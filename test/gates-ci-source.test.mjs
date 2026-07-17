// FAFF-533 — the 4th `discoverRungs` detector: a CI-workflow gate source.
// Encodes the acceptance directly. The `--selftest` table (run via runCli below) covers the
// classifier / extractor / dedup / false-positive units against tmp fixtures; THIS file adds the
// real-repo-root acceptance: faff's OWN `.github/workflows/validate.yml` must resolve
// `discovery: confident` with a re-runnable UNIT rung (`node --test`), so the `gates.fallback:
// advisory` stopgap can be removed from this repo's .faffrc.yaml with no regression, and post-merge
// verification finds a real UNIT rung instead of "no UNIT rung discovered".
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { discoverRungs, discoverCiWorkflows, ciRunnerKind, extractRunCommands, GATE_COST, CI_COST_PENALTY } =
  require("../plugin/skills/faff/bin/lib/gates.js");

test("gates --selftest passes (the CI-source unit table)", () => {
  const r = runCli(["gates", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

test("faff's own repo root resolves discovery:confident with a UNIT rung (the stopgap-removal acceptance)", () => {
  const { discovery, rungs } = discoverRungs(repoRoot);
  assert.equal(discovery, "confident", "faff's own repo must now resolve confident via its CI workflow");
  const unit = rungs.filter((r) => r.kind === "UNIT");
  assert.equal(unit.length, 1, "exactly one UNIT rung after dedup");
  assert.equal(unit[0].command, "node --test", "the UNIT rung is the re-runnable node --test command");
  assert.equal(unit[0].source, "ci_workflow", "sourced from the CI workflow (the only UNIT declarer)");
});

test("the detector reads validate.yml directly — >=1 UNIT (node --test) and >=1 LINT rung", () => {
  const ci = discoverCiWorkflows(repoRoot);
  assert.ok(ci.some((r) => r.kind === "UNIT" && r.command === "node --test"), "node --test UNIT rung");
  assert.ok(ci.some((r) => r.kind === "LINT"), "at least one LINT rung (validate-adapters/lint-refs/lint-cli-doc)");
  assert.ok(ci.every((r) => r.source === "ci_workflow" && r.required === true), "shape: ci_workflow + required");
  assert.ok(ci.every((r) => r.cost_rank === GATE_COST[r.kind] + CI_COST_PENALTY), "cost_rank = base + penalty");
});

test("ciRunnerKind classifies faff's gates and rejects shell noise", () => {
  assert.equal(ciRunnerKind("node --test"), "UNIT");
  assert.equal(ciRunnerKind("node plugin/skills/faff/bin/faff validate-adapters"), "LINT");
  assert.equal(ciRunnerKind("git checkout main"), null);
  assert.equal(ciRunnerKind("actions/checkout@v4"), null);
});

test("extractRunCommands handles block-scalar bodies and does not swallow the next step", () => {
  const cmds = extractRunCommands("      - name: t\n        run: |\n          echo setup\n\n          node --test\n      - name: n\n        run: echo done\n");
  assert.ok(cmds.includes("node --test"));
  assert.ok(cmds.includes("echo done"));
});
