// FAFF-318 — resumable frontier sweep via per-kind checkpointing. Deterministic, mock-driver only
// (no frontier calls, no `claude -p`). Covers the shared aggregation seam, set-membership kind
// completion, atomic checkpoint writes, the merge-aware fold-in (never drops a kind), and the
// --resume / --only / stamp-guard / corrupt-file edge cases in updateBaseline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runEvals, summarize, aggregateKind, readProgress, writeCheckpointKind,
  foldInAndWriteBaseline, updateBaseline, loadCases, diffAgainstBaseline, DEFAULT_POLICY,
} from "../eval/run-evals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = join(HERE, "..", "eval");
const REAL_PROGRESS = join(EVAL_DIR, "report", "frontier-sweep-progress.json");

const tmp = () => mkdtempSync(join(tmpdir(), "faff318-"));

// A closed-set case + the matching mock envelope. pass=true → predicted == oracle (PASS); pass=false
// → predicted [] (FAIL, but a stable signature) — used to give distinct per-case accuracies.
const closedCase = (id, kind, set) => ({ id, kind, oracle: { closed_set: set } });
const jEnv = (c, pass = true) => ({
  rawText: "```faff-eval:judgement\n" + JSON.stringify({ case_id: c.id, classifications: { [c.kind]: pass ? c.oracle.closed_set : [] } }) + "\n```",
  tokens: 3,
});
const okDriver = async (c) => jEnv(c, true);

function seedProgress(dir, stamp, kinds = {}) {
  const p = join(dir, "frontier-sweep-progress.json");
  writeFileSync(p, JSON.stringify({ schema: 1, stamp: stamp ?? { driver: "mock", model: null, base_reps: 2, started_at: "2026-01-01T00:00:00Z" }, kinds }, null, 2) + "\n");
  return p;
}
const three = (m) => ({ accuracy: m.accuracy, stability: m.stability, format_adherence: m.format_adherence });

// Silence + collect console during a call; restore after (updateBaseline logs a lot).
async function capture(fn) {
  const ol = console.log, ow = console.warn;
  const logs = [], warns = [];
  console.log = (...a) => logs.push(a.join(" "));
  console.warn = (...a) => warns.push(a.join(" "));
  try { const result = await fn(); return { result, logs, warns }; }
  finally { console.log = ol; console.warn = ow; }
}
const cleanReal = () => { rmSync(REAL_PROGRESS, { force: true }); rmSync(REAL_PROGRESS + ".tmp", { force: true }); };
const ensureReportDir = () => mkdirSync(dirname(REAL_PROGRESS), { recursive: true });

// ── 1. aggregateKind is the ONE shared seam: progress per-kind == summarize per-kind ──────────────
test("aggregateKind is shared — each progress.kinds[K] (3 fields) equals summarize's per_kind[K]", async () => {
  const dir = tmp();
  const path = seedProgress(dir);
  const cases = [closedCase("a1", "dupe", ["x"]), closedCase("a2", "dupe", ["y"]), closedCase("b1", "vague", ["z"])];
  const summary = await runEvals({ cases, driver: okDriver, baseReps: 2, maxReps: 2, progressPath: path });
  const progress = readProgress(path);
  for (const k of ["dupe", "vague"]) {
    assert.deepEqual(three(progress.kinds[k]), summary.per_kind[k], `${k}: checkpoint == summarize`);
  }
});

