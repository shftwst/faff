// FAFF-1287 — acceptance criteria carry the same ids in the spec, the PR body and the ac-checklist anchor:
// the schema keys, the writer rules, `faff evidence render ac-checklist` and `faff dod classify --issue`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const REPO = join(import.meta.dirname, "..");
const PLUGIN = join(REPO, "plugin", "skills");
const { classifySchemaChange } = require(join(PLUGIN, "faff", "bin", "lib", "evidence.js"));
const { validateAgainstSchema } = require(join(PLUGIN, "faff", "bin", "lib", "contract-engine.js"));
const { readAcComplete } = require(join(PLUGIN, "faff", "bin", "lib", "merge-gate.js"));
const { sanitizePrBody } = require(join(PLUGIN, "faff", "bin", "lib", "pr-body.js"));

const V03 = join(PLUGIN, "faff", "contracts", "evidence-v0.3");
const V03_COPY = join(REPO, "verification", "evidence", "v0.3");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const schemaOf = (root) => readJson(join(root, "schema", "ac-checklist.schema.json"));
const criterionProps = (schema) => schema.properties.criteria.items.properties;
const ISSUE = "FAFF-1287";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "faff-1287-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, ".faff", "runs", "run-20991231-000000-graft-FAFF-1287");
  mkdirSync(runDir, { recursive: true });
  const file = join(runDir, ISSUE, "ac-checklist.json");
  const write = (input) => runCli(["evidence", "write", "ac-checklist", "--run-dir", runDir, "--issue", ISSUE], { input: typeof input === "string" ? input : JSON.stringify(input), cwd: root });
  const render = (...extra) => runCli(["evidence", "render", "ac-checklist", "--run-dir", runDir, "--issue", ISSUE, ...extra], { cwd: root });
  const plant = (doc) => { mkdirSync(join(runDir, ISSUE), { recursive: true }); writeFileSync(file, typeof doc === "string" ? doc : JSON.stringify(doc)); };
  return { root, runDir, file, write, render, plant };
}

const TEST_METHOD = { kind: "test", locator: "test/a.test.mjs::does A" };
const COMMAND_METHOD = { kind: "command", locator: "node bin/b --check" };
const criterion = (n, extra = {}) => ({ ac: `Criterion ${n}`, verified: "passing", passed: true, ac_id: `faff-1287#ac-${n}`, verifications: [TEST_METHOD], ...extra });
const doc = (...criteria) => ({ all_verified: criteria.every((c) => c.passed), criteria });

// verifies: faff-1287#ac-6
test("both schema copies gain optional ac_id and verifications and stay byte-identical", () => {
  const schema = schemaOf(V03);
  const props = criterionProps(schema);
  assert.deepEqual(props.ac_id.type, ["string", "null"]);
  assert.match("faff-1287#ac-3", new RegExp(props.ac_id.pattern));
  assert.deepEqual(props.verifications.type, ["array", "null"]);
  assert.equal(props.verifications.minItems, 1);
  const method = props.verifications.items;
  assert.equal(method.additionalProperties, false);
  assert.deepEqual(method.required, ["kind"]);
  assert.deepEqual(method.properties.kind.enum, ["test", "command", "human"]);
  assert.equal(method.properties.locator.type, "string");
  assert.deepEqual(schema.properties.criteria.items.required, ["ac", "verified", "passed"]);
  assert.deepEqual(schema.required, ["schema_version", "all_verified"]);
  assert.deepEqual(schema.properties.schema_version.enum, [1]);
  assert.equal(readFileSync(join(V03, "schema", "ac-checklist.schema.json"), "utf8"), readFileSync(join(V03_COPY, "schema", "ac-checklist.schema.json"), "utf8"));
});

