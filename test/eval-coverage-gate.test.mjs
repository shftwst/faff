// FAFF-281 — lintable eval-coverage gate in `faff validate-adapters` (C1/C2 + slot-sibling relaxation).
// Born-verifiable scenarios from the spec. C2-fail (a `covered` kind with its cases deleted) is left to
// the manual smoke (`rm eval/cases/<kind>-*.json`) — mutating the shared real eval/cases/ would race the
// other test files that lint the real tree in parallel.
//
// FAFF-616 — the `calibrated` seam-registry tier + C3 accuracy-floor gate. C3 fixtures live in their
// own `--root` tmp tree (registry + eval/cases/ + eval/baselines/frontier.json), never the shared real
// eval/, so they never race the other test files linting the real tree in parallel — the same reason
// C2-fail above is left to a manual smoke rather than mutating eval/cases/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const LIB_PATH = join(REPO, "plugin", "skills", "faff", "bin", "lib", "validate-adapters.js");
const require = createRequire(import.meta.url);
const { checkCalibrated, c3CalibrationFloor, loadSeamRegistryForLint } = require(LIB_PATH);

function runValidate(extraSkillsDir, configured) {
  const args = [BIN, "validate-adapters"];
  if (configured) args.push("--configured");
  if (extraSkillsDir) args.push("--skills-dir", extraSkillsDir);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}
function runOnFixtures(fixtures, configured) {
  const dir = mkdtempSync(join(tmpdir(), "faff-cov-"));
  for (const [name, body] of Object.entries(fixtures)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "SKILL.md"), body);
  }
  const r = runValidate(dir, configured);
  rmSync(dir, { recursive: true, force: true });
  return r;
}
// frontmatter with an optional judgement_seam line (omit `seam` to leave the key ABSENT)
const fm = (name, seam) =>
  `---\nname: ${name}\ndescription: "x"\nuser-invocable: false\n` +
  (seam === undefined ? "" : `judgement_seam: ${seam}\n`) + `---\n\nbody\n`;

test("shipped tree passes the eval-coverage gate (exit 0, no `(eval coverage)` FAIL)", () => {
  const r = runValidate();
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /\(eval coverage\)/);
});

test("shipped tree has no advisory `undeclared` surface left; designed kinds are advisory NEEDS-CASES", () => {
  const r = runValidate();
  // The post-265 backfill family has fully landed, so no shipped registry/slot skill is undeclared:
  // FAFF-285 faffter-noon-architecture (owns `architecture`), FAFF-284 faffter-noon-evaluate (owns
  // `holdout`), FAFF-282 faffter-noon-spec-review (owns `spec-verdict`) + its sibling faffter-dark-spec-
  // review (sibling relaxation) all reconcile clean. FAFF-286 closes the last two: faffter-noon-adr owns
  // the `adr-gloss` row (declares `judgement_seam: adr-gloss`), and faffter-noon-env-compose is declared-
  // deterministic (`judgement_seam: none`, no registry row) — so neither is undeclared any more.
  assert.doesNotMatch(r.stdout, /UNDECLARED  /);
  for (const n of ["faffter-noon-env-compose", "faffter-noon-adr"]) {
    assert.doesNotMatch(r.stdout, new RegExp(`UNDECLARED  ${n} `), `${n} is now declared, not undeclared`);
  }
  // the two still-`designed` (zero-case) kinds remain advisory NEEDS-CASES
  assert.match(r.stdout, /NEEDS-CASES  reconciliation /);
  assert.match(r.stdout, /NEEDS-CASES  verdict-build /);
});

test("C1: a registry SURFACE with no judgement_seam key FAILS (eval coverage)", () => {
  const r = runOnFixtures({ "faff-tidy": fm("faff-tidy") }); // faff-tidy owns 6 KINDs in the registry
  assert.match(r.stdout, /FAIL  faff-tidy \(eval coverage\)/);
  assert.match(r.stdout, /no `judgement_seam:` declaration/);
  assert.notEqual(r.status, 0);
});

test("C1: an unrowed REGISTRY slot-skill with no key is advisory undeclared, NOT an eval-coverage FAIL", () => {
  // FAFF-285: faffter-noon-architecture is now a registry SURFACE, so the exemplar of a still-unrowed
  // REGISTRY slot-skill is faffter-noon-env-compose (no registry row → advisory undeclared, not a fail).
  const r = runOnFixtures({ "faffter-noon-env-compose": fm("faffter-noon-env-compose") });
  assert.match(r.stdout, /UNDECLARED  faffter-noon-env-compose /);
  assert.doesNotMatch(r.stdout, /faffter-noon-env-compose \(eval coverage\)/);
});

