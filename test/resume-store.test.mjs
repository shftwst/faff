// FAFF-1314 — faff resume-store: a held build's per-issue state survives into a fresh run dir,
// so a build-review dialogue held at round 2 resumes at round 3 with its counters.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const rs = require("../plugin/skills/faff/bin/lib/resume-store.js");

const ISSUE = "FAFF-9";

function withTmp(fn) {
  const tmp = fs.mkdtempSync(join(tmpdir(), "faff-resume-store-"));
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function write(file, body, mode) {
  fs.mkdirSync(join(file, ".."), { recursive: true });
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  if (mode) fs.chmodSync(file, mode);
}

// Every entry under dir with its kind, mode and bytes: two equal snapshots mean nothing changed.
function snapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  const out = {};
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) out[r] = `link:${fs.readlinkSync(p)}`;
      else if (st.isDirectory()) { out[r] = `dir:${st.mode & 0o777}`; walk(p, r); }
      else out[r] = `file:${st.mode & 0o777}:${fs.readFileSync(p, "utf8")}`;
    }
  };
  walk(dir, "");
  return out;
}

function dialogueRun(runDir, rounds = 2) {
  const d = join(runDir, ISSUE);
  write(join(d, "build-progress.json"), { build_complete: true });
  write(join(d, "ac-checklist.json"), { all_verified: true });
  write(join(d, "review-progress.json"), { outage_retries: 0 });
  for (let n = 1; n <= rounds; n++) write(join(d, "build-review", `round-${n}.json`), { signal: "fail", findings: [], author_replies: [] });
  write(join(d, "build-review", "judge", "ledger.json"), {}, 0o600);
  write(join(d, "review-rounds", "round-1.json"), { round: 1 });
  return d;
}

const stashArgs = (runDir, store, cause = "build-review-dialogue", counters = ["--fix-rounds-used", "1", "--rebuttal-rounds-used", "1"]) =>
  ["resume-store", "stash", "--run-dir", runDir, "--issue", ISSUE, "--cause", cause, ...counters, "--store-root", store];
const restoreArgs = (runDir, store) => ["resume-store", "restore", "--run-dir", runDir, "--issue", ISSUE, "--store-root", store];
const readArgs = (store) => ["resume-store", "read", "--issue", ISSUE, "--store-root", store];

function ok(r) {
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("a dialogue held at round 2 and restored into a fresh run dir resumes at round 3", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const b = join(tmp, "B");
  const store = join(tmp, "store");
  dialogueRun(a);
  const held = ok(runCli(stashArgs(a, store)));
  assert.deepEqual(held.dialogue, { hold_count: 1, next_round: 3, fix_rounds_used: 1, rebuttal_rounds_used: 1, stage: "judge" });
  fs.mkdirSync(b);
  const back = ok(runCli(restoreArgs(b, store)));
  assert.equal(back.dialogue.next_round, 3);
  assert.equal(back.dialogue.hold_count, 1);
  const next = runCli(["spec-review-window", "--next-round", "--dir", join(b, ISSUE, "build-review")]);
  assert.equal(next.stdout.trim(), "3");
  assert.ok(fs.existsSync(join(b, ISSUE, "ac-checklist.json")));
  assert.equal(fs.statSync(join(b, ISSUE, "build-review", "judge", "ledger.json")).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(join(b, ISSUE, "hold.json")), "the hold record stays in the store");
}));

test("the hold record names schema, issue, cause and every carried file, sorted", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const store = join(tmp, "store");
  dialogueRun(a);
  write(join(a, ISSUE, "notes.txt"), "not json");
  fs.symlinkSync(join(a, ISSUE, "ac-checklist.json"), join(a, ISSUE, "linked.json"));
  write(join(a, ISSUE, "hold.json"), { stray: true });
  const rec = ok(runCli(stashArgs(a, store)));
  assert.deepEqual(Object.keys(rec), ["schema_version", "issue", "cause", "stashed_at", "carried", "dialogue"]);
  assert.equal(rec.schema_version, 1);
  assert.equal(rec.issue, ISSUE);
  assert.equal(rec.cause, "build-review-dialogue");
  assert.ok(!Number.isNaN(Date.parse(rec.stashed_at)));
  assert.deepEqual(rec.carried, [
    "ac-checklist.json",
    "build-progress.json",
    "build-review/judge/ledger.json",
    "build-review/round-1.json",
    "build-review/round-2.json",
    "review-progress.json",
    "review-rounds/round-1.json",
  ]);
  const inStore = Object.keys(snapshot(join(store, ISSUE))).filter((p) => !snapshot(join(store, ISSUE))[p].startsWith("dir:"));
  assert.deepEqual(inStore.filter((p) => p !== "hold.json"), rec.carried);
  assert.deepEqual(JSON.parse(fs.readFileSync(join(store, ISSUE, "hold.json"), "utf8")), rec);
}));

