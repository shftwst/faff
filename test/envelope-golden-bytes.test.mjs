// FAFF-1241 — write-path golden bytes for the one shared schema:3 envelope builder.
//
// Key-sorted canonical signatures and the treeDigest read-immutability check are both field-order
// independent, so only an exact-bytes assertion catches a field-order or conditional-field slip in
// the builder that commissaire.ts and governor.ts share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEnvelope } from "../plugin/skills/faff/bin/lib/producer-auth.js";
import { buildEnvelope as commissaireBuildEnvelope } from "../plugin/skills/faff/bin/lib/commissaire.js";

const TS = "2026-10-09T00:00:00.000Z";
const EFFECT = { kind: "merge", target: "main" };

const GOLDEN_GOVERNOR_VERDICT =
  '{"schema":3,"run_id":"RUN-G","seq":4,"ts":"2026-10-09T00:00:00.000Z","author":"commissaire","producer_id":"P1","contract_revision":"r1","kind_of_entry":"effect-decision-verdict","unit_id":"FAFF-1","step":"merge","prev":"abc123","payload":{"verdict":"grant"}}';
const GOLDEN_COMMISSAIRE_PRODUCER =
  '{"schema":3,"run_id":"RUN-C","seq":2,"ts":"2026-10-09T00:00:00.000Z","author":"producer","producer_id":"P1","contract_revision":"r1","kind_of_entry":"observe","unit_id":"FAFF-2","step":"merge","prev":"def456","effect":{"kind":"merge","target":"main"}}';
const GOLDEN_BARE =
  '{"schema":3,"run_id":"RUN-C","seq":1,"ts":"2026-10-09T00:00:00.000Z","author":"producer","producer_id":"P1","contract_revision":"r1","kind_of_entry":"declare","unit_id":"FAFF-3","step":"merge","prev":"genesis"}';

test("governor-shaped mint: exact bytes, payload included, effect omitted", () => {
  const rec = buildEnvelope("RUN-G", 4, "abc123", "commissaire", "P1", "r1",
    { kind_of_entry: "effect-decision-verdict", unit_id: "FAFF-1", step: "merge", payload: { verdict: "grant" } }, TS);
  assert.equal(JSON.stringify(rec), GOLDEN_GOVERNOR_VERDICT);
});

test("commissaire-shaped mint: exact bytes, effect included, payload omitted", () => {
  const rec = commissaireBuildEnvelope("RUN-C", 2, "def456", "producer", "P1", "r1",
    { kind_of_entry: "observe", unit_id: "FAFF-2", step: "merge", effect: EFFECT }, TS);
  assert.equal(JSON.stringify(rec), GOLDEN_COMMISSAIRE_PRODUCER);
});

test("a body with neither effect nor payload emits neither key", () => {
  const rec = buildEnvelope("RUN-C", 1, "genesis", "producer", "P1", "r1",
    { kind_of_entry: "declare", unit_id: "FAFF-3", step: "merge" }, TS);
  assert.equal(JSON.stringify(rec), GOLDEN_BARE);
});

test("omitting ts stamps now, in the same field position", () => {
  const rec = buildEnvelope("RUN-G", 1, "p", "commissaire", "P1", "r1", { kind_of_entry: "k", unit_id: "U", step: "s" });
  assert.match(rec.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(Object.keys(rec), ["schema", "run_id", "seq", "ts", "author", "producer_id", "contract_revision", "kind_of_entry", "unit_id", "step", "prev"]);
});

test("commissaire re-exports the shared builder", () => {
  assert.equal(commissaireBuildEnvelope, buildEnvelope);
});
