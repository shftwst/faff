// FAFF-821 — `faff decision-capture` — read-only instrumentation of the current
// decision-kernel inputs and chosen actions. Spawns the real CLI (execFileSync — the
// entrypoint, arg parsing, exit codes, exactly as CI and users invoke it) over a scratch
// `.faff/runs/<run-id>` tree, mirroring test/events-chain.test.mjs's conventions. Asserts
// the 5 SCENARIOS from spec §5, the two bare assertions, and the spec §8 integration
// smoke test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
// export --include-anchors (FAFF-960): committed-anchor records reach the corpus.
// ---------------------------------------------------------------------------

// A full replayable next-kernel envelope, as export/anchor bytes carry it (top-level
// run_id/seq is the dedup identity; the kernel payload lives under `data`).
function anchorNextRecord({ run_id, seq, issue, extraInputs = {}, action = "graft" }) {
  return {
    type: "decision-capture", run_id, seq, issue,
    data: {
      kernel: "next", kernel_version: "next@1",
      normalised_inputs: { ...FULL_NEXT_INPUTS, awaitingSpecReview: false, ...extraInputs },
      selected_action: action, coverage: "replayable", missing_inputs: [],
    },
  };
}

// Write a committed-anchor events.jsonl (.faff/anchors/<run>/<issue>/events.jsonl) from a
// list of record objects (or raw string lines, for the malformed case).
function writeAnchor(root, runId, issue, recordsOrLines) {
  const dir = join(root, ".faff", "anchors", runId, issue);
  mkdirSync(dir, { recursive: true });
  const lines = recordsOrLines.map((r) => (typeof r === "string" ? r : JSON.stringify(r)));
  writeFileSync(join(dir, "events.jsonl"), lines.join("\n") + "\n");
  return dir;
}