test("slot-sibling relaxation: an alternate declaring its sibling's KINDs reconciles clean", () => {
  // FAFF-241: faffter-noon-spec's sibling row-set is now [confidence, marker, specqual], so an alternate
  // that declares all three reconciles clean (the sibling relaxation, one KIND wider than before).
  const r = runOnFixtures({ "faffter-dark-nlspec": fm("faffter-dark-nlspec", "confidence, marker, specqual") });
  assert.doesNotMatch(r.stdout, /faffter-dark-nlspec \(judgement seam\)/);
  assert.doesNotMatch(r.stdout, /faffter-dark-nlspec \(eval coverage\)/);
});

test("slot-sibling: an alternate declaring only a partial sibling set still mismatches", () => {
  const r = runOnFixtures({ "faffter-dark-nlspec": fm("faffter-dark-nlspec", "confidence") });
  assert.match(r.stdout, /faffter-dark-nlspec \(judgement seam\)/);
  // FAFF-241: expected set widened to [confidence, marker, specqual] (faffter-noon-spec's rows).
  assert.match(r.stdout, /judgement_seam mismatch — declared \[confidence\] vs expected \[confidence, marker, specqual\]/);
});

test("--configured runs no coverage sweep (no eval-coverage / undeclared / needs-cases lines)", () => {
  const r = runOnFixtures({ "faffter-noon-architecture": fm("faffter-noon-architecture") }, true);
  assert.doesNotMatch(r.stdout, /\(eval coverage\)|UNDECLARED|NEEDS-CASES/);
});

// ===========================================================================
// FAFF-616 — `calibrated` seam status + C3 accuracy-floor gate
// ===========================================================================

// ---- loadSeamRegistryForLint: root threading ----

test("loadSeamRegistryForLint(root): undefined root preserves today's HERE-relative default and returns it", () => {
  const { registry, error, root } = loadSeamRegistryForLint(undefined);
  assert.equal(error, null);
  assert.ok(registry && typeof registry.kinds === "object");
  assert.equal(root, join(REPO)); // the HERE-relative resolve == repo root
});

test("loadSeamRegistryForLint(root): an explicit root is used verbatim and returned alongside {registry, error}", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-loadreg-"));
  mkdirSync(join(root, "eval"), { recursive: true });
  writeFileSync(join(root, "eval", "seam-registry.json"), JSON.stringify({ kinds: { demo: { surface: "x", status: "covered" } } }));
  const result = loadSeamRegistryForLint(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(result.root, root);
  assert.equal(result.error, null);
  assert.deepEqual(Object.keys(result.registry.kinds), ["demo"]);
});

// ---- checkCalibrated: PURE unit tests (hand-built objects, no disk I/O) ----

test("checkCalibrated: above-floor, not a warn_kind -> ok, no reason", () => {
  const baseline = { per_kind: { demo: { accuracy: 0.9, stability: 1, format_adherence: 1 } } };
  const result = checkCalibrated("demo", { status: "calibrated" }, baseline, 0.85, new Set());
  assert.deepEqual(result, { ok: true });
});

test("checkCalibrated: below-floor -> fail, reason contains the accuracy AND the floor", () => {
  const baseline = { per_kind: { demo: { accuracy: 0.5 } } };
  const result = checkCalibrated("demo", { status: "calibrated" }, baseline, 0.85, new Set());
  assert.equal(result.ok, false);
  assert.match(result.reason, /0\.5/);
  assert.match(result.reason, /0\.85/);
});

test("checkCalibrated: absent per_kind row -> fail, reason contains FAFF-614", () => {
  const baseline = { per_kind: {} };
  const result = checkCalibrated("demo", { status: "calibrated" }, baseline, 0.85, new Set());
  assert.equal(result.ok, false);
  assert.match(result.reason, /FAFF-614/);
});

test("checkCalibrated: a warn_kind FAILs even when accuracy clears the floor, reason names it a warn_kind", () => {
  const baseline = { per_kind: { demo: { accuracy: 0.99 } } };
  const result = checkCalibrated("demo", { status: "calibrated" }, baseline, 0.85, new Set(["demo"]));
  assert.equal(result.ok, false);
  assert.match(result.reason, /warn_kind/);
});

