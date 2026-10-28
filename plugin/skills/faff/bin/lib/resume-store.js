// ===========================================================================
// === region:factory — resume-store — FAFF-1314: stash and restore a held build across run dirs ===
// A held graft build hands its per-issue run state to the next drain through the resume store
// `<store-root>/<ISSUE>/`. This module owns the layout: what a hold carries (every top-level
// `*.json` plus `review-rounds/` and `build-review/`), the hold record `hold.json`, and the proof
// that a restored dialogue resumes at the round its record names. Graft decides when to hold and
// what to do on a refusal; it never copies the store by hand.
//
// Every subcommand takes the per-issue lock (an exclusive mkdir of `.<ISSUE>.stage`) and repairs
// a torn publish (`.<ISSUE>.old` with no `<ISSUE>`) before reading the store.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseArgs, usageError } = require("./argv");
const { nextRoundNumber } = require("./spec-review-window");

const HOLD_CAUSES = ["review-outage", "build-review-dialogue"];
const ISSUE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const STALE_LOCK_MS = 10 * 60 * 1000;
const HOLD_RECORD = "hold.json";
const PREP_HOLD = "spec-review-hold.json";
const LOCK_FILE = ".lock";
const CARRIED_DIRS = ["review-rounds", "build-review"];
const JUDGE_LEDGER = path.join("build-review", "judge", "ledger.json");
const STAGES = ["dialogue", "judge"];
const LEGACY_RECORD = Object.freeze({ cause: "review-outage", legacy: true });

const EXIT = { ok: 0, refused: 1, fault: 2, noStore: 3, busy: 4 };

const USAGE = [
  "usage: faff resume-store stash --run-dir <dir> --issue <id> --cause <review-outage|build-review-dialogue>",
  "                               [--fix-rounds-used N --rebuttal-rounds-used N] [--store-root <dir>]",
  "       faff resume-store restore --run-dir <dir> --issue <id> [--store-root <dir>]",
  "       faff resume-store read --issue <id> [--store-root <dir>]",
  "       faff resume-store --selftest",
].join("\n");

const SPECS = {
  stash: { flags: { "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--cause": { arity: 1 }, "--fix-rounds-used": { arity: 1 }, "--rebuttal-rounds-used": { arity: 1 }, "--store-root": { arity: 1 } } },
  restore: { flags: { "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--store-root": { arity: 1 } } },
  read: { flags: { "--issue": { arity: 1 }, "--store-root": { arity: 1 } } },
};

class Refusal extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const refuse = (message) => { throw new Refusal(EXIT.refused, message); };
const fault = (message) => { throw new Refusal(EXIT.fault, message); };

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

const isDir = (p) => { const st = lstatOrNull(p); return !!st && st.isDirectory(); };

const stagePath = (storeRoot, issue) => path.join(storeRoot, `.${issue}.stage`);
const oldPath = (storeRoot, issue) => path.join(storeRoot, `.${issue}.old`);

// ---------------------------------------------------------------------------
// Issue lock and torn-swap recovery
// ---------------------------------------------------------------------------

function takeLock(storeRoot, issue, nowMs = Date.now()) {
  const stage = stagePath(storeRoot, issue);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(stage);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const st = lstatOrNull(stage);
      if (attempt === 0 && (!st || nowMs - st.mtimeMs > STALE_LOCK_MS)) {
        fs.rmSync(stage, { recursive: true, force: true });
        continue;
      }
      return null;
    }
    const nonce = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(path.join(stage, LOCK_FILE), nonce, { flag: "wx" });
    return { stage, nonce };
  }
  return null;
}

function ownsLock(lock) {
  try { return fs.readFileSync(path.join(lock.stage, LOCK_FILE), "utf8") === lock.nonce; } catch { return false; }
}

function releaseLock(lock) {
  if (lock && ownsLock(lock)) fs.rmSync(lock.stage, { recursive: true, force: true });
}

