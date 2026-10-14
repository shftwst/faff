// FAFF-1181 — `commissaire governor pin --fly-app` and `commissaire governor identify --json`. The `fly`
// binary is an injected seam (runFly) that records its argument array and answers with a scripted
// `fly ssh console` result; git runs for real against a throwaway bare origin and gh is a stub, as in
// governor-admin.test.mjs. Nothing here touches Fly, GitHub or the host user database.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { makeWorld, admin, passingDeps, REPO, LIB, BIN } from "./helpers/governor-admin-world.mjs";

const require = createRequire(import.meta.url);
const COMMISSAIRE = join(BIN, "commissaire");
const producerAuth = require(join(LIB, "producer-auth.js"));

const worlds = [];
const world = () => { const w = makeWorld(); worlds.push(w); return w; };
const dirs = [];
after(() => { for (const w of worlds) w.cleanup(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const APP = "commissaire-governor";
const FLY = "/usr/local/bin/fly";
const COMMAND = "/opt/commissaire/current/bin/commissaire governor identify --json";
const SOURCE = "0123456789abcdef0123456789abcdef01234567";
const FLAGS = { "--fly-app": APP, "--runner-user": "runner", "--repo": REPO };

const noCalls = (what) => () => { throw new Error(`${what} must not be called`); };

// Deps for a passing Fly pin. The local host-fact seams throw, so any check that still reaches them fails the test.
function flyDeps(w, { reply = {}, run, over = {} } = {}) {
  const kp = producerAuth.mintGovernorKeypair();
  const calls = [];
  const identifyJson = JSON.stringify({ ok: true, pk: kp.pk, pk_fingerprint: kp.pk_fingerprint, key_file: "/data/commissaire/governor-key.json", runner_checks: null, source_commit: SOURCE, ...reply });
  const deps = passingDeps(w, {
    resolveBin: (name) => (name === "git" ? w.gitShim : name === "gh" ? w.gh : name === "fly" ? FLY : null),
    runFly: (bin, args) => { calls.push({ bin, args }); return run ? run(bin, args) : { status: 0, stdout: `${identifyJson}\n`, stderr: "" }; },
    peerRequest: noCalls("peerRequest"),
    homeOf: noCalls("homeOf"),
    openNoFollow: noCalls("openNoFollow"),
    lookupRunner: () => ({ uid: 1001, gids: [1001, 998], groups: ["runner", "docker"] }),
    ...over,
  });
  return { deps, calls, kp };
}

const pin = (w, flags = {}, opts = {}) => {
  const f = flyDeps(w, opts);
  const o = admin.pinCore({ ...FLAGS, ...flags }, f.deps);
  return { ...f, outcome: o, result: o.result };
};

// --- usage ---------------------------------------------------------------------------------------

test("--fly-app must be a lowercase Fly app name: anything else is a usage error and nothing runs", () => {
  const w = world();
  const trap = { runFly: noCalls("runFly"), resolveBin: noCalls("resolveBin"), lookupRunner: noCalls("lookupRunner"), runGit: noCalls("runGit"), runGh: noCalls("runGh") };
  for (const bad of ["Bad_App", "a b", "-x", "app;rm", "app$(x)", "UPPER", "", "a/b", "app\nx", "../x"]) {
    const o = admin.pinCore({ ...FLAGS, "--fly-app": bad }, passingDeps(w, trap));
    assert.match(o.usage ?? "", /--fly-app must be a Fly app name matching \^\[a-z0-9-\]\+\$/, JSON.stringify(bad));
  }
  const bare = admin.pinCore({ ...FLAGS, "--fly-app": true }, passingDeps(w, trap));
  assert.match(bare.usage ?? "", /--fly-app/);
});

test("--fly-app and --socket together are a usage error; --fly-app needs no --socket", () => {
  const w = world();
  const o = admin.pinCore({ ...FLAGS, "--socket": "/tmp/g.sock" }, passingDeps(w, { runFly: noCalls("runFly") }));
  assert.match(o.usage ?? "", /mutually exclusive/);
  const ok = pin(w, { "--dry-run": true });
  assert.equal(ok.result.pinned, "dry-run");
});

test("through the CLI a bad app name exits 2 with empty stdout, and --runner-user and --repo stay required", () => {
  for (const args of [
    ["governor", "pin", "--fly-app", "Bad_App", "--runner-user", "r", "--repo", "a/b"],
    ["governor", "pin", "--fly-app", "good-app", "--repo", "a/b"],
    ["governor", "pin", "--fly-app", "good-app", "--runner-user", "r"],
    ["governor", "pin", "--fly-app", "good-app", "--socket", "/tmp/x.sock", "--runner-user", "r", "--repo", "a/b"],
  ]) {
    const r = spawnSync(process.execPath, [COMMISSAIRE, ...args], { encoding: "utf8" });
    assert.equal(r.status, 2, args.join(" "));
    assert.equal(r.stdout, "");
    assert.notEqual(r.stderr, "");
  }
});

// --- how fly is run ------------------------------------------------------------------------------

test("pin runs fly with an argument array, the fixed /opt/commissaire/current path, and reads identify from its stdout", () => {
  const w = world();
  const { calls, result, kp } = pin(w);
  assert.equal(result.pinned, "opened-pr", JSON.stringify(result));
  assert.equal(result.pk_fingerprint, kp.pk_fingerprint);
  assert.deepEqual(calls, [{ bin: FLY, args: ["ssh", "console", "-a", APP, "-C", COMMAND] }]);
  assert.ok(calls[0].args.every((a) => typeof a === "string"), "an argument array, never a shell string");
});

test("pin takes the identify reply from the last JSON line when fly prints a banner first", () => {
  const w = world();
  const kp = producerAuth.mintGovernorKeypair();
  const reply = JSON.stringify({ ok: true, pk: kp.pk, pk_fingerprint: kp.pk_fingerprint, key_file: "/data/commissaire/governor-key.json", runner_checks: null });
  const { result } = pin(w, { "--dry-run": true }, { run: () => ({ status: 0, stdout: `Connecting to fdaa:0:1::2... complete\n${reply}\n`, stderr: "" }) });
  assert.equal(result.pinned, "dry-run");
  assert.equal(result.pk_fingerprint, kp.pk_fingerprint);
});

test("pin refuses a runner-writable fly binary code-runner-writable, before fly runs", () => {
  const w = world();
  const { result, calls } = pin(w, {}, { over: { runnerCanWrite: (p) => p === FLY } });
  assert.equal(result.reason, "code-runner-writable");
  assert.match(result.detail, /fly/);
  assert.equal(calls.length, 0);
  const dirWritable = pin(w, {}, { over: { runnerCanWrite: (p) => p === "/usr/local/bin" } });
  assert.equal(dirWritable.result.reason, "code-runner-writable", "a writable directory above fly counts too");
});

test("pin refuses when fly is not on PATH, when it fails, and when it prints no JSON", () => {
  const w = world();
  assert.equal(pin(w, {}, { over: { resolveBin: (n) => (n === "fly" ? null : n === "git" ? w.gitShim : w.gh) } }).result.reason, "fly-failed");
  const failed = pin(w, {}, { run: () => ({ status: 1, stdout: "", stderr: "Error: app not found" }) }).result;
  assert.equal(failed.reason, "governor-unreachable");
  assert.match(failed.detail, /app not found/);
  assert.equal(pin(w, {}, { run: () => ({ status: 0, stdout: "no json here\n", stderr: "" }) }).result.reason, "identify-invalid");
  assert.equal(pin(w, {}, { run: () => ({ status: 0, stdout: `${JSON.stringify({ ok: false, reason: "caller-not-allowed" })}\n`, stderr: "" }) }).result.reason, "governor-refused");
  assert.equal(w.ghCalls().filter((c) => c[0] === "pr").length, 0);
});

test("pin verifies pk_fingerprint against SHA-256 of the SPKI-DER public key and opens no PR on a mismatch", () => {
  const w = world();
  const { result, kp } = pin(w, {}, { reply: { pk_fingerprint: "c".repeat(64) } });
  assert.equal(result.reason, "fingerprint-mismatch");
  assert.notEqual(result.pk_fingerprint, kp.pk_fingerprint);
  const other = producerAuth.mintGovernorKeypair();
  assert.equal(pin(w, {}, { reply: { pk: other.pk } }).result.reason, "fingerprint-mismatch", "a key swapped under an honest fingerprint is caught too");
  assert.equal(pin(w, {}, { reply: { pk_fingerprint: "short" } }).result.reason, "identify-invalid");
  assert.equal(w.ghCalls().filter((c) => c[0] === "pr").length, 0);
  assert.equal(w.remoteBranches().filter((b) => b.startsWith("commissaire/pin-")).length, 0);
});

// --- what is skipped and what is kept ------------------------------------------------------------

test("pin skips only the local host-fact checks: a root-equivalent runner group and no install record do not matter", () => {
  const w = world();
  const { result } = pin(w, { "--dry-run": true });
  assert.equal(result.pinned, "dry-run", JSON.stringify(result));
});

test("pin keeps the invoker checks: invoked-as-root and invoked-as-runner are refused before fly runs", () => {
  const w = world();
  assert.equal(pin(w, {}, { over: { getuid: () => 0 } }).result.reason, "invoked-as-root");
  const asRunner = pin(w, {}, { over: { getuid: () => 1001 } });
  assert.equal(asRunner.result.reason, "invoked-as-runner");
  assert.equal(asRunner.calls.length, 0);
});

test("pin keeps the repository, base-branch and branch-protection checks", () => {
  const w = world();
  assert.equal(pin(w, { "--repo": "acme/other" }).result.reason, "repo-mismatch");
  w.setGh({ rules: [] });
  assert.equal(pin(w).result.reason, "base-not-protected");
  w.setGh({ rules: "fail" });
  assert.equal(pin(w).result.reason, "base-protection-unknown");
  w.setGh({});
  const repoWritable = pin(w, {}, { over: { runnerCanWrite: (p) => p === join(w.work, ".git") } });
  assert.equal(repoWritable.result.reason, "repo-runner-writable");
  assert.equal(w.ghCalls().filter((c) => c[0] === "pr").length, 0);
});

test("a fingerprint already on the base branch is already-pinned and opens nothing", () => {
  const first = world();
  const { kp } = pin(first, { "--dry-run": true });
  const w = makeWorld({ trustToml: `schema = 1\n\ngovernor_key_fingerprints = [\n  "${kp.pk_fingerprint}",\n]\n` });
  worlds.push(w);
  const f = flyDeps(w, { reply: { pk: kp.pk, pk_fingerprint: kp.pk_fingerprint } });
  const o = admin.pinCore({ ...FLAGS }, f.deps);
  assert.equal(o.result.pinned, "already-pinned");
});

// --- the pull request ----------------------------------------------------------------------------

test("the PR body names the app, the source commit, the cross-check command and the five-item checklist, verbatim", () => {
  const w = world();
  const { result, kp } = pin(w);
  assert.equal(result.pinned, "opened-pr");
  const create = w.ghCalls().find((c) => c[0] === "pr" && c[1] === "create");
  const body = create[create.indexOf("--body") + 1];
  const pushed = /Pushed commit: `([0-9a-f]{40,64})`/.exec(body)[1];
  assert.equal(pushed, execFileSync("git", ["--git-dir", w.bare, "rev-parse", `refs/heads/${result.branch}`], { encoding: "utf8" }).trim());
  const expected = [
    "Target repository: acme/widgets, base branch: main",
    `Governor key fingerprint: \`${kp.pk_fingerprint}\``,
    `Pushed commit: \`${pushed}\``,
    ["Fly app: `commissaire-governor`", `Image source commit: \`${SOURCE}\``].join("\n"),
    [
      "Read by `commissaire governor pin --fly-app` from its own `fly ssh console` session inside the governor machine, and checked against the SHA-256 of the SPKI-DER public key the governor reported.",
      "To read the same fingerprint independently before approving, run:",
      "```",
      `fly ssh console -a ${APP} -C "${COMMAND}"`,
      "```",
    ].join("\n"),
    [
      "Checklist for the approving human (pin cannot observe these Fly facts):",
      "- [ ] The runbook records the Fly documentation on isolation between custom private networks and the operator's 2026-10-14 basis for the same-network question (only the governor and runner apps on the network).",
      "- [ ] `fly ips list -a <app>` shows no public address.",
      "- [ ] The governor app and the runner app share one custom private network that no other app is on.",
      "- [ ] The runner app's machines hold no Fly token that can deploy to, SSH into, or manage volumes of the governor app.",
      "- [ ] The governor was deployed from a clean checkout of a release tag.",
    ].join("\n"),
    "A human must approve this PR. It changes `.commissaire/trust.toml`, so the runner must not merge it.",
  ].join("\n\n") + "\n";
  assert.equal(body, expected);
  assert.ok(!body.includes("- [x]"), "every box is unticked");
});

test("the trust-file entry comment names the Fly app, not a host uid", () => {
  const w = world();
  const { result, kp } = pin(w);
  assert.equal(result.pinned, "opened-pr");
  const file = w.show(result.branch, ".commissaire/trust.toml");
  assert.match(file, new RegExp(`"${kp.pk_fingerprint}",  # fly app ${APP}, pinned \\d{4}-\\d{2}-\\d{2}`));
  assert.match(w.log(result.branch), /Signed-off-by: Test Human <human@example\.invalid>/);
});

test("an unreported source commit is said so rather than invented", () => {
  const w = world();
  const { result } = pin(w, {}, { reply: { source_commit: "not-a-commit" } });
  assert.equal(result.pinned, "opened-pr");
  const create = w.ghCalls().find((c) => c[0] === "pr" && c[1] === "create");
  assert.match(create[create.indexOf("--body") + 1], /Image source commit: not reported by the governor/);
});

test("without --fly-app a TCP endpoint is still refused remote-governor-unsupported, and no fly call is made", () => {
  const w = world();
  const deps = passingDeps(w, { runFly: noCalls("runFly"), peerRequest: noCalls("peerRequest") });
  const o = admin.pinCore({ "--socket": "127.0.0.1:9000", "--runner-user": "runner", "--repo": REPO }, deps);
  assert.equal(o.result.reason, "remote-governor-unsupported");
});

// --- identify --json -----------------------------------------------------------------------------

function startGovernor(adminUid) {
  const dir = mkdtempSync(join(tmpdir(), "gfly-"));
  dirs.push(dir);
  chmodSync(dir, 0o700);
  writeFileSync(join(dir, "governor-config.json"), JSON.stringify({ admin_uids: [adminUid], allow_uids: [] }), { mode: 0o600 });
  const child = spawn(process.execPath, [COMMISSAIRE, "governor", "start", "--key-dir", dir], { stdio: ["ignore", "pipe", "pipe"] });
  const ready = new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`governor did not start: ${out}`)), 8000);
    child.stdout.on("data", (c) => { out += c; if (out.includes('"listening"')) { clearTimeout(timer); resolve(); } });
    child.on("error", reject);
  });
  return { child, ready, dir };
}

