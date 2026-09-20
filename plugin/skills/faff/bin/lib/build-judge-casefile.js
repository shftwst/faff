// ===========================================================================
// === region:factory — build-judge-casefile — FAFF-996: per-finding case-file assembler + admit roll-up ===
//
// The build-side sibling of `spec-judge-casefile.js`'s `assemble`/`admitRollup`, ported one
// altitude down to the build-review dialogue's would-be-park point (FAFF-996). Owns the two
// DETERMINISTIC seams the build-judge pass needs (the model call is only the per-finding
// adjudication, dispatched by `build-judge-evidence.js`):
//
//   assembleBuildCaseFiles() — atomise the criticals requiring adjudication 1:1 into blinded,
//                 scrubbed `BuildJudgeCaseFile`s (Argument A = the independent reviewer's
//                 finding, Argument B = the author's last rebuttal for that finding, or a
//                 labelled null-defence when there is none), order coin-swapped, plus one
//                 out-of-band `ledger.json` (mode 0600).
//
//   admitBuildRollup() — after every case has a ruling (or a parked marker), roll the ledger
//                 up to a deterministic AdmitResult. The judge never asserts admission; the
//                 ONE floor (critical-free-latest, p-17) vetoes over the top and fails CLOSED
//                 on a missing/degraded input. No L4/PRD/infosec floors — those are spec-side
//                 only (OUT OF SCOPE per the spec).
//
// Imports the generic blinding/scrub primitives from `./adversarial-judge-scrub` — NEVER from
// `./spec-judge-casefile` (a build-to-spec require would be the wrong-way dependency the
// FAFF-996 extraction exists to avoid; see the spec's ratified Punt 2 ruling).
//
// Determinism-first: no model call anywhere in this module. Every transform (scrub, path
// confinement, order seed, roll-up arithmetic) is a pure function.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  orderSeed,
  coinSwap,
  scrubSpecField,
  secretRedact,
  hasDiffMarkers,
} = require("./adversarial-judge-scrub");

// The sentinel argument_B carries when the author never rebutted a still-standing critical
// (it can still reach the would-be-park point via the churn/convergence/cap stops, p-05/HOW).
const NULL_DEFENCE_CLAIM = "(the author did not rebut this finding)";

function caseId(i) { return `f-${String(i + 1).padStart(2, "0")}`; }

// --- diff extraction (bounded, best-effort file-scoped hunk slice) ---------

// extractDiffForFile(diffText, filePath) -> the unified-diff block(s) whose `diff --git a/<p>
// b/<p>` header names filePath, or the WHOLE (bounded) diff when filePath is empty/unmatched —
// never a model call, never a semantic re-parse. Bounded to DIFF_SLICE_MAX_BYTES so a pathological
// diff never blows the case-file budget.
const DIFF_SLICE_MAX_BYTES = 20000;
function extractDiffForFile(diffText, filePath) {
  const text = String(diffText || "");
  if (!filePath) return text.slice(0, DIFF_SLICE_MAX_BYTES);
  const blocks = text.split(/(?=^diff --git )/m).filter(Boolean);
  const matches = blocks.filter((b) => {
    const header = b.split("\n", 1)[0] || "";
    return header.includes(filePath);
  });
  if (!matches.length) return text.slice(0, DIFF_SLICE_MAX_BYTES);
  return matches.join("\n").slice(0, DIFF_SLICE_MAX_BYTES);
}

// --- scrub fixpoint + diff-marker gate --------------------------------------

// safeScrub(text, { allowDiffMarkers }) -> { ok, text } | { ok:false, cause }
//   - applies scrubSpecField (imperativeScrub∘secretRedact); a residual directive detected by a
//     SECOND application (the scrub must be a fixpoint) parks the field.
//   - a non-diff field that trips hasDiffMarkers (an injected unified-diff header where none
//     belongs) parks the field. `relevant_diff` is the one field this check is skipped for — it
//     is EXPECTED to carry diff markers.
function safeScrub(text, { allowDiffMarkers = false } = {}) {
  const raw = typeof text === "string" ? text : "";
  const once = scrubSpecField(raw);
  const twice = scrubSpecField(once);
  if (twice !== once) return { ok: false, cause: "residual directive after a second scrub pass (not a fixpoint)" };
  if (!allowDiffMarkers && hasDiffMarkers(once)) return { ok: false, cause: "injected unified-diff header in a non-diff field" };
  return { ok: true, text: once };
}

// --- assemble ---------------------------------------------------------------

