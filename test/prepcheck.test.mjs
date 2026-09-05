// FAFF-178 — `faff prepcheck`: the Stop-hook backstop that makes "attach the produced
// spec in the same prep turn" mechanical, not prose. Mirrors runcheck: it reads an
// externalised attach-state marker prep writes (.faff/prep/<ISSUE>.json) and blocks on
// any produced-but-not-attached spec. Drives the real entrypoint against fixture roots.
//
// FAFF-250 — the hook now carries the runcheck session-scope + liveness gate: it
// HARD-BLOCKS only on a marker THIS session owns (env/session match) or a foreign
// abandoned one under --recover; a foreign live marker (held by its run ledger, or a
// fresh file mtime) is silent; a foreign abandoned marker WARNS (never blocks). The
// blocking tests below are therefore OWNING-session cases; the new FAFF-250 cases cover
// the foreign/liveness branches, mirroring test/runcheck-gate.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// spawnSync so we capture BOTH streams: the hook BLOCKS via a stdout decision payload,
// and (FAFF-250/235) WARNS via a non-blocking stderr line — the tests distinguish them.
// FAFF_RUN_DIR / FAFF_SESSION_ID default to "" so the test process's own env can never
// leak ownership into a "foreign" case; an owning case sets them explicitly.
function run(args, env) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, FAFF_RUN_DIR: "", FAFF_SESSION_ID: "", ...env },
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

const isoAgo = (secs) => new Date(Date.now() - secs * 1000).toISOString();

// Build a fixture root with .faff/prep/<issue>.json markers; returns the root path.
// A marker object may carry `__mtimeAgoSecs` to backdate the file mtime (stripped
// before serialisation) so the marker-mtime liveness floor can be exercised.
function rootWith(markers) {
  const dir = mkdtempSync(join(tmpdir(), "prepcheck-"));
  mkdirSync(join(dir, ".faff", "prep"), { recursive: true });
  for (const [issue, body] of Object.entries(markers)) {
    const p = join(dir, ".faff", "prep", `${issue}.json`);
    let mtimeAgo = null;
    let payload = body;
    if (body && typeof body === "object") {
      const { __mtimeAgoSecs, ...rest } = body;
      mtimeAgo = __mtimeAgoSecs ?? null;
      payload = rest;
    }
    writeFileSync(p, typeof payload === "string" ? payload : JSON.stringify(payload));
    if (mtimeAgo != null) {
      const t = new Date(Date.now() - mtimeAgo * 1000);
      utimesSync(p, t, t);
    }
  }
  return dir;
}

// Write a run-ledger fixture under the root and return its ABSOLUTE run dir, so a
// marker's owner.run_dir can point at it for the tier-(a) ledger-delegation path.
function ledgerDir(root, name, ledger) {
  const runDir = join(root, ".faff", "runs", name);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger));
  return runDir;
}

