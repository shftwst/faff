// ===========================================================================
// === region:factory — gates-cli — the `faff gates` command (cmdGates) and its --selftest ===
// Split out of gates.js (FAFF-1390), which re-exports every name it exported before.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseArgs, usageError } = require("./argv");
const { contractQualityGates } = require("./contract-defs");
const { findRoot } = require("./shared-infra");
const { defaultShardConcurrency, readGatesConfig, safeAvailableParallelism } = require("./gates-config");
const { CI_COST_PENALTY, GATE_COST, ciRunnerKind, discoverCiWorkflows, discoverRungs, extractRunCommands, runnerKindForName } = require("./gates-discover");
const { discoverRungsReporting, extractRunCommandsWithContext, reportKind } = require("./gates-report");
const { aggregateShardResults, globToRegExp, runRung, runShardedRung, rungCwd, shardCapable } = require("./gates-exec");
const { aggregateSelftest, applyPartialPolicy, capPerKind, exclusionReason, runLadder, selectRunnableRungs } = require("./gates-select");
const { GatesProgressError, MAX_BUDGET_SECS, clearProgress, isGitWorkTree } = require("./gates-progress");

const GATES_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 }, "--budget-secs": { arity: 1 }, "--resume": { arity: 0 }, "--clear-progress": { arity: 0 } }, positionals: { min: 0, max: 1, name: "action" } };
const GATES_USAGE = "usage: faff gates <discover|run> [--json] [--root DIR] [--budget-secs N] [--resume]\n       faff gates run --clear-progress [--root DIR]";
// FAFF-628 — declared grammar. Neither `discover` nor `run` unconditionally requires a flag
// today (both default from --root/findRoot()).
const GATES_SURFACE = {
  kind: "subcommand_dispatch",
  spec: GATES_SPEC,
  subcommands: {
    discover: { required_flags: [] },
    run: { required_flags: [] },
  },
};

// Map a GatesOutcome → the quality-gates contract EXTRACTION shape (rungs reduced to {kind,status}).
function gatesContractExtraction(outcome) {
  return { signal: outcome.signal, rungs: outcome.rungs.map((r) => ({ kind: r.kind, status: r.status })) };
}

async function cmdGates(args) {
  if (args.includes("--selftest")) return gatesSelftest();
  const { values, positionals, errors } = parseArgs(args, GATES_SPEC);
  if (errors.length) return usageError(errors, GATES_USAGE);
  const action = positionals[0];
  const json = !!values["--json"];
  const root = values["--root"] || findRoot();

  if (action === "discover") {
    // FAFF-848 (639a): `discover` renders the REPORTING resolver (discoverRungsReporting) — the
    // wider recognition (invariant lints) + two-tier dedup + Coverage/partial classification.
    // `faff gates run` below keeps calling runLadder → discoverRungs (the execution resolver,
    // untouched) — discover and run can now report different rung sets by design (see the spec's
    // recorded interim discover>run gap, closed by FAFF-849).
    const { rungs, discovery, coverage } = discoverRungsReporting(root);
    if (json) { console.log(JSON.stringify({ discovery, coverage, rungs }, null, 2)); return 0; }
    console.log(`gate ladder discovery: ${discovery} (${rungs.length} rung${rungs.length === 1 ? "" : "s"})`);
    for (const r of rungs) console.log(`  ${String(r.cost_rank).padStart(3)}  ${r.kind.padEnd(16)} ${r.command}   [${r.source}]`);
    console.log(`coverage: recognised ${coverage.recognised_steps} / eligible ${coverage.eligible_steps} steps (${coverage.ratio.toFixed(2)})`);
    return 0;
  }

  if (action === "run" && (values["--budget-secs"] !== undefined || values["--resume"] || values["--clear-progress"])) {
    return runBudgeted(root, values, json);
  }

  if (action === "run") {
    const outcome = await runLadder(root);
    const extraction = gatesContractExtraction(outcome);
    // Emit the contract block in the SAME fenced-code-block form every faff producer uses
    // (```faff-contract:<name> … ```), so Step 7.5's "locate that block" matches the identical
    // pattern as review-verdict/spec-readiness/delivery-outcome — not a divergent XML envelope.
    const block = "```faff-contract:quality-gates\n" + JSON.stringify(extraction) + "\n```";
    if (json) {
      console.log(JSON.stringify({ ...outcome, contract: extraction }, null, 2));
    } else {
      console.log(`gate ladder: signal=${outcome.signal} discovery=${outcome.discovery}`);
      for (const r of outcome.rungs) console.log(`  ${r.status.padEnd(8)} ${r.kind.padEnd(16)} ${r.command}  (${r.duration_ms}ms)`);
      if (outcome.discovery === "none") console.log("  no declared engineering gates found; ran none");
      for (const ex of outcome.exclusions || []) console.log(`  excluded (${ex.reason}): ${ex.command}`);
      if (outcome.coverage) console.log(`  runnable coverage: recognised ${outcome.coverage.recognised_steps} / eligible ${outcome.coverage.eligible_steps} steps (${outcome.coverage.ratio.toFixed(2)})`);
      if (outcome.partialWarning) console.log(`  [warn] partial coverage: runnable coverage below gates.partial_threshold; ran the recognised subset (gates.partial: warn)`);
      console.log(block);
    }
    // exit 0 all-pass / 1 >=1 fail / 2 usage (mirrors the spec). needs-human exits 1 (non-green).
    return outcome.signal === "pass" ? 0 : 1;
  }

  process.stderr.write("faff gates: expected one of: discover | run (or --selftest)\n");
  return 2;
}

// FAFF-1405: `faff gates run --budget-secs N` / `--resume` / `--clear-progress`. Exit 3 means the
// budget ran out with units still to run: the progress is saved and the caller re-invokes with
// --resume. An incomplete call prints no contract block, so nothing can read it as a verdict.
async function runBudgeted(root, values, json) {
  const fail = (reason, detail) => { process.stderr.write(`faff gates run: ${reason}: ${detail}\n`); return 2; };
  if (values["--clear-progress"]) {
    if (values["--budget-secs"] !== undefined || values["--resume"] || json) {
      return usageError([{ code: "invalid-value", detail: "--clear-progress takes only --root" }], GATES_USAGE);
    }
    try { clearProgress(root); } catch (e) {
      if (e instanceof GatesProgressError) return fail(e.reason, e.detail);
      throw e;
    }
    return 0;
  }
  let budgetSecs = null;
  const raw = values["--budget-secs"];
  if (raw !== undefined) {
    const n = Number(raw);
    if (!/^\d+$/.test(String(raw)) || !Number.isInteger(n) || n < 1 || n > MAX_BUDGET_SECS) {
      return usageError([{ code: "invalid-value", detail: `--budget-secs expects an integer from 1 to ${MAX_BUDGET_SECS}` }], GATES_USAGE);
    }
    budgetSecs = n;
  }
  if (!isGitWorkTree(root)) return fail("not-a-git-work-tree", "--budget-secs and --resume need a git work tree");
  if (budgetSecs === null) {
    const cfg = readGatesConfig(root);
    budgetSecs = cfg.run_budget_secs;
    if (cfg.run_budget_secs_raw !== null && cfg.run_budget_secs_raw > MAX_BUDGET_SECS) {
      process.stderr.write(`faff gates run: gates.run_budget_secs ${cfg.run_budget_secs_raw} is above ${MAX_BUDGET_SECS}; clamped to ${MAX_BUDGET_SECS}\n`);
    }
  }
  let res;
  try {
    res = await runLadder(root, { budgetSecs, resume: !!values["--resume"] });
  } catch (e) {
    if (e instanceof GatesProgressError) return fail(e.reason, e.detail);
    throw e;
  }
  if (res.incomplete) {
    const { incomplete, ...rest } = res;
    const out = { status: "incomplete", ...rest };
    if (!out.discarded) delete out.discarded;
    if (json) console.log(JSON.stringify(out, null, 2));
    else {
      if (out.discarded) console.log(`progress discarded: ${out.discarded}`);
      console.log(`gate ladder: incomplete (budget ${out.budget_secs}s): ${out.units_done} of ${out.units_total} units done; run again with --resume`);
    }
    return 3;
  }
  return printOutcome(res.outcome, json);
}

// Print a finished GatesOutcome and its contract block; exit 0 pass, 1 otherwise.
function printOutcome(outcome, json) {
  const extraction = gatesContractExtraction(outcome);
  const block = "```faff-contract:quality-gates\n" + JSON.stringify(extraction) + "\n```";
  if (json) {
    console.log(JSON.stringify({ ...outcome, contract: extraction }, null, 2));
  } else {
    console.log(`gate ladder: signal=${outcome.signal} discovery=${outcome.discovery}`);
    for (const r of outcome.rungs) console.log(`  ${r.status.padEnd(8)} ${r.kind.padEnd(16)} ${r.command}  (${r.duration_ms}ms)`);
    if (outcome.discovery === "none") console.log("  no declared engineering gates found; ran none");
    for (const ex of outcome.exclusions || []) console.log(`  excluded (${ex.reason}): ${ex.command}`);
    if (outcome.coverage) console.log(`  runnable coverage: recognised ${outcome.coverage.recognised_steps} / eligible ${outcome.coverage.eligible_steps} steps (${outcome.coverage.ratio.toFixed(2)})`);
    if (outcome.partialWarning) console.log(`  [warn] partial coverage: runnable coverage below gates.partial_threshold; ran the recognised subset (gates.partial: warn)`);
    if (outcome.resumed) console.log(`  resumed: ${outcome.resumed.calls} call${outcome.resumed.calls === 1 ? "" : "s"}${outcome.resumed.discarded ? `, progress discarded: ${outcome.resumed.discarded}` : ""}`);
    console.log(block);
  }
  return outcome.signal === "pass" ? 0 : 1;
}

