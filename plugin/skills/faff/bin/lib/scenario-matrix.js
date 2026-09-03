// ===========================================================================
// === region:governance — scenario-matrix — FAFF-822: the pure ScenarioRecord emitter + deterministic report renderer for the nine-scenario Phase 0 reference matrix ===
//
// The common per-scenario record shape (the ticket's "common audit bundle",
// named off "audit" so it never clashes with ADR-0123's `commissaire audit`
// governance-evidence object) plus a pure emitter that builds it from one
// scenario result and a pure renderer that folds the banked records into a
// deterministic REPORT.md. Cross-oracle Phase-0 evidence tooling, NOT one of
// ADR-0123's four Commissaire facade objects (contract/effect/verdict/audit),
// so it lives under its own top-level `faff scenario-matrix` namespace rather
// than inside the facade.
//
// PURE core: buildScenarioRecord / renderReport read only their inputs — no
// filesystem, tracker, network, or LLM access, matching computeEscapes
// (effects.js). Region governance so the emitter requires NO factory file and
// the require-graph direction lint (regions.js) holds; the thin CLI shell below
// uses node builtins only (fs to read stdin / a matrix.jsonl path).
// ===========================================================================

"use strict";

const fs = require("node:fs");
const { parseArgs, usageError } = require("./argv");

// The record-shape version, frozen for banked readers.
const SCHEMA = 1;

// The nine canonical dispositions — one per scenario, mapped from the raw oracle basis.
const DISPOSITIONS = [
  "accepted",   // 1: grant, chain verified, audit verify clean, no escape
  "blocked",    // 2: decideFloor refuse at the merge chokepoint (E-B prevention)
  "refused",    // 3: forged grant fails commissaire audit verify / chokepointPermit
  "recovered",  // 4: bundleRecover noop-already-present or reconstructed; torn tail tolerated
  "denied",     // 5: request deny reason=stale-evidence, no grant written
  "detected",   // 6: computeEscapes.any_escape=true naming the uncovered effect
  "parked",     // 7: budget outcome park-until-window-reset with resume_at
  "amended",    // 8: new-revision records verify, stale-key record fails the auth leg
  "corrected",  // 9: idempotency match/conflict, gap-free resumed seq, no duplicate work-item
];
const DISPOSITION_SET = new Set(DISPOSITIONS);

const JOURNAL_CLASSES = ["J-A", "J-B", "J-C", "J-D"];
const EFFECT_CLASSES = ["E-A", "E-B", "E-C", "E-D"];

// Scenarios 2, 3, 5, 6 are the catch rows — governance blocks/refuses/denies/detects a seeded
// fault, so an ungoverned one-shot control makes the catch legible. The control is non-null on
// exactly these ordinals and null everywhere else.
const CATCH_ORDINALS = new Set([2, 3, 5, 6]);

// The required-field list a validator reuses (the shape a banked reader depends on).
const SCENARIO_RECORD_REQUIRED_FIELDS = [
  "schema", "scenario_id", "scenario_ordinal", "inputs", "environment", "run_id", "work_item_id",
  "disposition", "disposition_basis", "evidence_paths", "human_interventions", "cost",
  "assurance_vector", "claim_label", "one_shot_control", "two_custodian_split_verified",
];

// --- honest-claim label detection ---------------------------------------------------------
// A claim label implies E-B prevention when it names E-B or "prevent"; it implies
// non-repudiation when it names "non-repudiation". These are the two overstatements the guard
// refuses (a producer HMAC leg is J-C mechanical detection, never non-repudiation; E-B is
// claimable only at the merge chokepoint's block).
function claimImpliesEB(label) {
  return /(^|[^A-Za-z])E-?B([^A-Za-z]|$)/i.test(label) || /prevent/i.test(label);
}
function claimImpliesNonRepudiation(label) {
  return /non[-\s]?repudiat/i.test(label);
}
// The strongest journal class a label NAMES (J-A strongest … J-D weakest), or null if it names
// none. Used to refuse a label that advertises a stronger journal dimension than the vector the
// oracle computed (the "claim_label ≤ every dimension" principle, journal axis).
const JOURNAL_RANK = { "J-A": 0, "J-B": 1, "J-C": 2, "J-D": 3 };
function claimJournalClass(label) {
  let strongest = null;
  for (const m of String(label).matchAll(/(^|[^A-Za-z])(J-[ABCD])([^A-Za-z]|$)/gi)) {
    const cls = m[2].toUpperCase();
    if (strongest === null || JOURNAL_RANK[cls] < JOURNAL_RANK[strongest]) strongest = cls;
  }
  return strongest;
}