// ── 2. Kind-completion by SET MEMBERSHIP, not cr.kind adjacency ────────────────────────────────────
test("kind-completion fires on the last case of a kind, not on adjacency (A1,B1,A2,B2)", async () => {
  const dir = tmp();
  const path = seedProgress(dir);
  // Interleaved by array order (dupe,vague,dupe,vague); A1 passes, A2 fails → dupe accuracy 0.5.
  const cases = [closedCase("A1", "dupe", ["x"]), closedCase("B1", "vague", ["z"]), closedCase("A2", "dupe", ["y"]), closedCase("B2", "vague", ["w"])];
  const snapshots = [];
  const driver = async (c) => {
    snapshots.push(Object.keys(readProgress(path).kinds).sort()); // progress state at the START of this case
    return jEnv(c, c.id !== "A2"); // A2 fails
  };
  await runEvals({ cases, driver, baseReps: 1, maxReps: 1, progressPath: path });
  // At A1,B1,A2 no kind is complete yet; dupe appears only once A2 has run (visible at B2's call).
  assert.deepEqual(snapshots, [[], [], [], ["dupe"]]);
  const progress = readProgress(path);
  assert.deepEqual(Object.keys(progress.kinds).sort(), ["dupe", "vague"]);
  assert.equal(progress.kinds.dupe.accuracy, 0.5, "dupe folds BOTH A1 (pass) and A2 (fail) — not adjacency-truncated");
  assert.deepEqual(progress.kinds.dupe.case_ids, ["A1", "A2"]);
});

// ── 3. Atomic write: temp-then-rename, no leftover .tmp, case_ids sorted ───────────────────────────
test("writeCheckpointKind writes via <path>.tmp + rename — no partial file left behind", () => {
  const dir = tmp();
  const path = seedProgress(dir);
  writeCheckpointKind(path, "dupe", { accuracy: 1, stability: 1, format_adherence: 1 }, ["d2", "d1"]);
  assert.equal(existsSync(path + ".tmp"), false, "no leftover .tmp after a normal write");
  const progress = readProgress(path);
  assert.equal(progress.kinds.dupe.accuracy, 1);
  assert.deepEqual(progress.kinds.dupe.case_ids, ["d1", "d2"], "case_ids stored sorted");
  assert.ok(typeof progress.kinds.dupe.captured_at === "string" && progress.kinds.dupe.captured_at.length > 0);
});

// ── 4. Advisory-only invariant: summary byte-identical with vs without progressPath ────────────────
test("advisory-only — runEvals summary is byte-identical with vs without progressPath", async () => {
  const wobbly = async (c, i) => jEnv(c, i % 2 === 0); // deterministic wobble
  const cases = [closedCase("d", "dupe", ["A", "B"])];
  const dir = tmp();
  const path = seedProgress(dir);
  const withProg = await runEvals({ cases, driver: wobbly, baseReps: 2, maxReps: 6, progressPath: path });
  const without = await runEvals({ cases, driver: wobbly, baseReps: 2, maxReps: 6 });
  assert.equal(JSON.stringify(withProg), JSON.stringify(without), "checkpointing moves no result");
});

// ── 5. Fold-in never drops a kind (gate safety) ───────────────────────────────────────────────────
test("fold-in overlays a partial sweep onto the prior baseline — no kind dropped, gates clean", () => {
  const dir = tmp();
  const baselinePath = join(dir, "frontier.json");
  writeFileSync(baselinePath, JSON.stringify({
    meta: {}, policy: DEFAULT_POLICY,
    per_kind: {
      dupe: { accuracy: 1, stability: 1, format_adherence: 1 },
      vague: { accuracy: 0.9, stability: 0.9, format_adherence: 1 },
      stale: { accuracy: 0.95, stability: 0.95, format_adherence: 1 },
    },
  }, null, 2) + "\n");
  const path = seedProgress(dir, { driver: "mock", model: null, base_reps: 2, started_at: "z" }, {
    dupe: { accuracy: 1, stability: 1, format_adherence: 1, case_ids: ["d1"], captured_at: "z" }, // only dupe freshly swept
  });
  const stamp = { driver: "mock", model: null, base_reps: 2 };
  foldInAndWriteBaseline(baselinePath, path, new Set(["dupe", "vague", "stale"]), stamp, { per_kind: {} }, { only: false });
  const written = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.deepEqual(Object.keys(written.per_kind).sort(), ["dupe", "stale", "vague"], "all 3 kinds survive the partial fold-in");
  assert.equal(diffAgainstBaseline(written, written).failed, false, "the written baseline gates clean against itself");
});

