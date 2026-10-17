// FAFF-1256: the v0.3 evidence schemas, manifest and bundled copy checked against the
// shapes the writers produce and the data committed in .faff/anchors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAgainstSchema } from "../plugin/skills/faff/contracts/validate-schema.mjs";
import { mintL4Ledger } from "./helpers/mint-l4-ledger.mjs";
import { example, seedFloor, seedOptionalFloor } from "./helpers/evidence-anchor-fixtures.mjs";

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(REPO, "verification", "evidence", "v0.3");
const BUNDLE = join(REPO, "plugin", "skills", "faff", "contracts", "evidence-v0.3");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const lib = (name) => require(`../plugin/skills/faff/bin/lib/${name}.js`);
const { DELIVERY_PROFILE } = lib("governance-profile");
const { DECISION_CAPTURE_COVERAGE_VALUES, DISPATCH_KINDS, EFFORT_LEVELS, QUALITY_GATE_CATCHES, RUNNER_IDENTITY_CREDENTIAL_SOURCES, eventViolations } = lib("events");
const { CONCLUSION_KIND, EFFECT_KINDS, LEGACY_CONCLUSION_KIND, declaredEffectViolations } = lib("effects");
const { DECISION_VERDICTS, KIND_AUTHOR } = lib("commissaire");
const { redactKnownSecrets, resolveKnownSecretValues } = lib("redact");
const { runResumeEvent } = lib("resume");
const { runClaimAbandonedEvent } = lib("resumecheck");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const schemaPath = (name) => join(SRC, "schema", `${name}.schema.json`);
const schema = (name) => readJson(schemaPath(name));
const walk = (dir) => readdirSync(dir).sort().flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
// Every schema file, top level and the per-type subdirectories, as a path relative to schema/.
const schemaFiles = () => walk(join(SRC, "schema")).map((p) => relative(join(SRC, "schema"), p).split("\\").join("/"))
  .filter((f) => f.endsWith(".schema.json") && !f.startsWith("examples/"));

const anchors = [];
for (const run of readdirSync(join(REPO, ".faff", "anchors"))) {
  for (const issue of readdirSync(join(REPO, ".faff", "anchors", run))) {
    anchors.push({ id: `${run}/${issue}`, dir: join(REPO, ".faff", "anchors", run, issue) });
  }
}
const committed = (file) => anchors.filter((a) => existsSync(join(a.dir, file))).map((a) => ({ ...a, path: join(a.dir, file) }));

// --- manifest and file layout ------------------------------------------------

test("v0.3: anchor-manifest.json validates against its schema and has exactly the twelve entries", () => {
  const manifest = readJson(join(SRC, "anchor-manifest.json"));
  assert.deepEqual(validateAgainstSchema(manifest, schema("anchor-manifest")), []);
  assert.deepEqual(Object.keys(manifest.files).sort(), [
    "ac-checklist.json", "build-progress.json", "chain-head.json", "commissaire/producer/pk.json", "declared-effects.jsonl",
    "effects-chain-head.json", "events.jsonl", "holdout.json", "landing-progress.json", "review-verdict.json",
    "run-ledger.json", "spec-review-verdict.json",
  ]);
  for (const entry of Object.values(manifest.files)) assert.ok(existsSync(join(SRC, entry.schema)), entry.schema);
});

