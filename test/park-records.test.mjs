// FAFF-779 — the shared park-record WRITER seam: `addParkRecord` (the orchestrator's
// in-run park_records accumulator, dedup-by-completed-transition) and `renderParksBlock`
// (the run-end canonical `faff-parks` fence). This is the behavioral-orchestration-seam
// coverage the spec calls for: "if summary-record emission cannot be proved at the
// orchestration seam, do not satisfy the requirement with hand-authored consumer fixtures
// alone." These two pure functions ARE that seam — `faff-beep-boop`'s Park protocol
// (gateway → Park protocol (shared) → the accumulator and render boundary) calls exactly
// these, not a bespoke per-verdict writer, so a punt/gap/cycle park all round-trip through
// the same code.
//
// Round-trip proof: `renderParksBlock`'s output is parsed back by `extractParksBlock`
// (park-history.js's existing reader, FAFF-152) to the identical array — the reader and
// writer share one wire format, never a second storage format (spec OUT OF SCOPE).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addParkRecord, renderParksBlock, extractParksBlock,
} from "../plugin/skills/faff/bin/lib/park-history.js";

test("renderParksBlock: zero parks emits exactly one fence containing []", () => {
  const block = renderParksBlock([]);
  const fences = block.match(/```faff-parks/g) ?? [];
  assert.equal(fences.length, 1, "exactly one faff-parks fence");
  assert.deepEqual(extractParksBlock(block, "run-t"), []);
});

test("renderParksBlock: absent/undefined accumulator degrades to the same empty fence", () => {
  const block = renderParksBlock(undefined);
  assert.deepEqual(extractParksBlock(block, "run-t"), []);
});

test("renderParksBlock: one record round-trips byte-for-byte through extractParksBlock", () => {
  const records = [{ issue_id: "FAFF-1", root_cause_class: "punt-not-closed", timestamp: "2026-08-12T10:00:00Z" }];
  const block = renderParksBlock(records);
  const fences = block.match(/```faff-parks/g) ?? [];
  assert.equal(fences.length, 1);
  assert.deepEqual(extractParksBlock(block, "run-t"), records);
});

test("renderParksBlock: multiple parks retain occurrence order across classes (gap/cycle/punt — shared writer, not Punt-special-cased)", () => {
  const records = [
    { issue_id: "FAFF-1", root_cause_class: "gap", timestamp: "2026-08-12T09:00:00Z" },
    { issue_id: "FAFF-2", root_cause_class: "cycle", timestamp: "2026-08-12T09:05:00Z" },
    { issue_id: "FAFF-3", root_cause_class: "punt-not-closed", timestamp: "2026-08-12T09:10:00Z" },
  ];
  const block = renderParksBlock(records);
  const fences = block.match(/```faff-parks/g) ?? [];
  assert.equal(fences.length, 1);
  assert.deepEqual(extractParksBlock(block, "run-t"), records);
});

test("addParkRecord: a fresh record is appended, occurrence-ordered", () => {
  let acc = [];
  acc = addParkRecord(acc, { issue_id: "FAFF-1", root_cause_class: "punt-not-closed", timestamp: "2026-08-12T09:00:00Z" });
  acc = addParkRecord(acc, { issue_id: "FAFF-2", root_cause_class: "gap", timestamp: "2026-08-12T09:05:00Z" });
  assert.equal(acc.length, 2);
  assert.equal(acc[0].issue_id, "FAFF-1");
  assert.equal(acc[1].issue_id, "FAFF-2");
});

test("addParkRecord: retrying the SAME completed transition (identical issue/class/timestamp) does not duplicate", () => {
  let acc = [];
  const fact = { issue_id: "FAFF-1", root_cause_class: "punt-not-closed", timestamp: "2026-08-12T09:00:00Z" };
  acc = addParkRecord(acc, fact);
  // Simulate a retried return AND a backstop rediscovering the same completed transition.
  acc = addParkRecord(acc, { ...fact });
  acc = addParkRecord(acc, { ...fact });
  assert.equal(acc.length, 1, "exactly one record for one completed transition even when reconciled twice");
  assert.deepEqual(acc, [fact]);
});

test("addParkRecord: a genuinely later distinct transition for the SAME issue/class is a real repeat park, not a dup", () => {
  let acc = [];
  acc = addParkRecord(acc, { issue_id: "FAFF-1", root_cause_class: "punt-not-closed", timestamp: "2026-06-01T09:00:00Z" });
  acc = addParkRecord(acc, { issue_id: "FAFF-1", root_cause_class: "punt-not-closed", timestamp: "2026-06-08T09:00:00Z" });
  acc = addParkRecord(acc, { issue_id: "FAFF-1", root_cause_class: "punt-not-closed", timestamp: "2026-06-15T09:00:00Z" });
  assert.equal(acc.length, 3, "three genuinely distinct completed transitions all recorded");
});

test("addParkRecord: a different root_cause_class for the same issue at the same instant is not treated as a dup", () => {
  let acc = [];
  acc = addParkRecord(acc, { issue_id: "FAFF-1", root_cause_class: "gap", timestamp: "2026-08-12T09:00:00Z" });
  acc = addParkRecord(acc, { issue_id: "FAFF-1", root_cause_class: "cycle", timestamp: "2026-08-12T09:00:00Z" });
  assert.equal(acc.length, 2);
});

test("end-to-end: accumulate then render — exactly one fence, occurrence-ordered, dedup survives the whole pipeline", () => {
  let acc = [];
  const punt = { issue_id: "FAFF-1", root_cause_class: "punt-not-closed", timestamp: "2026-08-12T09:00:00Z" };
  const gap = { issue_id: "FAFF-2", root_cause_class: "gap", timestamp: "2026-08-12T09:05:00Z" };
  acc = addParkRecord(acc, punt);
  acc = addParkRecord(acc, gap);
  acc = addParkRecord(acc, { ...punt }); // a backstop rediscovering FAFF-1's completed transition
  const block = renderParksBlock(acc);
  const fences = block.match(/```faff-parks/g) ?? [];
  assert.equal(fences.length, 1);
  assert.deepEqual(extractParksBlock(block, "run-t"), [punt, gap]);
});
