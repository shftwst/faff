// FAFF-539 — `faff self-intake`: the mechanical same-repo/team gate on the FAFF-536
// `outward → outward-self-intake` reclassification (ADR-0079). The SELF side is
// re-derived from committed config by the CLI itself (no --self flag — the exact
// forgeable seam this primitive closes); the TARGET side is caller-supplied on the
// FAFF-354 trust boundary (bound by --record, recomputed by `faff audit`).
// Exercises the CLI end-to-end with fixture rc files (lane on/off, one-sided self,
// record + audit round-trip), like contain.test.mjs. Every fixture spawns with cwd
// pointed at its own tmp root (findRoot stops at the fixture's .faff dir), never
// the real repo's config or run history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function runIn(cwd, ...args) {
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

// A fixture repo root: its own .faff dir (findRoot anchor) + an optional .faffrc.yaml.
function fixtureRoot(rc = null, { runId = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-self-intake-"));
  mkdirSync(join(root, ".faff"), { recursive: true });
  if (rc !== null) writeFileSync(join(root, ".faffrc.yaml"), rc);
  if (runId !== null) mkdirSync(join(root, ".faff", "runs", runId), { recursive: true });
  return root;
}

const RC_LANE_ON_REPO = "containment:\n  self_hosting_intake: true\ntracking:\n  repo: acme/app\n";
const RC_LANE_ON_BOTH = "containment:\n  self_hosting_intake: true\ntracking:\n  team_key: FAFF\n  repo: acme/app\n";
const RC_LANE_OFF_EXPLICIT = "containment:\n  self_hosting_intake: false\ntracking:\n  repo: acme/app\n";

test("self-intake --selftest passes (the decision table)", () => {
  const r = runIn(fixtureRoot(), "self-intake", "--selftest");
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

// --- the ratified critical: verified, not asserted ---

test("lane on + repo-match → exit 0, reclassification honoured", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO);
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":null,"repo":"acme/app"}');
  assert.equal(r.code, 0);
  assert.match(r.out, /self: repo-match — reclassification honoured/);
});

test("lane on + team-match (one-sided target) → exit 0", () => {
  const root = fixtureRoot(RC_LANE_ON_BOTH);
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":"FAFF","repo":null}');
  assert.equal(r.code, 0);
  assert.match(r.out, /self: team-match/);
});

test("a target that does not resolve to the config's team/repo stays not-self (mismatch), exit 3", () => {
  const root = fixtureRoot(RC_LANE_ON_BOTH);
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":"OTHER","repo":"other/app"}');
  assert.equal(r.code, 3);
  assert.match(r.out, /not-self: mismatch — outward stands/);
});

test("lane unset (registry default false) → lane-off even on a perfect match — asserting 'the lane is on' cannot make it so", () => {
  const root = fixtureRoot("tracking:\n  team_key: FAFF\n  repo: acme/app\n");
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":"FAFF","repo":"acme/app"}');
  assert.equal(r.code, 3);
  assert.match(r.out, /not-self: lane-off/);
});

test("lane explicitly false → lane-off, exit 3", () => {
  const root = fixtureRoot(RC_LANE_OFF_EXPLICIT);
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":null,"repo":"acme/app"}');
  assert.equal(r.code, 3);
  assert.match(r.out, /lane-off/);
});

test("lane as the quoted string \"true\" also reads as on (config-get parity)", () => {
  const root = fixtureRoot('containment:\n  self_hosting_intake: "true"\ntracking:\n  repo: acme/app\n');
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":null,"repo":"acme/app"}');
  assert.equal(r.code, 0);
});

test("lane on but both self leaves unset → unresolved-self (two null sides never match)", () => {
  const root = fixtureRoot("containment:\n  self_hosting_intake: true\n");
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":"FAFF","repo":"acme/app"}');
  assert.equal(r.code, 3);
  assert.match(r.out, /unresolved-self/);
});

test("empty-string config leaves coerce to null (never an empty-string match)", () => {
  const root = fixtureRoot('containment:\n  self_hosting_intake: true\ntracking:\n  team_key: ""\n  repo: ""\n');
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":"","repo":""}');
  assert.equal(r.code, 3);
  // target empties coerce first → unresolved-target (rung 3 precedes rung 4)
  assert.match(r.out, /unresolved-target/);
});

test("all-null target → unresolved-target, exit 3", () => {
  const root = fixtureRoot(RC_LANE_ON_BOTH);
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":null,"repo":null}');
  assert.equal(r.code, 3);
  assert.match(r.out, /unresolved-target/);
});

test("case-mismatched repo slug fails toward not-self (strict ===)", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO);
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":null,"repo":"Acme/App"}');
  assert.equal(r.code, 3);
  assert.match(r.out, /mismatch/);
});

