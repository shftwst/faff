// FAFF-1258 — bundle-recover upgrades a restored legacy run-ledger.json / landing-progress.json through the
// shared serialisers, and keeps a second recovery a no-op.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { PLUGIN, bundleFixture, faff, recover } from "./helpers/bundle-recover-fixture.mjs";

const require = createRequire(import.meta.url);
const { idempotencyDecision } = require("../plugin/skills/faff/bin/lib/bundle-recover.js");

test("a legacy snapshot is upgraded on the first recovery and the second reports noop-already-present", () => {
  const fx = bundleFixture();
  try {
    assert.equal("schema_version" in JSON.parse(fx.snapshot.toString()), false, "fixture snapshot is legacy");
    const first = recover(fx);
    assert.equal(first.code, 0, first.err);
    assert.equal(JSON.parse(first.out).disposition, "reconstructed");
    const led = JSON.parse(readFileSync(fx.ledgerPath, "utf8"));
    assert.equal(led.schema_version, 1);
    assert.equal(Object.keys(led)[0], "schema_version");
    const verify = faff(["events", "verify", "--run-dir", path.dirname(fx.ledgerPath)]);
    assert.equal(verify.code, 0, verify.out + verify.err);
    const second = recover(fx);
    assert.equal(second.code, 0, second.err);
    assert.equal(JSON.parse(second.out).disposition, "noop-already-present");
  } finally { fx.cleanup(); }
});

test("a snapshot already at schema_version 1 is restored byte for byte with no extra event", () => {
  const fx = bundleFixture({ stamped: true });
  try {
    const r = recover(fx);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(readFileSync(fx.ledgerPath), fx.snapshot);
    const anchorEvents = readFileSync(path.join(fx.fresh, ".faff", "anchors", fx.runId, "FAFF-1", "events.jsonl"), "utf8");
    assert.equal(readFileSync(path.join(path.dirname(fx.ledgerPath), "events.jsonl"), "utf8"), anchorEvents, "no event appended");
  } finally { fx.cleanup(); }
});

test("a restored legacy landing-progress.json is stamped and its old history fault is reported, not refused", () => {
  const fx = bundleFixture({ landing: true });
  try {
    const r = recover(fx);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /pre-existing schema violation.*note/);
    const restored = JSON.parse(readFileSync(path.join(path.dirname(fx.ledgerPath), "FAFF-1", "landing-progress.json"), "utf8"));
    assert.equal(restored.schema_version, 1);
    assert.equal(restored.fix_cycles, 1, "only the stamp changes");
    const anchored = JSON.parse(readFileSync(path.join(fx.fresh, ".faff", "anchors", fx.runId, "FAFF-1", "landing-progress.json"), "utf8"));
    assert.equal("schema_version" in anchored, false, "the anchor copy stays immutable legacy");
  } finally { fx.cleanup(); }
});

test("a recovery whose upgrade is forced to fail leaves the ledger unstamped; the next recovery completes it", () => {
  const fx = bundleFixture();
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-brfail-"));
  try {
    const copy = path.join(tmp, "faff");
    cpSync(PLUGIN, copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
    rmSync(path.join(copy, "contracts", "evidence-v0.3", "anchor-manifest.json"));
    const failed = recover(fx, [], { cli: path.join(copy, "bin", "faff") });
    assert.equal(failed.code, 0, failed.err);
    assert.equal(JSON.parse(failed.out).disposition, "reconstructed");
    assert.match(failed.err, /not upgraded/);
    assert.equal("schema_version" in JSON.parse(readFileSync(fx.ledgerPath, "utf8")), false, "still unstamped");
    const next = recover(fx);
    assert.equal(next.code, 0, next.err);
    assert.equal(JSON.parse(next.out).disposition, "noop-already-present");
    assert.equal(JSON.parse(readFileSync(fx.ledgerPath, "utf8")).schema_version, 1);
    const again = recover(fx);
    assert.equal(JSON.parse(again.out).disposition, "noop-already-present");
  } finally { fx.cleanup(); rmSync(tmp, { recursive: true, force: true }); }
});

test("--dry-run on a legacy snapshot reports the same disposition and writes nothing under the real root", () => {
  const fx = bundleFixture({ landing: true });
  try {
    const dry = recover(fx, ["--dry-run"]);
    assert.equal(dry.code, 0, dry.err);
    assert.equal(JSON.parse(dry.out).disposition, "reconstructed");
    assert.equal(existsSync(path.join(fx.fresh, ".faff", "runs")), false);
    assert.equal(existsSync(path.join(fx.fresh, ".faff", "anchors")), false);
    const real = recover(fx);
    assert.equal(JSON.parse(real.out).disposition, "reconstructed");
  } finally { fx.cleanup(); }
});

test("idempotencyDecision: equal bytes, stamped upgrade, redacted upgrade, one other key changed, unparseable", () => {
  const snap = Buffer.from(JSON.stringify({ run_id: "R", admitted: ["A"], stop_reason: "x" }));
  const stamped = (over = {}) => Buffer.from(JSON.stringify({ schema_version: 1, run_id: "R", admitted: ["A"], stop_reason: "x", ...over }, null, 2) + "\n");
  assert.equal(idempotencyDecision(snap, snap), "match");
  assert.equal(idempotencyDecision(stamped(), snap), "match");
  assert.equal(idempotencyDecision(stamped({ stop_reason: "y" }), snap), "conflict");
  assert.equal(idempotencyDecision(stamped({ schema_version: 2 }), snap), "conflict");
  assert.equal(idempotencyDecision(Buffer.from("{ nope"), snap), "conflict");
  assert.equal(idempotencyDecision(null, snap), "absent");
});

test("idempotencyDecision matches a stamped upgrade of a snapshot that carried a known secret value", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-brsecret-"));
  try {
    mkdirSync(path.join(tmp, ".git"));
    writeFileSync(path.join(tmp, ".faffrc.yaml"), "andon:\n  token: S3CR3T-SENTINEL\n");
    const script = `
      const { idempotencyDecision } = require(${JSON.stringify(path.join(PLUGIN, "bin/lib/bundle-recover.js"))});
      const snap = Buffer.from(JSON.stringify({ run_id: "R", stop_reason: "leak S3CR3T-SENTINEL" }));
      const upgraded = Buffer.from(JSON.stringify({ schema_version: 1, run_id: "R", stop_reason: "leak [REDACTED]" }));
      console.log(idempotencyDecision(upgraded, snap));
    `;
    const r = spawnSync("node", ["-e", script], { encoding: "utf8", cwd: tmp });
    assert.equal(r.stdout.trim(), "match", r.stderr);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
