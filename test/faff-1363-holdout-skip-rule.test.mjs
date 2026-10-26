// FAFF-1363 — graft's holdout_offer (Step 6) and holdout_run (Step 8c) in faff-graft/SKILL.md must skip
// the code-blind holdout whenever judged_count == 0, regardless of integration_count. The old rule
// required BOTH judged_count == 0 AND integration_count == 0, so an integration-tier-only spec
// (judged_count 0, integration_count > 0) still ran the holdout and mis-aggregated to needs-human
// ("nothing was judged at all"). This is a static-text regression guard over the committed SKILL.md
// (the fix is prose-only, no code path changed) plus a live `faff dod classify` sanity check over the
// exact facts the corrected rule depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const SKILL = join(REPO, "plugin", "skills", "faff-graft", "SKILL.md");

const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", input });

// Extract a fenced ``` ... ``` block whose first line contains `marker` (e.g. "PROCEDURE holdout_offer").
function extractProcedure(text, marker) {
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.includes(marker));
  assert.ok(startIdx >= 0, `could not find a line containing ${JSON.stringify(marker)} in faff-graft/SKILL.md`);
  // Walk backward to the opening fence, forward to the closing fence.
  let open = startIdx;
  while (open > 0 && lines[open].trim() !== "```") open--;
  let close = startIdx;
  while (close < lines.length && lines[close].trim() !== "```") close++;
  assert.ok(lines[open].trim() === "```" && lines[close].trim() === "```", `could not bound the fenced block around ${JSON.stringify(marker)}`);
  return lines.slice(open + 1, close).join("\n");
}

test("FAFF-1363: faff-graft/SKILL.md no longer states the old two-count skip rule anywhere", () => {
  const text = readFileSync(SKILL, "utf8");
  assert.doesNotMatch(text, /judged_count == 0 AND integration_count == 0/, "the old buggy conjunct must not survive anywhere in faff-graft/SKILL.md");
  assert.doesNotMatch(text, /judged_count==0 AND integration_count==0/, "the old buggy invariant comment must not survive anywhere in faff-graft/SKILL.md");
});

test("FAFF-1363: Step 6 holdout_offer skips on judged_count == 0 alone", () => {
  const block = extractProcedure(readFileSync(SKILL, "utf8"), "PROCEDURE holdout_offer");
  const skipLine = block.split("\n").find((l) => l.includes("decision: skip"));
  assert.ok(skipLine, "holdout_offer must have a line producing decision: skip");
  assert.match(skipLine, /judged_count == 0/);
  assert.doesNotMatch(skipLine, /integration_count/, "the skip condition must not reference integration_count");
});

test("FAFF-1363: Step 8c holdout_run — the SOLE live skip gate — skips on judged_count == 0 alone", () => {
  const block = extractProcedure(readFileSync(SKILL, "utf8"), "PROCEDURE holdout_run");
  const skipLine = block.split("\n").find((l) => /SOLE skip gate/.test(l));
  assert.ok(skipLine, "holdout_run must carry the SOLE-skip-gate line");
  assert.match(skipLine, /judged_count == 0/);
  assert.doesNotMatch(skipLine, /judged_count == 0 AND integration_count/, "the live skip gate must not require integration_count == 0 too");
});

test("FAFF-1363: Step 10's absent-verdict prose no longer implies an integration-tier criterion blocks the skip", () => {
  const text = readFileSync(SKILL, "utf8");
  assert.doesNotMatch(text, /nothing judged and no integration-tier criterion/, "the stale Step 10 phrasing must be corrected");
  assert.match(text, /nothing judged.*integration-tier-only spec/, "Step 10 must name an integration-tier-only spec as a legitimate skip cause");
});

test("FAFF-1363: faff dod classify facts — an integration-tier-only spec has judged_count 0 and integration_count > 0 (the live input the corrected rule depends on)", () => {
  const integrationOnly = ["## Scenarios", "", "```integration", "Given a", "When b", "Then c", "```", "", "## 8. DONE", "", "- [ ] operators like it"].join("\n");
  const r = run(["dod", "classify", "--spec", "-", "--json"], integrationOnly);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.judged_count, 0, "an integration-tier-only spec has nothing for the holdout to judge");
  assert.ok(out.integration_count > 0, "an integration-tier-only spec has at least one integration-tier criterion");
});

test("FAFF-1363: faff dod classify facts — a spec with any judged criterion is never the skip case, regardless of integration_count", () => {
  const mixed = ["## Scenarios", "", "```", "Given a", "When b", "Then c", "```", "", "```integration", "Given x", "When y", "Then z", "```", "", "## 8. DONE", "", "- [ ] operators like it"].join("\n");
  const r = run(["dod", "classify", "--spec", "-", "--json"], mixed);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.judged_count > 0, "a mixed spec retains at least one judged criterion");
  assert.ok(out.integration_count > 0, "the mixed fixture also carries an integration-tier criterion, to show it does not matter either way");
});
