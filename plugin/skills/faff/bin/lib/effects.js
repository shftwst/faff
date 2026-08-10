// ===========================================================================
// === region:governance — effects — FAFF-106: escaped-side-effect detection via a declared-effects ledger. ===
//
// The PRODUCER of the escaped-side-effect signal Sentry (FAFF-49) already consumes.
// A step DECLARES the effects it intends BEFORE acting; chokepoints OBSERVE effects as
// faff performs/witnesses them; `check` computes observed-MINUS-declared per (issue,
// step) and emits an EscapeSignal for anything uncovered. Detection ONLY — it never
// aborts/kills the run (that is Sentry's / FAFF-37's job: producer ≠ consumer).
//
// A PARALLEL ledger (.faff/runs/<id>/declared-effects.jsonl), NOT an events.jsonl schema
// bump — the schema-1 event log stays FROZEN for its shipped readers (FAFF-289, Sentry).
// The orchestrator bridges `any_escape` into Sentry via `sentry check`'s
// `--forbidden-side-effect` CLI flag (FAFF-352, the signals.forbidden_side_effect seam's
// CLI surface) — no events-schema change; the flag is the only Sentry-side reach.
//
// Observation surface = Option A, faff-mediated only (human Decision 2026-06-29):
// effects faff observes at its own chokepoints; out-of-band effects are the container's
// job (ADR-0010). PURE: no tracker/network, writes only under the run dir. Pure cores +
// a thin I/O wrapper + --selftest, mirroring events / budget.
// ===========================================================================


const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { requireFlags } = require("./argv");
const { appendRecordsUnderLock, sha256Hex, verifyEffectsChain, verifyExitCode } = require("./events");
const { findRoot, resolveRunDir } = require("./shared-infra");

// FAFF-628 — declared grammar for `faff cli-surface --json`. `effects` reads its own fixed
// flag set manually (never forwards to a sub-process), so no CommandSpec import is needed for
// parsing — `spec` below is a minimal declaration purely for the flag-membership half of the
// drift-guard + the cli-surface accepted-flag list.
const EFFECTS_SPEC = { flags: {
  "--json": { arity: 0 }, "--selftest": { arity: 0 },
  "--root": { arity: 1 }, "--run": { arity: 1 }, "--issue": { arity: 1 }, "--step": { arity: 1 }, "--ts": { arity: 1 },
  // FAFF-621: `effects verify` surfaces the declared-effects.jsonl chain verifier (sibling of
  // `events verify`). --run-dir verifies a direct dir (a run or anchor dir); --legacy-policy
  // maps the schema-1 legacy/mixed disposition to the exit code, same vocabulary as events.
  "--run-dir": { arity: 1 }, "--legacy-policy": { arity: 1 },
} };
const EFFECTS_SURFACE = {
  kind: "subcommand_dispatch",
  spec: EFFECTS_SPEC,
  subcommands: {
    declare: { required_flags: ["--run", "--issue", "--step"] },
    observe: { required_flags: ["--run", "--issue", "--step"] },
    check: { required_flags: ["--run"] },
    verify: { required_flags: [] }, // one of --run / --run-dir (checked in the handler)
  },
};

const EFFECT_KINDS = new Set([
  "merge", "branch-delete", "deploy", "db-migration", "secret-rotation",
  "email", "webhook", "registry-publish", "force-push", "prod-script",
  "label-write", "tracker-write", "file-write", "other",
]);

// Pure validator for one EffectDescriptor — returns violation strings (empty == valid).
// Unknown kind / missing-or-empty target / non-boolean reversible are the invalid cases.
function effectDescriptorViolations(d) {
  if (d === null || typeof d !== "object" || Array.isArray(d)) return ["effect must be a JSON object"];
  const v = [];
  if (!EFFECT_KINDS.has(d.kind)) v.push(`kind ${JSON.stringify(d.kind)} not in EffectKind`);
  if (typeof d.target !== "string" || d.target === "") v.push("missing or empty target");
  if (d.reversible !== undefined && typeof d.reversible !== "boolean") v.push("reversible must be a boolean");
  return v;
}

// Canonicalise a validated descriptor to {kind,target,reversible}. reversible defaults
// true (most effects are revert-undoable; the consumer escalates harder on explicit false).
function normEffect(d) {
  return { kind: d.kind, target: d.target, reversible: d.reversible === undefined ? true : d.reversible };
}

// target_matches — exact string OR a declared "*" wildcard (the step declared this kind
// broadly). No fuzzy/semantic matching in v1 (deterministic-tools principle).
function effectTargetMatches(declaredTarget, observedTarget) {
  return declaredTarget === "*" || declaredTarget === observedTarget;
}

