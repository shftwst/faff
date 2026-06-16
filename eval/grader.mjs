// FAFF-130 — Judgement-eval grader (two-tier, deterministic) + aggregation.
//
// Closed-set and ordering judgements grade against a human oracle with NO LLM in the
// grading path. The synthesis gloss grades by a mechanical must_include/must_avoid
// rubric; an LLM "is it good?" judge stays ADVISORY and is never the reported coverage
// (spec Decision 3). Flakiness — not accuracy — is the load-bearing metric, so we measure
// per-case *signature* stability across reps, distinct from oracle accuracy.
//
// Zero-dependency: node builtins only. Pure functions — no clock / random / network.

// FAFF-146 — prep's three judgement surfaces join tidy's six. confidence + marker are isolatable
// (black-box lane); reconciliation is execution-entangled (live-driver lane). All three grade through
// the closed-set path (single-element level for confidence; per-unit `id:class` pairs for marker /
// reconciliation), so the grader reuses CLOSED_SET_KINDS for every new kind.
// FAFF-147 — splittable joins too; it grades via its own synonym-tolerant branch (gradeSplittable),
// so it is deliberately NOT in CLOSED_SET_KINDS.
// FAFF-148 — the review-verdict surface adds two kinds:
//   verdict-revert  — SHIPPED. Isolatable revert-test classification of DESCRIBED findings on the
//                     black-box lane (fail vs needs-human per finding). Oracle = closed-set of
//                     "<finding-key>:<verdict>" pairs; the envelope carries `verdicts: {key: verdict}`.
//   verdict-build   — DESIGNED + CARVED to a follow-up child (live-driver lane). The whole-change
//                     verdict over a real diff/build via runSkill; oracle = single-element closed-set
//                     over {pass, fail, needs-human}. The kind is registered so a future case validates,
//                     but no verdict-build case ships in this issue (the live-driver parameterisation
//                     is the follow-up, shared with FAFF-146's reconciliation child).
// FAFF-149 — the routing surface adds one kind:
//   routing         — SHIPPED. Isolatable verdict-assignment over an ASSEMBLED fixture-of-findings on
//                     the black-box lane: which of the closed SIX automation-routing verdicts the
//                     fixture implies. Oracle = single-element closed-set over {fire-and-forget,
//                     likely-fire, needs-decision-first, gap-blocked, circular-blocked, repeat-parked};
//                     the envelope carries `verdict: "<one of the six>"` (the confidence analogue, one
//                     level → one verdict). The LIVE input-assembly half (diagnostics + markers +
//                     park-history + live-thread reconciliation assembled across a real pass) is CARVED
//                     to a FAFF-135 live-driver child — the kind is registered here so that future case
//                     validates with no grader change. The admission rule (only fire-and-forget +
//                     likely-fire admit) is a DETERMINISTIC derived check over the assigned verdict,
//                     asserted in the cases / tests, NOT a second LLM judgement (spec §6.B).
// FAFF-150 — the jot/intake MODE-DETECTION surface adds one kind:
//   modedetect      — SHIPPED. Isolatable greenfield/single-item/ambiguous classification of a
//                     ModeScenario fixture on the black-box lane. Oracle = single-element closed-set
//                     over {greenfield, single-item, ambiguous}; the envelope carries `mode: "<one
//                     of the three>"` (the confidence/routing analogue, one verdict → a one-element
//                     set). It grades through the EXISTING closed-set/`setEqual` path — zero new
//                     grader logic — so a missing/out-of-enum `mode` → empty/verbatim set → a clean
//                     FAIL with a distinct signature (flakiness preserved). The GENERATIVE half
//                     (ticket shaping, plot decomposition) is CARVED to a follow-up that implements
//                     the advisory rubric-coverage oracle (gradeShaping / gradeDecomposition mirroring
//                     gradeGloss); no shaping/decomposition kind ships here.
// FAFF-161 — that carved follow-up: the GENERATIVE jot/plot surfaces add two kinds, the advisory
// rubric-coverage oracle FAFF-150 §7/§9 settled (policy Chosen, human decision 2026-06-15):
//   shaping        — SHIPPED. jot/plot ticket-shaping coverage: a `gradeGloss`-style mechanical
//                    must_include/must_avoid synonym-set coverage fraction over the emitted ticket-
//                    boundary set (env.shaping). NO structural assertions (shaping has no tree). NON-
//                    closed-set (generative, multi-valued — the gloss/splittable posture); carries its
//                    oracle in the EXISTING `gloss_rubric` field. PARTIAL/PASS-on-1 like gloss.
//   decomposition  — SHIPPED. plot decomposition coverage: the same gloss coverage fraction over the
//                    emitted tree (env.decomposition), ANDed with THREE deterministic structural
//                    assertions over the tree (structuralChecks): every proposed epic links to a parent
//                    project; no branch recurses past first-slice; dep links form a DAG. The three
//                    booleans append to the coverage vector before the score, so a structural violation
//                    lowers reported coverage mechanically. NON-closed-set; `gloss_rubric` oracle.
//   Any LLM judge stays strictly ADVISORY (ADR-0004) — never the reported metric, never gates a grade.
//   The measured frontier baseline (real claude -p reps) is the human-supervised carved follow-up.
// FAFF-153 — the CHAIN-GAP prose-parsing surface adds one kind:
//   chain-gap      — SHIPPED. The full-pipeline LLM half of tidy's chain-gap structural diagnostic:
//                    read a spec's free-text implementation advice, IDENTIFY the references it names
//                    but doesn't ticket, classify each as upstream/downstream/peer/sub-ticket, and
//                    apply the conservative skips ([] when no real gap remains). It grades via its OWN
//                    synonym-tolerant branch (gradeChainGap) over `{reference, sub_type}` pairs — the
//                    gradeSplittable SHAPE, but a pair (reference synonym-folded + EXACT sub_type enum)
//                    rather than a bare label — so it is deliberately NOT in CLOSED_SET_KINDS. The
//                    envelope carries `chain_gap: [{reference, sub_type}, …]`; the oracle rides the
//                    EXISTING `closed_set` field (validateCase's default `want`, no change). A
//                    missing/garbage field or out-of-enum sub_type → empty/verbatim canon → a clean
//                    FAIL with a distinct signature (the gradeSplittable Array.isArray fail-safe). The
//                    DETERMINISTIC graph-traversal half (does a matching ticket exist) is carved to a
//                    scripted test (mirroring FAFF-152), NOT this eval. The measured frontier baseline
//                    is the human-supervised carved follow-up.
export const KINDS = ["dupe", "vague", "stale", "superseded", "ordering", "gloss", "confidence", "marker", "reconciliation", "splittable", "verdict-revert", "verdict-build", "routing", "modedetect", "shaping", "decomposition", "chain-gap"];
export const CLOSED_SET_KINDS = new Set(["dupe", "vague", "stale", "superseded", "confidence", "marker", "reconciliation", "verdict-revert", "verdict-build", "routing", "modedetect"]);