// ── 6. Complete sweep = clean replace, prunes a kind absent from the current case set ──────────────
test("a complete sweep replaces per_kind and prunes a kind absent from the current cases", () => {
  const dir = tmp();
  const baselinePath = join(dir, "frontier.json");
  writeFileSync(baselinePath, JSON.stringify({
    meta: {}, policy: DEFAULT_POLICY,
    per_kind: { dupe: { accuracy: 1, stability: 1, format_adherence: 1 }, vague: { accuracy: 1, stability: 1, format_adherence: 1 }, ghost: { accuracy: 1, stability: 1, format_adherence: 1 } },
  }, null, 2) + "\n");
  const path = seedProgress(dir, { driver: "mock", model: null, base_reps: 2, started_at: "z" }, {
    dupe: { accuracy: 1, stability: 1, format_adherence: 1, case_ids: ["d1"], captured_at: "z" },
    vague: { accuracy: 0.8, stability: 0.8, format_adherence: 1, case_ids: ["v1"], captured_at: "z" },
  });
  foldInAndWriteBaseline(baselinePath, path, new Set(["dupe", "vague"]), { driver: "mock", model: null, base_reps: 2 }, { per_kind: {} }, { only: false });
  const written = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.deepEqual(Object.keys(written.per_kind).sort(), ["dupe", "vague"], "ghost kind pruned on a complete sweep");
});

// ── 7. First-ever baseline built by a partial sweep → hard warn + only the swept kinds ────────────
test("first baseline from a partial sweep warns hard and writes exactly the completed kinds", () => {
  const dir = tmp();
  const baselinePath = join(dir, "does-not-exist.json"); // no prior baseline to overlay onto
  const path = seedProgress(dir, { driver: "mock", model: null, base_reps: 2, started_at: "z" }, {
    dupe: { accuracy: 1, stability: 1, format_adherence: 1, case_ids: ["d1"], captured_at: "z" },
  });
  const { warns } = mustWarn(() => foldInAndWriteBaseline(baselinePath, path, new Set(["dupe", "vague", "stale"]), { driver: "mock", model: null, base_reps: 2 }, { per_kind: {} }, { only: false }));
  const written = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.deepEqual(Object.keys(written.per_kind), ["dupe"], "only the completed kind is written");
  assert.ok(warns.some((w) => /first baseline/i.test(w)), "a hard first-baseline warning fired");
  assert.ok(warns.some((w) => /PARTIAL/i.test(w) && /vague/.test(w)), "warns which kinds remain");
});
function mustWarn(fn) {
  const ow = console.warn, ol = console.log;
  const warns = [];
  console.warn = (...a) => warns.push(a.join(" "));
  console.log = () => {};
  try { fn(); return { warns }; } finally { console.warn = ow; console.log = ol; }
}

// ── 8. --only writes/reads no progress file and overlays (never drops other kinds) ────────────────
test("--only reads/writes no progress file and its fold-in overlays (retains other kinds)", async () => {
  cleanReal();
  const cases = loadCases();
  const target = cases[0];
  const dir = tmp();
  const baselinePath = join(dir, "frontier.json");
  writeFileSync(baselinePath, JSON.stringify({
    meta: {}, policy: DEFAULT_POLICY,
    per_kind: { [target.kind]: { accuracy: 0, stability: 0, format_adherence: 1 }, ghostA: { accuracy: 1, stability: 1, format_adherence: 1 }, ghostB: { accuracy: 1, stability: 1, format_adherence: 1 } },
  }, null, 2) + "\n");
  const spy = [];
  const presets = { frontierDriver: () => async (c) => { spy.push(c.id); return jEnv(c, true); } };
  const argv = ["--driver", "frontier", "--model", "M", "--reps", "1", "--only", target.id];
  const { result } = await capture(() => updateBaseline(argv, presets, baselinePath));
  assert.equal(existsSync(REAL_PROGRESS), false, "--only never touches the progress file");
  assert.ok(spy.every((id) => id === target.id), "only the target case was dispatched");
  const written = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.ok(["ghostA", "ghostB", target.kind].every((k) => k in written.per_kind), "other kinds retained (overlay, never dropped)");
  assert.equal(result, 0);
});

