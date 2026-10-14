// FAFF-1181 — the governor image in operations/fly/governor/, built and run locally with Docker. It covers
// the integration smoke steps: the entrypoint's refusals, the key file and directory modes on a fresh
// volume, the config replaced on every start, the listener address, `contract admit` over TCP from a
// second process, `identify` as root inside the container, and `identify` over TCP refused op-unix-only.
// A named Docker volume stands in for the Fly volume. Nothing leaves the host except the base image's apt
// fetch while building.
//
// SKIPS cleanly when Docker is not reachable or the node:20-slim base image is not already present
// locally (the test never pulls). Run it on any host with `docker pull node:20-slim`.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const producerAuth = require(join(REPO_ROOT, "plugin", "skills", "faff", "bin", "lib", "producer-auth.js"));
const BASE_IMAGE = "node:20-slim";
const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TAG = `commissaire-governor-test:${process.pid}`;
const PREFIX = `faff1181-${process.pid}`;
const DOCKERFILE = join(REPO_ROOT, "operations", "fly", "governor", "Dockerfile");
const BIN = "/opt/commissaire/current/bin/commissaire";
const PORT_HEX = "1DE2";

const docker = (args, opts = {}) => spawnSync("docker", args, { encoding: "utf8", timeout: opts.timeout ?? 120_000, input: opts.input });
function skipReason() {
  if (docker(["info"], { timeout: 20_000 }).status !== 0) return "docker daemon is not reachable";
  if (docker(["image", "inspect", BASE_IMAGE], { timeout: 20_000 }).status !== 0) return `docker image ${BASE_IMAGE} is not present locally (docker pull ${BASE_IMAGE})`;
  return false;
}
const SKIP = skipReason();

const wrap = (r) => ({ code: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() });
const ok = (r, label) => { assert.equal(r.code, 0, `${label}: ${r.err || r.out}`); return r.out; };
const volumes = new Set();
const newVolume = (label) => {
  const name = `${PREFIX}-${label}`;
  ok(wrap(docker(["volume", "create", name])), "volume create");
  volumes.add(name);
  return name;
};
const env = (vars) => Object.entries(vars).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
// A one-shot run of the real entrypoint; it must exit before it execs the governor.
const entrypoint = (volume, vars) => wrap(docker(["run", "--rm", ...(volume ? ["-v", `${volume}:/data`] : []), ...env(vars), TAG]));
// A root shell on the image, with the volume mounted, used to craft or inspect volume states.
const rootShell = (volume, script) => wrap(docker(["run", "--rm", "--entrypoint", "sh", "-v", `${volume}:/data`, TAG, "-c", script]));
const imageShell = (script) => wrap(docker(["run", "--rm", "--entrypoint", "sh", TAG, "-c", script]));

