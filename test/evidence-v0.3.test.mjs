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

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(REPO, "verification", "evidence", "v0.3");
const BUNDLE = join(REPO, "plugin", "skills", "faff", "contracts", "evidence-v0.3");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const lib = (name) => require(`../plugin/skills/faff/bin/lib/${name}.js`);
const { DELIVERY_PROFILE } = lib("governance-profile");
const { eventViolations } = lib("events");
const { declaredEffectViolations } = lib("effects");
const { redactKnownSecrets, resolveKnownSecretValues } = lib("redact");
const { runResumeEvent } = lib("resume");
const { runClaimAbandonedEvent } = lib("resumecheck");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const schemaPath = (name) => join(SRC, "schema", `${name}.schema.json`);
const schema = (name) => readJson(schemaPath(name));
const schemaFiles = () => readdirSync(join(SRC, "schema")).filter((f) => f.endsWith(".schema.json")).sort();
const walk = (dir) => readdirSync(dir).sort().flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

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
  writeFileSync(join(src, "run-ledger.json"), JSON.stringify({ run_id: runId }));
  writeFileSync(join(src, "declared-effects.jsonl"), readFileSync(join(SRC, "schema", "examples", "declared-effect.example.json"), "utf8").replace(/\s*\n\s*/g, " ") + "\n");
  mkdirSync(join(src, "FAFF-1"), { recursive: true });
  for (const f of ["ac-checklist.json", "review-verdict.json", "spec-review-verdict.json", "holdout.json", "build-progress.json", "landing-progress.json"]) {
    writeFileSync(join(src, "FAFF-1", f), "{}");
  }
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
const OPEN_PAYLOADS = new Set(["data", "effect", "payload"]);
const JSONL_SCHEMAS = new Set(["run-event.schema.json", "declared-effect.schema.json"]);

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

test("v0.3: every object node is closed, apart from the open JSONL payloads and discriminator bases", () => {
  for (const file of schemaFiles()) {
    walkSchema(readJson(join(SRC, "schema", file)), (node, trail) => {
      if (!node.type || ![].concat(node.type).includes("object")) return;
      if (trail[trail.length - 1] === "properties") return;
      const name = trail[trail.length - 1];
      if (JSONL_SCHEMAS.has(file) && OPEN_PAYLOADS.has(name) && trail[trail.length - 2] === "properties") return;
      if (node.discriminator) {
        for (const mapped of Object.values(node.discriminator.mapping)) {
          assert.equal(mapped.additionalProperties, false, `${file}: mapped sub-schema is open`);
        }
        return;
      }
      const ap = node.additionalProperties;
      assert.ok(ap === false || (ap && typeof ap === "object"), `${file} ${trail.join(".")} (${name}) is not closed`);
    });
  }
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
  ["run-20261014-065523-beepboop-list-10835a/FAFF-1267", "outcome_details."],
  ["run-20261014-065523-beepboop-list-10835a/FAFF-1263", "outcome_details."],
  // The live ledger of a run whose FAFF-1256 had already merged carries outcome_details.FAFF-1256.merge, which the
  // v0.3 schema does not allow; the writer-side fix belongs to the ledger-writer slice.
  ["run-20261014-065523-beepboop-list-10835a/FAFF-1259", "outcome_details.FAFF-1256"],
  ["run-20261014-065523-beepboop-list-10835a/FAFF-1258", "outcome_details."],
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

test("v0.3: schema enums mirror DELIVERY_PROFILE", () => {
  const event = schema("run-event").discriminator.mapping["2"].properties;
  assert.deepEqual(event.type.enum, DELIVERY_PROFILE.event_types);
  assert.deepEqual(event.phase.enum, DELIVERY_PROFILE.event_phases);
  assert.deepEqual(schema("run-ledger").properties.outcomes.additionalProperties.enum, DELIVERY_PROFILE.ledger_outcomes);
});

// --- docs and examples --------------------------------------------------------

test("v0.3: the evidence README lists v0.3 as draft with the draft rule and a changelog entry", () => {
  const readme = readFileSync(join(REPO, "verification", "evidence", "README.md"), "utf8");
  assert.match(readme, /\[`v0\.3\/`\]\(v0\.3\/\) \| draft \|/);
  assert.match(readme, /\*\*Draft rule:\*\*/);
  assert.match(readme, /^- \*\*v0\.3 — 2026-10-14 \(FAFF-1256, draft\)\.\*\*/m);
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
  for (const file of readdirSync(join(SRC, "schema", "examples")).sort()) {
    const name = file.replace(/\.invalid\.example\.json$/, "").replace(/\.example\.json$/, "").replace(/\.schema-\d+$/, "");
    const errs = validateAgainstSchema(readJson(join(SRC, "schema", "examples", file)), schema(name));
    if (file.includes(".invalid.")) assert.ok(errs.length > 0, file);
    else assert.deepEqual(errs, [], file);
  }
});
