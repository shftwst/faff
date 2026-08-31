// Deterministic tests for eval/prefix-planner.mjs — segment, scan, classify, carry, cluster, report.
// Uses a tiny synthetic gateway + skills so the usage matrix and every derived number are checkable.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  segmentGateway,
  scanUsage,
  classify,
  carriedFor,
  clusterLayers,
  layeredCarried,
  buildReport,
} from "../eval/prefix-planner.mjs";

const GATEWAY = [
  "# Gateway preamble line that is short",
  "",
  "## Configuration (shared across all sub-skills)",
  "shared configuration body that every skill relies on implicitly.",
  "",
  "## Spec readiness (fixed)",
  "the canonical spec markers contract body, cited by the spec skill.",
  "",
  "## Concurrency slot contract details",
  "the concurrency contract body, cited by the concurrency skill only.",
  "",
  "## Orphan block never referenced anywhere",
  "a block no skill cites by name, so the scan cannot place it.",
].join("\n");

const SKILLS = [
  { name: "skill-spec", text: "This producer satisfies the gateway Spec readiness (fixed) contract." },
  { name: "skill-conc", text: "This occupant honours the Concurrency slot contract details from the gateway." },
];
const names = SKILLS.map((s) => s.name);

test("segmentGateway splits on headings and sizes each block", () => {
  const blocks = segmentGateway(GATEWAY);
  const titles = blocks.map((b) => b.title);
  assert.ok(titles.includes("Configuration (shared across all sub-skills)"));
  assert.ok(titles.includes("Spec readiness (fixed)"));
  assert.ok(titles.includes("Orphan block never referenced anywhere"));
  assert.ok(blocks.every((b) => b.tokens > 0));
});

test("scanUsage finds citations by block title, ignoring non-citers", () => {
  const blocks = segmentGateway(GATEWAY);
  const m = scanUsage(blocks, SKILLS);
  assert.deepEqual([...m.get("Spec readiness (fixed)")], ["skill-spec"]);
  assert.deepEqual([...m.get("Concurrency slot contract details")], ["skill-conc"]);
  assert.equal(m.get("Orphan block never referenced anywhere").size, 0);
});

test("classify tags titled-shared as universal, uncited as unknown, cited as set", () => {
  const blocks = segmentGateway(GATEWAY);
  const c = classify(blocks, scanUsage(blocks, SKILLS), names);
  const byTitle = Object.fromEntries(c.map((b) => [b.title, b]));
  assert.equal(byTitle["Configuration (shared across all sub-skills)"].kind, "universal");
  assert.equal(byTitle["Spec readiness (fixed)"].kind, "set");
  assert.equal(byTitle["Orphan block never referenced anywhere"].kind, "unknown");
});

test("carriedFor: conservative carries unknowns; optimistic drops them", () => {
  const blocks = segmentGateway(GATEWAY);
  const c = classify(blocks, scanUsage(blocks, SKILLS), names);
  const cons = carriedFor(c, "skill-spec", { conservative: true });
  const opt = carriedFor(c, "skill-spec", { conservative: false });
  assert.ok(cons > opt); // the orphan (unknown) block is carried only under conservative
  // conservative for skill-spec = universal + unknowns + its own set; excludes the concurrency set block
  const concTokens = c.find((b) => b.title === "Concurrency slot contract details").tokens;
  const everything = c.reduce((a, b) => a + b.tokens, 0);
  assert.equal(cons, everything - concTokens);
});

test("clusterLayers orders widest-audience (universal/unknown) first", () => {
  const blocks = segmentGateway(GATEWAY);
  const c = classify(blocks, scanUsage(blocks, SKILLS), names);
  const layers = clusterLayers(c, names);
  assert.equal(layers[0].consumers.length, names.length); // universal + unknown ride at the front
});

test("layeredCarried contiguity is never below the skip-allowed ideal", () => {
  const blocks = segmentGateway(GATEWAY);
  const c = classify(blocks, scanUsage(blocks, SKILLS), names);
  const layers = clusterLayers(c, names);
  for (const k of names) {
    const { contiguous, ideal } = layeredCarried(layers, k);
    assert.ok(contiguous >= ideal);
  }
});

test("buildReport ranks approaches: current >= conservative >= optimistic, layered >= floor", () => {
  const blocks = segmentGateway(GATEWAY);
  const c = classify(blocks, scanUsage(blocks, SKILLS), names);
  const r = buildReport(c, names, { conservative: true });
  const a = r.approaches;
  assert.ok(a.current_one_big_prefix >= a.granularity_conservative);
  assert.ok(a.granularity_conservative >= a.granularity_optimistic);
  assert.ok(a.layered_prefixes >= a.ideal_floor); // contiguity tax is non-negative
  assert.equal(r.contiguity_tax, Math.round((a.layered_prefixes - a.ideal_floor) * 10) / 10);
  assert.ok(r.unknown_headroom_tokens > 0); // the orphan block is the locked headroom
});
