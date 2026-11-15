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

// --- seam D: the reader and the byte-exact helper (uncalled by the floors until slice 2) -----------
const { readHumanOnlyAcs } = require("../plugin/skills/faff/bin/lib/human-only-acs.js");
const { readAnchoredBytes, gitRun } = require("../plugin/skills/faff/bin/lib/merge-gate-floor.js");

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");
const LIB = join(HERE, "..", "plugin", "skills", "faff", "bin", "lib");

const mkDoc = (over = {}) => ({ schema_version: 1, issue: "FAFF-9", level: "L3", unattended: false, human_only: ["faff-9#ac-1", "faff-9#ac-2"], ...over });
const asBytes = (doc) => Buffer.from(JSON.stringify(doc, null, 2) + "\n");
const stampLine = (issue, sha) => JSON.stringify({ type: "human-only-acs-stamp", issue, data: { issue, sha256: sha } }) + "\n";
const eventsFor = (fileBytes, issue = "FAFF-9") => Buffer.from(stampLine(issue, sha256Of(fileBytes)));
const read = (doc, level = "L3", events) => {
  const bytes = Buffer.isBuffer(doc) ? doc : asBytes(doc);
  return readHumanOnlyAcs(bytes, events === undefined ? eventsFor(bytes) : events, "FAFF-9", level);
};

describe("readHumanOnlyAcs", () => {
  test("a valid file with its stamp reads back unattended and ids", () => {
    assert.deepEqual(read(mkDoc()), { unattended: false, ids: ["faff-9#ac-1", "faff-9#ac-2"] });
    assert.deepEqual(read(mkDoc({ level: "L4", unattended: true, human_only: [] }), "L4"), { unattended: true, ids: [] });
    assert.deepEqual(read(mkDoc({ unattended: true })), { unattended: true, ids: ["faff-9#ac-1", "faff-9#ac-2"] });
  });

  test("issue matching is case-insensitive", () => {
    const bytes = asBytes(mkDoc({ issue: "faff-9" }));
    assert.notEqual(readHumanOnlyAcs(bytes, eventsFor(bytes, "faff-9"), "FAFF-9", "L3"), null);
  });

  test("returns null for each structural fault", () => {
    const bad = {
      "unparseable JSON": Buffer.from("{nope"),
      "an array": Buffer.from("[]"),
      "null JSON": Buffer.from("null"),
      "invalid UTF-8": Buffer.from([0x7b, 0xff, 0x7d]),
      "wrong schema_version": asBytes(mkDoc({ schema_version: 2 })),
      "issue mismatch": asBytes(mkDoc({ issue: "FAFF-8", human_only: [] })),
      "level mismatch": asBytes(mkDoc({ level: "L2" })),
      "L1 unattended": asBytes(mkDoc({ level: "L1", unattended: true })),
      "non-boolean unattended": asBytes(mkDoc({ unattended: "false" })),
      "missing human_only": asBytes(mkDoc({ human_only: undefined })),
      "a malformed id": asBytes(mkDoc({ human_only: ["FAFF-9#ac-1"] })),
      "a non-string id": asBytes(mkDoc({ human_only: [1] })),
      "a duplicate id": asBytes(mkDoc({ human_only: ["faff-9#ac-1", "faff-9#ac-1"] })),
      "a foreign id": asBytes(mkDoc({ human_only: ["faff-8#ac-1"] })),
    };
    for (const [name, bytes] of Object.entries(bad)) {
      assert.equal(readHumanOnlyAcs(bytes, eventsFor(bytes), "FAFF-9", "L3"), null, name);
    }
  });

  test("the level constraints hold for L1, L2 and L4", () => {
    for (const level of ["L1", "L2"]) {
      assert.equal(read(mkDoc({ level, unattended: true }), level), null, `${level} unattended`);
      assert.notEqual(read(mkDoc({ level, unattended: false }), level), null, `${level} attended`);
    }
    assert.equal(read(mkDoc({ level: "L4", unattended: false }), "L4"), null);
  });

  test("a missing or mismatched stamp returns null", () => {
    assert.equal(read(mkDoc(), "L3", Buffer.alloc(0)), null, "no events");
    assert.equal(read(mkDoc(), "L3", Buffer.from('{"type":"other","issue":"FAFF-9"}\n')), null, "no stamp");
    assert.equal(read(mkDoc(), "L3", Buffer.from(stampLine("FAFF-9", "0".repeat(64)))), null, "wrong digest");
    assert.equal(read(mkDoc(), "L3", Buffer.from('{"type":"human-only-acs-stamp","issue":"FAFF-9"}\n')), null, "stamp without data");
  });

  test("a stamp whose data.issue disagrees with its issue is a mismatch", () => {
    const bytes = asBytes(mkDoc());
    const forged = JSON.stringify({ type: "human-only-acs-stamp", issue: "FAFF-9", data: { issue: "FAFF-8", sha256: sha256Of(bytes) } }) + "\n";
    assert.equal(readHumanOnlyAcs(bytes, Buffer.from(forged), "FAFF-9", "L3"), null);
  });

  test("a stamp for another issue is ignored, even when newer", () => {
    const bytes = asBytes(mkDoc());
    const events = Buffer.concat([eventsFor(bytes), Buffer.from(stampLine("FAFF-8", "0".repeat(64)))]);
    assert.notEqual(readHumanOnlyAcs(bytes, events, "FAFF-9", "L3"), null);
  });

  test("the last stamp for the issue wins", () => {
    const bytes = asBytes(mkDoc());
    const staleLast = Buffer.concat([eventsFor(bytes), Buffer.from(stampLine("FAFF-9", "0".repeat(64)))]);
    assert.equal(readHumanOnlyAcs(bytes, staleLast, "FAFF-9", "L3"), null);
    const freshLast = Buffer.concat([Buffer.from(stampLine("FAFF-9", "0".repeat(64))), eventsFor(bytes)]);
    assert.notEqual(readHumanOnlyAcs(bytes, freshLast, "FAFF-9", "L3"), null);
  });

  test("the digest covers the exact bytes, so a trimmed or re-encoded file fails", () => {
    const bytes = asBytes(mkDoc());
    const events = eventsFor(bytes);
    assert.equal(readHumanOnlyAcs(Buffer.from(bytes.toString("utf8").trim()), events, "FAFF-9", "L3"), null);
    assert.equal(readHumanOnlyAcs(Buffer.concat([Buffer.from("﻿"), bytes]), events, "FAFF-9", "L3"), null);
  });

  test("blank lines and a torn final line are tolerated; a mid-file bad line is not", () => {
    const bytes = asBytes(mkDoc());
    const stamp = eventsFor(bytes);
    const tolerated = Buffer.concat([stamp, Buffer.from("\n"), Buffer.from('{"type":"x","iss')]);
    assert.notEqual(readHumanOnlyAcs(bytes, tolerated, "FAFF-9", "L3"), null);
    const midFile = Buffer.concat([Buffer.from("not json\n"), stamp]);
    assert.equal(readHumanOnlyAcs(bytes, midFile, "FAFF-9", "L3"), null);
  });

  test("it is total: odd inputs return null and never throw", () => {
    for (const args of [[null, null, "FAFF-9", "L3"], [undefined, Buffer.alloc(0), "FAFF-9", "L3"], [asBytes(mkDoc()), null, "FAFF-9", "L3"], [asBytes(mkDoc()), Buffer.alloc(0), undefined, undefined]]) {
      assert.doesNotThrow(() => assert.equal(readHumanOnlyAcs(...args), null));
    }
  });
});

