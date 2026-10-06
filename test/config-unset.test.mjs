// FAFF-1201 -- `faff config unset` through the real CLI: exact file text after each edit, the
// exit-code contract, the list and inline-map refusals, the other-file note, and the selftest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

function run(cwd, ...args) {
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function repo(base, local) {
  const dir = mkdtempSync(join(tmpdir(), "faff1201-"));
  if (base !== undefined) writeFileSync(join(dir, ".faffrc.yaml"), base);
  if (local !== undefined) writeFileSync(join(dir, ".faffrc.local.yaml"), local);
  return dir;
}
const base = (dir) => readFileSync(join(dir, ".faffrc.yaml"), "utf8");
const overlay = (dir) => readFileSync(join(dir, ".faffrc.local.yaml"), "utf8");

test("unset removes a block and keeps the surrounding comments and separators", () => {
  const dir = repo("tracking:\n  provider: linear\n\n# model lanes\nmodels:\n  build: sonnet\n  # legacy\n  spec: opus\n\nappetite: small\n");
  const r = run(dir, "config", "unset", "models");
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), "config unset: removed models from .faffrc.yaml.");
  assert.equal(base(dir), "tracking:\n  provider: linear\n\n# model lanes\n\nappetite: small\n");
});

test("unset works outside WRITABLE_NAMESPACES (no namespace guard)", () => {
  const dir = repo("legacy_tree:\n  a: 1\nappetite: small\n");
  assert.equal(run(dir, "config", "unset", "legacy_tree").code, 0);
  assert.equal(base(dir), "appetite: small\n");
});

test("unset --local edits only the overlay and notes the base still sets the key", () => {
  const dir = repo("effort:\n  build: high\n", "effort:\n  build: low\nslots:\n  spec: x\n");
  const r = run(dir, "config", "unset", "effort", "--local");
  assert.equal(r.code, 0);
  assert.equal(overlay(dir), "slots:\n  spec: x\n");
  assert.equal(base(dir), "effort:\n  build: high\n");
  assert.match(r.err, /note: effort is still set in \.faffrc\.yaml/);
});

test("unset on the base notes a lingering overlay value; no note when the other file is clean", () => {
  const noted = repo("models:\n  build: sonnet\n", "models:\n  build: opus\n");
  assert.match(run(noted, "config", "unset", "models").err, /note: models is still set in \.faffrc\.local\.yaml/);
  const quiet = repo("models:\n  build: sonnet\n", "slots:\n  spec: x\n");
  assert.equal(run(quiet, "config", "unset", "models").err, "");
});

test("unset prunes emptied parents and names them", () => {
  const dir = repo("dispatch:\n  spec:\n    effort: low\n");
  const r = run(dir, "config", "unset", "dispatch.spec.effort");
  assert.equal(r.code, 0);
  assert.match(r.out, /Pruned empty dispatch\.spec, dispatch\./);
  assert.equal(base(dir), "");
});

test("unset handles a 4-space-indented body", () => {
  const dir = repo("a:\n    b:\n        c: 1\n    d: 2\n");
  assert.equal(run(dir, "config", "unset", "a.b.c").code, 0);
  assert.equal(base(dir), "a:\n    d: 2\n");
});

test("--dry-run prints the edited text and leaves the file byte-identical", () => {
  const text = "a: 1\nmodels:\n  build: x\n";
  const dir = repo(text);
  const r = run(dir, "config", "unset", "models", "--dry-run");
  assert.equal(r.code, 0);
  assert.equal(r.out, "a: 1\n");
  assert.equal(base(dir), text);
});

test("null leaves (key: and key: null) are removed", () => {
  for (const line of ["models:", "models: null"]) {
    const dir = repo(`a: 1\n${line}\nb: 2\n`);
    assert.equal(run(dir, "config", "unset", "models").code, 0);
    assert.equal(base(dir), "a: 1\nb: 2\n");
  }
});

test("usage errors exit 2", () => {
  const dir = repo("a: 1\n");
  for (const args of [[], ["a", "b"], ["a..b"], ["a."]]) {
    const r = run(dir, "config", "unset", ...args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, /requires exactly one <dotted\.key>/);
  }
});

test("a missing target exits 3 and creates nothing", () => {
  const dir = repo(undefined);
  assert.equal(run(dir, "config", "unset", "models").code, 3);
  assert.equal(existsSync(join(dir, ".faffrc.yaml")), false);
  const withBase = repo("a: 1\n");
  const r = run(withBase, "config", "unset", "models", "--local");
  assert.equal(r.code, 3);
  assert.equal(existsSync(join(withBase, ".faffrc.local.yaml")), false);
});

test("absent key, absent ancestor and scalar ancestor exit 3 and leave the file alone", () => {
  const text = "tracking: foo\na:\n  b: 1\n";
  const dir = repo(text);
  for (const key of ["a.c", "x.y", "tracking.provider", "zz"]) {
    const r = run(dir, "config", "unset", key);
    assert.equal(r.code, 3, key);
    assert.match(r.err, new RegExp(`'${key.replace(".", "\\.")}' is not set in \\.faffrc\\.yaml`));
    assert.equal(base(dir), text);
  }
});

