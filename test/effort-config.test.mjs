// FAFF-416 — per-lane reasoning-EFFORT selection: the `effort:` config surface.
// The effort counterpart to FAFF-315's `models:` lanes. Covers: registry defaults resolve
// (inherit); the closed vocabulary fails LOUD (exit 2, names value + legal set) on an invalid
// token — never a silent inherit; the HARD prep/spec + eval EXCLUSION (no such effort lane);
// `config resolved` echoes a non-default effort lane; and the no-config byte-identity.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function fixtureDir(faffrcBody) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff416-"));
  if (faffrcBody !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), faffrcBody);
  return dir;
}

test("effort.* registry defaults resolve to inherit with no config (byte-for-byte today)", () => {
  const dir = fixtureDir(); // no .faffrc at all
  try {
    for (const key of ["effort.build", "effort.methodology", "effort.intake"]) {
      const r = runCli(["config", "get", key], { cwd: dir });
      assert.equal(r.code, 0, `${key} exit`);
      assert.equal(r.stdout.trim(), "inherit", key);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config defaults --selftest covers the effort.* family + vocab table", () => {
  const r = runCli(["config", "defaults", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

test("a valid effort level resolves; an invalid one fails loud (exit 2, names value + legal set)", () => {
  const dir = fixtureDir("effort:\n  build: low\n  methodology: max\n  intake: bogus\n");
  try {
    assert.equal(runCli(["config", "get", "effort.build"], { cwd: dir }).stdout.trim(), "low");
    assert.equal(runCli(["config", "get", "effort.methodology"], { cwd: dir }).stdout.trim(), "max");
    const bad = runCli(["config", "get", "effort.intake"], { cwd: dir });
    assert.equal(bad.code, 2, "invalid effort token must exit 2 (fail-loud), not silently inherit");
    assert.match(bad.stderr, /bogus/, "message names the bad value");
    assert.match(bad.stderr, /inherit \| low \| medium \| high \| xhigh \| max/, "message names the legal set");
    assert.equal(bad.stdout.trim(), "", "no value on stdout for an invalid token");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a model token in an effort lane fails loud (the vocabularies are distinct)", () => {
  const dir = fixtureDir("effort:\n  build: sonnet\n");
  try {
    const bad = runCli(["config", "get", "effort.build"], { cwd: dir });
    assert.equal(bad.code, 2, "a model token is not a legal effort level");
    assert.match(bad.stderr, /sonnet/);
    assert.match(bad.stderr, /inherit \| low \| medium \| high \| xhigh \| max/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("HARD EXCLUSION: no prep/spec or eval effort lane exists (prep is pinned, not tunable)", () => {
  // These lanes have a MODEL lane (FAFF-372) but must have NO effort lane. With no such key in
  // DEFAULTS and none in config, `config get` reports the key absent (exit 3) — never inherits an
  // effort, and (crucially) a configured value under one of these keys is NOT vocabulary-validated
  // as an effort lane, so it is not silently treated as a tunable effort knob.
  const dir = fixtureDir(); // no .faffrc
  try {
    for (const key of ["effort.spec", "effort.spec_review", "effort.prep_explore", "effort.architecture", "effort.eval"]) {
      const r = runCli(["config", "get", key], { cwd: dir });
      assert.equal(r.code, 3, `${key} must be absent (no such lane), got exit ${r.code}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config resolved echoes a non-default effort lane (a pinned effort is visible, never silent)", () => {
  const dir = fixtureDir("effort:\n  build: low\n  methodology: high\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /effort build: low/);
    assert.match(r.stdout, /effort methodology: high/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config resolved with no effort config emits no effort line (no-config byte-identity)", () => {
  const dir = fixtureDir("tracking:\n  team_key: X\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /^effort /m, "an all-default run banner names no effort lane");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
