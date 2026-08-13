// FAFF-386 — Andon light: push alerting/escalation channel for run-critical events.
// `faff andon pump` is a cursor-based reader over events.jsonl: classify (park /
// sentry-trip / budget-breach / run-end) → dedupe → POST → advance cursor, fail-open
// throughout (a transport failure never turns into a non-zero exit). `faff andon send`
// is the direct one-shot escape hatch. Covers the spec's five scenarios + the
// non-functional assertions (payload minimisation, POST cap, zero new dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  andonStatePath, buildNotification, classifyEvent, formatPayload, ntfyPriority,
  resolveAndonConfig, runPump,
} from "../plugin/skills/faff/bin/lib/andon.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function tmp(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }

// Async CLI runner (spawn, not execFileSync) — REQUIRED here because several tests
// run an in-process loopback http server in this same test process; a synchronous
// execFileSync would block this process's event loop while the child's request is
// still in flight, deadlocking client and server against each other.
function run(args) {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI, ...args]);
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

// A loopback server that records every POST it receives; caller controls the response.
// `t` (the running test's TestContext) registers the close so a server is NEVER left
// listening after its test ends — an unclosed handle would keep `node --test`'s process
// alive past every test finishing (the event loop never drains), hanging the whole run.
function loopbackServer(t, handler) {
  return new Promise((resolve) => {
    const posts = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        posts.push({ method: req.method, path: req.url, headers: req.headers, body });
        if (handler) handler(req, res, posts);
        else { res.writeHead(200); res.end("ok"); }
      });
    });
    t.after(() => new Promise((r) => { if (server.listening) server.close(r); else r(); }));
    server.listen(0, "127.0.0.1", () => resolve({ server, posts, url: (p) => `http://127.0.0.1:${server.address().port}${p || "/hook"}` }));
  });
}

