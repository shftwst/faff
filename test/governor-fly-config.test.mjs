// FAFF-1181 — the committed Fly deployment config under operations/fly/governor/, the runbook section in
// docs/guide/unattended.md, and the ADR 0135 amendment note. Static checks only; the image itself is built
// and run by test/governor-fly-container.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(REPO, "operations", "fly", "governor");
const read = (...p) => readFileSync(join(REPO, ...p), "utf8");
const require = createRequire(import.meta.url);
const { parseGovernorConfig } = require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "governor.js"));

const uncommented = (text) => text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

test("fly.toml mounts one volume at /data, has no services and no http_service, and keeps the machine running", () => {
  const toml = uncommented(read("operations", "fly", "governor", "fly.toml"));
  assert.match(toml, /^app = "commissaire-governor"$/m);
  assert.deepEqual([...toml.matchAll(/^\[\[?mounts\]\]?$/gm)].length, 1);
  assert.match(toml, /^\[mounts\]\n\s*source = "commissaire_data"\n\s*destination = "\/data"/m);
  assert.doesNotMatch(toml, /\[\[?services/);
  assert.doesNotMatch(toml, /http_service/);
  assert.doesNotMatch(toml, /auto_stop_machines\s*=\s*(true|"stop"|"suspend")/);
  assert.match(toml, /\[\[restart\]\]\n\s*policy = "always"/);
  assert.equal([...toml.matchAll(/^\[\[vm\]\]$/gm)].length, 1);
  assert.match(toml, /^\s*GOVERNOR_ALLOW_DNS = "[a-z0-9-]+\.internal"$/m);
  assert.doesNotMatch(toml, /\[(\[)?(secrets|statics|processes)/);
});

test("governor-config.json lists only uid 0 as an admin and no allowed runner uid, and the governor accepts it", () => {
  const config = JSON.parse(read("operations", "fly", "governor", "governor-config.json"));
  assert.deepEqual(config, { admin_uids: [0], allow_uids: [] });
  assert.equal(parseGovernorConfig(config).ok, true);
});

test("the Dockerfile runs a fixed non-root user from a root-owned code tree and labels the source commit", () => {
  const docker = uncommented(read("operations", "fly", "governor", "Dockerfile"));
  assert.match(docker, /^FROM node:20-slim$/m);
  assert.match(docker, /useradd .*--uid 10001 .*commissaire/);
  assert.match(docker, /apt-get install -y --no-install-recommends python3/);
  assert.match(docker, /chown -R root:root \/opt\/commissaire/);
  assert.match(docker, /chmod -R go-w/);
  assert.match(docker, /ln -s \$\{COMMISSAIRE_ROOT\}\/plugin\/skills\/faff \/opt\/commissaire\/current/);
  assert.match(docker, /^LABEL org\.opencontainers\.image\.revision=\$\{SOURCE_COMMIT\}$/m);
  assert.match(docker, /^ENTRYPOINT \["\/usr\/local\/bin\/commissaire-entrypoint"\]$/m);
  assert.doesNotMatch(docker, /^USER /m, "the entrypoint starts as root only to prepare the volume, then drops privileges");
  assert.doesNotMatch(docker, /(SECRET|PRIVATE_KEY|governor-key)/i);
  assert.match(read("operations", "fly", "governor", "Dockerfile.dockerignore"), /^\*$/m);
});

test("entrypoint.sh is executable, parses as POSIX sh, and drops to the commissaire user", () => {
  const file = join(DIR, "entrypoint.sh");
  assert.ok(statSync(file).mode & 0o111, "executable");
  assert.equal(spawnSync("sh", ["-n", file]).status, 0);
  const sh = read("operations", "fly", "governor", "entrypoint.sh");
  assert.match(sh, /GOVERNOR_LISTEN:-fly-local-6pn:7650/);
  assert.match(sh, /--key-dir "\$KEY_DIR" --listen "\$listen" --listen-allow-dns "\$allow"/);
  assert.match(sh, /setpriv --reuid="\$USER_NAME" --regid="\$USER_NAME" --clear-groups/);
  assert.match(sh, /\[!A-Za-z0-9\.:_-\]/);
});

test("the directory holds exactly the documented files, and the README points at the runbook section", () => {
  assert.deepEqual(readdirSync(DIR).sort(), ["Dockerfile", "Dockerfile.dockerignore", "README.md", "entrypoint.sh", "fly.toml", "governor-config.json"]);
  assert.match(read("operations", "fly", "governor", "README.md"), /unattended\.md#run-the-governor-as-its-own-fly-app/);
});

const SECTION = (() => {
  const doc = read("docs", "guide", "unattended.md");
  const start = doc.indexOf("## Run the governor as its own Fly app");
  const end = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, end);
})();

test("the runbook covers every operator step in the spec's human-tasks table", () => {
  for (const needle of [
    "### Never on the default organisation network",
    "fly apps create commissaire-governor --network",
    "fly apps list --json",
    "fly volumes create commissaire_data",
    "fly tokens create deploy -a commissaire-governor",
    "--no-public-ips",
    "fly ips list -a commissaire-governor",
    "fly deploy .",
    "git status --porcelain",
    "commissaire governor pin --fly-app commissaire-governor",
    "fly ssh console -a commissaire-governor -C \"/opt/commissaire/current/bin/commissaire governor identify --json\"",
    "fly secrets list -a fly-ci-l3-runner",
    "fly tokens list",
    "IPv6",
    "relay",
    "COMMISSAIRE_GOVERNOR=commissaire-governor.internal:7650",
    "getent ahosts commissaire-governor.internal",
    "</dev/tcp/commissaire-governor.internal/7650",
    "getent hosts fly-local-6pn",
    "governor-log.jsonl",
    "Redeploy between firings",
    "re-run the checks in steps 1 and 7",
    "/data/commissaire/github-app.pem",
    "github_app",
    "OWNER/NAME@branch",
    "app_token: ok",
    "github_app: configured",
    "fly machine restart",
    "api.github.com",
    "The runner must not merge this pull request.",
  ]) assert.ok(SECTION.includes(needle), `runbook is missing: ${needle}`);
});

test("the runbook cites the three Fly sources, the quotes and the two operator conditions", () => {
  for (const needle of [
    "https://docs.fly.io/networking/custom-private-networks",
    "https://docs.fly.io/networking/private-networking",
    "https://fly.io/blog/incoming-6pn-private-networks/",
    "Apps on separate 6PNs can never communicate unless explicitly configured to do so.",
    "The Fly.io platform won't forward packets between different 6PNs, unless you explicitly allow it",
    "You can't add an existing app to a custom 6PN or change an app's 6PN.",
    "BPF access control",
    "No other app is ever created on the custom network.",
    "hold no Fly token that can create an app, or that can deploy to, SSH into or manage volumes of the governor app",
  ]) assert.ok(SECTION.includes(needle), `runbook is missing: ${needle}`);
});

test("the checklist in the runbook is the same five items the pin PR body prints", () => {
  const items = [
    "The runbook records the Fly documentation on isolation between custom private networks and the operator's 2026-10-14 basis for the same-network question (only the governor and runner apps on the network).",
    "`fly ips list -a <app>` shows no public address.",
    "The governor app and the runner app share one custom private network that no other app is on.",
    "The runner app's machines hold no Fly token that can deploy to, SSH into, or manage volumes of the governor app.",
    "The governor was deployed from a clean checkout of a release tag.",
  ];
  const source = read("plugin", "skills", "faff", "bin", "lib", "governor-admin.ts");
  for (const item of items) {
    assert.ok(SECTION.includes(`- ${item}`), `runbook: ${item}`);
    assert.ok(source.includes(JSON.stringify(item).slice(1, -1)), `pin: ${item}`);
  }
});

test("the runbook uses the product names and no em dashes", () => {
  assert.match(SECTION, /SuperDomestique/);
  assert.match(SECTION, /Commissaire/);
  assert.ok(!SECTION.includes("—"));
});

test("ADR 0135 carries an amendment note for decision 2 citing FAFF-1181", () => {
  const adr = readFileSync(join(REPO, "records", "adr", readdirSync(join(REPO, "records", "adr")).find((f) => f.startsWith("0135-"))), "utf8");
  assert.match(adr, /^- \*\*Amended:\*\* 2026-10-14: decision 2 amended by FAFF-1181/m);
  assert.match(adr, /\*\*Amendment \(2026-10-14, FAFF-1181\)\.\*\* The Fly governor is always on/);
});
