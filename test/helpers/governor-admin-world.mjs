// FAFF-1217: a throwaway world for `commissaire governor pin|status` tests. A bare "GitHub" origin at
// <srv>/acme/widgets.git, a human clone whose origin URL parses to acme/widgets (git reaches the bare
// repo through a GIT_SSH_COMMAND shim, so no network and no sshd), a configurable stub `gh`, and a stub
// `git` shim that logs every argv. Nothing here touches the real remote, real GitHub or the host user db.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
export const LIB = join(resolve(HERE, "..", ".."), "plugin", "skills", "faff", "bin", "lib");
export const BIN = join(LIB, "..");
const require = createRequire(import.meta.url);
export const admin = require(join(LIB, "governor-admin.js"));

export const FP = "a".repeat(63) + "1";
export const OTHER_FP = "b".repeat(63) + "2";
export const REPO = "acme/widgets";

export const ghStubScript = (configPath, logPath) => `#!/usr/bin/env node
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(configPath)}, "utf8"));
const args = process.argv.slice(2);
const joined = args.join(" ");
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
const out = (s) => process.stdout.write(s);
const done = (code, err) => { if (err) process.stderr.write(err + "\\n"); process.exit(code); };
if (args[0] === "repo" && args[1] === "view") {
  if (cfg.repoViewFails) done(1, "gh: repo view failed");
  out(JSON.stringify({ defaultBranchRef: { name: cfg.defaultBranch } })); done(0);
}
if (args[0] === "pr" && args[1] === "create") {
  if (cfg.prCreateFails) done(1, "gh: pr create failed");
  out(cfg.prUrl + "\\n"); done(0);
}
if (args[0] === "api") {
  const probe = args.includes("-i");
  if (joined.includes("/rules/branches/")) {
    if (cfg.rules === "fail") done(1, "gh: rules unavailable");
    if (cfg.rules === "garbage") { out("not json"); done(0); }
    out(JSON.stringify(cfg.rules)); done(0);
  }
  if (joined.includes(".commissaire/trust.toml")) {
    if (probe) { out(cfg.trustMode === "down" ? "HTTP/2.0 500 Server Error\\n\\n" : "HTTP/2.0 404 Not Found\\n\\n"); done(1); }
    if (cfg.trustMode === "present") { out(JSON.stringify({ content: Buffer.from(cfg.trustToml, "utf8").toString("base64"), encoding: "base64" })); done(0); }
    done(1, "gh: not found");
  }
  if (probe && joined.includes("/contents")) { out("HTTP/2.0 200 OK\\n\\n"); done(0); }
  if (joined === "api user") { if (cfg.userFails) done(1, "gh: no user"); out(JSON.stringify({ login: cfg.human })); done(0); }
}
done(3, "gh stub: unhandled call: " + joined);
`;

const SSH_SHIM = (srv) => `#!/bin/sh
for last; do :; done
cd ${srv} && exec sh -c "$last"
`;

const GIT_SHIM = (logPath) => `#!/bin/sh
printf '%s\\n' "$*" >> ${logPath}
exec /usr/bin/git "$@"
`;

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });

// An ambient git rewrite (url.<base>.insteadOf from GIT_CONFIG_COUNT) would redirect the pseudo GitHub
// URL to the real network; scrub every config-from-environment variable so the world stays local.
function hermeticGit() {
  for (const key of Object.keys(process.env)) {
    if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete process.env[key];
  }
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
}

