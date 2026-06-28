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

test("compose-gen: redis provisions (service) but mount-seeds with an unseeded note", () => {
  const dir = tmp();
  try {
    const { plan } = composeGen(dir, { schema: 1, datastores: [{ kind: "redis", evidence: "x" }], deploy_targets: [] });
    assert.ok(plan.services.some((s) => s.name === "redis"));
    assert.ok(plan.seed_targets.some((t) => t.kind === "redis" && t.strategy === "mount"));
    assert.ok(plan.notes.some((n) => /redis/.test(n) && /FAFF-271/.test(n)));
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

// --- docker-gated integration: FAFF-30 §5 scenario 1+3 (real env stands up, seeded, ready) ---
function dockerAvailable() {
  try { execFileSync("docker", ["info"], { stdio: "ignore", timeout: 30000 }); return true; }
  catch { return false; }
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
