// FAFF-319 / FAFF-670 — the mechanical completeness gate for eval/calibration/oracle-triage.json.
//
// FAFF-319 built this to stop the FAFF-321 recurrence: a triage that covered the alphabetically-first
// 24 case files instead of the target kinds, left kinds untriaged, and carried interchangeable
// "requires Opus regen" notes. FAFF-670 widens the artifact to seven more kinds and reworks the gate so
// the scope is DERIVED from the artifact's own declaration rather than a hardcoded constant — which is
// what lets a timeboxed pass ship partial (some kinds triaged, the rest openly declared "remaining")
// without the suite going red, while three anti-bypass constraints stop the artifact lying about it:
//   - the ratchet: the FAFF-319 kinds can never retreat out of scope;
//   - per-kind set equality: a kind in scope must have an entry for every one of its case files;
//   - deferral is priced: a non-empty remaining_kinds costs a filed ticket naming the exact kinds.
// Plus the free-work claim (paid_model_reps === 0), provenance on every entry, and a corpus-derived
// (not declaration-derived) check on the extension record's kinds_added.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CASES_DIR = join(REPO, "eval", "cases");
const PILOT_DIR = join(REPO, "eval", "cases-pilot");
const ARTIFACT = join(REPO, "eval", "calibration", "oracle-triage.json");
const BASELINE = join(REPO, "eval", "baselines", "frontier.json");

// TARGET_KINDS is THE SPIKE'S SCOPE, hardcoded: the fifteen kinds with no per_kind row in
// eval/baselines/frontier.json — the FAFF-319 eight plus FAFF-670's seven. When FAFF-614 re-baselines,
// every kind in eval/cases/ gets a row and this constant stops describing anything true; the staleness
// test below is deliberately one-directional so that day does not turn the suite red, and retiring the
// constant is owned by the fixture-widening follow-up.
const FAFF_319_KINDS = new Set([
  "architecture", "specqual", "holdout", "roadmap", "adr-gloss", "spec-verdict", "refutation-spec", "refutation-code",
]);
const FAFF_670_KINDS = new Set([
  "adr-drift", "chain-gap", "explanatory-order", "grouping", "holdout-exercise", "prep-architecture-trigger", "resolved-elsewhere",
]);
// FAFF-816 — the upper-gate YAGNI Phase-2 challenge adds one more ungated kind (prdr-yagni, sharing
// adr-drift's binary shape). Widened the same way FAFF-670 widened FAFF-319: triaged immediately
// (zero model reps, static prose triage), never left as a silent staleness-check gap.
const FAFF_816_KINDS = new Set(["prdr-yagni"]);
const TARGET_KINDS = new Set([...FAFF_319_KINDS, ...FAFF_670_KINDS, ...FAFF_816_KINDS]);

const CLASSES = new Set(["oracle-defect", "needs-evidence", "suspected-genuine-miss", "sound"]);
// The FAFF-321 deferral signature — a rationale must never read like a generic punt.
const GENERIC_DEFERRAL = /requires?\s+(opus\s+)?regen|human judgment|human judgement|needs? regen|to be determined/i;

const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
const meta = artifact.meta || {};
const entries = artifact.entries || [];

// Scope is DERIVED from the artifact — the whole point of the FAFF-670 rework. The union/disjointness/
// ratchet trio below is what keeps that derivation honest (it replaces the old tautological
// deepEqual(scope_kinds, IN_SCOPE_KINDS) assertion, which compared the artifact to itself).
const IN_SCOPE_KINDS = new Set(meta.scope_kinds || []);
const REMAINING_KINDS = new Set(meta.remaining_kinds || []);

function setEq(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}
function caseKindsIn(dir) {
  const byKind = new Map();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const c = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!byKind.has(c.kind)) byKind.set(c.kind, new Set());
    byKind.get(c.kind).add(c.id);
  }
  return byKind;
}

const casesByKind = caseKindsIn(CASES_DIR);

test("FAFF-670 scope declaration is honest: union == TARGET_KINDS, disjoint, ratchet holds", () => {
  const union = new Set([...IN_SCOPE_KINDS, ...REMAINING_KINDS]);
  assert.ok(setEq(union, TARGET_KINDS), `scope_kinds ∪ remaining_kinds must equal the ${TARGET_KINDS.size} target kinds`);
  const overlap = [...IN_SCOPE_KINDS].filter((k) => REMAINING_KINDS.has(k));
  assert.deepEqual(overlap, [], `scope_kinds and remaining_kinds must be disjoint; overlap: ${overlap.join(", ")}`);
  for (const k of FAFF_319_KINDS) {
    assert.ok(IN_SCOPE_KINDS.has(k), `ratchet: a FAFF-319 kind may never leave scope_kinds — ${k} did`);
  }
});

