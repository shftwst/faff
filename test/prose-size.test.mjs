// FAFF-1442 — skill prose measured in bytes and ratcheted down. Covers the pure comparison, the
// validate-adapters byte ratchet over fixture skills dirs and over a copy of the bundled tree (the
// missing-baseline fail-closed path), `faff prose-size baseline --lower`, `faff prose-size tally` over a
// synthetic git repo, and the committed baseline against the real tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SKILLS = join(REPO, "plugin", "skills");
const CLI = join(SKILLS, "faff", "bin", "faff");
const require = createRequire(import.meta.url);
const prose = require("../plugin/skills/faff/bin/lib/prose-size.js");

const run = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", ...opts });

// A fixture skills dir: demo/SKILL.md, demo/references/notes.md, and faff/prose-baseline.json at exact sizes.
function fixture({ extraBaseline = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "faff-prose-"));
  mkdirSync(join(dir, "demo", "references"), { recursive: true });
  mkdirSync(join(dir, "faff"));
  writeFileSync(join(dir, "demo", "SKILL.md"), "# Demo\n\nA demo skill.\n");
  writeFileSync(join(dir, "demo", "references", "notes.md"), "# Notes\n\nSome reference notes here.\n");
  const files = { ...prose.measure(dir), ...extraBaseline };
  writeFileSync(join(dir, "faff", "prose-baseline.json"), prose.serialiseBaseline(files));
  return dir;
}
const size = (p) => statSync(p).size;
const readBase = (dir) => JSON.parse(readFileSync(join(dir, "faff", "prose-baseline.json"), "utf8")).files;
const validate = (dir) => run(["validate-adapters", "--skills-dir", dir]);

test("compareProse: grew, shrank, equal, unlisted, stale and mixed, sorted by path", () => {
  assert.deepEqual(prose.compareProse({ a: 10 }, { a: 10 }), { fails: [], ratchets: [] });
  assert.deepEqual(prose.compareProse({ a: 12 }, { a: 10 }).fails, [{ path: "a", kind: "grew", bytes: 12, baseline: 10, delta: 2 }]);
  assert.deepEqual(prose.compareProse({ a: 7 }, { a: 10 }), { fails: [], ratchets: [{ path: "a", bytes: 7, baseline: 10, delta: 3 }] });
  assert.deepEqual(prose.compareProse({ a: 1 }, {}).fails, [{ path: "a", kind: "unlisted", bytes: 1 }]);
  assert.deepEqual(prose.compareProse({}, { a: 1 }).fails, [{ path: "a", kind: "stale", baseline: 1 }]);
  const mixed = prose.compareProse({ z: 5, b: 9, c: 1 }, { z: 4, b: 10, d: 3 });
  assert.deepEqual(mixed.fails.map((f) => `${f.path}:${f.kind}`), ["c:unlisted", "d:stale", "z:grew"]);
  assert.deepEqual(mixed.ratchets.map((r) => r.path), ["b"]);
});

test("serialiseBaseline writes sorted keys, one per line, a blank line between entries, and round-trips", () => {
  const text = prose.serialiseBaseline({ "b/SKILL.md": 2, "a/SKILL.md": 1 });
  assert.equal(text, '{\n  "schema": 1,\n  "files": {\n    "a/SKILL.md": 1,\n\n    "b/SKILL.md": 2\n  }\n}\n');
  assert.deepEqual(prose.validateBaseline(JSON.parse(text)), { ok: true, files: { "a/SKILL.md": 1, "b/SKILL.md": 2 } });
});

test("validateBaseline refuses a wrong schema, a non-object files map and a bad value", () => {
  assert.equal(prose.validateBaseline({ schema: 2, files: {} }).ok, false);
  assert.equal(prose.validateBaseline({ schema: 1, files: [] }).ok, false);
  assert.equal(prose.validateBaseline({ schema: 1, files: { a: -1 } }).ok, false);
  assert.equal(prose.validateBaseline({ schema: 1, files: { a: 1.5 } }).ok, false);
  assert.equal(prose.validateBaseline({ schema: 1, files: { a: "3" } }).ok, false);
});

