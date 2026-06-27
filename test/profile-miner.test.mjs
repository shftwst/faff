// FAFF-231 — infra-profile repo-mining acquirer (slice 2 of 2): the default `profile`-slot occupant.
// A deterministic, read-only repo-miner. Scans --root for infra artifacts and emits ONE
// faff-contract:infra-profile block (FAFF-26 schema). Pure file inspection: NO network/install/
// subprocess (constraint ①); writes no files (the orchestrator writes .faff/infra-profile.json, ADR 0013).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");

// Run the CLI (node by absolute path so an empty-PATH env still launches the interpreter while
// any subprocess spawn the miner might attempt would fail to resolve — the offline assertion).
function run(args, opts = {}) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args],
      { encoding: "utf8", input: opts.input ?? "", env: opts.env ?? process.env });
    return { code: 0, out, err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() };
  }
}

function tmp() { return mkdtempSync(join(tmpdir(), "faff231-")); }
function write(dir, rel, body) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}
// Mine a dir → parsed profile object (via --json), plus the fenced block for the contract-shape checks.
function mine(dir, env) {
  const json = run(["profile", "mine", "--root", dir, "--json"], { env });
  assert.equal(json.code, 0, json.err);
  return JSON.parse(json.out);
}
function validate(profileObj) {
  return run(["profile", "validate"], { input: JSON.stringify(profileObj) });
}
const find = (arr, k, v) => arr.find((e) => e[k] === v);