function recover(storeRoot, issue) {
  const dst = path.join(storeRoot, issue);
  const old = oldPath(storeRoot, issue);
  if (!lstatOrNull(old)) return;
  if (lstatOrNull(dst)) fs.rmSync(old, { recursive: true, force: true });
  else fs.renameSync(old, dst);
}

// ---------------------------------------------------------------------------
// Copying: regular files and directories only, mode and timestamps kept, symlinks skipped
// ---------------------------------------------------------------------------

function keepStat(dst, st) {
  fs.chmodSync(dst, st.mode & 0o7777);
  fs.utimesSync(dst, st.atimeMs / 1000, st.mtimeMs / 1000);
}

function copyEntry(src, dst) {
  const st = fs.lstatSync(src);
  if (st.isFile()) {
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
    keepStat(dst, st);
  } else if (st.isDirectory()) {
    fs.mkdirSync(dst);
    for (const name of fs.readdirSync(src).sort()) copyEntry(path.join(src, name), path.join(dst, name));
    keepStat(dst, st);
  }
}

function carriedTopLevel(dir) {
  return fs.readdirSync(dir).sort().filter((name) => {
    if (!name.endsWith(".json") || name === HOLD_RECORD || name === PREP_HOLD) return false;
    const st = fs.lstatSync(path.join(dir, name));
    return st.isFile();
  });
}

function copyCarriedSet(from, into) {
  for (const name of carriedTopLevel(from)) copyEntry(path.join(from, name), path.join(into, name));
  for (const folder of CARRIED_DIRS) {
    if (isDir(path.join(from, folder))) copyEntry(path.join(from, folder), path.join(into, folder));
  }
}

function listFiles(dir, prefix = "") {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = fs.lstatSync(path.join(dir, name));
    if (st.isDirectory()) out.push(...listFiles(path.join(dir, name), rel));
    else if (st.isFile()) out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The hold record
// ---------------------------------------------------------------------------

const isCount = (v, min = 0) => Number.isInteger(v) && v >= min;

function holdRecordProblem(rec, issue) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return "not a JSON object";
  if (rec.schema_version !== 1) return "schema_version is not 1";
  if (rec.issue !== issue) return `issue is not ${issue}`;
  if (!HOLD_CAUSES.includes(rec.cause)) return `cause ${JSON.stringify(rec.cause)} is not a hold cause`;
  if (typeof rec.stashed_at !== "string") return "stashed_at is not a string";
  if (!Array.isArray(rec.carried) || !rec.carried.every((p) => typeof p === "string")) return "carried is not a list of paths";
  // A stage lives inside the dialogue object. One outside it would restore as a legacy dialogue hold
  // and skip the judge-ledger proof.
  if (rec.stage !== undefined) return "stage is outside the dialogue object";
  if (rec.dialogue !== undefined) {
    const d = rec.dialogue;
    if (!d || typeof d !== "object") return "dialogue is not an object";
    if (!isCount(d.hold_count) || !isCount(d.next_round, 2) || !isCount(d.fix_rounds_used) || !isCount(d.rebuttal_rounds_used)) {
      return "dialogue counters are out of shape";
    }
    if (d.stage !== undefined && !STAGES.includes(d.stage)) return `dialogue stage ${JSON.stringify(d.stage)} is not dialogue or judge`;
  }
  return null;
}

// "judge" exactly when the judge ledger is a regular file (a directory or symlink reads as dialogue).
function stageOf(issueDir) {
  const st = lstatOrNull(path.join(issueDir, JUDGE_LEDGER));
  return st && st.isFile() ? "judge" : "dialogue";
}

// readHoldRecord(storeDir, issue) -> record | null (absent); throws a fault when unreadable or out of shape.
function readHoldRecord(storeDir, issue) {
  const file = path.join(storeDir, HOLD_RECORD);
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return null; fault(`${file} is unreadable (${e.code})`); }
  let rec;
  try { rec = JSON.parse(text); } catch { fault(`${file} is not valid JSON`); }
  const problem = holdRecordProblem(rec, issue);
  if (problem) fault(`${file} is out of shape: ${problem}`);
  return rec;
}

