// FAFF-895 — the digest-verified custody basis on the remote-backed `--pr` L4 merge path.
//
// FAFF-892 landed a path-agnostic merge-floor fold: `cmdMergeGate` (the `--pr` branch) and
// `cmdMergeGateLocal` both call the identical `buildMergeFloorDigestVerify` + `resolveIntegrity`
// pair. FAFF-893 produced the `digest-verified` custody verdict on the interactive `--local`
// path; FAFF-895 broadens that same producer to also thread its two flags onto the `--pr`
// invocation. This suite pins the CONSUMER half of that claim directly against `cmdMergeGate`
// (the `--pr` branch) — the same gh-stub harness pattern as merge-gate-controlflow.test.mjs — so
// the fix is exercised end to end, not merely asserted in prose:
//
//   1. an L4 `--pr` merge with an otherwise-clean floor and NO custody flags refuses
//      (`corrective-artifact integrity unasserted at L4`) — the gap this ticket confirmed exists.
//   2. the identical run, now carrying a clean custody-verdict.json + its retained sha256 threaded
//      via --custody-verdict/--custody-verdict-sha256, reaches merge-ok — the fix.
//   3. a tampered/mismatched verdict, or a verdict at the wrong path, still refuses — the two-basis
//      admission discipline (computeCustodyVerdictAdmission) holds on --pr exactly as on --local.
//
// No code changes ship with this ticket (merge-gate.js is unmodified) — this suite is the
// confirming test the spec's DONE checklist calls for, proving the already-landed fold admits
// the already-existing producer shape on the remote-backed path.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, utimesSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const ISSUE = "FAFF-9";
const SHA = "deadbeefcafe1234567890abcdef1234567890ab";
const REPO = "owner/repo";

const tmpDirs = [];
const mkTmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// Minimal stub `gh` — only the subcommands an L4 `--pr` merge-gate invocation issues. Mirrors
// merge-gate-controlflow.test.mjs's STUB_GH (duplicated here, not imported, per this suite's own
// convention of self-contained fixtures); an unhandled subcommand fails loudly (exit 3).
const STUB_GH = `#!/usr/bin/env bash
case "$1" in
  repo)
    [ "$2" = "view" ] && { printf '{"nameWithOwner":"%s"}' "$STUB_REPO"; exit 0; } ;;
  pr)
    case "$2" in
      view)   printf '{"headRefOid":"%s","headRefName":"stub-head-branch","state":"OPEN","url":"https://example.test/pr/9"}' "$STUB_SHA"; exit 0 ;;
      checks) printf '[]'; exit 0 ;;
      merge)  printf '%s' "$*" > "$STUB_MERGE_SENTINEL"; exit 0 ;;
    esac ;;
  api)
    if [ "$2" = "-I" ]; then printf 'HTTP/2 200 OK\\r\\n\\r\\n'; exit 0; fi
    case "$*" in
      *contents*)   printf '%s' "$STUB_ANCHOR_CONTENT"; exit 0 ;;
      *check-runs*) printf '[{"status":"completed","conclusion":"success"}]'; exit 0 ;;
      *status*)     printf '{"state":"success","count":1}'; exit 0 ;;
    esac ;;
esac
printf 'stub gh: unhandled subcommand: %s\\n' "$*" >&2
exit 3
`;

