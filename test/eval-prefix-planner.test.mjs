// Deterministic tests for eval/prefix-planner.mjs — segment, scan, classify, carry, cluster, report.
// Uses a tiny synthetic gateway + skills so the usage matrix and every derived number are checkable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  segmentGateway,
  scanUsage,
  classify,
  classifyFromManifest,
  carriedFor,
  clusterLayers,
  layeredCarried,
  buildReport,
  loadManifest,
  seedEntry,
  syncManifest,
  driftCheck,
  checkManifest,
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

test("buildReport scan-fallback (no manifest) ranks approaches: current >= conservative >= optimistic, layered >= floor", () => {
  const blocks = segmentGateway(GATEWAY);
  const matrix = scanUsage(blocks, SKILLS);
  const r = buildReport(blocks, names, { conservative: true, matrix }); // manifest omitted → scan fallback
  const a = r.approaches;
  assert.ok(a.current_one_big_prefix >= a.granularity_conservative);
  assert.ok(a.granularity_conservative >= a.granularity_optimistic);
  assert.ok(a.layered_prefixes >= a.ideal_floor); // contiguity tax is non-negative
  assert.equal(r.contiguity_tax, Math.round((a.layered_prefixes - a.ideal_floor) * 10) / 10);
  assert.ok(r.unknown_headroom_tokens > 0); // the orphan block is the locked headroom (fallback only)
});

// --- FAFF-963: manifest-authoritative classification -------------------------------------------

// A manifest that declares the (fixed) block keep:true with a single consumer, and a plain block with
// one declared consumer (movable). Mirrors the gateway's real shape at a tiny scale.
const MANIFEST = {
  _note: "test fixture",
  _schema: 1,
  blocks: [
    { title: "(preamble)", consumers: "none", keep: false, source: "verified" },
    { title: "Configuration (shared across all sub-skills)", consumers: "all", keep: true, source: "verified" },
    { title: "Spec readiness (fixed)", consumers: ["skill-spec"], keep: true, keep_reason: "canonical", source: "verified" },
    { title: "Concurrency slot contract details", consumers: ["skill-conc"], keep: false, source: "verified" },
    { title: "Orphan block never referenced anywhere", consumers: "none", keep: false, source: "verified" },
  ],
};
const manifestArg = () => ({ byTitle: new Map(MANIFEST.blocks.map((e) => [e.title, e])), raw: MANIFEST });

test("classifyFromManifest: movable = single declared consumer AND not keep", () => {
  const entry = (t) => MANIFEST.blocks.find((e) => e.title === t);
  const spec = classifyFromManifest({ title: "Spec readiness (fixed)", tokens: 10 }, entry("Spec readiness (fixed)"));
  assert.equal(spec.kind, "set");
  assert.equal(spec.keep, true);
  assert.equal(spec.movable, false); // keep:true — never movable, even at one consumer (the FAFF-963 fix)
  const conc = classifyFromManifest({ title: "Concurrency slot contract details", tokens: 10 }, entry("Concurrency slot contract details"));
  assert.equal(conc.movable, true); // single consumer, not keep
  const uni = classifyFromManifest({ title: "Configuration (shared across all sub-skills)", tokens: 10 }, entry("Configuration (shared across all sub-skills)"));
  assert.equal(uni.kind, "universal");
  const none = classifyFromManifest({ title: "Orphan block never referenced anywhere", tokens: 10 }, entry("Orphan block never referenced anywhere"));
  assert.equal(none.kind, "uncited");
});

test("buildReport manifest-authoritative: keep:true (fixed) block excluded from duplication_candidates", () => {
  const blocks = segmentGateway(GATEWAY);
  const r = buildReport(blocks, names, { manifest: manifestArg() });
  const dc = r.duplication_candidates.map((d) => d.title);
  assert.ok(!dc.includes("Spec readiness (fixed)")); // keep:true, single consumer → NOT movable
  assert.deepEqual(dc, ["Concurrency slot contract details"]); // the only single-consumer non-keep block
  assert.equal(r.unknown_headroom_tokens, 0); // no unknowns under a manifest
});

