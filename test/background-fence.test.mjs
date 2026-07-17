// FAFF-491 — `faff background-fence --hook`: the PreToolUse fence on a self-backgrounded
// gate/test Bash call (registered by `hooks-ensure` — test/hooks-ensure.test.mjs covers the
// registration half). The pure matcher table is covered by `background-fence --selftest`;
// these tests drive the real CLI's stdin shell — JSON.parse/degrade behaviour, the deny
// message, and the exit-code contract (2 = deny, 0 = allow/degrade) — which the selftest
// cannot reach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function runHook(event) {
  const input = event === undefined ? "" : JSON.stringify(event);
  const r = spawnSync("node", [CLI, "background-fence", "--hook"], { encoding: "utf8", input });
  return { code: r.status, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

test("background-fence --selftest passes (the shipped matcher + event-decision table)", () => {
  const r = spawnSync("node", [CLI, "background-fence", "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("denies a backgrounded node --test call: exit 2, stderr names the foreground remedy", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: "node --test", run_in_background: true } });
  assert.equal(r.code, 2);
  assert.equal(r.out, "", "no stdout — the deny message is on stderr only");
  assert.match(r.err, /faff background-fence/);
  assert.match(r.err, /FOREGROUND/, "names the foreground remedy");
  assert.match(r.err, /never end a turn/i, "names the never-end-a-turn rule");
});

test("denies the ladder's quoted-variable form ('\"$faff\" gates run'), backgrounded", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: '"$faff" gates run --json', run_in_background: true } });
  assert.equal(r.code, 2);
});

test("denies npm test / npx vitest / pytest / cargo test / go test, backgrounded", () => {
  for (const command of ["npm test", "npx vitest run", "pytest -x", "cargo test", "go test ./..."]) {
    const r = runHook({ tool_name: "Bash", tool_input: { command, run_in_background: true } });
    assert.equal(r.code, 2, `expected deny for: ${command}`);
  }
});

test("allows the same gate commands in the foreground (run_in_background false or absent)", () => {
  const explicit = runHook({ tool_name: "Bash", tool_input: { command: "node --test", run_in_background: false } });
  assert.equal(explicit.code, 0);
  assert.equal(explicit.err, "");
  const absent = runHook({ tool_name: "Bash", tool_input: { command: "node --test" } });
  assert.equal(absent.code, 0);
  assert.equal(absent.err, "");
});

test("allows a backgrounded non-gate command (e.g. a dev server)", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: "npm run dev", run_in_background: true } });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
});

test("allows a non-Bash tool_name regardless of command content or run_in_background", () => {
  const r = runHook({ tool_name: "Read", tool_input: { command: "node --test", run_in_background: true } });
  assert.equal(r.code, 0);
});

test("allows a non-boolean run_in_background (e.g. the string \"true\") — strict boolean check", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: "node --test", run_in_background: "true" } });
  assert.equal(r.code, 0);
});

test("degrades to exit 0 on malformed JSON (never blocks on a parse failure)", () => {
  const r = spawnSync("node", [CLI, "background-fence", "--hook"], { encoding: "utf8", input: "not json at all" });
  assert.equal(r.status, 0);
  assert.equal((r.stderr ?? "").toString(), "");
});

test("degrades to exit 0 on empty stdin (never blocks on nothing to read)", () => {
  const r = spawnSync("node", [CLI, "background-fence", "--hook"], { encoding: "utf8", input: "" });
  assert.equal(r.status, 0);
});

test("degrades to exit 0 on closed/absent stdin (no `input` option at all)", () => {
  const r = spawnSync("node", [CLI, "background-fence", "--hook"], { encoding: "utf8", input: "" });
  assert.equal(r.status, 0);
});

test("tolerates an unrecognised --root DIR flag (probeServes always passes one)", () => {
  const r = spawnSync("node", [CLI, "background-fence", "--hook", "--root", "/does/not/exist"], {
    encoding: "utf8", input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm run dev", run_in_background: true } }),
  });
  assert.equal(r.status, 0);
});

// FAFF-530 — the Monitor arm: a gate/test command run under the Monitor tool is
// background-by-construction, so it is denied regardless of run_in_background, with
// its own remedy naming a FOREGROUND Bash call. The parallel executor's Monitor
// poll-loops / log-tails (non-gate commands) are never denied.
test("denies a gate/test command run under Monitor: exit 2, stderr names the foreground-Bash remedy", () => {
  const r = runHook({ tool_name: "Monitor", tool_input: { command: "node --test --watch tests/" } });
  assert.equal(r.code, 2);
  assert.equal(r.out, "", "no stdout — the deny message is on stderr only");
  assert.match(r.err, /faff background-fence/);
  assert.match(r.err, /Monitor/, "names Monitor as the wrong tool");
  assert.match(r.err, /FOREGROUND Bash/, "names the foreground-Bash remedy");
});

test("denies pytest / the quoted-ladder form under Monitor (no run_in_background conjunct)", () => {
  for (const command of ["pytest -x", '"$faff" gates run --json', "npm test"]) {
    const r = runHook({ tool_name: "Monitor", tool_input: { command } });
    assert.equal(r.code, 2, `expected deny for Monitor: ${command}`);
  }
});

test("allows a Monitor await-all poll loop / log tail (non-gate commands) — the orchestrator posture is untouched", () => {
  const poll = runHook({ tool_name: "Monitor", tool_input: { command: "until test -f .faff/runs/r1/done; do :; done" } });
  assert.equal(poll.code, 0);
  assert.equal(poll.err, "");
  const tail = runHook({ tool_name: "Monitor", tool_input: { command: "tail -f .faff/runs/r1/build.log" } });
  assert.equal(tail.code, 0);
});

test("allows a Monitor event with no/ws-mode command (fail-safe)", () => {
  assert.equal(runHook({ tool_name: "Monitor", tool_input: { ws: "wss://x" } }).code, 0);
  assert.equal(runHook({ tool_name: "Monitor", tool_input: {} }).code, 0);
});

test("neither --hook nor --selftest is a usage error (exit 2, names the two legal forms)", () => {
  const r = spawnSync("node", [CLI, "background-fence"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--hook/);
  assert.match(r.stderr, /--selftest/);
});
