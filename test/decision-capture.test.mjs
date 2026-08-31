// FAFF-821 — `faff decision-capture` — read-only instrumentation of the current
// decision-kernel inputs and chosen actions. Spawns the real CLI (execFileSync — the
// entrypoint, arg parsing, exit codes, exactly as CI and users invoke it) over a scratch
// `.faff/runs/<run-id>` tree, mirroring test/events-chain.test.mjs's conventions. Asserts
// the 5 SCENARIOS from spec §5, the two bare assertions, and the spec §8 integration
// smoke test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function run(cwd, args, input) {
  const opts = { cwd, encoding: "utf8", input: input ?? "" };
  try {
    const out = execFileSync("node", [CLI, ...args], opts);
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

function mkRoot(prefix, runId) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  return { root, runDir, log: join(runDir, "events.jsonl") };
}

function enableCapture(root, extraYaml = "") {
  writeFileSync(join(root, ".faffrc.yaml"), `capture:\n  decision_kernel: on\n${extraYaml}`);
}

// Seed a genesis event (a real `faff events append`, so the chain is minted exactly as the
// live CLI would mint it — never a hand-rolled fixture line).
function seedGenesis(root, runId) {
  const r = run(root, ["events", "append", "--run", runId, "--ts", "2026-08-19T00:00:00Z"], JSON.stringify({ phase: "run", type: "run-start" }));
  assert.equal(r.code, 0, r.err);
}

