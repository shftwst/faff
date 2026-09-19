// ===========================================================================
// === region:factory — run-ledger — FAFF-761: the standalone-interactive L2 mint. ===
//
// `faff run-ledger init-interactive` is the L2 SIBLING of `faff lights-out`'s L4
// `mintLightsOut` (lights-out.js ~899): it creates a fresh interactive run dir with a
// minimal, HONEST `run-ledger.json` (level "L2") + a genesis `events.jsonl` chain, so a
// directly-invoked `/faff-graft` (no beep-boop orchestrator above it) has the SAME anchor
// substrate `faff events anchor` (Step 9b) already knows how to byte-copy — and
// `faff merge-gate`'s fail-closed anchor floor is satisfied HONESTLY, never weakened.
//
// Load-bearing invariants (the merge-floor trust machinery — do not soften):
//   * level is the CONSTANT "L2", written UNCONDITIONALLY. There is NO flag that
//     sets/raises/lowers it (exactly as mintLightsOut hardcodes "L4"). The anchored
//     `level` is the merge-gate ceiling (FAFF-690) — never operator-settable at mint.
//   * every chain hash (the genesis `prev`, each link, the anchor's chain-head.json
//     witness) is CLI-computed inside appendRecordUnderLock / computeChainHead — the
//     caller never supplies a hash. Because the run dir's basename IS the run_id, the
//     genesis `prev` = SHA-256(run_id), so the chain still verifies after `events anchor`
//     relocates it under `.faff/anchors/<run-id>/<issue>/` (FAFF-568 verifier rule).
//   * CLI-LEVEL trust guard (defense-in-depth, infosec): the mint REFUSES (exit 3) +
//     emits a refusal observe when FAFF_RUN_DIR (or --root's newest run dir) already
//     resolves a LIVE run at a level ABOVE L2 (L3/L4, owner.status:"running") — an
//     interactive L2 mint must never silently downgrade a live higher-level run. The
//     boundary is enforced HERE in the deterministic CLI, not only in swappable graft
//     prose. It grants no new capability; it only forecloses the one concrete downgrade a
//     stray/duplicate invocation could cause, and it never authenticates the caller.
// ===========================================================================

"use strict";

const crypto = require("node:crypto");
const fs = require("fs");
const path = require("path");

const { parseArgs, usageError } = require("./argv");
const { findRoot, latestRunDir } = require("./shared-infra");
const { mutateLedgerUnderLock } = require("./heartbeat");
const { appendRecordUnderLock, appendEventRecord, computeChainHead, emitGenesisRunStart, verifyChain, verifyExitCode, EVENT_LEDGER_OUTCOMES } = require("./events");
// FAFF-1028: lazy-resolved at mint time (not required at module top) — merge-gate.js is a much
// heavier module (contract-defs/container-check/commissaire/gates/…) than run-ledger.js needs
// for the rest of its own work, and there is no load-order hazard either way (merge-gate.js
// never requires run-ledger.js), but keeping this require inside resolveMintBaseSha means a
// module that only ever calls record-outcome pays nothing for it.

// The one level this verb ever writes — a FLOOR_LEVELS member (contract-defs.js), read by
// merge-gate's resolveAnchorLevel. A CONSTANT, never flag-derived (see the module header).
const INTERACTIVE_LEVEL = "L2";
// FAFF-966 — the L3 sibling constant `init-self-drain` mints. Also a CONSTANT, never
// flag-derived — no `--level` flag exists on either verb.
const SELF_DRAIN_LEVEL = "L3";
// Levels ABOVE L2 that the guard refuses to silently downgrade when live. Reused AS-IS
// (identical shape, per the spec) for init-self-drain's own guard — an L3 self-drain mint
// must not start alongside, or downgrade, an already-live L3 or L4 run either.
const HIGHER_LEVELS = new Set(["L3", "L4"]);
// The bare-issue-id shape merge-gate.js / `events anchor` --issue already enforce (a shared
// floor, never a forked rule): reject anything that could walk a path outside the run dir.
const ISSUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// FAFF-1028 — the post-feature mint marker: a run minted by a build that carries this field
// (always `true`) is one whose ledger `faff effects reconcile-merges` (effects-reconcile.js)
// MUST be able to trust `base_sha` on. A run minted before this slice shipped has neither key at
// all, which is the DISCRIMINATOR the reconcile uses to treat it as legacy-exempt rather than a
// fault — the marker is a MINT-TIME fact, never inferable from base_sha's mere absence (that
// ambiguity is exactly what the field incident this ticket fixes lacked). Shared verbatim with
// mintLightsOut's own L4 ledger object (lights-out.js) and effects-reconcile.js's own read of it
// — one literal, one home, never independently retyped at each of the three mint sites/reader.
const MINT_MARKER_KEY = "base_sha_required";

