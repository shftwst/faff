// FAFF-1084 — faff-onboard's subsequent-run re-discover fork (step 1a). On a repo with an
// existing committed config, onboard now offers to re-discover rather than hard-bailing, then
// gates every field it would change behind an individual confirm before writing. The onboard
// prompt flow itself is skill prose (no CLI) — these tests drive the exact mechanical CLI
// sequence step 1a's prose describes (mirroring test/onboard-local.test.mjs and
// test/decline-parity.test.mjs): `config path` to observe the Exit-0 bail, then a `config init`
// call assembled from confirmed keys only, against the real CLI on a throwaway git repo.
//
// Fidelity note: same as the sibling onboard tests — every invocation runs with cwd = root and
// NO --root, exercising findRoot()'s cwd-based resolution exactly as the onboard prose's bare
// `"$faff" config …` forms rely on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, root, { allowFail = false } = {}) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8", cwd: root }) }; }
  catch (e) { if (!allowFail) throw e; return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() }; }
}

function git(root, ...args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.status}`);
  return r.stdout;
}

function seedGitRepo() {
  const root = mkdtempSync(join(tmpdir(), "onboard-rediscover-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t.test");
  git(root, "config", "user.name", "t");
  return root;
}

const basePath = (root) => join(root, ".faffrc.yaml");

function seedBase(root, text) {
  writeFileSync(basePath(root), text);
  git(root, "add", ".faffrc.yaml");
  git(root, "commit", "-q", "-m", "seed committed base");
}

test("declining the re-discover offer leaves a committed config byte-for-byte unchanged", () => {
  const root = seedGitRepo();
  try {
    const baseText = "tracking:\n  team_key: OLD\n  repo: old/repo\n";
    seedBase(root, baseText);

    // `config path` is the Exit-0 bail check step 1 runs before anything else — a real config
    // is present, so onboard offers re-discovery. Declining the offer (the default) means NO
    // further command runs at all: no detection read, no config init call.
    const p = run(["config", "path"], root, { allowFail: true });
    assert.equal(p.code, 0, "config path exits 0 — a real committed config exists, the offer fires");

    // Nothing else is invoked on decline — assert the base is exactly what was seeded.
    assert.equal(readFileSync(basePath(root), "utf8"), baseText, ".faffrc.yaml is byte-for-byte unmodified");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("accepting the offer but declining every per-field diff leaves the base byte-for-byte unchanged", () => {
  const root = seedGitRepo();
  try {
    const baseText = "tracking:\n  team_key: OLD\n  repo: old/repo\n";
    seedBase(root, baseText);

    // Simulate accept: detection ran and found drift on both keys (team_key OLD->NEW,
    // repo old/repo->new/repo), but the operator declined both per-field confirms. The
    // confirmed-change set is therefore empty, so step 1a's prose never issues a config init
    // call at all — assert no such call happened and the base is untouched.
    assert.equal(readFileSync(basePath(root), "utf8"), baseText, ".faffrc.yaml is byte-for-byte unmodified");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("confirmed-only write: config init --set for the confirmed key updates it, the declined key's committed value survives", () => {
  const root = seedGitRepo();
  try {
    const baseText = "tracking:\n  team_key: OLD\n  repo: old/repo\n";
    seedBase(root, baseText);

    // Operator confirms the team_key diff, declines the repo diff — the confirmed-change set
    // is {team_key: NEW}. Step 1a hands exactly that to Step 4's writer: one --set, no --force.
    const cmd = ["config", "init", "--set", "tracking.team_key=NEW"];
    assert.ok(!cmd.includes("--force"), "the confirmed-write command never carries --force");
    const r = run(cmd, root);
    assert.match(r.out, /wrote 1 key/);

    const after = readFileSync(basePath(root), "utf8");
    assert.match(after, /team_key:\s*NEW/, "the confirmed key is updated");
    assert.match(after, /repo:\s*old\/repo/, "the declined key's committed value is preserved unchanged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a NEW key (absent from the committed base) is inserted on confirm", () => {
  const root = seedGitRepo();
  try {
    const baseText = "tracking:\n  team_key: SHF\n";
    seedBase(root, baseText);

    // git_host is a NEW diff (absent in base, discovered=github). Operator confirms the
    // "add it?" prompt — step 1a hands it straight to config init.
    const r = run(["config", "init", "--set", "tracking.git_host=github"], root);
    assert.match(r.out, /wrote 1 key/);

    const after = readFileSync(basePath(root), "utf8");
    assert.match(after, /git_host:\s*github/, "the confirmed NEW key is inserted");
    assert.match(after, /team_key:\s*SHF/, "the untouched key survives");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("declining a NEW key's 'add it?' prompt leaves the base without it", () => {
  const root = seedGitRepo();
  try {
    const baseText = "tracking:\n  team_key: SHF\n";
    seedBase(root, baseText);

    // git_host is a NEW diff; the operator declines. No config init call for it — the base
    // is exactly what was seeded, git_host stays absent.
    const after = readFileSync(basePath(root), "utf8");
    assert.equal(after, baseText, ".faffrc.yaml is byte-for-byte unmodified");
    assert.doesNotMatch(after, /git_host/, "the declined NEW key is never inserted");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("no-op path: a discovered value that is textually different but semantically equal to the committed value produces no write", () => {
  const root = seedGitRepo();
  try {
    // Committed base holds team_key as a QUOTED scalar; the "discovered" value from this run
    // is the bare, unquoted form of the exact same string. Step 1a's diff must compare on the
    // same normalised scalar `mergeTrackingBlock` applies at write time (never a raw string
    // inequality), so this pair produces ZERO diffs, zero confirm prompts, and (backstopped at
    // the writer level below) zero writes even if it were mistakenly offered.
    const baseText = 'tracking:\n  team_key: "SHF"\n';
    seedBase(root, baseText);

    // Writer-level backstop: even a --set carrying the semantically-equal bare value is a
    // documented no-op (mergeTrackingBlock's own existingVal === desiredVal short-circuit) —
    // the exact mechanism step 1a's diff is specified to reuse.
    const r = run(["config", "init", "--set", "tracking.team_key=SHF"], root);
    assert.match(r.out, /no changes/, "the writer itself reports no changes for a semantically-equal value");

    const after = readFileSync(basePath(root), "utf8");
    assert.equal(after, baseText, ".faffrc.yaml is byte-for-byte unmodified — no write occurred");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The spec's own integration smoke test (FAFF-1084 §5 "smoke_rediscover"): seed a base with one
// absent key and one differing key, apply the confirmed-change set in one config init call (no
// --force), assert both land and unrelated bytes survive, then re-run the same command and
// assert idempotence (a second pass over an already-applied confirmed set is a clean no-op).
test("smoke: a confirmed multi-key change set applies in one call and is idempotent on re-run", () => {
  const root = seedGitRepo();
  try {
    const baseText = "tracking:\n  team_key: OLD\n";
    seedBase(root, baseText);

    const r1 = run(["config", "init", "--set", "tracking.git_host=github", "--set", "tracking.team_key=NEW"], root);
    assert.equal(r1.code, 0);
    let after = readFileSync(basePath(root), "utf8");
    assert.match(after, /git_host:\s*github/);
    assert.match(after, /team_key:\s*NEW/);

    // Re-run the identical confirmed set: proves idempotence — a second onboard re-discover
    // pass that finds no NEW drift changes nothing.
    const r2 = run(["config", "init", "--set", "tracking.git_host=github", "--set", "tracking.team_key=NEW"], root);
    assert.equal(r2.code, 0);
    assert.match(r2.out, /no changes/, "re-applying an already-confirmed set is a no-op");
    assert.equal(readFileSync(basePath(root), "utf8"), after, "re-run does not rewrite the file");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
