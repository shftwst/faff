// ===========================================================================
// === region:factory — spec-judge-casefile — FAFF-930: per-proposition case-file assembler + admit roll-up ===
//
// FAFF-930 reshapes FAFF-922's review-level weighing judge into a blinded, two-phase,
// per-proposition case-file ADJUDICATOR. This module owns the two DETERMINISTIC seams
// (the model call is only the per-proposition adjudication, done by faff-prep's dispatch):
//
//   assemble()  — atomise the standing residue 1:1 into propositions; for each, build one
//                 blinded, judge-facing case file (governing requirements, a clean spec-
//                 section snapshot, bounded + secret-redacted repository evidence, a
//                 DETERMINISTIC-TEMPLATE proposition, and the two anonymised arguments A/B
//                 in a randomised order) plus one out-of-band ledger entry (the un-blinding
//                 key, retained lens tag, reputation annotation, stable anchor, seeds, and
//                 the retained pre-correction spec content). The ledger is written 0600.
//
//   admitRollup() — after every proposition has a ruling (or a parked marker) and any
//                 correction has been applied, roll the resolved ledger up to a deterministic
//                 AdmitResult { admit, level, resolved[], unresolved[], parked[], prd_boundary[],
//                 minor_corrections_applied[]/unapplied[], floor_veto[] }. The judge never
//                 asserts admission. Floors veto over the top; a null/degraded floor input
//                 fails CLOSED. The L4-ratification gate is the roll-up's HALF of the two-part
//                 L4-final gate (the merge-time governance-check is the other half).
//
// Determinism-first: no model call anywhere in this module. Every transform (scrub, redact,
// path confinement, anchor lookup, order seed, roll-up arithmetic) is a pure function.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { headingSlug, headingText } = require("./heading-slug");
const { verifyChain } = require("./events");

// --- constants ------------------------------------------------------------

// The per-section floor the reconstruction-validation gate (faff-prep) enforces; exported so
// the dispatch and its tests read one source.
const RECONSTRUCTION_MIN_SECTION_CHARS = 40;
// The four reconstruction section keys Phase 1 must emit (the fixed Phase-1/validation contract).
const RECONSTRUCTION_SECTION_KEYS = ["requirements_invariants", "existing_behaviour", "valid_solution_properties", "undeterminable_facts"];
// A correction's verification literal floor (contract-enforced too — kept in step here for the
// assemble-side smoke and the correction-applied doc).
const CORRECTION_VERIFICATION_MIN = 24;
// The taste-level sentinel the FAFF-935 triple carries when a lens gives no predicted consequence.
const NOT_SEPARATELY_STATED = "not separately stated";

// The deterministic per-lens DOMAIN phrase the proposition template names (round-8 operator fold).
// The domain is legible by design — the judge weighs a security argument as a security one — so
// naming it in the proposition is consistent with the blind (which strips AUTHORITY, not domain).
const LENS_DOMAIN = {
  architectural: "software architecture and design",
  infosec: "security",
  methodology: "delivery methodology and right-sizing",
  QA: "testing and quality assurance",
};
// The fixed fallback anchor token when an objection carries no spec_anchor.
const PROPOSITION_ANCHOR_FALLBACK = "the disputed decision";

// The content-level no-leak scrub list (best-effort over a maintained list, layered on the hard
// structural field-absence). The four lens labels + their domain-authority synonyms.
const LENS_SCRUB_TOKENS = [
  "architectural", "infosec", "methodology", "QA",
  "security", "secure", "vulnerability", "threat",
  "test coverage", "right-sizing", "process", "architecture", "design",
];
// The enumerated authority-phrase list (whole-phrase, case-insensitive) the scrub removes.
const AUTHORITY_PHRASES = [
  "as a security concern", "as an architect", "from a security standpoint",
  "the reviewer", "the refuter", "the objecting lens", "my lens", "this objection",
  "a blocker", "a major objection", "a minor objection", "critical severity",
];
// The enumerated directive-prose list the imperative-scrub removes (case-insensitive; a matched
// sentence/line is dropped). A fixed list so the scrub unit test is decidable.
const DIRECTIVE_PHRASES = [
  "ignore previous instructions", "ignore prior instructions", "disregard the above",
  "rule affirm_spec", "return affirm_spec", "you must accept", "you must affirm",
  "you must approve", "accept this", "affirm this", "approve this", "do not uphold",
  "override the objection", "treat this as approved", "the correct ruling is",
];

