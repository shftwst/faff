// ===========================================================================
// === region:factory — post-merge — FAFF-385: post-merge verification (verification-only slice). ===
// `faff post-merge-check` re-runs the project's OWN declared UNIT rung — resolved via the SAME
// `discoverRungs`/`runRung` (`gates.js`) faff-graft Step 7.5/Step 8 already trust, never a second
// divergent resolver — against an EPHEMERAL DETACHED WORKTREE at the sha `faff merge-gate` already
// pinned into `<run-dir>/<issue>/merge-record.json` (FAFF-397; never a second sha observation).
// Pure classify-and-validate core lives in contract-defs.js (`computePostMergeVerification`,
// registered as `CONTRACTS["post-merge-verification"]`); this module is the impure shell only —
// it resolves the sha, stands up + tears down the worktree, runs the rung, and persists the
// per-issue artifact. NO auto-revert, NO merge, NO PR of any kind lives here or anywhere in this
// slice (seam (b) is a separate, unbuilt follow-up) — this step only OBSERVES and ANNOTATES.
// The tracker comment + discovered-scope filing on a verified-fail verdict are graft's job (prose,
// faff-graft/SKILL.md Step 10's shipped arm), never this CLI's — mirrors the gates.js / faff-graft
// split (the CLI emits the mechanical signal; the agent narrates the human-facing consequence).
// ===========================================================================

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadConfig } = require("./config");
const { discoverRungs, runRung } = require("./gates");
const { dig, findRoot } = require("./shared-infra");

// <run-dir>/<issue>/post-merge-verification.json — mirrors mergeRecordPath's convention exactly
// (merge-gate.js) so every per-issue floor/observation artifact lives at the same address shape.
function postMergeVerificationPath(runDir, issue) {
  return path.join(runDir, issue, "post-merge-verification.json");
}

function mergeRecordPath(runDir, issue) {
  return path.join(runDir, issue, "merge-record.json");
}

// Read the merge sha `faff merge-gate` already pinned (FAFF-397) — the ONLY sha source besides an
// explicit --sha override. Missing/unreadable/malformed → null (never a second, divergent
// resolution attempt — e.g. re-deriving via a fresh PR-view call).
function readMergeSha(runDir, issue) {
  try {
    const j = JSON.parse(fs.readFileSync(mergeRecordPath(runDir, issue), "utf8"));
    return j && typeof j.head_sha === "string" && j.head_sha.trim() ? j.head_sha : null;
  } catch {
    return null;
  }
}

// Write the per-issue artifact. Best-effort like writeMergeRecord — a write failure is surfaced
// but never crashes the check (the observation itself is the load-bearing event).
function writePostMergeVerification(runDir, issue, record) {
  try {
    const dir = path.join(runDir, issue);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(postMergeVerificationPath(runDir, issue), JSON.stringify(record, null, 2) + "\n");
    return true;
  } catch (e) {
    process.stderr.write(`faff post-merge-check: warning — could not write post-merge-verification.json: ${e.message}\n`);
    return false;
  }
}

// post_merge.check: on|off (default on) — consulted in autonomous mode only (graft's job to check
// before invoking this CLI at all); exposed here as a pure config read so the CLI itself can also
// no-op cleanly if invoked directly against a repo that has opted out.
function postMergeCheckEnabled(root) {
  try {
    const [data] = loadConfig(root);
    const v = dig(data, "post_merge.check");
    return v !== "off" && v !== false;
  } catch {
    return true; // fail-safe default: on
  }
}