test("v0.3: a per-PR mint with every optional file present produces only manifested files", () => {
  const src = mkdtempSync(join(tmpdir(), "faff-v03-mint-src-"));
  const dest = mkdtempSync(join(tmpdir(), "faff-v03-mint-dest-"));
  const runId = "run-v03-mint";
  const genesis = { schema: 2, run_id: runId, seq: 0, ts: "2026-01-01T00:00:00.000Z", phase: "run", type: "run-start", prev: createHash("sha256").update(runId, "utf8").digest("hex") };
  writeFileSync(join(src, "events.jsonl"), JSON.stringify(genesis) + "\n");
  writeFileSync(join(src, "run-ledger.json"), example("run-ledger"));
  writeFileSync(join(src, "declared-effects.jsonl"), readFileSync(join(SRC, "schema", "examples", "declared-effect.example.json"), "utf8").replace(/\s*\n\s*/g, " ") + "\n");
  seedFloor(src, "FAFF-1");
  seedOptionalFloor(src, "FAFF-1");
  mkdirSync(join(src, "commissaire", "producer"), { recursive: true });
  writeFileSync(join(src, "commissaire", "producer", "pk.json"), readFileSync(join(SRC, "schema", "examples", "producer-pk.example.json")));
  const r = spawnSync(process.execPath, [BIN, "events", "anchor", "--run-dir", src, "--issue", "FAFF-1", "--dest", dest], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const produced = walk(dest).map((p) => relative(dest, p).split("\\").join("/")).sort();
  const manifest = readJson(join(SRC, "anchor-manifest.json"));
  assert.deepEqual(produced, Object.keys(manifest.files).sort());
  rmSync(src, { recursive: true, force: true });
  rmSync(dest, { recursive: true, force: true });
});

test("v0.3: the bundled copy and verification/evidence/v0.3 have the same files and identical bytes", () => {
  const rel = (root) => walk(root).map((p) => relative(root, p));
  assert.deepEqual(rel(BUNDLE), rel(SRC));
  for (const f of rel(SRC)) assert.ok(readFileSync(join(SRC, f)).equals(readFileSync(join(BUNDLE, f))), f);
});

// --- schema lint --------------------------------------------------------------

const KNOWN_TYPES = new Set(["object", "array", "string", "boolean", "number", "integer", "null"]);

function walkSchema(node, visit, trail = []) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((n, i) => walkSchema(n, visit, [...trail, String(i)])); return; }
  visit(node, trail);
  for (const [k, v] of Object.entries(node)) {
    if (k === "enum" || k === "required") continue;
    walkSchema(v, visit, [...trail, k]);
  }
}

test("v0.3: every type value in every schema is one of the seven known names", () => {
  for (const file of schemaFiles()) {
    walkSchema(readJson(join(SRC, "schema", file)), (node, trail) => {
      if (node.type === undefined || trail[trail.length - 1] === "properties") return;
      for (const name of [].concat(node.type)) assert.ok(KNOWN_TYPES.has(name), `${file} ${trail.join(".")}: ${name}`);
    });
  }
});

// FAFF-1260: the open nodes a different contract owns and checks. A node is named by the record
// type or kind its schema describes plus its path from the record root; it appears in that type's
// own file and again in the composed log schema.
const OPEN_NODES = new Set([
  "decision-capture: data.normalised_inputs",
  "decision-capture: data.verdict",
  "decision-capture: data.selected_action",
  "decision-capture-action: data.selected_action",
  "effect-decision-request: payload.effect",
  "effect-decision-verdict: payload.effect",
]);
// Open by design elsewhere: free-form outcome_details entries (FAFF-1274) and the frozen schema-1
// event payload (no writer emits schema 1).
const OPEN_ENTRIES = new Set(["run-ledger: outcome_details.<entry>", "run-event: data"]);
const OWNING_DISCRIMINATORS = new Set(["type", "kind_of_entry"]);

// The record a schema file describes before any discriminator mapping is entered.
function fileOwner(file) {
  const m = file.match(/^(events|commissaire|effects)\/(.+)\.schema\.json$/);
  return m ? m[2] : file.replace(/\.schema\.json$/, "");
}

// Walks a schema and returns its open nodes as "<owner>: <path>". An object node is open when it
// neither closes its keys nor is a discriminator base; a property schema with no type is open too.
function openObjectNodes(file, root) {
  const open = [];
  const visit = (node, owner, at) => {
    if (node === null || typeof node !== "object") return;
    const name = `${owner}: ${at.join(".")}`;
    if (node.discriminator) {
      const owns = OWNING_DISCRIMINATORS.has(node.discriminator.field);
      for (const [key, mapped] of Object.entries(node.discriminator.mapping)) visit(mapped, owns ? key : owner, at);
      return;
    }
    const types = [].concat(node.type || []);
    if (node.type === undefined && at.length > 0) open.push(name);
    if (types.includes("object")) {
      const ap = node.additionalProperties;
      if (ap && typeof ap === "object") visit(ap, owner, [...at, "<entry>"]);
      else if (ap !== false) open.push(name);
    }
    for (const [k, sub] of Object.entries(node.properties || {})) visit(sub, owner, [...at, k]);
    if (node.items) visit(node.items, owner, [...at, "[]"]);
  };
  visit(root, fileOwner(file), []);
  return open;
}