// --- assurance vector: computed FROM the disposition basis, never a static string ----------
// journal_class: J-C when the audit_verify basis shows a producer HMAC leg `verified`; J-D for a
//   self-declared record; never above J-C for producer authentication. An unverifiable_without_
//   secret claim never raises it (only a `verified` producer count does).
// effect_class:  E-B ONLY when disposition == blocked (the merge chokepoint); E-D for a budget
//   park (no effect-observation assurance); E-C otherwise.
// independence.organisational_independence: ALWAYS false (Phase 0, one maintainer).
// isolation: fixture unless the row ran against a clean outward repo. review: mechanical.
function computeAssuranceVector(result) {
  const basis = (result.disposition_basis && typeof result.disposition_basis === "object") ? result.disposition_basis : {};
  const av = (basis.audit_verify && typeof basis.audit_verify === "object") ? basis.audit_verify : null;
  const producerVerified = !!(av && av.producer && Number(av.producer.verified) > 0);
  const authRow = !!av;
  const journal_class = producerVerified ? "J-C" : "J-D";
  let effect_class;
  if (result.disposition === "blocked") effect_class = "E-B";
  else if (result.disposition === "parked") effect_class = "E-D";
  else effect_class = "E-C";
  const isolation = result.isolation === "clean-outward-repo" ? "clean-outward-repo" : "fixture";
  return {
    journal_class,
    effect_class,
    independence: {
      key_custody_split: result.two_custodian_split_verified === true,
      author_binding: authRow,          // producer HMAC vs Commissaire Ed25519 distinguishable on this row
      process_independence: authRow,    // producer records authored by a separate spawned process
      organisational_independence: false, // ALWAYS false in Phase 0 by construction
    },
    isolation,
    review: "mechanical",
  };
}

function deepFreeze(obj) {
  if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
    Object.freeze(obj);
  }
  return obj;
}

