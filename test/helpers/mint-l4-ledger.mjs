// FAFF-1256: mints a full L4 run-ledger.json in a temp root by calling the same exported,
// un-mocked primitives `cmdLightsOut` uses (the CLI itself refuses on a host without a real
// pid-1 integrity declaration, so `correctiveIntegrityBasis: "asserted"` is the one
// synthesised input). Mirrors `mintFixtureLedger` in test/lights-out.test.mjs without
// editing that file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../plugin/skills/faff/bin/lib/config.js";
import { envelopeFrom, measureTokensByClass } from "../../plugin/skills/faff/bin/lib/budget.js";
import { LIGHTS_OUT_GUARDRAIL_IDS, estimateOnlyPosture, guardrailClaim, lightsOutPreflight, mintAtCeiling, tokenDependentCeilingArmed } from "../../plugin/skills/faff/bin/lib/lights-out.js";
import { atomicWriteLedger } from "../../plugin/skills/faff/bin/lib/heartbeat.js";

export function mintL4Ledger() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "faff-l4-ledger-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".faffrc.yaml"),
    "slots:\n  review: faffter-dark-adversarial-review\n  spec_review: faffter-dark-spec-review\ngates:\n  fallback: fail-closed\nbudget:\n  tokens: 50000000\n  on_estimate_only: warn\nautonomous:\n  engine_bounded: true\n",
  );
  const [cfg] = loadConfig(root);
  const envelope = envelopeFrom(cfg, { until: null, max_attempts: null });
  envelope.at_ceiling = mintAtCeiling(cfg);
  const metering = measureTokensByClass({ cwd: root, env: process.env, runStartMs: null });
  const reachable = Object.fromEntries(LIGHTS_OUT_GUARDRAIL_IDS.map((id) => [id, true]));
  const floor = { no_execute: true, worktree_isolation: true, autonomous_contract: true };
  const pf = lightsOutPreflight({
    container: "contained", reachable, reviewReachable: true, specReviewSlot: true,
    budgetCeilingSet: true, floor,
    dial: { level: "L4", slots: { review: "faffter-dark-adversarial-review", spec_review: "faffter-dark-spec-review" }, gates_fallback: "fail-closed", recipe: null },
    meteringMeasurable: metering.source === "transcript",
    estimateOnlyPosture: estimateOnlyPosture(cfg),
    tokenDependentCeiling: tokenDependentCeilingArmed(envelope),
    correctiveIntegrityBasis: "asserted",
  });
  const nowIso = new Date().toISOString();
  const runId = "run-20260101-000000-lights-out-fixture";
  const runDir = path.join(root, ".faff", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const ledger = {
    run_id: runId,
    level: "L4",
    armed: pf.armed, enforced: pf.enforced, rechecked: pf.rechecked,
    guardrail_claim: guardrailClaim(nowIso),
    banner: pf.banner,
    budget: { envelope, measure_session_id: null, metering: { source_at_mint: metering.source, degraded: pf.degrades.some((d) => d.gate === "budget-metering") } },
    budget_ceiling: envelope.ceilings,
    dial_profile: { appetite: "full", convergence: "forced", slots: { review: "faffter-dark-adversarial-review", spec_review: "faffter-dark-spec-review" }, gates: null },
    prd_creative_licence: "tight",
    prd_root_container: "container-a",
    corrective_authority: "available",
    container: "contained",
    floor,
    admitted: [], outcomes: {},
    base_sha: null,
    base_sha_required: true,
    owner: { status: "running", session_id: null, pid: process.pid, started_at: nowIso, last_heartbeat: nowIso },
  };
  atomicWriteLedger(runDir, ledger);
  return { root, runDir, ledger: JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8")) };
}