test("buildReport manifest-authoritative: declared consumers override the scan", () => {
  // Scan sees TWO citers for a block; the manifest declares only one — the declared set wins.
  const blocks = [{ title: "Concurrency slot contract details", level: 3, tokens: 10 }];
  const twoCiterManifest = { byTitle: new Map([["Concurrency slot contract details", { title: "Concurrency slot contract details", consumers: ["skill-conc"], keep: false }]]), raw: { blocks: [] } };
  const r = buildReport(blocks, names, { manifest: twoCiterManifest });
  assert.deepEqual(r.duplication_candidates[0].only, "skill-conc"); // declared, not the scanned two
});

test("checkManifest: structural (missing/extra) and reference (dead skill) violations", () => {
  const blocks = segmentGateway(GATEWAY);
  const skillDirs = ["skill-spec", "skill-conc"];
  // A manifest missing a gateway block, carrying an extra dead entry, and naming a nonexistent skill.
  const m = {
    blocks: [
      { title: "Configuration (shared across all sub-skills)", consumers: "all", keep: true },
      { title: "Spec readiness (fixed)", consumers: ["skill-spec"], keep: true },
      { title: "Ghost block not in gateway", consumers: ["skill-spec"], keep: false },
      { title: "Concurrency slot contract details", consumers: ["skill-nope"], keep: false },
      // "Orphan block never referenced anywhere" is deliberately absent → a structural violation
    ],
  };
  const { structural, reference } = checkManifest(blocks, m, skillDirs);
  assert.ok(structural.some((v) => v.includes("Orphan block never referenced anywhere") && v.includes("no manifest entry")));
  assert.ok(structural.some((v) => v.includes("Ghost block not in gateway") && v.includes("names no gateway block")));
  assert.ok(reference.some((v) => v.includes("skill-nope")));
});

test("checkManifest: clean manifest yields no violations", () => {
  const blocks = segmentGateway(GATEWAY);
  const skillDirs = ["skill-spec", "skill-conc"];
  const { structural, reference } = checkManifest(blocks, MANIFEST, skillDirs);
  assert.deepEqual(structural, []);
  assert.deepEqual(reference, []);
});

test("syncManifest: seed-if-absent then merge-preserving (existing entries byte-stable)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-manifest-"));
  const path = join(dir, "gateway-usage.json");
  const blocks = segmentGateway(GATEWAY);
  const matrix = scanUsage(blocks, SKILLS);
  assert.equal(existsSync(path), false);
  const first = syncManifest(blocks, matrix, path);
  assert.equal(first.preserved, 0);
  assert.equal(first.added.length, blocks.length); // seeded all
  // Human edits one entry, marking it keep + a verified consumer set.
  const edited = loadManifest(path).raw;
  const specEntry = edited.blocks.find((e) => e.title === "Spec readiness (fixed)");
  specEntry.keep = true;
  specEntry.consumers = ["skill-spec"];
  specEntry.source = "verified";
  writeFileSync(path, JSON.stringify(edited, null, 2) + "\n");
  const before = readFileSync(path, "utf8");
  // A re-emit on an unchanged gateway must be a byte-stable no-op (preserves the human edit).
  const second = syncManifest(blocks, matrix, path);
  assert.equal(second.added.length, 0);
  assert.equal(second.preserved, blocks.length);
  assert.equal(readFileSync(path, "utf8"), before); // byte-identical — human edit never clobbered
});

test("driftCheck: one-directional — warns only when the scan sees a citer the manifest lacks", () => {
  const blocks = [{ title: "Concurrency slot contract details", level: 3, tokens: 10 }];
  const matrix = new Map([["Concurrency slot contract details", new Set(["skill-conc", "skill-extra"])]]);
  // Manifest declares only skill-conc AND an extra skill the scan does NOT see.
  const m = { blocks: [{ title: "Concurrency slot contract details", consumers: ["skill-conc", "skill-implicit"], keep: false }] };
  const warnings = driftCheck(blocks, matrix, m);
  assert.equal(warnings.length, 1); // skill-extra (scan sees, manifest lacks); skill-implicit (manifest-only) is silent
  assert.ok(warnings[0].includes("skill-extra"));
  assert.ok(!warnings[0].includes("skill-implicit"));
});