// Pure escape core: observed-MINUS-declared per (issue, step). `entries` is the parsed
// ledger; optional issueFilter narrows scope. Returns { escapes: [EscapeSignal], any_escape }.
function computeEscapes(entries, issueFilter) {
  const groups = new Map(); // (issue\0step) -> { issue, step, declared:[], observed:[] }
  for (const e of entries) {
    if (issueFilter != null && e.issue !== issueFilter) continue;
    const k = `${e.issue}\x00${e.step}`;
    if (!groups.has(k)) groups.set(k, { issue: e.issue, step: e.step, declared: [], observed: [] });
    const g = groups.get(k);
    if (e.kind_of_entry === "declare") g.declared.push(e.effect);
    else if (e.kind_of_entry === "observe") g.observed.push(e.effect);
  }
  const escapes = [];
  for (const g of groups.values()) {
    const escaped = g.observed.filter((O) =>
      !g.declared.some((d) => d.kind === O.kind && effectTargetMatches(d.target, O.target)));
    if (escaped.length) escapes.push({ signal: "escaped-side-effect", issue: g.issue, step: g.step, escaped, event_seq: null });
  }
  return { escapes, any_escape: escapes.length > 0 };
}

// === FAFF-329: review-progress checkpoint =================================
// A per-issue on-disk record of how far the graft review step got, written before the slow adversarial
// Phase-2 call so a re-dispatched build subagent RESUMES rather than repeats. Lives beside graft.md at
// `<run-dir>/<issue>/review-progress.json`. PURE JSON read/write — no tracker, no network (the CLI
// determinism invariant); it is a HINT the graft flow consults, never authoritative over git/PR truth
// (the diff-identity guard keeps it honest — Phase-1 is skipped only when phase1.diff_hash still matches).
const REVIEW_PHASE2_STATUSES = new Set(["pending", "in_flight", "complete", "skipped_deadline", "skipped_unreachable"]);

function reviewProgressPath(runDir, issue) {
  return path.join(runDir, issue, "review-progress.json");
}

// Pure: fold a Phase-1 pass (+ the diff hash it was computed against) into the record. Phase-1 fail /
// needs-human are already terminal (graft returns with no Phase-2), so the checkpoint is only ever written
// on a `pass`. Seeds phase2 to `pending` when absent so a resume knows Phase-2 has not started.
function reviewProgressApplyPhase1(existing, issue, diffHash, nowIso) {
  const base = (existing && typeof existing === "object") ? existing : {};
  const hash = String(diffHash);
  // A new Phase-1 pass VOIDS any prior Phase-2 when the diff moved: a fix-up commit re-runs Phase-1 on a
  // DIFFERENT diff, but a prior phase2=complete carries findings computed against the OLD diff. Carrying it
  // forward would let the resume "skip both phases" and disposition stale findings for a diff they were
  // never computed on. So reset phase2 to `pending` whenever the diff_hash changes; an identical-diff
  // re-write (idempotent) preserves the in-flight phase2.
  const priorHash = base.phase1 && base.phase1.diff_hash;
  const phase2 = (base.phase2 && typeof base.phase2 === "object" && priorHash === hash)
    ? base.phase2 : { status: "pending", attempts: 0, findings_ref: null };
  return { issue, phase1: { status: "done", verdict: "pass", diff_hash: hash }, phase2, updated_at: nowIso };
}

// Pure: fold a Phase-2 status transition into the record (preserving phase1). `findings` sets findings_ref
// (a `complete` status), `attempts` records backends consumed. An unknown status is rejected by the caller.
function reviewProgressApplyPhase2(existing, status, findings, attempts, nowIso) {
  const base = (existing && typeof existing === "object") ? existing : {};
  const phase2 = (base.phase2 && typeof base.phase2 === "object") ? { ...base.phase2 } : { status: "pending", attempts: 0, findings_ref: null };
  phase2.status = status;
  if (findings != null) phase2.findings_ref = String(findings);
  if (attempts != null) phase2.attempts = Number(attempts);
  return { issue: base.issue, phase1: base.phase1 || null, phase2, updated_at: nowIso };
}

// FAFF-403: pure fold for the outage-retry counter. Increments the top-level `outage_retries` field
// (absent → 1), preserving phase1/phase2 verbatim — the retry-later disposition arm calls this on a
// mandatory-review `unavailable` verdict instead of writing a terminal review-verdict.json, so the
// counter is the loop-bound state that survives across drains (carried via the .faff/resume/<ISSUE>/
// stash — see faff-graft Step 3/9 resume prose). The caller (cmdReviewProgress) requires an existing
// record before calling this — the arm only ever fires when the checkpoint chain already exists.
function reviewProgressApplyOutageRetry(existing, issue, nowIso) {
  const base = (existing && typeof existing === "object") ? existing : {};
  const outageRetries = (Number.isInteger(base.outage_retries) ? base.outage_retries : 0) + 1;
  return { issue: base.issue || issue, phase1: base.phase1 || null, phase2: base.phase2 || null, outage_retries: outageRetries, updated_at: nowIso };
}

