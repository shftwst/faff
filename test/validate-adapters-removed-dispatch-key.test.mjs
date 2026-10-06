// FAFF-1198 — the removed-dispatch-key lint in `faff validate-adapters`. Skill prompt text and
// reference files must not name a removed `models.*` / `effort.*` key or `faff models|effort build-for`,
// and must not read `dispatch.*` with `faff config get` (sites resolve through `faff dispatch resolve`).
// Fixture skills live in a throwaway skills dir (modeled on validate-adapters-prose-defaults.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

function runOnFixture(skillBody, referenceBody) {
  const dir = mkdtempSync(join(tmpdir(), "faff-removedkey-"));
  const skill = join(dir, "zz-removedkey-fixture");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), skillBody);
  if (referenceBody !== undefined) {
    mkdirSync(join(skill, "references"));
    writeFileSync(join(skill, "references", "lane.md"), referenceBody);
  }
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}
const flagged = (r) => /\(removed dispatch key\)/.test(r.stdout);

test("pattern A: flags a removed models.<lane> key in SKILL.md", () => {
  const r = runOnFixture("Resolve `faff config get models.spec` before dispatch.\n");
  assert.ok(flagged(r));
  assert.match(r.stdout, /FAIL {2}zz-removedkey-fixture \(removed dispatch key\)/);
  assert.match(r.stdout, /line 1: models\.spec was removed/);
  assert.notEqual(r.status, 0);
});

test("pattern A: flags every removed key family, including the matcher trees and placeholders", () => {
  for (const text of [
    "models.build_by_confidence", "models.build_by_tier.complex", "effort.build_by_tier", "effort.build", "models.prep_explore",
    "effort.methodology", "models.<lane>", "effort.<slot>", "models.adr", "effort.architecture",
  ]) {
    assert.ok(flagged(runOnFixture(`The lane reads ${text} at dispatch.\n`)), text);
  }
});

test("pattern A: flags a removed key in a references/*.md file, naming the file", () => {
  const r = runOnFixture("Clean skill text.\n", "Read models.methodology here.\n");
  assert.ok(flagged(r));
  assert.match(r.stdout, /zz-removedkey-fixture\/references\/lane\.md \(removed dispatch key\)/);
});

test("pattern A negative: eval, dispatch, data.effort and engine.effort keys pass", () => {
  const r = runOnFixture([
    "Set eval.model and eval.effort in the eval block.",
    "Read dispatch.spec.model and dispatch.build.by_tier.complex.effort.",
    "The event tags data.effort and the engine reports engine.effort.",
    "Run `faff config set dispatch.spec.effort low`.",
    "",
  ].join("\n"));
  assert.equal(flagged(r), false, r.stdout);
});

test("pattern B: flags faff models build-for and faff effort build-for", () => {
  for (const verb of ["faff models build-for --tier complex", "faff effort build-for --tier complex"]) {
    const r = runOnFixture(`Run \`${verb}\` per issue.\n`);
    assert.ok(flagged(r), verb);
    assert.match(r.stdout, /was removed; use faff dispatch resolve build/);
  }
});

test("pattern C: flags a faff config get read of a dispatch key", () => {
  const r = runOnFixture("Read `faff config get dispatch.spec.model` at the site.\n");
  assert.ok(flagged(r));
  assert.match(r.stdout, /dispatch sites read dispatch: through faff dispatch resolve/);
  assert.ok(flagged(runOnFixture("Run faff config get dispatch.build.model first.\n")));
});

test("pattern C negative: faff dispatch resolve and a config set of a dispatch key pass", () => {
  const r = runOnFixture("Run `faff dispatch resolve spec`; operators tune it with `faff config set dispatch.spec.effort low`.\n");
  assert.equal(flagged(r), false, r.stdout);
});

test("a clean fixture with a clean reference file does not trip the lint", () => {
  assert.equal(flagged(runOnFixture("Lean text.\n", "Reference text naming dispatch.<lane>.model.\n")), false);
});
