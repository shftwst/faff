import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import budget from "../plugin/skills/faff/bin/lib/budget.js";
import { runCli } from "./helpers/run-cli.mjs";

function fixture(t, level, admitted) {
  const root = mkdtempSync(path.join(tmpdir(), "faff-requests-graft-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runId = level === "L2" ? "run-20261126-100000-graft-FAFF-1" : "run-20261126-100000-beepboop-full-abc123";
  const runDir = path.join(root, ".faff", "runs", runId);
  const sessionId = randomUUID();
  const env = { ...process.env, FAFF_SESSION_ID: runId, CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_CONFIG_DIR: path.join(root, "claude") };
  const transcriptDir = budget.transcriptBaseDir(root, env);
  const startedAt = new Date(Date.now() - 10000).toISOString();
  const timestamp = new Date(Date.now() - 5000).toISOString();
  mkdirSync(runDir, { recursive: true });
  mkdirSync(transcriptDir, { recursive: true });
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({
    run_id: runId, level, admitted, outcomes: {},
    owner: { epoch: 1, status: "running", session_id: runId, started_at: startedAt, last_heartbeat: startedAt },
  }));
  const transcript = path.join(transcriptDir, sessionId + ".jsonl");
  writeFileSync(transcript, JSON.stringify({
    type: "assistant", timestamp, sessionId, requestId: "req-gr01", uuid: randomUUID(),
    message: { role: "assistant", type: "message", id: "msg_gr01", model: "claude-opus-4-6",
      content: [{ type: "text", text: "private fixture text" }],
      usage: { input_tokens: 12, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 7 } },
  }) + "\n");
  return { root, runDir, env, transcript, sidecar: path.join(runDir, "run-request-metrics.json") };
}

test("standalone graft captures its native session when the last admitted issue drains", (t) => {
  const { root, runDir, env, sidecar } = fixture(t, "L2", ["FAFF-1", "FAFF-2"]);
  const record = (issue) => runCli(["run-ledger", "record-outcome", "--issue", issue, "--outcome", "parked", "--run-dir", runDir, "--root", root, "--json"], { cwd: root, env });
  const active = record("FAFF-1");
  assert.equal(active.code, 0, active.stderr);
  assert.equal(existsSync(sidecar), false);
  const drained = record("FAFF-2");
  assert.equal(drained.code, 0, drained.stderr);
  assert.equal(JSON.parse(drained.stdout).owner_status, "done");
  const saved = readFileSync(sidecar, "utf8");
  assert.doesNotMatch(saved, /private fixture text/);
  const snapshot = JSON.parse(saved);
  assert.equal(snapshot.schema, 1);
  assert.equal(Object.keys(snapshot.epochs).length, 1);
  const [epoch] = Object.values(snapshot.epochs);
  assert.equal(epoch.records.length, 1);
  assert.equal(epoch.records[0].usage.cache_read, 7);
});


test("beep-boop close captures one request on retry and ignores a refused close", (t) => {
  const { root, runDir, env, transcript, sidecar } = fixture(t, "L3", ["FAFF-1"]);
  const invoke = (args) => runCli(args, { cwd: root, env });
  const close = () => invoke(["run", "close", "--run-dir", runDir, "--root", root, "--stop-reason", "queue-drained", "--json"]);
  assert.equal(close().code, 3);
  assert.equal(existsSync(sidecar), false);
  const record = invoke(["run-ledger", "record-outcome", "--issue", "FAFF-1", "--outcome", "parked", "--run-dir", runDir, "--root", root]);
  assert.equal(record.code, 0, record.stderr);
  assert.equal(existsSync(sidecar), false);
  for (let i = 0; i < 2; i++) {
    const result = close();
    assert.equal(result.code, 0, result.stderr);
    const { epochs } = JSON.parse(readFileSync(sidecar, "utf8"));
    assert.equal(Object.keys(epochs).length, 1);
    assert.equal(Object.values(epochs)[0].records.length, 1);
    if (i === 0) {
      const unrelated = JSON.parse(readFileSync(transcript, "utf8"));
      unrelated.message.id = "msg_after_close";
      unrelated.timestamp = new Date().toISOString();
      appendFileSync(transcript, JSON.stringify(unrelated) + "\n");
    }
  }
});
