// FAFF-695 — `faff tracker probe`: the deterministic pin-classifier the skills lean on
// when resolving tracker-vs-git-only under a deferred-tool harness (Codex). A CLI is
// MCP-blind, so it reports only the pin half (`pinned` | `unpinned`); the harness
// discovery + "unreachable this session" fail-loud live in skill prose. Exercises the
// real entrypoint via runCli (arg parsing, exit codes, --json seam) — per ADR 0002,
// assert the deterministic seam (stdout / exit / parsed JSON), never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runCli } from "./helpers/run-cli.mjs";

// A throwaway git repo with an optional .faffrc.yaml so loadConfig anchors there.
function tmpRepo(faffrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-tracker-"));
  spawnSync("git", ["-C", dir, "init", "-q"], { encoding: "utf8" });
  if (faffrc !== undefined) fs.writeFileSync(path.join(dir, ".faffrc.yaml"), faffrc);
  return dir;
}
const baseEnv = (extra = {}) => ({ ...process.env, ...extra });

test("tracker --selftest passes", () => {
  const { code } = runCli(["tracker", "--selftest"]);
  assert.equal(code, 0);
});

test("pinned tracker → resolution pinned (plain + json), exit 0", () => {
  const repo = tmpRepo("tracking:\n  tracker: linear\n");
  const plain = runCli(["tracker", "probe"], { cwd: repo, env: baseEnv() });
  assert.equal(plain.code, 0);
  assert.equal(plain.stdout.trim(), "pinned");

  const json = runCli(["tracker", "probe", "--json"], { cwd: repo, env: baseEnv() });
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.stdout), { pin: "linear", resolution: "pinned" });
});

test("no pin → resolution unpinned, exit 0", () => {
  const repo = tmpRepo("tracking:\n  team_key: FAFF\n");
  const { stdout, code } = runCli(["tracker", "probe", "--json"], { cwd: repo, env: baseEnv() });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), { pin: null, resolution: "unpinned" });
});

test("no config at all → unpinned, exit 0 (never a hard error)", () => {
  const repo = tmpRepo(); // no .faffrc.yaml
  const { stdout, code } = runCli(["tracker", "probe", "--json"], { cwd: repo, env: baseEnv() });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), { pin: null, resolution: "unpinned" });
});

test("blank pin value → unpinned (a whitespace pin is not an assertion)", () => {
  const repo = tmpRepo('tracking:\n  tracker: "   "\n');
  const { stdout, code } = runCli(["tracker", "probe", "--json"], { cwd: repo, env: baseEnv() });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), { pin: null, resolution: "unpinned" });
});

test("unknown verb → usage error exit 2", () => {
  const { code } = runCli(["tracker", "wat"]);
  assert.equal(code, 2);
});

test("missing verb → usage error exit 2", () => {
  const { code } = runCli(["tracker"]);
  assert.equal(code, 2);
});
