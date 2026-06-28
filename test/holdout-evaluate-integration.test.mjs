// FAFF-34 — docker-gated live integration test for the holdout evaluator loop.
//
// Stands a REAL container up (a tiny http-echo fixture serving a known body), classifies a spec's DoD,
// exercises the born-verifiable criteria against the running service with the deterministic reference
// exerciser, validates the assembled verdict through `faff contract holdout-verdict`, and tears the env
// down. Proves the loop's plumbing closes end-to-end against a real env — incl. the known-broken negative.
//
// Gated on docker: skipped when the daemon is unavailable (CI has docker, so it runs there for real).
import { test } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyDoD, buildVerdict } from "./helpers/holdout-exercise.mjs";

const FAFF = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));
const IMAGE = "hashicorp/http-echo";
const SKIP = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0 ? false : "docker unavailable";

// A tiny spec whose born-verifiable DoD the fixture env can satisfy or violate.
const SPEC = [
  "## Scenarios",
  "```",
  "Given the service is running",
  "When a client GETs the root",
  "Then the body reports ORDER_SUBMITTED",
  "```",
  "",
  "## 8. DONE",
  "- [ ] The endpoint MUST report ORDER_SUBMITTED",
].join("\n");

function contractExit(verdict) {
  return spawnSync("node", [FAFF, "contract", "holdout-verdict"], { input: JSON.stringify(verdict), encoding: "utf8" }).status;
}
function up(name, text, port) {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  const r = spawnSync("docker", ["run", "-d", "--name", name, "-p", `${port}:5678`, IMAGE, "-listen=:5678", `-text=${text}`], { encoding: "utf8" });
  return r.status === 0;
}
function down(name) { spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" }); }
function dangling(name) { return spawnSync("docker", ["ps", "-aq", "--filter", `name=${name}`], { encoding: "utf8" }).stdout.trim(); }
async function waitReady(endpoint, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(endpoint); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

test("holdout loop: a satisfying feature → met → meets-spec, env torn down (docker-gated)", { skip: SKIP }, async () => {
  const name = `faff-holdout-pos-${process.pid}`;
  const port = 18745;
  const endpoint = `http://localhost:${port}/`;
  assert.ok(up(name, "ORDER_SUBMITTED", port), "fixture env stands up");
  try {
    assert.ok(await waitReady(endpoint), "env reaches health");
    const classified = classifyDoD(FAFF, SPEC);
    assert.ok(classified.filter((c) => c.class !== "prose").length >= 1, "spec carries born-verifiable criteria");
    const verdict = await buildVerdict({ classified, endpoint, expectSubstring: "ORDER_SUBMITTED" });
    assert.equal(verdict.aggregate, "meets-spec", "all born-verifiable criteria met → meets-spec");
    assert.ok(verdict.criteria.some((c) => c.verdict === "met" && c.evidence_present), "a met criterion carries evidence");
    assert.equal(contractExit(verdict), 0, "the verdict is contract-valid and gate-passing");
  } finally {
    down(name);
  }
  assert.equal(dangling(name), "", "env torn down via teardown — no dangling container");
});

test("holdout loop: a violating feature → unmet (the known-broken negative) (docker-gated)", { skip: SKIP }, async () => {
  const name = `faff-holdout-neg-${process.pid}`;
  const port = 18746;
  const endpoint = `http://localhost:${port}/`;
  assert.ok(up(name, "INTERNAL_ERROR", port), "broken fixture env stands up");
  try {
    assert.ok(await waitReady(endpoint), "env reaches health");
    const classified = classifyDoD(FAFF, SPEC);
    const verdict = await buildVerdict({ classified, endpoint, expectSubstring: "ORDER_SUBMITTED" });
    assert.ok(verdict.criteria.some((c) => c.verdict === "unmet"), "the violated criterion comes back unmet");
    assert.notEqual(verdict.aggregate, "meets-spec", "a violating feature never reads as meets-spec (guards live-exercise fidelity)");
    assert.equal(contractExit(verdict), 0, "the unmet verdict is still contract-valid");
  } finally {
    down(name);
  }
  assert.equal(dangling(name), "", "env torn down via teardown — no dangling container");
});
