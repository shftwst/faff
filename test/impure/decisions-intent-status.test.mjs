// FAFF-929 — `faff decisions intent-status`: the deterministic marker classifier faff-prep's
// reconcile step and faff-graft Step 4c's materialise guard both shell out to, so the two can
// never fork on what "superseded" means. Mirrors test/decisions.test.mjs's real-BIN spawn shape
// (via the shared runCli helper) over fixture comment bodies, asserting the 0/1/2 exits + JSON
// shape end-to-end through the real CLI entrypoint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../helpers/run-cli.mjs";

const LIVE_INTENT =
  "## Decisions-register intent\n" +
  "- topic: pino vs winston\n" +
  "- Chosen: pino\n" +
  "- Rationale: house structured-JSON logger.\n" +
  "- Scope: all backend services.\n" +
  "- Matches: pino vs winston\n";

const SUPERSEDED_INTENT =
  LIVE_INTENT + "\n> Superseded 2026-09-01 (FAFF-929): design dropped the sha256 digest\n";

const SUFFIX_ONLY_INTENT =
  "## Decisions-register intent (superseded)\n- topic: portable spec-revision identity\n- Chosen: sha256 digest\n";

const NOT_INTENT = "## ADR promotion intent\n- Decision: use pino\n";

function writeFixture(dir, name, body) {
  const p = path.join(dir, name);
  writeFileSync(p, body);
  return p;
}

test("intent-status --file: a live intent (no marker line) exits 0 and prints live", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "faff929-intent-"));
  try {
    const file = writeFixture(dir, "live.md", LIVE_INTENT);
    const { stdout, code } = runCli(["decisions", "intent-status", "--file", file]);
    assert.equal(code, 0, stdout);
    assert.equal(stdout.trim(), "live");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("intent-status --file --json: a live intent emits {kind:\"intent\",status:\"live\"}", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "faff929-intent-"));
  try {
    const file = writeFixture(dir, "live.md", LIVE_INTENT);
    const { stdout, code } = runCli(["decisions", "intent-status", "--file", file, "--json"]);
    assert.equal(code, 0, stdout);
    assert.deepEqual(JSON.parse(stdout), { kind: "intent", status: "live" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("intent-status --file: a `> Superseded ...` marker line exits 1 and prints superseded", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "faff929-intent-"));
  try {
    const file = writeFixture(dir, "superseded.md", SUPERSEDED_INTENT);
    const { stdout, code } = runCli(["decisions", "intent-status", "--file", file]);
    assert.equal(code, 1, stdout);
    assert.equal(stdout.trim(), "superseded");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("intent-status --file --json: superseded emits {kind:\"intent\",status:\"superseded\"}", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "faff929-intent-"));
  try {
    const file = writeFixture(dir, "superseded.md", SUPERSEDED_INTENT);
    const { stdout, code } = runCli(["decisions", "intent-status", "--file", file, "--json"]);
    assert.equal(code, 1, stdout);
    assert.deepEqual(JSON.parse(stdout), { kind: "intent", status: "superseded" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("intent-status --file: a '(superseded)' heading suffix ALONE (no marker line) is still live — the marker line, not the suffix, is authoritative", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "faff929-intent-"));
  try {
    const file = writeFixture(dir, "suffix-only.md", SUFFIX_ONLY_INTENT);
    const { stdout, code } = runCli(["decisions", "intent-status", "--file", file, "--json"]);
    assert.equal(code, 0, stdout);
    assert.deepEqual(JSON.parse(stdout), { kind: "intent", status: "live" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("intent-status --file: an unrelated comment (e.g. ADR promotion intent) exits 2, not-intent", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "faff929-intent-"));
  try {
    const file = writeFixture(dir, "not-intent.md", NOT_INTENT);
    const { stdout, code } = runCli(["decisions", "intent-status", "--file", file]);
    assert.equal(code, 2, stdout);
    assert.equal(stdout.trim(), "not-intent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("intent-status --file --json: not-intent emits {kind:\"not-intent\",status:null}", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "faff929-intent-"));
  try {
    const file = writeFixture(dir, "not-intent.md", NOT_INTENT);
    const { stdout, code } = runCli(["decisions", "intent-status", "--file", file, "--json"]);
    assert.equal(code, 2, stdout);
    assert.deepEqual(JSON.parse(stdout), { kind: "not-intent", status: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("intent-status: reads the body from stdin when --file is omitted", () => {
  const { stdout, code } = runCli(["decisions", "intent-status"], { input: SUPERSEDED_INTENT });
  assert.equal(code, 1, stdout);
  assert.equal(stdout.trim(), "superseded");
});

test("intent-status --file: an unreadable path exits 2 with a clear stderr message, never a crash", () => {
  const { stderr, code } = runCli(["decisions", "intent-status", "--file", "/nonexistent/faff929-fixture.md"]);
  assert.equal(code, 2);
  assert.match(stderr, /cannot read/);
});