test("v0.3: every object node is closed apart from the named open nodes and the outcome_details entries", () => {
  const found = new Set();
  for (const file of schemaFiles()) {
    for (const node of openObjectNodes(file, readJson(join(SRC, "schema", file)))) {
      assert.ok(OPEN_NODES.has(node) || OPEN_ENTRIES.has(node), `${file}: ${node} is open`);
      found.add(node);
    }
  }
  assert.deepEqual([...found].filter((n) => OPEN_NODES.has(n)).sort(), [...OPEN_NODES].sort());
});

test("v0.3: the closure lint catches an open payload, an untyped property and a non-closing mapping", () => {
  const event = schema("events/park");
  event.properties.data.properties.extra = { type: "object" };
  event.properties.data.properties.untyped = {};
  assert.deepEqual(openObjectNodes("events/park.schema.json", event).sort(), ["park: data.extra", "park: data.untyped"]);
  const composed = schema("run-event");
  delete composed.discriminator.mapping["2"].discriminator.mapping["run-end"].properties.data.additionalProperties;
  assert.deepEqual(openObjectNodes("run-event.schema.json", composed).filter((n) => !OPEN_NODES.has(n) && !OPEN_ENTRIES.has(n)), ["run-end: data"]);
  const ledger = schema("run-ledger");
  ledger.properties.outcomes.additionalProperties = { type: "object" };
  assert.deepEqual(openObjectNodes("run-ledger.schema.json", ledger).filter((n) => !OPEN_ENTRIES.has(n)), ["run-ledger: outcomes.<entry>"]);
});

test("v0.3: every evidence-document schema requires schema_version with enum [1]", () => {
  const manifest = readJson(join(SRC, "anchor-manifest.json"));
  for (const entry of Object.values(manifest.files).filter((e) => e.versioned_by === "field")) {
    const s = readJson(join(SRC, entry.schema));
    assert.ok(s.required.includes("schema_version"), entry.schema);
    assert.deepEqual(s.properties.schema_version.enum, [1], entry.schema);
  }
  assert.ok(schema("review-round").required.includes("schema_version"));
});

test("v0.3: the unknown-type guard fires in both validator copies", () => {
  const { validateAgainstSchema: cjs } = lib("contract-engine");
  const bad = { type: ["objet", "null"] };
  assert.deepEqual(validateAgainstSchema({}, bad), ["<root>: schema error: unknown type objet"]);
  assert.deepEqual(cjs({}, bad), ["<root>: schema error: unknown type objet"]);
});

// --- restated shapes stay in step with their sources --------------------------

function shape(node) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(shape);
  const out = {};
  if (node.type !== undefined) out.type = [].concat(node.type).filter((t) => t !== "null").sort();
  if (node.required) out.required = [...node.required].sort();
  if (node.additionalProperties !== undefined) out.additionalProperties = typeof node.additionalProperties === "object" ? shape(node.additionalProperties) : node.additionalProperties;
  if (node.properties) out.properties = Object.fromEntries(Object.entries(node.properties).map(([k, v]) => [k, shape(v)]));
  if (node.items) out.items = shape(node.items);
  return out;
}

test("v0.3: producer-pk matches the Commissaire facade v0.2 producer-pk", () => {
  const facade = readJson(join(REPO, "verification", "commissaire-facade", "v0.2", "schema", "producer-pk.schema.json"));
  assert.deepEqual(shape(schema("producer-pk")), shape(facade));
});

test("v0.3: the holdout attestation matches contracts/holdout-verdict.schema.json", () => {
  const contract = readJson(join(REPO, "plugin", "skills", "faff", "contracts", "holdout-verdict.schema.json"));
  assert.deepEqual(shape(schema("holdout-anchored").properties.attestation), shape(contract.properties.attestation));
});

