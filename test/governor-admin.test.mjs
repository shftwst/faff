// FAFF-1217 — `commissaire governor pin` and `governor status`, and the governor's read-only `identify`
// operation. Host facts (uids, groups, file ownership) come through injected deps; git runs for real
// against a throwaway bare origin, and gh is a stub on a controlled path. Nothing here opens a real PR.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { realpathSync, existsSync, mkdirSync, mkdtempSync, readFileSync, chmodSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { regionsRequireEdges } from "../plugin/skills/faff/bin/lib/regions.js";
import { makeWorld, admin, passingDeps, identifyReply, runnerChecks, FP, OTHER_FP, REPO, LIB, BIN } from "./helpers/governor-admin-world.mjs";

const require = createRequire(import.meta.url);
const governor = require(join(LIB, "governor.js"));
const client = require(join(LIB, "commissaire-governor-client.js"));
const trustLib = require(join(LIB, "commissaire-trust.js"));
const mergeGate = require(join(LIB, "merge-gate.js"));
const COMMISSAIRE = join(BIN, "commissaire");
const FAFF = join(BIN, "faff");

const worlds = [];
const world = (opts) => { const w = makeWorld(opts); worlds.push(w); return w; };
after(() => { for (const w of worlds) w.cleanup(); });

const FLAGS = { "--socket": "/tmp/g.sock", "--runner-user": "runner", "--repo": REPO };
const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const pin = (w, flags = {}, over = {}) => { const o = admin.pinCore(drop({ ...FLAGS, ...flags }), passingDeps(w, over)); assert.ok(o.result, `unexpected usage error: ${o.usage}`); return o.result; };
const status = (w, flags = {}, over = {}) => { const o = admin.statusCore(drop({ "--socket": "/tmp/g.sock", "--runner-user": "runner", "--repo": REPO, ...flags }), passingDeps(w, over)); return o; };

// A peerRequest stub whose reply is rewritten over the passing identify reply (fingerprint kept honest).
const peer = (w, replyOver = {}, peerUid = 990) => (_e, _r) => {
  const kp = passingDeps(w).kp;
  return { ok: true, reply: identifyReply({ pk: kp.pk, pk_fingerprint: kp.pk_fingerprint, ...replyOver }), peer_uid: peerUid };
};
const noCalls = (what) => () => { throw new Error(`${what} must not be called`); };

// --- usage errors --------------------------------------------------------------------------------

test("usage: pin needs --socket, --runner-user and --repo; status takes them optionally; nothing is called", () => {
  const trap = { peerRequest: noCalls("peerRequest"), runGit: noCalls("runGit"), runGh: noCalls("runGh"), lookupRunner: noCalls("lookupRunner"), resolveBin: noCalls("resolveBin") };
  const w = world();
  for (const missing of ["--socket", "--runner-user", "--repo"]) {
    const flags = { ...FLAGS }; delete flags[missing];
    const saved = process.env.COMMISSAIRE_GOVERNOR; delete process.env.COMMISSAIRE_GOVERNOR;
    try { const o = admin.pinCore(flags, passingDeps(w, trap)); assert.match(o.usage ?? "", new RegExp(missing), missing); } finally { if (saved !== undefined) process.env.COMMISSAIRE_GOVERNOR = saved; }
  }
});

test("usage: a malformed --repo is a usage error on both commands with no socket, git or gh call", () => {
  const w = world();
  const trap = { peerRequest: noCalls("peerRequest"), runGit: noCalls("runGit"), runGh: noCalls("runGh"), lookupRunner: noCalls("lookupRunner"), resolveBin: noCalls("resolveBin") };
  for (const bad of ["acme", "a/b/c", "../x", "acme/..", "-acme/widgets", "acme/-w", "ac me/w", "acme/w;rm", "acme/wid gets", "/widgets", "acme/", "acme/w..x/y"]) {
    const p = admin.pinCore({ ...FLAGS, "--repo": bad }, passingDeps(w, trap));
    assert.match(p.usage ?? "", /--repo/, `pin ${bad}`);
    const s = admin.statusCore({ "--socket": "/tmp/g.sock", "--repo": bad }, passingDeps(w, trap));
    assert.match(s.usage ?? "", /--repo/, `status ${bad}`);
  }
});

test("usage: an unknown flag and a bad --base are usage errors through the CLI (exit 2, stdout empty)", () => {
  for (const args of [["governor", "pin", "--bogus"], ["governor", "pin", "--socket", "/tmp/x.sock", "--runner-user", "r"], ["governor", "pin", "--socket", "/tmp/x.sock", "--runner-user", "r", "--repo", "bad"], ["governor", "status", "--bogus"], ["governor", "status", "--repo", "x"], ["governor", "pin", "--socket", "/tmp/x.sock", "--runner-user", "r", "--repo", "a/b", "--base", "-x"]]) {
    const r = spawnSync(process.execPath, [COMMISSAIRE, ...args], { encoding: "utf8" });
    assert.equal(r.status, 2, args.join(" "));
    assert.equal(r.stdout, "", args.join(" "));
    assert.notEqual(r.stderr, "");
  }
});

// --- pin: invoker, runner, code, repo -------------------------------------------------------------

test("pin refuses invoked-as-root and invoked-as-runner before any socket call; runner-user-unknown for an unresolvable name", () => {
  const w = world();
  const none = { peerRequest: noCalls("peerRequest"), runGit: noCalls("runGit"), runGh: noCalls("runGh") };
  assert.equal(pin(w, {}, { ...none, getuid: () => 0 }).reason, "invoked-as-root");
  assert.equal(pin(w, {}, { ...none, getuid: () => 1001 }).reason, "invoked-as-runner");
  assert.equal(pin(w, {}, { ...none, lookupRunner: () => null }).reason, "runner-user-unknown");
});

test("pin refuses code-runner-writable for the require closure, the interpreter and git or gh; hooks stay off", () => {
  const w = world();
  const none = { peerRequest: noCalls("peerRequest"), runGit: noCalls("runGit"), runGh: noCalls("runGh") };
  const writable = (needle) => ({ runnerCanWrite: (p) => p.includes(needle) });
  let r = pin(w, {}, { ...none, ...writable("/opt/commissaire/1/lib") });
  assert.equal(r.reason, "code-runner-writable");
  assert.match(r.detail, /\/opt\/commissaire\/1\/lib/);
  assert.match(r.detail, /installed copy/);
  r = pin(w, {}, { ...none, ...writable("/usr/local/bin") });
  assert.equal(r.reason, "code-runner-writable");
  assert.match(r.detail, /interpreter/);
  assert.match(r.detail, /\/usr\/local\/bin\/node/);
  r = pin(w, {}, { ...none, runnerCanWrite: (p) => p === w.gh });
  assert.equal(r.reason, "code-runner-writable");
  assert.match(r.detail, /gh/);
  r = pin(w, {}, { ...none, runnerCanWrite: (p) => p === w.gitShim });
  assert.match(r.detail, /git/);
});

test("pin refuses repo-runner-writable for .git or any directory above it, and no git command runs", () => {
  const w = world();
  const none = { peerRequest: noCalls("peerRequest"), runGit: noCalls("runGit"), runGh: noCalls("runGh") };
  for (const writablePath of [join(w.work, ".git"), w.work, dirname(w.work)]) {
    const r = pin(w, {}, { ...none, runnerCanWrite: (p) => p === writablePath });
    assert.equal(r.reason, "repo-runner-writable", writablePath);
    assert.equal(r.pinned, "refused");
  }
  assert.equal(w.gitCalls().length, 0);
});

