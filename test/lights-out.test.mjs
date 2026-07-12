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
  fs.writeFileSync(
    path.join(dir, ".faffrc.yaml"),
    `${recipeLine}slots:\n  review: ${review}\n  spec_review: ${specReview}\ngates:\n  fallback: ${gatesFallback}\n${budgetBlock}`);
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
test("lights-out: budget.cost alone (no price_per_mtok) PROCEEDS — the default map-priced dollar ceiling (AC 2)", () => {
  // FAFF-428: on_estimate_only: warn — this fixture has no real transcript, so the
  // cost-armed ceiling would otherwise refuse on estimate-only metering (a different
  // gate than the one under test here).
  const root = tmpRoot({ budget: "budget:\n  cost: 25\n  on_estimate_only: warn\n" }); // no price_per_mtok ⇒ map pricing, always priceable
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  assert.equal(out.proceed, true);
  assert.ok(!out.refusals || !out.refusals.some((r) => r.gate === "budget-ceiling"), "no budget-ceiling refusal");
  assert.ok(fs.existsSync(path.join(root, ".faff")), "a run WAS minted — the dollar ceiling alone satisfied the gate");
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
test("lights-out: tokens ceiling proceeds; minted envelope defaults at_ceiling escalate", () => {
  // FAFF-428: on_estimate_only: warn — no real transcript in this fixture.
  const root = tmpRoot({ budget: "budget:\n  tokens: 50000000\n  on_estimate_only: warn\n" });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  assert.equal(out.proceed, true);
  const ledger = JSON.parse(fs.readFileSync(path.join(out.run_dir, "run-ledger.json"), "utf8"));
  assert.equal(ledger.budget.envelope.at_ceiling, "escalate", "L4 mint-time default when config unset");
  assert.equal(ledger.budget.envelope.ceilings.tokens, 50000000);
  assert.equal(ledger.budget.envelope.ceilings.max_attempts, null);
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-312 — an explicit budget.at_ceiling: stop is minted verbatim (human-explicit
// config outranks the level default; the operator asked for a quiet stop at ceiling).
test("lights-out: explicit budget.at_ceiling stop is minted verbatim", () => {
  // FAFF-428: on_estimate_only: warn — no real transcript in this fixture.
  const root = tmpRoot({ budget: "budget:\n  tokens: 50000000\n  at_ceiling: stop\n  on_estimate_only: warn\n" });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  const ledger = JSON.parse(fs.readFileSync(path.join(out.run_dir, "run-ledger.json"), "utf8"));
  assert.equal(ledger.budget.envelope.at_ceiling, "stop", "explicit stop honoured, not overridden to escalate");
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-312 — the minted escalate at_ceiling is what `faff budget check --run-dir`
// reports on breach: tokens satisfies the precondition, max_attempts:1 rides as an
// extra backstop, and a forced 2-outcome breach yields outcome "escalate" (→ Sentry's
// budget-breach signal + run-done's fixed-floor escalation, never a silent stop).
test("lights-out: budget check --run-dir reflects the minted escalate at_ceiling on breach", () => {
  // FAFF-428: on_estimate_only: warn — no real transcript in this fixture.
  const root = tmpRoot({ budget: "budget:\n  tokens: 50000000\n  max_attempts: 1\n  on_estimate_only: warn\n" });
  const mint = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED });
  const { run_dir } = JSON.parse(mint.stdout);
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
test("lights-out --check: passes preflight without minting a run", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(["lights-out", "--root", root, "--max", "5", "--check", "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  assert.equal(out.proceed, true);
  assert.equal(out.checked, true);
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

// FAFF-379 — a worktree root OUTSIDE the repo (fresh tmpdir) proceeds, and the banner
// carries the per-entry checked/static mode tokens.
test("lights-out --check: FAFF_WORKTREE_ROOT outside the repo proceeds; banner carries mode tokens", () => {
  const root = tmpRoot();
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "faff-wt-"));
  const env = { ...CONTAINED, FAFF_WORKTREE_ROOT: path.join(wt, "roots") };
  const { stdout, code } = runCli(["lights-out", "--root", root, "--check", "--json"], { env });
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  assert.equal(out.proceed, true);
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

// Proceed path: mint a strict-defaults L4 run-ledger (armed:Map<Guardrail,State>),
// persist the banner derivable 1:1 from armed, and emit a run-start event.
test("lights-out: proceed mints an L4 run-ledger + banner + run-start event", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(
    ["lights-out", "--root", root, "--max", "5", "--json"],
    { env: { ...CONTAINED, FAFF_SESSION_ID: "test-lo" } });
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.proceed, true);
  assert.equal(out.level, "L4");
  assert.equal(out.container, "contained");
  // all 8 guardrails live, armed covers exactly the 8.
  assert.equal(Object.keys(out.armed).length, 8);
  assert.ok(Object.values(out.armed).every((s) => s === "live"));

  const ledgerPath = path.join(out.run_dir, "run-ledger.json");
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  assert.equal(ledger.level, "L4");
  assert.deepEqual(ledger.armed, out.armed);
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
  assert.equal(ledger.banner, out.banner);
  for (const id of Object.keys(out.armed)) assert.ok(ledger.banner.includes(id), `banner names ${id}`);

  // run-start event emitted onto the observability timeline.
  const events = fs.readFileSync(path.join(out.run_dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "run-start");
  assert.equal(events[0].phase, "run");
  assert.equal(events[0].run_id, out.run_id);
  fs.rmSync(root, { recursive: true, force: true });
});

// FAFF-305/FAFF-309 — banner honesty: the proceed path reports each guardrail's
// enforcement state (reachable vs enforced), distinct from armed reachability. Once
// the per-run holdout phase invokes the env→evaluate chain (FAFF-309), `holdout` is
// enforced too, so all 8 count and the status line reads 8/8 — while `proceed` is
// unchanged (banner honesty only, never gated on enforcement).
test("lights-out: proceed reports enforced map (8/8) + ledger carries it", () => {
  const root = tmpRoot();
  const { stdout, code } = runCli(["lights-out", "--root", root, "--max", "5", "--json"], { env: CONTAINED });
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.proceed, true); // enforcement does not gate — identical to pre-change
  // enforced map: exactly the 8 ids, all true (holdout now enforced by the per-run phase).
  assert.equal(Object.keys(out.enforced).length, 8);
  assert.equal(out.enforced.holdout, true);
  assert.equal(Object.values(out.enforced).filter((v) => v === true).length, 8);
  // status line states 8/8 enforced with no trailing reachable-but-not-enforced clause.
  assert.match(out.banner, /ARMED — 8\/8 enforced/);
  assert.ok(!out.banner.includes("reachable-but-not-enforced"));
  // no guardrail line shows a bare "live" without an enforcement token.
  const guardrailLines = out.banner.split("\n").filter((l) => /^ {4}[●◐○] /.test(l));
  assert.equal(guardrailLines.length, 8);
  assert.ok(guardrailLines.every((l) => /\b(enforced|reachable-only)\b/.test(l)), "every line has an enforcement token");
  assert.ok(guardrailLines.some((l) => /\bholdout\b/.test(l) && /reachable:live/.test(l) && /\benforced\b/.test(l)));
  // ledger persists enforced alongside armed, matching the JSON.
  const ledger = JSON.parse(fs.readFileSync(path.join(out.run_dir, "run-ledger.json"), "utf8"));
  assert.deepEqual(ledger.enforced, out.enforced);
  assert.equal(ledger.banner, out.banner);
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
  assert.ok(!fs.existsSync(path.join(root, ".faff")), "no run minted — a recipe name never auto-passes");
  fs.rmSync(root, { recursive: true, force: true });
});

// Integration smoke: the minted ledger + events are consumed cleanly by the very
// contracts the runner composes — events validate, runcheck (clean), budget check
// (honours the recorded envelope). "If this connects, the plumbing is wired."
test("lights-out: minted run is consumed cleanly by events/runcheck/budget", () => {
  const root = tmpRoot();
  const mint = runCli(["lights-out", "--root", root, "--max", "5", "--json"], { env: CONTAINED });
  const { run_dir } = JSON.parse(mint.stdout);

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
test("lights-out: valid --until flag over malformed config proceeds clean", () => {
  const root = tmpRoot({ budget: "budget:\n  until: \"25:00\"\n" });
  const { stdout, code } = runCli(["lights-out", "--root", root, "--until", "06:00", "--json"], { env: CONTAINED });
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  assert.equal(out.proceed, true);
  assert.ok(!out.refusals, "no refusals key on a proceeding run");
  const ledger = JSON.parse(fs.readFileSync(path.join(out.run_dir, "run-ledger.json"), "utf8"));
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
// the estimate-only path is unambiguous and never accidentally measurable.
// ===========================================================================
const CONTAINED_NO_TRANSCRIPT = (() => {
  const env = { ...CONTAINED };
  delete env.CLAUDE_CODE_SESSION_ID;
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
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED_NO_TRANSCRIPT });
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  assert.equal(out.proceed, true);
  assert.ok(Array.isArray(out.degrades) && out.degrades.some((d) => d.gate === "budget-metering"), JSON.stringify(out.degrades));
  assert.match(out.banner, /degraded \(proceeding\)/);
  assert.match(out.banner, /budget-metering/);
  const ledger = JSON.parse(fs.readFileSync(path.join(out.run_dir, "run-ledger.json"), "utf8"));
  assert.deepEqual(ledger.budget.metering, { source_at_mint: "estimate", degraded: true });
  fs.rmSync(root, { recursive: true, force: true });
});

// Scenario 3 — an L4 config whose ONLY ceiling is budget.until (a clock, not a token
// meter) with unreadable transcripts does NOT fire budget-metering — a clock ceiling
// needs no token meter.
test("lights-out: until-only ceiling + estimate-only metering never fires budget-metering", () => {
  const root = tmpRoot({ budget: "budget:\n  until: \"23:59\"\n" }); // no tokens/cost — until only
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env: CONTAINED_NO_TRANSCRIPT });
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  assert.equal(out.proceed, true);
  assert.ok(!out.refusals, "no refusals key on a proceeding run");
  assert.ok(!out.degrades || out.degrades.length === 0, "an until-only ceiling never degrades on metering either");
  const ledger = JSON.parse(fs.readFileSync(path.join(out.run_dir, "run-ledger.json"), "utf8"));
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
  const { stdout, code } = runCli(["lights-out", "--root", root, "--json"], { env });
  const out = JSON.parse(stdout);
  assert.equal(code, 0, stdout);
  assert.equal(out.proceed, true);
  assert.ok(!out.degrades || out.degrades.length === 0, JSON.stringify(out.degrades));
  const ledger = JSON.parse(fs.readFileSync(path.join(out.run_dir, "run-ledger.json"), "utf8"));
  assert.deepEqual(ledger.budget.metering, { source_at_mint: "transcript", degraded: false });
  fs.rmSync(root, { recursive: true, force: true });
});
