import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { SLOT_TYPES, REQUIRED_METHODOLOGY_OUTPUTS } = require("../plugin/skills/faff/bin/lib/validate-adapters.js");

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), "faff-authoring-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function command(...args) {
  return runCli(["validate-adapters", ...args]);
}
function scaffold(root, slot, extra = []) {
  const name = "third-party-" + slot.replaceAll("_", "-");
  const file = join(root, name, "SKILL.md");
  const r = command("scaffold", "--slot", slot, "--name", name, "--description", 'Author a "quoted" example.', "--judgement-seam", "example-kind", "--path", file, ...extra);
  return { r, file, name };
}

test("each supported slot scaffold writes a structurally valid local layout and never overwrites it", (t) => {
  const root = temp(t);
  for (const slot of Object.keys(SLOT_TYPES)) {
    const { r, file, name } = scaffold(root, slot);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { path: file, slot });
    const text = readFileSync(file, "utf8");
    assert.match(text, /^---\nname: third-party-/);
    assert.match(text, /judgement_seam: example-kind/);
    assert.ok(text.includes(String.raw`description: "Author a \"quoted\" example."`));
    assert.match(text, /author/i, "the scaffold labels its authoring placeholders");
    const checked = command("check", "--slot", slot, "--path", file);
    assert.equal(checked.code, 0, checked.stderr + checked.stdout);
    assert.deepEqual(JSON.parse(checked.stdout), { signal: "pass", scope: "structural", slot, path: file, violations: [] });
    const byName = command("check", "--slot", slot, "--skill", `foreign:${name}`, "--skills-dir", root);
    assert.equal(byName.code, 0, byName.stderr + byName.stdout);
    assert.equal(scaffold(root, slot).r.code, 2);
    assert.equal(readFileSync(file, "utf8"), text);
  }
});

test("specific fixtures preserve pure render, producer, methodology and mechanism profiles", (t) => {
  const root = temp(t);
  const content = (slot) => {
    const { r, file } = scaffold(root, slot);
    assert.equal(r.code, 0, r.stderr);
    return readFileSync(file, "utf8");
  };
  const render = content("rendering_adaptor");
  assert.match(render, /no internal contract/);
  assert.doesNotMatch(render, /How this contract reaches you/);
  const routing = content("routing_adaptor");
  assert.match(routing, /faff contract automation-routing/);
  assert.match(routing, /sole source of contract data/);
  const contentOnce = content("methodology");
  for (const heading of REQUIRED_METHODOLOGY_OUTPUTS) assert.ok(contentOnce.includes(heading));
  assert.match(content("concurrency"), /foreground-to-terminal/);
  assert.match(content("review"), /faff-contract:review-verdict/);
  assert.doesNotMatch(content("adr"), /faff-contract:/);

});

test("targeted checks fail on foreign files without rewriting them and do not accept ambiguous input", (t) => {
  const root = temp(t);
  const file = join(root, "SKILL.md");
  const broken = "---\nname: foreign-routing\n---\n# Foreign routing\n";
  writeFileSync(file, broken);
  const r = command("check", "--slot", "routing_adaptor", "--path", root);
  assert.equal(r.code, 1, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual([report.signal, report.scope, report.path], ["fail", "structural", file]);
  assert.ok(report.violations.some((v) => v.includes("refer-back")));
  assert.ok(report.violations.some((v) => v.includes("judgement_seam")));
  assert.equal(readFileSync(file, "utf8"), broken);
  assert.equal(command("check", "--slot", "unknown", "--path", file).code, 2);
  assert.equal(command("check", "--slot", "review", "--path", file, "--skill", "foreign").code, 2);
  assert.equal(command("check", "--slot", "review", "--skill", "../outside", "--skills-dir", root).code, 2);
  assert.equal(scaffold(root, "unknown").r.code, 2);
  const target = join(root, "outside", "SKILL.md");
  assert.equal(command("scaffold", "--slot", "review", "--name", "../outside", "--description", "x", "--judgement-seam", "none", "--path", target).code, 2);
  assert.equal(existsSync(target), false);
});