test("a second hold after a restore carries rounds 1 to 3, next_round 4 and hold_count 2", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const b = join(tmp, "B");
  const store = join(tmp, "store");
  dialogueRun(a);
  ok(runCli(stashArgs(a, store)));
  ok(runCli(restoreArgs(b, store)));
  write(join(b, ISSUE, "build-review", "round-3.json"), { signal: "fail" });
  const rec = ok(runCli(stashArgs(b, store)));
  assert.equal(rec.dialogue.hold_count, 2);
  assert.equal(rec.dialogue.next_round, 4);
  assert.deepEqual(fs.readdirSync(join(store, ISSUE, "build-review")).filter((n) => n.startsWith("round-")).sort(), ["round-1.json", "round-2.json", "round-3.json"]);
}));

test("dialogue, outage, then dialogue holds count 1, 1, 2", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const store = join(tmp, "store");
  dialogueRun(a);
  const counts = ["build-review-dialogue", "review-outage", "build-review-dialogue"].map((cause) => ok(runCli(stashArgs(a, store, cause))).dialogue.hold_count);
  assert.deepEqual(counts, [1, 1, 2]);
}));

test("a review-outage round trip keeps outage_retries and review-rounds and prints no dialogue", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const b = join(tmp, "B");
  const store = join(tmp, "store");
  write(join(a, ISSUE, "build-progress.json"), { build_complete: true });
  write(join(a, ISSUE, "review-progress.json"), { outage_retries: 1 });
  write(join(a, ISSUE, "review-rounds", "round-1.json"), { round: 1 });
  const held = ok(runCli(stashArgs(a, store, "review-outage", [])));
  assert.equal(held.dialogue, undefined);
  const back = ok(runCli(restoreArgs(b, store)));
  assert.equal(back.cause, "review-outage");
  assert.equal(back.dialogue, undefined);
  assert.equal(JSON.parse(fs.readFileSync(join(b, ISSUE, "review-progress.json"), "utf8")).outage_retries, 1);
  assert.ok(fs.existsSync(join(b, ISSUE, "review-rounds", "round-1.json")));
}));

test("a store written by the old prose restores as the legacy review-outage shape", () => withTmp((tmp) => {
  const b = join(tmp, "B");
  const store = join(tmp, "store");
  write(join(store, ISSUE, "build-progress.json"), { build_complete: true });
  write(join(store, ISSUE, "review-rounds", "round-1.json"), { round: 1 });
  assert.deepEqual(ok(runCli(restoreArgs(b, store))), { cause: "review-outage", legacy: true });
  assert.deepEqual(ok(runCli(readArgs(store))), { cause: "review-outage", legacy: true });
  assert.ok(fs.existsSync(join(b, ISSUE, "build-progress.json")));
  assert.ok(fs.existsSync(join(b, ISSUE, "review-rounds", "round-1.json")));
}));

test("restore refuses with the run dir unchanged when rounds and the hold record disagree", () => withTmp((tmp) => {
  const b = join(tmp, "B");
  const store = join(tmp, "store");
  write(join(store, ISSUE, "build-review", "round-1.json"), {});
  write(join(store, ISSUE, "hold.json"), { schema_version: 1, issue: ISSUE, cause: "build-review-dialogue", stashed_at: "2026-10-17T00:00:00Z", carried: ["build-review/round-1.json"], dialogue: { hold_count: 1, next_round: 3, fix_rounds_used: 0, rebuttal_rounds_used: 0 } });
  write(join(b, ISSUE, "build-progress.json"), "older");
  const before = snapshot(b);
  const r = runCli(restoreArgs(b, store));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /disagree/);
  assert.deepEqual(snapshot(b), before);
}));

