#!/usr/bin/env node
// FAFF-440 — byte-identical verification harness for the bin/faff module split (FAFF-441).
//
// A one-time MIGRATION GATE, not a regression suite. It runs a fixed argv matrix against a
// pre-split binary (a git ref, materialised via `git archive` — NO worktree-registry writes, so the
// harness is safe to run from ANY checkout including inside a linked worktree; FAFF-442) and a post-split binary (the
// working tree) under IDENTICAL conditions — same install path, same sandbox HOME, same fixture
// bytes, same scrubbed env — and demands byte-identical stdout, stderr, and exit code per
// invocation. Any surviving difference is attributable to the split and nothing else.
//
// RUN-IN-PLACE SWAP is the whole trick: both phases install into the SAME per-shape paths and run
// from the SAME fixture under the SAME HOME, so path-embedding output (process.argv[1], __dirname,
// resolveHookBin, cwd diagnostics) is byte-identical across phases with ZERO normalization. The
// only residual cross-phase difference source is wall-clock/entropy in a row's output — such rows
// are EXCLUDED (or their pure `--selftest` form is used), never normalized (a normalizer is a place
// a real deviation hides). See records/specs/2026-07-10-FAFF-440-…-design.md.
//
//   node scripts/verify-split-parity.mjs --baseline-ref <git-ref> [--candidate-ref <ref>] [--keep]
//   node scripts/verify-split-parity.mjs --selftest
//
// Exit codes: 0 = full parity · 1 = >=1 mismatch · 2 = usage/setup fault (fail-closed).
//
// Recipe (recorded on FAFF-441): run with --baseline-ref = the split PR's merge-base; PASS/exit 0
// means the split changed no observable behaviour across the matrix under both install shapes; the
// EXCLUSIONS constant below lists what parity does NOT cover and why.
//
// Zero-dependency: node:* builtins + the repo's own test/helpers/seed-repo.mjs (ADR 0002).

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedRepo } from "../test/helpers/seed-repo.mjs";

const SELF_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SELF_PATH);
// REPO_ROOT stays SCRIPT_DIR-lexical (not resolved via --git-common-dir): FAFF-442 removed every
// worktree-registry WRITE, so the harness only ever issues git READS (rev-parse, archive) against
// this root — those are correct from any checkout (main or a linked worktree). No registry op means
// no reason to canonicalise the root. (--git-common-dir was measured a no-op for the old churn.)
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const FAFF_REL = path.join("plugin", "skills", "faff"); // the skill tree the split reorganises
// Explicit — Node's spawnSync default maxBuffer is 1 MiB, but the plugin/skills/faff tar stream is
// already ~1.4 MiB, so the default would silently truncate the baseline tree (FAFF-442 D5).
const ARCHIVE_MAXBUF = 64 * 1024 * 1024;

// Materialise a ref's plugin/skills/faff subtree as a plain file tree via `git archive | tar -x` —
// which the harness consumes exactly as `worktree add` used to (cpSync input + subprocess entrypoint),
// but with ZERO writes to the shared .git/worktrees/ registry (the FAFF-442 fix). Safe from any
// checkout, main or linked. Every step fails closed → SetupFault → exit 2 (never a truncated tree).
function materialiseRef(repoRoot, ref, destDir, refLabel) {
  let r = spawnSync("git", ["-C", repoRoot, "rev-parse", "--verify", `${ref}^{commit}`], { encoding: "utf8" });
  if (r.status !== 0) throw new SetupFault(`${refLabel} '${ref}' does not resolve to a commit`);
  r = spawnSync("git", ["-C", repoRoot, "archive", ref, "--", "plugin/skills/faff"], { maxBuffer: ARCHIVE_MAXBUF });
  if (r.error || r.status !== 0) throw new SetupFault(`${refLabel} '${ref}' git archive failed: ${r.error?.message ?? (r.stderr ?? Buffer.alloc(0)).toString()}`);
  mkdirSync(destDir, { recursive: true });
  // -p preserves the archived mode bits exactly (git 0644/0755), umask-independent — the harness
  // spawns bin/faff directly and FAFF-441's gate demands byte-identity incl. mode (FAFF-442 review).
  const x = spawnSync("tar", ["-x", "-p", "-C", destDir], { input: r.stdout });
  if (x.error || x.status !== 0) throw new SetupFault(`${refLabel} '${ref}' tar extract failed: ${x.error?.message ?? (x.stderr ?? Buffer.alloc(0)).toString()}`);
  return path.join(destDir, "plugin", "skills", "faff");
}

