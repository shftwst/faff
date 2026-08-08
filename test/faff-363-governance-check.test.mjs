// FAFF-363 — governance-check's INTEGRATION SMOKE TEST (spec §8's required "Integration
// smoke test"). Drives the real `faff governance-check` CLI child process (not the
// in-process pure cores `governance-check --selftest` already covers) against a fixture
// run dir built from real ledger + events + floor artifacts on disk — the same substrate
// a `.github/actions/governance-check` composite Action step would hand it.
//
//   1. Build a clean fixture run dir: a complete ledger (admitted issue has a terminal
//      outcome), a clean budget-checkpoint event, and valid ac-checklist/review-verdict
//      floor artifacts for the target issue.
//   2. `governance-check --json` on that fixture asserts pass (exit 0, JSON verdict).
//   3. Corrupt the ledger (drop the admitted issue's outcome — the FAFF-205 "admitted but
//      never dispatched" shape) → asserts exit 1, naming a completeness reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function tmpRunDir(prefix) { return mkdtempSync(path.join(tmpdir(), prefix)); }

function writeLedger(runDir, ledger) {
  writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
}

function writeFloorArtifacts(runDir, issue) {
  const dir = path.join(runDir, issue);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
  writeFileSync(path.join(dir, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
}

function appendEvent(runDir, event) {
  appendFileSync(path.join(runDir, "events.jsonl"), JSON.stringify(event) + "\n");
}

const ISSUE = "FAFF-363";

test("FAFF-363 integration smoke: a complete fixture run dir passes governance-check --json", () => {
  const runDir = tmpRunDir("faff363-govcheck-pass-");
  try {
    writeLedger(runDir, {
      run_id: "run-faff363-pass",
      admitted: [ISSUE],
      outcomes: { [ISSUE]: "shipped" },
      owner: { status: "done", last_heartbeat: new Date().toISOString() },
    });
    appendEvent(runDir, {
      schema: 1, run_id: "run-faff363-pass", seq: 0, ts: new Date().toISOString(),
      phase: "run", type: "budget-checkpoint",
      data: { spent: { attempts: 1, tokens: 1000 }, tokens_source: "transcript", breached: [], outcome: "none" },
    });
    writeFloorArtifacts(runDir, ISSUE);

    const r = runCli(["governance-check", "--run-dir", runDir, "--issue", ISSUE, "--json"]);
    assert.equal(r.code, 0, `expected pass; stdout=${r.stdout} stderr=${r.stderr}`);
    const verdict = JSON.parse(r.stdout);
    assert.equal(verdict.pass, true);
    assert.equal(verdict.runs.length, 1);
    assert.equal(verdict.runs[0].legs.completeness.pass, true);
    assert.equal(verdict.runs[0].legs.budget.pass, true);
    assert.equal(verdict.runs[0].legs.merge_floor.pass, true);
    assert.deepEqual(verdict.reasons, []);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("FAFF-363 integration smoke: corrupting the ledger (dropping the outcome) fails with a completeness reason", () => {
  const runDir = tmpRunDir("faff363-govcheck-corrupt-");
  try {
    writeLedger(runDir, {
      run_id: "run-faff363-corrupt",
      admitted: [ISSUE],
      outcomes: { [ISSUE]: "shipped" },
      owner: { status: "done", last_heartbeat: new Date().toISOString() },
    });
    appendEvent(runDir, {
      schema: 1, run_id: "run-faff363-corrupt", seq: 0, ts: new Date().toISOString(),
      phase: "run", type: "budget-checkpoint",
      data: { spent: { attempts: 1, tokens: 1000 }, tokens_source: "transcript", breached: [], outcome: "none" },
    });
    writeFloorArtifacts(runDir, ISSUE);

    // Sanity: the uncorrupted fixture passes first (isolates the corruption's effect).
    const before = runCli(["governance-check", "--run-dir", runDir, "--issue", ISSUE]);
    assert.equal(before.code, 0, `fixture should pass before corruption; stderr=${before.stderr}`);

    // Corrupt the ledger — drop the admitted issue's outcome (an admitted-but-never-
    // dispatched shape: exactly the completeness leg's undispatched case).
    writeLedger(runDir, {
      run_id: "run-faff363-corrupt",
      admitted: [ISSUE],
      outcomes: {},
      owner: { status: "done", last_heartbeat: new Date().toISOString() },
    });

    const r = runCli(["governance-check", "--run-dir", runDir, "--issue", ISSUE, "--json"]);
    assert.equal(r.code, 1, `expected fail; stdout=${r.stdout} stderr=${r.stderr}`);
    const verdict = JSON.parse(r.stdout);
    assert.equal(verdict.pass, false);
    assert.equal(verdict.runs[0].legs.completeness.pass, false);
    assert.deepEqual(verdict.runs[0].legs.completeness.undispatched, [ISSUE]);
    assert.ok(
      verdict.reasons.some((reason) => reason.includes("completeness") && reason.includes(ISSUE)),
      `expected a completeness reason naming ${ISSUE}; got ${JSON.stringify(verdict.reasons)}`,
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("FAFF-363: a malformed run-ledger.json is fail-loud exit 2, never folded into a leg failure", () => {
  const runDir = tmpRunDir("faff363-govcheck-malformed-");
  try {
    writeFileSync(path.join(runDir, "run-ledger.json"), "{ this is not valid json");
    const r = runCli(["governance-check", "--run-dir", runDir]);
    assert.equal(r.code, 2, `expected usage/malformed exit 2; stdout=${r.stdout} stderr=${r.stderr}`);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

// --- FAFF-568 fix pass: anchor discovery derivation + containment (CLI-side) ----
// `--derive-anchor-dirs` is the Action's discovery core: prefix-strip at ANY
// anchors-path depth, reject ".." traversal, realpath-contain, skip deleted dirs.

test("FAFF-568: --derive-anchor-dirs handles 1/2/3-segment anchors-paths and rejects '..' traversal", () => {
  const root = tmpRunDir("faff568-derive-");
  try {
    for (const p of ["anchors", ".faff/anchors", ".faff/sub/anchors"]) {
      mkdirSync(path.join(root, p, "run-1", "FAFF-1"), { recursive: true });
    }
    const cases = [
      ["anchors", "anchors/run-1/FAFF-1/events.jsonl", "anchors/run-1/FAFF-1"],
      [".faff/anchors", ".faff/anchors/run-1/FAFF-1/chain-head.json", ".faff/anchors/run-1/FAFF-1"],
      [".faff/sub/anchors", ".faff/sub/anchors/run-1/FAFF-1/events.jsonl", ".faff/sub/anchors/run-1/FAFF-1"],
    ];
    for (const [anchorsPath, changed, want] of cases) {
      const r = runCli(["governance-check", "--derive-anchor-dirs", anchorsPath], { cwd: root, input: changed + "\n" });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout.trim(), want, `anchors-path ${anchorsPath}`);
    }
    // ".." traversal: dropped with a loud stderr warning, never a derived dir.
    const trav = runCli(["governance-check", "--derive-anchor-dirs", ".faff/anchors"],
      { cwd: root, input: ".faff/anchors/../../evil/x/events.jsonl\n" });
    assert.equal(trav.code, 0);
    assert.equal(trav.stdout.trim(), "", "no dir derived from a traversal path");
    assert.match(trav.stderr, /dropped.*traversal/, "the drop is warned, never silent");
    // A dir the PR deleted is skipped without a warning (not carried anymore).
    const gone = runCli(["governance-check", "--derive-anchor-dirs", ".faff/anchors"],
      { cwd: root, input: ".faff/anchors/run-gone/FAFF-9/events.jsonl\n" });
    assert.equal(gone.code, 0);
    assert.equal(gone.stdout.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-568: --anchors-root rejects an --anchor-dir that resolves outside it (exit 2, fail-loud)", () => {
  const root = tmpRunDir("faff568-root-");
  try {
    const anchorDir = path.join(root, "anchors", "run-1", "FAFF-1");
    mkdirSync(anchorDir, { recursive: true });
    mkdirSync(path.join(root, "outside"), { recursive: true });
    // FAFF-623: this test asserts CONTAINMENT — with no events.jsonl, integrity trivially
    // passes, but merge_floor now also runs against the anchor dir and fails closed on
    // missing floor evidence. Write it so the assertion stays about containment.
    writeFileSync(path.join(anchorDir, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
    writeFileSync(path.join(anchorDir, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
    const ok = runCli(["governance-check", "--anchor-dir", anchorDir, "--anchors-root", path.join(root, "anchors")]);
    assert.equal(ok.code, 0, ok.stderr);
    const bad = runCli(["governance-check", "--anchor-dir", path.join(root, "outside"), "--anchors-root", path.join(root, "anchors")]);
    assert.equal(bad.code, 2, `expected containment exit 2; stdout=${bad.stdout} stderr=${bad.stderr}`);
    assert.match(bad.stderr, /outside the anchors root/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- FAFF-690 (F1b): evaluateAnchorDir derives the merge-floor level from the anchor's OWN
// committed run-ledger.json, not the --level flag, so the required governance-check and merge-gate
// consult the same head-sha-pinned truth. Only strengthens; non-L4/legacy/level-less anchors keep the
// flag behaviour. No events.jsonl ⇒ the integrity leg trivially passes (nothing to verify, no witness
// required), isolating merge_floor as the variable. ---

function writeAnchorFloor(anchorDir, { ac = true, review = "pass" } = {}) {
  writeFileSync(path.join(anchorDir, "ac-checklist.json"), JSON.stringify({ all_verified: ac }));
  writeFileSync(path.join(anchorDir, "review-verdict.json"), JSON.stringify({ signal: review, findings: [] }));
}

test("FAFF-690 (F1b): an L4 anchor-ledger + no holdout FAILS the merge-floor leg with NO --level flag (level derived from the anchor, not the L3 flag default)", () => {
  const anchor = tmpRunDir("faff690-f1b-l4-");
  try {
    writeAnchorFloor(anchor);
    writeLedger(anchor, { run_id: "anchored", level: "L4" }); // the anchor's own committed level
    // No --level flag → the flag would default to L3 (holdout leg skipped). F1b derives L4 from the
    // anchor ledger, so the absent holdout blocks.
    const r = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(r.code, 1, `expected merge_floor fail from the derived L4 level; stdout=${r.stdout} stderr=${r.stderr}`);
    const verdict = JSON.parse(r.stdout);
    assert.equal(verdict.runs[0].legs.integrity.pass, true, "integrity is clean — isolates the assertion to the derived-level holdout leg");
    assert.equal(verdict.runs[0].legs.merge_floor.pass, false);
    assert.ok(verdict.runs[0].legs.merge_floor.issues.some((i) => (i.reasons || []).some((x) => /holdout/.test(x))),
      `expected a holdout reason from the derived L4 level; got ${JSON.stringify(verdict.runs[0].legs.merge_floor.issues)}`);
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});

test("FAFF-690 (F1b): a non-L4 (L3) anchor-ledger keeps today's flag behaviour — a clean floor passes (the holdout leg is not derived on)", () => {
  const anchor = tmpRunDir("faff690-f1b-l3-");
  try {
    writeAnchorFloor(anchor);
    writeLedger(anchor, { run_id: "anchored", level: "L3" });
    const r = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(r.code, 0, `expected pass; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.equal(JSON.parse(r.stdout).runs[0].legs.merge_floor.pass, true);
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});

test("FAFF-690 (F1b): a level-less / missing anchor-ledger falls back to the --level flag (unchanged) — the L3 default clean floor passes", () => {
  const anchor = tmpRunDir("faff690-f1b-nolevel-");
  try {
    writeAnchorFloor(anchor);
    writeLedger(anchor, { run_id: "anchored" }); // no `level` key → flag default (L3) governs
    const r = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(r.code, 0, `expected pass (flag default L3); stdout=${r.stdout} stderr=${r.stderr}`);
    assert.equal(JSON.parse(r.stdout).runs[0].legs.merge_floor.pass, true);
    // And an explicit --level L4 on the SAME level-less anchor DOES gate (flag fallback is honoured).
    const gated = runCli(["governance-check", "--anchor-dir", anchor, "--level", "L4", "--json"]);
    assert.equal(gated.code, 1, "a level-less anchor falls back to the --level flag, so --level L4 gates the holdout");
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});

// --- FAFF-568 fix pass: witness gating + legacy-policy warn through the CLI -----

function buildChainDir(dir, runId, payloads) {
  const sha256 = (b) => createHash("sha256").update(b).digest("hex");
  let prevBytes = null;
  const lines = payloads.map((p, i) => {
    const prev = prevBytes === null ? sha256(Buffer.from(runId, "utf8")) : sha256(prevBytes);
    const line = JSON.stringify({ schema: 2, run_id: runId, seq: i, ts: "t", prev, ...p });
    prevBytes = Buffer.from(line, "utf8");
    return line;
  });
  writeFileSync(path.join(dir, "events.jsonl"), lines.join("\n") + "\n");
  return lines;
}

test("FAFF-568: a spoofed legacy downgrade on an anchored chain fails governance-check with a witness-mismatch integrity reason", () => {
  const anchor = tmpRunDir("faff568-witness-");
  try {
    const lines = buildChainDir(anchor, "run-w", [
      { phase: "run", type: "run-start" },
      { phase: "build", type: "build-start", issue: "FAFF-1" },
    ]);
    // Anchor-time witness (CLI-shape: head_sha256 / line_count / schema_floor).
    const sha256 = (b) => createHash("sha256").update(b).digest("hex");
    writeFileSync(path.join(anchor, "chain-head.json"), JSON.stringify({
      run_id: "run-w", issue: "FAFF-1", head_seq: 1,
      head_sha256: sha256(Buffer.from(lines[lines.length - 1], "utf8")),
      line_count: lines.length, schema_floor: 2,
    }, null, 2) + "\n");
    // FAFF-623: merge_floor now also gates anchors — clean floor evidence keeps this test's
    // "before" baseline a true clean pass, isolating the spoof's effect to integrity alone.
    writeFileSync(path.join(anchor, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
    writeFileSync(path.join(anchor, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
    const before = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(before.code, 0, before.stderr);
    // The spoof: strip every prev + downgrade schema.
    writeFileSync(path.join(anchor, "events.jsonl"),
      lines.map((l) => { const { prev, ...rest } = JSON.parse(l); return JSON.stringify({ ...rest, schema: 1 }); }).join("\n") + "\n");
    const r = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(r.code, 1, `expected integrity fail; stdout=${r.stdout} stderr=${r.stderr}`);
    const verdict = JSON.parse(r.stdout);
    assert.equal(verdict.runs[0].legs.integrity.status, "witness-mismatch");
    assert.ok(verdict.reasons.some((x) => /integrity/.test(x) && /witness/.test(x)), JSON.stringify(verdict.reasons));
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});

test("FAFF-568: legacy-policy warn passes a legacy anchor WITH a loud stderr note (never silently identical to pass)", () => {
  const anchor = tmpRunDir("faff568-warn-");
  try {
    const line = JSON.stringify({ schema: 1, run_id: "run-l", seq: 0, ts: "t", phase: "run", type: "run-start" });
    appendFileSync(path.join(anchor, "events.jsonl"), line + "\n");
    // Fix pass 2: an anchor requires its witness — a legacy anchor carries one too
    // (CLI-written at anchor time, schema_floor 1).
    const sha256 = (b) => createHash("sha256").update(b).digest("hex");
    writeFileSync(path.join(anchor, "chain-head.json"), JSON.stringify({
      run_id: "run-l", issue: "FAFF-1", head_seq: 0,
      head_sha256: sha256(Buffer.from(line, "utf8")), line_count: 1, schema_floor: 1,
    }, null, 2) + "\n");
    // FAFF-623: merge_floor now also gates anchors — clean floor evidence keeps `quiet`/`warned`
    // isolated to the legacy-policy/integrity behaviour this test is actually about.
    writeFileSync(path.join(anchor, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
    writeFileSync(path.join(anchor, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
    const quiet = runCli(["governance-check", "--anchor-dir", anchor, "--legacy-policy", "pass"]);
    assert.equal(quiet.code, 0);
    assert.doesNotMatch(quiet.stderr, /warn/, "pass stays quiet");
    const warned = runCli(["governance-check", "--anchor-dir", anchor, "--legacy-policy", "warn"]);
    assert.equal(warned.code, 0, warned.stderr);
    assert.match(warned.stderr, /integrity — legacy schema-1 log .*warn/, "warn emits the note");
    const failed = runCli(["governance-check", "--anchor-dir", anchor, "--legacy-policy", "fail"]);
    assert.equal(failed.code, 1, "fail gates");
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});

// --- FAFF-568 fix pass 2: an anchor without its witness fails closed -----------
// Deleting chain-head.json must NOT restore the legacy-downgrade spoof: an anchor
// dir is CLI-written and always carries its witness, so events.jsonl with no
// chain-head.json beside it is `witness-absent` — a FAIL, under every policy. A
// bare run dir (verb path / --run-dir sweep) has no witness by design and is
// unchanged: the requirement applies only when the dir is evaluated AS an anchor.

test("FAFF-568: an anchor dir with events.jsonl but NO chain-head.json → integrity FAIL (witness-absent)", () => {
  const anchor = tmpRunDir("faff568-nowitness-");
  try {
    buildChainDir(anchor, "run-nw", [
      { phase: "run", type: "run-start" },
      { phase: "build", type: "build-start", issue: "FAFF-1" },
    ]);
    const r = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(r.code, 1, `expected witness-absent fail; stdout=${r.stdout} stderr=${r.stderr}`);
    const verdict = JSON.parse(r.stdout);
    assert.equal(verdict.runs[0].legs.integrity.status, "witness-absent");
    assert.ok(verdict.reasons.some((x) => /integrity/.test(x) && /witness-absent/.test(x)), JSON.stringify(verdict.reasons));
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});

// --- FAFF-562: unconditional fail-closed guard --------------------------------
// `governance-check` (the verb) takes no `--on-missing` input at all — that knob
// lives only in the Action's `on-missing`-branch step, which is skipped entirely
// whenever a run dir or an anchor is discovered (action.yml's "Run governance-check"
// step condition). So a present-but-invalid anchor already fails independent of any
// on-missing posture; this guard test locks that as an assertion so a future refactor
// can't quietly route anchor evaluation behind the adoption-mode branch (i.e. reading
// an `on-missing`-shaped flag before deciding whether a present anchor's failure
// counts). No such flag is passed below — its total absence from the invocation is
// itself part of what's being asserted: the fail-closed path takes no such input.

test("FAFF-562: a present anchor with INCOMPLETE merge_floor evidence fails unconditionally (no --on-missing input exists on the verb)", () => {
  const anchor = tmpRunDir("faff562-incomplete-floor-");
  try {
    buildChainDir(anchor, "run-562a", [
      { phase: "run", type: "run-start" },
      { phase: "build", type: "build-start", issue: "FAFF-1" },
    ]);
    const sha256 = (b) => createHash("sha256").update(b).digest("hex");
    const lines = readFileSync(path.join(anchor, "events.jsonl"), "utf8").trim().split("\n");
    writeFileSync(path.join(anchor, "chain-head.json"), JSON.stringify({
      run_id: "run-562a", issue: "FAFF-1", head_seq: lines.length - 1,
      head_sha256: sha256(Buffer.from(lines[lines.length - 1], "utf8")),
      line_count: lines.length, schema_floor: 2,
    }, null, 2) + "\n");
    // Only ac-checklist.json — review-verdict.json is missing entirely (incomplete,
    // not merely non-pass). Integrity is clean; merge_floor must still fail closed.
    writeFileSync(path.join(anchor, "ac-checklist.json"), JSON.stringify({ all_verified: true }));

    const r = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(r.code, 1, `expected merge_floor fail; stdout=${r.stdout} stderr=${r.stderr}`);
    const verdict = JSON.parse(r.stdout);
    assert.equal(verdict.runs[0].legs.integrity.pass, true, "integrity itself is clean — isolates the assertion to merge_floor");
    assert.equal(verdict.runs[0].legs.merge_floor.pass, false);
    assert.ok(
      verdict.reasons.some((x) => /merge_floor/.test(x)),
      `expected a merge_floor reason; got ${JSON.stringify(verdict.reasons)}`,
    );

    // The unconditional part: no --on-missing-shaped flag exists on this verb at all —
    // the CLI's own usage/help text never mentions it (that knob is Action-only).
    const help = runCli(["governance-check", "--help"]);
    assert.doesNotMatch(`${help.stdout}${help.stderr}`, /on-missing/, "on-missing is not a verb-level input");
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});

test("FAFF-562: a present anchor with BOTH broken integrity and incomplete merge_floor still fails (compound, unconditional)", () => {
  const anchor = tmpRunDir("faff562-compound-broken-");
  try {
    const lines = buildChainDir(anchor, "run-562b", [
      { phase: "run", type: "run-start" },
      { phase: "build", type: "build-start", issue: "FAFF-1" },
    ]);
    const sha256 = (b) => createHash("sha256").update(b).digest("hex");
    writeFileSync(path.join(anchor, "chain-head.json"), JSON.stringify({
      run_id: "run-562b", issue: "FAFF-1", head_seq: 1,
      head_sha256: sha256(Buffer.from(lines[lines.length - 1], "utf8")),
      line_count: lines.length, schema_floor: 2,
    }, null, 2) + "\n");
    // Break integrity (strip prev + downgrade schema) AND leave merge_floor evidence
    // absent — neither leg should save the other; the verdict must still be a fail.
    writeFileSync(path.join(anchor, "events.jsonl"),
      lines.map((l) => { const { prev, ...rest } = JSON.parse(l); return JSON.stringify({ ...rest, schema: 1 }); }).join("\n") + "\n");

    const r = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(r.code, 1, `expected fail; stdout=${r.stdout} stderr=${r.stderr}`);
    const verdict = JSON.parse(r.stdout);
    assert.equal(verdict.runs[0].legs.integrity.pass, false);
    assert.equal(verdict.runs[0].legs.merge_floor.pass, false);
    assert.equal(verdict.pass, false);
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});

test("FAFF-568: the spoof-minus-witness repro (stripped prev + deleted chain-head.json) fails the anchor integrity leg", () => {
  const anchor = tmpRunDir("faff568-spoofminus-");
  try {
    const lines = buildChainDir(anchor, "run-sm", [
      { phase: "run", type: "run-start" },
      { phase: "build", type: "build-start", issue: "FAFF-1" },
    ]);
    // The Phase-2 repro: no chain-head.json at all + every prev stripped, schema downgraded.
    writeFileSync(path.join(anchor, "events.jsonl"),
      lines.map((l) => { const { prev, ...rest } = JSON.parse(l); return JSON.stringify({ ...rest, schema: 1 }); }).join("\n") + "\n");
    const r = runCli(["governance-check", "--anchor-dir", anchor, "--json"]);
    assert.equal(r.code, 1, `spoof-minus-witness must not exit 0; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.equal(JSON.parse(r.stdout).runs[0].legs.integrity.status, "witness-absent");
    // The verb path on the SAME dir (a bare run dir — no anchor context) keeps
    // today's behaviour: legacy-unverifiable, exit 0 under the default policy.
    const verb = runCli(["events", "verify", "--run-dir", anchor, "--json"]);
    assert.equal(verb.code, 0, verb.stderr);
    assert.equal(JSON.parse(verb.stdout).status, "legacy-unverifiable");
  } finally { rmSync(anchor, { recursive: true, force: true }); }
});