test("coveredFiles: SKILL.md and references/*.md only, not recursive, not other extensions", () => {
  const dir = fixture();
  mkdirSync(join(dir, "demo", "references", "deep"));
  writeFileSync(join(dir, "demo", "references", "deep", "x.md"), "x");
  writeFileSync(join(dir, "demo", "references", "data.json"), "{}");
  writeFileSync(join(dir, "demo", "other.md"), "o");
  assert.deepEqual(prose.coveredFiles(dir), ["demo/SKILL.md", "demo/references/notes.md"]);
  rmSync(dir, { recursive: true, force: true });
});

test("validate-adapters fails a covered file that grows, naming it, its baseline and the delta", () => {
  const dir = fixture();
  const p = join(dir, "demo", "SKILL.md");
  const before = size(p);
  appendFileSync(p, "0123456789");
  const r = validate(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL {2}demo\/SKILL\.md \(prose bytes\)/);
  assert.ok(r.stdout.includes(`demo/SKILL.md is ${before + 10} bytes (baseline ${before}, +10)`), r.stdout);
});

test("validate-adapters prints a RATCHET advisory, exit 0, when a covered file shrinks", () => {
  const dir = fixture();
  const p = join(dir, "demo", "references", "notes.md");
  const body = readFileSync(p, "utf8");
  writeFileSync(p, body.slice(0, body.length - 5));
  const r = validate(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /RATCHET {2}demo\/references\/notes\.md — now \d+ bytes, below baseline \d+ \(-5\)/);
});

test("validate-adapters fails a covered file with no baseline entry, naming its size", () => {
  const dir = fixture();
  writeFileSync(join(dir, "demo", "references", "extra.md"), "extra!");
  const r = validate(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('not in prose-baseline.json; add "demo/references/extra.md": 6'), r.stdout);
});

test("validate-adapters fails a baseline entry whose file is missing", () => {
  const dir = fixture({ extraBaseline: { "gone/SKILL.md": 100 } });
  const r = validate(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL {2}gone\/SKILL\.md \(prose bytes\)/);
  assert.ok(r.stdout.includes("listed in prose-baseline.json but missing; remove the entry"), r.stdout);
});

test("validate-adapters fails a malformed baseline and skips an absent one for an explicit skills dir", () => {
  const dir = fixture();
  writeFileSync(join(dir, "faff", "prose-baseline.json"), "{ not json");
  const bad = validate(dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL {2}prose-baseline\.json \(prose bytes\)/);
  unlinkSync(join(dir, "faff", "prose-baseline.json"));
  const absent = validate(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(absent.status, 0, absent.stdout);
  assert.match(absent.stdout, /INFO {2}prose bytes: no baseline at .*; byte ratchet not applied/);
});

test("a 601-line SKILL.md with a matching byte baseline still fails the line cap", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-prose-"));
  mkdirSync(join(dir, "zz-long"));
  mkdirSync(join(dir, "faff"));
  writeFileSync(join(dir, "zz-long", "SKILL.md"), Array.from({ length: 601 }, (_, i) => `line ${i}`).join("\n"));
  writeFileSync(join(dir, "faff", "prose-baseline.json"), prose.serialiseBaseline(prose.measure(dir)));
  const r = validate(dir);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\(line cap\)/);
  assert.doesNotMatch(r.stdout, /\(prose bytes\)/);
});

test("the bundled tree fails closed when its baseline is missing or malformed (copied tree, no --skills-dir)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-prose-tree-"));
  const copy = join(tmp, "skills");
  cpSync(SKILLS, copy, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes("node_modules") });
  const copyCli = join(copy, "faff", "bin", "faff");
  const baseline = join(copy, "faff", "prose-baseline.json");
  const runCopy = () => spawnSync(process.execPath, [copyCli, "validate-adapters", "--root", REPO], { encoding: "utf8" });
  const intact = runCopy();
  assert.doesNotMatch(intact.stdout, /\(prose bytes\)/, "the intact copy carries no byte-ratchet failure");
  unlinkSync(baseline);
  const missing = runCopy();
  assert.equal(missing.status, 1, missing.stdout);
  assert.match(missing.stdout, /FAIL {2}prose-baseline\.json \(prose bytes\)\n\s+✗ missing/);
  writeFileSync(baseline, '{"schema":1,"files":{"x":"big"}}');
  const malformed = runCopy();
  rmSync(tmp, { recursive: true, force: true });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stdout, /FAIL {2}prose-baseline\.json \(prose bytes\)/);
  assert.ok(existsSyncSafe(join(SKILLS, "faff", "prose-baseline.json")), "the real baseline is never touched");
});

