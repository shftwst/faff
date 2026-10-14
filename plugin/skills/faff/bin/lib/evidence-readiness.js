// ===========================================================================
// === region:factory — evidence-readiness — FAFF-1263: the measurable exit criterion for the warn-only evidence-schema period ===
//
// `faff evidence-readiness --since <rev>` re-validates every per-PR anchor first added to git in
// <rev>..HEAD against the bundled v0.3 schemas and reports whether FAFF-1261 may switch on refusal.
// The committed anchors are the durable record of a warning, so the count is reproducible on any
// checkout of the same commit. Read-only: it changes no gate and writes nothing.
//
// It is factory-region because it requires governance-check.js (deriveAnchorDirs); evidence.js is
// governance-region and may not require a factory file.
// ===========================================================================

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { SchemaUnavailable, checkAnchorDir, manifestFileNames, sanitiseDisplay } = require("./evidence");
const governanceCheck = require("./governance-check");

const SPEC_VERSION = "v0.3";
const DEFAULT_ANCHORS_ROOT = ".faff/anchors";

// The six writer slices of FAFF-1255. FAFF-1257 is an umbrella since its split and is not listed.
const WRITER_TICKETS = ["FAFF-1266", "FAFF-1267", "FAFF-1268", "FAFF-1258", "FAFF-1259", "FAFF-1260"];
const ROUTINE_FILES = ["events.jsonl", "run-ledger.json", "build-progress.json", "ac-checklist.json", "review-verdict.json", "declared-effects.jsonl", "chain-head.json", "effects-chain-head.json"];
const WRITER_PROOF_FILES = ["spec-review-verdict.json", "holdout.json"];
// Occasional files are whatever the bundled manifest names beyond the routine and writer-proof sets.

const EVIDENCE_READINESS_SPEC = { flags: {
  "--since": { arity: 1 }, "--anchors-root": { arity: 1 }, "--json": { arity: 0 }, "--selftest": { arity: 0 },
}, positionals: { min: 0, max: 0 } };

class ReadinessFault extends Error {}

const toPosix = (p) => p.split(path.sep).join("/");
const UNSAFE_PATH = /[\u0000-\u001f\u007f|]/;

// --- the pure criterion ------------------------------------------------------

// evaluate(input) -> ReadinessReport. input.anchors: [{ anchor, run, issue, status, files: [non-ok paths],
// present: [every file path in the anchor], bound, commit }]; input.writers: [{ issue, commit, before_since }].
function evaluate(input) {
  const anchors = [...input.anchors].sort((a, b) => (a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0));
  const warningAnchors = anchors
    .filter((a) => a.status !== "pass")
    .map((a) => ({ anchor: a.anchor, status: a.status === "legacy" || a.status === "fail" ? a.status : "error", files: a.files }));
  const byRun = new Map();
  for (const a of anchors) {
    if (!byRun.has(a.run)) byRun.set(a.run, []);
    byRun.get(a.run).push(a);
  }
  const runs = [...byRun.keys()].sort().map((run) => {
    const list = byRun.get(run);
    const beepBoop = run.includes("-beepboop-");
    return {
      run, beep_boop: beepBoop, anchors: list.length, warnings: list.filter((a) => a.status !== "pass").length,
      qualifying: beepBoop && list.every((a) => a.bound && a.status === "pass"),
    };
  });
  const qualifyingRuns = new Set(runs.filter((r) => r.qualifying).map((r) => r.run));
  const observedWhere = (name, predicate) => anchors.some((a) => predicate(a) && a.present.includes(name));
  const observe = (names, predicate) => Object.fromEntries(names.map((n) => [n, { observed: observedWhere(n, predicate) }]));
  const routine = observe(ROUTINE_FILES, (a) => qualifyingRuns.has(a.run));
  const occasional = observe(input.occasional, (a) => qualifyingRuns.has(a.run));
  const writerProof = observe(WRITER_PROOF_FILES, (a) => a.bound);

  const unmet = [];
  if (anchors.length === 0) unmet.push("no anchors in window");
  for (const w of input.writers) {
    if (w.commit === null) unmet.push(`writer ${w.issue} has no merge commit on HEAD`);
    else if (!w.before_since) unmet.push(`writer ${w.issue} merged after --since`);
  }
  if (input.dropped.length > 0) unmet.push(`${input.dropped.length} anchor path(s) dropped (see dropped)`);
  if (warningAnchors.length > 0) unmet.push(`${warningAnchors.length} warning(s) in window (see warning_anchors)`);
  if (anchors.length > 0 && qualifyingRuns.size === 0) unmet.push("no qualifying beep-boop run");
  for (const [name, v] of Object.entries(routine)) if (!v.observed) unmet.push(`routine file ${name} not observed`);
  for (const [name, v] of Object.entries(writerProof)) if (!v.observed) unmet.push(`writer-proof file ${name} not observed in window`);

  return {
    ready: unmet.length === 0,
    since: input.since,
    head: input.head,
    spec_version: SPEC_VERSION,
    window_anchors: anchors.length,
    warnings: warningAnchors.length,
    warning_anchors: warningAnchors,
    runs,
    writers: input.writers,
    dropped: input.dropped,
    ignored: input.ignored,
    unbound_anchors: input.unbound,
    routine_files: routine,
    writer_proof_files: writerProof,
    occasional_files: occasional,
    unmet,
  };
}