// A setup fault is anything that stops us building "identical conditions" — always exit 2, never a
// silent PASS. A real mismatch is exit 1.
class SetupFault extends Error {}

// ── The argv matrix (fixed order) ──────────────────────────────────────────────────────────────
// Each row: [args...]. First arg (when it is a subcommand) is what the coverage self-check maps.
// A pinned ISO / epoch is passed to the two hermetic rows so their wall-clock is fixed, not read.
const PINNED_ISO = "2026-01-02T03:04:05.000Z";
const PINNED_MS = "1767326645000";

// Every internal contract name that ships a `contract <name> --selftest` (from validate.yml).
const CONTRACT_NAMES = [
  "architecture-proposal", "automation-routing", "delivery-outcome", "env-handle",
  "holdout-verdict", "integrity-floor", "prd-coverage", "prd-readiness", "prdr-admission",
  "prdr-yagni", "quality-gates", "review-verdict", "run-termination", "spec-readiness",
  "spec-review-verdict",
];

const MATRIX = [
  // 1. Dispatch surface — the top-level dispatcher + USAGE (mutation-kill target lives here).
  ["--help"],
  ["help"],
  [],                                   // no-args → USAGE on stderr, exit 2
  ["__no_such_subcommand__"],           // unknown → USAGE on stderr, exit 2

  // 2. Every subcommand's `--selftest` as a subprocess — exercises that subcommand's module load +
  //    dispatch + its pure-function table through the real argv path (the seam a split breaks).
  ...[
    "admissible", "adr", "audit", "branch-protection-check", "budget", "build-progress", "contain",
    "container-check", "corrective-integrity", "dod", "economics", "effects", "eligible",
    "env", "events", "fixtures", "heartbeat", "holdout", "hooks-ensure",
    "intake-record", "intakecheck", "label", "labels", "lights-out", "lint-cli-doc",
    "lint-refs", "merge-fence", "merge-gate", "models", "next", "park-history", "prdr",
    "prepcheck", "profile", "project-next", "quality", "review-progress", "run-done",
    "runcheck", "sentry", "shadow-fidelity", "spec-review-lenses", "state", "validate-adapters",
    "worktree-prune", "worktree-root",
  ].map((s) => [s, "--selftest"]),
  ["config", "init", "--selftest"],     // config's selftest is under `init`
  ...CONTRACT_NAMES.map((n) => ["contract", n, "--selftest"]),

  // 3. Pure-read rows against the seeded fixture — exercise real argv→dispatch→read→stdout paths
  //    (what a bad require() actually breaks), which the in-memory selftest tables do not.
  ["config", "get", "tracking.spec_docs_path", "-d", "docs/specs/"],
  ["config", "dump"],
  ["state"],
  ["next"],
  ["eligible", "--label", "faff-automate", "--default", "opt-in"],

  // 4. Hermetic rows — wall-clock pinned by a documented flag, so output is fixed run-to-run.
  ["budget", "check", "--now-ms", PINNED_MS],
  ["park-history", "--now", PINNED_ISO],

  // 5. Shape-sensitive probes — the install-shape branches most at risk from moving files.
  ["hooks-ensure", "--dry-run"],
  ["doctor"],
];

// ── Exclusions (subcommand → reason) ────────────────────────────────────────────────────────────
// "No live-run row" — NOT "untested": every excluded subcommand whose `--selftest` is pure still has
// a selftest row above. These two have NO safe row: their `--selftest` mutates the install tree /
// writes files, which would desync the run-in-place trees between phases.
const EXCLUSIONS = [
  { subcommand: "sync", reason: "side-effecting" },            // re-links ~/.local/bin + skill dirs
  { subcommand: "gitignore-ensure", reason: "side-effecting" }, // writes .gitignore
  { subcommand: "gates", reason: "wall-clock" },               // even --selftest embeds live duration_ms
  // FAFF-444: regions --selftest's fixture table and regions check's output both changed shape
  // (banner-tagged identifier lint → require-graph enforcement) — parity vs the pre-split
  // baseline is definitionally broken for this surface, not a regression to chase.
  { subcommand: "regions", reason: "require-graph enforcement (FAFF-444) changed selftest/check output shape" },
];
// Exclusion ⇒ "no live-run row", not "untested". `gates`'s --selftest runs real timed checks whose
// duration_ms is non-deterministic (proven by a HEAD-vs-HEAD self-parity FAIL), so it has no
// byte-stable row — normalization is banned (a masked-deviation channel), so it is excluded. Every
// OTHER hazardous subcommand (heartbeat/intake-record/adr/prdr/profile/sentry/events/…) IS rowed
// via its PURE `--selftest` (a static "ok" table with no wall-clock), so it stays covered.

