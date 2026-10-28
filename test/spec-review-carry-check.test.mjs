// FAFF-1271 — `faff spec-review carry-check` CLI wiring: the real entrypoint's flag parsing,
// file-read and exit-code behaviour, plus the `pathExists` root-containment checks that only a
// real filesystem (symlinks, absolute tokens, `..` escapes) can exercise. The pure classifier's
// own behaviour is covered by test/spec-refresh-carry.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { makePathExists } from "../plugin/skills/faff/bin/lib/spec-review.js";

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "faff-carry-cli-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const BEFORE = [
  "> Spec: faffter-dark-nlspec . 2026-10-10",
  "",
  "**Chosen:** see docs/design/x.md",
  "",
  "build-tier: standard",
  "confidence: high",
  "spec-review: approve",
].join("\n");

const AFTER = [
  "> Spec: faffter-dark-nlspec . 2026-10-14",
  "",
  "**Chosen:** see docs/archive/design/x.md",
  "",
  "> Revised on 2026-10-14: paths refreshed",
  "",
  "build-tier: complex",
  "confidence: high",
  "spec-review: approve",
].join("\n");

test("CLI carry-check: verified directory move → exit 0, one JSON line", () => {
  withTmp((dir) => {
    mkdirSync(join(dir, "docs", "archive", "design"), { recursive: true });
    writeFileSync(join(dir, "docs", "archive", "design", "x.md"), "x");
    const beforeFile = join(dir, "before.md");
    const afterFile = join(dir, "after.md");
    writeFileSync(beforeFile, BEFORE);
    writeFileSync(afterFile, AFTER);
    const r = runCli(["spec-review", "carry-check", "--before", beforeFile, "--after", afterFile, "--root", dir]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.carry, true);
    assert.equal(parsed.reason, "paths-only");
  });
});

test("CLI carry-check: --root defaults to the repo root (cwd) when omitted", () => {
  // The real spec file's old path is absent from the repo and the new one doesn't exist
  // either, so with no --root (defaulting to findRoot()) the move is unverified.
  withTmp((dir) => {
    const beforeFile = join(dir, "before.md");
    const afterFile = join(dir, "after.md");
    writeFileSync(beforeFile, BEFORE);
    writeFileSync(afterFile, AFTER);
    const r = runCli(["spec-review", "carry-check", "--before", beforeFile, "--after", afterFile]);
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.stdout).reason, "path-move-unverified");
  });
});

test("CLI carry-check: unreadable --before/--after → exit 2, nothing on stdout", () => {
  withTmp((dir) => {
    const afterFile = join(dir, "after.md");
    writeFileSync(afterFile, AFTER);
    const r = runCli(["spec-review", "carry-check", "--before", join(dir, "nope.md"), "--after", afterFile]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.length > 0);
  });
});

test("CLI carry-check: missing --before or --after → exit 2, nothing on stdout", () => {
  withTmp((dir) => {
    const afterFile = join(dir, "after.md");
    writeFileSync(afterFile, AFTER);
    const a = runCli(["spec-review", "carry-check", "--after", afterFile]);
    assert.equal(a.code, 2);
    assert.equal(a.stdout, "");
    const b = runCli(["spec-review", "carry-check"]);
    assert.equal(b.code, 2);
    assert.equal(b.stdout, "");
  });
});