// FAFF-1028 — resolve the protected branch's CURRENT local HEAD sha at mint time, for the
// `base_sha` hard input the off-ledger reconcile needs (spec §3 "Base anchor recording"). Local
// git only (never a forge query) — mirrors merge-gate.js's own `resolveLocalBase` exactly, so the
// mint-time anchor and the reconcile-time base always name the same branch. Best-effort and
// NEVER throws: an unresolvable branch/sha degrades to `null` (the reconcile then faults
// "no base anchor" on this run rather than the mint itself failing over a detection feature).
//
// No mint/first-merge race (adversarial review, code review round 2): this call is the FIRST
// write of a brand-new run dir at every call site (init-interactive/init-self-drain create the
// run dir, then mint the ledger with this value) — nothing can land "as part of this run" before
// the run itself exists, so there is no window in which a merge could precede the base_sha it is
// meant to be measured against.
function resolveMintBaseSha(root) {
  try {
    const { gitRun, resolveLocalBase } = require("./merge-gate");
    const branch = resolveLocalBase(root, null);
    if (!branch) return null;
    const r = gitRun(root, ["rev-parse", "--verify", "--quiet", branch], 5000);
    return r.ok && r.stdout ? r.stdout : null;
  } catch {
    return null;
  }
}

// PURE — the minimal honest L2 ledger object. Single-sourced here so the shape, the `level`
// constant, and the empty `outcomes` (the terminal is NOT yet known at mint — §4 sequencing)
// are testable and cannot drift into graft prose. Mirrors the beep-boop/lights-out ledger
// keys `runcheck` + the Stop hook already read (admitted/outcomes/owner/budget), so no reader
// needs a new shape and resolveAnchorLevel reads only `level`.
function buildInteractiveLedger({ runId, issue, nowIso, sessionId, pid, baseSha }) {
  return {
    run_id: runId,
    level: INTERACTIVE_LEVEL, // CONSTANT — never operator-settable
    admitted: [issue], // exactly the one issue this graft builds
    outcomes: {}, // EMPTY at mint — written only at the genuine terminal (graft step 6)
    budget: { envelope: { ceilings: {}, at_ceiling: "stop" } }, // minimal honest shape; no L4 governor
    // FAFF-1028: base_sha is the off-ledger reconcile's hard lower bound (null when the
    // protected branch was unresolvable at mint — the reconcile then faults on THIS run, never
    // silently reads clean); base_sha_required is the mint-time marker distinguishing a
    // post-feature run (must carry a resolvable base_sha) from a pre-feature legacy one.
    base_sha: baseSha === undefined ? null : baseSha,
    [MINT_MARKER_KEY]: true,
    owner: {
      status: "running", // → "done" at the graft terminal
      session_id: sessionId || runId,
      pid,
      started_at: nowIso,
      last_heartbeat: nowIso,
    },
  };
}

// FAFF-966 — PURE, the minimal honest L3 self-drain ledger object, mirroring
// buildInteractiveLedger's shape/rationale. NOT issue-scoped (`admitted` starts empty — a
// self-drain run admits issues over waves, at step 4, not at mint) and carries NO `budget`
// block: beep-boop's own `faff budget baseline` call (unchanged, run right after this mint)
// is what seeds `budget` — the new verb mints only the CORE shape (run dir, ledger, genesis),
// never beep-boop's richer augmentation fields (see the ticket's OUT-OF-SCOPE list).
function buildSelfDrainLedger({ runId, nowIso, sessionId, pid, baseSha }) {
  return {
    run_id: runId,
    level: SELF_DRAIN_LEVEL, // CONSTANT — never operator-settable
    admitted: [],
    outcomes: {},
    // FAFF-1028: see buildInteractiveLedger's own comment — identical rationale, additive here.
    base_sha: baseSha === undefined ? null : baseSha,
    [MINT_MARKER_KEY]: true,
    owner: {
      status: "running",
      session_id: sessionId || runId,
      pid,
      started_at: nowIso,
      last_heartbeat: nowIso,
    },
  };
}

// PURE — the honest terminal-outcome edit (§4 step 6): records `outcomes[issue]` = the
// terminal-state string, ALWAYS refreshes `owner.last_heartbeat` (a per-item write is proof of
// life), and flips `owner.status` to "done" ONLY when this write DRAINS the queue — every
// admitted item now has an outcome (FAFF-1024). "Drained" mirrors runcheck.js's own
// completeness core (`admitted − outcomes.keys() == ∅`, deduped) exactly — the two must never
// silently drift. A single-item ledger (the ordinary L2 interactive case) still drains on its
// one write, so this is backward compatible. On a non-draining write, `owner.status` is left
// exactly as it was — never invented, never overwritten to something other than "done".
// Single-sourced here so the terminal shape is testable and graft prose never hand-edits the
// ledger (the anti-pattern the spec forbids). Mutates a copy-in-place object under the lock.
function applyTerminalOutcome(ledger, issue, outcome, nowIso) {
  if (!ledger || typeof ledger !== "object") return ledger;
  ledger.outcomes = (ledger.outcomes && typeof ledger.outcomes === "object") ? ledger.outcomes : {};
  ledger.outcomes[issue] = outcome;
  ledger.owner = (ledger.owner && typeof ledger.owner === "object") ? ledger.owner : {};
  const admitted = Array.isArray(ledger.admitted) ? [...new Set(ledger.admitted)] : [];
  // Object.hasOwn (NOT the `in` operator, and NOT runcheck.js's own `!(i in outcomes)` —
  // a pre-existing, separately-tracked defect there, out of scope for this fix) — `in`
  // walks the prototype chain, so an admitted id that collides with an inherited
  // Object.prototype key ("constructor", "toString", "hasOwnProperty", …) would read as
  // already-dispatched even with zero recorded outcomes for it, wrongly draining the
  // queue and flipping owner.status to "done" while that item was never actually
  // recorded (caught by adversarial review, FAFF-1024).
  const undispatched = admitted.filter((i) => !Object.hasOwn(ledger.outcomes, i));
  const drained = undispatched.length === 0;
  if (drained) {
    ledger.owner.status = "done"; // last outcome / queue complete — never invented otherwise
  }
  ledger.owner.last_heartbeat = nowIso; // ALWAYS — proof of life, draining or not
  return ledger;
}

