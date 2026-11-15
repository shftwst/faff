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

// --- seam C: faff pr open mints the file --------------------------------------------------------

const { runPrOpen, defaultDeps } = require("../plugin/skills/faff/bin/lib/pr-open.js");
const { resolveUnattended, resolveIntegrity } = require("../plugin/skills/faff/bin/lib/merge-gate-floor.js");
const { chmodSync } = await import("node:fs");
const { basename, delimiter } = await import("node:path");

const sh = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const cleanEnv = (extra = {}) => {
  const e = { ...process.env };
  delete e.FAFF_RUN_DIR;
  delete e.FAFF_SESSION_ID;
  return { ...e, ...extra };
};

const GH_STUB = `#!/usr/bin/env node
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync(process.env.STUB_GH_CONFIG, "utf8"));
const args = process.argv.slice(2);
if (args[0] === "pr" && args[1] === "list") { process.stdout.write(JSON.stringify(cfg.prList)); process.exit(0); }
if (args[0] === "pr" && args[1] === "create") { process.stdout.write(cfg.prCreateUrl + "\\n"); process.exit(0); }
process.stderr.write("stub gh: unhandled " + args.join(" ") + "\\n");
process.exit(3);
`;

const TAGGED = "- [ ] [ac-1] returns 200 for GET /x\n- [ ] [ac-2] needs-human: Prices match the published pricing page\n- [ ] [ac-3] returns 404 for GET /y";
const TAGGED_OTHER = "- [ ] [ac-1] needs-human: returns 200 for GET /x\n- [ ] [ac-2] Prices match the published pricing page\n- [ ] [ac-3] returns 404 for GET /y";

// A main checkout with a linked build worktree on branch b, a local bare origin, a minted run dir, a gh stub
// and a main-checkout captured spec. `open()` runs the real `faff pr open` from the worktree.
function prFixture(t, { level = "L4", captured = spec(TAGGED) } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-1476-pr-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, "main");
  const bare = join(root, "origin.git");
  const wt = join(root, "wt");
  mkdirSync(main);
  sh(main, "init", "-q", "-b", "main");
  sh(main, "config", "user.name", "t");
  sh(main, "config", "user.email", "t@example.com");
  sh(main, "config", "commit.gpgsign", "false");
  writeFileSync(join(main, "README"), "seed\n");
  writeFileSync(join(main, ".gitignore"), ".faff/runs/\n.faff/graft/\n");
  sh(main, "add", ".");
  sh(main, "commit", "-q", "-m", "seed");
  sh(root, "init", "-q", "--bare", bare);
  sh(main, "remote", "add", "origin", bare);
  sh(main, "push", "-q", "origin", "main");
  sh(main, "worktree", "add", "-q", "-b", "b", wt);
  writeFileSync(join(wt, "work.txt"), "work\n");
  sh(wt, "add", "work.txt");
  sh(wt, "commit", "-q", "-m", "work");
  sh(wt, "push", "-q", "origin", "b");
  const minted = runCli(["run-ledger", "init-interactive", "--issue", ISSUE], { cwd: main, env: cleanEnv() });
  assert.equal(minted.code, 0, minted.stderr);
  const runDir = minted.stdout.trim();
  const ledgerFile = join(runDir, "run-ledger.json");
  const setLevel = (l) => {
    writeFileSync(ledgerFile, JSON.stringify({ ...readJson(ledgerFile), level: l }));
    const bound = runCli(["events", "append", "--run", basename(runDir)], { cwd: main, env: cleanEnv(), input: JSON.stringify({ phase: "run", type: "ledger-write", data: { ledger_sha256: sha256(readFileSync(ledgerFile)) } }) });
    assert.equal(bound.code, 0, bound.stderr);
  };
  setLevel(level);
  const issueDir = join(runDir, ISSUE);
  mkdirSync(issueDir, { recursive: true });
  cpSync(join(SCHEMAS, "examples", "ac-checklist.example.json"), join(issueDir, "ac-checklist.json"));
  cpSync(join(SCHEMAS, "examples", "review-verdict-anchored.example.json"), join(issueDir, "review-verdict.json"));
  const capturedFile = join(main, ".faff", "graft", ISSUE, "captured-spec.md");
  mkdirSync(dirname(capturedFile), { recursive: true });
  writeFileSync(capturedFile, captured);
  const draft = join(root, "draft.md");
  writeFileSync(draft, `Summary.\n\nImplements ${ISSUE}.\n`);
  const ghDir = join(root, "gh-bin");
  mkdirSync(ghDir);
  writeFileSync(join(ghDir, "gh"), GH_STUB);
  chmodSync(join(ghDir, "gh"), 0o755);
  const cfgFile = join(root, "gh.json");
  const setPrList = (prList) => writeFileSync(cfgFile, JSON.stringify({ prList, prCreateUrl: "https://example.invalid/pr/7" }));
  setPrList([]);
  const env = cleanEnv({ PATH: `${ghDir}${delimiter}${process.env.PATH}`, STUB_GH_CONFIG: cfgFile });
  const open = () => runCli(["pr", "open", "--run-dir", runDir, "--issue", ISSUE, "--base", "main", "--title", "T", "--body-file", draft, "--json"], { cwd: wt, env });
  const anchorRel = `.faff/anchors/${basename(runDir)}/${ISSUE}`;
  const anchorFile = (name) => join(wt, anchorRel, name);
  const headBlob = (name) => spawnSync("git", ["show", `HEAD:${anchorRel}/${name}`], { cwd: wt, encoding: "buffer" });
  const runFile = join(issueDir, "human-only-acs.json");
  const destFile = anchorFile("human-only-acs.json");
  return { root, main, wt, runDir, setLevel, capturedFile, setPrList, env, open, anchorRel, anchorFile, headBlob, runFile, destFile,
    sh: (...a) => sh(wt, ...a) };
}