test("CLI carry-check: pathExists — a symlink inside root pointing outside it counts as not existing", () => {
  withTmp((dir) => {
    // An outside target that genuinely exists on disk...
    const outside = mkdtempSync(join(tmpdir(), "faff-carry-outside-"));
    try {
      mkdirSync(join(outside, "design"), { recursive: true });
      writeFileSync(join(outside, "design", "x.md"), "x");
      // ...linked FROM inside root, so without the containment check it would resolve "real".
      mkdirSync(join(dir, "docs", "archive"), { recursive: true });
      symlinkSync(join(outside, "design"), join(dir, "docs", "archive", "design"));
      const beforeFile = join(dir, "before.md");
      const afterFile = join(dir, "after.md");
      writeFileSync(beforeFile, BEFORE);
      writeFileSync(afterFile, AFTER);
      const r = runCli(["spec-review", "carry-check", "--before", beforeFile, "--after", afterFile, "--root", dir]);
      // docs/design/x.md never existed under root either, so this is the ordinary
      // "neither side verified" unverified-move case — the symlink's realpath escaping
      // root must NOT be treated as the new path existing.
      assert.equal(r.code, 1);
      assert.equal(JSON.parse(r.stdout).reason, "path-move-unverified");
      assert.equal(JSON.parse(r.stdout).path_moves[0].verified, false);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
});

test("makePathExists: an absolute token counts as not existing, even one that is genuinely present", () => {
  withTmp((dir) => {
    // A file that genuinely exists at the absolute path the token names.
    mkdirSync(join(dir, "real"), { recursive: true });
    writeFileSync(join(dir, "real", "x.md"), "x");
    const pathExists = makePathExists(dir);
    assert.equal(pathExists(join(dir, "real", "x.md")), false);
  });
});

test("makePathExists: a '..' escape counts as not existing, even one that resolves to a real file above root", () => {
  withTmp((dir) => {
    mkdirSync(join(dir, "root"), { recursive: true });
    writeFileSync(join(dir, "outside.md"), "x"); // genuinely exists one level above `root`
    const pathExists = makePathExists(join(dir, "root"));
    assert.equal(pathExists("../outside.md"), false);
  });
});

test("makePathExists: a symlink inside root pointing outside it counts as not existing", () => {
  withTmp((dir) => {
    const outside = mkdtempSync(join(tmpdir(), "faff-carry-outside-"));
    try {
      writeFileSync(join(outside, "x.md"), "x");
      mkdirSync(join(dir, "root"), { recursive: true });
      symlinkSync(outside, join(dir, "root", "linked"));
      const pathExists = makePathExists(join(dir, "root"));
      assert.equal(pathExists("linked/x.md"), false);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
});

test("makePathExists: a genuine relative path under root exists, and root itself is never 'existing'", () => {
  withTmp((dir) => {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "x.md"), "x");
    const pathExists = makePathExists(dir);
    assert.equal(pathExists("docs/x.md"), true);
    assert.equal(pathExists("."), false); // root resolves to rel === "" — not itself "existing" as a move target
  });
});

// Adversarial-review finding (round 1, minor): every other test builds `root` straight from
// `mkdtempSync`, never through a symlink — on a host where the tmp dir itself is reached via a
// symlink (macOS's /var -> /private/var is the canonical case), a real path-move under a
// symlinked root must still resolve `pathExists` to true. `makePathExists` realpaths BOTH the
// root and the candidate before comparing, so this already works; this test makes that
// positive case explicit rather than leaving it to inference from the symlink-ESCAPE tests above.
test("makePathExists: a genuine move under a root reached THROUGH a symlink still resolves true", () => {
  withTmp((dir) => {
    const real = join(dir, "real-root");
    mkdirSync(join(real, "docs"), { recursive: true });
    writeFileSync(join(real, "docs", "x.md"), "x");
    const linkedRoot = join(dir, "linked-root");
    symlinkSync(real, linkedRoot);
    const pathExists = makePathExists(linkedRoot);
    assert.equal(pathExists("docs/x.md"), true);
  });
});

test("CLI carry-check: both paths exist → exit 1, path-move-unverified", () => {
  withTmp((dir) => {
    mkdirSync(join(dir, "docs", "design"), { recursive: true });
    mkdirSync(join(dir, "docs", "archive", "design"), { recursive: true });
    writeFileSync(join(dir, "docs", "design", "x.md"), "x");
    writeFileSync(join(dir, "docs", "archive", "design", "x.md"), "x");
    const beforeFile = join(dir, "before.md");
    const afterFile = join(dir, "after.md");
    writeFileSync(beforeFile, BEFORE);
    writeFileSync(afterFile, AFTER);
    const r = runCli(["spec-review", "carry-check", "--before", beforeFile, "--after", afterFile, "--root", dir]);
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.stdout).reason, "path-move-unverified");
  });
});

test("CLI carry-check: a content change (DONE item edit) → exit 1, content-changed", () => {
  withTmp((dir) => {
    const before = ["## 8. DONE", "", "- [ ] a done item", "", "build-tier: standard", "confidence: high", "spec-review: approve"].join("\n");
    const after = ["## 8. DONE", "", "- [ ] a DIFFERENT done item", "", "build-tier: standard", "confidence: high", "spec-review: approve"].join("\n");
    const beforeFile = join(dir, "before.md");
    const afterFile = join(dir, "after.md");
    writeFileSync(beforeFile, before);
    writeFileSync(afterFile, after);
    const r = runCli(["spec-review", "carry-check", "--before", beforeFile, "--after", afterFile, "--root", dir]);
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.stdout).reason, "content-changed");
  });
});

test("CLI: unknown verb message now lists carry-check; usage line names it on a bad arity", () => {
  const r = runCli(["spec-review", "nope"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /carry-check/);
});