// --- git and filesystem collection ------------------------------------------

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 29, stdio: ["ignore", "pipe", "pipe"] });
}

function realpathOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

function listRelFiles(dir) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else out.push(r);
    }
  };
  walk("");
  return out;
}

function resolveRepo(cwd) {
  let inside;
  try { inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]).trim(); } catch { inside = ""; }
  if (inside !== "true") throw new ReadinessFault("not inside a git work tree");
  return fs.realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
}

function resolveAnchorsRoot(repoRoot, cwd, flag) {
  const asked = path.resolve(cwd, flag === undefined ? path.join(repoRoot, DEFAULT_ANCHORS_ROOT) : flag);
  const real = realpathOrNull(asked) || asked;
  if (real === repoRoot || !(real + path.sep).startsWith(repoRoot + path.sep)) throw new ReadinessFault("--anchors-root is not inside the repository");
  return { abs: real, rel: toPosix(path.relative(repoRoot, real)) };
}

function resolveWriters(repoRoot, sinceSha) {
  const lines = git(repoRoot, ["log", "--first-parent", "--format=%H%x09%s", "HEAD"]).split("\n").filter(Boolean);
  return WRITER_TICKETS.map((issue) => {
    const hit = lines.find((l) => l.slice(l.indexOf("\t") + 1).includes(`(${issue})`));
    const commit = hit ? hit.slice(0, hit.indexOf("\t")) : null;
    let before = false;
    if (commit !== null) {
      try { git(repoRoot, ["merge-base", "--is-ancestor", commit, sinceSha]); before = true; } catch { before = false; }
    }
    return { issue, commit, before_since: before };
  });
}