test("restore refuses with the run dir unchanged on an occupied or symlinked round folder, or a dialogue store without a hold record", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const store = join(tmp, "store");
  dialogueRun(a);
  ok(runCli(stashArgs(a, store)));
  const cases = {
    "non-empty review-rounds": (d) => write(join(d, "review-rounds", "round-9.json"), {}),
    "non-empty build-review": (d) => write(join(d, "build-review", "round-9.json"), {}),
    "symlinked build-review": (d) => { fs.mkdirSync(join(tmp, "elsewhere"), { recursive: true }); fs.symlinkSync(join(tmp, "elsewhere"), join(d, "build-review")); },
    "symlinked review-rounds": (d) => { fs.mkdirSync(join(tmp, "elsewhere"), { recursive: true }); fs.symlinkSync(join(tmp, "elsewhere"), join(d, "review-rounds")); },
    "directory named like a carried file": (d) => fs.mkdirSync(join(d, "ac-checklist.json", "inner"), { recursive: true }),
  };
  for (const [name, arrange] of Object.entries(cases)) {
    const b = join(tmp, name.replace(/ /g, "-"));
    write(join(b, ISSUE, "build-progress.json"), "older");
    arrange(join(b, ISSUE));
    const before = snapshot(b);
    const r = runCli(restoreArgs(b, store));
    assert.equal(r.code, 1, name);
    assert.deepEqual(snapshot(b), before, name);
  }
  fs.rmSync(join(store, ISSUE, "hold.json"));
  const b = join(tmp, "no-record");
  write(join(b, ISSUE, "build-progress.json"), "older");
  const before = snapshot(b);
  const r = runCli(restoreArgs(b, store));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /without a hold record/);
  assert.deepEqual(snapshot(b), before);
}));

test("restore refuses with the run dir unchanged when the staged round check fails", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const b = join(tmp, "B");
  const storeRoot = join(tmp, "store");
  dialogueRun(a);
  ok(runCli(stashArgs(a, storeRoot)));
  write(join(b, ISSUE, "build-progress.json"), "older");
  const before = snapshot(b);
  assert.throws(
    () => rs.restore({ runDir: b, issue: ISSUE, storeRoot, afterStageCopy: (rstage) => fs.rmSync(join(rstage, "build-review", "round-2.json")) }),
    (e) => e.code === rs.EXIT.refused && /staged rounds/.test(e.message),
  );
  assert.deepEqual(snapshot(b), before);
  assert.ok(!fs.existsSync(join(storeRoot, `.${ISSUE}.stage`)), "the lock is released");
}));

test("stash refuses a dialogue hold with no rounds, and needs both counters once rounds exist", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const store = join(tmp, "store");
  write(join(a, ISSUE, "build-progress.json"), {});
  const none = runCli(stashArgs(a, store, "build-review-dialogue", []));
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no dialogue rounds/);
  dialogueRun(a);
  assert.equal(runCli(stashArgs(a, store, "build-review-dialogue", ["--fix-rounds-used", "1"])).code, 2);
  assert.equal(runCli(stashArgs(a, store, "review-outage", [])).code, 2);
  assert.equal(runCli(stashArgs(a, store, "build-review-dialogue", ["--fix-rounds-used", "-1", "--rebuttal-rounds-used", "0"])).code, 2);
  assert.ok(!fs.existsSync(join(store, ISSUE)));
  assert.equal(runCli(stashArgs(join(tmp, "missing"), store, "review-outage", [])).code, 2);
  const linked = join(tmp, "L");
  write(join(linked, ISSUE, "build-progress.json"), {});
  fs.symlinkSync(join(a, ISSUE, "build-review"), join(linked, ISSUE, "build-review"));
  assert.equal(runCli(stashArgs(linked, store, "build-review-dialogue")).code, 1, "a symlinked build-review is not carried, so it holds no rounds");
}));

test("an --issue that is not an issue id exits 2 before touching the filesystem", () => withTmp((tmp) => {
  const store = join(tmp, "store");
  for (const bad of ["../x", ".hidden", "a/b", ""]) {
    for (const args of [
      ["resume-store", "stash", "--run-dir", tmp, "--issue", bad, "--cause", "review-outage", "--store-root", store],
      ["resume-store", "restore", "--run-dir", tmp, "--issue", bad, "--store-root", store],
      ["resume-store", "read", "--issue", bad, "--store-root", store],
    ]) {
      assert.equal(runCli(args).code, 2, `${args[1]} ${JSON.stringify(bad)}`);
    }
  }
  assert.ok(!fs.existsSync(store));
}));