const LINUX = process.platform === "linux" && existsSync("/usr/bin/python3");

test("identify --json prints the governor's identify reply from the local Unix socket", { skip: LINUX ? false : "needs linux + /usr/bin/python3 for the peer-credential guard" }, async () => {
  const g = startGovernor(process.getuid());
  try {
    await g.ready;
    for (const args of [["--key-dir", g.dir], ["--socket", join(g.dir, "governor.sock")]]) {
      const r = spawnSync(process.execPath, [COMMISSAIRE, "governor", "identify", "--json", ...args], { encoding: "utf8", env: { ...process.env, COMMISSAIRE_KEY_DIR: undefined } });
      assert.equal(r.status, 0, r.stderr);
      const reply = JSON.parse(r.stdout);
      const key = JSON.parse(readFileSync(join(g.dir, "governor-key.json"), "utf8"));
      assert.equal(reply.ok, true);
      assert.equal(reply.pk, key.pk);
      assert.equal(reply.pk_fingerprint, key.pk_fingerprint);
      assert.equal(producerAuth.pkFingerprint(reply.pk), reply.pk_fingerprint);
      assert.equal(reply.key_file, join(g.dir, "governor-key.json"));
      assert.equal(reply.runner_checks, null);
      assert.ok(!("source_commit" in reply), "a checkout outside /opt/commissaire/<commit>/ reports no source commit");
    }
    const viaEnv = spawnSync(process.execPath, [COMMISSAIRE, "governor", "identify", "--json"], { encoding: "utf8", env: { ...process.env, COMMISSAIRE_KEY_DIR: g.dir } });
    assert.equal(viaEnv.status, 0, viaEnv.stderr);
    assert.equal(JSON.parse(viaEnv.stdout).ok, true);
  } finally { g.child.kill("SIGTERM"); await delay(100); }
});

