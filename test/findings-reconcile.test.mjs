// FAFF-569 — resolved-elsewhere correlation (the deterministic half of tidy's
// finding-ticket diagnostic).
//
// Integration smoke over the real CLI seam: `faff findings-reconcile` reads the
// agent-fetched { finding_tickets, fix_corpus } on stdin and emits candidates.
// The pure correlation + anchor-grammar table lives in
// `faff findings-reconcile --selftest` (run in CI); this proves the real binary
// wiring (dispatch + stdin read + exit codes) end-to-end, including the spec's
// known-incident smoke (FAFF-551 vs its merged 3-way split).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const faffBin = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");

function faff(args, stdin) {
  const r = spawnSync("node", [faffBin, ...args], { cwd: repoRoot, encoding: "utf8", input: stdin });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

const LOG = ".faff/logs/2026-07-18/225751-beep-boop-findings.md";

test("findings-reconcile --selftest passes (the pure grammar + correlation table)", () => {
  const r = faff(["findings-reconcile", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("known incident: FAFF-551 vs merged 3-way split -> one strong candidate citing all three (spec smoke)", () => {
  const input = JSON.stringify({
    finding_tickets: [
      { id: "FAFF-551", status: "Todo", title: "git-only orchestrator gap", symptom_text: `Full writeup: ${LOG} (finding F2).` },
    ],
    fix_corpus: [
      { ref: "FAFF-556", merged: true, source_ticket: "FAFF-556", anchors: [], cited_ticket_ids: ["FAFF-551"], text: "Split of FAFF-551 (slice 1 of 3)" },
      { ref: "FAFF-557", merged: true, source_ticket: "FAFF-557", anchors: [], cited_ticket_ids: ["FAFF-551"], text: "Split of FAFF-551 (slice 2 of 3)" },
      { ref: "FAFF-559", merged: true, source_ticket: "FAFF-559", anchors: [], cited_ticket_ids: ["FAFF-551"], text: "Split of FAFF-551 (slice 3 of 3)" },
    ],
  });
  const r = faff(["findings-reconcile", "--stdin"], input);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.candidates.length, 1);
  const c = out.candidates[0];
  assert.equal(c.finding, "FAFF-551");
  assert.equal(c.strength, "strong");
  assert.equal(c.evidence.length, 3);
  assert.deepEqual(c.evidence.map((e) => e.fix_ref).sort(), ["FAFF-556", "FAFF-557", "FAFF-559"]);
  assert.ok(c.evidence.every((e) => e.merged === true));
});

test("self-reference guard: a finding whose only merged PR is its own is NOT surfaced (spec scenario 2)", () => {
  const input = JSON.stringify({
    finding_tickets: [{ id: "FAFF-552", status: "Todo", symptom_text: `writeup ${LOG} (finding F3)` }],
    fix_corpus: [{ ref: "PR#440", merged: true, source_ticket: "FAFF-552", anchors: [LOG], cited_ticket_ids: ["FAFF-552"], text: "fix(FAFF-552): finding F3" }],
  });
  const r = faff(["findings-reconcile", "--stdin"], input);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout), { candidates: [] });
});

test("unmerged fix citing the finding -> weak, never strong", () => {
  const input = JSON.stringify({
    finding_tickets: [{ id: "FAFF-800", status: "Backlog", symptom_text: "no anchor here" }],
    fix_corpus: [{ ref: "FAFF-801", merged: false, source_ticket: "FAFF-801", anchors: [], cited_ticket_ids: ["FAFF-800"], text: "" }],
  });
  const r = faff(["findings-reconcile", "--stdin"], input);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].strength, "weak");
});

test("terminal finding (Done) never surfaces, judged from the supplied live status", () => {
  const input = JSON.stringify({
    finding_tickets: [{ id: "FAFF-802", status: "Done", symptom_text: `see ${LOG}` }],
    fix_corpus: [{ ref: "FAFF-803", merged: true, source_ticket: "FAFF-803", anchors: [LOG], cited_ticket_ids: ["FAFF-802"], text: "" }],
  });
  const r = faff(["findings-reconcile", "--stdin"], input);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout), { candidates: [] });
});

test("anchor co-reference alone (no citation) surfaces a strong candidate", () => {
  const input = JSON.stringify({
    finding_tickets: [{ id: "FAFF-804", status: "Todo", symptom_text: `Full writeup: ${LOG} (finding F1).` }],
    fix_corpus: [{ ref: "FAFF-805", merged: true, source_ticket: "FAFF-805", anchors: [LOG], cited_ticket_ids: [], text: "resolves finding F1" }],
  });
  const r = faff(["findings-reconcile", "--stdin"], input);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].evidence[0].kind, "anchor-coref");
});

test("malformed stdin -> exit 2, no stdout verdict (loud, never a silent empty result)", () => {
  const r = faff(["findings-reconcile", "--stdin"], "{ not valid json");
  assert.equal(r.code, 2);
  assert.equal(r.stdout.trim(), "");
  assert.match(r.stderr, /not valid JSON/);
});

test("well-formed JSON with missing arrays -> exit 2 naming the faults", () => {
  const r = faff(["findings-reconcile", "--stdin"], JSON.stringify({ finding_tickets: "nope" }));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /finding_tickets is not an array/);
  assert.match(r.stderr, /fix_corpus is not an array/);
});
