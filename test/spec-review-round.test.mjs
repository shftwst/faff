// FAFF-1417 — `faff spec-review round`: prep's post-dispatch spec-review sequence as one verb.
// The decision table is driven through the pure `decideRound`; the procedure through the shipped
// CLI over temp scratch dirs; the corpus replay over committed historical round records. Case
// names are the ones the spec's rule inventory cites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const CORPUS = join(HERE, "fixtures", "spec-review-round-corpus");
const srr = require("../plugin/skills/faff/bin/lib/spec-review-round.js");

// --- Fixtures ---

const o = (lens, severity, extra = {}) => ({ lens, severity, ...extra });
const rec = (verdict, objections) => ({ verdict, objections });
const REVISE_ARCH = rec("revise", [o("architectural", "major")]);

function scratch(records = {}, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-srr-"));
  const dir = join(root, "s");
  mkdirSync(dir, { recursive: true });
  for (const [n, r] of Object.entries(records)) writeFileSync(join(dir, `round-${n}.json`), JSON.stringify(r));
  for (const [name, body] of Object.entries(extra)) writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  return { root, dir };
}
function block(body) {
  return "Review done.\n\n```faff-contract:spec-review-verdict\n" + (typeof body === "string" ? body : JSON.stringify(body)) + "\n```\n";
}
function runDirAt(root, level) {
  const runDir = join(root, "run");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(level === undefined ? {} : { level }));
  return runDir;
}
// round(fx, verdictText, flags) -> { code, res, stderr }; defaults: single-pass, autonomous, high.
function round(fx, verdictText, flags = {}) {
  const f = join(fx.root, "out.md");
  writeFileSync(f, verdictText);
  const opts = { occupant: "single-pass", mode: "autonomous", appetite: "high", ...flags };
  const args = ["spec-review", "round", "--issue", opts.issue ?? "FAFF-9001", "--dir", fx.dir, "--verdict-file", f, "--root", fx.root, "--json"];
  for (const k of ["occupant", "mode", "appetite", "served", "run-dir", "retry-limit"]) if (opts[k] !== undefined && opts[k] !== null) args.push(`--${k}`, String(opts[k]));
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, FAFF_RUN_DIR: "" } });
  let res = null;
  try { res = JSON.parse(r.stdout); } catch { res = null; }
  return { code: r.status, res, stderr: r.stderr };
}
function cli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, FAFF_RUN_DIR: "" } });
  let res = null;
  try { res = JSON.parse(r.stdout); } catch { res = null; }
  return { code: r.status, res, stdout: r.stdout, stderr: r.stderr };
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const PIN = { provider: "p", model: "m", host: "h" };
function adversarialFx(records = {}, n = Object.keys(records).length + 1) {
  return scratch(records, {
    "pinned-reviewer.json": PIN,
    "pin-capture.json": { state: "captured", round: 1 },
    [`served-${n}.json`]: { served_identity: "p|m|h" },
  });
}

// --- The six spec scenarios ---

test("scenario 1: churn at round 3 parks with the exact cause and keeps round-3.json", () => {
  const fx = scratch({ 1: REVISE_ARCH, 2: rec("revise", [o("architectural", "minor")]) });
  const { code, res } = round(fx, block(rec("revise", [o("architectural", "minor"), o("QA", "minor")])), { appetite: "high" });
  assert.equal(code, 0);
  assert.equal(res.action, "park");
  assert.equal(res.cause, "spec-review churn detected — new objecting lens(es) since round 2: QA");
  assert.equal(readJson(join(fx.dir, "round-3.json")).verdict, "revise");
});

test("scenario 2: an approve carrying objections parks exit 1 and leaves no round-1.json", () => {
  const fx = scratch();
  const { code, res } = round(fx, block(rec("approve", [o("QA", "minor")])), { mode: "interactive" });
  assert.equal(code, 0);
  assert.equal(res.action, "park");
  assert.equal(res.cause, "spec-review contract not satisfied (exit 1)");
  assert.equal(existsSync(join(fx.dir, "round-1.json")), false);
});

