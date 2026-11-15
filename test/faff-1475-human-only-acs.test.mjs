// FAFF-1475 slice 1. Seam A: `faff dod classify` marks a `needs-human:` DONE item human_only.
// Seam B: the human-only-acs.json contract, its writer and its stamp event.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { runCli } from "./helpers/run-cli.mjs";
import { mintScopeAnchor, mkScopeRun } from "./helpers/evidence-anchor-fixtures.mjs";

const require = createRequire(import.meta.url);
const { emitGenesisRunStart } = require("../plugin/skills/faff/bin/lib/events.js");
const { validateAgainstSchema } = require("../plugin/skills/faff/bin/lib/contract-engine.js");
const { resolveFaffVersion } = require("../plugin/skills/faff/bin/lib/faff-version.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

const classify = (specText, issue = "FAFF-9") => {
  const dir = mkdtempSync(join(tmpdir(), "faff-1475-"));
  const spec = join(dir, "spec.md");
  writeFileSync(spec, specText);
  const r = spawnSync(process.execPath, [BIN, "dod", "classify", "--spec", spec, "--issue", issue, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return { out: JSON.parse(r.stdout), stderr: r.stderr };
};

const spec = (done, extra = "") => `# T

## Scenarios

Given a thing
When it runs
Then it returns 200

${extra}
### 4. DONE

${done}
`;

describe("marker", () => {
  test("a needs-human: DONE item is human_only, delegated, and leaves other rows' ids unchanged", () => {
    const withMarker = classify(spec("- [ ] [ac-1] returns 200 for GET /x\n- [ ] [ac-2] needs-human: Prices match the published pricing page\n- [ ] [ac-3] returns 404 for GET /y"));
    const plain = classify(spec("- [ ] [ac-1] returns 200 for GET /x\n- [ ] [ac-2] Prices match the published pricing page\n- [ ] [ac-3] returns 404 for GET /y"));
    const rows = withMarker.out.criteria;
    const row = rows.find((c) => c.ac_id === "faff-9#ac-2");
    assert.equal(row.human_only, true);
    assert.equal(row.verification_tier, "delegated");
    assert.equal(row.verifier, "ac-checklist");
    assert.equal(row.text, "Prices match the published pricing page");
    for (const c of rows) if (c !== row) assert.equal(c.human_only, false, c.id);
    assert.deepEqual(rows.map((c) => [c.id, c.ac_id]), plain.out.criteria.map((c) => [c.id, c.ac_id]));
  });

  test("positional ids are unchanged by a marker", () => {
    const { out } = classify(spec("- [ ] returns 200\n- [ ] needs-human: looks right to a designer\n- [ ] returns 404"));
    assert.deepEqual(out.criteria.filter((c) => c.source === "done").map((c) => [c.ac_id, c.human_only]),
      [["faff-9#done:1", false], ["faff-9#done:2", true], ["faff-9#done:3", false]]);
  });

  test("an empty reason is not a marker: literal text, human_only false, stderr advisory", () => {
    const { out, stderr } = classify(spec("- [ ] [ac-1] needs-human:   \n- [ ] [ac-2] returns 200"));
    const row = out.criteria.find((c) => c.ac_id === "faff-9#ac-1");
    assert.equal(row.human_only, false);
    assert.match(row.text, /^needs-human:/);
    assert.match(stderr, /needs-human/);
  });

  test("a marker outside the DONE section is ignored", () => {
    const { out, stderr } = classify(spec("- [ ] [ac-1] returns 200", "- needs-human: a bullet in the body\n\n"));
    assert.ok(out.criteria.every((c) => c.human_only === false));
    assert.equal(stderr, "");
  });

  test("a human_only row naming a code surface stays delegated", () => {
    const unmarked = classify(spec("- [ ] [ac-1] `a.test.mjs` MUST pass"));
    assert.equal(unmarked.out.criteria.find((c) => c.ac_id === "faff-9#ac-1").verification_tier, "integration");
    const { out } = classify(spec("- [ ] [ac-1] needs-human: `a.test.mjs` MUST pass"));
    const row = out.criteria.find((c) => c.ac_id === "faff-9#ac-1");
    assert.equal(row.human_only, true);
    assert.equal(row.verification_tier, "delegated");
    assert.equal(row.verifier, "ac-checklist");
  });
});

// --- seam B: contract, writer, stamp, anchor copy -----------------------------------------------

const PLUGIN = join(HERE, "..", "plugin", "skills", "faff");
const SCHEMAS = join(PLUGIN, "contracts", "evidence-v0.3", "schema");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const ISSUE = "FAFF-9";
const DOC = { issue: ISSUE, level: "L4", unattended: true, human_only: ["faff-9#ac-2", "faff-9#done:3"] };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "faff-1475-writer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, ".faff", "runs", "run-20991231-000000-graft-FAFF-9");
  mkdirSync(runDir, { recursive: true });
  emitGenesisRunStart(runDir);
  const file = join(runDir, ISSUE, "human-only-acs.json");
  const events = join(runDir, "events.jsonl");
  const write = (input, { dir = runDir, issue = ISSUE, bin } = {}) =>
    bin
      ? spawnSync(process.execPath, [bin, "evidence", "write", "human-only-acs", "--run-dir", dir, "--issue", issue], { cwd: root, input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8" })
      : runCli(["evidence", "write", "human-only-acs", "--run-dir", dir, "--issue", issue], { cwd: root, input: typeof input === "string" ? input : JSON.stringify(input) });
  const lines = () => readFileSync(events, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { root, runDir, file, events, write, lines };
}

describe("contract", () => {
  const schema = readJson(join(SCHEMAS, "human-only-acs.schema.json"));
  const example = (name) => readJson(join(SCHEMAS, "examples", name));

  test("the valid example passes and the invalid example fails the schema", () => {
    assert.deepEqual(validateAgainstSchema(example("human-only-acs.example.json"), schema), []);
    assert.ok(validateAgainstSchema(example("human-only-acs.invalid.example.json"), schema).length > 0);
  });

  test("the schema is closed and requires every key but faff_version", () => {
    const ok = example("human-only-acs.example.json");
    assert.ok(validateAgainstSchema({ ...ok, extra: 1 }, schema).length > 0);
    for (const key of ["schema_version", "issue", "level", "unattended", "human_only"]) {
      const { [key]: _gone, ...rest } = ok;
      assert.ok(validateAgainstSchema(rest, schema).length > 0, key);
    }
    assert.deepEqual(validateAgainstSchema({ ...ok, faff_version: "0.44.0", human_only: [] }, schema), []);
  });

  test("the manifest lists the file as a field-versioned json document with thirteen entries in all", () => {
    const manifest = readJson(join(PLUGIN, "contracts", "evidence-v0.3", "anchor-manifest.json"));
    assert.deepEqual(manifest.files["human-only-acs.json"], { schema: "schema/human-only-acs.schema.json", format: "json", versioned_by: "field" });
    assert.equal(Object.keys(manifest.files).length, 13);
  });

  test("the stamp event type is in the delivery profile, issue-scoped, and has its example pair", () => {
    const { DELIVERY_PROFILE } = require("../plugin/skills/faff/bin/lib/governance-profile.js");
    assert.ok(DELIVERY_PROFILE.event_types.includes("human-only-acs-stamp"));
    assert.ok(DELIVERY_PROFILE.issue_scoped_types.includes("human-only-acs-stamp"));
    const runEvent = readJson(join(SCHEMAS, "run-event.schema.json"));
    assert.deepEqual(validateAgainstSchema(example("events/human-only-acs-stamp.example.json"), runEvent), []);
    assert.ok(validateAgainstSchema(example("events/human-only-acs-stamp.invalid.example.json"), runEvent).length > 0);
    const stamp = example("events/human-only-acs-stamp.example.json");
    assert.ok(validateAgainstSchema({ ...stamp, issue: undefined }, runEvent).length > 0, "issue-scoped");
    assert.ok(validateAgainstSchema({ ...stamp, data: { ...stamp.data, sha256: stamp.data.sha256.toUpperCase() } }, runEvent).length > 0, "lowercase hex only");
    assert.ok(validateAgainstSchema({ ...stamp, data: { ...stamp.data, extra: 1 } }, runEvent).length > 0, "closed data");
  });
});

describe("writer", () => {
  test("writes the document with schema_version and faff_version, and appends one stamp holding the file's SHA-256", (t) => {
    const f = fixture(t);
    const before = f.lines().length;
    const r = f.write(DOC);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), f.file);
    const bytes = readFileSync(f.file);
    assert.equal(bytes.toString("utf8"), JSON.stringify({ schema_version: 1, faff_version: resolveFaffVersion().version, ...DOC }, null, 2) + "\n");
    const stamps = f.lines().slice(before);
    assert.equal(stamps.length, 1);
    assert.equal(stamps[0].type, "human-only-acs-stamp");
    assert.equal(stamps[0].phase, "build");
    assert.equal(stamps[0].issue, ISSUE);
    assert.deepEqual(stamps[0].data, { issue: ISSUE, sha256: sha256(bytes) });
  });

  test("an empty human_only list is written, and an issue differing only in case is accepted", (t) => {
    const f = fixture(t);
    const r = f.write({ ...DOC, issue: "faff-9", level: "L3", unattended: false, human_only: [] });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readJson(f.file).human_only, []);
  });

  test("drops unknown keys and the caller's schema_version", (t) => {
    const f = fixture(t);
    assert.equal(f.write({ ...DOC, schema_version: 7, extra: 1 }).code, 0);
    const doc = readJson(f.file);
    assert.equal(doc.schema_version, 1);
    assert.ok(!("extra" in doc));
  });

  const refusals = [
    ["an issue mismatch", { ...DOC, issue: "FAFF-10" }],
    ["an L1 document with unattended true", { ...DOC, level: "L1" }],
    ["an L2 document with unattended true", { ...DOC, level: "L2" }],
    ["an L4 document with unattended false", { ...DOC, unattended: false }],
    ["a level outside L1..L4", { ...DOC, level: "L5" }],
    ["a duplicate id", { ...DOC, human_only: ["faff-9#ac-2", "faff-9#ac-2"] }],
    ["an id naming another ticket", { ...DOC, human_only: ["faff-10#ac-2"] }],
    ["an id that does not parse", { ...DOC, human_only: ["ac-2"] }],
    ["a non-boolean unattended", { ...DOC, unattended: "yes" }],
    ["a missing human_only", { issue: ISSUE, level: "L4", unattended: true }],
    ["a stdin that is not an object", "[1]"],
  ];
  for (const [label, input] of refusals) {
    test(`refuses ${label}: exit 1, no file, no stamp`, (t) => {
      const f = fixture(t);
      const eventsBefore = readFileSync(f.events);
      const r = f.write(input);
      assert.equal(r.code, 1, r.stderr);
      assert.match(r.stderr, /refused/);
      assert.ok(!existsSync(f.file));
      assert.ok(readFileSync(f.events).equals(eventsBefore));
    });
  }

  test("a refusal does not echo the offending id", (t) => {
    const f = fixture(t);
    const r = f.write({ ...DOC, human_only: ["faff-10#ac-77"] });
    assert.equal(r.code, 1);
    assert.ok(!r.stderr.includes("ac-77"));
  });

  test("a failed stamp append removes the file, exits 2 and leaves events.jsonl untouched", (t) => {
    const f = fixture(t);
    const dir = mkdtempSync(join(tmpdir(), "faff-1475-plugin-copy-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const copy = join(dir, "faff");
    cpSync(PLUGIN, copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
    const schemaPath = join(copy, "contracts", "evidence-v0.3", "schema", "run-event.schema.json");
    const doc = readJson(schemaPath);
    const data = doc.discriminator.mapping["2"].discriminator.mapping["human-only-acs-stamp"].properties.data;
    data.required = [...data.required, "probe_required"];
    writeFileSync(schemaPath, JSON.stringify(doc));
    const eventsBefore = readFileSync(f.events);
    const r = f.write(DOC, { bin: join(copy, "bin", "faff") });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /cannot append the human-only-acs-stamp event; nothing written/);
    assert.ok(!existsSync(f.file));
    assert.ok(readFileSync(f.events).equals(eventsBefore));
  });

  test("a run dir with no events.jsonl exits 2 and leaves no file", (t) => {
    const f = fixture(t);
    rmSync(f.events);
    const r = f.write(DOC);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /no events\.jsonl/);
    assert.ok(!existsSync(f.file));
  });

  test("a rewrite replaces the file and the latest stamp matches the new bytes", (t) => {
    const f = fixture(t);
    assert.equal(f.write(DOC).code, 0);
    assert.equal(f.write({ ...DOC, human_only: [] }).code, 0);
    const stamps = f.lines().filter((e) => e.type === "human-only-acs-stamp");
    assert.equal(stamps.length, 2);
    assert.equal(stamps[1].data.sha256, sha256(readFileSync(f.file)));
    assert.notEqual(stamps[0].data.sha256, stamps[1].data.sha256);
  });

  test("an --issue that is not a bare token is a path-guard fault (exit 2)", (t) => {
    const f = fixture(t);
    assert.equal(f.write(DOC, { issue: "../x" }).code, 2);
  });
});

describe("anchor copy", () => {
  test("an anchor minted from a run dir holding the file carries it byte-identical, and the stamp in events.jsonl", (t) => {
    const root = mkdtempSync(join(tmpdir(), "faff-1475-anchor-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { runDir, runName } = mkScopeRun(root, { admitted: [ISSUE] });
    const r = runCli(["evidence", "write", "human-only-acs", "--run-dir", runDir, "--issue", ISSUE], { cwd: root, input: JSON.stringify(DOC) });
    assert.equal(r.code, 0, r.stderr);
    const dest = mintScopeAnchor(runDir, runName, ISSUE, join(root, "anchors"));
    const written = readFileSync(join(runDir, ISSUE, "human-only-acs.json"));
    const anchored = readFileSync(join(dest, "human-only-acs.json"));
    assert.ok(anchored.equals(written));
    const stamps = readFileSync(join(dest, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "human-only-acs-stamp" && e.issue === ISSUE);
    assert.equal(stamps.length, 1);
    assert.equal(stamps[0].data.sha256, sha256(anchored));
    const report = JSON.parse(runCli(["evidence", "validate", dest, "--json"], { cwd: root }).stdout);
    assert.equal(report.status, "pass", JSON.stringify(report.files.filter((x) => x.status !== "ok")));
    assert.ok(report.files.some((x) => x.path === "human-only-acs.json" && x.status === "ok"));
  });

  test("an anchor minted without the file carries none", (t) => {
    const root = mkdtempSync(join(tmpdir(), "faff-1475-anchor-none-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { runDir, runName } = mkScopeRun(root, { admitted: [ISSUE] });
    const dest = mintScopeAnchor(runDir, runName, ISSUE, join(root, "anchors"));
    assert.ok(!existsSync(join(dest, "human-only-acs.json")));
  });
});
