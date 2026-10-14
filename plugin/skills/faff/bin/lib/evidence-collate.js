// ===========================================================================
// === region:governance — evidence-collate — FAFF-1267: collate every spec-review round into one digest-checked comment ===
//
// Pure cores behind `faff spec-review collate-evidence` and `faff evidence write spec-review-verdict`.
// The collator lists every objection from every valid `round-<n>.json` as its own item (never merged),
// redacted before anything is rendered, because the sha256 line forbids changing the bytes afterwards.
// The renderer prints the whole `## Spec-review evidence` comment body; the parser reads it back and
// refuses any block whose digest no longer matches. Governance code: it requires only governance and
// shared modules, so the factory `spec-review` verb can require it and never the reverse.
// ===========================================================================

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { REVIEW_DISPOSITIONS, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_VERDICTS } = require("./review-vocab");
const { redactKnownSecrets } = require("./redact");

const EVIDENCE_HEADING = "spec-review evidence";
const EVIDENCE_FENCE_RE = /```faff-contract:spec-review-verdict\s*\n([\s\S]*?)\n```/;
const DIGEST_LINE_RE = /^sha256: ([0-9a-f]{64})\s*$/;
const OBJECTION_TEXT_FIELDS = ["claim", "evidence", "predicted_consequence", "spec_anchor"];
const RESOLUTION_FIELDS = ["disposition", "refutation", "disposition_rationale"];

class EvidenceRefusal extends Error {}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sha256Hex = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

function evidenceSection(text) {
  const lines = String(text).split(/\r?\n/);
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/;
  let startIdx = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[2].trim().toLowerCase() === EVIDENCE_HEADING) {
      startIdx = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[1].length <= startLevel) { endIdx = i; break; }
  }
  return lines.slice(startIdx, endIdx).join("\n");
}

// extractSpecReviewEvidence(text) -> the JSON body of the `faff-contract:spec-review-verdict` fenced
// block under a `## Spec-review evidence` heading (case-insensitive, any level), or null when there is
// no such section or fence. The section runs to the next heading at the same-or-shallower level.
function extractSpecReviewEvidence(text) {
  const section = evidenceSection(text);
  if (section === null) return null;
  const fence = section.match(EVIDENCE_FENCE_RE);
  return fence ? fence[1] : null;
}

function conformantRound(rec) {
  if (!isObject(rec) || !SPEC_REVIEW_VERDICTS.includes(rec.verdict) || !Array.isArray(rec.objections)) return false;
  const objectionsOk = rec.objections.every((o) => isObject(o) && SPEC_REVIEW_LENSES.includes(o.lens) && SPEC_REVIEW_SEVERITIES.includes(o.severity));
  return objectionsOk && (rec.verdict === "approve") === (rec.objections.length === 0);
}

function collatedItem(o, n, i) {
  const item = { key: `${n}#${i}`, lens: o.lens, severity: o.severity };
  for (const field of OBJECTION_TEXT_FIELDS) if (typeof o[field] === "string") item[field] = o[field];
  item.first_round = n;
  item.last_round = n;
  const occurrence = { round: n, severity: o.severity };
  if (item.claim !== undefined) occurrence.claim = item.claim;
  if (item.spec_anchor !== undefined) occurrence.spec_anchor = item.spec_anchor;
  item.occurrences = [occurrence];
  return item;
}

// collateSpecReviewRounds(dir, secrets) -> { record, rounds: [{n, count}], skipped: [fileName] }.
// Every valid round across the whole loop, never the convergence window. A round file that is not a
// conformant round is skipped and named. Throws when `dir` cannot be read.
function collateSpecReviewRounds(dir, secrets = []) {
  const names = fs.readdirSync(dir);
  const found = [];
  for (const name of names) {
    const m = name.match(/^round-(\d+)\.json$/);
    if (m) found.push({ name, n: parseInt(m[1], 10) });
  }
  found.sort((a, b) => a.n - b.n);
  const rounds = [];
  const skipped = [];
  const objections = [];
  let verdict = "approve";
  let finalVerdict = "approve";
  for (const { name, n } of found) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { rec = null; }
    if (!conformantRound(rec)) { skipped.push(name); continue; }
    const round = redactKnownSecrets(rec, secrets);
    rounds.push({ n, count: round.objections.length });
    round.objections.forEach((o, i) => objections.push(collatedItem(o, n, i)));
    finalVerdict = round.verdict;
    if (round.objections.length > 0) verdict = round.verdict;
  }
  return { record: { verdict, final_verdict: finalVerdict, rounds_total: rounds.length, objections }, rounds, skipped };
}

