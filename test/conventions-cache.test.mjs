// FAFF-1068 — persist the .faff/conventions.json cache. Covers the mine/get/show CLI cache
// round-trip against tmp dirs (mine writes a cache; get hits on a fingerprint match,
// re-derives on a mismatch/torn file; show treats a stale-schema/torn file as absent/stale), the
// byte-identical no-cache fallback, and the pure exports (schema, fingerprint, validator).
// FAFF-1082 — extends the same cache with a `rules` manifest (repository rule-file discovery,
// schema bumped 2 -> 3); see the tests below that section.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import {
  CONVENTIONS_SCHEMA,
  computeSourceFingerprint,
  validateConventionSet,
  mineConventions,
} from "../plugin/skills/faff/bin/lib/conventions.js";

function tmp() { return mkdtempSync(join(tmpdir(), "faff-conv-cache-")); }
function cachePath(root) { return join(root, ".faff", "conventions.json"); }
function readCache(root) { return JSON.parse(readFileSync(cachePath(root), "utf8")); }

test("mine writes a schema-2 .faff/conventions.json that validates", () => {
  const root = tmp();
  try {
    const r = runCli(["conventions", "mine", "--root", root]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(cachePath(root)), "cache file exists");
    const c = readCache(root);
    assert.equal(c.schema, CONVENTIONS_SCHEMA);
    assert.equal(typeof c.source_fingerprint, "string");
    assert.ok(c.git_signal && "head" in c.git_signal && "branches" in c.git_signal);
    assert.equal(validateConventionSet(c).length, 0, JSON.stringify(validateConventionSet(c)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mine --refresh behaves like mine (always rewrites)", () => {
  const root = tmp();
  try {
    assert.equal(runCli(["conventions", "mine", "--refresh", "--root", root]).code, 0);
    assert.equal(readCache(root).schema, CONVENTIONS_SCHEMA);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("get returns the cached value on a fingerprint match (no re-derive)", () => {
  const root = tmp();
  try {
    runCli(["conventions", "mine", "--root", root]);
    // Plant a NON-default value under the (still-matching) fingerprint. Re-derivation on this
    // empty repo would give the default 'issue-slug', so reading back 'slash-scoped' proves the
    // cache was read, not re-derived.
    const c = readCache(root);
    c.branch_naming.value = "slash-scoped";
    c.branch_naming.source = "documented";
    c.branch_naming.evidence = [{ kind: "doc-file", ref: "planted", detail: "planted" }];
    writeFileSync(cachePath(root), JSON.stringify(c, null, 2));
    const r = runCli(["conventions", "get", "branch_naming", "--root", root]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "slash-scoped");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("get re-derives on a fingerprint mismatch (and refreshes the cache)", () => {
  const root = tmp();
  try {
    runCli(["conventions", "mine", "--root", root]);
    const c = readCache(root);
    c.branch_naming.value = "slash-scoped";      // stale planted value
    c.source_fingerprint = "0".repeat(64);       // deliberately mismatched
    writeFileSync(cachePath(root), JSON.stringify(c, null, 2));
    const r = runCli(["conventions", "get", "branch_naming", "--root", root]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "issue-slug", "re-derived the real default, ignoring the stale cache");
    // the miss refreshed the cache with a matching fingerprint
    assert.equal(readCache(root).source_fingerprint, computeSourceFingerprint(root, {}));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("get treats a torn (invalid-JSON) cache as absent -> re-derives, never crashes", () => {
  const root = tmp();
  try {
    runCli(["conventions", "mine", "--root", root]);
    writeFileSync(cachePath(root), "{ not valid json");
    const r = runCli(["conventions", "get", "commit_subject", "--root", root]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "conventional");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("get is byte-identical to the pre-cache default on a no-cache repo (all three keys, plain + --json)", () => {
  const root = tmp();
  try {
    assert.equal(runCli(["conventions", "get", "branch_naming", "--root", root]).stdout.trim(), "issue-slug");
    assert.equal(runCli(["conventions", "get", "commit_subject", "--root", root]).stdout.trim(), "conventional");
    assert.equal(runCli(["conventions", "get", "pr_title", "--root", root]).stdout.trim(), "conventional");
    const j = JSON.parse(runCli(["conventions", "get", "branch_naming", "--json", "--root", root]).stdout);
    assert.deepEqual(j, { key: "branch_naming", value: "issue-slug", source: "default", confidence: "low", evidence: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("get -d overrides only when resolution falls to the default tier (parity with pre-cache)", () => {
  const root = tmp();
  try {
    const r = runCli(["conventions", "get", "branch_naming", "-d", "tracker-hint", "--root", root]);
    assert.equal(r.stdout.trim(), "tracker-hint");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("show reads a schema-2 cache (exit 0)", () => {
  const root = tmp();
  try {
    runCli(["conventions", "mine", "--root", root]);
    const r = runCli(["conventions", "show", "--root", root]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).schema, CONVENTIONS_SCHEMA);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("show treats a schema-1 cache as absent/stale (exit 3, no crash)", () => {
  const root = tmp();
  try {
    runCli(["conventions", "mine", "--root", root]);
    writeFileSync(cachePath(root), JSON.stringify({ schema: 1, generated_at: "t" }));
    const r = runCli(["conventions", "show", "--root", root]);
    assert.equal(r.code, 3, "schema-1 with no override reads as never-mined");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("show keeps exit-2 on a torn (invalid-JSON) cache", () => {
  const root = tmp();
  try {
    runCli(["conventions", "mine", "--root", root]);
    writeFileSync(cachePath(root), "{ not json");
    const r = runCli(["conventions", "show", "--root", root]);
    assert.equal(r.code, 2, "malformed JSON is a loud exit-2, not silently absent");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("computeSourceFingerprint is deterministic for unchanged inputs", () => {
  const root = tmp();
  try {
    assert.equal(computeSourceFingerprint(root, {}), computeSourceFingerprint(root, {}));
    // a mined set's stored fingerprint matches a fresh recompute
    const set = mineConventions(root, {});
    assert.equal(set.source_fingerprint, computeSourceFingerprint(root, {}));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("validateConventionSet accepts the current schema and rejects other schemas", () => {
  const set = mineConventions(tmpdir(), {});
  assert.equal(set.schema, CONVENTIONS_SCHEMA);
  assert.equal(validateConventionSet(set).length, 0);
  assert.ok(validateConventionSet({ ...set, schema: 1 }).length > 0, "schema 1 is stale/invalid");
  assert.ok(validateConventionSet({ ...set, schema: CONVENTIONS_SCHEMA + 1 }).length > 0, "a future/unknown schema is invalid");
});

// --- FAFF-1082: repository rule-file discovery (.claude/rules/, CLAUDE.md) ---

test("mine discovers .claude/rules/*.md and CLAUDE.md as a rules manifest (schema 3)", () => {
  const root = tmp();
  try {
    mkdirSync(join(root, ".claude", "rules", "managed"), { recursive: true });
    writeFileSync(join(root, ".claude", "rules", "managed", "documentation.md"), "# doc standards\n");
    writeFileSync(join(root, "CLAUDE.md"), "# rules load automatically\n");

    const r = runCli(["conventions", "mine", "--json", "--root", root]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);

    assert.equal(parsed.schema, 3);
    assert.ok(Array.isArray(parsed.rules), "top-level rules array present");

    const docEntry = parsed.rules.find((e) => e.key === ".claude/rules/managed/documentation.md");
    assert.ok(docEntry, "documentation.md discovered");
    assert.equal(docEntry.value, ".claude/rules/managed/documentation.md");
    assert.equal(docEntry.source, "discovered");
    assert.equal(docEntry.confidence, "high");
    assert.deepEqual(docEntry.evidence, [{ kind: "rule-file", ref: ".claude/rules/managed/documentation.md", detail: ".claude/rules/managed/documentation.md discovered as a repository rule file" }]);

    const claudeEntry = parsed.rules.find((e) => e.key === "CLAUDE.md");
    assert.ok(claudeEntry, "CLAUDE.md discovered");
    assert.equal(claudeEntry.source, "discovered");
    assert.equal(claudeEntry.confidence, "high");

    assert.equal(validateConventionSet(parsed).length, 0, JSON.stringify(validateConventionSet(parsed)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mine on a repo with no rule files emits an empty rules array, not a missing field", () => {
  const root = tmp();
  try {
    const r = runCli(["conventions", "mine", "--json", "--root", root]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed.rules, []);
    assert.equal(validateConventionSet(parsed).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("adding rule files does not shift branch_naming / commit_subject / pr_title resolution", () => {
  const root = tmp();
  try {
    writeFileSync(join(root, "CONTRIBUTING.md"), "Branch naming: use <issue>-<slug> for every feature branch.\n");
    const before = JSON.parse(runCli(["conventions", "mine", "--json", "--root", root]).stdout);

    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    writeFileSync(join(root, ".claude", "rules", "general.md"), "# general working rules\n");
    writeFileSync(join(root, "CLAUDE.md"), "# rules load automatically\n");
    const after = JSON.parse(runCli(["conventions", "mine", "--json", "--root", root]).stdout);

    assert.deepEqual(after.branch_naming, before.branch_naming);
    assert.deepEqual(after.commit_subject, before.commit_subject);
    assert.deepEqual(after.pr_title, before.pr_title);
    assert.ok(after.rules.length > before.rules.length, "the rules manifest itself did grow");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("show passes the rules field through untouched", () => {
  const root = tmp();
  try {
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    writeFileSync(join(root, ".claude", "rules", "general.md"), "# general working rules\n");
    runCli(["conventions", "mine", "--root", root]);
    const shown = JSON.parse(runCli(["conventions", "show", "--root", root]).stdout);
    assert.deepEqual(shown.rules, readCache(root).rules);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a schema-2 cache (pre-FAFF-1082, no rules field) reads as stale and re-mines with schema 3", () => {
  const root = tmp();
  try {
    runCli(["conventions", "mine", "--root", root]);
    const c = readCache(root);
    delete c.rules;
    c.schema = 2;
    writeFileSync(cachePath(root), JSON.stringify(c, null, 2));
    const r = runCli(["conventions", "get", "branch_naming", "--root", root]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(readCache(root).schema, 3, "the stale schema-2 cache was re-mined to schema 3");
    assert.ok(Array.isArray(readCache(root).rules));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