// Best-effort secret redaction over a known-pattern list. Order matters (broad PEM/base64 last).
const SECRET_PATTERNS = [
  /-----BEGIN[A-Z ]*(?:PRIVATE KEY|CERTIFICATE|RSA PRIVATE KEY)-----[\s\S]*?-----END[A-Z ]*-----/g, // PEM block
  /AKIA[0-9A-Z]{16}/g,                                              // AWS access key id
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,                          // bearer token
  /(?:password|passwd|token|api[_-]?key|secret|access[_-]?key)\s*[=:]\s*["']?[^\s"'#]{8,}/gi, // k=v secrets
  /"(?:api[_-]?key|token|secret|password|access[_-]?key)"\s*:\s*"[^"]{8,}"/gi, // JSON "api_key":"…"
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,                                 // long base64 blob
];
const REDACTED = "[redacted]";

// Repo-relative path refuse patterns (dotfiles, env, key/secret path shapes). A path whose
// realpath escapes the repo root is ALSO refused (checked separately in gatherRepositoryEvidence).
const REFUSE_PATH_RE = [
  /(^|\/)\.[^/]+/,        // any dotfile / dotdir component (.env, .ssh, .git, …)
  /\.pem$/i, /\.key$/i, /(^|\/)id_rsa/i, /(^|\/)credentials/i,
  /(^|\/)\.env/i,
];

// --- pure scrubs ----------------------------------------------------------

// Escape a literal for use in a RegExp.
function reEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Content-level no-leak scrub: strip lens labels, domain-authority synonyms, and authority
// phrases from ARGUMENT prose. Best-effort over the maintained list, never claimed absolute.
function lensScrub(text) {
  if (typeof text !== "string" || text === "") return text || "";
  let out = text;
  // Whole authority phrases first (longer matches), then single tokens (whole-word).
  for (const phrase of AUTHORITY_PHRASES) {
    out = out.replace(new RegExp(reEscape(phrase), "gi"), "[scrubbed]");
  }
  for (const tok of LENS_SCRUB_TOKENS) {
    // Whole-word / whole-phrase, case-insensitive. `QA` is caught case-insensitively too.
    out = out.replace(new RegExp(`\\b${reEscape(tok)}\\b`, "gi"), "[scrubbed]");
  }
  return out;
}

// Imperative-scrub: remove any sentence/line carrying an enumerated directive phrase. Content-
// stripping only (no semantic rewrite, no model call) — it cannot alter the substantive claims.
function imperativeScrub(text) {
  if (typeof text !== "string" || text === "") return text || "";
  const hasDirective = (seg) => {
    const low = seg.toLowerCase();
    return DIRECTIVE_PHRASES.some((d) => low.includes(d));
  };
  const lines = text.split("\n");
  const keptLines = [];
  for (const line of lines) {
    if (!hasDirective(line)) { keptLines.push(line); continue; }
    // Line carries a directive — drop only the offending sentence(s), keep the rest.
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((s) => !hasDirective(s));
    keptLines.push(kept.join(" "));
  }
  return keptLines.join("\n");
}