// applyDispositions(record, dispositions, secrets) -> a new record with each entry folded onto its
// keyed objection. Throws EvidenceRefusal naming the rule and key, never a field value.
function applyDispositions(record, dispositions, secrets = []) {
  if (!Array.isArray(dispositions)) throw new EvidenceRefusal("dispositions must be a JSON array");
  const entries = redactKnownSecrets(dispositions, secrets);
  const byKey = new Map();
  entries.forEach((entry, i) => {
    if (!isObject(entry) || typeof entry.key !== "string") throw new EvidenceRefusal(`dispositions[${i}] has no string key`);
    if (byKey.has(entry.key)) throw new EvidenceRefusal(`duplicate key ${entry.key}`);
    if (!REVIEW_DISPOSITIONS.includes(entry.disposition)) throw new EvidenceRefusal(`key ${entry.key}: disposition not in {${REVIEW_DISPOSITIONS.join(",")}}`);
    for (const field of ["disposition_rationale", "refutation"]) {
      if (entry[field] !== undefined && typeof entry[field] !== "string") throw new EvidenceRefusal(`key ${entry.key}: ${field} must be a string`);
    }
    byKey.set(entry.key, entry);
  });
  const known = new Set(record.objections.map((o) => o.key));
  for (const key of byKey.keys()) if (!known.has(key)) throw new EvidenceRefusal(`unknown key ${key}`);
  const objections = record.objections.map((o) => {
    const entry = byKey.get(o.key);
    if (!entry) throw new EvidenceRefusal(`uncovered key ${o.key}`);
    if (entry.lens !== o.lens) throw new EvidenceRefusal(`key ${o.key}: lens does not match the keyed objection`);
    const folded = {};
    for (const [field, value] of Object.entries(o)) {
      if (field === "first_round") for (const r of RESOLUTION_FIELDS) if (entry[r] !== undefined) folded[r] = entry[r];
      folded[field] = value;
    }
    return folded;
  });
  return { ...record, objections };
}

function summaryLine(o) {
  const settled = o.disposition === undefined ? "unsettled" : o.disposition;
  const anchor = o.spec_anchor === undefined ? "no anchor" : o.spec_anchor;
  return `- [round ${o.first_round}] ${o.lens} ${o.severity} (${anchor}): ${settled}`.replace(/\s*[\r\n]+\s*/g, " ");
}

// renderSpecReviewComment(record, rounds) -> the whole comment body, ending with the sha256 line.
function renderSpecReviewComment(record, rounds) {
  const stripped = record.objections.map(({ key, ...rest }) => rest);
  const block = JSON.stringify({ verdict: record.verdict, final_verdict: record.final_verdict, rounds_total: record.rounds_total, objections: stripped });
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const perRound = rounds.map((r) => `round ${r.n}: ${r.count}`).join(", ");
  const headline = `${plural(record.rounds_total, "round")}, ${plural(record.objections.length, "objection")} (${perRound})`;
  return [
    "## Spec-review evidence",
    "",
    headline,
    "",
    ...record.objections.map(summaryLine),
    "",
    "```faff-contract:spec-review-verdict",
    block,
    "```",
    `sha256: ${sha256Hex(block)}`,
    "",
  ].join("\n");
}

// parseSpecReviewComment(text) -> the parsed, digest-verified collated record. Throws EvidenceRefusal.
function parseSpecReviewComment(text) {
  const section = evidenceSection(text);
  if (section === null) throw new EvidenceRefusal("no '## Spec-review evidence' section");
  const fence = section.match(EVIDENCE_FENCE_RE);
  if (!fence) throw new EvidenceRefusal("no faff-contract:spec-review-verdict fence in the evidence section");
  const body = fence[1];
  if (body.includes("\n")) throw new EvidenceRefusal("pre-collation evidence block (multi-line fence body)");
  const after = section.slice(fence.index + fence[0].length).split("\n");
  const digestLine = after.map((l) => l.match(DIGEST_LINE_RE)).find((m) => m !== null);
  if (!digestLine) throw new EvidenceRefusal("no sha256 line after the evidence fence");
  if (sha256Hex(body) !== digestLine[1]) throw new EvidenceRefusal("digest mismatch: the evidence block was changed after it was rendered");
  let parsed;
  try { parsed = JSON.parse(body); } catch { throw new EvidenceRefusal("evidence block is not valid JSON"); }
  const collated = isObject(parsed) && Number.isInteger(parsed.rounds_total) && Array.isArray(parsed.objections)
    && parsed.objections.every((o) => isObject(o) && Number.isInteger(o.first_round) && Number.isInteger(o.last_round) && Array.isArray(o.occurrences));
  if (!collated) throw new EvidenceRefusal("pre-collation evidence block (no rounds_total, first_round, last_round or occurrences)");
  return parsed;
}

module.exports = {
  EvidenceRefusal, applyDispositions, collateSpecReviewRounds, conformantRound, extractSpecReviewEvidence,
  parseSpecReviewComment, renderSpecReviewComment,
};