// ---------------------------------------------------------------------------
// Subcommands. Each returns { code, record?, message? }; the CLI wrapper prints.
// ---------------------------------------------------------------------------

function parseCount(raw, flag) {
  if (raw == null) return null;
  if (!/^\d+$/.test(raw)) fault(`${flag} must be an integer >= 0`);
  return parseInt(raw, 10);
}

function underLock(storeRoot, issue, body) {
  const lock = takeLock(storeRoot, issue);
  if (!lock) return { code: EXIT.busy, message: `${stagePath(storeRoot, issue)} is held by another resume-store call` };
  try {
    recover(storeRoot, issue);
    return body(lock);
  } finally {
    releaseLock(lock);
  }
}

function stash({ runDir, issue, cause, fixRoundsUsed, rebuttalRoundsUsed, storeRoot, beforePublish }) {
  const src = path.join(runDir, issue);
  const dst = path.join(storeRoot, issue);
  if (!isDir(src)) fault(`no issue dir at ${src}`);
  const n = isDir(path.join(src, "build-review")) ? nextRoundNumber(path.join(src, "build-review")) : 1;
  if (cause === "build-review-dialogue" && n === 1) refuse("no dialogue rounds to resume");
  if (n > 1 && (fixRoundsUsed == null || rebuttalRoundsUsed == null)) {
    fault("build-review/ holds a round file, so --fix-rounds-used and --rebuttal-rounds-used are required");
  }
  fs.mkdirSync(storeRoot, { recursive: true });
  return underLock(storeRoot, issue, (lock) => {
    const prior = readHoldRecord(dst, issue);
    const priorHolds = prior && prior.dialogue ? prior.dialogue.hold_count : 0;
    copyCarriedSet(src, lock.stage);
    if (lstatOrNull(path.join(dst, PREP_HOLD))) copyEntry(path.join(dst, PREP_HOLD), path.join(lock.stage, PREP_HOLD));
    const record = {
      schema_version: 1,
      issue,
      cause,
      stashed_at: new Date().toISOString(),
      carried: listFiles(lock.stage).filter((p) => p !== HOLD_RECORD && p !== LOCK_FILE),
    };
    if (n > 1) {
      record.dialogue = {
        hold_count: priorHolds + (cause === "build-review-dialogue" ? 1 : 0),
        next_round: n,
        fix_rounds_used: fixRoundsUsed,
        rebuttal_rounds_used: rebuttalRoundsUsed,
        stage: stageOf(src),
      };
    }
    fs.writeFileSync(path.join(lock.stage, HOLD_RECORD), JSON.stringify(record, null, 2) + "\n");
    if (beforePublish) beforePublish(lock);
    if (!ownsLock(lock)) return { code: EXIT.busy, message: "the issue lock was taken over before publish" };
    const old = oldPath(storeRoot, issue);
    fs.rmSync(path.join(lock.stage, LOCK_FILE));
    try {
      if (lstatOrNull(dst)) fs.renameSync(dst, old);
      fs.renameSync(lock.stage, dst);
    } catch (e) {
      fs.rmSync(lock.stage, { recursive: true, force: true });
      throw e;
    }
    fs.rmSync(old, { recursive: true, force: true });
    return { code: EXIT.ok, record };
  });
}

function refuseOccupiedFolders(dst) {
  for (const folder of CARRIED_DIRS) {
    const p = path.join(dst, folder);
    const st = lstatOrNull(p);
    if (!st) continue;
    if (st.isSymbolicLink()) refuse(`run dir already has ${folder} (a symlink)`);
    if (!st.isDirectory() || fs.readdirSync(p).length) refuse(`run dir already has ${folder}`);
  }
}

function refuseDirectoryCollisions(rstage, dst) {
  for (const name of fs.readdirSync(rstage)) {
    if (CARRIED_DIRS.includes(name)) continue;
    const st = lstatOrNull(path.join(dst, name));
    if (st && st.isDirectory()) refuse(`run dir has a directory named ${name}`);
  }
}

