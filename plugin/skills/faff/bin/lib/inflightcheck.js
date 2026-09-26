// ===========================================================================
// === region:governance — inflightcheck — refuse a turn-end with an Agent dispatch still in flight (FAFF-884) ===
// The fourth member of the Stop-hook family (runcheck / prepcheck / sentrycheck):
// the orchestrator writes a per-dispatch marker before an Agent-tool Producer
// dispatch (`--open`) and clears it after the tool result returns (`--close`);
// this hook audits those markers at turn-end and blocks the OWNING session from
// ending a turn while one is still open. It closes the arm background-fence
// abstains from — a backgrounded Agent dispatch that dies at turn-end strands the
// run with `owner.status:"running"` and no live process (the observed L4 drain bug).
//
// The doctrine ("never end a turn with a dispatched step in flight") was written at
// three prose altitudes and unenforced on the Agent arm; this is the mechanical floor.
// Like the rest of the family it trusts the externalised marker and never touches the
// tracker (the pure-function CLI invariant).
//
// Two design pins the objections drove (see the spec):
//  - PATH-DERIVED OWNERSHIP. The owner identity is encoded in the marker's PATH
//    (`.faff/inflight/<owner-scope>/<key>.json`), not only its body, so a corrupt/
//    unparseable body that PATH-proves it OWNED still fails CLOSED (block) rather
//    than fails open — the exact silent-strand class the fix exists to prevent.
//  - AGE-ALONE SWEEP. An OWNED marker whose `opened_at` is past the TTL is a corpse
//    (the dispatch that opened it is gone) and is SWEPT, keyed on opened_at age ALONE
//    — never runIsHeld — so a same-scope launcher resuming the run keeps the run
//    heartbeat fresh yet cannot leave the corpse un-swept and wedge turn-end forever.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { overlayHeartbeat, readHeartbeatFile } = require("./heartbeat");
const { runIsHeld } = require("./runcheck");
const { findRoot, readLedger, RUN_HEARTBEAT_STALE_SECS_DEFAULT } = require("./shared-infra");

// The dispatch key is used verbatim as the marker's file basename, so it is
// constrained to a safe charset with NO leading dot (a ".foo" key writes a
// ".foo.json" dotfile a shell `*.json` glob would skip — a fail-open hole; this
// hook reads via readdirSync so it is dotfile-inclusive regardless, but the write
// side rejects the leading dot so neither layer alone is the sole guard). No path
// separator and no leading dot means a key can never be "." / ".." nor escape the
// owner-scope directory.
const INFLIGHT_KEY_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
function isValidKey(k) { return typeof k === "string" && INFLIGHT_KEY_RE.test(k); }

// slug(s) := <sanitised>-<hash8>. The sanitised prefix replaces every run of chars
// outside [A-Za-z0-9_-] with "-" (so no "/" or ".." survives into the path); the
// 8-hex hash of the FULL original string makes the slug injective, so two distinct
// run dirs never collide onto one owner-scope (a collision would misclassify a
// foreign marker as owned — a false-positive turn-end block).
function slugScope(s) {
  const sanitised = String(s).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
  const hash8 = crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 8);
  return `${sanitised}-${hash8}`;
}

// This session's owner-scope, path-encoded as the marker subdirectory:
//   slug(FAFF_RUN_DIR) when set, else slug(FAFF_SESSION_ID) when set,
//   else slug(CLAUDE_CODE_SESSION_ID) when set, else "local".
// The CLAUDE_CODE_SESSION_ID tier (FAFF-1096) gives an interactive Claude Code
// session — which sets neither FAFF_RUN_DIR nor FAFF_SESSION_ID — a real per-session
// scope, so two interactive sessions no longer collapse onto one shared "local" scope
// and cross-block on each other's markers. A session with none of the three still
// falls to "local" (safe degradation, no new fail-open); the age-alone sweep bounds
// any residual cross-session block there exactly as before.
function resolveOwnerScope(env) {
  const e = env || process.env;
  if (e.FAFF_RUN_DIR) return slugScope(e.FAFF_RUN_DIR);
  if (e.FAFF_SESSION_ID) return slugScope(e.FAFF_SESSION_ID);
  if (e.CLAUDE_CODE_SESSION_ID) return slugScope(e.CLAUDE_CODE_SESSION_ID);
  return "local";
}