test("export --include-anchors: an anchor-only record (no live dir) reaches the corpus, re-redacted at the publish boundary (AC1)", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-anchor-only-"));
  const outDir = mkdtempSync(join(tmpdir(), "dc-anchor-out-"));
  const SECRET = "aLongEnoughSecretTokenValue123";
  try {
    // capture on + a resolvable known secret; NO .faff/runs at all (external-only case).
    writeFileSync(join(root, ".faffrc.yaml"), `capture:\n  decision_kernel: on\nandon:\n  token: ${SECRET}\n`);
    writeAnchor(root, "run-EXT", "FAFF-x", [
      anchorNextRecord({ run_id: "run-EXT", seq: 1, issue: "FAFF-x", extraInputs: { note: `token is ${SECRET}` } }),
    ]);
    const r = run(root, ["decision-capture", "export", "--out", outDir, "--include-anchors"]);
    assert.equal(r.code, 0, r.err);
    const corpus = readFileSync(join(outDir, "decision-corpus.jsonl"), "utf8");
    assert.equal(corpus.includes(SECRET), false, "the raw secret must not survive the publish-boundary re-redaction");
    assert.match(corpus, /\[REDACTED\]/);
    const recs = corpus.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(recs.length, 1);
    assert.equal(recs[0].run_id, "run-EXT");
    assert.equal(recs[0].data.normalised_inputs.note, "token is [REDACTED]");
    assert.equal(JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")).record_count, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("export --include-anchors: a live record and its byte-identical committed anchor collapse to one, counted once (AC2)", () => {
  const { root, log } = mkRoot("dc-anchor-dedup-", "Rdup");
  const outDir = mkdtempSync(join(tmpdir(), "dc-dedup-out-"));
  try {
    enableCapture(root);
    seedGenesis(root, "Rdup");
    run(root, ["decision-capture", "record", "--run", "Rdup", "--issue", "FAFF-d", "--kernel", "next"],
      JSON.stringify({ normalised_inputs: FULL_NEXT_INPUTS, selected_action: "graft" }));
    const liveRecs = records(log).filter((r) => r.type === "decision-capture");
    assert.equal(liveRecs.length, 1);
    // The anchor is a byte-copy of the same run's events — same run_id+seq identity.
    writeAnchor(root, "Rdup", "FAFF-d", liveRecs);
    const r = run(root, ["decision-capture", "export", "--out", outDir, "--include-anchors"]);
    assert.equal(r.code, 0, r.err);
    const recs = readFileSync(join(outDir, "decision-corpus.jsonl"), "utf8").split("\n").filter(Boolean);
    assert.equal(recs.length, 1, "the live record and its anchor copy are one logical record");
    assert.equal(JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")).record_count, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("export --include-anchors: two exports of the same logical set are byte-identical and reproduce (AC3)", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-anchor-repro-"));
  const outA = mkdtempSync(join(tmpdir(), "dc-repro-a-"));
  const outB = mkdtempSync(join(tmpdir(), "dc-repro-b-"));
  const report = mkdtempSync(join(tmpdir(), "dc-repro-report-"));
  try {
    writeFileSync(join(root, ".faffrc.yaml"), "capture:\n  decision_kernel: on\n");
    // Two anchors under different runs, deliberately out of natural order.
    writeAnchor(root, "run-B", "FAFF-2", [anchorNextRecord({ run_id: "run-B", seq: 1, issue: "FAFF-2" })]);
    writeAnchor(root, "run-A", "FAFF-1", [anchorNextRecord({ run_id: "run-A", seq: 1, issue: "FAFF-1" })]);
    const rA = run(root, ["decision-capture", "export", "--out", outA, "--include-anchors"]);
    const rB = run(root, ["decision-capture", "export", "--out", outB, "--include-anchors"]);
    assert.equal(rA.code, 0, rA.err);
    assert.equal(rB.code, 0, rB.err);
    const corpusA = readFileSync(join(outA, "decision-corpus.jsonl"));
    const corpusB = readFileSync(join(outB, "decision-corpus.jsonl"));
    assert.ok(corpusA.equals(corpusB), "same logical set -> byte-identical corpus");
    assert.equal(JSON.parse(readFileSync(join(outA, "manifest.json"), "utf8")).corpus_sha256,
      JSON.parse(readFileSync(join(outB, "manifest.json"), "utf8")).corpus_sha256);
    // and the study reproduces from a report built off that corpus.
    const rRun = run(REPO, ["shadow-fidelity", "run", "--corpus", join(outA, "decision-corpus.jsonl"), "--manifest", join(outA, "manifest.json"), "--out", report, "--root", REPO]);
    assert.equal(rRun.code, 0, rRun.err || rRun.out);
    const rRepro = run(REPO, ["shadow-fidelity", "reproduce", "--dir", report, "--root", REPO]);
    assert.equal(rRepro.code, 0, rRepro.err || rRepro.out);
  } finally {
    for (const d of [root, outA, outB, report]) rmSync(d, { recursive: true, force: true });
  }
});

test("export (no --include-anchors): default path ignores anchors, byte-identical to the live-only corpus (AC4)", () => {
  const { root, log } = mkRoot("dc-anchor-default-", "Rdef");
  const outBefore = mkdtempSync(join(tmpdir(), "dc-def-before-"));
  const outAfter = mkdtempSync(join(tmpdir(), "dc-def-after-"));
  try {
    enableCapture(root);
    seedGenesis(root, "Rdef");
    run(root, ["decision-capture", "record", "--run", "Rdef", "--issue", "FAFF-df", "--kernel", "next"],
      JSON.stringify({ normalised_inputs: FULL_NEXT_INPUTS, selected_action: "graft" }));
    assert.equal(records(log).filter((r) => r.type === "decision-capture").length, 1);
    const before = run(root, ["decision-capture", "export", "--out", outBefore]);
    assert.equal(before.code, 0, before.err);
    // Add a committed anchor with an UNRELATED record; the no-flag path must ignore it.
    writeAnchor(root, "run-EXT", "FAFF-z", [anchorNextRecord({ run_id: "run-EXT", seq: 9, issue: "FAFF-z" })]);
    const after = run(root, ["decision-capture", "export", "--out", outAfter]);
    assert.equal(after.code, 0, after.err);
    const corpusBefore = readFileSync(join(outBefore, "decision-corpus.jsonl"));
    const corpusAfter = readFileSync(join(outAfter, "decision-corpus.jsonl"));
    assert.ok(corpusBefore.equals(corpusAfter), "default path is unchanged by the presence of anchors");
    assert.equal(JSON.parse(readFileSync(join(outBefore, "manifest.json"), "utf8")).corpus_sha256,
      JSON.parse(readFileSync(join(outAfter, "manifest.json"), "utf8")).corpus_sha256);
    assert.equal(JSON.parse(readFileSync(join(outAfter, "manifest.json"), "utf8")).record_count, 1);
  } finally {
    for (const d of [root, outBefore, outAfter]) rmSync(d, { recursive: true, force: true });
  }
});

test("export --include-anchors: a malformed anchor events.jsonl is skipped with a stderr note; exit code unaffected (AC5)", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-anchor-bad-"));
  const outDir = mkdtempSync(join(tmpdir(), "dc-bad-out-"));
  try {
    writeFileSync(join(root, ".faffrc.yaml"), "capture:\n  decision_kernel: on\n");
    // A good anchor and a malformed one (one valid record line + one non-JSON line).
    writeAnchor(root, "run-good", "FAFF-g", [anchorNextRecord({ run_id: "run-good", seq: 1, issue: "FAFF-g" })]);
    writeAnchor(root, "run-bad", "FAFF-b", [
      JSON.stringify(anchorNextRecord({ run_id: "run-bad", seq: 1, issue: "FAFF-b" })),
      "this is not json {{{",
    ]);
    // spawnSync captures stderr even on a 0 exit (the shared run() helper drops it on success).
    const r = spawnSync("node", [CLI, "decision-capture", "export", "--out", outDir, "--include-anchors"], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, "a bad anchor never changes the exit code");
    assert.match(r.stderr, /malformed line/);
    const recs = readFileSync(join(outDir, "decision-corpus.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    // both parseable records survive (the good anchor's + the bad anchor's valid line).
    assert.deepEqual(recs.map((x) => x.run_id).sort(), ["run-bad", "run-good"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("export --include-anchors: no .faff/anchors directory behaves as the default path over the live dirs (spec 'No anchors present' scenario)", () => {
  const { root } = mkRoot("dc-no-anchors-", "Rna");
  const outFlag = mkdtempSync(join(tmpdir(), "dc-na-flag-"));
  const outPlain = mkdtempSync(join(tmpdir(), "dc-na-plain-"));
  try {
    enableCapture(root);
    seedGenesis(root, "Rna");
    run(root, ["decision-capture", "record", "--run", "Rna", "--issue", "FAFF-na", "--kernel", "next"],
      JSON.stringify({ normalised_inputs: FULL_NEXT_INPUTS, selected_action: "graft" }));
    // No .faff/anchors exists at all; --include-anchors must degrade to the live-only corpus.
    const rFlag = run(root, ["decision-capture", "export", "--out", outFlag, "--include-anchors"]);
    assert.equal(rFlag.code, 0, rFlag.err);
    const rPlain = run(root, ["decision-capture", "export", "--out", outPlain]);
    assert.equal(rPlain.code, 0, rPlain.err);
    // With one live record and no anchors, both digests must agree and count 1 (a well-formed corpus).
    assert.equal(JSON.parse(readFileSync(join(outFlag, "manifest.json"), "utf8")).record_count, 1);
    assert.equal(JSON.parse(readFileSync(join(outFlag, "manifest.json"), "utf8")).corpus_sha256,
      JSON.parse(readFileSync(join(outPlain, "manifest.json"), "utf8")).corpus_sha256);
  } finally {
    for (const d of [root, outFlag, outPlain]) rmSync(d, { recursive: true, force: true });
  }
});

test("export --include-anchors then shadow-fidelity run: non-null result for an anchor-only run whose live dir is absent (AC6)", () => {
  const root = mkdtempSync(join(tmpdir(), "dc-anchor-e2e-"));
  const outDir = mkdtempSync(join(tmpdir(), "dc-e2e-out-"));
  try {
    writeFileSync(join(root, ".faffrc.yaml"), "capture:\n  decision_kernel: on\n");
    writeAnchor(root, "run-EXT", "FAFF-x", [anchorNextRecord({ run_id: "run-EXT", seq: 1, issue: "FAFF-x" })]);
    const rExp = run(root, ["decision-capture", "export", "--out", outDir, "--include-anchors"]);
    assert.equal(rExp.code, 0, rExp.err);
    const rStudy = run(REPO, ["shadow-fidelity", "run", "--corpus", join(outDir, "decision-corpus.jsonl"), "--manifest", join(outDir, "manifest.json"), "--root", REPO, "--json"]);
    assert.equal(rStudy.code, 0, rStudy.err || rStudy.out);
    const result = JSON.parse(rStudy.out);
    assert.equal(result.null_result, false, "an anchor-sourced corpus yields a populated study");
    assert.equal(result.record_count, 1);
    assert.ok(result.matrix.next, "the anchor-only next record populates matrix.next");
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
