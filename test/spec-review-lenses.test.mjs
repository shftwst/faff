// FAFF-268 — the `faff spec-review-lenses` subcommand: change-surface lens selection.
// The cost-gate that runs IN FRONT OF the spec_review producer (FAFF-265 spine, FAFF-266
// L1–L3 reviewer, FAFF-267 L4 refuters). A pure, deterministic map from a spec's CLASSIFIED
// change-surface tags + level + appetite to a LensSelection {lenses, mode, rationale}. The
// heuristic signal→tag classification is the prose layer's (faff-prep) — NOT tested here;
// this asserts the deterministic mapping. Parity with `faff eligible` / `faff admissible`.
//
// The load-bearing invariants (ADR 0028 — safe-direction / additive-only): infosec + QA are
// sticky at L1–L3; only architectural (or methodology when no tag adds it) is ever dropped;
// an unclassified/unrecognised surface fails safe to all four; the four-lens enum and the
// verdict contract are never widened.
//
// FAFF-1343: `mode` is NO LONGER pinned to the L4 mint. It follows whether an adversarial
// spec_review chain is CONFIGURED, at every level, so an operator who configures the
// adversarial occupant gets per-lens refuters on an ordinary L3 drain instead of silently
// getting the collapsed checklist. L4 keeps one level-specific rule and it is the opposite
// of a degrade: with no configured chain it FAILS CLOSED (exit 3). Because configuredness is
// now an input, every test below passes `--adversarial-configured` EXPLICITLY — a test that
// let it resolve from the ambient repo config would assert on whatever `.faff/config.yaml`
// happens to say and flip with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const run = (args) =>
  spawnSync(process.execPath, [BIN, "spec-review-lenses", ...args], { cwd: REPO, encoding: "utf8" });
// Default to an UNCONFIGURED chain so a bare sel() asserts the single-pass branch
// deterministically regardless of this repo's own .faff/config.yaml; pass the flag
// explicitly to exercise the adversarial branch.
const sel = (args) =>
  JSON.parse(run(args.some((a) => a === "--adversarial-configured") ? args : [...args, "--adversarial-configured", "no"]).stdout);
const ALL = ["architectural", "infosec", "methodology", "QA"];

test("--selftest verdict table passes (exit 0) and names every spec'd branch", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
  for (const frag of ["config-only", "auth-security", "ambiguous", "unknown tag", "L4", "low appetite", "medium appetite", "public-api", "data-schema", "sticky",
    "FAILS CLOSED", "out-of-enum level is REJECTED", "every level can reach it"]) {
    assert.match(r.stdout, new RegExp(frag));
  }
});

test("config-only L2 high → architectural skipped, infosec+QA fire, single-pass, rationale cites config (smoke test)", () => {
  const s = sel(["--tags", "config", "--level", "L2", "--appetite", "high"]);
  assert.ok(!s.lenses.includes("architectural"), "architectural must be skipped");
  assert.ok(s.lenses.includes("infosec"), "infosec sticky");
  assert.ok(s.lenses.includes("QA"), "QA sticky");
  assert.equal(s.mode, "single-pass");
  assert.match(s.rationale, /config/);
});

test("auth-security at any level → infosec is always in the lens-set (never skipped)", () => {
  // FAFF-1343: L4 now REQUIRES a configured chain, so declare one — the sticky-infosec
  // invariant this asserts is about the lens SET and holds in either mode.
  for (const level of ["L1", "L2", "L3", "L4"]) {
    const s = sel(["--tags", "auth-security", "--level", level, "--appetite", "full", "--adversarial-configured", "yes"]);
    assert.ok(s.lenses.includes("infosec"), `infosec must fire at ${level}`);
  }
});

test("ambiguous (no tags) → all four fire (fail-safe)", () => {
  const s = sel(["--tags", "", "--level", "L2", "--appetite", "high"]);
  assert.deepEqual(s.lenses, ALL);
});

test("unrecognised tag → fail-safe all four, rationale flags it", () => {
  const s = sel(["--tags", "mystery", "--level", "L3", "--appetite", "high"]);
  assert.deepEqual(s.lenses, ALL);
  assert.match(s.rationale, /unrecognised/);
});

test("L4 + configured chain → adversarial mode, all four, never narrowed by appetite even on a trivial surface", () => {
  const s = sel(["--tags", "config", "--level", "L4", "--appetite", "full", "--adversarial-configured", "yes"]);
  assert.equal(s.mode, "adversarial");
  assert.deepEqual(s.lenses, ALL);
});

// FAFF-1343 — mode follows CONFIGURATION, at every level.
test("a configured chain yields adversarial at EVERY level, not just L4", () => {
  for (const level of ["L1", "L2", "L3", "L4"]) {
    const s = sel(["--tags", "", "--level", level, "--adversarial-configured", "yes"]);
    assert.equal(s.mode, "adversarial", `level ${level} must reach adversarial when configured`);
  }
});

