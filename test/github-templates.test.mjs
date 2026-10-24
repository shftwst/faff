// FAFF-1112 — `faff github-templates scan` is the pure offline GitHub issue-template scanner. These
// drive the REAL CLI against throwaway trees and assert the spec's scenarios: type bucketing,
// the bare-file universal rule, config.yml exclusion, the default-type path, local label
// normalisation, ordering, and the purity/registration invariants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin");
const CLI = join(BIN, "faff");
const MODULE = join(BIN, "lib", "github-templates.js");
const TYPES = ["bug", "feature", "spike", "chore", "epic", "default"];

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "faff1112-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
const fm = (lines, body = "## Repro\n## Expected\n") => `---\n${lines.join("\n")}\n---\n${body}`;

function scan(root, ...extra) {
  const r = spawnSync(process.execPath, [CLI, "github-templates", "scan", "--json", "--root", root, ...extra], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr, json: r.status === 0 ? JSON.parse(r.stdout) : null };
}

test("smoke: bug_report.md lands in the bug set with normalised flow labels", () => {
  const root = tree({ ".github/ISSUE_TEMPLATE/bug_report.md": fm(["name: Bug report", "about: Report a defect", "labels: [bug, triage]"]) });
  const r = scan(root, "--type", "bug");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.candidates.length, 1);
  const c = r.json.candidates[0];
  assert.equal(c.path, ".github/ISSUE_TEMPLATE/bug_report.md");
  assert.equal(c.type, "bug");
  assert.equal(c.universal, false);
  assert.deepEqual(c.labels, ["bug", "triage"]);
  assert.deepEqual(r.json.dropped, []);
});

test("no templates at all: exit 0, zero candidates, zero notes", () => {
  const r = scan(tree({ "README.md": "x" }));
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.candidates, []);
  assert.deepEqual(r.json.notes, []);
});

test("config.yml only: dropped as excluded-config, bare arm still evaluated", () => {
  const only = scan(tree({ ".github/ISSUE_TEMPLATE/config.yml": "blank_issues_enabled: false\n" }));
  assert.deepEqual(only.json.candidates, []);
  assert.deepEqual(only.json.dropped, [{ path: ".github/ISSUE_TEMPLATE/config.yml", reason: "excluded-config" }]);
  const withBare = scan(tree({ ".github/ISSUE_TEMPLATE/config.yaml": "x: 1\n", ".github/ISSUE_TEMPLATE.md": "generic\n" }));
  assert.equal(withBare.json.candidates.length, 1);
  assert.equal(withBare.json.candidates[0].universal, true);
});

test("directory-form file with no signal is dropped, never universal", () => {
  const r = scan(tree({ ".github/ISSUE_TEMPLATE/notes.md": fm(["name: Notes"]) }));
  assert.deepEqual(r.json.candidates, []);
  assert.deepEqual(r.json.dropped, [{ path: ".github/ISSUE_TEMPLATE/notes.md", reason: "unclassified" }]);
});

test("bare fence-less file is a universal candidate in all six type sets", () => {
  const root = tree({ ".github/ISSUE_TEMPLATE.md": "## Describe\n" });
  for (const t of TYPES) {
    const r = scan(root, "--type", t);
    assert.equal(r.json.candidates.length, 1, t);
    assert.equal(r.json.candidates[0].type, null);
    assert.equal(r.json.candidates[0].universal, true);
    assert.equal(r.json.candidates[0].form, "bare");
  }
});

test("--type default with only typed directory templates is empty", () => {
  const r = scan(tree({ ".github/ISSUE_TEMPLATE/bug.md": fm(["name: Bug"]) }), "--type", "default");
  assert.deepEqual(r.json.candidates, []);
});

test("holdout: a classifying bare file is a single-type candidate", () => {
  const root = tree({ ".github/ISSUE_TEMPLATE.md": fm(["name: Bug report"]) });
  const all = scan(root).json.candidates;
  assert.equal(all[0].type, "bug");
  assert.equal(all[0].universal, false);
  assert.deepEqual(scan(root, "--type", "feature").json.candidates, []);
});

test("holdout: RFC proposal classifies spike, not feature", () => {
  const root = tree({ ".github/ISSUE_TEMPLATE/rfc.md": fm(["name: RFC proposal"]) });
  assert.equal(scan(root).json.candidates[0].type, "spike");
  assert.deepEqual(scan(root, "--type", "feature").json.candidates, []);
});

test("signal precedence is labels, then name, then about", () => {
  const root = tree({
    ".github/ISSUE_TEMPLATE/a.md": fm(["name: Bug report", "labels: [chore]"]),
    ".github/ISSUE_TEMPLATE/b.md": fm(["name: Feature", "about: a bug"]),
  });
  const byPath = Object.fromEntries(scan(root).json.candidates.map((c) => [c.path, c.type]));
  assert.equal(byPath[".github/ISSUE_TEMPLATE/a.md"], "chore");
  assert.equal(byPath[".github/ISSUE_TEMPLATE/b.md"], "feature");
});

