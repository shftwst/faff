// FAFF-1216 — the real install, in a Linux container (node:20 + useradd + runuser, per the FAFF-1109
// spike). Root exists only inside the container; nothing here touches the host. The one thing faked is
// systemd: a `systemctl` shim starts and stops the governor from the unit's ExecStart under the
// `commissaire` account, so the unit text, the install copy and the account are all exercised for real.
//
// SKIPS cleanly when Docker is not reachable or the node:20 image is not already present locally (the
// test never pulls). Run it on any host with `docker pull node:20`.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE = "node:20";
const NAME = `faff1216-${process.pid}`;
const SOCK = "/var/lib/commissaire-socket/governor.sock";
const TAGS = ["faff--v9.9.1", "faff--v9.9.2", "faff--v9.9.3"];

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
const asUser = (user, ...argv) => dx("runuser", "-u", user, "--", ...argv);
const ok = (r, label) => { assert.equal(r.code, 0, `${label}: ${r.err || r.out}`); return r.out; };

const SYSTEMCTL_SHIM = `#!/bin/sh
UNIT=/etc/systemd/system/commissaire-governor.service
echo "$@" >> /var/log/systemctl-shim.log
stop() { pkill -f "bin/commissaire governor start" || true; for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "bin/commissaire governor start" >/dev/null || return 0; sleep 0.2; done; }
start() {
  stop
  CMD=$(sed -n 's/^ExecStart=//p' $UNIT)
  setsid -f runuser -u commissaire -- $CMD >/var/log/governor.out 2>&1 </dev/null
}
case "$1" in
  daemon-reload) exit 0 ;;
  enable) [ "$2" = "--now" ] && start; exit 0 ;;
  restart) start; exit 0 ;;
  disable) [ "$2" = "--now" ] && stop; exit 0 ;;
  is-active) pgrep -f "bin/commissaire governor start" >/dev/null; exit $? ;;
esac
exit 0
`;

const DRIVER = `const install = require("/opt/installer/bin/lib/governor-install.js");
const [verb, flags] = [process.argv[2], JSON.parse(process.argv[3])];
const code = verb === "install"
  ? install.governorInstall(flags, { releaseRepoUrl: "file:///srv/repo.git" })
  : install.governorUninstall(flags);
process.exit(code);
`;

const CONNECT = `const net = require("net");
const c = net.connect(process.argv[1]);
let buf = "";
c.on("connect", () => c.write(process.argv[2] + "\\n"));
c.on("data", (d) => { buf += d; });
c.on("close", () => console.log(buf.trim()));
c.on("error", (e) => console.log(JSON.stringify({ connect_error: e.code })));
`;

function install(tag, extra = {}, env = "SUDO_USER=hal") {
  const flags = JSON.stringify({ "--runner-user": "alice", "--from-tag": tag, "--json": true, ...extra });
  const r = sh(`${env} node /root/driver.js install '${flags}'`);
  return { ...r, result: r.out.startsWith("{") ? JSON.parse(r.out) : null };
}
const uninstall = (extra = {}) => sh(`node /root/driver.js uninstall '${JSON.stringify({ "--json": true, ...extra })}'`);
const stat = (path) => sh(`stat -c '%U:%G %a' ${path}`).out;
const readJson = (path) => JSON.parse(ok(sh(`cat ${path}`), path));
const connect = (user, payload) => {
  const r = asUser(user, "node", "-e", CONNECT, SOCK, JSON.stringify(payload));
  return JSON.parse(ok(r, `${user} connect`));
};
const logLines = () => ok(sh("cat /var/lib/commissaire/governor-log.jsonl 2>/dev/null || true"), "log").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const treeHash = (dir) => ok(sh(`cd ${dir} && find . -type f | sort | xargs sha256sum | sha256sum`), "tree hash");
const without = (o, key) => { const c = structuredClone(o); delete c.runner_checks[key]; return c; };

