// FAFF-826 — `faff shadow-fidelity` — the read-only coordination-fidelity study.
// Spawns the real CLI (execFileSync — entrypoint, arg parsing, exit codes, exactly as
// CI and users invoke it) over scratch corpora, mirroring test/decision-capture.test.mjs's
// conventions. Asserts the --selftest suite, a synthetic-corpus run, the reproduce
// round-trip, the empty-corpus null result, and the manifest-digest-mismatch refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function run(cwd, args) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "faff-shadow-"));
  return root;
}

// A replayable @1 envelope, as the export would emit it.
function rec(kernel, ni, action, over = {}) {
  return JSON.stringify({
    type: "decision-capture",
    run_id: over.run_id || "run-x",
    seq: over.seq ?? 1,
    data: {
      kernel,
      kernel_version: over.kernel_version || `${kernel}@1`,
      normalised_inputs: ni,
      selected_action: action,
      coverage: over.coverage || "replayable",
      missing_inputs: over.missing_inputs || [],
    },
  });
}

test("shadow-fidelity --selftest passes", () => {
  const r = run(REPO, ["shadow-fidelity", "--selftest"]);
  assert.equal(r.code, 0, r.err || r.out);
  assert.match(r.out, /RESULT ok shadow-fidelity selftest \(0 failures\)/);
});

test("run over a synthetic corpus: an agreement and a wrong divergence", () => {
  const root = scratch();
  const corpus = join(root, "corpus.jsonl");
  const lines = [
    rec("next", { status: "todo", spec: "high", eligible: true, parked: false, blocked: false, ifEligible: false, awaitingSpecReview: false }, "graft"),
    rec("claim-verdict", { claimedAtISO: "2026-01-01T00:00:00Z", nowISO: "2026-01-01T00:05:00Z", ttlHours: 6 }, "stale"), // prescribed live ⇒ wrong
  ];
  writeFileSync(corpus, lines.join("\n") + "\n");
  const r = run(REPO, ["shadow-fidelity", "run", "--corpus", corpus, "--root", REPO, "--json"]);
  assert.equal(r.code, 0, r.err || r.out);
  const result = JSON.parse(r.out);
  assert.equal(result.record_count, 2);
  assert.equal(result.null_result, false);
  assert.equal(result.coverage.replayable, 2);
  assert.equal(result.matrix.next.agreement, 1);
  assert.equal(result.matrix["claim-verdict"].wrong, 1);
  assert.equal(result.divergences.length, 1);
  // scope is derived live from the committed state-authority map + registry
  assert.equal(result.in_scope_kernels.length, 9);
  assert.ok(result.set_aside.find((s) => s.command === "state"));
});

test("run --out then reproduce round-trips byte-identically", () => {
  const root = scratch();
  const corpus = join(root, "corpus.jsonl");
  const outDir = join(root, "report");
  const lines = [
    rec("eligible", { labels: ["faff-automate"], automationDefault: "opt-in", trackerPresent: true }, "eligible"),
    rec("run-outward", { targetRaw: { container: "acme", repo: "x", source: "resolved" }, selfRaw: { container: "self", repo: "y", is_self: false } }, "outward-adopter"),
  ];
  writeFileSync(corpus, lines.join("\n") + "\n");
  const rRun = run(REPO, ["shadow-fidelity", "run", "--corpus", corpus, "--out", outDir, "--root", REPO]);
  assert.equal(rRun.code, 0, rRun.err || rRun.out);
  const rRepro = run(REPO, ["shadow-fidelity", "reproduce", "--dir", outDir, "--root", REPO]);
  assert.equal(rRepro.code, 0, rRepro.err || rRepro.out);
  const repro = JSON.parse(rRepro.out);
  assert.equal(repro.reproduced, true);
});

test("empty corpus is a stated null result, exit 0", () => {
  const root = scratch();
  const corpus = join(root, "empty.jsonl");
  writeFileSync(corpus, "");
  const r = run(REPO, ["shadow-fidelity", "run", "--corpus", corpus, "--root", REPO, "--json"]);
  assert.equal(r.code, 0, r.err || r.out);
  const result = JSON.parse(r.out);
  assert.equal(result.null_result, true);
  assert.equal(result.record_count, 0);
  assert.match(result.null_reason, /capture was off/);
});

