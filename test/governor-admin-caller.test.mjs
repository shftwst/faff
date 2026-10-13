// FAFF-1216 — the governor-side changes the install makes possible: the read-only admin caller, the
// optional admin_uids and runner_checks config keys, the runner_checks copy on admission payloads, the
// opt-in --socket-group-access socket mode and its two rate caps. All run without root: peer
// credentials come from a stub reader and the clock is injected.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(resolve(HERE, ".."), "plugin", "skills", "faff", "bin", "lib");
const COMMISSAIRE = join(LIB, "..", "commissaire");
const require = createRequire(import.meta.url);
const governor = require(join(LIB, "governor.js"));
const { openState, loadGovernorConfig, parseGovernorConfig, guardUnixConnection, makeConnectionBounds, ADMIN_OPS } = governor;

class FakeSocket extends EventEmitter {
  constructor() { super(); this._handle = { fd: -1 }; this.ended = null; this.destroyed = false; }
  setEncoding() {}
  end(data) { this.ended = data; return this; }
  destroy() { this.destroyed = true; }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "faff-admin-"));
  const opened = openState(dir);
  assert.equal(opened.ok, true);
  return { dir, state: opened.state, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const readLog = (dir) => {
  const p = join(dir, "governor-log.jsonl");
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const callers = (...pairs) => new Map(pairs);
const reader = (uid) => ({ readPeerUid: () => ({ ok: true, uid }) });

function send(state, map, uid, request) {
  const sock = new FakeSocket();
  guardUnixConnection(state, map, reader(uid), sock);
  if (sock.ended === null) sock.emit("data", JSON.stringify(request) + "\n");
  return JSON.parse(sock.ended);
}

const ADMIT = { op: "admit", run_id: "RUN-ADM", producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge"] };
const MAP = callers([1000, "runner"], [1001, "admin"]);

const RUNNER_CHECKS = {
  schema: 1, runner_user: "alice", runner_uid: 1000, platform: "linux", socket_group: "commissaire-clients",
  docker_group: false, sudo_rules: false, sudo_absent: false, admin_group: null, independent: true,
  checked_at: "2026-10-12T04:00:00Z", install_version: "a".repeat(64), source_tag: "faff--v0.42.0",
};

// --- Admin caller ------------------------------------------------------------------------------

test("admin caller: admit, authorize and conclude are refused op-not-permitted-for-admin before dispatch, with no state change", () => {
  const { dir, state, cleanup } = fixture();
  try {
    for (const op of ["admit", "authorize", "conclude"]) {
      const reply = send(state, MAP, 1001, { ...ADMIT, op });
      assert.equal(reply.ok, false);
      assert.equal(reply.reason, "op-not-permitted-for-admin");
      assert.equal(reply.op, op);
    }
    assert.equal(state.admissions.size, 0, "nothing the admin sent reached governor state");
    assert.equal(state.lastHead.size, 0);
    const lines = readLog(dir);
    assert.equal(lines.length, 3);
    for (const line of lines) {
      assert.equal(line.peer_uid, 1001);
      assert.equal(line.caller_role, "admin");
      assert.equal(line.refusal, "op-not-permitted-for-admin");
      assert.equal(line.signed_record, undefined);
    }
  } finally { cleanup(); }
});

test("admin caller: identify passes the role check (unknown-op until FAFF-1217 adds the op)", () => {
  const { state, cleanup } = fixture();
  try {
    assert.deepEqual([...ADMIN_OPS], ["identify"]);
    const reply = send(state, MAP, 1001, { op: "identify" });
    assert.notEqual(reply.reason, "op-not-permitted-for-admin");
    assert.equal(reply.reason, "unknown-op");
  } finally { cleanup(); }
});

test("admin caller: a non-string op is not an admin op", () => {
  const { state, cleanup } = fixture();
  try {
    assert.equal(send(state, MAP, 1001, { op: ["identify"] }).reason, "op-not-permitted-for-admin");
    assert.equal(send(state, MAP, 1001, {}).reason, "op-not-permitted-for-admin");
  } finally { cleanup(); }
});

test("runner caller keeps every operation and its log line carries caller_role runner; an unlisted uid is caller-not-allowed", () => {
  const { dir, state, cleanup } = fixture();
  try {
    const reply = send(state, MAP, 1000, ADMIT);
    assert.equal(reply.ok, true);
    assert.equal(reply.custody, "governor");
    assert.equal(state.admissions.size, 1);
    const last = readLog(dir).pop();
    assert.equal(last.op, "admit");
    assert.equal(last.caller_role, "runner");
    assert.equal(last.peer_uid, 1000);

    const refused = send(state, MAP, 1002, ADMIT);
    assert.equal(refused.reason, "caller-not-allowed");
    assert.equal(readLog(dir).pop().refusal, "caller-not-allowed");
  } finally { cleanup(); }
});

// --- Config: admin_uids and runner_checks ------------------------------------------------------------

test("parseGovernorConfig: admin_uids is optional, validated like allow_uids, and never shares a uid with allow_uids", () => {
  assert.deepEqual(parseGovernorConfig({ allow_uids: [1] }).config.admin_uids, []);
  assert.deepEqual(parseGovernorConfig({ allow_uids: [1], admin_uids: [2] }).config.admin_uids, [2]);
  for (const bad of ["x", -1, [-1], [1.5], ["1"], null]) {
    const r = parseGovernorConfig({ allow_uids: [1], admin_uids: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.error, /admin_uids/);
  }
  const both = parseGovernorConfig({ allow_uids: [5], admin_uids: [5] });
  assert.equal(both.ok, false);
  assert.match(both.error, /admin_uids/);
});

test("parseGovernorConfig: runner_checks is optional; a valid object is accepted verbatim", () => {
  assert.equal(parseGovernorConfig({ allow_uids: [1] }).config.runner_checks, undefined);
  const ok = parseGovernorConfig({ allow_uids: [1], runner_checks: RUNNER_CHECKS });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.config.runner_checks, RUNNER_CHECKS);
  assert.equal(parseGovernorConfig({ allow_uids: [1], runner_checks: { ...RUNNER_CHECKS, platform: "macos", admin_group: false } }).ok, true);
  assert.equal(parseGovernorConfig({ allow_uids: [1], runner_checks: { ...RUNNER_CHECKS, sudo_absent: true } }).ok, true, "sudo_absent with sudo_rules false is valid");
});

test("parseGovernorConfig: every malformed runner_checks shape is rejected naming runner_checks", () => {
  const without = (key) => Object.fromEntries(Object.entries(RUNNER_CHECKS).filter(([k]) => k !== key));
  const bad = {
    "not an object": "nope",
    "an array": [],
    "extra key": { ...RUNNER_CHECKS, extra: 1 },
    "schema 2": { ...RUNNER_CHECKS, schema: 2 },
    "schema string": { ...RUNNER_CHECKS, schema: "1" },
    "runner_user number": { ...RUNNER_CHECKS, runner_user: 7 },
    "runner_uid negative": { ...RUNNER_CHECKS, runner_uid: -1 },
    "runner_uid float": { ...RUNNER_CHECKS, runner_uid: 1.5 },
    "platform windows": { ...RUNNER_CHECKS, platform: "windows" },
    "socket_group number": { ...RUNNER_CHECKS, socket_group: 1 },
    "docker_group string": { ...RUNNER_CHECKS, docker_group: "false" },
    "sudo_rules null": { ...RUNNER_CHECKS, sudo_rules: null },
    "sudo_absent number": { ...RUNNER_CHECKS, sudo_absent: 0 },
    "independent string": { ...RUNNER_CHECKS, independent: "true" },
    "admin_group string": { ...RUNNER_CHECKS, admin_group: "no" },
    "checked_at not ISO": { ...RUNNER_CHECKS, checked_at: "yesterday" },
    "checked_at number": { ...RUNNER_CHECKS, checked_at: 1 },
    "install_version number": { ...RUNNER_CHECKS, install_version: 1 },
    "source_tag number": { ...RUNNER_CHECKS, source_tag: 1 },
    "sudo_absent with sudo_rules": { ...RUNNER_CHECKS, sudo_absent: true, sudo_rules: true, independent: false },
    "linux with non-null admin_group": { ...RUNNER_CHECKS, admin_group: false },
    "independent contradicts docker_group": { ...RUNNER_CHECKS, docker_group: true },
    "independent contradicts sudo_rules": { ...RUNNER_CHECKS, sudo_rules: true },
    "independent false but nothing fails": { ...RUNNER_CHECKS, independent: false },
    "independent contradicts admin_group": { ...RUNNER_CHECKS, platform: "macos", admin_group: true },
  };
  for (const key of Object.keys(RUNNER_CHECKS)) bad[`missing ${key}`] = without(key);
  for (const [label, rc] of Object.entries(bad)) {
    const r = parseGovernorConfig({ allow_uids: [1], runner_checks: rc });
    assert.equal(r.ok, false, label);
    assert.match(r.error, /runner_checks/, label);
  }
});

function startWithConfig(config) {
  const { dir, cleanup } = fixture();
  const cfg = join(dir, "governor-config.json");
  writeFileSync(cfg, JSON.stringify(config));
  chmodSync(cfg, 0o600);
  const r = spawnSync(process.execPath, [COMMISSAIRE, "governor", "start", "--key-dir", dir, "--socket", join(dir, "s.sock")], { encoding: "utf8", timeout: 10000 });
  cleanup();
  return r;
}

test("governor start exits 2 naming runner_checks when it is malformed, and naming admin_uids when a uid has two roles", () => {
  const badChecks = startWithConfig({ allow_uids: [1], runner_checks: { ...RUNNER_CHECKS, docker_group: true } });
  assert.equal(badChecks.status, 2);
  assert.match(badChecks.stderr, /runner_checks/);
  const bothRoles = startWithConfig({ allow_uids: [7], admin_uids: [7] });
  assert.equal(bothRoles.status, 2);
  assert.match(bothRoles.stderr, /admin_uids/);
});

test("loadGovernorConfig: an absent file is an empty allow list and an empty admin list", () => {
  const { dir, cleanup } = fixture();
  try {
    const loaded = loadGovernorConfig(dir);
    assert.deepEqual(loaded.config, { allow_uids: [], admin_uids: [] });
  } finally { cleanup(); }
});

// --- runner_checks on the admission payload -----------------------------------------------------------

test("admission payload carries runner_checks deep-equal to the loaded object; without it the key is absent", () => {
  const withChecks = fixture();
  const without = fixture();
  try {
    withChecks.state.runnerChecks = RUNNER_CHECKS;
    const a = send(withChecks.state, MAP, 1000, ADMIT);
    assert.deepEqual(a.admission_record.payload.runner_checks, RUNNER_CHECKS);
    const b = send(without.state, MAP, 1000, ADMIT);
    assert.equal("runner_checks" in b.admission_record.payload, false);
    assert.deepEqual(Object.keys(b.admission_record.payload), ["producer_id", "contract_revision", "admitted_scope", "pk_fingerprint", "admitted_at", "custody"]);
  } finally { withChecks.cleanup(); without.cleanup(); }
});

// --- Rate caps ------------------------------------------------------------------------------------------

function clockAt(start) {
  const clock = { t: start, now: () => clock.t, advance(ms) { clock.t += ms; } };
  return clock;
}
const MINUTE_START = 60_000 * 1_000_000;

test("spawn cap: the 21st connection within one second is closed with no reader call; the minute's close writes one spawn-limited line", () => {
  const { dir, state, cleanup } = fixture();
  try {
    const clock = clockAt(MINUTE_START + 1000);
    const bounds = makeConnectionBounds(state, clock.now);
    let reads = 0;
    const counting = { readPeerUid: () => { reads++; return { ok: true, uid: 1000 }; } };
    const sockets = [];
    for (let i = 0; i < 21; i++) {
      const sock = new FakeSocket();
      guardUnixConnection(state, MAP, counting, sock, bounds);
      sockets.push(sock);
    }
    assert.equal(reads, 20);
    assert.equal(sockets[20].destroyed, true, "the 21st connection is closed");
    assert.equal(sockets[20].ended, null, "closed without a reply");
    assert.ok(sockets.slice(0, 20).every((s) => s.listenerCount("data") === 1), "the first twenty were served");
    assert.equal(readLog(dir).filter((l) => l.event === "spawn-limited").length, 0, "nothing is written until the minute closes");

    clock.advance(60_000);
    bounds.flush();
    const lines = readLog(dir).filter((l) => l.event === "spawn-limited");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].count, 1);
    assert.equal(lines[0].window_start, new Date(MINUTE_START).toISOString());
    assert.equal(lines[0].window_end, new Date(MINUTE_START + 60_000).toISOString());
    bounds.flush();
    assert.equal(readLog(dir).filter((l) => l.event === "spawn-limited").length, 1, "the summary is written once");
  } finally { cleanup(); }
});

test("spawn cap: the bucket refills, so a slower caller is never limited", () => {
  const { dir, state, cleanup } = fixture();
  try {
    const clock = clockAt(MINUTE_START);
    const bounds = makeConnectionBounds(state, clock.now);
    for (let i = 0; i < 100; i++) {
      clock.advance(100);
      const sock = new FakeSocket();
      guardUnixConnection(state, MAP, reader(1000), sock, bounds);
      assert.equal(sock.destroyed, false);
    }
    clock.advance(60_000);
    bounds.flush();
    assert.equal(readLog(dir).filter((l) => l.event === "spawn-limited").length, 0, "a minute with nothing closed writes no summary");
  } finally { cleanup(); }
});

test("log cap: the 61st refused connection in a minute writes no line; the minute's close writes one refusals-suppressed line with count 1", () => {
  const { dir, state, cleanup } = fixture();
  try {
    const clock = clockAt(MINUTE_START);
    const bounds = makeConnectionBounds(state, clock.now);
    for (let i = 0; i < 61; i++) {
      clock.advance(100);
      const sock = new FakeSocket();
      guardUnixConnection(state, MAP, reader(4242), sock, bounds);
      assert.equal(JSON.parse(sock.ended).reason, "caller-not-allowed", "the refusal itself is still sent");
    }
    assert.equal(readLog(dir).filter((l) => l.op === "connect").length, 60);
    clock.advance(60_000);
    bounds.flush();
    const summary = readLog(dir).filter((l) => l.event === "refusals-suppressed");
    assert.equal(summary.length, 1);
    assert.equal(summary[0].count, 1);
    assert.equal(summary[0].window_start, new Date(MINUTE_START).toISOString());
    assert.equal(summary[0].window_end, new Date(MINUTE_START + 60_000).toISOString());
  } finally { cleanup(); }
});

test("log cap: a minute with nothing suppressed writes no summary, and the next minute counts afresh", () => {
  const { dir, state, cleanup } = fixture();
  try {
    const clock = clockAt(MINUTE_START);
    const bounds = makeConnectionBounds(state, clock.now);
    for (let i = 0; i < 60; i++) { clock.advance(100); guardUnixConnection(state, MAP, reader(4242), new FakeSocket(), bounds); }
    clock.advance(60_000);
    bounds.flush();
    assert.equal(readLog(dir).filter((l) => l.event).length, 0);
    for (let i = 0; i < 60; i++) { clock.advance(100); guardUnixConnection(state, MAP, reader(4242), new FakeSocket(), bounds); }
    assert.equal(readLog(dir).filter((l) => l.op === "connect").length, 120, "the second minute has its own 60");
  } finally { cleanup(); }
});

test("without bounds (no --socket-group-access) neither cap applies", () => {
  const { dir, state, cleanup } = fixture();
  try {
    let reads = 0;
    const counting = { readPeerUid: () => { reads++; return { ok: true, uid: 4242 }; } };
    for (let i = 0; i < 100; i++) guardUnixConnection(state, MAP, counting, new FakeSocket());
    assert.equal(reads, 100);
    assert.equal(readLog(dir).filter((l) => l.op === "connect").length, 100);
  } finally { cleanup(); }
});

// --- --socket-group-access socket mode -------------------------------------------------------------------------

function socketModeOf(extraArgs) {
  const { dir, cleanup } = fixture();
  const sock = join(dir, "s.sock");
  const child = spawn(process.execPath, [COMMISSAIRE, "governor", "start", "--key-dir", dir, "--socket", sock, ...extraArgs], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolveP, rejectP) => {
    let out = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); cleanup(); rejectP(new Error(`governor did not start: ${out}`)); }, 8000);
    child.stdout.on("data", (c) => {
      out += c;
      if (!out.includes('"listening"')) return;
      clearTimeout(timer);
      const mode = statSync(sock).mode & 0o777;
      child.once("exit", () => { cleanup(); resolveP(mode); });
      child.kill("SIGTERM");
    });
    child.on("error", rejectP);
  });
}

test("governor start: --socket-group-access makes the socket 0660; without it the socket stays 0600", async () => {
  assert.equal((await socketModeOf(["--socket-group-access"])).toString(8), "660");
  assert.equal((await socketModeOf([])).toString(8), "600");
});
