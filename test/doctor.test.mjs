// FAFF-190 — `faff doctor` install-health: detects copy-installs (stale risk) vs symlinks (live).
// Reads the filesystem, so it works even from a stale installed bin. Tested against fixture targets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(...args) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString() }; }
}

test("doctor: a symlinked install is clean (exit 0, live)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-ok-"));
  try {
    symlinkSync("/tmp", join(dir, "faff-graft"));
    symlinkSync("/tmp", join(dir, "faffter-noon-review"));
    const r = run("doctor", "--target", dir);
    assert.equal(r.code, 0);
    assert.match(r.out, /repo is live/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("doctor: a copy install is flagged (exit 1, names the skill + the fix)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-copy-"));
  try {
    mkdirSync(join(dir, "faff-graft"));        // real dir = copy
    symlinkSync("/tmp", join(dir, "faff-prep")); // mixed: one symlink
    const r = run("doctor", "--target", dir);
    assert.equal(r.code, 1, "exit non-zero when any skill is a copy");
    assert.match(r.out, /faff-graft\s+COPY/);
    assert.match(r.out, /link-skills\.sh --global --replace/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("doctor: ignores non-faff dirs", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-mix-"));
  try {
    mkdirSync(join(dir, "some-other-skill"));   // not faff-family → ignored
    symlinkSync("/tmp", join(dir, "faff"));      // the only faff skill, live
    const r = run("doctor", "--target", dir);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /some-other-skill/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("doctor: a target with no faff skills is a usage error (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-empty-"));
  try { assert.equal(run("doctor", "--target", dir).code, 2); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