const stampsIn = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "human-only-acs-stamp" && e.issue === ISSUE);

describe("faff pr open mint (real git)", () => {
  test("scenario 2: mints from the main-checkout captured spec although the worktree spec and spec-commit.json were rewritten", (t) => {
    const f = prFixture(t);
    const wtSpec = join(f.wt, "docs", "spec.md");
    mkdirSync(dirname(wtSpec), { recursive: true });
    writeFileSync(wtSpec, spec(TAGGED_OTHER));
    writeFileSync(join(f.runDir, ISSUE, "spec-commit.json"), JSON.stringify({ spec_path: wtSpec, sha256: sha256(Buffer.from(spec(TAGGED_OTHER))) }));
    f.sh("add", "-A");
    f.sh("commit", "-q", "-m", "rewrite spec");
    f.sh("push", "-q", "origin", "b");
    const r = f.open();
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.token, "opened");
    assert.deepEqual(out.warnings, []);
    const doc = JSON.parse(f.headBlob("human-only-acs.json").stdout.toString("utf8"));
    assert.equal(doc.issue, ISSUE);
    assert.equal(doc.level, "L4");
    assert.equal(doc.unattended, true);
    assert.deepEqual(doc.human_only, ["faff-9#ac-2"]);
    const anchoredFile = readFileSync(f.destFile);
    assert.ok(f.headBlob("human-only-acs.json").stdout.equals(anchoredFile));
    const stamps = stampsIn(f.anchorFile("events.jsonl"));
    assert.equal(stamps.at(-1).data.sha256, sha256(anchoredFile));
  });

  test("scenario 3: an unreadable captured spec still opens the PR, warns, and leaves no file in the anchor", (t) => {
    const f = prFixture(t);
    rmSync(f.capturedFile);
    const r = f.open();
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.token, "opened");
    assert.ok(out.warnings.some((w) => /human-only-acs\.json not minted: captured spec unreadable/.test(w)), out.warnings.join("|"));
    assert.ok(!existsSync(f.destFile));
    assert.ok(!existsSync(f.runFile));
    assert.notEqual(f.headBlob("run-ledger.json").status, null);
    assert.notEqual(f.headBlob("human-only-acs.json").status, 0);
  });

  test("scenario 4: a later fault after a committed mint deletes the file from the new anchor commit", (t) => {
    const f = prFixture(t);
    assert.equal(f.open().code, 0);
    assert.equal(f.headBlob("human-only-acs.json").status, 0);
    const firstHead = f.sh("rev-parse", "HEAD");
    f.setPrList([{ number: 7, url: "https://example.invalid/pr/7", baseRefName: "main", headRefOid: "0".repeat(40) }]);
    rmSync(f.capturedFile);
    writeFileSync(join(f.wt, "more.txt"), "more\n");
    f.sh("add", "more.txt");
    f.sh("commit", "-q", "-m", "more");
    const r = f.open();
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.token, "already-open");
    assert.ok(out.warnings.some((w) => /not minted: captured spec unreadable/.test(w)));
    assert.notEqual(f.sh("rev-parse", "HEAD"), firstHead);
    assert.notEqual(f.headBlob("human-only-acs.json").status, 0, "the new anchor commit no longer carries the file");
    assert.ok(!existsSync(f.destFile));
    assert.ok(!existsSync(f.runFile));
    assert.match(f.sh("show", "--name-status", "--format=", "HEAD"), new RegExp(`^D\\s+${f.anchorRel.replace(/[.]/g, "\\.")}/human-only-acs\\.json`, "m"));
  });

  test("scenario 5: older untracked copies are replaced, and the committed file is the newly written one", (t) => {
    const f = prFixture(t);
    mkdirSync(dirname(f.destFile), { recursive: true });
    writeFileSync(f.destFile, "stale destination\n");
    writeFileSync(f.runFile, "stale run dir\n");
    const r = f.open();
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.warnings, []);
    const written = readFileSync(f.runFile);
    assert.ok(!written.toString("utf8").includes("stale"));
    assert.ok(f.headBlob("human-only-acs.json").stdout.equals(written));
    assert.ok(readFileSync(f.destFile).equals(written));
  });

  test("an unchanged head with a tracked anchor returns already-open and runs no removal, mint or stamp", (t) => {
    const f = prFixture(t);
    assert.equal(f.open().code, 0);
    const head = f.sh("rev-parse", "HEAD");
    const eventsBefore = readFileSync(join(f.runDir, "events.jsonl"));
    const runBefore = readFileSync(f.runFile);
    f.setPrList([{ number: 7, url: "https://example.invalid/pr/7", baseRefName: "main", headRefOid: head }]);
    rmSync(f.capturedFile);
    const r = f.open();
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.token, "already-open");
    assert.deepEqual(out.warnings, []);
    assert.equal(f.sh("rev-parse", "HEAD"), head);
    assert.equal(f.headBlob("human-only-acs.json").status, 0, "the tracked file survives");
    assert.ok(existsSync(f.destFile));
    assert.ok(readFileSync(f.runFile).equals(runBefore));
    assert.ok(readFileSync(join(f.runDir, "events.jsonl")).equals(eventsBefore));
  });

  test("an empty human-only set still writes the file; L3 is unattended only when the main checkout config declares it", (t) => {
    const undeclared = prFixture(t, { level: "L3", captured: spec("- [ ] [ac-1] returns 200") });
    assert.equal(undeclared.open().code, 0);
    const none = readJson(undeclared.runFile);
    assert.deepEqual(none.human_only, []);
    assert.equal(none.level, "L3");
    assert.equal(none.unattended, false);

    const declared = prFixture(t, { level: "L3", captured: spec("- [ ] [ac-1] returns 200") });
    writeFileSync(join(declared.main, ".faffrc.yaml"), "autonomous:\n  unattended: true\n");
    assert.ok(!existsSync(join(declared.wt, ".faffrc.yaml")), "the worktree carries no config of its own");
    assert.equal(declared.open().code, 0);
    assert.equal(readJson(declared.runFile).unattended, true);
  });

  test("a level outside L1..L4 warns and mints nothing", (t) => {
    const f = prFixture(t, { level: "L9" });
    const r = f.open();
    const out = JSON.parse(r.stdout);
    assert.ok(out.warnings.some((w) => /not minted: run-ledger level unreadable/.test(w)), r.stdout + r.stderr);
    assert.ok(!existsSync(f.runFile));
    assert.ok(!existsSync(f.destFile));
  });
});