test("manifest digest mismatch is refused (exit 1)", () => {
  const root = scratch();
  const corpus = join(root, "corpus.jsonl");
  const manifest = join(root, "manifest.json");
  writeFileSync(corpus, rec("next", { status: "todo", spec: "high", eligible: true, parked: false, blocked: false, ifEligible: false, awaitingSpecReview: false }, "graft") + "\n");
  writeFileSync(manifest, JSON.stringify({ version: "decision-corpus-1", record_count: 1, corpus_sha256: "deadbeef" }));
  const r = run(REPO, ["shadow-fidelity", "run", "--corpus", corpus, "--manifest", manifest, "--root", REPO]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /digest mismatch/);
});

test("cost snapshot reads a real run ledger without crashing (finding-1 regression)", () => {
  const root = scratch();
  // the state-authority map so `eligible` resolves in-scope under this scratch --root
  const mapRel = join("docs", "rfc", "rfc-superdomestique-runtime", "v5", "STATE-AUTHORITY-MAP-v5.md");
  mkdirSync(dirname(join(root, mapRel)), { recursive: true });
  writeFileSync(join(root, mapRel), readFileSync(join(REPO, mapRel), "utf8"));
  // a scratch run dir with a real ledger + event log the record joins to by run_id
  const runId = "run-20260101-000000-graft-cost";
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ level: "L2", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, run_segments: [] }));
  writeFileSync(join(runDir, "events.jsonl"), [
    JSON.stringify({ schema: 1, run_id: runId, seq: 0, ts: "2026-01-01T00:00:00Z", phase: "run", type: "run-start" }),
    JSON.stringify({ schema: 1, run_id: runId, seq: 1, ts: "2026-01-01T00:10:00Z", phase: "run", type: "run-end" }),
  ].join("\n") + "\n");
  const corpus = join(root, "corpus.jsonl");
  writeFileSync(corpus, rec("eligible", { labels: ["faff-automate"], automationDefault: "opt-in", trackerPresent: true }, "eligible", { run_id: runId }) + "\n");
  const r = run(REPO, ["shadow-fidelity", "run", "--corpus", corpus, "--root", root, "--json"]);
  assert.equal(r.code, 0, r.err || r.out);
  const result = JSON.parse(r.out);
  assert.equal(result.cost.artifacts_present, true);
  const runCost = result.cost.runs[runId];
  assert.equal(runCost.available, true);
  // token_cost must NOT be the swallowed-TypeError shape — it read the run's engine spend
  assert.ok(!(runCost.token_cost && runCost.token_cost.available === false && /Cannot read properties/.test(runCost.token_cost.reason || "")), "token_cost crashed: " + JSON.stringify(runCost.token_cost));
  assert.ok(runCost.token_cost && "totals" in runCost.token_cost, "token_cost should carry a real measureRunSpend result");
  assert.equal(runCost.latency.events, 2);
});

test("--non-default-policy-run is repeatable (finding-2 regression)", () => {
  const root = scratch();
  const corpus = join(root, "corpus.jsonl");
  writeFileSync(corpus, rec("next", { status: "todo", spec: "high", eligible: true, parked: false, blocked: false, ifEligible: false, awaitingSpecReview: false }, "graft") + "\n");
  const r = run(REPO, ["shadow-fidelity", "run", "--corpus", corpus, "--root", REPO, "--json", "--non-default-policy-run", "run-a", "--non-default-policy-run", "run-b"]);
  assert.equal(r.code, 0, r.err || r.out); // two occurrences must NOT be a duplicate-flag error
});

test("the committed FAFF-826 report reproduces from a clean context", () => {
  const dir = join(REPO, "verification", "reports", "FAFF-826-coordination-fidelity");
  const r = run(REPO, ["shadow-fidelity", "reproduce", "--dir", dir, "--root", REPO]);
  assert.equal(r.code, 0, r.err || r.out);
  // the committed corpus digest must match its manifest
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const corpusBytes = readFileSync(join(dir, "decision-corpus.jsonl"));
  assert.equal(manifest.corpus_sha256, sha256(corpusBytes));
});
