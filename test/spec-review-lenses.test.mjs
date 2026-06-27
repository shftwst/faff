// FAFF-268 — the `faff spec-review-lenses` subcommand: change-surface lens selection.
// The cost-gate that runs IN FRONT OF the spec_review producer (FAFF-265 spine, FAFF-266
// L1–L3 reviewer, FAFF-267 L4 refuters). A pure, deterministic map from a spec's CLASSIFIED
// change-surface tags + level + appetite to a LensSelection {lenses, mode, rationale}. The
// heuristic signal→tag classification is the prose layer's (faff-prep) — NOT tested here;
// this asserts the deterministic mapping. Parity with `faff eligible` / `faff admissible`.
//
// The load-bearing invariants (ADR 0028 — safe-direction / additive-only): infosec + QA are
// sticky at L1–L3; only architectural (or methodology when no tag adds it) is ever dropped;
// an unclassified/unrecognised surface fails safe to all four; L4 is pinned to all four
// adversarial; the four-lens enum and the verdict contract are never widened.
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
const sel = (args) => JSON.parse(run(args).stdout);
const ALL = ["architectural", "infosec", "methodology", "QA"];

test("--selftest verdict table passes (exit 0) and names every spec'd branch", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
  for (const frag of ["config-only", "auth-security", "ambiguous", "unknown tag", "L4", "low appetite", "medium appetite", "public-api", "data-schema", "sticky"]) {
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
  for (const level of ["L1", "L2", "L3", "L4"]) {
    const s = sel(["--tags", "auth-security", "--level", level, "--appetite", "full"]);
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

test("L4 → adversarial mode, all four, never narrowed by appetite even on a trivial surface", () => {
  const s = sel(["--tags", "config", "--level", "L4", "--appetite", "full"]);
  assert.equal(s.mode, "adversarial");
  assert.deepEqual(s.lenses, ALL);
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
  for (const args of [["--tags", "config", "--level", "L2", "--appetite", "high"], ["--tags", "", "--level", "L3"], ["--tags", "public-api", "--level", "L4"]]) {
    const s = sel(args);
    assert.equal(typeof s.rationale, "string");
    assert.ok(s.rationale.length > 0);
  }
});
