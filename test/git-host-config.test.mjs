// FAFF-430 — shrink the `git_host` promise to GitHub-only. `.faffrc` advertised
// `git_host: github | gitlab | gitea`, but the merge floor (merge-gate.js) is unconditionally
// `gh` — a configured non-github host was silent config theater: branch/commit ops look fine,
// then the merge gate is silently GitHub-shaped. This constrains `tracking.git_host` to the
// closed allowlist `{ "github" }` at all three config-validation enforcement points — `config
// get` (read, exit 2), `config set` / `config init --set` (write, refused, file byte-unchanged),
// and `config check` (an `error` finding, exit 1) — mirroring the existing validateModelLane /
// validateEffortLane closed-vocab pattern. Unset stays fully valid throughout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

function run(cwd, ...args) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString() };
  }
}

function fixtureDir(faffrcBody) {
  const dir = mkdtempSync(join(tmpdir(), "faff430-"));
  if (faffrcBody !== undefined) writeFileSync(join(dir, ".faffrc.yaml"), faffrcBody);
  return dir;
}

// ---------------------------------------------------------------------------
// Read time — `faff config get tracking.git_host`
// ---------------------------------------------------------------------------

test("config get tracking.git_host: github exits 0 and prints github", () => {
  const dir = fixtureDir("tracking:\n  git_host: github\n");
  try {
    const r = runCli(["config", "get", "tracking.git_host"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "github");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config get tracking.git_host: unset exits 3 (absent) — unset stays fully valid", () => {
  const dir = fixtureDir("tracking:\n  team_key: X\n");
  try {
    const r = runCli(["config", "get", "tracking.git_host"], { cwd: dir });
    assert.equal(r.code, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const bad of ["gitlab", "gitea", "GitHub", "github.com", "gh"]) {
  test(`config get tracking.git_host: "${bad}" fails loud (exit 2), names the value + github`, () => {
    const dir = fixtureDir(`tracking:\n  git_host: ${bad}\n`);
    try {
      const r = runCli(["config", "get", "tracking.git_host"], { cwd: dir });
      assert.equal(r.code, 2, `git_host "${bad}" must exit 2 (fail-loud), not silently pass`);
      assert.match(r.stderr, new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "message names the bad value");
      assert.match(r.stderr, /github/, "message names the legal set");
      assert.equal(r.stdout.trim(), "", "no value on stdout for an invalid host");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// ---------------------------------------------------------------------------
// Writer refusal — `faff config set` reuses the same read-time validator
// ---------------------------------------------------------------------------

test("config set tracking.git_host gitlab is refused (exit 2), no file written", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff430set-"));
  try {
    const r = run(dir, "config", "set", "tracking.git_host", "gitlab");
    assert.equal(r.code, 2);
    assert.match(r.err, /invalid host/);
    assert.match(r.err, /gitlab/);
    assert.equal(run(dir, "config", "path").code, 3, "no config file should exist");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config set tracking.git_host gitea on an existing file is refused, file byte-unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff430set2-"));
  const before = "tracking:\n  team_key: X\nappetite: high\n";
  writeFileSync(join(dir, ".faffrc.yaml"), before);
  try {
    const r = run(dir, "config", "set", "tracking.git_host", "gitea");
    assert.equal(r.code, 2);
    assert.match(r.err, /invalid host/);
    assert.equal(readFileSync(join(dir, ".faffrc.yaml"), "utf8"), before, "file must be byte-unchanged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config set tracking.git_host github succeeds", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff430set3-"));
  try {
    const r = run(dir, "config", "set", "tracking.git_host", "github");
    assert.equal(r.code, 0);
    assert.equal(run(dir, "config", "get", "tracking.git_host").out, "github");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Writer refusal — `faff config init --set tracking.git_host=<v>`
// ---------------------------------------------------------------------------

test("config init --set tracking.git_host=gitea is refused (exit 2), no file written", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff430init-"));
  try {
    const r = run(dir, "config", "init", "--set", "tracking.git_host=gitea");
    assert.equal(r.code, 2);
    assert.match(r.err, /invalid host/);
    assert.equal(run(dir, "config", "path").code, 3, "no config file should exist");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config init --set tracking.git_host=gitlab on an existing file is refused, file byte-unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff430init2-"));
  const before = "tracking:\n  team_key: X\n";
  writeFileSync(join(dir, ".faffrc.yaml"), before);
  try {
    const r = run(dir, "config", "init", "--set", "tracking.git_host=gitlab");
    assert.equal(r.code, 2);
    assert.match(r.err, /invalid host/);
    assert.equal(readFileSync(join(dir, ".faffrc.yaml"), "utf8"), before, "file must be byte-unchanged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config init --set tracking.git_host=github succeeds", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff430init3-"));
  try {
    const r = run(dir, "config", "init", "--set", "tracking.git_host=github");
    assert.equal(r.code, 0);
    assert.equal(run(dir, "config", "get", "tracking.git_host").out, "github");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// `config check` — a hand-edited base with a non-github git_host is an error finding
// ---------------------------------------------------------------------------

test("config check: a non-github git_host emits an error finding on tracking.git_host, exit 1", () => {
  const dir = fixtureDir("tracking:\n  git_host: gitlab\n");
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /tracking\.git_host/);
    assert.match(r.out, /not supported/);
    assert.match(r.out, /GitHub-only/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check --json: a non-github git_host reports an error-severity finding", () => {
  const dir = fixtureDir("tracking:\n  git_host: gitea\n");
  try {
    const r = run(dir, "config", "check", "--json");
    assert.equal(r.code, 1);
    const parsed = JSON.parse(r.out);
    assert.equal(parsed.ok, false);
    const finding = parsed.findings.find((f) => f.surface === "tracking.git_host");
    assert.ok(finding, "expected a finding on surface tracking.git_host");
    assert.equal(finding.severity, "error");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: git_host: github is clean for this key", () => {
  const dir = fixtureDir("tracking:\n  git_host: github\n");
  try {
    const r = run(dir, "config", "check", "--json");
    const parsed = JSON.parse(r.out);
    assert.ok(!parsed.findings.some((f) => f.surface === "tracking.git_host"), "github must not be flagged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: unset git_host emits no finding for this key", () => {
  const dir = fixtureDir("tracking:\n  team_key: X\n");
  try {
    const r = run(dir, "config", "check", "--json");
    const parsed = JSON.parse(r.out);
    assert.ok(!parsed.findings.some((f) => f.surface === "tracking.git_host"), "unset must not be flagged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Integration smoke test — the spec's §8 DONE procedure, end to end.
// ---------------------------------------------------------------------------

test("smoke: gitlab refused at get + check; github clean; gitea refused at set", () => {
  const dir = fixtureDir("tracking:\n  git_host: gitlab\n");
  try {
    let r = runCli(["config", "get", "tracking.git_host"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /github/);

    r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /tracking\.git_host/);

    writeFileSync(join(dir, ".faffrc.yaml"), "tracking:\n  git_host: github\n");
    r = runCli(["config", "get", "tracking.git_host"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "github");

    r = run(dir, "config", "check", "--json");
    const parsed = JSON.parse(r.out);
    assert.ok(!parsed.findings.some((f) => f.surface === "tracking.git_host"));

    r = run(dir, "config", "set", "tracking.git_host", "gitea");
    assert.equal(r.code, 2);
    assert.equal(readFileSync(join(dir, ".faffrc.yaml"), "utf8"), "tracking:\n  git_host: github\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