// --- surface: flags, JSON, usage ---

test("--json emits { mandate, target, self, verdict, reason } with normalized values", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO);
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":42,"repo":"acme/app"}', "--json");
  assert.equal(r.code, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.mandate, "M-1");
  assert.deepEqual(j.target, { team: null, repo: "acme/app" }); // wrong-typed team null-coerced
  assert.deepEqual(j.self, { team: null, repo: "acme/app", lane_on: true });
  assert.equal(j.verdict, "self");
  assert.equal(j.reason, "repo-match");
});

test("no --self flag exists — it is rejected by name, exit 2, and never read", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO);
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":null,"repo":"other/app"}', "--self", '{"repo":"other/app"}');
  assert.equal(r.code, 2);
  assert.match(r.err, /no --self flag/);
});

test("malformed --target: unparseable JSON → exit 2 usage", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO);
  const r = runIn(root, "self-intake", "M-1", "--target", "not json");
  assert.equal(r.code, 2);
  assert.match(r.err, /--target is not a valid JSON object/);
});

test("malformed --target: array and non-object → exit 2", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO);
  assert.equal(runIn(root, "self-intake", "M-1", "--target", "[1,2]").code, 2);
  assert.equal(runIn(root, "self-intake", "M-1", "--target", '"str"').code, 2);
  assert.equal(runIn(root, "self-intake", "M-1", "--target", "null").code, 2);
});

test("wrong-typed fields inside a well-formed object null-coerce and the ladder proceeds", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO);
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":42,"repo":["acme/app"]}');
  assert.equal(r.code, 3);
  assert.match(r.out, /unresolved-target/);
});

test("missing mandate or missing --target → exit 2 with a usage line", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO);
  const noMandate = runIn(root, "self-intake", "--target", "{}");
  assert.equal(noMandate.code, 2);
  assert.match(noMandate.err, /usage/);
  const noTarget = runIn(root, "self-intake", "M-1");
  assert.equal(noTarget.code, 2);
  assert.match(noTarget.err, /usage/);
});

test("--phase without --record → exit 2 (contain's rule)", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO);
  const r = runIn(root, "self-intake", "M-1", "--target", "{}", "--phase", "tidy");
  assert.equal(r.code, 2);
  assert.match(r.err, /--phase only makes sense alongside --record/);
});

test("--phase outside the EVENT_PHASES vocabulary → exit 2", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO, { runId: "r1" });
  const r = runIn(root, "self-intake", "M-1", "--target", "{}", "--record", "r1", "--phase", "bogus");
  assert.equal(r.code, 2);
});

test("config parse failure is a LOUD exit 2 — never a mislabelled not-self", () => {
  const root = fixtureRoot("- a top-level sequence\n- is not a config mapping\n");
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":null,"repo":"acme/app"}');
  assert.equal(r.code, 2);
  assert.match(r.err, /config/i);
  assert.doesNotMatch(r.out, /not-self/);
});

// --- recording (--record) + audit recompute round-trip ---