// verifies: faff-1287#ac-7
test("adding the two keys classes as an additive schema change", () => {
  const head = schemaOf(V03);
  const base = structuredClone(head);
  delete criterionProps(base).ac_id;
  delete criterionProps(base).verifications;
  assert.deepEqual(classifySchemaChange(base, head), { additive: true, reasons: [] });
  const bumped = structuredClone(head);
  bumped.properties.schema_version.enum = [1, 2];
  assert.equal(classifySchemaChange(head, bumped).additive, false);
});

// verifies: faff-1287#ac-7
test("anchor-manifest.json is unchanged and the two v0.3 trees agree on every changed file", () => {
  assert.equal(readFileSync(join(V03, "anchor-manifest.json"), "utf8"), readFileSync(join(V03_COPY, "anchor-manifest.json"), "utf8"));
  for (const rel of ["README.md", "evidence-documents.md", join("schema", "examples", "ac-checklist.schema-1.example.json")]) {
    assert.equal(readFileSync(join(V03, rel), "utf8"), readFileSync(join(V03_COPY, rel), "utf8"), rel);
  }
});

// verifies: faff-1287#ac-8
test("the old example, the new example and the invalid example behave against the schema", () => {
  const schema = schemaOf(V03);
  const example = (name) => readJson(join(V03, "schema", "examples", name));
  assert.deepEqual(validateAgainstSchema(example("ac-checklist.example.json"), schema), []);
  const withIds = example("ac-checklist.schema-1.example.json");
  assert.deepEqual(validateAgainstSchema(withIds, schema), []);
  assert.deepEqual(withIds.criteria.flatMap((c) => c.verifications.map((m) => m.kind)), ["test", "command", "human"]);
  assert.ok(validateAgainstSchema(example("ac-checklist.invalid.example.json"), schema).length > 0);
});

test("the schema rejects a malformed id, an empty list, an unknown kind and an extra method key", () => {
  const schema = schemaOf(V03);
  const bad = (patch) => validateAgainstSchema({ schema_version: 1, all_verified: true, criteria: [{ ac: "a", verified: "v", passed: true, ...patch }] }, schema);
  assert.deepEqual(bad({ ac_id: null, verifications: null }), []);
  assert.ok(bad({ ac_id: "FAFF-1287#AC-3" }).length > 0);
  assert.ok(bad({ ac_id: "faff-1287#ac-03" }).length > 0);
  assert.ok(bad({ verifications: [] }).length > 0);
  assert.ok(bad({ verifications: [{ kind: "magic" }] }).length > 0);
  assert.ok(bad({ verifications: [{ kind: "human", extra: 1 }] }).length > 0);
});

// verifies: faff-1287#ac-9
test("the writer keeps ac_id and verifications and emits both on every criterion, refusing an omitted ac_id", (t) => {
  const f = fixture(t);
  const plain = { ac: "b", verified: "v", passed: true };
  const w = f.write(doc(criterion(1, { verifications: [TEST_METHOD, COMMAND_METHOD, { kind: "human" }] }), plain));
  assert.equal(w.code, 1, "mixed ids are refused");
  assert.equal(f.write(doc(criterion(1, { verifications: [TEST_METHOD, COMMAND_METHOD, { kind: "human" }] }), criterion(2))).code, 0);
  const written = readJson(f.file);
  assert.deepEqual(written.criteria[0].verifications, [TEST_METHOD, COMMAND_METHOD, { kind: "human" }]);
  assert.deepEqual(Object.keys(written.criteria[0]), ["ac", "verified", "passed", "ac_id", "verifications"]);
  rmSync(f.file);
  const refused = f.write({ all_verified: true, criteria: [plain] });
  assert.equal(refused.code, 1, "an omitted ac_id is refused (FAFF-1261)");
  assert.match(refused.stderr, /criteria\[0\]\.ac_id: required/);
  assert.ok(!existsSync(f.file));
});