// --- committed data -----------------------------------------------------------

test("v0.3: every committed chain-head.json and effects-chain-head.json validates", () => {
  const files = [...committed("chain-head.json"), ...committed("effects-chain-head.json")];
  assert.ok(files.length > 100);
  for (const f of files) assert.deepEqual(validateAgainstSchema(readJson(f.path), schema("chain-head")), [], f.id);
});

test("v0.3: every committed build-progress.json validates once schema_version is inserted", () => {
  const files = committed("build-progress.json");
  assert.ok(files.length > 100);
  for (const f of files) assert.deepEqual(validateAgainstSchema({ schema_version: 1, ...readJson(f.path) }, schema("build-progress")), [], f.id);
});

test("v0.3: every committed producer pk.json validates", () => {
  for (const f of committed("commissaire/producer/pk.json")) assert.deepEqual(validateAgainstSchema(readJson(f.path), schema("producer-pk")), [], f.id);
});

const LEDGER_EXCEPTIONS = new Map([
  ["run-20260803-232227-beepboop-full/FAFF-647", "outcomes.FAFF-647"],
  ["run-20260810-185342-beepboop-list/FAFF-581", "budget.envelope.window"],
  ["run-20260810-185342-beepboop-list/FAFF-699", "budget.envelope.window"],
  ["run-20260810-185342-beepboop-list/FAFF-723", "budget.envelope.window"],
  ["run-20260818-195900-beepboop-list-dac127/FAFF-865", "post_merge_verification_failures[0]"],
  ["run-20260915-094719-fly-l3/FAFF-1017", "post_merge_verification_failures[0]"],
  ["run-20260903-203823-fly-l3/FAFF-959", "outcome_details."],
]);

test("v0.3: every committed run-ledger.json validates except the seven known writer bugs", () => {
  const files = committed("run-ledger.json");
  assert.ok(files.length > 100);
  const failing = new Map();
  for (const f of files) {
    const errs = validateAgainstSchema({ schema_version: 1, ...readJson(f.path) }, schema("run-ledger"));
    if (errs.length) failing.set(f.id, errs);
  }
  assert.deepEqual([...failing.keys()].sort(), [...LEDGER_EXCEPTIONS.keys()].sort());
  for (const [id, key] of LEDGER_EXCEPTIONS) {
    assert.ok(failing.get(id).some((e) => e.startsWith(key)), `${id} should fail naming ${key}: ${failing.get(id)}`);
  }
});

test("v0.3: a ledger minted by the L4 fixture validates", () => {
  const { root, ledger } = mintL4Ledger();
  assert.deepEqual(validateAgainstSchema({ schema_version: 1, ...ledger }, schema("run-ledger")), []);
  rmSync(root, { recursive: true, force: true });
});

test("v0.3: outcome_details entries are free-form objects while outcomes stays a terminal-state string", () => {
  const ledger = (extra) => validateAgainstSchema({ schema_version: 1, run_id: "r", ...extra }, schema("run-ledger"));
  assert.deepEqual(ledger({
    outcomes: { "FAFF-1": "shipped", "FAFF-2": "parked" },
    outcome_details: {
      "FAFF-1": { merge: { sha: "abc1234", pr: 1 }, superseded_by: ["FAFF-2"] },
      "FAFF-2": { attempts: [1, 2], unlisted_key: null },
    },
  }), []);
  assert.deepEqual(ledger({ outcome_details: {} }), []);
  const fails = (doc, key) => {
    const errs = ledger(doc);
    assert.ok(errs.some((e) => e.startsWith(key)), `should fail naming ${key}: ${errs}`);
  };
  fails({ outcome_details: { "FAFF-1": 5 } }, "outcome_details.FAFF-1");
  fails({ outcome_details: { "FAFF-1": "bare string note" } }, "outcome_details.FAFF-1");
  fails({ outcome_details: ["FAFF-1"] }, "outcome_details");
  fails({ outcomes: { "FAFF-1": { state: "shipped" } } }, "outcomes.FAFF-1");
});

