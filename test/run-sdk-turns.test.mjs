import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runCli, faffBin } from "./helpers/run-cli.mjs";

const { sdkTurnReceipts } = createRequire(import.meta.url)("../plugin/skills/faff/bin/lib/run-sdk-turns.js");

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "faff-sdk-turns-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const id = randomUUID(), runId = dir.split("/").at(-1);
  const ledger = { run_id: runId, budget: { measure_session_id: id } };
  const saveLedger = () => writeFileSync(join(dir, "run-ledger.json"), JSON.stringify(ledger));
  saveLedger();
  const env = { ...process.env, FAFF_RUN_DIR: dir, CLAUDE_CODE_SESSION_ID: id };
  const result = { type: "result", subtype: "success", is_error: false, session_id: id, num_turns: 9, result: "operator answer", usage: { secret: "private" } };
  const record = (envelope = result, session = id) => runCli(["economics", "--record-claude-result"], {
    cwd: dir, env: { ...env, CLAUDE_CODE_SESSION_ID: session }, input: JSON.stringify(envelope),
  });
  return { dir, env, id, ledger, saveLedger, record, result };
}

test("fresh print receipt retains turn count only, survives repeat and excludes competing counts", (t) => {
  const f = fixture(t);
  const first = f.record();
  assert.equal(first.code, 0);
  assert.equal(first.stdout, "operator answer\n");
  assert.equal(first.stderr, "");
  assert.equal(f.record().stderr, "");
  assert.match(f.record({ ...f.result, num_turns: 18 }).stderr, /unavailable/);
  const stored = readFileSync(join(f.dir, "sdk-turns-0.json"), "utf8");
  assert.doesNotMatch(stored, /operator answer|private|usage/);
  assert.deepEqual(sdkTurnReceipts(f.dir, f.ledger), { turns: 9, observed_turns: 9, observed_epochs: 1, expected_epochs: 1 });
  const next = randomUUID();
  f.ledger.budget.sessions = [{ session_id: f.id }, { session_id: next }];
  f.saveLedger();
  assert.deepEqual(sdkTurnReceipts(f.dir, f.ledger), { turns: null, observed_turns: 9, observed_epochs: 1, expected_epochs: 2 });
  assert.equal(f.record({ ...f.result, session_id: next, num_turns: 3 }, next).stderr, "");
  assert.equal(sdkTurnReceipts(f.dir, f.ledger).turns, 12);
});

test("missing coverage, foreign result, invalid count, and wrong terminal type remain unavailable", (t) => {
  const f = fixture(t);
  const foreign = randomUUID();
  for (const envelope of [{ ...f.result, type: "assistant" }, { ...f.result, session_id: foreign }, { ...f.result, num_turns: -1 }]) {
    assert.match(f.record(envelope).stderr, /unavailable/);
  }
  assert.match(f.record({ ...f.result, session_id: foreign }, foreign).stderr, /unavailable/);
  assert.deepEqual(readdirSync(f.dir), ["run-ledger.json"]);
  assert.equal(sdkTurnReceipts(f.dir, f.ledger).turns, null);
});

test("watcher pipe preserves Claude exit and emits only the original final text", (t) => {
  const f = fixture(t);
  const pipeline = 'set -o pipefail\n(printf "%s" "$FIXTURE_ENVELOPE"; exit "$FIXTURE_STATUS") | node "$FAFF_BIN" economics --record-claude-result';
  for (const status of [0, 7]) {
    const result = spawnSync("bash", ["-c", pipeline], { encoding: "utf8", cwd: f.dir, env: {
      ...f.env, FAFF_BIN: faffBin, FIXTURE_STATUS: String(status), FIXTURE_ENVELOPE: JSON.stringify(f.result),
    } });
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, "operator answer\n");
  }
});