// verifies: faff-1287#ac-10
test("the writer refuses each rule break with exit 1, writes nothing and never echoes a locator", (t) => {
  const f = fixture(t);
  const LEAK = "supersecret-locator-value";
  const withMethod = (m) => doc(criterion(1, { verifications: [m] }));
  const cases = {
    "some ac_id strings and others null": doc(criterion(1), criterion(2, { ac_id: null })),
    "a criterion with no ac_id": doc({ ac: "b", verified: "v", passed: true }),
    "every ac_id null": doc(criterion(1, { ac_id: null }), criterion(2, { ac_id: null })),
    "a duplicate ac_id": doc(criterion(1), criterion(2, { ac_id: "faff-1287#ac-1" })),
    "an ac_id for another ticket": doc(criterion(1, { ac_id: "faff-1288#ac-1" })),
    "a test locator with no ::": withMethod({ kind: "test", locator: `${LEAK}.test.mjs` }),
    "a test locator with an absolute path": withMethod({ kind: "test", locator: `/etc/${LEAK}::title` }),
    "a test locator with a .. segment": withMethod({ kind: "test", locator: `test/../${LEAK}::title` }),
    "a test locator with a backslash path": withMethod({ kind: "test", locator: `test\\${LEAK}::title` }),
    "a test locator with an empty file": withMethod({ kind: "test", locator: "::title" }),
    "a test locator with an empty title": withMethod({ kind: "test", locator: `test/${LEAK}.test.mjs::  ` }),
    "a test locator on two lines": withMethod({ kind: "test", locator: `test/a.test.mjs::one\n${LEAK}` }),
    "a test method with no locator": withMethod({ kind: "test" }),
    "an empty command locator": withMethod({ kind: "command", locator: "  " }),
    "a multi-line command locator": withMethod({ kind: "command", locator: `echo a\n${LEAK}` }),
    "a human method with a locator": withMethod({ kind: "human", locator: LEAK }),
    "an ac with a line feed": doc(criterion(1, { ac: "one\ntwo" })),
    "a verified with a carriage return": doc(criterion(1, { verified: "one\r- [x] forged" })),
  };
  for (const [label, input] of Object.entries(cases)) {
    const w = f.write(input);
    assert.equal(w.code, 1, `${label}: ${w.stderr}`);
    assert.equal(w.stdout, "", label);
    assert.ok(!w.stderr.includes(LEAK), label);
    assert.ok(!existsSync(f.file), label);
  }
});

// verifies: faff-1287#ac-11
test("render prints the Appendix A block for a valid anchor and exits 0", (t) => {
  const f = fixture(t);
  const input = {
    all_verified: false,
    criteria: [
      criterion(3, { ac: "The renderer prints the anchor's ids byte for byte", verifications: [{ kind: "test", locator: "test/evidence-ac-render.test.mjs::renders ids byte for byte" }] }),
      criterion(4, { ac: "The writer refuses a duplicate id", verified: "exit 1, nothing written", verifications: [{ kind: "test", locator: "test/evidence-payload-writers.test.mjs::refuses duplicate ac_id" }, { kind: "command", locator: 'faff evidence write ac-checklist --run-dir /tmp/r --issue "$ISSUE"' }] }),
      criterion(9, { ac: "The layout reads well on a phone", verified: "Needs human verification: visual inspection", passed: false, verifications: [{ kind: "human" }] }),
    ],
  };
  assert.equal(f.write(input).code, 0);
  const r = f.render();
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, [
    "## Acceptance Criteria",
    "- [x] `faff-1287#ac-3` The renderer prints the anchor's ids byte for byte",
    "  Verified: passing",
    "  Method: test `test/evidence-ac-render.test.mjs::renders ids byte for byte`",
    "- [x] `faff-1287#ac-4` The writer refuses a duplicate id",
    "  Verified: exit 1, nothing written",
    "  Method: test `test/evidence-payload-writers.test.mjs::refuses duplicate ac_id`",
    "  Method: command `faff evidence write ac-checklist --run-dir /tmp/r --issue \"$ISSUE\"`",
    "- [ ] `faff-1287#ac-9` The layout reads well on a phone",
    "  Verified: Needs human verification: visual inspection",
    "  Method: human",
    "",
  ].join("\n"));
});