// PURE — the guard predicate: does this ledger describe a LIVE run at a level ABOVE L2?
// Fail-safe: a null/shapeless/level-absent ledger is NOT a live higher-level run (never
// blocks a legitimate mint on a malformed foreign ledger).
function isLiveHigherLevel(ledger) {
  return !!(
    ledger &&
    typeof ledger === "object" &&
    HIGHER_LEVELS.has(ledger.level) &&
    ledger.owner &&
    typeof ledger.owner === "object" &&
    ledger.owner.status === "running"
  );
}

// Resolve the run dir the guard inspects: an explicit FAFF_RUN_DIR carrying a run-ledger.json
// takes precedence (the dispatch/orchestrator-supplied dir); otherwise the newest run dir under
// root (latestRunDir only ever returns a dir already carrying run-ledger.json). Returns null
// when neither resolves — the common interactive case (graft only mints when FAFF_RUN_DIR is
// unset), so the guard is inert on a clean standalone graft.
function guardCandidateDir(root, env) {
  const explicit = env && typeof env.FAFF_RUN_DIR === "string" ? env.FAFF_RUN_DIR : "";
  if (explicit) {
    return fs.existsSync(path.join(explicit, "run-ledger.json")) ? explicit : null;
  }
  return latestRunDir(root);
}

// Read a run dir's ledger, tolerating any read/parse fault (a foreign/malformed ledger must
// never crash the mint — it simply isn't a live-higher-level run for the guard's purposes).
function readLedgerSafe(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "run-ledger.json"), "utf8"));
  } catch {
    return null;
  }
}

// Derive the UTC run stamp — the SAME derivation mintLightsOut uses (lights-out.js:907).
function utcStamp(nowIso) {
  return nowIso.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-"); // YYYYMMDD-HHMMSS
}

const RUN_LEDGER_SPEC = {
  flags: {
    "--issue": { arity: 1 },
    "--outcome": { arity: 1, enum: [...EVENT_LEDGER_OUTCOMES] },
    "--root": { arity: 1 },
    "--run-dir": { arity: 1 },
    "--id": { arity: 1 },
    "--mode": { arity: 1 },
    "--json": { arity: 0 },
    "--selftest": { arity: 0 },
  },
  positionals: { min: 0, max: 1, name: "subcommand" },
};

// The declared CLI grammar (FAFF-628). NB: there is deliberately NO --level flag on
// init-interactive/init-self-drain; each mints a CONSTANT level (L2 / L3 respectively).
// `record-outcome` is the honest terminal write on the interactive- or orchestrator-minted
// LIVE ledger (post-anchor) — the committed anchor is an immutable pre-merge snapshot.
// `init-self-drain` (FAFF-966) is the L3 sibling of `init-interactive` — no required flags
// (both `--mode` and `--id` are optional; it is not issue-scoped).
const RUN_LEDGER_SURFACE = {
  kind: "subcommand_dispatch",
  spec: RUN_LEDGER_SPEC,
  subcommands: {
    "init-interactive": { required_flags: ["--issue"] },
    "init-self-drain": { required_flags: [] },
    "record-outcome": { required_flags: ["--issue", "--outcome"] },
  },
};

const USAGE = "usage: faff run-ledger <init-interactive --issue <ISSUE-ID> [--root DIR] [--id RUN-ID] | init-self-drain [--mode MODE] [--id RUN-ID] [--root DIR] | record-outcome --issue <ISSUE-ID> --outcome <TERMINAL> [--run-dir DIR]> [--json] [--selftest]";

function cmdRunLedger(args) {
  if (args.includes("--selftest")) return runLedgerSelftest();
  const { values, positionals, errors } = parseArgs(args, RUN_LEDGER_SPEC);
  if (errors.length) return usageError(errors, USAGE);

  const sub = positionals[0];
  if (sub === "init-interactive") return initInteractive(values);
  if (sub === "init-self-drain") return initSelfDrain(values);
  if (sub === "record-outcome") return recordOutcome(values);
  process.stderr.write(`faff run-ledger: expected subcommand 'init-interactive' | 'init-self-drain' | 'record-outcome'${sub ? ` (got ${JSON.stringify(sub)})` : ""}\n${USAGE}\n`);
  return 2;
}

