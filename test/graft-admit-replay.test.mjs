// FAFF-1434 — the full post-fix decision-corpus replay through `faff graft admit`, the command
// beep-boop's build-queue admission now calls. Three passes over
// verification/reports/FAFF-974-post-fix-fidelity/decision-corpus.jsonl:
//   1. kernel replay: every `next` and `eligible` base record reproduces its recorded verdict through
//      the committed emit's kernels;
//   2. disposition replay: every `next` record's inputs run through the whole chain, and the
//      disposition equals the recorded verdict except the sidecar's intended divergences;
//   3. action-marker replay: every `next`/`eligible` marker matches the command's marker table, except
//      the sidecar's listed exceptions, each classed.
// The sidecar (test/fixtures/graft-admit/corpus-facts.json) supplies what the corpus lacks. An
// ordinary node --test case; it gates nothing beyond the test run.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const LIB = join(REPO, "plugin", "skills", "faff", "bin", "lib");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const CORPUS = join(REPO, "verification", "reports", "FAFF-974-post-fix-fidelity", "decision-corpus.jsonl");
const SIDECAR = JSON.parse(readFileSync(join(HERE, "fixtures", "graft-admit", "corpus-facts.json"), "utf8"));
const require = createRequire(import.meta.url);
const { nextStep } = require(join(LIB, "next.js"));
const { automationEligible } = require(join(LIB, "eligible.js"));