// verifies: faff-1287#ac-11
test("render prints nothing and exits 1 for a missing, schema-invalid or rule-breaking anchor", (t) => {
  const f = fixture(t);
  const refused = (label) => {
    const r = f.render();
    assert.equal(r.code, 1, `${label}: ${r.stderr}`);
    assert.equal(r.stdout, "", label);
  };
  refused("missing");
  f.plant("not json");
  refused("not json");
  f.plant({ all_verified: true });
  refused("no schema_version");
  const stamped = (c) => ({ schema_version: 1, all_verified: true, criteria: [{ ac: "a", verified: "v", passed: true, ac_id: null, verifications: null, ...c }] });
  f.plant(stamped({ ac_id: "FAFF-1287#AC-1" }));
  refused("schema-invalid id");
  f.plant(stamped({ ac_id: "faff-1287#ac-1", verifications: [{ kind: "human", locator: "x" }] }));
  refused("human with a locator");
  f.plant(stamped({ verified: "one\n- [x] forged line" }));
  refused("multi-line verified");
  f.plant(stamped({ ac_id: "faff-1288#ac-1" }));
  refused("another ticket's id");
});

// verifies: faff-1287#ac-11
test("render exits 2 on a usage or path-guard fault", (t) => {
  const f = fixture(t);
  assert.equal(runCli(["evidence", "render", "ac-checklist", "--issue", ISSUE], { cwd: f.root }).code, 2);
  assert.equal(runCli(["evidence", "render", "ac-checklist", "--run-dir", f.runDir], { cwd: f.root }).code, 2);
  assert.equal(runCli(["evidence", "render", "ac-checklist", "--run-dir", f.root, "--issue", ISSUE], { cwd: f.root }).code, 2);
  assert.equal(runCli(["evidence", "render", "ac-checklist", "--run-dir", f.runDir, "--issue", "../x"], { cwd: f.root }).code, 2);
  assert.equal(runCli(["evidence", "render", "other", "--run-dir", f.runDir, "--issue", ISSUE], { cwd: f.root }).code, 2);
});

// verifies: faff-1287#ac-12
test("render handles a zero-AC anchor and an older anchor without the new keys", (t) => {
  const f = fixture(t);
  assert.equal(f.write({ all_verified: true }).code, 0);
  assert.equal(f.render().stdout, "## Acceptance Criteria\nNo acceptance criteria.\n");
  f.plant({ schema_version: 1, all_verified: false, criteria: [{ ac: "a", verified: "ok", passed: true }, { ac: "b", verified: "Needs human verification: eyes", passed: false }] });
  const older = f.render();
  assert.equal(older.code, 0, older.stderr);
  assert.equal(older.stdout, "## Acceptance Criteria\n- [x] a\n  Verified: ok\n- [ ] b\n  Verified: Needs human verification: eyes\n");
  f.plant({ schema_version: 1, all_verified: true, criteria: [{ ac: "a", verified: "ok", passed: true, ac_id: null, verifications: null }] });
  assert.equal(f.render().stdout, "## Acceptance Criteria\n- [x] a\n  Verified: ok\n");
});

test("render fences a command locator that contains backticks", (t) => {
  const f = fixture(t);
  assert.equal(f.write(doc(criterion(1, { verifications: [{ kind: "command", locator: "echo `date`" }] }))).code, 0);
  assert.match(f.render().stdout, /^ {2}Method: command `` echo `date` ``$/m);
});