describe("the governor image on a local volume", { skip: SKIP }, () => {
  let ipv6 = false;

  before(() => {
    const built = docker(["build", "-q", "-f", DOCKERFILE, "--build-arg", `SOURCE_COMMIT=${SOURCE_COMMIT}`, "-t", TAG, REPO_ROOT], { timeout: 600_000 });
    ok(wrap(built), "docker build");
    ipv6 = docker(["run", "--rm", "--sysctl", "net.ipv6.conf.all.disable_ipv6=0", "--entrypoint", "node", TAG, "-e", "require('net').createServer().listen(0,'::1',function(){this.close()}).on('error',()=>process.exit(1))"]).status === 0;
  });

  after(() => {
    docker(["rm", "-f", `${PREFIX}-gov`], { timeout: 60_000 });
    for (const v of volumes) docker(["volume", "rm", "-f", v], { timeout: 60_000 });
    docker(["rmi", "-f", TAG], { timeout: 60_000 });
  });

  test("the build refuses a missing or malformed SOURCE_COMMIT", () => {
    for (const arg of [[], ["--build-arg", "SOURCE_COMMIT=latest"]]) {
      const r = wrap(docker(["build", "-q", "-f", DOCKERFILE, ...arg, "-t", `${TAG}-bad`, REPO_ROOT], { timeout: 600_000 }));
      assert.notEqual(r.code, 0, arg.join(" "));
      assert.match(r.err, /SOURCE_COMMIT/);
    }
  });

  test("the image records its source commit and runs from a root-owned, read-only code tree", () => {
    assert.equal(ok(wrap(docker(["image", "inspect", TAG, "--format", '{{ index .Config.Labels "org.opencontainers.image.revision" }}'])), "label"), SOURCE_COMMIT);
    assert.equal(ok(imageShell("id -u commissaire"), "uid"), "10001");
    const tree = `/opt/commissaire/${SOURCE_COMMIT}`;
    assert.equal(ok(imageShell(`stat -c '%U:%G' ${tree} ${tree}/plugin/skills/faff/bin/commissaire`), "owner"), "root:root\nroot:root");
    assert.equal(ok(imageShell("find /opt/commissaire ! -type l -perm /022 -print"), "writable"), "", "nothing in the tree is group- or world-writable");
    assert.equal(ok(imageShell("find /opt/commissaire ! -type l ! -user root -print"), "owners"), "");
    assert.equal(ok(imageShell("readlink /opt/commissaire/current"), "link"), `${tree}/plugin/skills/faff`);
    const write = imageShell(`setpriv --reuid=commissaire --regid=commissaire --clear-groups sh -c 'touch ${tree}/x 2>&1; touch ${tree}/plugin/skills/faff/bin/lib/x 2>&1'`);
    assert.match(write.out + write.err, /Permission denied/);
    assert.equal(ok(imageShell(`test -x ${BIN} && echo yes`), "binary"), "yes");
  });

  test("the entrypoint exits 1 naming GOVERNOR_ALLOW_DNS when it is unset or empty", () => {
    const volume = newVolume("noallow");
    for (const vars of [{}, { GOVERNOR_ALLOW_DNS: "" }]) {
      const r = entrypoint(volume, vars);
      assert.equal(r.code, 1);
      assert.match(r.err, /GOVERNOR_ALLOW_DNS must name the runner app/);
    }
  });

  test("the entrypoint exits 1 without a volume at /data and on characters outside [A-Za-z0-9.:_-]", () => {
    const none = entrypoint(null, { GOVERNOR_ALLOW_DNS: "runner.internal" });
    assert.equal(none.code, 1);
    assert.match(none.err, /no volume at \/data/);
    const volume = newVolume("badchars");
    for (const [vars, name] of [
      [{ GOVERNOR_ALLOW_DNS: "runner.internal; rm -rf /" }, "GOVERNOR_ALLOW_DNS"],
      [{ GOVERNOR_ALLOW_DNS: "runner.internal", GOVERNOR_LISTEN: "fly-local-6pn:7650 --listen-unrestricted" }, "GOVERNOR_LISTEN"],
      [{ GOVERNOR_ALLOW_DNS: "$(id)" }, "GOVERNOR_ALLOW_DNS"],
    ]) {
      const r = entrypoint(volume, vars);
      assert.equal(r.code, 1, JSON.stringify(vars));
      assert.match(r.err, new RegExp(`${name} has characters outside`));
    }
  });

  test("the entrypoint refuses a key directory that is a symlink, has another mode, or holds an entry owned by someone else", () => {
    const vars = { GOVERNOR_ALLOW_DNS: "runner.internal" };
    const cases = [
      ["symlink", "mkdir /data/elsewhere && ln -s /data/elsewhere /data/commissaire", /\/data\/commissaire is a symlink/],
      ["mode", "install -d -o commissaire -g commissaire -m 0750 /data/commissaire", /not mode 0700/],
      ["owner", "install -d -o root -g root -m 0700 /data/commissaire", /not owned by commissaire/],
      ["stranger", "install -d -o commissaire -g commissaire -m 0700 /data/commissaire && touch /data/commissaire/stray && chown root /data/commissaire/stray", /\/data\/commissaire\/stray is not owned by commissaire/],
    ];
    for (const [label, craft, expected] of cases) {
      const volume = newVolume(`dir-${label}`);
      ok(rootShell(volume, craft), `craft ${label}`);
      const r = entrypoint(volume, vars);
      assert.equal(r.code, 1, label);
      assert.match(r.err, expected, label);
    }
  });

  describe("a running governor on a fresh volume", () => {
    const NAME = `${PREFIX}-gov`;
    let volume;
    let key;
    const exec = (...argv) => wrap(docker(["exec", NAME, ...argv]));
    const execShell = (script) => exec("sh", "-c", script);
    const logLines = () => ok(execShell("cat /data/commissaire/governor-log.jsonl"), "log").split("\n").filter(Boolean).map((l) => JSON.parse(l));

    before(async (t) => {
      if (!ipv6) return t.skip("the container has no IPv6 loopback to bind");
      volume = newVolume("main");
      ok(wrap(docker(["run", "-d", "--name", NAME, "--sysctl", "net.ipv6.conf.all.disable_ipv6=0", "-v", `${volume}:/data`, ...env({ GOVERNOR_LISTEN: "::1:7650", GOVERNOR_ALLOW_DNS: "::1" }), TAG])), "start governor");
      for (let i = 0; i < 100; i++) {
        if (docker(["logs", NAME]).stdout.includes('"tcp"')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const logs = docker(["logs", NAME]);
      assert.match(logs.stdout, /"listening":\{"tcp":"::1:7650"\}/, `${logs.stdout}${logs.stderr}`);
      key = JSON.parse(ok(exec("cat", "/data/commissaire/governor-key.json"), "key file"));
    });

    test("the key file is mode 0600 owned by commissaire in a 0700 directory, and the governor runs as that user", () => {
      assert.equal(ok(execShell("stat -c '%a %U' /data/commissaire /data/commissaire/governor-key.json /data/commissaire/governor-config.json"), "stat"), "700 commissaire\n600 commissaire\n600 commissaire");
      assert.match(ok(exec("grep", "Uid", "/proc/1/status"), "uid"), /10001\s+10001\s+10001\s+10001/);
    });

    test("the image's governor-config.json replaces the volume copy on every start", () => {
      const wanted = { admin_uids: [0], allow_uids: [] };
      assert.deepEqual(JSON.parse(ok(exec("cat", "/data/commissaire/governor-config.json"), "config")), wanted);
      ok(execShell("printf '%s' '{\"admin_uids\":[0],\"allow_uids\":[1000]}' > /data/commissaire/governor-config.json"), "tamper");
      ok(wrap(docker(["restart", "-t", "2", NAME])), "restart");
      assert.deepEqual(JSON.parse(ok(exec("cat", "/data/commissaire/governor-config.json"), "config after restart")), wanted);
    });

    test("the governor listens only on the one address it was given", () => {
      const tcp6 = ok(exec("cat", "/proc/net/tcp6"), "tcp6").split("\n").slice(1).map((l) => l.trim().split(/\s+/));
      const listening = tcp6.filter((f) => f[3] === "0A").map((f) => f[1]);
      assert.deepEqual(listening, [`00000000000000000000000001000000:${PORT_HEX}`]);
      const tcp4 = ok(exec("cat", "/proc/net/tcp"), "tcp").split("\n").slice(1).map((l) => l.trim().split(/\s+/));
      assert.deepEqual(tcp4.filter((f) => f[3] === "0A"), []);
    });

    test("a second process in the container admits a run over TCP and gets custody governor", () => {
      ok(execShell("mkdir -p /tmp/run"), "run dir");
      const out = ok(execShell(`COMMISSAIRE_GOVERNOR=::1:7650 ${BIN} contract admit --run-dir /tmp/run --producer P --contract-revision r1`), "admit");
      const reply = JSON.parse(out);
      assert.equal(reply.admitted, true);
      assert.equal(reply.custody, "governor");
      assert.equal(reply.pk_fingerprint, key.pk_fingerprint);
      assert.ok(logLines().some((l) => l.op === "admit"), "the governor's log on the volume shows the admit");
    });

    test("identify as root matches the key file, and its fingerprint is the SHA-256 of the SPKI-DER public key", () => {
      const reply = JSON.parse(ok(exec(BIN, "governor", "identify", "--json"), "identify"));
      assert.equal(reply.ok, true);
      assert.equal(reply.pk, key.pk);
      assert.equal(reply.pk_fingerprint, key.pk_fingerprint);
      assert.equal(producerAuth.pkFingerprint(reply.pk), reply.pk_fingerprint);
      assert.equal(reply.key_file, "/data/commissaire/governor-key.json");
      assert.equal(reply.source_commit, SOURCE_COMMIT, "the reply names the commit the code tree was installed from");
    });

    test("identify over TCP is refused op-unix-only", () => {
      const out = ok(exec("node", "-e", `const c=require("net").connect(7650,"::1",()=>c.write('{"op":"identify"}\\n'));c.on("data",d=>{process.stdout.write(String(d));c.destroy()})`), "tcp identify");
      assert.deepEqual(JSON.parse(out), { ok: false, reason: "op-unix-only" });
    });

    test("the signing key never appears in the container's logs, environment or the image history", () => {
      const sk = key.sk;
      assert.ok(sk.length > 20);
      const haystacks = [docker(["logs", NAME]), docker(["inspect", NAME]), docker(["history", "--no-trunc", TAG])].map((r) => r.stdout + r.stderr);
      for (const h of haystacks) assert.ok(!h.includes(sk));
      assert.ok(!JSON.stringify(logLines()).includes(sk));
    });
  });
});