// Does the harness track a backgrounded Agent dispatch ACROSS the turn boundary and
// re-invoke the parent when the child completes? (FAFF-1096.) Interactive Claude Code
// does: its Agent tool is always-background, yet the child survives turn-end and the
// parent is re-invoked, so an OWN marker still open at turn-end is NOT a strand and must
// not block. The signal is the interactive proxy CLAUDE_CODE_SESSION_ID present AND
// FAFF_RUN_DIR absent: FAFF_RUN_DIR marks the autonomous/headless run path (beep-boop
// always sets it) where turn-end kills the cage and the stranding premise DOES hold, so
// the block stays. Absent CLAUDE_CODE_SESSION_ID → false (degrade to block; never fail
// open — a genuinely stranded headless child is still caught). A bare `claude -p` prep
// with no FAFF_RUN_DIR is the one disclosed residual (see the spec Punt): swept at TTL.
function isHarnessTrackedBackground(env) {
  const e = env || process.env;
  return !!(e.CLAUDE_CODE_SESSION_ID && !e.FAFF_RUN_DIR);
}

// The sweep TTL. Defaults to the same 900s window the ledger liveness check uses
// (one source, RUN_HEARTBEAT_STALE_SECS_DEFAULT), overridable via FAFF_INFLIGHT_STALE_SECS
// for tuning — mirrors runcheck's heartbeatStaleSecs / prepcheck's prepMarkerStaleSecs.
function inflightStaleSecs(env) {
  const raw = (env || process.env).FAFF_INFLIGHT_STALE_SECS;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : RUN_HEARTBEAT_STALE_SECS_DEFAULT;
}

// Is a marker's opened_at older than the sweep TTL? A missing/unparseable opened_at
// on an otherwise-parseable marker is NOT stale (fail-closed: an owned marker with a
// mangled opened_at blocks rather than being silently swept — the owner clears it
// with `--close`). nowMs/env injectable so the decision runs as a pure function.
function inflightIsStale(openedAt, nowMs, env) {
  const t = Date.parse(openedAt);
  if (!Number.isFinite(t)) return false;
  return (nowMs - t) / 1000 > inflightStaleSecs(env);
}

// Non-throwing readLedger for the foreign-liveness delegation: a foreign marker's
// owner.run_dir may point at a deleted / rotated / never-existed run dir, so a
// missing OR malformed ledger resolves to null (the tier no-ops) — never throws.
function tryReadLedger(runDir) {
  try { return readLedger(runDir); } catch { return null; }
}

// Is a FOREIGN marker still HELD by a live owner? Two-tier, mirroring prepIsHeld —
// held if EITHER tier judges it live:
//   (a) ledger-delegation — when owner.run_dir references a run ledger, delegate to
//       runIsHeld(that ledger) with the dedicated heartbeat file overlaid first.
//   (b) opened_at floor — a marker opened within the TTL is presumed live (covers a
//       foreign marker with no readable ledger, e.g. a session-scoped or local one).
// Neither live ⇒ NOT held (abandoned-looking). This only ever decides SILENT vs WARN
// for a foreign marker (a non-owner is never hard-blocked except under --recover), so
// erring live keeps the non-owner silent, never trapped.
function inflightForeignHeld(marker, nowMs, env) {
  const owner = marker && marker.owner;
  if (owner && owner.run_dir) {
    const ledger = tryReadLedger(owner.run_dir);
    if (ledger) {
      overlayHeartbeat(ledger, readHeartbeatFile(owner.run_dir));
      if (runIsHeld(ledger, nowMs, env)) return true; // tier (a)
    }
  }
  const t = Date.parse(marker && marker.opened_at);
  if (Number.isFinite(t) && (nowMs - t) / 1000 <= inflightStaleSecs(env)) return true; // tier (b)
  return false;
}