test("identify --json from a caller with no role prints the refusal and exits 1; an absent socket exits 1 as unreachable", { skip: LINUX ? false : "needs linux + /usr/bin/python3 for the peer-credential guard" }, async () => {
  const g = startGovernor(process.getuid() + 1);
  try {
    await g.ready;
    const refused = spawnSync(process.execPath, [COMMISSAIRE, "governor", "identify", "--json", "--key-dir", g.dir], { encoding: "utf8" });
    assert.equal(refused.status, 1);
    assert.equal(JSON.parse(refused.stdout).reason, "caller-not-allowed");
  } finally { g.child.kill("SIGTERM"); await delay(100); }
  const gone = spawnSync(process.execPath, [COMMISSAIRE, "governor", "identify", "--json", "--socket", join(tmpdir(), "no-such-governor.sock")], { encoding: "utf8" });
  assert.equal(gone.status, 1);
  assert.equal(JSON.parse(gone.stdout).reason, "governor-unreachable");
});

test("identify is wired into dispatch, the required-flag table and usage", () => {
  const commissaire = require(join(LIB, "commissaire.js"));
  assert.equal(typeof commissaire.COMMISSAIRE_DISPATCH["governor identify"], "function");
  assert.deepEqual(commissaire.REQUIRED_FLAGS_BY_CANONICAL["governor identify"], []);
  const r = spawnSync(process.execPath, [COMMISSAIRE, "governor", "identify", "--bogus"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});
