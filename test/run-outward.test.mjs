// FAFF-521 — the signals.outward producer's integration smoke (mirror of run-start.test.mjs).
//
// Proves the COMPOSITION seam end-to-end: `faff run-outward` folds a passed-in TargetRef/SelfRef
// into the fixed OutwardSignal, and that signal's `.outward` boolean feeds straight into
// `faff run-start --outward|--no-outward` exactly as the plot-ignition wiring does (spec §8
// "Integration smoke test"). The pure-core decision table lives in `faff run-outward --selftest`
// (run in CI); this is the live CLI wiring + the two named scenarios from spec §8.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const faffBin = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");

function faff(args, input) {
  const r = spawnSync("node", [faffBin, ...args], { cwd: repoRoot, encoding: "utf8", input });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

test("integration: a non-self adopter target resolves outward:true and run-start proceeds (plan|drain)", () => {
  const target = JSON.stringify({ container: "ADOPT-1", repo: "acme/app", source: "explicit" });
  const self = JSON.stringify({ container: null, repo: "shftwst/faff", is_self: false });
  const r = faff(["run-outward", "--target", target, "--self", self, "--json"]);
  assert.equal(r.code, 0);
  const sig = JSON.parse(r.stdout);
  assert.equal(sig.outward, true);
  assert.equal(sig.reason, "outward-adopter");
  assert.deepEqual(sig.target, { container: "ADOPT-1", repo: "acme/app", source: "explicit" });

  // Feed straight into run-start (never re-derive refuse/self-directed locally).
  const v = JSON.parse(faff(["run-start", "--target-resolved", "--outward"]).stdout);
  assert.notEqual(v.verdict, "refuse");
});

test("integration: a self-directed target (repo-slug match) resolves outward:false and run-start refuses", () => {
  const target = JSON.stringify({ container: null, repo: "shftwst/faff", source: "inherited" });
  const self = JSON.stringify({ container: null, repo: "shftwst/faff", is_self: true });
  const r = faff(["run-outward", "--target", target, "--self", self, "--json"]);
  assert.equal(r.code, 0);
  const sig = JSON.parse(r.stdout);
  assert.equal(sig.outward, false);
  assert.equal(sig.reason, "self-marked");

  const v = JSON.parse(faff(["run-start", "--target-resolved", "--no-outward"]).stdout);
  assert.equal(v.verdict, "refuse");
  assert.equal(v.reason, "self-directed");
});

test("integration: an explicit outward target from within the faff repo is honoured (is_self:false, not self-marked)", () => {
  // target.repo != tracking.repo → is_self:false — only a target resolving BACK to tracking.repo fires self-marked.
  const target = JSON.stringify({ container: "ADOPT-2", repo: "acme/other-app", source: "explicit" });
  const self = JSON.stringify({ container: null, repo: "shftwst/faff", is_self: false });
  const sig = JSON.parse(faff(["run-outward", "--target", target, "--self", self, "--json"]).stdout);
  assert.equal(sig.outward, true);
  assert.equal(sig.reason, "outward-adopter");
});

test("integration: an unresolved target (both container and repo null) is fail-safe refused", () => {
  const target = JSON.stringify({ container: null, repo: null, source: "unresolved" });
  const sig = JSON.parse(faff(["run-outward", "--target", target, "--json"]).stdout);
  assert.equal(sig.outward, false);
  assert.equal(sig.reason, "unresolved-target");
});

test("integration: --self is optional — omitted defaults to is_self:false, not self-marked", () => {
  const target = JSON.stringify({ container: "ADOPT-1", repo: "acme/app", source: "explicit" });
  const sig = JSON.parse(faff(["run-outward", "--target", target, "--json"]).stdout);
  assert.equal(sig.outward, true);
  assert.equal(sig.reason, "outward-adopter");
});

test("integration: missing --target → exit 2 (usage error, never an implicit proceed)", () => {
  const r = faff(["run-outward"]);
  assert.equal(r.code, 2);
});

test("integration: malformed --target JSON → exit 2 (usage error)", () => {
  const r = faff(["run-outward", "--target", "not-json"]);
  assert.equal(r.code, 2);
});

test("integration: malformed --self JSON → exit 2 (usage error)", () => {
  const target = JSON.stringify({ container: "ADOPT-1", repo: "acme/app" });
  const r = faff(["run-outward", "--target", target, "--self", "not-json"]);
  assert.equal(r.code, 2);
});

test("integration: report-only exit 0 even on outward:false (the refusal stays single-homed in run-start)", () => {
  const target = JSON.stringify({ container: null, repo: null });
  const r = faff(["run-outward", "--target", target]);
  assert.equal(r.code, 0);
});

test("integration: no --json emits a human-readable line, not JSON", () => {
  const target = JSON.stringify({ container: "ADOPT-1", repo: "acme/app" });
  const r = faff(["run-outward", "--target", target]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^outward: true \(outward-adopter\)/);
});
