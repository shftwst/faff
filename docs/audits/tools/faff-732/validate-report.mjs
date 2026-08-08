#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const STATUSES = new Set(["enforced", "attested", "demonstrated", "planned", "stale", "unsupported"]);
const KINDS = new Set(["product-guarantee", "process-observation"]);
const SURFACES = new Set(["current-public", "historical-record", "test-or-fixture", "generated-or-metadata", "non-prose"]);
const SUPPORTS = new Set(["enforcement-mechanism", "enforcement-activation", "attestation", "demonstration", "status-history"]);
const RULES = new Set(["guarantee-modal", "enforcement-term", "autonomy-level", "support-term"]);
const DISPOSITIONS = new Set(["claim", "not-a-claim", "historical-context"]);
const sha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const list = (value) => Array.isArray(value) ? value : [];
const count = (values, value) => values.filter((item) => item === value).length;

function scopedPaths(sourceCommit) {
  const result = spawnSync("git", ["ls-tree", "-r", "--name-only", sourceCommit, "--", "README.md", "docs", "website"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ls-tree failed: ${result.stderr.trim()}`);
  return result.stdout.trim().split("\n").filter(Boolean).sort();
}

function sourceText(sourceCommit, path) {
  const result = spawnSync("git", ["show", `${sourceCommit}:${path}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git show failed for ${path}: ${result.stderr.trim()}`);
  return result.stdout;
}

function scannerMatches(sourceCommit, files) {
  const matches = [];
  for (const entry of files.filter((item) => item.surface === "current-public")) {
    sourceText(sourceCommit, entry.path).split("\n").forEach((raw, index) => {
      const matched_text = raw.trim().replace(/^[-#>*\d.\s]+/, "").slice(0, 240);
      if (!matched_text) return;
      let matched_rule = null;
      if (/\b(will|must|cannot|always|never)\b/i.test(matched_text)) matched_rule = "guarantee-modal";
      else if (/\b(enforce|deny|block|fail closed|mandatory)\w*\b/i.test(matched_text)) matched_rule = "enforcement-term";
      else if (/\bL[1-4]\b|lights-out|unattended/i.test(matched_text)) matched_rule = "autonomy-level";
      else if (/\b(support|supported|unsupported|planned|parity)\w*\b/i.test(matched_text)) matched_rule = "support-term";
      if (matched_rule) matches.push({ source: { path: entry.path, section: `line ${index + 1}` }, matched_text, matched_rule });
    });
  }
  return matches;
}

export function validateLedger(ledger, { checkInventory = true } = {}) {
  const errors = [];
  if (!ledger || ledger.schema !== 1 || ledger.issue !== "FAFF-732") errors.push("schema/issue must be 1/FAFF-732");
  if (!sha(ledger?.source_commit)) errors.push("source_commit must be a forty-character lowercase Git SHA");
  if (!text(ledger?.generated_at) || Number.isNaN(Date.parse(ledger.generated_at))) errors.push("generated_at must be ISO-8601");
  if (JSON.stringify(ledger?.scope) !== JSON.stringify(["README.md", "docs/**", "website/**"])) errors.push("scope mismatch");

  const files = list(ledger?.files);
  const paths = files.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) errors.push("files contains duplicate paths");
  if (checkInventory && sha(ledger?.source_commit)) {
    try {
      const expected = scopedPaths(ledger.source_commit);
      const actual = [...paths].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(`file inventory mismatch: expected ${expected.length}, got ${actual.length}`);
    } catch (error) { errors.push(error.message); }
  }

  const claims = list(ledger?.claims);
  const claimIds = claims.map((claim) => claim.id);
  if (new Set(claimIds).size !== claimIds.length) errors.push("claims contains duplicate IDs");
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const fileByPath = new Map(files.map((entry) => [entry.path, entry]));

  for (const entry of files) {
    if (!text(entry.path) || !SURFACES.has(entry.surface)) errors.push(`invalid file entry ${entry.path || "<missing>"}`);
    if (!list(entry.claim_ids).length && !text(entry.rationale)) errors.push(`${entry.path}: empty claim_ids requires rationale`);
    for (const id of list(entry.claim_ids)) {
      const claim = claimById.get(id);
      if (!claim) errors.push(`${entry.path}: dangling claim ${id}`);
      else if (claim.source?.path !== entry.path) errors.push(`${entry.path}: claim ${id} source mismatch`);
    }
  }

  for (const claim of claims) {
    if (!text(claim.id) || !KINDS.has(claim.kind) || !STATUSES.has(claim.status) || !text(claim.summary) || !text(claim.current_state)) errors.push(`${claim.id || "<missing>"}: invalid claim shape`);
    if (!fileByPath.has(claim.source?.path) || !text(claim.source?.section)) errors.push(`${claim.id}: invalid source anchor`);
    if (!list(fileByPath.get(claim.source?.path)?.claim_ids).includes(claim.id)) errors.push(`${claim.id}: absent from source file claim_ids`);
    const evidence = list(claim.evidence);
    for (const ref of evidence) if (!text(ref.label) || !text(ref.target) || !SUPPORTS.has(ref.supports)) errors.push(`${claim.id}: invalid evidence`);
    const supportKinds = evidence.map((ref) => ref.supports);
    if (claim.status === "enforced" && (count(supportKinds, "enforcement-mechanism") < 1 || count(supportKinds, "enforcement-activation") < 1)) errors.push(`${claim.id}: enforced requires mechanism and activation evidence`);
    if (claim.status === "attested" && !supportKinds.includes("attestation")) errors.push(`${claim.id}: attested requires attestation evidence`);
    if (claim.status === "demonstrated" && !supportKinds.includes("demonstration")) errors.push(`${claim.id}: demonstrated requires demonstration evidence`);
    if (["planned", "stale", "unsupported"].includes(claim.status) && !/^FAFF-[1-9][0-9]*$/.test(claim.owner_issue || "")) errors.push(`${claim.id}: unresolved claim requires owner_issue`);
  }

  const candidateKeys = new Set();
  for (const candidate of list(ledger?.candidates)) {
    const key = `${candidate.source?.path}#${candidate.source?.section}#${candidate.matched_text}`;
    if (candidateKeys.has(key)) errors.push(`duplicate candidate ${key}`);
    candidateKeys.add(key);
    if (!fileByPath.has(candidate.source?.path) || !text(candidate.source?.section) || !text(candidate.matched_text) || !RULES.has(candidate.matched_rule) || !DISPOSITIONS.has(candidate.disposition)) errors.push(`invalid candidate ${key}`);
    if (candidate.disposition === "claim" && !claimById.has(candidate.claim_id)) errors.push(`${key}: claim disposition requires valid claim_id`);
    if (candidate.disposition !== "claim" && !text(candidate.rationale)) errors.push(`${key}: non-claim disposition requires rationale`);
  }
  if (checkInventory && sha(ledger?.source_commit)) {
    try {
      for (const match of scannerMatches(ledger.source_commit, files)) {
        const key = `${match.source.path}#${match.source.section}#${match.matched_text}`;
        if (!candidateKeys.has(key)) errors.push(`${key}: scanner match has no candidate disposition`);
      }
    } catch (error) { errors.push(error.message); }
  }

  for (const term of list(ledger?.terminology)) if (!text(term.term) || !text(term.definition) || !Array.isArray(term.deprecated_aliases)) errors.push("invalid terminology entry");
  return errors;
}

const esc = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
const source = (claim) => `\`${claim.source.path}\` (${claim.source.section})`;

export function renderReport(ledger) {
  const claims = [...list(ledger.claims)].sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    "# Public trust claims: dated status audit",
    "",
    `> FAFF-732 baseline at \`${ledger.source_commit}\`, generated ${ledger.generated_at}.`,
    "",
    "This is a dated audit, not continuous semantic enforcement. It distinguishes product guarantees from process observations and records the evidence available at the pinned source commit.",
    "",
    "## Method",
    "",
    `The inventory covers all ${ledger.files.length} tracked paths under \`README.md\`, \`docs/**\`, and \`website/**\`. A recall-biased scanner records obvious guarantee, enforcement, autonomy-level, and support-status language. Human review still owns semantic sufficiency and evidence strength.`,
    "",
    "## Status summary",
    "",
    "| Status | Claims |",
    "|---|---:|",
    ...[...STATUSES].map((status) => `| ${status} | ${claims.filter((claim) => claim.status === status).length} |`),
    "",
    "## Claim ledger",
    "",
  ];
  for (const claim of claims) {
    lines.push(`**${claim.id}: ${claim.summary}**`, "", `- Kind/status: \`${claim.kind}\` / \`${claim.status}\``, `- Source: ${source(claim)}`, `- Current: ${claim.current_state}`);
    if (text(claim.target_state)) lines.push(`- Target: ${claim.target_state}`);
    if (claim.owner_issue) lines.push(`- Owner: ${claim.owner_issue}`);
    for (const evidence of list(claim.evidence)) lines.push(`- Evidence (${evidence.supports}): ${evidence.label} — \`${evidence.target}\``);
    lines.push("");
  }
  lines.push("## Stale content", "");
  const stale = claims.filter((claim) => claim.status === "stale");
  lines.push(...(stale.length ? stale.map((claim) => `- **${claim.id}**: ${claim.current_state} Owner: ${claim.owner_issue}.`) : ["No stale claim was recorded at this snapshot."]));
  lines.push("", "## Terminology map", "", "| Term | Definition | Preferred term | Deprecated aliases |", "|---|---|---|---|");
  for (const term of [...list(ledger.terminology)].sort((a, b) => a.term.localeCompare(b.term))) lines.push(`| ${esc(term.term)} | ${esc(term.definition)} | ${esc(term.preferred_term || "—")} | ${esc(list(term.deprecated_aliases).join(", ") || "—")} |`);
  lines.push("", "## Current versus target", "");
  const targets = claims.filter((claim) => text(claim.target_state));
  lines.push(...(targets.length ? targets.map((claim) => `- **${claim.id}**: ${claim.current_state} Target: ${claim.target_state}`) : ["No separate target state was recorded."]));
  lines.push("", "## Evidence gaps", "");
  const gaps = claims.filter((claim) => ["planned", "stale", "unsupported"].includes(claim.status));
  lines.push(...(gaps.length ? gaps.map((claim) => `- **${claim.id}** (${claim.status}): ${claim.current_state} Owner: ${claim.owner_issue}.`) : ["No unresolved evidence gap was recorded."]));
  lines.push("", "## File inventory", "");
  for (const surface of [...SURFACES]) {
    lines.push(`### ${surface}`, "");
    for (const entry of ledger.files.filter((item) => item.surface === surface).sort((a, b) => a.path.localeCompare(b.path))) lines.push(`- \`${entry.path}\` — ${entry.claim_ids.length ? `claims: ${entry.claim_ids.join(", ")}` : entry.rationale}`);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function selftest() {
  const base = { schema: 1, issue: "FAFF-732", source_commit: "a".repeat(40), generated_at: "2026-08-07T00:00:00Z", scope: ["README.md", "docs/**", "website/**"], terminology: [], candidates: [], files: [{ path: "README.md", surface: "current-public", claim_ids: [], rationale: "fixture" }], claims: [] };
  if (validateLedger(base, { checkInventory: false }).length) throw new Error("valid fixture rejected");
  if (!validateLedger({ ...base, source_commit: "bad" }, { checkInventory: false }).some((error) => error.includes("source_commit"))) throw new Error("bad SHA accepted");
  const drift = { ...base, claims: [{ id: "x", kind: "product-guarantee", status: "enforced", summary: "x", source: { path: "README.md", section: "x" }, evidence: [], current_state: "x" }], files: [{ ...base.files[0], claim_ids: ["x"], rationale: undefined }] };
  if (!validateLedger(drift, { checkInventory: false }).some((error) => error.includes("mechanism"))) throw new Error("weak enforcement evidence accepted");
  console.log("validate-report --selftest: ok (3 cases)");
}

const args = process.argv.slice(2);
if (args[0] === "--selftest") selftest();
else {
  const renderOnly = args[0] === "--render";
  const ledgerPath = renderOnly ? args[1] : args[0];
  const reportPath = renderOnly ? null : args[1];
  if (!ledgerPath) { console.error("usage: validate-report.mjs <ledger.json> [report.md] | --render <ledger.json> | --selftest"); process.exit(2); }
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); }
  catch (error) { console.error(`invalid ledger: ${error.message}`); process.exit(1); }
  const errors = validateLedger(ledger);
  const rendered = renderReport(ledger);
  if (reportPath) {
    let committed = "";
    try { committed = fs.readFileSync(reportPath, "utf8"); } catch (error) { errors.push(`cannot read report: ${error.message}`); }
    if (committed !== rendered) errors.push("committed Markdown differs from --render output");
  }
  if (errors.length) { errors.forEach((error) => console.error(error)); process.exit(1); }
  if (renderOnly) process.stdout.write(rendered);
  else console.log(JSON.stringify({ valid: true, files: ledger.files.length, claims: ledger.claims.length, candidates: ledger.candidates.length }));
}