// assembleBuildCaseFiles({ criticalsToAdjudicate, diffText, acceptanceCriteria, runId,
//   windowStart, repositoryEvidenceText }) -> { caseFiles: {case_id: caseFile}, ledger, parked }
//   criticalsToAdjudicate — array of:
//     { finding_id, location, title, reviewer_claim, reviewer_evidence, rebuttal_text,
//       requires_confirm }
//     (still-standing criticals AND rebuttal-driven withdrawals awaiting confirmation, per the
//     PROCEDURE build_judge's `adjudicate` set — see the spec's HOW section)
//   diffText              — the captured review diff (unified-diff text)
//   acceptanceCriteria    — the ticket AC / spec DoD (governing requirements)
//   repositoryEvidenceText — bounded, path-confined file facts the caller has already gathered
//                            (assembly here never re-walks the filesystem — that stays the
//                            caller's concern, mirroring the spec side's gatherRepositoryEvidence
//                            being a SEPARATE step from case-file scrubbing)
function assembleBuildCaseFiles(opts) {
  const {
    criticalsToAdjudicate = [], diffText = "", acceptanceCriteria = "",
    runId = "run", windowStart = 1, repositoryEvidenceText = "",
  } = opts || {};

  const caseFiles = {};
  const ledgerEntries = {};
  const order = [];
  const parked = [];

  criticalsToAdjudicate.forEach((finding, i) => {
    const cid = caseId(i);
    const findingId = finding && typeof finding.finding_id === "string" ? finding.finding_id : "";
    const location = finding && typeof finding.location === "string" ? finding.location : "";
    const title = finding && typeof finding.title === "string" ? finding.title : "";
    const reviewerClaim = finding && typeof finding.reviewer_claim === "string" && finding.reviewer_claim.trim() ? finding.reviewer_claim : title;
    const reviewerEvidence = finding && typeof finding.reviewer_evidence === "string" && finding.reviewer_evidence.trim()
      ? finding.reviewer_evidence
      : `finding at ${location || "(no location given)"}`;
    const hasRebuttal = finding && typeof finding.rebuttal_text === "string" && finding.rebuttal_text.trim().length > 0;
    const requiresConfirm = !!(finding && finding.requires_confirm);
    const filePath = (location || "").split(":")[0];

    // Scrub every field individually; a single field failing the fixpoint/diff-marker gate parks
    // the WHOLE finding (never a partial/unsafe case file).
    const fields = {
      acceptance_criteria: safeScrub(acceptanceCriteria),
      relevant_diff: safeScrub(extractDiffForFile(diffText, filePath), { allowDiffMarkers: true }),
      repository_evidence: safeScrub(repositoryEvidenceText || "no repository evidence cited"),
      argA_claim: safeScrub(reviewerClaim),
      argA_evidence: safeScrub(reviewerEvidence),
      argB_claim: safeScrub(hasRebuttal ? finding.rebuttal_text : NULL_DEFENCE_CLAIM),
    };
    const failed = Object.entries(fields).find(([, v]) => !v.ok);
    order.push(cid);
    if (failed) {
      parked.push(findingId);
      ledgerEntries[cid] = {
        case_id: cid,
        finding_id: findingId,
        severity: "critical",
        blocking: true,
        requires_confirm: requiresConfirm,
        argument_A_source: "reviewer:independent",
        argument_B_source: hasRebuttal ? "author:rebuttal" : "author:none",
        order_seed: orderSeed(runId, windowStart, cid),
        pre_ruling_diff_sha: "",
        ruling: null,
        resolution: "parked",
        park_cause: `scrub failure on ${failed[0]}: ${failed[1].cause}`,
      };
      return;
    }

    const proposition = `Is finding "${title}" on this diff a material defect?`;
    const argA = { claim: fields.argA_claim.text, evidence: fields.argA_evidence.text, predicted_consequence: "" };
    const argB = { claim: fields.argB_claim.text, evidence: "", predicted_consequence: "" };

    const seed = orderSeed(runId, windowStart, cid);
    const swap = coinSwap(seed);
    const refuterSource = "reviewer:independent";
    const authorSource = hasRebuttal ? "author:rebuttal" : "author:none";
    const presentedA = swap ? { triple: argB, source: authorSource } : { triple: argA, source: refuterSource };
    const presentedB = swap ? { triple: argA, source: refuterSource } : { triple: argB, source: authorSource };

    caseFiles[cid] = {
      case_id: cid,
      finding_id: findingId,
      reconstruction_context: {
        acceptance_criteria: fields.acceptance_criteria.text,
        relevant_diff: fields.relevant_diff.text,
        repository_evidence: fields.repository_evidence.text,
        proposition: scrubSpecField(proposition),
      },
      arguments: {
        argument_A: presentedA.triple,
        argument_B: presentedB.triple,
      },
    };

    ledgerEntries[cid] = {
      case_id: cid,
      finding_id: findingId,
      severity: "critical",
      blocking: true,
      requires_confirm: requiresConfirm,
      argument_A_source: presentedA.source,
      argument_B_source: presentedB.source,
      order_seed: seed,
      pre_ruling_diff_sha: sha256Text(diffText),
      ruling: null,
      resolution: "pending",
    };
  });

  return {
    caseFiles,
    ledger: { order, entries: ledgerEntries, run_id: runId, window_start: windowStart },
    parked,
  };
}

