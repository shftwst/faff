import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "./helpers/run-cli.mjs";

function setup(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "faff-template-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const templates = path.join(root, ".faff", "templates");
  mkdirSync(templates, { recursive: true });
  const fields = (type, args = [], input) => runCli(["native-map", "fields", "--root", root, "--type", type, ...args], { input, cwd: root });
  const mapped = () => {
    const out = runCli(["native-map", "set", "--root", root, "--team", "TEST", "--tracker", "linear", "--json"],
      { input: JSON.stringify({ mappings: { bug: { id: "template-id", name: "Bug: triage" } } }), cwd: root });
    assert.equal(out.code, 0, out.stderr);
  };
  return {root, templates, fields, mapped};
}

function ok(result) {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("built-in field order across the six supported ticket types", t => {
  const { fields } = setup(t);
  for (const [type, expected] of Object.entries({
    bug: ["Repro", "Expected", "Actual", "Scope"], feature: ["Why", "What", "Acceptance"],
    spike: ["Question", "Timebox", "Decision to make"], chore: ["What", "Why now"],
    epic: ["Outcome", "Child slices"], default: ["Why", "What"],
  })) assert.deepEqual(ok(fields(type)), { fields: [...expected, "Open questions"] });
  assert.equal(fields("../unrecognised").code, 2);
});

test("tracker identity, pinned native fields, committed override and built-in resolve in order", t => {
  const { root, templates, fields, mapped } = setup(t);
  writeFileSync(path.join(templates, "bug.md"), "instructions\n## Local A\n## Local B\n");
  mapped();
  assert.deepEqual(ok(fields("bug")), { id: "template-id", name: "Bug: triage" });
  const body = "## Repro\r\nbody\r\n~~~md\r\n## Example, not a field\r\n~~~\r\n### Nested\r\n## Actual\r\n## Repro\r\n";
  const native = path.join(root, "native.md");
  writeFileSync(native, body);
  const expected = { fields: ["Repro", "Actual", "Repro"] };
  assert.deepEqual(ok(fields("bug", ["--native-body", native])), expected);
  assert.deepEqual(ok(fields("bug", ["--native-body", "-"], body)), expected);
  assert.deepEqual(ok(fields("bug", ["--local"])), { fields: ["Local A", "Local B"] });
  const opaque = fields("bug", ["--native-body", "-"], "form only");
  assert.deepEqual(ok(opaque), { fields: ["Local A", "Local B"] });
  assert.match(opaque.stderr, /native template has no level-2 fields/);
  const missing = fields("bug", ["--native-body", path.join(root, "missing")]);
  assert.deepEqual(ok(missing), { fields: ["Local A", "Local B"] });
  assert.match(missing.stderr, /could not be read/);
  writeFileSync(path.join(templates, "bug.md"), "##   \n");
  const fallback = fields("bug", ["--local"]);
  assert.equal(ok(fallback).fields[0], "Repro");
  assert.match(fallback.stderr, /skipped.*override/);
});

test("configuration selects the templates directory; local selection is read-only", t => {
  const { root, fields } = setup(t);
  writeFileSync(path.join(root, ".faffrc.yaml"), "tracking:\n  templates_path: ticket/forms\n");
  const custom = path.join(root, "ticket", "forms");
  mkdirSync(custom, { recursive: true });
  writeFileSync(path.join(custom, "epic.md"), "## Outcome\n## Children\n");
  assert.deepEqual(ok(fields("epic", ["--local"])), { fields: ["Outcome", "Children"] });
  mkdirSync(path.join(custom, "default.md"));
  const unreadable = fields("default", ["--local"]);
  assert.deepEqual(ok(unreadable).fields, ["Why", "What", "Open questions"]);
  assert.match(unreadable.stderr, /skipped unreadable/);
  assert.equal(fields("epic", ["--local", "--native-body", "-"]).code, 2);
  assert.equal(fields("epic", ["--force"]).code, 2);
  assert.equal(runCli(["native-map", "get", "--local", "--root", root]).code, 2);
});