test("v0.3: every committed event line eventViolations accepts also passes run-event", () => {
  let checked = 0;
  for (const f of committed("events.jsonl")) {
    for (const line of readFileSync(f.path, "utf8").split("\n").filter(Boolean)) {
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (eventViolations(rec, true).length) continue;
      checked++;
      assert.deepEqual(validateAgainstSchema(rec, schema("run-event")), [], `${f.id}: ${line.slice(0, 120)}`);
    }
  }
  assert.ok(checked > 1000);
});

test("v0.3: every committed declared-effects line declaredEffectViolations accepts also passes declared-effect", () => {
  let checked = 0;
  for (const f of committed("declared-effects.jsonl")) {
    for (const line of readFileSync(f.path, "utf8").split("\n").filter(Boolean)) {
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (declaredEffectViolations(rec).length) continue;
      checked++;
      assert.deepEqual(validateAgainstSchema(rec, schema("declared-effect")), [], `${f.id}: ${line.slice(0, 120)}`);
    }
  }
  assert.ok(checked > 500);
});

test("v0.3: events built by the in-code builders that write extra top-level keys pass run-event", () => {
  const prev = "a".repeat(64);
  const plan = { epoch: 2, skip: ["FAFF-1"], redispatch: ["FAFF-2"], park: [] };
  const resume = runResumeEvent("run-x", 3, "2026-01-01T00:00:00.000Z", "aborted-resumable", plan, prev);
  const abandoned = runClaimAbandonedEvent("run-x", 4, "2026-01-01T00:00:00.000Z", 2, prev);
  for (const rec of [resume, abandoned]) {
    assert.deepEqual(eventViolations(rec, true), []);
    assert.deepEqual(validateAgainstSchema(rec, schema("run-event")), []);
  }
});

test("v0.3: schema enums mirror their code constants", () => {
  const byType = schema("run-event").discriminator.mapping["2"].discriminator.mapping;
  assert.deepEqual(Object.keys(byType), DELIVERY_PROFILE.event_types);
  for (const [type, s] of Object.entries(byType)) {
    assert.deepEqual(s.properties.type.enum, [type]);
    assert.deepEqual(s.properties.phase.enum, DELIVERY_PROFILE.event_phases, type);
    for (const tag of ["effort", "gate"]) {
      const node = s.properties.data.properties[tag];
      if (node) assert.deepEqual(node.enum, [...{ effort: EFFORT_LEVELS, gate: QUALITY_GATE_CATCHES }[tag]], `${type} data.${tag}`);
    }
  }
  assert.deepEqual(schema("run-ledger").properties.outcomes.additionalProperties.enum, DELIVERY_PROFILE.ledger_outcomes);
  assert.deepEqual(byType["issue-outcome"].properties.data.properties.outcome.enum, DELIVERY_PROFILE.ledger_outcomes);
  assert.deepEqual(byType["agent-dispatch"].properties.data.properties.kind.enum, [...DISPATCH_KINDS]);
  assert.deepEqual(byType["decision-capture"].properties.data.properties.coverage.enum, [...DECISION_CAPTURE_COVERAGE_VALUES]);
  assert.deepEqual(byType["runner-identity"].properties.data.properties.credential_source.enum, [...RUNNER_IDENTITY_CREDENTIAL_SOURCES]);
  const effects = schema("declared-effect").discriminator.mapping["2"].properties.effect.discriminator.mapping;
  assert.deepEqual(Object.keys(effects), [...EFFECT_KINDS]);
  const kinds = schema("declared-effect").discriminator.mapping["3"].discriminator.mapping;
  assert.deepEqual(Object.keys(kinds), [...Object.keys(KIND_AUTHOR), LEGACY_CONCLUSION_KIND]);
  for (const [kind, s] of Object.entries(kinds)) assert.deepEqual(s.properties.author.enum, [KIND_AUTHOR[kind === LEGACY_CONCLUSION_KIND ? CONCLUSION_KIND : kind]], kind);
  for (const kind of ["effect-decision-verdict"]) {
    assert.deepEqual(kinds[kind].properties.payload.properties.verdict.enum, [...DECISION_VERDICTS]);
    assert.deepEqual(kinds[kind].properties.payload.properties.pure_verdict.enum, [...DECISION_VERDICTS]);
  }
});