function sha256Text(text) {
  return require("node:crypto").createHash("sha256").update(String(text || "")).digest("hex");
}

// --- admit roll-up ------------------------------------------------------------

// admitBuildRollup({ ledger, rulings, floors }) -> AdmitResult
//   ledger  — { order:[case_id], entries:{case_id: BuildJudgeLedgerEntry} }
//   rulings — { case_id: BuildJudgeVerdict | null } (null/missing -> the caller must have
//             recorded resolution:"parked" on the ledger entry; a listed case_id with no
//             ruling AND no parked marker is fail-loud, thrown for the CLI layer to map to exit 2)
//   floors  — { critical_free_latest }: tri-state — true (pass) / false (fired) / null (degraded
//             -> fails CLOSED). The v1 floor set is minimal (p-17): ONE floor, derived by the
//             CLI layer from the last dialogue round record.
// Throws { failLoud: msg } for a missing ruling on a non-parked listed case_id.
function admitBuildRollup(opts) {
  const { ledger, rulings = {}, floors = {} } = opts || {};
  const order = (ledger && Array.isArray(ledger.order)) ? ledger.order : [];
  const entries = (ledger && ledger.entries) || {};

  const resolved = [];
  const unresolved = [];
  const parked = [];
  const product_boundary = [];
  const floor_veto = [];

  for (const cid of order) {
    const entry = entries[cid];
    if (!entry) throw { failLoud: `ledger lists ${cid} but has no entry for it` };
    const resolution = entry.resolution;
    const ruling = rulings[cid];

    if (resolution === "parked") {
      unresolved.push(cid);
      parked.push(cid);
      continue;
    }
    if (ruling == null) throw { failLoud: `no ruling for listed finding ${cid} (and it is not marked parked)` };

    const outcome = ruling.outcome;
    if (outcome === "OVERTURN") {
      resolved.push(cid);
    } else if (outcome === "PRODUCT_BOUNDARY") {
      product_boundary.push(cid);
      unresolved.push(cid);
    } else if (outcome === "UPHOLD") {
      unresolved.push(cid);
    } else {
      // A non-conformant / unexpected outcome that slipped past the contract -> unresolved (safe).
      unresolved.push(cid);
    }
  }

  // Every blocking (severity==critical) finding resolved (OVERTURN)? No PRODUCT_BOUNDARY
  // anywhere? No blocking finding parked? The quantifier is universal — a single OVERTURN
  // among several standing criticals never admits if any sibling is UPHOLD/PRODUCT_BOUNDARY/
  // parked (p-16).
  const blockingUnresolved = unresolved.filter((cid) => entries[cid] && entries[cid].blocking && !parked.includes(cid));
  const blockingParked = parked.filter((cid) => entries[cid] && entries[cid].blocking);
  const everyBlockingResolved = blockingUnresolved.length === 0 && blockingParked.length === 0;

  // The critical-free-latest floor (p-17) — evaluated `=== true` so a null/degraded input fails
  // CLOSED (veto). The CLI layer computes this from the last dialogue round record; this module
  // never re-derives it (determinism-first — no fs walk of round records here).
  let floorPass = true;
  if (floors.critical_free_latest !== true) {
    floorPass = false;
    floor_veto.push(floors.critical_free_latest === false ? "critical_not_overturned" : "floor_input_degraded");
  }

  const admit = everyBlockingResolved && product_boundary.length === 0 && floorPass;

  return { admit, resolved, unresolved, parked, product_boundary, floor_veto };
}

module.exports = {
  NULL_DEFENCE_CLAIM,
  caseId,
  extractDiffForFile,
  safeScrub,
  assembleBuildCaseFiles,
  sha256Text,
  admitBuildRollup,
};