describe("governor install in a Linux container", { skip: SKIP }, () => {
  let uid = {};
  let first;

  before(() => {
    ok(wrap(docker(["run", "-d", "--name", NAME, "-v", `${join(REPO, "plugin", "skills", "faff")}:/src-faff:ro`, IMAGE, "sleep", "7200"])), "start container");
    ok(sh(`set -e
useradd -m alice; useradd -m hal; useradd -m mallory
mkdir -p /opt/installer /work/plugin/skills/faff /etc/systemd/system
tar -C /src-faff --exclude=node_modules -cf - . | tar -C /opt/installer --no-same-owner -xf -
tar -C /src-faff --exclude=node_modules -cf - . | tar -C /work/plugin/skills/faff --no-same-owner -xf -
chown -R root:root /opt/installer; chmod -R go-w /opt/installer
git config --global user.email t@example.invalid; git config --global user.name t
cd /work; git init -q -b main; git add -A; git commit -q -m v1; git tag ${TAGS[0]}
echo "# 9.9.2" >> plugin/skills/faff/bin/lib/peer-cred-helper.py; git commit -qam v2; git tag ${TAGS[1]}
echo "# 9.9.3" >> plugin/skills/faff/bin/lib/peer-cred-helper.py; git commit -qam v3; git tag ${TAGS[2]}
git clone -q --bare /work /srv/repo.git
cat > /usr/sbin/systemctl <<'SHIM'
${SYSTEMCTL_SHIM}SHIM
chmod 755 /usr/sbin/systemctl
cat > /root/driver.js <<'DRV'
${DRIVER}DRV
`), "container setup");
    uid = { alice: Number(ok(sh("id -u alice"), "uid")), hal: Number(ok(sh("id -u hal"), "uid")), mallory: Number(ok(sh("id -u mallory"), "uid")) };
  });

  after(() => { docker(["rm", "-f", NAME], { timeout: 60_000 }); });

  test("install: account, directories, config, group, unit and install copy are what the spec says", () => {
    first = install(TAGS[0]);
    assert.equal(first.code, 0, first.err || first.out);
    const r = first.result;
    const version = r.install_copy.version;

    const passwd = ok(sh("getent passwd commissaire"), "account").split(":");
    assert.equal(passwd[6], "/usr/sbin/nologin");
    assert.equal(passwd[5], "/var/lib/commissaire");
    assert.ok(Number(passwd[2]) < 1000, "a system-range uid");
    assert.equal(stat("/var/lib/commissaire"), "commissaire:commissaire 700");
    assert.equal(stat("/var/lib/commissaire/governor-config.json"), "commissaire:commissaire 600");
    assert.equal(stat("/var/lib/commissaire/governor-key.json"), "commissaire:commissaire 600", "the governor minted its own key");
    assert.equal(stat("/var/lib/commissaire-socket"), "commissaire:commissaire-clients 2750");
    assert.equal(ok(sh(`stat -c %a ${SOCK}`), "socket mode"), "660");

    const config = readJson("/var/lib/commissaire/governor-config.json");
    assert.deepEqual(config.allow_uids, [uid.alice]);
    assert.deepEqual(config.admin_uids, [uid.hal]);
    assert.deepEqual(
      { ...config.runner_checks, checked_at: "-", install_version: "-" },
      { schema: 1, runner_user: "alice", runner_uid: uid.alice, platform: "linux", socket_group: "commissaire-clients", docker_group: false, sudo_rules: false, sudo_absent: true, admin_group: null, independent: true, checked_at: "-", install_version: "-", source_tag: TAGS[0] },
    );
    assert.equal(config.runner_checks.install_version, version);
    assert.deepEqual(r.runner_checks, config.runner_checks);

    const group = ok(sh("getent group commissaire-clients"), "group").split(":");
    assert.ok(Number(group[2]) < 1000, "a system group");
    assert.deepEqual(group[3].split(",").sort(), ["alice", "hal"]);

    const unit = ok(sh("cat /etc/systemd/system/commissaire-governor.service"), "unit");
    assert.match(unit, new RegExp(`^ExecStart=/usr/local/bin/node /opt/commissaire/${version}/bin/commissaire governor start --key-dir /var/lib/commissaire --socket ${SOCK} --socket-group-access$`, "m"));
    assert.match(unit, /^ReadWritePaths=\/var\/lib\/commissaire-socket$/m);
    assert.equal(stat("/etc/systemd/system/commissaire-governor.service"), "root:root 644");
    assert.match(ok(sh("cat /var/log/systemctl-shim.log"), "shim log"), /daemon-reload\nenable --now commissaire-governor\.service/);

    assert.equal(stat(`/opt/commissaire/${version}`), "root:root 755");
    assert.equal(stat(`/opt/commissaire/${version}/bin/commissaire`), "root:root 755");
    assert.equal(stat(`/opt/commissaire/${version}/bin/lib/peer-cred-helper.py`), "root:root 644");
    const manifest = readJson(`/opt/commissaire/${version}/install-manifest.json`);
    assert.equal(manifest.source_tag, TAGS[0]);
    assert.equal(manifest.source_commit, r.install_copy.source_commit);
    assert.equal(r.install_copy.source_commit, ok(sh(`git -C /work rev-parse ${TAGS[0]}`), "commit"));
    assert.equal(ok(sh("ls /root | grep -c commissaire-release || true"), "clone left"), "0", "the release clone is removed");

    assert.equal(r.pk_fingerprint, readJson("/var/lib/commissaire/governor-key.json").pk_fingerprint);
    assert.deepEqual(r.allow_uids, [uid.alice]);
    assert.deepEqual(r.admin_uids, [uid.hal]);
    assert.equal(r.next_steps.length, 3);
    assert.ok(r.next_steps[2].includes(`/opt/commissaire/${version}/bin/commissaire governor pin --socket ${SOCK} --runner-user alice --repo <OWNER/NAME>`));
  });

  test("the runner completes an admit over the socket from the install copy, and the payload carries runner_checks", () => {
    const version = first.result.install_copy.version;
    ok(asUser("alice", "mkdir", "-p", "/home/alice/proj/.faff/runs/RUN-1"), "mkdir run dir");
    const admit = asUser("alice", "env", `COMMISSAIRE_GOVERNOR=${SOCK}`, "/usr/local/bin/node", `/opt/commissaire/${version}/bin/commissaire`,
      "contract", "admit", "--run-dir", "/home/alice/proj/.faff/runs/RUN-1", "--producer", "P1", "--contract-revision", "faff-runner-v1", "--scope", "merge");
    assert.equal(admit.code, 0, admit.err || admit.out);
    assert.equal(JSON.parse(admit.out).custody, "governor");
    const record = JSON.parse(ok(sh("head -n1 /home/alice/proj/.faff/runs/RUN-1/declared-effects.jsonl"), "ledger"));
    assert.deepEqual(record.payload.runner_checks, readJson("/var/lib/commissaire/governor-config.json").runner_checks);
    assert.equal(record.payload.custody, "governor");
  });

  test("the admin is refused admit with op-not-permitted-for-admin, logged with its uid and role; identify passes the role check", () => {
    const before = logLines().length;
    const refused = connect("hal", { op: "admit", run_id: "RUN-HAL", producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge"] });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "op-not-permitted-for-admin");
    const lines = logLines();
    assert.equal(lines.length, before + 1);
    const line = lines.at(-1);
    assert.deepEqual([line.op, line.peer_uid, line.caller_role, line.refusal], ["admit", uid.hal, "admin", "op-not-permitted-for-admin"]);
    assert.equal(line.signed_record, undefined, "nothing was signed");
    const identify = connect("hal", { op: "identify" });
    assert.notEqual(identify.reason, "op-not-permitted-for-admin");
    assert.equal(identify.ok, true);
    assert.equal(identify.key_file, "/var/lib/commissaire/governor-key.json");
  });

  test("a user outside commissaire-clients cannot connect (EACCES, no log line); added by hand she is refused caller-not-allowed with her uid logged", () => {
    const before = logLines().length;
    assert.deepEqual(connect("mallory", { op: "admit" }), { connect_error: "EACCES" });
    assert.equal(logLines().length, before, "the governor never saw the connection");

    ok(sh("gpasswd -a mallory commissaire-clients"), "add mallory");
    try {
      const refused = connect("mallory", { op: "admit", run_id: "RUN-M", producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge"] });
      assert.equal(refused.reason, "caller-not-allowed");
      assert.deepEqual(refused.peer, { uid: uid.mallory });
      const line = logLines().at(-1);
      assert.deepEqual([line.op, line.peer_uid, line.refusal], ["connect", uid.mallory, "caller-not-allowed"]);
    } finally {
      ok(sh("gpasswd -d mallory commissaire-clients"), "remove mallory");
    }
  });

  test("re-running install with the same flags converges: config, unit, group and install copy are unchanged and the key is never touched", () => {
    const version = first.result.install_copy.version;
    const snap = () => ({
      config: without(readJson("/var/lib/commissaire/governor-config.json"), "checked_at"),
      unit: ok(sh("cat /etc/systemd/system/commissaire-governor.service"), "unit"),
      group: ok(sh("getent group commissaire-clients"), "group"),
      copy: treeHash(`/opt/commissaire/${version}`),
      key: ok(sh("sha256sum /var/lib/commissaire/governor-key.json"), "key"),
      keyStat: ok(sh("stat -c '%i %Y' /var/lib/commissaire/governor-key.json"), "key stat"),
    });
    const before = snap();
    const again = install(TAGS[0]);
    assert.equal(again.code, 0, again.err || again.out);
    assert.deepEqual(snap(), before);
    assert.equal(again.result.pk_fingerprint, first.result.pk_fingerprint);
    assert.match(ok(sh("cat /var/log/systemctl-shim.log"), "shim"), /enable commissaire-governor\.service\nrestart commissaire-governor\.service/, "an existing service is restarted");
  });

  test("installing tags A, B and C in turn keeps only the current and previous install copies", () => {
    const versions = [first.result.install_copy.version];
    for (const tag of TAGS.slice(1)) {
      const r = install(tag);
      assert.equal(r.code, 0, r.err || r.out);
      versions.push(r.result.install_copy.version);
      assert.equal(r.result.runner_checks.source_tag, tag);
    }
    assert.equal(new Set(versions).size, 3, "each tag lands in its own version directory");
    assert.deepEqual(ok(sh("ls /opt/commissaire"), "ls").split("\n").sort(), [versions[1], versions[2]].sort());
    assert.match(ok(sh("pgrep -af 'bin/commissaire governor start'"), "pgrep"), new RegExp(versions[2]), "the service now runs from the newest copy");
  });

  test("the runner is still served after the upgrade, from the new copy", () => {
    const version = ok(sh("ls -t /opt/commissaire | head -n1"), "newest");
    ok(asUser("alice", "mkdir", "-p", "/home/alice/proj/.faff/runs/RUN-2"), "mkdir");
    const admit = asUser("alice", "env", `COMMISSAIRE_GOVERNOR=${SOCK}`, "/usr/local/bin/node", `/opt/commissaire/${version}/bin/commissaire`,
      "contract", "admit", "--run-dir", "/home/alice/proj/.faff/runs/RUN-2", "--producer", "P1", "--contract-revision", "faff-runner-v1", "--scope", "merge");
    assert.equal(admit.code, 0, admit.err || admit.out);
  });

  test("uninstall removes the service, account, socket directory and group; the key directory stays root-owned with the same key and empty lists", () => {
    const fingerprint = readJson("/var/lib/commissaire/governor-key.json").pk_fingerprint;
    const gone = uninstall();
    assert.equal(gone.code, 0, gone.err || gone.out);
    assert.equal(sh("getent passwd commissaire").code, 2);
    assert.equal(sh("getent group commissaire-clients").code, 2);
    assert.equal(sh("test -e /var/lib/commissaire-socket").code, 1);
    assert.equal(sh("test -e /etc/systemd/system/commissaire-governor.service").code, 1);
    assert.equal(sh("test -e /opt/commissaire").code, 1, "every install copy is gone");
    assert.equal(stat("/var/lib/commissaire"), "root:root 700");
    assert.equal(stat("/var/lib/commissaire/governor-key.json"), "root:root 600");
    assert.equal(readJson("/var/lib/commissaire/governor-key.json").pk_fingerprint, fingerprint);
    assert.deepEqual(readJson("/var/lib/commissaire/governor-config.json"), { allow_uids: [], admin_uids: [] });
    assert.equal(sh("pgrep -f 'bin/commissaire governor start'").code, 1, "the governor is stopped");
  });

  test("a runner-owned file pre-seeded in the kept key directory aborts install and creates nothing", () => {
    ok(sh("echo '{}' > /var/lib/commissaire/governor-key.json.evil && chown alice:alice /var/lib/commissaire/governor-key.json.evil && chmod 600 /var/lib/commissaire/governor-key.json.evil"), "seed");
    try {
      const r = install(TAGS[2]);
      assert.equal(r.code, 2);
      assert.match(r.err, /\/var\/lib\/commissaire\/governor-key\.json\.evil is owned by uid/);
      assert.equal(sh("getent passwd commissaire").code, 2, "no account was created");
      assert.equal(sh("test -e /opt/commissaire").code, 1);
    } finally {
      ok(sh("rm -f /var/lib/commissaire/governor-key.json.evil"), "unseed");
    }
  });

  test("a reinstall re-owns the kept directory to the recreated account with the same key; uninstall --purge-key then removes it", () => {
    const fingerprint = readJson("/var/lib/commissaire/governor-key.json").pk_fingerprint;
    const again = install(TAGS[2]);
    assert.equal(again.code, 0, again.err || again.out);
    assert.equal(again.result.pk_fingerprint, fingerprint, "earlier grants still verify");
    assert.equal(stat("/var/lib/commissaire/governor-key.json"), "commissaire:commissaire 600");
    const purged = uninstall({ "--purge-key": true });
    assert.equal(purged.code, 0, purged.err || purged.out);
    assert.equal(sh("test -e /var/lib/commissaire").code, 1, "the key directory is gone");
  });

  test("failure paths leave the host untouched: a branch name, a non-root-owned interpreter and an unknown runner", () => {
    const branch = install("main");
    assert.equal(branch.code, 2);
    assert.match(branch.err, /from-tag must be a release tag/);
    const missingTag = install("faff--v0.0.1");
    assert.equal(missingTag.code, 1, "an unknown tag fails the clone");
    const bob = install(TAGS[0], { "--runner-user": "bob" });
    assert.equal(bob.code, 2);
    assert.match(bob.err, /no such user: bob/);
    ok(sh("cp /usr/local/bin/node /home/alice/node && chown alice:alice /home/alice/node"), "alice-owned node");
    const nvm = install(TAGS[0], { "--node": "/home/alice/node" });
    assert.equal(nvm.code, 2);
    assert.match(nvm.err, /interpreter-not-root-owned/);
    for (const r of [branch, missingTag, bob, nvm]) assert.equal(r.out.startsWith("{"), false);
    assert.equal(sh("getent passwd commissaire").code, 2);
    assert.equal(sh("test -e /var/lib/commissaire").code, 1);
    assert.equal(sh("ls /root | grep -c commissaire-release").out, "0", "no clone directory is left behind");
  });

  test("install refuses to run from a copy the runner can write, and --repo-url is an unknown argument", () => {
    ok(sh("cp -r /opt/installer /home/alice/installer && chown -R alice:alice /home/alice/installer"), "runner copy");
    const flags = JSON.stringify({ "--runner-user": "alice", "--from-tag": TAGS[0] });
    const r = sh(`SUDO_USER=hal node -e 'process.exit(require("/home/alice/installer/bin/lib/governor-install.js").governorInstall(JSON.parse(process.argv[1])))' '${flags}'`);
    assert.equal(r.code, 2);
    assert.match(r.err, /install-code-not-root-owned: \/home\/alice/);
    assert.match(r.err, /sudo git clone --depth 1 --branch faff--v9\.9\.1/);
    assert.equal(sh("getent passwd commissaire").code, 2);
    const repoUrl = sh("node /opt/installer/bin/commissaire governor install --runner-user alice --from-tag faff--v9.9.1 --repo-url https://example.invalid/x.git");
    assert.equal(repoUrl.code, 2);
    assert.match(repoUrl.err, /unknown argument: --repo-url/);
  });
});