// Read every marker under .faff/inflight/<scope>/*.json across ALL scopes. The read
// is dotfile-inclusive (readdirSync lists dotfiles) and tolerant — a malformed body
// is kept with parseOk:false (ownership is still decidable from the PATH), a
// non-file / non-.json entry is skipped, never fatal. Each entry carries its scope
// (the subdirectory name) so ownership is a pure path comparison.
function readInflightMarkers(root) {
  const dir = path.join(root, ".faff", "inflight");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  let scopes;
  try { scopes = fs.readdirSync(dir); } catch { return []; }
  for (const scope of scopes) {
    const scopeDir = path.join(dir, scope);
    let st; try { st = fs.statSync(scopeDir); } catch { continue; }
    if (!st.isDirectory()) continue;
    let names; try { names = fs.readdirSync(scopeDir); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(scopeDir, name);
      let fst; try { fst = fs.statSync(file); } catch { continue; }
      if (!fst.isFile()) continue;
      const key = name.replace(/\.json$/, "");
      let raw; try { raw = fs.readFileSync(file, "utf8"); } catch { out.push({ scope, key, file, parseOk: false }); continue; }
      let m; try { m = JSON.parse(raw); } catch { out.push({ scope, key, file, parseOk: false }); continue; }
      if (!m || typeof m !== "object" || Array.isArray(m)) { out.push({ scope, key, file, parseOk: false }); continue; }
      out.push({ scope, key, file, parseOk: true, opened_at: m.opened_at, describe: m.describe, owner: m.owner || null });
    }
  }
  return out;
}

function inflightReason(keys) {
  return (
    `faff inflightcheck: this session left ${keys.length} Agent dispatch(es) in flight at turn-end: ${keys.join(", ")}. ` +
    `A dispatched step must not be left running when the turn ends — under headless \`claude -p\` the turn end kills the ` +
    `cage and the child dies with it, stranding the run (owner.status:"running", no live process). Finish the step in the ` +
    `foreground this turn (re-issue with run_in_background: false and let its result return), or take the step's held ` +
    `outcome and record a terminal outcome in the run ledger, then clear the marker: faff inflightcheck --close --key <key>.`
  );
}

// The SOLE per-marker "would this block turn-end?" predicate (FAFF-1096) — pure,
// filesystem-free, and shared by inflightHookDecision (below) AND turncheck's
// hasOpenInflightForOwner, so the two can never drift (the coupling turncheck.js:48-55
// mandates). A marker blocks IFF it is owned-by-path AND is not a swept corpse AND the
// harness does not track the background child across the turn boundary:
//   foreign                          → false (a non-owner never blocks; warn/silent decided in the hook)
//   owned + unparseable body         → true  (fail closed — the PATH proves ownership)
//   owned + stale (opened_at > TTL)  → false (corpse; swept, not blocked)
//   owned + harness-tracked-bg       → false (interactive Claude Code re-invokes the parent — not a strand)
//   owned + fresh + stranding holds  → true  (a live strand this turn)
// It models the normal turn-end decision; the hook's --recover human override (foreign
// → block) is deliberately outside this predicate, and turncheck never uses --recover.
function inflightWouldBlock(marker, nowMs, env) {
  const owned = marker.scope === resolveOwnerScope(env);
  if (!owned) return false;
  if (!marker.parseOk) return true;
  if (inflightIsStale(marker.opened_at, nowMs, env)) return false;
  if (isHarnessTrackedBackground(env)) return false;
  return true;
}

