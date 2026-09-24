#!/usr/bin/env node
// FAFF-1073 spike — Track 2: bounded live env-standup sample (FIXTURE-DERIVED).
//
// faff itself has no SUT (FAFF-717), and external standup-target repos are not reachable
// from this run, so per the spec's Track-2 fallback this drives the `faff env` datastore
// FIXTURE MATRIX instead of real tickets — the (b) numbers below are labelled fixture-derived.
// It exercises the REAL seam: `faff env compose-gen -> up -> down` against live docker,
// timing standup + teardown wall-clock and recording env_status / fault per kind.
//
// Condition (b) = "the env cannot stand up the SUT": env_status == failed (an unprovisionable
// datastore kind, or a health-wait that never reached healthy inside the 60s SLA).
//
// Usage:  node env-sample.mjs [--faff <path>] [--out <json>]
// Emits:  condition-b.json + a per-kind summary to stdout. Every env is torn down on exit.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const argOf = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const here = dirname(fileURLToPath(import.meta.url));
const faff = argOf("--faff", process.env.FAFF_BIN || "faff");
const outPath = argOf("--out", join(here, "condition-b.json"));
const work = mkdtempSync(join(tmpdir(), "faff-1073-t2-"));

// The fixture matrix: representative datastore architectures + the two negative shapes
// (an unknown kind that must land unprovisionable, and a no-datastore CLI-like profile).
const MATRIX = [
  { label: "redis-backed",    datastores: [{ kind: "redis" }] },
  { label: "postgres-backed", datastores: [{ kind: "postgres" }] },
  { label: "mysql-backed",    datastores: [{ kind: "mysql" }] },
  { label: "mongo-backed",    datastores: [{ kind: "mongo" }] },
  { label: "sqlite-backed",   datastores: [{ kind: "sqlite" }] },
  { label: "unknown-kind",    datastores: [{ kind: "cassandra" }] }, // not in DATASTORE_TABLE
  { label: "no-datastore",    datastores: [] },                      // CLI/skills shape (faff itself)
];

const ms = () => Number(process.hrtime.bigint() / 1000000n);
const run = (a, opts = {}) =>
  execFileSync(faff, a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...opts });

const observations = [];

for (const m of MATRIX) {
  const profPath = join(work, `${m.label}-profile.json`);
  const planPath = join(work, `${m.label}-plan.json`);
  writeFileSync(profPath, JSON.stringify({ schema: 1, acquired_by: "faff-1073-spike-fixture", runtimes: [], datastores: m.datastores }));

  const obs = {
    label: m.label, source: "live-fixture", kinds: m.datastores.map((d) => d.kind),
    plan_services: null, unprovisionable: null,
    env_status: null, condition_b_fires: null,
    standup_wall_ms: null, teardown_wall_ms: null, fault: null,
  };

  // compose-gen
  let plan;
  try {
    const raw = run(["env", "compose-gen", "--profile", profPath, "--base-host", "localhost"]);
    writeFileSync(planPath, raw);
    plan = JSON.parse(raw);
    obs.plan_services = (plan.services || []).map((s) => s.name);
    obs.unprovisionable = plan.unprovisionable || [];
  } catch (e) {
    obs.env_status = "failed"; obs.condition_b_fires = true;
    obs.fault = `compose-gen: ${String(e.message || e).slice(0, 160)}`;
    observations.push(obs); continue;
  }

  // An unknown datastore kind reports in unprovisionable[] and never provisions -> condition (b).
  if ((obs.unprovisionable || []).length > 0) {
    obs.env_status = "failed"; obs.condition_b_fires = true;
    obs.fault = `unprovisionable: ${JSON.stringify(obs.unprovisionable)}`;
    observations.push(obs); continue;
  }
  // A no-datastore profile with no runnable app service: nothing to stand up.
  if ((obs.plan_services || []).length === 0) {
    obs.env_status = "not-attempted"; obs.condition_b_fires = false;
    obs.fault = "no provisionable service (CLI/skills shape — no SUT to stand up)";
    observations.push(obs); continue;
  }

  // env up (timed) — real docker pull + boot + 60s health SLA.
  const project = plan.project_name;
  const t0 = ms();
  try {
    run(["env", "up", "--plan", planPath], { stdio: ["ignore", "pipe", "pipe"] });
    obs.standup_wall_ms = ms() - t0;
    obs.env_status = "ready"; obs.condition_b_fires = false;
  } catch (e) {
    obs.standup_wall_ms = ms() - t0;
    obs.env_status = "failed"; obs.condition_b_fires = true;
    obs.fault = `env up: ${String((e.stderr || e.message || e)).slice(0, 200)}`;
  }

  // teardown on every path that provisioned (timed)
  const td0 = ms();
  try { run(["env", "down", "--project", project], { stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { obs.teardown_fault = String((e.stderr || e.message || e)).slice(0, 160); }
  obs.teardown_wall_ms = ms() - td0;

  observations.push(obs);
}

// Aggregate condition (b): over the ATTEMPTED provisionings (exclude not-attempted).
const attempted = observations.filter((o) => o.env_status !== "not-attempted");
const bFires = attempted.filter((o) => o.condition_b_fires).length;
const ready = attempted.filter((o) => o.env_status === "ready");
const standups = ready.map((o) => o.standup_wall_ms).filter((x) => x != null).sort((a, b) => a - b);
const median = standups.length ? standups[Math.floor((standups.length - 1) / 2)] : null;

const summary = {
  spike: "FAFF-1073", track: "2 — bounded live env-standup sample (fixture-derived)",
  generated_at: new Date().toISOString().slice(0, 10),
  basis: "fixture-derived (faff env datastore matrix; not real external tickets — see spec Track-2 fallback)",
  matrix_size: MATRIX.length,
  attempted_provisionings: attempted.length,
  condition_b_fires: bFires,
  condition_b_rate_of_attempted: attempted.length ? Number((bFires / attempted.length).toFixed(4)) : 0,
  ready: ready.length,
  standup_fault_rate: attempted.length ? Number((bFires / attempted.length).toFixed(4)) : 0,
  median_standup_wall_ms: median,
  standup_wall_ms_by_kind: Object.fromEntries(ready.map((o) => [o.label, o.standup_wall_ms])),
};

writeFileSync(outPath, JSON.stringify({ summary, observations }, null, 2) + "\n", "utf8");

console.log(`# FAFF-1073 Track 2 — env-standup sample (FIXTURE-DERIVED)`);
console.log(`matrix: ${MATRIX.length} shapes; attempted provisionings: ${attempted.length}`);
console.log(`condition (b) fires: ${bFires}/${attempted.length}`);
console.log(`ready: ${ready.length}   median standup wall: ${median != null ? median + "ms" : "n/a"}`);
for (const o of observations) {
  console.log(` - ${o.label.padEnd(16)} status=${String(o.env_status).padEnd(13)} b=${o.condition_b_fires}` +
    (o.standup_wall_ms != null ? ` standup=${o.standup_wall_ms}ms` : "") +
    (o.fault ? ` fault=${o.fault}` : ""));
}
console.log(`machine output: ${basename(outPath)}`);