// --- docs and examples --------------------------------------------------------

test("v0.3: the evidence README lists v0.3 as current with one versioning rule and a changelog entry", () => {
  const readme = readFileSync(join(REPO, "verification", "evidence", "README.md"), "utf8");
  assert.match(readme, /\[`v0\.3\/`\]\(v0\.3\/\) \| current \|/);
  assert.doesNotMatch(readme, /\*\*Draft rule:\*\*/);
  assert.match(readme, /^- \*\*v0\.3 — 2026-10-17 \(FAFF-1261, current, slice 6\)\.\*\*/m);
  assert.match(readme, /^- \*\*v0\.3 — 2026-10-14 \(FAFF-1256, draft\)\.\*\*/m);
  const entry = readme.slice(readme.indexOf("(FAFF-1261, current, slice 6)"), readme.indexOf("(FAFF-1260, draft, slice 5)"));
  assert.ok(entry.includes("FAFF-1287") && entry.includes("FAFF-1268"), "the freeze entry names both in-place additions");
  assert.match(readme, /v0\.1 and v0\.2 are \*\*immutable\*\*/);
  assert.match(readme, /typo or prose fix/);
  assert.match(readme, /additive change to a JSON evidence document/);
  assert.match(readme, /schema-first, writer-second/);
  assert.match(readme, /Any other change\*\* to a v0\.3 schema needs a new minor version/);
  assert.match(readme, /\*\*Vocabulary sequencing:\*\*/);
  assert.match(readme, /v1\.0 is reserved for the first version an external consumer pins/);
  assert.doesNotMatch(readme, /every change to the documented shape/);
  assert.doesNotMatch(readme, /Published version directories are \*\*immutable\*\*/);
  const v03 = readFileSync(join(SRC, "README.md"), "utf8");
  assert.match(v03, /^# Agent Delivery Evidence spec, v0\.3 \(current\)/);
  assert.match(v03, /\*\*Status: current\.\*\*/);
  assert.doesNotMatch(v03, /Nothing refuses on v0\.3|Nothing in this version changes a gate|freezes when FAFF-1261/);
  assert.match(v03, /versioning rule in\s+\[`verification\/evidence\/README\.md`\]/);
  for (const page of ["README.md", "anchor-manifest.md", "evidence-documents.md", "logs.md"]) assert.ok(existsSync(join(SRC, page)), page);
  const manifestPage = readFileSync(join(SRC, "anchor-manifest.md"), "utf8");
  for (const anchorPath of Object.keys(readJson(join(SRC, "anchor-manifest.json")).files)) assert.ok(manifestPage.includes(`\`${anchorPath}\``), anchorPath);
});

test("v0.3: every bundled example passes redactKnownSecrets unchanged and carries no copied run identity", () => {
  const secrets = resolveKnownSecretValues();
  const examples = walk(join(SRC, "schema", "examples"));
  assert.ok(examples.length >= 26);
  for (const file of examples) {
    const doc = readJson(file);
    assert.deepEqual(redactKnownSecrets(doc, secrets), doc, file);
  }
  const text = examples.map((f) => readFileSync(f, "utf8")).join("\n");
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text), "a UUID session id");
  assert.ok(!/\.local|\.lan|\/Users\/|\/home\//.test(text), "a hostname or path");
  assert.ok(!/run-2026(?!0101-000000-example)\d{4}-/.test(text), "a committed run id");
});

test("v0.3: every example validates (valid) or fails (invalid) against its schema", () => {
  const examples = join(SRC, "schema", "examples");
  for (const path of walk(examples)) {
    const file = relative(examples, path).split("\\").join("/");
    const name = file.replace(/\.invalid\.example\.json$/, "").replace(/\.example\.json$/, "").replace(/\.schema-\d+$/, "");
    const errs = validateAgainstSchema(readJson(path), schema(name));
    if (file.includes(".invalid.")) assert.ok(errs.length > 0, file);
    else assert.deepEqual(errs, [], file);
  }
});
