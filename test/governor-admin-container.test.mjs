// FAFF-1217 — `commissaire governor pin|status` against a real governor running as a second OS user, in a
// Linux container (node:20 with useradd and runuser, the FAFF-1109 precedent). Three users are made with
// useradd (governor, runner, human) and the governor's key directory, config and socket directory are built
// by hand to FAFF-1216's documented modes and owners; `governor install` is never run. Root exists only
// inside the container. gh is a stub and the "GitHub" origin is a bare repository inside the container, so
// no real PR is opened and nothing leaves it.
//
// SKIPS cleanly when Docker is not reachable or the node:20 image is not already present locally (the
// test never pulls). Run it on any host with `docker pull node:20`.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ghStubScript } from "./helpers/governor-admin-world.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE = "node:20";
const NAME = `faff1217-${process.pid}`;
const SOCK = "/var/lib/govsock/governor.sock";
const RELAY_SOCK = "/tmp/relay/relay.sock";
const COMMISSAIRE = "/opt/installer/bin/commissaire";
const SSH_SHIM = "#!/bin/sh\nfor last; do :; done\ncd /srv && exec sh -c \"$last\"\n";
const RELAY = `const net = require("net");
net.createServer((c) => { const u = net.connect(${JSON.stringify(SOCK)}); c.pipe(u); u.pipe(c); c.on("error", () => u.destroy()); u.on("error", () => c.destroy()); }).listen(${JSON.stringify(RELAY_SOCK)}, () => require("fs").chmodSync(${JSON.stringify(RELAY_SOCK)}, 0o666));
`;
const PEER_PROBE = `const c = require("/opt/installer/bin/lib/commissaire-governor-client.js");
console.log(JSON.stringify(c.governorRequestWithPeer({ kind: "unix", socket_path: process.argv[2] }, { op: "identify" }, { connect_ms: 3000, reply_ms: 10000 })));
`;

const docker = (args, opts = {}) => spawnSync("docker", args, { encoding: "utf8", timeout: opts.timeout ?? 120_000, input: opts.input });
function skipReason() {
  if (docker(["info"], { timeout: 20_000 }).status !== 0) return "docker daemon is not reachable";
  if (docker(["image", "inspect", IMAGE], { timeout: 20_000 }).status !== 0) return `docker image ${IMAGE} is not present locally (docker pull ${IMAGE})`;
  return false;
}
const SKIP = skipReason();

const wrap = (r) => ({ code: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() });
const dx = (...argv) => wrap(docker(["exec", NAME, ...argv], { timeout: 180_000 }));
const sh = (script) => dx("bash", "-c", script);
const ok = (r, label) => { assert.equal(r.code, 0, `${label}: ${r.err || r.out}`); return r.out; };
const ENV = "GIT_SSH_COMMAND=/usr/local/bin/fakessh GIT_CONFIG_GLOBAL=/dev/null";
const asUser = (user, script) => sh(`cd /home/${user}/proj 2>/dev/null || cd /tmp; runuser -u ${user} -- env ${ENV} bash -c '${script.replace(/'/g, "'\\''")}'`);
const pinAs = (user, extra = "", sock = SOCK) => asUser(user, `node ${COMMISSAIRE} governor pin --socket ${sock} --runner-user runner --repo acme/widgets ${extra}`);
const statusAs = (user, extra = "") => asUser(user, `node ${COMMISSAIRE} governor status --socket ${SOCK} --runner-user runner --runner-login runner-bot ${extra}`);
const setGh = (cfg) => ok(sh(`cat > /srv/gh-config.json <<'EOF'\n${JSON.stringify({ defaultBranch: "main", rules: [{ type: "pull_request" }], trustMode: "absent", human: "human-login", bare: "/srv/acme/widgets.git", prUrl: "https://github.com/acme/widgets/pull/7", ...cfg })}\nEOF`), "gh config");
const bareShow = (ref, file) => ok(sh(`git -c safe.directory='*' -C /srv/acme/widgets.git show ${ref}:${file}`), `show ${ref}`);

