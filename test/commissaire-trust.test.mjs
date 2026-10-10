// FAFF-1210 — the Commissaire trust-file TOML-subset parser, schema-1 validator, and base-branch
// reader. Covers: a parser corpus (accepted + refused, each refusal line-numbered); schema-1
// validation; the local (`git show`) reader against a real temp repo including the no-local-override
// proof; the remote (`gh api contents`) reader with a stubbed `spawnSync` for the success + both 404
// arms; a smol-toml equivalence check over the accepted corpus (test-only devDependency, guarded-skip
// when absent); and the shipped-closure / package.json no-dependency proofs (the latter two extend the
// commissaire-standalone guard pattern onto this module).

import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { regionsRequireEdges } from "../plugin/skills/faff/bin/lib/regions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const PLUGIN = join(REPO, "plugin", "skills", "faff");
const LIB = join(PLUGIN, "bin", "lib");
const MODULE_JS = join(LIB, "commissaire-trust.js");

const trust = await import(`file://${MODULE_JS}`);
const { parseTrustToml, validateSchema1, readTrustFile } = trust.default;

const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);
const FP_C = "c".repeat(64);

// --- helpers ------------------------------------------------------------------------------------

// Convert a parsed TomlDocument to a plain object (key -> js value), for comparison with smol-toml.
function docToPlain(doc) {
  const out = {};
  for (const [k, v] of doc.entries) {
    if (v.kind === "String") out[k] = v.string;
    else if (v.kind === "Integer") out[k] = v.integer;
    else if (v.kind === "Boolean") out[k] = v.boolean;
    else if (v.kind === "StringArray") out[k] = v.stringArray;
  }
  return out;
}

// --- parser corpus: accepted ---------------------------------------------------------------------

const ACCEPTED = {
  "minimal schema only": "schema = 1\n",
  "all keys, strict off": [
    "schema = 1",
    `governor_key_fingerprints = ["${FP_A}", "${FP_B}"]`,
    "require_pinned_governor = false",
    'pin_change_approvers = ["octocat", "hubot"]',
    "",
  ].join("\n"),
  "strict on with a pin": [
    "schema = 1",
    `governor_key_fingerprints = ["${FP_A}"]`,
    "require_pinned_governor = true",
  ].join("\n"),
  "multi-line array with comment and trailing comma (the ADR example shape)": [
    "schema = 1",
    "governor_key_fingerprints = [",
    `  "${FP_A}",`,
    "  # a comment between elements",
    `  "${FP_B}",`,
    "]",
    "require_pinned_governor = true",
  ].join("\n"),
  "empty array": "schema = 1\npin_change_approvers = []\n",
  "comments and blank lines and trailing comments": [
    "# leading comment",
    "",
    "schema = 1  # the schema version",
    "require_pinned_governor = false",
    "",
  ].join("\n"),
  "zero integer": "schema = 0\n", // parses (validation rejects); parse-level only here
  "hash inside a quoted string stays in the string": `schema = 1\npin_change_approvers = ["a # b"]\n`,
  "CRLF line endings": "schema = 1\r\nrequire_pinned_governor = false\r\n",
};

test("parser corpus: every accepted file parses without error", () => {
  for (const [name, text] of Object.entries(ACCEPTED)) {
    const r = parseTrustToml(text);
    assert.equal(r.ok, true, `${name} should parse: ${r.ok ? "" : r.error.message}`);
  }
});

test("accepted: the hash inside quotes is preserved verbatim", () => {
  const r = parseTrustToml(`schema = 1\npin_change_approvers = ["a # b"]\n`);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.entries.get("pin_change_approvers").stringArray, ["a # b"]);
});