function proveRounds(dir, rec, where) {
  if (rec.dialogue && nextRoundNumber(path.join(dir, "build-review")) !== rec.dialogue.next_round) {
    refuse(`${where} rounds and hold record disagree (hold record next_round ${rec.dialogue.next_round})`);
  }
}

function proveStage(dir, rec, where) {
  if (rec.dialogue && rec.dialogue.stage === "judge" && stageOf(dir) !== "judge") {
    refuse(`${where} judge-stage store without a judge ledger`);
  }
}

function restore({ runDir, issue, storeRoot, afterStageCopy }) {
  const src = path.join(storeRoot, issue);
  const dst = path.join(runDir, issue);
  if (!isDir(storeRoot)) return { code: EXIT.noStore, message: `no resume store at ${src}` };
  return underLock(storeRoot, issue, () => {
    if (!lstatOrNull(src)) return { code: EXIT.noStore, message: `no resume store at ${src}` };
    let rec = readHoldRecord(src, issue);
    if (!rec) {
      if (lstatOrNull(path.join(src, "build-review"))) refuse("dialogue store without a hold record");
      rec = LEGACY_RECORD;
    }
    proveRounds(src, rec, "stashed");
    proveStage(src, rec, "stashed");
    refuseOccupiedFolders(dst);
    const rstage = path.join(runDir, `.${issue}.restore`);
    fs.rmSync(rstage, { recursive: true, force: true });
    fs.mkdirSync(rstage, { recursive: true });
    try {
      copyCarriedSet(src, rstage);
      if (afterStageCopy) afterStageCopy(rstage);
      proveRounds(rstage, rec, "staged");
      proveStage(rstage, rec, "staged");
      refuseDirectoryCollisions(rstage, dst);
      fs.mkdirSync(dst, { recursive: true });
      for (const name of fs.readdirSync(rstage).sort()) fs.renameSync(path.join(rstage, name), path.join(dst, name));
    } finally {
      fs.rmSync(rstage, { recursive: true, force: true });
    }
    return { code: EXIT.ok, record: rec };
  });
}