test("--record with a missing run dir → exit 2 BEFORE any verdict (never silently unrecorded)", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO);
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":null,"repo":"acme/app"}', "--record", "no-such-run");
  assert.equal(r.code, 2);
  assert.match(r.err, /run dir missing/);
  assert.doesNotMatch(r.out, /self:|not-self:/);
});

test("--record rejects a traversal-shaped run-id, exit 2", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO, { runId: "r1" });
  const r = runIn(root, "self-intake", "M-1", "--target", "{}", "--record", "../evil");
  assert.equal(r.code, 2);
});

test("--record appends exactly one eventViolations-clean self-intake-check event with the exact target_raw + config snapshot; faff audit recompute agrees", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO, { runId: "r1" });
  writeFileSync(join(root, ".faff", "runs", "r1", "run-ledger.json"),
    JSON.stringify({ run_id: "r1", admitted: [], outcomes: {}, discovered_scope_filed: 0 }));
  const targetRaw = '{"team":null,"repo":"acme/app"}';
  const r = runIn(root, "self-intake", "M-1", "--target", targetRaw, "--record", "r1", "--phase", "run", "--json");
  assert.equal(r.code, 0);

  const lines = readFileSync(join(root, ".faff", "runs", "r1", "events.jsonl"), "utf8")
    .split("\n").filter((l) => l.trim() !== "");
  assert.equal(lines.length, 1);
  const ev = JSON.parse(lines[0]);
  assert.equal(ev.type, "self-intake-check");
  assert.equal(ev.issue, "M-1");
  assert.equal(ev.phase, "run");
  assert.equal(ev.data.target_raw, targetRaw); // the EXACT --target string
  assert.deepEqual(ev.data.self, { team: null, repo: "acme/app", lane_on: true });
  assert.equal(ev.data.verdict, "self");
  assert.equal(ev.data.reason, "repo-match");
  assert.equal(ev.data.exit, 0);

  // the recorded line validates as a full envelope record
  const v = runIn(root, "events", "validate", "--file", join(root, ".faff", "runs", "r1", "events.jsonl"));
  assert.equal(v.code, 0);

  // audit recomputes from the recorded target_raw + self snapshot and agrees
  const a = runIn(root, "audit", "r1", "--json");
  assert.equal(a.code, 0);
  const recon = JSON.parse(a.out);
  assert.equal(recon.coherence.self_intake_mismatches.length, 0);
  assert.equal(recon.coherence.clean, true);
});

test("a hand-edited verdict in a recorded self-intake-check event is reported by faff audit as a coherence mismatch", () => {
  const root = fixtureRoot(RC_LANE_ON_REPO, { runId: "r1" });
  writeFileSync(join(root, ".faff", "runs", "r1", "run-ledger.json"),
    JSON.stringify({ run_id: "r1", admitted: [], outcomes: {}, discovered_scope_filed: 0 }));
  const r = runIn(root, "self-intake", "M-1", "--target", '{"team":"OTHER","repo":"other/app"}', "--record", "r1");
  assert.equal(r.code, 3); // genuine verdict: mismatch

  // tamper: flip the recorded verdict to "self" (the confabulation this makes durable)
  const evPath = join(root, ".faff", "runs", "r1", "events.jsonl");
  const tampered = readFileSync(evPath, "utf8")
    .replace('"verdict":"not-self"', '"verdict":"self"')
    .replace('"reason":"mismatch"', '"reason":"team-match"');
  writeFileSync(evPath, tampered);

  const a = runIn(root, "audit", "r1", "--json");
  assert.equal(a.code, 0);
  const recon = JSON.parse(a.out);
  assert.equal(recon.coherence.self_intake_mismatches.length, 1);
  assert.equal(recon.coherence.self_intake_mismatches[0].recorded, "self");
  assert.equal(recon.coherence.self_intake_mismatches[0].recomputed, "not-self");
  assert.equal(recon.coherence.clean, false);
});

test("the FAFF-536 downstream is untouched: contain --selftest still passes byte-identical", () => {
  const r = runIn(fixtureRoot(), "contain", "--selftest");
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});