// Pure per-marker decision for the Stop hook — the twin of prepcheckHookDecision.
// Each marker is decided INDEPENDENTLY against THIS session's owner-scope (path
// comparison, no body parse needed for ownership):
//   - unparseable body, owned-by-path  → block  (fail closed — never fail open)
//   - unparseable body, foreign        → silent (a non-owner's corrupt marker is unassessable)
//   - owned + stale (opened_at age > TTL) → sweep (corpse; the wedge escape), never blocks
//   - owned + fresh + harness-tracked-bg → note  (FAFF-1096: tracked child survives turn-end, not a strand)
//   - owned + fresh + stranding holds  → block  (a live strand this turn)
//   - foreign + held                   → silent
//   - foreign + not-held               → warn, unless --recover forces the block
// The block routing agrees with inflightWouldBlock by construction (same owned/stale/
// tracked sub-conditions). Returns { block:[keys], warn:[keys], sweep:[{scope,key,file}],
// note:[keys] }. The ledger read for foreign liveness happens inside inflightForeignHeld;
// the selftest's synthetic run_dir resolves to null on disk so the opened_at floor decides.
function inflightHookDecision(markers, nowMs, env, opts) {
  const recover = !!(opts && opts.recover);
  const thisScope = resolveOwnerScope(env);
  const block = [];
  const warn = [];
  const sweep = [];
  const note = [];
  for (const m of markers) {
    const owned = m.scope === thisScope;
    if (!m.parseOk) {
      if (owned) block.push(m.key); // fail-closed; foreign unparseable → silent (unassessable non-owner)
      continue;
    }
    if (owned) {
      if (inflightIsStale(m.opened_at, nowMs, env)) sweep.push({ scope: m.scope, key: m.key, file: m.file });
      else if (isHarnessTrackedBackground(env)) note.push(m.key); // harness-tracked bg child — not a strand
      else block.push(m.key);
      continue;
    }
    // foreign
    if (inflightForeignHeld(m, nowMs, env)) continue; // silent
    if (recover) block.push(m.key);
    else warn.push(m.key);
  }
  return { block: [...new Set(block)].sort(), warn: [...new Set(warn)].sort(), sweep, note: [...new Set(note)].sort() };
}

const { parseArgs, usageError } = require("./argv");
const INFLIGHTCHECK_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--hook": { arity: 0 }, "--json": { arity: 0 }, "--recover": { arity: 0 },
  "--root": { arity: 1 }, "--open": { arity: 0 }, "--close": { arity: 0 }, "--key": { arity: 1 }, "--describe": { arity: 1 },
} };

function markerPath(root, scope, key) {
  return path.join(root, ".faff", "inflight", scope, `${key}.json`);
}