test("no configured chain yields single-pass at L1–L3 (unchanged below L4)", () => {
  for (const level of ["L1", "L2", "L3"]) {
    const s = sel(["--tags", "", "--level", level, "--adversarial-configured", "no"]);
    assert.equal(s.mode, "single-pass", `level ${level} must stay single-pass when unconfigured`);
  }
});

test("L4 with NO configured chain FAILS CLOSED on exit 3 — never degrades to single-pass", () => {
  const r = run(["--level", "L4", "--adversarial-configured", "no"]);
  assert.equal(r.status, 3, `expected exit 3, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.equal(r.stdout.trim(), "", "a refusal must emit no selection on stdout");
  assert.match(r.stderr, /L4 requires a configured adversarial spec_review chain/);
});

test("mode is orthogonal to the lens SET: a configured L3 still narrows by tag", () => {
  const s = sel(["--tags", "config", "--level", "L3", "--appetite", "high", "--adversarial-configured", "yes"]);
  assert.equal(s.mode, "adversarial");
  assert.ok(!s.lenses.includes("architectural"), "architectural still skipped on a config-only surface");
  assert.ok(s.lenses.includes("infosec") && s.lenses.includes("QA"), "infosec+QA still sticky");
});

test("an out-of-enum --level is rejected (exit 2), not coerced to single-pass", () => {
  for (const bad of ["4", "Lx", "l5", "L0"]) {
    const r = run(["--level", bad, "--adversarial-configured", "yes"]);
    assert.equal(r.status, 2, `--level ${bad} must be rejected, got ${r.status}`);
    assert.equal(r.stdout.trim(), "", `--level ${bad} must emit no selection`);
    assert.match(r.stderr, /--level must be one of L1\|L2\|L3\|L4/);
  }
});

test("an out-of-enum --level cannot BYPASS the L4 fail-closed refusal", () => {
  // The old resolver silently read a bare `4` as non-L4 and returned single-pass, so a
  // malformed level would have slipped past the refusal above entirely.
  const r = run(["--level", "4", "--adversarial-configured", "no"]);
  assert.notEqual(r.status, 0, "a malformed level must never produce a usable selection");
  assert.equal(r.stdout.trim(), "");
});

test("a lowercase level is still case-normalised, not rejected", () => {
  const s = sel(["--tags", "", "--level", "l4", "--adversarial-configured", "yes"]);
  assert.equal(s.mode, "adversarial");
});

test("an out-of-enum --adversarial-configured is rejected (exit 2), never defaulted", () => {
  const r = run(["--level", "L3", "--adversarial-configured", "maybe"]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout.trim(), "");
});

test("low/medium appetite widens to all four at L1–L3 (no skip)", () => {
  for (const app of ["low", "medium"]) {
    const s = sel(["--tags", "config", "--level", "L2", "--appetite", app]);
    assert.deepEqual(s.lenses, ALL, `${app} should widen`);
  }
});

test("public-api L3 high → architectural + methodology fire (positive-fire rule)", () => {
  const s = sel(["--tags", "public-api", "--level", "L3", "--appetite", "high"]);
  assert.ok(s.lenses.includes("architectural") && s.lenses.includes("methodology"));
  assert.ok(s.lenses.includes("infosec") && s.lenses.includes("QA"));
});

test("data-schema L3 high → architectural + infosec fire, methodology skipped", () => {
  const s = sel(["--tags", "data-schema", "--level", "L3", "--appetite", "high"]);
  assert.ok(s.lenses.includes("architectural") && s.lenses.includes("infosec") && s.lenses.includes("QA"));
  assert.ok(!s.lenses.includes("methodology"));
});

test("invariant: lenses are always ⊆ the four frozen lenses, mode in the enum, infosec+QA sticky at L1–L3", () => {
  for (const tags of ["config", "ui", "pure-logic", "config,ui", "auth-security,config"]) {
    for (const level of ["L1", "L2", "L3"]) {
      const s = sel(["--tags", tags, "--level", level, "--appetite", "high"]);
      assert.ok(s.lenses.every((l) => ALL.includes(l)), `lenses ⊆ frozen four for ${tags}@${level}`);
      assert.ok(["single-pass", "adversarial"].includes(s.mode));
      assert.ok(s.lenses.includes("infosec") && s.lenses.includes("QA"), `infosec+QA sticky for ${tags}@${level}`);
    }
  }
});

test("rationale is a non-empty audit-trail string (signals→tags→fired) in every selection", () => {
  for (const args of [["--tags", "config", "--level", "L2", "--appetite", "high"], ["--tags", "", "--level", "L3"],
    // L4 needs a configured chain post-FAFF-1343, else there is no selection to carry a rationale.
    ["--tags", "public-api", "--level", "L4", "--adversarial-configured", "yes"]]) {
    const s = sel(args);
    assert.equal(typeof s.rationale, "string");
    assert.ok(s.rationale.length > 0);
  }
});