const RECORDS = readFileSync(CORPUS, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const BASES = RECORDS.filter((r) => r.type === "decision-capture");
const NEXT = BASES.filter((r) => r.data.kernel === "next");
const ELIGIBLE = BASES.filter((r) => r.data.kernel === "eligible");
const MARKERS = RECORDS.filter((r) => r.type === "decision-capture-action" && ["next", "eligible"].includes(r.data.kernel));

// The recorded `next` verdict the chain should reproduce as a disposition when no gate intervenes.
const VERDICT_TO_DISPOSITION = { graft: "proceed", prep: "needs-prep", "needs-human": "needs-human" };
// graft-admit.ts writeMarkers(): the action each disposition records per kernel (absent = no marker).
const MARKER_TABLE = {
  proceed: { next: "graft", eligible: "eligible" },
  "needs-prep": { next: "prep", eligible: "eligible" },
  "needs-human": { next: "needs-human", eligible: "eligible" },
  ineligible: { next: "skip-ineligible", eligible: "ineligible" },
  "claimed-by-peer": { next: "none" },
  blocked: { next: "none" },
  inadmissible: { next: "none" },
};

// Facts as FAFF-1414's In Review replay builds them, from the record's own normalised inputs.
function factsFor(rec) {
  const ni = rec.data.normalised_inputs;
  const labels = [];
  if (ni.eligible) labels.push("faff-automate");
  if (ni.parked) labels.push("faff-parked");
  if (ni.awaitingSpecReview) labels.push("faff-awaiting-spec-review");
  return {
    issue: rec.issue,
    status: ni.status,
    labels,
    spec: { found: ni.spec !== "none", confidence: ni.spec },
    externally_blocked: ni.blocked,
    claimed_at: null,
    tracker: { mode: "tracker", configured: true, pinned: false, reachable: true },
  };
}

// Every `next` record through the CLI once, memoised only once complete: the disposition and marker
// passes share it, and a failed replay throws again on the next call rather than serving a partial map.
let replayed = null;
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
function replayDispositions() {
  if (replayed) return replayed;
  assert.deepEqual(SIDECAR.build_claim_refs, {}, "the sidecar plants no build-claim ref");
  const root = mkdtempSync(join(tmpdir(), "faff-graft-admit-corpus-"));
  roots.push(root);
  spawnSync("git", ["-C", root, "init", "-q"]);
  writeFileSync(join(root, ".faffrc.yaml"), "bundle_store: local\n");
  writeFileSync(join(root, "admissible.md"), SIDECAR.admissible_spec);
  for (const [issue, text] of Object.entries(SIDECAR.refused_specs)) writeFileSync(join(root, `refused-${issue}.md`), text);
  const env = { ...process.env };
  delete env.FAFF_RUN_DIR;
  delete env.FAFF_SESSION_ID;
  const byId = new Map();
  for (const rec of NEXT) {
    const spec = rec.issue in SIDECAR.refused_specs ? `refused-${rec.issue}.md` : "admissible.md";
    const r = spawnSync("node", [CLI, "graft", "admit", "--json", "--mode", "autonomous", "--facts", "-", "--spec-file", join(root, spec), "--root", root, "--now", rec.ts],
      { cwd: root, encoding: "utf8", input: JSON.stringify(factsFor(rec)), env });
    assert.equal(r.status, 0, `${rec.data.correlation_id}: ${r.stderr}`);
    let out;
    try { out = JSON.parse(r.stdout); } catch (e) { assert.fail(`${rec.data.correlation_id}: stdout is not JSON (${e.message}): ${r.stdout}`); }
    byId.set(rec.data.correlation_id, { rec, out });
  }
  replayed = byId;
  return replayed;
}

test("the corpus holds 40 next and 23 eligible base records and 52 next/eligible markers", () => {
  assert.equal(NEXT.length, 40);
  assert.equal(ELIGIBLE.length, 23);
  assert.equal(MARKERS.length, 52);
});

// The replay keys on these, so a duplicate or a missing input would silently replay different facts.
test("the replayed records are well-formed: unique keys, every next input present, a timestamp on each", () => {
  const ids = [...NEXT, ...ELIGIBLE].map((r) => r.data.correlation_id);
  assert.ok(ids.every((id) => typeof id === "string" && id !== ""), "every next/eligible base carries a correlation id");
  assert.equal(new Set(ids).size, ids.length, "next/eligible base correlation ids are unique");
  const markerKeys = MARKERS.map((m) => `${m.run_id}#${m.seq}`);
  assert.equal(new Set(markerKeys).size, markerKeys.length, "markers are unique by run and seq");
  for (const rec of NEXT) {
    const ni = rec.data.normalised_inputs;
    for (const k of ["status", "spec"]) assert.equal(typeof ni[k], "string", `${rec.data.correlation_id}: ${k}`);
    for (const k of ["eligible", "parked", "blocked", "ifEligible", "awaitingSpecReview"]) assert.equal(typeof ni[k], "boolean", `${rec.data.correlation_id}: ${k}`);
    assert.ok(!Number.isNaN(Date.parse(rec.ts)), `${rec.data.correlation_id}: ts`);
  }
});

test("kernel replay: every next and eligible base record reproduces its recorded verdict", () => {
  for (const rec of NEXT) {
    const [step] = nextStep(rec.data.normalised_inputs);
    assert.equal(step, rec.data.verdict, rec.data.correlation_id);
  }
  for (const rec of ELIGIBLE) {
    const ni = rec.data.normalised_inputs;
    assert.equal(automationEligible(ni.labels, ni.automationDefault, ni.trackerPresent), rec.data.verdict.eligible, rec.data.correlation_id);
  }
});

test("disposition replay: 19 records give the mapped verdict, 21 give the sidecar's intended divergence", () => {
  const byId = replayDispositions();
  const divergent = new Map(SIDECAR.disposition_divergences.map((d) => [d.correlation_id, d.expected]));
  assert.equal(divergent.size, 21);
  assert.equal([...divergent.values()].filter((e) => e === "claimed-by-peer").length, 14);
  assert.equal([...divergent.values()].filter((e) => e === "inadmissible").length, 7);
  for (const id of divergent.keys()) assert.ok(byId.has(id), `listed divergence is not a next record in the corpus: ${id}`);
  let mapped = 0;
  for (const [id, { rec, out }] of byId) {
    assert.equal(out.kernels.next.step, rec.data.verdict, `${id}: next verdict not reproduced`);
    if (divergent.has(id)) {
      assert.equal(out.disposition, divergent.get(id), `${id}: ${JSON.stringify(out)}`);
      assert.notEqual(out.disposition, VERDICT_TO_DISPOSITION[rec.data.verdict], `${id}: listed as a divergence but it matches`);
    } else {
      assert.equal(out.disposition, VERDICT_TO_DISPOSITION[rec.data.verdict], `${id}: unlisted divergence ${JSON.stringify(out)}`);
      mapped += 1;
    }
  }
  assert.equal(mapped, 19);
});

test("disposition replay: FAFF-1318's refusal names the missing born-verifiable scenarios", () => {
  for (const [id, { rec, out }] of replayDispositions()) {
    if (rec.issue !== "FAFF-1318") continue;
    assert.match(out.reason, /born-verifiable scenario/, id);
  }
});

// The structural class of a marker, before any sidecar listing: why it cannot be joined, or the
// expected action it should carry and the disposition that implies.
function classify(marker, byId) {
  const base = BASES.find((b) => b.data.correlation_id === marker.data.correlation_id);
  if (!base) return { cls: "orphan" };
  if (base.data.kernel !== marker.data.kernel || base.issue !== marker.issue) return { cls: "mis-joined" };
  const prior = NEXT.filter((n) => n.run_id === marker.run_id && n.issue === marker.issue && n.seq < marker.seq)
    .sort((a, b) => b.seq - a.seq)[0];
  if (!prior) return { cls: "no-next-record" };
  const disposition = byId.get(prior.data.correlation_id).out.disposition;
  const expected = (MARKER_TABLE[disposition] || {})[marker.data.kernel];
  return expected === marker.data.selected_action ? { cls: "match" } : { cls: "mismatch", disposition };
}

test("action-marker replay: 31 markers match and the other 21 are classified exactly as the sidecar lists", () => {
  const byId = replayDispositions();
  const key = (run, seq) => `${run}#${seq}`;
  const listed = new Map(SIDECAR.marker_exceptions.map((e) => [key(e.run_id, e.seq), e]));
  assert.equal(listed.size, 21);
  const ids = new Set(RECORDS.filter((r) => r.data && r.data.correlation_id).map((r) => r.data.correlation_id));
  for (const e of listed.values()) assert.ok(ids.has(e.correlation_id), `listed correlation id absent from the corpus: ${e.correlation_id}`);
  const counts = {};
  let matched = 0;
  for (const m of MARKERS) {
    const { cls, disposition } = classify(m, byId);
    const entry = listed.get(key(m.run_id, m.seq));
    if (cls === "match") {
      assert.equal(entry, undefined, `${m.data.correlation_id} seq ${m.seq}: listed as an exception but it matches`);
      matched += 1;
      continue;
    }
    assert.ok(entry, `${m.data.correlation_id} seq ${m.seq} (${cls}): unclassified marker`);
    assert.equal(entry.correlation_id, m.data.correlation_id, `${m.run_id} seq ${m.seq}: sidecar correlation id`);
    if (cls === "mismatch") {
      assert.ok(["capture-join", "intended-divergence"].includes(entry.class), `${m.data.correlation_id} seq ${m.seq}: a mismatch listed as ${entry.class}`);
      if (entry.class === "capture-join") assert.equal(disposition, "needs-prep", `${m.data.correlation_id}: capture-join`);
      if (entry.class === "intended-divergence") assert.equal(disposition, "inadmissible", `${m.data.correlation_id}: intended divergence`);
    } else {
      assert.equal(entry.class, cls, `${m.data.correlation_id} seq ${m.seq}`);
    }
    counts[entry.class] = (counts[entry.class] || 0) + 1;
  }
  assert.equal(matched, 31);
  assert.deepEqual(counts, { orphan: 5, "no-next-record": 2, "mis-joined": 8, "capture-join": 2, "intended-divergence": 4 });
});
