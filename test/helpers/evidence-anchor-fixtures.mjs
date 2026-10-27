// FAFF-1263: shared fixtures for the warn-only evidence-schema tests. Builds run dirs that mint through
// `faff events anchor`, with evidence documents copied from the shipped v0.3 valid examples.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { appendRecordUnderLock, mintIssueAnchor } = require("../../plugin/skills/faff/bin/lib/events.js");

export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

// FAFF-1347: build a schema-2 event chain by hand (prev = SHA-256 of the previous physical line's
// raw bytes; genesis prev = SHA-256 of the run_id) so a fixture can carry rows the FAFF-1353 write
// core would refuse — an unattributable (issue "") or whitespace-only row the OLD writer produced.
// `records` is an ordered list of { ts, phase, type, issue?, data? }; seq is the array index.
export function buildChain(runDir, runName, records) {
  let prev = sha256Hex(Buffer.from(runName, "utf8"));
  const lines = [];
  records.forEach((r, i) => {
    const rec = { schema: 2, run_id: runName, seq: i, ts: r.ts, prev, phase: r.phase, type: r.type };
    if ("issue" in r) rec.issue = r.issue;
    rec.data = r.data || {};
    const line = JSON.stringify(rec);
    lines.push(line);
    prev = sha256Hex(Buffer.from(line, "utf8"));
  });
  writeFileSync(path.join(runDir, "events.jsonl"), lines.join("\n") + "\n");
}

// Build a multi-issue run dir: a run-ledger.json (admitted + outcomes), a seq-0 run-start, the given
// rows, and — when bindLedger — a final ledger-write folding over the run-ledger bytes (so the
// anchor's ledger reads as BOUND). Returns { runDir, runName, ledger }. Never touches a live run dir.
export function mkScopeRun(root, {
  runName = "run-20261101-000000-beepboop-list-scope",
  admitted = ["FAFF-A", "FAFF-B"], outcomes = {},
  rows = [], startTs = "2026-11-01T00:00:00.000Z", bindLedger = true,
} = {}) {
  const runDir = path.join(root, ".faff", "runs", runName);
  mkdirSync(runDir, { recursive: true });
  // Base on the shipped v0.3 run-ledger example (schema_version + required fields), overriding only
  // the run id / level / admitted set / outcomes the scope tests need.
  const ledger = { ...exampleObject("run-ledger"), run_id: runName, level: "L3", admitted, outcomes };
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(ledger));
  // Per-issue v0.3 evidence so the minted anchor is schemaed (not legacy), so the scoped events
  // verdict actually applies. Each admitted issue gets a conforming ac-checklist + review-verdict.
  for (const issue of admitted) {
    mkdirSync(path.join(runDir, issue), { recursive: true });
    writeFileSync(path.join(runDir, issue, "ac-checklist.json"), example("ac-checklist"));
    writeFileSync(path.join(runDir, issue, "review-verdict.json"), example("review-verdict-anchored"));
  }
  const records = [{ ts: startTs, phase: "run", type: "run-start", data: {} },
    ...rows.map((r) => ({ ts: startTs, ...r }))];
  if (bindLedger) {
    const h = sha256Hex(readFileSync(path.join(runDir, "run-ledger.json")));
    records.push({ ts: startTs, phase: "run", type: "ledger-write", data: { ledger_sha256: h } });
  }
  buildChain(runDir, runName, records);
  return { runDir, runName, ledger };
}

// Mint a per-issue anchor into <anchorsRoot>/<runName>/<issue>/ (basename = issue, as real mints do).
export function mintScopeAnchor(runDir, runName, issue, anchorsRoot) {
  const destDir = path.join(anchorsRoot, runName, issue);
  const r = mintIssueAnchor(runDir, issue, destDir);
  if (!r.ok) throw new Error(`mintIssueAnchor failed: ${r.code} ${r.message}`);
  return destDir;
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..");
export const examplesDir = path.join(repoRoot, "plugin", "skills", "faff", "contracts", "evidence-v0.3", "schema", "examples");

export const example = (name) => readFileSync(path.join(examplesDir, `${name}.example.json`), "utf8");
export const exampleObject = (name) => JSON.parse(example(name));

// A run dir with a valid two-record genesis chain whose records pass the run-event schema.
export function mkChainedRun(root, runName = "run-20261014-000000-graft-FAFF-1") {
  const runDir = path.join(root, ".faff", "runs", runName);
  mkdirSync(runDir, { recursive: true });
  const ts = "2026-01-01T00:00:00.000Z";
  appendRecordUnderLock(runDir, (seq, _p, prev) => ({ schema: 2, run_id: runName, seq, ts, prev, phase: "run", type: "run-start", data: {} }));
  appendRecordUnderLock(runDir, (seq, _p, prev) => ({ schema: 2, run_id: runName, seq, ts, prev, phase: "build", type: "build-start", issue: "FAFF-1", data: {} }));
  return runDir;
}

// "legacy": today's shape, no schema_version anywhere. "v03": the shipped valid examples.
export function writeEvidence(runDir, shape, issue = "FAFF-1") {
  mkdirSync(path.join(runDir, issue), { recursive: true });
  if (shape === "legacy") {
    writeFileSync(path.join(runDir, issue, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
    writeFileSync(path.join(runDir, issue, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
    return;
  }
  writeFileSync(path.join(runDir, "run-ledger.json"), example("run-ledger"));
  writeFileSync(path.join(runDir, issue, "ac-checklist.json"), example("ac-checklist"));
  writeFileSync(path.join(runDir, issue, "review-verdict.json"), example("review-verdict-anchored"));
}

export { cpSync };
