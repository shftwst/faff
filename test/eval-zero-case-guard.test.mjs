// FAFF-691 — the zero-case guard. A run that resolves to zero cases grades nothing, yet summarize([])
// reports status:"complete" and every entry maps complete → exit 0. This pins the refusal at all six
// guarded sites (five refuse, one warns) plus the pure emptyCaseReason message-attribution precedence.
//
// The run-evals CLI sites run OFFLINE via spawnSync + --reps 0 (the test/run-evals-cases-dir.test.mjs
// idiom — zero driver calls, so no `claude -p`); updateBaseline runs via its exported entry with an
// injected preset (the test/eval-resume.test.mjs idiom); runLiveEvals via the mock-model assert.rejects
// idiom (test/eval-run-live-evals.test.mjs). No frontier spend anywhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  emptyCaseReason, assertNonEmptyCases, updateBaseline, gate, DEFAULT_POLICY,
} from "../eval/run-evals.mjs";
import { runLiveEvals } from "../eval/run-live-evals.mjs";
import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill } from "./helpers/skill-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const CLI = join(REPO_ROOT, "eval", "run-evals.mjs");
const LATEST = join(REPO_ROOT, "eval", "report", "latest.json");
const COMMITTED_BASELINE = join(REPO_ROOT, "eval", "baselines", "frontier.json");

const readOrNull = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

// ─────────────────────────── pure helper: emptyCaseReason ───────────────────────────

test("emptyCaseReason returns null when there is something to run", () => {
  assert.equal(emptyCaseReason([{ id: "x" }], { entry: "plain sweep", loadedCount: 1 }), null);
});

test("emptyCaseReason precedence — --only branch: a non-empty load emptied by --only names --only", () => {
  const r = emptyCaseReason([], { entry: "plain sweep", only: "no-such-id", casesDir: null, kind: null, loadedCount: 12 });
  assert.match(r, /plain sweep: --only 'no-such-id' matched none of the 12 loaded case\(s\)/);
});

test("emptyCaseReason precedence — --cases-dir branch: an empty load names --cases-dir", () => {
  const r = emptyCaseReason([], { entry: "plain sweep", only: null, casesDir: "/tmp/empty", kind: null, loadedCount: 0 });
  assert.match(r, /plain sweep: --cases-dir '\/tmp\/empty' contains no eval cases/);
});

test("emptyCaseReason precedence — empty --cases-dir AND --only both set names --cases-dir, not --only", () => {
  const r = emptyCaseReason([], { entry: "plain sweep", only: "no-such-id", casesDir: "/tmp/empty", kind: null, loadedCount: 0 });
  assert.match(r, /--cases-dir '\/tmp\/empty' contains no eval cases/);
  assert.doesNotMatch(r, /--only/, "loadedEmpty skips the --only branch — the real cause is the empty load");
});

test("emptyCaseReason precedence — --kind branch: a kind with no fixtures names --kind (rule 3)", () => {
  // Advisory note: the live --kind-with-no-fixtures path is not exercisable end-to-end (every
  // registered live kind has fixtures; an unregistered --kind throws earlier), so assert it directly.
  const r = emptyCaseReason([], { entry: "--kind somekind", only: null, casesDir: null, kind: "somekind", loadedCount: 0 });
  assert.match(r, /--kind 'somekind' has no live fixtures \(its adapter loader returned nothing\)/);
});

test("emptyCaseReason precedence — default: an empty corpus with no attributable filter", () => {
  const r = emptyCaseReason([], { entry: "plain sweep", only: null, casesDir: null, kind: null, loadedCount: 0 });
  assert.match(r, /plain sweep: the eval corpus is empty — nothing to run/);
});

test("assertNonEmptyCases throws the emptyCaseReason message; is a no-op on a non-empty set", () => {
  assert.throws(
    () => assertNonEmptyCases([], { entry: "plain sweep", only: null, casesDir: null, kind: null, loadedCount: 0 }),
    /plain sweep: the eval corpus is empty/,
  );
  assert.doesNotThrow(() => assertNonEmptyCases([{ id: "x" }], { entry: "plain sweep", loadedCount: 1 }));
});

// ─────────────── plain sweep (main) — offline via spawnSync + --reps 0 ───────────────