test("accepted: a multi-line array resumes after the closing bracket, never re-reading an array line", () => {
  const r = parseTrustToml(ACCEPTED["multi-line array with comment and trailing comma (the ADR example shape)"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.entries.get("governor_key_fingerprints").stringArray, [FP_A, FP_B]);
  // The key AFTER the array was reached (cursor advanced past every consumed array line).
  assert.equal(r.value.entries.get("require_pinned_governor").boolean, true);
});

test("accepted: `0` parses as integer; the empty array is []", () => {
  assert.equal(parseTrustToml("schema = 0\n").value.entries.get("schema").integer, 0);
  assert.deepEqual(parseTrustToml("schema = 1\npin_change_approvers = []\n").value.entries.get("pin_change_approvers").stringArray, []);
});

// --- parser corpus: refused (line-numbered) -----------------------------------------------------

const REFUSED = [
  ["byte-order mark", "﻿schema = 1\n", 1, /byte-order mark/],
  ["table header [x]", "schema = 1\n[section]\n", 2, /table headers are not allowed/],
  ["array-of-tables [[x]]", "[[a]]\n", 1, /table headers are not allowed/],
  ["dotted key", "a.b = 1\n", 1, /key must be a bare key/],
  ["quoted key", '"a" = 1\n', 1, /key must be a bare key/],
  ["duplicate key", "schema = 1\nschema = 1\n", 2, /duplicate key/],
  ["no equals", "schema\n", 1, /expected key = value/],
  ["missing key", "= 1\n", 1, /missing key/],
  ["literal (single-quoted) string", "a = 'x'\n", 1, /unrecognised value/],
  ["unterminated string", 'a = "x\n', 1, /unterminated string/],
  ["unsupported escape", 'a = "x\\ny"\n', 1, /unsupported escape/],
  ["signed integer", "a = +1\n", 1, /unrecognised value/], // leading + is not a digit -> unrecognised
  ["negative integer", "a = -1\n", 1, /unrecognised value/],
  ["leading zero 01", "a = 01\n", 1, /invalid integer/],
  ["double zero 00", "a = 00\n", 1, /invalid integer/],
  ["underscores", "a = 1_000\n", 1, /underscores are not allowed/],
  ["hex integer", "a = 0xff\n", 1, /only decimal integers are allowed/],
  ["octal integer", "a = 0o17\n", 1, /only decimal integers are allowed/],
  ["float", "a = 1.5\n", 1, /floats, dates and times are not allowed/],
  ["date", "a = 2026-10-10\n", 1, /floats, dates and times are not allowed/],
  ["inline table", "a = { b = 1 }\n", 1, /unrecognised value/],
  ["nested array", 'a = [["x"]]\n', 1, /nested arrays are not allowed/],
  ["mixed-type array", 'a = ["x", 1]\n', 1, /array elements must be strings/],
  ["leading comma in array", 'a = [, "x"]\n', 1, /unexpected comma/],
  ["double comma in array", 'a = ["x",, "y"]\n', 1, /unexpected comma/],
  ["unterminated array", 'a = ["x"\n', 1, /unterminated array/],
  ["trailing chars after value", 'a = 1 2\n', 1, /trailing characters after value/],
];

test("parser corpus: every refused file is trust-file-invalid with the right line and reason", () => {
  for (const [name, text, line, reasonRe] of REFUSED) {
    const r = parseTrustToml(text);
    assert.equal(r.ok, false, `${name} should be refused`);
    assert.equal(r.error.code, "trust-file-invalid", `${name} code`);
    assert.equal(r.error.line, line, `${name} line (got ${r.error.line}: ${r.error.reason})`);
    assert.match(r.error.reason, reasonRe, `${name} reason`);
    assert.equal(r.error.message, `trust-file-invalid: line ${line}: ${r.error.reason}`, `${name} message format`);
  }
});

test("control character and invalid utf-8 in a string are refused", () => {
  const tab = parseTrustToml('a = "x\ty"\n');
  assert.equal(tab.ok, false);
  assert.match(tab.error.reason, /control character in string/);
  const bad = parseTrustToml('a = "x�y"\n');
  assert.equal(bad.ok, false);
  assert.match(bad.error.reason, /invalid utf-8 in string/);
});

test("an integer above MAX_SAFE_INTEGER is refused", () => {
  const r = parseTrustToml("a = 9007199254740993\n"); // MAX_SAFE_INTEGER + 2
  assert.equal(r.ok, false);
  assert.match(r.error.reason, /integer out of range/);
});

// --- schema-1 validation ------------------------------------------------------------------------

function validate(text) {
  const p = parseTrustToml(text);
  assert.equal(p.ok, true, `fixture must parse: ${p.ok ? "" : p.error.message}`);
  return validateSchema1(p.value);
}

test("schema-1: a full valid file validates with the right shape and defaults", () => {
  const r = validate(ACCEPTED["all keys, strict off"]);
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  assert.deepEqual(r.value, {
    schema: 1,
    governorKeyFingerprints: [FP_A, FP_B],
    requirePinnedGovernor: false,
    pinChangeApprovers: ["octocat", "hubot"],
  });
});

test("schema-1: defaults when keys are absent", () => {
  const r = validate("schema = 1\n");
  assert.deepEqual(r.value, { schema: 1, governorKeyFingerprints: [], requirePinnedGovernor: false, pinChangeApprovers: [] });
});

test("schema-1: missing schema is invalid with a null line", () => {
  const r = validate("require_pinned_governor = false\n");
  assert.equal(r.ok, false);
  assert.equal(r.error.line, null);
  assert.match(r.error.reason, /missing required key schema/);
  assert.equal(r.error.message, `trust-file-invalid: ${r.error.reason}`);
});

test("schema-1: schema not 1 is invalid at the schema line", () => {
  for (const [text, line] of [["schema = 0\n", 1], ["schema = 2\n", 1], ['schema = "1"\n', 1]]) {
    const r = validate(text);
    assert.equal(r.ok, false);
    assert.equal(r.error.line, line);
    assert.match(r.error.reason, /schema must be 1/);
  }
});

test("schema-1: an unknown key is invalid at that key's line", () => {
  const r = validate("schema = 1\nrequire_pinned_governer = true\n");
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 2);
  assert.match(r.error.reason, /unknown key: require_pinned_governer/);
});

