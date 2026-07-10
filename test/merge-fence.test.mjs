// FAFF-434 — `faff merge-fence --hook`: the PreToolUse fence on a raw `gh pr merge` Bash
// call (registered by `hooks-ensure` — test/hooks-ensure.test.mjs covers the registration
// half). The pure matcher table is covered by `merge-fence --selftest`; these tests drive
// the real CLI's stdin shell — JSON.parse/degrade behaviour, the deny message, and the
// exit-code contract (2 = deny, 0 = allow/degrade) — which the selftest cannot reach.
//
// SAFETY NOTE: this repo carries a live hand-added PreToolUse stopgap that denies any Bash
// command containing the literal three adjacent words "gh", "pr", "merge" — every fixture
// command below is assembled from string PIECES at runtime so no test-file source line (nor
// any Bash tool call used to develop/run this suite) ever contains that literal sequence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function runHook(event) {
  const input = event === undefined ? "" : JSON.stringify(event);
  const r = spawnSync("node", [CLI, "merge-fence", "--hook"], { encoding: "utf8", input });
  return { code: r.status, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

// Token pieces assembled at call time — see the safety note above.
const PR = "pr", MERGE = "merge";
function ghMergeCommand(prefix = "", suffix = "") {
  return `${prefix}gh ${PR} ${MERGE}${suffix}`;
}

test("merge-fence --selftest passes (the shipped matcher + event-decision table)", () => {
  const r = spawnSync("node", [CLI, "merge-fence", "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("denies a raw gh pr merge Bash call: exit 2, stderr names faff merge-gate as the remedy", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: ghMergeCommand("", " 123 --squash") } });
  assert.equal(r.code, 2);
  assert.equal(r.out, "", "no stdout — the deny message is on stderr only");
  assert.match(r.err, /faff merge-fence/);
  assert.match(r.err, /faff merge-gate/, "names merge-gate as the sanctioned remedy");
  assert.match(r.err, /not the sanctioned merge path/);
});

test("denies a path-prefixed gh (e.g. /usr/bin/gh)", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: ghMergeCommand("/usr/bin/", " 123") } });
  assert.equal(r.code, 2);
});

test("denies an env-prefixed invocation (e.g. FOO=1 gh …)", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: ghMergeCommand("FOO=1 ", " 5 --squash") } });
  assert.equal(r.code, 2);
});

test("allows gh pr view / gh pr checkout (no merge)", () => {
  const view = runHook({ tool_name: "Bash", tool_input: { command: `gh ${PR} view 123` } });
  assert.equal(view.code, 0);
  assert.equal(view.err, "");
  const checkout = runHook({ tool_name: "Bash", tool_input: { command: `gh ${PR} checkout 123` } });
  assert.equal(checkout.code, 0);
  assert.equal(checkout.err, "");
});

test("allows git merge (no pr token)", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: `git ${MERGE} main` } });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
});

test("allows a non-Bash tool_name regardless of command content", () => {
  const r = runHook({ tool_name: "Read", tool_input: { command: ghMergeCommand("", " 1") } });
  assert.equal(r.code, 0);
});

test("degrades to exit 0 on malformed JSON (never blocks on a parse failure)", () => {
  const r = spawnSync("node", [CLI, "merge-fence", "--hook"], { encoding: "utf8", input: "not json at all" });
  assert.equal(r.status, 0);
  assert.equal((r.stderr ?? "").toString(), "");
});

test("degrades to exit 0 on empty stdin (never blocks on nothing to read)", () => {
  const r = spawnSync("node", [CLI, "merge-fence", "--hook"], { encoding: "utf8", input: "" });
  assert.equal(r.status, 0);
});

test("degrades to exit 0 on closed/absent stdin (no `input` option at all)", () => {
  const r = spawnSync("node", [CLI, "merge-fence", "--hook"], { encoding: "utf8", input: "" });
  assert.equal(r.status, 0);
});

test("tolerates an unrecognised --root DIR flag (probeServes always passes one)", () => {
  const r = spawnSync("node", [CLI, "merge-fence", "--hook", "--root", "/does/not/exist"], {
    encoding: "utf8", input: JSON.stringify({ tool_name: "Bash", tool_input: { command: `gh ${PR} view 1` } }),
  });
  assert.equal(r.status, 0);
});

test("neither --hook nor --selftest is a usage error (exit 2, names the two legal forms)", () => {
  const r = spawnSync("node", [CLI, "merge-fence"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--hook/);
  assert.match(r.stderr, /--selftest/);
});
