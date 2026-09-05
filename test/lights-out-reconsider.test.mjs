// FAFF-993 — the autonomous reconsider pass (`reconsiderParkedItems`, the resume-time seam of
// `resumeLightsOut`). A real git-only run: a `parked` ledger outcome + a real `.faff/prep/<key>.json`
// marker carrying a machine park with a repo-root config-file cited input. Config untouched → the park
// stays and no hold is written; config edited → both surfacers clear, a run-scoped `park-reconsidered`
// event lands on events.jsonl, and the FAFF-900 spec-review-resume hold is written (the re-entry).
// The full `faff lights-out --resume` CLI is unreachable in-host (container attestation, see
// lights-out-resume.test.mjs), so the pass is driven directly — its write authority is own-live-run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const lo = require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "lights-out.js"));
const { fingerprintFile } = require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "park-history.js"));
const { specReviewHoldPresent } = require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "prepcheck.js"));
const { readOutcomes } = require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "queue-state.js"));

const NOW = "2026-09-05T12:00:00Z";
const BEFORE = "2026-09-01T00:00:00Z";

// A git-only run whose only remaining item is a machine spec-review park with a config-file cited input.
function scaffold(root, key, { reconsider = "machine", configBody = "adversarial:\n  spec_review:\n    max_tokens: 15000\n" } = {}) {
  writeFileSync(join(root, ".faffrc.yaml"), configBody);
  const fp = fingerprintFile(root, ".faffrc.yaml");                    // park-time fingerprint
  const runDir = join(root, ".faff", "runs", "run-993");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({
    run_id: "run-993", admitted: [key], outcomes: { [key]: "parked" },
    owner: { status: "running", session_id: "s", epoch: 1, last_heartbeat: NOW },
  }, null, 2) + "\n");
  // genesis events record so the chain has a tail to continue
  writeFileSync(join(runDir, "events.jsonl"),
    JSON.stringify({ schema: 2, run_id: "run-993", seq: 1, ts: BEFORE, prev: null, phase: "run", type: "run-start" }) + "\n");
  const prepDir = join(root, ".faff", "prep");
  mkdirSync(prepDir, { recursive: true });
  writeFileSync(join(prepDir, `${key}.json`), JSON.stringify({
    issue: key, spec_produced: true, attached: false, disposition: "parked",
    owner: { run_dir: runDir },
    park: { reconsider, cause_class: "config-fault", parked_at: BEFORE,
            cited_input: { kind: "config-file", ref: ".faffrc.yaml", keys: ["adversarial.spec_review.max_tokens"], fingerprint: fp } },
  }, null, 2) + "\n");
  return { runDir, fp };
}
function readMarker(root, key) { return JSON.parse(readFileSync(join(root, ".faff", "prep", `${key}.json`), "utf8")); }
function freshRoot() { return mkdtempSync(join(tmpdir(), "lo993-")); }

test("autonomous pass: config UNCHANGED → park stays, all-parked holds, no hold written", () => {
  const root = freshRoot();
  const { runDir } = scaffold(root, "FAFF-10");
  const changed = lo.reconsiderParkedItems(runDir, root, NOW, "run-993");
  assert.deepEqual(changed, [], "an unchanged cited input is not reconsidered");
  assert.equal(readOutcomes(runDir).outcomes["FAFF-10"], "parked", "the ledger outcome still reads parked");
  assert.equal(readMarker(root, "FAFF-10").disposition, "parked", "the marker still reads parked");
  assert.equal(specReviewHoldPresent(root, "FAFF-10"), false, "no spec-review-resume hold");
});

test("autonomous pass: config EDITED → both surfacers clear, event appended, hold written (re-entry)", () => {
  const root = freshRoot();
  const { runDir } = scaffold(root, "FAFF-11");
  // The operator edited the cited config since park time → its fingerprint now differs.
  writeFileSync(join(root, ".faffrc.yaml"), "adversarial:\n  spec_review:\n    max_tokens: 30000\n");
  const changed = lo.reconsiderParkedItems(runDir, root, NOW, "run-993");
  assert.deepEqual(changed, ["FAFF-11"], "the changed cited input is reconsidered");
  // both git-only surfacers cleared
  assert.equal(readOutcomes(runDir).outcomes["FAFF-11"], undefined, "the ledger parked outcome is cleared");
  const m = readMarker(root, "FAFF-11");
  assert.equal(m.disposition, undefined);
  assert.equal(m.park, undefined);
  // the run-scoped park-reconsidered event landed on THIS run's events.jsonl
  const events = readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const rec = events.find((e) => e.type === "park-reconsidered");
  assert.ok(rec, "a park-reconsidered event is appended");
  assert.equal(rec.phase, "run");
  assert.equal(rec.data.via, "resume-reconsider");
  assert.equal(rec.data.ledger_cleared, true);
  assert.equal(rec.issue, undefined, "run-scoped: the issue rides in data, not the top-level field");
  // the FAFF-900 spec-review-resume hold is written with the FAFF-993 discriminator → re-entry
  assert.equal(specReviewHoldPresent(root, "FAFF-11"), true);
  const hold = JSON.parse(readFileSync(join(root, ".faff", "resume", "FAFF-11", "spec-review-hold.json"), "utf8"));
  assert.equal(hold.cause, "reconsider-input-changed");
});

test("autonomous pass: a parked marker owned by a DIFFERENT run is not touched (no cross-run own-run write)", () => {
  const root = freshRoot();
  const { runDir } = scaffold(root, "FAFF-13");
  writeFileSync(join(root, ".faffrc.yaml"), "adversarial:\n  spec_review:\n    max_tokens: 30000\n"); // changed
  // Re-point the marker's owner at a DIFFERENT run dir; there is no ledger `parked` outcome for it
  // in THIS run, so the only way it could be reconsidered is the unscoped marker scan — which must not fire.
  const mPath = join(root, ".faff", "prep", "FAFF-13.json");
  const m = JSON.parse(readFileSync(mPath, "utf8"));
  m.owner.run_dir = join(root, ".faff", "runs", "some-other-run");
  writeFileSync(mPath, JSON.stringify(m, null, 2) + "\n");
  // and remove FAFF-13 from THIS run's ledger outcomes so it is a pure foreign-marker case
  const ledPath = join(runDir, "run-ledger.json");
  const led = JSON.parse(readFileSync(ledPath, "utf8"));
  delete led.outcomes["FAFF-13"]; led.admitted = [];
  writeFileSync(ledPath, JSON.stringify(led, null, 2) + "\n");
  const changed = lo.reconsiderParkedItems(runDir, root, NOW, "run-993");
  assert.deepEqual(changed, [], "a foreign-run parked marker is never reconsidered under own-live-run authority");
  assert.equal(readMarker(root, "FAFF-13").disposition, "parked", "the foreign marker is left standing");
});

test("autonomous pass: a HUMAN park is never auto-re-opened even when the config changed", () => {
  const root = freshRoot();
  const { runDir } = scaffold(root, "FAFF-12", { reconsider: "human" });
  writeFileSync(join(root, ".faffrc.yaml"), "adversarial:\n  spec_review:\n    max_tokens: 99999\n");
  const changed = lo.reconsiderParkedItems(runDir, root, NOW, "run-993");
  assert.deepEqual(changed, [], "a human park stays human regardless of file changes");
  assert.equal(readMarker(root, "FAFF-12").disposition, "parked");
  assert.equal(specReviewHoldPresent(root, "FAFF-12"), false);
});