// FAFF-149 — the closed SIX automation-routing verdicts (the gateway's vocabulary, verbatim) + the
// fixed build-queue admission rule. `admits(verdict)` is a PURE function of the verdict — the spec's
// deterministic derived check (§6.B), so cases/tests assert admission without a second LLM judgement.
export const ROUTING_VERDICTS = ["fire-and-forget", "likely-fire", "needs-decision-first", "gap-blocked", "circular-blocked", "repeat-parked"];
const ADMITTED_VERDICTS = new Set(["fire-and-forget", "likely-fire"]);
export const admits = (verdict) => ADMITTED_VERDICTS.has(verdict);

export class CaseError extends Error {}

// FAFF-146 — prep surfaces carry a non-backlog fixture (a spec body / decision sections / a comment
// thread), so the harness reads the shape the kind expects rather than the tidy `issues[]` backlog.
// Each entry lists the fixture fields that kind's driver reads; validateCase asserts they are present.
const FIXTURE_SHAPE = {
  confidence: ["spec_body"],
  marker: ["sections"],
  reconciliation: ["issue", "spec_comment", "thread"],
  // FAFF-149 — the routing fixture is an assembled fixture-of-findings; the driver renders `issue` +
  // `spec` (plus the optional diagnostics / conflict / park_history inputs that drive the verdict).
  routing: ["issue", "spec"],
  // FAFF-155 — verdict-build deliberately carries NO validateCase FIXTURE_SHAPE entry: the FAFF-148
  // contract test asserts a fixture-less verdict-build oracle validates (validateCase is oracle-shape
  // only for this kind), so the load-bearing `spec`/`diff` presence check lives in verdictBuildLiveDriver
  // + driveVerdictBuildCase (the driver guards), not here. Keeping validateCase byte-identical for the
  // already-registered kind is the constraint; the spec's FIXTURE_SHAPE guard was explicitly optional.
};