function initInteractive(values) {
  const issue = values["--issue"];
  if (!issue) {
    process.stderr.write(`faff run-ledger init-interactive: --issue is required\n${USAGE}\n`);
    return 2;
  }
  // Bad --issue → exit 2, mint NOTHING (no partial dir). Same shape check as `events anchor`.
  if (!ISSUE_ID_RE.test(issue) || issue.includes("..")) {
    process.stderr.write(`faff run-ledger init-interactive: --issue ${JSON.stringify(issue)} is not a valid issue id\n`);
    return 2;
  }

  const root = values["--root"] || findRoot();

  // An explicit --id (tests/determinism) becomes BOTH the run dir basename AND the ledger run_id —
  // so it must satisfy the same bare-id shape as --issue: a "/" would break basename==run_id (the
  // genesis-chain invariant), a ".." could walk outside .faff/runs/. Reject either (exit 2, no dir).
  const idArg = values["--id"];
  if (idArg !== undefined && (!ISSUE_ID_RE.test(idArg) || idArg.includes(".."))) {
    process.stderr.write(`faff run-ledger init-interactive: --id ${JSON.stringify(idArg)} is not a valid run id\n`);
    return 2;
  }

  // CLI-LEVEL trust guard (defense-in-depth): refuse (exit 3) + observe when a LIVE L3/L4 run
  // is already resolved — never silently downgrade it to an L2 mint. Runs BEFORE any dir is
  // created, so a refusal mints no partial dir.
  const candidate = guardCandidateDir(root, process.env);
  if (candidate) {
    const liveLedger = readLedgerSafe(candidate);
    if (isLiveHigherLevel(liveLedger)) {
      // Best-effort refusal observe onto the LIVE run's own timeline — this attempted-then-
      // refused L2 mint is a legitimate part of that run's history. A `sentry-trip` is the
      // honest event type for a guard that fired. Never let an emit fault change the exit-3
      // refusal (the refusal is the load-bearing behaviour; the observe is the record of it).
      try {
        appendRecordUnderLock(candidate, (seq, _prev, prevHash) => ({
          schema: 2,
          run_id: liveLedger.run_id || path.basename(candidate),
          seq,
          ts: new Date().toISOString(),
          prev: prevHash,
          phase: "run",
          type: "sentry-trip",
          data: {
            guard: "run-ledger-init-interactive-downgrade-refused",
            live_level: liveLedger.level,
            attempted_issue: issue,
          },
        }));
      } catch { /* observe is best-effort; the refusal below is unconditional */ }
      process.stderr.write(
        `faff run-ledger init-interactive: refusing — a live ${liveLedger.level} run (${liveLedger.run_id || path.basename(candidate)}) is already resolved; ` +
        `an L2 interactive mint must not downgrade a live higher-level run\n`
      );
      return 3;
    }
  }

  // MINT — mirror mintLightsOut's tail (create run dir, write ledger under lock, emit genesis).
  const nowIso = new Date().toISOString();
  const runId = values["--id"] || `run-${utcStamp(nowIso)}-graft-${issue}`;
  const runDir = path.join(root, ".faff", "runs", runId);
  // The run dir's basename IS the run_id — load-bearing for the genesis `prev` = SHA-256(run_id).
  fs.mkdirSync(runDir, { recursive: true });

  const ledger = buildInteractiveLedger({
    runId,
    issue,
    nowIso,
    sessionId: process.env.FAFF_SESSION_ID || null,
    pid: process.pid,
    baseSha: resolveMintBaseSha(root), // FAFF-1028 — null on an unresolvable branch, never thrown
  });
  // Route through the SAME locked core every ledger write uses (uniformity; a just-minted
  // dir cannot contend). The trivial mutate ignores the fresh read (initial creation).
  const mintWriteRes = mutateLedgerUnderLock(runDir, () => ledger);
  // Fail-closed on a non-write (lock-budget exhaustion yields without throwing) — never report a
  // successful mint over an absent ledger, which would build a level-less anchor merge-gate refuses.
  if (!mintWriteRes.written) {
    process.stderr.write(`faff run-ledger init-interactive: could not write ${path.join(runDir, "run-ledger.json")} (lock contention/abort) — no ledger minted\n`);
    return 3;
  }

  // Emit the genesis run-start onto the events chain via the shared FAFF-966 helper (never a
  // hand-duplicated emit) — byte-identical to before the extraction: no `data.level` (this L2
  // mint has never carried one; see the regression assertion in
  // run-ledger-init-interactive.test.mjs).
  emitGenesisRunStart(runDir);

  if (values["--json"]) {
    process.stdout.write(
      JSON.stringify({
        proceed: true,
        level: INTERACTIVE_LEVEL,
        run_id: runId,
        run_dir: runDir,
        ledger_sha256_before: mintWriteRes.before_sha256, // always null on a mint
        ledger_sha256_after: mintWriteRes.after_sha256,
      }) + "\n"
    );
  } else {
    // The bare-mode stdout is JUST the absolute run dir path — so the caller can
    // `export FAFF_RUN_DIR="$(faff run-ledger init-interactive --issue …)"`.
    process.stdout.write(runDir + "\n");
  }
  return 0;
}