function wholeToken(subject, issue) {
  const escaped = issue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?![0-9])`).test(subject);
}

function collect(cwd, values) {
  const since = values["--since"];
  if (typeof since !== "string" || since === "") throw new ReadinessFault("--since <rev> is required");
  if (since.startsWith("-")) throw new ReadinessFault("--since must be a revision, not an option");
  const repoRoot = resolveRepo(cwd);
  const root = resolveAnchorsRoot(repoRoot, cwd, values["--anchors-root"]);
  if (git(repoRoot, ["status", "--porcelain", "--untracked-files=all", "--", `:(literal)${root.rel}`]).trim() !== "") {
    throw new ReadinessFault("anchors root has uncommitted changes");
  }
  let sinceSha;
  try { sinceSha = git(repoRoot, ["rev-parse", "--verify", `${since}^{commit}`]).trim(); } catch { throw new ReadinessFault(`--since ${sanitiseDisplay(since)} does not resolve to a commit`); }
  const headSha = git(repoRoot, ["rev-parse", "HEAD"]).trim();
  const writers = resolveWriters(repoRoot, sinceSha);
  let occasional;
  try {
    const known = new Set([...ROUTINE_FILES, ...WRITER_PROOF_FILES]);
    occasional = manifestFileNames().filter((n) => !known.has(n)).sort();
  } catch (e) {
    if (e instanceof SchemaUnavailable) throw new ReadinessFault(sanitiseDisplay(e.message));
    throw e;
  }

  const added = git(repoRoot, ["log", "-z", "--diff-filter=A", "--name-only", "--format=", `${sinceSha}..HEAD`, "--", `:(literal)${root.rel}`])
    .split("\0").filter(Boolean);
  const dropped = [];
  const ignored = [];
  const candidates = [];
  for (const p of [...new Set(added)]) {
    if (UNSAFE_PATH.test(p)) { dropped.push({ path: sanitiseDisplay(p), reason: "unsafe path characters" }); continue; }
    const below = p.startsWith(root.rel + "/") ? p.slice(root.rel.length + 1) : null;
    if (below === null || below.split("/").length < 3) { ignored.push({ path: p, reason: "fewer than three segments below the anchors root" }); continue; }
    candidates.push(p);
  }
  const derived = governanceCheck.deriveAnchorDirs(candidates.map((p) => path.join(repoRoot, p)), root.abs);
  for (const d of derived.dropped) dropped.push({ path: sanitiseDisplay(toPosix(path.relative(repoRoot, d.path))), reason: sanitiseDisplay(d.reason) });

  const unbound = [];
  const anchors = [];
  let probed = false;
  for (const dir of derived.dirs) {
    const [run, issue] = toPosix(path.relative(root.abs, dir)).split("/");
    const dirRel = toPosix(path.relative(repoRoot, dir));
    const adding = git(repoRoot, ["log", "--first-parent", "--diff-filter=A", "--format=%H%x09%s", `${sinceSha}..HEAD`, "--", `:(literal)${dirRel}`]).split("\n").filter(Boolean);
    const last = adding.length ? adding[adding.length - 1] : "";
    const commit = last.slice(0, last.indexOf("\t"));
    const bound = last !== "" && wholeToken(last.slice(last.indexOf("\t") + 1), issue);
    if (!bound) unbound.push({ anchor: sanitiseDisplay(`${run}/${issue}`), commit });
    const check = checkAnchorDir(dir, {});
    probed = true;
    if (check.schema_unavailable) throw new ReadinessFault(check.reason);
    anchors.push({
      anchor: `${run}/${issue}`, run, issue, status: check.status, files: check.files.map((f) => f.path),
      present: listRelFiles(dir), bound, commit,
    });
  }
  if (!probed) {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "faff-evidence-readiness-probe-"));
    try {
      const check = checkAnchorDir(empty, {});
      if (check.schema_unavailable) throw new ReadinessFault(check.reason);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  }
  return { since: sinceSha, head: headSha, anchors, writers, occasional, dropped, ignored, unbound };
}

// --- rendering ---------------------------------------------------------------

function renderHuman(report) {
  const out = [`evidence-readiness since ${report.since.slice(0, 12)}: ${report.ready ? "READY" : "NOT READY"}`];
  out.push(`head ${report.head.slice(0, 12)}, spec ${report.spec_version}`);
  out.push(`window anchors: ${report.window_anchors}, warnings: ${report.warnings}, dropped: ${report.dropped.length}, ignored: ${report.ignored.length}, unbound: ${report.unbound_anchors.length}`);
  out.push("runs:");
  for (const r of report.runs) out.push(`  ${sanitiseDisplay(r.run)}: ${r.anchors} anchor(s), ${r.warnings} warning(s), ${r.beep_boop ? "beep-boop" : "other"}, ${r.qualifying ? "qualifying" : "not qualifying"}`);
  out.push("writers:");
  for (const w of report.writers) out.push(`  ${w.issue}: ${w.commit === null ? "no merge commit" : w.commit.slice(0, 12)}${w.commit !== null && !w.before_since ? " (after --since)" : ""}`);
  const listObserved = (label, map) => {
    out.push(`${label}:`);
    for (const [name, v] of Object.entries(map)) out.push(`  ${name}: ${v.observed ? "observed" : "not observed"}`);
  };
  listObserved("routine files", report.routine_files);
  listObserved("writer-proof files", report.writer_proof_files);
  listObserved("occasional files (reported only)", report.occasional_files);
  if (report.warning_anchors.length) {
    out.push("warning anchors:");
    for (const w of report.warning_anchors) out.push(`  ${sanitiseDisplay(w.anchor)}: ${w.status}${w.files.length ? ` (${w.files.join(", ")})` : ""}`);
  }
  for (const reason of report.unmet) out.push(`unmet: ${reason}`);
  return out.join("\n") + "\n";
}

// --- command -----------------------------------------------------------------

const USAGE = "usage: faff evidence-readiness --since <rev> [--anchors-root DIR] [--json]\n       faff evidence-readiness --selftest";

function cmdEvidenceReadiness(args) {
  const parsed = parseArgs(args, EVIDENCE_READINESS_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, USAGE);
  const values = parsed.values;
  if (values["--selftest"]) return evidenceReadinessSelftest();
  try {
    const report = evaluate(collect(process.cwd(), values));
    process.stdout.write(values["--json"] ? JSON.stringify(report) + "\n" : renderHuman(report));
    return report.ready ? 0 : 1;
  } catch (e) {
    if (e instanceof ReadinessFault) {
      process.stderr.write(`faff evidence-readiness: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

