// FAFF-200 — `faff sync`: the skill-owned repair that re-links a stale copy-install.
// It's a thin wrapper over scripts/link-skills.sh --global --replace, so these tests
// drive it against a STUB script (via --script) — never the real one, so nothing under
// ~/.claude is ever touched. The stub records its argv and exits with a chosen code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env = {}) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() }; }
}

// Write a stub link-skills.sh that records its argv (FAFF_STUB_LOG) and exits FAFF_STUB_EXIT.
function mkStub() {
  const dir = mkdtempSync(join(tmpdir(), "sync-stub-"));
  const script = join(dir, "link-skills.sh");
  writeFileSync(script, `#!/usr/bin/env bash\nif [ -n "$FAFF_STUB_LOG" ]; then echo "$@" > "$FAFF_STUB_LOG"; fi\nexit \${FAFF_STUB_EXIT:-0}\n`);
  chmodSync(script, 0o755);
  return { dir, script };
}

test("sync: --dry-run --json reports ran:false / dry_run:true, exit 0, names the script", () => {
  const { dir, script } = mkStub();
  try {
    const r = run(["sync", "--dry-run", "--json", "--script", script]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.ran, false);
    assert.equal(j.dry_run, true);
    assert.equal(j.ok, true);
    assert.equal(j.exit, 0);
    assert.equal(j.script, script);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sync: --json shape on a real (non-dry) run is { script, ran, dry_run, exit, ok }", () => {
  const { dir, script } = mkStub();
  try {
    const r = run(["sync", "--json", "--script", script]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.deepEqual(Object.keys(j).sort(), ["dry_run", "exit", "ok", "ran", "script"]);
    assert.equal(j.ran, true);
    assert.equal(j.dry_run, false);
    assert.equal(j.ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sync: a missing/unreadable script fails loud on stderr and exits 2 (never a silent no-op)", () => {
  const r = run(["sync", "--script", "/nonexistent/path/link-skills.sh"]);
  assert.equal(r.code, 2);
  assert.match(r.err ?? "", /cannot find link-skills\.sh/);
});

test("sync: the script's non-zero exit is passed through (1→1, 2→2), never swallowed to 0", () => {
  const { dir, script } = mkStub();
  try {
    assert.equal(run(["sync", "--json", "--script", script], { FAFF_STUB_EXIT: "1" }).code, 1);
    assert.equal(run(["sync", "--json", "--script", script], { FAFF_STUB_EXIT: "2" }).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sync: passes --global --replace to the script, and --dry-run only when asked", () => {
  const { dir, script } = mkStub();
  const log = join(dir, "argv.txt");
  try {
    run(["sync", "--dry-run", "--script", script], { FAFF_STUB_LOG: log });
    assert.match(readFileSync(log, "utf8"), /--global --replace --dry-run/);

    run(["sync", "--script", script], { FAFF_STUB_LOG: log });
    const argv = readFileSync(log, "utf8");
    assert.match(argv, /--global --replace/);
    assert.doesNotMatch(argv, /--dry-run/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