// FAFF-966 — `faff run-ledger init-self-drain`: the L3 sibling of `init-interactive` (L2) and
// `mintLightsOut` (L4). Mints ATOMICALLY (mirrors init-interactive's tail): a fresh run dir,
// a minimal honest L3 `run-ledger.json`, and a genesis `events.jsonl` chain — so beep-boop's
// ordinary self-drain mint gets the SAME anchor substrate the other two levels already have,
// closing the provisioning gap this ticket exists to fix. NOT issue-scoped: a self-drain run
// admits issues over waves, so no `--issue` is required and `admitted` starts empty.
function initSelfDrain(values) {
  // --mode / --id share the SAME bare-id allowlist init-interactive already applies to
  // --issue/--id (reject "/" and ".."), validated BEFORE any dir is created — a bad value
  // mints NOTHING (exit 2, no partial dir). `--mode` needs this guard too: unlike --id it was
  // previously unvalidated in the prior (rejected) spec draft, but it lands in the run-dir path
  // (`run-<stamp>-beepboop-<mode>-<entropy>`) exactly like --id does.
  const modeArg = values["--mode"];
  if (modeArg !== undefined && (!ISSUE_ID_RE.test(modeArg) || modeArg.includes(".."))) {
    process.stderr.write(`faff run-ledger init-self-drain: --mode ${JSON.stringify(modeArg)} is not a valid mode\n`);
    return 2;
  }
  const idArg = values["--id"];
  if (idArg !== undefined && (!ISSUE_ID_RE.test(idArg) || idArg.includes(".."))) {
    process.stderr.write(`faff run-ledger init-self-drain: --id ${JSON.stringify(idArg)} is not a valid run id\n`);
    return 2;
  }

  const root = values["--root"] || findRoot();

  // CLI-LEVEL trust guard — IDENTICAL shape to init-interactive's own guard above (same
  // HIGHER_LEVELS set, same candidate resolution, same best-effort refusal observe): refuse
  // (exit 3, no partial dir) when a LIVE L3/L4 run is already resolved, so a self-drain mint
  // can never start alongside another live self-drain, or downgrade a live L4 lights-out run.
  // Runs BEFORE any dir is created.
  const candidate = guardCandidateDir(root, process.env);
  if (candidate) {
    const liveLedger = readLedgerSafe(candidate);
    if (isLiveHigherLevel(liveLedger)) {
      try {
        appendRecordUnderLock(candidate, (seq, _prev, prevHash) => ({
          schema: 2,
          run_id: liveLedger.run_id || path.basename(candidate),
          seq,
          ts: new Date().toISOString(),
          prev: prevHash,
          phase: "run",
          type: "sentry-trip",
          data: {
            guard: "run-ledger-init-self-drain-downgrade-refused",
            live_level: liveLedger.level,
          },
        }));
      } catch { /* observe is best-effort; the refusal below is unconditional */ }
      process.stderr.write(
        `faff run-ledger init-self-drain: refusing — a live ${liveLedger.level} run (${liveLedger.run_id || path.basename(candidate)}) is already resolved; ` +
        `an L3 self-drain mint must not start alongside or downgrade a live higher-level run\n`
      );
      return 3;
    }
  }

  const nowIso = new Date().toISOString();
  const runId = idArg || `run-${utcStamp(nowIso)}-beepboop-${modeArg || "full"}-${crypto.randomBytes(3).toString("hex")}`;
  const runsParent = path.join(root, ".faff", "runs");
  const runDir = path.join(runsParent, runId);

  // Ensure the PARENT exists (idempotent, recursive — a fresh repo has no `.faff/runs/` yet),
  // then exclusive-create the LEAF (non-recursive — throws EEXIST iff the leaf is taken). The
  // run dir's basename IS the run_id (load-bearing for the genesis `prev` = SHA-256(run_id)).
  // A leaf collision REFUSES rather than appends over a stale tail (a re-run with the same
  // --id, or a dir a killed run left behind) — never the silent `{recursive:true}` mkdir
  // init-interactive's OWN mint uses today (out of scope to change there; the spec asks for
  // this guard on the new verb specifically).
  fs.mkdirSync(runsParent, { recursive: true });
  try {
    fs.mkdirSync(runDir);
  } catch (e) {
    if (e && e.code === "EEXIST") {
      process.stderr.write(`faff run-ledger init-self-drain: run dir already exists: ${runDir} — refusing to mint over it (nothing written into it)\n`);
      return 3;
    }
    throw e;
  }

  const ledger = buildSelfDrainLedger({
    runId,
    nowIso,
    sessionId: process.env.FAFF_SESSION_ID || null,
    pid: process.pid,
    baseSha: resolveMintBaseSha(root), // FAFF-1028 — null on an unresolvable branch, never thrown
  });
  // Unlike a non-throwing `written:false` (a null-mutate abort — never returned by the mutate
  // above — or an owner-epoch-fence yield, never armed here), lock-ACQUISITION exhaustion
  // THROWS a tagged LEDGER_LOCKED error (fs-lock.js) rather than returning. Catch it too — a
  // fresh mint under contention is a real, testable fail-closed path this verb must not crash
  // on (never a mint over an absent ledger, and never an unhandled stack trace where the DoD
  // asks for a clean exit 3).
  let mintWriteRes;
  try { mintWriteRes = mutateLedgerUnderLock(runDir, () => ledger); }
  catch (e) {
    process.stderr.write(`faff run-ledger init-self-drain: could not write ${path.join(runDir, "run-ledger.json")}${e && e.code === "LEDGER_LOCKED" ? " (lock contention/abort)" : `: ${e && e.message}`} — no ledger minted\n`);
    return 3;
  }
  if (!mintWriteRes.written) {
    process.stderr.write(`faff run-ledger init-self-drain: could not write ${path.join(runDir, "run-ledger.json")} (lock contention/abort) — no ledger minted\n`);
    return 3;
  }

  // The ledger write above and this genesis emit are TWO locked operations, not one critical
  // section — fail-closed ACROSS the seam: report success (exit 0) only when BOTH landed.
  // A crash/lock-exhaustion here leaves a half-minted dir (ledger written, no genesis) that
  // the read-only anchor guard (`validateAnchorGenesis`) refuses fail-closed — this verb MUST
  // NEVER exit 0 over that state, which is exactly the anchor-missing gap this ticket closes.
  let genesisFailed = false, genesisErr = null;
  try { emitGenesisRunStart(runDir, { level: SELF_DRAIN_LEVEL }); }
  catch (e) { genesisFailed = true; genesisErr = e; }
  if (genesisFailed) {
    process.stderr.write(`faff run-ledger init-self-drain: could not append the genesis run-start event in ${runDir}${genesisErr ? `: ${genesisErr.message}` : ""} (ledger written, no chain) — mint NOT reported successful\n`);
    return 3;
  }

  if (values["--json"]) {
    process.stdout.write(
      JSON.stringify({
        proceed: true,
        level: SELF_DRAIN_LEVEL,
        run_id: runId,
        run_dir: runDir,
        ledger_sha256_before: mintWriteRes.before_sha256, // always null on a mint
        ledger_sha256_after: mintWriteRes.after_sha256,
      }) + "\n"
    );
  } else {
    // Bare-mode stdout is JUST the absolute run dir path — so the caller can
    // `export FAFF_RUN_DIR="$(faff run-ledger init-self-drain --mode full)"`.
    process.stdout.write(runDir + "\n");
  }
  return 0;
}