test("checkCalibrated: reads only accuracy — stability/format_adherence never affect the verdict", () => {
  const good = checkCalibrated("demo", {}, { per_kind: { demo: { accuracy: 0.9, stability: 0, format_adherence: 0 } } }, 0.85, new Set());
  const bad = checkCalibrated("demo", {}, { per_kind: { demo: { accuracy: 0.5, stability: 1, format_adherence: 1 } } }, 0.85, new Set());
  assert.equal(good.ok, true);
  assert.equal(bad.ok, false);
});

test("checkCalibrated: kind lookup is exact-string — a case/dash/underscore-folded key reads as absent", () => {
  const baseline = { per_kind: { "demo-kind": { accuracy: 0.99 } } };
  const result = checkCalibrated("demo_kind", {}, baseline, 0.85, new Set()); // underscore, not dash
  assert.equal(result.ok, false);
  assert.match(result.reason, /FAFF-614/); // treated as absent-row, not matched
});

test("checkCalibrated: identical args -> identical result (pure, deterministic; no disk I/O, no process.exit)", () => {
  const baseline = { per_kind: { demo: { accuracy: 0.9 } } };
  const a = checkCalibrated("demo", { status: "calibrated" }, baseline, 0.85, new Set());
  const b = checkCalibrated("demo", { status: "calibrated" }, baseline, 0.85, new Set());
  assert.deepEqual(a, b);
});

// ---- no-model-call oracle: the C3 code path imports none of child_process/net/http/eval driver ----