// --- selftest ----------------------------------------------------------------

function evidenceReadinessSelftest() {
  const failures = [];
  const check = (label, ok) => { if (!ok) failures.push(label); };
  const writers = WRITER_TICKETS.map((issue, i) => ({ issue, commit: String(i).repeat(40), before_since: true }));
  const files = [...ROUTINE_FILES, ...WRITER_PROOF_FILES];
  const anchor = (run, issue, over = {}) => ({ anchor: `${run}/${issue}`, run, issue, status: "pass", files: [], present: files, bound: true, commit: "c", ...over });
  const base = { since: "s".repeat(40), head: "h".repeat(40), writers, occasional: ["landing-progress.json"], dropped: [], ignored: [], unbound: [] };
  const run = "run-20261014-000000-beepboop-list-aaaaaa";
  const ready = (over) => evaluate({ ...base, anchors: [anchor(run, "FAFF-1")], ...over }).ready;

  check("a clean qualifying window is ready", ready({}));
  check("an empty window is not ready", !ready({ anchors: [] }));
  check("a legacy anchor is one warning", evaluate({ ...base, anchors: [anchor(run, "FAFF-1"), anchor(run, "FAFF-2", { status: "legacy" })] }).warnings === 1);
  check("a failing anchor with several bad files is one warning", evaluate({ ...base, anchors: [anchor(run, "FAFF-1", { status: "fail", files: ["a", "b", "c"] })] }).warnings === 1);
  check("no beep-boop run is not ready", !ready({ anchors: [anchor("run-20261014-000000-graft-FAFF-1", "FAFF-1")] }));
  check("an unbound anchor does not qualify its run", !ready({ anchors: [anchor(run, "FAFF-1", { bound: false })] }));
  check("a missing routine file blocks", !ready({ anchors: [anchor(run, "FAFF-1", { present: files.filter((f) => f !== "build-progress.json") })] }));
  check("a missing writer-proof file blocks", !ready({ anchors: [anchor(run, "FAFF-1", { present: ROUTINE_FILES })] }));
  check("a dropped path blocks", !ready({ dropped: [{ path: "x", reason: "y" }] }));
  check("a writer merged after --since blocks", !ready({ writers: writers.map((w, i) => (i === 0 ? { ...w, before_since: false } : w)) }));
  check("a writer with no commit blocks", !ready({ writers: writers.map((w, i) => (i === 0 ? { ...w, commit: null } : w)) }));
  check("an ignored path does not block", ready({ ignored: [{ path: "README.md", reason: "shallow" }] }));
  check("an occasional file never blocks", ready({}) && Object.values(evaluate({ ...base, anchors: [anchor(run, "FAFF-1")] }).occasional_files).every((v) => v.observed === false));
  check("whole-token binding rejects a longer number", wholeToken("feat (FAFF-90)", "FAFF-9") === false && wholeToken("feat (FAFF-9) (#1)", "FAFF-9") === true);
  check("unsafe path characters are recognised", UNSAFE_PATH.test("a|b") && UNSAFE_PATH.test("a\nb") && !UNSAFE_PATH.test("a/b"));

  if (failures.length) {
    process.stderr.write(`evidence-readiness selftest FAILED:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
    return 1;
  }
  process.stdout.write("evidence-readiness selftest: OK\n");
  return 0;
}

module.exports = { EVIDENCE_READINESS_SPEC, ROUTINE_FILES, WRITER_PROOF_FILES, WRITER_TICKETS, cmdEvidenceReadiness, evaluate, evidenceReadinessSelftest };