// Best-effort secret redaction over the known-pattern list.
function secretRedact(text) {
  if (typeof text !== "string" || text === "") return text || "";
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

// Every judge-facing text field passes through secret redaction. Argument prose ALSO gets the
// content-level lens scrub. Both get the imperative scrub (they enter a model call).
function scrubArgumentField(text) { return imperativeScrub(lensScrub(secretRedact(text))); }
// Spec content / proposition / governing requirements: imperative-scrub + secret-redact, but NOT
// the lens scrub (the domain is legible by design in these fields; only ARGUMENT prose is blinded).
function scrubSpecField(text) { return imperativeScrub(secretRedact(text)); }

// The unambiguous unified-diff signatures — a `@@ ` hunk header or a `+++ `/`--- ` file header.
// A bare leading `-`/`+` is a legitimate markdown bullet or sign and must NOT trip.
function hasDiffMarkers(text) {
  if (typeof text !== "string") return false;
  return /(^|\n)(@@ |\+\+\+ |--- )/.test(text);
}

// --- proposition template (round-8 operator fold) -------------------------

// The DETERMINISTIC proposition template, built with no model call from the objection's
// spec_anchor and its retained lens-domain. Defensively secret-redacted (a slug cannot carry an
// imperative, so the imperative-scrub is a no-op here, but it is applied for uniformity).
function buildProposition(objection) {
  const anchorRaw = objection && typeof objection.spec_anchor === "string" && objection.spec_anchor.trim()
    ? objection.spec_anchor.trim()
    : PROPOSITION_ANCHOR_FALLBACK;
  const domain = (objection && LENS_DOMAIN[objection.lens]) || "the decision";
  const template = `Is the decision at ${anchorRaw} sound with respect to ${domain}?`;
  return scrubSpecField(template);
}

// --- spec heading index + Argument B --------------------------------------

// Index the spec's headings by slug → { slug, heading, start, end, body }. The body is the text
// from just after the heading line to just before the next heading line (any level).
function buildSpecHeadingIndex(specText) {
  const lines = String(specText).split("\n");
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#+\s/.test(lines[i])) headings.push({ line: i, slug: headingSlug(headingText(lines[i])) });
  }
  const index = new Map(); // slug -> array of {bodyLines}
  for (let h = 0; h < headings.length; h++) {
    const start = headings[h].line + 1;
    const end = h + 1 < headings.length ? headings[h + 1].line : lines.length;
    const body = lines.slice(start, end).join("\n").trim();
    const slug = headings[h].slug;
    if (!index.has(slug)) index.set(slug, []);
    index.get(slug).push(body);
  }
  return index;
}

// Derive Argument B (the orchestrator's defence) for an anchor slug from the CURRENT spec.
// Returns { body, source } where source ∈ {chosen, undefended, anchor-lost}. `mode` selects the
// assemble-time semantics ("assemble": zero-match/absent → undefended) vs the dispatch re-derive
// semantics ("redispatch": a bound anchor whose heading is gone → anchor-lost).
function deriveArgumentB(specText, anchorSlug, mode) {
  const index = buildSpecHeadingIndex(specText);
  if (!anchorSlug) return { body: "", source: "orchestrator:undefended" };
  if (!index.has(anchorSlug)) {
    return mode === "redispatch"
      ? { body: "", source: "orchestrator:anchor-lost" }
      : { body: "", source: "orchestrator:undefended" };
  }
  const blocks = index.get(anchorSlug);
  // Multiple blocks under one heading slug are concatenated in document order (order-stable).
  const body = blocks.join("\n\n").trim();
  if (!body) return { body: "", source: "orchestrator:undefended" };
  return { body, source: "orchestrator:chosen" };
}

// Build the Argument B triple from its derived body/source, scrubbed like any argument.
function argumentBTriple(derived) {
  if (derived.source === "orchestrator:chosen") {
    return {
      claim: scrubArgumentField(derived.body),
      evidence: scrubArgumentField("the current spec's own Chosen:/Decision: rationale for the disputed decision"),
      predicted_consequence: NOT_SEPARATELY_STATED,
    };
  }
  // undefended / anchor-lost: a labelled null-defence.
  return {
    claim: "(the spec offers no argued defence for this proposition)",
    evidence: "",
    predicted_consequence: NOT_SEPARATELY_STATED,
  };
}

// --- Argument A (the refuter triple) --------------------------------------

function argumentATriple(objection) {
  const claim = scrubArgumentField(typeof objection.claim === "string" ? objection.claim : "");
  const evidence = scrubArgumentField(typeof objection.evidence === "string" ? objection.evidence : "");
  const pc = typeof objection.predicted_consequence === "string" && objection.predicted_consequence.trim()
    ? objection.predicted_consequence
    : NOT_SEPARATELY_STATED;
  return { claim, evidence, predicted_consequence: scrubArgumentField(pc) };
}

// --- repository evidence: path confinement + secret redaction -------------

// Extract repo-relative path-like tokens from an objection's evidence prose.
function extractPathTokens(evidenceText) {
  if (typeof evidenceText !== "string") return [];
  const out = new Set();
  // A path segment: one or more `dir/` components then a filename, or a bare `name.ext`.
  const re = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+|\b[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8}\b/g;
  let m;
  while ((m = re.exec(evidenceText)) !== null) out.add(m[0]);
  return [...out];
}