// ---------------------------------------------------------------------------
// Scenario 1 — infra repo: CI workflow (setup-node@20) + compose (postgres)
// ---------------------------------------------------------------------------
test("scenario 1: workflow node/20 + compose postgres → evidenced, validates", () => {
  const dir = tmp();
  try {
    write(dir, ".github/workflows/ci.yml",
      "name: ci\non: [push]\njobs:\n  build:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n");
    write(dir, "docker-compose.yml",
      "services:\n  db:\n    image: postgres:16\n");
    const p = mine(dir);
    const node = find(p.runtimes, "name", "node");
    assert.ok(node, "node runtime mined");
    assert.equal(node.version, "20");
    assert.equal(node.evidence, ".github/workflows/ci.yml");
    const ci = find(p.ci, "name", "github-actions");
    assert.ok(ci && ci.evidence === ".github/workflows/ci.yml", "github-actions ci evidenced by workflow");
    const pg = find(p.datastores, "kind", "postgres");
    assert.ok(pg && pg.evidence === "docker-compose.yml", "postgres datastore evidenced by compose");
    assert.equal(validate(p).code, 0, "emitted profile validates");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Scenario 2 — faff's own repo: CI workflows, no Dockerfile/IaC/datastores → valid, exit success
// ---------------------------------------------------------------------------
test("scenario 2: faff's own repo mines to a valid profile (graceful, exit success)", () => {
  const p = mine(REPO);
  assert.ok(find(p.ci, "name", "github-actions"), "faff repo has github-actions CI");
  assert.equal(p.datastores.length, 0, "faff repo has no datastores");
  assert.equal(validate(p).code, 0, "faff-repo profile validates");
});

// ---------------------------------------------------------------------------
// Scenario 3 / edge — same fact twice → deduped by identity, evidence retained
// ---------------------------------------------------------------------------
test("dedup: two compose files each postgres → single postgres entry, evidence retained", () => {
  const dir = tmp();
  try {
    write(dir, "docker-compose.yml", "services:\n  db:\n    image: postgres:15\n");
    write(dir, "docker-compose.prod.yml", "services:\n  db:\n    image: postgres:16\n");
    const p = mine(dir);
    const pg = p.datastores.filter((e) => e.kind === "postgres");
    assert.equal(pg.length, 1, "postgres deduped by kind");
    assert.ok(pg[0].evidence && pg[0].evidence.length > 0, "evidence retained");
    assert.equal(validate(p).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Edge — minimal profile: empty repo → minimal-profile note, valid, exit success
// ---------------------------------------------------------------------------
test("minimal profile: no infra artifacts → minimal-profile note, valid", () => {
  const dir = tmp();
  try {
    write(dir, "README.md", "# nothing infra here\n");
    const p = mine(dir);
    assert.equal(p.runtimes.length + p.ci.length + p.deploy_targets.length + p.datastores.length, 0);
    assert.ok(p.notes.some((n) => /no infra artifacts discovered/.test(n)), "minimal-profile note present");
    assert.equal(validate(p).code, 0, "minimal profile validates");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Edge — unpinned version omitted (never invent infra facts)
// ---------------------------------------------------------------------------
test("unpinned version omitted: package.json without engines.node → node, no version", () => {
  const dir = tmp();
  try {
    write(dir, "package.json", JSON.stringify({ name: "x", version: "1.0.0" }));
    const p = mine(dir);
    const node = find(p.runtimes, "name", "node");
    assert.ok(node, "node runtime mined from package.json");
    assert.equal(node.version, undefined, "no version invented when unpinned");
    assert.equal(node.evidence, "package.json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Per-rule mining coverage (each MINING_RULE → right list + right evidence path)
// ---------------------------------------------------------------------------
test("per-rule: gitlab-ci", () => {
  const dir = tmp();
  try {
    write(dir, ".gitlab-ci.yml", "stages: [build]\n");
    const ci = find(mine(dir).ci, "name", "gitlab-ci");
    assert.ok(ci && ci.evidence === ".gitlab-ci.yml");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("per-rule: Dockerfile → container-image deploy target + FROM base runtime", () => {
  const dir = tmp();
  try {
    write(dir, "Dockerfile", "FROM node:20-alpine\nRUN echo hi\n");
    const p = mine(dir);
    const dt = find(p.deploy_targets, "kind", "container-image");
    assert.ok(dt && dt.evidence === "Dockerfile", "container-image deploy target evidenced by Dockerfile");
    assert.ok(find(p.runtimes, "name", "node"), "FROM base image mined as runtime");
    assert.equal(validate(p).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("per-rule: terraform aws provider → aws deploy target", () => {
  const dir = tmp();
  try {
    write(dir, "infra/main.tf", 'provider "aws" {\n  region = "eu-west-1"\n}\nresource "aws_s3_bucket" "b" {}\n');
    const dt = find(mine(dir).deploy_targets, "kind", "aws");
    assert.ok(dt && dt.evidence === "infra/main.tf");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("per-rule: netlify.toml → netlify deploy target + paas_available", () => {
  const dir = tmp();
  try {
    write(dir, "netlify.toml", "[build]\n  command = \"npm run build\"\n");
    const p = mine(dir);
    assert.ok(find(p.deploy_targets, "kind", "netlify"));
    assert.ok(p.paas_available.includes("netlify"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("per-rule: vercel.json → vercel; Procfile → heroku", () => {
  const d1 = tmp();
  try {
    write(d1, "vercel.json", "{}\n");
    assert.ok(find(mine(d1).deploy_targets, "kind", "vercel"));
  } finally { rmSync(d1, { recursive: true, force: true }); }
  const d2 = tmp();
  try {
    write(d2, "Procfile", "web: node server.js\n");
    assert.ok(find(mine(d2).deploy_targets, "kind", "heroku"));
  } finally { rmSync(d2, { recursive: true, force: true }); }
});

test("per-rule: go.mod version pin; requirements.txt python", () => {
  const d1 = tmp();
  try {
    write(d1, "go.mod", "module x\n\ngo 1.21\n");
    const go = find(mine(d1).runtimes, "name", "go");
    assert.ok(go && go.version === "1.21" && go.evidence === "go.mod");
  } finally { rmSync(d1, { recursive: true, force: true }); }
  const d2 = tmp();
  try {
    write(d2, "requirements.txt", "flask==3.0\n");
    const py = find(mine(d2).runtimes, "name", "python");
    assert.ok(py && py.evidence === "requirements.txt");
  } finally { rmSync(d2, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Invariant — every emitted list entry carries non-empty evidence (FAFF-26 trust signal)
// ---------------------------------------------------------------------------
test("every mined list entry has non-empty evidence", () => {
  const dir = tmp();
  try {
    write(dir, ".github/workflows/ci.yml", "jobs:\n  b:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 18\n");
    write(dir, "Dockerfile", "FROM python:3.12\n");
    write(dir, "docker-compose.yml", "services:\n  cache:\n    image: redis:7\n");
    write(dir, "infra/main.tf", 'provider "google" {}\n');
    const p = mine(dir);
    for (const field of ["runtimes", "ci", "deploy_targets", "datastores"]) {
      for (const el of p[field]) {
        assert.ok(el.evidence && String(el.evidence).trim().length > 0, `${field} entry must cite evidence`);
      }
    }
    assert.equal(validate(p).code, 0, "rich fixture validates");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Constraint ① — a full mine issues NO network/install/subprocess calls (verifiable offline),
// and writes NO files.
// ---------------------------------------------------------------------------
test("constraint ①: mine runs offline (empty PATH) and writes no files", () => {
  const dir = tmp();
  try {
    write(dir, ".github/workflows/ci.yml", "jobs:\n  b:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n");
    write(dir, "docker-compose.yml", "services:\n  db:\n    image: postgres:16\n");
    // Empty PATH: node itself is launched by absolute path (process.execPath), but any subprocess the
    // miner might try to spawn (git/docker/terraform/…) would fail to resolve — so a clean run proves
    // pure file inspection.
    const env = { ...process.env, PATH: "" };
    const p = mine(dir, env);
    assert.ok(find(p.ci, "name", "github-actions"), "mined offline");
    assert.ok(find(p.datastores, "kind", "postgres"), "mined offline");
    assert.equal(validate(p).code, 0, "offline-mined profile validates");
    // writes no files — the miner emits a block and stops; the orchestrator owns .faff/infra-profile.json.
    assert.equal(existsSync(join(dir, ".faff", "infra-profile.json")), false, "miner writes no .faff/infra-profile.json");
    assert.equal(existsSync(join(dir, ".faff")), false, "miner creates no .faff dir");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Output shape — default `mine` emits exactly one fenced faff-contract:infra-profile block
// ---------------------------------------------------------------------------
test("output: default mine emits exactly one fenced faff-contract:infra-profile block", () => {
  const dir = tmp();
  try {
    write(dir, "README.md", "# x\n");
    const r = run(["profile", "mine", "--root", dir]);
    assert.equal(r.code, 0, r.err);
    const opens = (r.out.match(/```faff-contract:infra-profile/g) || []).length;
    assert.equal(opens, 1, "exactly one contract block");
    const body = r.out.split("```faff-contract:infra-profile")[1].split("```")[0];
    assert.doesNotThrow(() => JSON.parse(body), "block body parses as JSON");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// repo slug — resolved read-only from .git/config (no `git` subprocess), end-anchored so the
// org/repo is extracted across the realistic remote-URL forms (https, scp-style, ssh://, an
// embedded credential, an explicit port). `repo` is optional + schema-unvalidated; recall-over-
// precision (an exotic form yielding harmless slug-noise never invalidates the block).
// ---------------------------------------------------------------------------
test("repo slug: extracted across common remote-URL forms", () => {
  const cases = [
    ["https://github.com/org/repo.git", "org/repo"],
    ["git@github.com:org/repo.git", "org/repo"],
    ["ssh://git@github.com/org/repo.git", "org/repo"],
    ["https://user:tok@github.com/org/repo.git", "org/repo"],
    ["https://github.com:8080/org/repo.git", "org/repo"],
    ["https://github.com/org/repo", "org/repo"],
  ];
  for (const [url, want] of cases) {
    const dir = tmp();
    try {
      write(dir, ".git/config", `[remote "origin"]\n\turl = ${url}\n`);
      const p = mine(dir);
      assert.equal(p.repo, want, `slug for ${url}`);
      assert.equal(validate(p).code, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("repo slug: omitted when no .git/config remote (unresolvable → omit, still valid)", () => {
  const dir = tmp();
  try {
    write(dir, "README.md", "# x\n");
    const p = mine(dir);
    assert.equal(p.repo, undefined, "repo omitted when unresolvable");
    assert.equal(validate(p).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Slot registration — the public `profile` slot is registered: `slots.profile` is a recognised
// config key, and SLOT_TYPES.profile makes `validate-adapters --configured` lint a swapped-in
// occupant (it must emit the faff-contract:infra-profile block).
// ---------------------------------------------------------------------------
test("slot registration: slots.profile is config-readable (unset → empty, exit 3)", () => {
  const dir = tmp();
  try {
    const r = run(["config", "get", "slots.profile", "--root", dir]);
    assert.equal(r.code, 3, "unset slot resolves with exit 3 (no built-in default skill — like gates)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("slot registration: a conformant configured profile occupant passes the producer-profile lint", () => {
  const dir = tmp();
  try {
    write(dir, "good-acquirer/SKILL.md",
      "# good-acquirer\n\nAn infra-profile acquirer. Emits its `faff-contract:infra-profile` artifact block " +
      "(FAFF-26 schema) which the orchestrator validates and stores.\n");
    write(dir, ".faffrc.yaml", "slots:\n  profile: good-acquirer\n");
    const r = run(["validate-adapters", "--configured", "--root", dir, "--skills-dir", dir]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /pass\s+profile: good-acquirer \(producer-profile\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("slot registration: a configured profile occupant that emits no infra-profile block FAILs the lint", () => {
  const dir = tmp();
  try {
    write(dir, "bad-acquirer/SKILL.md", "# bad-acquirer\n\nScans a repo but never declares the contract block it must emit.\n");
    write(dir, ".faffrc.yaml", "slots:\n  profile: bad-acquirer\n");
    const r = run(["validate-adapters", "--configured", "--root", dir, "--skills-dir", dir]);
    assert.notEqual(r.code, 0, "an acquirer that emits no faff-contract:infra-profile block must fail");
    assert.match(r.out, /faff-contract:infra-profile/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
