// FAFF-533 — the 4th `discoverRungs` detector: a CI-workflow gate source.
// Encodes the acceptance directly. The `--selftest` table (run via runCli below) covers the
// classifier / extractor / dedup / false-positive units against tmp fixtures; THIS file adds the
// real-repo-root acceptance: faff's OWN `.github/workflows/validate.yml` must resolve
// `discovery: confident` with a re-runnable UNIT rung (`node --import ./test/hermetic-env.mjs
// --test`, the FAFF-785 hermetic invocation), so the `gates.fallback: advisory` stopgap can be
// removed from this repo's .faffrc.yaml with no regression, and post-merge verification finds a
// real UNIT rung instead of "no UNIT rung discovered".
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { discoverRungs, discoverCiWorkflows, ciRunnerKind, extractRunCommands, GATE_COST, CI_COST_PENALTY, discoverRungsReporting } =
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
  assert.equal(unit[0].command, "node --import ./test/hermetic-env.mjs --test", "the UNIT rung is the re-runnable hermetic node --test command (FAFF-785)");
  assert.equal(unit[0].source, "ci_workflow", "sourced from the CI workflow (the only UNIT declarer)");
});

test("the detector reads validate.yml directly — >=1 UNIT (node --test) and >=1 LINT rung", () => {
  const ci = discoverCiWorkflows(repoRoot);
  assert.ok(ci.some((r) => r.kind === "UNIT" && r.command === "node --import ./test/hermetic-env.mjs --test"), "hermetic node --test UNIT rung (FAFF-785)");
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

// FAFF-848 (639a) — real-repo acceptance for the REPORTING path. `faff gates discover` must see
// what `.github/workflows/validate.yml` actually enforces (the FAFF-604 class of surprise: `faff
// regions check` runs in CI but was invisible to discovery). NOTE (FAFF-849/639b): `faff gates run`
// (runLadder) now CONSUMES the wider reporting set through selectRunnableRungs — so this test asserts
// the retained narrow resolver `discoverRungs` DIRECTLY (left in place per the 639b spec §2), not
// runLadder, which is where execution's today-identical isolation still holds.
test("discovery reports a STATIC_ANALYSIS `regions check` rung and discovery:partial on faff's own repo, while discoverRungs (the retained narrow resolver) stays today-identical", () => {
  const reporting = discoverRungsReporting(repoRoot);
  assert.ok(
    reporting.rungs.some((r) => r.kind === "STATIC_ANALYSIS" && r.command === "node plugin/skills/faff/bin/faff regions check"),
    "the reporting resolver recognises faff's own `regions check` invariant lint",
  );
  assert.ok(
    reporting.rungs.some((r) => r.kind === "STATIC_ANALYSIS" && r.command.includes("regions selftest")),
    "regions selftest is recognised report-only (human-ratified 2026-08-19)",
  );
  // Three distinct faff LINT lints stay distinct (not collapsed to one, per the FAFF-604 harm).
  const lintCommands = new Set(reporting.rungs.filter((r) => r.kind === "LINT").map((r) => r.command));
  assert.ok(lintCommands.size >= 3, `expected >=3 distinct LINT commands, got ${lintCommands.size}`);
  assert.equal(reporting.discovery, "partial", "faff's own workflow covers well under half its eligible steps");
  assert.ok(reporting.coverage.ratio < 0.5, "coverage ratio must back the partial classification");
  assert.ok(reporting.coverage.eligible_steps > reporting.coverage.recognised_steps, "the report is honest about what it does not see");

  // discoverRungs (the retained narrow resolver, no longer feeding runLadder — 639b spec §2) sees
  // NEITHER `regions check` nor the wider LINT set — today's exact 2-rung (LINT + UNIT) kind-deduped
  // selection, unchanged by this ticket. (runLadder's own widened execution is covered by gates.js
  // --selftest cases 25-32.)
  const execution = discoverRungs(repoRoot);
  assert.equal(execution.discovery, "confident");
  assert.ok(execution.rungs.every((r) => r.kind !== "STATIC_ANALYSIS"), "execution never gains a STATIC_ANALYSIS rung from this reporting change");
  assert.equal(execution.rungs.filter((r) => r.kind === "LINT").length, 1, "execution still collapses LINT to exactly one rung (today's behaviour)");
});