test("labels shapes all normalise to the same list", () => {
  const shapes = ["labels: [bug, triage]", 'labels: ["bug","triage"]', "labels: '[bug, triage]'"];
  for (const line of shapes) {
    const r = scan(tree({ ".github/ISSUE_TEMPLATE/x.md": fm([line, "name: x"]) }));
    assert.deepEqual(r.json.candidates[0].labels, ["bug", "triage"], line);
  }
  const block = scan(tree({ ".github/ISSUE_TEMPLATE/x.md": fm(["labels:", "  - bug", "  - triage"]) }));
  assert.deepEqual(block.json.candidates[0].labels, ["bug", "triage"]);
  const scalar = scan(tree({ ".github/ISSUE_TEMPLATE/x.md": fm(["labels: bug"]) }));
  assert.deepEqual(scalar.json.candidates[0].labels, ["bug"]);
  for (const line of ["labels: []", "labels: true", "labels: 3"]) {
    const r = scan(tree({ ".github/ISSUE_TEMPLATE/x.md": fm([line, "name: Bug"]) }));
    assert.deepEqual(r.json.candidates[0].labels, [], line);
  }
});

test("ordering, no dedup, non-markdown and nested handling", () => {
  const root = tree({
    ".github/ISSUE_TEMPLATE/z.md": fm(["name: Bug"]),
    ".github/ISSUE_TEMPLATE/a.md": fm(["name: Bug"]),
    ".github/ISSUE_TEMPLATE/form.yml": "name: Form\n",
    ".github/ISSUE_TEMPLATE/nested/x.md": fm(["name: Bug"]),
    ".github/ISSUE_TEMPLATE.md": "generic\n",
  });
  const r = scan(root);
  assert.deepEqual(r.json.candidates.map((c) => c.path),
    [".github/ISSUE_TEMPLATE/a.md", ".github/ISSUE_TEMPLATE/z.md", ".github/ISSUE_TEMPLATE.md"]);
  assert.deepEqual(r.json.dropped, [{ path: ".github/ISSUE_TEMPLATE/form.yml", reason: "not-markdown" }]);
  assert.equal(scan(root).out, r.out, "byte-identical across runs");
  assert.equal(scan(root, "--type", "bug").json.candidates.length, 3);
  for (const c of r.json.candidates) {
    assert.equal(c.universal, c.type === null);
    if (c.universal) assert.equal(c.form, "bare");
  }
});

test("a fence-less body is not read as key lines", () => {
  const r = scan(tree({ ".github/ISSUE_TEMPLATE/p.md": "# Title\nname: Bug\nlabels: [bug]\n" }));
  assert.deepEqual(r.json.candidates, []);
});

test("an unreadable file is dropped, noted, and the scan continues", { skip: process.getuid?.() === 0 }, () => {
  const root = tree({ ".github/ISSUE_TEMPLATE/ok.md": fm(["name: Bug"]), ".github/ISSUE_TEMPLATE/locked.md": fm(["name: Bug"]) });
  chmodSync(join(root, ".github/ISSUE_TEMPLATE/locked.md"), 0o000);
  const r = scan(root);
  assert.equal(r.code, 0);
  assert.equal(r.json.candidates.length, 1);
  assert.deepEqual(r.json.dropped, [{ path: ".github/ISSUE_TEMPLATE/locked.md", reason: "unreadable" }]);
  assert.equal(r.json.notes.length, 1);
});

test("output is independent of tracking.tracker", () => {
  const files = { ".github/ISSUE_TEMPLATE/bug.md": fm(["name: Bug"]) };
  const a = scan(tree({ ...files, ".faff/config.yaml": "tracking:\n  tracker: linear\n" }));
  const b = scan(tree({ ...files, ".faff/config.yaml": "tracking:\n  tracker: github\n" }));
  const strip = (r) => JSON.stringify({ ...r.json, root: null });
  assert.equal(strip(a), strip(b));
});

test("unknown --type is a usage error (exit 2) and emits no candidate set", () => {
  const r = scan(tree({}), "--type", "bogus");
  assert.equal(r.code, 2);
  assert.equal(r.out, "");
  assert.match(r.err, /unknown faff type 'bogus'/);
});

test("module purity: fixed require set, no literal taxonomy list, one region banner", () => {
  const src = readFileSync(MODULE, "utf8");
  const reqs = [...src.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(reqs, ["./argv", "./native-map", "./shared-infra", "node:fs", "node:path"]);
  assert.ok(!/\bbug\W{1,4}feature\W{1,4}spike\b/i.test(src), "taxonomy must come from FAFF_TYPES");
  assert.ok(!/\bchore\W{1,4}epic\W{1,4}default\b/i.test(src), "taxonomy must come from FAFF_TYPES");
  assert.equal((src.match(/^\/\/ === region:factory — github-templates — FAFF-1112/gm) || []).length, 1);
});

test("selftest passes", () => {
  const r = spawnSync(process.execPath, [CLI, "github-templates", "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /RESULT: PASS/);
});