// --- the pure emitter ---------------------------------------------------------------------
// buildScenarioRecord(scenarioResult) → frozen ScenarioRecord (schema:1). Fails LOUD (throws)
// on any dishonest or ill-formed input rather than banking a downgraded record.
function buildScenarioRecord(scenarioResult) {
  const r = (scenarioResult && typeof scenarioResult === "object" && !Array.isArray(scenarioResult)) ? scenarioResult : null;
  if (!r) throw new Error("scenario-matrix: scenario result must be a JSON object");

  // 1. required identities and shape.
  if (typeof r.scenario_id !== "string" || r.scenario_id === "") throw new Error("scenario-matrix: scenario_id is required");
  if (!Number.isInteger(r.scenario_ordinal) || r.scenario_ordinal < 1 || r.scenario_ordinal > 9) {
    throw new Error("scenario-matrix: scenario_ordinal must be an integer in 1..9");
  }
  if (typeof r.run_id !== "string" || r.run_id === "") throw new Error("scenario-matrix: run_id is required (a scenario result without a run identity is non-emittable)");
  if (typeof r.work_item_id !== "string" || r.work_item_id === "") throw new Error("scenario-matrix: work_item_id is required (a scenario result without a work-item identity is non-emittable)");
  if (!DISPOSITION_SET.has(r.disposition)) throw new Error(`scenario-matrix: disposition ${JSON.stringify(r.disposition)} not in {${DISPOSITIONS.join(",")}}`);
  if (r.disposition_basis === null || typeof r.disposition_basis !== "object" || Array.isArray(r.disposition_basis)) {
    throw new Error("scenario-matrix: disposition_basis must be a JSON object");
  }

  // 4. the two-custodian split is asserted true on every row.
  if (r.two_custodian_split_verified !== true) throw new Error("scenario-matrix: two_custodian_split_verified must be true on every row");

  // 5. one_shot_control non-null IFF ordinal in {2,3,5,6}.
  const isCatch = CATCH_ORDINALS.has(r.scenario_ordinal);
  const hasControl = r.one_shot_control !== null && r.one_shot_control !== undefined;
  if (isCatch !== hasControl) {
    throw new Error(`scenario-matrix: one_shot_control must be non-null iff scenario_ordinal in {2,3,5,6} (ordinal ${r.scenario_ordinal}, control ${hasControl ? "present" : "null"})`);
  }
  let one_shot_control = null;
  if (hasControl) {
    const c = r.one_shot_control;
    if (c === null || typeof c !== "object" || Array.isArray(c)) throw new Error("scenario-matrix: one_shot_control must be an object or null");
    if (c.ungoverned_shipped !== true) throw new Error("scenario-matrix: a catch-scenario one_shot_control must record ungoverned_shipped: true (a control that refuses is not a genuine catch)");
    if (typeof c.artifact_ref !== "string" || c.artifact_ref === "") throw new Error("scenario-matrix: one_shot_control.artifact_ref must name what the ungoverned run shipped");
    if (!DISPOSITION_SET.has(c.governed_disposition)) throw new Error("scenario-matrix: one_shot_control.governed_disposition must be a Disposition");
    one_shot_control = { ungoverned_shipped: true, artifact_ref: c.artifact_ref, governed_disposition: c.governed_disposition };
  }

  // 2. compute the assurance vector from the basis.
  const assurance_vector = computeAssuranceVector(r);

  // 3. honest-claim guard on the caller's claim_label.
  const claim_label = typeof r.claim_label === "string" ? r.claim_label : "";
  if (claimImpliesEB(claim_label) && r.disposition !== "blocked") {
    throw new Error("scenario-matrix: claim_label implies E-B prevention but disposition is not blocked (E-B is claimable only at the merge chokepoint)");
  }
  // Non-repudiation is never claimable at J-C or weaker (symmetric HMAC / self-declared), and in
  // Phase 0 the journal_class is always J-C or J-D — so a non-repudiation claim on ANY row is an
  // overstatement, not only on a row carrying a producer leg (the J-D gap).
  if (claimImpliesNonRepudiation(claim_label) && JOURNAL_RANK[assurance_vector.journal_class] >= JOURNAL_RANK["J-C"]) {
    throw new Error(`scenario-matrix: claim_label implies non-repudiation but journal_class is ${assurance_vector.journal_class} (non-repudiation needs asymmetric producer signing, absent in Phase 0; producer HMAC is J-C mechanical detection at best)`);
  }
  // The label may not advertise a stronger journal class than the vector the oracle computed.
  const namedJournal = claimJournalClass(claim_label);
  if (namedJournal && JOURNAL_RANK[namedJournal] < JOURNAL_RANK[assurance_vector.journal_class]) {
    throw new Error(`scenario-matrix: claim_label names journal class ${namedJournal} but the computed vector is ${assurance_vector.journal_class} (a label may never exceed its assurance vector)`);
  }

  // 6. the frozen record — field order is stable so matrix.jsonl serialises deterministically.
  const record = {
    schema: SCHEMA,
    scenario_id: r.scenario_id,
    scenario_ordinal: r.scenario_ordinal,
    inputs: (r.inputs && typeof r.inputs === "object") ? r.inputs : {},
    environment: (r.environment && typeof r.environment === "object") ? r.environment : {},
    run_id: r.run_id,
    work_item_id: r.work_item_id,
    disposition: r.disposition,
    disposition_basis: r.disposition_basis,
    evidence_paths: Array.isArray(r.evidence_paths) ? r.evidence_paths.slice() : [],
    human_interventions: Number.isInteger(r.human_interventions) ? r.human_interventions : 0,
    cost: (r.cost && typeof r.cost === "object") ? r.cost : {},
    assurance_vector,
    claim_label,
    one_shot_control,
    two_custodian_split_verified: true,
  };
  return deepFreeze(record);
}