test("FAFF-670 TARGET_KINDS has not silently gone stale (one-directional: a NEW ungated kind fails loud)", () => {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const gatedKinds = new Set(Object.keys(baseline.per_kind || {}));
  const ungated = [...casesByKind.keys()].filter((k) => !gatedKinds.has(k));
  const escaped = ungated.filter((k) => !TARGET_KINDS.has(k));
  // Deliberately one-directional. A NEW ungated kind appearing (a kind added to eval/cases/ that no
  // baseline row covers and this spike never triaged) fails here. TARGET_KINDS becoming a SUPERSET of the
  // ungated set — which is what FAFF-614's re-baseline does when it writes rows for these very kinds —
  // does NOT fail, so this spike does not booby-trap the sweep it exists to unblock. Retiring the constant
  // is owned by the fixture-widening follow-up; FAFF-614 is the trigger.
  assert.deepEqual(escaped, [], `ungated kinds not in TARGET_KINDS (new untriaged kind?): ${escaped.join(", ")}`);
});

test("FAFF-670 deferral is priced: a non-empty remaining_kinds costs a ticket naming the exact kinds", () => {
  if (REMAINING_KINDS.size === 0) return; // a complete pass owes nothing here
  const value = (meta.follow_ups || {}).remaining_kinds;
  assert.ok(typeof value === "string" && /FAFF-\d+/.test(value), "remaining_kinds present ⇒ follow_ups.remaining_kinds must name a FAFF ticket");
  // Word-boundary token match, NOT substring/containment (FAFF-670 finding 3): a naive scan matches
  // "holdout" inside "holdout-exercise", so a correct value naming holdout-exercise would spuriously
  // yield {holdout, holdout-exercise}. Split the free-text value on non-kind-token characters and keep
  // only exact tokens that are themselves target kinds — kind ids are lowercase words joined by hyphens.
  const tokens = new Set(value.split(/[^a-z-]+/).filter((t) => TARGET_KINDS.has(t)));
  assert.ok(setEq(tokens, REMAINING_KINDS), `follow_ups.remaining_kinds must enumerate exactly the remaining kinds; got {${[...tokens].join(", ")}}, want {${[...REMAINING_KINDS].join(", ")}}`);
});

test("FAFF-670 per-kind set equality: every in-scope kind's entries cover exactly its case files (both directions)", () => {
  for (const k of IN_SCOPE_KINDS) {
    const caseIds = casesByKind.get(k) || new Set();
    const entryIds = new Set(entries.filter((e) => e.kind === k).map((e) => e.case_id));
    const missing = [...caseIds].filter((id) => !entryIds.has(id));
    const phantom = [...entryIds].filter((id) => !caseIds.has(id));
    assert.deepEqual(missing, [], `kind ${k}: untriaged case file(s): ${missing.join(", ")}`);
    assert.deepEqual(phantom, [], `kind ${k}: entry with no live case file: ${phantom.join(", ")}`);
  }
});

test("FAFF-670 no entry carries an out-of-scope kind", () => {
  for (const e of entries) {
    assert.ok(IN_SCOPE_KINDS.has(e.kind), `entry ${e.case_id}: kind ${e.kind} is not in scope_kinds`);
  }
});

test("FAFF-670 meta counts are counted, not asserted", () => {
  assert.equal(meta.case_count, entries.length, "meta.case_count must equal entries.length");
  const counts = meta.class_counts || {};
  const sum = Object.values(counts).reduce((a, n) => a + n, 0);
  assert.equal(sum, entries.length, "class_counts must sum to entries.length");
  for (const key of Object.keys(counts)) assert.ok(CLASSES.has(key), `class_counts has unknown class ${key}`);
});

test("FAFF-670 the free-work claim: paid_model_reps === 0 (strict, not truthy-zero)", () => {
  assert.strictEqual(meta.paid_model_reps, 0, "meta.paid_model_reps must be exactly 0");
});

