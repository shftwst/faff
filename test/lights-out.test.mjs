// FAFF-225 — `faff lights-out`: the L4 lights-out entry point / runner.
// Exercises the real entrypoint via runCli (shebang dispatch, arg parsing, exit codes,
// the minted ledger + persisted banner + run-start event) and the in-process pure
// preflight table via --selftest. Per ADR 0002 — assert the deterministic seam
// (token / exit / parsed JSON / on-disk artefact), never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { loadConfig } from "../plugin/skills/faff/bin/lib/config.js";
import { envelopeFrom, measureTokensByClass } from "../plugin/skills/faff/bin/lib/budget.js";
import { LIGHTS_OUT_GUARDRAIL_IDS, engineBoundedFromConfig, estimateOnlyPosture, lightsOutPreflight, mintAtCeiling, tokenDependentCeilingArmed } from "../plugin/skills/faff/bin/lib/lights-out.js";
import { parseYamlSubset } from "../plugin/skills/faff/bin/lib/shared-infra.js";
import { atomicWriteLedger } from "../plugin/skills/faff/bin/lib/heartbeat.js";
import { eventLineCount } from "../plugin/skills/faff/bin/lib/events.js";

// FAFF-325: this test host carries no genuine FAFF_INTEGRITY_BOUNDARY pid-1 declaration (nothing
// short of actual container tooling can fake /proc/1/environ for a really-spawned child), so
// `faff lights-out` now correctly refuses admission on EVERY real invocation here — exactly the
// shipped, spec-mandated behaviour (an L4 run without the outer-layer launch declaration SHOULD
// refuse at rung-0; the mount+declaration mechanism is explicitly out of THIS ticket's scope,
// assert-don't-implement). Tests below whose actual subject is a DIFFERENT gate now assert via the
// refusals/banner shape (which the real CLI still emits, on the refuse path too) rather than a
// false `proceed:true`. Tests whose subject is genuinely POST-ADMISSION content (a minted ledger's
// envelope/metering/armed/banner, consumed by budget/events/runcheck) can no longer reach that
// state through the real, now-gated CLI — this helper reproduces the SAME mint cmdLightsOut
// performs, calling the identical exported, unmodified-by-FAFF-325 primitives (`envelopeFrom`,
// `mintAtCeiling`, `lightsOutPreflight` + `renderLightsOutBanner` via it, `atomicWriteLedger`,
// `eventLineCount`) with a synthetic `correctiveIntegrityBasis: "asserted"` probe — the ONE input
// this ticket added — so every OTHER field (armed/enforced/banner/floor) is the real, un-mocked
// computation, and only the un-fakeable pid-1 trust signal is synthesised, in test code, never in
// the shipped CLI.
function mintFixtureLedger(root, { untilFlag, maxAttempts, sessionId, env } = {}) {
  const [cfg] = loadConfig(root);
  const envelope = envelopeFrom(cfg, { until: untilFlag ?? null, max_attempts: maxAttempts ?? null });
  envelope.at_ceiling = mintAtCeiling(cfg);
  const meteringEnv = env || process.env;
  const metering = measureTokensByClass({ cwd: root, env: meteringEnv, runStartMs: null });
  const meteringMeasurable = metering.source === "transcript";
  const onEstimateOnlyPosture = estimateOnlyPosture(cfg);
  const tokenDependentCeiling = tokenDependentCeilingArmed(envelope);
  const allReach = {}; for (const id of LIGHTS_OUT_GUARDRAIL_IDS) allReach[id] = true;
  const floor = { no_execute: true, worktree_isolation: true, autonomous_contract: true };
  const pf = lightsOutPreflight({
    container: "contained", reachable: allReach, reviewReachable: true, specReviewSlot: true,
    budgetCeilingSet: true, floor, dial: { level: "L4", slots: { review: "faffter-dark-adversarial-review", spec_review: "faffter-dark-spec-review" }, gates_fallback: "fail-closed", recipe: null },
    meteringMeasurable, estimateOnlyPosture: onEstimateOnlyPosture, tokenDependentCeiling,
    correctiveIntegrityBasis: "asserted",
  });
  const nowIso = new Date().toISOString();
  const stamp = nowIso.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const runId = `run-${stamp}-lights-out-fixture`;
  const runDir = path.join(root, ".faff", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const degraded = pf.degrades.some((d) => d.gate === "budget-metering");
  const ledger = {
    run_id: runId,
    level: "L4",
    armed: pf.armed, enforced: pf.enforced, banner: pf.banner,
    budget: { envelope, metering: { source_at_mint: metering.source, degraded } },
    budget_ceiling: envelope.ceilings,
    dial_profile: { appetite: "full", slots: {}, gates: null },
    prd_creative_licence: null,
    corrective_authority: "available",
    container: "contained",
    floor,
    admitted: [], outcomes: {},
    owner: { status: "running", session_id: sessionId || null, pid: process.pid, started_at: nowIso, last_heartbeat: nowIso },
  };
  atomicWriteLedger(runDir, ledger);
  const eventsPath = path.join(runDir, "events.jsonl");
  const seq = eventLineCount(eventsPath);
  fs.appendFileSync(eventsPath, JSON.stringify({ schema: 1, run_id: runId, seq, ts: nowIso, phase: "run", type: "run-start" }) + "\n");
  return { runDir, runId, ledger, pf };
}

// A throwaway repo root with a .git marker so findRoot anchors there, and a forced
// container signal so container-check resolves `contained` regardless of the host.
// It also writes a COHERENT dial (FAFF-298): adversarial review + spec_review slots
// and fail-closed gates, so the dial-coherence pass admits the proceed path and each
// refuse fixture isolates only its own gate. `dial` overrides let a test drive an
// incoherent dial explicitly (see the dial-coherence refuse test).
function tmpRoot(dial = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-lo-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  const review = dial.review ?? "faffter-dark-adversarial-review";
  const specReview = dial.spec_review ?? "faffter-dark-spec-review";
  const gatesFallback = dial.gates_fallback ?? "fail-closed";
  // FAFF-312: a spend/time ceiling is now the mandatory L4 precondition (a count-cap
  // alone refuses), so proceed-path fixtures carry a `budget.tokens` ceiling by default.
  // `dial.budget: null` omits the block (the no-ceiling refuse fixture); a string value
  // supplies an explicit `budget:` block (the count-cap / explicit-at_ceiling fixtures).
  // FAFF-428: these fixtures don't set up a real transcript, so the test-running
  // process's metering resolves estimate-only for the fixture's tmp `--root` — the
  // default fallback carries `on_estimate_only: warn` so proceed-path assertions
  // elsewhere in this file (unrelated to metering) aren't newly gated on it. The
  // dedicated FAFF-428 tests below construct their own budget blocks explicitly.
  const budgetBlock = dial.budget === null ? ""
    : (typeof dial.budget === "string" ? dial.budget : "budget:\n  tokens: 50000000\n  on_estimate_only: warn\n");
  const recipeLine = dial.recipe ? `recipe: ${dial.recipe}\n` : "";
  // FAFF-333: unlike containerCheck (env-injectable via KUBERNETES_SERVICE_HOST, so the
  // CONTAINED fixture below can force `contained` deterministically), hostSocketProbe reads
  // the REAL filesystem — a test-runner host with Docker actually installed (GitHub Actions'
  // own `ubuntu-latest` runners, or any dev laptop with Docker Desktop) genuinely has
  // /var/run/docker.sock present, independent of whether this test cares about that axis.
  // Attest engine_bounded:true by default so every proceed-path / other-gate fixture here is
  // immune to that ambient host state (exact parity with the budget block's role above —
  // neutralize axes this fixture isn't testing); `dial.engine_bounded: false` opts a specific
  // test OUT when it wants the attestation absent.
  const engineBoundedLine = dial.engine_bounded === false ? "" : "autonomous:\n  engine_bounded: true\n";
  fs.writeFileSync(
    path.join(dir, ".faffrc.yaml"),
    `${recipeLine}slots:\n  review: ${review}\n  spec_review: ${specReview}\ngates:\n  fallback: ${gatesFallback}\n${budgetBlock}${engineBoundedLine}`);
  return dir;
}
const CONTAINED = { ...process.env, KUBERNETES_SERVICE_HOST: "10.0.0.1" };

// --selftest drives the pure preflight core in-process (proceed/refuse table, armed
// derivation, banner 1:1). Deterministic — no env/fs dependency.
test("lights-out --selftest: the preflight table passes (exit 0)", () => {
  const { stdout, code } = runCli(["lights-out", "--selftest"]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /lights-out --selftest: ok/);
});

// FAFF-333 — host-socket boundedness (ADR-0041 decision 3), driven directly through the
// pure lightsOutPreflight() core (mirrors mintFixtureLedger's clean, all-green probes
// fixture below, plus the new hostSocketPresent/hostSocketPath/engineBounded fields).
function cleanProbes(over = {}) {
  const allReach = {}; for (const id of LIGHTS_OUT_GUARDRAIL_IDS) allReach[id] = true;
  return {
    container: "contained", reachable: allReach, reviewReachable: true, specReviewSlot: true,
    budgetCeilingSet: true, floor: { no_execute: true, worktree_isolation: true, autonomous_contract: true },
    dial: { level: "L4", slots: { review: "faffter-dark-adversarial-review", spec_review: "faffter-dark-spec-review" }, gates_fallback: "fail-closed", recipe: null },
    meteringMeasurable: true, correctiveIntegrityBasis: "asserted",
    ...over,
  };
}

test("lightsOutPreflight: a present, unattested host socket REFUSES even on an otherwise clean fixture", () => {
  const pf = lightsOutPreflight(cleanProbes({ hostSocketPresent: true, hostSocketPath: "/var/run/docker.sock" }));
  assert.equal(pf.proceed, false);
  const r = pf.refusals.find((x) => x.gate === "host-socket");
  assert.ok(r, "expected a host-socket refusal");
  assert.match(r.detail, /\/var\/run\/docker\.sock/);
  assert.match(r.detail, /ADR-0041/);
});

test("lightsOutPreflight: autonomous.engine_bounded:true downgrades the socket refuse to a warn and proceeds", () => {
  const pf = lightsOutPreflight(cleanProbes({ hostSocketPresent: true, hostSocketPath: "/var/run/docker.sock", engineBounded: true }));
  assert.equal(pf.proceed, true);
  assert.ok(!pf.refusals.some((x) => x.gate === "host-socket"), "attested-bounded must not refuse");
  assert.ok(pf.degrades.some((x) => x.gate === "host-socket"), "attested-bounded still surfaces a warn via degrades[]");
});

test("lightsOutPreflight: socket absent (the default — no hostSocketPresent key at all) is byte-for-byte unchanged", () => {
  const pf = lightsOutPreflight(cleanProbes());
  assert.equal(pf.proceed, true);
  assert.ok(!pf.refusals.some((x) => x.gate === "host-socket"));
  assert.ok(!pf.degrades.some((x) => x.gate === "host-socket"));
});

// FAFF-333 — engineBoundedFromConfig resolves the attestation FAIL-CLOSED from a REALLY-parsed
// config (the config-resolution seam cmdLightsOut uses in production, so a coercion regression is
// caught here). The load-bearing case: a QUOTED `engine_bounded: "true"` — which the hand-rolled
// YAML parser returns as the STRING "true", not a boolean — must still attest, or an operator who
// quoted the value gets a silent refuse despite doing what the docs said.
test("engineBoundedFromConfig: bare `true` attests (boolean, the documented form)", () => {
  assert.equal(engineBoundedFromConfig(parseYamlSubset("autonomous:\n  engine_bounded: true\n")), true);
});
test("engineBoundedFromConfig: QUOTED `\"true\"` attests too (the YAML-quoting footgun)", () => {
  assert.equal(engineBoundedFromConfig(parseYamlSubset("autonomous:\n  engine_bounded: \"true\"\n")), true);
});
test("engineBoundedFromConfig: `True` (case variant) attests", () => {
  assert.equal(engineBoundedFromConfig(parseYamlSubset("autonomous:\n  engine_bounded: True\n")), true);
});
test("engineBoundedFromConfig is FAIL-CLOSED on every non-affirmative (false/\"false\"/yes/unset)", () => {
  assert.equal(engineBoundedFromConfig(parseYamlSubset("autonomous:\n  engine_bounded: false\n")), false);
  assert.equal(engineBoundedFromConfig(parseYamlSubset("autonomous:\n  engine_bounded: \"false\"\n")), false);
  // `yes` is NOT a documented affirmative — fail-closed keeps it refusing (safe direction).
  assert.equal(engineBoundedFromConfig(parseYamlSubset("autonomous:\n  engine_bounded: yes\n")), false);
  // unset ⇒ the default posture (refuse), regardless of the DEFAULTS registry display value.
  assert.equal(engineBoundedFromConfig(parseYamlSubset("slots:\n  review: x\n")), false);
  assert.equal(engineBoundedFromConfig({}), false);
});

// Bare host (container-check not_confirmed) → refuse, no run minted, exit 1. The
// container guardrail is `absent` and the refusal names it (the cage is the
// container's job — faff detects and refuses, never self-grants).
test("lights-out: bare host (no container signal) refuses, mints nothing", () => {
  const root = tmpRoot();
  const noContainer = { ...process.env };
  delete noContainer.KUBERNETES_SERVICE_HOST;
  delete noContainer.container;
  const { stdout, code } = runCli(["lights-out", "--root", root, "--max", "5", "--json"], { env: noContainer });
  // container-check may still resolve contained from a real host marker; only assert
  // the refuse contract when the probe genuinely yielded not_confirmed.
  const out = JSON.parse(stdout);
  if (out.container !== "contained") {
    assert.equal(code, 1, stdout);
    assert.equal(out.proceed, false);
    assert.equal(out.armed.container, "absent");
    assert.ok(out.refusals.some((r) => r.gate === "guardrail:container"));
    assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run dir minted on refusal");
  }
  fs.rmSync(root, { recursive: true, force: true });
});

// No budget ceiling → refuse (no unbounded lights-out run), even fully contained.
test("lights-out: no budget ceiling refuses", () => {
  const root = tmpRoot({ budget: null });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.equal(out.proceed, false);
  assert.ok(out.refusals.some((r) => r.gate === "budget-ceiling"));
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted");
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-312 — a count-cap (max_attempts) alone is NOT an L4 governor: refuse, mint
// nothing, and the refusal names the spend remedy. (max_attempts is legal only
// as an extra backstop alongside a spend/time ceiling — see the tokens-only test.)
// FAFF-427: the remedy now LEADS with budget.cost (the recommended default
// governor — map-priced with no price_per_mtok needed), naming budget.tokens too.
test("lights-out: count-cap-only (max_attempts) ceiling refuses — not an L4 governor", () => {
  const root = tmpRoot({ budget: "budget:\n  max_attempts: 40\n" });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.equal(out.proceed, false);
  const bc = out.refusals.find((r) => r.gate === "budget-ceiling");
  assert.ok(bc, "names the budget-ceiling gate");
  assert.match(bc.detail, /spend ceiling/, "detail names the spend remedy");
  assert.match(bc.detail, /budget\.cost/, "detail leads with budget.cost, the recommended default governor");
  assert.match(bc.detail, /budget\.tokens/);
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted on a count-cap-only ceiling");
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-427: `budget.cost` alone, with NO `price_per_mtok` configured, is now the
// DEFAULT, RECOMMENDED L4 spend governor — the ADR-0048 per-model x per-class map
// prices it (with the costliest-known-rate fallback for an unpriced model), so a
// dollar ceiling always has SOME price to apply. This replaces the pre-FAFF-427
// "unpriced cost ceiling refuses (vacuous)" behaviour — a flat-scalar dead zone
// that no longer exists now the map prices by default (see budget.test.mjs /
// lights-out --selftest for the still-live legacy-flat-zero-price refusal case).
test("lights-out: budget.cost alone (no price_per_mtok) satisfies budget-ceiling — the default map-priced dollar ceiling (AC 2)", () => {
  // FAFF-428: on_estimate_only: warn — this fixture has no real transcript, so the
  // cost-armed ceiling would otherwise refuse on estimate-only metering (a different
  // gate than the one under test here).
  const root = tmpRoot({ budget: "budget:\n  cost: 25\n  on_estimate_only: warn\n" }); // no price_per_mtok ⇒ map pricing, always priceable
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  // FAFF-325: this host asserts no genuine FAFF_INTEGRITY_BOUNDARY, so overall admission now
  // correctly refuses (defence-in-depth) — the thing under test here is that budget-ceiling
  // specifically does NOT ALSO fire (the dollar ceiling alone satisfies its own gate).
  assert.equal(code, 1, stdout);
  assert.equal(out.proceed, false);
  assert.ok(!out.refusals.some((r) => r.gate === "budget-ceiling"), "no budget-ceiling refusal");
  assert.ok(out.refusals.some((r) => r.gate === "corrective-integrity"), "the only refusal is the (unrelated) FAFF-325 admission gate");
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted — corrective-integrity refuses admission");
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-427: a legacy-shaped envelope that EXPLICITLY sets the flat scalar to a
// non-priced value (`price_per_mtok: 0`, `pricing` therefore resolves to "flat"
// only when a caller stamps it verbatim on a hand-built envelope — see
// lights-out --selftest's "pricing:flat + unpriced cost" case) still refuses;
// this file's CLI-level fixtures always go through the real `envelopeFrom`,
// which now resolves an unset price to `pricing:"map"` (see the test above) —
// so the pure hand-built-envelope shape is covered in the unit selftest, not here.

// FAFF-312 — a spend/time (tokens) ceiling proceeds, and the minted ledger envelope
// carries the level-scoped mint-time default at_ceiling: "escalate" (config unset).
// FAFF-325: this real CLI invocation now correctly refuses admission (no genuine pid-1
// declaration on this host), so the mint itself is exercised via mintFixtureLedger — the
// SAME exported, unmodified-by-FAFF-325 primitives cmdLightsOut calls (envelopeFrom +
// mintAtCeiling), not a corrective-integrity bypass. The refusal itself is asserted first.
test("lights-out: tokens ceiling — real CLI now refuses on corrective-integrity, NOT budget-ceiling; minted envelope (via the same primitives) defaults at_ceiling escalate", () => {
  const root = tmpRoot({ budget: "budget:\n  tokens: 50000000\n  on_estimate_only: warn\n" });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.ok(!out.refusals.some((r) => r.gate === "budget-ceiling"), "the tokens ceiling itself is not the reason for refusal");
  assert.ok(out.refusals.some((r) => r.gate === "corrective-integrity"));
  const { runDir } = mintFixtureLedger(root);
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(ledger.budget.envelope.at_ceiling, "escalate", "L4 mint-time default when config unset");
  assert.equal(ledger.budget.envelope.ceilings.tokens, 50000000);
  assert.equal(ledger.budget.envelope.ceilings.max_attempts, null);
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-312 — an explicit budget.at_ceiling: stop is minted verbatim (human-explicit
// config outranks the level default; the operator asked for a quiet stop at ceiling).
test("lights-out: explicit budget.at_ceiling stop is minted verbatim", () => {
  const root = tmpRoot({ budget: "budget:\n  tokens: 50000000\n  at_ceiling: stop\n  on_estimate_only: warn\n" });
  const { runDir } = mintFixtureLedger(root);
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(ledger.budget.envelope.at_ceiling, "stop", "explicit stop honoured, not overridden to escalate");
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-312 — the minted escalate at_ceiling is what `faff budget check --run-dir`
// reports on breach: tokens satisfies the precondition, max_attempts:1 rides as an
// extra backstop, and a forced 2-outcome breach yields outcome "escalate" (→ Sentry's
// budget-breach signal + run-done's fixed-floor escalation, never a silent stop).
// `faff budget check` is a DIFFERENT subcommand, ungated by corrective-integrity — only
// the mint itself (lights-out admission) needed the fixture helper.
test("lights-out: budget check --run-dir reflects the minted escalate at_ceiling on breach", () => {
  const root = tmpRoot({ budget: "budget:\n  tokens: 50000000\n  max_attempts: 1\n  on_estimate_only: warn\n" });
  const { runDir: run_dir } = mintFixtureLedger(root);
  const lp = path.join(run_dir, "run-ledger.json");
  const ledger = JSON.parse(fs.readFileSync(lp, "utf8"));
  // Pin the mechanism, not just the consequence: the minted ledger envelope itself carries
  // at_ceiling escalate, so the escalate outcome below flows through envelopeFromLedger's
  // ledger-precedence path (not a fresh-config fallback).
  assert.equal(ledger.budget.envelope.at_ceiling, "escalate", "minted ledger envelope carries escalate");
  ledger.admitted = ["A", "B"];
  ledger.outcomes = { A: "shipped", B: "parked" }; // 2 dispatched attempts vs the max_attempts:1 backstop
  fs.writeFileSync(lp, JSON.stringify(ledger));
  const bc = runCli(["budget", "check", "--run-dir", run_dir, "--json"]);
  assert.equal(bc.code, 0, bc.stdout + bc.stderr);
  const state = JSON.parse(bc.stdout);
  assert.ok(state.breached.includes("max_attempts"), "the max_attempts backstop breached");
  assert.equal(state.outcome, "escalate", "budget check reports the minted escalate at_ceiling");
  fs.rmSync(root, { recursive: true, force: true });
});

// A configured-but-unreachable review slot refuses (unreachable == absent), rather
// than starting with the second-opinion gate silently skipped.
test("lights-out: unreachable review slot refuses (never pass+skip)", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(
    ["lights-out", "--root", root, "--max", "5", "--slot-unreachable", "review", "--json"],
    { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.ok(out.refusals.some((r) => r.gate === "review-slot"));
  fs.rmSync(root, { recursive: true, force: true });
});

// A down spec_review slot (its CLI contract live) → degraded armed-state + refuse.
test("lights-out: down spec_review slot → degraded + refuse", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(
    ["lights-out", "--root", root, "--max", "5", "--slot-unreachable", "spec_review", "--json"],
    { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.equal(out.armed.spec_review, "degraded");
  assert.ok(out.refusals.some((r) => r.gate === "spec_review-slot"));
  fs.rmSync(root, { recursive: true, force: true });
});

// --check: would-proceed but mints NOTHING (a side-effect-free preflight probe).
// FAFF-325: --check still runs the FULL preflight (including the new corrective-integrity
// gate), so on this real, undeclared host it now correctly reports proceed:false too — the
// point of THIS test (mints nothing either way) still holds on both branches.
test("lights-out --check: never mints a run, on proceed OR refuse", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(["lights-out", "--root", root, "--max", "5", "--check", "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.ok(code === 0 || code === 1, stdout);
  if (code === 0) { assert.equal(out.proceed, true); assert.equal(out.checked, true); }
  else { assert.equal(out.proceed, false); assert.ok(out.refusals.some((r) => r.gate === "corrective-integrity")); }
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "--check mints nothing");
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-379 — worktree_isolation is now a LIVE floor gate. A worktree root resolving
// INSIDE the repo tree refuses with gate floor:worktree_isolation and a path-naming
// detail (formerly a vacuous always-true pass).
test("lights-out: FAFF_WORKTREE_ROOT inside the repo refuses (floor:worktree_isolation)", () => {
  const root = tmpRoot();
  const env = { ...CONTAINED, FAFF_WORKTREE_ROOT: path.join(root, "wt") };
  const { stdout, code } = runCli(["lights-out", "--root", root, "--check", "--json"], { env });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.equal(out.proceed, false);
  const f = out.refusals.find((r) => r.gate === "floor:worktree_isolation");
  assert.ok(f, "names the floor:worktree_isolation gate");
  assert.match(f.detail, /inside the repo/);
  assert.match(f.detail, new RegExp(path.join(root, "wt").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted on floor refusal");
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-379 — the DEFAULT resolution is now a live gate too: with HOME pointed at the
// repo root and no override, the default `$HOME/.faff/worktrees` lands inside the repo
// → refuse. (Proves the formerly-vacuous default path can now fire.)
test("lights-out: default worktree root inside the repo (HOME=repo) refuses", () => {
  const root = tmpRoot();
  const env = { ...CONTAINED, HOME: root };
  delete env.FAFF_WORKTREE_ROOT;
  const { stdout, code } = runCli(["lights-out", "--root", root, "--check", "--json"], { env });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.ok(out.refusals.some((r) => r.gate === "floor:worktree_isolation"), stdout);
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-379 — a worktree root OUTSIDE the repo (fresh tmpdir) satisfies floor:worktree_isolation
// on its own (never fires that gate), and the banner carries the per-entry checked/static mode
// tokens — the banner is computed + emitted on the refuse path too (FAFF-325's unrelated
// corrective-integrity refusal on this undeclared host doesn't suppress it).
test("lights-out --check: FAFF_WORKTREE_ROOT outside the repo satisfies worktree_isolation; banner carries mode tokens", () => {
  const root = tmpRoot();
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "faff-wt-"));
  const env = { ...CONTAINED, FAFF_WORKTREE_ROOT: path.join(wt, "roots") };
  const { stdout, code } = runCli(["lights-out", "--root", root, "--check", "--json"], { env });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.ok(!out.refusals.some((r) => r.gate === "floor:worktree_isolation"), "a worktree root outside the repo never fires this gate");
  assert.ok(out.refusals.some((r) => r.gate === "corrective-integrity"), "the only refusal is the unrelated FAFF-325 admission gate");
  assert.match(out.banner, /worktree-isolation ✓ checked/);
  assert.match(out.banner, /no-execute ✓ static/);
  assert.match(out.banner, /autonomous-contract ✓ static/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(wt, { recursive: true, force: true });
});

// FAFF-379 — a worktree root whose nearest existing ancestor is not writable refuses
// (creatability probe). Skipped as root: a chmod-based writability denial is a no-op
// for uid 0, so W_OK still succeeds and the refusal would not fire.
test("lights-out: worktree root under a non-writable ancestor refuses",
  { skip: (process.getuid && process.getuid() === 0) ? "chmod writability denial is a no-op for uid 0" : false },
  () => {
    const root = tmpRoot();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "faff-ro-"));
    fs.chmodSync(base, 0o500); // r-x: not writable
    const env = { ...CONTAINED, FAFF_WORKTREE_ROOT: path.join(base, "wt") };
    const { stdout, code } = runCli(["lights-out", "--root", root, "--check", "--json"], { env });
    const out = JSON.parse(stdout);
    assert.equal(code, 1, stdout);
    const f = out.refusals.find((r) => r.gate === "floor:worktree_isolation");
    assert.ok(f, "names the floor:worktree_isolation gate");
    assert.match(f.detail, /not writable/);
    fs.chmodSync(base, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  });

// Real-CLI admission: on this host (no genuine declaration) the FAFF-325 gate is the ONLY
// refusal — every OTHER guardrail is live, proving the pre-existing 8-guardrail reachability
// logic is untouched by this ticket.
test("lights-out: real CLI — every pre-existing guardrail is live; corrective-integrity is the ONLY refusal on this host", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(
    ["lights-out", "--root", root, "--max", "5", "--json"],
    { env: { ...CONTAINED, FAFF_SESSION_ID: "test-lo" } });
  assert.equal(code, 1, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.proceed, false);
  assert.equal(out.level, "L4");
  assert.equal(out.container, "contained");
  assert.equal(Object.keys(out.armed).length, 8);
  assert.ok(Object.values(out.armed).every((s) => s === "live"), "every pre-existing guardrail is live");
  assert.deepEqual(out.refusals.map((r) => r.gate), ["corrective-integrity"], "the ONLY refusal on this host");
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted");
  fs.rmSync(root, { recursive: true, force: true });
});

// Proceed path (via mintFixtureLedger — see its header comment): mint a strict-defaults L4
// run-ledger (armed:Map<Guardrail,State>), persist the banner derivable 1:1 from armed, and
// emit a run-start event.
test("lights-out: proceed mints an L4 run-ledger + banner + run-start event", () => {
  const root = tmpRoot();
  const { runDir, runId, ledger: minted } = mintFixtureLedger(root, { maxAttempts: 5, sessionId: "test-lo" });
  // all 8 guardrails live, armed covers exactly the 8.
  assert.equal(Object.keys(minted.armed).length, 8);
  assert.ok(Object.values(minted.armed).every((s) => s === "live"));

  const ledgerPath = path.join(runDir, "run-ledger.json");
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  assert.equal(ledger.level, "L4");
  assert.deepEqual(ledger.armed, minted.armed);
  assert.equal(ledger.owner.status, "running");
  assert.equal(ledger.owner.session_id, "test-lo");
  assert.deepEqual(ledger.admitted, []);
  assert.deepEqual(ledger.outcomes, {});
  assert.equal(ledger.budget_ceiling.max_attempts, 5);
  // FAFF-379: the ledger floor object stays byte-shape-identical — {key: boolean}, no
  // nested {holds,mode} — so runcheck / ledger consumers see no schema change. Mode
  // honesty rides on the persisted banner, not the floor object.
  assert.deepEqual(ledger.floor, { no_execute: true, worktree_isolation: true, autonomous_contract: true });
  for (const k of Object.keys(ledger.floor)) assert.equal(typeof ledger.floor[k], "boolean", `floor.${k} is a boolean`);
  // banner persisted (not just printed) and derivable 1:1 from armed.
  assert.equal(ledger.banner, minted.banner);
  for (const id of Object.keys(minted.armed)) assert.ok(ledger.banner.includes(id), `banner names ${id}`);

  // run-start event emitted onto the observability timeline.
  const events = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "run-start");
  assert.equal(events[0].phase, "run");
  assert.equal(events[0].run_id, runId);
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-305/FAFF-309 — banner honesty (via mintFixtureLedger): the proceed path reports each
// guardrail's enforcement state (reachable vs enforced), distinct from armed reachability. Once
// the per-run holdout phase invokes the env→evaluate chain (FAFF-309), `holdout` is
// enforced too, so all 8 count and the status line reads 8/8 — while `proceed` is
// unchanged (banner honesty only, never gated on enforcement).
test("lights-out: proceed reports enforced map (8/8) + ledger carries it", () => {
  const root = tmpRoot();
  const { runDir, ledger: minted } = mintFixtureLedger(root, { maxAttempts: 5 });
  // enforced map: exactly the 8 ids, all true (holdout now enforced by the per-run phase).
  assert.equal(Object.keys(minted.enforced).length, 8);
  assert.equal(minted.enforced.holdout, true);
  assert.equal(Object.values(minted.enforced).filter((v) => v === true).length, 8);
  // status line states 8/8 enforced with no trailing reachable-but-not-enforced clause.
  assert.match(minted.banner, /ARMED — 8\/8 enforced/);
  assert.ok(!minted.banner.includes("reachable-but-not-enforced"));
  // no guardrail line shows a bare "live" without an enforcement token.
  const guardrailLines = minted.banner.split("\n").filter((l) => /^ {4}[●◐○] /.test(l));
  assert.equal(guardrailLines.length, 8);
  assert.ok(guardrailLines.every((l) => /\b(enforced|reachable-only)\b/.test(l)), "every line has an enforcement token");
  assert.ok(guardrailLines.some((l) => /\bholdout\b/.test(l) && /reachable:live/.test(l) && /\benforced\b/.test(l)));
  // ledger persists enforced alongside armed, matching the mint.
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.deepEqual(ledger.enforced, minted.enforced);
  assert.equal(ledger.banner, minted.banner);
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-351 — L4 is shipped-and-reachable but not yet proven on a real end-to-end holdout
// run, so the banner carries a "(preview)" caveat on the runtime surface an operator
// confirms an L4 run against (mirrors the gateway levels table + guarantee table). The
// caveat rides both the headline and the level line, and survives into the persisted ledger.
test("lights-out: banner carries the L4 (preview) caveat, persisted to the ledger", () => {
  const root = tmpRoot();
  const { runDir, ledger: minted } = mintFixtureLedger(root, { maxAttempts: 5 });
  assert.match(minted.banner, /faff lights-out — L4 \(preview\) run banner/);
  assert.match(minted.banner, /level: L4 \(preview\)/);
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.match(ledger.banner, /L4 \(preview\)/);
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-298 — dial-coherence end-to-end: a fully-contained, budgeted run whose dials
// are each individually valid but JOINTLY reckless (non-adversarial review + advisory
// gates) refuses at preflight with the named dial-coherence gates, mints nothing.
test("lights-out: reckless dial combination refuses (non-adversarial review + advisory gates)", () => {
  const root = tmpRoot({ review: "faffter-noon-review", gates_fallback: "advisory" });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--max", "5", "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.equal(out.proceed, false);
  assert.ok(out.refusals.some((r) => r.gate === "dial-coherence:adversarial-review"), "names the non-adversarial review gate");
  assert.ok(out.refusals.some((r) => r.gate === "dial-coherence:gates-fallback"), "names the advisory gates.fallback gate");
  // every coherence refusal carries a non-empty detail (greppable + human-readable).
  for (const r of out.refusals.filter((x) => x.gate.startsWith("dial-coherence:"))) {
    assert.ok(typeof r.detail === "string" && r.detail.length > 0, `${r.gate} has a detail`);
  }
  // FAFF-468 — the gates-fallback remedy points the operator at the .faffrc.local.yaml
  // overlay (not the shared committed base) and names the fail-closed target value.
  const gatesRef = out.refusals.find((r) => r.gate === "dial-coherence:gates-fallback");
  assert.match(gatesRef.detail, /\.faffrc\.local\.yaml/, "gates-fallback remedy names the overlay");
  assert.match(gatesRef.detail, /fail-closed/, "gates-fallback remedy names the fail-closed target");
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted on a reckless dial");
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-377 — a named recipe does NOT bypass dial-coherence: VETTED_RECIPES is empty,
// so `recipe: mature-prod` paired with an otherwise-reckless dial (non-adversarial
// review + spec_review, advisory gates) still refuses on the named dial-coherence
// gates, exactly as an un-named reckless dial would.
test("lights-out: named recipe + reckless dial still refuses (no name-based bypass)", () => {
  const root = tmpRoot({
    recipe: "mature-prod",
    review: "faffter-noon-review",
    spec_review: "faffter-noon-spec-review",
    gates_fallback: "advisory",
  });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--max", "5", "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.equal(out.proceed, false);
  const coherenceRefusals = out.refusals.filter((r) => r.gate.startsWith("dial-coherence:"));
  assert.ok(coherenceRefusals.length >= 1, "at least one dial-coherence refusal fires");
  assert.ok(out.refusals.some((r) => r.gate === "dial-coherence:adversarial-review"), "names the non-adversarial review gate");
  // FAFF-468 — the single-pass spec_review trips adversarial-spec-review, and its remedy
  // points the operator at the .faffrc.local.yaml overlay + the adversarial target occupant.
  const specReviewRef = out.refusals.find((r) => r.gate === "dial-coherence:adversarial-spec-review");
  assert.ok(specReviewRef, "the single-pass spec_review trips the adversarial-spec-review gate");
  assert.match(specReviewRef.detail, /\.faffrc\.local\.yaml/, "spec_review remedy names the overlay");
  assert.match(specReviewRef.detail, /faffter-dark-spec-review/, "spec_review remedy names the adversarial target");
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted — a recipe name never auto-passes");
  fs.rmSync(root, { recursive: true, force: true });
});

// Integration smoke: the minted ledger + events are consumed cleanly by the very
// contracts the runner composes — events validate, runcheck (clean), budget check
// (honours the recorded envelope). "If this connects, the plumbing is wired."
test("lights-out: minted run is consumed cleanly by events/runcheck/budget", () => {
  const root = tmpRoot();
  const { runDir: run_dir } = mintFixtureLedger(root, { maxAttempts: 5 });

  const ev = runCli(["events", "validate", "--file", path.join(run_dir, "events.jsonl")]);
  assert.equal(ev.code, 0, ev.stdout + ev.stderr);

  const rc = runCli(["runcheck", run_dir]);
  assert.equal(rc.code, 0, rc.stdout + rc.stderr);
  assert.match(rc.stdout, /clean/);

  const bc = runCli(["budget", "check", "--run-dir", run_dir, "--json"]);
  assert.equal(bc.code, 0, bc.stdout + bc.stderr);
  const state = JSON.parse(bc.stdout);
  assert.equal(state.outcome, "none"); // a fresh run has breached nothing
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-364 — a malformed budget.until must never mint a run carrying a vacuous
// until ceiling (a value that parses to null and can therefore never breach).
// Fires even alongside a clean, well-formed budget.tokens ceiling.
test("lights-out: malformed budget.until refuses, names the raw value, mints nothing", () => {
  const root = tmpRoot({ budget: "budget:\n  tokens: 50000000\n  until: \"25:00\"\n" });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.equal(out.proceed, false);
  const bui = out.refusals.find((r) => r.gate === "budget-until-invalid");
  assert.ok(bui, "names the budget-until-invalid gate");
  assert.match(bui.detail, /25:00/);
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted on a malformed until");
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-364 — a malformed until AS THE ONLY ceiling refuses on BOTH gates: it can
// never satisfy budget-ceiling (until resolves to null) AND it independently names
// budget-until-invalid — each refusal points at its own remedy.
test("lights-out: malformed until as the only ceiling → both budget-ceiling and budget-until-invalid fire", () => {
  const root = tmpRoot({ budget: "budget:\n  until: \"garbage\"\n" });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.ok(out.refusals.some((r) => r.gate === "budget-ceiling"), "budget-ceiling also fires (until resolved to null)");
  assert.ok(out.refusals.some((r) => r.gate === "budget-until-invalid"), "budget-until-invalid names the malformed value");
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted");
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-364 — a valid --until flag overriding a malformed config value proceeds
// clean: no refusal, no warning, and the minted envelope carries the flag's value.
test("lights-out: valid --until flag over malformed config resolves clean (no budget-until-invalid)", () => {
  const root = tmpRoot({ budget: "budget:\n  until: \"25:00\"\n" });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--until", "06:00", "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout); // FAFF-325: corrective-integrity refuses on this undeclared host
  assert.ok(!out.refusals.some((r) => r.gate === "budget-until-invalid"), "the valid --until flag resolves clean (unrelated to the FAFF-325 refusal)");
  const { runDir } = mintFixtureLedger(root, { untilFlag: "06:00" });
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(ledger.budget.envelope.ceilings.until, "06:00", "the valid flag value wins and is minted");
  assert.equal(ledger.budget.envelope.until_invalid ?? null, null, "no until_invalid on a clean resolution");
  fs.rmSync(root, { recursive: true, force: true });
});

// ===========================================================================
// FAFF-428 — the L4 spend governor must be MEASURABLE, not merely configured.
// CONTAINED-but-transcript-free: a fresh --root tmpdir has no matching
// ~/.claude/projects/<encoded> directory, so `measureTokensByClass` resolves
// estimate-only regardless of whether CLAUDE_CODE_SESSION_ID happens to be set in
// the ambient test-running environment — these fixtures explicitly strip it too, so
// the estimate-only path is unambiguous and never accidentally measurable. Also pin
// CLAUDE_CONFIG_DIR to a fresh, guaranteed-empty tmpdir (adversarial review finding,
// FAFF-428) — the "no transcript" property must be STRUCTURAL (no project dir can
// possibly exist there), not merely incidental on the deleted session id; a future
// edit that reintroduces CLAUDE_CODE_SESSION_ID here must not silently flip these
// fixtures to "measurable" via a stray real ~/.claude/projects/ entry.
const CONTAINED_NO_TRANSCRIPT = (() => {
  const env = { ...CONTAINED };
  delete env.CLAUDE_CODE_SESSION_ID;
  env.CLAUDE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "faff-lo-no-transcript-cfg-"));
  return env;
})();

// AC / Scenario 1 — an L4 config with a token-dependent ceiling (tokens) and
// unreadable transcripts REFUSES by default: exit 1, gate budget-metering, no run
// ledger minted.
test("lights-out: estimate-only metering + a tokens ceiling refuses by default (budget-metering)", () => {
  const root = tmpRoot({ budget: "budget:\n  tokens: 50000000\n" }); // no on_estimate_only ⇒ refuse default
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED_NO_TRANSCRIPT });
  const out = JSON.parse(stdout);
  assert.equal(code, 1, stdout);
  assert.equal(out.proceed, false);
  const bm = out.refusals.find((r) => r.gate === "budget-metering");
  assert.ok(bm, "names the budget-metering gate");
  assert.match(bm.detail, /estimate-only/);
  assert.match(bm.detail, /budget\.on_estimate_only: warn/, "names the warn opt-out remedy");
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted on an unmeasurable meter");
  fs.rmSync(root, { recursive: true, force: true });
});

// Scenario 2 — the same config plus `budget.on_estimate_only: warn` PROCEEDS: the
// JSON carries degrades[] naming budget-metering, and the minted ledger records
// budget.metering = { source_at_mint: "estimate", degraded: true }.
test("lights-out: budget.on_estimate_only warn proceeds; ledger records the metering degrade", () => {
  const root = tmpRoot({ budget: "budget:\n  tokens: 50000000\n  on_estimate_only: warn\n" });
  const { runDir, pf } = mintFixtureLedger(root, { env: CONTAINED_NO_TRANSCRIPT });
  assert.ok(Array.isArray(pf.degrades) && pf.degrades.some((d) => d.gate === "budget-metering"), JSON.stringify(pf.degrades));
  assert.match(pf.banner, /degraded \(proceeding\)/);
  assert.match(pf.banner, /budget-metering/);
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.deepEqual(ledger.budget.metering, { source_at_mint: "estimate", degraded: true });
  fs.rmSync(root, { recursive: true, force: true });
});

// Scenario 3 — an L4 config whose ONLY ceiling is budget.until (a clock, not a token
// meter) with unreadable transcripts does NOT fire budget-metering — a clock ceiling
// needs no token meter.
test("lights-out: until-only ceiling + estimate-only metering never fires budget-metering", () => {
  const root = tmpRoot({ budget: "budget:\n  until: \"23:59\"\n" }); // no tokens/cost — until only
  const { runDir, pf } = mintFixtureLedger(root, { untilFlag: "23:59", env: CONTAINED_NO_TRANSCRIPT });
  assert.ok(!pf.degrades || pf.degrades.length === 0, "an until-only ceiling never degrades on metering either");
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(ledger.budget.metering.source_at_mint, "estimate", "the mint still HONESTLY records the sampled source");
  assert.equal(ledger.budget.metering.degraded, false, "not a degrade — the gate never fired for an until-only governor");
  fs.rmSync(root, { recursive: true, force: true });
});

// A clean, measurable L4 run (real transcript) mints degraded:false and carries no
// budget-metering entries anywhere — the byte-identical-to-today assertion.
test("lights-out: a measurable meter (real transcript) mints degraded:false, no degrades/refusals", () => {
  const root = tmpRoot({ budget: "budget:\n  tokens: 50000000\n" });
  const sid = "test-lo-measurable";
  const projdir = path.join(root, "cfg", "projects", root.replace(/\//g, "-"));
  fs.mkdirSync(projdir, { recursive: true });
  fs.writeFileSync(path.join(projdir, `${sid}.jsonl`),
    JSON.stringify({ sessionId: sid, message: { usage: { input_tokens: 10, output_tokens: 5 } } }));
  const env = { ...CONTAINED_NO_TRANSCRIPT, CLAUDE_CONFIG_DIR: path.join(root, "cfg"), CLAUDE_CODE_SESSION_ID: sid };
  const { runDir, pf } = mintFixtureLedger(root, { env });
  assert.ok(!pf.degrades || pf.degrades.length === 0, JSON.stringify(pf.degrades));
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.deepEqual(ledger.budget.metering, { source_at_mint: "transcript", degraded: false });
  fs.rmSync(root, { recursive: true, force: true });
});