// `record-outcome` — the honest per-item outcome write (§4 step 6) on the interactive- or
// orchestrator-minted LIVE ledger, run at the graft terminal AFTER Step 9b already committed
// the immutable anchor (so the anchor stays a pre-merge `outcomes:{}` snapshot; this write
// lands only on the live dir). Always sets outcomes[issue] under the lock (which also folds a
// ledger-write event — belt-and-braces chain honesty); owner.status flips to "done" ONLY when
// this write drains the queue (FAFF-1024 — see applyTerminalOutcome) — a multi-issue L4 drain's
// first outcome leaves the owner "running", not terminated early. On the shipped path, appends
// an issue-outcome close event. Fail-closed: an absent/invalid run dir → exit 3; a bad
// --issue/--outcome → 2.
function recordOutcome(values) {
  const issue = values["--issue"];
  const outcome = values["--outcome"];
  if (!issue || (!ISSUE_ID_RE.test(issue) || issue.includes(".."))) {
    process.stderr.write(`faff run-ledger record-outcome: --issue ${JSON.stringify(issue)} is not a valid issue id\n`);
    return 2;
  }
  // --outcome is enum-guarded by parseArgs (a member of EVENT_LEDGER_OUTCOMES); belt here.
  if (!outcome || !EVENT_LEDGER_OUTCOMES.has(outcome)) {
    process.stderr.write(`faff run-ledger record-outcome: --outcome ${JSON.stringify(outcome)} is not a terminal-state string\n`);
    return 2;
  }
  const root = values["--root"] || findRoot();
  // Resolve the LIVE run dir: explicit --run-dir > FAFF_RUN_DIR > newest run dir under root.
  const runDir = values["--run-dir"] || process.env.FAFF_RUN_DIR || latestRunDir(root);
  if (!runDir || !fs.existsSync(path.join(runDir, "run-ledger.json"))) {
    process.stderr.write(`faff run-ledger record-outcome: no run dir with run-ledger.json resolved (${runDir || "none"}) — pass --run-dir or set FAFF_RUN_DIR\n`);
    return 3;
  }
  const nowIso = new Date().toISOString();
  let runId = path.basename(runDir);
  // Captured from inside the lock callback — the actual resulting owner.status after the
  // drain-gated flip (FAFF-1024), never assumed "done". mutateLedgerUnderLock returns only
  // {written, yielded, before_sha256, after_sha256} — not the mutated ledger — so this is the
  // only place the post-mutation status is observable.
  let resultingOwnerStatus = null;
  const res = mutateLedgerUnderLock(runDir, (fresh) => {
    if (!fresh || typeof fresh !== "object") return null; // vanished/malformed → abort (no write)
    if (typeof fresh.run_id === "string") runId = fresh.run_id;
    const next = applyTerminalOutcome(fresh, issue, outcome, nowIso);
    resultingOwnerStatus = next && next.owner && next.owner.status;
    return next;
  });
  if (!res.written) {
    process.stderr.write(`faff run-ledger record-outcome: could not write ${path.join(runDir, "run-ledger.json")} (missing/locked/malformed)\n`);
    return 3;
  }
  // On the shipped path, append the issue-outcome close event (CLI-computed hash). Best-effort:
  // a chain-append fault never unwinds the durable ledger write above (surfaced, not fatal).
  if (outcome === "shipped") {
    try {
      appendEventRecord(runDir, runId, { phase: "build", type: "issue-outcome", issue, data: { outcome } }, nowIso);
    } catch (e) {
      process.stderr.write(`faff run-ledger record-outcome: issue-outcome close event append failed in ${runDir}: ${e && e.message} — the ledger IS written\n`);
    }
  }
  if (values["--json"]) {
    process.stdout.write(JSON.stringify({ recorded: true, run_id: runId, run_dir: runDir, issue, outcome, owner_status: resultingOwnerStatus, ledger_sha256_before: res.before_sha256, ledger_sha256_after: res.after_sha256 }) + "\n");
  } else {
    process.stdout.write(`recorded ${issue}=${outcome} (owner ${resultingOwnerStatus}) in ${runDir}\n`);
  }
  return 0;
}