test("FAFF-319/670 every entry carries the common fields and a known class", () => {
  for (const e of entries) {
    assert.ok(typeof e.case_id === "string" && e.case_id, `entry missing case_id: ${JSON.stringify(e)}`);
    assert.ok(typeof e.kind === "string" && e.kind, `entry ${e.case_id}: missing kind`);
    assert.ok(typeof e.grader_shape === "string" && e.grader_shape, `entry ${e.case_id}: missing grader_shape`);
    assert.ok(CLASSES.has(e.class), `entry ${e.case_id}: unknown class ${JSON.stringify(e.class)}`);
    assert.ok(typeof e.rationale === "string" && e.rationale.length > 40, `entry ${e.case_id}: rationale too thin`);
  }
});

test("FAFF-670 provenance: every entry names its triage ticket", () => {
  for (const e of entries) {
    assert.ok(/^FAFF-\d+$/.test(e.triage_ticket || ""), `entry ${e.case_id}: triage_ticket must match /^FAFF-\\d+$/`);
  }
  const tickets = new Set(entries.map((e) => e.triage_ticket));
  for (const t of tickets) assert.ok(t === "FAFF-319" || t === "FAFF-670" || t === "FAFF-816" || t === "FAFF-907", `unexpected triage_ticket ${t}`);
});

test("FAFF-319/670 per-class required fields, present-iff", () => {
  for (const e of entries) {
    // oracle-defect ⇒ proposed_fix
    if (e.class === "oracle-defect") {
      assert.ok(typeof e.proposed_fix === "string" && e.proposed_fix.length > 20, `oracle-defect ${e.case_id}: needs a proposed_fix`);
    } else {
      assert.ok(e.proposed_fix == null, `${e.class} ${e.case_id}: only oracle-defect may carry a proposed_fix`);
    }
    // needs-evidence ⇒ discriminating_question
    if (e.class === "needs-evidence") {
      assert.ok(typeof e.discriminating_question === "string" && e.discriminating_question.length > 20, `needs-evidence ${e.case_id}: needs a discriminating_question`);
    } else {
      assert.ok(e.discriminating_question == null, `${e.class} ${e.case_id}: only needs-evidence may carry a discriminating_question`);
    }
    // suspected-genuine-miss ⇒ expected_signal (FAFF-670: the class finally has its own required field,
    // so "no unresolved observation" is checkable rather than aspirational)
    if (e.class === "suspected-genuine-miss") {
      assert.ok(typeof e.expected_signal === "string" && e.expected_signal.length > 20, `suspected-genuine-miss ${e.case_id}: needs an expected_signal`);
    } else {
      assert.ok(e.expected_signal == null, `${e.class} ${e.case_id}: only suspected-genuine-miss may carry an expected_signal`);
    }
  }
});

test("FAFF-321 no generic deferral, no two interchangeable rationales (the stranger test)", () => {
  const seen = new Map();
  for (const e of entries) {
    assert.ok(!GENERIC_DEFERRAL.test(e.rationale), `entry ${e.case_id}: rationale reads as a generic deferral — ${e.rationale.slice(0, 60)}`);
    const norm = e.rationale.trim().toLowerCase();
    assert.ok(!seen.has(norm), `entries ${seen.get(norm)} and ${e.case_id} have interchangeable rationale text`);
    seen.set(norm, e.case_id);
  }
});