test("list-valued keys by name and by shape exit 2 and leave the file alone", () => {
  const text = "tracking:\n  teams:\n    - A\n    - B\nk: [a, b]\nj: [\"a\",\"b\"]\nother:\n  items:\n    - x\n";
  const dir = repo(text);
  for (const key of ["tracking.teams", "adversarial.refs", "adversarial.spec_review.refs", "tracking.team_routing.x", "k", "j", "other.items"]) {
    const r = run(dir, "config", "unset", key);
    assert.equal(r.code, 2, key);
    assert.match(r.err, /list-valued key/);
    assert.equal(base(dir), text);
  }
});

test("an unindented block sequence is refused as list-valued and the file is untouched", () => {
  const text = "teams:\n- A\nz: 1\n";
  const dir = repo(text);
  const r = run(dir, "config", "unset", "teams");
  assert.equal(r.code, 2);
  assert.match(r.err, /list-valued key/);
  assert.equal(base(dir), text);
});

test("a shallower comment inside a block does not hide later keys", () => {
  const text = "a:\n  b: 1\n# old\n  c: 2\nz: 1\n";
  const leaf = repo(text);
  assert.equal(run(leaf, "config", "unset", "a.c").code, 0);
  assert.equal(base(leaf), "a:\n  b: 1\n# old\nz: 1\n");
  const whole = repo(text);
  assert.equal(run(whole, "config", "unset", "a").code, 0);
  assert.equal(base(whole), "z: 1\n");
});

test("an inherited property name is not a key", () => {
  const dir = repo("a: {\"b\": 1}\n");
  assert.equal(run(dir, "config", "unset", "a.toString").code, 3);
});

test("a block scalar whose text starts with a dash is not a list", () => {
  const dir = repo("notes: |\n  - item one\nz: 1\n");
  assert.equal(run(dir, "config", "unset", "notes").code, 0);
  assert.equal(base(dir), "z: 1\n");
});

test("a map subtree that holds a list is removed whole", () => {
  const dir = repo("adversarial:\n  refs:\n    - a\n  timeout: 5\nz: 1\n");
  assert.equal(run(dir, "config", "unset", "adversarial").code, 0);
  assert.equal(base(dir), "z: 1\n");
});

test("inline flow map: ancestor refused, leaf removed, partial path absent", () => {
  const text = "a: {\"b\": 1}\ninfra: {\"x\": 1}\n";
  const dir = repo(text);
  const refused = run(dir, "config", "unset", "a.b");
  assert.equal(refused.code, 2);
  assert.match(refused.err, /'a' is an inline map; unset 'a' instead/);
  assert.equal(run(dir, "config", "unset", "a.b.c").code, 3);
  assert.equal(base(dir), text);
  assert.equal(run(dir, "config", "unset", "infra").code, 0);
  assert.equal(base(dir), "a: {\"b\": 1}\n");
});

test("a duplicate key fails the round-trip proof: exit 2, no write, no values in the message", () => {
  const text = "models:\n  a: 1111\nmodels:\n  b: 2222\n";
  const dir = repo(text);
  const r = run(dir, "config", "unset", "models");
  assert.equal(r.code, 2);
  assert.match(r.err, /internal error, edited text does not round-trip \(differs at models\.b/);
  assert.doesNotMatch(r.err, /1111|2222/);
  assert.equal(base(dir), text);
});

test("config and config bogus list unset in the verb list", () => {
  const dir = repo("a: 1\n");
  assert.match(run(dir, "config").err, /unset/);
  assert.match(run(dir, "config", "bogus").err, /unset/);
});

test("integration smoke: base and overlay, dry run, prune, then already-gone", () => {
  const dir = repo(
    "tracking:\n  provider: linear\n\nmodels:\n  build: sonnet\n\ndispatch:\n  spec:\n    effort: low\n",
    "models:\n  build: opus\n");
  const dry = run(dir, "config", "unset", "models", "--dry-run");
  assert.equal(dry.code, 0);
  assert.doesNotMatch(dry.out, /models:/);
  assert.match(base(dir), /models:/);
  const first = run(dir, "config", "unset", "models");
  assert.equal(first.code, 0);
  assert.match(first.err, /models is still set in \.faffrc\.local\.yaml/);
  assert.equal(run(dir, "config", "unset", "models", "--local").code, 0);
  assert.equal(overlay(dir), "");
  const pruned = run(dir, "config", "unset", "dispatch.spec.effort");
  assert.match(pruned.out, /Pruned empty dispatch\.spec, dispatch\./);
  assert.equal(run(dir, "config", "unset", "models").code, 3);
  assert.equal(base(dir), "tracking:\n  provider: linear\n");
});

test("config unset --selftest passes", () => {
  const r = run(HERE, "config", "unset", "--selftest");
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS \(config unset, 0 failed\)/);
});