function records(logPath) {
  return readFileSync(logPath, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

// SHA-256 of the log's last PHYSICAL line's raw bytes (exclusive of its terminating
// newline) — the value the NEXT record's causation.sha256/prev must equal (FAFF-564's rule).
function lastPhysicalLineSha(logPath) {
  const raw = readFileSync(logPath);
  let end = raw.length;
  if (raw[end - 1] === 0x0a) end -= 1;
  const nl = raw.lastIndexOf(0x0a, end - 1);
  const start = nl === -1 ? 0 : nl + 1;
  return sha256(raw.subarray(start, end));
}

const FULL_NEXT_INPUTS = { status: "todo", spec: "high", eligible: true, parked: false, blocked: false, ifEligible: false };

// ---------------------------------------------------------------------------
// Scenario 1 (spec §5): replayable.
// ---------------------------------------------------------------------------
test("replayable: complete next-kernel inputs -> coverage=replayable, envelope carries run_id/issue/kernel_version/causation matching the prior chain head, events verify still verified", () => {
  const { root, runDir, log } = mkRoot("dc-replayable-", "R1");
  try {
    enableCapture(root);
    seedGenesis(root, "R1");
    const priorSeq = records(log).pop().seq;
    const priorSha = lastPhysicalLineSha(log);

    const stdin = JSON.stringify({ normalised_inputs: FULL_NEXT_INPUTS, selected_action: "graft" });
    const r = run(root, ["decision-capture", "record", "--run", "R1", "--issue", "FAFF-1", "--kernel", "next"], stdin);
    assert.equal(r.code, 0, r.err);
    const printed = JSON.parse(r.out);
    assert.equal(printed.coverage, "replayable");
    assert.equal(typeof printed.seq, "number");

    const rec = records(log).pop();
    assert.equal(rec.type, "decision-capture");
    assert.equal(rec.run_id, "R1");
    assert.equal(rec.issue, "FAFF-1");
    assert.equal(rec.data.kernel, "next");
    assert.equal(rec.data.kernel_version, "next@1");
    assert.equal(rec.data.coverage, "replayable");
    assert.deepEqual(rec.data.missing_inputs, []);
    assert.equal(rec.data.selected_action, "graft");
    assert.deepEqual(rec.data.normalised_inputs, FULL_NEXT_INPUTS);
    assert.equal(rec.data.causation.seq, priorSeq, "causation.seq matches the prior chain head's seq");
    assert.equal(rec.data.causation.sha256, priorSha, "causation.sha256 matches the prior chain head's physical-line hash");

    const v = run(root, ["events", "verify", "--run-dir", runDir, "--json"]);
    assert.equal(v.code, 0, v.err);
    assert.equal(JSON.parse(v.out).status, "verified");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Scenario 2 (spec §5): non-replayable.
// ---------------------------------------------------------------------------
test("non-replayable: a required next-kernel input is omitted -> coverage=non-replayable, missing_inputs names exactly the absent required keys", () => {
  const { root, log } = mkRoot("dc-nonreplayable-", "R2");
  try {
    enableCapture(root);
    seedGenesis(root, "R2");
    const stdin = JSON.stringify({ normalised_inputs: { status: "todo", spec: "high" }, selected_action: "prep" });
    const r = run(root, ["decision-capture", "record", "--run", "R2", "--issue", "FAFF-2", "--kernel", "next"], stdin);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).coverage, "non-replayable");
    const rec = records(log).pop();
    assert.equal(rec.data.coverage, "non-replayable");
    assert.deepEqual(rec.data.missing_inputs.sort(), ["blocked", "eligible", "ifEligible", "parked"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Scenario 3 (spec §5): uncovered.
// ---------------------------------------------------------------------------
test("uncovered: --kernel names a function not in KERNEL_REGISTRY -> coverage=uncovered, kernel_version='', missing_inputs=[]", () => {
  const { root, log } = mkRoot("dc-uncovered-", "R3");
  try {
    enableCapture(root);
    seedGenesis(root, "R3");
    const stdin = JSON.stringify({ normalised_inputs: { anything: 1 }, selected_action: { verdict: "x" } });
    const r = run(root, ["decision-capture", "record", "--run", "R3", "--issue", "FAFF-3", "--kernel", "budget"], stdin);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).coverage, "uncovered");
    const rec = records(log).pop();
    assert.equal(rec.data.coverage, "uncovered");
    assert.equal(rec.data.kernel_version, "");
    assert.deepEqual(rec.data.missing_inputs, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Scenario 4 (spec §5): disabled.
// ---------------------------------------------------------------------------
test("disabled: capture.decision_kernel unset -> no event appended, exit 0, journal byte-identical to before", () => {
  const { root, log } = mkRoot("dc-disabled-unset-", "R4");
  try {
    // No .faffrc.yaml at all -> disabled by default.
    seedGenesis(root, "R4");
    const before = readFileSync(log);
    const stdin = JSON.stringify({ normalised_inputs: FULL_NEXT_INPUTS, selected_action: "graft" });
    const r = run(root, ["decision-capture", "record", "--run", "R4", "--issue", "FAFF-4", "--kernel", "next"], stdin);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(readFileSync(log), before, "the authoritative journal is byte-identical to a run without instrumentation");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("disabled: capture.decision_kernel explicitly off -> no event appended, exit 0", () => {
  const { root, log } = mkRoot("dc-disabled-off-", "R4b");
  try {
    writeFileSync(join(root, ".faffrc.yaml"), "capture:\n  decision_kernel: off\n");
    seedGenesis(root, "R4b");
    const before = readFileSync(log);
    const r = run(root, ["decision-capture", "record", "--run", "R4b", "--issue", "FAFF-4", "--kernel", "next"], "{}");
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(readFileSync(log), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Scenario 5 (spec §5): malformed payload / append failure — BEST-EFFORT-FAIL.
// ---------------------------------------------------------------------------
test("malformed payload: invalid stdin JSON -> exit 0, writes a degraded-capture note, appends no event", () => {
  const { root, log } = mkRoot("dc-malformed-", "R5");
  try {
    enableCapture(root);
    seedGenesis(root, "R5");
    const before = readFileSync(log);
    const r = run(root, ["decision-capture", "record", "--run", "R5", "--issue", "FAFF-5", "--kernel", "next"], "{not valid json");
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(readFileSync(log), before, "no event appended");
    const notePath = join(root, ".faff", "logs", "decision-capture.jsonl");
    assert.ok(existsSync(notePath), "a degraded-capture note is written");
    const note = JSON.parse(readFileSync(notePath, "utf8").trim().split("\n").pop());
    assert.equal(note.note, "degraded-capture");
    assert.match(note.reason, /malformed stdin JSON/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("append failure: no run dir exists for --run -> exit 0, degraded-capture note, no crash", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-append-fail-"));
  try {
    mkdirSync(join(root, ".faff"), { recursive: true }); // marks root findable without walking to the real repo root
    enableCapture(root);
    const stdin = JSON.stringify({ normalised_inputs: FULL_NEXT_INPUTS, selected_action: "graft" });
    const r = run(root, ["decision-capture", "record", "--run", "GHOST", "--issue", "FAFF-6", "--kernel", "next"], stdin);
    assert.equal(r.code, 0, r.err);
    const notePath = join(root, ".faff", "logs", "decision-capture.jsonl");
    assert.ok(existsSync(notePath), "a degraded-capture note is written");
    assert.equal(existsSync(join(root, ".faff", "runs", "GHOST", "events.jsonl")), false, "no event dir/journal was fabricated");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("malformed shape: an invalid selected_action (undefined; no --action, no stdin field) -> exit 0, degraded-capture note, no event appended", () => {
  const { root, log } = mkRoot("dc-badshape-", "R5b");
  try {
    enableCapture(root);
    seedGenesis(root, "R5b");
    const before = readFileSync(log);
    const stdin = JSON.stringify({ normalised_inputs: FULL_NEXT_INPUTS });
    const r = run(root, ["decision-capture", "record", "--run", "R5b", "--issue", "FAFF-5", "--kernel", "next"], stdin);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(readFileSync(log), before, "no event appended");
    const notePath = join(root, ".faff", "logs", "decision-capture.jsonl");
    assert.ok(existsSync(notePath));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Bare assertion: selected_action is the harness's real action, never silently
// substituted with the kernel's own prescribed output. This is a code-shape guarantee
// (spec's anti-pattern: "calling the journal from inside nextStep()") — asserted here as
// a purity check: the capture module never requires any of the eleven kernel modules, so it
// has no way to compute/override selected_action itself.
// ---------------------------------------------------------------------------
test("purity: decision-capture.js never requires any of the eleven kernel modules (selected_action can only come from the caller, never computed here)", () => {
  const src = readFileSync(join(REPO, "plugin", "skills", "faff", "bin", "lib", "decision-capture.js"), "utf8");
  for (const mod of ["next", "eligible", "tier", "run-done", "queue-state", "regions", "claim-verdict", "park-verdict", "project-next", "run-outward", "run-start"]) {
    assert.ok(!new RegExp(`require\\(["']\\./${mod}["']\\)`).test(src), `decision-capture.js must not require ./${mod}`);
  }
});

// ---------------------------------------------------------------------------
// Bare assertion: a seeded secret in normalised_inputs is [REDACTED] on disk (inherited
// via appendEventRecord — FAFF-107). Mirrors test/redact.test.mjs's andon.token fixture.
// ---------------------------------------------------------------------------
test("redaction: a seeded secret in normalised_inputs is [REDACTED] on disk", () => {
  const { root, log } = mkRoot("dc-redact-", "R7");
  try {
    const SECRET = "aLongEnoughSecretTokenValue123";
    enableCapture(root, `andon:\n  token: ${SECRET}\n`);
    seedGenesis(root, "R7");
    const stdin = JSON.stringify({
      normalised_inputs: { ...FULL_NEXT_INPUTS, note: `token is ${SECRET}` },
      selected_action: "graft",
    });
    const r = run(root, ["decision-capture", "record", "--run", "R7", "--issue", "FAFF-7", "--kernel", "next"], stdin);
    assert.equal(r.code, 0, r.err);
    const raw = readFileSync(log, "utf8");
    assert.equal(raw.includes(SECRET), false, "the raw secret must not appear anywhere in the physical line");
    assert.ok(raw.includes("[REDACTED]"));
    const rec = records(log).pop();
    assert.equal(rec.data.normalised_inputs.note, "token is [REDACTED]");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// list / export.
// ---------------------------------------------------------------------------
test("list: emits matching decision-capture records as JSONL, filterable by --coverage", () => {
  const { root, runDir, log } = mkRoot("dc-list-", "R8");
  try {
    enableCapture(root);
    seedGenesis(root, "R8");
    run(root, ["decision-capture", "record", "--run", "R8", "--issue", "FAFF-8a", "--kernel", "next"],
      JSON.stringify({ normalised_inputs: FULL_NEXT_INPUTS, selected_action: "graft" }));
    run(root, ["decision-capture", "record", "--run", "R8", "--issue", "FAFF-8b", "--kernel", "bogus-kernel"],
      JSON.stringify({ normalised_inputs: {}, selected_action: "x" }));
    assert.equal(records(log).filter((r) => r.type === "decision-capture").length, 2);

    const all = run(root, ["decision-capture", "list", "--run", "R8"]);
    assert.equal(all.code, 0, all.err);
    const allRecs = all.out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(allRecs.length, 2);

    const filtered = run(root, ["decision-capture", "list", "--run", "R8", "--coverage", "uncovered"]);
    assert.equal(filtered.code, 0, filtered.err);
    const filteredRecs = filtered.out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(filteredRecs.length, 1);
    assert.equal(filteredRecs[0].issue, "FAFF-8b");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("export: writes a redacted, manifest-digested decision-corpus.jsonl + manifest.json", () => {
  const { root, log } = mkRoot("dc-export-", "R9");
  const outDir = mkdtempSync(join(tmpdir(), "dc-export-out-"));
  try {
    enableCapture(root);
    seedGenesis(root, "R9");
    run(root, ["decision-capture", "record", "--run", "R9", "--issue", "FAFF-9", "--kernel", "next"],
      JSON.stringify({ normalised_inputs: FULL_NEXT_INPUTS, selected_action: "graft" }));
    assert.equal(records(log).filter((r) => r.type === "decision-capture").length, 1);

    const r = run(root, ["decision-capture", "export", "--out", outDir]);
    assert.equal(r.code, 0, r.err);
    const corpusPath = join(outDir, "decision-corpus.jsonl");
    const manifestPath = join(outDir, "manifest.json");
    assert.ok(existsSync(corpusPath));
    assert.ok(existsSync(manifestPath));
    const corpusBytes = readFileSync(corpusPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.record_count, 1);
    assert.equal(manifest.corpus_sha256, sha256(corpusBytes), "manifest digest matches the corpus bytes via integrity-digest.js's sha256");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --selftest passes as a real subprocess too (parity with every other lib module).
// ---------------------------------------------------------------------------
test("--selftest passes", () => {
  const r = run(REPO, ["decision-capture", "--selftest"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /RESULT: PASS/);
});

// ---------------------------------------------------------------------------
// Integration smoke test (spec §8 Definition of Done). NOTE: the spec's literal example
// payload `{"status":"backlog","spec":"none"}` supplies only 2 of next's 6 real call-contract
// keys; the other 4 (eligible/parked/blocked/ifEligible) are load-bearing for a genuine
// replay (nextStep's `!eligible && !ifEligible` branch means an omitted `eligible` cannot be
// safely defaulted without risking a DIFFERENT verdict than the one actually taken — the
// exact "captured shape does not reconstruct the kernel call" failure mode spec §4 names).
// KERNEL_REGISTRY.next therefore requires all 6 keys (derived from nextStep's full options-
// object signature, per the house-convention brief); this smoke test supplies the complete
// input set so it demonstrates the mechanism while genuinely earning coverage=replayable,
// preserving every one of the DoD's own observable assertions (exit 0, type/coverage/issue,
// events verify -> verified).
// ---------------------------------------------------------------------------
test("integration smoke test (spec §8): stdin JSON -> record --run R --issue FAFF-1 --kernel next -> replayable, verified chain", () => {
  const { root, runDir, log } = mkRoot("dc-smoke-", "R");
  try {
    enableCapture(root);
    seedGenesis(root, "R");
    const stdin = JSON.stringify({
      normalised_inputs: { status: "backlog", spec: "none", eligible: true, parked: false, blocked: false, ifEligible: false },
      selected_action: "prep",
    });
    const r = run(root, ["decision-capture", "record", "--run", "R", "--issue", "FAFF-1", "--kernel", "next"], stdin);
    assert.equal(r.code, 0, r.err);

    const rec = records(log).pop();
    assert.equal(rec.type, "decision-capture");
    assert.equal(rec.data.coverage, "replayable");
    assert.equal(rec.issue, "FAFF-1");

    const v = run(root, ["events", "verify", "--run-dir", runDir, "--json"]);
    assert.equal(v.code, 0, v.err);
    assert.equal(JSON.parse(v.out).status, "verified");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