// ── 8b. FAFF-712: --kind scopes the sweep to named kinds and folds them in, retaining the rest ─────
test("--kind dispatches only the named kind(s) and overlays their rows, leaving other rows byte-identical", async () => {
  cleanReal();
  const cases = loadCases();
  const byKind = {};
  for (const c of cases) (byKind[c.kind] ??= []).push(c.id);
  // a real MULTI-case kind — the thing --only cannot re-baseline (a kind's row is an aggregate). Use a
  // smoke kind (2 cases, graded via env.classifications) so the mock okDriver deterministically PASSes
  // every case → the refreshed row is a clean accuracy 1, distinct from the seeded 0.
  const target = "dupe";
  assert.ok(byKind[target].length >= 2, "the target must be a multi-case kind to exercise the aggregate");
  const dir = tmp();
  const baselinePath = join(dir, "frontier.json");
  const priorGhostA = { accuracy: 0.71, stability: 0.72, format_adherence: 1 };
  const priorGhostB = { accuracy: 0.61, stability: 0.62, format_adherence: 1 };
  writeFileSync(baselinePath, JSON.stringify({
    meta: { source: "prior" }, policy: DEFAULT_POLICY,
    per_kind: { [target]: { accuracy: 0, stability: 0, format_adherence: 1 }, ghostA: priorGhostA, ghostB: priorGhostB },
  }, null, 2) + "\n");
  const spy = [];
  const presets = { frontierDriver: () => async (c) => { spy.push(c.id); return jEnv(c, true); } };
  const argv = ["--driver", "frontier", "--model", "M", "--reps", "1", "--update-baseline", baselinePath, "--kind", target];
  const { result } = await capture(() => updateBaseline(argv, presets, baselinePath));

  assert.equal(result, 0);
  assert.equal(existsSync(REAL_PROGRESS), false, "--kind never touches the progress file");
  assert.ok(spy.length > 0 && spy.every((id) => byKind[target].includes(id)), "ONLY the named kind's cases were dispatched");
  const written = JSON.parse(readFileSync(baselinePath, "utf8"));
  // the named kind's row is refreshed (okDriver → PASS → accuracy 1, up from the seeded 0)
  assert.equal(written.per_kind[target].accuracy, 1, "the named kind's row was re-measured");
  // every un-named kind is retained byte-identically
  assert.deepEqual(written.per_kind.ghostA, priorGhostA, "ghostA retained unchanged");
  assert.deepEqual(written.per_kind.ghostB, priorGhostB, "ghostB retained unchanged");
  assert.ok(/scoped --update-baseline --kind/.test(written.meta.source), "source reads as a scoped re-baseline");
  assert.equal(diffAgainstBaseline(written, written).failed, false, "the written baseline gates clean against itself");
});

test("--kind fails loud on an unknown kind, and is rejected alongside --only (but NOT --resume — FAFF-714)", async () => {
  const dir = tmp();
  const baselinePath = join(dir, "frontier.json");
  const presets = { frontierDriver: () => async (c) => jEnv(c, true) };
  // unknown kind → fail loud, names the corpus (never a silent empty sweep — composes with FAFF-691)
  await assert.rejects(
    () => capture(() => updateBaseline(["--driver", "frontier", "--model", "M", "--update-baseline", baselinePath, "--kind", "not-a-kind"], presets, baselinePath)),
    /unknown kind\(s\) not-a-kind/,
  );
  // --only + --kind → still rejected (thrown before any driver/corpus work, so {} presets suffice)
  await assert.rejects(
    () => updateBaseline(["--update-baseline", baselinePath, "--only", "x", "--kind", "y"], {}, baselinePath),
    /--only and --kind are mutually exclusive/,
  );
  // FAFF-714 — --kind + --resume is now VALID (no longer throws); covered by the scoped-resume tests below.
});

// ── 8c. FAFF-714: a scoped --kind run checkpoints + resumes to its OWN progress file ───────────────
const REAL_SCOPED = join(EVAL_DIR, "report", "frontier-scoped-progress.json");
const cleanScoped = () => { rmSync(REAL_SCOPED, { force: true }); rmSync(REAL_SCOPED + ".tmp", { force: true }); };