async function gatesSelftest() {
  const cases = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-gates-"));
  const mk = (name, files) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d, { recursive: true });
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
      fs.writeFileSync(path.join(d, f), body);
    }
    return d;
  };

  // 1. package.json with lint + test → both discovered, LINT before UNIT by cost_rank.
  const dPkg = mk("pkg", { "package.json": JSON.stringify({ scripts: { lint: "true", test: "true", build: "true" } }) });
  const dis1 = discoverRungs(dPkg);
  cases.push(["pkg: discovers lint+test, not build", dis1.rungs.length === 2 && dis1.rungs[0].kind === "LINT" && dis1.rungs[1].kind === "UNIT"]);
  cases.push(["pkg: discovery confident", dis1.discovery === "confident"]);
  cases.push(["pkg: cost_rank ascending (LINT<UNIT)", dis1.rungs[0].cost_rank < dis1.rungs[1].cost_rank]);

  // 2. run ladder all-pass → signal pass, rungs both pass, ordered LINT before UNIT.
  const out2 = await runLadder(dPkg);
  cases.push(["pkg run: signal pass", out2.signal === "pass"]);
  cases.push(["pkg run: LINT then UNIT", out2.rungs[0].kind === "LINT" && out2.rungs[1].kind === "UNIT"]);
  cases.push(["pkg run: both pass", out2.rungs.every((r) => r.status === "pass")]);

  // 3. lint fails (exit 1) → fail-fast: signal fail, stops BEFORE the test rung (only 1 result).
  const dFail = mk("fail", { "package.json": JSON.stringify({ scripts: { lint: "false", test: "true" } }) });
  const out3 = await runLadder(dFail);
  cases.push(["fail-fast: signal fail", out3.signal === "fail"]);
  cases.push(["fail-fast: stopped before UNIT (1 result)", out3.rungs.length === 1 && out3.rungs[0].kind === "LINT" && out3.rungs[0].status === "fail"]);

  // 4. no declared checks → discovery none; fail-closed default → needs-human; explicit advisory → pass.
  const dNone = mk("none", { "README.md": "hi" });
  const out4 = await runLadder(dNone);
  cases.push(["none: discovery none", out4.discovery === "none"]);
  cases.push(["none: fail-closed default → needs-human", out4.signal === "needs-human"]);
  const dAdvisory = mk("advisory", { "README.md": "hi", ".faffrc.yaml": "gates:\n  fallback: advisory\n" });
  const outAdvisory = await runLadder(dAdvisory);
  cases.push(["none: explicit advisory opt-out → pass", outAdvisory.signal === "pass"]);
  const dClosed = mk("closed", { "README.md": "hi", ".faffrc.yaml": "gates:\n  fallback: fail-closed\n" });
  const out5 = await runLadder(dClosed);
  cases.push(["none: explicit fail-closed config → needs-human", out5.signal === "needs-human"]);

  // 5. errored rung (command not found) → needs-human, not fail.
  const dErr = mk("err", { "package.json": JSON.stringify({ scripts: { lint: "this-command-does-not-exist-xyz" } }) });
  const out6 = await runLadder(dErr);
  cases.push(["errored rung → needs-human not fail", out6.signal === "needs-human" && out6.rungs[0].status === "errored"]);

  // 5b. FAFF-984: a rung killed by the configured spawnSync timeout is classified with a distinct
  // reason:"timed-out" (not a bare crash) and a timeout-shaped detail — never confused with a
  // genuine tool-missing/spawn-error case (still status: "errored" at the contract boundary).
  // Drive runRung directly (not through npm's own script indirection) so the kill lands on the
  // exact process spawnSync is timing, per the spec's fixture shape.
  const dTimeout = mk("timeout", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: 500\n" });
  const timeoutRung = await runRung({ kind: "UNIT", name: "unit (sleep)", command: "sleep 5" }, dTimeout);
  cases.push(["timeout: rung status errored", timeoutRung.status === "errored"]);
  cases.push(["timeout: reason timed-out", timeoutRung.reason === "timed-out"]);
  cases.push(["timeout: detail names the timeout + limit", /timed out after \d+ms \(limit 500ms\)/.test(timeoutRung.detail)]);
  cases.push(["timeout: contract extraction stays within the closed enum", ["pass", "fail", "skipped", "errored"].includes(gatesContractExtraction({ signal: "needs-human", rungs: [timeoutRung] }).rungs[0].status)]);

  // Confirm the ladder itself still folds a timed-out rung to needs-human (an unfinished suite
  // never reads as green) — same fixture shape as case 5's errored-rung ladder check.
  const dTimeoutLadder = mk("timeout-ladder", {
    "package.json": JSON.stringify({ scripts: { lint: "sleep 5" } }),
    ".faffrc.yaml": "gates:\n  rung_timeout_ms: 500\n",
  });
  const outTimeoutLadder = await runLadder(dTimeoutLadder);
  cases.push(["timeout: ladder signal needs-human (unfinished suite never reads as green)", outTimeoutLadder.signal === "needs-human" && outTimeoutLadder.rungs[0].reason === "timed-out"]);

  // 5c. Companion: a fast command under a generous configured timeout still passes (raising/
  // threading the timeout doesn't change ordinary pass behaviour), and carries no `reason`.
  const dTimeoutOk = mk("timeout-ok", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: 60000\n" });
  const okRung = await runRung({ kind: "UNIT", name: "unit (fast)", command: "true" }, dTimeoutOk);
  cases.push(["timeout: fast command under generous timeout still passes", okRung.status === "pass" && !okRung.reason]);

  // 5e. Unchanged: genuine command-not-found (127) still classifies errored with NO reason — the
  // timeout branch must never swallow a real spawn error.
  const notFoundRung = await runRung({ kind: "LINT", name: "lint (missing)", command: "this-command-does-not-exist-xyz" }, dTimeoutOk);
  cases.push(["timeout: genuine command-not-found stays errored with no reason", notFoundRung.status === "errored" && !notFoundRung.reason]);

  // 5f. FAFF-981: a rung that prints well over 1 MB of stdout and exits 0 must classify "pass", not
  // "errored" — the false-park class this fix eliminates. Node's default spawnSync maxBuffer is 1
  // MB; MAX_RUNG_STDOUT_BYTES (64 MiB) clears that comfortably for a real ~4 MB burst.
  const dOverflowOk = mk("overflow-ok", {});
  const noisyPassCmd = "node -e \"for(let i=0;i<80000;i++)process.stdout.write('x'.repeat(30)+'\\n')\"";
  const noisyPassRung = await runRung({ kind: "UNIT", name: "unit (noisy pass)", command: noisyPassCmd }, dOverflowOk);
  cases.push(["overflow: >1 MB stdout + exit 0 classifies pass, not errored", noisyPassRung.status === "pass" && !noisyPassRung.reason]);

  // 5g. Companion: the same high-output rung exiting non-zero classifies "fail", not "errored" —
  // output volume alone must never manufacture (or erase) a failure verdict.
  const noisyFailCmd = "node -e \"for(let i=0;i<80000;i++)process.stdout.write('x'.repeat(30)+'\\n');process.exitCode=1\"";
  const noisyFailRung = await runRung({ kind: "UNIT", name: "unit (noisy fail)", command: noisyFailCmd }, dOverflowOk);
  cases.push(["overflow: >1 MB stdout + exit 1 classifies fail, not errored", noisyFailRung.status === "fail" && !noisyFailRung.reason]);

  // 5i. FAFF-1002: shard-capability predicate — deterministic from the command string alone.
  cases.push(["shard: node --test with no shard token is shard-capable", shardCapable("node --import ./test/hermetic-env.mjs --test") === true]);
  cases.push(["shard: node --test with explicit test paths is NOT shard-capable (a trailing shard flag would be ignored)", shardCapable("node --import ./test/hermetic-env.mjs --test test/env.test.mjs test/holdout-evaluate-integration.test.mjs") === false]);
  cases.push(["shard: node --test WITH an existing --test-shard is NOT shard-capable (defensive)", shardCapable("node --test --test-shard=1/4 test/") === false]);
  cases.push(["shard: lint/static (no node/--test) is NOT shard-capable", shardCapable("eslint .") === false]);
  cases.push(["shard: a non-`--test` node command is NOT shard-capable", shardCapable("node scripts/build.js") === false]);
  cases.push(["shard: true/sleep selftest fixtures are NOT shard-capable", shardCapable("true") === false && shardCapable("sleep 5") === false]);

  // 5j. FAFF-1002: gates.local_shards config resolution — present-ness-before-coerce, mirroring
  // rung_timeout_ms's own guard (case 5d below).
  cases.push(["config: absent local_shards defaults to availableParallelism", readGatesConfig(mk("ls-absent", { "README.md": "hi" })).local_shards === safeAvailableParallelism()]);
  cases.push(["config: non-numeric local_shards defaults", readGatesConfig(mk("ls-nan", { ".faffrc.yaml": "gates:\n  local_shards: not-a-number\n" })).local_shards === safeAvailableParallelism()]);
  cases.push(["config: local_shards=1 defaults (no sharding benefit)", readGatesConfig(mk("ls-one", { ".faffrc.yaml": "gates:\n  local_shards: 1\n" })).local_shards === safeAvailableParallelism()]);
  cases.push(["config: local_shards=0 defaults", readGatesConfig(mk("ls-zero", { ".faffrc.yaml": "gates:\n  local_shards: 0\n" })).local_shards === safeAvailableParallelism()]);
  cases.push(["config: positive local_shards>=2 honoured", readGatesConfig(mk("ls-ok", { ".faffrc.yaml": "gates:\n  local_shards: 3\n" })).local_shards === 3]);

  // FAFF-1137: gates.local_shard_concurrency — same present-ness-before-coerce idiom as local_shards
  // above; the default is a quarter of the shard count. With local_shards unset it resolves
  // to safeAvailableParallelism(), so the default is defaultShardConcurrency of that.
  const lscDefault = defaultShardConcurrency(safeAvailableParallelism());
  cases.push(["config: absent local_shard_concurrency defaults to defaultShardConcurrency(local_shards)", readGatesConfig(mk("lsc-absent", { "README.md": "hi" })).local_shard_concurrency === lscDefault]);
  cases.push(["config: non-numeric local_shard_concurrency defaults", readGatesConfig(mk("lsc-nan", { ".faffrc.yaml": "gates:\n  local_shard_concurrency: not-a-number\n" })).local_shard_concurrency === lscDefault]);
  cases.push(["config: local_shard_concurrency=0 (<1) defaults", readGatesConfig(mk("lsc-zero", { ".faffrc.yaml": "gates:\n  local_shard_concurrency: 0\n" })).local_shard_concurrency === lscDefault]);
  cases.push(["config: positive local_shard_concurrency>=1 honoured verbatim", readGatesConfig(mk("lsc-ok", { ".faffrc.yaml": "gates:\n  local_shard_concurrency: 1\n" })).local_shard_concurrency === 1]);
  cases.push(["config: local_shard_concurrency=7 honoured verbatim", readGatesConfig(mk("lsc-seven", { ".faffrc.yaml": "gates:\n  local_shard_concurrency: 7\n" })).local_shard_concurrency === 7]);
  cases.push(["defaultShardConcurrency pins 2,3,4,8,16 to 1,1,1,2,4", [2, 3, 4, 8, 16].map(defaultShardConcurrency).join(",") === "1,1,1,2,4"]);

  // 5k. FAFF-1002: end-to-end sharded run — a real `node --test` fixture, forced to 2 shards via
  // gates.local_shards, must produce ONE aggregate RungResult whose command is the logical
  // (unsharded) command, and must fold a real per-shard failure into an aggregate `fail` (worst-wins,
  // never masked by the passing shard). Small fixture files keep this well inside --selftest's 2min
  // subprocess budget (regions.js's own selftest-runner timeout).
  const dShardPass = mk("shard-pass", {
    "test/a.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('a', () => assert.ok(true));\n",
    "test/b.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('b', () => assert.ok(true));\n",
    ".faffrc.yaml": "gates:\n  local_shards: 2\n",
  });
  const shardPassRung = await runRung({ kind: "UNIT", name: "unit (sharded pass)", command: "node --test" }, dShardPass);
  cases.push(["shard: sharded pass → aggregate status pass", shardPassRung.status === "pass"]);
  cases.push(["shard: sharded aggregate command stays the LOGICAL unsharded command (no --test-shard leak)", shardPassRung.command === "node --test"]);

  const dShardFail = mk("shard-fail", {
    "test/a.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('a', () => assert.ok(true));\n",
    "test/b.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('b', () => assert.ok(false));\n",
    ".faffrc.yaml": "gates:\n  local_shards: 2\n",
  });
  const shardFailRung = await runRung({ kind: "UNIT", name: "unit (sharded fail)", command: "node --test" }, dShardFail);
  cases.push(["shard: one real failing shard → aggregate status fail (never masked by the passing sibling)", shardFailRung.status === "fail"]);

  // FAFF-1137: the bounded shard pool. The exported runShardedRung's `concurrency` param defaults to
  // single-wave (n) when omitted, so an external caller is byte-identical to the pre-pool path.
  const shardNoConc = await runShardedRung({ kind: "UNIT", name: "unit (no concurrency arg)", command: "node --test" }, dShardPass, 1_800_000, 2);
  cases.push(["shard: exported runShardedRung with concurrency omitted → single-wave, aggregate pass", shardNoConc.status === "pass"]);

  // Single wave: concurrency == n reproduces today's full-width scheduling.
  const dSingleWave = mk("shard-single-wave", {
    "test/a.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('a', () => assert.ok(true));\n",
    "test/b.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('b', () => assert.ok(true));\n",
    ".faffrc.yaml": "gates:\n  local_shards: 2\n  local_shard_concurrency: 2\n",
  });
  cases.push(["shard: single wave (concurrency == n) → aggregate pass", (await runRung({ kind: "UNIT", name: "unit (single wave)", command: "node --test" }, dSingleWave)).status === "pass"]);

  // Fail-open guard: concurrency < n forces the FAILING shard into a LATER wave (node maps the
  // alphabetically-later b.test.mjs to shard 2/2, which runs only after shard 1/2 under a pool of 1).
  // The aggregate must still fold to fail — a later-wave RED is never dropped.
  const dLaterWaveFail = mk("shard-later-wave-fail", {
    "test/a.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('a', () => assert.ok(true));\n",
    "test/b.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('b', () => assert.ok(false));\n",
    ".faffrc.yaml": "gates:\n  local_shards: 2\n  local_shard_concurrency: 1\n",
  });
  cases.push(["shard: concurrency < n, failing shard in a LATER wave → aggregate fail (fail-open, later-wave RED never dropped)", (await runRung({ kind: "UNIT", name: "unit (later-wave fail)", command: "node --test" }, dLaterWaveFail)).status === "fail"]);

  // Index-order preservation, driven directly against runShardedRung with a per-shard `node -e`
  // command: shard 1 emits MARK1 after a 400ms delay, shard 2 emits MARK2 instantly, so shard 2
  // COMPLETES FIRST. With results keyed by shard index, the aggregate detail lists MARK1 (shard 1)
  // before MARK2 (shard 2); a completion-order fold would surface MARK2 first. This pins the
  // index-order collection that aggregateShardResults' first-errored-in-index-order reason relies on.
  // `--` terminates node's option parsing so the pool's appended `--test-shard=i/n` reaches the
  // program as a positional arg (node otherwise consumes `--test-shard` as its own flag).
  const idxProg = 'const s=(process.argv.find(a=>a.startsWith("--test-shard"))||"").split("=")[1]||"";if(s.startsWith("1")){setTimeout(()=>{process.stdout.write("MARK1");process.exitCode=1},400)}else{process.stdout.write("MARK2");process.exitCode=1}';
  const idxRung = await runShardedRung({ kind: "UNIT", name: "unit (index order)", command: `node -e '${idxProg}' --` }, dShardPass, 1_800_000, 2, 2);
  cases.push(["shard: results folded in INDEX order regardless of completion order (MARK1 before MARK2)", idxRung.status === "fail" && idxRung.detail.startsWith("shard 1/2: MARK1") && idxRung.detail.indexOf("MARK1") < idxRung.detail.indexOf("MARK2")]);

  // 5k2. FAFF-1382: the gate-owned file pool. Config resolution first, then real runs: a pooled
  // failure folds to fail, a serial file runs only after every pooled file has finished, a
  // dot-directory copy is never run, and an empty match is errored rather than a vacuous pass.
  const poolCfgAbsent = readGatesConfig(mk("pool-cfg-absent", { "README.md": "hi" }));
  cases.push(["pool: absent local_test_files → null (shard path unchanged)", poolCfgAbsent.local_test_files === null && poolCfgAbsent.serial_tests.length === 0]);
  cases.push(["pool: width defaults to the core count, not the shard default", poolCfgAbsent.file_pool_concurrency === safeAvailableParallelism()]);
  const poolCfgSet = readGatesConfig(mk("pool-cfg-set", { ".faffrc.yaml": "gates:\n  local_test_files: test/**/*.test.mjs\n  serial_tests:\n    - test/s.test.mjs\n  local_shard_concurrency: 3\n" }));
  cases.push(["pool: local_test_files, serial_tests and an explicit width are read", poolCfgSet.local_test_files === "test/**/*.test.mjs" && poolCfgSet.serial_tests.join() === "test/s.test.mjs" && poolCfgSet.file_pool_concurrency === 3]);
  cases.push(["pool: ** spans zero or more directories", globToRegExp("test/**/*.test.mjs").test("test/a.test.mjs") && globToRegExp("test/**/*.test.mjs").test("test/x/y/a.test.mjs") && !globToRegExp("test/**/*.test.mjs").test("src/test/a.test.mjs")]);
  cases.push(["pool: a literal dot is not a wildcard", !globToRegExp("a.test.mjs").test("aXtest.mjs")]);

  // The serial file records whether the pooled marker exists when it starts; the pooled file sleeps
  // first, so the check only passes if the serial file waited for the pool to drain.
  const dPool = mk("pool-run", {
    "test/p.test.mjs": "import test from 'node:test'; import fs from 'node:fs'; test('p', async () => { await new Promise((r) => setTimeout(r, 300)); fs.writeFileSync('pooled.done', ''); });\n",
    "test/s.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; import fs from 'node:fs'; test('s', () => assert.ok(fs.existsSync('pooled.done')));\n",
    ".faff/copy/stray.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('stray', () => assert.ok(false));\n",
    ".faffrc.yaml": "gates:\n  local_test_files: '**/*.test.mjs'\n  serial_tests:\n    - test/s.test.mjs\n",
  });
  const poolRun = await runRung({ kind: "UNIT", name: "unit (pool)", command: "node --test" }, dPool);
  cases.push(["pool: serial file runs after the pool drains; dot-directory copy is skipped → pass", poolRun.status === "pass" && poolRun.detail === "all 2 files passed (1 pooled, 1 serial)"]);
  cases.push(["pool: aggregate command stays the logical command", poolRun.command === "node --test"]);
  const dPoolFail = mk("pool-fail", {
    "test/a.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('a', () => assert.ok(true));\n",
    "test/b.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('b', () => assert.ok(false));\n",
    ".faffrc.yaml": "gates:\n  local_test_files: test/*.test.mjs\n",
  });
  const poolFail = await runRung({ kind: "UNIT", name: "unit (pool fail)", command: "node --test" }, dPoolFail);
  cases.push(["pool: one failing file → fail, and the detail names it", poolFail.status === "fail" && poolFail.detail.startsWith("test/b.test.mjs: ")]);
  const poolEmpty = await runRung({ kind: "UNIT", name: "unit (pool empty)", command: "node --test" }, mk("pool-empty", { ".faffrc.yaml": "gates:\n  local_test_files: test/*.test.mjs\n" }));
  cases.push(["pool: a glob that matches nothing → errored no-test-files, never a vacuous pass", poolEmpty.status === "errored" && poolEmpty.reason === "no-test-files"]);

  // 5l. FAFF-1002: aggregateShardResults itself — worst-wins precedence and reason carry, driven
  // directly against fabricated per-shard results (no real process spawn needed for the pure logic).
  const rFixture = { kind: "UNIT", name: "unit", command: "node --test" };
  cases.push(["aggregate: errored beats fail (worst-wins)", aggregateShardResults(rFixture, [
    { index: 1, status: "fail", detail: "boom" },
    { index: 2, status: "errored", reason: "timed-out", detail: "slow" },
  ], 2, 1000).status === "errored"]);
  cases.push(["aggregate: carries the FIRST errored shard's reason (index order)", aggregateShardResults(rFixture, [
    { index: 1, status: "errored", reason: "timed-out", detail: "slow" },
    { index: 2, status: "errored", reason: "stdout-overflow", detail: "noisy" },
  ], 2, 1000).reason === "timed-out"]);
  cases.push(["aggregate: all pass → pass, no reason", (() => {
    const a = aggregateShardResults(rFixture, [{ index: 1, status: "pass", detail: "" }, { index: 2, status: "pass", detail: "" }], 2, 1000);
    return a.status === "pass" && !a.reason;
  })()]);
  cases.push(["aggregate: duration_ms is the passed wall-clock, never a sum", aggregateShardResults(rFixture, [{ index: 1, status: "pass", detail: "" }], 1, 4242).duration_ms === 4242]);

  // 5h. The ENOBUFS-past-the-ceiling branch (reason:"stdout-overflow") needs a real write past the
  // 64 MiB MAX_RUNG_STDOUT_BYTES ceiling to trigger — too slow to run on every `--selftest` /
  // gate-ladder invocation, so it is covered instead by the dedicated regression test
  // test/gates-rung-stdout-overflow.test.mjs (asserted directly against runRung).

  // 5d. readGatesConfig: absent/empty/non-numeric/zero/negative rung_timeout_ms all fall back to
  // the 30-minute default; a positive override is honoured.
  cases.push(["config: absent rung_timeout_ms defaults to 1_800_000", readGatesConfig(mk("rt-absent", { "README.md": "hi" })).rung_timeout_ms === 1_800_000]);
  cases.push(["config: non-numeric rung_timeout_ms defaults", readGatesConfig(mk("rt-nan", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: not-a-number\n" })).rung_timeout_ms === 1_800_000]);
  cases.push(["config: zero rung_timeout_ms defaults", readGatesConfig(mk("rt-zero", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: 0\n" })).rung_timeout_ms === 1_800_000]);
  cases.push(["config: negative rung_timeout_ms defaults", readGatesConfig(mk("rt-neg", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: -5\n" })).rung_timeout_ms === 1_800_000]);
  cases.push(["config: positive rung_timeout_ms honoured", readGatesConfig(mk("rt-ok", { ".faffrc.yaml": "gates:\n  rung_timeout_ms: 42000\n" })).rung_timeout_ms === 42000]);

  // 6. Makefile target discovery.
  const dMk = mk("mk", { "Makefile": "lint:\n\ttrue\nbuild:\n\ttrue\n" });
  const dis6 = discoverRungs(dMk);
  cases.push(["makefile: discovers lint target only", dis6.rungs.length === 1 && dis6.rungs[0].kind === "LINT" && dis6.rungs[0].source === "makefile"]);

  // 7. dedup: package.json lint preferred over makefile lint (cheaper source already; one LINT rung).
  const dDup = mk("dup", { "package.json": JSON.stringify({ scripts: { lint: "true" } }), "Makefile": "lint:\n\ttrue\n" });
  const dis7 = discoverRungs(dDup);
  cases.push(["dedup: one LINT rung when both pkg+makefile declare it", dis7.rungs.filter((r) => r.kind === "LINT").length === 1]);

  // 8. contract extraction shape pipes cleanly through the quality-gates contract.
  const ext = gatesContractExtraction(out2);
  const c = contractQualityGates(ext);
  cases.push(["contract: pass outcome conforms", !c.failLoud && c.contractData.conformant === true]);

  // 9. pre-commit: only recognised-kind hooks are swept in; an unknown heavy hook is dropped,
  //    never run as a required gate (the "slow target labelled cheap" failure mode).
  const dPc = mk("pc", { ".pre-commit-config.yaml": "repos:\n  - hooks:\n      - id: ruff\n      - id: my-heavy-integration-suite\n" });
  const dis9 = discoverRungs(dPc);
  cases.push(["pre-commit: recognised hook swept, unknown dropped", dis9.rungs.length === 1 && dis9.rungs[0].kind === "LINT" && dis9.rungs[0].source === "pre_commit"]);

  // 10. discover exit code via the cmd path (--root, --json arg handling — the observation gap).
  const exitDiscover = await cmdGates(["discover", "--root", dPkg, "--json"]);
  cases.push(["cmd discover --root --json exit 0", exitDiscover === 0]);
  const exitBad = await cmdGates(["bogus-action", "--root", dPkg]);
  cases.push(["cmd unknown-action exit 2 (usage)", exitBad === 2]);
  const exitRunPass = await cmdGates(["run", "--root", dPkg, "--json"]);
  cases.push(["cmd run all-pass exit 0", exitRunPass === 0]);
  const exitRunFail = await cmdGates(["run", "--root", dFail, "--json"]);
  cases.push(["cmd run with fail exit 1", exitRunFail === 1]);

  // 11. ciRunnerKind: recognised runners map to the right kind; unrecognised → null.
  cases.push(["ci: node --test → UNIT", ciRunnerKind("node --test") === "UNIT"]);
  cases.push(["ci: faff validate-adapters → LINT", ciRunnerKind("node plugin/skills/faff/bin/faff validate-adapters") === "LINT"]);
  cases.push(["ci: lint-refs → LINT", ciRunnerKind("node plugin/skills/faff/bin/faff lint-refs") === "LINT"]);
  cases.push(["ci: pytest → UNIT", ciRunnerKind("python -m pytest -q") === "UNIT"]);
  cases.push(["ci: tsc → TYPECHECK", ciRunnerKind("npx tsc --noEmit") === "TYPECHECK"]);
  cases.push(["ci: git checkout → null (no false positive)", ciRunnerKind("git checkout main") === null]);
  cases.push(["ci: bare shell noise → null", ciRunnerKind("echo done") === null && ciRunnerKind("make build") === null]);

  // 12. extractRunCommands: inline form.
  const exInline = extractRunCommands("    steps:\n      - name: t\n        run: node --test\n");
  cases.push(["extract: inline run command", exInline.length === 1 && exInline[0] === "node --test"]);

  // 13. extractRunCommands: block-scalar form, blank line inside the block does not terminate it.
  const exBlock = extractRunCommands("      - name: tests\n        run: |\n          echo setup\n\n          node --test\n      - name: next\n        run: echo done\n");
  cases.push(["extract: block-scalar yields body lines", exBlock.includes("node --test") && exBlock.includes("echo setup")]);
  cases.push(["extract: block does not swallow the next step", exBlock.includes("echo done")]);

  // 14. discoverCiWorkflows: a CI-only repo resolves confident with a UNIT rung (source ci_workflow).
  const dCi = mk("ci", { ".github/workflows/validate.yml": "jobs:\n  v:\n    steps:\n      - name: adapters\n        run: node bin/faff validate-adapters\n      - name: tests\n        run: node --test\n" });
  const disCi = discoverRungs(dCi);
  cases.push(["ci: discovery confident", disCi.discovery === "confident"]);
  cases.push(["ci: UNIT rung node --test source ci_workflow", disCi.rungs.some((r) => r.kind === "UNIT" && r.source === "ci_workflow" && r.command === "node --test")]);
  cases.push(["ci: LINT rung from validate-adapters", disCi.rungs.some((r) => r.kind === "LINT" && r.source === "ci_workflow")]);
  cases.push(["ci: UNIT cost_rank = base + penalty", disCi.rungs.filter((r) => r.kind === "UNIT").every((r) => r.cost_rank === GATE_COST.UNIT + CI_COST_PENALTY)]);

  // 15. dedup: package.json UNIT (test) beats a CI node --test (local wins, lower cost_rank).
  const dCiDup = mk("cidup", { "package.json": JSON.stringify({ scripts: { test: "true" } }), ".github/workflows/ci.yml": "jobs:\n  v:\n    steps:\n      - run: node --test\n" });
  const disCiDup = discoverRungs(dCiDup);
  const unitRungs = disCiDup.rungs.filter((r) => r.kind === "UNIT");
  cases.push(["ci dedup: one UNIT rung", unitRungs.length === 1]);
  cases.push(["ci dedup: local pkg rung wins", unitRungs[0].source === "pkg_script"]);

  // 16. false-positive guard: a workflow of only uses:/name:/non-recognised run: → none, no rung.
  //     A recognised token inside a `name:` label (not a `run:` value) is NOT scanned.
  const dCiNone = mk("cinone", { ".github/workflows/noop.yml": "jobs:\n  v:\n    steps:\n      - uses: actions/checkout@v4\n      - name: Run pytest suite\n        run: echo done\n" });
  const disCiNone = discoverRungs(dCiNone);
  cases.push(["ci false-positive guard: discovery none", disCiNone.discovery === "none"]);
  cases.push(["ci false-positive guard: no rung emitted", disCiNone.rungs.length === 0]);

  // 17. missing .github/workflows dir → [] (the common local-only repo case).
  cases.push(["ci: missing workflows dir → []", discoverCiWorkflows(dPkg).length === 0]);

  // --- FAFF-848 (639a): the REPORTING path (discover only — runLadder/discoverRungs/ciRunnerKind
  // untouched, asserted explicitly in case 24 below). ---

  // 18. reportKind recognises the four invariant-lint patterns → STATIC_ANALYSIS; ciRunnerKind
  //     (the EXECUTION recogniser) stays null for all of them — proves the widened recognition
  //     never reaches the execution path.
  cases.push(["report: regions check → STATIC_ANALYSIS", reportKind("node bin/faff regions check") === "STATIC_ANALYSIS"]);
  cases.push(["report: regions selftest --region factory → STATIC_ANALYSIS", reportKind("node bin/faff regions selftest --region factory") === "STATIC_ANALYSIS"]);
  cases.push(["report: adr validate → STATIC_ANALYSIS", reportKind("node bin/faff adr validate") === "STATIC_ANALYSIS"]);
  cases.push(["report: prdr validate → STATIC_ANALYSIS", reportKind("node bin/faff prdr validate") === "STATIC_ANALYSIS"]);
  cases.push(["report: still rejects shell noise", reportKind("git checkout main") === null]);
  cases.push(["execution: ciRunnerKind never recognises regions check", ciRunnerKind("node bin/faff regions check") === null]);
  cases.push(["execution: ciRunnerKind never recognises adr validate", ciRunnerKind("node bin/faff adr validate") === null]);
  cases.push(["execution: ciRunnerKind never recognises prdr validate", ciRunnerKind("node bin/faff prdr validate") === null]);

  // A CI workflow carrying the three distinct faff LINT lints, all five invariant-lint STATIC_ANALYSIS
  // commands, one UNIT command, and ten unrecognised noise steps (19 candidate steps, 9 recognised —
  // ratio 9/19 ≈ 0.47, deliberately < 0.5 so the SAME fixture also exercises `partial`).
  const wideWorkflow = "jobs:\n  v:\n    steps:\n"
    + "      - name: adapters\n        run: node bin/faff validate-adapters\n"
    + "      - name: refs\n        run: node bin/faff lint-refs\n"
    + "      - name: clidoc\n        run: node bin/faff lint-cli-doc\n"
    + "      - name: regions\n        run: node bin/faff regions check\n"
    + "      - name: selftest-factory\n        run: node bin/faff regions selftest --region factory\n"
    + "      - name: selftest-governance\n        run: node bin/faff regions selftest --region governance\n"
    + "      - name: adr\n        run: node bin/faff adr validate\n"
    + "      - name: prdr\n        run: node bin/faff prdr validate\n"
    + "      - name: tests\n        run: node --test\n"
    + "      - name: noise1\n        run: echo noise-1\n"
    + "      - name: noise2\n        run: echo noise-2\n"
    + "      - name: noise3\n        run: echo noise-3\n"
    + "      - name: noise4\n        run: echo noise-4\n"
    + "      - name: noise5\n        run: echo noise-5\n"
    + "      - name: noise6\n        run: echo noise-6\n"
    + "      - name: noise7\n        run: echo noise-7\n"
    + "      - name: noise8\n        run: echo noise-8\n"
    + "      - name: noise9\n        run: echo noise-9\n"
    + "      - name: noise10 (block scalar — still ONE step)\n        run: |\n          echo multi-line\n          echo noise\n          echo block\n";
  const dWide = mk("wide", { ".github/workflows/wide.yml": wideWorkflow });
  const disWide = discoverRungsReporting(dWide);

  // 19. two-tier dedup — CI: the three distinct LINT commands stay distinct (not collapsed to
  //     one), and all five distinct STATIC_ANALYSIS invariant-lint commands are all reported.
  const wideLint = disWide.rungs.filter((r) => r.kind === "LINT");
  const wideStatic = disWide.rungs.filter((r) => r.kind === "STATIC_ANALYSIS");
  cases.push(["report dedup: 3 distinct LINT rungs (not collapsed)", wideLint.length === 3]);
  cases.push(["report dedup: LINT commands are validate-adapters/lint-refs/lint-cli-doc, each once",
    new Set(wideLint.map((r) => r.command)).size === 3]);
  cases.push(["report dedup: 5 distinct STATIC_ANALYSIS rungs (regions check + 2 selftest + adr + prdr)", wideStatic.length === 5]);
  cases.push(["report dedup: STATIC_ANALYSIS commands all distinct", new Set(wideStatic.map((r) => r.command)).size === 5]);
  cases.push(["report: regions selftest --region factory/governance both present as distinct commands",
    wideStatic.some((r) => r.command.includes("--region factory")) && wideStatic.some((r) => r.command.includes("--region governance"))]);

  // 20. partial classification — this fixture's coverage ratio is deliberately < 0.5.
  cases.push(["report: coverage eligible_steps counts all 19 run: steps", disWide.coverage.eligible_steps === 19]);
  cases.push(["report: coverage recognised_steps counts the 9 recognised steps", disWide.coverage.recognised_steps === 9]);
  cases.push(["report: discovery partial when ratio < 0.5", disWide.discovery === "partial" && disWide.coverage.ratio < 0.5]);

  // 21. discovery confident/none semantics unchanged in the reporting path (mirrors discoverRungs).
  const disNoneReporting = discoverRungsReporting(dNone);
  cases.push(["report: discovery none when nothing recognised (empty rungs)", disNoneReporting.discovery === "none" && disNoneReporting.rungs.length === 0]);
  const dFullCi = mk("fullci", { ".github/workflows/full.yml": "jobs:\n  v:\n    steps:\n      - name: adapters\n        run: node bin/faff validate-adapters\n" });
  const disFullReporting = discoverRungsReporting(dFullCi);
  cases.push(["report: discovery confident when ratio == 1.0", disFullReporting.discovery === "confident" && disFullReporting.coverage.ratio === 1.0]);

  // 22. step-granularity coverage counting — a block scalar with N command lines is ONE
  //     candidate step, not N. (wide's noise10 block-scalar step holds 3 lines but contributed 1
  //     to eligible_steps, already asserted via the eligible_steps===19 total above; assert it
  //     directly here too via extractRunCommandsWithContext.)
  const stepCtxRecords = extractRunCommandsWithContext(wideWorkflow);
  const blockScalarIndices = stepCtxRecords.filter((r) => r.command.startsWith("echo") && ["multi-line", "noise", "block"].includes(r.command.replace(/^echo /, ""))).map((r) => r.step_index);
  cases.push(["report: block-scalar body lines share ONE step_index", new Set(blockScalarIndices).size === 1 && blockScalarIndices.length === 3]);
  cases.push(["report: step_index increments once per run: key (19 distinct indices)", new Set(stepCtxRecords.map((r) => r.step_index)).size === 19]);

  // 23. a STATIC_ANALYSIS reported rung sorts ahead of every UNIT reported rung (cost_rank:
  //     STATIC_ANALYSIS=40 < UNIT=50, unmodified — GATE_COST itself is untouched by 848).
  const staticIdx = disWide.rungs.findIndex((r) => r.kind === "STATIC_ANALYSIS");
  const lastUnitIdx = disWide.rungs.map((r) => r.kind).lastIndexOf("UNIT");
  cases.push(["report: STATIC_ANALYSIS sorts ahead of UNIT", staticIdx !== -1 && lastUnitIdx !== -1 && staticIdx < lastUnitIdx]);

  // 24. local rung of a kind still suppresses ALL ci rungs of that kind in the REPORTING path too
  //     (FAFF-533 preserved) — a local pkg lint script means the reporting resolver shows ZERO
  //     ci-sourced LINT rungs even though the CI workflow declares three.
  const dSuppress = mk("suppress", {
    "package.json": JSON.stringify({ scripts: { lint: "true" } }),
    ".github/workflows/wide.yml": wideWorkflow,
  });
  const disSuppress = discoverRungsReporting(dSuppress);
  const suppressLint = disSuppress.rungs.filter((r) => r.kind === "LINT");
  cases.push(["report: local lint suppresses all 3 ci LINT rungs", suppressLint.length === 1 && suppressLint[0].source === "pkg_script"]);
  cases.push(["report: ci STATIC_ANALYSIS/UNIT rungs still reported (local only covers LINT)",
    disSuppress.rungs.some((r) => r.kind === "STATIC_ANALYSIS") && disSuppress.rungs.some((r) => r.kind === "UNIT")]);

  // 25. discoverRungs is UNCHANGED by 639b (it stops feeding runLadder but stays for 848's own
  //     isolation self-tests, per the spec §2): it still sees NONE of the widened STATIC_ANALYSIS
  //     recognition and still collapses LINT by kind — today's narrow, ciRunnerKind-only resolver.
  const disWideExecution = discoverRungs(dWide);
  cases.push(["discoverRungs unchanged: sees no STATIC_ANALYSIS rung on the wide fixture",
    disWideExecution.rungs.every((r) => r.kind !== "STATIC_ANALYSIS")]);
  cases.push(["discoverRungs unchanged: still collapses LINT to exactly one rung",
    disWideExecution.rungs.filter((r) => r.kind === "LINT").length === 1]);

  // --- FAFF-849 (639b): the EXECUTION path now CONSUMES the wider reporting set through
  // selectRunnableRungs (filter → aggregate → cap). These re-express 848's execution-isolation
  // runLadder assertions to reflect the intended widening. ---
  const cfgDefault = readGatesConfig(dNone);        // dNone has no .faffrc → all gates.* defaults
  const selWide = selectRunnableRungs(dWide, cfgDefault, "linux");
  cases.push(["execution (639b): selectRunnableRungs surfaces the widened STATIC_ANALYSIS rungs",
    selWide.rungs.some((r) => r.kind === "STATIC_ANALYSIS")]);
  cases.push(["execution (639b): runnable discovery is partial on the wide fixture (ratio < 0.5)",
    selWide.discovery === "partial" && selWide.coverage.ratio < 0.5]);
  cases.push(["execution (639b): runnable coverage counts all 19 eligible + 9 recognised steps",
    selWide.coverage.eligible_steps === 19 && selWide.coverage.recognised_steps === 9]);
  cases.push(["execution (639b): runLadder now sources from selectRunnableRungs — discovery reflects runnable coverage",
    (await runLadder(dWide)).discovery === "partial"]);

  // 26. selftest aggregation — the two per-region selftest commands collapse to ONE
  //     `regions selftest --region all` rung, consuming a single STATIC_ANALYSIS slot; the other
  //     STATIC_ANALYSIS rungs (regions check / adr validate / prdr validate) still stand.
  cases.push(["aggregate: regions selftest family collapses to one --region all rung",
    selWide.rungs.filter((r) => /regions\s+selftest/i.test(r.command)).length === 1 &&
    selWide.rungs.some((r) => /regions\s+selftest\s+--region\s+all/i.test(r.command))]);
  cases.push(["aggregate: 4 STATIC_ANALYSIS rungs after aggregation (check/adr/prdr/selftest-all)",
    selWide.rungs.filter((r) => r.kind === "STATIC_ANALYSIS").length === 4]);
  cases.push(["aggregate: derived command keeps a runnable invocation prefix",
    selWide.rungs.some((r) => /node .*regions\s+selftest\s+--region\s+all/i.test(r.command))]);
  const aggEmpty = aggregateSelftest([{ kind: "LINT", command: "node --test", cost_rank: 25 }]);
  cases.push(["aggregate: no-op when no selftest rung present", aggEmpty.length === 1 && aggEmpty[0].command === "node --test"]);

  // 27. exclusion reasons — precedence configured > github-context > not-runnable > os-mismatch
  // (FAFF-1149); each excludes. github-context stays AHEAD of not-runnable so ${{ }} / $GITHUB_ /
  // $RUNNER_ keep their existing reason; a recognised portable UNIT runner bypasses os-mismatch.
  const exCfg = { exclude: ["regions selftest"], partial: "warn", max_rungs_per_kind: 5, partial_threshold: 0.5, fallback: "fail-closed" };
  cases.push(["exclude: github-context ${{ }}", exclusionReason({ command: "node --test ${{ matrix.x }}" }, exCfg, "linux") === "github-context"]);
  cases.push(["exclude: github-context $GITHUB_", exclusionReason({ command: "echo $GITHUB_SHA" }, exCfg, "linux") === "github-context"]);
  // FAFF-1149: a recognised portable UNIT runner (node --test) bypasses os-mismatch — updated from
  // the pre-1149 "os-mismatch" expectation so the genuine cross-platform suite runs on any host.
  cases.push(["exclude: portable node --test bypasses os-mismatch (FAFF-1149)", exclusionReason({ command: "node --test", runs_on: "macos-latest" }, exCfg, "linux") === null]);
  // Companion: a NON-portable OS-specific shell step (not a CI_RUNNERS UNIT runner) still os-mismatch.
  cases.push(["exclude: non-portable OS-specific step still os-mismatch (FAFF-1149)", exclusionReason({ command: "sw_vers -productVersion", runs_on: "macos-latest" }, exCfg, "linux") === "os-mismatch"]);
  cases.push(["exclude: same-OS ubuntu on linux is runnable", exclusionReason({ command: "node --test", runs_on: "ubuntu-latest" }, exCfg, "linux") === null]);
  cases.push(["exclude: absent runs-on not excluded on OS grounds", exclusionReason({ command: "node --test" }, exCfg, "linux") === null]);
  cases.push(["exclude: matrix runs-on (unrecognised) not excluded", exclusionReason({ command: "node --test", runs_on: "${{ matrix.os }}" }, exCfg, "linux") === null]);
  cases.push(["exclude: configured substring match", exclusionReason({ command: "node bin/faff regions selftest --region factory" }, exCfg, "linux") === "configured"]);
  cases.push(["exclude: precedence configured beats os-mismatch", exclusionReason({ command: "regions selftest x", runs_on: "macos-latest" }, exCfg, "linux") === "configured"]);

  // 27b. FAFF-1149 — not-runnable exclusion (comment lines, undefined shell vars, bare fragments).
  // The undefined-var leg is tested DETERMINISTICALLY: inject a known-present var and use a
  // known-absent one, restored after — never relying on an ambient var like $HOME.
  cases.push(["not-runnable: comment-only line", exclusionReason({ command: "# per-file loop over node --test" }, exCfg, "linux") === "not-runnable"]);
  cases.push(["not-runnable: assignment-only bare fragment", exclusionReason({ command: "SHARD_TOTAL=4" }, exCfg, "linux") === "not-runnable"]);
  const savedPresent = process.env.FAFF_TEST_PRESENT;
  const savedAbsent = process.env.FAFF_TEST_ABSENT;
  process.env.FAFF_TEST_PRESENT = "x";
  delete process.env.FAFF_TEST_ABSENT;
  cases.push(["not-runnable: reference to a var absent from process.env", exclusionReason({ command: "node --import ./test/hermetic-env.mjs --test \"$FAFF_TEST_ABSENT\"" }, exCfg, "linux") === "not-runnable"]);
  cases.push(["not-runnable: a command referencing only a PRESENT env var is runnable", exclusionReason({ command: "echo $FAFF_TEST_PRESENT" }, exCfg, "linux") === null]);
  if (savedPresent === undefined) delete process.env.FAFF_TEST_PRESENT; else process.env.FAFF_TEST_PRESENT = savedPresent;
  if (savedAbsent === undefined) delete process.env.FAFF_TEST_ABSENT; else process.env.FAFF_TEST_ABSENT = savedAbsent;

  // 28. FAFF-1149 — a portable UNIT runner (node --test) survives an OS mismatch as a runnable rung
  // (updated from the pre-1149 "macos step excluded" expectation), while a NON-portable OS-specific
  // step is still os-mismatch-excluded and logged. Two eligible steps now (the portable UNIT + LINT).
  const dMac = mk("macos", { ".github/workflows/mac.yml": "jobs:\n  impure-macos:\n    runs-on: macos-latest\n    steps:\n      - name: t\n        run: node --test\n      - name: mac-only\n        run: sw_vers -productVersion\n  linux-job:\n    runs-on: ubuntu-latest\n    steps:\n      - name: adapters\n        run: node bin/faff validate-adapters\n" });
  const selMac = selectRunnableRungs(dMac, cfgDefault, "linux");
  cases.push(["os-mismatch: portable node --test survives OS mismatch as a UNIT rung (FAFF-1149)", selMac.rungs.filter((r) => r.kind === "UNIT").length === 1 && selMac.rungs.some((r) => r.kind === "LINT")]);
  cases.push(["os-mismatch: portable UNIT step counts as eligible (2: node --test + validate-adapters)", selMac.coverage.eligible_steps === 2]);
  cases.push(["os-mismatch: the non-portable mac-only step is excluded and logged os-mismatch", selMac.exclusions.some((e) => e.reason === "os-mismatch" && /sw_vers/.test(e.command))]);
  // FAFF-1200: the mirror direction, pinned so both rows hold on any host. On a macOS host the
  // ubuntu-latest validate-adapters step is the os-mismatch while the portable node --test survives.
  const selMacHost = selectRunnableRungs(dMac, cfgDefault, "macos");
  cases.push(["os-mismatch (macos host): ubuntu step excluded os-mismatch, portable node --test UNIT survives (FAFF-1200)",
    selMacHost.exclusions.some((e) => e.reason === "os-mismatch" && /validate-adapters/.test(e.command)) &&
    selMacHost.rungs.filter((r) => r.kind === "UNIT").length === 1 && !selMacHost.rungs.some((r) => r.kind === "LINT")]);

  // 28b. a step's working-directory (before or after its run:) becomes the rung's cwd; a templated or
  // out-of-repo directory excludes the step; a step without one runs at the root as before.
  const dWd = mk("workdir", { ".github/workflows/w.yml": "jobs:\n  t:\n    steps:\n      - name: types\n        working-directory: pkg\n        run: npx tsc --noEmit -p tsconfig.json\n      - name: lint\n        run: node bin/faff lint-refs\n        working-directory: tools\n      - name: tests\n        run: node --test\n      - name: templated\n        working-directory: ${{ matrix.dir }}\n        run: node bin/faff adr validate\n      - name: outside\n        working-directory: ../elsewhere\n        run: node bin/faff prdr validate\n" });
  const selWd = selectRunnableRungs(dWd, cfgDefault);
  const wdOf = (kind) => (selWd.rungs.find((r) => r.kind === kind) || {}).cwd;
  cases.push(["workdir: working-directory before run: sets the rung cwd", wdOf("TYPECHECK") === "pkg"]);
  cases.push(["workdir: working-directory after run: sets the rung cwd", wdOf("LINT") === "tools"]);
  cases.push(["workdir: a step without working-directory has no cwd", wdOf("UNIT") === undefined]);
  cases.push(["workdir: a templated working-directory is excluded github-context", selWd.exclusions.some((e) => e.reason === "github-context" && /adr validate/.test(e.command))]);
  cases.push(["workdir: an out-of-repo working-directory is excluded not-runnable", selWd.exclusions.some((e) => e.reason === "not-runnable" && /prdr validate/.test(e.command))]);
  const wdJobs = extractRunCommandsWithContext("jobs:\n  a:\n    steps:\n      - name: t\n        run: node --test\n  b:\n    defaults:\n      run:\n        working-directory: site\n    steps:\n      - working-directory: pkg\n        run: npx tsc --noEmit\n");
  cases.push(["workdir: a later job's defaults working-directory never leaks onto the previous job's step", wdJobs.find((r) => r.command === "node --test").working_directory === undefined]);
  cases.push(["workdir: working-directory as a step's first key (- working-directory:) is honoured", wdJobs.find((r) => /tsc/.test(r.command)).working_directory === "pkg"]);
  cases.push(["workdir: rungCwd joins the cwd onto the root", rungCwd({ cwd: "pkg" }, "/r") === path.join("/r", "pkg") && rungCwd({}, "/r") === "/r"]);

  // 29. configured exclusion — a gates.exclude entry removes matching rungs; the rest still run.
  const dExc = mk("exc", {
    ".faffrc.yaml": "gates:\n  exclude:\n    - regions selftest\n",
    ".github/workflows/w.yml": "jobs:\n  v:\n    steps:\n      - name: check\n        run: node bin/faff regions check\n      - name: self\n        run: node bin/faff regions selftest --region factory\n",
  });
  const selExc = selectRunnableRungs(dExc, readGatesConfig(dExc), "linux");
  cases.push(["configured: no regions selftest rung when gates.exclude names it", !selExc.rungs.some((r) => /regions\s+selftest/i.test(r.command))]);
  cases.push(["configured: the non-excluded regions check rung still present", selExc.rungs.some((r) => /regions\s+check/i.test(r.command))]);
  cases.push(["configured: readGatesConfig parses gates.exclude list", readGatesConfig(dExc).exclude.includes("regions selftest")]);

  // 30. per-kind cap — cap 2 keeps the cheapest 2 STATIC_ANALYSIS rungs of the wide fixture.
  const cfgCap = { ...cfgDefault, max_rungs_per_kind: 2 };
  const selCap = selectRunnableRungs(dWide, cfgCap, "linux");
  cases.push(["cap: max_rungs_per_kind=2 keeps 2 STATIC_ANALYSIS rungs", selCap.rungs.filter((r) => r.kind === "STATIC_ANALYSIS").length === 2]);
  cases.push(["cap: capPerKind keeps the cheapest N by cost_rank",
    capPerKind([{ kind: "UNIT", cost_rank: 55 }, { kind: "UNIT", cost_rank: 50 }, { kind: "UNIT", cost_rank: 60 }], 2).map((r) => r.cost_rank).join(",") === "50,55"]);

  // 31. readGatesConfig malformed-value coercion → defaults.
  const dBad = mk("badcfg", { ".faffrc.yaml": "gates:\n  partial: banana\n  max_rungs_per_kind: -3\n  partial_threshold: 9\n  exclude: not-a-list\n" });
  const cfgBad = readGatesConfig(dBad);
  cases.push(["config coerce: invalid gates.partial → warn", cfgBad.partial === "warn"]);
  cases.push(["config coerce: non-positive max_rungs_per_kind → 5", cfgBad.max_rungs_per_kind === 5]);
  cases.push(["config coerce: out-of-range partial_threshold → 0.5", cfgBad.partial_threshold === 0.5]);
  cases.push(["config coerce: non-list gates.exclude → []", Array.isArray(cfgBad.exclude) && cfgBad.exclude.length === 0]);
  const dGood = mk("goodcfg", { ".faffrc.yaml": "gates:\n  partial: needs-human\n  max_rungs_per_kind: 3\n  partial_threshold: 0.7\n" });
  const cfgGood = readGatesConfig(dGood);
  cases.push(["config: valid gates.partial needs-human parsed", cfgGood.partial === "needs-human"]);
  cases.push(["config: valid max_rungs_per_kind parsed", cfgGood.max_rungs_per_kind === 3]);
  cases.push(["config: valid partial_threshold parsed", cfgGood.partial_threshold === 0.7]);

  // 32. applyPartialPolicy — the signal branch, unit-tested (never lowers fail/needs-human).
  const cov = { ratio: 0.32, eligible_steps: 19, recognised_steps: 6 };
  const cfgNH = { partial: "needs-human", partial_threshold: 0.5 };
  const cfgWarn = { partial: "warn", partial_threshold: 0.5 };
  cases.push(["signal: partial + needs-human + pass → needs-human", applyPartialPolicy("pass", "partial", cov, cfgNH).signal === "needs-human"]);
  cases.push(["signal: partial + warn + pass → pass + warning", applyPartialPolicy("pass", "partial", cov, cfgWarn).signal === "pass" && applyPartialPolicy("pass", "partial", cov, cfgWarn).partialWarning === true]);
  cases.push(["signal: never lowers a fail (needs-human config)", applyPartialPolicy("fail", "partial", cov, cfgNH).signal === "fail"]);
  cases.push(["signal: never lowers a needs-human (warn config)", applyPartialPolicy("needs-human", "partial", cov, cfgWarn).signal === "needs-human"]);
  cases.push(["signal: confident discovery is a pass-through", applyPartialPolicy("pass", "confident", { ratio: 1.0 }, cfgNH).signal === "pass" && applyPartialPolicy("pass", "confident", { ratio: 1.0 }, cfgNH).partialWarning === false]);
  cases.push(["signal: ratio at/above threshold is a pass-through", applyPartialPolicy("pass", "partial", { ratio: 0.6 }, cfgNH).signal === "pass"]);

  await runnerFileSelftestCases(cases, mk, tmp);

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }

  let failed = 0;
  for (const [n, ok] of cases) { console.log(`${ok ? "ok  " : "FAIL"} ${n}`); if (!ok) failed++; }
  console.log(`RESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}

// FAFF-1269: runner-file source cases. Fixtures are 0755 unless listed in `plain`; the
// executable-bit and symlink cases need POSIX file modes, so win32 asserts only the os-mismatch skip.
async function runnerFileSelftestCases(cases, mk, tmp) {
  const OK = "#!/bin/sh\nexit 0\n";
  const mkRunners = (name, files, plain = []) => {
    const d = mk(name, files);
    for (const f of Object.keys(files)) if (!plain.includes(f)) fs.chmodSync(path.join(d, f), 0o755);
    return d;
  };
  const cfgFor = (over = {}) => ({ fallback: "fail-closed", partial: "warn", exclude: [], max_rungs_per_kind: 5, partial_threshold: 0.5, ...over });
  const cmds = (rungs, kind) => rungs.filter((r) => !kind || r.kind === kind).map((r) => r.command).join(",");

  const unitNames = ["testall", "test-e2e", "unittests", "tests", "run-tests", "test-unit"];
  const lintNames = ["linter", "lint-js", "lint", "eslint"];
  const nullNames = ["setup", "rails", "cibuild", "latest", "attestation", "contest", "splint", "check", "format"];
  cases.push(["runner kind: wildcard and token UNIT names", unitNames.every((n) => runnerKindForName(n) === "UNIT")]);
  cases.push(["runner kind: wildcard and token LINT names", lintNames.every((n) => runnerKindForName(n) === "LINT")]);
  cases.push(["runner kind: non-gate names, check and format → null", nullNames.every((n) => runnerKindForName(n) === null)]);

  const winBase = mkRunners("runner-win", { "script/test": OK, "bin/lint": OK });
  const win = selectRunnableRungs(winBase, cfgFor(), "windows");
  cases.push(["runner windows: no runner rung, each candidate excluded os-mismatch",
    !win.rungs.some((r) => r.source === "runner_file") &&
    win.exclusions.filter((e) => e.reason === "os-mismatch").map((e) => e.command).sort().join(",") === "./bin/lint,./script/test"]);
  if (process.platform === "win32") return;

  const dBase = mkRunners("runner-base", { "script/test": OK, "bin/lint": OK });
  const rep = discoverRungsReporting(dBase);
  const unit = rep.rungs.find((r) => r.kind === "UNIT");
  const lint = rep.rungs.find((r) => r.kind === "LINT");
  cases.push(["runner: script/test + bin/lint → confident, UNIT ./script/test, LINT ./bin/lint",
    rep.discovery === "confident" && rep.rungs.length === 2 && unit && unit.command === "./script/test" && lint && lint.command === "./bin/lint"]);
  cases.push(["runner: rung shape (source, cost_rank, required, name)",
    unit.source === "runner_file" && unit.cost_rank === GATE_COST.UNIT + 2 && unit.required === true && unit.name === "unit (runner: ./script/test)" &&
    lint.source === "runner_file" && lint.cost_rank === GATE_COST.LINT + 2 && lint.name === "lint (runner: ./bin/lint)"]);
  cases.push(["runner: command matches the safe relative-path shape",
    rep.rungs.every((r) => /^\.\/(script|scripts|bin)\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(r.command))]);

  const dSh = mkRunners("runner-sh", { "scripts/lint.sh": OK });
  cases.push(["runner: scripts/lint.sh → LINT ./scripts/lint.sh", cmds(discoverRungsReporting(dSh).rungs, "LINT") === "./scripts/lint.sh"]);

  const dWild = mkRunners("runner-wild", { "bin/testall": OK, "bin/test-e2e": OK, "bin/unittests": OK, "bin/linter": OK, "bin/lint-js": OK });
  const wild = discoverRungsReporting(dWild).rungs;
  cases.push(["runner: wildcard files each give a rung of the right kind",
    cmds(wild, "UNIT") === "./bin/test-e2e,./bin/testall,./bin/unittests" && cmds(wild, "LINT") === "./bin/lint-js,./bin/linter"]);

  const dNeg = mkRunners("runner-neg", { "bin/setup": OK, "bin/rails": OK, "script/cibuild": OK, "bin/latest": OK, "bin/attestation": OK, "bin/contest": OK, "bin/splint": OK });
  cases.push(["runner: non-gate names produce no rung", discoverRungsReporting(dNeg).rungs.length === 0]);

  const dExt = mkRunners("runner-ext", { "bin/test": OK, "bin/test.sh": OK });
  cases.push(["runner: bin/test + bin/test.sh → one rung ./bin/test", cmds(discoverRungsReporting(dExt).rungs) === "./bin/test"]);
  const dDirs = mkRunners("runner-dirs", { "script/test": OK, "bin/test": OK });
  cases.push(["runner: script/test + bin/test → one rung ./script/test", cmds(discoverRungsReporting(dDirs).rungs) === "./script/test"]);

  const dTwo = mkRunners("runner-two", { "bin/test-unit": OK, "bin/test-e2e": OK });
  cases.push(["runner: two UNIT runners both appear in reporting and execution",
    cmds(discoverRungsReporting(dTwo).rungs) === "./bin/test-e2e,./bin/test-unit" &&
    cmds(selectRunnableRungs(dTwo, cfgFor(), "linux").rungs) === "./bin/test-e2e,./bin/test-unit"]);
  cases.push(["runner: max_rungs_per_kind 1 keeps ./bin/test-e2e", cmds(selectRunnableRungs(dTwo, cfgFor({ max_rungs_per_kind: 1 }), "linux").rungs) === "./bin/test-e2e"]);
  const exCap = selectRunnableRungs(dTwo, cfgFor({ max_rungs_per_kind: 1, exclude: ["./bin/test-e2e"] }), "linux");
  cases.push(["runner: excluded runner is configured and takes no cap slot",
    cmds(exCap.rungs) === "./bin/test-unit" && exCap.exclusions.some((e) => e.command === "./bin/test-e2e" && e.reason === "configured")]);

  const ciNodeTest = "jobs:\n  u:\n    steps:\n      - run: node --test\n";
  const dPkgWins = mkRunners("runner-pkg-wins", { "package.json": JSON.stringify({ scripts: { test: "true" } }), "script/test": OK, "bin/test-e2e": OK, ".github/workflows/ci.yml": ciNodeTest }, ["package.json", ".github/workflows/ci.yml"]);
  const pkgWins = selectRunnableRungs(dPkgWins, cfgFor(), "linux");
  cases.push(["runner: package.json UNIT suppresses every runner UNIT rung",
    cmds(discoverRungsReporting(dPkgWins).rungs, "UNIT") === "npm run test" && cmds(pkgWins.rungs, "UNIT") === "npm run test"]);
  cases.push(["runner: CI dropped by a local rung is not runner-covered", !pkgWins.exclusions.some((e) => e.reason === "runner-covered")]);
  const dMake = mkRunners("runner-make", { "Makefile": "lint:\n\ttrue\n", "bin/lint": OK }, ["Makefile"]);
  cases.push(["runner: Makefile LINT suppresses the runner LINT rung", cmds(discoverRungsReporting(dMake).rungs, "LINT") === "make lint"]);
  const dPre = mkRunners("runner-pre", { ".pre-commit-config.yaml": "repos:\n  - hooks:\n      - id: eslint\n", "bin/lint": OK }, [".pre-commit-config.yaml"]);
  cases.push(["runner: pre-commit LINT suppresses the runner LINT rung", cmds(discoverRungsReporting(dPre).rungs, "LINT") === "pre-commit run eslint --all-files"]);

  const dCi = mkRunners("runner-ci", { "bin/test-unit": OK, "bin/test-e2e": OK, ".github/workflows/ci.yml": ciNodeTest }, [".github/workflows/ci.yml"]);
  const ciSel = selectRunnableRungs(dCi, cfgFor(), "linux");
  cases.push(["runner: runner UNIT suppresses the CI UNIT rung (reporting and execution)",
    cmds(discoverRungsReporting(dCi).rungs, "UNIT") === "./bin/test-e2e,./bin/test-unit" && cmds(ciSel.rungs, "UNIT") === "./bin/test-e2e,./bin/test-unit"]);
  cases.push(["runner: displaced CI rung recorded as runner-covered", ciSel.exclusions.some((e) => e.command === "node --test" && e.reason === "runner-covered")]);
  const dOrder = mkRunners("runner-order", { "package.json": JSON.stringify({ scripts: { lint: "true" } }), "bin/lint": OK, "bin/test": OK, ".github/workflows/ci.yml": ciNodeTest }, ["package.json", ".github/workflows/ci.yml"]);
  cases.push(["runner: discoverRungs picks pkg over runner and runner over CI", cmds(discoverRungs(dOrder).rungs) === "npm run lint,./bin/test"]);

  const dUnsafe = mkRunners("runner-unsafe", { "bin/te st": OK, "bin/test;rm": OK, "bin/$(x)test": OK });
  cases.push(["runner: names with whitespace or shell metacharacters produce no rung", discoverRungsReporting(dUnsafe).rungs.length === 0]);

  const outside = path.join(tmp, "runner-outside-target");
  fs.writeFileSync(outside, OK);
  fs.chmodSync(outside, 0o755);
  const dOut = mk("runner-symlink-out", {});
  fs.mkdirSync(path.join(dOut, "bin"));
  fs.symlinkSync(outside, path.join(dOut, "bin", "test"));
  cases.push(["runner: symlink resolving outside the repo produces no rung", discoverRungsReporting(dOut).rungs.length === 0]);
  const dIn = mkRunners("runner-symlink-in", { "tools/run-tests": OK });
  fs.mkdirSync(path.join(dIn, "bin"));
  fs.symlinkSync(path.join("..", "tools", "run-tests"), path.join(dIn, "bin", "test"));
  cases.push(["runner: symlink inside the repo to an executable file gives a rung", cmds(discoverRungsReporting(dIn).rungs) === "./bin/test"]);

  const dPlain = mkRunners("runner-plain", { "bin/test": OK }, ["bin/test"]);
  cases.push(["runner: non-executable bin/test (0644) produces no rung", discoverRungsReporting(dPlain).rungs.length === 0]);

  const lad = await runLadder(dBase);
  cases.push(["runner ladder: script/test + bin/lint → pass, both rungs pass",
    lad.signal === "pass" && lad.rungs.length === 2 && lad.rungs.every((r) => r.status === "pass")]);
  const dFail = mkRunners("runner-fail", { "script/test": "#!/bin/sh\nexit 1\n" });
  cases.push(["runner ladder: a runner exiting 1 → fail", (await runLadder(dFail)).signal === "fail"]);
}

module.exports = { GATES_SPEC, GATES_SURFACE, cmdGates, gatesContractExtraction, gatesSelftest };
