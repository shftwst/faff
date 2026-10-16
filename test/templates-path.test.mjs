// FAFF-1300: `faff config templates-path`: the single resolver for committed template overrides.
// Every case drives the real CLI, so the once-per-process notice latch is fresh by construction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

function cli(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const tmpRoot = () => mkdtempSync(join(tmpdir(), "faff1300-"));
const mk = (root, ...dirs) => dirs.forEach((d) => mkdirSync(join(root, d), { recursive: true }));
const FALLBACK_REMEDY = "git mv .faff-templates .faff/templates";

test("only the canonical directory: resolves it, silent", () => {
  const root = tmpRoot();
  mk(root, ".faff/templates");
  const r = cli(["config", "templates-path", "--root", root], root);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, ".faff/templates\n");
  assert.equal(r.stderr, "");
});

test("only the deprecated directory: resolves it with the directory-level notice on stderr", () => {
  const root = tmpRoot();
  mk(root, ".faff-templates");
  const r = cli(["config", "templates-path", "--root", root], root);
  assert.equal(r.stdout, ".faff-templates\n");
  assert.ok(r.stderr.includes(FALLBACK_REMEDY));
  assert.equal(r.stderr.trim().split("\n").filter((l) => l.startsWith("faff:")).length, 1);
});

test("both directories: canonical wins, the shadowed notice gives a file-level remedy", () => {
  const root = tmpRoot();
  mk(root, ".faff/templates", ".faff-templates");
  const r = cli(["config", "templates-path", "--root", root], root);
  assert.equal(r.stdout, ".faff/templates\n");
  assert.match(r.stderr, /are deprecated and are now ignored/);
  assert.ok(!r.stderr.includes(FALLBACK_REMEDY));
  assert.match(r.stderr, /Do not `git mv` the whole directory/);
});

test("neither directory: canonical answer, silent, nothing created", () => {
  const root = tmpRoot();
  const r = cli(["config", "templates-path", "--root", root], root);
  assert.equal(r.stdout, ".faff/templates\n");
  assert.equal(r.stderr, "");
  assert.equal(existsSync(join(root, ".faff")), false);
});

test("a configured value wins outright: no fallback, no notice, trailing slash stripped", () => {
  const root = tmpRoot();
  mk(root, ".faff-templates");
  writeFileSync(join(root, ".faffrc.yaml"), "tracking:\n  templates_path: records/tpl/\n");
  const r = cli(["config", "templates-path", "--root", root], root);
  assert.equal(r.stdout, "records/tpl\n");
  assert.equal(r.stderr, "");
});

test("--create makes the resolved directory and never the deprecated one", () => {
  const root = tmpRoot();
  const r = cli(["config", "templates-path", "--create", "--root", root], root);
  assert.equal(r.code, 0);
  assert.ok(existsSync(join(root, ".faff", "templates")));
  assert.equal(existsSync(join(root, ".faff-templates")), false);
});

test("--absolute prints the directory joined onto the root, from any working directory", () => {
  const root = tmpRoot();
  const elsewhere = tmpRoot();
  mk(root, ".faff/templates");
  assert.equal(cli(["config", "templates-path", "--absolute", "--root", root], elsewhere).stdout, join(root, ".faff/templates") + "\n");
  writeFileSync(join(root, ".faffrc.yaml"), "tracking:\n  templates_path: /etc/faff\n");
  assert.equal(cli(["config", "templates-path", "--absolute", "--root", root], elsewhere).stdout, join(root, "/etc/faff") + "\n");
  writeFileSync(join(root, ".faffrc.yaml"), "tracking:\n  templates_path: ../shared/tpl\n");
  assert.equal(cli(["config", "templates-path", "--absolute", "--root", root], elsewhere).stdout, join(root, "../shared/tpl") + "\n");
  rmSync(root, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

test("stdout is one whitespace-free line in default and --absolute forms", () => {
  const root = tmpRoot();
  mk(root, ".faff-templates");
  for (const flag of [[], ["--absolute"]]) {
    const out = cli(["config", "templates-path", ...flag, "--root", root], root).stdout;
    assert.match(out, /^\S+\n$/);
  }
});

test("config set / get round-trips tracking.templates_path", () => {
  const root = tmpRoot();
  const set = cli(["config", "set", "tracking.templates_path", "records/tpl", "--root", root], root);
  assert.equal(set.code, 0, set.stderr);
  const get = cli(["config", "get", "tracking.templates_path", "--root", root], root);
  assert.equal(get.stdout.trim(), "records/tpl");
});