test("an unknown --cause, or a stored hold record with one, exits 2", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const store = join(tmp, "store");
  dialogueRun(a);
  assert.equal(runCli(stashArgs(a, store, "nap")).code, 2);
  write(join(store, ISSUE, "hold.json"), { schema_version: 1, issue: ISSUE, cause: "nap", stashed_at: "x", carried: [] });
  assert.equal(runCli(restoreArgs(join(tmp, "B"), store)).code, 2);
  assert.equal(runCli(readArgs(store)).code, 2);
  assert.equal(runCli(stashArgs(a, store)).code, 2, "a corrupt prior record is never read as zero holds");
}));

test("restore and read exit 3 when there is no store", () => withTmp((tmp) => {
  const store = join(tmp, "store");
  assert.equal(runCli(restoreArgs(join(tmp, "B"), store)).code, 3);
  assert.equal(runCli(readArgs(store)).code, 3);
  fs.mkdirSync(store);
  assert.equal(runCli(restoreArgs(join(tmp, "B"), store)).code, 3);
  assert.equal(runCli(readArgs(store)).code, 3);
  assert.deepEqual(fs.readdirSync(store), [], "no stage is left behind");
}));

test("the first stash in a repo creates the store root", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  dialogueRun(a);
  const store = join(tmp, "repo", ".faff", "resume");
  ok(runCli(stashArgs(a, store)));
  assert.deepEqual(fs.readdirSync(store), [ISSUE]);
}));

test("a fresh issue lock makes every subcommand exit 4 and leaves the store and stage untouched", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const store = join(tmp, "store");
  dialogueRun(a);
  ok(runCli(stashArgs(a, store)));
  write(join(store, `.${ISSUE}.stage`, ".lock"), "someone");
  const before = snapshot(store);
  for (const args of [stashArgs(a, store), restoreArgs(join(tmp, "B"), store), readArgs(store)]) {
    assert.equal(runCli(args).code, 4, args[1]);
  }
  assert.deepEqual(snapshot(store), before);
  assert.ok(!fs.existsSync(join(tmp, "B", ISSUE)));
}));

test("a stale lock is cleared without touching .old, and restore and read leave no stage", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const store = join(tmp, "store");
  dialogueRun(a);
  ok(runCli(stashArgs(a, store)));
  const stage = join(store, `.${ISSUE}.stage`);
  const stale = () => {
    write(join(stage, ".lock"), "crashed");
    const then = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(stage, then, then);
  };
  stale();
  ok(runCli(readArgs(store)));
  assert.ok(!fs.existsSync(stage));
  stale();
  ok(runCli(restoreArgs(join(tmp, "B"), store)));
  assert.ok(!fs.existsSync(stage));
  stale();
  write(join(store, `.${ISSUE}.old`, "marker.json"), "old");
  assert.ok(rs.takeLock(store, ISSUE), "a stale stage is taken over");
  assert.ok(fs.existsSync(join(store, `.${ISSUE}.old`, "marker.json")), ".old is not touched by the lock");
}));

test("a torn publish is repaired before a stash reads the prior hold count", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const store = join(tmp, "store");
  dialogueRun(a);
  ok(runCli(stashArgs(a, store)));
  fs.renameSync(join(store, ISSUE), join(store, `.${ISSUE}.old`));
  const rec = ok(runCli(stashArgs(a, store)));
  assert.equal(rec.dialogue.hold_count, 2);
  assert.ok(!fs.existsSync(join(store, `.${ISSUE}.old`)));
  fs.renameSync(join(store, ISSUE), join(store, `.${ISSUE}.old`));
  assert.equal(ok(runCli(readArgs(store))).dialogue.hold_count, 2, "read repairs it too");
  fs.renameSync(join(store, ISSUE), join(store, `.${ISSUE}.old`));
  assert.equal(ok(runCli(restoreArgs(join(tmp, "B"), store))).dialogue.hold_count, 2, "and restore");
}));