test("no-model-call oracle: validate-adapters.js imports none of child_process, net, http, or the eval driver", () => {
  const src = require("node:fs").readFileSync(LIB_PATH, "utf8");
  assert.doesNotMatch(src, /require\(\s*["']child_process["']\s*\)/);
  assert.doesNotMatch(src, /require\(\s*["']net["']\s*\)/);
  assert.doesNotMatch(src, /require\(\s*["']http["']\s*\)/);
  assert.doesNotMatch(src, /eval\/grader\.mjs|eval\/run-evals|eval\/cli-driver/);
});

// ---- c3CalibrationFloor: zero calibrated claims never reads frontier.json ----

test("c3CalibrationFloor: zero calibrated kinds -> returns clean without reading frontier.json (root need not even exist)", () => {
  const seamReg = { kinds: { demo: { surface: "x", status: "covered" } } }; // no calibrated kind
  const result = c3CalibrationFloor(seamReg, join(tmpdir(), "faff-c3-nonexistent-root-xyz"), () => 0);
  assert.deepEqual(result, { failed: false, exit2: false });
});

// ---- --root fixture-integration tests (automated node:test — CLI end-to-end, own tmp eval/ tree) ----

function writeJSON(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2)); }

// Builds a self-contained fixture: <root>/eval/{seam-registry.json,cases/,baselines/frontier.json} +
// <root>/skills/demo-skill/SKILL.md declaring judgement_seam: demo — a tiny tree that reconciles clean
// on its own, so the ONLY thing under test is C3's verdict. `perKind`/`policy` are the frontier's
// per_kind/policy blocks; pass `perKind: null` to omit frontier.json entirely (missing-file scenario),
// or `malformed: true` to write invalid JSON. `withCase: false` omits eval/cases/demo-1.json (so the
// extended C2 fires instead). `wrongFrontierPath: true` writes the baseline at eval/frontier.json
// (unnested) instead of eval/baselines/frontier.json — pinning the nested read path.
function runC3Fixture({ perKind = { demo: { accuracy: 0.9 } }, policy = { warn_kinds: [] }, withCase = true, malformed = false, wrongFrontierPath = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-c3-"));
  mkdirSync(join(root, "eval", "cases"), { recursive: true });
  mkdirSync(join(root, "eval", "baselines"), { recursive: true });
  mkdirSync(join(root, "skills", "demo-skill"), { recursive: true });

  writeJSON(join(root, "eval", "seam-registry.json"), {
    version: 1, _comment: "fixture", kinds: { demo: { surface: "demo-skill", status: "calibrated" } },
  });
  if (withCase) writeFileSync(join(root, "eval", "cases", "demo-1.json"), "{}");
  writeFileSync(join(root, "skills", "demo-skill", "SKILL.md"), fm("demo-skill", "demo"));

  if (perKind !== null) {
    const dest = wrongFrontierPath ? join(root, "eval", "frontier.json") : join(root, "eval", "baselines", "frontier.json");
    if (malformed) writeFileSync(dest, "{ not valid json");
    else writeJSON(dest, { meta: { source: "fixture" }, per_kind: perKind, policy });
  }

  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--root", root, "--skills-dir", join(root, "skills")], { encoding: "utf8" });
  rmSync(root, { recursive: true, force: true });
  return r;
}

test("C3 fixture: above-floor calibrated kind passes — no FAIL for it, C3 contributes exit 0", () => {
  const r = runC3Fixture({ perKind: { demo: { accuracy: 0.9 } } });
  assert.doesNotMatch(r.stdout, /demo.*\(calibration floor\)/);
  assert.equal(r.status, 0, r.stdout);
});

test("C3 fixture: below-floor calibrated kind FAILs, reason contains accuracy and floor, exit 1 (lint fail)", () => {
  const r = runC3Fixture({ perKind: { demo: { accuracy: 0.5 } } });
  assert.match(r.stdout, /FAIL {2}eval\/baselines\/frontier\.json:demo \(calibration floor\)/);
  assert.match(r.stdout, /0\.5/);
  assert.match(r.stdout, /0\.85/);
  assert.equal(r.status, 1, r.stdout);
});

test("C3 fixture: no per_kind row for the calibrated kind FAILs with a reason containing FAFF-614, exit 1", () => {
  const r = runC3Fixture({ perKind: {} });
  assert.match(r.stdout, /FAIL {2}eval\/baselines\/frontier\.json:demo \(calibration floor\)/);
  assert.match(r.stdout, /FAFF-614/);
  assert.equal(r.status, 1, r.stdout);
});

test("C3 fixture: a warn_kind FAILs even though accuracy clears the floor", () => {
  const r = runC3Fixture({ perKind: { demo: { accuracy: 0.99 } }, policy: { warn_kinds: ["demo"] } });
  assert.match(r.stdout, /FAIL {2}eval\/baselines\/frontier\.json:demo \(calibration floor\)/);
  assert.match(r.stdout, /warn_kind/);
  assert.equal(r.status, 1, r.stdout);
});

test("C3 fixture: a NON-default calibration_floor governs — 0.90 accuracy fails at floor 0.95, passes at the 0.85 default with the key removed", () => {
  const failing = runC3Fixture({ perKind: { demo: { accuracy: 0.9 } }, policy: { warn_kinds: [], calibration_floor: 0.95 } });
  assert.match(failing.stdout, /FAIL {2}eval\/baselines\/frontier\.json:demo \(calibration floor\)/);
  assert.match(failing.stdout, /0\.9/);
  assert.match(failing.stdout, /0\.95/);
  assert.equal(failing.status, 1, failing.stdout);

  const passing = runC3Fixture({ perKind: { demo: { accuracy: 0.9 } }, policy: { warn_kinds: [] } }); // no calibration_floor key
  assert.doesNotMatch(passing.stdout, /demo.*\(calibration floor\)/);
  assert.equal(passing.status, 0, passing.stdout);
});

test("C3 fixture: frontier.json missing while a calibrated claim exists -> fail-loud exit 2 (distinct from lint exit 1)", () => {
  const r = runC3Fixture({ perKind: null });
  assert.match(r.stdout, /FAIL {2}eval\/baselines\/frontier\.json \(calibration floor\)/);
  assert.match(r.stdout, /FAFF-616 C3/);
  assert.equal(r.status, 2, r.stdout);
});

test("C3 fixture: frontier.json malformed JSON while a calibrated claim exists -> fail-loud exit 2", () => {
  const r = runC3Fixture({ malformed: true });
  assert.match(r.stdout, /FAIL {2}eval\/baselines\/frontier\.json \(calibration floor\)/);
  assert.equal(r.status, 2, r.stdout);
});

test("C3 fixture: the baseline at the WRONG (unnested) eval/frontier.json path is not found — pins the nested read path", () => {
  const r = runC3Fixture({ wrongFrontierPath: true });
  // C3 only ever reads eval/baselines/frontier.json — a baseline sitting at eval/frontier.json
  // (the false-parallel-to-casesDir anti-pattern) reads as absent: fail-loud exit 2.
  assert.match(r.stdout, /FAIL {2}eval\/baselines\/frontier\.json \(calibration floor\)/);
  assert.equal(r.status, 2, r.stdout);
});

test("C3 fixture: a calibrated kind with 0 cases is caught by the EXTENDED C2 (not C3) — FAIL names the kind and its status", () => {
  const r = runC3Fixture({ withCase: false });
  assert.match(r.stdout, /FAIL {2}eval\/cases\/demo \(eval coverage\)/);
  assert.match(r.stdout, /kind `demo` is registry-status `calibrated` but has 0 cases/);
  assert.equal(r.status, 1, r.stdout);
});
