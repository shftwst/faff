// FAFF-679 — the mid-bracket write rule (gateway obligation 5): a custody bracket must
// not report `tampered` when the TRUSTED orchestrator writes a bracketed member (Class
// A, a CLI-mediated write like `budget baseline` / `events append --tokens` / `sentry
// abort`; Class B, the orchestrator's own direct session edit of run-ledger.json)
// inside its own open bracket window, while continuing to catch an actually-untrusted
// write. Exercised end-to-end via the real CLI seam (`faff integrity-digest`,
// `faff budget baseline`, `faff corrective author`), per ADR 0002 — assert the
// deterministic seam, never prose. DONE items 1/2/3/5/6 from the FAFF-679 spec.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runCli } from "./helpers/run-cli.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// FAFF-607: the `concurrency` slot contract (obligation 5) moved from the monolith into the L4 lane
// reference (faff/references/l4.md) — that is where the obligation-5 prose now lives.
const gatewaySkill = readFileSync(join(repoRoot, "plugin", "skills", "faff", "references", "l4.md"), "utf8");
const sequentialSkill = readFileSync(join(repoRoot, "plugin", "skills", "faffter-noon-concurrency-sequential", "SKILL.md"), "utf8");
const parallelSkill = readFileSync(join(repoRoot, "plugin", "skills", "faffter-dark-concurrency-parallel", "SKILL.md"), "utf8");

function evidenceDir() {
  const rd = mkdtempSync(path.join(tmpdir(), "faff-679-bw-"));
  mkdirSync(path.join(rd, "corrective"), { recursive: true });
  writeFileSync(path.join(rd, "run-ledger.json"), JSON.stringify({
    run_id: "run-test", admitted: [], outcomes: {},
    owner: { status: "running", started_at: "2026-07-29T00:00:00Z", last_heartbeat: "2026-07-29T00:00:00Z" },
    budget: {},
  }, null, 2) + "\n");
  writeFileSync(path.join(rd, "events.jsonl"), "");
  return rd;
}
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const snap = (rd) => runCli(["integrity-digest", "snapshot", "--run-dir", rd, "--events"]);
const verify = (rd, manifest) => runCli(["integrity-digest", "verify", "--run-dir", rd, "--events", "--manifest", "-", "--json"], { input: manifest });

// --- DONE 1: the ticket's repro, inverted -------------------------------------------

