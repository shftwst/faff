// FAFF-1443: both bundled `spec` producers state one scenario format, and every fenced scenario example in
// their Scenarios section is read by both counters: `dod classify` classes each unit `scenario` and
// `faff admissible`'s R1 counts one per example. The negative pins hold the FAFF-1431 bullet form at
// prose / R1 0, so widening either counter later is a visible, deliberate test change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(HERE, "..", "plugin", "skills");
const { dodClassify, parseScenarios, admissibleVerdict } = require("../plugin/skills/faff/bin/lib/admissibility.js");

const PRODUCERS = [
  { skill: "faffter-noon-spec", heading: /^### Scenarios\b/ },
  { skill: "faffter-dark-nlspec", heading: /^### 5\. SCENARIOS\b/ },
];

// The producer's Scenarios section: from its heading to the next heading of the same or higher level.
function scenariosSection(text, heading) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  assert.ok(start >= 0, `no Scenarios heading matching ${heading}`);
  const level = /^(#+)/.exec(lines[start])[1].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+)\s/.exec(lines[i]);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start + 1, end);
}

// Every plain or `holdout` fenced block in the section whose first line starts with Given, dedented. Both
// forms are ones the format rule permits, so neither may be skipped.
function scenarioExamples(section) {
  const examples = [];
  for (let i = 0; i < section.length; i++) {
    const open = /^(\s*)```(?:holdout)?\s*$/.exec(section[i]);
    if (!open) continue;
    const indent = open[1].length;
    const body = [];
    let j = i + 1;
    for (; j < section.length && !/^\s*```\s*$/.test(section[j]); j++) body.push(section[j].slice(indent));
    if (body.length && /^Given\b/.test(body[0])) examples.push(body);
    i = j;
  }
  return examples;
}

const minimalSpec = (units) => [
  "# EX: producer example", "", "## Scenarios", "", ...units, "", "## 7. DONE", "", "- [ ] `faff x` exits 0", "", "confidence: high", "",
].join("\n");

for (const { skill, heading } of PRODUCERS) {
  const text = readFileSync(join(SKILLS, skill, "SKILL.md"), "utf8");

  test(`${skill}: every fenced Scenarios example is a scenario to classify and counts once for R1`, () => {
    const examples = scenarioExamples(scenariosSection(text, heading));
    assert.ok(examples.length >= 1, "the Scenarios section carries at least one fenced example");
    const spec = minimalSpec(examples.flatMap((body) => ["```", ...body, "```", ""]));
    const held = minimalSpec(["```", "Given a held example", "When it runs", "Then it passes", "```", "", "```holdout", ...examples[0], "```", ""]);
    assert.equal(scenarioExamples(held.split("\n")).length, 2, "the extractor reads a holdout fence too");
    assert.equal(parseScenarios(held), 2);
    const units = dodClassify(spec).criteria.filter((c) => c.source === "scenarios");
    assert.equal(units.length, examples.length);
    for (const u of units) assert.equal(u.class, "scenario", u.text);
    assert.equal(parseScenarios(spec), examples.length);
    assert.equal(admissibleVerdict(spec, true).admissible, true);
  });

  test(`${skill}: states the one-format rule and names the forms the counters do not read`, () => {
    const section = scenariosSection(text, heading).join("\n");
    assert.match(section, /own fenced block/);
    assert.match(section, /capitalised `Given`, `When`, `Then` or `And`/);
    assert.match(section, /bulleted scenario/);
    assert.match(section, /bold keywords/);
    assert.match(section, /lowercase `then`/);
  });
}

test("negative pins: the FAFF-1431 bullet form is prose with R1 0; bold lines and a one-line bullet count 0 for R1", () => {
  const bullet = minimalSpec(["- **Given** a, **when** b, **then** c"]);
  assert.equal(dodClassify(bullet).criteria.find((c) => c.source === "scenarios").class, "prose");
  assert.equal(parseScenarios(bullet), 0);
  assert.equal(parseScenarios(minimalSpec(["- Given a When b Then c"])), 0);
  assert.equal(parseScenarios(minimalSpec(["**Given** a", "**When** b", "**Then** c"])), 0);
  assert.equal(admissibleVerdict(bullet, true).admissible, false);
});

test("the noon self-review treats an R1 refusal with Scenarios units as a major finding", () => {
  const text = readFileSync(join(SKILLS, "faffter-noon-spec", "SKILL.md"), "utf8");
  assert.match(text, /R1 refusal \(`born-verifiable scenario\(s\)`\) while the Scenarios section has at least one unit is a `major` format finding/);
});
