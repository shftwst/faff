// ===========================================================================
// === region:factory — gates-progress — FAFF-1405: budgeted, resumable gate runs (fingerprints and the progress file) ===
// `faff gates run --budget-secs N` / `--resume` save the units a call finished to
// <root>/.faff/gates/run-progress.json so the next call can skip them. A saved result is only
// reused on the same tree and plan: the tree fingerprint is HEAD's tree id plus the content id of
// every file `git status` reports (nothing is written to the index or the object store), and the
// plan fingerprint covers the runnable rungs, their units and the gates config. Progress older than
// an hour is stale. The file is never trusted blindly: it is read without following a symlink,
// shape-checked, and discarded (and deleted) on any doubt.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { readLeafNoFollow } = require("./leaf-read");
const { redactKnownSecrets, resolveKnownSecretValues } = require("./redact");
const { secretRedact } = require("./adversarial-judge-scrub");

const PROGRESS_SCHEMA = 1;
const PROGRESS_FILE = "run-progress.json";
const STALE_AFTER_MS = 3600 * 1000;
const MAX_BUDGET_SECS = 480;
const DEFAULT_BUDGET_SECS = 420;
const MAX_GRACE_SECS = 60;
const UNIT_STATUSES = new Set(["pass", "fail", "errored"]);

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// A typed failure the CLI maps to exit 2 with `reason` on stderr.
class GatesProgressError extends Error {
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
    this.detail = detail;
  }
}

function git(root, args, input) {
  const opts = { cwd: root, maxBuffer: 256 * 1024 * 1024 };
  if (input !== undefined) opts.input = Buffer.from(input, "utf8");
  const res = spawnSync("git", args, opts);
  return res;
}

function gitOk(root, args, step, input) {
  const res = git(root, args, input);
  if (res.error || res.status !== 0) {
    const why = res.error ? res.error.message : String(res.stderr || "").trim().split("\n").pop();
    throw new GatesProgressError("git-failed", `${step}: ${why || `exit ${res.status}`}`);
  }
  return res.stdout;
}

// True when root is inside a git work tree.
function isGitWorkTree(root) {
  const res = git(root, ["rev-parse", "--is-inside-work-tree"]);
  return !res.error && res.status === 0 && String(res.stdout).trim() === "true";
}

// Content ids for regular files, computed by `git hash-object --no-filters --stdin-paths` (no -w, so
// nothing reaches the object store). Paths are absolute or relative to root.
function contentIds(root, paths) {
  if (!paths.length) return [];
  const out = String(gitOk(root, ["hash-object", "--no-filters", "--stdin-paths"], "git hash-object", paths.join("\n") + "\n"));
  const ids = out.split("\n").filter(Boolean);
  if (ids.length !== paths.length) throw new GatesProgressError("git-failed", "git hash-object: id count mismatch");
  return ids;
}

// Split `git status --porcelain=v2 -z` output into the paths it reports (rename sources included).
function parseStatusPaths(buf) {
  const recs = String(buf).split("\0");
  const paths = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!r) continue;
    const t = r[0];
    if (t === "?") paths.push(r.slice(2));
    else if (t === "1") paths.push(r.split(" ").slice(8).join(" "));
    else if (t === "2") { paths.push(r.split(" ").slice(9).join(" ")); if (recs[i + 1]) paths.push(recs[++i]); }
    else if (t === "u") paths.push(r.split(" ").slice(10).join(" "));
  }
  return [...new Set(paths)].sort();
}

// The tree fingerprint (spec 4.2): sha256 over HEAD^{tree} and one entry per changed path. Writes
// nothing: --no-optional-locks keeps `git status` from refreshing .git/index.
function treeFingerprint(root) {
  const base = String(gitOk(root, ["rev-parse", "HEAD^{tree}"], "git rev-parse")).trim();
  const status = gitOk(root, ["--no-optional-locks", "status", "--porcelain=v2", "-z", "--untracked-files=all", "--", ".", ":(exclude).faff"], "git status");
  const paths = parseStatusPaths(status);
  const entries = [];
  const regular = [];
  for (const p of paths) {
    let st;
    try { st = fs.lstatSync(path.join(root, p)); } catch { entries.push({ p, e: `D ${p}` }); continue; }
    if (st.isSymbolicLink()) {
      let target = "";
      try { target = fs.readlinkSync(path.join(root, p)); } catch { /* unreadable link: hash the empty target */ }
      entries.push({ p, e: `120000 link:${sha256(target)} ${p}` });
    } else if (st.isFile()) {
      const mode = (st.mode & 0o111) ? "100755" : "100644";
      regular.push({ p, mode });
    } else {
      entries.push({ p, e: `other ${p}` });
    }
  }
  const ids = contentIds(root, regular.map((r) => r.p));
  regular.forEach((r, i) => entries.push({ p: r.p, e: `${r.mode} ${ids[i]} ${r.p}` }));
  entries.sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  return sha256(base + "\0" + entries.map((x) => x.e).join("\0"));
}