// verifies: faff-1287#ac-1
test("every ac_id survives render and the PR-body sanitizer byte for byte, in order", (t) => {
  const f = fixture(t);
  const input = doc(criterion(2, { ac: "The command exits 0" }), criterion(5, { ac: "Output is JSON, per FAFF-1259" }), criterion(7, { ac: "positional", ac_id: "faff-1287#done:7" }));
  assert.equal(f.write(input).code, 0);
  const anchored = readJson(f.file).criteria.map((c) => c.ac_id);
  assert.deepEqual(anchored, ["faff-1287#ac-2", "faff-1287#ac-5", "faff-1287#done:7"]);
  const body = sanitizePrBody(f.render().stdout, ISSUE);
  const found = [...body.matchAll(/`([a-z][a-z0-9]{1,15}-[1-9][0-9]*#(?:ac-[1-9][0-9]*|done:[1-9][0-9]*))`/g)].map((m) => m[1]);
  assert.deepEqual(found, anchored);
  assert.ok(body.includes("per FAFF‑1259"), "AC text is sanitized, ids are not");
});

// verifies: faff-1287#ac-20
test("readAcComplete returns the same result with and without the new keys", (t) => {
  const f = fixture(t);
  const verdict = (c) => { f.plant({ schema_version: 1, all_verified: c.passed, criteria: [c] }); return readAcComplete(f.runDir, ISSUE); };
  const base = { ac: "a", verified: "v" };
  for (const passed of [true, false]) {
    const old = verdict({ ...base, passed });
    assert.equal(old, passed);
    assert.equal(verdict({ ...base, passed, ac_id: null, verifications: null }), old);
    assert.equal(verdict({ ...base, passed, ac_id: "faff-1287#ac-1", verifications: [TEST_METHOD, { kind: "human" }] }), old);
  }
});

const SPEC = (done) => ["## Scenarios", "```", "Given a user", "When they act", "Then it works", "```", "", "## 7. DONE", "", ...done, ""].join("\n");
const classify = (spec, ...extra) => {
  const r = runCli(["dod", "classify", "--spec", "-", "--json", ...extra], { input: spec });
  return { ...r, json: r.code === 0 ? JSON.parse(r.stdout) : null, lines: r.stderr.split("\n").filter(Boolean) };
};

// verifies: faff-1287#ac-13
test("dod classify adds local_ac_id, and ac_id with --issue, and strips the leading id from text", () => {
  const spec = SPEC(["- [ ] [ac-1] The command exits 0", "- [x] [ac-5] Output is JSON"]);
  const without = classify(spec);
  assert.deepEqual(without.json.criteria.filter((c) => c.source === "done").map((c) => [c.local_ac_id, c.ac_id, c.text]), [["ac-1", undefined, "The command exits 0"], ["ac-5", undefined, "Output is JSON"]]);
  const withIssue = classify(spec, "--issue", "FAFF-9");
  assert.deepEqual(withIssue.json.criteria.filter((c) => c.source === "done").map((c) => [c.id, c.ac_id]), [["done:1", "faff-9#ac-1"], ["done:2", "faff-9#ac-5"]]);
  assert.deepEqual(withIssue.json.criteria.filter((c) => c.source === "scenarios").map((c) => Object.keys(c).sort()), [["class", "holdout", "id", "oracle_less", "source", "text", "verification_tier", "verifier"]]);
});

// verifies: faff-1287#ac-13
test("authoring ids changes neither id, class, holdout nor the counts", () => {
  const items = ["The command exits 0", "Output is JSON", "The layout reads well", "holdout: kept literal"];
  const plain = classify(SPEC(items.map((t) => `- [ ] ${t}`))).json;
  const authored = classify(SPEC(items.map((t, i) => `- [ ] [ac-${i + 1}] ${t}`))).json;
  const core = (c) => ({ id: c.id, class: c.class, holdout: c.holdout, oracle_less: c.oracle_less, source: c.source, text: c.text, verification_tier: c.verification_tier });
  assert.deepEqual(authored.criteria.map(core), plain.criteria.map(core));
  for (const key of ["counts", "holdout_counts", "oracle_less_count", "verification_tier_counts"]) assert.deepEqual(authored[key], plain[key], key);
  assert.deepEqual(plain.criteria.filter((c) => c.source === "done").map((c) => c.local_ac_id), ["done:1", "done:2", "done:3", "done:4"]);
});

