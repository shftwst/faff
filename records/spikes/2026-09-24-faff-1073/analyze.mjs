#!/usr/bin/env node
// FAFF-1073 spike — Track 1: retrospective condition-(a) mine.
// Reproducible, read-only. Mirrors the records/spikes/2026-07-10-faff-411 shape.
//
// Condition (a) = "the ticket is not suitable for holdout testing (no born-verifiable
// criteria, nothing to exercise)". Computed here from `faff dod classify` over every
// committed spec: born_verifiable = counts.scenario + counts.assertion; condition (a)
// fires when that is 0 (the evaluator could only return all-needs-human).
//
// Usage:  node analyze.mjs [--specs-dir <dir>] [--faff <path>] [--out <json>]
// Emits:  condition-a.json (machine output) + a headline summary to stdout.

import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const argOf = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const here = dirname(fileURLToPath(import.meta.url));
// repo root = three levels up from records/spikes/2026-09-24-faff-1073/
const repoRoot = join(here, "..", "..", "..");
const specsDir = argOf("--specs-dir", join(repoRoot, "records", "specs"));
const faff = argOf("--faff", process.env.FAFF_BIN || "faff");
const outPath = argOf("--out", join(here, "condition-a.json"));

if (!existsSync(specsDir)) {
  console.error(`FATAL: specs dir not found: ${specsDir}`);
  process.exit(1);
}

const specs = readdirSync(specsDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

if (specs.length === 0) {
  console.error(`FATAL: no *.md specs under ${specsDir}`);
  process.exit(1);
}

const observations = [];
let errors = 0;

for (const f of specs) {
  const path = join(specsDir, f);
  let counts, tiers;
  try {
    const raw = execFileSync(faff, ["dod", "classify", "--spec", path, "--json"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const o = JSON.parse(raw);
    counts = o.counts || { scenario: 0, assertion: 0, prose: 0 };
    tiers = o.verification_tier_counts || {};
  } catch (e) {
    errors++;
    observations.push({ spec: f, error: String(e.message || e).slice(0, 200) });
    continue;
  }
  const born = (counts.scenario || 0) + (counts.assertion || 0);
  observations.push({
    spec: f,
    issue: (f.match(/(FAFF-\d+)/i) || [])[1] || null,
    scenario: counts.scenario || 0,
    assertion: counts.assertion || 0,
    prose: counts.prose || 0,
    born_verifiable: born,
    condition_a_fires: born === 0,
    running_stack: tiers["running-stack"] || 0,
    integration: tiers["integration"] || 0,
  });
}

const scored = observations.filter((o) => !o.error);
const n = scored.length;
const aFires = scored.filter((o) => o.condition_a_fires).length;
const rate = n ? aFires / n : 0;

// Distribution of born-verifiable counts (histogram, capped bucket at 10+).
const hist = {};
for (const o of scored) {
  const b = o.born_verifiable >= 10 ? "10+" : String(o.born_verifiable);
  hist[b] = (hist[b] || 0) + 1;
}

// Secondary cut: of specs that DO clear (a), how many have NO running-stack criteria
// (only integration-tier born-verifiable)? Those are the FAFF-961 shape — born-verifiable
// but not observable by a code-blind holdout against a stood-up env.
const clearsA = scored.filter((o) => !o.condition_a_fires);
const noRunningStack = clearsA.filter((o) => o.running_stack === 0).length;

const summary = {
  spike: "FAFF-1073",
  track: "1 — retrospective condition-(a) mine",
  generated_at: new Date().toISOString().slice(0, 10),
  specs_dir_rel: "records/specs",
  corpus_size: specs.length,
  scored: n,
  read_errors: errors,
  condition_a_fires: aFires,
  condition_a_rate: Number(rate.toFixed(4)),
  born_verifiable_histogram: hist,
  clears_a_but_no_running_stack: noRunningStack,
  clears_a_but_no_running_stack_rate_of_scored: n
    ? Number((noRunningStack / n).toFixed(4))
    : 0,
};

writeFileSync(
  outPath,
  JSON.stringify({ summary, observations }, null, 2) + "\n",
  "utf8"
);

// Headline (FAFF-411-style).
console.log(`# FAFF-1073 Track 1 — condition-(a) mine`);
console.log(`corpus: ${specs.length} committed specs under records/specs/`);
console.log(`scored: ${n}   read-errors: ${errors}`);
console.log(
  `condition (a) fires (zero born-verifiable): ${aFires}/${n} = ${(rate * 100).toFixed(1)}%`
);
console.log(
  `clears (a) but has NO running-stack born-verifiable (FAFF-961 shape): ${noRunningStack}/${n} = ${((noRunningStack / (n || 1)) * 100).toFixed(1)}%`
);
console.log(`born-verifiable histogram:`, JSON.stringify(hist));
console.log(`machine output: ${basename(outPath)}`);
