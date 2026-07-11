// FAFF-200 — `faff sync`: the skill-owned repair that re-links a stale copy-install.
// It's a thin wrapper over scripts/link-skills.sh --global --replace, so these tests
// drive it against a STUB script (via --script) — never the real one, so nothing under
// ~/.claude is ever touched. The stub records its argv and exits with a chosen code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env = {}, opts = {}) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env }, ...opts }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() }; }
}

// FAFF-204: build a temp "repo" with a .git marker and a stub scripts/link-skills.sh,
// so default (no --script) resolution from cwd can be exercised without touching ~/.claude.
function mkRepo({ anchor = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sync-repo-"));
  if (anchor) mkdirSync(join(dir, ".git"));
  mkdirSync(join(dir, "scripts"));
  const script = join(dir, "scripts", "link-skills.sh");
  writeFileSync(script, `#!/usr/bin/env bash\nif [ -n "$FAFF_STUB_LOG" ]; then echo "$@" > "$FAFF_STUB_LOG"; fi\nexit \${FAFF_STUB_EXIT:-0}\n`);
  chmodSync(script, 0o755);
  return { dir, script };
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

// ---- FAFF-204: default (no --script) resolution from the cwd/repo anchor ----

test("sync: default resolution finds <repo>/scripts/link-skills.sh from cwd (no --script), runs it", () => {
  const { dir, script } = mkRepo();
  const log = join(dir, "argv.txt");
  try {
    // cwd = the temp repo; .git anchor → findRoot lands on dir → resolves dir/scripts/link-skills.sh.
    const r = run(["sync", "--dry-run", "--json"], { FAFF_STUB_LOG: log }, { cwd: dir });
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.script, script);
    assert.equal(j.dry_run, true);
    assert.equal(j.ran, false);
    assert.match(readFileSync(log, "utf8"), /--global --replace --dry-run/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sync: default resolution resolves from a SUBDIR of the repo (findRoot walks up to the anchor)", () => {
  const { dir, script } = mkRepo();
  const sub = join(dir, "a", "b");
  mkdirSync(sub, { recursive: true });
  try {
    const r = run(["sync", "--dry-run", "--json"], {}, { cwd: sub });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).script, script);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sync: no readable candidate → exit 2, stderr names every path tried (no anchor, no self-repo)", () => {
  // To exercise the fail-loud branch BOTH strategies must miss. Run a COPY of the CLI
  // from an isolated dir (so the self-walk four-up has no scripts/link-skills.sh) with
  // cwd = a dir that has no .git/.faff anchor and no scripts/link-skills.sh either.
  const cliDir = mkdtempSync(join(tmpdir(), "sync-cli-"));
  const cwdDir = mkdtempSync(join(tmpdir(), "sync-noanchor-"));
  const cliCopy = join(cliDir, "faff");
  // FAFF-441: the CLI is now an entrypoint + sibling bin/lib modules, so an isolated
  // copy must bring the whole bin/ tree (a lone-file copy can't require its modules).
  cpSync(dirname(CLI), cliDir, { recursive: true });
  try {
    const r = (() => {
      try { return { code: 0, out: execFileSync("node", [cliCopy, "sync"], { encoding: "utf8", cwd: cwdDir }) }; }
      catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() }; }
    })();
    assert.equal(r.code, 2);
    assert.match(r.err ?? "", /cannot find link-skills\.sh \(tried: /);
    // names the cwd-anchored candidate (Strategy 1) explicitly
    assert.match(r.err ?? "", new RegExp(join(cwdDir, "scripts", "link-skills.sh").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally { rmSync(cliDir, { recursive: true, force: true }); rmSync(cwdDir, { recursive: true, force: true }); }
});
