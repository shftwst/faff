// FAFF-1262 — declaredEffectViolations: the committed corpus passes it, and the one writer obeys it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEffectEntries, declaredEffectViolations } from "../plugin/skills/faff/bin/lib/effects.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");

function committedLedgerLines() {
  const files = execFileSync("git", ["ls-files", ".faff/anchors/*/*/declared-effects.jsonl"], { cwd: REPO, encoding: "utf8" })
    .split("\n").filter(Boolean);
  return files.flatMap((file) => execFileSync("git", ["show", `HEAD:${file}`], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n")
    .map((text, i) => ({ file, line: i + 1, text }))
    .filter(({ text }) => text.trim() !== ""));
}

function mkRunDir() {
  const root = mkdtempSync(join(tmpdir(), "declared-effect-"));
  const runDir = join(root, "run-smoke");
  mkdirSync(runDir);
  return { root, runDir, ledger: join(runDir, "declared-effects.jsonl") };
}

function runCli(args, input) {
  try {
    const out = execFileSync("node", [CLI, ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out, err: "" };
  } catch (e) {
    return { code: e.status, out: String(e.stdout), err: String(e.stderr) };
  }
}

test("every committed declared-effects line passes declaredEffectViolations", () => {
  const lines = committedLedgerLines();
  const schemas = new Set();
  const failures = [];
  for (const { file, line, text } of lines) {
    let rec;
    try {
      rec = JSON.parse(text);
    } catch {
      failures.push(`${file}:${line}: not valid JSON`);
      continue;
    }
    schemas.add(rec.schema);
    const violations = declaredEffectViolations(rec);
    if (violations.length) failures.push(`${file}:${line}: ${violations.join("; ")}`);
  }
  assert.deepEqual(failures, []);
  assert.ok(lines.length >= 1022, `corpus holds ${lines.length} lines, expected at least 1022`);
  assert.deepEqual([...schemas].sort(), [1, 2, 3]);
});

test("a bad recordFields bag aborts the whole batch and leaves the ledger byte-identical", () => {
  const { root, runDir, ledger } = mkRunDir();
  try {
    const d = { kind: "pr-create", target: "main", reversible: true };
    appendEffectEntries(runDir, "declare", "FAFF-1", "pr-create", [d, d], undefined, { origin: "x" });
    const before = readFileSync(ledger);
    const result = appendEffectEntries(runDir, "declare", "FAFF-1", "pr-create", [d, d], undefined, { origin: "x", extra: 1 });
    assert.deepEqual(result, { violations: [{ index: 0, violations: ['unexpected field "extra"'], scope: "record" }] });
    assert.ok(readFileSync(ledger).equals(before));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("smoke: an auto-declared pr-create record validates and the chain verifies", () => {
  const { root, runDir } = mkRunDir();
  try {
    const result = appendEffectEntries(runDir, "declare", "FAFF-1", "pr-create",
      [{ kind: "pr-create", target: "main", reversible: true }], undefined,
      { origin: "pr-create-auto", github_actor: { login: null, source: "ambient" } });
    assert.equal(result.written.length, 1);
    assert.deepEqual(declaredEffectViolations(result.written[0]), []);
    assert.equal(runCli(["effects", "verify", "--run-dir", runDir]).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("cmdEffects labels an empty --issue record[0] and a bad descriptor descriptor[0]", () => {
  const { root, runDir, ledger } = mkRunDir();
  try {
    const emptyIssue = runCli(["effects", "declare", "--run-dir", runDir, "--issue", "", "--step", "build"],
      JSON.stringify([{ kind: "merge", target: "pr:1" }]));
    assert.equal(emptyIssue.code, 1);
    assert.ok(emptyIssue.err.includes("- record[0]: issue must be a non-empty string\n"), emptyIssue.err);
    assert.equal(existsSync(ledger), false);

    const badDescriptor = runCli(["effects", "declare", "--run-dir", runDir, "--issue", "FAFF-1", "--step", "build"],
      JSON.stringify([{ kind: "merge" }]));
    assert.equal(badDescriptor.code, 1);
    assert.equal(badDescriptor.err, "- descriptor[0]: missing or empty target\n");
    assert.equal(existsSync(ledger), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