function sortedJson(v) {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${sortedJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v === undefined ? null : v);
}

// The plan fingerprint (spec 4.2): the runnable rungs, each rung's ordered unit list (pool files with
// their content ids), and the gates config without the budget, which decides when a call stops and
// not whether a result holds.
function planFingerprint(rungPlans, cfg) {
  const { run_budget_secs, run_budget_secs_raw, ...rest } = cfg || {};
  const rungs = rungPlans.map((p) => ({
    kind: p.rung.kind, name: p.rung.name, command: p.rung.command,
    required: !!p.rung.required, cwd: p.rung.cwd || null,
    mode: p.mode, units: p.units.map((u) => ({ id: u.id, content: u.content || null, serial: !!u.serial })),
  }));
  return sha256(sortedJson({ rungs, cfg: rest }));
}

function progressDir(root) { return path.join(root, ".faff", "gates"); }
function progressPath(root) { return path.join(progressDir(root), PROGRESS_FILE); }

// Check (and optionally create) .faff and .faff/gates: each must be a real directory, not a symlink,
// and resolve inside root. Throws progress-dir-unsafe.
function checkProgressDir(root, { create } = {}) {
  const realRoot = fs.realpathSync(root);
  for (const rel of [".faff", path.join(".faff", "gates")]) {
    const abs = path.join(root, rel);
    let st = null;
    try { st = fs.lstatSync(abs); } catch (e) { if (e.code !== "ENOENT") throw new GatesProgressError("progress-dir-unsafe", `${rel}: ${e.code}`); }
    if (st === null) {
      if (!create) return false;
      fs.mkdirSync(abs, { mode: 0o700 });
      st = fs.lstatSync(abs);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new GatesProgressError("progress-dir-unsafe", `${rel} is not a real directory`);
  }
  const realDir = fs.realpathSync(progressDir(root));
  if (realDir !== path.join(realRoot, ".faff", "gates")) throw new GatesProgressError("progress-dir-unsafe", ".faff/gates resolves outside the root");
  return true;
}

// Make sure git ignores the progress file before writing it (spec 4.3). Writes .faff/gates/.gitignore
// as exactly "*\n" when that file is untracked or absent; never edits a tracked file.
function ensureProgressIgnored(root) {
  const rel = path.join(".faff", "gates", PROGRESS_FILE);
  const ignored = () => {
    const r = git(root, ["check-ignore", "-q", "--", rel]);
    if (r.error || (r.status !== 0 && r.status !== 1)) throw new GatesProgressError("git-failed", "git check-ignore");
    return r.status === 0;
  };
  if (ignored()) return;
  const giRel = path.join(".faff", "gates", ".gitignore");
  const tracked = git(root, ["ls-files", "--error-unmatch", "--", giRel]);
  if (!tracked.error && tracked.status === 0) {
    throw new GatesProgressError("progress-file-not-ignored", `${giRel} is tracked and does not ignore ${PROGRESS_FILE}`);
  }
  const giAbs = path.join(root, giRel);
  let st = null;
  try { st = fs.lstatSync(giAbs); } catch { /* absent */ }
  if (st && !st.isFile()) throw new GatesProgressError("progress-dir-unsafe", `${giRel} is not a regular file`);
  fs.writeFileSync(giAbs, "*\n", { mode: 0o600 });
  if (!ignored()) throw new GatesProgressError("progress-file-not-ignored", `${rel} is still not ignored`);
}

function validUnitResult(u) {
  return u && typeof u === "object" && Number.isInteger(u.rung_index) && u.rung_index >= 0
    && typeof u.unit === "string" && UNIT_STATUSES.has(u.status)
    && Number.isFinite(u.duration_ms) && typeof u.detail === "string"
    && (u.reason === undefined || typeof u.reason === "string")
    && (u.ceiling_secs === undefined || Number.isInteger(u.ceiling_secs));
}

function validProgress(p) {
  return p && typeof p === "object" && p.schema === PROGRESS_SCHEMA
    && typeof p.tree === "string" && typeof p.plan === "string"
    && typeof p.written_at === "string" && Number.isFinite(Date.parse(p.written_at))
    && Number.isInteger(p.calls) && p.calls >= 1
    && Array.isArray(p.done) && p.done.every(validUnitResult)
    && p.rung_ms && typeof p.rung_ms === "object" && !Array.isArray(p.rung_ms);
}

// readProgress(root) -> { kind: "absent" } | { kind: "ok", progress } | { kind: "unreadable" }
function readProgress(root) {
  let leaf;
  try {
    if (!checkProgressDir(root)) return { kind: "absent" };
    leaf = readLeafNoFollow(progressPath(root));
  } catch { return { kind: "unreadable" }; }
  if (leaf.kind === "absent") return { kind: "absent" };
  if (leaf.kind !== "regular") return { kind: "unreadable" };
  let p;
  try { p = JSON.parse(leaf.bytes.toString("utf8")); } catch { return { kind: "unreadable" }; }
  return validProgress(p) ? { kind: "ok", progress: p } : { kind: "unreadable" };
}

// Decide whether saved progress applies to this call (spec 4.1 step 4).
function judgeProgress(read, tree, plan, nowMs) {
  if (read.kind === "absent") return { prior: null, discarded: null };
  if (read.kind !== "ok") return { prior: null, discarded: "unreadable" };
  const p = read.progress;
  if (p.tree !== tree) return { prior: null, discarded: "tree-changed" };
  if (p.plan !== plan) return { prior: null, discarded: "plan-changed" };
  if (nowMs - Date.parse(p.written_at) > STALE_AFTER_MS) return { prior: null, discarded: "stale" };
  return { prior: p, discarded: null };
}

// A unit's detail is already the last 500 characters of its output, so it can start part-way
// through a secret that the redactors would no longer recognise. Drop that leading fragment first.
const DETAIL_TAIL_CHARS = 500;
function redactDetail(text, secretValues) {
  let s = String(text || "");
  if (s.length >= DETAIL_TAIL_CHARS) s = s.replace(/^\S*\s?/, "");
  return secretRedact(redactKnownSecrets(s, secretValues));
}

function knownSecrets(root) {
  try { return resolveKnownSecretValues(root); } catch { return []; }
}

// Write progress atomically: a temp file created O_EXCL in the checked directory, then rename.
function writeProgress(root, progress, secretValues) {
  checkProgressDir(root, { create: true });
  ensureProgressIgnored(root);
  const body = {
    ...progress,
    done: progress.done.map((u) => ({ ...u, detail: u.status === "pass" ? "" : redactDetail(u.detail, secretValues) })),
  };
  const dir = progressDir(root);
  const tmp = path.join(dir, `${PROGRESS_FILE}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeSync(fd, JSON.stringify(body, null, 2) + "\n"); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, progressPath(root));
}

// Delete the progress file and any temp files beside it. Never follows a symlinked directory.
function clearProgress(root) {
  let present;
  try { present = checkProgressDir(root); } catch { return false; }
  if (!present) return false;
  const dir = progressDir(root);
  let removed = false;
  for (const name of fs.readdirSync(dir)) {
    if (name === PROGRESS_FILE || name.startsWith(`${PROGRESS_FILE}.tmp-`)) {
      try { fs.unlinkSync(path.join(dir, name)); removed = true; } catch { /* already gone */ }
    }
  }
  return removed;
}

// The budget the call runs under: the flag, else (with --resume) the config value, else none.
function graceSecs(budgetSecs) {
  return Math.min(MAX_GRACE_SECS, budgetSecs);
}

module.exports = {
  DEFAULT_BUDGET_SECS, GatesProgressError, MAX_BUDGET_SECS, MAX_GRACE_SECS, PROGRESS_FILE, PROGRESS_SCHEMA, STALE_AFTER_MS,
  checkProgressDir, clearProgress, contentIds, ensureProgressIgnored, graceSecs, isGitWorkTree, judgeProgress, knownSecrets,
  parseStatusPaths, planFingerprint, progressPath, readProgress, redactDetail, treeFingerprint, validProgress, writeProgress,
};