function existsSyncSafe(p) {
  try { statSync(p); return true; } catch { return false; }
}

test("prose-size baseline --lower lowers a shrunk entry, leaves a grown one, reports both, keeps the format", () => {
  const dir = fixture();
  const skill = join(dir, "demo", "SKILL.md");
  const notes = join(dir, "demo", "references", "notes.md");
  const before = readBase(dir);
  appendFileSync(skill, "four");
  const body = readFileSync(notes, "utf8");
  writeFileSync(notes, body.slice(0, body.length - 6));
  const r = run(["prose-size", "baseline", "--skills-dir", dir, "--lower", "--json"]);
  const after = readBase(dir);
  const text = readFileSync(join(dir, "faff", "prose-baseline.json"), "utf8");
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(after["demo/references/notes.md"], before["demo/references/notes.md"] - 6);
  assert.equal(after["demo/SKILL.md"], before["demo/SKILL.md"]);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.grown.map((g) => g.path), ["demo/SKILL.md"]);
  assert.deepEqual(out.lowered.map((l) => l.path), ["demo/references/notes.md"]);
  assert.equal(text, prose.serialiseBaseline(after));
});

test("prose-size baseline --lower never adds or removes an entry, and refuses without --lower or a baseline", () => {
  const dir = fixture({ extraBaseline: { "gone/SKILL.md": 9 } });
  writeFileSync(join(dir, "demo", "references", "new.md"), "new");
  const r = run(["prose-size", "baseline", "--skills-dir", dir, "--lower", "--json"]);
  const after = readBase(dir);
  assert.equal(r.status, 0);
  assert.equal(after["gone/SKILL.md"], 9);
  assert.equal(after["demo/references/new.md"], undefined);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.missing.map((m) => m.path), ["gone/SKILL.md"]);
  assert.deepEqual(out.unlisted.map((u) => u.path), ["demo/references/new.md"]);
  assert.equal(run(["prose-size", "baseline", "--skills-dir", dir]).status, 2);
  unlinkSync(join(dir, "faff", "prose-baseline.json"));
  assert.equal(run(["prose-size", "baseline", "--skills-dir", dir, "--lower"]).status, 2);
  rmSync(dir, { recursive: true, force: true });
});