// In-memory selftest (mirrors lights-out/events): mints into an ephemeral tmp dir and asserts
// the pure ledger shape + the genesis chain verifies. Fail-closed per-case ok/FAIL + RESULT.
function runLedgerSelftest() {
  const os = require("os");
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

  // --- pure shape assertions over buildInteractiveLedger (no fs) ---
  const nowIso = "2026-08-11T00:00:00.000Z";
  const led = buildInteractiveLedger({ runId: "run-20260811-000000-graft-TEST-1", issue: "TEST-1", nowIso, sessionId: null, pid: 4242 });
  ok("ledger level is the constant L2", led.level === "L2");
  ok("ledger admitted is exactly [issue]", Array.isArray(led.admitted) && led.admitted.length === 1 && led.admitted[0] === "TEST-1");
  ok("ledger outcomes is EMPTY at mint", led.outcomes && typeof led.outcomes === "object" && Object.keys(led.outcomes).length === 0);
  ok("ledger owner is running with the mint fields", led.owner && led.owner.status === "running" && led.owner.pid === 4242 && led.owner.started_at === nowIso && led.owner.last_heartbeat === nowIso);
  ok("ledger owner.session_id falls back to run_id when session unset", led.owner.session_id === "run-20260811-000000-graft-TEST-1");
  ok("ledger carries a minimal honest budget.envelope", led.budget && led.budget.envelope && typeof led.budget.envelope.ceilings === "object" && led.budget.envelope.at_ceiling === "stop");
  // --- FAFF-1028: base_sha + the post-feature mint marker ---
  ok("ledger stamps the post-feature mint marker unconditionally", led[MINT_MARKER_KEY] === true);
  ok("ledger base_sha defaults to null when unresolved (never thrown, never omitted)", led.base_sha === null);
  const ledWithBase = buildInteractiveLedger({ runId: "run-20260811-000000-graft-TEST-2", issue: "TEST-2", nowIso, sessionId: null, pid: 1, baseSha: "deadbeef" });
  ok("ledger base_sha carries a resolved sha verbatim", ledWithBase.base_sha === "deadbeef");
  const drainLed = buildSelfDrainLedger({ runId: "run-20260811-000000-beepboop-full-abc123", nowIso, sessionId: null, pid: 1 });
  ok("self-drain ledger also stamps the mint marker", drainLed[MINT_MARKER_KEY] === true);
  ok("self-drain ledger base_sha defaults to null when unresolved", drainLed.base_sha === null);

  // --- guard predicate ---
  ok("guard trips on a live L3 run", isLiveHigherLevel({ level: "L3", owner: { status: "running" } }) === true);
  ok("guard trips on a live L4 run", isLiveHigherLevel({ level: "L4", owner: { status: "running" } }) === true);
  ok("guard does NOT trip on a DONE higher-level run", isLiveHigherLevel({ level: "L4", owner: { status: "done" } }) === false);
  ok("guard does NOT trip on an L2 run", isLiveHigherLevel({ level: "L2", owner: { status: "running" } }) === false);
  ok("guard fail-safe: null/level-absent ledger never trips", isLiveHigherLevel(null) === false && isLiveHigherLevel({ owner: { status: "running" } }) === false);

  // --- terminal-outcome edit (§4 step 6) ---
  const term = applyTerminalOutcome(buildInteractiveLedger({ runId: "r", issue: "TEST-1", nowIso, sessionId: null, pid: 1 }), "TEST-1", "shipped", "2026-08-11T01:00:00.000Z");
  ok("terminal write records outcomes[issue]", term.outcomes["TEST-1"] === "shipped");
  ok("terminal write flips owner.status to done", term.owner.status === "done" && term.owner.last_heartbeat === "2026-08-11T01:00:00.000Z");
  ok("terminal write keeps admitted intact (completeness: admitted ⊆ outcomes.keys)", term.admitted.every((i) => i in term.outcomes));
  const parkedTerm = applyTerminalOutcome({ admitted: ["X"], outcomes: {}, owner: { status: "running" } }, "X", "parked", nowIso);
  ok("terminal write works for a non-shipped terminal (parked)", parkedTerm.outcomes["X"] === "parked" && parkedTerm.owner.status === "done");

  // --- FAFF-1024: drain-gated owner-flip on a multi-issue (L4-style) ledger ---
  const midDrain = applyTerminalOutcome({ admitted: ["A", "B"], outcomes: {}, owner: { status: "running" } }, "A", "shipped", "2026-08-11T02:00:00.000Z");
  ok("multi-issue first outcome: outcomes[A] recorded", midDrain.outcomes["A"] === "shipped");
  ok("multi-issue first outcome: owner stays running (NOT drained — B is still queued)", midDrain.owner.status === "running");
  ok("multi-issue first outcome: last_heartbeat still refreshed (proof of life)", midDrain.owner.last_heartbeat === "2026-08-11T02:00:00.000Z");

  const fullDrain = applyTerminalOutcome({ admitted: ["A", "B"], outcomes: { A: "shipped" }, owner: { status: "running" } }, "B", "shipped", "2026-08-11T03:00:00.000Z");
  ok("multi-issue last outcome: outcomes[B] recorded", fullDrain.outcomes["B"] === "shipped");
  ok("multi-issue last outcome: owner flips to done (queue now drained)", fullDrain.owner.status === "done");

  const preexistingStatus = applyTerminalOutcome({ admitted: ["A", "B"], outcomes: {}, owner: { status: "paused" } }, "A", "shipped", nowIso);
  ok("non-draining write leaves a pre-existing owner.status untouched (never invented)", preexistingStatus.owner.status === "paused");

  const dupedAdmitted = applyTerminalOutcome({ admitted: ["A", "A", "B"], outcomes: {}, owner: { status: "running" } }, "A", "shipped", nowIso);
  ok("duplicate admitted entry does not miscount drain state (still running — B outstanding)", dupedAdmitted.owner.status === "running");
  const dupedAdmittedDrained = applyTerminalOutcome({ admitted: ["A", "A", "B"], outcomes: { A: "shipped" }, owner: { status: "running" } }, "B", "shipped", nowIso);
  ok("duplicate admitted entry: draining the deduped set flips owner to done", dupedAdmittedDrained.owner.status === "done");

  // --- FAFF-1024 (adversarial finding): an admitted id colliding with an inherited
  // Object.prototype key must NOT read as already-dispatched via the `in` operator's
  // prototype-chain walk — own-key check only (Object.hasOwn).
  const protoCollision = applyTerminalOutcome({ admitted: ["A", "constructor"], outcomes: {}, owner: { status: "running" } }, "A", "shipped", nowIso);
  ok("admitted id 'constructor' (Object.prototype key) is NOT treated as already-dispatched — owner stays running", protoCollision.owner.status === "running");
  const protoCollisionDrained = applyTerminalOutcome({ admitted: ["A", "constructor"], outcomes: { A: "shipped" }, owner: { status: "running" } }, "constructor", "shipped", nowIso);
  ok("recording the 'constructor' id itself correctly drains the queue", protoCollisionDrained.owner.status === "done" && Object.hasOwn(protoCollisionDrained.outcomes, "constructor"));

  // --- real mint into a tmp dir → genesis chain verifies (basename==run_id ⇒ prev=SHA256(run_id)) ---
  let tmp = null;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-run-ledger-selftest-"));
    const runId = "run-20260811-000000-graft-TEST-1";
    const runDir = path.join(tmp, ".faff", "runs", runId);
    fs.mkdirSync(runDir, { recursive: true });
    mutateLedgerUnderLock(runDir, () => buildInteractiveLedger({ runId, issue: "TEST-1", nowIso, sessionId: null, pid: process.pid }));
    appendRecordUnderLock(runDir, (seq, _p, prevHash) => ({ schema: 2, run_id: runId, seq, ts: nowIso, prev: prevHash, phase: "run", type: "run-start" }));
    const persisted = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
    ok("persisted ledger round-trips level L2", persisted.level === "L2");
    ok("persisted ledger round-trips the FAFF-1028 mint marker", persisted[MINT_MARKER_KEY] === true);
    const lines = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const genesis = lines[0];
    // The physical seq-0 record is the `ledger-write` the ledger fold emits (FAFF-564) —
    // identical to mintLightsOut. The load-bearing genesis invariant is prev == SHA-256(run_id)
    // (why the chain still verifies after `events anchor` relocates the dir), asserted here.
    const runIdHash = require("crypto").createHash("sha256").update(Buffer.from(runId, "utf8")).digest("hex");
    ok("genesis seq is 0 and schema 2", genesis.seq === 0 && genesis.schema === 2 && genesis.phase === "run");
    ok("genesis prev == SHA-256(run_id) (survives anchor relocation)", genesis.prev === runIdHash);
    ok("a run-start event is present in the genesis chain", lines.some((r) => r.type === "run-start"));
    const verify = verifyChain(runDir);
    ok("genesis chain verifies (faff events verify → verified)", verifyExitCode(verify, "fail") === 0);
  } catch (e) {
    ok(`real mint selftest threw: ${e && e.message}`, false);
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  INTERACTIVE_LEVEL,
  SELF_DRAIN_LEVEL,
  MINT_MARKER_KEY,
  RUN_LEDGER_SURFACE,
  buildInteractiveLedger,
  buildSelfDrainLedger,
  applyTerminalOutcome,
  isLiveHigherLevel,
  guardCandidateDir,
  resolveMintBaseSha,
  cmdRunLedger,
  runLedgerSelftest,
};