function cmdInflightcheck(args) {
  if (args.includes("--selftest")) return inflightcheckSelftest();
  const { values, errors } = parseArgs(args, INFLIGHTCHECK_SPEC);
  if (errors.length) return usageError(errors, "usage: faff inflightcheck (--open --key K [--describe T] | --close --key K | --hook | --json) [--recover] [--root DIR]");
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const root = get("--root") || findRoot();
  const key = get("--key");

  // --open: write the per-dispatch marker under this session's owner-scope.
  if (values["--open"]) {
    if (!isValidKey(key)) { process.stderr.write(`faff inflightcheck --open: --key must match ${INFLIGHT_KEY_RE} (no path separator, no leading dot)\n`); return 2; }
    const scope = resolveOwnerScope(process.env);
    const owner = {};
    if (process.env.FAFF_RUN_DIR) owner.run_dir = process.env.FAFF_RUN_DIR;
    // owner.session_id is attribution/forensics only — the ownership DECISION stays
    // path-derived (the scope subdir), so the body is never trusted for a block. Stamp
    // FAFF_SESSION_ID first, else CLAUDE_CODE_SESSION_ID (FAFF-1096); omit when neither
    // is set rather than writing an empty string (legacy-tolerant, mirrors prepcheck).
    const sessionId = process.env.FAFF_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID;
    if (sessionId) owner.session_id = sessionId;
    const marker = { key, describe: get("--describe") || key, opened_at: new Date().toISOString(), owner };
    const dir = path.join(root, ".faff", "inflight", scope);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(markerPath(root, scope, key), JSON.stringify(marker, null, 2) + "\n");
    return 0;
  }

  // --close: remove THIS session's marker for the key (idempotent — absent = success).
  if (values["--close"]) {
    if (!isValidKey(key)) { process.stderr.write(`faff inflightcheck --close: --key must match ${INFLIGHT_KEY_RE} (no path separator, no leading dot)\n`); return 2; }
    const scope = resolveOwnerScope(process.env);
    try { fs.rmSync(markerPath(root, scope, key)); } catch { /* ENOENT / already gone → idempotent success */ }
    return 0;
  }

  const markers = readInflightMarkers(root);

  if (values["--hook"]) {
    const recover = !!values["--recover"];
    const d = inflightHookDecision(markers, Date.now(), process.env, { recover });
    // Sweep first — remove each corpse and surface a non-blocking notice, so an
    // orphaned owned marker can never wedge turn-end indefinitely.
    for (const s of d.sweep) {
      try { fs.rmSync(s.file); } catch { /* raced away → fine */ }
      process.stderr.write(`[warn] swept stale in-flight marker ${s.key}: owning dispatch no longer live\n`);
    }
    // Harness-tracked own dispatches (FAFF-1096): surface a non-blocking note and do NOT
    // block — the child survives turn-end and the harness re-invokes the parent.
    if (d.note.length) process.stderr.write(`[note] ${d.note.length} harness-tracked Agent dispatch(es) still in flight at turn-end (not stranded — the harness re-invokes the parent on completion): ${d.note.join(", ")}\n`);
    // block via the decision payload on stdout (the Stop-hook block mechanism), not
    // the exit code — same as runcheck/prepcheck --hook. Foreign abandoned → stderr warn.
    if (d.block.length) console.log(JSON.stringify({ decision: "block", reason: inflightReason(d.block) }));
    else if (d.warn.length) process.stderr.write(`[warn] ${inflightReason(d.warn)}\n`);
    return 0;
  }

  // Plain / --json report (owned-marker scan; not a hook payload). Reports every
  // marker THIS session owns that is still open, mirroring runcheck/prepcheck's CLI mode.
  const thisScope = resolveOwnerScope(process.env);
  const openOwned = [...new Set(markers.filter((m) => m.scope === thisScope).map((m) => m.key))].sort();
  if (values["--json"]) {
    console.log(JSON.stringify({ scope: thisScope, open: openOwned, scanned: markers.length }, null, 2));
  } else if (openOwned.length) {
    console.log(`OPEN (${openOwned.length}) under scope ${thisScope}: ${openOwned.join(", ")}`);
    console.log("→ an Agent dispatch is recorded in flight: finish it in the foreground, record its outcome, or `faff inflightcheck --close --key <key>`.");
  } else {
    console.log(`clean: ${markers.length} in-flight marker(s) scanned, none open for this session (scope ${thisScope}).`);
  }
  return openOwned.length ? 3 : 0;
}

// ---------------------------------------------------------------------------
// Selftest — drives the pure decision over synthetic markers with a fixed NOW
// anchoring the opened_at ages, plus a small key-validation + slug table. A
// synthetic owner.run_dir resolves to null on disk, so the foreign-liveness
// opened_at floor decides (filesystem-free) — the live ledger-delegated tier is
// covered with real fixtures in test/inflightcheck.test.mjs.
// ---------------------------------------------------------------------------
const INFLIGHT_NOW = Date.parse("2026-08-19T16:00:00Z");
const inflightAgo = (secs) => new Date(INFLIGHT_NOW - secs * 1000).toISOString();
// Build a marker whose scope is THIS session's scope (owned) or a foreign scope.
const ownedScope = (env) => resolveOwnerScope(env);
const ownM = (env, extra) => ({ scope: ownedScope(env), key: "K", parseOk: true, ...extra });
const forM = (extra) => ({ scope: "ZZ-foreign-scope", key: "K", parseOk: true, ...extra });

