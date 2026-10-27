// FAFF-1317: `--absolute` lives in the shared CONFIG_SPEC but is honoured only by
// `templates-path` (FAFF-1300). It must be refused on the known non-honouring verbs rather than
// accepted-but-ignored — the native-map set --type / bundle publish --bundle-store posture. Every
// case drives the real CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

function cli(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const tmpRoot = () => mkdtempSync(join(tmpdir(), "faff1317-"));

test("non-honouring verb (get): --absolute is refused with the templates-path-only message", () => {
  const root = tmpRoot();
  const r = cli(["config", "get", "appetite", "--absolute", "--root", root], root);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "faff config get: --absolute is a `templates-path`-only flag and is not accepted by `get`\n");
});

test("another non-honouring verb (path): the analogous refusal with the verb substituted in both positions", () => {
  const root = tmpRoot();
  const r = cli(["config", "path", "--absolute", "--root", root], root);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--absolute/);
  assert.match(r.stderr, /templates-path/);
  assert.equal(r.stderr, "faff config path: --absolute is a `templates-path`-only flag and is not accepted by `path`\n");
});

test("templates-path --absolute still prints the absolute path (behaviour unchanged)", () => {
  const root = tmpRoot();
  mkdirSync(join(root, ".faff", "templates"), { recursive: true });
  const r = cli(["config", "templates-path", "--absolute", "--root", root], root);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, join(root, ".faff/templates") + "\n");
});

test("templates-path with no flag still prints the repo-relative path", () => {
  const root = tmpRoot();
  mkdirSync(join(root, ".faff", "templates"), { recursive: true });
  const r = cli(["config", "templates-path", "--root", root], root);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, ".faff/templates\n");
});

test("unknown verb + --absolute falls through to the expected-one-of message (not the refusal)", () => {
  const root = tmpRoot();
  const r = cli(["config", "bogus-verb", "--absolute", "--root", root], root);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /expected one of/);
  assert.ok(!/templates-path`-only/.test(r.stderr), "must not be the --absolute refusal");
});

test("inherited-property name + --absolute falls through to expected-one-of (proves Object.hasOwn)", () => {
  const root = tmpRoot();
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const r = cli(["config", name, "--absolute", "--root", root], root);
    assert.equal(r.code, 2, `${name} should exit 2`);
    assert.match(r.stderr, /expected one of/, `${name} should hit expected-one-of`);
    assert.ok(!/templates-path`-only/.test(r.stderr), `${name} must not be the --absolute refusal`);
  }
});

test("--absolute before the verb: cmd is the literal --absolute, falls through to expected-one-of", () => {
  const root = tmpRoot();
  const r = cli(["config", "--absolute", "get", "appetite", "--root", root], root);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /expected one of/);
  assert.ok(!/templates-path`-only/.test(r.stderr), "must not be the --absolute refusal");
});

test("--absolute=x is a gate arity error before the guard is reached", () => {
  const root = tmpRoot();
  const r = cli(["config", "get", "appetite", "--absolute=x", "--root", root], root);
  assert.equal(r.code, 2);
  assert.ok(!/templates-path`-only/.test(r.stderr), "arity error, not the refusal");
});
