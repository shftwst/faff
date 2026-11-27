import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("unattended tracker guidance retains marker ownership, granularity and fresh human steering", () => {
  const text = readFileSync(new URL("../plugin/skills/faff/references/tracker.md", import.meta.url), "utf8");
  const section = text.split("### Tracker as the lights-out control plane")[1].split("### Spec discovery")[0];
  for (const marker of ["Spec-attach / promote", "Park", "Resolve-attempt-proceed", "Appetite-override",
    "Discovered-scope / chain-gap filing", "Terminal disposition", "The once-per-run run-summary digest"]) {
    assert.ok(section.includes("**" + marker + "**"), marker);
  }
  assert.match(section, /Before acting on any ticket, including factory-created tickets, fetch its current state and incorporate human edits/);
  assert.match(section, /Graft records and returns without tracker writes/);
  assert.match(section, /Never file vague discovered scope/);
  assert.match(section, /CI polls in .*logs and the run digest only/);
});