describe("governor pin and status against a governor on a second OS user", { skip: SKIP }, () => {
  let uid = {};
  let fingerprint;

  before(() => {
    ok(wrap(docker(["run", "-d", "--name", NAME, "-v", `${join(REPO_ROOT, "plugin", "skills", "faff")}:/src-faff:ro`, IMAGE, "sleep", "7200"])), "start container");
    ok(sh(`set -e
useradd -r -d /var/lib/gov -M -s /usr/sbin/nologin gov
useradd -m runner; useradd -m human
groupadd -r commissaire-clients; usermod -aG commissaire-clients runner; usermod -aG commissaire-clients human
mkdir -p /var/lib/gov /var/lib/govsock /opt/installer
chown gov:gov /var/lib/gov; chmod 700 /var/lib/gov
chown gov:commissaire-clients /var/lib/govsock; chmod 2750 /var/lib/govsock
tar -C /src-faff --exclude=node_modules -cf - . | tar -C /opt/installer --no-same-owner -xf -
chown -R root:root /opt/installer; chmod -R go-w /opt/installer
printf '%s' '${SSH_SHIM.replace(/\n/g, "\\n")}' | sed 's/\\\\n/\\n/g' > /usr/local/bin/fakessh
chmod 755 /usr/local/bin/fakessh
cat > /usr/local/bin/gh <<'GHSTUB'
${ghStubScript("/srv/gh-config.json", "/srv/gh.log")}GHSTUB
chmod 755 /usr/local/bin/gh
mkdir -p /srv/acme; git init -q --bare -b main /srv/acme/widgets.git; touch /srv/gh.log; chown -R human /srv
`), "container setup");
    uid = { gov: Number(ok(sh("id -u gov"), "uid")), runner: Number(ok(sh("id -u runner"), "uid")), human: Number(ok(sh("id -u human"), "uid")) };
    const rc = { schema: 1, runner_user: "runner", runner_uid: uid.runner, platform: "linux", socket_group: "commissaire-clients", docker_group: false, sudo_rules: false, sudo_absent: true, admin_group: null, independent: true, checked_at: new Date().toISOString(), install_version: "0.0.0-test", source_tag: "faff--v0.0.0" };
    const config = JSON.stringify({ allow_uids: [uid.runner], admin_uids: [uid.human], runner_checks: rc });
    ok(sh(`printf '%s' '${config}' > /var/lib/gov/governor-config.json && chown gov:gov /var/lib/gov/governor-config.json && chmod 600 /var/lib/gov/governor-config.json`), "governor config");
    ok(sh(`setsid -f runuser -u gov -- /usr/local/bin/node ${COMMISSAIRE} governor start --key-dir /var/lib/gov --socket ${SOCK} --socket-group-access >/var/log/gov.out 2>&1 </dev/null
for i in $(seq 1 50); do grep -q listening /var/log/gov.out && exit 0; sleep 0.2; done; cat /var/log/gov.out; exit 1`), "start governor");
    fingerprint = JSON.parse(ok(sh("cat /var/lib/gov/governor-key.json"), "key")).pk_fingerprint;
    ok(sh(`set -e
runuser -u human -- env ${ENV} bash -c 'umask 022 && mkdir -p /home/human/proj && cd /home/human/proj && git init -q -b main && git config user.name "Test Human" && git config user.email human@example.invalid && echo hi > README.md && git add -A && git commit -q -m init && git remote add origin git@github.com:acme/widgets.git && git push -q origin main'
`), "human clone");
    setGh({});
  });

  after(() => { docker(["rm", "-f", NAME], { timeout: 60_000 }); });

  test("the client reads the governor's kernel uid, which differs from the caller's", () => {
    ok(sh(`cat > /tmp/probe.js <<'EOF'\n${PEER_PROBE}EOF`), "probe");
    const res = JSON.parse(ok(asUser("human", `node /tmp/probe.js ${SOCK}`), "peer probe"));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.peer_uid, uid.gov);
    assert.notEqual(res.peer_uid, uid.human, "a client that reported its own credentials would fail here");
    assert.equal(res.reply.pk_fingerprint, fingerprint);
    assert.equal(res.reply.key_file, "/var/lib/gov/governor-key.json");
    assert.equal(res.reply.runner_checks.runner_uid, uid.runner);
  });

  test("status before the pin: governor uid, host_checks and install passed, conditions met, pinned_on_base no, not ready", () => {
    const r = statusAs("human");
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(r.out);
    assert.deepEqual([s.custody, s.transport, s.socket, s.governor_uid, s.host_checks, s.install_result], ["governor", "unix", "answers", uid.gov, "passed", "passed"]);
    assert.deepEqual(Object.values(s.counting).map((c) => c.state), ["met", "met", "met"]);
    assert.equal(s.pinned_on_base, "no");
    assert.equal(s.ready_to_count, false);
    assert.equal(s.pk_fingerprint, fingerprint);
  });

  test("pin as the runner is refused invoked-as-runner; a relay owned by the runner is refused governor-same-user", () => {
    const asRunner = pinAs("runner");
    assert.equal(asRunner.code, 1);
    assert.equal(JSON.parse(asRunner.out).reason, "invoked-as-runner");
    ok(sh(`mkdir -p /tmp/relay && chown runner /tmp/relay && printf '%s' '${RELAY.replace(/'/g, "'\\''")}' > /tmp/relay/relay.js && chown runner /tmp/relay/relay.js
setsid -f runuser -u runner -- /usr/local/bin/node /tmp/relay/relay.js >/tmp/relay/out 2>&1 </dev/null
for i in $(seq 1 50); do [ -S ${RELAY_SOCK} ] && exit 0; sleep 0.2; done; cat /tmp/relay/out; exit 1`), "start relay");
    const viaRelay = pinAs("human", "", RELAY_SOCK);
    assert.equal(viaRelay.code, 1, viaRelay.err);
    assert.equal(JSON.parse(viaRelay.out).reason, "governor-same-user");
    const dry = pinAs("human", "--dry-run");
    assert.equal(JSON.parse(dry.out).pinned, "dry-run", dry.out + dry.err);
  });

  test("pin as the human opens a PR through the real socket, the stub gh records it, and the branch carries the fingerprint", () => {
    const r = pinAs("human");
    assert.equal(r.code, 0, `${r.out} ${r.err}`);
    const result = JSON.parse(r.out);
    assert.equal(result.pinned, "opened-pr");
    assert.equal(result.pk_fingerprint, fingerprint);
    const branch = `commissaire/pin-${fingerprint.slice(0, 12)}`;
    assert.equal(result.branch, branch);
    const file = bareShow(branch, ".commissaire/trust.toml");
    assert.match(file, new RegExp(`governor_key_fingerprints = \\[\\n  "${fingerprint}",  # [A-Za-z0-9.-]+ governor uid ${uid.gov}, pinned \\d{4}-\\d{2}-\\d{2}\\n\\]`));
    const calls = ok(sh("cat /srv/gh.log"), "gh log").split("\n").map((l) => JSON.parse(l));
    const create = calls.find((c) => c[0] === "pr" && c[1] === "create");
    assert.ok(create, "gh pr create was called");
    const body = create[create.indexOf("--body") + 1];
    assert.ok(body.includes("A human must approve this PR"));
    assert.ok(body.includes(`governor process uid: ${uid.gov}`));
    assert.ok(body.includes(`runner user: runner (uid ${uid.runner})`));
    assert.ok(body.includes("key directory: /var/lib/gov, owner uid " + uid.gov + ", mode 0700"));
    const sha = ok(sh(`git -c safe.directory='*' -C /srv/acme/widgets.git rev-parse refs/heads/${branch}`), "rev-parse");
    assert.ok(body.includes(`Pushed commit: \`${sha}\``), "the body names the pushed commit");
    assert.ok(calls.some((c) => c[0] === "pr" && c[1] === "view"), "the PR head was read back");
    assert.ok(!calls.some((c) => c[0] === "pr" && c[1] === "merge"), "pin never merges");
    assert.match(ok(sh(`git -c safe.directory='*' -C /srv/acme/widgets.git log -1 --format=%B ${branch}`), "log"), /Signed-off-by: Test Human <human@example\.invalid>/);
  });

  test("once the pin is merged, status reports the governor ready to count", () => {
    const branch = `commissaire/pin-${fingerprint.slice(0, 12)}`;
    const trust = bareShow(branch, ".commissaire/trust.toml");
    ok(sh(`cd /srv/acme/widgets.git && git -c safe.directory='*' update-ref refs/heads/main ${branch}`), "merge the pin");
    setGh({ trustMode: "present", trustToml: trust });
    const s = JSON.parse(ok(statusAs("human"), "status"));
    assert.equal(s.pinned_on_base, "yes");
    assert.equal(s.ready_to_count, true);
    const again = pinAs("human");
    assert.equal(JSON.parse(again.out).pinned, "already-pinned");
    assert.equal(again.code, 0);
  });

  test("a runner-owned clone is refused repo-runner-writable by the real predicate, with no git command run", () => {
    ok(sh("mkdir -p /home/runner/clone/.git && chown -R runner /home/runner/clone && chmod 755 /home/runner"), "runner clone");
    const r = sh(`cd /home/runner/clone && runuser -u human -- env ${ENV} node ${COMMISSAIRE} governor pin --socket ${SOCK} --runner-user runner --repo acme/widgets`);
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(JSON.parse(r.out).reason, "repo-runner-writable");
  });
});