// The impure shell: resolve sha → discover the UNIT rung → run it in an ephemeral DETACHED
// worktree (named under the system tmpdir, deliberately OUTSIDE any configured worktree_root so
// `faff worktree-prune`'s scoped-to-this-run cleanup and `faff doctor`'s install-health scan never
// need to reason about it — spec-review build note) → classify → ALWAYS remove the worktree
// (FINALLY, success or failure) → persist the artifact. Returns the PostMergeVerification record
// plus the CLI exit code the caller (cmdPostMergeCheck) surfaces verbatim.
function verifyPostMerge({ issue, pr, runDir, shaOverride, root }) {
  const repoRoot = root || findRoot();
  const merge_sha = shaOverride || readMergeSha(runDir, issue);
  if (!merge_sha) {
    return { failLoud: `cannot resolve a merge sha for ${issue} — no --sha and no readable ${mergeRecordPath(runDir, issue)}` };
  }

  const { rungs } = discoverRungs(repoRoot);
  const unitRung = rungs.find((r) => r.kind === "UNIT");

  let verdict, basis, command;
  if (!unitRung) {
    verdict = "unverified";
    basis = "no UNIT rung discovered";
    command = null;
  } else {
    command = unitRung.command;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-post-merge-"));
    try {
      // Best-effort: the sha may not yet be locally resolvable (a fresh merge on a shallow/stale
      // fetch) — never fail the check on a network hiccup here; `worktree add` itself is the
      // authoritative resolvability probe.
      spawnSync("git", ["fetch", "origin", merge_sha], { cwd: repoRoot, encoding: "utf8" });
      const added = spawnSync("git", ["worktree", "add", "--detach", tmp, merge_sha], { cwd: repoRoot, encoding: "utf8" });
      if (added.status !== 0) {
        verdict = "unverified";
        basis = `git worktree add --detach failed: ${((added.stderr || "") + (added.stdout || "")).trim().slice(-300)}`;
      } else {
        const result = runRung(unitRung, tmp);
        if (result.status === "pass") { verdict = "verified-ok"; basis = `${command} exit 0`; }
        else if (result.status === "fail") { verdict = "verified-fail"; basis = `${command} failed: ${result.detail}`; }
        else { verdict = "unverified"; basis = `${command} errored: ${result.detail}`; }
      }
    } finally {
      // ALWAYS remove — success, fail, or an exception mid-run-ladder. A stray `git worktree`
      // entry surviving this step is the one failure mode the FINALLY exists to prevent.
      spawnSync("git", ["worktree", "remove", "--force", tmp], { cwd: repoRoot, encoding: "utf8" });
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  // discovered_scope_ref stays null here by construction — filing the discovered-scope entry on
  // a verified-fail verdict is graft's job (prose, Step 10's shipped arm, AFTER this CLI exits 1),
  // never this mechanical shell's. This artifact is written once, before that filing happens.
  const record = {
    issue,
    pr: Number(pr),
    merge_sha,
    verdict,
    basis,
    command,
    discovered_scope_ref: null,
    checked_at: new Date().toISOString(),
  };
  writePostMergeVerification(runDir, issue, record);

  const exit = verdict === "verified-ok" ? 0 : verdict === "verified-fail" ? 1 : 3;
  return { record, exit };
}

function cmdPostMergeCheck(args) {
  if (args.includes("--selftest")) return postMergeSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const issue = get("--issue");
  const pr = get("--pr");
  const runDir = get("--run-dir");
  const shaOverride = get("--sha");
  const root = get("--root") || findRoot();
  const json = args.includes("--json");

  if (!issue || !pr || !runDir) {
    process.stderr.write("faff post-merge-check: usage: --issue ID --pr N --run-dir DIR [--sha SHA] [--json]\n");
    return 2;
  }

  const { record, exit, failLoud } = verifyPostMerge({ issue, pr, runDir, shaOverride, root });
  if (failLoud) {
    process.stderr.write(`faff post-merge-check: fail-loud: ${failLoud}\n`);
    return 2;
  }

  if (json) {
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log(`post-merge-check ${record.issue}: verdict=${record.verdict} sha=${record.merge_sha.slice(0, 12)} basis="${record.basis}"`);
  }
  return exit;
}

function postMergeSelftest() {
  const cases = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-post-merge-selftest-"));

  const git = (cwd, ...gitArgs) => spawnSync("git", ["-C", cwd, ...gitArgs], { encoding: "utf8" });

  // Build a real repo: commit 1 has a passing `test` script; commit 2 flips it to fail;
  // commit 3 removes package.json entirely (no UNIT rung discoverable).
  const repo = path.join(tmpRoot, "repo");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.t");
  git(repo, "config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "green");
  const greenSha = git(repo, "rev-parse", "HEAD").stdout.trim();

  // repo's HEAD advances here (still declaring the SAME `test` script name — only its body
  // flips to a failing command) — discovery reads repoRoot's OWN current package.json (repo_root
  // per the spec's pseudocode), which is deliberately independent of which sha gets EXECUTED in
  // the ephemeral worktree; the command name it discovers ("npm run test") stays the same either
  // way, so this one repo covers both the verified-ok and verified-fail executions correctly.
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts: { test: "false" } }));
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "red");
  const redSha = git(repo, "rev-parse", "HEAD").stdout.trim();

  // A SEPARATE repo with no declared UNIT rung at all (discovery is a property of repoRoot's own
  // current declarations, not of the sha being checked) — exercises the no-rung → unverified path.
  const repoNoRung = path.join(tmpRoot, "repo-no-rung");
  fs.mkdirSync(repoNoRung, { recursive: true });
  git(repoNoRung, "init", "-q", "-b", "main");
  git(repoNoRung, "config", "user.email", "t@t.t");
  git(repoNoRung, "config", "user.name", "t");
  fs.writeFileSync(path.join(repoNoRung, "README.md"), "no gates declared\n");
  git(repoNoRung, "add", "-A");
  git(repoNoRung, "commit", "-qm", "no-rung");
  const noRungSha = git(repoNoRung, "rev-parse", "HEAD").stdout.trim();

  const runDir = path.join(tmpRoot, "run-dir");

  // 1. readMergeSha: absent merge-record.json → null.
  cases.push(["readMergeSha: missing record → null", readMergeSha(runDir, "FAFF-X") === null]);

  // 2. verified-ok path (against the green sha, via --sha override — no merge-record.json needed).
  const worktreesBefore = git(repo, "worktree", "list").stdout;
  const okResult = verifyPostMerge({ issue: "FAFF-1", pr: 1, runDir, shaOverride: greenSha, root: repo });
  cases.push(["verified-ok: exit 0", okResult.exit === 0]);
  cases.push(["verified-ok: verdict", okResult.record.verdict === "verified-ok"]);
  cases.push(["verified-ok: command captured", okResult.record.command === "npm run test"]);
  cases.push(["verified-ok: artifact persisted", fs.existsSync(postMergeVerificationPath(runDir, "FAFF-1"))]);
  const worktreesAfterOk = git(repo, "worktree", "list").stdout;
  cases.push(["verified-ok: ephemeral worktree cleaned up (no leftover)", worktreesAfterOk === worktreesBefore]);

  // 3. verified-fail path (against the red sha).
  const failResult = verifyPostMerge({ issue: "FAFF-2", pr: 2, runDir, shaOverride: redSha, root: repo });
  cases.push(["verified-fail: exit 1", failResult.exit === 1]);
  cases.push(["verified-fail: verdict", failResult.record.verdict === "verified-fail"]);
  cases.push(["verified-fail: discovered_scope_ref left null (graft's job, not the CLI's)", failResult.record.discovered_scope_ref === null]);
  const worktreesAfterFail = git(repo, "worktree", "list").stdout;
  cases.push(["verified-fail: ephemeral worktree cleaned up even on a failing rung", worktreesAfterFail === worktreesBefore]);

  // 4. unverified path — no UNIT rung discoverable at all (a separate repo with no declared checks).
  const noRungResult = verifyPostMerge({ issue: "FAFF-3", pr: 3, runDir, shaOverride: noRungSha, root: repoNoRung });
  cases.push(["unverified (no rung): exit 3", noRungResult.exit === 3]);
  cases.push(["unverified (no rung): verdict", noRungResult.record.verdict === "unverified"]);
  cases.push(["unverified (no rung): command null", noRungResult.record.command === null]);

  // 5. merge-record.json read path (no --sha; reads the file merge-gate already wrote).
  fs.mkdirSync(path.join(runDir, "FAFF-4"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "FAFF-4", "merge-record.json"), JSON.stringify({ pr: 4, head_sha: greenSha, merged: true }));
  cases.push(["readMergeSha: reads merge-record.json's head_sha", readMergeSha(runDir, "FAFF-4") === greenSha]);
  const viaRecord = verifyPostMerge({ issue: "FAFF-4", pr: 4, runDir, root: repo });
  cases.push(["verified via merge-record.json (no --sha): exit 0", viaRecord.exit === 0]);

  // 6. fail-loud: no --sha and no merge-record.json → cannot resolve.
  const noSha = verifyPostMerge({ issue: "FAFF-5", pr: 5, runDir, root: repo });
  cases.push(["fail-loud: unresolvable sha", !!noSha.failLoud]);

  // 7. cmdPostMergeCheck usage exit 2 (missing required flags).
  const usageExit = cmdPostMergeCheck(["--issue", "FAFF-1"]);
  cases.push(["cmd: missing --run-dir/--pr → exit 2 usage", usageExit === 2]);

  // 8. cmdPostMergeCheck full path --json (green sha, via merge-record.json already written above).
  const cmdExit = cmdPostMergeCheck(["--issue", "FAFF-4", "--pr", "4", "--run-dir", runDir, "--root", repo, "--json"]);
  cases.push(["cmd: full invocation via CLI → exit 0", cmdExit === 0]);

  // 9. postMergeCheckEnabled: default on (no config) — fail-safe true.
  cases.push(["postMergeCheckEnabled: default on with no config", postMergeCheckEnabled(repo) === true]);

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }

  let failed = 0;
  for (const [n, ok] of cases) { console.log(`${ok ? "ok  " : "FAIL"} ${n}`); if (!ok) failed++; }
  console.log(`RESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}

module.exports = { cmdPostMergeCheck, mergeRecordPath, postMergeCheckEnabled, postMergeVerificationPath, readMergeSha, verifyPostMerge, writePostMergeVerification };