test("--kind --resume skips a checkpointed named kind, uses the scoped file, and never touches the full-sweep file", async () => {
  cleanReal(); cleanScoped();
  const cases = loadCases();
  const byKind = {};
  for (const c of cases) (byKind[c.kind] ??= []).push(c.id);
  // two mock-gradeable smoke kinds: `dupe` is seeded complete, `vague` must still run.
  const done = "dupe", todo = "vague";
  seedProgressAt(REAL_SCOPED, { driver: "frontier", model: "M", base_reps: 1, started_at: "z" }, {
    [done]: { accuracy: 1, stability: 1, format_adherence: 1, case_ids: [...byKind[done]].sort(), captured_at: "z" },
  });
  // a prior baseline carrying an un-named ghost kind that must survive byte-identical
  const dir = tmp();
  const baselinePath = join(dir, "frontier.json");
  const priorGhost = { accuracy: 0.71, stability: 0.72, format_adherence: 1 };
  writeFileSync(baselinePath, JSON.stringify({ meta: { source: "prior" }, policy: DEFAULT_POLICY,
    per_kind: { [done]: { accuracy: 0, stability: 0, format_adherence: 1 }, [todo]: { accuracy: 0, stability: 0, format_adherence: 1 }, ghost: priorGhost } }, null, 2) + "\n");

  const spy = [];
  const presets = { frontierDriver: () => async (c) => { spy.push(c.id); return jEnv(c, true); } };
  const argv = ["--driver", "frontier", "--model", "M", "--reps", "1", "--update-baseline", baselinePath, "--kind", `${done},${todo}`, "--resume"];
  const { result } = await capture(() => updateBaseline(argv, presets, baselinePath));

  assert.equal(result, 0);
  assert.ok(spy.length > 0 && spy.every((id) => byKind[todo].includes(id)), "ONLY the un-checkpointed named kind's cases dispatched (the done kind was skipped)");
  assert.equal(existsSync(REAL_PROGRESS), false, "the full-sweep progress file was never touched by a scoped run");
  const written = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.ok(done in written.per_kind && todo in written.per_kind, "both named kinds are in the folded baseline (incl. the one restored from checkpoint)");
  assert.deepEqual(written.per_kind.ghost, priorGhost, "the un-named ghost kind is byte-identical");
  cleanReal(); cleanScoped();
});

test("--kind --resume refuses to blend on a stamp mismatch, before any rep", async () => {
  cleanReal(); cleanScoped();
  const cases = loadCases();
  const byKind = {};
  for (const c of cases) (byKind[c.kind] ??= []).push(c.id);
  seedProgressAt(REAL_SCOPED, { driver: "frontier", model: "DIFFERENT", base_reps: 1, started_at: "z" }, {
    dupe: { accuracy: 1, stability: 1, format_adherence: 1, case_ids: [...byKind.dupe].sort(), captured_at: "z" },
  });
  const spy = [];
  const presets = { frontierDriver: () => async (c) => { spy.push(c.id); return jEnv(c, true); } };
  const dir = tmp();
  await assert.rejects(
    () => capture(() => updateBaseline(["--driver", "frontier", "--model", "M", "--reps", "1", "--update-baseline", join(dir, "frontier.json"), "--kind", "dupe,vague", "--resume"], presets, join(dir, "frontier.json"))),
    /refusing to blend/,
  );
  assert.equal(spy.length, 0, "no rep dispatched before the stamp guard threw");
  cleanScoped();
});

