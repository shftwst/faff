// FAFF-387 — two-file merged config resolution (.faffrc.local.yaml overlay over
// .faffrc.yaml base over DEFAULTS) + `faff config check` + `config path`/`resolved`.
// Exercised through the REAL CLI on the filesystem, so the whole read path is covered
// (findConfig/findOverlay → deepMergeConfig → dig), not just the pure helpers.
//
// Back-compat is load-bearing: the no-overlay cases assert byte-for-byte the
// pre-FAFF-387 single-file behaviour (the existing config tests stay green unchanged;
// this file adds the explicit back-compat assertion the spec's §8 DONE requires).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(cwd, ...args) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString() };
  }
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

// A plain (non-git) tmp dir with the given files written.
function plainDir({ base, overlay } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "faff387-"));
  if (base != null) writeFileSync(join(dir, ".faffrc.yaml"), base);
  if (overlay != null) writeFileSync(join(dir, ".faffrc.local.yaml"), overlay);
  return dir;
}

// A real git repo (findRoot anchors on .git; posture probes need a repo) with files.
function gitDir({ base, overlay, gitignore, commitBase } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "faff387g-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.test");
  git(dir, "config", "user.name", "t");
  if (gitignore != null) writeFileSync(join(dir, ".gitignore"), gitignore);
  if (base != null) writeFileSync(join(dir, ".faffrc.yaml"), base);
  if (overlay != null) writeFileSync(join(dir, ".faffrc.local.yaml"), overlay);
  if (commitBase) { git(dir, "add", ".faffrc.yaml"); if (gitignore != null) git(dir, "add", ".gitignore"); git(dir, "commit", "-q", "-m", "init"); }
  return dir;
}

// ---------------------------------------------------------------------------
// Merge semantics
// ---------------------------------------------------------------------------