function cmdReviewProgress(args) {
  if (args.includes("--selftest")) return reviewProgressSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const positional = args.filter((a) => !a.startsWith("-"));
  const sub = positional[0];
  const runDir = positional[1];
  const issue = positional[2];
  if ((sub !== "read" && sub !== "write") || !runDir || !issue) {
    process.stderr.write("usage: faff review-progress <read|write> <run-dir> <issue> [--phase1-pass --diff-hash H | --phase2 STATUS [--findings PATH] [--attempts N] | --outage-retry]\n");
    return 2;
  }
  const file = reviewProgressPath(runDir, issue);
  const readExisting = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

  if (sub === "read") {
    const rec = readExisting();
    if (!rec) return 3;   // no checkpoint yet — NOT an error ("nothing recorded"), just absent
    console.log(JSON.stringify(rec));
    return 0;
  }

  // write
  const nowIso = new Date().toISOString();
  // FAFF-403: --outage-retry is a standalone increment form — reject it combined with either write mode
  // explicitly (rather than silently letting the first-matching branch below win and dropping the
  // increment unflagged). A caller passing both gets a loud usage error, not a quietly-ignored flag.
  if (args.includes("--outage-retry") && (args.includes("--phase1-pass") || args.includes("--phase2"))) {
    process.stderr.write("faff review-progress write --outage-retry is not combinable with --phase1-pass or --phase2\n"); return 2;
  }
  let rec;
  if (args.includes("--phase1-pass")) {
    const diffHash = get("--diff-hash");
    if (!diffHash) { process.stderr.write("faff review-progress write --phase1-pass requires --diff-hash <h>\n"); return 2; }
    rec = reviewProgressApplyPhase1(readExisting(), issue, diffHash, nowIso);
  } else if (args.includes("--phase2")) {
    const status = get("--phase2");
    if (!REVIEW_PHASE2_STATUSES.has(status)) {
      process.stderr.write(`faff review-progress: invalid phase2 status "${status}" — one of: ${[...REVIEW_PHASE2_STATUSES].join(" | ")}\n`); return 2;
    }
    const existing = readExisting();
    // A Phase-2 transition only ever follows a recorded Phase-1 pass (the checkpoint is written on pass and
    // never earlier) — reject a phase2 write with no prior phase1, so no `phase1: null` checkpoint (an
    // unenumerated resume state) can ever be created.
    if (!existing || !existing.phase1 || existing.phase1.verdict !== "pass") {
      process.stderr.write("faff review-progress write --phase2 requires a prior --phase1-pass checkpoint (no Phase-1 verdict recorded)\n"); return 2;
    }
    // A `complete` status MUST carry a findings artifact — a `complete` with no findings_ref is a silent
    // coverage lie (the resume would skip Phase-2 and disposition nothing). --findings is required here.
    const findings = get("--findings");
    if (status === "complete" && !findings) {
      process.stderr.write("faff review-progress write --phase2 complete requires --findings <path>\n"); return 2;
    }
    rec = reviewProgressApplyPhase2(existing, status, findings, get("--attempts"), nowIso);
    rec.issue = rec.issue || issue;
  } else if (args.includes("--outage-retry")) {
    // FAFF-403: standalone increment form (combinable with nothing else) — requires an existing
    // record already, since the retry-later arm only fires when the checkpoint chain exists (a
    // build-progress + review-progress pair was already written earlier in this same review pass).
    const existing = readExisting();
    if (!existing) {
      process.stderr.write("faff review-progress write --outage-retry requires an existing checkpoint record (none found)\n"); return 2;
    }
    rec = reviewProgressApplyOutageRetry(existing, issue, nowIso);
  } else {
    process.stderr.write("faff review-progress write: expected --phase1-pass or --phase2 <status> or --outage-retry\n"); return 2;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n");
  fs.renameSync(tmp, file);
  console.log(JSON.stringify(rec));
  return 0;
}

function reviewProgressSelftest() {
  let fail = 0;
  const ok = (n, c) => { if (!c) { console.log(`FAIL ${n}`); fail++; } else console.log(`ok   ${n}`); };
  const NOW = "2026-07-05T00:00:00.000Z";
  // phase1 pass seeds phase2 pending + records the diff hash
  const p1 = reviewProgressApplyPhase1(null, "FAFF-329", "abc123", NOW);
  ok("phase1 records done/pass + diff_hash", p1.phase1.status === "done" && p1.phase1.verdict === "pass" && p1.phase1.diff_hash === "abc123");
  ok("phase1 seeds phase2 pending", p1.phase2.status === "pending");
  ok("phase1 stamps updated_at", p1.updated_at === NOW);
  // phase2 in_flight preserves phase1 + its diff hash
  const p2 = reviewProgressApplyPhase2(p1, "in_flight", null, null, NOW);
  ok("phase2 transition preserves phase1", p2.phase1.verdict === "pass" && p2.phase1.diff_hash === "abc123");
  ok("phase2 status set to in_flight", p2.phase2.status === "in_flight");
  // phase2 complete sets findings_ref + attempts
  const p3 = reviewProgressApplyPhase2(p2, "complete", ".faff/x/findings.md", 2, NOW);
  ok("phase2 complete sets findings_ref", p3.phase2.findings_ref === ".faff/x/findings.md");
  ok("phase2 complete records attempts", p3.phase2.attempts === 2);
  // FAFF-329 F4: a Phase-1 re-pass on a DIFFERENT diff voids the prior (stale) phase2 → reset to pending
  const p4 = reviewProgressApplyPhase1(p3, "FAFF-329", "def456", NOW);
  ok("phase1 re-pass on a new diff resets stale phase2 to pending", p4.phase2.status === "pending" && p4.phase2.findings_ref === null);
  ok("phase1 re-pass records the new diff_hash", p4.phase1.diff_hash === "def456");
  // an IDENTICAL-diff re-write is idempotent — the in-flight phase2 is preserved
  const p5 = reviewProgressApplyPhase1(p3, "FAFF-329", "abc123", NOW);
  ok("phase1 re-write on the SAME diff preserves phase2 (idempotent)", p5.phase2.status === "complete" && p5.phase2.findings_ref === ".faff/x/findings.md");
  // deadline / unreachable skip statuses are valid
  ok("skipped_deadline is a valid status", REVIEW_PHASE2_STATUSES.has("skipped_deadline"));
  ok("skipped_unreachable is a valid status", REVIEW_PHASE2_STATUSES.has("skipped_unreachable"));
  ok("an unknown status is rejected by the vocab", !REVIEW_PHASE2_STATUSES.has("bogus"));
  // path shape
  ok("checkpoint path is <run-dir>/<issue>/review-progress.json", reviewProgressPath("/r/run-1", "FAFF-329") === path.join("/r/run-1", "FAFF-329", "review-progress.json"));
  // FAFF-403: outage-retry counter — absent → 1, preserves phase1/phase2, increments across calls
  const o1 = reviewProgressApplyOutageRetry(p2, "FAFF-329", NOW);
  ok("outage-retry absent starts at 1", o1.outage_retries === 1);
  ok("outage-retry preserves phase1", o1.phase1.verdict === "pass" && o1.phase1.diff_hash === "abc123");
  ok("outage-retry preserves phase2", o1.phase2.status === "in_flight");
  const o2 = reviewProgressApplyOutageRetry(o1, "FAFF-329", NOW);
  ok("outage-retry increments on a second call (cross-drain carry-forward)", o2.outage_retries === 2);
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (review-progress checkpoint, ${fail} failed)`);
  return fail ? 1 : 0;
}

// === FAFF-402: build-progress checkpoint =================================
// A per-issue on-disk record that the build (gates + AC) is COMPLETE for a specific pushed diff, written at
// build-complete (graft Step 8b) AFTER the branch is pushed to origin, so a re-dispatched graft RESUMES at
// review — recreating the worktree from origin/<branch> and skipping the build — rather than rebuilding.
// Lives beside review-progress.json at `<run-dir>/<issue>/build-progress.json`. PURE JSON read/write — no
// tracker, no network, no git (the CLI determinism invariant); the diff_hash (which needs a git fetch/diff)
// is computed in graft prose and passed in. It is a HINT the graft flow consults, never authoritative over
// git truth (the diff-identity guard keeps it honest — the build is skipped only when the recorded diff_hash
// still matches the remote three-dot diff of the pushed branch).

function buildProgressPath(runDir, issue) {
  return path.join(runDir, issue, "build-progress.json");
}

// Pure: fold a build-complete record (the remote-three-dot diff hash it was gated at + the pushed branch).
// The checkpoint is only ever written AFTER a successful push (Step 8b: push → hash → write), so its
// existence attests a durable branch on origin. A re-write with a new diff_hash simply replaces the record
// (a moved branch is a fresh build-complete for a new diff).
function buildProgressApplyComplete(existing, issue, diffHash, branch, nowIso) {
  return { issue, build: { status: "complete", diff_hash: String(diffHash), branch: String(branch), pushed_at: nowIso }, updated_at: nowIso };
}

function cmdBuildProgress(args) {
  if (args.includes("--selftest")) return buildProgressSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const positional = args.filter((a) => !a.startsWith("-"));
  const sub = positional[0];
  const runDir = positional[1];
  const issue = positional[2];
  if ((sub !== "read" && sub !== "write") || !runDir || !issue) {
    process.stderr.write("usage: faff build-progress <read|write> <run-dir> <issue> [--build-complete --diff-hash H --branch B]\n");
    return 2;
  }
  const file = buildProgressPath(runDir, issue);
  const readExisting = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

  if (sub === "read") {
    const rec = readExisting();
    if (!rec) return 3;   // no checkpoint yet — NOT an error ("nothing recorded"), just absent (mirrors review-progress)
    console.log(JSON.stringify(rec));
    return 0;
  }

  // write
  if (!args.includes("--build-complete")) {
    process.stderr.write("faff build-progress write: expected --build-complete\n"); return 2;
  }
  const diffHash = get("--diff-hash");
  const branch = get("--branch");
  // Both are required. The diff_hash is the diff-identity guard a resume re-checks against the pushed branch;
  // the branch is what a pruned-worktree resume checks out (`git worktree add <path> <branch>`) with no
  // tracker round-trip. A build-complete with either missing is a coverage lie — reject it.
  if (!diffHash) { process.stderr.write("faff build-progress write --build-complete requires --diff-hash <h>\n"); return 2; }
  if (!branch) { process.stderr.write("faff build-progress write --build-complete requires --branch <b>\n"); return 2; }
  const nowIso = new Date().toISOString();
  const rec = buildProgressApplyComplete(readExisting(), issue, diffHash, branch, nowIso);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n");
  fs.renameSync(tmp, file);
  console.log(JSON.stringify(rec));
  return 0;
}

function buildProgressSelftest() {
  let fail = 0;
  const ok = (n, c) => { if (!c) { console.log(`FAIL ${n}`); fail++; } else console.log(`ok   ${n}`); };
  const NOW = "2026-07-07T00:00:00.000Z";
  const b = buildProgressApplyComplete(null, "FAFF-402", "abc123", "faff-402-x", NOW);
  ok("build-complete records status/diff_hash/branch", b.build.status === "complete" && b.build.diff_hash === "abc123" && b.build.branch === "faff-402-x");
  ok("build-complete stamps pushed_at + updated_at", b.build.pushed_at === NOW && b.updated_at === NOW);
  ok("build-complete records the issue", b.issue === "FAFF-402");
  // a re-write with a new diff hash replaces the record (a moved branch = a fresh build-complete)
  const b2 = buildProgressApplyComplete(b, "FAFF-402", "def456", "faff-402-x", NOW);
  ok("a re-write records the new diff_hash", b2.build.diff_hash === "def456");
  // string coercion (the CLI passes strings, but guard non-strings so the store never holds a non-string hash)
  const b3 = buildProgressApplyComplete(null, "FAFF-402", 123, 456, NOW);
  ok("diff_hash + branch are coerced to strings", b3.build.diff_hash === "123" && b3.build.branch === "456");
  // path shape — sibling of review-progress.json
  ok("checkpoint path is <run-dir>/<issue>/build-progress.json", buildProgressPath("/r/run-1", "FAFF-402") === path.join("/r/run-1", "FAFF-402", "build-progress.json"));
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (build-progress checkpoint, ${fail} failed)`);
  return fail ? 1 : 0;
}