export function makeWorld({ trustToml = null } = {}) {
  hermeticGit();
  const root = mkdtempSync(join(tmpdir(), "gadm-"));
  const srv = join(root, "srv");
  const bare = join(srv, "acme", "widgets.git");
  const work = join(root, "clone", "work");
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(root, "clone"), { recursive: true });
  mkdirSync(join(srv, "acme"), { recursive: true });
  git(root, "init", "-q", "--bare", "-b", "main", bare);
  git(root, "init", "-q", "-b", "main", work);
  git(work, "config", "user.name", "Test Human");
  git(work, "config", "user.email", "human@example.invalid");
  writeFileSync(join(work, "README.md"), "hello\n");
  if (trustToml !== null) {
    mkdirSync(join(work, ".commissaire"), { recursive: true });
    writeFileSync(join(work, ".commissaire", "trust.toml"), trustToml);
  }
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "init");
  git(work, "remote", "add", "origin", "git@github.com:acme/widgets.git");
  const sshShim = join(root, "fakessh");
  writeFileSync(sshShim, SSH_SHIM(srv));
  chmodSync(sshShim, 0o755);
  process.env.GIT_SSH_COMMAND = sshShim;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  git(work, "push", "-q", "origin", "main");

  const ghConfig = join(root, "gh-config.json");
  const ghLog = join(root, "gh.log");
  const gitLog = join(root, "git.log");
  const gh = join(bin, "gh");
  const gitShim = join(bin, "git");
  writeFileSync(gh, ghStubScript(ghConfig, ghLog)); chmodSync(gh, 0o755);
  writeFileSync(gitShim, GIT_SHIM(gitLog)); chmodSync(gitShim, 0o755);
  writeFileSync(ghLog, ""); writeFileSync(gitLog, "");

  const world = {
    root, bare, work, gh, gitShim, ghLog, gitLog,
    setGh(cfg) {
      writeFileSync(ghConfig, JSON.stringify({
        defaultBranch: "main", rules: [{ type: "pull_request" }], trustMode: trustToml === null ? "absent" : "present", trustToml,
        human: "human-login", prUrl: "https://github.com/acme/widgets/pull/7", ...cfg,
      }));
    },
    ghCalls: () => readFileSync(ghLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    gitCalls: () => readFileSync(gitLog, "utf8").split("\n").filter(Boolean),
    remoteBranches: () => git(bare, "branch", "--list").split("\n").map((l) => l.replace(/^[* ]+/, "")).filter(Boolean),
    show: (ref, file) => git(bare, "show", `${ref}:${file}`),
    log: (ref) => git(bare, "log", "-1", "--format=%B", ref),
    localBranches: () => git(work, "branch", "--list").split("\n").map((l) => l.replace(/^[* ]+/, "")).filter(Boolean),
    worktrees: () => git(work, "worktree", "list").split("\n").filter(Boolean),
    git: (...args) => git(work, ...args),
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
  world.setGh({});
  return world;
}

export function runnerChecks(over = {}) {
  return {
    schema: 1, runner_user: "runner", runner_uid: 1001, platform: "linux", socket_group: "commissaire-clients",
    docker_group: false, sudo_rules: false, sudo_absent: true, admin_group: null, independent: true,
    checked_at: new Date(Date.now() - 3 * 86400000).toISOString(), install_version: "0.42.0", source_tag: "faff--v0.42.0", ...over,
  };
}

export function identifyReply(over = {}) {
  return { ok: true, pk: "PK", pk_fingerprint: FP, key_file: "/var/lib/gov/governor-key.json", runner_checks: runnerChecks(), ...over };
}

// Stub deps for a passing pin: human uid 1000, runner uid 1001, governor uid 990 owning /var/lib/gov.
// The stub governor's reply carries a freshly minted key so pkFingerprint(pk) agrees with the fingerprint.
export function passingDeps(world, over = {}) {
  const producerAuth = require(join(LIB, "producer-auth.js"));
  const kp = producerAuth.mintGovernorKeypair();
  const stats = {
    "/var/lib/gov": { uid: 990, gid: 990, mode: 0o700, isDirectory: true, isSymlink: false },
    "/var/lib": { uid: 0, gid: 0, mode: 0o755, isDirectory: true, isSymlink: false },
    "/var": { uid: 0, gid: 0, mode: 0o755, isDirectory: true, isSymlink: false },
    "/": { uid: 0, gid: 0, mode: 0o755, isDirectory: true, isSymlink: false },
  };
  const calls = { peer: 0, git: [], gh: [] };
  const deps = {
    ...admin.DEFAULT_DEPS,
    calls, stats,
    kp,
    peerRequest: () => { calls.peer++; return { ok: true, reply: identifyReply({ pk: kp.pk, pk_fingerprint: kp.pk_fingerprint }), peer_uid: 990 }; },
    getuid: () => 1000,
    platform: () => "linux",
    lookupRunner: () => ({ uid: 1001, gids: [1001], groups: ["runner"] }),
    lstat: (p) => stats[p] ?? null,
    openNoFollow: () => "EACCES",
    ancestors: (p) => { const out = []; for (let c = p; ; c = c.replace(/\/[^/]*$/, "") || "/") { out.push(c); if (c === "/") break; } return out; },
    runnerCanWrite: () => false,
    requireClosure: () => ["/opt/commissaire/1/lib/a.js"],
    execPath: () => "/usr/local/bin/node",
    uidMin: () => 1000,
    homeOf: () => "/var/lib/gov",
    resolveBin: (name) => (name === "git" ? world.gitShim : name === "gh" ? world.gh : null),
    gitDir: () => join(world.work, ".git"),
    hostname: () => "host-1",
    cwd: () => world.work,
    now: () => new Date(),
    ...over,
  };
  return deps;
}
