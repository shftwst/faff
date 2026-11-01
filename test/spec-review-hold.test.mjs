// FAFF-1417 — `faff spec-review hold`: prep's outage and turn-budget holds as one verb.
// The store decision through the pure `decideHold`; the verb through the shipped CLI over temp
// roots. Case names are the ones the spec's rule inventory cites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const srh = require("../plugin/skills/faff/bin/lib/spec-review-hold.js");

const ADD = [{ op: "add", label: "faff-awaiting-spec-review" }];
const REMOVE = [{ op: "remove", label: "faff-awaiting-spec-review" }];

function fx(issue = "FAFF-9001", store = undefined, siblings = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-srh-"));
  const dir = join(root, ".faff", "resume", issue);
  mkdirSync(dir, { recursive: true });
  if (store !== undefined) writeFileSync(join(dir, "spec-review-hold.json"), typeof store === "string" ? store : JSON.stringify(store));
  for (const [name, body] of Object.entries(siblings)) writeFileSync(join(dir, name), body);
  return { root, dir, file: join(dir, "spec-review-hold.json") };
}
function hold(root, args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, "spec-review", "hold", "--root", root, "--json", ...args], { encoding: "utf8", env: { ...process.env, FAFF_RUN_DIR: "", ...env } });
  let res = null;
  try { res = JSON.parse(r.stdout); } catch { res = null; }
  return { code: r.status, res, stderr: r.stderr };
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
// An outage scratch dir whose trailing unavailable rounds exceed the retry limit.
function outageScratch(root, rounds = 3) {
  const s = join(root, "scratch");
  mkdirSync(s, { recursive: true });
  for (let k = 1; k <= rounds; k++) writeFileSync(join(s, `round-${k}.json`), JSON.stringify({ verdict: "unavailable", objections: [{ lens: "QA", severity: "major" }] }));
  return s;
}

// --- The spec scenarios ---

test("scenario 5: a turn-budget hold increments the counter, writes the cause and adds the label", () => {
  const f = fx("FAFF-9001", { turn_budget_holds: 1 });
  const { code, res } = hold(f.root, ["--issue", "FAFF-9001", "--cause", "turn-budget", "--mode", "autonomous"]);
  assert.equal(code, 0);
  assert.equal(res.action, "hold");
  assert.equal(res.token, "spec-review-pending");
  const store = readJson(f.file);
  assert.equal(store.turn_budget_holds, 2);
  assert.equal(store.cause, "turn-budget");
  assert.deepEqual(res.label_ops, ADD);
});

test("scenario 6: a corrupt counter parks and renames the store aside with its original bytes", () => {
  const body = '{"turn_budget_holds":"two","outage_holds":1}';
  const f = fx("FAFF-9002", body);
  const { code, res } = hold(f.root, ["--issue", "FAFF-9002", "--cause", "turn-budget", "--mode", "autonomous"]);
  assert.equal(code, 0);
  assert.equal(res.action, "park");
  assert.equal(res.cause, "spec-review-hold.json corrupt — cannot read turn_budget_holds");
  assert.equal(existsSync(f.file), false);
  const files = readdirSync(f.dir);
  assert.equal(files.length, 1);
  assert.ok(files[0].startsWith("spec-review-hold.corrupt-"), files[0]);
  assert.equal(readFileSync(join(f.dir, files[0]), "utf8"), body);
});

// --- The outage hold (P42–P50) ---

test("outage hold: past the in-turn ceiling an outage hold writes the store, label and notice", () => {
  const f = fx();
  const scratch = outageScratch(f.root, 3);
  writeFileSync(join(scratch, "pinned-reviewer.json"), JSON.stringify({ provider: "p", model: "m", host: "h" }));
  const { res } = hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous", "--kind", "model-transient", "--lenses", "QA,infosec", "--dir", scratch, "--retry-limit", "2"]);
  assert.equal(res.action, "hold");
  assert.equal(res.token, "spec-review-held");
  assert.deepEqual(res.label_ops, ADD);
  assert.equal(res.comment, "spec-review provider unavailable; spec attached and held; attempt 1/3; auto-resumes at review on the next drain");
  const store = readJson(f.file);
  assert.equal(store.outage_holds, 1);
  assert.equal(store.cause, "outage");
  assert.equal(store.kind, "model-transient");
  assert.deepEqual(store.outaged_lenses, ["QA", "infosec"]);
  assert.deepEqual(store.pinned_reviewer, { provider: "p", model: "m", host: "h" });
  assert.equal(store.held_at_round, 3);
  assert.equal(typeof store.held_at, "string");
});