test("scenario 3: a converging loop at the cap yields (cap 3, used 3, yielded)", () => {
  const arch = (k) => Array.from({ length: k }, () => o("architectural", "major"));
  const fx = scratch({ 1: rec("revise", arch(3)), 2: rec("revise", arch(2)) });
  const { res } = round(fx, block(rec("revise", [o("architectural", "minor")])), { appetite: "medium" });
  assert.equal(res.action, "fix-and-rerun");
  assert.equal(res.cap.limit, 3);
  assert.equal(res.cap.used, 3);
  assert.equal(res.cap.yielded, true);
});

test("scenario 4: L3 autonomous, plateaued at the cap, goes to the judge", () => {
  const qa = rec("revise", [o("QA", "minor"), o("QA", "minor")]);
  const fx = scratch({ 1: qa, 2: qa });
  const { res } = round(fx, block(qa), { appetite: "medium", "run-dir": runDirAt(fx.root, "L3") });
  assert.equal(res.action, "judge");
  assert.equal(res.cause, "spec-review loop cap reached — revise");
  assert.equal(res.convergence.converging, false);
});

// --- Window and governance (P2–P10) ---

test("window read: window_start comes from window.json on disk", () => {
  const fx = scratch({ 1: REVISE_ARCH, 2: REVISE_ARCH }, { "window.json": { window_start: 2 } });
  const { res } = round(fx, block(REVISE_ARCH));
  assert.equal(res.window_start, 2);
});

test("govern any-served: an adversarial round with a matching served identity keeps the window", () => {
  const fx = adversarialFx({ 1: REVISE_ARCH });
  const { res } = round(fx, block(rec("revise", [o("architectural", "minor")])), { occupant: "adversarial", served: "any" });
  assert.equal(res.governance.action, "unchanged");
  assert.equal(res.window_start, 1);
  assert.ok(existsSync(join(fx.dir, "governance-2.json")));
});

test("govern no-lens: a round where no lens served records a no-lens governance", () => {
  const fx = adversarialFx({ 1: REVISE_ARCH });
  const { res } = round(fx, block(rec("unavailable", [o("QA", "major")])), { occupant: "adversarial", served: "none", mode: "interactive" });
  assert.equal(res.governance.action, "no-lens");
});

test("govern anomaly: a missed round-1 pin capture is surfaced as a warning", () => {
  const fx = scratch({}, { "served-1.json": { served_identity: "p|m|h" } });
  const { res } = round(fx, block(REVISE_ARCH), { occupant: "adversarial", served: "any" });
  assert.equal(res.governance.anomaly, "round1-capture-missed");
  assert.ok(res.warnings.some((w) => /govern-anomaly: unpinnable-reset round1-capture-missed/.test(w)), JSON.stringify(res.warnings));
});

test("govern fault: a missing served identity under a pin resets window_start to n with a warning", () => {
  const fx = scratch({ 1: REVISE_ARCH }, { "pinned-reviewer.json": PIN, "pin-capture.json": { state: "captured", round: 1 }, "window.json": { window_start: 1 } });
  const { res } = round(fx, block(rec("revise", [o("architectural", "minor")])), { occupant: "adversarial", served: "any" });
  assert.equal(res.window_start, 2);
  assert.ok(res.warnings.some((w) => w.startsWith("govern-fault: ")), JSON.stringify(res.warnings));
});

test("govern record missing: an absent governance-<n>.json resets window_start to n", () => {
  const fx = scratch({ 1: REVISE_ARCH }, { "window.json": { window_start: 1 } });
  const govern = () => ({ code: 0, result: { round: 2, window_start: 1, action: "unchanged", anomaly: null } }); // writes no record
  const res = srr.runRound({ issue: "FAFF-9001", dir: fx.dir, verdictText: block(rec("revise", [o("architectural", "minor")])), mode: "autonomous", occupant: "adversarial", served: "any", runDir: null, appetite: "high", retryLimit: 2, root: fx.root }, { govern });
  assert.equal(res.window_start, 2);
  assert.ok(res.warnings.includes("govern-record-missing"));
});

