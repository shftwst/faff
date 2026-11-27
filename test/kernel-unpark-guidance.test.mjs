import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("kernel keeps the cause-specific recovery routes and clearing restrictions available on first load", () => {
  const kernel = readFileSync(new URL("../plugin/skills/faff/references/kernel.md", import.meta.url), "utf8");
  const section = kernel.split("### Unpark protocol (shared)")[1].split("### Sibling-skill invocation")[0];
  for (const requirement of [
    "faff-parked", "comment naming the human resolution", "/faff-prep", "--refresh", "On high confidence",
    "/faff-graft", "draft PR", "gap-blocked", "circular-blocked", "next tidy pass",
    "In Review/Done/Cancelled", "strip-ok", "In Progress alone cannot clear",
    "cited blocker shipped", "later Chosen/Decision", "autonomous park pattern",
    "remove the parked label and log the cause", "prep marker disposition", "run-ledger outcome",
    "Never auto-reopen a human or legacy park", "The git-only Unpark contract",
  ]) assert.ok(section.includes(requirement), requirement);
});