test("outage precondition: an outage hold before the in-turn ceiling, or without --dir, exits 2", () => {
  const f = fx();
  assert.equal(hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous"]).code, 2);
  const early = outageScratch(f.root, 2);
  assert.equal(hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous", "--dir", early, "--retry-limit", "2"]).code, 2);
  const s = join(f.root, "revise-scratch");
  mkdirSync(s);
  writeFileSync(join(s, "round-1.json"), JSON.stringify({ verdict: "revise", objections: [{ lens: "QA", severity: "minor" }] }));
  assert.equal(hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous", "--dir", s, "--retry-limit", "0"]).code, 2);
  assert.equal(existsSync(f.file), false);
});

test("outage exhausted: at the hold limit the store file alone is deleted and the issue parks", () => {
  const f = fx("FAFF-9001", { outage_holds: 2, held_at_round: 0 }, { "hold.json": "{}" });
  const scratch = outageScratch(f.root, 3);
  const { res } = hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous", "--dir", scratch, "--retry-limit", "2", "--hold-limit", "3"]);
  assert.equal(res.action, "park");
  assert.equal(res.cause, "spec-review provider outage, 3 held drains exhausted");
  assert.deepEqual(res.label_ops, REMOVE);
  assert.equal(existsSync(f.file), false);
  assert.ok(existsSync(join(f.dir, "hold.json")), "the build-side hold.json survives");
});

test("hold has no parked op: no hold result ever carries a faff-parked label op", () => {
  for (const store of [undefined, { turn_budget_holds: 2 }, "{ torn"]) {
    const f = fx("FAFF-9001", store);
    const { res } = hold(f.root, ["--issue", "FAFF-9001", "--cause", "turn-budget", "--mode", "autonomous"]);
    assert.ok(res.label_ops.every((op) => op.label !== "faff-parked"), JSON.stringify(res.label_ops));
  }
});

// --- The turn-budget hold (P52–P59) ---

test("interactive turn budget: interactive never auto-holds, it surfaces and writes nothing", () => {
  const f = fx();
  const { res } = hold(f.root, ["--issue", "FAFF-9001", "--cause", "turn-budget", "--mode", "interactive"]);
  assert.equal(res.action, "surface");
  assert.equal(existsSync(f.file), false);
  const o = hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "interactive"]);
  assert.equal(o.res.action, "surface");
});

test("turn budget exhausted: at the hold limit the turn-budget hold parks with its cause", () => {
  const f = fx("FAFF-9001", { turn_budget_holds: 2 }, { "hold.json": "{}" });
  const { res } = hold(f.root, ["--issue", "FAFF-9001", "--cause", "turn-budget", "--mode", "autonomous"]);
  assert.equal(res.action, "park");
  assert.equal(res.cause, "spec-review turn-budget: 3 held drains exhausted — spec may be too large or a backend degraded");
  assert.equal(existsSync(f.file), false);
  assert.ok(existsSync(join(f.dir, "hold.json")));
});

test("counters independent: each hold preserves the other counter and unknown keys", () => {
  const f = fx("FAFF-9001", { outage_holds: 1, extra_key: "kept" });
  hold(f.root, ["--issue", "FAFF-9001", "--cause", "turn-budget", "--mode", "autonomous"]);
  let store = readJson(f.file);
  assert.equal(store.outage_holds, 1);
  assert.equal(store.turn_budget_holds, 1);
  assert.equal(store.extra_key, "kept");
  const scratch = outageScratch(f.root, 3);
  hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous", "--dir", scratch, "--retry-limit", "2"]);
  store = readJson(f.file);
  assert.equal(store.outage_holds, 2);
  assert.equal(store.turn_budget_holds, 1);
  assert.equal(store.extra_key, "kept");
});

test("hold writes no round: a hold never writes a round record or a verdict", () => {
  const f = fx();
  const scratch = outageScratch(f.root, 3);
  const before = readdirSync(scratch).sort();
  hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous", "--dir", scratch, "--retry-limit", "2"]);
  hold(f.root, ["--issue", "FAFF-9001", "--cause", "turn-budget", "--mode", "autonomous", "--dir", scratch]);
  assert.deepEqual(readdirSync(scratch).sort(), before);
});

test("turn budget survives a damaged scratch dir: an unreadable round record never blocks the hand-back", () => {
  const f = fx();
  const s = join(f.root, "scratch");
  mkdirSync(s);
  writeFileSync(join(s, "round-1.json"), "{ torn");
  const { code, res } = hold(f.root, ["--issue", "FAFF-9001", "--cause", "turn-budget", "--mode", "autonomous", "--dir", s]);
  assert.equal(code, 0);
  assert.equal(res.action, "hold");
  const o = hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous", "--dir", s, "--retry-limit", "0"]);
  assert.equal(o.code, 2, "the outage precondition still fails loud on an unreadable record");
});

test("lenses validated: --lenses outside the lens vocabulary exits 2", () => {
  const f = fx();
  const s = outageScratch(f.root, 3);
  assert.equal(hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous", "--dir", s, "--retry-limit", "2", "--lenses", "QA,;drop"]).code, 2);
  assert.equal(existsSync(f.file), false);
});

test("limit flags under a run: --hold-limit and --retry-limit may lower the configured ceilings but never raise them", () => {
  const run = join(mkdtempSync(join(tmpdir(), "faff-srh-run-")), "run");
  mkdirSync(run);
  writeFileSync(join(run, "run-ledger.json"), JSON.stringify({ level: "L3" }));
  const env = { FAFF_RUN_DIR: run };
  const tb = (limit) => hold(fx().root, ["--issue", "FAFF-9001", "--cause", "turn-budget", "--mode", "autonomous", "--hold-limit", String(limit)], env);
  assert.equal(tb(5).code, 2, "5 raises the configured 3");
  assert.equal(tb(2).res.limit, 2, "lowering is allowed");
  const f = fx();
  const s7 = outageScratch(join(f.root, "seven"), 7); // 7 dispatches clear a limit of 5, so only the raise guard can refuse
  assert.equal(hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous", "--dir", s7, "--retry-limit", "5"], env).code, 2, "5 raises the configured 2");
  const s = outageScratch(f.root, 3);
  assert.equal(hold(f.root, ["--issue", "FAFF-9001", "--cause", "outage", "--mode", "autonomous", "--dir", s, "--retry-limit", "1"], env).res.action, "hold", "lowering is allowed");
  assert.equal(hold(fx().root, ["--issue", "FAFF-9001", "--cause", "turn-budget", "--mode", "autonomous", "--hold-limit", "5"]).code, 0, "with no run, the flag is the operator's call");
});

// --- --read and --clear (P51, P58, P62) ---

test("read states: --read reports absent, valid and corrupt stores", () => {
  assert.equal(hold(fx().root, ["--read", "--issue", "FAFF-9001"]).res.store.state, "absent");
  const valid = hold(fx("FAFF-9001", { outage_holds: 1, held_at_round: 4 }).root, ["--read", "--issue", "FAFF-9001"]).res.store;
  assert.deepEqual(valid, { state: "valid", cause: "outage", outage_holds: 1, turn_budget_holds: null, held_at_round: 4 });
  assert.equal(hold(fx("FAFF-9001", "{ torn").root, ["--read", "--issue", "FAFF-9001"]).res.store.state, "corrupt");
  assert.equal(hold(fx("FAFF-9001", { turn_budget_holds: -1 }).root, ["--read", "--issue", "FAFF-9001"]).res.store.state, "corrupt");
});

test("legacy store: a store without a cause reads as an outage hold", () => {
  const { res } = hold(fx("FAFF-9001", { outage_holds: 2 }).root, ["--read", "--issue", "FAFF-9001"]);
  assert.equal(res.store.cause, "outage");
});

test("reconsider store: the lights-out reconsider-input-changed store with no counters is valid", () => {
  const { res } = hold(fx("FAFF-9001", { cause: "reconsider-input-changed" }).root, ["--read", "--issue", "FAFF-9001"]);
  assert.equal(res.store.state, "valid");
  assert.equal(res.store.cause, "reconsider-input-changed");
});

test("clear keeps hold.json: --clear deletes only spec-review-hold.json, idempotently", () => {
  const f = fx("FAFF-9001", { outage_holds: 1 }, { "hold.json": "{}" });
  const first = hold(f.root, ["--clear", "--issue", "FAFF-9001"]);
  assert.equal(first.res.action, "cleared");
  assert.deepEqual(first.res.label_ops, REMOVE);
  assert.equal(existsSync(f.file), false);
  assert.ok(existsSync(join(f.dir, "hold.json")));
  assert.equal(hold(f.root, ["--clear", "--issue", "FAFF-9001"]).code, 0);
});

// --- Faults and the lock (§3) ---

test("lock busy: a held resume-store lock exits 4", () => {
  const f = fx("FAFF-9001", { turn_budget_holds: 0 });
  mkdirSync(join(f.root, ".faff", "resume", ".FAFF-9001.stage"));
  const { code } = hold(f.root, ["--issue", "FAFF-9001", "--cause", "turn-budget", "--mode", "autonomous"]);
  assert.equal(code, 4);
  assert.equal(readJson(f.file).turn_budget_holds, 0);
});

test("usage exits: a bad issue id or a missing cause exits 2", () => {
  const f = fx();
  assert.equal(hold(f.root, ["--issue", "../x", "--cause", "turn-budget", "--mode", "autonomous"]).code, 2);
  assert.equal(hold(f.root, ["--issue", "FAFF-9001", "--mode", "autonomous"]).code, 2);
});

// --- decideHold ---

test("decideHold: absent counts from zero, corrupt and exhausted never write", () => {
  assert.equal(srh.decideHold({ state: "absent" }, "outage", 3, {}).kind, "hold");
  assert.deepEqual(srh.decideHold({ state: "corrupt" }, "outage", 3, {}), { kind: "corrupt", cause: "spec-review-hold.json corrupt — cannot read outage_holds" });
  assert.equal(srh.decideHold({ state: "valid", value: { outage_holds: 1.5 } }, "outage", 3, {}).kind, "corrupt");
  assert.equal(srh.decideHold({ state: "valid", value: { outage_holds: "x" } }, "turn-budget", 3, {}).kind, "hold");
  const ex = srh.decideHold({ state: "valid", value: { turn_budget_holds: 2 } }, "turn-budget", 3, {});
  assert.deepEqual(ex, { kind: "exhausted", cause: "spec-review turn-budget: 3 held drains exhausted — spec may be too large or a backend degraded", holds: 3 });
});