test("prepcheck --selftest passes (the shipped case table)", () => {
  const r = run(["prepcheck", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

test("FAFF-178 backstop: --hook blocks the OWNING session's produced-but-not-attached spec", () => {
  const root = rootWith({
    "FAFF-99": { issue: "FAFF-99", spec_produced: true, attached: false, mode: "tracker", owner: { run_dir: "/runs/MINE" } },
  });
  try {
    const r = run(["prepcheck", "--hook", "--root", root], { FAFF_RUN_DIR: "/runs/MINE" });
    assert.equal(r.code, 0, "hook blocks via the decision payload, not the exit code (mirrors runcheck)");
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block");
    assert.match(payload.reason, /FAFF-99/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--hook blocks the owning session via the session_id fallback (env-pointer absent)", () => {
  const root = rootWith({
    "FAFF-99": { issue: "FAFF-99", spec_produced: true, attached: false, owner: { session_id: "S1" } },
  });
  try {
    const r = run(["prepcheck", "--hook", "--root", root], { FAFF_SESSION_ID: "S1" });
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block", "session_id match proves ownership when FAFF_RUN_DIR is absent");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-250: --hook stays SILENT for a foreign live in-flight marker (fresh mtime) — the fix", () => {
  const root = rootWith({
    "FAFF-224": { issue: "FAFF-224", spec_produced: true, attached: false, owner: { run_dir: "/runs/OTHER" }, __mtimeAgoSecs: 10 },
  });
  try {
    const r = run(["prepcheck", "--hook", "--root", root]); // FAFF_RUN_DIR/SESSION unset → foreign
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "", "a live foreign in-flight marker must not block an unrelated session");
    assert.equal(r.err.trim(), "", "fresh mtime → held → fully silent");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-250: --hook WARNS (never blocks) a foreign ABANDONED marker (stale mtime, no live ledger)", () => {
  const root = rootWith({
    "FAFF-7": { issue: "FAFF-7", spec_produced: true, attached: false, owner: { run_dir: "/runs/OTHER" }, __mtimeAgoSecs: 1000 },
  });
  try {
    const r = run(["prepcheck", "--hook", "--root", root]);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "", "a non-owning session must NOT be hard-blocked (no stdout decision payload)");
    assert.match(r.err, /\[warn\]/, "the abandoned foreign marker is still surfaced — as a non-blocking warning");
    assert.match(r.err, /FAFF-7/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-250: --hook --recover hard-blocks a foreign abandoned marker (deliberate human recovery)", () => {
  const root = rootWith({
    "FAFF-7": { issue: "FAFF-7", spec_produced: true, attached: false, owner: { run_dir: "/runs/OTHER" }, __mtimeAgoSecs: 1000 },
  });
  try {
    const r = run(["prepcheck", "--hook", "--recover", "--root", root]);
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block", "--recover is the sanctioned hard-assert on a chosen abandoned marker");
    assert.match(payload.reason, /FAFF-7/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-250: --hook WARNS (never blocks) a legacy ownerless stale marker in a foreign session", () => {
  const root = rootWith({
    "FAFF-5": { issue: "FAFF-5", spec_produced: true, attached: false, __mtimeAgoSecs: 1000 },
  });
  try {
    const r = run(["prepcheck", "--hook", "--root", root]);
    assert.equal(r.out.trim(), "", "a legacy ownerless marker is unowned → a foreign session warns, never hard-blocks");
    assert.match(r.err, /\[warn\]/);
    assert.match(r.err, /FAFF-5/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-250: --hook is SILENT for a foreign marker its run ledger still HOLDS (ledger-delegated liveness)", () => {
  const root = rootWith({});
  const runDir = ledgerDir(root, "RUN-LIVE", {
    run_id: "RUN-LIVE", admitted: ["FAFF-224"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  // marker mtime is STALE so tier-(b) cannot hold it — only the live ledger (tier a) can.
  const more = rootWith({
    "FAFF-224": { issue: "FAFF-224", spec_produced: true, attached: false, owner: { run_dir: runDir }, __mtimeAgoSecs: 1000 },
  });
  try {
    const r = run(["prepcheck", "--hook", "--root", more]);
    assert.equal(r.out.trim(), "", "a foreign marker whose run ledger is held stays silent (tier-a delegation)");
    assert.equal(r.err.trim(), "", "ledger held → fully silent");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(more, { recursive: true, force: true }); }
});

test("FAFF-355: --hook is SILENT for a foreign marker whose run ledger has a STALE field but a FRESH heartbeat file (tier-a reads the file)", () => {
  const root = rootWith({});
  const runDir = ledgerDir(root, "RUN-LIVE", {
    run_id: "RUN-LIVE", admitted: ["FAFF-224"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(1000) },
  });
  writeFileSync(join(runDir, "heartbeat"), isoAgo(10) + "\n");
  // marker mtime is STALE so tier-(b) cannot hold it — only the fresh heartbeat FILE
  // (via tier-a's overlay onto the stale ledger field) can.
  const more = rootWith({
    "FAFF-224": { issue: "FAFF-224", spec_produced: true, attached: false, owner: { run_dir: runDir }, __mtimeAgoSecs: 1000 },
  });
  try {
    const r = run(["prepcheck", "--hook", "--root", more]);
    assert.equal(r.out.trim(), "", "a fresh heartbeat FILE holds tier-a even though the ledger field is stale");
    assert.equal(r.err.trim(), "", "held → fully silent");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(more, { recursive: true, force: true }); }
});

test("FAFF-233: --hook stays SILENT for a foreign marker with a fresh ledger heartbeat but a DEAD recorded pid (pid not consulted)", () => {
  const root = rootWith({});
  const runDir = ledgerDir(root, "RUN-LIVE", {
    run_id: "RUN-LIVE", admitted: ["FAFF-224"], outcomes: {},
    owner: { status: "running", pid: 2147483646, last_heartbeat: isoAgo(10) },
  });
  const more = rootWith({
    "FAFF-224": { issue: "FAFF-224", spec_produced: true, attached: false, owner: { run_dir: runDir, pid: 2147483646 }, __mtimeAgoSecs: 1000 },
  });
  try {
    const r = run(["prepcheck", "--hook", "--root", more]);
    assert.equal(r.out.trim(), "", "a fresh heartbeat is authoritative — a dead/rolled recorded pid must not flip it to abandoned");
    assert.equal(r.err.trim(), "", "held → fully silent");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(more, { recursive: true, force: true }); }
});

test("FAFF-250: a malformed ledger at owner.run_dir is caught (falls through to mtime, never throws)", () => {
  const root = rootWith({});
  const runDir = join(root, ".faff", "runs", "RUN-BAD");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), "not json{");
  const more = rootWith({
    // stale mtime AND a malformed ledger → tier-a no-ops, tier-b stale → abandoned → warn (no crash).
    "FAFF-8": { issue: "FAFF-8", spec_produced: true, attached: false, owner: { run_dir: runDir }, __mtimeAgoSecs: 1000 },
  });
  try {
    const r = run(["prepcheck", "--hook", "--root", more]);
    assert.equal(r.out.trim(), "", "a malformed ledger must not produce a block on a foreign marker");
    assert.match(r.err, /\[warn\]/, "malformed ledger → treated as no live ledger → mtime decides (stale → warn)");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(more, { recursive: true, force: true }); }
});

test("prepcheck --hook is silent once the spec is attached", () => {
  const root = rootWith({ "FAFF-99": { issue: "FAFF-99", spec_produced: true, attached: true, mode: "tracker" } });
  try {
    const r = run(["prepcheck", "--hook", "--root", root]);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "", "no block when the attach happened");
    assert.equal(r.err.trim(), "", "attached marker is filtered before the gate — no warn either");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck does not false-block a spec parked by design", () => {
  const root = rootWith({ "FAFF-99": { issue: "FAFF-99", spec_produced: true, attached: false, disposition: "parked" } });
  try {
    const hook = run(["prepcheck", "--hook", "--root", root]);
    assert.equal(hook.out.trim(), "", "parked is a legitimate non-attach, not a dropped spec");
    assert.equal(hook.err.trim(), "", "parked is filtered before the gate — no warn either");
    const plain = run(["prepcheck", "--root", root]);
    assert.equal(plain.code, 0);
    assert.match(plain.out, /clean/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck plain report exits 3 and names the open issue; git-only drop counts the same (gate-independent)", () => {
  const root = rootWith({ "FAFF-77": { issue: "FAFF-77", spec_produced: true, attached: false, mode: "git-only" } });
  try {
    const r = run(["prepcheck", "--root", root]);
    assert.equal(r.code, 3, "the plain report path is ownership-gate-independent — still fails loud on any open marker");
    assert.match(r.out, /OPEN \(1\): FAFF-77/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--hook blocks on the owning session's open marker among several issues, naming only the open one", () => {
  const root = rootWith({
    "FAFF-1": { issue: "FAFF-1", spec_produced: true, attached: true, owner: { run_dir: "/runs/MINE" } },
    "FAFF-2": { issue: "FAFF-2", spec_produced: true, attached: false, owner: { run_dir: "/runs/MINE" } },
  });
  try {
    const r = run(["prepcheck", "--hook", "--root", root], { FAFF_RUN_DIR: "/runs/MINE" });
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block");
    assert.match(payload.reason, /FAFF-2/);
    assert.doesNotMatch(payload.reason, /FAFF-1\b/, "the attached one is not flagged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck tolerates a malformed marker (skips it, never crashes)", () => {
  const root = rootWith({
    "FAFF-bad": "not json{",
    "FAFF-9": { issue: "FAFF-9", spec_produced: true, attached: true },
  });
  try {
    const r = run(["prepcheck", "--root", root]);
    assert.equal(r.code, 0, "a malformed marker is skipped, not fatal");
    assert.match(r.out, /clean/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck is clean when no markers exist at all", () => {
  const dir = mkdtempSync(join(tmpdir(), "prepcheck-empty-"));
  try {
    const r = run(["prepcheck", "--root", dir]);
    assert.equal(r.code, 0);
    assert.match(r.out, /clean/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ===========================================================================
// FAFF-258 — `prepcheck --issue`: the single-issue five-state verdict, the
// orchestrator↔prep delegation reconciliation primitive. Reads ONLY
// .faff/prep/<ISSUE>.json (never the global scan) and is additive to --hook
// (verified above, unchanged). Exit map: 0/0/1/2/2 for
// attached/parked/open/missing/malformed.
// ===========================================================================

test("prepcheck --issue: attached marker → state=attached, exit 0", () => {
  const root = rootWith({
    "FAFF-501": { issue: "FAFF-501", spec_produced: true, attached: true, mode: "tracker", ts: "2026-07-10T00:00:00Z" },
  });
  try {
    const r = run(["prepcheck", "--issue", "FAFF-501", "--json", "--root", root]);
    assert.equal(r.code, 0);
    const payload = JSON.parse(r.out.trim());
    assert.deepEqual(payload, {
      issue: "FAFF-501", spec_produced: true, attached: true, disposition: null,
      owner: null, ts: "2026-07-10T00:00:00Z", owner_matches_run: null, state: "attached",
      awaiting_spec_review: false, // FAFF-993: git-only awaiting-spec-review derivation (no hold file → false)
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-993: prepcheck --issue surfaces awaiting_spec_review:true from a git-only spec-review-resume hold", () => {
  const root = rootWith({
    "FAFF-993": { issue: "FAFF-993", spec_produced: true, attached: false, mode: "tracker" },
  });
  try {
    // no hold file yet → false
    assert.equal(JSON.parse(run(["prepcheck", "--issue", "FAFF-993", "--json", "--root", root]).out.trim()).awaiting_spec_review, false);
    // the reconsider/interactive seam wrote the FAFF-900 hold → the git-only awaiting-spec-review signal
    mkdirSync(join(root, ".faff", "resume", "FAFF-993"), { recursive: true });
    writeFileSync(join(root, ".faff", "resume", "FAFF-993", "spec-review-hold.json"), JSON.stringify({ cause: "reconsider-input-changed" }));
    assert.equal(JSON.parse(run(["prepcheck", "--issue", "FAFF-993", "--json", "--root", root]).out.trim()).awaiting_spec_review, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck --issue: parked disposition (attach not expected, by-design non-attach) → state=parked, exit 0", () => {
  const root = rootWith({
    "FAFF-502": { issue: "FAFF-502", spec_produced: true, attached: false, disposition: "parked" },
  });
  try {
    const r = run(["prepcheck", "--issue", "FAFF-502", "--json", "--root", root]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out.trim()).state, "parked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck --issue: produced-but-unattached, no park disposition → state=open, exit 1 (the FAFF-258 drop)", () => {
  const root = rootWith({
    "FAFF-503": { issue: "FAFF-503", spec_produced: true, attached: false },
  });
  try {
    const r = run(["prepcheck", "--issue", "FAFF-503", "--json", "--root", root]);
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.out.trim()).state, "open");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck --issue: no marker file for the issue → state=missing, exit 2", () => {
  const root = rootWith({});
  try {
    const r = run(["prepcheck", "--issue", "FAFF-NOPE", "--json", "--root", root]);
    assert.equal(r.code, 2);
    assert.equal(JSON.parse(r.out.trim()).state, "missing");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck --issue: unparseable marker JSON → state=malformed, exit 2", () => {
  const root = rootWith({ "FAFF-504": "not json{" });
  try {
    const r = run(["prepcheck", "--issue", "FAFF-504", "--json", "--root", root]);
    assert.equal(r.code, 2);
    assert.equal(JSON.parse(r.out.trim()).state, "malformed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck --issue: marker missing the required spec_produced key → state=malformed, exit 2", () => {
  const root = rootWith({ "FAFF-505": { issue: "FAFF-505", attached: false } });
  try {
    const r = run(["prepcheck", "--issue", "FAFF-505", "--json", "--root", root]);
    assert.equal(r.code, 2);
    assert.equal(JSON.parse(r.out.trim()).state, "malformed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck --issue: owner_matches_run true/false/null against --run-dir", () => {
  const root = rootWith({
    "FAFF-506": { issue: "FAFF-506", spec_produced: true, attached: true, owner: { run_dir: "/runs/MINE" } },
  });
  try {
    const matched = run(["prepcheck", "--issue", "FAFF-506", "--run-dir", "/runs/MINE", "--json", "--root", root]);
    assert.equal(JSON.parse(matched.out.trim()).owner_matches_run, true);

    const mismatched = run(["prepcheck", "--issue", "FAFF-506", "--run-dir", "/runs/OTHER", "--json", "--root", root]);
    assert.equal(JSON.parse(mismatched.out.trim()).owner_matches_run, false);

    const omitted = run(["prepcheck", "--issue", "FAFF-506", "--json", "--root", root]);
    assert.equal(JSON.parse(omitted.out.trim()).owner_matches_run, null, "null when --run-dir is omitted");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck --issue reads ONLY the named issue's marker — an unrelated open marker never surfaces", () => {
  const root = rootWith({
    "FAFF-507": { issue: "FAFF-507", spec_produced: true, attached: true },
    "FAFF-508": { issue: "FAFF-508", spec_produced: true, attached: false }, // open, but a different issue
  });
  try {
    const r = run(["prepcheck", "--issue", "FAFF-507", "--json", "--root", root]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out.trim()).state, "attached", "the --issue mode is scoped to the named marker, never the global scan");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck --issue: --hook stays byte-unchanged when --issue is also passed to a --hook invocation (additive dispatch only)", () => {
  // --issue takes precedence as a distinct mode; it does not leak into --hook's own
  // decision path (--hook's own tests above already cover it in isolation).
  const root = rootWith({
    "FAFF-509": { issue: "FAFF-509", spec_produced: true, attached: false, owner: { run_dir: "/runs/MINE" } },
  });
  try {
    const r = run(["prepcheck", "--hook", "--issue", "FAFF-509", "--root", root], { FAFF_RUN_DIR: "/runs/MINE" });
    // cmdPrepcheck checks --issue before consulting the hook branch, so this exercises
    // the --issue exit-coded report path, not the hook's stdout decision payload.
    assert.equal(r.code, 1, "still the --issue exit map (open), proving --issue is checked first without touching --hook's own code path");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-258 integration smoke test (per spec §8): seed open → flip attached → re-verify", () => {
  const root = rootWith({
    "FAFF-TEST": { issue: "FAFF-TEST", spec_produced: true, attached: false },
  });
  try {
    const opened = run(["prepcheck", "--issue", "FAFF-TEST", "--json", "--root", root]);
    assert.equal(opened.code, 1);
    assert.equal(JSON.parse(opened.out.trim()).state, "open");

    writeFileSync(
      join(root, ".faff", "prep", "FAFF-TEST.json"),
      JSON.stringify({ issue: "FAFF-TEST", spec_produced: true, attached: true }),
    );

    const attached = run(["prepcheck", "--issue", "FAFF-TEST", "--json", "--root", root]);
    assert.equal(attached.code, 0);
    assert.equal(JSON.parse(attached.out.trim()).state, "attached");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
