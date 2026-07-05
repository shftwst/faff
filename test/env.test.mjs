// FAFF-270 — `faff env` live compose provisioning, hardened + tested.
// Two tiers: deterministic compose-gen unit tests (always run, no docker) + a docker-gated
// integration test that SKIPS (never fails) when docker is absent — the issue's "actually-tested
// where docker exists" bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(cwd, args, input) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}
// FAFF-371: run with an environment override (e.g. a dead DOCKER_HOST) — the env verbs must
// inherit the ambient engine context, never resolve or fall back to a different socket.
function runEnv(cwd, args, envOverride) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...envOverride } });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

function tmp() { return mkdtempSync(join(tmpdir(), "faff270-")); }
function writeProfile(dir, obj) {
  const p = join(dir, "profile.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}
// compose-gen --profile P --out OUT --project NAME → parsed ProvisionPlan
function composeGen(dir, profile, project = "demo") {
  const p = writeProfile(dir, profile);
  const out = join(dir, "dc.yml");
  const r = run(dir, ["env", "compose-gen", "--profile", p, "--out", out, "--project", project]);
  return { r, plan: r.code === 0 ? JSON.parse(r.out) : null, out };
}

const PG_APP = { schema: 1, datastores: [{ kind: "postgres", evidence: "docker-compose.yml" }], deploy_targets: [{ kind: "container-image", evidence: "Dockerfile" }] };

test("env --selftest passes", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["env", "--selftest"]).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: postgres + container-image → postgres + app services, sql-load, empty unprovisionable", () => {
  const dir = tmp();
  try {
    const { r, plan, out } = composeGen(dir, PG_APP);
    assert.equal(r.code, 0);
    assert.equal(plan.schema, 1);
    assert.ok(plan.services.some((s) => s.name === "postgres" && s.image === "postgres:16-alpine"));
    assert.ok(plan.services.some((s) => s.name === "app" && s.built_from === "Dockerfile"));
    assert.ok(plan.seed_targets.some((t) => t.kind === "postgres" && t.strategy === "sql-load"));
    assert.equal(plan.unprovisionable.length, 0);
    assert.ok(plan.health_checks.length >= 1);
    assert.ok(existsSync(out));                                   // compose file written
    assert.match(readFileSync(out, "utf8"), /image: postgres:16-alpine/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: health_checks shape matches env-handle (name/path/expected_status)", () => {
  const dir = tmp();
  try {
    const { plan } = composeGen(dir, PG_APP);
    for (const hc of plan.health_checks) {
      assert.equal(typeof hc.name, "string");
      assert.equal(typeof hc.path, "string");
      assert.equal(typeof hc.expected_status, "number");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: byte-identical across two runs (no timestamps, no random)", () => {
  const dir = tmp();
  try {
    const a = composeGen(dir, PG_APP);
    const aCompose = readFileSync(a.out, "utf8");
    const b = composeGen(dir, PG_APP);
    const bCompose = readFileSync(b.out, "utf8");
    assert.equal(a.r.out, b.r.out);                              // ProvisionPlan identical
    assert.equal(aCompose, bCompose);                            // compose file identical
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: unknown datastore kind → unprovisionable[], not a silent skip, no service", () => {
  const dir = tmp();
  try {
    const { plan } = composeGen(dir, { schema: 1, datastores: [{ kind: "cassandra", evidence: "x" }], deploy_targets: [] });
    assert.ok(plan.unprovisionable.includes("cassandra"));
    assert.ok(!plan.services.some((s) => s.name === "cassandra"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: sqlite is file-based — seed target, no service, excluded from services", () => {
  const dir = tmp();
  try {
    const { plan } = composeGen(dir, { schema: 1, datastores: [{ kind: "sqlite", evidence: "x" }], deploy_targets: [] });
    assert.ok(plan.seed_targets.some((t) => t.kind === "sqlite" && t.file_based === true));
    assert.ok(!plan.services.some((s) => s.name === "sqlite"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: redis provisions (service) and command-replay-seeds — no unseeded note", () => {
  const dir = tmp();
  try {
    const { plan } = composeGen(dir, { schema: 1, datastores: [{ kind: "redis", evidence: "x" }], deploy_targets: [] });
    assert.ok(plan.services.some((s) => s.name === "redis"));
    assert.ok(plan.seed_targets.some((t) => t.kind === "redis" && t.strategy === "command-replay"));
    assert.ok(!plan.notes.some((n) => /redis/.test(n)));          // seeded now → no "unseeded" note
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: mongo provisions (service) and mongoimport-seeds — no unseeded note", () => {
  const dir = tmp();
  try {
    const { plan } = composeGen(dir, { schema: 1, datastores: [{ kind: "mongo", evidence: "x" }], deploy_targets: [] });
    assert.ok(plan.services.some((s) => s.name === "mongo" && s.image === "mongo:7"));
    assert.ok(plan.seed_targets.some((t) => t.kind === "mongo" && t.strategy === "mongoimport"));
    assert.ok(!plan.notes.some((n) => /mongo/.test(n)));         // seeded now → no "unseeded" note
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: minio provisions (service) with command: + object-upload seed, http endpoint, empty unprovisionable [FAFF-273]", () => {
  const dir = tmp();
  try {
    const { plan, out } = composeGen(dir, { schema: 1, datastores: [{ kind: "minio", evidence: "x" }], deploy_targets: [] });
    assert.ok(plan.services.some((s) => s.name === "minio" && s.image === "minio/minio"));
    assert.ok(plan.seed_targets.some((t) => t.kind === "minio" && t.strategy === "object-upload"));
    assert.equal(plan.unprovisionable.length, 0);
    assert.equal(plan.endpoints.minio, "http://localhost:9000");   // S3 API is HTTP, not raw tcp
    const compose = readFileSync(out, "utf8");
    assert.match(compose, /command: "server \/data --console-address :9001"/);   // MinIO needs the server arg
    assert.match(compose, /minio\/health\/ready/);                  // engine-native health probe
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: s3 is an alias for minio — provisions minio, not unprovisionable [FAFF-273]", () => {
  const dir = tmp();
  try {
    const { plan } = composeGen(dir, { schema: 1, datastores: [{ kind: "s3", evidence: "x" }], deploy_targets: [] });
    assert.ok(plan.services.some((s) => s.name === "minio"));
    assert.equal(plan.unprovisionable.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: command: is opt-in — a datastore without one (postgres) emits no command line [FAFF-273]", () => {
  const dir = tmp();
  try {
    const { out } = composeGen(dir, PG_APP);
    assert.doesNotMatch(readFileSync(out, "utf8"), /command:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: endpoint precedence — app when present, else first datastore", () => {
  const dir = tmp();
  try {
    const withApp = composeGen(dir, PG_APP).plan;
    assert.equal(withApp.endpoint, withApp.endpoints.app);
    const noApp = composeGen(dir, { schema: 1, datastores: [{ kind: "postgres", evidence: "x" }], deploy_targets: [] }).plan;
    assert.equal(noApp.endpoint, noApp.endpoints.postgres);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("up: unprovisionable datastore fails loud (exit 1) before touching docker", () => {
  const dir = tmp();
  try {
    const p = writeProfile(dir, { schema: 1, datastores: [{ kind: "cassandra", evidence: "x" }], deploy_targets: [] });
    const r = run(dir, ["env", "up", "--profile", p, "--project", "d"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /unprovisionable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("down: idempotent — succeeds (exit 0) even with no env / docker", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["env", "down", "--project", "nonexistent"]).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-371 — a dead DOCKER_HOST is terminal + named; faff never falls back to the default socket
// (the silent fallback would re-open the exact host-socket path the bounded-engine posture closes).
// Deterministic: needs no daemon — `docker info` against the nonexistent socket fails either way.
test("up: dead DOCKER_HOST fails loud (exit 1) naming the effective engine context", () => {
  const dir = tmp();
  try {
    const p = writeProfile(dir, { schema: 1, datastores: [{ kind: "postgres", evidence: "x" }], deploy_targets: [] });
    const r = runEnv(dir, ["env", "up", "--profile", p, "--project", "d371"], { DOCKER_HOST: "unix:///nonexistent/faff371.sock" });
    assert.equal(r.code, 1);
    assert.match(r.err, /docker unavailable \(DOCKER_HOST=unix:\/\/\/nonexistent\/faff371\.sock\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("down: dead DOCKER_HOST stays idempotent OK and names the engine context", () => {
  const dir = tmp();
  try {
    const r = runEnv(dir, ["env", "down", "--project", "d371"], { DOCKER_HOST: "unix:///nonexistent/faff371.sock" });
    assert.equal(r.code, 0);
    assert.match(r.out, /docker unavailable \(DOCKER_HOST=unix:\/\/\/nonexistent\/faff371\.sock\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- docker-gated integration: FAFF-30 §5 scenario 1+3 (real env stands up, seeded, ready) ---
function dockerAvailable() {
  try { execFileSync("docker", ["info"], { stdio: "ignore", timeout: 30000 }); return true; }
  catch { return false; }
}
// FAFF-371: detect the mounted-host-socket cage — this test process is containerised, the host
// daemon socket is mounted, and the daemon is not rootless. There, containers publish on the HOST
// loopback (unreachable from in here), so host-side reachability assertions are skipped loudly.
function hostSocketCage() {
  const contained = existsSync("/.dockerenv") || existsSync("/run/.containerenv");
  if (!contained || !existsSync("/var/run/docker.sock")) return false;
  try {
    const so = execFileSync("docker", ["info", "--format", "{{.SecurityOptions}}"], { encoding: "utf8", timeout: 30000 });
    return !/rootless/.test(so);
  } catch { return true; }
}
const DOCKER = dockerAvailable();
// FAFF-274: a CI lane that MUST run this test sets FAFF_REQUIRE_DOCKER. When set + non-empty,
// docker absence is a FAILURE (run the test so it fails loudly), not a silent skip — closing the
// hole where a skipped docker-gated test is indistinguishable from a passing one in a green CI run.
// Unset / empty keeps the graceful local-dev skip; only a non-empty value arms the guard.
const REQUIRE_DOCKER = !!process.env.FAFF_REQUIRE_DOCKER;
const skipIntegration = DOCKER ? false                  // docker here → run
  : REQUIRE_DOCKER ? false                              // required but absent → RUN so it can FAIL
  : "docker unavailable";                               // local/dev → graceful skip

test("integration: postgres env stands up, seeds, and tears down [docker-gated]", { skip: skipIntegration }, () => {
  // FAFF-274: assert docker presence first so a required-but-absent lane fails loudly (not a silent skip).
  assert.ok(DOCKER, "FAFF_REQUIRE_DOCKER is set but docker is unavailable — this lane must run the env integration test (FAFF-274)");
  const dir = tmp();
  const project = "faff270-it";
  try {
    const profile = { schema: 1, datastores: [{ kind: "postgres", evidence: "x" }], deploy_targets: [] };
    const p = writeProfile(dir, profile);
    const plan = JSON.parse(run(dir, ["env", "compose-gen", "--profile", p, "--out", join(dir, "dc.yml"), "--project", project]).out);
    writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
    // a tiny fixtures manifest so seed has something to load
    const manifest = { schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [{ name: "users", fields: [{ name: "id", type: "uuid" }] }] }, volumes: { users: 2 } };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    try {
      const up = run(dir, ["env", "up", "--plan", join(dir, "plan.json"), "--project", project, "--sla-secs", "90"]);
      assert.equal(up.code, 0, `up failed: ${up.err}`);
      const seed = run(dir, ["env", "seed", "--plan", join(dir, "plan.json"), "--manifest", join(dir, "manifest.json"), "--project", project]);
      assert.equal(seed.code, 0, `seed failed: ${seed.err}`);
    } finally {
      run(dir, ["env", "down", "--project", project]);           // always tear down
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("integration: mongo env stands up, mongoimport-seeds, and tears down [docker-gated]", { skip: skipIntegration }, () => {
  // FAFF-274: assert docker presence first so a required-but-absent lane fails loudly (not a silent skip).
  assert.ok(DOCKER, "FAFF_REQUIRE_DOCKER is set but docker is unavailable — this lane must run the mongo env integration test (FAFF-272)");
  const dir = tmp();
  const project = "faff272-it";
  const compose = join(dir, "dc.yml");
  try {
    const profile = { schema: 1, datastores: [{ kind: "mongo", evidence: "x" }], deploy_targets: [] };
    const p = writeProfile(dir, profile);
    const plan = JSON.parse(run(dir, ["env", "compose-gen", "--profile", p, "--out", compose, "--project", project]).out);
    writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
    // a tiny fixtures manifest so seed has one entity (2 rows) to import
    const manifest = { schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [{ name: "users", fields: [{ name: "id", type: "uuid" }] }] }, volumes: { users: 2 } };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    try {
      const up = run(dir, ["env", "up", "--plan", join(dir, "plan.json"), "--project", project, "--sla-secs", "90"]);
      assert.equal(up.code, 0, `up failed: ${up.err}`);
      const seed = run(dir, ["env", "seed", "--plan", join(dir, "plan.json"), "--manifest", join(dir, "manifest.json"), "--project", project]);
      assert.equal(seed.code, 0, `seed failed: ${seed.err}`);
      // the born-verifiable AC: the collection actually landed the 2 documents inside the mongo service.
      const count = execFileSync("docker", ["compose", "--project-directory", dir, "-p", project, "-f", compose, "exec", "-T",
        "mongo", "mongosh", "--quiet", "--eval", 'db.getSiblingDB("app").users.countDocuments()'],
        { cwd: dir, encoding: "utf8" }).trim();
      assert.equal(count, "2", `expected 2 documents in app.users, got: ${count}`);
    } finally {
      run(dir, ["env", "down", "--project", project]);           // always tear down
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("integration: redis env stands up, command-replay-seeds, and tears down [docker-gated]", { skip: skipIntegration }, () => {
  // FAFF-274: assert docker presence first so a required-but-absent lane fails loudly (not a silent skip).
  assert.ok(DOCKER, "FAFF_REQUIRE_DOCKER is set but docker is unavailable — this lane must run the redis env integration test (FAFF-271)");
  const dir = tmp();
  const project = "faff271-it";
  const compose = join(dir, "dc.yml");
  try {
    const profile = { schema: 1, datastores: [{ kind: "redis", evidence: "x" }], deploy_targets: [] };
    const p = writeProfile(dir, profile);
    const plan = JSON.parse(run(dir, ["env", "compose-gen", "--profile", p, "--out", compose, "--project", project]).out);
    writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
    // a tiny fixtures manifest so seed has one entity (2 rows) to replay
    const manifest = { schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [{ name: "users", fields: [{ name: "id", type: "uuid" }] }] }, volumes: { users: 2 } };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    try {
      const up = run(dir, ["env", "up", "--plan", join(dir, "plan.json"), "--project", project, "--sla-secs", "90"]);
      assert.equal(up.code, 0, `up failed: ${up.err}`);
      const seed = run(dir, ["env", "seed", "--plan", join(dir, "plan.json"), "--manifest", join(dir, "manifest.json"), "--project", project]);
      assert.equal(seed.code, 0, `seed failed: ${seed.err}`);
      // the born-verifiable AC: the keyspace is non-empty inside the redis service (scheme-agnostic — FAFF-271).
      const dbsize = execFileSync("docker", ["compose", "--project-directory", dir, "-p", project, "-f", compose, "exec", "-T",
        "redis", "redis-cli", "DBSIZE"],
        { cwd: dir, encoding: "utf8" }).trim();
      assert.ok(Number(dbsize) > 0, `expected DBSIZE > 0 after seed, got: ${dbsize}`);
    } finally {
      run(dir, ["env", "down", "--project", project]);           // always tear down
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("integration: minio env stands up, object-upload-seeds, and tears down [docker-gated]", { skip: skipIntegration }, () => {
  // FAFF-274: assert docker presence first so a required-but-absent lane fails loudly (not a silent skip).
  assert.ok(DOCKER, "FAFF_REQUIRE_DOCKER is set but docker is unavailable — this lane must run the minio env integration test (FAFF-273)");
  const dir = tmp();
  const project = "faff273-it";
  const compose = join(dir, "dc.yml");
  try {
    const profile = { schema: 1, datastores: [{ kind: "minio", evidence: "x" }], deploy_targets: [] };
    const p = writeProfile(dir, profile);
    const plan = JSON.parse(run(dir, ["env", "compose-gen", "--profile", p, "--out", compose, "--project", project]).out);
    writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
    // a tiny fixtures manifest so seed has one entity (2 rows) to upload
    const manifest = { schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [{ name: "users", fields: [{ name: "id", type: "uuid" }] }] }, volumes: { users: 2 } };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    try {
      const up = run(dir, ["env", "up", "--plan", join(dir, "plan.json"), "--project", project, "--sla-secs", "90"]);
      assert.equal(up.code, 0, `up failed: ${up.err}`);
      const seed = run(dir, ["env", "seed", "--plan", join(dir, "plan.json"), "--manifest", join(dir, "manifest.json"), "--project", project]);
      assert.equal(seed.code, 0, `seed failed: ${seed.err}`);
      // the born-verifiable AC: the bucket "users" landed 2 objects, counted via an `mc ls` sidecar.
      const count = execFileSync("docker", ["run", "--rm", "--network", `${project}_default`,
        "-e", "MC_HOST_local=http://faffdev:faffdevsecret@minio:9000", "minio/mc", "ls", "--recursive", "local/users"],
        { cwd: dir, encoding: "utf8" }).split("\n").filter((l) => /\.json/.test(l)).length;
      assert.equal(count, 2, `expected 2 objects in bucket users, got: ${count}`);
    } finally {
      run(dir, ["env", "down", "--project", project]);           // always tear down
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ===========================================================================
// FAFF-303 — reconcile the synthesized app service against the repo's own compose,
// and resolve the build context to the repo root.
// ===========================================================================

const APP_PROFILE = { schema: 1, runtimes: [{ name: "node", version: "20" }], datastores: [{ kind: "postgres", evidence: "docker-compose.yml" }], deploy_targets: [{ kind: "container-image", evidence: "Dockerfile" }] };

// A production-shaped repo compose: Node api on 3000 with its own node healthcheck + DATABASE_URL,
// plus a postgres datastore named `db`.
const REPO_COMPOSE = [
  "services:",
  "  api:",
  "    build:",
  "      context: .",
  "      dockerfile: Dockerfile",
  "    ports:",
  '      - "3000:3000"',
  "    environment:",
  "      - DATABASE_URL=postgres://postgres@db:5432/app",
  "    healthcheck:",
  '      test: ["CMD-SHELL", "node -e \\"require(\'http\').get(\'http://localhost:3000/healthz\',r=>process.exit(r.statusCode===200?0:1)).on(\'error\',()=>process.exit(1))\\""]',
  "  db:",
  "    image: postgres:16-alpine",
].join("\n");

// compose-gen run with a repo compose present at --root.
function composeGenRoot(rootDir, profile, project = "demo") {
  const p = writeProfile(rootDir, profile);
  const out = join(rootDir, ".faff", "env", "dc.yml");
  const r = run(rootDir, ["env", "compose-gen", "--root", rootDir, "--profile", p, "--out", out, "--project", project]);
  return { r, plan: r.code === 0 ? JSON.parse(r.out) : null, out, compose: r.code === 0 ? readFileSync(out, "utf8") : "" };
}

test("compose-gen: repo compose present → app port/env/healthcheck/context reconciled (no curl)", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "docker-compose.yml"), REPO_COMPOSE);
    const { r, plan, compose } = composeGenRoot(dir, APP_PROFILE);
    assert.equal(r.code, 0, r.err);
    const app = plan.services.find((s) => s.name === "app");
    assert.deepEqual(app.ports, ["3000:3000"]);                          // repo port, not 8080
    assert.equal(app.env.DATABASE_URL, "postgres://postgres@postgres:5432/app"); // host realigned db→postgres
    assert.equal(plan.endpoints.app, "http://localhost:3000");
    assert.match(compose, /context: \./);                                // relative; --project-directory resolves it
    assert.match(compose, /healthz/);                                    // repo healthcheck path
    assert.doesNotMatch(compose, /curl/);                                // never curl
    assert.match(compose, /DATABASE_URL: "postgres:\/\/postgres@postgres:5432\/app"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: NO repo compose → byte-identical to profile-only synthesis (additive)", () => {
  const dir = tmp();      // no compose file written
  try {
    const withRoot = composeGenRoot(dir, APP_PROFILE).compose;
    // same profile through the plain profile-only path (no repo compose anywhere)
    const dir2 = tmp();
    try {
      const plain = composeGen(dir2, APP_PROFILE).out;
      assert.equal(withRoot, readFileSync(plain, "utf8"));
      assert.match(withRoot, /curl -fsS http:\/\/localhost:8080\/health/); // unchanged default
    } finally { rmSync(dir2, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: repo compose with no app healthcheck → node http probe, never curl", () => {
  const dir = tmp();
  try {
    const noHc = [
      "services:",
      "  api:",
      "    build: .",
      "    ports:",
      '      - "3000:3000"',
      "  db:",
      "    image: postgres:16-alpine",
    ].join("\n");
    writeFileSync(join(dir, "compose.yaml"), noHc);
    const { compose } = composeGenRoot(dir, APP_PROFILE);
    assert.match(compose, /node -e .*require\('http'\)/);
    assert.doesNotMatch(compose, /curl/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("compose-gen: two buildable app services → fall back to profile defaults (no crash)", () => {
  const dir = tmp();
  try {
    const multi = ["services:", "  a:", "    build: .", "  b:", "    build: .", "  db:", "    image: postgres:16-alpine"].join("\n");
    writeFileSync(join(dir, "docker-compose.yml"), multi);
    const { r, compose } = composeGenRoot(dir, APP_PROFILE);
    assert.equal(r.code, 0);
    assert.match(compose, /8080:8080/);     // profile default app, override declined
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A repo compose whose app CONNECTS to postgres at boot, using a role+db (`linkshortener`) that
// only exist if compose-gen reconciles the datastore auth-env (FAFF-303 rev 2). The db service
// declares POSTGRES_USER/DB/PASSWORD; the app's DATABASE_URL binds to them (host `db` realigned
// to the generated `postgres` service name).
const REPO_COMPOSE_DB = [
  "services:",
  "  api:",
  "    build:",
  "      context: .",
  "      dockerfile: Dockerfile",
  "    ports:",
  '      - "3000:3000"',
  "    environment:",
  "      - DATABASE_URL=postgres://linkshortener:pw@db:5432/linkshortener",
  "    healthcheck:",
  '      test: ["CMD-SHELL", "node -e \\"require(\'http\').get(\'http://localhost:3000/healthz\',r=>process.exit(r.statusCode===200?0:1)).on(\'error\',()=>process.exit(1))\\""]',
  "  db:",
  "    image: postgres:16-alpine",
  "    environment:",
  "      POSTGRES_USER: linkshortener",
  "      POSTGRES_DB: linkshortener",
  "      POSTGRES_PASSWORD: pw",
].join("\n");

// --- docker-gated integration: a REAL Node 20 + Postgres service stands up via the env lane,
// with the app actually CONNECTING to the reconciled role/db at boot (FAFF-303 rev 2) ---
const skipAppIntegration = DOCKER ? false : REQUIRE_DOCKER ? false : "docker unavailable";

test("integration: real Node + Postgres app tier (connects at boot) stands up healthy via env lane [docker-gated]", { skip: skipAppIntegration }, () => {
  assert.ok(DOCKER, "FAFF_REQUIRE_DOCKER is set but docker is unavailable — this lane must run the app-tier integration test (FAFF-303)");
  const dir = tmp();
  const project = "faff303-it";
  try {
    // The app does a real, dependency-free Postgres startup handshake at boot, NO retry: it only
    // listens (→ healthy) if (a) the wired role+db exist [db-env reconcile] AND (b) postgres is
    // already up [depends_on service_healthy]. Without either FAFF-303 fix, the app never goes healthy.
    writeFileSync(join(dir, "server.js"), [
      "const http = require('http');",
      "const net = require('net');",
      "const u = new URL(process.env.DATABASE_URL);",   // fail-fast (throws) if unset
      "const params = `user\\0${u.username}\\0database\\0${u.pathname.slice(1)}\\0\\0`;",
      "const body = Buffer.alloc(4 + Buffer.byteLength(params));",
      "body.writeInt32BE(196608, 0); body.write(params, 4);",   // protocol 3.0
      "const msg = Buffer.alloc(4 + body.length); msg.writeInt32BE(msg.length, 0); body.copy(msg, 4);",
      "const sock = net.connect({ host: u.hostname, port: Number(u.port) || 5432 }, () => sock.write(msg));",
      "sock.once('data', (buf) => {",
      "  if (String.fromCharCode(buf[0]) === 'R') {",   // AuthenticationOk → role+db exist, trust accepted
      "    sock.end();",
      "    http.createServer((req, res) => { if (req.url === '/healthz') { res.writeHead(200); res.end('ok'); } else { res.writeHead(404); res.end(); } })",
      "      .listen(Number(process.env.PORT) || 3000, () => console.log('listening'));",
      "  } else { console.error('db handshake rejected: ' + String.fromCharCode(buf[0])); process.exit(1); }",
      "});",
      "sock.on('error', (e) => { console.error('db connect error: ' + e.message); process.exit(1); });",
    ].join("\n"));
    writeFileSync(join(dir, "Dockerfile"), ["FROM node:20-alpine", "WORKDIR /app", "COPY server.js .", "EXPOSE 3000", 'CMD ["node", "server.js"]'].join("\n"));
    writeFileSync(join(dir, "docker-compose.yml"), REPO_COMPOSE_DB);
    const p = writeProfile(dir, APP_PROFILE);
    const gen = run(dir, ["env", "compose-gen", "--root", dir, "--profile", p, "--out", join(dir, ".faff", "env", "dc.yml"), "--project", project]);
    assert.equal(gen.code, 0, `compose-gen failed: ${gen.err}`);
    const plan = JSON.parse(gen.out);
    // the generated postgres carries the reconciled auth-env, and the app is ordered behind it
    const pg = plan.services.find((s) => s.name === "postgres");
    assert.equal(pg.env.POSTGRES_DB, "linkshortener", "db-tier auth-env reconciled");
    const app = plan.services.find((s) => s.name === "app");
    assert.equal(app.depends_on.postgres.condition, "service_healthy", "app ordered behind postgres");
    writeFileSync(join(dir, "plan.json"), JSON.stringify(plan));
    try {
      const up = run(dir, ["env", "up", "--root", dir, "--plan", join(dir, "plan.json"), "--project", project, "--sla-secs", "180"]);
      assert.equal(up.code, 0, `up failed: ${up.err}`);    // app connects to the reconciled DB → healthy (the reopened failure no longer reproduces)
      assert.match(up.out, /2 service\(s\) healthy/);
      // FAFF-371: the plan endpoint must be reachable from THIS process — the exact property the
      // holdout evaluator depends on (the env-handle endpoint), and precisely what rootless
      // port-publishing can break while in-container healthchecks stay green. Small retry loop:
      // the publish can trail the in-container healthy by a beat.
      // Carve-out: inside a MOUNTED-HOST-SOCKET cage (containerised test process + host
      // /var/run/docker.sock + non-rootless daemon) published ports bind on the HOST loopback, so
      // the property is false by construction — that is the deprecated posture this work exists to
      // replace. Skip loudly there; the assertion runs on CI VM runners and rootless engines.
      if (hostSocketCage()) {
        console.warn("WARN: mounted host-socket cage detected — published ports bind on the host, endpoint reachability cannot hold here; skipping the reachability GET (it runs on CI runners and rootless nested engines)");
      } else {
        let reachable = false, lastErr = "";
        for (let i = 0; i < 5 && !reachable; i++) {
          try {
            execFileSync("node", ["-e",
              "require('http').get(process.argv[1], (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))",
              `${plan.endpoint}/healthz`], { timeout: 15000 });
            reachable = true;
          } catch (e) { lastErr = String(e.message || e); execFileSync("sleep", ["2"]); }
        }
        assert.ok(reachable, `plan endpoint ${plan.endpoint}/healthz not reachable from the test process: ${lastErr}`);
      }
    } finally {
      run(dir, ["env", "down", "--project", project]);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
