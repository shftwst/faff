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
const { resolveFaffVersion } = require("./faff-version"); // FAFF-1395
const { HEX64_RE, RUNNER_IDENTITY_CREDENTIAL_SOURCES, appendRecordsUnderLock, sha256Hex, verifyEffectsChain, verifyExitCode } = require("./events");
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
  // FAFF-1028: `effects reconcile-merges --describe` prints the honesty-condition text (what
  // the off-ledger detector catches and does not) — see effects-reconcile.js DESCRIBE_TEXT.
  "--describe": { arity: 0 },
} };
const EFFECTS_SURFACE = {
  kind: "subcommand_dispatch",
  spec: EFFECTS_SPEC,
  subcommands: {
    // FAFF-864: --run dropped from required_flags — declare/observe/check now take
    // exactly one of --run / --run-dir, enforced in the handler (mirrors verify). Leaving
    // --run here would make a --run-dir-only call fail requireFlags before the handler runs.
    declare: { required_flags: ["--issue", "--step"] },
    observe: { required_flags: ["--issue", "--step"] },
    check: { required_flags: [] },
    verify: { required_flags: [] }, // one of --run / --run-dir (checked in the handler)
    // FAFF-1028: the off-ledger landed-merge DETECTION verb — one of --run / --run-dir
    // (checked in the handler, same shape as check/verify); --issue optionally narrows both
    // attribution and the ledger read. Implemented in the sibling effects-reconcile.js module
    // so the pure computeEscapes core above stays untouched (spec §3 "CLI surface").
    "reconcile-merges": { required_flags: [] },
  },
};

const EFFECT_KINDS = new Set([
  "merge", "branch-delete", "deploy", "db-migration", "secret-rotation",
  "email", "webhook", "registry-publish", "force-push", "prod-script",
  "label-write", "tracker-write", "file-write", "pr-create", "push", "other",
]);

// FAFF-1225: the protected-effect kinds — an observed effect of one of these needs a signed
// Commissaire grant to conclude cleanly. One home both the chokepoints and `verdict conclude`
// can consult, so the two enforcement points never drift. Exactly the kinds the runner governs
// today; every other EFFECT_KIND (tracker-write, label-write, push, …) is unaffected.
const PROTECTED_EFFECT_KINDS = new Set(["merge", "branch-delete", "pr-create"]);
function isProtectedKind(kind) { return PROTECTED_EFFECT_KINDS.has(kind); }

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

// === FAFF-1167: the work-unit compatibility read ==========================
// A ledger record names its work unit under `unit_id` (schema:3 records minted after
// FAFF-1167) or `issue` (frozen schema:3 records and every schema:2 row). The key name is
// inside each record's signed image, so frozen records are never rewritten; readers resolve
// the unit here instead. A record carrying BOTH keys is rejected (it resolves to no unit),
// and the unit is a string — never coerced — compared strictly.

function hasUnitKey(rec, key) {
  return Object.prototype.hasOwnProperty.call(rec, key) && rec[key] !== undefined;
}

function carriesBothUnitKeys(rec) {
  return !!rec && typeof rec === "object" && hasUnitKey(rec, "issue") && hasUnitKey(rec, "unit_id");
}

// The record's work unit, or null when it is not a plain object, carries both keys, or its
// unit is not a non-empty string.
function unitIdOf(rec) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;
  if (carriesBothUnitKeys(rec)) return null;
  const unit = hasUnitKey(rec, "unit_id") ? rec.unit_id : rec.issue;
  return typeof unit === "string" && unit !== "" ? unit : null;
}

// === FAFF-1262: the whole-record validator ================================
// effectDescriptorViolations checks the {kind,target,reversible} descriptor; this checks the
// full declared-effects.jsonl record around it. Shape only: a present commissaire_sig or
// producer_hmac is not a verified one (the governance-check schema-3 auth leg verifies).

const COMMON_ENVELOPE_KEYS = ["schema", "run_id", "seq", "ts", "step", "effect"];
const LEGACY_ENVELOPE_KEYS = new Set([...COMMON_ENVELOPE_KEYS, "kind_of_entry", "issue"]);
const CHAINED_LEGACY_ENVELOPE_KEYS = new Set([...LEGACY_ENVELOPE_KEYS, "prev", "origin", "github_actor"]);
const COMMISSAIRE_ENVELOPE_KEYS = new Set([
  ...COMMON_ENVELOPE_KEYS, "author", "producer_id", "contract_revision", "kind_of_entry", "unit_id",
  "issue", "prev", "payload", "commissaire_sig", "producer_hmac",
]);

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v !== "";

function unexpectedFieldViolations(rec, allowedKeys) {
  return Object.keys(rec).filter((k) => !allowedKeys.has(k)).map((k) => `unexpected field ${JSON.stringify(k)}`);
}

function nonEmptyStringViolations(rec, fields) {
  return fields.filter((f) => !isNonEmptyString(rec[f])).map((f) => `${f} must be a non-empty string`);
}

function effectFieldViolations(rec) {
  return effectDescriptorViolations(rec.effect).map((m) => `effect: ${m}`);
}

