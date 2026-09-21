// FAFF-1068 — persist the .faff/conventions.json cache. Covers the mine/get/show CLI cache
// round-trip against tmp dirs (mine writes a schema-2 cache; get hits on a fingerprint match,
// re-derives on a mismatch/torn file; show treats a schema-1/torn file as absent/stale), the
// byte-identical no-cache fallback, and the pure exports (schema, fingerprint, validator).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

test("validateConventionSet accepts schema 2 and rejects other schemas", () => {
  const set = mineConventions(tmpdir(), {});
  assert.equal(set.schema, CONVENTIONS_SCHEMA);
  assert.equal(validateConventionSet(set).length, 0);
  assert.ok(validateConventionSet({ ...set, schema: 1 }).length > 0, "schema 1 is stale/invalid");
  assert.ok(validateConventionSet({ ...set, schema: 3 }).length > 0, "schema 3 is invalid");
});