test("prep's spec-review-hold.json is byte-identical through stash and restore and never restored", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const b = join(tmp, "B");
  const store = join(tmp, "store");
  dialogueRun(a);
  const prepHold = join(store, ISSUE, "spec-review-hold.json");
  write(prepHold, '{"held": "by prep"}\n', 0o640);
  write(join(a, ISSUE, "spec-review-hold.json"), "run-dir copy");
  const before = fs.readFileSync(prepHold);
  ok(runCli(stashArgs(a, store)));
  assert.deepEqual(fs.readFileSync(prepHold), before);
  ok(runCli(restoreArgs(b, store)));
  assert.deepEqual(fs.readFileSync(prepHold), before);
  assert.ok(!fs.existsSync(join(b, ISSUE, "spec-review-hold.json")));
}));

test("copies keep mtimes, so holdout.json stays newer than build-progress.json", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const b = join(tmp, "B");
  const store = join(tmp, "store");
  dialogueRun(a);
  write(join(a, ISSUE, "holdout.json"), {});
  fs.utimesSync(join(a, ISSUE, "build-progress.json"), new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
  fs.utimesSync(join(a, ISSUE, "holdout.json"), new Date("2026-01-01T00:00:05Z"), new Date("2026-01-01T00:00:05Z"));
  ok(runCli(stashArgs(a, store)));
  ok(runCli(restoreArgs(b, store)));
  const mtime = (n) => fs.statSync(join(b, ISSUE, n)).mtimeMs;
  assert.equal(mtime("build-progress.json"), Date.parse("2026-01-01T00:00:00Z"));
  assert.equal(mtime("holdout.json"), Date.parse("2026-01-01T00:00:05Z"));
}));

// FAFF-1249 — the hold record states whether the build judge was mid-assemble.
const holdRecord = (dialogue, extra = {}) => ({ schema_version: 1, issue: ISSUE, cause: "build-review-dialogue", stashed_at: "2026-10-27T00:00:00Z", carried: ["build-review/round-1.json", "build-review/round-2.json"], dialogue, ...extra });
const dialogueOf = (extra = {}) => ({ hold_count: 1, next_round: 3, fix_rounds_used: 0, rebuttal_rounds_used: 0, ...extra });

// A store with two rounds and a hold record, plus optionally a judge ledger.
function handStore(store, rec, { ledger = false } = {}) {
  write(join(store, ISSUE, "build-review", "round-1.json"), {});
  write(join(store, ISSUE, "build-review", "round-2.json"), {});
  if (ledger) write(join(store, ISSUE, "build-review", "judge", "ledger.json"), {}, 0o600);
  write(join(store, ISSUE, "hold.json"), rec);
}

test("stash records stage judge when the judge ledger is a regular file, for either cause", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const store = join(tmp, "store");
  dialogueRun(a);
  const held = ok(runCli(stashArgs(a, store)));
  assert.equal(held.dialogue.stage, "judge");
  assert.equal(held.dialogue.next_round, 3);
  assert.equal(held.dialogue.hold_count, 1);
  assert.equal(ok(runCli(readArgs(store))).dialogue.stage, "judge", "read prints the record unchanged");
  const outage = ok(runCli(stashArgs(a, store, "review-outage")));
  assert.equal(outage.dialogue.stage, "judge");
}));

test("stash records stage dialogue when the judge ledger is absent, a directory or a symlink", () => withTmp((tmp) => {
  const store = join(tmp, "store");
  const absent = join(tmp, "absent");
  dialogueRun(absent);
  fs.rmSync(join(absent, ISSUE, "build-review", "judge"), { recursive: true });
  assert.equal(ok(runCli(stashArgs(absent, store))).dialogue.stage, "dialogue");

  const asDir = join(tmp, "dir");
  dialogueRun(asDir);
  fs.rmSync(join(asDir, ISSUE, "build-review", "judge", "ledger.json"));
  fs.mkdirSync(join(asDir, ISSUE, "build-review", "judge", "ledger.json"));
  assert.equal(ok(runCli(stashArgs(asDir, store))).dialogue.stage, "dialogue");

  const linked = join(tmp, "link");
  dialogueRun(linked);
  const ledger = join(linked, ISSUE, "build-review", "judge", "ledger.json");
  fs.rmSync(ledger);
  write(join(tmp, "elsewhere.json"), {});
  fs.symlinkSync(join(tmp, "elsewhere.json"), ledger);
  assert.equal(ok(runCli(stashArgs(linked, store))).dialogue.stage, "dialogue", "a symlinked ledger is not followed");
}));

