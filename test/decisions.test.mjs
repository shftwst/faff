// FAFF-448 — the `faff decisions` subcommand: deterministic mechanics over a single committed
// docs/decisions.md (match / list / validate). Read-only; the register itself is never written
// by this CLI. Mirrors test/adr.test.mjs's spawnSync-the-real-BIN shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const run = (args, cwd = REPO) => spawnSync(process.execPath, [BIN, "decisions", ...args], { cwd, encoding: "utf8" });

// A temp repo root with docs/decisions.md holding the given body (or none at all).
function tmpRepo(body) {
  const root = mkdtempSync(join(tmpdir(), "faff-decisions-it-"));
  if (body != null) {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "decisions.md"), body);
  }
  return root;
}

const loggingEntry =
  "## Logging library\n" +
  "- Chosen: pino\n" +
  "- Rationale: pino is the house structured-JSON logger; already used app-wide since the platform slice shipped.\n" +
  "- Scope: all backend services; excludes the CLI (which writes plain stdout).\n" +
  "- Matches: pino vs winston; logging library; which logger\n" +
  "- Date: 2026-07-11\n";

test("match: exact-equal hit returns {id, chosen, rationale, scope}", () => {
  const root = tmpRepo(loggingEntry);
  const r = run(["match", "--punt", "pino vs winston", "--json", "--root", root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.id, "logging-library");
  assert.equal(out.chosen, "pino");
  assert.match(out.rationale, /structured-JSON logger/);
  assert.match(out.scope, /all backend services/);
  rmSync(root, { recursive: true, force: true });
});

test("match: no declared key -> {match: null}, exit 0 (not an error)", () => {
  const root = tmpRepo(loggingEntry);
  const r = run(["match", "--punt", "redis vs memcached", "--json", "--root", root]);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { match: null });
  rmSync(root, { recursive: true, force: true });
});

test("match: containment never fires — a declared key contained in a longer, unrelated punt returns no-match", () => {
  const root = tmpRepo(loggingEntry);
  const r = run(["match", "--punt", "structured logging library for the audit subsystem", "--json", "--root", root]);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { match: null });
  rmSync(root, { recursive: true, force: true });
});

test("match: ambiguous — two entries equal-matching the same normalized topic -> no-match", () => {
  const body =
    "## Logging library\n- Chosen: pino\n- Rationale: r1\n- Scope: s1\n- Matches: which logger\n- Date: 2026-07-11\n\n" +
    "## Logging library redux\n- Chosen: bunyan\n- Rationale: r2\n- Scope: s2\n- Matches: which logger\n- Date: 2026-07-12\n";
  const root = tmpRepo(body);
  const r = run(["match", "--punt", "which logger", "--json", "--root", root]);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { match: null });
  rmSync(root, { recursive: true, force: true });
});

test("match: absent docs/decisions.md -> clean no-match, exit 0", () => {
  const root = tmpRepo(null);
  const r = run(["match", "--punt", "anything", "--json", "--root", root]);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { match: null });
  rmSync(root, { recursive: true, force: true });
});

test("match: normalizes case/whitespace/punctuation before comparing", () => {
  const root = tmpRepo(loggingEntry);
  const r = run(["match", "--punt", "  Pino   VS   Winston?  ", "--json", "--root", root]);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).id, "logging-library");
  rmSync(root, { recursive: true, force: true });
});

test("list --json: enumerates id/topic/chosen/date", () => {
  const root = tmpRepo(loggingEntry);
  const r = run(["list", "--json", "--root", root]);
  assert.equal(r.status, 0);
  const arr = JSON.parse(r.stdout);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].id, "logging-library");
  assert.equal(arr[0].topic, "Logging library");
  assert.equal(arr[0].chosen, "pino");
  assert.equal(arr[0].date, "2026-07-11");
  rmSync(root, { recursive: true, force: true });
});

test("list: absent register -> empty, exit 0", () => {
  const root = tmpRepo(null);
  const r = run(["list", "--json", "--root", root]);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), []);
  rmSync(root, { recursive: true, force: true });
});

test("validate: passes a clean entry", () => {
  const root = tmpRepo(loggingEntry);
  const r = run(["validate", "--root", root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^OK —/m);
  rmSync(root, { recursive: true, force: true });
});

test("validate: fails on a missing required field", () => {
  const body = "## Storage engine\n- Chosen: postgres\n- Rationale: r\n- Matches: db choice\n- Date: 2026-07-11\n";
  const root = tmpRepo(body);
  const r = run(["validate", "--root", root]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Scope/);
  rmSync(root, { recursive: true, force: true });
});

test("validate: fails on an empty Matches list", () => {
  const body = "## Storage engine\n- Chosen: postgres\n- Rationale: r\n- Scope: s\n- Date: 2026-07-11\n";
  const root = tmpRepo(body);
  const r = run(["validate", "--root", root]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Matches must be non-empty/);
  rmSync(root, { recursive: true, force: true });
});

test("validate: fails on a duplicate citation id", () => {
  const body =
    "## Logging Library\n- Chosen: pino\n- Rationale: r\n- Scope: s\n- Matches: m1\n- Date: 2026-07-11\n\n" +
    "## logging library\n- Chosen: bunyan\n- Rationale: r2\n- Scope: s2\n- Matches: m2\n- Date: 2026-07-12\n";
  const root = tmpRepo(body);
  const r = run(["validate", "--root", root]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /duplicate citation id/);
  rmSync(root, { recursive: true, force: true });
});

test("validate: absent register -> clean OK, 0 entries", () => {
  const root = tmpRepo(null);
  const r = run(["validate", "--root", root]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^OK — 0 decision\(s\)/m);
  rmSync(root, { recursive: true, force: true });
});

test("--selftest passes", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("no docs/decisions.md in the real repo is not an error — CLI performs no tracker/network access", () => {
  // The real repo may or may not carry a register yet; either way match/list/validate must not crash.
  const m = run(["match", "--punt", "anything", "--json"]);
  assert.equal(m.status, 0);
  const l = run(["list", "--json"]);
  assert.equal(l.status, 0);
});

test("regression: the real repo's docs/decisions.md (if any) validates clean", () => {
  const r = run(["validate"]);
  assert.equal(r.status, 0, `shipped docs/decisions.md must validate:\n${r.stdout}`);
  assert.match(r.stdout, /^OK —/m);
});
