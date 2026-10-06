// Per-lane reasoning-EFFORT selection through the `dispatch:` tree (FAFF-416 lanes, FAFF-1198 form).
// Covers: an unset effort resolves to inherit; the closed vocabulary fails LOUD (exit 2, names value
// + legal set) on an invalid token — never a silent inherit; every dispatch lane takes an effort;
// the eval block's own effort key; `config resolved` echoes a non-default effort; and the
// no-config byte-identity.

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

const LANES = ["build", "prep_explore", "spec", "spec_review", "methodology", "intake", "architecture", "adr"];
const LEGAL_EFFORTS = /inherit \| low \| medium \| high \| xhigh \| max/;
const resolve = (dir, lane) => runCli(["dispatch", "resolve", lane], { cwd: dir });

test("every dispatch lane resolves effort inherit with no config (byte-for-byte today)", () => {
  const dir = fixtureDir(); // no .faffrc at all
  try {
    for (const lane of LANES) {
      const r = resolve(dir, lane);
      assert.equal(r.code, 0, `${lane} exit`);
      assert.equal(JSON.parse(r.stdout).effort, "inherit", lane);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config defaults --selftest covers the effort vocabulary", () => {
  const r = runCli(["config", "defaults", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

test("a valid effort level resolves; an invalid one fails loud (exit 2, names value + legal set)", () => {
  const good = fixtureDir("dispatch:\n  build:\n    effort: low\n  methodology:\n    effort: max\n");
  const dir = fixtureDir("dispatch:\n  intake:\n    effort: bogus\n");
  try {
    assert.equal(JSON.parse(resolve(good, "build").stdout).effort, "low");
    assert.equal(JSON.parse(resolve(good, "methodology").stdout).effort, "max");
    const bad = resolve(dir, "intake");
    assert.equal(bad.code, 2, "invalid effort token must exit 2 (fail-loud), not silently inherit");
    assert.match(bad.stderr, /bogus/, "message names the bad value");
    assert.match(bad.stderr, LEGAL_EFFORTS, "message names the legal set");
    assert.equal(bad.stdout.trim(), "", "no value on stdout for an invalid token");
    assert.equal(runCli(["config", "get", "dispatch.intake.effort"], { cwd: dir }).code, 2, "the raw read refuses it too");
  } finally { for (const d of [good, dir]) rmSync(d, { recursive: true, force: true }); }
});

test("a model token in an effort field fails loud (the vocabularies are distinct)", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    effort: sonnet\n");
  try {
    const bad = resolve(dir, "build");
    assert.equal(bad.code, 2, "a model token is not a legal effort level");
    assert.match(bad.stderr, /sonnet/);
    assert.match(bad.stderr, LEGAL_EFFORTS);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("effort is settable on all eight dispatch lanes, including the five that never had an effort lane", () => {
  for (const lane of LANES) {
    const dir = fixtureDir(`dispatch:\n  ${lane}:\n    effort: high\n`);
    try {
      assert.equal(JSON.parse(resolve(dir, lane).stdout).effort, "high", lane);
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
    assert.match(r.stderr, LEGAL_EFFORTS);
  } finally { for (const d of [unset, pinned, bad]) rmSync(d, { recursive: true, force: true }); }
});

test("config resolved echoes a non-default effort (a pinned effort is visible, never silent)", () => {
  const dir = fixtureDir("dispatch:\n  build:\n    effort: low\n  methodology:\n    effort: high\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /dispatch build: effort=low/);
    assert.match(r.stdout, /dispatch methodology: effort=high/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config resolved with no dispatch config emits no dispatch line (no-config byte-identity)", () => {
  const dir = fixtureDir("tracking:\n  team_key: X\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /^(dispatch|effort) /m, "an all-default run banner names no effort lane");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