// [name, marker, env, wantBlock, wantWarn, wantSweep, wantNote, opts?]
const INFLIGHT_HOOK_SELFTEST_CASES = [
  ["owned + fresh opened_at → block (live strand this turn)",
    ownM({ FAFF_SESSION_ID: "S1" }, { opened_at: inflightAgo(10) }), { FAFF_SESSION_ID: "S1" }, true, false, false, false],
  ["owned + stale opened_at → SWEEP (corpse; the wedge escape), no block",
    ownM({ FAFF_SESSION_ID: "S1" }, { opened_at: inflightAgo(1000) }), { FAFF_SESSION_ID: "S1" }, false, false, true, false],
  ["owned + stale opened_at + a still-live same-scope run heartbeat → STILL swept (age alone, not runIsHeld)",
    ownM({ FAFF_SESSION_ID: "S1" }, { opened_at: inflightAgo(1000), owner: { run_dir: "/runs/OWNED-LIVE" } }), { FAFF_SESSION_ID: "S1" }, false, false, true, false],
  ["owned + unparseable body → block (fail closed, path-derived ownership)",
    ownM({ FAFF_SESSION_ID: "S1" }, { parseOk: false }), { FAFF_SESSION_ID: "S1" }, true, false, false, false],
  ["owned via FAFF_RUN_DIR scope + fresh → block",
    ownM({ FAFF_RUN_DIR: "/runs/MINE" }, { opened_at: inflightAgo(10) }), { FAFF_RUN_DIR: "/runs/MINE" }, true, false, false, false],
  ["foreign + fresh opened_at → silent (held via opened_at floor)",
    forM({ opened_at: inflightAgo(10) }), { FAFF_SESSION_ID: "S1" }, false, false, false, false],
  ["foreign + stale opened_at + no live ledger → WARN, not block",
    forM({ opened_at: inflightAgo(1000), owner: { run_dir: "/runs/OTHER" } }), { FAFF_SESSION_ID: "S1" }, false, true, false, false],
  ["foreign + unparseable body → silent (a non-owner's corrupt marker is unassessable)",
    forM({ parseOk: false }), { FAFF_SESSION_ID: "S1" }, false, false, false, false],
  ["foreign + stale + --recover → block (deliberate human recovery)",
    forM({ opened_at: inflightAgo(1000), owner: { run_dir: "/runs/OTHER" } }), { FAFF_SESSION_ID: "S1" }, true, false, false, false, { recover: true }],
  ["foreign + fresh + --recover → silent (nothing to recover)",
    forM({ opened_at: inflightAgo(10) }), { FAFF_SESSION_ID: "S1" }, false, false, false, false, { recover: true }],
  ["owned + stale + --recover → still SWEEP (recover never turns a corpse into a block)",
    ownM({ FAFF_SESSION_ID: "S1" }, { opened_at: inflightAgo(1000) }), { FAFF_SESSION_ID: "S1" }, false, false, true, false, { recover: true }],
  ["custom FAFF_INFLIGHT_STALE_SECS shrinks the window: owned opened 120s ago, TTL 60 → SWEEP",
    ownM({ FAFF_SESSION_ID: "S1", FAFF_INFLIGHT_STALE_SECS: "60" }, { opened_at: inflightAgo(120) }),
    { FAFF_SESSION_ID: "S1", FAFF_INFLIGHT_STALE_SECS: "60" }, false, false, true, false],
  // --- FAFF-1096: interactive Claude Code (CLAUDE_CODE_SESSION_ID) owner-scope + harness-tracked-bg ---
  ["FAFF-1096: owned + fresh + interactive Claude Code (CC session, no FAFF_RUN_DIR) → NOTE, not block (harness re-invokes)",
    ownM({ CLAUDE_CODE_SESSION_ID: "cc-A" }, { opened_at: inflightAgo(10) }), { CLAUDE_CODE_SESSION_ID: "cc-A" }, false, false, false, true],
  ["FAFF-1096: owned + fresh + FAFF_RUN_DIR set (headless/autonomous under claude-code) → block (stranding premise holds)",
    ownM({ FAFF_RUN_DIR: "/runs/MINE", CLAUDE_CODE_SESSION_ID: "cc-A" }, { opened_at: inflightAgo(10) }),
    { FAFF_RUN_DIR: "/runs/MINE", CLAUDE_CODE_SESSION_ID: "cc-A" }, true, false, false, false],
  ["FAFF-1096 (Dimension 2): peer interactive session's fresh marker → silent, NOT block (distinct CC scope)",
    { scope: slugScope("cc-A"), key: "FAFF-1078", parseOk: true, opened_at: inflightAgo(10), owner: { session_id: "cc-A" } },
    { CLAUDE_CODE_SESSION_ID: "cc-B" }, false, false, false, false],
  ["FAFF-1096 (Dimension 2): legacy \"local\" owner:{} marker, stale → WARN not block for a real-scope session",
    { scope: "local", key: "FAFF-1016", parseOk: true, opened_at: inflightAgo(1000), owner: {} },
    { CLAUDE_CODE_SESSION_ID: "cc-A" }, false, true, false, false],
  ["FAFF-1096: owned + stale under interactive CC scope → SWEEP (corpse still swept, harness-tracked never masks a corpse)",
    ownM({ CLAUDE_CODE_SESSION_ID: "cc-A" }, { opened_at: inflightAgo(1000) }), { CLAUDE_CODE_SESSION_ID: "cc-A" }, false, false, true, false],
];