// ── 9. --resume runs only the missing kind and writes a complete baseline (exit 0) ────────────────
test("--resume dispatches only missing kinds and writes a complete baseline", async () => {
  cleanReal();
  const cases = loadCases();
  const byKind = {};
  for (const c of cases) (byKind[c.kind] ??= []).push(c.id);
  const kinds = Object.keys(byKind);
  const missing = kinds[0];
  const seeded = {};
  for (const k of kinds) if (k !== missing) seeded[k] = { accuracy: 1, stability: 1, format_adherence: 1, case_ids: [...byKind[k]].sort(), captured_at: "2026-01-01T00:00:00Z" };
  seedProgressAt(REAL_PROGRESS, { driver: "frontier", model: "M", base_reps: 1, started_at: "2026-01-01T00:00:00Z" }, seeded);

  const spy = [];
  const presets = { frontierDriver: () => async (c) => { spy.push(c.id); return jEnv(c, true); } };
  const dir = tmp();
  const baselinePath = join(dir, "frontier.json");
  const argv = ["--driver", "frontier", "--model", "M", "--reps", "1", "--resume"];
  const { result } = await capture(() => updateBaseline(argv, presets, baselinePath));

  assert.ok(spy.length > 0, "the missing kind's cases were dispatched");
  assert.ok(spy.every((id) => byKind[missing].includes(id)), "ONLY the missing kind's cases were dispatched");
  assert.equal(spy.length, byKind[missing].length, "each missing-kind case ran once (reps 1)");
  const written = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.ok(kinds.every((k) => k in written.per_kind), "the final baseline has every expected kind");
  assert.equal(result, 0);
  cleanReal();
});
function seedProgressAt(path, stamp, kinds) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify({ schema: 1, stamp, kinds }, null, 2) + "\n"); }

// ── 10. --resume with all kinds already complete runs zero reps, complete baseline, exit 0 ────────
test("--resume with all kinds complete runs zero reps and writes a complete baseline (exit 0)", async () => {
  cleanReal();
  const cases = loadCases();
  const byKind = {};
  for (const c of cases) (byKind[c.kind] ??= []).push(c.id);
  const seeded = {};
  for (const k of Object.keys(byKind)) seeded[k] = { accuracy: 1, stability: 1, format_adherence: 1, case_ids: [...byKind[k]].sort(), captured_at: "z" };
  seedProgressAt(REAL_PROGRESS, { driver: "frontier", model: "M", base_reps: 1, started_at: "z" }, seeded);

  const spy = [];
  const presets = { frontierDriver: () => async (c) => { spy.push(c.id); return jEnv(c, true); } };
  const dir = tmp();
  const baselinePath = join(dir, "frontier.json");
  const { result } = await capture(() => updateBaseline(["--driver", "frontier", "--model", "M", "--reps", "1", "--resume"], presets, baselinePath));
  assert.equal(spy.length, 0, "zero reps dispatched");
  const written = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.ok(Object.keys(byKind).every((k) => k in written.per_kind), "complete baseline written");
  assert.equal(result, 0);
  cleanReal();
});

// ── 11. Stale case-id set for a completed kind → re-run, not kept ──────────────────────────────────
test("a completed kind whose stored case-id set is stale is re-run, not kept", async () => {
  cleanReal();
  const cases = loadCases();
  const byKind = {};
  for (const c of cases) (byKind[c.kind] ??= []).push(c.id);
  const kinds = Object.keys(byKind);
  const stale = kinds[0];
  const seeded = {};
  for (const k of kinds) {
    const ids = k === stale ? [...byKind[k], "GHOST-EXTRA-ID"].sort() : [...byKind[k]].sort(); // mangle one set
    seeded[k] = { accuracy: 1, stability: 1, format_adherence: 1, case_ids: ids, captured_at: "z" };
  }
  seedProgressAt(REAL_PROGRESS, { driver: "frontier", model: "M", base_reps: 1, started_at: "z" }, seeded);

  const spy = [];
  const presets = { frontierDriver: () => async (c) => { spy.push(c.id); return jEnv(c, true); } };
  const dir = tmp();
  await capture(() => updateBaseline(["--driver", "frontier", "--model", "M", "--reps", "1", "--resume"], presets, join(dir, "frontier.json")));
  assert.equal(spy.length, byKind[stale].length, "the stale kind was re-run");
  assert.ok(spy.every((id) => byKind[stale].includes(id)), "and ONLY the stale kind was re-run");
  cleanReal();
});

