import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "adr-promotion-source-"));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const call = (...args) => runCli(["adr", "promotion-source", "--root", root, ...args], {cwd:root});
  return { root, call };
}
function ok(result) {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("a known comment is authoritative, no spec scan or ADR write", t => {
  const {root, call} = fixture(t);
  writeFileSync(path.join(root, ".faffrc.yaml"), "adr:\n  mode: offer\n");
  const docPath = runCli(["config", "adr-docs-path", "--root", root], {cwd:root});
  assert.equal(docPath.code, 0);
  assert.deepEqual(ok(call("--tracker-intent")), {source:"tracker", adr_docs_path:docPath.stdout.trim()});
  assert.deepEqual(readdirSync(root), [".faffrc.yaml"]);
  assert.equal(call("--file", "unreadable.md", "--tracker-intent").code, 2);
  assert.equal(call().code, 2);
});

test("the spec fallback preserves the existing extractor's exact heading section", t => {
  const {root, call} = fixture(t);
  const body = "# Design\r\n## ADR promotion intent\r\nChosen: Keep X\r\n### Details\r\nWhy.\r\n## Out of section\r\nIgnore.\r\n";
  const spec = path.join(root, "issue.md");
  writeFileSync(spec, body);
  const prior = runCli(["adr","extract-intent","--root",root,"--file",spec], {cwd:root});
  const current = ok(call("--file", "issue.md"));
  assert.equal(prior.code, 0, prior.stderr);
  assert.equal(current.source, "spec");
  assert.equal(current.section.trimEnd(), prior.stdout.trimEnd());
  assert.match(current.section, /Keep X/);
  assert.doesNotMatch(current.section, /Out of section/);
  writeFileSync(spec, "## Not an intent\n");
  assert.deepEqual(ok(call("--file","issue.md")), {source:"absent"});
  rmSync(spec);
  const missing = call("--file","issue.md");
  assert.deepEqual(ok(missing), {source:"absent"});
  assert.match(missing.stderr, /could not read/);
});

test("off mode bypasses both sources, including an unreadable spec", t => {
  const {root, call} = fixture(t);
  writeFileSync(path.join(root, ".faffrc.yaml"), "adr:\n  mode: off\n");
  for (const argv of [["--tracker-intent"],["--file","missing.md"]]) {
    const r = call(...argv);
    assert.deepEqual(ok(r), {source:"off"});
    assert.equal(r.stderr, "");
  }
});

test("CLI discovery includes the selector and preserves other ADR verbs' flags", t => {
  const {root} = fixture(t);
  const surface = ok(runCli(["cli-surface", "--json"], {cwd:root}));
  assert.ok(surface.adr.flags.includes("--tracker-intent"));
  assert.ok(surface.adr.subcommands.includes("promotion-source"));
  assert.equal(runCli(["adr", "list", "--tracker-intent", "--root", root], {cwd:root}).code, 2);
});