// ── Coverage self-check (fail-closed) ───────────────────────────────────────────────────────────
// Parse the candidate's `faff --help` for its top-level subcommands and assert every one appears in
// MATRIX (as a row's first arg) or EXCLUSIONS. Any gap → SetupFault (exit 2). Drift-proof: a
// subcommand added between spec and split cannot silently escape coverage.
function parseHelpSubcommands(helpText) {
  const subs = new Set();
  for (const line of String(helpText).split("\n")) {
    // Subcommand lines are indented two spaces then a lowercase token (see `faff --help`).
    const m = /^ {2}([a-z][a-z0-9-]*)\b/.exec(line);
    if (m) subs.add(m[1]);
  }
  return subs;
}

function coverageCheck(helpText, matrix, exclusions) {
  const subs = parseHelpSubcommands(helpText);
  if (subs.size === 0) throw new SetupFault("coverage self-check: parsed zero subcommands from `faff --help` (format drift?)");
  const rowSubs = new Set(matrix.filter((r) => r.length && /^[a-z]/.test(r[0])).map((r) => r[0]));
  const excluded = new Set(exclusions.map((e) => e.subcommand));
  const gaps = [...subs].filter((s) => !rowSubs.has(s) && !excluded.has(s));
  if (gaps.length) {
    throw new SetupFault(
      `coverage self-check: ${gaps.length} subcommand(s) in neither MATRIX nor EXCLUSIONS: ${gaps.join(", ")}`,
    );
  }
  return subs.size;
}

// ── Environment + install topology ──────────────────────────────────────────────────────────────
// Build the scrubbed child env ONCE. Replaced, not inherited: sandbox HOME, minimal PATH (dirs of
// node + git only, plus the shape-S bin dir), TZ/LC_ALL pinned, all ambient FAFF_*/CLAUDE_*/GIT_*
// dropped — so no ambient secret or config can reach a capture, and locale/tz can't vary output.
function toolDir(tool) {
  const r = spawnSync("bash", ["-lc", `command -v ${tool}`], { encoding: "utf8" });
  const p = (r.stdout || "").trim().split("\n")[0];
  if (!p) throw new SetupFault(`cannot resolve '${tool}' on PATH for the sandbox`);
  return path.dirname(p);
}

function buildScrubbedEnv(sandboxHome) {
  const binDirs = [...new Set([path.join(sandboxHome, ".local", "bin"), toolDir("node"), toolDir("git")])];
  return {
    HOME: sandboxHome,
    PATH: binDirs.join(":"),
    TZ: "UTC",
    LC_ALL: "C",
    // deliberately: no FAFF_*, CLAUDE_*, GIT_* — a scrubbed, reproducible world.
  };
}

// Install `srcFaffDir` (a .../plugin/skills/faff tree) into both per-shape locations at fixed paths.
function installTrees(srcFaffDir, paths) {
  for (const dest of [paths.shapeS.tree, paths.shapeC.tree]) {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(srcFaffDir, dest, { recursive: true });
  }
  // shape S: a symlink on the sandbox PATH → the tree's bin/faff (the real-install topology).
  rmSync(paths.shapeS.symlink, { force: true });
  mkdirSync(path.dirname(paths.shapeS.symlink), { recursive: true });
  symlinkSync(path.join(paths.shapeS.tree, "bin", "faff"), paths.shapeS.symlink);
}

// ── Capture + compare ───────────────────────────────────────────────────────────────────────────
// Raw bytes: no encoding ⇒ stdout/stderr are Buffers. Buffer.equals + strict exit equality.
function runRow(entrypoint, args, cwd, env, pluginRoot) {
  const rowEnv = pluginRoot ? { ...env, CLAUDE_PLUGIN_ROOT: pluginRoot } : { ...env };
  const r = spawnSync(entrypoint, args, { cwd, env: rowEnv }); // Buffers by default
  if (r.error) throw new SetupFault(`spawn failed for [${args.join(" ")}] at ${entrypoint}: ${r.error.message}`);
  return { stdout: r.stdout ?? Buffer.alloc(0), stderr: r.stderr ?? Buffer.alloc(0), exit: r.status };
}

