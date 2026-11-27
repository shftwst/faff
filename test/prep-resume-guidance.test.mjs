import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const skill = readFileSync(new URL("../plugin/skills/faff-prep/SKILL.md",import.meta.url),"utf8");

test("existing-spec prep keeps the build, review and intent boundaries", () => {
  const resume = skill.split("### Scenario B: Resume")[1].split("### Scenario C:")[0];
  for (const rule of ["Withhold build until incorporated", "Context alone allows build",
    "preserve the Step 1 spec before revision","Refresh files","review carried forward: paths only","lists path moves",
    "After reattachment","Decisions-register reconcile step"]) assert.ok(resume.includes(rule), rule);
});
test("interactive re-prep respects the parked run's authority", () => {
  const prep = skill.split("\n## Re-prepping\n")[1].split("## Tracker-less")[0];
  for (const rule of ["explicitly unparks","owner.run_dir","owner is live","ledger malformed",
    "park-reconsidered",'via:"interactive-reprep"',"warn if unchanged","only the marker and prep log"]) assert.ok(prep.includes(rule),rule);
});

test("automatic refresh keeps independent original bytes and compares the staged working file", () => {
  const section = skill.split("### Path 1")[1].split("### Path 2")[0];
  assert.ok(section.indexOf("Before narrowing, editing or staging") < section.indexOf("Stage `$after`"));
  for (const rule of ["Copy a local source byte for byte", "write a tracker-only body once",
    'carry-check --before "$before" --after "$after"', "a challenge or resolution always re-reviews",
    "Decisions-register reconcile step"]) assert.ok(section.includes(rule), rule);
});