describe("readAnchoredBytes", () => {
  const ANCHOR_DIR = ".faff/anchors/run-1/FAFF-9";
  const git = (cwd, ...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };

  function commitAnchor(t, fileBytes, eventsBytes) {
    const repo = mkdtempSync(join(tmpdir(), "faff-1476-bytes-"));
    t.after(() => rmSync(repo, { recursive: true, force: true }));
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "t");
    git(repo, "config", "commit.gpgsign", "false");
    mkdirSync(join(repo, ANCHOR_DIR), { recursive: true });
    writeFileSync(join(repo, ANCHOR_DIR, "human-only-acs.json"), fileBytes);
    writeFileSync(join(repo, ANCHOR_DIR, "events.jsonl"), eventsBytes);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "anchor");
    return { repo, head: git(repo, "rev-parse", "HEAD") };
  }

  const bigEvents = (fileBytes) => {
    const filler = JSON.stringify({ type: "filler", issue: "FAFF-9", data: { pad: "x".repeat(900) } }) + "\n";
    return Buffer.concat([Buffer.from(filler.repeat(1300)), eventsFor(fileBytes)]);
  };

  test("scenario 7: exact committed bytes for a newline-ended file and an events.jsonl over 1 MiB", (t) => {
    const fileBytes = asBytes(mkDoc());
    const events = bigEvents(fileBytes);
    assert.ok(events.length > 1024 * 1024);
    assert.ok(fileBytes.at(-1) === 0x0a && events.at(-1) === 0x0a);
    const { repo, head } = commitAnchor(t, fileBytes, events);
    const gotFile = readAnchoredBytes(repo, null, `${ANCHOR_DIR}/human-only-acs.json`, head);
    const gotEvents = readAnchoredBytes(repo, null, `${ANCHOR_DIR}/events.jsonl`, head);
    assert.ok(Buffer.isBuffer(gotFile) && Buffer.isBuffer(gotEvents));
    assert.ok(gotFile.equals(fileBytes), "file bytes exact");
    assert.ok(gotEvents.equals(events), "events bytes exact");
    const stampEvent = JSON.parse(gotEvents.toString("utf8").trim().split("\n").at(-1));
    assert.equal(sha256Of(gotFile), stampEvent.data.sha256);
    assert.deepEqual(readHumanOnlyAcs(gotFile, gotEvents, "FAFF-9", "L3"), { unattended: false, ids: ["faff-9#ac-1", "faff-9#ac-2"] });
  });

  test("regression: gitRun trims the newline and caps the buffer, so it would break the digest", (t) => {
    const fileBytes = asBytes(mkDoc());
    const events = bigEvents(fileBytes);
    const { repo, head } = commitAnchor(t, fileBytes, events);
    const viaGitRun = gitRun(repo, ["show", `${head}:${ANCHOR_DIR}/human-only-acs.json`]);
    assert.equal(viaGitRun.ok, true);
    assert.notEqual(sha256Of(Buffer.from(viaGitRun.stdout)), sha256Of(fileBytes), "the trimmed read hashes differently");
    assert.equal(gitRun(repo, ["show", `${head}:${ANCHOR_DIR}/events.jsonl`]).ok, false, "a blob over 1 MiB overflows gitRun's buffer");
    assert.ok(readAnchoredBytes(repo, null, `${ANCHOR_DIR}/events.jsonl`, head).equals(events));
  });

  test("a missing object returns null with or without a repo slug when gh is absent", (t) => {
    const { repo, head } = commitAnchor(t, asBytes(mkDoc()), Buffer.from("x\n"));
    assert.equal(readAnchoredBytes(repo, null, `${ANCHOR_DIR}/nope.json`, head), null);
    assert.equal(readAnchoredBytes(repo, null, `${ANCHOR_DIR}/human-only-acs.json`, "0".repeat(40)), null);
  });

  describe("Contents API fallback", () => {
    const withGh = (t, body) => {
      const bin = mkdtempSync(join(tmpdir(), "faff-1476-gh-"));
      t.after(() => rmSync(bin, { recursive: true, force: true }));
      const gh = join(bin, "gh");
      writeFileSync(gh, `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(body)}\nJSON\n`, { mode: 0o755 });
      const saved = process.env.PATH;
      process.env.PATH = `${bin}:${saved}`;
      t.after(() => { process.env.PATH = saved; });
    };
    const empty = (t) => {
      const dir = mkdtempSync(join(tmpdir(), "faff-1476-nogit-"));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      return dir;
    };

    test("decodes the base64 content without trimming", (t) => {
      const fileBytes = asBytes(mkDoc());
      const wrapped = fileBytes.toString("base64").replace(/(.{60})/g, "$1\n");
      withGh(t, { encoding: "base64", content: wrapped });
      const got = readAnchoredBytes(empty(t), "o/r", `${ANCHOR_DIR}/human-only-acs.json`, "a".repeat(40));
      assert.ok(Buffer.isBuffer(got) && got.equals(fileBytes));
      assert.equal(sha256Of(got), sha256Of(fileBytes));
    });

    test("returns null when the API gives no inline content", (t) => {
      withGh(t, { encoding: "none", content: "" });
      assert.equal(readAnchoredBytes(empty(t), "o/r", `${ANCHOR_DIR}/events.jsonl`, "a".repeat(40)), null);
    });

    test("returns null for a directory listing", (t) => {
      withGh(t, [{ name: "x" }]);
      assert.equal(readAnchoredBytes(empty(t), "o/r", ANCHOR_DIR, "a".repeat(40)), null);
    });

    test("does not call the API when repo is null", (t) => {
      withGh(t, { content: Buffer.from("hi").toString("base64") });
      assert.equal(readAnchoredBytes(empty(t), null, "x", "a".repeat(40)), null);
    });
  });
});

describe("the reader and helper stay out of the floors until slice 2", () => {
  for (const file of ["merge-gate.js", "merge-gate-local.js", "governance-check.js"]) {
    test(`${file} does not require or call them`, () => {
      const src = readFileSync(join(LIB, file), "utf8");
      assert.doesNotMatch(src, /human-only-acs["'\/]/);
      assert.doesNotMatch(src, /readHumanOnlyAcs|readAnchoredBytes/);
    });
  }
  test("the reader is a governance module that requires no factory module", () => {
    const src = readFileSync(join(LIB, "human-only-acs.ts"), "utf8");
    assert.match(src, /region:governance — human-only-acs/);
    assert.deepEqual([...src.matchAll(/require\("(\.[^"]+)"\)/g)].map((m) => m[1]), ["./ac-id"]);
  });
});