test("single-pass no govern: a single-pass round writes no governance record", () => {
  const fx = scratch({ 1: REVISE_ARCH });
  const { res } = round(fx, block(REVISE_ARCH));
  assert.equal(res.governance, null);
  assert.equal(existsSync(join(fx.dir, "governance-2.json")), false);
});

test("served required: --occupant adversarial without --served exits 2", () => {
  const fx = scratch();
  const { code, res } = round(fx, block(REVISE_ARCH), { occupant: "adversarial" });
  assert.equal(code, 2);
  assert.equal(res.action, "errored");
});

test("single-pass served this round: single-pass with --served, or with this round's served-<n>.json, exits 2", () => {
  const fx = scratch();
  assert.equal(round(fx, block(REVISE_ARCH), { served: "any" }).code, 2);
  const fx2 = scratch({ 1: REVISE_ARCH }, { "served-2.json": { served_identity: "p|m|h" } });
  assert.equal(round(fx2, block(REVISE_ARCH)).code, 2);
});

test("single-pass after old adversarial rounds: earlier rounds' pin files do not refuse a single-pass round", () => {
  const fx = scratch({ 1: REVISE_ARCH }, { "pinned-reviewer.json": PIN, "served-1.json": { served_identity: "p|m|h" } });
  const { code, res } = round(fx, block(REVISE_ARCH));
  assert.equal(code, 0);
  assert.equal(res.action, "fix-and-rerun");
});

test("window bounds churn: a round before window_start is never the churn comparand", () => {
  const fx = scratch({ 1: rec("revise", [o("architectural", "major")]), 2: rec("revise", [o("QA", "major")]) }, { "window.json": { window_start: 3 } });
  const { res } = round(fx, block(rec("revise", [o("QA", "major"), o("infosec", "major")])));
  assert.equal(res.churn, null);
  assert.equal(res.action, "fix-and-rerun");
});