function compareCaptures(a, b) {
  const fields = new Set();
  if (!a.stdout.equals(b.stdout)) fields.add("stdout");
  if (!a.stderr.equals(b.stderr)) fields.add("stderr");
  if (a.exit !== b.exit) fields.add("exit");
  return fields;
}

function diffExcerpt(a, b, fields) {
  const lines = [];
  if (fields.has("exit")) lines.push(`  exit: baseline=${a.exit} candidate=${b.exit}`);
  for (const f of ["stdout", "stderr"]) {
    if (!fields.has(f)) continue;
    const al = a[f].toString("utf8").split("\n");
    const bl = b[f].toString("utf8").split("\n");
    lines.push(`  ${f} differs (baseline ${al.length}L / candidate ${bl.length}L):`);
    const n = Math.min(40, Math.max(al.length, bl.length));
    for (let i = 0; i < n; i++) {
      if (al[i] !== bl[i]) {
        lines.push(`    - ${JSON.stringify(al[i] ?? null)}`);
        lines.push(`    + ${JSON.stringify(bl[i] ?? null)}`);
      }
    }
  }
  return lines.join("\n");
}

// ── The core parity run ─────────────────────────────────────────────────────────────────────────
// Runs the whole matrix under both shapes for baseline then candidate at IDENTICAL per-shape paths,
// then compares phase-A vs phase-B captures. Returns { comparisons, mismatches:[{shape,args,fields,diff}] }.
function runParity({ baselineSrc, candidateSrc, matrix, scratch }) {
  const sandboxHome = path.join(scratch, "home");
  const paths = {
    shapeS: {
      tree: path.join(sandboxHome, ".claude", "skills", "faff"),
      symlink: path.join(sandboxHome, ".local", "bin", "faff"),
    },
    shapeC: {
      tree: path.join(scratch, "plugin-root", "skills", "faff"),
      pluginRoot: path.join(scratch, "plugin-root"),
    },
  };
  mkdirSync(sandboxHome, { recursive: true });
  const env = buildScrubbedEnv(sandboxHome);

  // A single fixture TEMPLATE (real git repo + .faff tree), copied byte-for-byte per shape per
  // phase so git SHAs/timestamps are identical everywhere (no re-seed ⇒ no fresh SHAs).
  const seeded = seedRepo({});
  const template = seeded.root;

  const shapes = [
    { name: "S", entrypoint: paths.shapeS.symlink, pluginRoot: null },
    { name: "C", entrypoint: path.join(paths.shapeC.tree, "bin", "faff"), pluginRoot: paths.shapeC.pluginRoot },
  ];

  // captures[phase][shapeName][rowIndex]
  const captures = { A: { S: [], C: [] }, B: { S: [], C: [] } };
  const phases = [["A", baselineSrc], ["B", candidateSrc]];

  try {
    for (const [phase, src] of phases) {
      installTrees(src, paths);
      for (const shape of shapes) {
        const fixture = path.join(scratch, `fixture-${shape.name}`);
        rmSync(fixture, { recursive: true, force: true });
        cpSync(template, fixture, { recursive: true });
        for (const args of matrix) {
          captures[phase][shape.name].push(runRow(shape.entrypoint, args, fixture, env, shape.pluginRoot));
        }
      }
    }
  } finally {
    try { seeded.teardown(); } catch { /* best-effort */ }
  }

  const mismatches = [];
  let comparisons = 0;
  for (const shape of shapes) {
    for (let i = 0; i < matrix.length; i++) {
      comparisons++;
      const a = captures.A[shape.name][i];
      const b = captures.B[shape.name][i];
      const fields = compareCaptures(a, b);
      if (fields.size) {
        mismatches.push({ shape: shape.name, args: matrix[i], fields: [...fields], diff: diffExcerpt(a, b, fields) });
      }
    }
  }
  return { comparisons, mismatches };
}

// ── Gate mode (--baseline-ref) ──────────────────────────────────────────────────────────────────
function readCandidateHelp(candidateSrc) {
  const bin = path.join(candidateSrc, "bin", "faff");
  const r = spawnSync(bin, ["--help"], { encoding: "utf8" });
  if (r.error || typeof r.stdout !== "string") throw new SetupFault(`cannot read candidate \`faff --help\`: ${r.error?.message ?? "no output"}`);
  return r.stdout;
}

