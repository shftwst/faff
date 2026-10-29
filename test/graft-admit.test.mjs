// FAFF-1414 — `faff graft admit`: graft's Step 2 admission chain as one read-only command.
// Every case spawns the real CLI against a scratch root (its own config, run dir and, for the
// claim cases, a git repo holding local build-claim refs), so the dispositions, the exit-2
// causes and the decision-capture marker table are pinned through the shipped entrypoint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const require = createRequire(import.meta.url);
const { buildClaimStore } = require("../plugin/skills/faff/bin/lib/bundle.js");

const RUN_ID = "run-20260101-000000-graft-FAFF-901";
const NOW = "2026-10-29T12:00:00.000Z";

// An admissible spec (a scenario, concrete DONE items, a runnable check) and two variants.
const GOOD_SPEC = [
  "## Scenarios", "", "```", "Given a concrete spec", "When the gate evaluates it", "Then the verdict is admissible", "```", "",
  "## 8. DONE", "", "- [ ] `faff admissible` MUST emit the verdict JSON", "- [ ] exit code MUST be 0 admissible / 1 inadmissible", "",
  "**Integration smoke test.**", "```", "faff admissible --selftest", "```", "",
].join("\n");
const NO_SCENARIO_SPEC = ["## 8. DONE", "", "- [ ] `faff admissible` MUST emit the verdict JSON", ""].join("\n");
const NO_RUNNABLE_SPEC = GOOD_SPEC.split("**Integration smoke test.**")[0];

