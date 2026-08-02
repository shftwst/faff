// FAFF-625 — the production seeded-defect corpus-lint test. Asserts every constraint the spec §3/§8
// pins on eval/cases-seeded/: floor counts (≥300 defective + ≥60 clean, per-stratum ≥90/90/60/60),
// validateSeededCase over every case, unique ids disjoint from the eval/cases/ pilot, pairwise-distinct
// fixture bodies (no copy-paste padding), and oracle<->expected_aggregate coherence (re-derived via the
// shipped deriveHoldoutAggregate, prose excluded — reused, never re-implemented).
//
// Offline / deterministic — reads only the committed static eval/cases-seeded/*.json files; never
// re-runs the generator (eval/gen-cases-seeded.mjs) and never bills the frontier.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSeededCases, validateSeededCase, rederiveAggregate, DEFECT_CLASSES } from "../eval/score-error-rates.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDED_DIR = join(HERE, "..", "eval", "cases-seeded");
const PILOT_DIR = join(HERE, "..", "eval", "cases-pilot");

// Floors from the spec (§3 "Chosen:" — inherited-punt settlement, ADR-0029 residual (4)).
const FLOOR_NEGATIVE = 300;
const FLOOR_CLEAN = 60;
const FLOOR_BY_CLASS = {
  "subtly-wrong": 90,
  "working-but-off-spec": 90,
  "missed-criterion": 60,
  "spec-satisfying-but-broken-elsewhere": 60,
};

function loadAll() {
  const map = loadSeededCases(SEEDED_DIR); // fail-loud on any constraint violation (SeededCaseError)
  return [...map.values()];
}

test("eval/cases-seeded/ is non-empty and every case validates via validateSeededCase", () => {
  const all = loadAll();
  assert.ok(all.length > 0, "corpus must not be empty");
  for (const c of all) validateSeededCase(c); // re-asserted explicitly (loadSeededCases already validates on load)
});

test("corpus meets the floor counts: >=300 defective, >=60 clean", () => {
  const all = loadAll();
  const defective = all.filter((c) => c.label === "defective");
  const clean = all.filter((c) => c.label === "clean");
  assert.ok(defective.length >= FLOOR_NEGATIVE, `expected >=${FLOOR_NEGATIVE} defective, got ${defective.length}`);
  assert.ok(clean.length >= FLOOR_CLEAN, `expected >=${FLOOR_CLEAN} clean, got ${clean.length}`);
});

test("corpus meets the per-stratum floors (subtly-wrong/working-but-off-spec >=90, missed-criterion/spec-satisfying-but-broken-elsewhere >=60)", () => {
  const all = loadAll();
  const byClass = {};
  for (const dc of DEFECT_CLASSES) byClass[dc] = 0;
  for (const c of all) if (c.label === "defective") byClass[c.defect_class]++;
  for (const [dc, floor] of Object.entries(FLOOR_BY_CLASS)) {
    assert.ok(byClass[dc] >= floor, `stratum ${dc}: expected >=${floor}, got ${byClass[dc]}`);
  }
});

test("ids are unique across eval/cases-seeded/ and disjoint from eval/cases/", () => {
  const all = loadAll();
  const ids = all.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate id(s) within eval/cases-seeded/");
  const pilotIds = new Set(readdirSync(PILOT_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")));
  const overlap = ids.filter((id) => pilotIds.has(id));
  assert.deepEqual(overlap, [], "case_id(s) collide with the eval/cases/ pilot — would mis-join the scorer");
});

test("fixture bodies are pairwise distinct (no copy-paste duplicates padding the denominator)", () => {
  const all = loadAll();
  const seen = new Map(); // hash -> first id
  const dupes = [];
  for (const c of all) {
    const h = createHash("sha256").update(JSON.stringify(c.fixture)).digest("hex");
    if (seen.has(h)) dupes.push([c.id, seen.get(h)]);
    else seen.set(h, c.id);
  }
  assert.deepEqual(dupes, [], `duplicate fixture bodies found: ${JSON.stringify(dupes)}`);
});

// The lint-checkable clause from spec §3: "the oracle's per-criterion classes are consistent with
// expected_aggregate under deriveHoldoutAggregate" — derive the oracle's classes and compare, exactly as
// the spec directs, reusing the scorer's own rederiveAggregate (never re-implemented here).
test("every case's oracle re-derives (prose excluded) to its declared expected_aggregate", () => {
  const all = loadAll();
  const mismatches = [];
  for (const c of all) {
    const oracleMap = Object.fromEntries(
      c.oracle.closed_set.map((pair) => {
        const i = pair.lastIndexOf(":");
        return [pair.slice(0, i), pair.slice(i + 1)];
      }),
    );
    const { aggregate } = rederiveAggregate(c, oracleMap);
    if (aggregate !== c.expected_aggregate) mismatches.push({ id: c.id, derived: aggregate, declared: c.expected_aggregate });
  }
  assert.deepEqual(mismatches, [], `oracle<->expected_aggregate mismatches: ${JSON.stringify(mismatches)}`);
});

// Every prose criterion's oracle entry must itself be needs-human (ADR-0029; validateSeededCase doesn't
// check this — it's an oracle-content property, not a format constraint — so it's asserted here).
test("every prose criterion's oracle entry is needs-human", () => {
  const all = loadAll();
  const violations = [];
  for (const c of all) {
    const oracleMap = Object.fromEntries(
      c.oracle.closed_set.map((pair) => {
        const i = pair.lastIndexOf(":");
        return [pair.slice(0, i), pair.slice(i + 1)];
      }),
    );
    for (const d of c.fixture.spec_dod) {
      if (d.class === "prose" && oracleMap[d.key] !== "needs-human") {
        violations.push({ id: c.id, key: d.key, got: oracleMap[d.key] });
      }
    }
  }
  assert.deepEqual(violations, [], `prose criteria with a non-needs-human oracle entry: ${JSON.stringify(violations)}`);
});

// Sanity per stratum: the corpus should have real (not accidental) domain breadth — a coarse machine
// proxy for the review-judgement diversity bar (spec §3 states the FULL diversity bar is reviewer-held,
// not machine-linted; this only asserts the floor is not met by copies of a single scenario). Domain
// identity is read off the criterion TEXT (the actual scenario content), not the key scheme (c0-c3 are
// the same structural roles by design — the defect-position convention — so key names alone never vary).
test("the corpus spans a meaningful number of distinct domain scenarios (coarse diversity floor)", () => {
  const all = loadAll();
  const domainSignature = new Set(all.map((c) => c.fixture.spec_dod[0].text));
  assert.ok(domainSignature.size >= 15, `expected a broad set of distinct domain scenarios (>=15), got ${domainSignature.size}`);
});