function gate({ baselineRef, candidateRef, keep }) {
  const scratch = mkdtempSync(path.join(tmpdir(), "faff-parity-"));
  try {
    // Materialise the baseline as a plain file tree via git archive — ZERO registry writes, so this
    // is safe from any checkout, main or linked (FAFF-442).
    const baselineSrc = materialiseRef(REPO_ROOT, baselineRef, path.join(scratch, "baseline"), "--baseline-ref");

    // Candidate = the working tree (default) or a materialised --candidate-ref (also archive-based).
    let candidateSrc = path.join(REPO_ROOT, FAFF_REL);
    if (candidateRef) {
      candidateSrc = materialiseRef(REPO_ROOT, candidateRef, path.join(scratch, "candidate"), "--candidate-ref");
    }

    // Drift-proof coverage totality BEFORE any run.
    const nSubs = coverageCheck(readCandidateHelp(candidateSrc), MATRIX, EXCLUSIONS);
    console.log(`coverage self-check: ${nSubs} subcommands, all in MATRIX or EXCLUSIONS`);

    const { comparisons, mismatches } = runParity({ baselineSrc, candidateSrc, matrix: MATRIX, scratch });

    for (const m of mismatches) {
      console.log(`\nMISMATCH  shape=${m.shape}  faff ${m.args.join(" ")}  [${m.fields.join(",")}]`);
      console.log(m.diff);
    }
    const pass = mismatches.length === 0;
    console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"} (${comparisons} comparisons, ${mismatches.length} mismatches)`);
    if (keep) console.log(`scratch retained: ${scratch}`);
    return pass ? 0 : 1;
  } finally {
    // Cleanup is a plain scratch removal — materialisation registered no worktree, so there is
    // nothing to unregister and nothing to strand even on an abnormal exit (FAFF-442).
    if (!keep) rmSync(scratch, { recursive: true, force: true });
  }
}

// ── Self-test (--selftest) ──────────────────────────────────────────────────────────────────────
// Proves the gate can actually pass AND fail: comparator field-attribution, self-parity PASS, a
// one-byte mutation kill (FAIL), and the coverage-drift kill (exit-2 path). A gate never seen to
// fail proves nothing.
const REDUCED = [["--help"], ["help"], [], ["__no_such_subcommand__"], ["next", "--selftest"], ["eligible", "--selftest"], ["config", "dump"]];

