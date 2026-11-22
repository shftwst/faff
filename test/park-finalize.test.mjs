import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "./helpers/run-cli.mjs";

const base = { issue_id: "TEST-13", root_cause_class: "gap", timestamp: "2026-11-18T12:00:00.000Z" };
const human = { ...base, reconsider: "human", cited_input: null };

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "faff-park-finalize-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (sub, facts) => runCli(["park", sub, "--root", root], {
    cwd: root, input: JSON.stringify(facts),
  });
  return {
    root, run, call(sub, facts) {
      const result = run(sub, facts);
      assert.equal(result.code, 0, result.stderr);
      return JSON.parse(result.stdout);
    },
  };
}

test("park prepare freezes a supported machine input and downgrades unsupported citations", t => {
  const { root, run, call } = fixture(t);
  const bytes = "retry: 2\n";
  writeFileSync(path.join(root, "cfg.yml"), bytes);
  symlinkSync(process.execPath, path.join(root, "escaped"));
  assert.deepEqual(call("prepare", { ...base, reconsider: "machine",
    cited_input: { kind: "config-file", ref: "cfg.yml", keys: ["retry"] } }),
  { ...base, reconsider: "machine", cited_input: {
    kind: "config-file", ref: "cfg.yml", keys: ["retry"],
    fingerprint: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
  } });
  for (const cited_input of [
    {kind: "backend", ref: "backend"}, {kind: "config-file", ref: "missing"},
    {kind: "config-file", ref: "escaped"}, {kind: "config-file", ref: path.join(root, "cfg.yml")}, null,
  ]) {
    assert.deepEqual(call("prepare", { ...base, reconsider: "machine", cited_input }), human);
  }
  assert.deepEqual(call("prepare", base), human);
  assert.equal(run("prepare", { ...base, root_cause_class: "outage" }).code, 2);
});

test("park finalize requires a conclusive live observation before planning each effect", t => {
  const { call } = fixture(t);
  const finalize = (comment, label) => call("finalize", { record: human, comment, label });
  assert.deepEqual(finalize("missing", "missing"), { action: "comment" });
  assert.deepEqual(finalize("unknown", "missing"), { action: "reconcile", effect: "comment" });
  assert.deepEqual(finalize("confirmed", "missing"), { action: "label" });
  assert.deepEqual(finalize("confirmed", "unknown"), { action: "reconcile", effect: "label" });
  assert.deepEqual(finalize("confirmed", "confirmed"), { action: "record", park_records: [human] });
  assert.deepEqual(call("finalize", { record: human, comment: "missing", label: "missing", backstop: true }),
    { action: "reconcile", effect: "comment" });
  assert.deepEqual(call("finalize", { record: human, comment: "confirmed", label: "missing", backstop: true }),
    { action: "label" });
});

test("park finalize deduplicates a completed transition before observing a later unpark", t => {
  const { call } = fixture(t);
  const completed = { ...human, reconsider: "machine", cited_input: {
    kind: "config-file", ref: "cfg.yml", fingerprint: "sha256:" + "a".repeat(64),
  } };
  const facts = { record: completed, park_records: [completed] };
  assert.deepEqual(call("finalize", { ...facts, comment: "confirmed", label: "missing" }), {action: "already-recorded"});
  const other = call("prepare", { ...human, timestamp: "2026-11-18T13:00:00.000Z" });
  assert.deepEqual(call("finalize", { ...facts, record: other, comment: "missing", label: "missing" }),
    { action: "comment" }, "an old comment and a cleared label do not complete the new park");
  assert.deepEqual(call("finalize", { ...facts, record: other, comment: "confirmed", label: "missing" }),
    { action: "label" }, "a confirmed new comment still needs the label after manual unpark");
  assert.deepEqual(call("finalize", { ...facts, record: other, marker: "missing" }),
    { action: "reconcile", effect: "marker" }, "a historical git-only marker does not confirm the new park");
  assert.deepEqual(call("finalize", { ...facts, record: other, marker: "confirmed" }),
    { action: "record", park_records: [completed, other] });
  assert.deepEqual(call("finalize", { ...facts, record: other, comment: "confirmed", label: "confirmed" }),
    { action: "record", park_records: [completed, other] });
});

test("park finalize uses the existing git-only marker confirmation and never plans tracker effects", t => {
  const { call, run } = fixture(t);
  assert.deepEqual(call("finalize", { record: human, marker: "confirmed" }), { action: "record", park_records: [human] });
  assert.deepEqual(call("finalize", { record: human, marker: "missing" }), { action: "reconcile", effect: "marker" });
  assert.equal(run("finalize", { record: human, marker: "confirmed", comment: "confirmed" }).code, 2);
});
