// FAFF-1216 — `commissaire governor install` / `uninstall` on Linux, without root. The privileged steps
// (useradd, systemctl, chown to another user, the clone) go through the injectable Host / Executor seams
// and are asserted as recorded ops and calls; test/governor-install-container.test.mjs runs the real thing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { makeWorld, fakeDir, fakeFile, REPO, CLONE, COMMIT, TAG, FINGERPRINT } from "./helpers/governor-install-world.mjs";

const require = createRequire(import.meta.url);
const LIB = join(REPO, "plugin", "skills", "faff", "bin", "lib");
const COMMISSAIRE_BIN = join(LIB, "..", "commissaire");
const install = require(join(LIB, "governor-install.js"));
const commissaire = require(join(LIB, "commissaire.js"));
const { parseGovernorConfig } = require(join(LIB, "governor.js"));

const PLUGIN_ROOT = join(REPO, "plugin", "skills", "faff");
const run = (world, flags, extra) => install.governorInstall(world.flags(flags), world.deps(extra));
const json = (world) => JSON.parse(world.out);

function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [COMMISSAIRE_BIN, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// --- Command and wiring -----------------------------------------------------------------------------------

test("wiring: install and uninstall are in dispatch, required flags, the flag spec and usage", () => {
  assert.equal(typeof commissaire.COMMISSAIRE_DISPATCH["governor install"], "function");
  assert.equal(typeof commissaire.COMMISSAIRE_DISPATCH["governor uninstall"], "function");
  assert.deepEqual(commissaire.REQUIRED_FLAGS_BY_CANONICAL["governor install"], ["--runner-user", "--from-tag"]);
  assert.deepEqual(commissaire.REQUIRED_FLAGS_BY_CANONICAL["governor uninstall"], []);
  const flags = commissaire.COMMISSAIRE_SPEC.flags;
  for (const f of ["--runner-user", "--admin-user", "--from-tag", "--socket-dir", "--install-prefix", "--node"]) assert.deepEqual(flags[f], { arity: 1 }, f);
  for (const f of ["--purge-key", "--socket-group-access"]) assert.deepEqual(flags[f], { arity: 0 }, f);
  assert.deepEqual(commissaire.COMMISSAIRE_SURFACE.subcommands["governor install"].required_flags, ["--runner-user", "--from-tag"]);
  const usage = cli([]).stderr;
  assert.match(usage, /governor install\s+--runner-user U --from-tag/);
  assert.match(usage, /governor uninstall/);
  assert.match(usage, /governor start .*--socket-group-access/);
});

test("wiring: there is no clone-source flag, so --repo-url exits 2 as an unknown argument", () => {
  const r = cli(["governor", "install", "--runner-user", "alice", "--from-tag", TAG, "--repo-url", "https://example.invalid/fork.git"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown argument: --repo-url/);
  assert.equal(cli(["governor", "uninstall", "--bogus"]).code, 2);
});

test("wiring: parsed value flags and booleans reach the handler", () => {
  const seen = [];
  const original = commissaire.COMMISSAIRE_DISPATCH["governor install"];
  commissaire.COMMISSAIRE_DISPATCH["governor install"] = (flags) => { seen.push(flags); return 0; };
  try {
    const code = commissaire.cmdCommissaire(["governor", "install", "--runner-user", "alice", "--admin-user", "hal", "--from-tag", TAG, "--socket-dir", "/s", "--install-prefix", "/p", "--node", "/n", "--key-dir", "/k", "--json"]);
    assert.equal(code, 0);
    assert.deepEqual(seen[0], { "--runner-user": "alice", "--admin-user": "hal", "--from-tag": TAG, "--socket-dir": "/s", "--install-prefix": "/p", "--node": "/n", "--key-dir": "/k", "--json": true });
  } finally { commissaire.COMMISSAIRE_DISPATCH["governor install"] = original; }
});

test("root guard: a non-root caller exits 2 before any probe, sudo, doas or op", () => {
  const world = makeWorld();
  assert.equal(run(world, {}, { getuid: () => 1000 }), 2);
  assert.match(world.err, /must be run as root/);
  assert.equal(world.calls.length, 0, "no probe of any kind ran");
  assert.equal(world.ops.length, 0);
  assert.equal(install.governorUninstall({}, world.deps({ getuid: () => 1000 })), 2);
  assert.equal(world.calls.length, 0);
});

test("macOS exits 2 pointing at FAFF-1251", () => {
  const world = makeWorld();
  assert.equal(run(world, {}, { platform: () => "macos" }), 2);
  assert.match(world.err, /FAFF-1251/);
  assert.equal(world.ops.length, 0);
});

test("--from-tag: anything but a release tag exits 2 before the self-custody guard, so no bootstrap carries it", () => {
  for (const bad of ["main", "v0.42.0", "faff--v0.42", "faff--v0.42.0-rc1", "faff--v1.2.3; rm -rf /", "-faff--v1.2.3", undefined]) {
    const world = makeWorld();
    world.fs.set("/opt/installer/bin/lib", fakeDir(1000, 1000, 0o755)); // would fail the guard if it ran
    const flags = bad === undefined ? { "--from-tag": undefined } : { "--from-tag": bad };
    assert.equal(run(world, flags), 2, String(bad));
    assert.match(world.err, /from-tag must be a release tag \(faff--vX\.Y\.Z\)/);
    assert.doesNotMatch(world.err, /install-code-not-root-owned/, "the guard did not run");
    assert.doesNotMatch(world.err, /sudo git clone/, "no bootstrap was printed");
    assert.equal(world.ops.length, 0);
    assert.equal(world.calls.length, 0, "no probe ran either");
  }
});

test("--runner-user is required and never falls back to SUDO_USER", () => {
  const world = makeWorld();
  assert.equal(run(world, { "--runner-user": undefined }, { env: { SUDO_USER: "alice" } }), 2);
  assert.match(world.err, /pass --runner-user <name>/);
  assert.equal(world.ops.length, 0);
});

test("runner user: root, an unknown user and a system account are refused and nothing is created", () => {
  for (const [name, message] of [["root", /pass --runner-user <name>/], ["bob", /no such user: bob/], ["svc", /runner-user svc is a system account/]]) {
    const world = makeWorld();
    assert.equal(run(world, { "--runner-user": name }), 2, name);
    assert.match(world.err, message);
    assert.equal(world.ops.length, 0);
  }
});

test("a runner user below UID_MIN is refused whatever else is passed (no override flag)", () => {
  const world = makeWorld();
  assert.equal(run(world, { "--runner-user": "svc", "--allow-system-runner": true }), 2);
  assert.match(world.err, /system account/);
});

test("admin user: defaults to SUDO_USER; missing, unknown, root, the runner and the governor account are refused", () => {
  const cases = [
    [{ env: {} }, {}, /pass --admin-user <name>/],
    [{ env: { SUDO_USER: "nobody-here" } }, {}, /no such user: nobody-here/],
    [{ env: { SUDO_USER: "alice" } }, {}, /admin-user must be a human account other than root, the runner and the governor/],
    [{ env: { SUDO_USER: "hal" } }, { "--admin-user": "root" }, /admin-user must be a human account/],
    [{ env: { SUDO_USER: "hal" } }, { "--admin-user": "alice" }, /admin-user must be a human account/],
  ];
  for (const [extra, flags, message] of cases) {
    const world = makeWorld();
    assert.equal(run(world, flags, extra), 2, JSON.stringify(flags));
    assert.match(world.err, message);
    assert.equal(world.ops.length, 0, "nothing is created");
  }
  const governor = makeWorld();
  governor.users.set("commissaire", { uid: 300, gid: 300, home: "/var/lib/commissaire", shell: "/usr/sbin/nologin" });
  assert.equal(run(governor, { "--admin-user": "commissaire" }), 2);
  assert.match(governor.err, /admin-user must be a human account/);
  const ok = makeWorld();
  assert.equal(run(ok, {}), 0);
  assert.deepEqual(json(ok).admin_uids, [1001], "SUDO_USER hal is the default admin");
  const flagWins = makeWorld();
  assert.equal(run(flagWins, { "--admin-user": "mallory" }), 0);
  assert.deepEqual(json(flagWins).admin_uids, [1002]);
});

// --- Self-custody guard and preflight ------------------------------------------------------------------------------

test("self-custody: install code owned by the runner aborts with the path and the bootstrap, creating nothing", () => {
  const world = makeWorld();
  world.fs.set("/opt/installer", fakeDir(1000, 1000, 0o755));
  assert.equal(run(world, {}), 2);
  assert.match(world.err, /install-code-not-root-owned: \/opt\/installer\n/);
  assert.match(world.err, new RegExp(`sudo git clone --depth 1 --branch ${TAG} https://github.com/shftwst/faff.git /root/commissaire-${TAG}`));
  assert.match(world.err, /--runner-user <name> --from-tag faff--v0\.42\.0/);
  assert.equal(world.ops.length, 0);
});

test("self-custody: a group-writable ancestor, a world-writable file in the code directory and a runner-owned binary are refused", () => {
  for (const [path, entry] of [["/opt", fakeDir(0, 0, 0o775)], ["/opt/installer/bin/lib/governor-install.js", fakeFile("", 0, 0, 0o666)], ["/opt/installer/bin/commissaire", fakeFile("", 1000, 1000, 0o755)]]) {
    const world = makeWorld();
    world.fs.set(path, entry);
    assert.equal(run(world, {}), 2, path);
    assert.match(world.err, new RegExp(`install-code-not-root-owned: ${path}`));
    assert.equal(world.ops.length, 0);
  }
});

test("preflight: a missing tool is named; python3 that cannot import socket and struct aborts python3-missing", () => {
  const noTool = makeWorld();
  noTool.fs.delete("/usr/sbin/useradd");
  assert.equal(run(noTool, {}), 2);
  assert.match(noTool.err, /missing tool: useradd/);
  const noPy = makeWorld({ python: false });
  assert.equal(run(noPy, {}), 2);
  assert.match(noPy.err, /python3-missing/);
  assert.equal(noPy.ops.length, 0);
});

test("preflight: python is probed in isolated mode so a caller's directory never reaches sys.path", () => {
  const world = makeWorld();
  assert.equal(run(world, {}), 0);
  const call = world.calls.find((c) => c.cmd === "/usr/bin/python3");
  assert.equal(call.args[0], "-I");
  assert.deepEqual(call.args, ["-I", "-c", "import socket, struct"]);
});

test("runProcess: every child of the real host and executor starts in / whatever the caller's cwd", () => {
  const here = process.cwd();
  const scratch = mkdtempSync(join(tmpdir(), "gi-cwd-"));
  try {
    process.chdir(scratch);
    const host = install.createHost();
    assert.equal(host.probe("/bin/sh", ["-c", "pwd"]).stdout.trim(), "/");
    const exec = install.createExecutor(host).run({ kind: "run_command", cmd: "/bin/sh", args: ["-c", "pwd"], env: { PATH: "/usr/bin:/bin" } });
    assert.equal(exec.value.trim(), "/");
  } finally { process.chdir(here); rmSync(scratch, { recursive: true, force: true }); }
});

test("path flags: a space, newline, percent sign, .. segment or other unit-unsafe character exits 2 before any op", () => {
  for (const flag of ["--key-dir", "--socket-dir", "--install-prefix", "--node"]) {
    for (const bad of ["/var/lib/a b", "/var/lib/a\nExecStartPre=/bin/evil", "/var/lib/a%h", "/var/lib/../etc", "/var/lib/$x", "/var/lib/a\"b"]) {
      const world = makeWorld();
      assert.equal(run(world, { [flag]: bad }), 2, `${flag} ${JSON.stringify(bad)}`);
      assert.match(world.err, /must match/);
      assert.equal(world.ops.length, 0);
      const un = makeWorld();
      if (flag !== "--node") {
        assert.equal(install.governorUninstall({ [flag]: bad }, un.deps()), 2);
        assert.equal(un.ops.length, 0);
      }
    }
  }
});

test("preflight: a tool root would run from a writable place is refused, naming the tool", () => {
  const owned = makeWorld();
  owned.fs.set("/usr/sbin/useradd", fakeFile("", 1000, 1000, 0o755));
  assert.equal(run(owned, {}), 2);
  assert.match(owned.err, /tool-not-root-owned: useradd/);
  assert.equal(owned.ops.length, 0);
  const writableDir = makeWorld();
  writableDir.fs.set("/usr/sbin", fakeDir(0, 0, 0o775));
  assert.equal(run(writableDir, {}), 2);
  assert.match(writableDir.err, /tool-not-root-owned: /);
  const python = makeWorld();
  python.fs.set("/usr/bin/python3", fakeFile("", 0, 0, 0o777));
  assert.equal(run(python, {}), 2);
  assert.match(python.err, /tool-not-root-owned: python3/);
  const viaUninstall = makeWorld();
  viaUninstall.fs.set("/usr/bin/systemctl", fakeFile("", 1000, 1000, 0o755));
  assert.equal(install.governorUninstall({}, viaUninstall.deps()), 2);
  assert.match(viaUninstall.err, /tool-not-root-owned: systemctl/);
  assert.equal(viaUninstall.ops.length, 0);
});

test("preflight: a root-owned symlinked tool is accepted on its target's custody, a runner-owned link or target is refused", () => {
  const link = (target, uid = 0) => ({ uid, gid: 0, mode: 0o777, kind: "symlink", target });
  const ok = makeWorld();
  ok.fs.set("/usr/bin/python3.11", fakeFile("", 0, 0, 0o755));
  ok.fs.set("/usr/bin/python3", link("/usr/bin/python3.11"));
  run(ok, {});
  assert.doesNotMatch(ok.err, /tool-not-root-owned/);
  const runnerLink = makeWorld();
  runnerLink.fs.set("/usr/bin/python3.11", fakeFile("", 0, 0, 0o755));
  runnerLink.fs.set("/usr/bin/python3", link("/usr/bin/python3.11", 1000));
  assert.equal(run(runnerLink, {}), 2);
  assert.match(runnerLink.err, /tool-not-root-owned: python3/);
  const runnerTarget = makeWorld();
  runnerTarget.fs.set("/usr/bin/python3.11", fakeFile("", 1000, 1000, 0o755));
  runnerTarget.fs.set("/usr/bin/python3", link("/usr/bin/python3.11"));
  assert.equal(run(runnerTarget, {}), 2);
  assert.match(runnerTarget.err, /tool-not-root-owned: python3/);
});

test("preflight: tools are resolved from the system directories only, never /usr/local", () => {
  const world = makeWorld();
  world.fs.delete("/usr/sbin/useradd");
  world.fs.set("/usr/local", fakeDir());
  world.fs.set("/usr/local/sbin", fakeDir());
  world.fs.set("/usr/local/sbin/useradd", fakeFile());
  assert.equal(run(world, {}), 2);
  assert.match(world.err, /missing tool: useradd/);
});

test("preflight: an interpreter, or an ancestor of it, that the runner can write aborts interpreter-not-root-owned", () => {
  const nvm = makeWorld();
  nvm.fs.set("/home/alice", fakeDir(1000, 1000, 0o755));
  nvm.fs.set("/home/alice/.nvm", fakeDir(1000, 1000, 0o755));
  nvm.fs.set("/home/alice/.nvm/node", fakeFile("", 1000, 1000, 0o755));
  assert.equal(run(nvm, {}, { execPath: "/home/alice/.nvm/node" }), 2);
  assert.match(nvm.err, /interpreter-not-root-owned: \/home\/alice\/\.nvm\/node/);
  assert.match(nvm.err, /--node/);
  assert.equal(nvm.ops.length, 0, "no clone was made");

  const flagged = makeWorld();
  flagged.fs.set("/usr/local", fakeDir(0, 0, 0o777));
  flagged.fs.set("/usr/local/bin", fakeDir());
  flagged.fs.set("/usr/local/bin/node", fakeFile());
  assert.equal(run(flagged, { "--node": "/usr/local/bin/node" }), 2);
  assert.match(flagged.err, /interpreter-not-root-owned: \/usr\/local\/bin\/node \(\/usr\/local is/);

  const missing = makeWorld();
  assert.equal(run(missing, { "--node": "/nonexistent/node" }), 2);
  assert.match(missing.err, /interpreter-not-root-owned/);
});

const symlink = (target, uid = 0) => ({ uid, gid: 0, mode: 0o777, kind: "symlink", target });

test("preflight: --node is checked through its literal chain too, and ExecStart= names the verified real path", () => {
  const swappable = makeWorld();
  swappable.fs.set("/srv", fakeDir());
  swappable.fs.set("/srv/ci", fakeDir(1000, 1000, 0o755));
  swappable.fs.set("/srv/ci/node", symlink("/usr/bin/node"));
  assert.equal(run(swappable, { "--node": "/srv/ci/node" }), 2);
  assert.match(swappable.err, /interpreter-not-root-owned: .*\/srv\/ci is/);
  assert.equal(swappable.ops.length, 0);

  const tight = makeWorld();
  tight.fs.set("/srv", fakeDir());
  tight.fs.set("/srv/ci", fakeDir());
  tight.fs.set("/srv/ci/node", symlink("/usr/bin/node"));
  assert.equal(run(tight, { "--node": "/srv/ci/node" }), 0, tight.err);
  const unit = tight.ops.find((o) => o.kind === "write_file" && o.path === "/etc/systemd/system/commissaire-governor.service");
  assert.match(unit.content, /^ExecStart=\/usr\/bin\/node /m);
  assert.doesNotMatch(unit.content, /\/srv\/ci/);
});

test("preflight: tool custody runs before root probes getent or id, and a loose /bin/sh is never executed", () => {
  const early = makeWorld();
  early.fs.set("/usr/sbin/useradd", fakeFile("", 1000, 1000, 0o755));
  assert.equal(run(early, {}), 2);
  assert.match(early.err, /tool-not-root-owned: useradd/);
  assert.equal(early.callsTo("getent").length + early.callsTo("id").length, 0, "no probe ran before the custody failure");

  const loose = makeWorld();
  loose.fs.set("/bin/sh", fakeFile("", 1000, 1000, 0o755));
  loose.commandV.set("doas", "/usr/bin/doas");
  const rules = install.escalationRules(loose.host, "alice");
  assert.equal(rules.sudo_rules, true, "a loose sh counts as a rule");
  assert.equal(rules.sudo_absent, false);
  assert.equal(loose.callsTo("sh").length, 0, "the loose sh was not run");
});

test("preflight: root executes the resolved real path of a symlinked tool, not the literal link", () => {
  const world = makeWorld();
  world.fs.set("/usr/bin/python3.11", fakeFile("", 0, 0, 0o755));
  world.fs.set("/usr/bin/python3", symlink("/usr/bin/python3.11"));
  world.fs.set("/usr/bin/sudo.real", fakeFile("", 0, 0, 0o755));
  world.fs.set("/usr/bin/sudo", symlink("/usr/bin/sudo.real"));
  assert.equal(run(world, {}), 0, world.err);
  assert.equal(world.calls.filter((c) => c.args.includes("import socket, struct")).map((c) => c.cmd)[0], "/usr/bin/python3.11");
  assert.deepEqual(world.calls.filter((c) => c.args[0] === "-n").map((c) => c.cmd), ["/usr/bin/sudo.real"]);
});

test("executor: a system tool with a loose chain is refused, and a tight link resolves to its real path", () => {
  const loose = makeWorld();
  loose.fs.set("/usr/bin/systemctl", fakeFile("", 1000, 1000, 0o755));
  const refused = install.createExecutor(loose.host).run({ kind: "service_op", args: ["daemon-reload"] });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /tool-not-root-owned: systemctl/);

  const linked = makeWorld();
  linked.fs.set("/usr/bin/systemctl.real", fakeFile("", 0, 0, 0o755));
  linked.fs.set("/usr/bin/systemctl", symlink("/usr/bin/systemctl.real"));
  const res = install.createExecutor(linked.host).run({ kind: "service_op", args: ["daemon-reload"] });
  assert.doesNotMatch(res.message ?? "", /tool-not-root-owned/, "a root-owned link passes custody and is spawned by its real path");
});

// --- Release clone --------------------------------------------------------------------------------------------------------

const GIT_ENV = { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/root", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };

test("release clone: the exact git argv and the replaced environment, with the constant URL", () => {
  const world = makeWorld();
  const clone = install.releaseClone(TAG, undefined, { host: world.host, executor: world.executor });
  assert.deepEqual(clone, { dir: CLONE, source_tag: TAG, source_commit: COMMIT });
  const git = world.ops.find((o) => o.kind === "run_command");
  assert.equal(git.cmd, "git");
  assert.deepEqual(git.args, ["-c", "http.sslVerify=true", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always",
    "clone", "--depth", "1", "--branch", TAG, "--no-recurse-submodules", "-c", "core.hooksPath=/dev/null", "https://github.com/shftwst/faff.git", CLONE]);
  assert.deepEqual(git.env, GIT_ENV, "exactly this environment, nothing inherited");
  assert.deepEqual(world.ops[0], { kind: "make_temp_dir", under: "/root", prefix: "commissaire-release-" });
  for (const probe of world.callsTo("git")) assert.deepEqual(probe.opts.env, GIT_ENV, "the rev-parse probes use it too");
  assert.deepEqual(world.callsTo("git").map((c) => c.args.slice(-2)[0] === "HEAD" ? "HEAD" : c.args.at(-1)), ["HEAD", `refs/tags/${TAG}^{commit}`]);
});

test("release clone: a caller's GIT_CONFIG_COUNT url rewrite never reaches git, and the clone still targets the constant URL", () => {
  const saved = { ...process.env };
  Object.assign(process.env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url.file:///tmp/evil.insteadOf", GIT_CONFIG_VALUE_0: "https://github.com/", GIT_SSL_NO_VERIFY: "1", HTTPS_PROXY: "http://evil.invalid:3128", GIT_ASKPASS: "/tmp/askpass" });
  try {
    const world = makeWorld();
    install.releaseClone(TAG, undefined, { host: world.host, executor: world.executor });
    const git = world.ops.find((o) => o.kind === "run_command");
    assert.deepEqual(git.env, GIT_ENV);
    for (const leaked of ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_SSL_NO_VERIFY", "HTTPS_PROXY", "GIT_ASKPASS"]) assert.equal(leaked in git.env, false, leaked);
    assert.equal(git.args.at(-2), install.RELEASE_REPO_URL);
    assert.equal(install.RELEASE_REPO_URL, "https://github.com/shftwst/faff.git");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  }
});

test("release clone: the production install clones the constant even when the deps carry no URL; only file:// is accepted besides it", () => {
  const world = makeWorld();
  assert.equal(run(world, {}), 0);
  assert.equal(world.ops.find((o) => o.kind === "run_command").args.at(-2), "https://github.com/shftwst/faff.git");
  for (const url of ["http://github.com/shftwst/faff.git", "ssh://git@github.com/shftwst/faff.git", "git://github.com/shftwst/faff.git", "https://github.com/evil/faff.git", "/srv/repo.git"]) {
    const w = makeWorld();
    assert.throws(() => install.releaseClone(TAG, url, { host: w.host, executor: w.executor }), /release clone source must be/, url);
    assert.equal(w.ops.length, 0, "refused before anything is made");
  }
  const local = makeWorld();
  install.releaseClone(TAG, "file:///srv/repo.git", { host: local.host, executor: local.executor });
  assert.ok(local.ops.find((o) => o.kind === "run_command").args.includes("protocol.file.allow=always"));
});

test("release clone: a tag that is not a release tag aborts before anything is made", () => {
  const world = makeWorld();
  assert.throws(() => install.releaseClone("main", undefined, { host: world.host, executor: world.executor }), /from-tag must be a release tag/);
  assert.equal(world.ops.length, 0);
});

test("release clone: /root must be root:root and not group- or world-writable (0550 on RHEL and Fedora is fine)", () => {
  for (const entry of [fakeDir(1000, 1000, 0o700), fakeDir(0, 0, 0o770), fakeDir(0, 0, 0o777), fakeDir(0, 1000, 0o700)]) {
    const world = makeWorld();
    world.fs.set("/root", entry);
    assert.throws(() => install.releaseClone(TAG, undefined, { host: world.host, executor: world.executor }), /\/root must be owned by root/);
    assert.equal(world.ops.length, 0);
  }
  for (const mode of [0o550, 0o700, 0o750]) {
    const world = makeWorld();
    world.fs.set("/root", fakeDir(0, 0, mode));
    const clone = install.releaseClone(TAG, undefined, { host: world.host, executor: world.executor });
    assert.equal(clone.dir, CLONE, mode.toString(8));
  }
});

test("release clone: a tag whose commit differs from HEAD aborts and the clone is removed", () => {
  const world = makeWorld({ gitTag: "9".repeat(40) });
  assert.throws(() => install.releaseClone(TAG, undefined, { host: world.host, executor: world.executor }), /does not resolve to the cloned HEAD/);
  assert.deepEqual(world.ops.at(-1), { kind: "remove", path: CLONE, recursive: true, onlyIfEmpty: false });
});

test("release clone: a failed clone (no network) aborts the install with exit 1 before any mutation", () => {
  const world = makeWorld({ failKind: "run_command" });
  assert.equal(run(world, {}), 1);
  assert.match(world.err, /release clone failed/);
  assert.deepEqual(world.opKinds(), ["make_temp_dir", "run_command", "remove"], "only the clone directory was touched, and it was removed");
});

test("install never reads files for the install copy from outside the clone", () => {
  const world = makeWorld();
  assert.equal(run(world, {}), 0);
  for (const op of world.ops.filter((o) => o.kind === "copy_file")) assert.ok(op.src.startsWith(`${CLONE}/plugin/skills/faff/`), op.src);
  const escaped = makeWorld();
  const realpath = escaped.host.realpath;
  escaped.host.realpath = (p) => (p.endsWith("shared-infra.js") ? "/home/alice/evil.js" : realpath(p));
  assert.throws(() => install.closureManifest(escaped.host, `${CLONE}/plugin/skills/faff`), /escapes the clone/);
});

// --- Escape-route check ---------------------------------------------------------------------------------------------------------

const check = (mutate) => {
  const world = makeWorld();
  mutate(world);
  return { world, result: install.escapeCheck(world.host, "alice") };
};
const sudoPresent = (world) => world.fs.set("/usr/bin/sudo", fakeFile());

test("escape check: docker group membership fails; no docker group passes (rootless Docker)", () => {
  assert.equal(check((w) => { w.groups.set("docker", { gid: 998, members: ["alice"] }); }).result.docker_group, true);
  assert.equal(check((w) => { w.groups.set("docker", { gid: 998, members: [] }); w.userGroups.set("alice", ["alice", "docker"]); }).result.docker_group, true, "supplementary membership counts");
  assert.equal(check((w) => { w.groups.set("docker", { gid: 998, members: ["hal"] }); }).result.docker_group, false);
  assert.equal(check(() => {}).result.docker_group, false, "no docker group at all");
  assert.equal(check((w) => { w.groups.set("docker", { gid: 998, members: [] }); w.idFails = true; }).result.docker_group, true, "an erroring probe fails closed");
});

test("escape check: sudo listing a rule fails, 'not allowed' passes, anything else fails closed", () => {
  const rules = check((w) => { sudoPresent(w); w.sudoOutput = "User alice may run the following commands on host:\n    (ALL) ALL\n"; }).result;
  assert.deepEqual([rules.sudo_rules, rules.sudo_absent], [true, false]);
  const none = check((w) => { sudoPresent(w); }).result;
  assert.deepEqual([none.sudo_rules, none.sudo_absent], [false, false]);
  const broken = check((w) => { sudoPresent(w); w.sudoOutput = "error"; }).result;
  assert.deepEqual([broken.sudo_rules, broken.sudo_absent], [true, false]);
  const odd = check((w) => { sudoPresent(w); w.sudoOutput = "sudo: parse error in /etc/sudoers\n"; }).result;
  assert.equal(odd.sudo_rules, true);
});

test("escape check: no sudo and no doas passes with sudo_absent true; sudo found only via command -v is still queried", () => {
  const absent = check(() => {}).result;
  assert.deepEqual(absent, { docker_group: false, sudo_rules: false, sudo_absent: true });
});

test("escape check: a sudo found only via command -v is recorded as a rule and never executed", () => {
  const viaPath = check((w) => { w.commandV.set("sudo", "/opt/odd/bin/sudo"); });
  assert.deepEqual([viaPath.result.sudo_rules, viaPath.result.sudo_absent], [true, false]);
  assert.equal(viaPath.world.callsTo("sudo").length, 0);
});

test("escape check: a sudo under a runner-writable path or owned by the runner is never executed and records a rule", () => {
  for (const mutate of [
    (w) => { w.fs.set("/usr/bin/sudo", fakeFile("", 1000, 1000, 0o755)); },
    (w) => { w.fs.set("/usr/bin/sudo", fakeFile("", 0, 0, 0o775)); },
    (w) => { w.fs.set("/usr/local", fakeDir(0, 0, 0o777)); w.fs.set("/usr/local/bin", fakeDir()); w.fs.set("/usr/local/bin/sudo", fakeFile()); },
  ]) {
    const r = check((w) => { w.fs.delete("/usr/bin/sudo"); mutate(w); });
    assert.deepEqual([r.result.sudo_rules, r.result.sudo_absent], [true, false]);
    assert.equal(r.world.callsTo("sudo").length, 0);
  }
});

test("escape check: doas is read from its config, failing closed when the file cannot be read", () => {
  const withDoas = (conf, mutate = () => {}) => check((w) => {
    w.fs.set("/usr/bin/doas", fakeFile());
    if (conf !== null) w.fs.set("/etc/doas.conf", fakeFile(conf, 0, 0, 0o600));
    mutate(w);
  }).result;
  assert.equal(withDoas(null).sudo_rules, true, "doas without a readable config fails closed");
  assert.equal(withDoas("permit nopass alice as root\n").sudo_rules, true);
  assert.equal(withDoas("permit persist setenv { PATH } :alice\n").sudo_rules, true, "a group rule matches the user's own group");
  assert.equal(withDoas("permit :wheel\n", (w) => w.userGroups.set("alice", ["alice", "wheel"])).sudo_rules, true);
  assert.equal(withDoas("# permit alice\npermit :wheel\npermit hal\n").sudo_rules, false);
  const quiet = withDoas("permit hal\n");
  assert.deepEqual([quiet.sudo_rules, quiet.sudo_absent], [false, false], "doas present, no rule for the runner, no sudo");
  const alpine = makeWorld();
  alpine.fs.set("/usr/bin/doas", fakeFile());
  alpine.fs.set("/usr/local/etc", fakeDir());
  alpine.fs.set("/usr/local/etc/doas.conf", fakeFile("permit alice\n"));
  assert.equal(install.escalationRules(alpine.host, "alice").sudo_rules, true, "the /usr/local/etc location is read too");
});

test("escape check: doas matches numeric uid and gid, joins continuation lines and fails closed on constructs it does not know", () => {
  const who = { user: "alice", uid: 1000, groups: ["alice"], gids: [1000, 1001] };
  const permits = (conf) => install.doasPermits(conf, who);
  assert.equal(permits("permit 1000\n"), true);
  assert.equal(permits("permit :1001\n"), true);
  assert.equal(permits("permit 1002\npermit :1002\n"), false);
  assert.equal(permits("permit nopass \\\n  alice as root\n"), true, "a continued line is one rule");
  assert.equal(permits("permit nopass \\\n  hal\n"), false);
  assert.equal(permits("permit keepenv { FOO } alice\n"), true);
  assert.equal(permits("permit hal\n"), false);
  for (const odd of ["frobnicate alice\n", "permit\n", "permit setenv alice\n", "permit setenv { A \n", 'permit "al ice"\n', "permit nopass !alice\n"]) assert.equal(permits(odd), true, JSON.stringify(odd));
  const world = makeWorld();
  world.fs.set("/usr/bin/doas", fakeFile());
  world.fs.set("/etc/doas.conf", fakeFile("permit 1000\n", 0, 0, 0o600));
  assert.equal(install.escalationRules(world.host, "alice").sudo_rules, true, "the runner's uid is passed through");
  world.fs.set("/etc/doas.conf", fakeFile("mystery alice\n", 0, 0, 0o600));
  assert.equal(install.escalationRules(world.host, "hal").sudo_rules, true, "an unknown construct fails closed");
});

test("escape check: the only escalation tool ever run is sudo -n -l -U <runner>, read-only, with a fixed environment", () => {
  const world = makeWorld();
  sudoPresent(world);
  world.fs.set("/usr/bin/doas", fakeFile());
  world.fs.set("/etc/doas.conf", fakeFile("permit hal\n"));
  assert.equal(run(world, {}), 0);
  assert.equal(world.callsTo("doas").length, 0, "doas is read from its config, never executed");
  assert.equal(world.callsTo("sudo").length, 1);
  const call = world.callsTo("sudo")[0];
  assert.deepEqual(call.args, ["-n", "-l", "-U", "alice"]);
  assert.equal(call.opts.env.LC_ALL, "C");
  assert.equal(world.ops.some((o) => o.kind === "run_command" && /sudo|doas/.test(o.cmd)), false);
  assert.equal(world.ops.some((o) => o.kind === "service_op" && o.args.includes("sudo")), false);
});

test("scenario: a runner in the docker group still installs, and the record says independent false", () => {
  const world = makeWorld();
  world.groups.set("docker", { gid: 998, members: ["alice"] });
  assert.equal(run(world, {}), 0);
  const checks = json(world).runner_checks;
  assert.equal(checks.docker_group, true);
  assert.equal(checks.independent, false);
  assert.equal(parseGovernorConfig({ allow_uids: [1000], runner_checks: checks }).ok, true, "the governor accepts the record it will repeat");
});

test("scenario: no sudo binary and no docker group records sudo_rules false, sudo_absent true, independent true", () => {
  const world = makeWorld();
  assert.equal(run(world, {}), 0);
  const checks = json(world).runner_checks;
  assert.deepEqual([checks.sudo_rules, checks.sudo_absent, checks.docker_group, checks.independent, checks.admin_group], [false, true, false, true, null]);
});

// --- The plan ---------------------------------------------------------------------------------------------------------------------

test("plan: a fresh install is the ordered op list for the account, group, directories, copy, unit and service", () => {
  const world = makeWorld();
  assert.equal(run(world, {}), 0);
  const ops = world.ops;
  const at = (pred) => ops.findIndex(pred);
  const account = ops.find((o) => o.kind === "create_account");
  assert.deepEqual(account, { kind: "create_account", name: "commissaire", shell: "/usr/sbin/nologin", home: "/var/lib/commissaire" });
  assert.deepEqual(ops.find((o) => o.kind === "create_group"), { kind: "create_group", name: "commissaire-clients" });
  assert.deepEqual(ops.find((o) => o.kind === "set_group_members"), { kind: "set_group_members", group: "commissaire-clients", members: ["alice", "hal"] });
  assert.ok(at((o) => o.kind === "create_account") < at((o) => o.kind === "create_dir" && o.path === "/var/lib/commissaire"), "account before its directory");
  assert.ok(at((o) => o.kind === "create_group") < at((o) => o.kind === "create_dir" && o.path === "/var/lib/commissaire-socket"), "group before the socket directory");
  assert.deepEqual(ops.find((o) => o.kind === "create_dir" && o.path === "/var/lib/commissaire"), { kind: "create_dir", path: "/var/lib/commissaire", owner: "commissaire", group: "commissaire", mode: 0o700 });
  assert.deepEqual(ops.find((o) => o.kind === "create_dir" && o.path === "/var/lib/commissaire-socket"), { kind: "create_dir", path: "/var/lib/commissaire-socket", owner: "commissaire", group: "commissaire-clients", mode: 0o2750 });
  const asserts = ops.filter((o) => o.kind === "assert").map((o) => o.check.type);
  assert.deepEqual(asserts, ["account", "group_members", "path", "path", "path"], "post-conditions are asserts in the plan");
  assert.deepEqual(ops.filter((o) => o.kind === "service_op").map((o) => o.args), [["daemon-reload"], ["enable", "--now", "commissaire-governor.service"]]);
  assert.ok(at((o) => o.kind === "write_file" && o.path.endsWith(".service")) < at((o) => o.kind === "service_op"), "unit before service start");
  assert.ok(at((o) => o.kind === "write_file" && o.path.endsWith("governor-config.json")) < at((o) => o.kind === "service_op"), "config before service start");
  assert.deepEqual(ops.at(-1), { kind: "remove", path: CLONE, recursive: true, onlyIfEmpty: false }, "the release clone is removed last");
  assert.equal(ops.some((o) => o.path && o.path.endsWith("governor-key.json")), false, "install never writes the key");
});

test("plan: governor-config.json is governor-owned 0600 with the runner, the admin and a valid runner_checks", () => {
  const world = makeWorld();
  assert.equal(run(world, {}), 0);
  const write = world.ops.find((o) => o.kind === "write_file" && o.path === "/var/lib/commissaire/governor-config.json");
  assert.deepEqual([write.owner, write.group, write.mode], ["commissaire", "commissaire", 0o600]);
  const config = JSON.parse(write.content);
  assert.deepEqual(config.allow_uids, [1000]);
  assert.deepEqual(config.admin_uids, [1001]);
  const parsed = parseGovernorConfig(config);
  assert.equal(parsed.ok, true, parsed.error);
  const result = json(world);
  assert.deepEqual(config.runner_checks, result.runner_checks);
  assert.equal(config.runner_checks.runner_user, "alice");
  assert.equal(config.runner_checks.runner_uid, 1000);
  assert.equal(config.runner_checks.platform, "linux");
  assert.equal(config.runner_checks.socket_group, "commissaire-clients");
  assert.equal(config.runner_checks.checked_at, "2026-10-12T04:00:00Z");
  assert.equal(config.runner_checks.source_tag, TAG);
  assert.equal(config.runner_checks.install_version, result.install_copy.version);
});

test("plan: the unit text matches the Service section, with ReadWritePaths for the socket directory", () => {
  const world = makeWorld();
  assert.equal(run(world, {}), 0);
  const unit = world.ops.find((o) => o.kind === "write_file" && o.path === "/etc/systemd/system/commissaire-governor.service");
  assert.deepEqual([unit.owner, unit.group, unit.mode], ["root", "root", 0o644]);
  const version = json(world).install_copy.version;
  const lines = unit.content.split("\n");
  for (const expected of [
    "[Service]", "User=commissaire",
    `ExecStart=/usr/bin/node /opt/commissaire/${version}/bin/commissaire governor start --key-dir /var/lib/commissaire --socket /var/lib/commissaire-socket/governor.sock --socket-group-access`,
    "StateDirectory=commissaire", "StateDirectoryMode=0700", "ReadWritePaths=/var/lib/commissaire-socket",
    "ProtectSystem=strict", "ProtectHome=yes", "NoNewPrivileges=yes", "PrivateTmp=yes", "Restart=on-failure", "[Install]", "WantedBy=multi-user.target",
  ]) assert.ok(lines.includes(expected), expected);
});

test("plan: a non-default key directory is listed in ReadWritePaths and drops StateDirectory", () => {
  const text = install.unitText({ node: "/usr/bin/node", dest: "/opt/c/v", keyDir: "/srv/k", socketDir: "/srv/s" });
  assert.match(text, /ReadWritePaths=\/srv\/k \/srv\/s\n/);
  assert.doesNotMatch(text, /StateDirectory/);
});

test("plan: nologin resolves to the first existing path; none present aborts", () => {
  const sbin = makeWorld();
  sbin.fs.delete("/usr/sbin/nologin");
  sbin.fs.set("/sbin/nologin", fakeFile());
  assert.equal(run(sbin, {}), 0);
  assert.equal(sbin.ops.find((o) => o.kind === "create_account").shell, "/sbin/nologin");
  const none = makeWorld();
  none.fs.delete("/usr/sbin/nologin");
  assert.equal(run(none, {}), 2);
  assert.match(none.err, /no nologin shell/);
  assert.equal(none.opKinds().includes("create_account"), false);
});

test("plan: planLinux is pure over its probes: the same inputs give the same plan and no op runs", () => {
  const world = makeWorld();
  const inputs = {
    runner: { name: "alice", uid: 1000, gid: 1000, home: "", shell: "" }, admin: { name: "hal", uid: 1001, gid: 1001, home: "", shell: "" },
    keyDir: "/var/lib/commissaire", socketDir: "/var/lib/commissaire-socket", prefix: "/opt/commissaire", node: "/usr/bin/node",
    clone: { dir: CLONE, source_tag: TAG, source_commit: COMMIT }, checks: { docker_group: false, sudo_rules: false, sudo_absent: true }, checkedAt: "2026-10-12T04:00:00Z",
  };
  const a = install.planLinux(world.host, inputs);
  const b = install.planLinux(world.host, inputs);
  assert.deepEqual(a, b);
  assert.equal(world.ops.length, 0, "planning executed nothing");
  assert.equal(a.platform, "linux");
  assert.deepEqual(a.account, { platform: "linux", user_name: "commissaire", group_name: "commissaire", uid: null, gid: null, shell: "/usr/sbin/nologin", home: "/var/lib/commissaire", real_name: "Commissaire governor", hidden: true });
  assert.deepEqual(a.client_group, { name: "commissaire-clients", members: ["alice", "hal"] });
  assert.equal(a.socket_dir.mode, 0o2750);
  assert.equal(a.runner_checks.independent, true);
  assert.equal(a.install_copy.dest, `/opt/commissaire/${a.install_copy.version}`);
  assert.equal(a.install_copy.node, "/usr/bin/node");
});

test("plan: an existing account with another shell or home aborts; an existing non-system group aborts", () => {
  const shell = makeWorld();
  shell.users.set("commissaire", { uid: 300, gid: 300, home: "/var/lib/commissaire", shell: "/bin/bash" });
  assert.equal(run(shell, {}), 2);
  assert.match(shell.err, /commissaire exists with shell \/bin\/bash/);
  const home = makeWorld();
  home.users.set("commissaire", { uid: 300, gid: 300, home: "/home/commissaire", shell: "/usr/sbin/nologin" });
  assert.equal(run(home, {}), 2);
  const group = makeWorld();
  group.groups.set("commissaire-clients", { gid: 2000, members: [] });
  assert.equal(run(group, {}), 2);
  assert.match(group.err, /not a system group/);
  assert.equal(group.opKinds().includes("set_group_members"), false);
});

test("plan: group members other than the runner and admin are replaced and reported, as are replaced uids", () => {
  const world = makeWorld();
  world.groups.set("commissaire-clients", { gid: 990, members: ["mallory", "alice"] });
  world.users.set("commissaire", { uid: 300, gid: 300, home: "/var/lib/commissaire", shell: "/usr/sbin/nologin" });
  world.fs.set("/var/lib/commissaire", fakeDir(300, 300, 0o700));
  world.fs.set("/var/lib/commissaire/governor-config.json", fakeFile(JSON.stringify({ allow_uids: [1000, 1500], admin_uids: [1002] }), 300, 300, 0o600));
  assert.equal(run(world, {}), 0);
  const result = json(world);
  assert.deepEqual(result.replaced, { allow_uids: [1500], admin_uids: [1002], group_members: ["mallory"] });
  assert.equal(world.opKinds().includes("create_group"), false, "an existing group is reused");
  assert.equal(world.opKinds().includes("create_account"), false, "an existing account is reused");
  assert.deepEqual(world.ops.find((o) => o.kind === "set_group_members").members, ["alice", "hal"]);
  const kinds = world.opKinds();
  assert.deepEqual(world.ops.find((o) => o.kind === "restrict_group"), { kind: "restrict_group", group: "commissaire-clients" }, "no gshadow admins and no password on a reused group");
  assert.ok(kinds.indexOf("restrict_group") < kinds.indexOf("set_group_members"));
  const fresh = makeWorld();
  run(fresh, {});
  assert.equal(fresh.opKinds().includes("restrict_group"), false, "a group install creates itself has nothing to clear");
});

// --- Directories: custody of what is already there -------------------------------------------------------------------------------

test("key directory: a runner-owned governor-key.json aborts install naming the path (a runner cannot pre-seed a key)", () => {
  const world = makeWorld();
  world.fs.set("/var/lib/commissaire", fakeDir(0, 0, 0o700));
  world.fs.set("/var/lib/commissaire/governor-key.json", fakeFile("{}", 1000, 1000, 0o600));
  assert.equal(run(world, {}), 2);
  assert.match(world.err, /\/var\/lib\/commissaire\/governor-key\.json is owned by uid 1000/);
  assert.equal(world.opKinds().includes("create_account"), false, "aborted at plan time, before any mutation");
  assert.equal(world.ops.some((o) => o.kind === "write_file"), false);
});

test("key directory: a directory, an entry or a nested entry owned by anyone else, or group/world-writable, aborts", () => {
  const cases = [
    ["the directory", (w) => w.fs.set("/var/lib/commissaire", fakeDir(1000, 1000, 0o700)), "/var/lib/commissaire is owned by uid 1000"],
    ["a writable entry", (w) => { w.fs.set("/var/lib/commissaire", fakeDir(0, 0, 0o700)); w.fs.set("/var/lib/commissaire/governor-log.jsonl", fakeFile("", 0, 0, 0o660)); }, "governor-log.jsonl is group- or world-writable"],
    ["a nested entry", (w) => { w.fs.set("/var/lib/commissaire", fakeDir(0, 0, 0o700)); w.fs.set("/var/lib/commissaire/sub", fakeDir(0, 0, 0o700)); w.fs.set("/var/lib/commissaire/sub/x", fakeFile("", 1000, 1000, 0o600)); }, "sub/x is owned by uid 1000"],
    ["a symlink as the directory", (w) => w.fs.set("/var/lib/commissaire", { uid: 0, gid: 0, mode: 0o777, kind: "symlink" }), "not a real directory"],
    ["a symlink entry", (w) => { w.fs.set("/var/lib/commissaire", fakeDir(0, 0, 0o700)); w.fs.set("/var/lib/commissaire/key", { uid: 0, gid: 0, mode: 0o777, kind: "symlink" }); }, "is a symlink"],
    ["a group-writable ancestor", (w) => w.fs.set("/var/lib", fakeDir(0, 0, 0o775)), "/var/lib must be root-owned"],
    ["a runner-owned ancestor", (w) => w.fs.set("/var", fakeDir(1000, 1000, 0o755)), "/var must be root-owned"],
  ];
  for (const [label, mutate, message] of cases) {
    const world = makeWorld();
    mutate(world);
    assert.equal(run(world, {}), 2, label);
    assert.ok(world.err.includes(message), `${label}: ${world.err}`);
    assert.equal(world.opKinds().includes("create_account"), false, `${label}: nothing was created`);
  }
});

test("key directory: a root-owned directory left by uninstall is re-owned recursively; a governor-owned one is reused", () => {
  const afterUninstall = makeWorld();
  afterUninstall.fs.set("/var/lib/commissaire", fakeDir(0, 0, 0o700));
  afterUninstall.fs.set("/var/lib/commissaire/governor-key.json", fakeFile("{}", 0, 0, 0o600));
  assert.equal(run(afterUninstall, {}), 0);
  assert.deepEqual(afterUninstall.ops.find((o) => o.kind === "chown"), { kind: "chown", path: "/var/lib/commissaire", owner: "commissaire", group: "commissaire", recursive: true });

  const governorOwned = makeWorld();
  governorOwned.users.set("commissaire", { uid: 300, gid: 300, home: "/var/lib/commissaire", shell: "/usr/sbin/nologin" });
  governorOwned.fs.set("/var/lib/commissaire", fakeDir(300, 300, 0o700));
  governorOwned.fs.set("/var/lib/commissaire/governor-key.json", fakeFile("{}", 300, 300, 0o600));
  assert.equal(run(governorOwned, {}), 0);
});

test("socket directory: an existing governor socket (mode 0660) does not trip the writable-entry rule; a runner-owned one does", () => {
  const world = makeWorld();
  world.users.set("commissaire", { uid: 300, gid: 300, home: "/var/lib/commissaire", shell: "/usr/sbin/nologin" });
  world.fs.set("/var/lib/commissaire-socket", fakeDir(300, 990, 0o2750));
  world.fs.set("/var/lib/commissaire-socket/governor.sock", { uid: 300, gid: 990, mode: 0o660, kind: "socket" });
  assert.equal(run(world, {}), 0);
  const bad = makeWorld();
  bad.fs.set("/var/lib/commissaire-socket", fakeDir(0, 0, 0o2750));
  bad.fs.set("/var/lib/commissaire-socket/governor.sock", { uid: 1000, gid: 1000, mode: 0o660, kind: "socket" });
  assert.equal(run(bad, {}), 2);
  assert.match(bad.err, /governor\.sock is owned by uid 1000/);
});

// --- Install copy -------------------------------------------------------------------------------------------------------------------

test("install copy: the closure holds bin/commissaire, the dispatch modules and peer-cred-helper.py, with a content-hash version", () => {
  const world = makeWorld();
  const files = install.closureManifest(world.host, `${CLONE}/plugin/skills/faff`);
  const rels = files.map((f) => f.rel_path);
  for (const required of ["bin/commissaire", "bin/lib/commissaire.js", "bin/lib/shared-infra.js", "bin/lib/governor.js", "bin/lib/governor-install.js", "bin/lib/peer-cred.js", "bin/lib/producer-auth.js", "bin/lib/peer-cred-helper.py"]) {
    assert.ok(rels.includes(required), required);
  }
  assert.deepEqual(rels, rels.slice().sort(), "sorted manifest");
  assert.equal(rels.some((r) => r.endsWith(".ts") || r.includes("node_modules")), false, "sources and build tooling are not copied");
  assert.equal(files.find((f) => f.rel_path === "bin/commissaire").mode, 0o755);
  assert.equal(files.find((f) => f.rel_path === "bin/lib/governor.js").mode, 0o644);
  const version = install.manifestVersion(files);
  assert.match(version, /^[0-9a-f]{64}$/);
  assert.equal(install.manifestVersion(files.slice().reverse()), version, "order does not matter");
  assert.notEqual(install.manifestVersion(files.map((f, i) => (i === 0 ? { ...f, sha256: "0".repeat(64) } : f))), version, "content does");
});

test("install copy: files copy root:root with 0755 directories and 0644 files, plus an install-manifest.json recording the source", () => {
  const world = makeWorld();
  assert.equal(run(world, {}), 0);
  const result = json(world);
  const copies = world.ops.filter((o) => o.kind === "copy_file");
  assert.ok(copies.length > 10);
  for (const c of copies) {
    assert.deepEqual([c.owner, c.group], ["root", "root"]);
    assert.ok(c.dest.startsWith(`/opt/commissaire/${result.install_copy.version}/`));
    assert.equal(c.mode, c.dest.endsWith("/bin/commissaire") ? 0o755 : 0o644);
  }
  assert.equal(world.ops.filter((o) => o.kind === "create_dir" && o.path.startsWith("/opt/commissaire")).every((o) => o.mode === 0o755 && o.owner === "root"), true);
  const manifest = world.ops.find((o) => o.kind === "write_file" && o.path.endsWith("install-manifest.json"));
  assert.deepEqual([manifest.owner, manifest.mode], ["root", 0o644]);
  const body = JSON.parse(manifest.content);
  assert.equal(body.version, result.install_copy.version);
  assert.equal(body.source_tag, TAG);
  assert.equal(body.source_commit, COMMIT);
  assert.ok(body.files.length === copies.length);
  assert.equal(result.install_copy.source_commit, COMMIT, "the result prints source_commit");
});

test("install copy: an install prefix under a runner-writable ancestor aborts", () => {
  const world = makeWorld();
  world.fs.set("/srv", fakeDir(1000, 1000, 0o755));
  assert.equal(run(world, { "--install-prefix": "/srv/commissaire" }), 2);
  assert.match(world.err, /\/srv must be root-owned/);
  assert.equal(world.opKinds().includes("create_account"), false);
});

test("install copy: built only from the manifest, a copy starts the governor (a missed module or asset fails here)", async () => {
  const world = makeWorld();
  const files = install.closureManifest(world.host, `${CLONE}/plugin/skills/faff`);
  const dest = mkdtempSync(join(tmpdir(), "faff-copy-"));
  const keyDir = mkdtempSync(join(tmpdir(), "faff-copy-key-"));
  try {
    for (const f of files) {
      mkdirSync(dirname(join(dest, f.rel_path)), { recursive: true });
      cpSync(f.source.replace(CLONE, REPO), join(dest, f.rel_path));
    }
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [join(dest, "bin", "commissaire"), "governor", "start", "--key-dir", keyDir, "--socket", join(keyDir, "s.sock"), "--socket-group-access"], { stdio: ["ignore", "pipe", "pipe"] });
    const out = await new Promise((resolveP, rejectP) => {
      let text = "", errText = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); rejectP(new Error(`no start: ${text} ${errText}`)); }, 10000);
      child.stderr.on("data", (c) => { errText += c; });
      child.stdout.on("data", (c) => { text += c; if (text.includes("listening")) { clearTimeout(timer); child.kill("SIGTERM"); resolveP(text); } });
      child.on("exit", (code) => { if (!text.includes("listening")) { clearTimeout(timer); rejectP(new Error(`exit ${code}: ${errText}`)); } });
    });
    assert.match(out, /"listening"/);
    assert.ok(readFileSync(join(dest, "bin/lib/peer-cred-helper.py"), "utf8").length > 0);
  } finally {
    rmSync(dest, { recursive: true, force: true });
    rmSync(keyDir, { recursive: true, force: true });
  }
});

test("install copy: pruning keeps the current version and the one the service ran before; a same-version reinstall keeps one", () => {
  const A = "a".repeat(64), B = "b".repeat(64);
  const world = makeWorld();
  assert.equal(run(world, {}), 0);
  const current = json(world).install_copy.version;

  const upgrade = makeWorld();
  upgrade.fs.set("/opt/commissaire", fakeDir());
  for (const v of [A, B]) upgrade.fs.set(`/opt/commissaire/${v}`, fakeDir());
  upgrade.fs.set("/opt/commissaire/not-a-version", fakeDir());
  upgrade.fs.set("/etc/systemd/system/commissaire-governor.service", fakeFile(`[Service]\nExecStart=/usr/bin/node /opt/commissaire/${B}/bin/commissaire governor start\n`, 0, 0, 0o644));
  assert.equal(run(upgrade, {}), 0);
  const removed = upgrade.ops.filter((o) => o.kind === "remove" && o.path.startsWith("/opt/commissaire/") && o.path !== `/opt/commissaire/${current}`).map((o) => o.path);
  assert.deepEqual(removed, [`/opt/commissaire/${A}`], "B (previous) is kept, A is pruned, a non-version name is untouched");
  assert.deepEqual(upgrade.ops.filter((o) => o.kind === "service_op").map((o) => o.args), [["daemon-reload"], ["enable", "commissaire-governor.service"], ["restart", "commissaire-governor.service"]], "an existing service is re-pointed and restarted");

  const same = makeWorld();
  same.fs.set("/opt/commissaire", fakeDir());
  same.fs.set(`/opt/commissaire/${A}`, fakeDir());
  same.fs.set("/etc/systemd/system/commissaire-governor.service", fakeFile(`ExecStart=/usr/bin/node /opt/commissaire/${current}/bin/commissaire governor start\n`, 0, 0, 0o644));
  assert.equal(run(same, {}), 0);
  assert.deepEqual(same.ops.filter((o) => o.kind === "remove" && o.path.startsWith("/opt/commissaire/")).map((o) => o.path), [`/opt/commissaire/${A}`]);
});

test("idempotency: an existing install copy with matching files is reused, not copied again", () => {
  const first = makeWorld();
  assert.equal(run(first, {}), 0);
  const version = json(first).install_copy.version;
  const files = install.closureManifest(first.host, `${CLONE}/plugin/skills/faff`);
  const second = makeWorld();
  second.fs.set("/opt/commissaire", fakeDir());
  second.fs.set(`/opt/commissaire/${version}`, fakeDir());
  for (const f of files) second.fs.set(`/opt/commissaire/${version}/${f.rel_path}`, fakeFile(readFileSync(f.source.replace(CLONE, REPO)).toString("utf8"), 0, 0, f.mode));
  const manifest = first.ops.find((o) => o.kind === "write_file" && o.path.endsWith("install-manifest.json"));
  second.fs.set(`/opt/commissaire/${version}/install-manifest.json`, fakeFile(manifest.content, 0, 0, 0o644));
  assert.equal(run(second, {}), 0);
  assert.equal(second.opKinds().includes("copy_file"), false, "nothing to copy");
  assert.equal(second.ops.some((o) => o.kind === "write_file" && o.path.endsWith("install-manifest.json")), false, "the manifest is unchanged");
  assert.equal(json(second).install_copy.version, version);

  const tampered = makeWorld();
  tampered.fs.set("/opt/commissaire", fakeDir());
  tampered.fs.set(`/opt/commissaire/${version}`, fakeDir());
  tampered.fs.set(`/opt/commissaire/${version}/bin/commissaire`, fakeFile("tampered", 0, 0, 0o755));
  assert.equal(run(tampered, {}), 0);
  assert.ok(tampered.ops.some((o) => o.kind === "remove" && o.path === `/opt/commissaire/${version}`), "a copy that does not match is replaced");
  assert.ok(tampered.opKinds().includes("copy_file"));

  const foreign = makeWorld();
  foreign.fs.set("/opt/commissaire", fakeDir());
  foreign.fs.set(`/opt/commissaire/${version}`, fakeDir(1000, 1000, 0o755));
  assert.equal(run(foreign, {}), 2, "a non-root-owned install copy is aborted on, not adopted");
});

test("idempotency: a second plan against the converged host reproduces the same config and unit text apart from checked_at", () => {
  const first = makeWorld();
  assert.equal(run(first, {}), 0);
  const second = makeWorld();
  assert.equal(run(second, {}, { now: () => new Date("2026-10-13T09:30:00Z") }), 0);
  const config = (w) => JSON.parse(w.ops.find((o) => o.kind === "write_file" && o.path.endsWith("governor-config.json")).content);
  const a = config(first), b = config(second);
  assert.notEqual(a.runner_checks.checked_at, b.runner_checks.checked_at);
  delete a.runner_checks.checked_at;
  delete b.runner_checks.checked_at;
  assert.deepEqual(a, b);
  const unit = (w) => w.ops.find((o) => o.kind === "write_file" && o.path.endsWith(".service")).content;
  assert.equal(unit(first), unit(second));
});

// --- Result, fingerprint, exit codes -----------------------------------------------------------------------------------------------------

test("result: prints the fingerprint from the key file, source_commit and all three next steps", () => {
  const world = makeWorld();
  assert.equal(run(world, {}), 0);
  const r = json(world);
  assert.equal(r.platform, "linux");
  assert.equal(r.pk_fingerprint, FINGERPRINT);
  assert.equal(r.install_copy.source_commit, COMMIT);
  assert.equal(r.install_copy.source_tag, TAG);
  assert.equal(r.socket_path, "/var/lib/commissaire-socket/governor.sock");
  assert.equal(r.key_dir, "/var/lib/commissaire");
  assert.deepEqual(r.allow_uids, [1000]);
  assert.deepEqual(r.admin_uids, [1001]);
  assert.deepEqual(r.client_group, { name: "commissaire-clients", members: ["alice", "hal"] });
  assert.equal(r.next_steps.length, 3);
  assert.match(r.next_steps[0], /commissaire\.governor: \/var\/lib\/commissaire-socket\/governor\.sock .*\.faffrc\.yaml.*COMMISSAIRE_GOVERNOR/);
  assert.match(r.next_steps[1], /new login session for alice and hal.*commissaire-clients/);
  assert.ok(r.next_steps[2].includes(`/opt/commissaire/${r.install_copy.version}/bin/commissaire governor pin --socket /var/lib/commissaire-socket/governor.sock --runner-user alice --repo <OWNER/NAME>`));
  assert.match(r.next_steps[2], /As hal/);
});

test("result: the human form carries the same facts", () => {
  const world = makeWorld();
  assert.equal(install.governorInstall({ "--runner-user": "alice", "--from-tag": TAG }, world.deps()), 0);
  assert.match(world.out, new RegExp(`pk_fingerprint: ${FINGERPRINT}`));
  assert.match(world.out, new RegExp(`source commit:  ${COMMIT}`));
  assert.match(world.out, /Next steps:\n  1\. .*\n  2\. .*\n  3\. /);
});

test("fingerprint: when the key file never appears install prints the result with pk_fingerprint null and exits 1", () => {
  const world = makeWorld({ keyAppears: false });
  const start = world.clock.t;
  assert.equal(run(world, {}), 1);
  const r = json(world);
  assert.equal(r.pk_fingerprint, null);
  assert.equal(r.next_steps.length, 3, "the rest of the result is still printed");
  assert.ok(world.clock.t - start >= 30_000, "it polled for the full 30 seconds");
  const human = makeWorld({ keyAppears: false });
  assert.equal(install.governorInstall({ "--runner-user": "alice", "--from-tag": TAG }, human.deps()), 1);
  assert.match(human.out, /pk_fingerprint: null .*systemctl status commissaire-governor/);
});

test("fingerprint: a partially written or fingerprint-less key file is polled again", () => {
  const world = makeWorld();
  let reads = 0;
  const host = { ...world.host, readFile: (p) => { reads++; return reads < 3 ? Buffer.from("{") : Buffer.from(JSON.stringify({ pk_fingerprint: "abc" })); } };
  assert.equal(install.learnFingerprint(host, "/k", world.clock, 30_000), "abc");
  assert.equal(reads, 3);
  assert.equal(install.learnFingerprint({ ...world.host, readFile: () => null }, "/k", world.clock, 1000), null);
});

test("execution: the first failing op aborts the install with its message and exit 1, and the clone is removed", () => {
  const world = makeWorld({ failKind: "create_account" });
  assert.equal(run(world, {}), 1);
  assert.match(world.err, /install step \d+ \(create_account\) failed: create_account refused by the test/);
  assert.equal(world.opKinds().includes("write_file"), false, "nothing after the failing step ran");
  assert.deepEqual(world.ops.at(-1), { kind: "remove", path: CLONE, recursive: true, onlyIfEmpty: false });
});

// --- Uninstall -------------------------------------------------------------------------------------------------------------------------------------

const installedWorld = () => {
  const world = makeWorld();
  world.users.set("commissaire", { uid: 300, gid: 300, home: "/var/lib/commissaire", shell: "/usr/sbin/nologin" });
  world.groups.set("commissaire-clients", { gid: 990, members: ["alice", "hal"] });
  world.fs.set("/var/lib/commissaire", fakeDir(300, 300, 0o700));
  world.fs.set("/var/lib/commissaire-socket", fakeDir(300, 990, 0o2750));
  world.fs.set("/etc/systemd/system/commissaire-governor.service", fakeFile("", 0, 0, 0o644));
  world.fs.set("/opt/commissaire", fakeDir());
  world.fs.set(`/opt/commissaire/${"a".repeat(64)}`, fakeDir());
  world.fs.set(`/opt/commissaire/${"b".repeat(64)}`, fakeDir());
  return world;
};

test("uninstall: stops the service, empties the lists, re-owns the kept key directory, then removes socket directory, group, account and copies in that order", () => {
  const world = installedWorld();
  assert.equal(install.governorUninstall({ "--json": true }, world.deps()), 0);
  const steps = world.ops.map((o) => (o.kind === "service_op" ? `systemctl ${o.args.join(" ")}` : o.kind === "remove" || o.kind === "chown" || o.kind === "write_file" ? `${o.kind} ${o.path}` : `${o.kind} ${o.name ?? ""}`.trim()));
  assert.deepEqual(steps, [
    "systemctl disable --now commissaire-governor.service",
    "remove /etc/systemd/system/commissaire-governor.service",
    "systemctl daemon-reload",
    "write_file /var/lib/commissaire/governor-config.json",
    "chown /var/lib/commissaire",
    "remove /var/lib/commissaire-socket",
    "delete_group commissaire-clients",
    "delete_account commissaire",
    `remove /opt/commissaire/${"a".repeat(64)}`,
    `remove /opt/commissaire/${"b".repeat(64)}`,
    "remove /opt/commissaire",
  ]);
  const config = JSON.parse(world.ops.find((o) => o.kind === "write_file").content);
  assert.deepEqual(config, { allow_uids: [], admin_uids: [] }, "no uids and no runner_checks");
  assert.deepEqual(world.ops.find((o) => o.kind === "chown"), { kind: "chown", path: "/var/lib/commissaire", owner: "root", group: "root", recursive: true });
  assert.equal(world.ops.find((o) => o.kind === "remove" && o.onlyIfEmpty).path, "/opt/commissaire");
  assert.deepEqual(JSON.parse(world.out), { uninstalled: true, key_dir: "/var/lib/commissaire", key_dir_kept: true, socket_dir: "/var/lib/commissaire-socket", install_prefix: "/opt/commissaire" });
});

test("uninstall --purge-key removes the key directory instead of re-owning it", () => {
  const world = installedWorld();
  assert.equal(install.governorUninstall({ "--purge-key": true }, world.deps()), 0);
  assert.deepEqual(world.ops.find((o) => o.path === "/var/lib/commissaire"), { kind: "remove", path: "/var/lib/commissaire", recursive: true, onlyIfEmpty: false });
  assert.equal(world.opKinds().includes("chown"), false);
});

test("uninstall: a failing step aborts before the account is removed, so the key never belongs to a deleted uid", () => {
  const world = installedWorld();
  world.failKind = "chown";
  assert.equal(install.governorUninstall({}, world.deps()), 1);
  assert.equal(world.opKinds().includes("delete_account"), false);
  assert.equal(world.opKinds().includes("delete_group"), false);
});

test("uninstall: needs root, the self-custody guard and the tools; on a host that was never installed it plans only the leftovers", () => {
  const world = installedWorld();
  assert.equal(install.governorUninstall({}, world.deps({ getuid: () => 1000 })), 2);
  assert.equal(world.ops.length, 0);
  const guard = installedWorld();
  guard.fs.set("/opt/installer/bin/lib", fakeDir(1000, 1000, 0o755));
  assert.equal(install.governorUninstall({}, guard.deps()), 2);
  assert.match(guard.err, /install-code-not-root-owned/);
  const clean = makeWorld();
  assert.equal(install.governorUninstall({}, clean.deps()), 0);
  assert.deepEqual(clean.opKinds(), ["remove", "remove"], "only the socket directory and prefix removals, both no-ops on a clean host");
});

test("uninstall: a user-owned socket directory aborts with exit 2 and removes nothing", () => {
  const world = installedWorld();
  world.fs.set("/var/lib/commissaire-socket", fakeDir(1000, 990, 0o2750));
  assert.equal(install.governorUninstall({}, world.deps()), 2);
  assert.match(world.err, /socket directory .* owned by uid 1000/);
  assert.equal(world.ops.length, 0);
});

test("uninstall: key and socket directories that are symlinks, runner-writable, in a loose chain, or hold foreign content abort", () => {
  const cases = [
    ["symlinked key dir", (w) => w.fs.set("/var/lib/commissaire", { uid: 0, gid: 0, mode: 0o777, kind: "symlink" }), {}],
    ["symlinked socket dir", (w) => w.fs.set("/var/lib/commissaire-socket", { uid: 0, gid: 0, mode: 0o777, kind: "symlink" }), {}],
    ["wrong socket group", (w) => w.fs.set("/var/lib/commissaire-socket", fakeDir(300, 1000, 0o2750)), {}],
    ["group-writable ancestor", (w) => w.fs.set("/var/lib", fakeDir(0, 0, 0o775)), {}],
    ["key dir entry owned by the runner", (w) => w.fs.set("/var/lib/commissaire/x", fakeFile("", 1000, 1000, 0o600)), { "--purge-key": true }],
    ["stray socket dir entry", (w) => w.fs.set("/var/lib/commissaire-socket/notes", fakeFile("", 0, 0, 0o600)), {}],
    ["key dir with no commissaire files", (w) => w.fs.set("/var/lib/commissaire/other", fakeFile("", 0, 0, 0o644)), { "--purge-key": true }],
    ["prefix owned by the runner", (w) => w.fs.set("/opt/commissaire", fakeDir(1000, 1000, 0o755)), {}],
  ];
  for (const [label, mutate, flags] of cases) {
    const world = installedWorld();
    mutate(world);
    assert.equal(install.governorUninstall(flags, world.deps()), 2, label);
    assert.equal(world.ops.length, 0, label);
  }
});

test("uninstall: --key-dir pointing at a shared directory like /home aborts and removes or re-owns nothing", () => {
  for (const flags of [{ "--key-dir": "/home" }, { "--key-dir": "/home", "--purge-key": true }]) {
    const world = installedWorld();
    world.fs.set("/home/alice", fakeDir(1000, 1000, 0o755));
    assert.equal(install.governorUninstall(flags, world.deps()), 2);
    assert.equal(world.ops.length, 0);
  }
  const socket = installedWorld();
  socket.fs.set("/home/alice", fakeDir(1000, 1000, 0o755));
  assert.equal(install.governorUninstall({ "--socket-dir": "/home" }, socket.deps()), 2);
  assert.equal(socket.ops.length, 0);
});