// [name, key, wantValid]
const INFLIGHT_KEY_SELFTEST_CASES = [
  ["issue id", "FAFF-884", true],
  ["smoke key", "SMOKE-1", true],
  ["internal dots ok (single component, no traversal)", "a.b_c-1", true],
  ["leading dot → reject (would write a glob-skipped dotfile)", ".hidden", false],
  ["path separator → reject", "a/b", false],
  ["parent traversal → reject", "../etc", false],
  ["dotdot → reject (leading dot)", "..", false],
  ["empty → reject", "", false],
];

function inflightcheckSelftest() {
  let fail = 0;
  for (const [name, marker, env, wantBlock, wantWarn, wantSweep, wantNote, opts] of INFLIGHT_HOOK_SELFTEST_CASES) {
    const d = inflightHookDecision([marker], INFLIGHT_NOW, env, opts);
    const gotBlock = d.block.length > 0;
    const gotWarn = d.warn.length > 0;
    const gotSweep = d.sweep.length > 0;
    const gotNote = d.note.length > 0;
    let ok = gotBlock === wantBlock && gotWarn === (wantWarn || false) && gotSweep === (wantSweep || false) && gotNote === (wantNote || false);
    // Cross-check: the SOLE would-block predicate must agree with the hook's block
    // routing on every non-recover case (--recover is a human override outside the
    // predicate). This is the anti-drift tie between inflightWouldBlock and the hook.
    if (!(opts && opts.recover)) {
      const wouldBlock = inflightWouldBlock(marker, INFLIGHT_NOW, env);
      if (wouldBlock !== gotBlock) { ok = false; console.log(`FAIL ${name} → inflightWouldBlock=${wouldBlock} disagrees with hook block=${gotBlock}`); }
    }
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} → block=${gotBlock} warn=${gotWarn} sweep=${gotSweep} note=${gotNote} (want block=${wantBlock} warn=${wantWarn || false} sweep=${wantSweep || false} note=${wantNote || false})`);
  }
  // A concurrency non-regression the pure decision CAN assert: N owned+fresh markers
  // open at a Stop event all block (a real strand); the executor's await-all prose is
  // what guarantees the Stop event is never reached mid-poll (not a hook property).
  {
    const env = { FAFF_SESSION_ID: "S1" };
    const many = [0, 1, 2].map((i) => ({ scope: ownedScope(env), key: `B${i}`, parseOk: true, opened_at: inflightAgo(10) }));
    const d = inflightHookDecision(many, INFLIGHT_NOW, env, {});
    const ok = d.block.length === 3 && d.warn.length === 0 && d.sweep.length === 0;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} N owned+fresh markers open at Stop → all 3 block → block=${d.block.length} (want 3)`);
  }
  for (const [name, key, wantValid] of INFLIGHT_KEY_SELFTEST_CASES) {
    const got = isValidKey(key);
    const ok = got === wantValid;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} key ${name}: ${JSON.stringify(key)} → valid=${got} (want ${wantValid})`);
  }
  // slug determinism + injectivity + traversal-safety
  {
    const a = slugScope("/runs/one"); const a2 = slugScope("/runs/one"); const b = slugScope("/runs/two");
    const noTraversal = !/[/]/.test(a) && !a.includes("..");
    const ok = a === a2 && a !== b && noTraversal;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} slug deterministic+injective+traversal-safe → ${a} / ${b}`);
  }
  // FAFF-1096: resolveOwnerScope gains the CLAUDE_CODE_SESSION_ID tier below FAFF_SESSION_ID
  // and above the "local" fallback; precedence FAFF_RUN_DIR > FAFF_SESSION_ID > CC > local.
  {
    const cc = resolveOwnerScope({ CLAUDE_CODE_SESSION_ID: "cc-A" }) === slugScope("cc-A");
    const loc = resolveOwnerScope({}) === "local";
    const sessOverCc = resolveOwnerScope({ FAFF_SESSION_ID: "S1", CLAUDE_CODE_SESSION_ID: "cc-A" }) === slugScope("S1");
    const runOverAll = resolveOwnerScope({ FAFF_RUN_DIR: "/r", FAFF_SESSION_ID: "S1", CLAUDE_CODE_SESSION_ID: "cc-A" }) === slugScope("/r");
    const ok = cc && loc && sessOverCc && runOverAll;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} resolveOwnerScope tiers: CC tier + local fallback + FAFF precedence`);
  }
  // FAFF-1096: isHarnessTrackedBackground iff CLAUDE_CODE_SESSION_ID ∧ ¬FAFF_RUN_DIR.
  {
    const t1 = isHarnessTrackedBackground({ CLAUDE_CODE_SESSION_ID: "cc-A" }) === true;                       // interactive CC
    const t2 = isHarnessTrackedBackground({ CLAUDE_CODE_SESSION_ID: "cc-A", FAFF_RUN_DIR: "/r" }) === false;  // headless/autonomous
    const t3 = isHarnessTrackedBackground({}) === false;                                                      // no CC → degrade to block
    const t4 = isHarnessTrackedBackground({ FAFF_SESSION_ID: "S1" }) === false;                               // faff session, not CC
    const ok = t1 && t2 && t3 && t4;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} isHarnessTrackedBackground truth table (CC ∧ ¬RUN_DIR only)`);
  }
  const total = INFLIGHT_HOOK_SELFTEST_CASES.length + 1 + INFLIGHT_KEY_SELFTEST_CASES.length + 1 + 2;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  INFLIGHT_HOOK_SELFTEST_CASES, INFLIGHT_KEY_SELFTEST_CASES, INFLIGHT_KEY_RE, INFLIGHT_NOW,
  cmdInflightcheck, inflightAgo, inflightForeignHeld, inflightHookDecision, inflightIsStale,
  inflightReason, inflightStaleSecs, inflightWouldBlock, isHarnessTrackedBackground, isValidKey,
  markerPath, readInflightMarkers, resolveOwnerScope, slugScope, tryReadLedger,
};
