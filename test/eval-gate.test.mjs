// FAFF-180 — the proportionate judgement-eval gate (selectable drivers: smart | local | frontier).
// Unit tests on the pure helpers + the load-bearing guarantees: soft path always exits 0, the local
// preflight is single-shot (no death loop), and smart never falls back to frontier when local is down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  resolveGateDriver, classifyDiffSurface, preflightLocal, gate, SMOKE_KINDS, SMOKE_REPS,
} from "../eval/run-evals.mjs";

const BASELINE = fileURLToPath(new URL("../eval/baselines/frontier.json", import.meta.url));
const LOCAL_ARGS = ["--driver", "local", "--base-url", "http://probe.test:11434", "--model", "m"];

// presets whose drivers THROW — proves the soft-skip path never spawns a build, and smart never falls back.
const throwingPresets = {
  localDriver: () => { throw new Error("localDriver must NOT be spawned on a soft-skip"); },
  frontierDriver: () => { throw new Error("frontier must NOT be spawned — smart never auto-falls-back"); },
};

test("resolveGateDriver defaults to smart; accepts local/frontier; rejects junk", () => {
  assert.equal(resolveGateDriver([]), "smart");
  assert.equal(resolveGateDriver(["--driver", "smart"]), "smart");
  assert.equal(resolveGateDriver(["--driver", "local"]), "local");
  assert.equal(resolveGateDriver(["--driver", "frontier"]), "frontier");
  assert.throws(() => resolveGateDriver(["--driver", "ollama-direct"]), /smart\|local\|frontier/);
});

test("classifyDiffSurface: prose-only is `prose`, any code/contract/CLI/grader is `substantive`", () => {
  assert.equal(classifyDiffSurface(["plugin/skills/faff/SKILL.md", "docs/x.md"]), "prose");
  assert.equal(classifyDiffSurface([]), "prose");
  assert.equal(classifyDiffSurface(["eval/run-evals.mjs"]), "substantive");      // code
  assert.equal(classifyDiffSurface(["plugin/skills/faff/bin/faff"]), "substantive"); // CLI entrypoint
  assert.equal(classifyDiffSurface(["plugin/skills/faff/bin/lib/config.js"]), "substantive"); // CLI module (FAFF-441)
  assert.equal(classifyDiffSurface(["plugin/skills/faff/contracts/x.mjs"]), "substantive");
  assert.equal(classifyDiffSurface(["eval/grader.mjs"]), "substantive");
  assert.equal(classifyDiffSurface(["a.md", "b.mjs"]), "substantive");           // mixed → substantive
});

test("SMOKE_KINDS is a scoped, prose-sensitive subset; SMOKE_REPS is low", () => {
  for (const k of ["dupe", "vague", "stale", "superseded", "ordering", "gloss", "marker"]) {
    assert.ok(SMOKE_KINDS.has(k), `${k} in smoke set`);
  }
  assert.ok(!SMOKE_KINDS.has("reconciliation"), "heavy kinds excluded");
  assert.ok(SMOKE_REPS <= 5, "low reps");
});

test("preflightLocal: unconfigured → ok:false and the probe is NEVER called", async () => {
  let probes = 0;
  const r = await preflightLocal(["--driver", "local"], { probe: () => { probes++; return true; } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not configured/);
  assert.equal(probes, 0, "no probe when there's nothing to reach");
});

test("preflightLocal: configured + reachable → ok:true, single probe", async () => {
  let probes = 0;
  const r = await preflightLocal(LOCAL_ARGS, { probe: () => { probes++; return true; } });
  assert.deepEqual({ ok: r.ok, baseUrl: r.baseUrl, model: r.model }, { ok: true, baseUrl: "http://probe.test:11434", model: "m" });
  assert.equal(probes, 1);
});

test("preflightLocal: configured + unreachable → ok:false, single probe (no retry)", async () => {
  let probes = 0;
  const r = await preflightLocal(LOCAL_ARGS, { probe: () => { probes++; return false; } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unreachable/);
  assert.equal(probes, 1, "ONE shot — the anti-death-loop invariant");
});

test("gate --driver local, model unavailable → exit 0, single probe, NO driver spawned", async () => {
  let probes = 0;
  const code = await gate(LOCAL_ARGS, throwingPresets, BASELINE, { probe: () => { probes++; return false; } });
  assert.equal(code, 0, "soft skip is exit 0, never a failure");
  assert.equal(probes, 1, "single-shot");
});

test("gate --driver smart (substantive diff), local unavailable → exit 0, single probe, NO frontier fallback", async () => {
  let probes = 0;
  const SMART_ARGS = ["--base-url", "http://probe.test:11434", "--model", "m"]; // no --driver ⇒ smart
  const code = await gate(
    SMART_ARGS, throwingPresets, BASELINE,
    { probe: () => { probes++; return false; }, changedFiles: ["eval/run-evals.mjs"] }, // substantive
  );
  assert.equal(code, 0, "smart inherits the soft path — exit 0");
  assert.equal(probes, 1, "single-shot, no re-route/retry");
  // throwingPresets proves frontierDriver/localDriver were never spawned.
});

test("gate soft path ALWAYS exits 0 even on a baseline regression (advisory, not blocking)", async () => {
  // probe reachable; inject a fake runEvals returning an empty per_kind → diffAgainstBaseline FAILS.
  const code = await gate(
    LOCAL_ARGS, { localDriver: () => "dummy-driver" }, BASELINE,
    { probe: () => true, runEvalsFn: async () => ({ status: "complete", per_kind: {}, total_cost_tokens: 0 }) },
  );
  assert.equal(code, 0, "a regression on the soft local gate WARNS but never blocks (exit 0)");
});