// ── 12. --resume stamp mismatch THROWS before any rep ─────────────────────────────────────────────
test("--resume throws before any rep when the progress stamp differs (driver/model/base_reps)", async () => {
  cleanReal();
  seedProgressAt(REAL_PROGRESS, { driver: "frontier", model: "M", base_reps: 99, started_at: "z" }, {}); // base_reps mismatch
  const spy = [];
  const presets = { frontierDriver: () => async (c) => { spy.push(c.id); return jEnv(c, true); } };
  const dir = tmp();
  await capture(async () => {
    await assert.rejects(
      updateBaseline(["--driver", "frontier", "--model", "M", "--reps", "1", "--resume"], presets, join(dir, "frontier.json")),
      /refusing to blend/,
    );
  });
  assert.equal(spy.length, 0, "no rep ran before the throw");
  cleanReal();
});

// ── 13. Corrupt/unparseable progress file on --resume THROWS with the path ─────────────────────────
test("a corrupt progress file on --resume throws with the path", async () => {
  cleanReal();
  ensureReportDir();
  writeFileSync(REAL_PROGRESS, "{ this is not json");
  const presets = { frontierDriver: () => async (c) => jEnv(c, true) };
  const dir = tmp();
  await capture(async () => {
    await assert.rejects(
      updateBaseline(["--driver", "frontier", "--model", "M", "--reps", "1", "--resume"], presets, join(dir, "frontier.json")),
      (e) => e.message.includes("frontier-sweep-progress.json") && /corrupt|unparseable/i.test(e.message),
    );
  });
  cleanReal();
});

// ── 14. --resume with NO progress file warns and runs the full sweep ──────────────────────────────
test("--resume with no progress file warns and runs the full sweep (non-fatal)", async () => {
  cleanReal();
  const cases = loadCases();
  const spy = [];
  const presets = { frontierDriver: () => async (c) => { spy.push(c.id); return jEnv(c, true); } };
  const dir = tmp();
  const baselinePath = join(dir, "frontier.json");
  const { result, warns } = await capture(() => updateBaseline(["--driver", "frontier", "--model", "M", "--reps", "1", "--resume"], presets, baselinePath));
  assert.ok(warns.some((w) => /no progress file/i.test(w)), "warned about the missing progress file");
  assert.equal(spy.length, cases.length, "every case ran (full sweep, reps 1)");
  assert.equal(existsSync(REAL_PROGRESS), true, "a fresh progress file was created");
  assert.equal(result, 0);
  cleanReal();
});

// ── 15. Killed sweep leaves completed kinds on disk (crash-salvage) ───────────────────────────────
test("a sweep that stops after some kinds leaves those kinds' aggregates in the progress file", async () => {
  const dir = tmp();
  const path = seedProgress(dir, { driver: "mock", model: null, base_reps: 1, started_at: "z" });
  // A deadline-style stop after dupe completes (simulate by running dupe's cases only).
  const cases = [closedCase("a1", "dupe", ["x"])];
  await runEvals({ cases, driver: okDriver, baseReps: 1, maxReps: 1, progressPath: path });
  const progress = readProgress(path);
  assert.deepEqual(Object.keys(progress.kinds), ["dupe"], "dupe is durably checkpointed; other kinds never ran");
  assert.ok(progress.kinds.dupe.case_ids.includes("a1"));
});

// ── 16. summarize output shape/values unchanged (aggregateKind refactor is transparent) ───────────
test("summarize still emits the same shape and values after the aggregateKind refactor", async () => {
  const cases = [closedCase("a1", "A", ["x"]), closedCase("a2", "A", ["y"]), closedCase("b1", "B", ["z"])];
  const results = [];
  for (const c of cases) {
    // build a CaseResult-shaped object the way aggregateCase would (mock the fields summarize reads)
    results.push({ case_id: c.id, kind: c.kind, accuracy: c.id === "a2" ? 0 : 1, stability: 1, format_adherence: 1, escalated: false, cost_tokens: 5 });
  }
  const s = summarize(results);
  assert.deepEqual(s.per_kind.A, aggregateKind(results.filter((r) => r.kind === "A")));
  assert.equal(s.per_kind.A.accuracy, 0.5);
  assert.equal(s.per_kind.B.accuracy, 1);
  assert.equal(s.total_cost_tokens, 15);
  assert.equal(s.status, "complete");
});