test("plain sweep with an empty --cases-dir refuses (exit 1, names --cases-dir) and writes no report", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-691-empty-"));
  const before = readOrNull(LATEST);
  try {
    const r = spawnSync(process.execPath, [CLI, "--cases-dir", tmp, "--reps", "0", "--model", "test"], { encoding: "utf8", cwd: REPO_ROOT });
    assert.notEqual(r.status, 0, "a zero-case sweep must exit non-zero");
    assert.match(r.stderr, /\[run-evals\] plain sweep: --cases-dir/);
    assert.match(r.stderr, /contains no eval cases/);
    assert.equal(readOrNull(LATEST), before, "no report/latest.json written for this refused run");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("plain sweep with an --only that matches nothing refuses (exit 1) and names --only", () => {
  const r = spawnSync(process.execPath, [CLI, "--only", "no-such-id", "--reps", "0", "--model", "test"], { encoding: "utf8", cwd: REPO_ROOT });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /\[run-evals\] plain sweep: --only 'no-such-id' matched none of the \d+ loaded case\(s\)/);
});

test("plain sweep with an empty --cases-dir AND --only both set names --cases-dir, not --only", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-691-empty-both-"));
  try {
    const r = spawnSync(process.execPath, [CLI, "--cases-dir", tmp, "--only", "no-such-id", "--reps", "0", "--model", "test"], { encoding: "utf8", cwd: REPO_ROOT });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--cases-dir/);
    assert.doesNotMatch(r.stderr, /--only/, "the empty load is the real cause, not the --only that ran after it");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ─────────── gateAgainst — the empty-per_kind hole that exits 0 today (spawn CLI) ───────────

test("gateAgainst against a baseline whose per_kind is {} with --only no-match refuses (the hole that exits 0 today)", () => {
  // A committed per_kind:{} baseline passes loadBaseline's truthy check yet makes diffAgainstBaseline
  // iterate nothing → failed=false → exit 0 today. The explicit cases.length guard closes it.
  const tmp = mkdtempSync(join(tmpdir(), "faff-691-empty-perkind-"));
  const baselinePath = join(tmp, "frontier.json");
  writeFileSync(baselinePath, JSON.stringify({ meta: {}, per_kind: {}, policy: DEFAULT_POLICY }, null, 2) + "\n");
  try {
    const r = spawnSync(process.execPath, [CLI, "--against", baselinePath, "--only", "no-such-id", "--model", "test", "--reps", "0"], { encoding: "utf8", cwd: REPO_ROOT });
    assert.notEqual(r.status, 0, "an empty-per_kind gate over zero cases must refuse, not exit 0");
    assert.match(r.stderr, /\[run-evals\] --against gate: --only 'no-such-id' matched none/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ──────── updateBaseline — exported entry, injected preset; baseline left byte-identical ────────

test("updateBaseline with an --only no-match rejects and leaves the baseline file byte-for-byte unchanged", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-691-update-"));
  const baselinePath = join(tmp, "frontier.json");
  const original = JSON.stringify({
    meta: { captured_at: "2026-01-01", source: "seed" },
    per_kind: { dupe: { accuracy: 1, stability: 1, format_adherence: 1 } },
    policy: DEFAULT_POLICY,
  }, null, 2) + "\n";
  writeFileSync(baselinePath, original);
  // The frontier preset returns a driver that throws if a rep is ever driven — proves zero spend.
  const presets = { frontierDriver: () => async () => { throw new Error("must not drive a rep on a zero-case run"); } };
  const argv = ["--driver", "frontier", "--model", "M", "--reps", "1", "--only", "no-such-id"];
  try {
    await assert.rejects(updateBaseline(argv, presets, baselinePath), /--update-baseline: --only 'no-such-id' matched none/);
    assert.equal(readFileSync(baselinePath, "utf8"), original, "the baseline is untouched — no meta.source/captured_at corruption");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ──────────────── runLiveEvals — mock-model assert.rejects; model never invoked ────────────────

test("runLiveEvals with an --only no-match rejects before the rep loop and never invokes the model", async (t) => {
  const tracker = loadFixture({ version: 1, issues: [{ id: "ISS-A", title: "anything", state: "Todo", stateCategory: "unstarted" }] });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
  t.after(() => repo.teardown());
  let called = 0;
  const model = async () => { called++; throw new Error("the model must never be called on a zero-case run"); };
  await assert.rejects(
    runLiveEvals({ kind: "reconciliation", only: "no-such-id", ctx: { runSkill, tracker, repo, model } }),
    /--kind reconciliation: --only 'no-such-id' matched none/,
  );
  assert.equal(called, 0, "zero spend — the injected model was never invoked");
});

// ──────────────── softLocalGate — warn-only: exit 0 + a [gate] warning, never a throw ────────────────

test("the soft local gate warns and returns 0 on a zero-case smoke set — never throws", async () => {
  const ol = console.log, ow = console.warn;
  const warns = [];
  console.log = () => {};
  console.warn = (...a) => warns.push(a.join(" "));
  let code;
  try {
    // --driver local routes gate → softLocalGate. probe:true clears preflight; the localDriver factory
    // returns a rep driver that would throw if run — the guard warns and returns 0 before it is reached.
    code = await gate(
      ["--driver", "local", "--base-url", "http://probe.test:11434", "--model", "m", "--only", "no-such-id"],
      { localDriver: () => async () => { throw new Error("soft smoke must not run a rep on a zero-case set"); } },
      COMMITTED_BASELINE,
      { probe: () => true },
    );
  } finally {
    console.log = ol; console.warn = ow;
  }
  assert.equal(code, 0, "the soft gate is always-exit-0, even with nothing to run");
  assert.ok(warns.some((w) => /\[gate\]/.test(w) && /--only 'no-such-id'/.test(w) && /soft smoke not run/.test(w)),
    "a [gate] advisory warning names the empty cause and states smoke did not run");
});