test("DONE-1: a trusted-side ledger write (budget baseline) inside an open bracket does not tamper the chain — post-write check names exactly run-ledger.json, re-baseline verifies clean", () => {
  const rd = evidenceDir();
  try {
    const b0 = snap(rd);
    assert.equal(b0.code, 0, b0.stderr);

    // The trusted orchestrator writes a bracketed member — a Class-A CLI-mediated write
    // that also appends a chained ledger-write NOTE to events.jsonl (an append, tolerated
    // by the events member's prefix-preserving carve-out).
    const w = runCli(["budget", "baseline", "--run-dir", rd, "--root", rd]);
    assert.equal(w.code, 0, w.stderr);

    // Post-write check: verify the OLD baseline against disk. The named tampered set
    // must be EXACTLY the member this write touched (run-ledger.json) — the events.jsonl
    // append must NOT show up (prefix rule), and nothing else changed.
    const post = verify(rd, b0.stdout);
    assert.equal(post.code, 1, "the whole-file ledger hash must move — that is the property under test");
    const postJson = JSON.parse(post.stdout);
    assert.deepEqual(postJson.tampered, ["run-ledger.json"], "the touched-member set must name exactly what this write touched, nothing more");

    // Re-snapshot → candidate baseline; verifying the CURRENT state against IT is clean.
    const b1 = snap(rd);
    assert.equal(b1.code, 0, b1.stderr);
    const clean = verify(rd, b1.stdout);
    assert.equal(clean.code, 0, clean.stderr);
    assert.equal(JSON.parse(clean.stdout).verdict, "digest-verified");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

// --- DONE 2: detection preserved -----------------------------------------------------

test("DONE-2: a second, untouched-by-the-trusted-write member also changing → the named set is no longer exactly the touched members → still exit-1", () => {
  const rd = evidenceDir();
  try {
    const b0 = snap(rd);
    const w = runCli(["budget", "baseline", "--run-dir", rd, "--root", rd]);
    assert.equal(w.code, 0, w.stderr);

    // An untrusted party (simulating a build subagent) also drops a file under
    // corrective/ — a member this legitimate write never touched.
    writeFileSync(path.join(rd, "corrective", "sneaky.json"), '{"op":"forged"}');

    const post = verify(rd, b0.stdout);
    assert.equal(post.code, 1);
    const tampered = JSON.parse(post.stdout).tampered;
    assert.ok(tampered.includes("run-ledger.json"), "the legitimate write still shows up");
    assert.ok(tampered.some((p) => p.includes("corrective")), "the untouched-by-this-write member must ALSO be named — detection is not weakened");
    assert.notDeepEqual(tampered, ["run-ledger.json"], "the named set is no longer exactly the touched members, so a post-write check must refuse to re-baseline");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

// --- DONE 3: independent oracle on the candidate baseline's sha256 -------------------

test("DONE-3: the candidate baseline's run-ledger.json sha256 equals the ledger_sha256 faff events append prints, both against an independent node:crypto digest", () => {
  const rd = evidenceDir();
  try {
    const w = runCli(["budget", "baseline", "--run-dir", rd, "--root", rd]);
    assert.equal(w.code, 0, w.stderr);
    assert.equal(w.stdout.trim() !== "", true);
    const written = JSON.parse(w.stdout);

    const b1 = snap(rd);
    assert.equal(b1.code, 0, b1.stderr);
    const manifest = JSON.parse(b1.stdout);

    const independent = sha256(readFileSync(path.join(rd, "run-ledger.json")));
    assert.equal(manifest.members["run-ledger.json"].sha256, independent, "the digest tool's own oracle");
    assert.equal(written.ledger_sha256_after, independent, "the writer's reported after-hash (FAFF-679) — same independent oracle, no CLI-hasher-only agreement");

    // The FAFF-564 ledger-write note's hash — a THIRD, independently-computed source —
    // must agree too (an events append --run/--tokens exercise, mirrored here via the
    // ledger-write note the atomicWriteLedger fold appended for the write above).
    const events = readFileSync(path.join(rd, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const note = events.find((e) => e.type === "ledger-write");
    assert.ok(note, "the write must have chained a ledger-write note");
    assert.equal(note.data.ledger_sha256, independent);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

// --- DONE 5: corrective author carries the sha256 of the file it wrote ---------------

test("DONE-5: corrective author --json carries the sha256 of the file at `path`, verified against an independent digest", () => {
  const rd = evidenceDir();
  try {
    const r = runCli(["corrective", "author", "--run-dir", rd, "--issue", "FAFF-1", "--op", "forbid-surface",
      "--surface", "src/x.js", "--cites-signal", "fix-review-thrash", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.sha256, "the record must carry the sha256 of the file it wrote");
    assert.equal(out.sha256, sha256(readFileSync(out.path)));
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

// --- DONE 6: Class B — the orchestrator's own direct session edit -------------------

test("DONE-6 (positive, fixed): verifying the held baseline BEFORE composing a direct ledger edit catches a subagent tamper — never absorbed into a candidate baseline", () => {
  const rd = evidenceDir();
  try {
    // The orchestrator snapshots and holds the baseline in context.
    const b0 = snap(rd);
    assert.equal(b0.code, 0, b0.stderr);

    // A build subagent tampers with the ledger directly (the case the ticket exists for).
    writeFileSync(path.join(rd, "run-ledger.json"), JSON.stringify({
      run_id: "run-test", admitted: [], outcomes: { "FAFF-9": "shipped" }, owner: { status: "running" },
    }, null, 2) + "\n");

    // Class B, as fixed: BEFORE composing any direct edit, the orchestrator verifies the
    // held baseline against disk. That verify must fire on the exit-1 path — the edit is
    // never composed, never written, and the tampered bytes never reach a candidate
    // baseline.
    const preComposeCheck = verify(rd, b0.stdout);
    assert.equal(preComposeCheck.code, 1, "the sequence must land on the exit-1 path before any compose/write happens");
    assert.deepEqual(JSON.parse(preComposeCheck.stdout).tampered, ["run-ledger.json"]);
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

test("DONE-6 (negative, companion): composing a direct ledger edit from a FRESH DISK READ — skipping the pre-compose verify — launders the tamper into the candidate baseline", () => {
  const rd = evidenceDir();
  try {
    const b0 = snap(rd);
    assert.equal(b0.code, 0, b0.stderr);

    // A build subagent tampers with the ledger directly.
    writeFileSync(path.join(rd, "run-ledger.json"), JSON.stringify({
      run_id: "run-test", admitted: [], outcomes: { "FAFF-9": "shipped" }, owner: { status: "running" },
    }, null, 2) + "\n");

    // The FLAWED path (what the first draft of the spec would have shipped): the
    // orchestrator composes its own edit by reading the CURRENT on-disk file (already
    // tampered) rather than from the held baseline, merges its own field, and writes —
    // with no pre-compose verify against the held baseline.
    const freshRead = JSON.parse(readFileSync(path.join(rd, "run-ledger.json"), "utf8"));
    freshRead.stop_reason = "orchestrator-note";
    const intended = JSON.stringify(freshRead, null, 2) + "\n";
    writeFileSync(path.join(rd, "run-ledger.json"), intended);

    // A content check that hashes "the bytes the orchestrator intended to write" —
    // derived from that same tainted read — passes trivially, because intended IS what
    // got written: the subagent's forged outcome for FAFF-9 is now baked into the file
    // AND into the new candidate baseline, laundered as legitimate.
    const b1 = snap(rd);
    assert.equal(b1.code, 0, b1.stderr);
    const manifest = JSON.parse(b1.stdout);
    assert.equal(manifest.members["run-ledger.json"].sha256, sha256(Buffer.from(intended)),
      "the naive content check (hash of the composed-from-tainted-read output) agrees with what was written — it cannot see the tamper");
    const persisted = JSON.parse(readFileSync(path.join(rd, "run-ledger.json"), "utf8"));
    assert.equal(persisted.outcomes["FAFF-9"], "shipped", "the forged outcome survived into the new baseline — this is the laundering DONE-6 exists to prevent");
  } finally { rmSync(rd, { recursive: true, force: true }); }
});

// --- DONE 7/8/9: the SKILL.md prose regression guards -------------------------------
// Precedent: test/merge-gate.test.mjs readFileSync's SKILL.md files and asserts against
// their text, rather than only against CLI behaviour — the same shape used here, because
// the FAFF-679 bug WAS a plausible-sounding false premise in prose ("this executor writes
// nothing between snapshot and verify … zero re-baselining") that no test caught.

test("DONE-7: gateway obligation 5 states the mid-bracket write rule, one-chain-per-orchestrator, and the Class-B composition requirement", () => {
  const obligation5 = gatewaySkill.match(/^5\. \*\*Bracket every graft dispatch.*$/m);
  assert.ok(obligation5, "obligation 5 must exist in the gateway, still numbered 5");
  const text = obligation5[0];
  assert.match(text, /one continuous run-grain chain per orchestrator|one \*\*chain\*\* per orchestrator|one continuous.*chain/i,
    "must state one chain per orchestrator, not per-dispatch");
  assert.match(text, /never.*per-dispatch baseline|never a per-dispatch baseline/i,
    "must reject a per-dispatch baseline over the shared mutable set");
  assert.match(text, /verify.*perform the write.*post-write check.*snapshot.*intended-content check/i,
    "must state the five-step mid-bracket write sequence in order");
  assert.match(text, /permitted, never forbidden/i, "must permit trusted mid-bracket writes rather than forbid them");
  assert.match(text, /Class A/, "must name Class A (CLI-mediated writes)");
  assert.match(text, /Class B/, "must name Class B (the orchestrator's own direct session edit)");
  assert.match(text, /composed from the baseline-verified copy already held in context, never from a fresh disk read/,
    "Class B must be required to compose from the held baseline, never a fresh disk read — the exact hole the FAFF-679 spec's first review pass missed");
});

test("DONE-8: the sequential executor no longer claims it writes nothing between snapshot and verify, or zero re-baselining", () => {
  assert.doesNotMatch(sequentialSkill, /writes nothing between snapshot and verify/i);
  assert.doesNotMatch(sequentialSkill, /zero re-baselining/i);
  assert.doesNotMatch(sequentialSkill, /disjoint,? per-dispatch/i);
  // Positive: it must still name obligation 5 and describe its own placement (at most one
  // bracket open at a time), not silently drop the section.
  assert.match(sequentialSkill, /obligation 5/);
  assert.match(sequentialSkill, /at most one\*\* bracket/i);
});

test("DONE-9: both executors reference obligation 5 for the shared chain/sequence/Class A-B rules, and carry only placement prose", () => {
  for (const [name, text] of [["sequential", sequentialSkill], ["parallel", parallelSkill]]) {
    assert.match(text, /obligation 5/, `${name} executor must reference obligation 5`);
  }
  // The full five-step sequence text must NOT be duplicated verbatim in either executor —
  // it now lives once, in the gateway (validate-adapters' duplicated-block lint is the
  // mechanical form of this; this is the semantic form: neither executor restates the
  // step list inline any more).
  for (const [name, text] of [["sequential", sequentialSkill], ["parallel", parallelSkill]]) {
    assert.doesNotMatch(text, /always in this order.*perform the write.*post-write check.*intended-content check/is,
      `${name} executor must not restate the five-step sequence's own ordering clause — refer back to the gateway instead`);
  }
});

test("DONE-9 (mechanical): faff validate-adapters reports no duplicated block and no dangling reference across the two executors", () => {
  const r = runCli(["validate-adapters"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /duplicat/i);
  assert.doesNotMatch(r.stdout, /dangling/i);
});

test("ADR-0078 states the chain's actual promise ('no unobserved window'), not the stronger, false 'frozen for the dispatch' property", () => {
  const adr = readFileSync(join(repoRoot, "records", "adr", "0078-digest-custody-bracket-as-concurrency-contract-obligation-5.md"), "utf8");
  assert.match(adr, /no unobserved window/i);
  assert.match(adr, /not\*\*[\s\S]{0,40}frozen for the dispatch/i);
});