// FAFF-383/621: the single ledger-append core — cmdEffects (the `declare`/`observe` CLI) and
// merge-gate's mechanical observe both call this so the record shape, seq derivation, and
// all-or-nothing validation live in exactly one place. `runDirAbsPath` is the run dir itself
// (e.g. `<root>/.faff/runs/<run-id>`, or merge-gate's `--run-dir`, which is the same directory
// by convention) — run_id is derived from its basename, never passed separately, so a caller
// cannot desync the two. Validates every descriptor BEFORE writing any (all-or-nothing, same
// as today's cmdEffects); on failure writes nothing and returns the violations instead (each
// entry carries its original descriptor index, so a caller can reproduce cmdEffects's per-index
// stderr lines verbatim).
//
// FAFF-621: the N effect descriptors of ONE declare/observe now land as N schema-2 CHAINED
// records under ONE lock acquisition (appendRecordsUnderLock) — one tail read, contiguous
// seqs, each `prev` = SHA-256 of the previous physical line (genesis: SHA-256 of the run_id),
// minted inside the lock that assigns the seq. One batch = one lock = one atomic, gap-free run,
// so only tampering (never honest concurrent traffic) can break the chain. The batch core is
// the SAME primitive `events append` drives at N=1 — no forked hashing rule.
function appendEffectEntries(runDirAbsPath, kindOfEntry, issue, step, effects, ts) {
  const violations = [];
  for (let i = 0; i < effects.length; i++) {
    const viol = effectDescriptorViolations(effects[i]);
    if (viol.length) violations.push({ index: i, violations: viol });
  }
  if (violations.length) return { violations };
  if (effects.length === 0) return { written: [] }; // nothing to declare — touch nothing

  const runId = path.basename(runDirAbsPath);
  const written = appendRecordsUnderLock(
    runDirAbsPath,
    { ledgerFile: "declared-effects.jsonl", lock: { code: "EFFECTS_LOCKED", label: "effects lock" } },
    effects.length,
    (index, seq, _prevRecord, prevHash) => ({
      schema: 2, run_id: runId, seq, ts: ts || new Date().toISOString(),
      kind_of_entry: kindOfEntry, issue, step, effect: normEffect(effects[index]), prev: prevHash,
    }),
  );
  return { written };
}