function selftest() {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };

  // 1. Comparator table — each field individually detected + attributed.
  const base = { stdout: Buffer.from("x"), stderr: Buffer.from("y"), exit: 0 };
  ok(compareCaptures(base, base).size === 0, "comparator: equal captures must have no mismatch");
  ok([...compareCaptures(base, { ...base, stdout: Buffer.from("z") })].join() === "stdout", "comparator: stdout-only diff misattributed");
  ok([...compareCaptures(base, { ...base, stderr: Buffer.from("z") })].join() === "stderr", "comparator: stderr-only diff misattributed");
  ok([...compareCaptures(base, { ...base, exit: 1 })].join() === "exit", "comparator: exit-only diff misattributed");

  // 4. Coverage-drift kill — a subcommand in neither list must exit 2 naming it.
  let drift = null;
  try { coverageCheck("Subcommands:\n  config <x> ...\n  ghostsub do a thing\n", [["config", "dump"]], []); }
  catch (e) { drift = e; }
  ok(drift instanceof SetupFault && /ghostsub/.test(drift.message), "coverage-drift kill: must SetupFault naming the uncovered subcommand");

  // 5. Worktree-verb invariant (D8) — the harness must never regain a `git worktree` write. Read our
  //    own source and fail on the exact quoted argv literal for the git subcommand. The needle is
  //    BUILT BY CONCATENATION so this assertion line can never match itself; the MATRIX rows
  //    "worktree-prune"/"worktree-root" and the D6 fs literal "worktrees" are different strings.
  const worktreeNeedle = '"work' + 'tree"';
  ok(!readFileSync(SELF_PATH, "utf8").includes(worktreeNeedle),
    `worktree-verb invariant: the harness source must contain zero occurrences of the ${worktreeNeedle} git argv literal (a git worktree call was reintroduced)`);

  // Prepare a scratch for the two live sub-runs (self-parity + mutation kill).
  const scratch = mkdtempSync(path.join(tmpdir(), "faff-parity-st-"));
  try {
    const cur = path.join(REPO_ROOT, FAFF_REL);

    // 2. Self-parity — baseline == candidate == working tree ⇒ 0 mismatches.
    const sp = runParity({ baselineSrc: cur, candidateSrc: cur, matrix: REDUCED, scratch: path.join(scratch, "sp") });
    mkdirSync(path.join(scratch, "sp"), { recursive: true }); // (defensive; runParity mkdirs home)
    ok(sp.mismatches.length === 0, `self-parity: expected 0 mismatches, got ${sp.mismatches.length} (${sp.mismatches.map((m) => m.args.join(" ")).join("; ")})`);

    // 3. Mutation kill — one-byte change to a user-visible USAGE string ⇒ >=1 mismatch on a dispatch row.
    const mutantTree = path.join(scratch, "mutant");
    cpSync(cur, mutantTree, { recursive: true });
    const binPath = path.join(mutantTree, "bin", "faff");
    const body = readFileSync(binPath, "utf8");
    // Mutate the LAST occurrence of a user-visible USAGE line — the needle also appears in a
    // top-of-file comment, so a first-match replace would mutate a comment (no output change).
    const needle = "the bundled CLI for the faff skill suite";
    const at = body.lastIndexOf(needle);
    ok(at >= 0, `mutation kill: needle ${JSON.stringify(needle)} not found in bin/faff`);
    writeFileSync(binPath, body.slice(0, at) + "the bundlxd CLI for the faff skill suite" + body.slice(at + needle.length));
    const mk = runParity({ baselineSrc: cur, candidateSrc: mutantTree, matrix: REDUCED, scratch: path.join(scratch, "mk") });
    ok(mk.mismatches.length >= 1, "mutation kill: expected >=1 mismatch, got 0 (gate cannot detect a deviation!)");
    ok(mk.mismatches.some((m) => m.args.includes("--help") || m.args.includes("help") || m.args.length === 0 || m.args[0]?.startsWith("__")), "mutation kill: mismatch did not name a dispatch/usage row");

    // 6. Registry-invariance (D4) — materialiseRef must leave the shared worktree registry untouched.
    //    Snapshot the registry dir (resolved via --git-common-dir, made absolute against REPO_ROOT;
    //    absent-dir → empty set) as sorted entry names, before and after materialising HEAD.
    const gcd = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
    const commonDir = gcd.status === 0 ? path.resolve(REPO_ROOT, gcd.stdout.trim()) : null;
    const regDir = commonDir ? path.join(commonDir, "worktrees") : null;
    const snapReg = () => { try { return readdirSync(regDir).sort().join("\n"); } catch { return ""; } };
    const before = regDir ? snapReg() : null;
    const matDest = path.join(scratch, "mat");
    const faffDir = materialiseRef(REPO_ROOT, "HEAD", matDest, "--baseline-ref");
    if (regDir) ok(before === snapReg(), "registry-invariance: materialiseRef changed the shared worktree registry (must be byte-identical)");
    const matBin = path.join(faffDir, "bin", "faff");
    ok((statSync(matBin).mode & 0o111) !== 0, "registry-invariance: materialised bin/faff must exist and be executable");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (fails.length) {
    console.log("verify-split-parity --selftest: FAIL");
    for (const f of fails) console.log(`  - ${f}`);
    return 1;
  }
  console.log("verify-split-parity --selftest: PASS (comparator + coverage-drift kill + self-parity + mutation kill + worktree-verb invariant + registry-invariance)");
  return 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { keep: false, selftest: false, baselineRef: null, candidateRef: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--selftest") a.selftest = true;
    else if (t === "--keep") a.keep = true;
    else if (t === "--baseline-ref") a.baselineRef = argv[++i];
    else if (t === "--candidate-ref") a.candidateRef = argv[++i];
    else throw new SetupFault(`unknown argument: ${t}`);
  }
  return a;
}

function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(String(e.message ?? e)); return 2; }

  if (a.selftest) return selftest();
  if (!a.baselineRef) { console.error("usage: verify-split-parity.mjs --baseline-ref <git-ref> [--candidate-ref <ref>] [--keep] | --selftest"); return 2; }
  try { return gate(a); }
  catch (e) {
    if (e instanceof SetupFault) { console.error(`SETUP FAULT: ${e.message}`); return 2; }
    throw e;
  }
}

process.exit(main());