// A synthetic repo: A adds x/SKILL.md (100 bytes); B grows it to 160 (FAFF-1); C shrinks it to 130 and adds
// x/references/r.md (20) (FAFF-2); D deletes r.md and adds an uncovered file (FAFF-3).
function syntheticRepo() {
  const repo = mkdtempSync(join(tmpdir(), "faff-prose-git-"));
  const git = (...a) => {
    const r = spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  const skill = join(repo, "plugin", "skills", "x");
  mkdirSync(join(skill, "references"), { recursive: true });
  const commit = (msg) => { git("add", "-A"); git("commit", "-q", "-m", msg); return git("rev-parse", "HEAD"); };
  writeFileSync(join(skill, "SKILL.md"), "a".repeat(100));
  const A = commit("base");
  writeFileSync(join(skill, "SKILL.md"), "a".repeat(160));
  const B = commit("feat: grow (FAFF-1)");
  writeFileSync(join(skill, "SKILL.md"), "a".repeat(130));
  writeFileSync(join(skill, "references", "r.md"), "r".repeat(20));
  const C = commit("feat: trim (FAFF-2) (#9)");
  unlinkSync(join(skill, "references", "r.md"));
  writeFileSync(join(skill, "notes.txt"), "n".repeat(50));
  const D = commit("chore: drop r (FAFF-3)");
  return { repo, A, B, C, D };
}

test("prose-size tally reports rows, start, end, net, groups and other from git history", () => {
  const { repo, A, C } = syntheticRepo();
  const r = run(["prose-size", "tally", "--repo", repo, "--from", A, "--to", C, "--group", "ext=FAFF-2", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const t = JSON.parse(r.stdout);
  assert.equal(t.start_bytes, 100);
  assert.equal(t.end_bytes, 150);
  assert.equal(t.net, 50);
  assert.deepEqual(t.rows.map((row) => [row.ticket, row.delta, row.total]), [["FAFF-1", 60, 160], ["FAFF-2", -10, 150]]);
  assert.deepEqual(t.rows[1].files, { "x/SKILL.md": -30, "x/references/r.md": 20 });
  assert.deepEqual(t.groups, [{ label: "ext", tickets: ["FAFF-2"], net: -10 }]);
  assert.equal(t.other_net, 60);
  rmSync(repo, { recursive: true, force: true });
});

test("prose-size tally counts a deleted file to 0, ignores uncovered files, and prints a text form", () => {
  const { repo, A, D } = syntheticRepo();
  const t = JSON.parse(run(["prose-size", "tally", "--repo", repo, "--from", A, "--to", D, "--json"]).stdout);
  const last = t.rows[t.rows.length - 1];
  assert.equal(last.ticket, "FAFF-3");
  assert.deepEqual(last.files, { "x/references/r.md": -20 });
  assert.equal(t.end_bytes, 130);
  const text = run(["prose-size", "tally", "--repo", repo, "--from", A, "--to", D]);
  assert.equal(text.status, 0);
  assert.match(text.stdout, /^start 100$/m);
  assert.match(text.stdout, /^end 130$/m);
  assert.match(text.stdout, /^net \+30$/m);
  assert.equal(run(["prose-size", "tally", "--repo", repo, "--from", "no-such-ref", "--to", D]).status, 2);
  assert.equal(run(["prose-size", "tally", "--repo", repo, "--from", A, "--to", D, "--group", "bad"]).status, 2);
  rmSync(repo, { recursive: true, force: true });
});

test("ticketOf takes the last parenthesised key; parseLsTree keeps covered blobs in scope", () => {
  assert.equal(prose.ticketOf("feat: trim (FAFF-2) (#9)"), "FAFF-2");
  assert.equal(prose.ticketOf("a (FAFF-1) then (FAFF-7)"), "FAFF-7");
  assert.equal(prose.ticketOf("no ticket here"), "untagged");
  const ls = [
    "100644 blob aaa     120\tplugin/skills/faff-graft/SKILL.md",
    "100644 blob bbb      30\tplugin/skills/faff/references/kernel.md",
    "100644 blob ccc      10\tplugin/skills/faff/bin/faff",
  ].join("\n");
  assert.deepEqual(prose.parseLsTree(ls, "all"), { "faff-graft/SKILL.md": 120, "faff/references/kernel.md": 30 });
  assert.deepEqual(prose.parseLsTree(ls, "hot"), { "faff-graft/SKILL.md": 120 });
});

test("the committed baseline equals the real tree exactly, entry for entry", () => {
  const measured = prose.measure(SKILLS);
  const base = readBase(SKILLS);
  assert.deepEqual(Object.keys(base).sort(), Object.keys(measured).sort(), "the entry set equals the covered set");
  for (const [rel, bytes] of Object.entries(measured)) assert.equal(base[rel], bytes, `${rel} sits exactly at its baseline`);
  assert.equal(readFileSync(join(SKILLS, "faff", "prose-baseline.json"), "utf8"), prose.serialiseBaseline(base));
});

test(".gitattributes keeps git from converting line endings in every covered file", () => {
  const files = prose.coveredFiles(SKILLS).map((rel) => `plugin/skills/${rel}`);
  const r = spawnSync("git", ["-C", REPO, "check-attr", "text", "--", ...files], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, files.length);
  for (const line of lines) assert.match(line, /: text: unset$/, line);
});