test("the real runnerCanWrite predicate: owned by the runner, group-writable with a runner group, world-writable", () => {
  const dir = mkdtempSync(join(tmpdir(), "gadm-rcw-"));
  try {
    const f = join(dir, "f"); writeFileSync(f, "x");
    const me = process.getuid(), gid = process.getgid();
    const runner = (uid, gids) => ({ uid, gids, groups: [] });
    chmodSync(f, 0o644);
    assert.equal(admin.DEFAULT_DEPS.runnerCanWrite(f, runner(me, [])), true, "owned by the runner");
    assert.equal(admin.DEFAULT_DEPS.runnerCanWrite(f, runner(me + 1000, [gid + 1000])), false, "other user, other group, 0644");
    chmodSync(f, 0o664);
    assert.equal(admin.DEFAULT_DEPS.runnerCanWrite(f, runner(me + 1000, [gid])), true, "group-writable with a runner group");
    assert.equal(admin.DEFAULT_DEPS.runnerCanWrite(f, runner(me + 1000, [gid + 1000])), false, "group-writable, runner not in the group");
    chmodSync(f, 0o666);
    assert.equal(admin.DEFAULT_DEPS.runnerCanWrite(f, runner(me + 1000, [])), true, "world-writable");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pin refuses platform-unsupported on macOS (naming FAFF-1251) and remote-governor-unsupported for TCP, before any socket call", () => {
  const w = world();
  const none = { peerRequest: noCalls("peerRequest"), lookupRunner: noCalls("lookupRunner") };
  let r = pin(w, {}, { ...none, platform: () => "darwin" });
  assert.equal(r.reason, "platform-unsupported");
  assert.match(r.detail, /FAFF-1251/);
  r = pin(w, { "--socket": "127.0.0.1:9000" }, none);
  assert.equal(r.reason, "remote-governor-unsupported");
  assert.match(r.detail, /FAFF-1181/);
});

// --- pin: the socket and the reply ----------------------------------------------------------------

test("pin maps socket outcomes: unreachable, refused (caller-not-allowed, unknown-op), invalid reply, fingerprint mismatch", () => {
  const w = world();
  const run = (peerRequest) => pin(w, {}, { peerRequest });
  assert.equal(run(() => ({ unreachable: true, detail: "ENOENT" })).reason, "governor-unreachable");
  let r = run(() => ({ ok: true, reply: { ok: false, reason: "caller-not-allowed" }, peer_uid: 990 }));
  assert.deepEqual([r.reason, r.detail], ["governor-refused", "caller-not-allowed"]);
  r = run(() => ({ ok: true, reply: { ok: false, reason: "unknown-op" }, peer_uid: 990 }));
  assert.deepEqual([r.reason, r.detail], ["governor-refused", "unknown-op"]);
  const missing = (field) => peer(w, { [field]: undefined });
  for (const field of ["pk", "pk_fingerprint", "key_file"]) assert.equal(run(missing(field)).reason, "identify-invalid", field);
  assert.equal(run(peer(w, { key_file: "relative/key.json" })).reason, "identify-invalid");
  assert.equal(run(peer(w, { runner_checks: { ...runnerChecks(), docker_group: "no" } })).reason, "identify-invalid");
  assert.equal(run(peer(w, { runner_checks: "nope" })).reason, "identify-invalid");
  r = run(peer(w, { pk_fingerprint: OTHER_FP }));
  assert.equal(r.reason, "fingerprint-mismatch");
});

test("pin judges the governor user from the kernel uid, never from a reply field", () => {
  const w = world();
  const run = (uid, over = {}) => pin(w, {}, { peerRequest: peer(w, { uid: 990, peer_uid: 990, governor_uid: 990 }, uid), ...over });
  assert.equal(run(0).reason, "governor-is-root");
  const sameRunner = run(1001);
  assert.equal(sameRunner.reason, "governor-same-user", "the reply claims uid 990; the kernel says the runner's uid");
  assert.equal(run(1000).reason, "governor-same-user", "the invoker's own uid");
  assert.equal(run(5000).reason, "governor-not-system-user");
  assert.equal(run(1000, { uidMin: () => 1000 }).reason, "governor-same-user");
});

test("pin checks the runner's groups, primary group included, never the invoker's", () => {
  const w = world();
  const lookups = [];
  for (const group of ["docker", "lxd", "incus-admin", "libvirt", "disk", "sudo", "wheel", "root"]) {
    const r = pin(w, {}, { lookupRunner: (n) => { lookups.push(n); return { uid: 1001, gids: [1001], groups: ["runner", group] }; } });
    assert.equal(r.reason, "runner-root-equivalent", group);
    assert.equal(r.detail, group);
  }
  assert.deepEqual([...new Set(lookups)], ["runner"], "only the runner is looked up; the invoker's groups are never read");
  const primary = pin(w, {}, { lookupRunner: () => ({ uid: 1001, gids: [0], groups: ["root"] }) });
  assert.equal(primary.reason, "runner-root-equivalent");
  assert.deepEqual(admin.ROOT_EQUIVALENT_GROUPS.macos, ["admin", "wheel"]);
});

test("pin refuses key-dir-untrusted for each way the key directory can be wrong", () => {
  const w = world();
  const with_ = (path, patch) => (p) => { const base = passingDeps(w).stats[p]; return p === path ? { ...base, ...patch } : (base ?? null); };
  const cases = {
    "home mismatch": { homeOf: () => "/home/other" },
    "home unreadable": { homeOf: () => null },
    "symlink": { lstat: with_("/var/lib/gov", { isSymlink: true }) },
    "not a directory": { lstat: with_("/var/lib/gov", { isDirectory: false }) },
    "wrong owner": { lstat: with_("/var/lib/gov", { uid: 991 }) },
    "mode 750": { lstat: with_("/var/lib/gov", { mode: 0o750 }) },
    "mode 770": { lstat: with_("/var/lib/gov", { mode: 0o770 }) },
    "ancestor not root": { lstat: with_("/var/lib", { uid: 1000 }) },
    "ancestor group-writable": { lstat: with_("/var", { mode: 0o775 }) },
    "ancestor world-writable": { lstat: with_("/", { mode: 0o777 }) },
    "ancestor unreadable": { lstat: (p) => (p === "/var/lib" ? null : passingDeps(w).stats[p] ?? null) },
    "dir unreadable": { lstat: (p) => (p === "/var/lib/gov" ? null : passingDeps(w).stats[p] ?? null) },
  };
  for (const [name, over] of Object.entries(cases)) assert.equal(pin(w, {}, over).reason, "key-dir-untrusted", name);
  assert.equal(pin(w, {}, { peerRequest: peer(w, { key_file: "/var/lib/other/governor-key.json" }) }).reason, "key-dir-untrusted", "a key file the governor's home does not contain");
});

test("pin opens the key file read-only and refuses when it can: readable, or an inconclusive error", () => {
  const w = world();
  assert.equal(pin(w, {}, { openNoFollow: () => "opened" }).reason, "key-readable-by-invoker");
  for (const code of ["ENOENT", "ELOOP", "EMFILE", "UNKNOWN"]) assert.equal(pin(w, {}, { openNoFollow: () => code }).reason, "key-read-check-inconclusive", code);
  for (const code of ["EACCES", "EPERM"]) assert.notEqual(pin(w, {}, { openNoFollow: () => code, resolveBin: () => null }).reason, "key-readable-by-invoker", code);
});

test("the real openNoFollow refuses a symlink and reports a readable file as opened", () => {
  const dir = mkdtempSync(join(tmpdir(), "gadm-open-"));
  try {
    writeFileSync(join(dir, "k"), "k");
    require("node:fs").symlinkSync(join(dir, "k"), join(dir, "link"));
    assert.equal(admin.DEFAULT_DEPS.openNoFollow(join(dir, "k")), "opened");
    assert.equal(admin.DEFAULT_DEPS.openNoFollow(join(dir, "link")), "ELOOP");
    assert.equal(admin.DEFAULT_DEPS.openNoFollow(join(dir, "none")), "ENOENT");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pin compares the install record: missing, runner name, uid, platform, independent false naming each failing field", () => {
  const w = world();
  const withChecks = (rc) => ({ peerRequest: peer(w, { runner_checks: rc }) });
  assert.equal(pin(w, {}, withChecks(null)).reason, "install-record-missing");
  let r = pin(w, {}, withChecks(runnerChecks({ runner_user: "someone" })));
  assert.deepEqual([r.reason, r.detail], ["install-check-failed", "install-runner-mismatch"]);
  r = pin(w, {}, withChecks(runnerChecks({ runner_uid: 4242 })));
  assert.deepEqual([r.reason, r.detail], ["install-check-failed", "install-runner-mismatch"]);
  r = pin(w, {}, withChecks(runnerChecks({ platform: "macos" })));
  assert.deepEqual([r.reason, r.detail], ["install-check-failed", "install-platform-mismatch"]);
  r = pin(w, {}, withChecks(runnerChecks({ docker_group: true, independent: false })));
  assert.equal(r.reason, "install-check-failed");
  assert.match(r.detail, /docker_group/);
  r = pin(w, {}, withChecks(runnerChecks({ docker_group: true, sudo_rules: true, sudo_absent: false, independent: false })));
  assert.match(r.detail, /docker_group true, sudo_rules true/);
  assert.deepEqual(w.remoteBranches(), ["main"], "no branch is created");
  assert.equal(w.ghCalls().filter((c) => c[0] === "pr").length, 0, "no PR is created");
});

// --- pin: repository, base, trust file ------------------------------------------------------------

test("pin refuses repo-mismatch (case ignored) before any branch, push or PR; same repo in another case passes", () => {
  const w = world();
  let r = pin(w, { "--repo": "someone/fork" });
  assert.equal(r.reason, "repo-mismatch");
  assert.match(r.detail, /acme\/widgets/);
  assert.match(r.detail, /someone\/fork/);
  assert.deepEqual(w.remoteBranches(), ["main"]);
  assert.equal(w.ghCalls().filter((c) => c[0] === "pr").length, 0);
  r = pin(w, { "--repo": "ACME/Widgets", "--dry-run": true });
  assert.equal(r.pinned, "dry-run");
  assert.ok(w.ghCalls().every((c) => c.join(" ").includes("ACME/Widgets") || c[0] === "api" && c[1] === "user" || !c.includes("--repo")), "gh calls name --repo");
});

test("pin refuses no-remote-base when there is no origin", () => {
  const w = world();
  w.git("remote", "remove", "origin");
  assert.equal(pin(w).reason, "no-remote-base");
});

test("pin passes --repo to every gh call that takes one, and reads the default branch when --base is absent", () => {
  const w = world();
  w.setGh({ defaultBranch: "main" });
  const r = pin(w, { "--dry-run": true });
  assert.equal(r.pinned, "dry-run");
  const calls = w.ghCalls();
  assert.ok(calls.some((c) => c[0] === "repo" && c[1] === "view" && c[2] === REPO && c.includes("defaultBranchRef")));
  assert.ok(calls.filter((c) => c[0] === "api").every((c) => c.some((a) => a.startsWith(`repos/${REPO}/`))));
});

test("pin refuses base-not-protected when no pull_request rule, base-protection-unknown when the rules read fails", () => {
  for (const [rules, reason] of [[[], "base-not-protected"], [[{ type: "deletion" }], "base-not-protected"], ["fail", "base-protection-unknown"], ["garbage", "base-protection-unknown"], [{ message: "Not Found" }, "base-protection-unknown"]]) {
    const w = world();
    w.setGh({ rules });
    assert.equal(pin(w).reason, reason, JSON.stringify(rules));
    assert.deepEqual(w.remoteBranches(), ["main"]);
  }
});

test("pin refuses gh-failed when the remote trust read fails, and trust-file-invalid with the line number", () => {
  let w = world();
  w.setGh({ trustMode: "down" });
  assert.equal(pin(w).reason, "gh-failed");
  w = world();
  w.setGh({ trustMode: "present", trustToml: "schema = 1\nbogus = 2\n" });
  const r = pin(w);
  assert.equal(r.reason, "trust-file-invalid");
  assert.match(r.detail, /line 2/);
  w = world();
  w.setGh({ repoViewFails: true });
  assert.equal(pin(w).reason, "gh-failed");
});

test("pin returns already-pinned with no branch when the fingerprint is listed", () => {
  const w = world();
  const deps = passingDeps(w);
  w.setGh({ trustMode: "present", trustToml: `schema = 1\ngovernor_key_fingerprints = ["${deps.kp.pk_fingerprint}"]\n` });
  const o = admin.pinCore(FLAGS, deps);
  assert.equal(o.result.pinned, "already-pinned");
  assert.equal(o.result.pk_fingerprint, deps.kp.pk_fingerprint);
  assert.deepEqual(w.remoteBranches(), ["main"]);
  assert.equal(w.gitCalls().some((c) => c.includes("worktree")), false);
  assert.equal(w.ghCalls().filter((c) => c[0] === "pr").length, 0);
});

test("pin --dry-run prints the new file text and creates no branch, commit or PR", () => {
  const w = world();
  const deps = passingDeps(w);
  const o = admin.pinCore({ ...FLAGS, "--dry-run": true }, deps);
  assert.equal(o.result.pinned, "dry-run");
  assert.match(o.result.detail, new RegExp(`^schema = 1\\n[\\s\\S]*"${deps.kp.pk_fingerprint}",  # host-1 governor uid 990, pinned \\d{4}-\\d{2}-\\d{2}`));
  assert.ok(trustLib.validateSchema1(trustLib.parseTrustToml(o.result.detail).value).ok);
  assert.deepEqual(w.remoteBranches(), ["main"]);
  assert.equal(w.ghCalls().filter((c) => c[0] === "pr").length, 0);
  assert.equal(w.gitCalls().filter((c) => /commit|worktree|push/.test(c)).length, 0);
});

// --- pin: opening the PR --------------------------------------------------------------------------

const prCreate = (w) => w.ghCalls().find((c) => c[0] === "pr" && c[1] === "create");
const flagValue = (call, name) => call[call.indexOf(name) + 1];

test("pin opens a PR: creates the trust file when absent, signed-off commit, branch name, title, body, worktree and local branch gone", () => {
  const w = world();
  const deps = passingDeps(w);
  const fp = deps.kp.pk_fingerprint;
  const o = admin.pinCore(FLAGS, deps);
  const r = o.result;
  assert.equal(r.pinned, "opened-pr", r.detail);
  const branch = `commissaire/pin-${fp.slice(0, 12)}`;
  assert.equal(r.branch, branch);
  assert.equal(r.pr_url, "https://github.com/acme/widgets/pull/7");
  assert.ok(w.remoteBranches().includes(branch));
  const file = w.show(branch, ".commissaire/trust.toml");
  assert.match(file, /^schema = 1\n\n# SHA-256 of each pinned governor's SPKI-DER public key, lowercase hex\.\ngovernor_key_fingerprints = \[\n  "[0-9a-f]{64}",  # host-1 governor uid 990, pinned \d{4}-\d{2}-\d{2}\n\]\n$/);
  assert.equal(trustLib.validateSchema1(trustLib.parseTrustToml(file).value).value.governorKeyFingerprints[0], fp);
  const message = w.log(branch);
  assert.match(message, /^chore\(commissaire\): pin governor key [0-9a-f]{12}\n/);
  assert.match(message, /Signed-off-by: Test Human <human@example\.invalid>/);
  const call = prCreate(w);
  assert.equal(flagValue(call, "--repo"), REPO);
  assert.equal(flagValue(call, "--base"), "main");
  assert.equal(flagValue(call, "--head"), branch);
  assert.equal(flagValue(call, "--title"), `chore(commissaire): pin governor key ${fp.slice(0, 12)}`);
  const body = flagValue(call, "--body");
  assert.match(body.split("\n")[0], /acme\/widgets.*main/);
  assert.ok(body.includes(fp));
  assert.ok(body.includes("Checked by `commissaire governor pin`"));
  assert.ok(body.includes("runner user: runner (uid 1001)"));
  assert.ok(body.includes("governor process uid: 990"));
  assert.ok(body.includes("key directory: /var/lib/gov, owner uid 990, mode 0700"));
  assert.ok(body.includes("A human must approve this PR"));
  assert.ok(body.indexOf("Reported by the governor") > body.indexOf("Checked by"));
  assert.equal(w.worktrees().length, 1, "the temporary worktree is removed");
  assert.deepEqual(w.localBranches(), ["main"]);
  assert.notEqual(w.ghCalls().some((c) => c[0] === "pr" && c[1] === "merge"), true, "pin never merges");
});

test("every git call pin makes carries -c core.hooksPath=/dev/null", () => {
  const w = world();
  assert.equal(pin(w).pinned, "opened-pr");
  const calls = w.gitCalls();
  assert.ok(calls.length >= 6);
  for (const c of calls) assert.ok(c.startsWith("-c core.hooksPath=/dev/null "), c);
});

test("the PR body shows checked_at and its age: 400 days is accepted, a future or unparseable date shows age unknown", () => {
  const body = (rc) => { const w = world(); const r = pin(w, {}, { peerRequest: peer(w, { runner_checks: rc }) }); assert.equal(r.pinned, "opened-pr", r.detail); return flagValue(prCreate(w), "--body"); };
  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  const section = (b) => b.slice(b.indexOf("Reported by the governor")).split("\n");
  let lines = section(body(runnerChecks({ checked_at: old })));
  assert.equal(lines[0], "Reported by the governor:");
  assert.match(lines[1], new RegExp(`^checked_at ${old.replace(/[.]/g, "\\.")}, record age 400 days$`));
  lines = section(body(runnerChecks({ checked_at: new Date(Date.now() + 5 * 86400000).toISOString() })));
  assert.match(lines[1], /age unknown$/);
  lines = section(body(runnerChecks({ checked_at: "not a date" })));
  assert.match(lines[1], /age unknown$/);
});

test("governor-supplied runner check values are reduced to printable ASCII, no backticks, 64 characters, inside a fenced block", () => {
  const w = world();
  const hostile = "[x](http://evil)\n```\n# heading `tick` " + "z".repeat(100) + "‮";
  const r = pin(w, {}, { peerRequest: peer(w, { runner_checks: runnerChecks({ install_version: hostile, source_tag: hostile }) }) });
  assert.equal(r.pinned, "opened-pr", r.detail);
  const body = flagValue(prCreate(w), "--body");
  const fenced = body.split("```");
  assert.equal(fenced.length, 3, "exactly one fenced block, so the hostile backticks did not open or close another");
  for (const line of fenced[1].split("\n").filter(Boolean)) {
    assert.match(line, /^[\x20-\x7e]+$/);
    assert.ok(line.split(": ").slice(1).join(": ").length <= 64, line);
  }
  assert.ok(!fenced[1].includes("`"));
});

test("the committed comment line carries only the host name, the peer uid and the UTC date", () => {
  const w = world();
  const r = pin(w, {}, { hostname: () => "my host\n#evil=1/long" + "x".repeat(80), peerRequest: peer(w, { evil: "# injected", comment: "# nope" }) });
  const file = w.show(r.branch, ".commissaire/trust.toml");
  const entry = file.split("\n").find((l) => l.includes('",'));
  assert.match(entry, /^  "[0-9a-f]{64}",  # myhostevil1longx{0,}.* governor uid 990, pinned \d{4}-\d{2}-\d{2}$/);
  assert.ok(entry.length < 64 + 140);
  assert.ok(!file.includes("injected") && !file.includes("nope"));
  const none = pin(world(), { "--dry-run": true }, { hostname: () => "" });
  assert.match(none.detail, /# unknown-host governor uid 990/);
});

test("pin keeps every pre-existing line byte-identical: comments before and after, a commented entry, a second fingerprint", () => {
  const original = [
    "schema = 1",
    "",
    "# Pinned governors; edit by pull request only.",
    "governor_key_fingerprints = [",
    `  "${OTHER_FP}",  # Fly governor, 2026-09-01`,
    "  # a hand-written note inside the array",
    "]",
    "",
    "# approvers below",
    'pin_change_approvers = ["human-login"]',
    "",
  ].join("\n");
  const w = world({ trustToml: original });
  const r = pin(w);
  assert.equal(r.pinned, "opened-pr", r.detail);
  const file = w.show(r.branch, ".commissaire/trust.toml");
  const before = original.split("\n"), after = file.split("\n");
  assert.equal(after.length, before.length + 1);
  const closing = before.indexOf("]");
  assert.deepEqual(after.slice(0, closing), before.slice(0, closing));
  assert.deepEqual(after.slice(closing + 1), before.slice(closing));
  assert.match(after[closing], /^  "[0-9a-f]{64}",  # host-1 governor uid 990, pinned \d{4}-\d{2}-\d{2}$/);
  const config = trustLib.validateSchema1(trustLib.parseTrustToml(file).value).value;
  assert.equal(config.governorKeyFingerprints.length, 2);
  assert.equal(config.governorKeyFingerprints[0], OTHER_FP);
  assert.ok(!flagValue(prCreate(w), "--body").includes("Reformatted"));
});

test("pin appends the array when the file has no governor_key_fingerprints", () => {
  const original = "schema = 1\nrequire_pinned_governor = false\n# keep me\n";
  const w = world({ trustToml: original });
  const r = pin(w);
  const file = w.show(r.branch, ".commissaire/trust.toml");
  assert.ok(file.startsWith(original));
  assert.equal(trustLib.validateSchema1(trustLib.parseTrustToml(file).value).value.governorKeyFingerprints.length, 1);
});

test("pin rewrites a single-line array to one entry per line, moves its trailing comment above, and says so in the PR body", () => {
  const original = `schema = 1\n\ngovernor_key_fingerprints = ["${OTHER_FP}"]  # Fly governor\nrequire_pinned_governor = false\n`;
  const w = world({ trustToml: original });
  const r = pin(w);
  assert.equal(r.pinned, "opened-pr", r.detail);
  const lines = w.show(r.branch, ".commissaire/trust.toml").split("\n");
  const at = lines.indexOf("# Fly governor");
  assert.equal(lines[at + 1], "governor_key_fingerprints = [");
  assert.equal(lines[at + 2], `  "${OTHER_FP}",`);
  assert.match(lines[at + 3], /^  "[0-9a-f]{64}",  # host-1/);
  assert.equal(lines[at + 4], "]");
  assert.equal(lines[at + 5], "require_pinned_governor = false");
  const body = flagValue(prCreate(w), "--body");
  assert.ok(body.includes("Reformatted the single-line governor_key_fingerprints array to one entry per line; no existing fingerprint changed"));
});

test("insertFingerprint: edge shapes (no trailing comma, empty array, CRLF, bracket sharing a line)", () => {
  const ins = (text) => admin.insertFingerprint(text, FP, "c");
  const ok = (t) => trustLib.validateSchema1(trustLib.parseTrustToml(t).value).value.governorKeyFingerprints;
  let r = ins(`schema = 1\ngovernor_key_fingerprints = [\n  "${OTHER_FP}"  # no comma\n]\n`);
  assert.deepEqual(ok(r.text), [OTHER_FP, FP]);
  assert.ok(r.text.includes(`  "${OTHER_FP}"  # no comma\n`), "the existing line is untouched");
  r = ins(`schema = 1\ngovernor_key_fingerprints = [\n]\n`);
  assert.deepEqual(ok(r.text), [FP]);
  r = ins(`schema = 1\r\ngovernor_key_fingerprints = [\r\n  "${OTHER_FP}",\r\n]\r\n`);
  assert.deepEqual(ok(r.text), [OTHER_FP, FP]);
  assert.ok(r.text.split("\n").slice(0, -1).every((l) => l.endsWith("\r")), "CRLF kept on every line");
  r = ins(`schema = 1\ngovernor_key_fingerprints = [\n  "${OTHER_FP}" ]\n`);
  assert.ok(r.error);
  r = ins("");
  assert.deepEqual(ok(r.text.replace(/^/, "schema = 1\n")), [FP]);
  r = ins(null);
  assert.ok(r.text.startsWith("schema = 1\n"));
});

test("pin refuses base-moved when the base branch no longer matches the bytes read", () => {
  const w = world({ trustToml: `schema = 1\n` });
  w.setGh({ trustMode: "present", trustToml: `schema = 1\n# stale copy that gh returned\n` });
  const r = pin(w);
  assert.equal(r.reason, "base-moved");
  assert.deepEqual(w.remoteBranches(), ["main"]);
  assert.equal(w.worktrees().length, 1);
  assert.deepEqual(w.localBranches(), ["main"]);
  const absent = world({ trustToml: null });
  absent.setGh({ trustMode: "present", trustToml: "schema = 1\n" });
  assert.equal(pin(absent).reason, "base-moved", "presence differs");
});

test("after a successful push and a failed gh pr create, pin deletes the remote branch", () => {
  const w = world();
  w.setGh({ prCreateFails: true });
  const r = pin(w);
  assert.equal(r.reason, "gh-failed");
  assert.match(r.detail, /deleted/);
  assert.deepEqual(w.remoteBranches(), ["main"]);
  assert.equal(w.worktrees().length, 1);
  assert.deepEqual(w.localBranches(), ["main"]);
});

test("when that delete also fails, the branch is named in the detail", () => {
  const w = world();
  w.setGh({ prCreateFails: true });
  require("node:child_process").execFileSync("git", ["config", "receive.denyDeletes", "true"], { cwd: w.bare });
  const r = pin(w);
  assert.equal(r.reason, "gh-failed");
  assert.match(r.detail, /commissaire\/pin-[0-9a-f]{12}/);
  assert.match(r.detail, /remains/);
});

test("a git failure refuses git-failed and never touches the remote branch it did not create", () => {
  const w = world();
  const squatted = pin(w, { "--dry-run": true });
  const branch = `commissaire/pin-${passingDeps(w).kp.pk_fingerprint.slice(0, 12)}`;
  assert.equal(squatted.pinned, "dry-run");
  const deps = passingDeps(w, { runGit: (bin, args, cwd) => (args[0] === "push" ? { status: 1, stdout: "", stderr: "rejected" } : admin.DEFAULT_DEPS.runGit(bin, args, cwd)) });
  const r = admin.pinCore(FLAGS, deps).result;
  assert.equal(r.reason, "git-failed");
  assert.match(r.detail, /git push/);
  assert.equal(w.worktrees().length, 1);
  assert.ok(!w.localBranches().includes(branch));
});

// --- FAFF-1217 review fixes -----------------------------------------------------------------------

const gitIn = (cwd, ...args) => require("node:child_process").execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const linkedWorktree = (w) => { const dir = join(w.root, "linked"); gitIn(w.work, "worktree", "add", "-q", "--detach", dir); return dir; };
const noGit = { peerRequest: noCalls("peerRequest"), runGit: noCalls("runGit"), runGh: noCalls("runGh") };

test("the default require closure covers the lazily loaded peer-cred module, its helper and the governor client", () => {
  const closure = admin.DEFAULT_DEPS.requireClosure();
  for (const name of ["peer-cred.js", "peer-cred-helper.py", "commissaire-governor-client.js", "governor-admin.js"]) {
    assert.ok(closure.some((f) => basename(f) === name), `${name} is in the closure`);
  }
  assert.equal(new Set(closure).size, closure.length, "no duplicates");
});

test("pin refuses repo-runner-writable for a runner-writable gitfile, working-tree root, .git/config or config.worktree", () => {
  const w = world();
  const linked = linkedWorktree(w);
  const linkedGitDir = admin.DEFAULT_DEPS.gitDir(linked);
  writeFileSync(join(linkedGitDir, "config.worktree"), "");
  writeFileSync(join(linkedGitDir, "config"), "");
  const repoLstat = (p) => (p.startsWith(w.work) || p.startsWith(realpathSync(w.work)) ? admin.DEFAULT_DEPS.lstat(p) : null);
  const cases = [
    ["gitfile", { gitDir: admin.DEFAULT_DEPS.gitDir, cwd: () => linked }, (p) => p === join(realpathSync(linked), ".git")],
    ["working-tree root", { gitDir: admin.DEFAULT_DEPS.gitDir, cwd: () => linked }, (p) => p === realpathSync(linked)],
    ["linked worktree's own config", { gitDir: admin.DEFAULT_DEPS.gitDir, cwd: () => linked }, (p) => p === join(realpathSync(linkedGitDir), "config")],
    ["linked worktree's config.worktree", { gitDir: admin.DEFAULT_DEPS.gitDir, cwd: () => linked, lstat: admin.DEFAULT_DEPS.lstat }, (p) => p === join(realpathSync(linkedGitDir), "config.worktree")],
    ["common dir config", { gitDir: admin.DEFAULT_DEPS.gitDir, cwd: () => linked }, (p) => p === join(realpathSync(w.work), ".git", "config")],
    [".git/config", {}, (p) => p === join(realpathSync(w.work), ".git", "config")],
  ];
  for (const [label, deps, predicate] of cases) {
    const r = pin(w, {}, { ...noGit, lstat: repoLstat, ...deps, runnerCanWrite: predicate });
    assert.equal(r.reason, "repo-runner-writable", label);
    assert.equal(r.pinned, "refused", label);
  }
  assert.equal(w.gitCalls().length, 0);
});

test("status skips git for a runner-writable git binary and says so, exit 0", () => {
  const w = world();
  const s = admin.statusCore(STATUS_FLAGS, passingDeps(w, { runGit: noCalls("runGit"), runnerCanWrite: (p) => p === realpathSync(w.gitShim) })).result;
  assert.deepEqual(s.counting.remote_base, { state: "unknown", reason: "git-runner-writable" });
  assert.equal(s.trust_source, null);
  assert.ok(s.caveats.some((c) => c.startsWith("pin would refuse code-runner-writable:") && c.includes("git")));
  assert.equal(s.ready_to_count, false);
  assert.equal(w.gitCalls().length, 0);
});

test("status skips gh for a runner-writable gh binary: remote_base, branch_protection and runner_identity are unknown by name", () => {
  const w = world();
  const s = admin.statusCore(STATUS_FLAGS, passingDeps(w, { runGh: noCalls("runGh"), runnerCanWrite: (p) => p === realpathSync(w.gh) })).result;
  assert.deepEqual(s.counting.remote_base, { state: "unknown", reason: "gh-runner-writable" });
  assert.deepEqual(s.counting.branch_protection, { state: "unknown", reason: "gh-runner-writable" });
  assert.deepEqual(s.counting.runner_identity, { state: "unknown", reason: "gh-runner-writable" });
  assert.ok(s.caveats.some((c) => c.startsWith("pin would refuse code-runner-writable:") && c.includes("gh")));
  assert.equal(s.ready_to_count, false);
});

test("status skips git for a runner-writable repository and says so", () => {
  const w = world();
  const s = admin.statusCore(STATUS_FLAGS, passingDeps(w, { runGit: noCalls("runGit"), lstat: (p) => (p.startsWith(w.work) || p.startsWith(realpathSync(w.work)) ? admin.DEFAULT_DEPS.lstat(p) : null), runnerCanWrite: (p) => p === join(realpathSync(w.work), ".git", "config") })).result;
  assert.deepEqual(s.counting.remote_base, { state: "unknown", reason: "repo-runner-writable" });
  assert.equal(s.trust_source, null);
  assert.ok(s.caveats.some((c) => c.startsWith("pin would refuse repo-runner-writable:")));
  assert.equal(w.gitCalls().length, 0);
  assert.equal(s.counting.branch_protection.state, "met", "gh does not depend on the repository");
});

test("repoFromRemoteUrl accepts only github.com, in https, ssh and scp forms", () => {
  for (const ok of ["https://github.com/acme/widgets.git", "ssh://git@github.com/acme/widgets", "git@github.com:acme/widgets.git", "https://GitHub.com/acme/widgets", "ssh://git@ssh.github.com:443/acme/widgets.git"]) {
    assert.equal(admin.repoFromRemoteUrl(ok), "acme/widgets", ok);
  }
  for (const no of ["git@gitlab.com:acme/widgets.git", "https://evil.example/acme/widgets", "https://github.com.evil.example/acme/widgets", "ssh://git@ghe.corp.example:2222/acme/widgets.git", "git@evil.example:acme/widgets", "git@github-work:acme/widgets.git"]) {
    assert.equal(admin.repoFromRemoteUrl(no), null, no);
  }
});

test("pin and status refuse an origin on another host with repo-mismatch, before any push", () => {
  const w = world();
  w.git("remote", "set-url", "origin", "git@evil.example:acme/widgets.git");
  const r = pin(w);
  assert.equal(r.reason, "repo-mismatch");
  assert.deepEqual(w.remoteBranches(), ["main"]);
  assert.equal(w.ghCalls().filter((c) => c[0] === "pr").length, 0);
  const s = admin.statusCore(STATUS_FLAGS, passingDeps(w)).result;
  assert.deepEqual(s.counting.remote_base, { state: "not-met", reason: "repo-mismatch" });
});

test("the PR body names the pushed commit, and the PR's head is read back and matches it", () => {
  const w = world();
  const r = pin(w);
  assert.equal(r.pinned, "opened-pr", r.detail);
  const sha = gitIn(w.bare, "rev-parse", `refs/heads/${r.branch}`);
  assert.ok(flagValue(prCreate(w), "--body").includes(`Pushed commit: \`${sha}\``));
  const view = w.ghCalls().find((c) => c[0] === "pr" && c[1] === "view");
  assert.deepEqual(view, ["pr", "view", r.pr_url, "--repo", REPO, "--json", "headRefOid"]);
});

test("a PR whose head is not the pushed commit is closed, its branch deleted, and pin refuses pr-head-mismatch", () => {
  const w = world();
  w.setGh({ prHeadOid: "f".repeat(40) });
  const r = pin(w);
  assert.equal(r.pinned, "refused");
  assert.equal(r.reason, "pr-head-mismatch");
  assert.equal(r.pr_url, null);
  assert.match(r.detail, /closed and its branch deleted/);
  const close = w.ghCalls().find((c) => c[0] === "pr" && c[1] === "close");
  assert.deepEqual(close, ["pr", "close", "https://github.com/acme/widgets/pull/7", "--repo", REPO, "--delete-branch"]);
  assert.deepEqual(w.remoteBranches(), ["main"]);
  assert.deepEqual(w.localBranches(), ["main"]);
});

test("a plain clone is not refused repo-runner-writable when the optional config.worktree is absent (real ancestors)", () => {
  const w = world();
  const split = (p) => { const out = []; for (let c = p; ; c = c.replace(/\/[^/]*$/, "") || "/") { out.push(c); if (c === "/") break; } return out; };
  const inRepo = (p) => p.startsWith(w.work) || p.startsWith(realpathSync(w.work));
  const ancestors = (p) => (inRepo(p) ? admin.DEFAULT_DEPS.ancestors(p) : split(p));
  assert.equal(existsSync(join(w.work, ".git", "config.worktree")), false);
  const r = pin(w, {}, { ancestors });
  assert.equal(r.pinned, "opened-pr", r.detail);
  const s = admin.statusCore(STATUS_FLAGS, passingDeps(w, { ancestors })).result;
  assert.notEqual(s.counting.remote_base.reason, "repo-runner-writable");
});

test("a linked worktree with no config of its own is not refused repo-runner-writable (real ancestors)", () => {
  const w = world();
  const linked = linkedWorktree(w);
  const linkedGitDir = admin.DEFAULT_DEPS.gitDir(linked);
  assert.equal(existsSync(join(linkedGitDir, "config")), false);
  const split = (p) => { const out = []; for (let c = p; ; c = c.replace(/\/[^/]*$/, "") || "/") { out.push(c); if (c === "/") break; } return out; };
  const inRepo = (p) => p.startsWith(w.work) || p.startsWith(realpathSync(w.work));
  const ancestors = (p) => (inRepo(p) ? admin.DEFAULT_DEPS.ancestors(p) : split(p));
  const lstat = (p) => (inRepo(p) ? admin.DEFAULT_DEPS.lstat(p) : null);
  const r = pin(w, { "--dry-run": true }, { gitDir: admin.DEFAULT_DEPS.gitDir, cwd: () => linked, ancestors, lstat });
  assert.notEqual(r.reason, "repo-runner-writable", r.detail);
});

test("neither command calls sudo or doas: the only process launches are id, getent, git and gh", () => {
  const src = readFileSync(require.resolve("../plugin/skills/faff/bin/lib/governor-admin.js"), "utf8");
  assert.equal((src.match(/spawnSync\(/g) || []).length, 1, "one spawn site, inside exec");
  const callees = [...src.matchAll(/[^\w.]exec\(\s*([\w.]+)/g)].map((m) => m[1]).filter((n) => n !== "bin");
  assert.deepEqual(callees.sort(), ["getent", "idBin"]);
  assert.doesNotMatch(src, /resolveBin\(\s*["'`](?:sudo|doas)/);
  assert.doesNotMatch(src, /exec\(\s*["'`][^"'`]*(?:sudo|doas)/);
  const w = world();
  const bins = [];
  const spy = (orig) => (bin, ...rest) => { bins.push(bin); return orig(bin, ...rest); };
  const base = passingDeps(w, {});
  pin(w, {}, { runGit: spy(base.runGit), runGh: spy(base.runGh) });
  admin.statusCore(STATUS_FLAGS, passingDeps(w, { runGit: spy(base.runGit), runGh: spy(base.runGh) }));
  assert.ok(bins.length > 0);
  for (const bin of bins) assert.ok(bin === w.gitShim || bin === w.gh, `unexpected binary ${bin}`);
});

test("gh pr create printing no PR URL for the repo refuses gh-failed and never views or closes a PR", () => {
  for (const prUrl of ["", "Creating pull request...", "https://github.com/other/repo/pull/7"]) {
    const w = world();
    w.setGh({ prUrl });
    const r = pin(w);
    assert.equal(r.reason, "gh-failed", prUrl);
    assert.ok(!w.ghCalls().some((c) => c[0] === "pr" && (c[1] === "view" || c[1] === "close")), prUrl);
    assert.deepEqual(w.remoteBranches(), ["main"], prUrl);
  }
});

test("an unreadable PR head also refuses pr-head-mismatch, and a failed close falls back to deleting the remote branch", () => {
  const w = world();
  w.setGh({ prViewFails: true, prCloseFails: true });
  const r = pin(w);
  assert.equal(r.reason, "pr-head-mismatch");
  assert.match(r.detail, /could not be read/);
  assert.match(r.detail, /was deleted/);
  assert.deepEqual(w.remoteBranches(), ["main"]);
});

test("a markdown-link checked_at is never printed outside the fence; the age reads unknown", () => {
  const w = world();
  const r = pin(w, {}, { peerRequest: peer(w, { runner_checks: runnerChecks({ checked_at: "[click](http://evil.example)" }) }) });
  assert.equal(r.pinned, "opened-pr", r.detail);
  const parts = flagValue(prCreate(w), "--body").split("```");
  assert.ok(!parts[0].includes("evil.example") && !parts[2].includes("evil.example"));
  assert.ok(parts[0].includes("Reported by the governor:\nrecord age unknown"));
});

test("a symlinked .commissaire or trust.toml on the base branch is refused trust-file-invalid and nothing is written through it", () => {
  const w = world();
  const outside = join(w.root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(w.work, ".commissaire"));
  gitIn(w.work, "add", "-A");
  gitIn(w.work, "commit", "-q", "-m", "symlink");
  gitIn(w.work, "push", "-q", "origin", "main");
  let r = pin(w);
  assert.equal(r.reason, "trust-file-invalid");
  assert.match(r.detail, /symlink/);
  assert.deepEqual(readdirSync(outside), []);
  assert.deepEqual(w.remoteBranches(), ["main"]);

  const v = world();
  mkdirSync(join(v.work, ".commissaire"));
  symlinkSync(join(v.root, "elsewhere.toml"), join(v.work, ".commissaire", "trust.toml"));
  gitIn(v.work, "add", "-A");
  gitIn(v.work, "commit", "-q", "-m", "symlink");
  gitIn(v.work, "push", "-q", "origin", "main");
  r = pin(v);
  assert.equal(r.reason, "trust-file-invalid");
  assert.ok(!existsSync(join(v.root, "elsewhere.toml")));
  assert.deepEqual(v.remoteBranches(), ["main"]);
});

// --- status ---------------------------------------------------------------------------------------

const ready = (w) => {
  const deps = passingDeps(w);
  w.setGh({ trustMode: "present", trustToml: `schema = 1\ngovernor_key_fingerprints = ["${deps.kp.pk_fingerprint}"]\n`, human: "human-login" });
  return deps;
};
const STATUS_FLAGS = { "--socket": "/tmp/g.sock", "--runner-user": "runner", "--repo": REPO, "--runner-login": "runner-bot" };

test("status with no endpoint is in-process, socket not-configured, never ready, and always carries the three caveats", () => {
  const w = world();
  const o = admin.statusCore({}, passingDeps(w, { peerRequest: noCalls("peerRequest") }));
  const s = o.result;
  assert.equal(s.custody, "in-process");
  assert.equal(s.socket, "not-configured");
  assert.equal(s.transport, null);
  assert.equal(s.ready_to_count, false);
  assert.equal(s.host_checks, "unknown");
  assert.equal(s.install_result, "unknown");
  assert.equal(s.caveats.filter((c) => /bypass actors|--runner-login|does not try to open the key file/.test(c)).length, 3);
});

test("status reports a governor that answers, with every counting condition met and the pin missing", () => {
  const w = world();
  const deps = passingDeps(w);
  w.setGh({ human: "human-login" });
  const s = admin.statusCore(STATUS_FLAGS, deps).result;
  assert.deepEqual([s.custody, s.socket, s.transport, s.governor_uid, s.runner_user, s.host_checks, s.install_result], ["governor", "answers", "unix", 990, "runner", "passed", "passed"]);
  assert.equal(s.pk_fingerprint, deps.kp.pk_fingerprint);
  assert.deepEqual(s.runner_checks.runner_user, "runner");
  assert.deepEqual(Object.values(s.counting).map((c) => c.state), ["met", "met", "met"]);
  assert.equal(s.trust_source, "remote-base");
  assert.equal(s.pinned_on_base, "no");
  assert.equal(s.ready_to_count, false);
  assert.ok(s.caveats.includes("Only the pin is missing: merge the pin PR on the base branch."));
});

test("status is ready_to_count only when everything holds and the identified governor's own fingerprint is pinned", () => {
  const w = world();
  const deps = ready(w);
  let s = admin.statusCore(STATUS_FLAGS, deps).result;
  assert.equal(s.pinned_on_base, "yes");
  assert.equal(s.ready_to_count, true);
  assert.ok(!s.caveats.some((c) => c.startsWith("Only the pin")));
  w.setGh({ trustMode: "present", trustToml: `schema = 1\ngovernor_key_fingerprints = ["${OTHER_FP}"]\n` });
  s = admin.statusCore(STATUS_FLAGS, deps).result;
  assert.equal(s.pinned_on_base, "no", "another governor's pin does not count");
  assert.equal(s.ready_to_count, false);
});

test("status socket states: unreachable, refused, invalid reply; custody stays governor and nothing is ready", () => {
  const w = world();
  const run = (peerRequest) => admin.statusCore(STATUS_FLAGS, passingDeps(w, { peerRequest })).result;
  let s = run(() => ({ unreachable: true, detail: "ENOENT" }));
  assert.deepEqual([s.custody, s.socket, s.host_checks, s.install_result, s.ready_to_count, s.pk_fingerprint, s.governor_uid], ["governor", "unreachable", "unknown", "unknown", false, null, null]);
  s = run(() => ({ ok: true, reply: { ok: false, reason: "caller-not-allowed" }, peer_uid: 990 }));
  assert.equal(s.socket, "refused:caller-not-allowed");
  s = run(() => ({ ok: true, reply: { ok: false, reason: "unknown-op" }, peer_uid: 990 }));
  assert.equal(s.socket, "refused:unknown-op");
  s = run(peer(w, { pk_fingerprint: undefined }));
  assert.deepEqual([s.socket, s.pk_fingerprint, s.ready_to_count, s.custody], ["invalid-reply", null, false, "governor"]);
  s = run(peer(w, { pk_fingerprint: OTHER_FP }));
  assert.equal(s.socket, "invalid-reply");
});

test("status installed record: missing, failed; unknown without --runner-user or with an unresolvable one", () => {
  const w = world();
  const run = (flags, over) => admin.statusCore(drop({ ...STATUS_FLAGS, ...flags }), passingDeps(w, over)).result;
  assert.equal(run({}, { peerRequest: peer(w, { runner_checks: null }) }).install_result, "missing");
  assert.equal(run({}, { peerRequest: peer(w, { runner_checks: runnerChecks({ docker_group: true, independent: false }) }) }).install_result, "failed");
  const noUser = run({ "--runner-user": undefined });
  assert.deepEqual([noUser.install_result, noUser.host_checks, noUser.runner_user], ["unknown", "unknown", null]);
  const unresolvable = run({}, { lookupRunner: () => null });
  assert.deepEqual([unresolvable.install_result, unresolvable.host_checks], ["unknown", "unknown"]);
});

test("status host_checks runs pin's list: invoker checks win whatever the socket does; runner groups, uid and key directory fail by name", () => {
  const w = world();
  const run = (over, flags = {}) => admin.statusCore(drop({ ...STATUS_FLAGS, ...flags }), passingDeps(w, over)).result;
  assert.equal(run({ getuid: () => 0 }).host_checks, "failed:invoked-as-root");
  assert.equal(run({ getuid: () => 0, peerRequest: () => ({ unreachable: true, detail: "x" }) }).host_checks, "failed:invoked-as-root");
  assert.equal(run({ getuid: () => 1001 }).host_checks, "failed:invoked-as-runner");
  assert.equal(run({ getuid: () => 1001, peerRequest: () => ({ unreachable: true, detail: "x" }) }).host_checks, "failed:invoked-as-runner");
  assert.equal(run({ getuid: () => 0 }, { "--runner-user": undefined }).host_checks, "failed:invoked-as-root");
  assert.equal(run({ lookupRunner: () => ({ uid: 1001, gids: [1001], groups: ["runner", "docker"] }) }).host_checks, "failed:runner-root-equivalent");
  assert.equal(run({ peerRequest: peer(w, {}, 0) }).host_checks, "failed:governor-is-root");
  assert.equal(run({ peerRequest: peer(w, {}, 1001) }).host_checks, "failed:governor-same-user");
  const groupWritable = (p) => (p === "/var/lib/gov" ? { uid: 990, gid: 990, mode: 0o770, isDirectory: true, isSymlink: false } : passingDeps(w).stats[p] ?? null);
  const s = run({ lstat: groupWritable });
  assert.equal(s.host_checks, "failed:key-dir-untrusted");
  assert.equal(s.ready_to_count, false);
});

test("status does not open the key file (a readable key does not change host_checks) and the runner-writable facts are caveats only", () => {
  const w = world();
  const s = admin.statusCore(STATUS_FLAGS, passingDeps(w, { openNoFollow: noCalls("openNoFollow"), runnerCanWrite: (p) => p === w.work || p.includes("/opt/commissaire/1/lib/a.js") })).result;
  assert.equal(s.host_checks, "passed");
  assert.ok(s.caveats.some((c) => c.includes("code-runner-writable")));
  assert.ok(s.caveats.some((c) => c.includes("repo-runner-writable")));
});

test("status on macOS and for a TCP endpoint: host_checks unknown, never ready; TCP is not queried", () => {
  const w = world();
  let s = admin.statusCore(STATUS_FLAGS, passingDeps(w, { platform: () => "darwin" })).result;
  assert.equal(s.host_checks, "unknown");
  assert.equal(s.ready_to_count, false);
  assert.ok(s.caveats.some((c) => c.includes("FAFF-1251")));
  s = admin.statusCore({ ...STATUS_FLAGS, "--socket": "127.0.0.1:9000" }, passingDeps(w, { peerRequest: noCalls("peerRequest") })).result;
  assert.deepEqual([s.custody, s.transport, s.host_checks, s.ready_to_count], ["governor", "tcp", "unknown", false]);
  s = admin.statusCore({ ...STATUS_FLAGS, "--socket": "127.0.0.1:9000" }, passingDeps(w, { getuid: () => 0, peerRequest: noCalls("peerRequest") })).result;
  assert.equal(s.host_checks, "failed:invoked-as-root", "an invoker failure is reported for every endpoint");
});

test("status with gh missing: remote_base, branch_protection and runner_identity unknown; exit 0", () => {
  const w = world();
  const s = admin.statusCore(STATUS_FLAGS, passingDeps(w, { resolveBin: (n) => (n === "git" ? w.gitShim : null) })).result;
  assert.equal(s.counting.remote_base.state, "unknown");
  assert.equal(s.counting.branch_protection.state, "unknown");
  assert.equal(s.counting.runner_identity.state, "unknown");
  assert.equal(s.pinned_on_base, "unknown");
  assert.equal(s.ready_to_count, false);
});

test("status remote_base: repo-mismatch and no-remote-base are not-met; a failing gh read is unknown", () => {
  const w = world();
  let s = admin.statusCore({ ...STATUS_FLAGS, "--repo": "someone/fork" }, passingDeps(w)).result;
  assert.deepEqual(s.counting.remote_base, { state: "not-met", reason: "repo-mismatch" });
  w.git("remote", "remove", "origin");
  s = admin.statusCore(STATUS_FLAGS, passingDeps(w)).result;
  assert.deepEqual(s.counting.remote_base, { state: "not-met", reason: "no-remote-base" });
  const down = world();
  down.setGh({ trustMode: "down" });
  s = admin.statusCore(STATUS_FLAGS, passingDeps(down)).result;
  assert.deepEqual(s.counting.remote_base, { state: "unknown", reason: "gh-unavailable" });
  assert.equal(s.trust_source, "local-ref", "a local read is shown for display only");
  assert.equal(s.pinned_on_base, "unknown");
});

test("status without --repo uses origin's repository", () => {
  const w = world();
  const s = admin.statusCore({ "--socket": "/tmp/g.sock", "--runner-user": "runner" }, passingDeps(w)).result;
  assert.equal(s.counting.remote_base.state, "met");
  assert.ok(w.ghCalls().some((c) => c.join(" ").includes(`repos/${REPO}/`)));
});

test("status branch_protection: a pull_request rule is met; [] is not-met; errors, 404 bodies and non-arrays are unknown", () => {
  const w = world();
  const bp = (rules) => { w.setGh({ rules }); return admin.statusCore(STATUS_FLAGS, passingDeps(w)).result.counting.branch_protection; };
  assert.deepEqual(bp([{ type: "deletion" }, { type: "pull_request" }]), { state: "met", reason: null });
  assert.deepEqual(bp([]), { state: "not-met", reason: "base-not-protected" });
  assert.deepEqual(bp([{ type: "deletion" }]), { state: "not-met", reason: "base-not-protected" });
  for (const bad of ["fail", "garbage", { message: "Not Found" }]) assert.deepEqual(bp(bad), { state: "unknown", reason: "rules-unreadable" });
});

test("status and FAFF-1212's hasPullRequestRule give the same answer on the same fixtures", () => {
  const fixtures = [[], [{ type: "pull_request" }], [{ type: "deletion" }, { type: "pull_request", parameters: {} }], [{ type: "required_status_checks" }], [null], [{}], { type: "pull_request" }, "pull_request", null];
  for (const rules of fixtures) {
    assert.equal(admin.rulesRequirePullRequest(rules), mergeGate.hasPullRequestRule(rules), JSON.stringify(rules));
  }
  const w = world();
  for (const rules of fixtures.filter(Array.isArray)) {
    w.setGh({ rules });
    const met = admin.statusCore(STATUS_FLAGS, passingDeps(w)).result.counting.branch_protection.state === "met";
    assert.equal(met, mergeGate.hasPullRequestRule(rules), JSON.stringify(rules));
  }
});

test("status runner_identity: same login (case, [bot] stripped) or a pin approver is not-met; unknowns never pass", () => {
  const w = world();
  const identity = (flags, gh = {}) => { w.setGh({ human: "Human-Login", trustMode: "present", trustToml: "schema = 1\npin_change_approvers = [\"Reviewer\"]\n", ...gh }); return admin.statusCore(drop({ ...STATUS_FLAGS, ...flags }), passingDeps(w)).result.counting.runner_identity; };
  assert.deepEqual(identity({ "--runner-login": "runner-bot" }), { state: "met", reason: null });
  assert.deepEqual(identity({ "--runner-login": "HUMAN-login[bot]" }), { state: "not-met", reason: "runner-identity-not-separate" });
  assert.deepEqual(identity({ "--runner-login": "human-login" }), { state: "not-met", reason: "runner-identity-not-separate" });
  assert.deepEqual(identity({ "--runner-login": "reviewer[bot]" }), { state: "not-met", reason: "runner-is-pin-approver" });
  assert.deepEqual(identity({ "--runner-login": undefined }), { state: "unknown", reason: "runner-login-not-given" });
  assert.deepEqual(identity({}, { userFails: true }), { state: "unknown", reason: "human-login-unreadable" });
  assert.deepEqual(identity({}, { trustMode: "down" }), { state: "unknown", reason: "approvers-unreadable" });
});

test("status ready_to_count follows step 9: each failing input keeps it false", () => {
  const w = world();
  const base = ready(w);
  assert.equal(admin.statusCore(STATUS_FLAGS, base).result.ready_to_count, true);
  const falsify = (name, flags, over, gh) => {
    const deps = ready(w);
    if (gh) w.setGh({ trustMode: "present", trustToml: `schema = 1\ngovernor_key_fingerprints = ["${deps.kp.pk_fingerprint}"]\n`, human: "human-login", ...gh });
    assert.equal(admin.statusCore(drop({ ...STATUS_FLAGS, ...flags }), { ...deps, ...over }).result.ready_to_count, false, name);
  };
  falsify("no runner login", { "--runner-login": undefined }, {});
  falsify("runner is human", { "--runner-login": "human-login" }, {});
  falsify("unprotected base", {}, {}, { rules: [] });
  falsify("macOS", {}, { platform: () => "darwin" });
  falsify("install failed", {}, { peerRequest: peer(w, { runner_checks: runnerChecks({ sudo_rules: true, sudo_absent: false, independent: false }) }) });
  falsify("TCP", { "--socket": "127.0.0.1:9000" }, {});
  falsify("repo mismatch", { "--repo": "someone/fork" }, {});
});

test("status prints the trust-file-invalid error object and exits 2; a usage error prints to stderr only", () => {
  const w = world();
  w.setGh({ trustMode: "present", trustToml: "schema = 1\n\n\nbogus = 1\n" });
  const o = admin.statusCore(STATUS_FLAGS, passingDeps(w));
  assert.equal(o.error.error, "trust-file-invalid");
  assert.match(o.error.detail, /^trust-file-invalid: line 4: /);
  const printed = []; const errs = [];
  const log = console.log, write = process.stderr.write;
  console.log = (s) => printed.push(s); process.stderr.write = (s) => { errs.push(s); return true; };
  try {
    assert.equal(admin.governorStatus(STATUS_FLAGS, passingDeps(w)), 2);
    assert.equal(JSON.parse(printed[0]).error, "trust-file-invalid");
    printed.length = 0;
    assert.equal(admin.governorStatus({ "--repo": "bad" }), 2);
    assert.deepEqual(printed, []);
    assert.match(errs.join(""), /--repo/);
    w.setGh({});
    assert.equal(admin.governorStatus(STATUS_FLAGS, passingDeps(w)), 0, "unmet conditions still exit 0");
    assert.equal(admin.governorPin(STATUS_FLAGS, passingDeps(w, { getuid: () => 0 })), 1, "a refusal exits 1");
    assert.equal(JSON.parse(printed.at(-1)).reason, "invoked-as-root");
  } finally { console.log = log; process.stderr.write = write; }
});

test("status reads a local trust file for display when there is no remote", () => {
  const w = world({ trustToml: "schema = 1\n" });
  w.git("remote", "remove", "origin");
  const s = admin.statusCore({ "--runner-user": "runner" }, passingDeps(w, { cwd: () => w.work })).result;
  assert.equal(s.trust_source, "local-ref");
  assert.equal(s.pinned_on_base, "unknown");
});

// --- readTrustFileText ---------------------------------------------------------------------------

test("readTrustFileText returns the committed bytes, or null text for an absent file; readTrustFile keeps its answers", () => {
  const w = world({ trustToml: "schema = 1\n# keep\n" });
  const read = trustLib.readTrustFileText({ repoDir: w.work, ref: "HEAD", transport: "local" });
  assert.deepEqual([read.ok, read.value.present, read.value.text, read.value.source], [true, true, "schema = 1\n# keep\n", "local-ref"]);
  const parsed = trustLib.readTrustFile({ repoDir: w.work, ref: "HEAD", transport: "local" });
  assert.equal(parsed.value.present, true);
  assert.equal(parsed.value.config.schema, 1);
  const bare = world();
  const absent = trustLib.readTrustFileText({ repoDir: bare.work, ref: "HEAD", transport: "local" });
  assert.deepEqual([absent.ok, absent.value.present, absent.value.text], [true, false, null]);
  assert.equal(trustLib.readTrustFileText({ repoDir: bare.work, ref: "HEAD", transport: "remote" }).ok, false);
  assert.equal(trustLib.readTrustFileText({ repoDir: bare.work, ref: "nope", transport: "local" }).ok, false);
});

// --- identify on the governor ---------------------------------------------------------------------

class FakeSocket extends EventEmitter {
  constructor() { super(); this._handle = { fd: -1 }; this.ended = null; }
  setEncoding() {}
  end(data) { this.ended = data; return this; }
  destroy() {}
}
const stubReader = (uid) => ({ readPeerUid: () => ({ ok: true, uid }) });
function sendTo(state, callers, uid, request) {
  const sock = new FakeSocket();
  governor.guardUnixConnection(state, callers, stubReader(uid), sock);
  if (sock.ended === null) sock.emit("data", JSON.stringify(request) + "\n");
  return JSON.parse(sock.ended);
}
const keyDirs = [];
const mkKeyDir = () => { const d = mkdtempSync(join(tmpdir(), "gid-")); keyDirs.push(d); return d; };
after(() => { for (const d of keyDirs) rmSync(d, { recursive: true, force: true }); });
const logLines = (dir) => readFileSync(join(dir, "governor-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("identify: a runner caller and an admin caller both get pk, fingerprint, absolute key_file and runner_checks; admit stays refused for the admin; both are logged", () => {
  const dir = mkKeyDir();
  const opened = governor.openState(dir);
  const record = runnerChecks();
  opened.state.runnerChecks = record;
  const callers = new Map([[1001, "runner"], [1000, "admin"]]);
  for (const [uid, role] of [[1001, "runner"], [1000, "admin"]]) {
    const reply = sendTo(opened.state, callers, uid, { op: "identify" });
    assert.equal(reply.ok, true);
    assert.equal(reply.pk, opened.state.pk);
    assert.equal(reply.pk_fingerprint, opened.state.pk_fingerprint);
    assert.equal(reply.key_file, join(dir, "governor-key.json"));
    assert.ok(reply.key_file.startsWith("/"));
    assert.deepEqual(reply.runner_checks, record);
    const line = logLines(dir).at(-1);
    assert.deepEqual([line.op, line.peer_uid, line.caller_role], ["identify", uid, role]);
  }
  const refused = sendTo(opened.state, callers, 1000, { op: "admit", run_id: "R", producer_id: "P", contract_revision: "r", admitted_scope: ["merge"] });
  assert.equal(refused.reason, "op-not-permitted-for-admin");
  assert.equal(opened.state.admissions.size, 0, "identify and the refused admit minted no state");
});

test("identify: runner_checks is null when the governor has none; a caller outside the lists never reaches it", () => {
  const dir = mkKeyDir();
  const opened = governor.openState(dir);
  const callers = new Map([[1001, "runner"]]);
  assert.equal(sendTo(opened.state, callers, 1001, { op: "identify" }).runner_checks, null);
  assert.equal(sendTo(opened.state, callers, 4242, { op: "identify" }).reason, "caller-not-allowed");
});

test("identify: answered on the Unix listener only; a socket-less call (the TCP path) gets op-unix-only", () => {
  const dir = mkKeyDir();
  const opened = governor.openState(dir);
  assert.deepEqual(governor.handleRequest(opened.state, { op: "identify" }), { ok: false, reason: "op-unix-only" });
});

const LINUX = process.platform === "linux" && existsSync("/usr/bin/python3");
const SKIP_LIVE = LINUX ? false : "needs linux + /usr/bin/python3 for the peer-credential guard";

function startGovernor({ listen } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gv-"));
  keyDirs.push(dir);
  chmodSync(dir, 0o700);
  writeFileSync(join(dir, "governor-config.json"), JSON.stringify({ allow_uids: [process.getuid()], runner_checks: runnerChecks({ runner_uid: process.getuid() }) }), { mode: 0o600 });
  const sock = join(dir, "g.sock");
  const args = [COMMISSAIRE, "governor", "start", "--key-dir", dir, "--socket", sock, ...(listen ? ["--listen", listen] : [])];
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, COMMISSAIRE_GOVERNOR: undefined } });
  const ready = new Promise((resolve, reject) => {
    let out = "";
    const to = setTimeout(() => reject(new Error(`governor did not start: ${out}`)), 8000);
    child.stdout.on("data", (c) => { out += c; if ((listen ? out.match(/"listening"/g) ?? [] : out.match(/"listening"/g) ?? []).length >= (listen ? 2 : 1)) { clearTimeout(to); resolve(); } });
    child.on("error", (e) => { clearTimeout(to); reject(e); });
  });
  return { child, ready, sock, dir };
}

const tcpRequest = (port, request) => new Promise((resolve, reject) => {
  const c = net.connect(port, "127.0.0.1", () => c.write(JSON.stringify(request) + "\n"));
  let buf = "";
  c.on("data", (d) => { buf += d; });
  c.on("close", () => resolve(JSON.parse(buf)));
  c.on("error", reject);
});

test("identify over TCP answers op-unix-only and discloses nothing; over the Unix socket the client reads the kernel's uid for the governor", { skip: SKIP_LIVE }, async () => {
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const g = startGovernor({ listen: `127.0.0.1:${port}` });
  try {
    await g.ready;
    const over = await tcpRequest(port, { op: "identify" });
    assert.deepEqual(over, { ok: false, reason: "op-unix-only" });
    const res = client.governorRequestWithPeer({ kind: "unix", socket_path: g.sock }, { op: "identify" }, { connect_ms: 3000, reply_ms: 10000 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.peer_uid, process.getuid(), "a same-user governor reports the invoker's own uid");
    assert.equal(res.reply.pk_fingerprint, JSON.parse(readFileSync(join(g.dir, "governor-key.json"), "utf8")).pk_fingerprint);
    assert.equal(res.reply.key_file, join(g.dir, "governor-key.json"));
    assert.equal(res.reply.runner_checks.runner_uid, process.getuid());
    const tcpEndpoint = client.governorRequestWithPeer({ kind: "tcp", host: "127.0.0.1", port }, { op: "identify" }, { connect_ms: 1000, reply_ms: 1000 });
    assert.deepEqual(tcpEndpoint, { unreachable: true, detail: "peer-credentials-unix-only" });
    assert.deepEqual(client.governorRequestWithPeer({ kind: "unix", socket_path: join(g.dir, "none.sock") }, { op: "identify" }, { connect_ms: 1000, reply_ms: 1000 }), { unreachable: true, detail: "ENOENT" });
    const logged = logLines(g.dir).filter((l) => l.op === "identify");
    assert.ok(logged.length >= 2, "both identify calls are logged");
  } finally { g.child.kill("SIGTERM"); await delay(100); }
});

test("a failed peer read is unreachable with peer-credentials-unreadable and never falls back to an unchecked call", { skip: SKIP_LIVE }, async () => {
  const g = startGovernor();
  const preload = join(mkKeyDir(), "preload.cjs");
  writeFileSync(preload, `const pc = require(${JSON.stringify(join(LIB, "peer-cred.js"))}); pc.makePeerCredReader = () => ({ readPeerUid: () => ({ ok: false, error: "stub-failure" }) });\n`);
  const saved = process.env.NODE_OPTIONS;
  try {
    await g.ready;
    process.env.NODE_OPTIONS = `--require ${preload}`;
    const res = client.governorRequestWithPeer({ kind: "unix", socket_path: g.sock }, { op: "identify" }, { connect_ms: 3000, reply_ms: 10000 });
    assert.deepEqual(res, { unreachable: true, detail: "peer-credentials-unreadable" });
  } finally {
    if (saved === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = saved;
    g.child.kill("SIGTERM"); await delay(100);
  }
});

test("end to end through the CLI: status against a live same-user governor reports the kernel's uid and refuses to call it independent", { skip: SKIP_LIVE }, async () => {
  const g = startGovernor();
  const w = world();
  try {
    await g.ready;
    const r = spawnSync(process.execPath, [COMMISSAIRE, "governor", "status", "--socket", g.sock, "--runner-user", "root"], { cwd: w.work, encoding: "utf8", env: { ...process.env, PATH: dirname(w.gh) + ":" + process.env.PATH } });
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(r.stdout);
    assert.deepEqual([s.custody, s.socket, s.transport, s.governor_uid], ["governor", "answers", "unix", process.getuid()]);
    assert.notEqual(s.host_checks, "passed");
    assert.equal(s.ready_to_count, false);
    const p = spawnSync(process.execPath, [COMMISSAIRE, "governor", "pin", "--socket", g.sock, "--runner-user", "root", "--repo", REPO, "--dry-run"], { cwd: w.work, encoding: "utf8" });
    assert.equal(p.status, 1);
    assert.equal(JSON.parse(p.stdout).pinned, "refused");
  } finally { g.child.kill("SIGTERM"); await delay(100); }
});

// --- parity, region and import guards -------------------------------------------------------------

test("`faff commissaire governor pin|status` and `commissaire governor pin|status` are byte-identical", () => {
  const empty = mkdtempSync(join(tmpdir(), "gadm-parity-"));
  keyDirs.push(empty);
  const env = { ...process.env, PATH: "/nonexistent", GIT_CONFIG_GLOBAL: "/dev/null" };
  delete env.COMMISSAIRE_GOVERNOR;
  for (const args of [
    ["governor", "pin"], ["governor", "pin", "--socket", "/tmp/x.sock", "--runner-user", "r", "--repo", "bad"], ["governor", "status", "--bogus"],
    ["governor", "status"], ["governor", "status", "--runner-user", "nobody-here", "--runner-login", "bot"], ["governor", "pin", "--socket", "/tmp/x.sock", "--runner-user", "r", "--repo", "a/b"],
  ]) {
    const a = spawnSync(process.execPath, [FAFF, "commissaire", ...args], { cwd: empty, encoding: "utf8", env });
    const b = spawnSync(process.execPath, [COMMISSAIRE, ...args], { cwd: empty, encoding: "utf8", env });
    assert.equal(b.stdout, a.stdout, `stdout: ${args.join(" ")}`);
    assert.equal(b.stderr, a.stderr, `stderr: ${args.join(" ")}`);
    assert.equal(b.status, a.status, `exit: ${args.join(" ")}`);
  }
  const status = spawnSync(process.execPath, [COMMISSAIRE, "governor", "status"], { cwd: empty, encoding: "utf8", env });
  assert.equal(status.status, 0, status.stderr);
  const s = JSON.parse(status.stdout);
  assert.deepEqual([s.custody, s.socket, s.ready_to_count], ["in-process", "not-configured", false]);
  assert.deepEqual(s.counting.remote_base.state === "not-met" || s.counting.remote_base.state === "unknown", true);
});

test("the CLI reaches no deps seam: the dispatch entries pass only flags", () => {
  const source = readFileSync(join(LIB, "commissaire.ts"), "utf8");
  assert.match(source, /"governor pin": \(flags\) => require\("\.\/governor-admin"\)\.governorPin\(flags\)/);
  assert.match(source, /"governor status": \(flags\) => require\("\.\/governor-admin"\)\.governorStatus\(flags\)/);
});

test("governor-admin carries the factory banner and requires only node built-ins, producer-auth, commissaire-trust and the governor client", () => {
  const source = readFileSync(join(LIB, "governor-admin.ts"), "utf8");
  assert.match(source, /^\/\/ === region:factory — governor-admin — FAFF-1217/m);
  const requires = [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(requires)].sort(), ["./commissaire-governor-client", "./commissaire-trust", "./producer-auth", "node:child_process", "node:fs", "node:os", "node:path"]);
  for (const forbidden of ["merge-gate", "config", "budget"]) assert.ok(!requires.some((r) => r.endsWith(forbidden)), forbidden);
  assert.match(readFileSync(join(LIB, "commissaire-governor-client.ts"), "utf8"), /peer-cred \(FAFF-1217/);
});

test("the require graph from governor-admin.js never reaches merge-gate, faff's config reader or an orchestration module", () => {
  const files = readdirSync(LIB).filter((f) => f.endsWith(".js")).map((f) => join(LIB, f));
  const sourceSet = new Set([...files, FAFF, COMMISSAIRE]);
  const visited = new Set();
  const queue = [join(LIB, "governor-admin.js")];
  while (queue.length) {
    const f = queue.pop();
    if (visited.has(f)) continue;
    visited.add(f);
    for (const e of regionsRequireEdges(f, new Map(), sourceSet).edges) queue.push(e.toFile);
  }
  const names = new Set([...visited].map((f) => basename(f, ".js")));
  for (const banned of ["merge-gate", "config", "tracker", "harness", "engine", "next", "project-next", "run-start", "run-done", "queue-state", "lights-out", "self-intake", "scenario-matrix"]) {
    assert.ok(!names.has(banned), `${banned} must not be reachable from governor-admin`);
  }
  // FAFF-1389: config.js is a facade over config-*.js; none of those may be reachable either.
  assert.deepEqual([...names].filter((n) => n.startsWith("config-")), [], "no config module may be reachable from governor-admin");
});