// --- the deterministic report renderer ----------------------------------------------------
// renderReport(records) → the REPORT.md string, records sorted by scenario_ordinal. A pure
// function of the records: no timestamps, no randomness, no environment reads.
function renderReport(records) {
  const rows = (Array.isArray(records) ? records.slice() : []).sort((a, b) => a.scenario_ordinal - b.scenario_ordinal);
  // Markdown-table cell safety: a literal pipe or newline in free-text (claim_label, artifact_ref,
  // scenario_id) would corrupt the table, so escape pipes and flatten newlines in every dynamic cell.
  const cell = (v) => String(v == null ? "" : v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const controlCell = (c) => (c ? `shipped: ${cell(c.artifact_ref)}` : "—");
  const lines = [];
  lines.push("# Phase 0 reference matrix — nine-scenario assurance bank");
  lines.push("");
  lines.push("Rendered by `faff scenario-matrix render` from `matrix.jsonl`. Deterministic: a pure function of the banked records, sorted by scenario ordinal. Regenerate, never hand-edit.");
  lines.push("");
  lines.push("| # | scenario_id | disposition | journal | effect | isolation | review | two-custodian split | one-shot control | claim_label |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const av = r.assurance_vector || {};
    lines.push(`| ${r.scenario_ordinal} | ${cell(r.scenario_id)} | ${cell(r.disposition)} | ${cell(av.journal_class)} | ${cell(av.effect_class)} | ${cell(av.isolation)} | ${cell(av.review)} | ${r.two_custodian_split_verified ? "verified" : "NOT verified"} | ${controlCell(r.one_shot_control)} | ${cell(r.claim_label)} |`);
  }
  lines.push("");
  lines.push("## Assurance notes");
  lines.push("");
  lines.push("- `organisational_independence` is false on every row — Phase 0 runs under one maintainer, so independence is proved as key-custody mechanism only, never inferred as organisational separation.");
  lines.push("- `effect_class` is E-B only where the disposition is `blocked` (the merge chokepoint's seeded refusal); every other row is E-C or weaker.");
  lines.push("- Producer HMAC authentication is journal class J-C — mechanical, record-granularity forgery detection, never non-repudiation.");
  lines.push("- Negative and null outcomes stay banked: `blocked` / `refused` / `denied` / `detected` are positive results, and `one_shot_control` is null on ordinals 1, 4, 7, 8, 9.");
  lines.push("");
  return lines.join("\n");
}

// --- CLI shell ----------------------------------------------------------------------------

const SCENARIO_MATRIX_SPEC = {
  flags: { "--in": { arity: 1 }, "--selftest": { arity: 0 } },
  positionals: { min: 0, max: 2, name: "matrix-path" },
};
const SCENARIO_MATRIX_SURFACE = {
  kind: "subcommand_dispatch",
  spec: SCENARIO_MATRIX_SPEC,
  subcommands: {
    record: { required_flags: [] },
    render: { required_flags: [] },
  },
};

function readJsonLines(text) {
  return text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

function cmdScenarioMatrix(args) {
  if (args.includes("--selftest")) return scenarioMatrixSelftest();
  const parsed = parseArgs(args, SCENARIO_MATRIX_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff scenario-matrix record | render [MATRIX.jsonl | --in FILE]   (record: scenario-result JSON on stdin → ScenarioRecord JSON on stdout)");
  const sub = parsed.positionals[0];
  if (sub === "record") {
    let raw;
    try { raw = fs.readFileSync(0, "utf8"); }
    catch { process.stderr.write("faff scenario-matrix record: cannot read scenario-result JSON from stdin\n"); return 2; }
    let scenarioResult;
    try { scenarioResult = JSON.parse(raw); }
    catch (e) { process.stderr.write(`faff scenario-matrix record: malformed scenario-result JSON — ${e.message}\n`); return 2; }
    let record;
    try { record = buildScenarioRecord(scenarioResult); }
    catch (e) { process.stderr.write(`faff scenario-matrix record: ${e.message}\n`); return 2; }
    process.stdout.write(JSON.stringify(record) + "\n");
    return 0;
  }
  if (sub === "render") {
    const src = parsed.values["--in"] !== undefined ? parsed.values["--in"] : parsed.positionals[1];
    if (src === undefined) { process.stderr.write("faff scenario-matrix render: a matrix.jsonl path is required (positional or --in FILE)\n"); return 2; }
    let raw;
    try { raw = fs.readFileSync(src, "utf8"); }
    catch (e) { process.stderr.write(`faff scenario-matrix render: cannot read ${src} — ${e.message}\n`); return 2; }
    let records;
    try { records = readJsonLines(raw); }
    catch (e) { process.stderr.write(`faff scenario-matrix render: ${src} is not valid JSONL — ${e.message}\n`); return 2; }
    process.stdout.write(renderReport(records));
    return 0;
  }
  process.stderr.write("usage: faff scenario-matrix record | render [MATRIX.jsonl | --in FILE]\n");
  return 2;
}

// In-memory selftest: the pure emitter's honest-claim guards + a render round trip. Host-safe
// (no fs writes), so `regions selftest` can run it.
function scenarioMatrixSelftest() {
  let failed = 0;
  const fail = (m) => { process.stderr.write(`scenario-matrix selftest FAIL: ${m}\n`); failed++; };
  const throws = (fn, label) => { let threw = false; try { fn(); } catch { threw = true; } if (!threw) fail(label); };

  const base = (over) => ({
    scenario_id: "01-normal-completion", scenario_ordinal: 1, inputs: {}, environment: {},
    run_id: "RUN-COM-01", work_item_id: "FAFF-1", disposition: "accepted",
    disposition_basis: { audit_verify: { exit: 0, producer: { verified: 1, unverifiable_without_secret: 0, failed: 0 }, decisions_valid: true } },
    evidence_paths: ["declared-effects.jsonl"], human_interventions: 0, cost: {},
    claim_label: "J-C mechanical auth; E-C detection", one_shot_control: null, two_custodian_split_verified: true,
    ...over,
  });

  // a clean accepted row builds, is frozen, and carries the computed vector
  const rec1 = buildScenarioRecord(base());
  if (rec1.schema !== 1) fail("schema is 1");
  if (rec1.assurance_vector.journal_class !== "J-C") fail("a verified producer leg computes J-C");
  if (rec1.assurance_vector.effect_class !== "E-C") fail("accepted → E-C");
  if (rec1.assurance_vector.independence.organisational_independence !== false) fail("organisational_independence is false");
  if (!Object.isFrozen(rec1)) fail("the record is frozen");

  // a blocked row computes E-B and carries a control
  const rec2 = buildScenarioRecord(base({ scenario_id: "02-governance-block", scenario_ordinal: 2, disposition: "blocked",
    disposition_basis: { floor_verdict: { verdict: "refuse", blockers: ["x"] }, commissaire_verdict: { verdict: "refuse", reason: "decision-signature-invalid" } },
    claim_label: "E-B prevention at the merge chokepoint",
    one_shot_control: { ungoverned_shipped: true, artifact_ref: "merged main", governed_disposition: "blocked" } }));
  if (rec2.assurance_vector.effect_class !== "E-B") fail("blocked → E-B");

  // a parked row is E-D
  const rec7 = buildScenarioRecord(base({ scenario_id: "07-exhausted-budget", scenario_ordinal: 7, disposition: "parked",
    disposition_basis: { budget_outcome: "park-until-window-reset" }, claim_label: "budget park" }));
  if (rec7.assurance_vector.effect_class !== "E-D") fail("parked → E-D");

  // honest-claim guards throw
  throws(() => buildScenarioRecord(base({ claim_label: "E-B prevention" })), "E-B label on a non-blocked row throws");
  throws(() => buildScenarioRecord(base({ claim_label: "non-repudiation of the producer record" })), "non-repudiation on a producer leg throws");
  // the widened journal-dimension guard: non-repudiation on a J-D self-declared row also throws
  throws(() => buildScenarioRecord(base({ scenario_id: "05-stale-evidence", scenario_ordinal: 5, disposition: "denied",
    disposition_basis: { commissaire_verdict: { verdict: "deny", reason: "stale-evidence" } },
    claim_label: "non-repudiation of a self-declared record",
    one_shot_control: { ungoverned_shipped: true, artifact_ref: "acted on stale evidence", governed_disposition: "denied" } })),
    "non-repudiation on a J-D row throws (the journal-dimension gap)");
  // a label naming a stronger journal class than the computed vector throws (J-D row labelled J-C)
  throws(() => buildScenarioRecord(base({ scenario_id: "05-stale-evidence", scenario_ordinal: 5, disposition: "denied",
    disposition_basis: { commissaire_verdict: { verdict: "deny", reason: "stale-evidence" } },
    claim_label: "J-C mechanical detection of stale evidence",
    one_shot_control: { ungoverned_shipped: true, artifact_ref: "acted on stale evidence", governed_disposition: "denied" } })),
    "a J-D row whose label names J-C throws (label exceeds the journal dimension)");
  // but a J-D row honestly labelled J-D builds fine
  buildScenarioRecord(base({ scenario_id: "05-stale-evidence", scenario_ordinal: 5, disposition: "denied",
    disposition_basis: { commissaire_verdict: { verdict: "deny", reason: "stale-evidence" } },
    claim_label: "J-D self-declared; E-C detection of stale evidence",
    one_shot_control: { ungoverned_shipped: true, artifact_ref: "acted on stale evidence", governed_disposition: "denied" } }));
  throws(() => buildScenarioRecord(base({ two_custodian_split_verified: false })), "two-custodian split not verified throws");
  throws(() => buildScenarioRecord(base({ scenario_ordinal: 1, one_shot_control: { ungoverned_shipped: true, artifact_ref: "x", governed_disposition: "accepted" } })), "one_shot_control on a non-catch ordinal throws");
  throws(() => buildScenarioRecord(base({ scenario_id: "05-stale-evidence", scenario_ordinal: 5, disposition: "denied", one_shot_control: null })), "missing one_shot_control on a catch ordinal throws");
  throws(() => buildScenarioRecord(base({ run_id: "" })), "missing run_id throws");
  throws(() => buildScenarioRecord(base({ work_item_id: "" })), "missing work_item_id throws");

  // render is deterministic and sorts by ordinal
  const r1 = renderReport([rec7, rec2, rec1]);
  const r2 = renderReport([rec1, rec2, rec7]);
  if (r1 !== r2) fail("renderReport is order-independent (sorts by ordinal)");
  if (!/\| 1 \| 01-normal-completion \|/.test(r1)) fail("render includes the accepted row");
  if (!/E-B/.test(r1)) fail("render retains the blocked row's E-B");

  // a pipe in a free-text cell is escaped (rendered as \| so a markdown reader keeps it in-cell,
  // never as a column separator) and no raw unescaped pipe survives in the cell text
  const recPipe = buildScenarioRecord(base({ claim_label: "J-C auth | E-C detection" }));
  const dataRow = renderReport([recPipe]).split("\n").find((l) => /^\| 1 \|/.test(l));
  if (!dataRow || !dataRow.includes("J-C auth \\| E-C detection")) fail("a pipe in claim_label is escaped as \\| in the cell");

  if (failed) return 1;
  console.log("scenario-matrix selftest: ok");
  return 0;
}

module.exports = {
  SCHEMA, DISPOSITIONS, DISPOSITION_SET, JOURNAL_CLASSES, EFFECT_CLASSES, CATCH_ORDINALS,
  SCENARIO_RECORD_REQUIRED_FIELDS, SCENARIO_MATRIX_SPEC, SCENARIO_MATRIX_SURFACE,
  claimImpliesEB, claimImpliesNonRepudiation, claimJournalClass, computeAssuranceVector,
  buildScenarioRecord, renderReport, cmdScenarioMatrix, scenarioMatrixSelftest,
};