test("merge: overlay overrides a nested leaf; the sibling leaf still resolves from base", () => {
  const dir = plainDir({
    base: "slots:\n  spec: base-spec\n  review: base-review\n",
    overlay: "slots:\n  review: overlay-review\n",
  });
  try {
    assert.equal(run(dir, "config", "get", "slots.review").out, "overlay-review", "overridden leaf ← overlay");
    assert.equal(run(dir, "config", "get", "slots.spec").out, "base-spec", "sibling leaf ← base");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("merge: overlay replaces a sequence WHOLESALE (never element-merged)", () => {
  const dir = plainDir({
    base: "hosts:\n  - alpha\n  - beta\n  - gamma\n",
    overlay: "hosts:\n  - only\n",
  });
  try {
    assert.deepEqual(JSON.parse(run(dir, "config", "get", "--json", "hosts").out), ["only"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("merge: an overlay-only key is added; a base-only key survives", () => {
  const dir = plainDir({
    base: "appetite: high\n",
    overlay: "logging: essential\n",
  });
  try {
    assert.equal(run(dir, "config", "get", "appetite").out, "high");
    assert.equal(run(dir, "config", "get", "logging").out, "essential");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("overlay-only, no base file → valid (all-overlay config), exit 0", () => {
  const dir = plainDir({ overlay: "appetite: low\n" });
  try {
    assert.equal(run(dir, "config", "get", "appetite").out, "low");
    const p = run(dir, "config", "path");
    assert.equal(p.code, 0);
    assert.match(p.out, /\.faffrc\.local\.yaml$/, "path prints the overlay");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Back-compat: no overlay → byte-for-byte the single-file behaviour
// ---------------------------------------------------------------------------

test("back-compat: no overlay → config get / dump identical to single-file behaviour", () => {
  const yaml = "slots:\n  spec: x\n  review: y\nappetite: full\n";
  const dir = plainDir({ base: yaml });
  try {
    assert.equal(run(dir, "config", "get", "slots.spec").out, "x");
    assert.equal(run(dir, "config", "get", "appetite").out, "full");
    // dump is the parsed base document, unchanged.
    assert.deepEqual(JSON.parse(run(dir, "config", "dump").out), { slots: { spec: "x", review: "y" }, appetite: "full" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("back-compat: no overlay → `config path` is a single line; `config resolved` has NO `config local:` line", () => {
  const dir = plainDir({ base: "slots:\n  spec: x\n" });
  try {
    const p = run(dir, "config", "path");
    assert.equal(p.out.split("\n").length, 1, "single line");
    assert.match(p.out, /\.faffrc\.yaml$/);
    const r = run(dir, "config", "resolved");
    assert.doesNotMatch(r.out, /config local:/, "no overlay line when no overlay");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("neither file → config path exit 3 (first-run offer semantics preserved)", () => {
  const dir = plainDir({});
  try {
    assert.equal(run(dir, "config", "path").code, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// config path multi-line + config resolved both paths
// ---------------------------------------------------------------------------

test("config path is multi-line (base first, overlay second) when both exist", () => {
  const dir = plainDir({ base: "appetite: high\n", overlay: "appetite: low\n" });
  try {
    const lines = run(dir, "config", "path").out.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /\.faffrc\.yaml$/);
    assert.match(lines[1], /\.faffrc\.local\.yaml$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config resolved echoes both `config:` and `config local:` paths", () => {
  const dir = plainDir({ base: "appetite: high\n", overlay: "appetite: low\n" });
  try {
    const r = run(dir, "config", "resolved");
    assert.match(r.out, /config:\s+.*\.faffrc\.yaml/);
    assert.match(r.out, /config local:\s+.*\.faffrc\.local\.yaml/);
    assert.match(r.out, /appetite: low/, "resolved appetite is the merged (overlay) value");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Overlay parse error → LOUD exit 2 (never a silent skip)
// ---------------------------------------------------------------------------

test("overlay that is a top-level sequence (malformed) → exit 2 on every read path", () => {
  const dir = plainDir({ base: "slots:\n  spec: x\n", overlay: "- a\n- b\n" });
  try {
    for (const sub of [["config", "get", "slots.spec"], ["config", "dump"], ["config", "resolved"], ["config", "check"]]) {
      const r = run(dir, ...sub);
      assert.equal(r.code, 2, `${sub.join(" ")} → exit 2`);
      assert.match(r.err, /parse/i, "loud stderr names the parse failure");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("comment-only / empty overlay is allowed (valid no-op overlay), exit 0", () => {
  const dir = plainDir({ base: "appetite: high\n", overlay: "# just a comment\n" });
  try {
    assert.equal(run(dir, "config", "get", "appetite").out, "high");
    assert.equal(run(dir, "config", "get", "appetite").code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("legacy-shaped overlay name (.faffrc.local.yml) → loud exit 2, never a silent load", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff387l-"));
  try {
    writeFileSync(join(dir, ".faffrc.yaml"), "appetite: high\n");
    writeFileSync(join(dir, ".faffrc.local.yml"), "appetite: low\n");
    const r = run(dir, "config", "get", "appetite");
    assert.equal(r.code, 2);
    assert.match(r.err, /legacy overlay/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// config check — posture, secret redaction, exit codes
// ---------------------------------------------------------------------------

test("config check --selftest passes (secret + merge + posture tables)", () => {
  const dir = plainDir({});
  try { assert.equal(run(dir, "config", "check", "--selftest").code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: base present but untracked → exit 1 with a posture finding + the 3 migration steps", () => {
  const dir = gitDir({ base: "slots:\n  spec: x\n" }); // written, NOT committed
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /unmigrated|untracked|uncommitted/i);
    assert.match(r.out, /Move machine-local values/);
    assert.match(r.out, /drop the `\.faffrc\.yaml` line/);
    assert.match(r.out, /commit \.faffrc\.yaml/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: base committed + overlay ignored → clean, exit 0", () => {
  const dir = gitDir({
    base: "slots:\n  spec: x\n",
    overlay: "appetite: low\n",
    gitignore: ".faffrc.local.yaml\n",
    commitBase: true,
  });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 0, r.out + r.err);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: overlay present but NOT git-ignored → hygiene finding, exit 1", () => {
  const dir = gitDir({
    base: "slots:\n  spec: x\n",
    overlay: "appetite: low\n",
    gitignore: "# empty\n",
    commitBase: true,
  });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /NOT git-ignored/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: a secret in the BASE file → exit 1, REDACTED (raw value NEVER in output)", () => {
  const RAW = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
  const dir = gitDir({
    base: "adversarial:\n  api_key: " + RAW + "\n",
    gitignore: ".faffrc.local.yaml\n",
    commitBase: true,
  });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    // the finding names the key path + length + 4-char prefix only.
    assert.match(r.out, /adversarial\.api_key/);
    assert.match(r.out, /len=\d+/);
    // THE LOAD-BEARING ASSERTION: the raw value appears NOWHERE in stdout OR stderr.
    assert.ok(!r.out.includes(RAW), "raw secret must not appear in stdout");
    assert.ok(!r.err.includes(RAW), "raw secret must not appear in stderr");
    // and the tail past the 4-char prefix is never echoed.
    assert.ok(!r.out.includes("abcdefghij"), "no substring past the 4-char prefix");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: secret redaction holds under --json too (raw value absent)", () => {
  const RAW = "ghp_ZZZZZZZZ0123456789abcdefghijklmn";
  const dir = gitDir({ base: "token: " + RAW + "\n", gitignore: ".faffrc.local.yaml\n", commitBase: true });
  try {
    const r = run(dir, "config", "check", "--json");
    assert.equal(r.code, 1);
    assert.ok(!r.out.includes(RAW), "raw secret absent from JSON output");
    const parsed = JSON.parse(r.out);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.findings.some((f) => /token/.test(f.surface)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: not a git repo → posture checks skipped (reported), parse/secret still run, exit 0 when clean", () => {
  const dir = plainDir({ base: "slots:\n  spec: x\n" }); // no .git
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 0);
    assert.match(r.out, /skip.*not a git repo/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: not a git repo BUT a secret present → still exit 1 (secret scan runs regardless)", () => {
  const RAW = "AKIAIOSFODNN7EXAMPLE";
  const dir = plainDir({ base: "aws_key: " + RAW + "\n" });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.ok(!r.out.includes(RAW), "raw secret absent");
    assert.match(r.out, /skip.*not a git repo/i, "posture still reported skipped");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: no config at all → exit 0 (defaults)", () => {
  const dir = gitDir({});
  try { assert.equal(run(dir, "config", "check").code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: a *_env value is NOT flagged (name-indirection is exempt by design)", () => {
  const dir = gitDir({
    base: "adversarial:\n  api_key_env: NVIDIA_API_KEY\n  host: https://integrate.api.nvidia.com/v1\n",
    gitignore: ".faffrc.local.yaml\n",
    commitBase: true,
  });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 0, "no secret finding for api_key_env / host: " + r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Scenario 1 — the 2026-07-01 failure mode is recoverable + detectable
// ---------------------------------------------------------------------------

test("scenario: a committed base survives a wholesale rewrite — diff visible, checkout restores", () => {
  const dir = gitDir({
    base: "slots:\n  review: faffter-dark-adversarial-review\n  spec: faffter-dark-nlspec\nappetite: high\n",
    gitignore: ".faffrc.local.yaml\n",
    commitBase: true,
  });
  try {
    // A wholesale agent rewrite drops the review slot (the real 2026-07-01 corruption shape).
    writeFileSync(join(dir, ".faffrc.yaml"), "slots:\n  spec: faffter-dark-nlspec\nappetite: high\n");
    // Drift is DETECTABLE: git sees a modification.
    const status = git(dir, "status", "--porcelain", ".faffrc.yaml");
    assert.match(status, /^\s*M\s+\.faffrc\.yaml/m, "wholesale rewrite shows as a working-tree diff");
    // and RECOVERABLE: checkout restores the dropped slot.
    git(dir, "checkout", "--", ".faffrc.yaml");
    assert.equal(run(dir, "config", "get", "slots.review").out, "faffter-dark-adversarial-review");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Integration smoke test (spec §8)
// ---------------------------------------------------------------------------

test("integration smoke: merge → check exit 1 (untracked) → commit → check exit 0 → secret → check exit 1 redacted", () => {
  const dir = gitDir({
    base: "adversarial:\n  host: http://base.test\n",
    overlay: "adversarial:\n  host: http://overlay.test\n",
    gitignore: ".faffrc.local.yaml\n",
  });
  try {
    // merge plumbing connected: overlay wins the nested leaf.
    assert.equal(run(dir, "config", "get", "adversarial.host").out, "http://overlay.test");
    // posture check connected: base is untracked → exit 1.
    assert.equal(run(dir, "config", "check").code, 1);
    // commit the base → clean posture.
    git(dir, "add", ".faffrc.yaml", ".gitignore");
    git(dir, "commit", "-q", "-m", "commit base");
    assert.equal(run(dir, "config", "check").code, 0);
    // append a secret to the base → exit 1, output redacted.
    const RAW = "token: nvapi-0123456789abcdefghijklmnopqrstuv";
    appendFileSync(join(dir, ".faffrc.yaml"), RAW + "\n");
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.ok(!r.out.includes("nvapi-0123456789abcdefghijklmnopqrstuv"), "raw secret redacted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
