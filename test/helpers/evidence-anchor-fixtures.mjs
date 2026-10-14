// FAFF-1263: shared fixtures for the warn-only evidence-schema tests. Builds run dirs that mint through
// `faff events anchor`, with evidence documents copied from the shipped v0.3 valid examples.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { appendRecordUnderLock } = require("../../plugin/skills/faff/bin/lib/events.js");

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
