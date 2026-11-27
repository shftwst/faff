import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

test("prep entry schedules its six required references and completes partial reads", () => {
  const skill = readFileSync(new URL("../plugin/skills/faff-prep/SKILL.md",import.meta.url),"utf8");
  const entry = skill.split("## Configuration")[1].split("### Spec slot")[0];
  assert.deepEqual([...entry.matchAll(/faff\/references\/([a-z]+)\.md/g)].map(m => m[1]),
    ["kernel","tracker","autonomous","methodology","review","park"]);
  assert.match(entry,/first if absent this turn/);
  assert.match(entry,/Finish clipped or failed reads/);
  assert.match(entry,/inherits the gateway ambiently/);
});