// --- seam C with fake dependencies: every fault path and the call order ----------------------------

const sp = (status = 0, stdout = "", stderr = "") => ({ status, stdout, stderr, timedOut: false });
const MAIN = "/main";
const CAPTURED = `${MAIN}/.faff/graft/FAFF-9/captured-spec.md`;
const RUN = "/runs/run-1";
const CLASSIFY_OUT = JSON.stringify({ criteria: [
  { source: "scenario", ac_id: "faff-9#scenario:1", human_only: false },
  { source: "done", ac_id: "faff-9#ac-1", human_only: false },
  { source: "done", ac_id: "faff-9#ac-2", human_only: true },
  { source: "done", ac_id: "faff-9#done:3", human_only: true },
  { source: "scenario", ac_id: "faff-9#scenario:2", human_only: true },
] });

function fakePrDeps(o = {}) {
  const calls = [];
  const inputs = {};
  const stale = [];
  const files = { "draft.md": "Body.\n", [CAPTURED]: "spec", [`${RUN}/run-ledger.json`]: JSON.stringify({ level: "L4" }), ...(o.files || {}) };
  const faffResp = { classify: sp(0, CLASSIFY_OUT), write: sp(0), ...(o.faff || {}) };
  const deps = {
    git: (args) => {
      const name = args[0] === "rev-parse" ? (args.includes("--abbrev-ref") ? "branch" : "head") : args[0] === "diff" ? "diff-cached" : args[0];
      calls.push(name);
      const defaults = { remote: sp(0, "origin\n"), branch: sp(0, "feat\n"), head: sp(0, "abc\n"), "ls-tree": sp(0, ""), rm: sp(0), add: sp(0), "diff-cached": sp(1), commit: sp(0), push: sp(0) };
      const r = o.git && o.git[name] !== undefined ? o.git[name] : defaults[name];
      return typeof r === "function" ? r(args) : r;
    },
    gh: () => { calls.push("pr-list"); return o.prList ?? sp(0, "[]"); },
    faff: (args, input) => {
      const name = args[0] === "dod" ? "classify" : args[0] === "evidence" ? "write" : args[0] === "commissaire" ? "status" : args[0] === "events" ? "anchor" : args[0];
      calls.push(name);
      if (input !== null) inputs[name] = input;
      if (name === "status") return sp(0, '{"governed":false}');
      if (name === "anchor") return sp(0);
      if (name === "pr-create") return sp(0, '{"verdict":"opened","pr_url":"https://github.com/o/r/pull/7"}');
      if (name === "bundle") return sp(0);
      const r = faffResp[name];
      return typeof r === "function" ? r(args, input) : r;
    },
    readReviewVerdict: () => "pass",
    sanitize: (d) => d,
    check: () => ({ ok: true, violations: [] }),
    validateAnchorGenesis: () => ({ valid: true }),
    prCreateGrantState: () => "valid-grant",
    deriveInputs: () => ({ level: "L4", attended: false, holdout: "missing" }),
    readFile: (f) => files[f] ?? null,
    writeTemp: (content) => { files["/tmp/safe.md"] = content; return "/tmp/safe.md"; },
    removeFile: () => {},
    removeStale: (f) => { calls.push("remove-stale"); stale.push(f); },
    mainCheckout: () => { calls.push("main-checkout"); return o.main === undefined ? MAIN : o.main; },
    unattendedFor: (level, root) => { calls.push("unattended-for"); assert.equal(root, MAIN); return level === "L4"; },
  };
  return { deps, calls, inputs, stale };
}
const PR_OPTS = { runDir: RUN, issue: ISSUE, base: "main", title: "t", bodyFile: "draft.md", specReviewEvidence: null };
const runMint = (o) => { const f = fakePrDeps(o); return { ...f, r: runPrOpen(PR_OPTS, f.deps) }; };
const DEST_FILE = ".faff/anchors/run-1/FAFF-9/human-only-acs.json";
const RUN_FILE = `${RUN}/FAFF-9/human-only-acs.json`;
const notMinted = (r, re) => assert.ok(r.warnings.some((w) => re.test(w)), r.warnings.join("|"));