function writeConfig(root, yaml) { writeFileSync(join(root, ".faffrc.yaml"), yaml); }
function writeEvents(runDir, lines) { writeFileSync(join(runDir, "events.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n"); }

// --- --selftest ------------------------------------------------------------

test("andon --selftest passes", async () => {
  const r = await run(["andon", "--selftest"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /RESULT: PASS/);
});

// --- classify / build / format (pure) ---------------------------------------------

test("classifyEvent: closed class set, sorted dedupe keys", () => {
  assert.equal(classifyEvent({ seq: 1, type: "issue-admitted" }), null);
  assert.deepEqual(classifyEvent({ seq: 1, type: "park", issue: "FAFF-1" }), { cls: "park", key: "park:FAFF-1:1" });
  assert.deepEqual(
    classifyEvent({ seq: 2, type: "budget-checkpoint", data: { breached: ["cost", "tokens"] } }),
    { cls: "budget-breach", key: "budget:cost,tokens" },
  );
  assert.equal(classifyEvent({ seq: 3, type: "budget-checkpoint", data: { breached: [] } }), null);
  assert.deepEqual(
    classifyEvent({ seq: 4, type: "sentry-trip", data: { verdicts: [{ signal: "wall-clock-runaway" }] } }),
    { cls: "sentry-trip", key: "sentry:wall-clock-runaway" },
  );
  assert.deepEqual(classifyEvent({ seq: 5, type: "run-end" }), { cls: "run-end", key: "run-end" });
});

test("buildNotification: payload-minimisation assertion — IDs, class, one-liners only", () => {
  const n = buildNotification("run-1", 3, "2026-01-01T00:00:00Z", "park", { issue: "FAFF-1", data: { reason: "budget-hit" } });
  assert.deepEqual(Object.keys(n).sort(), ["body", "class", "issue", "run_id", "seq", "title", "ts"]);
  assert.ok(n.title.length < 120 && n.body.length < 200, "title/body stay one-liner-sized");
  assert.doesNotMatch(n.body, /```|diff --git|Chosen:/, "no spec/diff content leaks into the body");
});

test("formatPayload: all four presets shape the SAME notification differently, never extend it", () => {
  const n = { run_id: "r", class: "budget-breach", title: "T", body: "B", ts: "x", seq: 1 };
  assert.equal(JSON.parse(formatPayload("generic", n).body).title, "T");
  const ntfy = formatPayload("ntfy", n);
  assert.equal(ntfy.body, "B");
  assert.equal(ntfy.headers.Title, "T");
  assert.equal(ntfy.headers.Priority, "urgent");
  assert.equal(ntfyPriority("park"), "high");
  assert.equal(ntfyPriority("run-end"), "default");
  assert.equal(JSON.parse(formatPayload("slack", n).body).text, "T\nB");
  assert.equal(JSON.parse(formatPayload("discord", n).body).content, "T\nB");
});

// --- resolveAndonConfig ------------------------------------------------------------

test("resolveAndonConfig: dark by default, resolves andon.* when set", () => {
  const root = tmp("andon-cfg-");
  try {
    writeConfig(root, "tracking:\n  repo: x/y\n");
    const cfg = resolveAndonConfig(root);
    assert.equal(cfg.url, null);
    assert.equal(cfg.format, "generic");
    assert.deepEqual(cfg.events, ["park", "sentry-trip", "budget-breach"]);

    writeConfig(root, "andon:\n  url: https://ntfy.example/topic\n  format: ntfy\n  token: sekret\n  events:\n    - run-end\n");
    const cfg2 = resolveAndonConfig(root);
    assert.equal(cfg2.url, "https://ntfy.example/topic");
    assert.equal(cfg2.format, "ntfy");
    assert.equal(cfg2.token, "sekret");
    assert.deepEqual(cfg2.events, ["run-end"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- runPump: the spec's own five scenarios (§5) ------------------------------------

test("scenario 1: a park event → exactly one POST naming the issue + class + run id; cursor advances", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-s1-root-"), runDir = tmp("andon-s1-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n`);
    writeEvents(runDir, [{ schema: 2, run_id: "run-x", seq: 0, type: "park", issue: "FAFF-123", phase: "prep", data: { reason: "needs-human" } }]);
    const r = await runPump(root, runDir);
    assert.equal(r.sent, 1);
    assert.equal(posts.length, 1);
    const body = JSON.parse(posts[0].body);
    assert.equal(body.issue, "FAFF-123");
    assert.equal(body.class, "park");
    assert.equal(body.run_id, "run-x");
    assert.equal(r.cursor, 1);
    assert.ok(existsSync(andonStatePath(runDir)));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

test("scenario 2: a second pump with no new events sends nothing, exit 0", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-s2-root-"), runDir = tmp("andon-s2-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n`);
    writeEvents(runDir, [{ schema: 2, run_id: "run-x", seq: 0, type: "park", issue: "FAFF-1", phase: "prep", data: { reason: "x" } }]);
    await runPump(root, runDir);
    const r2 = await runPump(root, runDir);
    assert.equal(r2.sent, 0);
    assert.equal(posts.length, 1); // still just the one from the first pump
    const cliResult = await run(["andon", "pump", "--run-dir", runDir, "--root", root, "--json"]);
    assert.equal(cliResult.code, 0);
    assert.equal(JSON.parse(cliResult.out).sent, 0);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

test("scenario 3: five persisting budget-checkpoint(breached:[tokens]) events → exactly one notification", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-s3-root-"), runDir = tmp("andon-s3-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n`);
    const lines = [];
    for (let i = 0; i < 5; i++) lines.push({ schema: 2, run_id: "r", seq: i, type: "budget-checkpoint", phase: "run", data: { breached: ["tokens"] } });
    writeEvents(runDir, lines);
    const r = await runPump(root, runDir);
    assert.equal(r.sent, 1);
    assert.equal(posts.length, 1);
    assert.equal(JSON.parse(posts[0].body).class, "budget-breach");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

test("scenario 4: a refusing endpoint → exit 0, cursor held, failure recorded; a later pump against a recovered endpoint delivers it", async (t) => {
  // A closed port on loopback refuses the connection immediately.
  const closed = await loopbackServer(t);
  const closedUrl = closed.url();
  await new Promise((r) => closed.server.close(r));

  const root = tmp("andon-s4-root-"), runDir = tmp("andon-s4-run-");
  try {
    writeConfig(root, `andon:\n  url: ${closedUrl}\n`);
    writeEvents(runDir, [{ schema: 2, run_id: "r", seq: 0, type: "park", issue: "FAFF-9", phase: "build", data: { reason: "y" } }]);
    const r1 = await runPump(root, runDir);
    assert.equal(r1.sent, 0);
    assert.equal(r1.failed, 1);
    assert.equal(r1.cursor, 0, "cursor does not advance past the failed event");
    const state = JSON.parse(readFileSync(andonStatePath(runDir), "utf8"));
    assert.equal(state.failures.length, 1);
    assert.equal(state.cursor, 0);

    // Recover: point config at a live server and re-pump.
    const live = await loopbackServer(t);
    writeConfig(root, `andon:\n  url: ${live.url()}\n`);
    const r2 = await runPump(root, runDir);
    assert.equal(r2.sent, 1);
    assert.equal(r2.cursor, 1);
    assert.equal(live.posts.length, 1);
    assert.equal(JSON.parse(live.posts[0].body).issue, "FAFF-9");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

test("scenario 5: no andon.url configured → no network attempt, no state file written", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-s5-root-"), runDir = tmp("andon-s5-run-");
  try {
    writeConfig(root, "tracking:\n  repo: x/y\n"); // no andon.url at all
    const lines = [];
    for (let i = 0; i < 6; i++) lines.push({ schema: 2, run_id: "r", seq: i, type: "park", issue: `FAFF-${i}`, phase: "prep", data: { reason: "x" } });
    writeEvents(runDir, lines);
    const r = await runPump(root, runDir);
    assert.equal(r.disabled, true);
    assert.equal(r.sent, 0);
    assert.equal(posts.length, 0);
    assert.equal(existsSync(andonStatePath(runDir)), false);
    void url; // unused — asserting NO connection was ever attempted, not exercising it
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

// --- FAFF-781: informational lifecycle classes (admitted / prep-start / build-start) ---

test("classifyEvent: informational classes, issue-less start events unclassifiable", () => {
  assert.deepEqual(classifyEvent({ seq: 1, type: "issue-admitted", issue: "FAFF-1" }), { cls: "admitted", key: "admitted" });
  assert.equal(classifyEvent({ seq: 1, type: "issue-admitted" }), null);
  assert.deepEqual(classifyEvent({ seq: 2, type: "prep-start", issue: "FAFF-7" }), { cls: "prep-start", key: "prep-start:FAFF-7" });
  assert.equal(classifyEvent({ seq: 2, type: "prep-start" }), null);
  assert.deepEqual(classifyEvent({ seq: 3, type: "build-start", issue: "FAFF-7" }), { cls: "build-start", key: "build-start:FAFF-7" });
  assert.equal(classifyEvent({ seq: 3, type: "build-start" }), null);
});

test("resolveAndonConfig: informational classes are opt-in, absent from ANDON_DEFAULT_EVENTS", () => {
  const root = tmp("andon-info-cfg-");
  try {
    writeConfig(root, "tracking:\n  repo: x/y\n");
    assert.deepEqual(resolveAndonConfig(root).events, ["park", "sentry-trip", "budget-breach"]);
    writeConfig(root, "andon:\n  url: https://ex.invalid/hook\n  events:\n    - admitted\n    - prep-start\n    - build-start\n");
    assert.deepEqual(resolveAndonConfig(root).events, ["admitted", "prep-start", "build-start"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("spec scenario: three issue-admitted events → exactly one 'admitted' summary POST, no issue field", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-admit-root-"), runDir = tmp("andon-admit-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n  events:\n    - admitted\n`);
    writeEvents(runDir, [
      { schema: 2, run_id: "run-x", seq: 0, type: "issue-admitted", issue: "FAFF-1", phase: "run" },
      { schema: 2, run_id: "run-x", seq: 1, type: "issue-admitted", issue: "FAFF-2", phase: "run" },
      { schema: 2, run_id: "run-x", seq: 2, type: "issue-admitted", issue: "FAFF-3", phase: "run" },
    ]);
    const r = await runPump(root, runDir);
    assert.equal(r.sent, 1);
    assert.equal(posts.length, 1);
    const body = JSON.parse(posts[0].body);
    assert.equal(body.class, "admitted");
    assert.equal(body.issue, undefined);
    for (const id of ["FAFF-1", "FAFF-2", "FAFF-3"]) assert.ok(body.body.includes(id), `admitted body should list ${id}`);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

test("spec scenario: default config (no informational classes opted in) sends zero informational notifications; run-critical behaviour unchanged", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-default-root-"), runDir = tmp("andon-default-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n`); // no events: override — the byte-for-byte default
    writeEvents(runDir, [
      { schema: 2, run_id: "run-x", seq: 0, type: "issue-admitted", issue: "FAFF-1", phase: "run" },
      { schema: 2, run_id: "run-x", seq: 1, type: "prep-start", issue: "FAFF-1", phase: "prep" },
      { schema: 2, run_id: "run-x", seq: 2, type: "build-start", issue: "FAFF-1", phase: "build" },
      { schema: 2, run_id: "run-x", seq: 3, type: "park", issue: "FAFF-1", phase: "build", data: { reason: "needs-human" } },
    ]);
    const r = await runPump(root, runDir);
    assert.equal(r.sent, 1); // the park only — run-critical behaviour is byte-for-byte unchanged
    assert.equal(posts.length, 1);
    assert.equal(JSON.parse(posts[0].body).class, "park");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

test("spec scenario: two build-start events for the same issue (e.g. a respec re-dispatch) → exactly one notification (dedupe)", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-buildstart-root-"), runDir = tmp("andon-buildstart-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n  events:\n    - build-start\n`);
    writeEvents(runDir, [
      { schema: 2, run_id: "run-x", seq: 0, type: "build-start", issue: "FAFF-1", phase: "build" },
      { schema: 2, run_id: "run-x", seq: 1, type: "build-start", issue: "FAFF-1", phase: "build" },
    ]);
    const r = await runPump(root, runDir);
    assert.equal(r.sent, 1);
    assert.equal(posts.length, 1);
    const body = JSON.parse(posts[0].body);
    assert.equal(body.class, "build-start");
    assert.equal(body.issue, "FAFF-1");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

test("prep-start notification names the run, issue, and stage", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-prepstart-root-"), runDir = tmp("andon-prepstart-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n  events:\n    - prep-start\n`);
    writeEvents(runDir, [{ schema: 2, run_id: "run-x", seq: 0, type: "prep-start", issue: "FAFF-7", phase: "prep" }]);
    const r = await runPump(root, runDir);
    assert.equal(r.sent, 1);
    const body = JSON.parse(posts[0].body);
    assert.equal(body.class, "prep-start");
    assert.equal(body.issue, "FAFF-7");
    assert.equal(body.run_id, "run-x");
    assert.match(body.body, /prep/);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

test("informational payloads stay minimal — no spec/diff/transcript content leaks", () => {
  const admittedNotif = buildNotification("r", null, "x", "admitted", { data: { admitted: ["FAFF-1", "FAFF-2"] } });
  assert.deepEqual(Object.keys(admittedNotif).sort(), ["body", "class", "run_id", "seq", "title", "ts"]);
  assert.doesNotMatch(admittedNotif.body, /```|diff --git|Chosen:/);
  const buildStartNotif = buildNotification("r", 1, "x", "build-start", { issue: "FAFF-1" });
  assert.deepEqual(Object.keys(buildStartNotif).sort(), ["body", "class", "issue", "run_id", "seq", "title", "ts"]);
  assert.doesNotMatch(buildStartNotif.body, /```|diff --git|Chosen:/);
});

// --- FAFF-781 spec §8 integration smoke test (CLI-level, loopback-verified) --------

test("smoke: run-start + two issue-admitted + build-start, opted into admitted+build-start, via the CLI", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-smoke-root-"), runDir = tmp("andon-smoke-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n  events:\n    - admitted\n    - build-start\n`);
    writeEvents(runDir, [
      { schema: 2, run_id: "run-x", seq: 0, type: "run-start", phase: "run" },
      { schema: 2, run_id: "run-x", seq: 1, type: "issue-admitted", issue: "FAFF-1", phase: "run" },
      { schema: 2, run_id: "run-x", seq: 2, type: "issue-admitted", issue: "FAFF-2", phase: "run" },
      { schema: 2, run_id: "run-x", seq: 3, type: "build-start", issue: "FAFF-1", phase: "build" },
    ]);
    const r1 = await run(["andon", "pump", "--run-dir", runDir, "--root", root, "--json"]);
    assert.equal(r1.code, 0);
    assert.equal(JSON.parse(r1.out).sent, 2);
    assert.equal(posts.length, 2);
    const admitted = posts.map((p) => JSON.parse(p.body)).find((b) => b.class === "admitted");
    assert.ok(admitted && admitted.body.includes("FAFF-1") && admitted.body.includes("FAFF-2"));
    const buildStart = posts.map((p) => JSON.parse(p.body)).find((b) => b.class === "build-start");
    assert.ok(buildStart && buildStart.issue === "FAFF-1");

    const r2 = await run(["andon", "pump", "--run-dir", runDir, "--root", root, "--json"]);
    assert.equal(JSON.parse(r2.out).sent, 0, "re-pump against the same log sends zero new notifications (dedupe)");
    assert.equal(posts.length, 2, "no additional POSTs on the second pump");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

// --- non-functional assertions -------------------------------------------------

test("flood cap: a pump over 50 critical events makes at most 11 POSTs (10 + rollup)", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-flood-root-"), runDir = tmp("andon-flood-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n`);
    const lines = [];
    for (let i = 0; i < 50; i++) lines.push({ schema: 2, run_id: "r", seq: i, type: "budget-checkpoint", phase: "run", data: { breached: [`dim${i}`] } });
    writeEvents(runDir, lines);
    const r = await runPump(root, runDir);
    assert.ok(posts.length <= 11, `expected <=11 POSTs, got ${posts.length}`);
    assert.equal(r.cursor, 50, "cursor still advances past every covered event, capped batch or not");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

test("malformed events.jsonl line is skipped and counted, pump still completes", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-malformed-root-"), runDir = tmp("andon-malformed-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n`);
    writeFileSync(join(runDir, "events.jsonl"), "not json at all\n" + JSON.stringify({ schema: 2, run_id: "r", seq: 1, type: "park", issue: "FAFF-1", phase: "prep", data: { reason: "x" } }) + "\n");
    const r = await runPump(root, runDir);
    assert.equal(r.malformed, 1);
    assert.equal(r.sent, 1);
    assert.equal(posts.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

test("absent/empty events.jsonl → { sent: 0 }, exit 0", async (t) => {
  const { url } = await loopbackServer(t);
  const root = tmp("andon-empty-root-"), runDir = tmp("andon-empty-run-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n`);
    const r = await runPump(root, runDir); // no events.jsonl written at all
    assert.equal(r.sent, 0);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runDir, { recursive: true, force: true }); }
});

// --- faff andon send (the escape-hatch one-shot) ------------------------------------

test("andon send: disabled by default (no andon.url) → exit 0, { disabled: true }", async () => {
  const root = tmp("andon-send-off-");
  try {
    writeConfig(root, "tracking:\n  repo: x/y\n");
    const r = await run(["andon", "send", "--class", "park", "--title", "T", "--body", "B", "--root", root, "--json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).disabled, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("andon send: delivers a one-shot notification bypassing the event log", async (t) => {
  const { url, posts } = await loopbackServer(t);
  const root = tmp("andon-send-on-");
  try {
    writeConfig(root, `andon:\n  url: ${url()}\n`);
    const r = await run(["andon", "send", "--class", "sentry-trip", "--title", "T", "--body", "B", "--issue", "FAFF-1", "--root", root, "--json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).sent, 1);
    assert.equal(posts.length, 1);
    assert.equal(JSON.parse(posts[0].body).issue, "FAFF-1");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("andon send: a refusing endpoint still exits 0 (fail-open) with failed:1", async (t) => {
  const closed = await loopbackServer(t);
  const closedUrl = closed.url();
  await new Promise((r) => closed.server.close(r));
  const root = tmp("andon-send-fail-");
  try {
    writeConfig(root, `andon:\n  url: ${closedUrl}\n`);
    const r = await run(["andon", "send", "--class", "park", "--title", "T", "--body", "B", "--root", root, "--json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).failed, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- usage / exit posture ------------------------------------------------------------

test("usage errors exit 2: missing verb, unknown flag, missing required flag", async () => {
  assert.equal((await run(["andon"])).code, 2);
  assert.equal((await run(["andon", "pump", "--bogus-flag"])).code, 2);
  assert.equal((await run(["andon", "pump"])).code, 2); // --run-dir required
  assert.equal((await run(["andon", "send", "--class", "park"])).code, 2); // --title/--body required
});

test("pump against a missing run dir is a usage error (exit 2), never a silent no-op", async () => {
  const root = tmp("andon-norundir-");
  try {
    const r = await run(["andon", "pump", "--run-dir", join(root, "does-not-exist"), "--root", root]);
    assert.equal(r.code, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