function cmdEffects(args) {
  let root = null, run = null, issue = null, step = null, ts = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--run") run = args[++i];
    else if (args[i] === "--issue") issue = args[++i];
    else if (args[i] === "--step") step = args[++i];
    else if (args[i] === "--ts") ts = args[++i];
    else rest.push(args[i]);
  }
  if (rest.includes("--selftest")) return effectsSelftest();
  // FAFF-591: an explicit --root is a strict escape hatch (no worktree fallback);
  // the default-from-findRoot() path may still resolve to the main checkout below.
  const rootExplicit = root !== null;
  root = root || findRoot();
  const cmd = rest[0];
  const asJson = rest.includes("--json");

  if (cmd === "declare" || cmd === "observe") {
    const reqErr = requireFlags({ "--run": run, "--issue": issue, "--step": step }, EFFECTS_SURFACE.subcommands[cmd], "effects", cmd);
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    // FAFF-591: from a linked build worktree, the run dir lives in the MAIN checkout's
    // .faff/runs/, not this cwd's — resolveRunDir falls back there (root-explicit only
    // ever uses the cwd-root path, unchanged).
    const dir = resolveRunDir(root, run, rootExplicit);
    // A missing path OR a non-directory there is "no valid run dir" → exit 3 (parity with
    // `events append`), never an uncaught ENOTDIR when appendFileSync hits a file.
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      process.stderr.write(`faff effects ${cmd}: run dir missing (${path.join(".faff", "runs", run)}) — initialise the run first\n`);
      return 3;
    }
    let raw;
    try { raw = fs.readFileSync(0, "utf8"); }
    catch { process.stderr.write(`faff effects ${cmd}: cannot read payload from stdin\n`); return 2; }
    let payload;
    try { payload = JSON.parse(raw); }
    catch { process.stderr.write(`faff effects ${cmd}: malformed payload (invalid JSON)\n`); return 2; }
    const descriptors = Array.isArray(payload) ? payload : [payload];
    if (descriptors.length === 0) { process.stderr.write(`faff effects ${cmd}: no effect descriptors in payload\n`); return 1; }
    // "issue" — the unit key (compat dialect; rename deferred to extraction schema-v2). run_id
    // is `run` verbatim here (dir's basename === run by construction — dir was just resolved
    // via resolveRunDir above, cwd-root or main-checkout, either way basename === run), so
    // appendEffectEntries's basename-derived run_id is byte-identical to what this CLI wrote
    // before the extraction.
    const result = appendEffectEntries(dir, cmd, issue, step, descriptors, ts);
    if (result.violations) {
      // Validate ALL before writing ANY (all-or-nothing; a bad descriptor writes nothing) —
      // reproduce the original per-descriptor stderr lines verbatim from the violation indices.
      for (const v of result.violations) for (const x of v.violations) process.stderr.write(`- descriptor[${v.index}]: ${x}\n`);
      return 1;
    }
    console.log(JSON.stringify(result.written.length === 1 ? result.written[0] : result.written));
    return 0;
  }

  if (cmd === "check") {
    const reqErr = requireFlags({ "--run": run }, EFFECTS_SURFACE.subcommands.check, "effects", "check");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    // Absence of the ledger is a CLEAN state (no declared-effects activity), NOT exit 3 —
    // parity with `events read` tolerance, and the spec's explicit edge case. FAFF-591: resolve
    // the run dir the same worktree-aware way as declare/observe, so `check` from a build
    // worktree reads the main checkout's ledger instead of false-reporting clean against an
    // empty worktree root.
    const ledgerPath = path.join(resolveRunDir(root, run, rootExplicit), "declared-effects.jsonl");
    let entries = [];
    if (fs.existsSync(ledgerPath)) {
      entries = fs.readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim() !== "")
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }
    const result = computeEscapes(entries, issue);
    if (asJson) { console.log(JSON.stringify(result)); return 0; }
    if (!result.any_escape) console.log("effects: no escape — every observed effect is covered by a declaration");
    else {
      console.log(`effects: ${result.escapes.length} escaped-side-effect signal(s) — any_escape: true`);
      for (const s of result.escapes) console.log(`  - ${s.issue}/${s.step}: ${s.escaped.map((e) => `${e.kind} ${e.target}`).join(", ")}`);
    }
    return 0;
  }

  // FAFF-621: `verify` — re-hash the declared-effects.jsonl chain (sibling of `events verify`,
  // composing the shared walkPhysicalChain). --run resolves the run dir the same worktree-aware
  // way as declare/observe/check; --run-dir verifies a direct dir (a run or anchor dir). Absent
  // ledger → verified (nothing to verify), exit 0.
  if (cmd === "verify") {
    let runDirArg = null, legacyPolicy = "pass";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--run-dir") runDirArg = args[i + 1];
      else if (args[i] === "--legacy-policy") legacyPolicy = args[i + 1];
    }
    if (!["pass", "warn", "fail"].includes(legacyPolicy)) {
      process.stderr.write(`faff effects verify: --legacy-policy must be pass|warn|fail (got ${JSON.stringify(legacyPolicy)})\n`); return 2;
    }
    const dir = runDirArg !== null ? runDirArg : (run !== null ? resolveRunDir(root, run, rootExplicit) : null);
    if (dir === null) {
      process.stderr.write("faff effects verify: one of --run <id> or --run-dir <dir> is required\n"); return 2;
    }
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      process.stderr.write(`faff effects verify: not a directory: ${dir}\n`); return 2;
    }
    const result = verifyEffectsChain(dir, { legacyPolicy });
    if (asJson) console.log(JSON.stringify(result));
    else console.log(`effects verify: ${result.status} — ${result.detail}${result.first_break ? ` [first break: line ${result.first_break.line}]` : ""}`);
    if (result.status === "legacy-unverifiable" && legacyPolicy === "warn") {
      process.stderr.write("faff effects verify: legacy schema-1 log (no chain) — reported under --legacy-policy warn\n");
    }
    if (result.status === "mixed" && legacyPolicy === "warn") {
      process.stderr.write("faff effects verify: mixed chain (prev-less lines content-unverifiable) — reported under --legacy-policy warn\n");
    }
    return verifyExitCode(result, legacyPolicy);
  }

  process.stderr.write("faff effects: expected one of declare | observe | check | verify (or --selftest)\n");
  return 2;
}

