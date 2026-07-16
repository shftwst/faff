// FAFF-514 — the `faff integrity-boundary` emitter: faff originates the (version, dir-set)
// CONTENT of the FAFF_INTEGRITY_BOUNDARY declaration the cage/hand-operator exports, so a
// future dir-set change is a faff-only change. Origin only — never reads pid-1 environ.
// Exercised end-to-end via the real CLI seam + the in-process --selftest round-trip table.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function markerDir() {
  const d = mkdtempSync(path.join(tmpdir(), "faff-ib-"));
  mkdirSync(path.join(d, ".faff"), { recursive: true }); // a resolvable root marker
  return d;
}
function bareDir() { return mkdtempSync(path.join(tmpdir(), "faff-ib-bare-")); }

test("integrity-boundary --selftest passes (the round-trip table)", () => {
  const r = runCli(["integrity-boundary", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

test("default (launch grain) prints exactly v1:<abs-root>/.faff/runs + newline, exit 0", () => {
  const d = markerDir();
  try {
    const r = runCli(["integrity-boundary"], { cwd: d });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `v1:${path.join(d, ".faff", "runs")}\n`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("--json emits {version, mode, dirs, declaration} matching the plain print", () => {
  const d = markerDir();
  try {
    const plain = runCli(["integrity-boundary"], { cwd: d }).stdout.trim();
    const j = JSON.parse(runCli(["integrity-boundary", "--json"], { cwd: d }).stdout);
    assert.equal(j.version, "v1");
    assert.equal(j.mode, "launch");
    assert.equal(j.dirs.length, 1);
    assert.equal(j.declaration, plain);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("--run-dir --issue --events prints v1: + the exact correctiveIntegrityDirs join (6 paths)", () => {
  const r = runCli(["integrity-boundary", "--run-dir", "/tmp/faff-run-x", "--issue", "FAFF-9", "--events"]);
  assert.equal(r.code, 0, r.stderr);
  const out = r.stdout.trim();
  assert.ok(out.startsWith("v1:/tmp/faff-run-x/corrective,/tmp/faff-run-x/run-ledger.json,"));
  assert.equal(out.split(",").length, 6); // 2 base + 3 per-issue + events.jsonl
  assert.ok(out.endsWith("/tmp/faff-run-x/events.jsonl"));
});

test("strict root: an existing --root wins; a marker-less tree with no --root exits 2 (never a guess)", () => {
  const bare = bareDir();
  try {
    // With no marker ANYWHERE up the temp path, the emitter must refuse rather than guess.
    const r = runCli(["integrity-boundary"], { cwd: bare });
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /never printing a guessed path|no .*marker/i);
  } finally { rmSync(bare, { recursive: true, force: true }); }
});

test("--root naming a nonexistent path exits 2 with nothing on stdout", () => {
  const r = runCli(["integrity-boundary", "--root", "/tmp/faff-does-not-exist-xyz-123"]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
});

test("--issue / --events without --run-dir exit 2 (they modify the per-run set only)", () => {
  assert.equal(runCli(["integrity-boundary", "--issue", "FAFF-9"]).code, 2);
  assert.equal(runCli(["integrity-boundary", "--events"]).code, 2);
});

test("an unknown flag exits 2", () => {
  assert.equal(runCli(["integrity-boundary", "--bogus"]).code, 2);
});