test("schema-1: a bad fingerprint (not 64 lowercase hex) is refused", () => {
  for (const bad of ['["nothex"]', `["${"A".repeat(64)}"]`, `["${"a".repeat(63)}"]`]) {
    const r = validate(`schema = 1\ngovernor_key_fingerprints = ${bad}\n`);
    assert.equal(r.ok, false, `${bad} should be refused`);
    assert.match(r.error.reason, /fingerprint must be 64 lowercase hex characters/);
  }
});

test("schema-1: duplicate fingerprints are refused", () => {
  const r = validate(`schema = 1\ngovernor_key_fingerprints = ["${FP_A}", "${FP_A}"]\n`);
  assert.equal(r.ok, false);
  assert.match(r.error.reason, /duplicate fingerprint/);
});

test("schema-1: require_pinned_governor must be a boolean", () => {
  const r = validate("schema = 1\nrequire_pinned_governor = 1\n");
  assert.equal(r.ok, false);
  assert.match(r.error.reason, /require_pinned_governor must be a boolean/);
});

test("schema-1: strict mode with an empty fingerprint list is refused at the strict line", () => {
  const r = validate("schema = 1\nrequire_pinned_governor = true\n");
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 2);
  assert.match(r.error.reason, /strict mode requires at least one fingerprint/);
});

test("schema-1: pin_change_approvers must be an array of strings", () => {
  const r = validate("schema = 1\npin_change_approvers = 1\n");
  assert.equal(r.ok, false);
  assert.match(r.error.reason, /pin_change_approvers must be an array of strings/);
});

test("schema-1: an empty file is invalid (missing required key schema)", () => {
  const r = validate("");
  assert.equal(r.ok, false);
  assert.match(r.error.reason, /missing required key schema/);
});

// --- local reader + no-local-override -----------------------------------------------------------