function githubActorViolations(actor) {
  const wellFormed = isPlainObject(actor)
    && Object.keys(actor).length === 2
    && (typeof actor.login === "string" || actor.login === null)
    && RUNNER_IDENTITY_CREDENTIAL_SOURCES.has(actor.source);
  return wellFormed ? [] : ["github_actor must be exactly {login, source} with login a string or null and source in {runner-credential, ambient}"];
}

function prevViolations(rec) {
  return typeof rec.prev === "string" && HEX64_RE.test(rec.prev) ? [] : ["prev must be 64 lowercase hex characters"];
}

function legacyRecordViolations(rec) {
  const v = unexpectedFieldViolations(rec, rec.schema === 1 ? LEGACY_ENVELOPE_KEYS : CHAINED_LEGACY_ENVELOPE_KEYS);
  if (rec.kind_of_entry !== "declare" && rec.kind_of_entry !== "observe") v.push("kind_of_entry must be declare or observe");
  v.push(...nonEmptyStringViolations(rec, ["issue"]), ...effectFieldViolations(rec));
  if (rec.schema === 2) {
    v.push(...prevViolations(rec));
    if (hasUnitKey(rec, "origin") && !isNonEmptyString(rec.origin)) v.push("origin must be a non-empty string");
    if (hasUnitKey(rec, "github_actor")) v.push(...githubActorViolations(rec.github_actor));
  }
  return v;
}

function commissaireRecordViolations(rec) {
  const v = unexpectedFieldViolations(rec, COMMISSAIRE_ENVELOPE_KEYS);
  if (rec.author !== "commissaire" && rec.author !== "producer") v.push("author must be commissaire or producer");
  v.push(...nonEmptyStringViolations(rec, ["producer_id", "contract_revision", "kind_of_entry"]), ...prevViolations(rec));
  if (unitIdOf(rec) === null) v.push("exactly one of unit_id or issue must be a non-empty string");
  if (rec.author === "commissaire" && !(isNonEmptyString(rec.commissaire_sig) && !hasUnitKey(rec, "producer_hmac"))) {
    v.push("author commissaire requires commissaire_sig and no producer_hmac");
  }
  if (rec.author === "producer" && !(isNonEmptyString(rec.producer_hmac) && !hasUnitKey(rec, "commissaire_sig"))) {
    v.push("author producer requires producer_hmac and no commissaire_sig");
  }
  if (hasUnitKey(rec, "effect")) v.push(...effectFieldViolations(rec));
  if (hasUnitKey(rec, "payload") && !isPlainObject(rec.payload)) v.push("payload must be a JSON object");
  return v;
}

// Pure validator for one whole declared-effects.jsonl record — returns violation strings
// (empty == valid). Messages name fields and keys, never values.
function declaredEffectViolations(rec) {
  if (!isPlainObject(rec)) return ["record must be a JSON object"];
  if (![1, 2, 3].includes(rec.schema)) return ["schema must be 1, 2 or 3"];
  const v = nonEmptyStringViolations(rec, ["run_id"]);
  if (!Number.isInteger(rec.seq) || rec.seq < 0) v.push("seq must be a non-negative integer");
  v.push(...nonEmptyStringViolations(rec, ["ts", "step"]));
  v.push(...(rec.schema === 3 ? commissaireRecordViolations(rec) : legacyRecordViolations(rec)));
  return v;
}

// The only unit comparison readers use: false for a missing or non-string comparand, so two
// unresolvable sides can never match each other.
function matchesUnit(rec, unit) {
  return typeof unit === "string" && unit !== "" && unitIdOf(rec) === unit;
}

// === FAFF-1221: the conclusion-kind compatibility read ====================
// Commissaire's conclude record names its kind under CONCLUSION_KIND from FAFF-1221 on;
// every record written before carries LEGACY_CONCLUSION_KIND. The kind is inside each
// record's signed image, so frozen records are never rewritten; readers ask here.

const CONCLUSION_KIND = "conformed_to_contract";
const LEGACY_CONCLUSION_KIND = "accepted_under_contract";

// The record's conclusion kind (current or legacy, exactly as stored), or null for any
// other kind, a non-string kind, no kind, or a record that is not a plain object.
function conclusionKindOf(rec) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return null;
  return rec.kind_of_entry === CONCLUSION_KIND || rec.kind_of_entry === LEGACY_CONCLUSION_KIND ? rec.kind_of_entry : null;
}