describe("faff pr open mint (fake dependencies)", () => {
  test("the happy path removes first, mints once between pr-list and anchor, and pipes the derived document", () => {
    const { r, calls, inputs, stale } = runMint();
    assert.equal(r.token, "opened");
    assert.deepEqual(r.warnings, []);
    const order = ["pr-list", "rm", "main-checkout", "classify", "unattended-for", "write", "anchor", "add", "commit", "push"];
    assert.deepEqual(calls.filter((c) => order.includes(c)), order);
    assert.deepEqual(stale, [DEST_FILE, RUN_FILE]);
    assert.deepEqual(JSON.parse(inputs.write), { issue: ISSUE, level: "L4", unattended: true, human_only: ["faff-9#ac-2", "faff-9#done:3"] });
  });

  test("git rm runs with -f --ignore-unmatch --quiet on the destination copy", () => {
    const seen = [];
    runMint({ git: { rm: (args) => { seen.push(args); return sp(0); } } });
    assert.deepEqual(seen, [["rm", "-f", "--ignore-unmatch", "--quiet", "--", DEST_FILE]]);
  });

  test("an empty human-only set is still written", () => {
    const { r, inputs } = runMint({ faff: { classify: sp(0, JSON.stringify({ criteria: [{ source: "done", ac_id: "faff-9#ac-1", human_only: false }] })) } });
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(JSON.parse(inputs.write).human_only, []);
  });

  test("an unchanged head with a tracked anchor returns already-open before any removal, mint or stamp", () => {
    const { r, calls } = runMint({
      git: { head: sp(0, "abc\n"), "ls-tree": sp(0, "100644 blob x\tfile\n") },
      prList: sp(0, JSON.stringify([{ number: 7, url: "https://github.com/o/r/pull/7", baseRefName: "main", headRefOid: "abc" }])),
    });
    assert.equal(r.token, "already-open");
    assert.deepEqual(r.warnings, []);
    for (const never of ["rm", "remove-stale", "main-checkout", "classify", "write", "anchor", "commit", "push"]) assert.ok(!calls.includes(never), never);
  });

  const faults = [
    ["a null main checkout", { main: null }, /not minted: main checkout not resolved/, ["classify", "write"]],
    ["an unreadable captured spec", { files: { [CAPTURED]: undefined } }, /not minted: captured spec unreadable/, ["classify", "write"]],
    ["a classify non-zero exit", { faff: { classify: sp(2, "", "boom\n") } }, /not minted: faff dod classify exited 2: boom/, ["write"]],
    ["unparseable classify output", { faff: { classify: sp(0, "not json") } }, /not minted: faff dod classify printed unparseable output/, ["write"]],
    ["classify output with no criteria", { faff: { classify: sp(0, "{}") } }, /not minted: faff dod classify printed no criteria/, ["write"]],
    ["an unreadable run ledger", { files: { [`${RUN}/run-ledger.json`]: undefined } }, /not minted: run-ledger level unreadable/, ["write"]],
    ["an unparseable run ledger", { files: { [`${RUN}/run-ledger.json`]: "{" } }, /not minted: run-ledger level unreadable/, ["write"]],
    ["a run ledger level outside L1..L4", { files: { [`${RUN}/run-ledger.json`]: JSON.stringify({ level: "L5" }) } }, /not minted: run-ledger level unreadable/, ["write"]],
    ["a failed git rm", { git: { rm: sp(128, "", "fatal\n") } }, /not minted: git rm exited 128/, ["main-checkout", "classify", "write"]],
  ];
  for (const [label, o, re, skipped] of faults) {
    test(`${label} warns, mints nothing, and the PR still opens`, () => {
      const { r, calls, stale } = runMint(o);
      assert.equal(r.token, "opened");
      notMinted(r, re);
      for (const name of skipped) assert.ok(!calls.includes(name), name);
      assert.deepEqual(stale.slice(0, 2), [DEST_FILE, RUN_FILE]);
      for (const outward of ["anchor", "commit", "push", "pr-create"]) assert.ok(calls.includes(outward), outward);
    });
  }

  test("a writer failure warns and removes the run-dir copy again", () => {
    const { r, stale } = runMint({ faff: { write: sp(2, "", "cannot append\n") } });
    assert.equal(r.token, "opened");
    notMinted(r, /not minted: faff evidence write human-only-acs exited 2: cannot append/);
    assert.deepEqual(stale, [DEST_FILE, RUN_FILE, RUN_FILE]);
  });

  test("a dependency that throws is a warning that clears both copies", () => {
    const f = fakePrDeps();
    f.deps.mainCheckout = () => { throw new Error("probe exploded"); };
    const r = runPrOpen(PR_OPTS, f.deps);
    assert.equal(r.token, "opened");
    notMinted(r, /not minted: probe exploded/);
    assert.deepEqual(f.stale.slice(-2), [RUN_FILE, DEST_FILE]);
  });

  test("a caller that supplies no mint dependencies skips the step entirely", () => {
    const f = fakePrDeps();
    delete f.deps.removeStale;
    delete f.deps.mainCheckout;
    const r = runPrOpen(PR_OPTS, f.deps);
    assert.equal(r.token, "opened");
    assert.deepEqual(r.warnings, []);
    assert.ok(!f.calls.includes("rm") && !f.calls.includes("classify"));
  });

  test("defaultDeps supplies the mint dependencies, and removeStale deletes a file", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "faff-1476-stale-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const deps = defaultDeps(dir);
    writeFileSync(join(dir, "x.json"), "{}");
    deps.removeStale("x.json");
    assert.ok(!existsSync(join(dir, "x.json")));
    assert.doesNotThrow(() => deps.removeStale("never-existed.json"));
    assert.equal(typeof deps.mainCheckout, "function");
  });
});

describe("resolveUnattended", () => {
  const declared = { autonomous: { unattended: true } };
  test("L4 is unattended with or without config", () => {
    assert.equal(resolveUnattended("L4", undefined), true);
    assert.equal(resolveUnattended("L4", {}), true);
  });
  test("L3 is unattended only when the config declares it", () => {
    assert.equal(resolveUnattended("L3", declared), true);
    assert.equal(resolveUnattended("L3", {}), false);
    assert.equal(resolveUnattended("L3", undefined), false);
  });
  test("L1 and L2 are never unattended, even in a repo that declares it", () => {
    for (const level of ["L1", "L2"]) assert.equal(resolveUnattended(level, declared), false);
  });
  test("resolveIntegrity keeps its branch-6 outcome through the shared fact", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "faff-1476-integrity-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const same = (level, cfg) => JSON.stringify(resolveIntegrity(dir, ISSUE, level, undefined, cfg));
    assert.equal(same("L3", declared), same("L4", undefined), "an L3 run in a repo that declares unattended resolves like L4");
    assert.equal(same("L3", {}), same("L2", declared), "an undeclared L3 run resolves like an attended one");
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