function read({ issue, storeRoot }) {
  const src = path.join(storeRoot, issue);
  if (!isDir(storeRoot)) return { code: EXIT.noStore, message: `no resume store at ${src}` };
  return underLock(storeRoot, issue, () => {
    if (!lstatOrNull(src)) return { code: EXIT.noStore, message: `no resume store at ${src}` };
    return { code: EXIT.ok, record: readHoldRecord(src, issue) || LEGACY_RECORD };
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function runSubcommand(sub, values) {
  const issue = values["--issue"];
  if (issue == null) fault("--issue is required");
  if (!ISSUE_RE.test(issue)) fault(`--issue ${JSON.stringify(issue)} is not an issue id`);
  const storeRoot = path.resolve(values["--store-root"] || path.join(".faff", "resume"));
  if (sub === "read") return read({ issue, storeRoot });
  const runDir = values["--run-dir"];
  if (runDir == null) fault("--run-dir is required");
  if (sub === "restore") return restore({ runDir: path.resolve(runDir), issue, storeRoot });
  const cause = values["--cause"];
  if (!HOLD_CAUSES.includes(cause)) fault(`--cause must be one of ${HOLD_CAUSES.join(", ")}`);
  return stash({
    runDir: path.resolve(runDir),
    issue,
    cause,
    fixRoundsUsed: parseCount(values["--fix-rounds-used"], "--fix-rounds-used"),
    rebuttalRoundsUsed: parseCount(values["--rebuttal-rounds-used"], "--rebuttal-rounds-used"),
    storeRoot,
  });
}

function cmdResumeStore(args) {
  if (args.includes("--selftest")) return resumeStoreSelftest();
  const [sub, ...rest] = args;
  if (!SPECS[sub]) return usageError([{ code: "missing-value", detail: "subcommand must be stash, restore or read" }], USAGE);
  const { values, errors, positionals } = parseArgs(rest, SPECS[sub]);
  if (errors.length) return usageError(errors, USAGE);
  if (positionals.length) return usageError([{ code: "too-many-positionals", detail: `unexpected argument ${positionals[0]}` }], USAGE);
  let result;
  try {
    result = runSubcommand(sub, values);
  } catch (e) {
    result = e instanceof Refusal ? { code: e.code, message: e.message } : { code: EXIT.fault, message: `I/O fault: ${e.message}` };
  }
  if (result.record) process.stdout.write(JSON.stringify(result.record) + "\n");
  if (result.message) process.stderr.write(`faff resume-store ${sub}: ${result.message}\n`);
  return result.code;
}

// ---------------------------------------------------------------------------
// Selftest: the copy keeps mode and mtime on this Node, and a lock taken over mid-stash is busy.
// ---------------------------------------------------------------------------

function resumeStoreSelftest() {
  const os = require("node:os");
  let fail = 0;
  const ok = (name, cond) => { console.log(`${cond ? "ok  " : "FAIL"} ${name}`); if (!cond) fail++; };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-resume-store-"));
  const attempt = (fn) => { try { return fn(); } catch (e) { return { code: e.code, message: e.message }; } };
  try {
    const runDir = path.join(tmp, "run");
    const storeRoot = path.join(tmp, "store");
    const issueDir = path.join(runDir, "FAFF-9");
    fs.mkdirSync(path.join(issueDir, "build-review", "judge"), { recursive: true });
    fs.writeFileSync(path.join(issueDir, "build-progress.json"), "{}");
    fs.writeFileSync(path.join(issueDir, "build-review", "round-1.json"), "{}");
    fs.writeFileSync(path.join(issueDir, "build-review", "round-2.json"), "{}");
    const ledger = path.join(issueDir, "build-review", "judge", "ledger.json");
    fs.writeFileSync(ledger, "{}", { mode: 0o600 });
    fs.chmodSync(ledger, 0o600);
    const past = new Date("2026-01-02T03:04:05Z");
    fs.utimesSync(ledger, past, past);
    fs.symlinkSync("/etc/hostname", path.join(issueDir, "linked.json"));

    const base = { runDir, issue: "FAFF-9", cause: "build-review-dialogue", fixRoundsUsed: 1, rebuttalRoundsUsed: 0, storeRoot };
    const taken = attempt(() => stash({ ...base, beforePublish: (lock) => fs.writeFileSync(path.join(lock.stage, LOCK_FILE), "someone-else") }));
    ok("a lock taken over before publish exits 4 and publishes nothing", taken.code === EXIT.busy && !lstatOrNull(path.join(storeRoot, "FAFF-9")));
    fs.rmSync(stagePath(storeRoot, "FAFF-9"), { recursive: true, force: true });

    const first = attempt(() => stash(base));
    ok("dialogue stash writes next_round 3 and hold_count 1", first.code === EXIT.ok && first.record.dialogue.next_round === 3 && first.record.dialogue.hold_count === 1);
    ok("symlinks are skipped", !first.record.carried.includes("linked.json"));
    ok("a stash that finds the judge ledger records stage judge", first.record.dialogue.stage === "judge");

    const fresh = path.join(tmp, "fresh");
    const back = attempt(() => restore({ runDir: fresh, issue: "FAFF-9", storeRoot }));
    const restored = lstatOrNull(path.join(fresh, "FAFF-9", "build-review", "judge", "ledger.json"));
    ok("restore exits 0", back.code === EXIT.ok);
    ok("a 0600 judge file stays 0600", !!restored && (restored.mode & 0o777) === 0o600);
    ok("mtime survives stash and restore", !!restored && Math.abs(restored.mtimeMs - past.getTime()) < 1);
    ok("restored build-review numbers on at round 3", nextRoundNumber(path.join(fresh, "FAFF-9", "build-review")) === 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (resume-store, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  EXIT,
  HOLD_CAUSES,
  cmdResumeStore,
  read,
  recover,
  restore,
  resumeStoreSelftest,
  stash,
  takeLock,
};
