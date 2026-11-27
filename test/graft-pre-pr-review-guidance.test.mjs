import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the Step 9 signal table routes human judgement to a pre-PR park", () => {
  const skill = readFileSync(new URL("../plugin/skills/faff-graft/SKILL.md", import.meta.url), "utf8");
  const rows = skill.split("| Signal | Meaning | Autonomous action |")[1].split("\n\n")[0];
  assert.match(rows, /\| `needs-human` \|[^\n]+Park on the tracker issue before opening a PR/);
  assert.match(rows, /\| `pass` \|[^\n]+Step 9b, then the merge-confidence gate/);
  assert.doesNotMatch(rows, /flip.*draft|merge on green CI/i);
});