// In-memory self-test of the pure cores (mirrors the events/budget selftest style).
function effectsSelftest() {
  let failed = 0;
  const fail = (m) => { process.stderr.write(`effects --selftest FAIL: ${m}\n`); failed++; };

  // --- descriptor validation ---
  const vcases = [
    [{ kind: "merge", target: "main", reversible: true }, 0, "valid merge descriptor"],
    [{ kind: "merge", target: "main" }, 0, "reversible optional"],
    [{ kind: "no-such-kind", target: "main" }, 1, "unknown kind"],
    [{ kind: "merge" }, 1, "missing target"],
    [{ kind: "merge", target: "" }, 1, "empty target"],
    [{ kind: "merge", target: "main", reversible: "yes" }, 1, "non-boolean reversible"],
    [["not an object"], 1, "array is not a descriptor"],
    [null, 1, "null is not a descriptor"],
  ];
  for (const [d, want, label] of vcases) {
    const got = effectDescriptorViolations(d).length > 0 ? 1 : 0;
    if (got !== want) fail(`${label} (want ${want}, got ${got})`);
  }

  // --- target_matches ---
  if (!effectTargetMatches("main", "main")) fail("exact target match");
  if (!effectTargetMatches("*", "anything")) fail("wildcard target match");
  if (effectTargetMatches("main", "production")) fail("non-match target reads as escape");

  // --- computeEscapes ---
  const decl = (issue, step, effect) => ({ kind_of_entry: "declare", issue, step, effect });
  const obs = (issue, step, effect) => ({ kind_of_entry: "observe", issue, step, effect });

  let r = computeEscapes([
    decl("FAFF-200", "build", { kind: "merge", target: "main" }),
    obs("FAFF-200", "build", { kind: "merge", target: "main" }),
  ]);
  if (r.any_escape !== false || r.escapes.length !== 0) fail("covered observation => no escape");

  r = computeEscapes([
    decl("FAFF-200", "build", { kind: "merge", target: "main" }),
    obs("FAFF-200", "build", { kind: "registry-publish", target: "pkg@1.2.0" }),
  ]);
  if (r.any_escape !== true || r.escapes.length !== 1 || r.escapes[0].signal !== "escaped-side-effect"
      || r.escapes[0].escaped[0].kind !== "registry-publish") fail("uncovered observation => escaped-side-effect");

  r = computeEscapes([obs("FAFF-1", "ship", { kind: "deploy", target: "prod" })]);
  if (r.any_escape !== true) fail("no declarations + observed => escape");

  r = computeEscapes([decl("FAFF-1", "ship", { kind: "deploy", target: "prod" })]);
  if (r.any_escape !== false) fail("declarations + no observations => no escape");

  r = computeEscapes([]);
  if (r.any_escape !== false || r.escapes.length !== 0) fail("empty ledger => clean");

  r = computeEscapes([
    decl("FAFF-2", "build", { kind: "file-write", target: "*" }),
    obs("FAFF-2", "build", { kind: "file-write", target: "/tmp/x" }),
  ]);
  if (r.any_escape !== false) fail("wildcard declaration covers observation");

  r = computeEscapes([
    decl("FAFF-3", "build", { kind: "merge", target: "main" }),
    obs("FAFF-3", "ship", { kind: "merge", target: "main" }),
  ]);
  if (r.any_escape !== true) fail("declaration in a different step does not cover");

  r = computeEscapes([
    obs("FAFF-A", "build", { kind: "deploy", target: "prod" }),
    obs("FAFF-B", "build", { kind: "deploy", target: "prod" }),
  ], "FAFF-A");
  if (r.escapes.length !== 1 || r.escapes[0].issue !== "FAFF-A") fail("issue filter narrows scope");

  // --- appendEffectEntries (FAFF-383/621): the shared ledger-append core cmdEffects and
  // merge-gate's mechanical observe both call — now schema-2 CHAINED (per-line prev). ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-effects-append-"));
    try {
      const r1 = appendEffectEntries(tmp, "declare", "FAFF-500", "merge", [{ kind: "merge", target: "pr:7" }], "t");
      if (!r1.written || r1.written.length !== 1) fail("appendEffectEntries: writes one record for one effect");
      if (r1.written[0].run_id !== path.basename(tmp)) fail("appendEffectEntries: run_id derives from the run dir's basename");
      if (r1.written[0].seq !== 0) fail("appendEffectEntries: first entry seq is 0");
      if (r1.written[0].kind_of_entry !== "declare") fail("appendEffectEntries: kind_of_entry is the caller's kindOfEntry arg");
      // FAFF-621: records are schema-2 and record 0's prev is the genesis sha256(run_id).
      if (r1.written[0].schema !== 2) fail("appendEffectEntries: records are schema 2");
      if (r1.written[0].prev !== sha256Hex(Buffer.from(path.basename(tmp), "utf8"))) fail("appendEffectEntries: genesis prev is sha256(run_id)");

      const r2 = appendEffectEntries(tmp, "observe", "FAFF-500", "merge", [{ kind: "merge", target: "pr:7" }], "t");
      if (!r2.written || r2.written[0].seq !== 1) fail("appendEffectEntries: seq is gap-free across calls (line-count-derived)");
      // FAFF-621: the 2nd record's prev is sha256 of the FIRST physical line's raw bytes.
      const line0 = fs.readFileSync(path.join(tmp, "declared-effects.jsonl"), "utf8").split("\n")[0];
      if (r2.written[0].prev !== sha256Hex(Buffer.from(line0, "utf8"))) fail("appendEffectEntries: each later prev is sha256 of the previous physical line");

      // FAFF-621: a multi-descriptor batch mints N contiguous chained records under one lock.
      const r3 = appendEffectEntries(tmp, "declare", "FAFF-500", "merge", [{ kind: "merge", target: "a" }, { kind: "deploy", target: "b" }, { kind: "email", target: "c" }], "t");
      if (!r3.written || r3.written.length !== 3) fail("appendEffectEntries: a 3-descriptor batch mints 3 records");
      if (r3.written[0].seq !== 2 || r3.written[1].seq !== 3 || r3.written[2].seq !== 4) fail("appendEffectEntries: batch seqs are contiguous s..s+N-1");
      const allLines = fs.readFileSync(path.join(tmp, "declared-effects.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "");
      if (r3.written[1].prev !== sha256Hex(Buffer.from(allLines[2], "utf8"))) fail("appendEffectEntries: within-batch prev hashes the previous physical line");
      if (r3.written[2].prev !== sha256Hex(Buffer.from(allLines[3], "utf8"))) fail("appendEffectEntries: within-batch prev chains across the batch");
      // and the resulting ledger verifies clean.
      if (verifyEffectsChain(tmp, {}).status !== "verified") fail("appendEffectEntries: the resulting chained ledger verifies");

      const bad = appendEffectEntries(tmp, "declare", "FAFF-500", "merge", [{ kind: "merge", target: "pr:8" }, { kind: "bogus", target: "x" }]);
      if (!bad.violations || bad.violations.length !== 1 || bad.violations[0].index !== 1) fail("appendEffectEntries: violations name the offending descriptor's index");
      const linesAfterBad = fs.readFileSync(path.join(tmp, "declared-effects.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "");
      if (linesAfterBad.length !== 5) fail("appendEffectEntries: a bad descriptor in the batch writes NOTHING (all-or-nothing)");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  if (failed) return 1;
  console.log("effects --selftest: ok");
  return 0;
}


module.exports = { EFFECT_KINDS, EFFECTS_SPEC, EFFECTS_SURFACE, REVIEW_PHASE2_STATUSES, appendEffectEntries, buildProgressApplyComplete, buildProgressPath, buildProgressSelftest, cmdBuildProgress, cmdEffects, cmdReviewProgress, computeEscapes, effectDescriptorViolations, effectTargetMatches, effectsSelftest, normEffect, reviewProgressApplyOutageRetry, reviewProgressApplyPhase1, reviewProgressApplyPhase2, reviewProgressPath, reviewProgressSelftest };