test("FAFF-670 the extension record: kinds_added is corpus-derived, paths resolve, origin_commit is real", () => {
  assert.ok(Array.isArray(meta.extensions) && meta.extensions.length > 0, "meta.extensions must be a non-empty array");
  const x = meta.extensions.find((r) => r.ticket === "FAFF-670");
  assert.ok(x, "meta.extensions must hold a FAFF-670 record");

  // kinds_added may legitimately be EMPTY mid-spike (FAFF-670 finding 2: the record is written up front,
  // at the zero-entries degradation state, and grows as kinds are triaged). What must hold is that it
  // equals the kinds actually CARRIED BY entries — corpus-derived, not copied from scope_kinds — so
  // declaring a kind added without writing its entries does not pass.
  assert.ok(Array.isArray(x.kinds_added), "kinds_added must be an array");
  for (const k of x.kinds_added) assert.ok(TARGET_KINDS.has(k), `kinds_added has non-target kind ${k}`);
  const carried = new Set(entries.filter((e) => e.triage_ticket === "FAFF-670").map((e) => e.kind));
  assert.ok(setEq(new Set(x.kinds_added), carried), `kinds_added must equal the kinds carried by FAFF-670 entries; got {${x.kinds_added.join(", ")}}, carried {${[...carried].join(", ")}}`);

  assert.ok(Array.isArray(x.relocated_paths) && x.relocated_paths.length === 5, "relocated_paths must have 5 entries");
  for (const mv of x.relocated_paths) {
    assert.ok(typeof mv.from === "string" && mv.from.startsWith("eval/cases/"), `relocated from must be under eval/cases/: ${mv.from}`);
    assert.ok(typeof mv.to === "string" && mv.to.startsWith("eval/cases-pilot/"), `relocated to must be under eval/cases-pilot/: ${mv.to}`);
    assert.ok(existsSync(join(REPO, mv.to)), `relocated target does not exist on disk: ${mv.to}`);
  }

  assert.ok(/^[0-9a-f]{7,40}$/.test(x.origin_commit || ""), "origin_commit must be 7–40 lowercase hex");
  // Reachability half. FAFF-670 finding 1: .github/workflows/validate.yml checks out with
  // actions/checkout@v4 and no fetch-depth — a depth-1 shallow clone in which only the checked-out tip
  // resolves, while origin_commit is BY CONSTRUCTION an earlier commit. `git cat-file -e <sha>^{commit}`
  // would therefore fail on every CI run. So the hex-shape assertion above is unconditional, and the
  // reachability check is SKIPPED when the clone is shallow (where it cannot be meaningful) and run only
  // in a full clone (local dev, where it catches a fabricated sha).
  let shallow = false;
  try {
    shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: REPO, encoding: "utf8" }).trim() === "true";
  } catch { shallow = true; } // no git / not a work tree ⇒ can't verify reachability, don't fail the suite
  if (!shallow) {
    assert.doesNotThrow(
      () => execFileSync("git", ["cat-file", "-e", `${x.origin_commit}^{commit}`], { cwd: REPO, stdio: "ignore" }),
      `origin_commit ${x.origin_commit} is not a reachable commit in this repo`,
    );
  }
});

test("FAFF-670 assumption checks are verdicts, not prose", () => {
  assert.ok(Array.isArray(meta.assumption_checks) && meta.assumption_checks.length >= 3, "meta.assumption_checks needs ≥3 records");
  for (const c of meta.assumption_checks) {
    assert.ok(typeof c.assumption === "string" && c.assumption, "assumption_check.assumption must be a non-empty string");
    assert.strictEqual(c.result, "pass", "a committed artifact may only record passing assumption checks (a fail stops the build)");
    assert.ok(typeof c.detail === "string" && c.detail.length > 40, "assumption_check.detail must state what was run and what came back (>40 chars)");
  }
});

test("FAFF-319/670 follow-ups name tickets", () => {
  for (const [key, v] of Object.entries(meta.follow_ups || {})) {
    assert.ok(/FAFF-\d+/.test(v), `follow_up ${key} must name a FAFF ticket: ${v}`);
  }
});

test("FAFF-319 meta names the superseded FAFF-321 artifact", () => {
  assert.ok(/triage-results\.json/.test(meta.supersedes || ""), "meta.supersedes must name the superseded root artifact");
});

// FAFF-615 — the entries resolved against the operator's sweep carry a `resolved_by` field, while
// `triage_ticket` stays at first-author provenance (Decision C). The guard is BIDIRECTIONAL and pinned
// to the FAFF-615 extension record's explicit case list, so it can't be built toothless: the class
// alone can't say which entries may carry the field (the flips land on both `oracle-defect` and
// `sound`, and 31 other `sound` entries carry none). The extension list is the concrete anchor.
test("FAFF-615 resolved_by is the literal ticket, cites the run, and matches the extension case list exactly", () => {
  const rec = (meta.extensions || []).find((r) => r.ticket === "FAFF-615");
  assert.ok(rec, "meta.extensions must hold a FAFF-615 record");
  const listed = new Set(rec.resolved_case_ids || []);
  assert.ok(listed.size > 0, "the FAFF-615 record must list a non-empty resolved_case_ids");

  const carrying = new Set();
  for (const e of entries) {
    if (e.resolved_by == null) continue;
    carrying.add(e.case_id);
    assert.equal(e.resolved_by, "FAFF-615", `entry ${e.case_id}: resolved_by must be the literal "FAFF-615"`);
    assert.ok(/20260803-012238/.test(e.rationale || ""), `entry ${e.case_id}: a resolved_by entry must cite run 20260803-012238 in its rationale`);
  }
  assert.ok(
    setEq(carrying, listed),
    `entries carrying resolved_by must equal the FAFF-615 extension list exactly; ` +
      `carrying {${[...carrying].join(", ")}}, listed {${[...listed].join(", ")}}`,
  );
});