// Validate one EvalCase: known kind, the oracle populates exactly the field its kind needs, and (for
// the prep kinds) the fixture carries the shape that kind's driver reads.
export function validateCase(c) {
  if (!c || typeof c !== "object") throw new CaseError("case must be an object");
  if (typeof c.id !== "string" || !c.id) throw new CaseError("case.id must be a non-empty string");
  if (!KINDS.includes(c.kind)) throw new CaseError(`case ${c.id}: unknown kind ${JSON.stringify(c.kind)}`);
  // splittable shares the `closed_set` oracle field (a set of independent-concern synonym-sets),
  // graded with synonym folding — see gradeSplittable.
  // FAFF-161 — shaping + decomposition carry their oracle in the EXISTING `gloss_rubric` field
  // ({ must_include, must_avoid }, synonym-set entries — the gradeGloss shape, FAFF-150 §9), so the
  // populate-exactly-one exclusivity check is reused with zero new oracle-field machinery.
  const want = c.kind === "ordering" ? "ordering"
    : (c.kind === "gloss" || c.kind === "shaping" || c.kind === "decomposition") ? "gloss_rubric"
    : "closed_set";
  const populated = ["closed_set", "ordering", "gloss_rubric"].filter((k) => (c.oracle || {})[k] != null);
  if (populated.length !== 1 || populated[0] !== want) {
    throw new CaseError(`case ${c.id}: oracle must populate exactly \`${want}\` for kind \`${c.kind}\``);
  }
  const shape = FIXTURE_SHAPE[c.kind];
  if (shape) {
    const fx = c.fixture || {};
    for (const field of shape) {
      if (fx[field] == null) throw new CaseError(`case ${c.id}: kind \`${c.kind}\` fixture must carry \`${field}\``);
    }
  }
  return c;
}