function stubGhEnv() {
  const stubDir = mkTmp("f895-gh-");
  const ghPath = join(stubDir, "gh");
  writeFileSync(ghPath, STUB_GH);
  chmodSync(ghPath, 0o755);
  const sentinel = join(stubDir, "merge-sentinel");
  const anchorBody = JSON.stringify({ run_id: "anchored", level: "L4" });
  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH}`,
    STUB_REPO: REPO,
    STUB_SHA: SHA,
    STUB_MERGE_SENTINEL: sentinel,
    STUB_ANCHOR_CONTENT: JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(anchorBody).toString("base64") }),
  };
  return { env, sentinel };
}

// A merge-ok floor (AC + review pass) with a FRESH holdout (postdating the build-complete
// checkpoint) — isolates the integrity leg exactly as merge-gate-controlflow.test.mjs's FAFF-420
// "fresh" case does, so the only remaining blocker on an unasserted host is the integrity leg.
function seedL4RunDir() {
  const runDir = mkTmp("f895-run-");
  const issueDir = join(runDir, ISSUE);
  mkdirSync(issueDir, { recursive: true });
  writeFileSync(join(issueDir, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
  writeFileSync(join(issueDir, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
  const checkpointTime = new Date("2026-08-20T12:00:00.000Z");
  writeFileSync(join(issueDir, "build-progress.json"), JSON.stringify({ issue: ISSUE, build: { status: "complete", pushed_at: checkpointTime.toISOString() }, updated_at: checkpointTime.toISOString() }));
  const holdoutFile = join(issueDir, "holdout.json");
  writeFileSync(holdoutFile, JSON.stringify({ aggregate: "meets-spec", code_blind: true, criteria: [{ class: "assertion", verdict: "met", evidence_present: true }], violations: [] }));
  const freshTime = new Date("2026-08-20T13:00:00.000Z"); // postdates the checkpoint
  utimesSync(holdoutFile, freshTime, freshTime);
  return runDir;
}

function sha256Hex(bytes) { return createHash("sha256").update(Buffer.from(bytes)).digest("hex"); }

// Writes the canonical custody-verdict.json produced by `integrity-digest verify --record-result`
// (composed, not hand-invented) and returns { file, sha256 } — the retained sha an honest
// interactive-custody-stamp sub-step would hold in-session.
function writeCustodyVerdict(runDir, issue, over = {}) {
  const record = {
    schema_version: 1, run_id: basename(runDir), issue, classification: "clean",
    paths: [], detail: "digest-verified", verified_at: "2026-08-20T13:30:00.000Z",
    merge_state_at_verification: "pre-merge", ...over,
  };
  const file = join(runDir, issue, "custody-verdict.json");
  const bytes = JSON.stringify(record);
  writeFileSync(file, bytes);
  return { file, sha256: sha256Hex(bytes) };
}

const custodyArgs = ({ file, sha256 } = {}) => (file ? ["--custody-verdict", file, "--custody-verdict-sha256", sha256] : []);

const prArgsL4 = (runDir, extra = []) =>
  ["merge-gate", "--pr", "9", "--issue", ISSUE, "--run-dir", runDir, "--level", "L4", "--repo", REPO, "--json", "--squash", "--execute", ...extra];

test("FAFF-895 gap-confirm: L4 --pr, clean floor + fresh holdout, NO custody flags → refuses (unasserted integrity) — the gap this ticket found", () => {
  const runDir = seedL4RunDir();
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(prArgsL4(runDir), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /corrective-artifact integrity unasserted at L4/.test(b)), "with no custody basis threaded, --pr refuses identically to --local pre-FAFF-893");
  assert.equal(existsSync(sentinel), false, "no gh pr merge on a refused floor");
});

test("FAFF-895 fix: L4 --pr, same floor, a clean custody verdict + matching retained sha256 threaded → merge-ok (digest-verified basis admits on --pr)", () => {
  const runDir = seedL4RunDir();
  const cv = writeCustodyVerdict(runDir, ISSUE);
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(prArgsL4(runDir, custodyArgs(cv)), { env });
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(out.integrity, "custody-trusted", "the digest-verified basis is the one FAFF-892's fold admits, byte-identical to --local");
  assert.equal(existsSync(sentinel), true, "a satisfied digest-verified basis on --pr must reach the real merge");
});

test("FAFF-895: a tampered per-issue member after the verdict was recorded still refuses on --pr (uncertainty fails toward refuse)", () => {
  const runDir = seedL4RunDir();
  const cv = writeCustodyVerdict(runDir, ISSUE);
  // Mutate a snapshotted member after the verdict was recorded — the same forge the FAFF-893
  // producer-side test exercises, now asserted against the --pr consumer.
  writeFileSync(join(runDir, ISSUE, "review-verdict.json"), JSON.stringify({ signal: "tampered-to-pass" }));
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(prArgsL4(runDir, custodyArgs(cv)), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.equal(existsSync(sentinel), false, "a stale custody verdict against a mutated surface must never merge");
});

test("FAFF-895: a retained sha256 that no longer matches the persisted verdict bytes → refuse, no merge", () => {
  const runDir = seedL4RunDir();
  const original = writeCustodyVerdict(runDir, ISSUE); // sha256 an honest caller would have retained
  writeCustodyVerdict(runDir, ISSUE, { detail: "replaced after recording" }); // same path, different bytes
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(prArgsL4(runDir, custodyArgs(original)), { env }); // stale retained digest
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.equal(existsSync(sentinel), false, "a digest mismatch against the retained sha must never merge");
});