// Pure escape core: observed-MINUS-declared per (unit, step). `entries` is the parsed
// ledger; optional unitFilter narrows scope. Returns { escapes: [EscapeSignal], any_escape }.
// A record carrying both unit keys never joins a group: it is reported as its own
// `rejected-unit-key` escape whatever the filter, so it can neither cover nor hide anything.
function computeEscapes(entries, unitFilter) {
  const groups = new Map(); // (unit\0step) -> { issue, step, declared:[], observed:[] }
  const rejected = [];
  for (const e of entries) {
    if (carriesBothUnitKeys(e)) {
      rejected.push({ signal: "rejected-unit-key", issue: null, step: e.step, seq: e.seq, escaped: e.effect ? [e.effect] : [], event_seq: null });
      continue;
    }
    const unit = unitIdOf(e);
    if (unitFilter != null && !matchesUnit(e, unitFilter)) continue;
    const k = `${unit === null ? "\x01" : `s${unit}`}\x00${e.step}`; // the null unit never shares a key with the string "null"
    if (!groups.has(k)) groups.set(k, { issue: unit, step: e.step, declared: [], observed: [] });
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
  escapes.push(...rejected);
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

// === FAFF-1258: the shared run-state writer ===============================
// build-progress.json and landing-progress.json are stamped `schema_version: 1` (+ `faff_version`), redacted once and
// validated against their closed v0.3 schemas before any bytes land. Only violations THIS write
// introduces refuse it; a legacy fault in carried-forward bytes is reported, never blamed on the
// current writer. A file stamped with a version this CLI does not know is never rewritten.
// evidence.js requires this module at load (declaredEffectViolations), so it is required lazily here.
function writeRunState(cmd, anchorPath, file, existing, rec, diffBase, opts = {}) {
  const evidence = require("./evidence");
  const { resolveKnownSecretValues, redactKnownSecrets } = require("./redact");
  const { atomicWriteSingleValueFile } = require("./heartbeat");
  const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const prior = isRecord(existing) ? existing : null;
  // FAFF-1395: every write restamps faff_version with the current writer's release (last writer
  // wins), second key after schema_version. The carried-forward base is stamped the same way so the
  // restamp never reads as a changed path of its own.
  const stamp = (r) => {
    const { schema_version: _ignored, faff_version: _prior, ...rest } = r;
    return redactKnownSecrets({ schema_version: 1, faff_version: resolveFaffVersion().version, ...rest }, resolveKnownSecretValues());
  };

  if (prior && "schema_version" in prior && prior.schema_version !== 1) {
    process.stderr.write(`faff ${cmd}: ${anchorPath} schema_version is not 1\n`);
    return 1;
  }
  const doc = stamp(rec);
  const result = evidence.validateEvidenceDocument(anchorPath, doc);
  if (result.unavailable) {
    process.stderr.write(`faff ${cmd}: ${anchorPath} schema unavailable (cannot load ${result.unavailable})\n`);
    return 1;
  }
  const base = diffBase === undefined ? prior : diffBase;
  const introduced = evidence.introducedViolations(anchorPath, base ? stamp(base) : null, doc, result.violations, base, rec);
  if (introduced.length > 0) {
    process.stderr.write(`faff ${cmd}: ${anchorPath} failed schema: ${introduced.slice(0, 5).join("; ")}\n`);
    return 1;
  }
  const remaining = result.violations.map((v) => v.message);
  for (const m of introduced) { const i = remaining.indexOf(m); if (i >= 0) remaining.splice(i, 1); }
  if (remaining.length > 0) {
    process.stderr.write(`faff ${cmd}: ${anchorPath} has ${remaining.length} pre-existing schema violation(s), first: ${remaining[0]}\n`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteSingleValueFile(file, JSON.stringify(doc, null, 2) + "\n");
  if (!opts.quiet) console.log(JSON.stringify(doc));
  return 0;
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
  const existing = readExisting();
  const rec = buildProgressApplyComplete(existing, issue, diffHash, branch, nowIso);
  // build-progress replaces the whole record, so every path is this write's own: any violation refuses
  return writeRunState("build-progress write", "build-progress.json", file, existing, rec, null);
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

// === FAFF-846: landing-progress checkpoint =================================
// A per-issue on-disk record of how many conflict/regression fix cycles the (future)
// landing loop has spent, written so the count survives a firing boundary — a beep-boop
// run ending and a later run resuming the same issue. Lives beside review-progress.json /
// build-progress.json at `<run-dir>/<issue>/landing-progress.json`. PURE JSON read/write —
// no tracker, no network, no git (the CLI determinism invariant); the fold is total, the
// `<= 3` cap is enforced by the CLI wrapper (never the fold) so a caller bug that tries a
// 4th record fails loud instead of being silently clamped to 3. No loop integration in
// this ticket — only the record, the pure fold, the CLI verb, and the selftest.
const LANDING_FIX_KINDS = new Set(["conflict", "regression"]);

function landingProgressPath(runDir, issue) {
  return path.join(runDir, issue, "landing-progress.json");
}

// Pure: fold one fix cycle into the record. Total over its inputs (null / {} / a valid record
// all fold cleanly). fix_cycles is DERIVED from history.length (never a separately-incremented
// integer), so the fix_cycles == length(history) invariant holds by construction and cannot
// drift. Appends exactly one history entry with cycle == history.length (1-based ordinal).
function landingProgressApplyFixCycle(existing, issue, kind, failingChecks, tried, headSha, nowIso) {
  const base = (existing && typeof existing === "object") ? existing : {};
  const history = Array.isArray(base.history) ? base.history.slice() : [];
  const cycle = history.length + 1;
  const entry = { cycle, kind, failing_checks: failingChecks ?? [], tried: tried ?? [], at: nowIso };
  history.push(entry);
  return {
    issue: base.issue ?? issue,
    fix_cycles: history.length,
    last_head_sha: headSha ?? base.last_head_sha ?? null,
    history,
    updated_at: nowIso,
  };
}

function cmdLandingProgress(args) {
  if (args.includes("--selftest")) return landingProgressSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const positional = args.filter((a) => !a.startsWith("-"));
  const sub = positional[0];
  const runDir = positional[1];
  const issue = positional[2];
  if ((sub !== "read" && sub !== "record-fix-cycle" && sub !== "clear") || !runDir || !issue) {
    process.stderr.write("usage: faff landing-progress <read|record-fix-cycle|clear> <run-dir> <issue> [--kind conflict|regression --head-sha SHA [--failing-checks a,b] [--tried x,y]]\n");
    return 2;
  }
  const file = landingProgressPath(runDir, issue);
  // a malformed on-disk file reads as null (schema-tolerant, mirroring review-progress/build-progress)
  const readExisting = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

  if (sub === "read") {
    const rec = readExisting();
    if (!rec) return 3;   // no checkpoint yet — NOT an error ("no cycles yet")
    console.log(JSON.stringify(rec));
    return 0;
  }

  if (sub === "clear") {
    // idempotent — absent file is a no-op success
    if (fs.existsSync(file)) fs.rmSync(file);
    return 0;
  }

  // record-fix-cycle
  const kind = get("--kind");
  if (!LANDING_FIX_KINDS.has(kind)) {
    process.stderr.write(`faff landing-progress: invalid --kind ${JSON.stringify(kind)} — one of: ${[...LANDING_FIX_KINDS].join(" | ")}\n`);
    return 2;
  }
  const headSha = get("--head-sha");
  if (!headSha) {
    process.stderr.write("faff landing-progress record-fix-cycle requires --head-sha <sha>\n");
    return 2;
  }
  const existing = readExisting();
  // the caller (the future landing loop) is responsible for hard-parking at 3; this record
  // must not paper over a caller bug by clamping a 4th write to 3 — loud exit 2, no write.
  if (existing && existing.fix_cycles >= 3) {
    process.stderr.write("landing-progress: fix_cycles already at 3 — caller must hard-park, never record a 4th\n");
    return 2;
  }
  const splitCsv = (v) => (v ? v.split(",").map((s) => s.trim()).filter((s) => s !== "") : []);
  const failingChecks = splitCsv(get("--failing-checks"));
  const tried = splitCsv(get("--tried"));
  const nowIso = new Date().toISOString();
  const rec = landingProgressApplyFixCycle(existing, issue, kind, failingChecks, tried, headSha, nowIso);
  return writeRunState("landing-progress record-fix-cycle", "landing-progress.json", file, existing, rec);
}

function landingProgressSelftest() {
  let fail = 0;
  const ok = (n, c) => { if (!c) { console.log(`FAIL ${n}`); fail++; } else console.log(`ok   ${n}`); };
  const NOW = "2026-08-17T00:00:00.000Z";
  const NOW2 = "2026-08-17T00:05:00.000Z";

  const c1 = landingProgressApplyFixCycle(null, "FAFF-846", "conflict", ["ci/x"], ["rebase"], "aaa", NOW);
  ok("first cycle: fix_cycles=1, one history entry", c1.fix_cycles === 1 && c1.history.length === 1);
  ok("first cycle: issue stamped from the arg (no prior record)", c1.issue === "FAFF-846");
  ok("first cycle: history entry has cycle=1 + kind + failing_checks + tried + at",
    c1.history[0].cycle === 1 && c1.history[0].kind === "conflict" &&
    c1.history[0].failing_checks[0] === "ci/x" && c1.history[0].tried[0] === "rebase" && c1.history[0].at === NOW);
  ok("first cycle: last_head_sha stamped", c1.last_head_sha === "aaa");
  ok("first cycle: updated_at stamped", c1.updated_at === NOW);

  const c2 = landingProgressApplyFixCycle(c1, "FAFF-846", "regression", [], [], "bbb", NOW2);
  ok("second cycle: fix_cycles=2, two history entries", c2.fix_cycles === 2 && c2.history.length === 2);
  ok("second cycle: cycle ordinal is 2 (== its index+1 in history)", c2.history[1].cycle === 2);
  ok("second cycle: last_head_sha updates to the most recent", c2.last_head_sha === "bbb");
  ok("second cycle: first entry preserved verbatim", c2.history[0].kind === "conflict" && c2.history[0].at === NOW);
  ok("invariant: fix_cycles == length(history) holds by construction", c2.fix_cycles === c2.history.length);

  // total over an empty-object existing, not just null
  const c3 = landingProgressApplyFixCycle({}, "FAFF-846", "conflict", null, null, "ccc", NOW);
  ok("an empty-object existing is treated as no history (total over {})", c3.fix_cycles === 1 && c3.history.length === 1);
  ok("null failingChecks/tried default to []",
    Array.isArray(c3.history[0].failing_checks) && c3.history[0].failing_checks.length === 0 &&
    Array.isArray(c3.history[0].tried) && c3.history[0].tried.length === 0);

  // an omitted headSha falls back to the prior last_head_sha (never drops it)
  const c4 = landingProgressApplyFixCycle(c2, "FAFF-846", "conflict", [], [], undefined, NOW2);
  ok("an omitted headSha falls back to the prior last_head_sha", c4.last_head_sha === "bbb");

  ok("checkpoint path is <run-dir>/<issue>/landing-progress.json",
    landingProgressPath("/r/run-1", "FAFF-846") === path.join("/r/run-1", "FAFF-846", "landing-progress.json"));
  ok("LANDING_FIX_KINDS is exactly {conflict, regression}",
    LANDING_FIX_KINDS.has("conflict") && LANDING_FIX_KINDS.has("regression") && LANDING_FIX_KINDS.size === 2);
  ok("an unknown kind is rejected by the vocab", !LANDING_FIX_KINDS.has("bogus"));

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (landing-progress checkpoint, ${fail} failed)`);
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
// FAFF-1012: `recordFields` is an optional trailing bag of NON-reserved record-level fields
// (e.g. `{ origin: "merge-gate-auto" }`) spread into each minted record BEFORE the reserved
// envelope keys, so the reserved keys (schema, run_id, seq, ts, kind_of_entry, issue, step,
// effect, prev) always win and a caller can only ADD fields, never override the chain shape.
// Absent (default {}) → the spread is a no-op → records are byte-identical to before, so the
// hash chain and every existing caller are unchanged.
function appendEffectEntries(runDirAbsPath, kindOfEntry, issue, step, effects, ts, recordFields) {
  const violations = [];
  for (let i = 0; i < effects.length; i++) {
    const viol = effectDescriptorViolations(effects[i]);
    if (viol.length) violations.push({ index: i, violations: viol });
  }
  if (violations.length) return { violations };
  if (effects.length === 0) return { written: [] }; // nothing to declare — touch nothing

  const runId = path.basename(runDirAbsPath);
  let recordViolation = null;
  // FAFF-1260: the v0.3 payload check, resolved before the lock and run on each minted record.
  const evidence = require("./evidence"); // lazy — evidence.js requires this module at load
  const schemaCheck = evidence.logRecordChecker("declared-effects.jsonl");
  let schemaUnavailable = null;
  const written = appendRecordsUnderLock(
    runDirAbsPath,
    { ledgerFile: "declared-effects.jsonl", lock: { code: "EFFECTS_LOCKED", label: "effects lock" } },
    effects.length,
    (index, seq, _prevRecord, prevHash) => {
      const record = {
        ...(recordFields || {}),
        schema: 2, run_id: runId, seq, ts: ts || new Date().toISOString(),
        kind_of_entry: kindOfEntry, issue, step, effect: normEffect(effects[index]), prev: prevHash,
      };
      const recordViolations = declaredEffectViolations(record);
      if (recordViolations.length) {
        recordViolation = { index, violations: recordViolations, scope: "record" };
        return null; // null aborts the whole batch; nothing is written
      }
      // Checked with the descriptor as the caller gave it, so a key normEffect would drop is refused, not lost.
      const asGiven = { ...record, effect: { ...effects[index], reversible: record.effect.reversible } };
      const schema = schemaCheck ? schemaCheck(asGiven) : { ok: true };
      if (schema.unavailable) schemaUnavailable = schema.unavailable;
      else if (!schema.ok) {
        recordViolation = { index, violations: schema.violations, scope: "schema" };
        return null;
      }
      return record;
    },
  );
  if (schemaUnavailable) evidence.noteSchemaUnavailable(runDirAbsPath, "effects", schemaUnavailable);
  if (written === null) return { violations: [recordViolation] };
  return { written };
}

function cmdEffects(args) {
  let root = null, run = null, runDir = null, issue = null, step = null, ts = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--run") run = args[++i];
    else if (args[i] === "--run-dir") runDir = args[++i];
    else if (args[i] === "--issue") issue = args[++i];
    else if (args[i] === "--step") step = args[++i];
    else if (args[i] === "--ts") ts = args[++i];
    else rest.push(args[i]);
  }
  const cmd = rest[0];
  // FAFF-1028: reconcile-merges owns its own --selftest (the reconcile pure cores + a
  // real-git integration pass, in effects-reconcile.js) — every OTHER subcommand keeps the
  // pre-existing behaviour of routing any --selftest to the generic effectsSelftest() below,
  // regardless of subcommand.
  if (rest.includes("--selftest") && cmd !== "reconcile-merges") return effectsSelftest();
  // FAFF-591: an explicit --root is a strict escape hatch (no worktree fallback);
  // the default-from-findRoot() path may still resolve to the main checkout below.
  const rootExplicit = root !== null;
  root = root || findRoot();
  const asJson = rest.includes("--json");

  // FAFF-1028: dispatched to the sibling effects-reconcile.js module (lazy require — it is
  // the one that requires ./effects back for effectTargetMatches/mergeRecordPath/gitRun, so
  // this require must stay lazy here to avoid a load-time cycle) so the pure computeEscapes
  // core above is never touched by the new detection verb.
  if (cmd === "reconcile-merges") {
    const { cmdEffectsReconcileMerges } = require("./effects-reconcile");
    return cmdEffectsReconcileMerges(args);
  }

  // FAFF-864: declare/observe/check resolve their ledger dir from EITHER --run (via
  // resolveRunDir → .faff/runs/<run>) OR --run-dir <dir> (verbatim — e.g. a committed
  // .faff/anchors/<run> the landing comment's merge-gate also reads, so declare and
  // observe share one ledger). Exactly one is required: both, or neither, is a caller
  // error (exit 2). This is a stricter XOR than verify's precedence, deliberately — a
  // write path that records a merge for the audit trail must never silently pick one of
  // two conflicting directories the caller named. Returns { err } or { dir }.
  const resolveLedgerDir = (subcmd) => {
    if (runDir !== null && run !== null) {
      process.stderr.write(`faff effects ${subcmd}: one of --run or --run-dir, not both\n`);
      return { err: 2 };
    }
    if (runDir === null && run === null) {
      process.stderr.write(`faff effects ${subcmd}: one of --run <id> or --run-dir <dir> is required\n`);
      return { err: 2 };
    }
    // FAFF-591: from a linked build worktree, the --run dir lives in the MAIN checkout's
    // .faff/runs/, not this cwd's — resolveRunDir falls back there. A --run-dir is used
    // verbatim (no fallback — the caller named the exact directory).
    return { dir: runDir !== null ? runDir : resolveRunDir(root, run, rootExplicit) };
  };

  if (cmd === "declare" || cmd === "observe") {
    const reqErr = requireFlags({ "--issue": issue, "--step": step }, EFFECTS_SURFACE.subcommands[cmd], "effects", cmd);
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    const resolved = resolveLedgerDir(cmd);
    if (resolved.err) return resolved.err;
    const dir = resolved.dir;
    // A missing path OR a non-directory there is "no valid run dir" → exit 3 (parity with
    // `events append`), never an uncaught ENOTDIR when appendFileSync hits a file. No
    // create-if-missing: a mistyped --run-dir (or an anchor that never got committed) must
    // fail loud here, never silently mint an orphan ledger nobody reads.
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      process.stderr.write(`faff effects ${cmd}: run dir missing (${dir}) — initialise the run first\n`);
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
    // "issue" — the unit key (compat dialect; rename deferred to extraction schema-v2).
    // appendEffectEntries derives run_id from path.basename(dir); since .faff/anchors/<run>
    // and .faff/runs/<run> share the basename <run>, a --run-dir-resolved ledger carries the
    // same run_id + chain genesis as a --run-resolved one (FAFF-864 — indistinguishable in shape).
    const result = appendEffectEntries(dir, cmd, issue, step, descriptors, ts);
    if (result.violations) {
      // Validate ALL before writing ANY (all-or-nothing; a bad descriptor writes nothing) —
      // reproduce the original per-descriptor stderr lines verbatim from the violation indices.
      for (const v of result.violations) for (const x of v.violations) process.stderr.write(`- ${v.scope || "descriptor"}[${v.index}]: ${x}\n`);
      return 1;
    }
    console.log(JSON.stringify(result.written.length === 1 ? result.written[0] : result.written));
    return 0;
  }

  if (cmd === "check") {
    // FAFF-864: check takes --run XOR --run-dir like declare/observe, so a human on a fresh
    // checkout can self-verify coverage against the committed anchor
    // (`faff effects check --run-dir .faff/anchors/<run> --issue <ISSUE>`) rather than a
    // false "clean" from an absent .faff/runs/<run> ledger.
    const resolved = resolveLedgerDir("check");
    if (resolved.err) return resolved.err;
    // Absence of the ledger is a CLEAN state (no declared-effects activity), NOT exit 3 —
    // parity with `events read` tolerance, and the spec's explicit edge case. FAFF-591: resolve
    // the run dir the same worktree-aware way as declare/observe, so `check` from a build
    // worktree reads the main checkout's ledger instead of false-reporting clean against an
    // empty worktree root.
    const ledgerPath = path.join(resolved.dir, "declared-effects.jsonl");
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
    // FAFF-1118: pr-create is a FIRST-CLASS kind (never coerced to `other`) — a well-formed
    // {kind:"pr-create", target, reversible} descriptor validates; an unknown kind still rejects.
    [{ kind: "pr-create", target: "main", reversible: true }, 0, "valid pr-create descriptor (first-class, not other-coerced)"],
    // FAFF-1119: push is a FIRST-CLASS kind (never coerced to `other`) — a well-formed
    // {kind:"push", target, reversible} descriptor validates; note force-push already existed.
    [{ kind: "push", target: "feature-x", reversible: true }, 0, "valid push descriptor (first-class, not other-coerced)"],
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

  // --- FAFF-1167: the work-unit compatibility read ---
  if (unitIdOf({ unit_id: "U1" }) !== "U1" || unitIdOf({ issue: "U1" }) !== "U1") fail("unitIdOf: resolves either single key");
  if (unitIdOf({ issue: "U1", unit_id: "U1" }) !== null || unitIdOf({ issue: "A", unit_id: "B" }) !== null) fail("unitIdOf: a dual-key record resolves to null");
  if (unitIdOf({}) !== null || unitIdOf({ unit_id: 5 }) !== null || unitIdOf({ issue: true }) !== null || unitIdOf({ unit_id: "" }) !== null) fail("unitIdOf: no unit, a non-string or an empty unit resolves to null");
  if (matchesUnit({}, undefined) || matchesUnit({ unit_id: 5 }, "5") || matchesUnit({ issue: "A", unit_id: "B" }, "A")) fail("matchesUnit: never matches an unresolved side");
  r = computeEscapes([
    { kind_of_entry: "declare", unit_id: "FAFF-9", step: "build", effect: { kind: "merge", target: "main" } },
    obs("FAFF-9", "build", { kind: "merge", target: "main" }),
  ], "FAFF-9");
  if (r.any_escape !== false) fail("a unit_id declare covers an issue-keyed observe for the same unit");
  r = computeEscapes([
    { kind_of_entry: "declare", issue: "A", unit_id: "B", step: "build", seq: 1, effect: { kind: "merge", target: "main" } },
    { kind_of_entry: "observe", issue: "A", unit_id: "B", step: "build", seq: 2, effect: { kind: "merge", target: "main" } },
  ], "OTHER");
  if (r.escapes.length !== 2 || r.escapes.some((x) => x.signal !== "rejected-unit-key" || x.issue !== null)) fail("each dual-key record is its own rejected-unit-key escape, whatever the filter");

  // --- FAFF-1221: the conclusion-kind compatibility read ---
  if (conclusionKindOf({ kind_of_entry: CONCLUSION_KIND }) !== CONCLUSION_KIND) fail("conclusionKindOf: the current kind resolves to itself");
  if (conclusionKindOf({ kind_of_entry: LEGACY_CONCLUSION_KIND }) !== LEGACY_CONCLUSION_KIND) fail("conclusionKindOf: the legacy kind resolves to itself");
  if (conclusionKindOf({ kind_of_entry: "declare" }) !== null || conclusionKindOf({ kind_of_entry: "" }) !== null || conclusionKindOf({ kind_of_entry: 5 }) !== null) fail("conclusionKindOf: any other kind resolves to null");
  if (conclusionKindOf({}) !== null || conclusionKindOf(null) !== null || conclusionKindOf([]) !== null) fail("conclusionKindOf: no kind, null or an array resolves to null");

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

  // --- declaredEffectViolations (FAFF-1262): one failing record per rule, exact messages ---
  {
    const effect = { kind: "merge", target: "pr:1", reversible: true };
    const schema1 = { schema: 1, run_id: "r", seq: 0, ts: "t", kind_of_entry: "declare", issue: "I", step: "s", effect };
    const schema2 = { ...schema1, schema: 2, prev: "a".repeat(64) };
    const commissaire3 = {
      schema: 3, run_id: "r", seq: 0, ts: "t", author: "commissaire", producer_id: "P", contract_revision: "c1",
      kind_of_entry: "verdict", unit_id: "U1", step: "s", prev: "a".repeat(64), payload: {}, commissaire_sig: "sig",
    };
    const producer3 = {
      ...commissaire3, author: "producer", issue: "U1", effect, commissaire_sig: undefined, unit_id: undefined, payload: undefined, producer_hmac: "h",
    };
    const variant = (base, patch) => {
      const rec = { ...base, ...patch };
      for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
      return rec;
    };
    const actorMessage = "github_actor must be exactly {login, source} with login a string or null and source in {runner-credential, ambient}";
    const unitMessage = "exactly one of unit_id or issue must be a non-empty string";
    const failing = [
      ["non-object", [1, 2], ["record must be a JSON object"]],
      ["null", null, ["record must be a JSON object"]],
      ["schema 4", { ...schema2, schema: 4, bogus: 1 }, ["schema must be 1, 2 or 3"]],
      ["empty run_id", variant(schema2, { run_id: "" }), ["run_id must be a non-empty string"]],
      ["empty ts", variant(schema2, { ts: "" }), ["ts must be a non-empty string"]],
      ["empty step", variant(schema2, { step: "" }), ["step must be a non-empty string"]],
      ["seq -1", variant(schema2, { seq: -1 }), ["seq must be a non-negative integer"]],
      ["seq 1.5", variant(schema2, { seq: 1.5 }), ["seq must be a non-negative integer"]],
      ["schema-1 unknown key", variant(schema1, { extra: 1 }), ['unexpected field "extra"']],
      ["schema-2 unknown key", variant(schema2, { extra: 1 }), ['unexpected field "extra"']],
      ["schema-1 prev", variant(schema1, { prev: "a".repeat(64) }), ['unexpected field "prev"']],
      ["schema-2 missing prev", variant(schema2, { prev: undefined }), ["prev must be 64 lowercase hex characters"]],
      ["schema-2 malformed prev", variant(schema2, { prev: "ABC" }), ["prev must be 64 lowercase hex characters"]],
      ["empty origin", variant(schema2, { origin: "" }), ["origin must be a non-empty string"]],
      ["github_actor extra key", variant(schema2, { github_actor: { login: null, source: "ambient", extra: 1 } }), [actorMessage]],
      ["github_actor numeric login", variant(schema2, { github_actor: { login: 7, source: "ambient" } }), [actorMessage]],
      ["github_actor source token", variant(schema2, { github_actor: { login: null, source: "token" } }), [actorMessage]],
      ["kind_of_entry x", variant(schema2, { kind_of_entry: "x" }), ["kind_of_entry must be declare or observe"]],
      ["empty issue", variant(schema2, { issue: "" }), ["issue must be a non-empty string"]],
      ["bad descriptor", variant(schema2, { effect: { kind: "merge", target: "" } }), ["effect: missing or empty target"]],
      ["schema-1 absent effect", variant(schema1, { effect: undefined }), ["effect: effect must be a JSON object"]],
      ["schema-2 absent effect", variant(schema2, { effect: undefined }), ["effect: effect must be a JSON object"]],
      ["schema-3 unknown key", variant(commissaire3, { extra: 1 }), ['unexpected field "extra"']],
      ["schema-3 bad author", variant(commissaire3, { author: "x" }), ["author must be commissaire or producer"]],
      ["schema-3 empty producer_id", variant(commissaire3, { producer_id: "" }), ["producer_id must be a non-empty string"]],
      ["schema-3 both unit keys", variant(commissaire3, { issue: "U1" }), [unitMessage]],
      ["schema-3 no unit key", variant(commissaire3, { unit_id: undefined }), [unitMessage]],
      ["schema-3 commissaire with producer_hmac", variant(commissaire3, { producer_hmac: "h" }), ["author commissaire requires commissaire_sig and no producer_hmac"]],
      ["schema-3 producer without producer_hmac", variant(producer3, { producer_hmac: undefined }), ["author producer requires producer_hmac and no commissaire_sig"]],
      ["schema-3 array payload", variant(commissaire3, { payload: [] }), ["payload must be a JSON object"]],
      ["scenario: dual unit keys on a producer", variant(producer3, { unit_id: "U1" }), [unitMessage]],
    ];
    for (const [label, rec, want] of failing) {
      const got = declaredEffectViolations(rec);
      if (JSON.stringify(got) !== JSON.stringify(want)) fail(`declaredEffectViolations ${label}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
    const passing = [
      ["schema 1", schema1],
      ["schema 2 bare", schema2],
      ["schema 2 with origin", variant(schema2, { origin: "merge-gate-auto" })],
      ["schema 2 with origin and github_actor", variant(schema2, { origin: "pr-create-auto", github_actor: { login: null, source: "ambient" } })],
      ["schema 3 commissaire", commissaire3],
      ["schema 3 producer", producer3],
    ];
    for (const [label, rec] of passing) {
      const got = declaredEffectViolations(rec);
      if (got.length) fail(`declaredEffectViolations accepts ${label}, got ${JSON.stringify(got)}`);
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-effects-record-"));
    try {
      const d = { kind: "pr-create", target: "main", reversible: true };
      appendEffectEntries(tmp, "declare", "FAFF-1", "pr-create", [d, d], "t", { origin: "x" });
      const ledger = path.join(tmp, "declared-effects.jsonl");
      const before = fs.readFileSync(ledger);
      const r = appendEffectEntries(tmp, "declare", "FAFF-1", "pr-create", [d, d], "t", { origin: "x", extra: 1 });
      if (JSON.stringify(r) !== JSON.stringify({ violations: [{ index: 0, violations: ['unexpected field "extra"'], scope: "record" }] })) {
        fail(`appendEffectEntries: an unknown recordFields key returns one record-scoped violation, got ${JSON.stringify(r)}`);
      }
      if (!fs.readFileSync(ledger).equals(before)) fail("appendEffectEntries: a record violation leaves the ledger byte-identical");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  if (failed) return 1;
  console.log("effects --selftest: ok");
  return 0;
}


module.exports = { writeRunState, CONCLUSION_KIND, EFFECT_KINDS, EFFECTS_SPEC, EFFECTS_SURFACE, LANDING_FIX_KINDS, LEGACY_CONCLUSION_KIND, PROTECTED_EFFECT_KINDS, REVIEW_PHASE2_STATUSES, appendEffectEntries, buildProgressApplyComplete, buildProgressPath, buildProgressSelftest, carriesBothUnitKeys, cmdBuildProgress, cmdEffects, cmdLandingProgress, cmdReviewProgress, computeEscapes, conclusionKindOf, declaredEffectViolations, effectDescriptorViolations, effectTargetMatches, effectsSelftest, isProtectedKind, landingProgressApplyFixCycle, landingProgressPath, landingProgressSelftest, matchesUnit, normEffect, reviewProgressApplyOutageRetry, reviewProgressApplyPhase1, reviewProgressApplyPhase2, reviewProgressPath, reviewProgressSelftest, unitIdOf };