function git(repoDir, args) {
  const r = childProcess.spawnSync("git", ["-C", repoDir, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r;
}

function makeRepo(trustContent) {
  const dir = mkdtempSync(join(tmpdir(), "cmsr-trust-repo-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "T"]);
  mkdirSync(join(dir, ".commissaire"), { recursive: true });
  writeFileSync(join(dir, ".commissaire", "trust.toml"), trustContent);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "trust file"]);
  return dir;
}

test("local reader: reads the committed file on the ref and labels it local-ref", () => {
  const dir = makeRepo(`schema = 1\ngovernor_key_fingerprints = ["${FP_A}", "${FP_B}"]\nrequire_pinned_governor = false\n`);
  try {
    const r = readTrustFile({ repoDir: dir, ref: "main", transport: "local" });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.equal(r.value.present, true);
    assert.deepEqual(r.value.config.governorKeyFingerprints, [FP_A, FP_B]);
    assert.equal(r.value.config.requirePinnedGovernor, false);
    assert.equal(r.value.source, "local-ref");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no-local-override: a working-tree edit and an untracked trust.local.toml change nothing", () => {
  const dir = makeRepo(`schema = 1\ngovernor_key_fingerprints = ["${FP_A}"]\n`);
  try {
    // Mutate the working tree and plant a local override — neither is committed on the ref.
    writeFileSync(join(dir, ".commissaire", "trust.toml"), `schema = 1\ngovernor_key_fingerprints = ["${FP_B}", "${FP_C}"]\n`);
    writeFileSync(join(dir, ".commissaire", "trust.local.toml"), `schema = 1\ngovernor_key_fingerprints = ["${FP_C}"]\nrequire_pinned_governor = true\n`);
    const r = readTrustFile({ repoDir: dir, ref: "main", transport: "local" });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.deepEqual(r.value.config.governorKeyFingerprints, [FP_A], "only the committed copy is read");
    assert.equal(r.value.config.requirePinnedGovernor, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local reader: a genuinely absent file returns present:false (no pins)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cmsr-trust-empty-"));
  try {
    git(dir, ["init", "-q", "-b", "main"]);
    git(dir, ["config", "user.email", "t@example.com"]);
    git(dir, ["config", "user.name", "T"]);
    writeFileSync(join(dir, "README"), "x\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "no trust file"]);
    const r = readTrustFile({ repoDir: dir, ref: "main", transport: "local" });
    assert.equal(r.ok, true);
    assert.equal(r.value.present, false);
    assert.equal(r.value.config, null);
    assert.equal(r.value.source, "local-ref");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local reader: a bad ref is trust-file-invalid (line null), never present:false", () => {
  const dir = makeRepo("schema = 1\n");
  try {
    const r = readTrustFile({ repoDir: dir, ref: "no-such-ref", transport: "local" });
    assert.equal(r.ok, false);
    assert.equal(r.error.stage, "Read");
    assert.equal(r.error.line, null);
    assert.match(r.error.reason, /could not read trust file from local-ref/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local reader: an invalid committed file fails closed (never no-pins)", () => {
  const dir = makeRepo("require_pinned_governor = true\n"); // missing schema
  try {
    const r = readTrustFile({ repoDir: dir, ref: "main", transport: "local" });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "trust-file-invalid");
    assert.match(r.error.reason, /missing required key schema/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- remote reader (stubbed gh) -----------------------------------------------------------------

function withStubbedGh(responder, fn) {
  const real = childProcess.spawnSync;
  childProcess.spawnSync = (cmd, args, opts) => {
    if (cmd === "gh") return responder(args);
    return real(cmd, args, opts);
  };
  try {
    return fn();
  } finally {
    childProcess.spawnSync = real;
  }
}

function contentsBody(toml) {
  // Base64 WITH embedded newlines, exactly as the GitHub Contents API returns it.
  const b64 = Buffer.from(toml, "utf8").toString("base64");
  const wrapped = b64.replace(/(.{1,60})/g, "$1\n");
  return JSON.stringify({ content: wrapped, encoding: "base64" });
}

test("remote reader: a successful contents read strips base64 newlines, decodes, labels remote-base", () => {
  const toml = `schema = 1\ngovernor_key_fingerprints = ["${FP_A}"]\nrequire_pinned_governor = true\n`;
  const r = withStubbedGh(
    (args) => {
      // Only the primary `gh api <path>` call should fire on success (no -I probe).
      assert.ok(!args.includes("-i"), "no headers probe on the success path");
      return { status: 0, stdout: contentsBody(toml), stderr: "" };
    },
    () => readTrustFile({ repoDir: "/unused", ref: "main", transport: "remote", repoSlug: "owner/name" }),
  );
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  assert.equal(r.value.present, true);
  assert.deepEqual(r.value.config.governorKeyFingerprints, [FP_A]);
  assert.equal(r.value.config.requirePinnedGovernor, true);
  assert.equal(r.value.source, "remote-base");
});

test("remote reader: a 404 proven file-absent by a 200 repo-root probe returns present:false", () => {
  const r = withStubbedGh(
    (args) => {
      if (!args.includes("-i")) return { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
      // headers probe: the file path -> 404; the repo-root path -> 200
      const isRoot = args.some((a) => /\/contents\?ref=/.test(a));
      return { status: isRoot ? 0 : 1, stdout: `HTTP/2.0 ${isRoot ? 200 : 404} ${isRoot ? "OK" : "Not Found"}\n`, stderr: "" };
    },
    () => readTrustFile({ repoDir: "/unused", ref: "main", transport: "remote", repoSlug: "owner/name" }),
  );
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  assert.equal(r.value.present, false);
  assert.equal(r.value.config, null);
  assert.equal(r.value.source, "remote-base");
});

test("remote reader: a 404 with a non-200 repo-root probe is trust-file-invalid, NOT present:false", () => {
  for (const rootCode of [404, 403]) {
    const r = withStubbedGh(
      (args) => {
        if (!args.includes("-i")) return { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
        const isRoot = args.some((a) => /\/contents\?ref=/.test(a));
        const code = isRoot ? rootCode : 404;
        return { status: 1, stdout: `HTTP/2.0 ${code} x\n`, stderr: "" };
      },
      () => readTrustFile({ repoDir: "/unused", ref: "main", transport: "remote", repoSlug: "owner/name" }),
    );
    assert.equal(r.ok, false, `root ${rootCode} must fail closed`);
    assert.equal(r.error.stage, "Read");
    assert.equal(r.error.line, null);
    assert.match(r.error.reason, /404 not provably file-absent/);
  }
});

test("remote reader: a non-404 file status (e.g. 403) is trust-file-invalid", () => {
  const r = withStubbedGh(
    (args) => {
      if (!args.includes("-i")) return { status: 1, stdout: "", stderr: "gh: Forbidden (HTTP 403)" };
      return { status: 1, stdout: "HTTP/2.0 403 Forbidden\n", stderr: "" };
    },
    () => readTrustFile({ repoDir: "/unused", ref: "main", transport: "remote", repoSlug: "owner/name" }),
  );
  assert.equal(r.ok, false);
  assert.match(r.error.reason, /contents read failed \(http 403\)/);
});

test("remote reader: a null status line (network down / gh missing) fails closed", () => {
  const r = withStubbedGh(
    (args) => {
      if (!args.includes("-i")) return { status: 1, stdout: "", stderr: "network error" };
      return { status: 1, stdout: "", stderr: "could not resolve host" };
    },
    () => readTrustFile({ repoDir: "/unused", ref: "main", transport: "remote", repoSlug: "owner/name" }),
  );
  assert.equal(r.ok, false);
  assert.match(r.error.reason, /contents read failed \(http none\)/);
});

test("remote reader: a missing repoSlug is a Read error", () => {
  const r = readTrustFile({ repoDir: "/unused", ref: "main", transport: "remote" });
  assert.equal(r.ok, false);
  assert.match(r.error.reason, /remote transport requires a repoSlug/);
});

// --- smol-toml equivalence over the accepted corpus ---------------------------------------------

test("corpus equivalence: smol-toml parses each accepted file to the same values", (t) => {
  let smol;
  try {
    const req = createRequire(join(PLUGIN, "package.json"));
    smol = req("smol-toml");
  } catch {
    t.skip("smol-toml not resolvable (run `npm install` under plugin/skills/faff); equivalence check skipped");
    return;
  }
  for (const [name, text] of Object.entries(ACCEPTED)) {
    const mine = parseTrustToml(text);
    assert.equal(mine.ok, true, `${name} parses`);
    const theirs = { ...smol.parse(text) }; // smol-toml returns a null-prototype object
    assert.deepEqual(docToPlain(mine.value), theirs, `${name}: parsers agree on values`);
  }
});

// --- shipped-closure + no-dependency proofs (extends the commissaire-standalone guard pattern) --

// The orchestration denylist the standalone guard uses, plus the two names this module must not reach.
const DENYLIST = new Set([
  "tracker", "harness", "engine", "next", "project-next", "run-start",
  "run-done", "queue-state", "lights-out", "self-intake", "scenario-matrix",
  "config", "budget",
]);

function libSourceSet(extra = []) {
  const files = readdirSync(LIB).filter((f) => f.endsWith(".js")).map((f) => join(LIB, f));
  return new Set([...files, ...extra]);
}

function walk(seeds, sourceSet) {
  const visited = new Set();
  const malformed = [];
  const emptyMap = new Map();
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const { edges, malformed: mf } = regionsRequireEdges(file, emptyMap, sourceSet);
    malformed.push(...mf);
    for (const e of edges) queue.push(e.toFile);
  }
  return { visited, malformed };
}

test("the trust module's require closure is a subset of {node:*} ∪ governance files, excluding config/budget/denylist", () => {
  const { visited, malformed } = walk([MODULE_JS], libSourceSet());
  assert.deepEqual(malformed, [], `unattributable / outside-set requires: ${malformed.join("; ")}`);
  const denyHits = [...visited].filter((f) => DENYLIST.has(basename(f, ".js")));
  assert.deepEqual(denyHits.map((f) => basename(f)), [], `denylisted modules reachable: ${denyHits.map((f) => basename(f)).join(", ")}`);
  const outside = [...visited].filter((f) => !f.startsWith(LIB + "/"));
  assert.deepEqual(outside, [], `files resolved outside bin/lib: ${outside.join(", ")}`);
});

test("the shipped emit never requires the test-only smol-toml library", () => {
  const src = readFileSync(MODULE_JS, "utf8");
  assert.ok(!/require\(\s*["']smol-toml["']\s*\)/.test(src), "commissaire-trust.js must not require smol-toml");
});

test("the closure guard fires against a tainted ./config require (proves it is not vacuous)", () => {
  // Write the taint into a temp SUBDIRECTORY of bin/lib, not the scanned top level: `faff regions
  // check`'s live scan (regionSources) reads bin/lib non-recursively, so a subdir .js is invisible to
  // a concurrent whole-suite run — while `require("../config")` still resolves to the real config.js
  // so the walk visits it and the denylist proof stays non-vacuous.
  const taintDir = mkdtempSync(join(LIB, "trusttaint-"));
  const taint = join(taintDir, "taint.js");
  try {
    const body = readFileSync(MODULE_JS, "utf8") + '\nrequire("../config");\n';
    writeFileSync(taint, body);
    const { visited } = walk([taint], libSourceSet([taint]));
    const denyHits = [...visited].filter((f) => DENYLIST.has(basename(f, ".js")));
    assert.ok(denyHits.some((f) => basename(f) === "config.js"), "tainted fixture must trip the denylist on config.js");
  } finally {
    rmSync(taintDir, { recursive: true, force: true });
  }
});

test("package.json declares no runtime dependencies and lists smol-toml only under devDependencies", () => {
  const pkg = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined, "package.json must have no dependencies key");
  assert.ok(pkg.devDependencies && pkg.devDependencies["smol-toml"], "smol-toml must be a devDependency");
});