function setEqual(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

// Normalised rank correlation over the judgement-determined portion only (1 - inversions/max).
// Identical order => 1.0; full reverse => 0.0. Structural-CLI ties excluded: we only score
// ids the oracle lists (the judgement portion), in the relative order the prediction gives them.
export function rankCorrelation(predicted, oracle) {
  const ranked = oracle.filter((id) => predicted.includes(id));
  const n = ranked.length;
  if (n < 2) return 1.0;
  const pos = new Map(predicted.map((id, i) => [id, i]));
  let inv = 0;
  const max = (n * (n - 1)) / 2;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (pos.get(ranked[i]) > pos.get(ranked[j])) inv++;
  return 1 - inv / max;
}

// FAFF-142: a rubric entry is EITHER a string (exact substring, as before) OR an array of synonyms
// (matches if ANY appears) — so a correct gloss using a synonym ("throttle" for "rate-limit") isn't a
// false-negative. Still fully mechanical/deterministic — no LLM in the load-bearing path.
const entryMatches = (t, entry) =>
  Array.isArray(entry)
    ? entry.some((syn) => t.includes(String(syn).toLowerCase()))
    : t.includes(String(entry).toLowerCase());

// Mechanical gloss rubric — fraction of must_include/must_avoid checks passing across glosses.
// Returns { score, checks, passed, vector } where vector is the per-check pass/fail (for stability).
export function gradeGloss(env, rubric) {
  const glosses = Object.values(env.gloss || {});
  const vector = [];
  for (const raw of glosses) {
    const t = String(raw).toLowerCase();
    for (const inc of rubric.must_include || []) vector.push(entryMatches(t, inc));
    for (const avo of rubric.must_avoid || []) vector.push(!entryMatches(t, avo));
  }
  const passed = vector.filter(Boolean).length;
  return { score: vector.length ? passed / vector.length : 0, checks: vector.length, passed, vector };
}

// FAFF-161 — collection-level rubric coverage (the shaping/decomposition oracle). UNLIKE gradeGloss —
// which scores a per-(gloss × entry) cross-product because a synthesis gloss is a SINGLE one-liner —
// a shaping/decomposition output is a SET of many ticket glosses, and a concept is "covered" when it
// appears ANYWHERE across the set (FAFF-150 §9 / spec SCENARIO 1: "covering both concept-sets" → 1.0),
// not when it appears in EVERY item. So each must_include set yields ONE check (passes if any item
// matches it) and each must_avoid set yields ONE check (passes if NO item matches it). The synonym
// folding (entryMatches) is reused verbatim — still fully mechanical, no LLM. Returns the gradeGloss
// { score, checks, passed, vector } shape so grade() handles it identically.
export function gradeCoverage(items, rubric) {
  const texts = (Array.isArray(items) ? items : Object.values(items || {})).map((x) => String(x).toLowerCase());
  const vector = [];
  for (const inc of (rubric && rubric.must_include) || []) vector.push(texts.some((t) => entryMatches(t, inc)));
  for (const avo of (rubric && rubric.must_avoid) || []) vector.push(!texts.some((t) => entryMatches(t, avo)));
  const passed = vector.filter(Boolean).length;
  return { score: vector.length ? passed / vector.length : 0, checks: vector.length, passed, vector };
}

// FAFF-161 — gradeShaping: collection-level coverage over the model's emitted ticket-boundary set.
// `env.shaping` is the glosses collection (a {id: gloss} map OR a flat array of one-line ticket
// glosses). A missing/garbage field → empty collection → every must_include misses (coverage 0), never
// a crash (the gradeGloss fail-safe stance). Shaping has NO tree, so NO structural checks.
export function gradeShaping(env, rubric) {
  return gradeCoverage((env && env.shaping) || [], rubric || {});
}

// FAFF-161 — the three DETERMINISTIC structural assertions over a decomposition tree (decomposition
// only). They are case-INDEPENDENT universal invariants of a correct decomposition, so they live in
// CODE (mechanical, DRY — one definition, not re-authored per case), not as per-case oracle data.
// Returns a boolean VECTOR [parentLink, stopRule, dag] (one per assertion) appended to the coverage
// vector before the score, so a structural violation lowers reported coverage mechanically.
//   - parent-link: every epic.parent is a non-null id present in projects[].id.
//   - stop-rule:   no epic recurses past first-slice (epic.slice === "first-slice" or absent for every
//                  epic; any deeper/other marker fails) — no branch recurses past the first slice.
//   - DAG:         the directed `deps` edges contain no cycle (a deterministic DFS over the edge list).
// Malformed structure (non-array epics/projects/deps) → the relevant assertion fails DEFENSIVELY (treat
// as a violation), never throws — the gradeSplittable Array.isArray guard stance. Empty deps → the DAG
// check vacuously passes (no edges, no cycle).
export function structuralChecks(tree) {
  const t = tree && typeof tree === "object" ? tree : {};
  const epics = Array.isArray(t.epics) ? t.epics : null;
  const projects = Array.isArray(t.projects) ? t.projects : null;
  const deps = Array.isArray(t.deps) ? t.deps : null;

  // parent-link: every epic links to a parent project present in projects[].id.
  let parentLink;
  if (epics === null || projects === null) {
    parentLink = false; // malformed → defensive violation
  } else {
    const projectIds = new Set(projects.map((p) => p && p.id).filter((id) => id != null));
    parentLink = epics.every((e) => e && e.parent != null && projectIds.has(e.parent));
  }

  // stop-rule: no branch recurses past first-slice.
  let stopRule;
  if (epics === null) {
    stopRule = false; // malformed → defensive violation
  } else {
    stopRule = epics.every((e) => e && (e.slice == null || e.slice === "first-slice"));
  }

  // DAG: the directed dep edges contain no cycle (DFS with a recursion stack).
  let dag;
  if (deps === null) {
    dag = false; // malformed deps → defensive violation
  } else {
    dag = isDag(deps);
  }

  return [parentLink, stopRule, dag];
}

// Deterministic cycle detection over a directed edge list ([[from, to], …]). Returns true iff acyclic.
// Empty edge list → true (vacuously a DAG). A malformed edge (not a 2-array) is skipped defensively.
function isDag(edges) {
  const adj = new Map();
  const nodes = new Set();
  for (const e of edges) {
    if (!Array.isArray(e) || e.length < 2) continue; // skip malformed edge defensively
    const [from, to] = e;
    nodes.add(from); nodes.add(to);
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(to);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map([...nodes].map((n) => [n, WHITE]));
  const visit = (n) => {
    color.set(n, GREY);
    for (const m of adj.get(n) || []) {
      const c = color.get(m);
      if (c === GREY) return false;          // back-edge → cycle
      if (c === WHITE && !visit(m)) return false;
    }
    color.set(n, BLACK);
    return true;
  };
  for (const n of nodes) {
    if (color.get(n) === WHITE && !visit(n)) return false;
  }
  return true;
}

// FAFF-161 — gradeDecomposition: the gloss coverage fraction over the emitted tree's flattened
// titles/glosses, ANDed with the three structuralChecks. The structural booleans are concatenated onto
// the coverage vector before computing passed/total, so a structural violation lowers reported coverage
// mechanically — the same `score`/`vector` shape grade() already handles for gloss. A missing/garbage
// tree → empty glosses (coverage 0) + structural checks fail defensively → a clean low score, no crash.
//
// The glosses collection for the rubric is the tree's flattened titles/glosses: every node's `title` or
// `gloss` across initiatives/projects/epics. (gradeGloss's Object.values shape — a {i: text} map.)
function decompositionGlosses(tree) {
  const t = tree && typeof tree === "object" ? tree : {};
  const out = [];
  for (const key of ["initiatives", "projects", "epics"]) {
    const arr = Array.isArray(t[key]) ? t[key] : [];
    for (const node of arr) {
      if (node && typeof node === "object") {
        const text = node.title ?? node.gloss;
        if (text != null) out.push(String(text));
      } else if (node != null) {
        out.push(String(node));
      }
    }
  }
  return out;
}

export function gradeDecomposition(env, rubric) {
  const tree = (env && env.decomposition) || {};
  const { vector: covVector } = gradeCoverage(decompositionGlosses(tree), rubric || {});
  const structural = structuralChecks(tree);
  const vector = [...covVector, ...structural];
  const passed = vector.filter(Boolean).length;
  return { score: vector.length ? passed / vector.length : 0, checks: vector.length, passed, vector };
}

// FAFF-146 — read the predicted closed set out of the envelope for the kind under grade. The tidy
// kinds read `classifications[kind]`; prep's surfaces carry their judgement under their own top-level
// envelope field (a new field per the FAFF-134 anti-pattern: wire both ends together). All three
// reduce to a flat string set the closed-set grader scores by set-equality:
//   confidence    → [ "<level>" ]                 (single-element level set)
//   marker        → [ "<section-key>:<class>" ]   (one per identified decision section)
//   reconciliation→ [ "<comment-id>:<label>" ]    (one per post-spec comment)
// A pair-map (marker/reconciliation) with no/garbage field yields an empty set → a clean FAIL, never
// a crash (the malformed-confidence fail-safe and its marker/reconciliation analogues).
function pairsOf(map) {
  if (!map || typeof map !== "object") return [];
  return Object.entries(map).map(([k, v]) => `${k}:${v}`);
}
function predictedSet(c, env) {
  switch (c.kind) {
    case "confidence":
      return env.confidence == null ? [] : [String(env.confidence)];
    // FAFF-149 — routing: a single assigned verdict → a single-element set (the confidence analogue).
    // A missing/garbage verdict → empty set → a clean FAIL, never a crash; an out-of-enum token is
    // passed through verbatim so setEqual fails it cleanly with a distinct signature (the eval-side
    // fail-safe; the deterministic fail-loud-on-out-of-enum lives in `faff contract automation-routing`,
    // NOT here — the verdict-revert/confidence coercion stance, spec §HOW edge cases).
    // FAFF-155 — verdict-build: the whole-change review verdict is ALSO a single verdict → a
    // single-element set (the routing analogue), so it reads the SAME `env.verdict` field. Joining
    // routing's arm is the one grader touch; the eval-side fail-safe is identical (missing → [] → clean
    // FAIL; out-of-enum → verbatim → distinct signature). NO eval-side coercion — the malformed→
    // needs-human coercion is computeReviewVerdict's job (out of scope), exactly the routing stance.
    case "routing":
    case "verdict-build":
      return env.verdict == null ? [] : [String(env.verdict)];
    // FAFF-150 — modedetect: a single mode verdict → a one-element set (the confidence/routing
    // analogue). A missing `mode` → empty set → a clean FAIL with signature "[]"; an out-of-enum
    // value (e.g. "feature") is passed through verbatim so setEqual fails it cleanly with a distinct
    // signature (the eval-side fail-safe — same stance as confidence/routing).
    case "modedetect":
      return env.mode == null ? [] : [String(env.mode)];
    case "marker":
      return pairsOf(env.markers);
    case "reconciliation":
      return pairsOf(env.reconciliation);
    default:
      return (env.classifications && env.classifications[c.kind]) || [];
  }
}

// FAFF-147 — splittable-spec grading. The model returns `splittable`: an array of free-text
// independent-concern labels ([] = not splittable). The oracle's `closed_set` is an array of
// concern entries, each a synonym-set (a string, or an array of synonyms, exactly like the gloss
// rubric — FAFF-142). We fold both sides through synonym matching before set-equality so 'URL
// routing' == 'routing' isn't a false-negative, and grading stays fully mechanical (no LLM).
//
// A predicted label canonicalises to the FIRST oracle entry it matches (its index); an unmatched
// label canonicalises to `extra:<label>` (so a phantom concern breaks equality). Matching is
// symmetric containment: a label matches an entry if any synonym is a substring of the label OR the
// label is a substring of a synonym. Returns { graded, score, signature }:
//   PASS  — every oracle entry is covered AND no predicted label is extra (synonym-tolerant equality)
//   FAIL  — otherwise
// signature = the sorted canonicalised label set (deterministic; for cross-rep stability).
// Normalise for synonym matching: lowercase, hyphens/underscores/slashes → spaces, collapse runs of
// whitespace, trim. So "continuous-integration pipeline" and "continuous integration" align, and a
// model's free-text label isn't a false-negative on punctuation alone.
const normLabel = (s) => String(s).toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
const labelMatchesEntry = (label, entry) => {
  const t = normLabel(label);
  const syns = Array.isArray(entry) ? entry : [entry];
  return syns.some((s) => {
    const syn = normLabel(s);
    return syn !== "" && (t.includes(syn) || syn.includes(t));
  });
};

export function gradeSplittable(predictedLabels, oracleSet) {
  const predicted = Array.isArray(predictedLabels) ? predictedLabels : [];
  const oracle = Array.isArray(oracleSet) ? oracleSet : [];
  const coveredOracleIdx = new Set();
  const canon = [];
  for (const label of predicted) {
    const idx = oracle.findIndex((entry) => labelMatchesEntry(label, entry));
    if (idx === -1) {
      canon.push(`extra:${normLabel(label)}`);
    } else {
      coveredOracleIdx.add(idx);
      canon.push(`oracle:${idx}`);
    }
  }
  const allCovered = coveredOracleIdx.size === oracle.length;
  const noExtra = !canon.some((c) => c.startsWith("extra:"));
  const ok = allCovered && noExtra;
  const signature = JSON.stringify([...new Set(canon)].sort());
  return { graded: ok ? "PASS" : "FAIL", score: ok ? 1 : 0, signature };
}

// FAFF-153 — chain-gap grading. The model returns `chain_gap`: an array of { reference, sub_type }
// pairs ([] = no real gap after the conservative skips). The oracle's `closed_set` is an array of
// { reference: <synonym-set>, sub_type: <enum> } entries — the reference a string OR an array of
// synonyms (the gloss/splittable shape — FAFF-142), the sub_type one of upstream/downstream/peer/
// sub-ticket. This is the gradeSplittable SHAPE one level richer: a predicted pair matches an oracle
// entry iff the reference matches synonym-tolerantly (reuse labelMatchesEntry/normLabel) AND the
// sub_type matches EXACTLY (a misclassified gap is a real miss — the chain-fill relationship differs
// per sub-type). Grading stays fully mechanical (no LLM).
//
// A predicted pair canonicalises to the FIRST oracle entry it matches (its index), marking it covered;
// an unmatched pair canonicalises to `extra:<norm reference>:<sub_type>` (so a phantom or misclassified
// gap breaks equality). Returns { graded, score, signature }:
//   PASS  — every oracle entry covered AND no predicted pair extra (synonym-tolerant equality)
//   FAIL  — otherwise (incl. missing/garbage field, out-of-enum sub_type → a verbatim canon, distinct sig)
// signature = the sorted canonicalised pair set (deterministic; for cross-rep stability).
export function gradeChainGap(predictedPairs, oracleSet) {
  const predicted = Array.isArray(predictedPairs) ? predictedPairs : [];
  const oracle = Array.isArray(oracleSet) ? oracleSet : [];
  const coveredOracleIdx = new Set();
  const canon = [];
  for (const pair of predicted) {
    const ref = pair == null ? "" : pair.reference;
    const sub = pair == null ? undefined : pair.sub_type;
    const idx = oracle.findIndex(
      (entry) =>
        entry != null &&
        labelMatchesEntry(ref, entry.reference) &&
        String(sub) === String(entry.sub_type)
    );
    if (idx === -1) {
      canon.push(`extra:${normLabel(ref)}:${sub}`);
    } else {
      coveredOracleIdx.add(idx);
      canon.push(`oracle:${idx}`);
    }
  }
  const allCovered = coveredOracleIdx.size === oracle.length;
  const noExtra = !canon.some((c) => c.startsWith("extra:"));
  const ok = allCovered && noExtra;
  const signature = JSON.stringify([...new Set(canon)].sort());
  return { graded: ok ? "PASS" : "FAIL", score: ok ? 1 : 0, signature };
}

// grade(case, envelope) -> RepResult { graded, score, tokens, signature }.
// `signature` is the canonical judgement identity used for flakiness (NOT the grade) —
// two reps that both FAIL but classify differently are correctly counted as unstable.
// FAFF-148 — map a verdict-revert envelope's `verdicts` object ({ "<key>": "fail|needs-human", … })
// onto the SAME closed-set shape the grader already scores: a flat ["<key>:<verdict>", …] array. A
// missing/out-of-enum verdict (e.g. the model emitting "pass" for a per-finding call, or a garbled
// token) is mapped through verbatim — so setEqual against the oracle FAILS it cleanly and it carries a
// distinct signature (the eval-side fail-safe; the DETERMINISTIC coercion lives in computeReviewVerdict
// and is deliberately NOT duplicated here — spec §3 coercion stance).
function verdictRevertPredicted(env) {
  const v = (env && env.verdicts) || {};
  if (typeof v !== "object" || Array.isArray(v)) return [];
  return Object.keys(v).map((k) => `${k}:${v[k]}`);
}

export function grade(c, env) {
  const tokens = (env && env.tokens) || 0;
  if (CLOSED_SET_KINDS.has(c.kind)) {
    // verdict-revert carries env.verdicts ({key: verdict}); confidence/marker/reconciliation + the tidy
    // closed-set kinds go through predictedSet. Both reduce to a flat predicted set for setEqual.
    const predicted = c.kind === "verdict-revert"
      ? verdictRevertPredicted(env)
      : predictedSet(c, env);
    const ok = setEqual(predicted, c.oracle.closed_set);
    return { graded: ok ? "PASS" : "FAIL", score: ok ? 1 : 0, tokens, signature: JSON.stringify([...predicted].sort()) };
  }
  if (c.kind === "ordering") {
    const predicted = env.ordering || [];
    const score = rankCorrelation(predicted, c.oracle.ordering);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(predicted) };
  }
  if (c.kind === "gloss") {
    const { score, vector } = gradeGloss(env, c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  // FAFF-161 — shaping/decomposition: gloss-style coverage metrics (PARTIAL on score in [0,1), PASS on
  // 1) with a vector signature, mirroring the gloss branch. decomposition's vector folds in the three
  // structural assertions so a structural violation alone drops it below 1.0 (PARTIAL) regardless of
  // rubric coverage.
  if (c.kind === "shaping") {
    const { score, vector } = gradeShaping(env, c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  if (c.kind === "decomposition") {
    const { score, vector } = gradeDecomposition(env, c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  if (c.kind === "splittable") {
    const { graded, score, signature } = gradeSplittable(env.splittable, c.oracle.closed_set);
    return { graded, score, tokens, signature };
  }
  if (c.kind === "chain-gap") {
    const { graded, score, signature } = gradeChainGap(env.chain_gap, c.oracle.closed_set);
    return { graded, score, tokens, signature };
  }
  throw new CaseError(`grade: unknown kind ${c.kind}`);
}

// A rep whose envelope was missing/malformed — distinct signature so it lowers stability.
export function erroredRep(transcriptRef) {
  return { graded: "ERRORED", score: 0, tokens: 0, signature: "ERRORED", transcript: transcriptRef || null };
}

// Aggregate reps into a CaseResult.
//   stability = fraction of reps whose judgement signature == the modal signature (1.0 = stable)
//   accuracy  = fraction of reps that PASS the oracle exactly (score === 1)
export function aggregateCase(c, repResults, { escalated = false } = {}) {
  const sigs = repResults.map((r) => r.signature);
  const counts = {};
  for (const s of sigs) counts[s] = (counts[s] || 0) + 1;
  const modal = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const n = repResults.length || 1;
  // FAFF-137: format_adherence = fraction of *parsed* reps (those carrying a format flag — errored
  // reps have none) whose envelope used the exact tag. null when no rep was parsed.
  const formatted = repResults.filter((r) => r.format === "compliant" || r.format === "noncompliant");
  return {
    case_id: c.id,
    kind: c.kind,
    rep_results: repResults,
    stability: sigs.filter((s) => s === modal).length / n,
    accuracy: repResults.filter((r) => r.score === 1).length / n,
    format_adherence: formatted.length ? formatted.filter((r) => r.format === "compliant").length / formatted.length : null,
    escalated,
    errored: repResults.filter((r) => r.graded === "ERRORED").length,
    cost_tokens: repResults.reduce((s, r) => s + (r.tokens || 0), 0),
  };
}

// True iff the reps so far show ≥1 cross-rep judgement disagreement (the escalation trigger).
export function hasDisagreement(repResults) {
  return new Set(repResults.map((r) => r.signature)).size > 1;
}