// Gather bounded repository evidence under path confinement (realpath must stay under repoRoot;
// dotfiles / .env / key / secret paths refused) + secret redaction. Returns { text, notes }.
function gatherRepositoryEvidence(objection, repoRoot) {
  const notes = [];
  const chunks = [];
  const root = realpathSafe(repoRoot);
  const tokens = extractPathTokens(objection && objection.evidence);
  for (const tok of tokens) {
    if (REFUSE_PATH_RE.some((re) => re.test(tok))) { notes.push(`refused refuse-list path ${tok}`); continue; }
    const candidate = path.resolve(root, tok);
    let real;
    try { real = fs.realpathSync(candidate); }
    catch { continue; } // not a real file — contributes nothing, no note (evidence prose is not all paths)
    // realpath-resolved target must stay under the repo root (symlink-escape refusal).
    if (real !== root && !real.startsWith(root + path.sep)) { notes.push(`refused escaping path ${tok} (realpath left the repo root)`); continue; }
    // Re-apply refuse-list to the RESOLVED repo-relative path (a symlink to .env inside the root).
    const rel = path.relative(root, real);
    if (REFUSE_PATH_RE.some((re) => re.test(rel))) { notes.push(`refused refuse-list target ${rel}`); continue; }
    let raw;
    try {
      const st = fs.statSync(real);
      if (!st.isFile()) continue;
      raw = fs.readFileSync(real, "utf8").slice(0, 2000);
    } catch { continue; }
    chunks.push(`# ${rel}\n${secretRedact(raw)}`);
  }
  const text = chunks.length ? chunks.join("\n\n") : "no repository paths cited in the objection evidence";
  return { text: scrubSpecField(text), notes };
}

