import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

for (const skill of ["plot","map"]) {
  test(skill + " loads its own reference set before acting", () => {
    const file = new URL("../plugin/skills/faff-"+skill+"/SKILL.md",import.meta.url);
    const entry = readFileSync(file,"utf8").split("\n").find(s => s.startsWith("**Load the kernel first."));
    const reads = entry.split("Skip `faff/SKILL.md`")[0];
    const lanes = skill === "plot" ? ["tracker","autonomous","methodology","create","park"] : ["tracker","methodology"];
    assert.deepEqual([...reads.matchAll(/faff\/references\/(\w+)\.md/g)].map(m => m[1]),["kernel",...lanes]);
    assert.match(entry,/first if absent this turn/);
    assert.match(entry,/Finish clipped or failed reads/);
    if (skill !== "plot") assert.match(entry,/skip `faff\/references\/autonomous.md`/i);
  });
}