test("dod classify rejects a malformed --issue with exit 2", () => {
  assert.equal(classify(SPEC(["- [ ] a"]), "--issue", "faff-9").code, 2);
});

// verifies: faff-1287#ac-14
test("near misses, duplicates and mixed ids fall back to done:N with an advisory and exit 0", () => {
  const localIds = (r) => r.json.criteria.filter((c) => c.source === "done").map((c) => c.local_ac_id);
  const NEAR = "dod classify: DONE item id not recognised (use lowercase [ac-N])";
  for (const near of ["[AC-2] x", "[ac-03] x", "[ac-2x] x"]) {
    const r = classify(SPEC([`- [ ] ${near}`]));
    assert.equal(r.code, 0);
    assert.deepEqual(localIds(r), ["done:1"], near);
    assert.ok(r.lines.includes(NEAR), near);
    assert.equal(r.json.criteria.find((c) => c.source === "done").text, near, "a near miss keeps its text");
  }
  const dup = classify(SPEC(["- [ ] [ac-2] a", "- [ ] [ac-2] b", "- [ ] [ac-3] c"]));
  assert.equal(dup.code, 0);
  assert.deepEqual(localIds(dup), ["done:1", "done:2", "ac-3"]);
  assert.ok(dup.lines.includes("dod classify: duplicate AC id ac-2"));
  assert.ok(dup.lines.includes("dod classify: mixed authored and positional AC ids"));
  const mixed = classify(SPEC(["- [ ] [ac-1] a", "- [ ] b"]), "--issue", "FAFF-9");
  assert.equal(mixed.code, 0);
  assert.deepEqual(mixed.json.criteria.filter((c) => c.source === "done").map((c) => c.ac_id), ["faff-9#ac-1", "faff-9#done:2"]);
  assert.ok(mixed.lines.includes("dod classify: mixed authored and positional AC ids"));
  assert.deepEqual(classify(SPEC(["- [ ] [ac-1] a", "- [ ] [ac-2] b"])).lines, []);
});

// verifies: faff-1287#ac-15
test("graft Step 8 takes ids from dod classify, renders the block and drops the hand-written template", () => {
  const skill = readFileSync(join(PLUGIN, "faff-graft", "SKILL.md"), "utf8");
  const step8 = skill.slice(skill.indexOf("**Step 8: AC verification"), skill.indexOf("**Step 8b:"));
  assert.match(step8, /faff dod classify --spec <spec> --issue <ISSUE> --json/);
  assert.match(step8, /faff evidence write ac-checklist/);
  assert.match(step8, /faff evidence render ac-checklist --run-dir "\$run_dir" --issue <ISSUE>/);
  assert.match(step8, /one line saying the checklist was refused/);
  assert.match(step8, /environment variable/);
  assert.doesNotMatch(step8, /AC 1/);
});

// verifies: faff-1287#ac-19
test("the CLI guide and both evidence-documents copies describe the new keys and the render action", () => {
  const cli = readFileSync(join(REPO, "docs", "guide", "cli.md"), "utf8");
  assert.match(cli, /`evidence render ac-checklist --run-dir <dir> --issue <id>`/);
  assert.match(cli, /`dod classify --spec <path\\\|-> \[--issue <id>\] \[--json\]`/);
  assert.match(cli, /`ac_id`\/`verifications`/);
  for (const root of [V03, V03_COPY]) {
    const docs = readFileSync(join(root, "evidence-documents.md"), "utf8");
    assert.match(docs, /`ac_id`/);
    assert.match(docs, /`verifications`/);
    assert.match(readFileSync(join(root, "README.md"), "utf8"), /FAFF-1287 extended `ac-checklist` in place/);
  }
});
