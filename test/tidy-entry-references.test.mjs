import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

test("tidy entry schedules its six required references and completes partial reads", () => {
  const skill = readFileSync(new URL("../plugin/skills/faff-tidy/SKILL.md",import.meta.url),"utf8");
  const entry = skill.split("## Configuration")[1].split("**Consuming-project")[0];
  assert.deepEqual([...entry.matchAll(/faff\/references\/([a-z]+)\.md/g)].map(m => m[1]),
    ["kernel","build","tracker","autonomous","methodology","park"]);
  assert.match(entry,/first if absent this turn/);
  assert.match(entry,/Finish clipped or failed reads/);
  assert.match(entry,/inherit the gateway ambiently/);
});
