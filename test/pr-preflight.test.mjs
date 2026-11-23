import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const faff = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));
const base = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();

function fixture(t, remote = true) {
  const dir = mkdtempSync(join(tmpdir(), "faff-pr-preflight-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = join(dir, "project"), bin = join(dir, "bin"), bare = join(dir, "remote.git");
  mkdirSync(cwd); mkdirSync(bin);
  const git = (args, where = cwd) => {
    const r = spawnSync(realGit, args, { cwd: where, env: base, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(["init", "-q", "-b", "main"]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "Initial"]);
  if (remote) {
    git(["init", "--bare", "-q", bare]);
    git(["remote", "add", "origin", bare]);
  }
  const calls = join(dir, "calls");
  writeFileSync(join(bin, "git"), `#!/bin/sh
if [ "$1" = push ]; then
  printf 'git %s\\n' "$*" >> "$AUDIT"
  if [ -n "$PUSH_ERROR" ]; then printf '%s\\n' "$PUSH_ERROR" >&2; exit 1; fi
fi
exec "$REAL_GIT" "$@"
`, { mode: 0o755 });
  writeFileSync(join(bin, "gh"), `#!/bin/sh
printf 'gh %s\\n' "$*" >> "$AUDIT"
[ "$*" = 'api repos/{owner}/{repo}' ] || exit 77
printf '%s\\n' "$REPO_METADATA"
exit "$GH_RESULT"
`, { mode: 0o755 });
  const run = (args, delta = {}, where = cwd) => {
    const r = spawnSync(process.execPath, [faff, "pr", "preflight", ...args], {
      cwd: where, encoding: "utf8", timeout: 15000,
      env: { ...base, PATH: bin + delimiter + base.PATH, AUDIT: calls, REAL_GIT: realGit,
        GH_RESULT: "0", REPO_METADATA: '{"allow_squash_merge":true}', ...delta },
    });
    return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
  };
  return { cwd, dir, bare, git, run, reads: () => existsSync(calls) ? readFileSync(calls, "utf8") : "" };
}

test("fresh issue uses the worktree convention, probes only, and skips local pre-push hooks", t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, ".faffrc.yaml"), "conventions:\n  branch_naming: slash-scoped\n");
  const hookMarker = join(f.dir, "prepush");
  writeFileSync(join(f.cwd, ".git/hooks/pre-push"), '#!/bin/sh\ntouch "' + hookMarker + '"\nexit 1\n', { mode: 0o755 });
  const before = f.git(["for-each-ref"], f.bare);
  const r = f.run(["--issue", "KIT-17", "--slug", "clamp"]);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.status, "clear");
  assert.equal(r.out.branch, "feature/KIT-17-clamp");
  assert.match(f.reads(), /git push --dry-run --no-verify --porcelain origin HEAD:refs\/heads\/feature\/KIT-17-clamp/);
  assert.equal(f.git(["for-each-ref"], f.bare), before);
  assert.equal(existsSync(hookMarker), false);
  assert.equal(existsSync(join(f.cwd, ".faff/conventions.json")), false);
});

test("fresh issue honours valid tracker-branch policy and shares fallback for an unrelated hint", t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, ".faffrc.yaml"), "conventions:\n  branch_naming: tracker-hint\n");
  const args = ["--issue", "KIT-17", "--slug", "clamp", "--tracker-branch"];
  assert.equal(f.run([...args, "custom/KIT-17-fix"]).out.branch, "custom/KIT-17-fix");
  assert.equal(f.run([...args, "main"]).out.branch, "KIT-17-clamp");
});

test("an existing owned worktree is probed at its actual ref; the ship backstop reads squash policy afresh", t => {
  const f = fixture(t);
  const feature = join(f.dir, "feature");
  f.git(["worktree", "add", "-qb", "custom/KIT-17-existing", feature, "main"]);
  const a = f.run(["--issue", "KIT-17", "--slug", "different"]);
  assert.equal(a.out.status, "clear");
  assert.equal(a.out.branch, "custom/KIT-17-existing");
  assert.match(f.reads(), /refs\/heads\/custom\/KIT-17-existing:refs\/heads\/custom\/KIT-17-existing/);
  const b = f.run(["--branch", a.out.branch], { REPO_METADATA: '{"allow_squash_merge":false}' }, feature);
  assert.equal(b.status, 1);
  assert.match(b.out.cause, /^not-ready:precondition:merge-method .+; remedy: /);
});

test("only evidenced refusal blocks; outages and invalid metadata stay indeterminate", t => {
  const f = fixture(t), args = ["--branch", "feature/KIT-17"];
  const denied = f.run(args, { PUSH_ERROR: "remote: Write access to repository not granted." });
  assert.equal(denied.status, 1);
  assert.match(denied.out.cause, /^not-ready:precondition:push .+; remedy: /);
  for (const delta of [
    { PUSH_ERROR: "Could not resolve host: example.invalid" },
    { PUSH_ERROR: "rejected (non-fast-forward)" }, { GH_RESULT: "1" },
    { REPO_METADATA: "{}" }, { REPO_METADATA: "oops" }, { REPO_METADATA: '{"allow_squash_merge":"false"}' },
  ]) {
    const r = f.run(args, delta);
    assert.equal(r.status, 0);
    assert.equal(r.out.status, "indeterminate");
  }
});

test("git-only skips both remote probes and invalid CLI arguments have no remote effects", t => {
  const f = fixture(t, false);
  assert.deepEqual(f.run(["--branch", "feature/test"]).out, { status: "git-only" });
  for (const args of [[], ["--branch", "bad name"], ["--issue", "KIT-17"], ["--issue", "x..y", "--slug", "test"], ["--branch", "good", "--issue", "KIT-17"], ["--unknown"]]) {
    assert.equal(f.run(args).status, 2, String(args));
  }
  assert.equal(f.reads(), "");
});

test("an issue in the main checkout directory name cannot select its default branch", t => {
  const f = fixture(t), alias = join(f.dir, "KIT-17-main-checkout");
  f.git(["clone", "-q", f.cwd, alias]);
  const r = f.run(["--issue", "KIT-17", "--slug", "clamp"], {}, alias);
  assert.equal(r.status, 0);
  assert.equal(r.out.status, "indeterminate");
  assert.equal(r.out.branch, null);
  assert.doesNotMatch(f.reads(), /git push/);
});