function scratch({ config = "", git = false, run = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-graft-admit-"));
  if (git) {
    spawnSync("git", ["-C", root, "init", "-q"]);
    spawnSync("git", ["-C", root, "config", "user.email", "faff-test@example.com"]);
    spawnSync("git", ["-C", root, "config", "user.name", "faff-test"]);
  }
  writeFileSync(join(root, ".faffrc.yaml"), "capture:\n  decision_kernel: on\n" + config);
  writeFileSync(join(root, "spec-good.md"), GOOD_SPEC);
  writeFileSync(join(root, "spec-no-scenario.md"), NO_SCENARIO_SPEC);
  writeFileSync(join(root, "spec-no-runnable.md"), NO_RUNNABLE_SPEC);
  const runDir = join(root, ".faff", "runs", RUN_ID);
  if (run) {
    mkdirSync(runDir, { recursive: true });
    const g = cli(root, ["events", "append", "--run", RUN_ID, "--ts", "2026-01-01T00:00:00Z", "--root", root], {}, JSON.stringify({ phase: "run", type: "run-start" }));
    assert.equal(g.code, 0, g.err);
  }
  return { root, runDir };
}

function cli(root, args, env = {}, input = "") {
  const base = { ...process.env };
  delete base.FAFF_RUN_DIR;
  delete base.FAFF_SESSION_ID;
  delete base.FAFF_DECISION_CORRELATION_ID;
  delete base.FAFF_DECISION_ISSUE;
  const r = spawnSync("node", [CLI, ...args], { cwd: root, encoding: "utf8", input, env: { ...base, ...env } });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function facts(over = {}) {
  return {
    issue: "FAFF-901",
    status: "todo",
    labels: ["faff-automate"],
    spec: { found: true, confidence: "high" },
    externally_blocked: false,
    claimed_at: null,
    tracker: { mode: "tracker", configured: true, pinned: false, reachable: true },
    ...over,
  };
}

// Run `graft admit` with a facts object written to a file; --json always, --root always.
function admit(root, mode, f, { specFile = "spec-good.md", runDir = true, extra = [], env = {}, now = NOW } = {}) {
  const factsPath = join(root, "facts.json");
  writeFileSync(factsPath, typeof f === "string" ? f : JSON.stringify(f));
  const args = ["graft", "admit", "--json", "--root", root, "--now", now, "--facts", factsPath];
  if (mode) args.push("--mode", mode);
  if (specFile) args.push("--spec-file", join(root, specFile));
  if (runDir) args.push("--run-dir", join(root, ".faff", "runs", RUN_ID));
  args.push(...extra);
  const r = cli(root, args, env);
  let json = null;
  try { json = JSON.parse(r.out); } catch { /* exit-2 text paths */ }
  return { ...r, json };
}

function events(runDir) {
  const p = join(runDir, "events.jsonl");
  return readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
}
const bases = (runDir) => events(runDir).filter((e) => e.type === "decision-capture");
const markers = (runDir) => events(runDir).filter((e) => e.type === "decision-capture-action");
const markerFor = (runDir, kernel) => markers(runDir).filter((m) => m.data.kernel === kernel).map((m) => m.data.selected_action);

// Plant a build-claim ref the way acquire writes it. heartbeating:false judges staleness by the
// claim_ttl_hours age, so `--now` decides live versus stale.
function plantClaim(root, issue, sessionId) {
  const store = buildClaimStore(root);
  const r = store.acquire({ issue }, { status: "running", epoch: 1, session_id: sessionId, pid: 1, started_at: new Date().toISOString(), last_heartbeat: new Date().toISOString(), machine_id: "M-test", heartbeating: false });
  assert.equal(r.acquired, true, JSON.stringify(r));
  return r;
}

// ---------------------------------------------------------------------------
// Exit 2: inputs the command cannot establish.
// ---------------------------------------------------------------------------

test("unreachable tracker: configured or pinned but not reachable exits 2 with tracker-unreachable", () => {
  const { root } = scratch();
  const a = admit(root, "autonomous", facts({ tracker: { mode: "tracker", configured: true, pinned: false, reachable: false } }));
  assert.equal(a.code, 2);
  assert.equal(a.json.reason, "tracker-unreachable");
  const b = admit(root, "interactive", facts({ tracker: { mode: "tracker", configured: false, pinned: true, reachable: false } }));
  assert.equal(b.code, 2);
  assert.equal(b.json.reason, "tracker-unreachable");
});

test("malformed facts exit 2: not JSON, a missing field, a bad status, an unsafe issue id", () => {
  const { root } = scratch();
  for (const bad of ["{not json", JSON.stringify({ ...facts(), externally_blocked: undefined }), JSON.stringify(facts({ status: "doing" })), JSON.stringify(facts({ issue: "../../etc/passwd" })), JSON.stringify(facts({ claimed_at: "yesterday" }))]) {
    const r = admit(root, "autonomous", bad);
    assert.equal(r.code, 2, bad);
    assert.equal(r.json.reason, "facts-invalid", bad);
  }
});

test("--mode is required and must be interactive or autonomous", () => {
  const { root } = scratch();
  assert.equal(admit(root, null, facts()).code, 2);
  assert.equal(admit(root, "lights-out", facts()).code, 2);
});

test("missing spec file: autonomous with a found spec and no readable --spec-file exits 2", () => {
  const { root } = scratch();
  const a = admit(root, "autonomous", facts(), { specFile: null });
  assert.equal(a.code, 2);
  assert.equal(a.json.reason, "spec-file-unreadable");
  const b = admit(root, "autonomous", facts(), { specFile: "nope.md" });
  assert.equal(b.code, 2);
  assert.equal(b.json.reason, "spec-file-unreadable");
});

test("claim store unavailable exit 2: a claim status whose store cannot be reached is never claimed-by-peer", () => {
  // bundle_store: git-remote with no origin remote: the ref read cannot reach the store.
  const { root } = scratch({ config: "bundle_store: git-remote\n", git: true });
  const r = admit(root, "autonomous", facts({ status: "in-review" }));
  assert.equal(r.code, 2);
  assert.equal(r.json.reason, "claim-store-unavailable");
});

// ---------------------------------------------------------------------------
// next's routing, as dispositions.
// ---------------------------------------------------------------------------

test("no spec → needs-prep", () => {
  const { root } = scratch();
  const r = admit(root, "autonomous", facts({ status: "backlog", spec: { found: false, confidence: "none" } }));
  assert.equal(r.code, 0);
  assert.equal(r.json.disposition, "needs-prep");
});

test("next routing per step: medium → needs-human with next's reason; external blocker → excluded blocked; parked → needs-human; awaiting spec review → needs-prep", () => {
  const { root } = scratch();
  const medium = admit(root, "autonomous", facts({ spec: { found: true, confidence: "medium" } }));
  assert.equal(medium.json.disposition, "needs-human");
  assert.equal(medium.json.reason, "needs-decision-first (medium spec)");
  const blocked = admit(root, "autonomous", facts({ externally_blocked: true }));
  assert.equal(blocked.json.disposition, "excluded");
  assert.equal(blocked.json.reason, "blocked");
  const parked = admit(root, "autonomous", facts({ labels: ["faff-automate", "faff-parked"] }));
  assert.equal(parked.json.disposition, "needs-human");
  const held = admit(root, "autonomous", facts({ status: "backlog", labels: ["faff-automate", "faff-awaiting-spec-review"] }));
  assert.equal(held.json.disposition, "needs-prep");
});

test("terminal and ineligible: a done issue without faff-automate is excluded, never ineligible", () => {
  const { root, runDir } = scratch();
  const r = admit(root, "autonomous", facts({ status: "done", labels: [] }));
  assert.equal(r.json.disposition, "excluded");
  assert.equal(r.json.reason, "done");
  assert.deepEqual(markerFor(runDir, "next"), ["done"]);
});

// ---------------------------------------------------------------------------
// Eligibility and intake.
// ---------------------------------------------------------------------------

test("autonomous ineligible records next skip-ineligible", () => {
  const { root, runDir } = scratch();
  const r = admit(root, "autonomous", facts({ labels: ["faff"] }));
  assert.equal(r.json.disposition, "ineligible");
  const next = bases(runDir).find((b) => b.data.kernel === "next");
  assert.equal(next.data.verdict, "skip-ineligible");
  assert.deepEqual(markerFor(runDir, "next"), ["skip-ineligible"]);
  assert.deepEqual(markerFor(runDir, "eligible"), ["ineligible"]);
});

test("intake_gate block with no marker and no faff-automate is ineligible, because eligibility is checked before intake", () => {
  const { root } = scratch({ config: "intake_gate: block\n" });
  const r = admit(root, "autonomous", facts({ labels: [] }));
  assert.equal(r.json.disposition, "ineligible");
});

test("eligible issue never intake-blocked: an eligible autonomous issue under intake_gate block with no marker proceeds", () => {
  const { root } = scratch({ config: "intake_gate: block\n" });
  const r = admit(root, "autonomous", facts());
  assert.equal(r.json.disposition, "proceed");
  assert.equal(r.json.kernels.intake.basis, "eligibility-gesture");
});

test("intake_gate off: the guard reports gate-off and proceeds", () => {
  const { root } = scratch({ config: "intake_gate: off\n" });
  const r = admit(root, "autonomous", facts());
  assert.equal(r.json.disposition, "proceed");
  assert.equal(r.json.kernels.intake.basis, "gate-off");
});

test("intake warn: an interactive ineligible issue with no provenance warns under intake_gate warn", () => {
  const { root } = scratch();
  const r = admit(root, "interactive", facts({ labels: [] }));
  assert.equal(r.json.disposition, "proceed");
  assert.ok(r.json.warnings.some((w) => /intake: no intake provenance/.test(w)), JSON.stringify(r.json.warnings));
});

test("interactive intake bypass: under intake_gate block an interactive ineligible issue with no marker proceeds with a warning", () => {
  const { root } = scratch({ config: "intake_gate: block\n" });
  const r = admit(root, "interactive", facts({ labels: [] }));
  assert.equal(r.json.disposition, "proceed");
  assert.ok(r.json.warnings.some((w) => /human at the keyboard/.test(w)));
});

test("malformed marker warns: a malformed provenance marker with another basis satisfied is a warning, not a refusal", () => {
  const { root } = scratch({ config: "intake_gate: block\n" });
  mkdirSync(join(root, ".faff", "provenance"), { recursive: true });
  writeFileSync(join(root, ".faff", "provenance", "FAFF-901.json"), "{torn");
  const r = admit(root, "autonomous", facts());
  assert.equal(r.json.disposition, "proceed");
  assert.ok(r.json.warnings.some((w) => /malformed/.test(w)));
});

test("interactive ineligible proceeds with a warning naming the missing eligibility label", () => {
  const { root } = scratch();
  const r = admit(root, "interactive", facts({ labels: ["faff"] }));
  assert.equal(r.json.disposition, "proceed");
  assert.ok(r.json.warnings.some((w) => /not automation-eligible \(no faff-automate\)/.test(w)));
});

test("custom prefix: under label_prefix sd, sd-automate is eligible and the intake guard sees the same label", () => {
  const { root } = scratch({ config: "intake_gate: block\ntracking:\n  label_prefix: sd\n" });
  const r = admit(root, "autonomous", facts({ labels: ["sd-automate"] }));
  assert.equal(r.json.disposition, "proceed");
  assert.equal(r.json.kernels.intake.basis, "eligibility-gesture");
  const stale = admit(root, "autonomous", facts({ labels: ["faff-automate"] }));
  assert.equal(stale.json.disposition, "ineligible", "the default-prefix literal does not satisfy a custom prefix");
});

test("automate-name override: a renamed automate label is eligible, the intake guard sees it, and the stale default literal does not satisfy", () => {
  const { root } = scratch({ config: "intake_gate: block\ntracking:\n  control_labels:\n    automate: \"Pipeline: eligible\"\n" });
  const r = admit(root, "autonomous", facts({ labels: ["Pipeline: eligible"] }));
  assert.equal(r.json.disposition, "proceed", r.err);
  assert.equal(r.json.kernels.intake.basis, "eligibility-gesture");
  const old = admit(root, "autonomous", facts({ labels: ["faff-automate"] }));
  assert.equal(old.json.disposition, "ineligible");
});

test("comma in label: labels arrive as a JSON array, so a label containing a comma survives intact", () => {
  const { root, runDir } = scratch();
  const r = admit(root, "autonomous", facts({ labels: ["faff-automate", "area: a,b"] }));
  assert.equal(r.json.disposition, "proceed");
  const eligible = bases(runDir).find((b) => b.data.kernel === "eligible");
  assert.deepEqual(eligible.data.normalised_inputs.labels, ["faff-automate", "area: a,b"]);
});

// ---------------------------------------------------------------------------
// Admissibility.
// ---------------------------------------------------------------------------

test("inadmissible: an autonomous spec the lights-out floor refuses is inadmissible, and the next base verdict is graft", () => {
  const { root, runDir } = scratch();
  const r = admit(root, "autonomous", facts(), { specFile: "spec-no-scenario.md" });
  assert.equal(r.json.disposition, "inadmissible");
  assert.match(r.json.reason, /scenario/);
  const next = bases(runDir).find((b) => b.data.kernel === "next");
  assert.equal(next.data.verdict, "graft");
  assert.deepEqual(markerFor(runDir, "next"), ["none"]);
  assert.deepEqual(markerFor(runDir, "eligible"), []);
});

test("admissible warnings pass: R3 advisory warnings surface and never gate", () => {
  const { root } = scratch();
  const r = admit(root, "autonomous", facts(), { specFile: "spec-no-runnable.md" });
  assert.equal(r.json.disposition, "proceed");
  assert.ok(r.json.warnings.some((w) => /R3 advisory/.test(w)), JSON.stringify(r.json.warnings));
});

test("interactive skips admissibility: an inadmissible spec still proceeds interactively", () => {
  const { root } = scratch();
  const r = admit(root, "interactive", facts(), { specFile: "spec-no-scenario.md" });
  assert.equal(r.json.disposition, "proceed");
  assert.equal(r.json.kernels.admissible, null);
});

// ---------------------------------------------------------------------------
// The claim check.
// ---------------------------------------------------------------------------

test("in-review peer: an autonomous In Review issue with no build-claim ref is claimed-by-peer, with a next marker none and no eligible marker", () => {
  const { root, runDir } = scratch({ git: true });
  const r = admit(root, "autonomous", facts({ status: "in-review" }));
  assert.equal(r.json.disposition, "claimed-by-peer");
  assert.equal(r.json.kernels.claim.ref, "missing");
  assert.deepEqual(markerFor(runDir, "next"), ["none"]);
  assert.deepEqual(markerFor(runDir, "eligible"), []);
});

test("in-progress peer (in-progress no ref): an autonomous In Progress issue with no ref is claimed-by-peer", () => {
  const { root } = scratch({ git: true });
  const r = admit(root, "autonomous", facts({ status: "in-progress" }));
  assert.equal(r.json.disposition, "claimed-by-peer");
});

test("claimed-by-peer emits no eligible marker: a non-eligibility skip writes the eligible base record but no eligible marker", () => {
  const { root, runDir } = scratch({ git: true });
  const r = admit(root, "autonomous", facts({ status: "in-progress" }));
  assert.equal(r.json.disposition, "claimed-by-peer");
  assert.equal(bases(runDir).filter((b) => b.data.kernel === "eligible").length, 1);
  assert.deepEqual(markerFor(runDir, "eligible"), []);
  assert.deepEqual(markerFor(runDir, "next"), ["none"]);
});

test("own claim proceeds: a ref whose owner.session_id equals --session-id is the caller's own", () => {
  const { root } = scratch({ git: true });
  plantClaim(root, "FAFF-901", "sess-mine");
  const r = admit(root, "autonomous", facts({ status: "in-review" }), { extra: ["--session-id", "sess-mine"] });
  assert.equal(r.json.disposition, "proceed");
  assert.equal(r.json.kernels.claim.own, true);
});

test("own claim from the environment: --session-id defaults to $FAFF_SESSION_ID", () => {
  const { root } = scratch({ git: true });
  plantClaim(root, "FAFF-901", "sess-env");
  const r = admit(root, "autonomous", facts({ status: "in-progress" }), { env: { FAFF_SESSION_ID: "sess-env" } });
  assert.equal(r.json.disposition, "proceed");
});

test("own claim from the run dir: with no session id set, the run dir's basename is the caller's identity, as acquire stamps it", () => {
  const { root, runDir } = scratch({ git: true });
  plantClaim(root, "FAFF-901", RUN_ID);
  const r = admit(root, "autonomous", facts({ status: "in-progress" }), { runDir: false, env: { FAFF_RUN_DIR: runDir } });
  assert.equal(r.json.disposition, "proceed", r.out);
  assert.equal(r.json.kernels.claim.own, true);
});

test("live peer ref: a live ref held by another session is claimed-by-peer", () => {
  const { root } = scratch({ git: true });
  plantClaim(root, "FAFF-901", "sess-peer");
  const r = admit(root, "autonomous", facts({ status: "in-progress" }), { extra: ["--session-id", "sess-mine"], now: new Date().toISOString() });
  assert.equal(r.json.disposition, "claimed-by-peer");
  assert.equal(r.json.kernels.claim.stale, false);
});

test("stale ref proceeds: a peer's ref that buildClaimStaleAware judges stale is proceed with a warning", () => {
  const { root } = scratch({ git: true });
  plantClaim(root, "FAFF-901", "sess-peer");
  const r = admit(root, "autonomous", facts({ status: "in-progress" }), { extra: ["--session-id", "sess-mine"], now: "2099-01-01T00:00:00.000Z" });
  assert.equal(r.json.disposition, "proceed");
  assert.equal(r.json.kernels.claim.stale, true);
  assert.ok(r.json.warnings.some((w) => /stale build claim held by sess-peer; Step 5's acquire reclaims it/.test(w)));
});

test("interactive peer warns and proceeds: a live ref held by another session only warns interactively", () => {
  const { root } = scratch({ git: true });
  plantClaim(root, "FAFF-901", "sess-peer");
  const r = admit(root, "interactive", facts({ status: "in-progress" }), { extra: ["--session-id", "sess-mine"], now: new Date().toISOString() });
  assert.equal(r.json.disposition, "proceed");
  assert.ok(r.json.warnings.some((w) => /held by another claimant \(sess-peer\)/.test(w)));
});

test("ordering: claim before prep — an In Review issue with no spec is claimed-by-peer, not needs-prep", () => {
  const { root, runDir } = scratch({ git: true });
  const r = admit(root, "autonomous", facts({ status: "in-review", spec: { found: false, confidence: "none" } }));
  assert.equal(r.json.disposition, "claimed-by-peer");
  assert.equal(bases(runDir).find((b) => b.data.kernel === "next").data.verdict, "prep");
});

test("claim-verdict is consulted when claimed_at is present on a claim status, reported under kernels.claim.ttl, and never changes the disposition", () => {
  const { root, runDir } = scratch({ git: true });
  const r = admit(root, "autonomous", facts({ status: "in-review", claimed_at: "2026-10-01T00:00:00.000Z" }));
  assert.equal(r.json.disposition, "claimed-by-peer");
  assert.equal(r.json.kernels.claim.ttl.verdict, "stale");
  assert.deepEqual(markerFor(runDir, "claim-verdict"), ["claimed-by-peer"]);
  // A Todo proceed writes no claim-verdict record, whatever claimed_at says.
  const { root: r2, runDir: d2 } = scratch({ git: true });
  const p = admit(r2, "autonomous", facts({ claimed_at: "2026-10-01T00:00:00.000Z" }));
  assert.equal(p.json.disposition, "proceed");
  assert.equal(p.json.kernels.claim, null);
  assert.equal(bases(d2).filter((b) => b.data.kernel === "claim-verdict").length, 0);
});

// ---------------------------------------------------------------------------
// Decision capture.
// ---------------------------------------------------------------------------

test("marker per disposition: proceed marks next graft and eligible eligible, and every marker shares its base record's correlation id", () => {
  const { root, runDir } = scratch();
  const r = admit(root, "autonomous", facts());
  assert.equal(r.json.disposition, "proceed");
  assert.deepEqual(markerFor(runDir, "next"), ["graft"]);
  assert.deepEqual(markerFor(runDir, "eligible"), ["eligible"]);
  const baseIds = new Set(bases(runDir).map((b) => b.data.correlation_id));
  for (const m of markers(runDir)) assert.ok(baseIds.has(m.data.correlation_id), m.data.correlation_id);
  assert.deepEqual([...baseIds].sort(), [`${RUN_ID}/FAFF-901/eligible/1`, `${RUN_ID}/FAFF-901/next/1`]);
});

test("marker per disposition: needs-prep marks next prep, and a second call mints the next consult ordinal", () => {
  const { root, runDir } = scratch();
  admit(root, "autonomous", facts({ status: "backlog", spec: { found: false, confidence: "none" } }));
  admit(root, "autonomous", facts({ status: "backlog", spec: { found: false, confidence: "none" } }));
  assert.deepEqual(markerFor(runDir, "next"), ["prep", "prep"]);
  assert.deepEqual(markers(runDir).filter((m) => m.data.kernel === "next").map((m) => m.data.correlation_id), [`${RUN_ID}/FAFF-901/next/1`, `${RUN_ID}/FAFF-901/next/2`]);
});

test("base records carry kernel inputs: next records all seven nextStep keys, eligible the normalised labels", () => {
  const { root, runDir } = scratch();
  admit(root, "interactive", facts());
  const next = bases(runDir).find((b) => b.data.kernel === "next");
  assert.deepEqual(Object.keys(next.data.normalised_inputs).sort(), ["awaitingSpecReview", "blocked", "eligible", "ifEligible", "parked", "spec", "status"]);
  assert.equal(next.data.normalised_inputs.ifEligible, true);
  assert.equal(next.data.coverage, "replayable");
  const eligible = bases(runDir).find((b) => b.data.kernel === "eligible");
  assert.deepEqual(eligible.data.normalised_inputs, { labels: ["faff-automate"], automationDefault: "opt-in", trackerPresent: true });
});

test("no run dir, no capture: without --run-dir or $FAFF_RUN_DIR nothing is written", () => {
  const { root, runDir } = scratch();
  const before = events(runDir).length;
  const r = admit(root, "autonomous", facts(), { runDir: false });
  assert.equal(r.json.disposition, "proceed");
  assert.equal(events(runDir).length, before);
  assert.equal(existsSync(join(root, ".faff", "logs", "decision-capture.jsonl")), false);
});

test("no tracker or label writes (no writes): the command writes no provenance marker, no claim ref and no prep marker", () => {
  const { root } = scratch({ git: true });
  admit(root, "autonomous", facts({ status: "in-review" }));
  admit(root, "autonomous", facts());
  assert.equal(existsSync(join(root, ".faff", "provenance")), false);
  const refs = spawnSync("git", ["-C", root, "for-each-ref", "refs/faff"], { encoding: "utf8" }).stdout.trim();
  assert.equal(refs, "");
  const prep = existsSync(join(root, ".faff", "prep")) ? readdirSync(join(root, ".faff", "prep")) : [];
  assert.deepEqual(prep, []);
});

test("text mode prints one summary line and the warnings", () => {
  const { root } = scratch();
  writeFileSync(join(root, "facts.json"), JSON.stringify(facts({ labels: [] })));
  const r = cli(root, ["graft", "admit", "--mode", "interactive", "--facts", join(root, "facts.json"), "--root", root, "--now", NOW]);
  assert.equal(r.code, 0, r.err);
  const lines = r.out.split("\n");
  assert.equal(lines[0], "FAFF-901: proceed (build-eligible)");
  assert.ok(lines.slice(1).every((l) => l.startsWith("[warn] ")));
});

test("facts from stdin: --facts - reads the object from standard input", () => {
  const { root } = scratch();
  const r = cli(root, ["graft", "admit", "--json", "--mode", "autonomous", "--facts", "-", "--spec-file", join(root, "spec-good.md"), "--root", root, "--now", NOW], {}, JSON.stringify(facts()));
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).disposition, "proceed");
});

test("fail closed on a corrupt config: a control-label map that is not a map exits 2 with config-invalid, never a guessed label", () => {
  const { root } = scratch({ config: "tracking:\n  control_labels:\n    - parked\n" });
  const r = admit(root, "autonomous", facts());
  assert.equal(r.code, 2, r.err);
  assert.equal(r.json.reason, "config-invalid");
  assert.equal(r.json.disposition, null);
});

test("--wave pins every base record and its marker to that wave", () => {
  const { root, runDir } = scratch();
  admit(root, "autonomous", facts(), { extra: ["--wave", "7"] });
  const ids = bases(runDir).map((b) => b.data.correlation_id).sort();
  assert.deepEqual(ids, [`${RUN_ID}/FAFF-901/eligible/7`, `${RUN_ID}/FAFF-901/next/7`]);
  assert.deepEqual(markers(runDir).map((m) => m.data.correlation_id).sort(), ids);
});

test("eligible capture parity: graft admit's eligible base record has the same inputs and verdict faff eligible records", () => {
  const { root, runDir } = scratch();
  admit(root, "autonomous", facts({ labels: ["faff-automate", "x"] }));
  const mine = bases(runDir).find((b) => b.data.kernel === "eligible");
  const r = cli(root, ["eligible", "--label", "faff-automate", "--label", "x", "--root", root],
    { FAFF_RUN_DIR: runDir, FAFF_DECISION_CORRELATION_ID: `${RUN_ID}/FAFF-901/eligible/99`, FAFF_DECISION_ISSUE: "FAFF-901" });
  assert.equal(r.code, 0, r.err);
  const theirs = bases(runDir).find((b) => b.data.kernel === "eligible" && b.data.correlation_id.endsWith("/99"));
  assert.deepEqual(mine.data.normalised_inputs, theirs.data.normalised_inputs);
  assert.deepEqual(mine.data.verdict, theirs.data.verdict);
  assert.equal(mine.data.kernel_version, theirs.data.kernel_version);
});