// realpathSync that tolerates a non-existent path by resolving the nearest existing ancestor.
function realpathSafe(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

// --- blinding: order seed + coin flip -------------------------------------

function orderSeed(runId, windowStart, propositionId) {
  return crypto.createHash("sha256").update(`${runId}:${windowStart}:${propositionId}`).digest("hex");
}
// Deterministic coin flip from the seed: true → swap (orchestrator under label A). The seed is
// run-fixed and NOT operator/orchestrator-injectable (there is no --seed input).
function coinSwap(seed) {
  return parseInt(seed[0], 16) % 2 === 1;
}

// --- blocking / severity --------------------------------------------------

function blockingOf(severity) { return severity === "blocker" || severity === "major"; }

function propositionId(i) { return `p-${String(i + 1).padStart(2, "0")}`; }

// --- assemble -------------------------------------------------------------

// assemble({ standingObjections, specText, runId, windowStart, repoRoot, reputationFlagged,
//            servingIdentity, governingRequirements }) -> { caseFiles: {pid: caseFile}, ledger }
function assemble(opts) {
  const {
    standingObjections = [], specText = "", runId = "run", windowStart = 1,
    repoRoot = process.cwd(), reputationFlagged = [], servingIdentity = "unknown",
    governingRequirements = "",
  } = opts;

  const caseFiles = {};
  const ledgerEntries = {};
  const order = [];
  const specSha = sha256Text(specText);

  standingObjections.forEach((obj, i) => {
    const pid = propositionId(i);
    order.push(pid);
    const lens = obj && typeof obj.lens === "string" ? obj.lens : "";
    const severity = obj && typeof obj.severity === "string" ? obj.severity : "";
    const anchor = obj && typeof obj.spec_anchor === "string" && obj.spec_anchor.trim() ? headingSlug(obj.spec_anchor.trim()) : "";

    const refuterTriple = argumentATriple(obj || {});
    const bDerived = deriveArgumentB(specText, anchor, "assemble");
    const orchTriple = argumentBTriple(bDerived);
    const proposition = buildProposition(obj || {});

    const relevantSpecSections = scrubSpecField(bDerived.body || "(no bound spec section)");

    const repoEv = gatherRepositoryEvidence(obj || {}, repoRoot);

    // Randomise A/B order (blinding). The ledger records the un-blinding truth.
    const seed = orderSeed(runId, windowStart, pid);
    const swap = coinSwap(seed);
    const refuterSource = `refuter:${servingIdentity}`;
    const presentedA = swap ? { triple: orchTriple, source: bDerived.source } : { triple: refuterTriple, source: refuterSource };
    const presentedB = swap ? { triple: refuterTriple, source: refuterSource } : { triple: orchTriple, source: bDerived.source };

    const caseFile = {
      proposition_id: pid,
      reconstruction_context: {
        governing_requirements: scrubSpecField(governingRequirements || ""),
        relevant_spec_sections: relevantSpecSections,
        repository_evidence: repoEv.text,
        proposition,
      },
      arguments: {
        argument_A: presentedA.triple,
        argument_B: presentedB.triple,
      },
    };
    caseFiles[pid] = caseFile;

    ledgerEntries[pid] = {
      proposition_id: pid,
      lens,
      severity,
      blocking: blockingOf(severity),
      argument_A_source: presentedA.source,
      argument_B_source: presentedB.source,
      case_file_anchor: bDerived.source === "orchestrator:chosen" ? anchor : "",
      contested_source: reputationFlagged.includes(servingIdentity),
      order_seed: seed,
      pre_ruling_spec_sha: specSha,
      pre_ruling_spec_content: specText,
      ruling: null,
      resolution: "pending",
    };
  });

  return { caseFiles, ledger: { order, entries: ledgerEntries, governing_requirements: String(governingRequirements || ""), run_id: runId, window_start: windowStart } };
}

function sha256Text(text) { return crypto.createHash("sha256").update(String(text)).digest("hex"); }

// --- correction-applied check ---------------------------------------------

// A UPHOLD_REVIEW / SYNTHESIZE correction is "applied" iff the whole current spec file:
//   (a) contains the verification literal, AND
//   (b) that literal was ABSENT from the retained pre-correction spec content (its presence now
//       proves the correction added it, not that a pre-existing token was matched), AND
//   (c) the whole-file hash differs from pre_ruling_spec_sha (change-detection).
// Returns { applied, reason }.
function correctionApplied(entry, ruling, currentSpecText) {
  const correction = ruling && ruling.correction;
  if (!correction || typeof correction.verification !== "string" || !correction.verification) {
    return { applied: false, reason: "no verification literal" };
  }
  const lit = correction.verification;
  const currentSha = sha256Text(currentSpecText);
  if (currentSha === entry.pre_ruling_spec_sha) return { applied: false, reason: "spec byte-identical (unchanged)" };
  if (typeof entry.pre_ruling_spec_content === "string" && entry.pre_ruling_spec_content.includes(lit)) {
    return { applied: false, reason: "verification literal already present pre-correction (absence-before not established)" };
  }
  if (!String(currentSpecText).includes(lit)) return { applied: false, reason: "verification literal absent from the current spec" };
  return { applied: true, reason: "literal added and spec changed" };
}

// --- L4 ratification (the roll-up's half of the two-part L4-final gate) ----

// Corroborate a caller-asserted L4 against the run-ledger `level` AND the local events.jsonl chain
// verified from genesis. Returns { effectiveLevel, veto } where veto ∈ {null, "l4_unratified",
// "l4_chain_uncorroborated"}. Honestly bounded: the local from-genesis walk catches a broken chain
// and an absent mint event, NOT a self-consistent full re-hash — that is the merge-time
// governance-check's half (see the spec's two-part-gate decision).
function l4Ratify(runDir) {
  // 1. run-ledger must independently say level "L4".
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8")); }
  catch { return { effectiveLevel: "L3", veto: "l4_unratified" }; }
  if (!ledger || ledger.level !== "L4") return { effectiveLevel: "L3", veto: "l4_unratified" };

  // 2. the local events.jsonl chain must verify from genesis AND carry the mint-time level:L4 event.
  let chain;
  try { chain = verifyChain(runDir); } catch { return { effectiveLevel: "L3", veto: "l4_chain_uncorroborated" }; }
  if (!chain || (chain.status !== "verified" && chain.status !== "mixed")) {
    return { effectiveLevel: "L3", veto: "l4_chain_uncorroborated" };
  }
  if (!chainCarriesLevelL4(runDir)) return { effectiveLevel: "L3", veto: "l4_chain_uncorroborated" };
  return { effectiveLevel: "L4", veto: null };
}

function chainCarriesLevelL4(runDir) {
  let buf;
  try { buf = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8"); } catch { return false; }
  for (const line of buf.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; }
    if (rec && rec.data && rec.data.level === "L4") return true;
  }
  return false;
}

// --- admit roll-up --------------------------------------------------------

// admitRollup({ ledger, rulings, currentSpecText, level, runDir, floors }) -> AdmitResult.
//   ledger        — { order:[pid], entries:{pid: LedgerEntry} }
//   rulings        — { pid: PropositionRuling | null }  (null / missing → the caller must have
//                     recorded resolution:"parked" on the ledger entry; a listed pid with no
//                     ruling AND no parked marker is fail-loud, thrown by the CLI layer)
//   floors         — { blocker_free_latest, infosec_major_free, reputation_ok, ratified_scope_ok }
//                     each is a tri-state: true (pass) / false (fired) / null (degraded → fail-closed)
// Throws { failLoud: msg } for a missing ruling on a non-parked listed proposition (the CLI maps
// it to exit 2).
function admitRollup(opts) {
  const { ledger, rulings = {}, currentSpecText = "", level = "L3", runDir = null, floors = {}, governingRequirements = "" } = opts;
  const order = (ledger && Array.isArray(ledger.order)) ? ledger.order : [];
  const entries = (ledger && ledger.entries) || {};

  const resolved = [];
  const unresolved = [];
  const parked = [];
  const prd_boundary = [];
  const minor_corrections_applied = [];
  const minor_corrections_unapplied = [];
  const floor_veto = [];

  for (const pid of order) {
    const entry = entries[pid];
    if (!entry) throw { failLoud: `ledger lists ${pid} but has no entry for it` };
    const resolution = entry.resolution;
    const ruling = rulings[pid];

    if (resolution === "parked") {
      unresolved.push(pid);
      parked.push(pid);
      continue;
    }
    if (ruling == null) throw { failLoud: `no ruling for listed proposition ${pid} (and it is not marked parked)` };

    const outcome = ruling.outcome;
    if (outcome === "AFFIRM_SPEC") {
      resolved.push(pid);
    } else if (outcome === "PRD_BOUNDARY") {
      prd_boundary.push(pid);
      unresolved.push(pid);
    } else if (outcome === "UPHOLD_REVIEW" || outcome === "SYNTHESIZE") {
      const { applied } = correctionApplied(entry, ruling, currentSpecText);
      if (applied) {
        resolved.push(pid);
        if (!entry.blocking) minor_corrections_applied.push(pid);
      } else {
        unresolved.push(pid);
        if (!entry.blocking) minor_corrections_unapplied.push(pid);
      }
    } else {
      // A non-conformant / unexpected outcome that slipped past the contract → unresolved (safe).
      unresolved.push(pid);
    }
  }

  // Every blocking proposition resolved? No PRD_BOUNDARY anywhere? No blocking proposition parked?
  const blockingUnresolved = unresolved.filter((pid) => entries[pid] && entries[pid].blocking && !parked.includes(pid));
  const blockingParked = parked.filter((pid) => entries[pid] && entries[pid].blocking);
  const everyBlockingResolved = blockingUnresolved.length === 0 && blockingParked.length === 0;

  // Floors — each evaluated as `=== true` so a null/degraded input fails CLOSED. A specific `false`
  // records the named floor; any other non-true value (null/absent/degraded) records
  // "floor_input_degraded" once (never a silent `!= false` skip that fails open).
  let floorPass = true;
  const pushVeto = (v) => { if (!floor_veto.includes(v)) floor_veto.push(v); };
  const floorIsTrue = (v) => v === true;
  if (!floorIsTrue(floors.blocker_free_latest)) {
    floorPass = false;
    pushVeto(floors.blocker_free_latest === false ? "blocker" : "floor_input_degraded");
  }
  if (!floorIsTrue(floors.infosec_major_free)) {
    floorPass = false;
    pushVeto(floors.infosec_major_free === false ? "infosec_major" : "floor_input_degraded");
  }
  if (floors.reputation_ok !== undefined && !floorIsTrue(floors.reputation_ok)) {
    floorPass = false;
    pushVeto("floor_input_degraded");
  }
  if (floors.ratified_scope_ok !== undefined && !floorIsTrue(floors.ratified_scope_ok)) {
    floorPass = false;
    pushVeto("floor_input_degraded");
  }

  // L4-ratification: the roll-up's half of the two-part L4-final gate.
  let effectiveLevel = level;
  if (level === "L4") {
    if (!runDir) {
      effectiveLevel = "L3";
      floor_veto.push("l4_unratified");
    } else {
      const rat = l4Ratify(runDir);
      effectiveLevel = rat.effectiveLevel;
      if (rat.veto) floor_veto.push(rat.veto);
    }
    // PRD-presence fail-safe: at effective L4 a null/empty governing_requirements blocks admit.
    if (effectiveLevel === "L4" && !String(governingRequirements || "").trim()) {
      floorPass = false;
      floor_veto.push("prd_absent_at_l4");
    }
  }

  const admit = everyBlockingResolved && prd_boundary.length === 0 && floorPass;

  return {
    admit,
    level: effectiveLevel,
    resolved,
    unresolved,
    parked,
    prd_boundary,
    minor_corrections_applied,
    minor_corrections_unapplied,
    floor_veto,
  };
}

// --- dispatch-side deterministic helpers (used by faff-prep's per-proposition dispatch) ---

// Parse the judge ruling from CALL 2's stdout ONLY. Exactly one well-formed
// `faff-contract:spec-judge-verdict` fenced block is required: zero → park (cause
// "no-verdict-block"), more than one → fail-loud park (cause "multiple-verdict-blocks"). The
// spec body is never in this stream, so a forged block embedded in the spec can never be read.
function parseVerdictBlock(stdout) {
  const text = String(stdout || "");
  const re = /```faff-contract:spec-judge-verdict\s*\n([\s\S]*?)\n```/g;
  const blocks = [];
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  if (blocks.length === 0) return { park: true, cause: "no-verdict-block" };
  if (blocks.length > 1) return { park: true, failLoud: true, cause: "multiple-verdict-blocks" };
  let json;
  try { json = JSON.parse(blocks[0]); }
  catch (e) { return { park: true, failLoud: true, cause: "malformed-verdict-block", detail: e.message }; }
  return { ok: true, json };
}

// The reconstruction-validation gate: each of the four named sections must be present AND carry at
// least RECONSTRUCTION_MIN_SECTION_CHARS non-whitespace characters. Presence + length only — it does
// NOT claim to reject length-passing boilerplate (a substance check needs a model call the
// determinism-first bar forbids). Returns { ok, missing:[], reason }.
function validateReconstruction(text) {
  const s = String(text || "");
  if (!s.trim()) return { ok: false, missing: RECONSTRUCTION_SECTION_KEYS.slice(), reason: "empty reconstruction" };
  // Locate each key's position (first occurrence). Missing key → fail.
  const positions = RECONSTRUCTION_SECTION_KEYS.map((k) => ({ k, i: s.indexOf(k) }));
  const missing = positions.filter((p) => p.i < 0).map((p) => p.k);
  if (missing.length) return { ok: false, missing, reason: `missing section(s): ${missing.join(", ")}` };
  // Order the found keys by position; each section's content runs to the next key (or end).
  const ordered = positions.slice().sort((a, b) => a.i - b.i);
  for (let j = 0; j < ordered.length; j++) {
    const start = ordered[j].i + ordered[j].k.length;
    const end = j + 1 < ordered.length ? ordered[j + 1].i : s.length;
    const content = s.slice(start, end).replace(/\s+/g, "");
    if (content.length < RECONSTRUCTION_MIN_SECTION_CHARS) {
      return { ok: false, missing: [ordered[j].k], reason: `section ${ordered[j].k} under ${RECONSTRUCTION_MIN_SECTION_CHARS} non-whitespace chars` };
    }
  }
  return { ok: true, missing: [] };
}

module.exports = {
  RECONSTRUCTION_MIN_SECTION_CHARS,
  parseVerdictBlock,
  validateReconstruction,
  RECONSTRUCTION_SECTION_KEYS,
  CORRECTION_VERIFICATION_MIN,
  NOT_SEPARATELY_STATED,
  LENS_DOMAIN,
  LENS_SCRUB_TOKENS,
  AUTHORITY_PHRASES,
  DIRECTIVE_PHRASES,
  lensScrub,
  imperativeScrub,
  secretRedact,
  scrubArgumentField,
  scrubSpecField,
  hasDiffMarkers,
  buildProposition,
  buildSpecHeadingIndex,
  deriveArgumentB,
  argumentATriple,
  argumentBTriple,
  gatherRepositoryEvidence,
  extractPathTokens,
  orderSeed,
  coinSwap,
  blockingOf,
  propositionId,
  assemble,
  sha256Text,
  correctionApplied,
  l4Ratify,
  chainCarriesLevelL4,
  admitRollup,
};
