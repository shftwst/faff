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

test("effort: has no spec/prep lane, so an unset effort.spec reads as absent (the lane lives under dispatch:)", () => {
  // These lanes have a MODEL lane (FAFF-372) but no key in the old effort: tree (FAFF-1197 sets their
  // effort at dispatch.<lane>.effort). With no such key in DEFAULTS and none in config, `config get`
  // reports the key absent (exit 3), never inheriting an effort.
  const dir = fixtureDir(); // no .faffrc
  try {
    for (const key of ["effort.spec", "effort.spec_review", "effort.prep_explore", "effort.architecture", "effort.adr"]) {
      const r = runCli(["config", "get", key], { cwd: dir });
      assert.equal(r.code, 3, `${key} must be absent (no such lane), got exit ${r.code}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a hand-set effort.<dispatch lane> key is fail-loud and names dispatch.<lane>.effort, never a silent echo", () => {
  // A user who hand-writes a non-tunable effort key into .faffrc must be told where it belongs
  // (dispatch.<lane>.effort), never have the value silently echoed as a live knob no resolver reads.
  for (const [key, body, pointer] of [
    ["effort.spec", "effort:\n  spec: low\n", /dispatch\.spec\.effort/],
    ["effort.spec_review", "effort:\n  spec_review: low\n", /dispatch\.spec_review\.effort/],
    ["effort.prep_explore", "effort:\n  prep_explore: low\n", /dispatch\.prep_explore\.effort/],
    ["effort.architecture", "effort:\n  architecture: high\n", /dispatch\.architecture\.effort/],
    ["effort.adr", "effort:\n  adr: high\n", /dispatch\.adr\.effort/],
    ["effort.bogus", "effort:\n  bogus: low\n", /not a tunable effort lane/],
  ]) {
    const dir = fixtureDir(body);
    try {
      const r = runCli(["config", "get", key], { cwd: dir });
      assert.equal(r.code, 2, `${key} must fail loud (exit 2), got exit ${r.code}`);
      assert.match(r.stderr, /not a tunable effort lane/, `${key} names the exclusion`);
      assert.match(r.stderr, pointer, `${key} points at its home`);
      assert.equal(r.stdout.trim(), "", `${key} echoes no value`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("effort.eval exits 2 saying eval is not a dispatch lane", () => {
  const dir = fixtureDir();
  try {
    const r = runCli(["config", "get", "effort.eval"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /eval is not a dispatch lane/);
    assert.match(r.stderr, /eval\.effort/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("eval.effort lives in the eval block: inherit by default, a pinned level echoes, off-vocab fails loud (ADR-0133)", () => {
  const unset = fixtureDir();
  const pinned = fixtureDir("eval:\n  effort: medium\n");
  const bad = fixtureDir("eval:\n  effort: turbo\n");
  try {
    assert.equal(runCli(["config", "get", "eval.effort"], { cwd: unset }).stdout.trim(), "inherit");
    assert.equal(runCli(["config", "get", "eval.effort"], { cwd: pinned }).stdout.trim(), "medium");
    const r = runCli(["config", "get", "eval.effort"], { cwd: bad });
    assert.equal(r.code, 2, "an off-vocabulary eval.effort fails loud");
    assert.match(r.stderr, /inherit \| low \| medium \| high \| xhigh \| max/);
  } finally { for (const d of [unset, pinned, bad]) rmSync(d, { recursive: true, force: true }); }
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