test("a stash with no round files carries no dialogue and so no stage, whatever judge/ holds", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const store = join(tmp, "store");
  write(join(a, ISSUE, "build-progress.json"), {});
  write(join(a, ISSUE, "build-review", "judge", "ledger.json"), {});
  const held = ok(runCli(stashArgs(a, store, "review-outage", [])));
  assert.equal(held.dialogue, undefined);
  assert.equal(held.stage, undefined);
}));

test("stash takes no stage flag", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  dialogueRun(a);
  assert.equal(runCli([...stashArgs(a, join(tmp, "store")), "--stage", "judge"]).code, 2);
}));

test("a legacy hold record without stage reads and restores as before", () => withTmp((tmp) => {
  const store = join(tmp, "store");
  const b = join(tmp, "B");
  handStore(store, holdRecord(dialogueOf()));
  assert.equal(ok(runCli(readArgs(store))).dialogue.stage, undefined);
  const back = ok(runCli(restoreArgs(b, store)));
  assert.equal(back.dialogue.stage, undefined);
  assert.ok(fs.existsSync(join(b, ISSUE, "build-review", "round-2.json")));
}));

test("a hold record whose stage is not dialogue or judge exits 2 on read and restore, leaving the run dir unchanged", () => withTmp((tmp) => {
  const store = join(tmp, "store");
  const b = join(tmp, "B");
  handStore(store, holdRecord(dialogueOf({ stage: "adjudication" })), { ledger: true });
  write(join(b, ISSUE, "build-progress.json"), "older");
  const before = snapshot(b);
  assert.equal(runCli(readArgs(store)).code, 2);
  const r = runCli(restoreArgs(b, store));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /stage/);
  assert.deepEqual(snapshot(b), before);
}));

test("a hold record with a stage outside a dialogue object exits 2 on read and restore, leaving the run dir unchanged", () => withTmp((tmp) => {
  const b = join(tmp, "B");
  for (const [name, rec] of Object.entries({
    "top-level stage beside a dialogue": holdRecord(dialogueOf(), { stage: "judge" }),
    "stage with no dialogue": holdRecord(undefined, { stage: "judge" }),
  })) {
    const store = join(tmp, name.replace(/ /g, "-"));
    handStore(store, rec, { ledger: true });
    write(join(b, ISSUE, "build-progress.json"), "older");
    const before = snapshot(b);
    assert.equal(runCli(readArgs(store)).code, 2, name);
    assert.equal(runCli(restoreArgs(b, store)).code, 2, name);
    assert.deepEqual(snapshot(b), before, name);
  }
}));

test("restore of a judge-stage record refuses with the run dir unchanged when the stashed store has no judge ledger", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const b = join(tmp, "B");
  const store = join(tmp, "store");
  dialogueRun(a);
  ok(runCli(stashArgs(a, store)));
  fs.rmSync(join(store, ISSUE, "build-review", "judge", "ledger.json"));
  write(join(b, ISSUE, "build-progress.json"), "older");
  const before = snapshot(b);
  const r = runCli(restoreArgs(b, store));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /stashed judge-stage store without a judge ledger/);
  assert.deepEqual(snapshot(b), before);
  assert.ok(!fs.existsSync(join(b, ISSUE, "build-review")));
}));

test("restore of a judge-stage record refuses with the run dir unchanged when the staged copy has no judge ledger", () => withTmp((tmp) => {
  const a = join(tmp, "A");
  const b = join(tmp, "B");
  const storeRoot = join(tmp, "store");
  dialogueRun(a);
  ok(runCli(stashArgs(a, storeRoot)));
  write(join(b, ISSUE, "build-progress.json"), "older");
  const before = snapshot(b);
  assert.throws(
    () => rs.restore({ runDir: b, issue: ISSUE, storeRoot, afterStageCopy: (rstage) => fs.rmSync(join(rstage, "build-review", "judge", "ledger.json")) }),
    (e) => e.code === rs.EXIT.refused && /staged judge-stage store without a judge ledger/.test(e.message),
  );
  assert.deepEqual(snapshot(b), before);
}));

test("a dialogue-stage record restores without a judge ledger", () => withTmp((tmp) => {
  const store = join(tmp, "store");
  const b = join(tmp, "B");
  handStore(store, holdRecord(dialogueOf({ stage: "dialogue" })));
  assert.equal(ok(runCli(restoreArgs(b, store))).dialogue.stage, "dialogue");
}));

test("resume-store --selftest passes", () => {
  const r = runCli(["resume-store", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});