test("open window: after a recorded park, --open-window moves window_start and the cap reset", () => {
  const fx = scratch({ 1: REVISE_ARCH, 2: REVISE_ARCH }, { "decision-2.json": { action: "park" } });
  const r = cli(["spec-review", "round", "--open-window", "--dir", fx.dir, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.res, { window_start: 3, cap_from: 3 });
  assert.equal(readJson(join(fx.dir, "window.json")).window_start, 3);
  const reset = readJson(join(fx.dir, "cap-reset.json"));
  assert.equal(reset.from_round, 3);
  assert.equal(reset.reason, "human-unpark");
  assert.equal(reset.after_decision, 2);
});

test("open window refused mid-loop: --open-window exits 2 unless the latest decision is park or judge", () => {
  const fx = scratch({ 1: REVISE_ARCH }, { "decision-1.json": { action: "fix-and-rerun" } });
  assert.equal(cli(["spec-review", "round", "--open-window", "--dir", fx.dir, "--json"]).code, 2);
  const empty = scratch();
  assert.equal(cli(["spec-review", "round", "--open-window", "--dir", empty.dir]).code, 2);
});

// --- Block location and the contract (P13–P17, P33–P36) ---

test("no block: output with no verdict block parks exit 2 and writes no round record", () => {
  const fx = scratch();
  const { res } = round(fx, "the reviewer said nothing structured\n");
  assert.equal(res.action, "park");
  assert.equal(res.cause, "spec-review contract not satisfied (exit 2)");
  assert.equal(existsSync(join(fx.dir, "round-1.json")), false);
});

test("bad json: an unparseable block parks exit 2", () => {
  const fx = scratch();
  const { res } = round(fx, block("{ not json"));
  assert.equal(res.cause, "spec-review contract not satisfied (exit 2)");
});

test("two blocks: more than one verdict block parks exit 2", () => {
  const fx = scratch();
  const { res } = round(fx, block(REVISE_ARCH) + block(REVISE_ARCH));
  assert.equal(res.cause, "spec-review contract not satisfied (exit 2)");
  assert.equal(existsSync(join(fx.dir, "round-1.json")), false);
});

test("fail loud: a block whose verdict is outside the vocabulary parks exit 2 and deletes the record", () => {
  const fx = scratch();
  const { res } = round(fx, block(rec("maybe", [o("QA", "minor")])));
  assert.equal(res.cause, "spec-review contract not satisfied (exit 2)");
  assert.equal(existsSync(join(fx.dir, "round-1.json")), false);
});

test("approve: a conformant approve returns approve and the retained line", () => {
  const fx = scratch({ 1: REVISE_ARCH });
  const { res } = round(fx, block(rec("approve", [])));
  assert.equal(res.action, "approve");
  assert.equal(res.retain, "spec-review: approve");
});

test("approve round 1: an approve on round 1 is backed by the record written before the pipe", () => {
  const fx = scratch();
  const { res } = round(fx, block(rec("approve", [])), { mode: "interactive" });
  assert.equal(res.action, "approve");
  assert.equal(res.round, 1);
  assert.ok(existsSync(join(fx.dir, "round-1.json")));
});

test("write before pipe: the written round record deep-equals {verdict, objections} from the block", () => {
  const fx = scratch();
  const objections = [o("architectural", "major", { claim: "c", evidence: "e", spec_anchor: "§3" })];
  round(fx, block({ verdict: "revise", objections, extra_top_level: true }));
  assert.deepEqual(readJson(join(fx.dir, "round-1.json")), { verdict: "revise", objections });
});

test("resume appends: the round number comes from disk, never overwriting round-1.json", () => {
  const fx = scratch({ 1: REVISE_ARCH, 2: REVISE_ARCH });
  const before = readFileSync(join(fx.dir, "round-1.json"), "utf8");
  const { res } = round(fx, block(REVISE_ARCH));
  assert.equal(res.round, 3);
  assert.equal(readFileSync(join(fx.dir, "round-1.json"), "utf8"), before);
});

test("revise: a revise below the cap is fix-and-rerun", () => {
  const fx = scratch();
  assert.equal(round(fx, block(REVISE_ARCH)).res.action, "fix-and-rerun");
});

test("no churn: a steady lens-set proceeds", () => {
  const fx = scratch({ 1: REVISE_ARCH });
  const { res } = round(fx, block(rec("revise", [o("architectural", "minor")])));
  assert.equal(res.churn.churn, false);
  assert.equal(res.action, "fix-and-rerun");
});

// --- Reject-approach routing (P19–P22, P27) ---

test("route prep: reject-approach with no methodology major loops in place", () => {
  const fx = scratch();
  assert.equal(round(fx, block(rec("reject-approach", [o("architectural", "major")]))).res.action, "fix-and-rerun");
});

test("route plot: reject-approach with a methodology major parks for /faff-plot", () => {
  const fx = scratch();
  const { res } = round(fx, block(rec("reject-approach", [o("methodology", "major")])));
  assert.equal(res.action, "park");
  assert.equal(res.cause, "spec-review reject-approach (methodology at major or above) — needs /faff-plot re-slice");
});

test("plot park carried: carried design-lens objections ride in the cause and the field", () => {
  const fx = scratch();
  const { res } = round(fx, block(rec("reject-approach", [o("methodology", "blocker"), o("infosec", "minor"), o("QA", "major")])));
  assert.equal(res.cause, "spec-review reject-approach (methodology at major or above) — needs /faff-plot re-slice; design-lens objections carried: infosec:minor, QA:major");
  assert.deepEqual(res.carried_design_objections, [o("infosec", "minor"), o("QA", "major")]);
});

test("plot L4: autonomous at L4 re-slices instead of parking", () => {
  const fx = scratch();
  const { res } = round(fx, block(rec("reject-approach", [o("methodology", "major"), o("QA", "minor")])), { "run-dir": runDirAt(fx.root, "L4") });
  assert.equal(res.action, "re-slice");
  assert.deepEqual(res.carried_design_objections, [o("QA", "minor")]);
});

test("level whitelist: only the exact strings L3 and L4 count as levels", () => {
  for (const level of ["l4", "L4 ", "4", undefined]) {
    const fx = scratch();
    const { res } = round(fx, block(rec("reject-approach", [o("methodology", "major")])), { "run-dir": runDirAt(fx.root, level) });
    assert.equal(res.level, null, String(level));
    assert.equal(res.action, "park", String(level));
  }
  assert.equal(srr.readLevel("/nonexistent/run/dir"), null);
});

test("route error: a reject-approach the router refuses parks with the route cause", () => {
  const d = srr.decideRound(inputs({ verdict: "reject-approach", objections: [o("nonlens", "major")], conformant: true }));
  assert.equal(d.action, "park");
  assert.equal(d.cause, "spec-review route failed (exit 2)");
});

// --- needs-human, outage (P23, P24, P40, P42–P44) ---

test("needs-human: parks with the lensed objections in the cause", () => {
  const fx = scratch();
  const { res } = round(fx, block(rec("needs-human", [o("infosec", "blocker"), o("QA", "major")])));
  assert.equal(res.action, "park");
  assert.equal(res.cause, "spec-review needs-human — infosec:blocker, QA:major");
});

test("needs-human no judge: needs-human parks directly even at L3–L4 autonomous", () => {
  const fx = scratch();
  const { res } = round(fx, block(rec("needs-human", [o("QA", "blocker")])), { "run-dir": runDirAt(fx.root, "L4") });
  assert.equal(res.action, "park");
});

test("unavailable routes: an autonomous unavailable round retries within the limit", () => {
  const fx = scratch();
  const { res } = round(fx, block(rec("unavailable", [o("QA", "major")])), { "retry-limit": 2 });
  assert.equal(res.action, "retry-outage");
  assert.equal(res.attempt, 1);
  assert.equal(res.retry_limit, 2);
});

test("interactive outage: an interactive unavailable round surfaces, never retries", () => {
  const fx = scratch();
  const { res } = round(fx, block(rec("unavailable", [o("QA", "major")])), { mode: "interactive" });
  assert.equal(res.action, "surface-outage");
  assert.deepEqual(res.outaged_lenses, ["QA"]);
});

test("outage retry count: the attempt counts trailing unavailable records above held_at_round", () => {
  const U = rec("unavailable", [o("QA", "major")]);
  const fx = scratch({ 1: REVISE_ARCH, 2: U, 3: U });
  const third = round(fx, block(U), { "retry-limit": 2 });
  assert.equal(third.res.attempt, 3);
  assert.equal(third.res.action, "hold-outage");
  // A resumed drain: the store's held_at_round 4 means only rounds above it count.
  const fx2 = scratch({ 1: U, 2: U, 3: U, 4: U });
  mkdirSync(join(fx2.root, ".faff", "resume", "FAFF-9001"), { recursive: true });
  writeFileSync(join(fx2.root, ".faff", "resume", "FAFF-9001", "spec-review-hold.json"), JSON.stringify({ outage_holds: 1, held_at_round: 4 }));
  const resumed = round(fx2, block(U), { "retry-limit": 2 });
  assert.equal(resumed.res.attempt, 1);
  assert.equal(resumed.res.action, "retry-outage");
});

test("outaged lenses: only the claim-less objections of an unavailable round are outaged", () => {
  const fx = scratch();
  const { res } = round(fx, block(rec("unavailable", [o("QA", "major"), o("architectural", "major", { claim: "served and objecting" })])));
  assert.deepEqual(res.outaged_lenses, ["QA"]);
});

// --- The cap (P26, P29, P30, P37, P38, P39) ---

test("cap by appetite: the limit is the appetite-scaled cap", () => {
  for (const [appetite, limit] of [["low", 1], ["medium", 3], ["high", 5], ["full", 10]]) {
    const fx = scratch();
    assert.equal(round(fx, block(REVISE_ARCH), { appetite }).res.cap.limit, limit, appetite);
  }
});

test("cap interactive park: at the cap without convergence an interactive round parks", () => {
  const fx = scratch({ 1: REVISE_ARCH });
  const { res } = round(fx, block(REVISE_ARCH), { appetite: "low", mode: "interactive" });
  assert.equal(res.action, "park");
  assert.equal(res.cause, "spec-review loop cap reached — revise");
});

test("interactive never judge: interactive never goes to the judge, even with an L4 run dir", () => {
  const fx = scratch({ 1: REVISE_ARCH });
  const { res } = round(fx, block(REVISE_ARCH), { appetite: "low", mode: "interactive", "run-dir": runDirAt(fx.root, "L4") });
  assert.equal(res.action, "park");
});

test("cap from disk: the cap counts loop rounds on disk, not unavailable or approve records", () => {
  const fx = scratch({ 1: REVISE_ARCH, 2: rec("unavailable", [o("architectural", "major")]) });
  const { res } = round(fx, block(REVISE_ARCH), { appetite: "medium" });
  assert.equal(res.cap.used, 2);
  assert.equal(res.action, "fix-and-rerun");
});

test("cap after unpark: loop rounds before the cap reset no longer count", () => {
  const fx = scratch({ 1: REVISE_ARCH, 2: REVISE_ARCH, 3: REVISE_ARCH }, { "cap-reset.json": { from_round: 4, reason: "human-unpark", after_decision: 3 } });
  const { res } = round(fx, block(REVISE_ARCH), { appetite: "low" });
  assert.equal(res.cap.from_round, 4);
  assert.equal(res.cap.used, 1);
});

test("ratified round not counted: a round marked ratified is excluded from the cap", () => {
  const fx = scratch({ 1: REVISE_ARCH }, { "decision-1.json": { action: "fix-and-rerun" } });
  const mark = cli(["spec-review", "round", "--mark-ratified", "1", "--comment-id", "c-123", "--dir", fx.dir, "--mode", "interactive", "--json"]);
  assert.equal(mark.code, 0, mark.stderr);
  assert.deepEqual(mark.res, { round: 1, ratified: true });
  assert.equal(readJson(join(fx.dir, "ratified-1.json")).comment_id, "c-123");
  const { res } = round(fx, block(REVISE_ARCH), { appetite: "low", mode: "interactive" });
  assert.equal(res.cap.used, 1);
});

test("ratify refused autonomous: --mark-ratified needs interactive mode, a comment id, a loop round and a recorded decision", () => {
  const fx = scratch({ 1: REVISE_ARCH, 2: rec("approve", []) }, { "decision-1.json": { action: "fix-and-rerun" }, "decision-2.json": { action: "approve" } });
  const base = ["spec-review", "round", "--dir", fx.dir, "--json"];
  assert.equal(cli([...base, "--mark-ratified", "1", "--comment-id", "c", "--mode", "autonomous"]).code, 2);
  assert.equal(cli([...base, "--mark-ratified", "1", "--mode", "interactive"]).code, 2);
  assert.equal(cli([...base, "--mark-ratified", "2", "--comment-id", "c", "--mode", "interactive"]).code, 2);
  const nodec = scratch({ 1: REVISE_ARCH });
  assert.equal(cli(["spec-review", "round", "--dir", nodec.dir, "--mark-ratified", "1", "--comment-id", "c", "--mode", "interactive"]).code, 2);
});

// --- Faults (§3 exit 2) ---

test("fault exits: usage, an unreadable verdict file and a corrupt window.json exit 2 with errored", () => {
  const fx = scratch();
  const missing = cli(["spec-review", "round", "--issue", "FAFF-9001", "--dir", fx.dir, "--verdict-file", join(fx.root, "nope.md"), "--mode", "autonomous", "--occupant", "single-pass", "--appetite", "high", "--json"]);
  assert.equal(missing.code, 2);
  assert.equal(missing.res.action, "errored");
  const corrupt = scratch({ 1: REVISE_ARCH }, { "window.json": "{ torn" });
  assert.equal(round(corrupt, block(REVISE_ARCH)).code, 2);
  const noMode = cli(["spec-review", "round", "--issue", "FAFF-9001", "--dir", fx.dir, "--verdict-file", "-", "--occupant", "single-pass", "--json"]);
  assert.equal(noMode.code, 2);
  const badIssue = round(scratch(), block(REVISE_ARCH), { issue: "../x" });
  assert.equal(badIssue.code, 2);
});

test("decision record: every round call writes decision-<n>.json with its RoundResult", () => {
  const fx = scratch();
  const { res } = round(fx, block(REVISE_ARCH));
  assert.deepEqual(readJson(join(fx.dir, "decision-1.json")), res);
});

test("text output: without --json one line names the action and round", () => {
  const fx = scratch();
  writeFileSync(join(fx.root, "out.md"), block(REVISE_ARCH));
  const r = cli(["spec-review", "round", "--issue", "FAFF-9001", "--dir", fx.dir, "--verdict-file", join(fx.root, "out.md"), "--mode", "autonomous", "--occupant", "single-pass", "--appetite", "high", "--root", fx.root]);
  assert.equal(r.stdout, "fix-and-rerun round 1\n");
});

// --- decideRound table (verdict × mode × level) ---

function inputs(contractData, over = {}) {
  const n = over.n ?? 1;
  const records = over.records ?? new Map([[n, { verdict: contractData.verdict, objections: contractData.objections }]]);
  return { n, records, windowStart: 1, capFrom: 1, ratified: new Set(), heldAtRound: 0, capLimit: 5, retryLimit: 2, mode: "autonomous", level: null, contractData, ...over };
}
const CD = (verdict, objections) => ({ verdict, objections, conformant: true, violations: [] });

test("decideRound table: every verdict × mode × level returns the §4.1 action", () => {
  const plateau = new Map([[1, { verdict: "revise", objections: [o("QA", "minor")] }], [2, { verdict: "revise", objections: [o("QA", "minor")] }]]);
  const cases = [
    // [verdict, objections, mode, level, records?, capLimit, want]
    ["approve", [], "interactive", null, null, 5, "approve"],
    ["approve", [], "autonomous", "L4", null, 5, "approve"],
    ["needs-human", [o("QA", "blocker")], "autonomous", "L3", null, 5, "park"],
    ["unavailable", [o("QA", "major")], "interactive", "L4", null, 5, "surface-outage"],
    ["unavailable", [o("QA", "major")], "autonomous", null, null, 5, "retry-outage"],
    ["unavailable", [o("QA", "major")], "autonomous", null, null, 5, "hold-outage", { retryLimit: 0 }],
    ["reject-approach", [o("methodology", "major")], "interactive", "L4", null, 5, "park"],
    ["reject-approach", [o("methodology", "major")], "autonomous", "L3", null, 5, "park"],
    ["reject-approach", [o("methodology", "major")], "autonomous", "L4", null, 5, "re-slice"],
    ["reject-approach", [o("QA", "major")], "autonomous", "L4", null, 5, "fix-and-rerun"],
    ["revise", [o("QA", "minor")], "interactive", null, null, 5, "fix-and-rerun"],
    ["revise", [o("QA", "minor")], "interactive", "L4", plateau, 1, "park"],
    ["revise", [o("QA", "minor")], "autonomous", null, plateau, 1, "park"],
    ["revise", [o("QA", "minor")], "autonomous", "L3", plateau, 1, "judge"],
    ["revise", [o("QA", "minor")], "autonomous", "L4", plateau, 1, "judge"],
  ];
  for (const [verdict, objections, mode, level, records, capLimit, want, over = {}] of cases) {
    const n = records ? 2 : 1;
    const d = srr.decideRound(inputs(CD(verdict, objections), { n, mode, level, capLimit, ...(records ? { records } : {}), ...over }));
    assert.equal(d.action, want, `${verdict} ${mode} ${level} cap ${capLimit}`);
  }
});

test("mode parity: interactive and autonomous decide identically except for outage and judge actions", () => {
  const verdicts = [["approve", []], ["needs-human", [o("QA", "major")]], ["revise", [o("QA", "minor")]], ["reject-approach", [o("methodology", "major")]]];
  for (const [v, objs] of verdicts) {
    const a = srr.decideRound(inputs(CD(v, objs), { mode: "interactive" }));
    const b = srr.decideRound(inputs(CD(v, objs), { mode: "autonomous" }));
    assert.deepEqual(a, b, v);
  }
});

test("park causes: every §4.3 round cause is produced as an exact string", () => {
  const causes = new Set();
  const add = (r) => { if (r.cause) causes.add(r.cause.replace(/ — .*| \d+: .*|; design-lens.*/, "")); };
  add(srr.decideRound(inputs(CD("needs-human", [o("QA", "major")]))));
  add(srr.decideRound(inputs(CD("reject-approach", [o("methodology", "major")]))));
  add(srr.decideRound(inputs(CD("reject-approach", [o("bogus", "major")]))));
  for (const want of ["spec-review needs-human", "spec-review reject-approach (methodology at major or above)", "spec-review route failed (exit 2)"]) {
    assert.ok([...causes].some((c) => c.startsWith(want)), `${want} in ${JSON.stringify([...causes])}`);
  }
  assert.equal(srr.CAUSE.contract1, "spec-review contract not satisfied (exit 1)");
  assert.equal(srr.CAUSE.contract2, "spec-review contract not satisfied (exit 2)");
});

// --- Corpus replay (§4.5) ---

test("corpus replay: every historical round re-records identically and churn and convergence match the standalone CLIs", () => {
  const dirs = readdirSync(CORPUS).sort();
  assert.ok(dirs.length >= 12, `need >= 12 corpus dirs, have ${dirs.length}`);
  const seen = { churn: false, cap: false, outage: false, plot: false };
  for (const name of dirs) {
    const src = join(CORPUS, name);
    const ns = readdirSync(src).map((f) => /^round-(\d+)\.json$/.exec(f)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
    for (const k of ns.filter((n) => n >= 2)) {
      const fx = scratch();
      for (const n of ns.filter((n) => n < k)) cpSync(join(src, `round-${n}.json`), join(fx.dir, `round-${n}.json`));
      let ws = 1;
      if (existsSync(join(src, "window.json"))) {
        const w = readJson(join(src, "window.json")).window_start;
        if (Number.isInteger(w) && w <= k) { cpSync(join(src, "window.json"), join(fx.dir, "window.json")); ws = w; }
      }
      const orig = readJson(join(src, `round-${k}.json`));
      const { code, res } = round(fx, block(orig), { appetite: "medium" });
      const where = `${name} round ${k}`;
      assert.equal(code, 0, where);
      assert.deepEqual(readJson(join(fx.dir, `round-${k}.json`)), orig, `${where}: written record`);
      if (res.churn !== null) {
        const prev = ns.filter((n) => n < k && n >= ws).pop();
        const c = cli(["spec-review-churn", "--prev", join(src, `round-${prev}.json`), "--curr", join(src, `round-${k}.json`)]);
        assert.deepEqual(res.churn, c.res, `${where}: churn`);
        if (res.churn.churn) seen.churn = true;
      }
      if (res.convergence !== null) {
        const c = cli(["spec-review-convergence", "--dir", fx.dir, "--window-start", String(ws)]);
        assert.deepEqual(res.convergence, c.res, `${where}: convergence`);
        seen.cap = true;
      }
      if (/outage/.test(res.action)) seen.outage = true;
      if (res.cause && res.cause.includes("faff-plot")) seen.plot = true;
    }
  }
  assert.deepEqual(seen, { churn: true, cap: true, outage: true, plot: true });
});
