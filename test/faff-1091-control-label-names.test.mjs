// FAFF-1091 — configure control-label names per role (full name), not just a prefix.
// Exercises the whole surface through the REAL CLI on the filesystem: the per-role override
// map config round-trip (incremental sibling-leaf writes without --force), the pure-function
// selftests (labels / label / eligible / next / intakecheck), override recognition at every
// read-site (a renamed `automate` still resolves eligible + is refused by role), injection
// safety on names (a newline/control-char value is rejected), and the new
// `faff label transition` single-select state-group verb's ordered remove-then-add contract
// (incl. the ungrouped `stacked` plain-add branch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

function run(cwd, ...args) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString() };
  }
}

function tmpRepo(extra = "") {
  const dir = mkdtempSync(join(tmpdir(), "faff1091-"));
  writeFileSync(join(dir, ".faffrc.yaml"), `tracking:\n  tracker: linear\n  repo: x/y\n${extra}`);
  return dir;
}

// --- the pure-function selftests all pass (the shipped tables) -------------------------------

for (const cmd of ["labels", "label", "eligible", "next", "intakecheck"]) {
  test(`${cmd} --selftest passes`, () => {
    const r = run(process.cwd(), cmd, "--selftest");
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /RESULT: PASS/);
  });
}

// --- per-role name round-trip via config (incremental sibling leaves, no --force) ------------

test("config set writes each control_labels role leaf; a second leaf appends a sibling without --force and without clobbering the first", () => {
  const dir = tmpRepo();
  const a = run(dir, "config", "set", "tracking.control_labels.automate", "Some group: eligible");
  assert.equal(a.code, 0, a.err);
  const b = run(dir, "config", "set", "tracking.control_labels.parked", "State: Parked");
  assert.equal(b.code, 0, b.err); // NO --force required for the sibling leaf
  const c = run(dir, "config", "set", "tracking.control_labels.claimed", "State: Claimed");
  assert.equal(c.code, 0, c.err);
  // all three read back intact
  assert.equal(run(dir, "config", "get", "tracking.control_labels.automate").out, "Some group: eligible");
  assert.equal(run(dir, "config", "get", "tracking.control_labels.parked").out, "State: Parked");
  assert.equal(run(dir, "config", "get", "tracking.control_labels.claimed").out, "State: Claimed");
  // the map is nested (unflattened) under tracking
  const raw = readFileSync(join(dir, ".faffrc.yaml"), "utf8");
  assert.match(raw, /\n {2}control_labels:\n {4}automate:/);
});

test("controlLabels renders overrides and falls back to <prefix>-<role> for unset roles", () => {
  const dir = tmpRepo("  control_labels:\n    parked: \"State: Parked\"\n    automate: \"Some group: eligible\"\n");
  const names = run(dir, "labels", "--names");
  assert.equal(names.code, 0, names.err);
  const lines = names.out.split("\n");
  assert.ok(lines.includes("State: Parked"), "parked override rendered");
  assert.ok(lines.includes("Some group: eligible"), "automate override rendered");
  assert.ok(lines.includes("faff-awaiting-review"), "unset role falls back to prefix");
  assert.ok(lines.includes("faff-stacked"), "unset role falls back to prefix");
});

// --- zero-config is byte-identical ----------------------------------------------------------

test("zero-config control labels are byte-identical to the default manifest names", () => {
  const dir = tmpRepo();
  const names = run(dir, "labels", "--names").out.split("\n");
  assert.deepEqual(names, [
    "faff-automate", "faff-parked", "faff-awaiting-review", "faff-awaiting-spec-review",
    "faff-claimed", "faff-awaiting-adjudication", "faff-stacked",
  ]);
});

// --- override recognition: a renamed `automate` still resolves eligible + is refused by role -

test("a renamed automate resolves eligible via `faff eligible` (by role, not the stale literal)", () => {
  const dir = tmpRepo("  control_labels:\n    automate: \"Some group: eligible\"\n");
  // the override name resolves eligible
  const eligible = run(dir, "eligible", "--label", "Some group: eligible", "--tracker", "present");
  assert.equal(eligible.out, "true", eligible.err);
  // the stale default literal must NOT fail open as still-eligible
  const stale = run(dir, "eligible", "--label", "faff-automate", "--tracker", "present");
  assert.equal(stale.out, "false", stale.err);
});

test("a renamed automate still triggers the tracker_owned refusal by role", () => {
  const dir = tmpRepo("  control_labels:\n    automate: \"Some group: eligible\"\n");
  const r = run(dir, "label", "add", "FAFF-1", "Some group: eligible", "--root", dir);
  assert.equal(r.code, 3, "tracker-owned refusal exit code");
  assert.match(r.err, /tracker-owned eligibility label/);
});

test("a renamed automate reads native in `faff next`'s skip-ineligible reason", () => {
  const dir = tmpRepo("  control_labels:\n    automate: \"Some group: eligible\"\n");
  const r = run(dir, "next", "--status", "todo", "--spec", "high", "--not-eligible", "--root", dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Some group: eligible/);
  assert.doesNotMatch(r.out, /faff-automate/);
});

// --- injection safety on names --------------------------------------------------------------

test("a whitespace-only control-label name is rejected at write", () => {
  const dir = tmpRepo();
  const r = run(dir, "config", "set", "tracking.control_labels.parked", "   ");
  assert.equal(r.code, 2);
  assert.match(r.err, /non-empty/);
});

test("a control-label name with a newline is rejected at write (can't corrupt state)", () => {
  const dir = tmpRepo();
  const r = run(dir, "config", "set", "tracking.control_labels.parked", "bad\nname");
  assert.equal(r.code, 2);
  assert.match(r.err, /control character or newline/);
});

test("a non-map tracking.control_labels value is rejected loud at read (resolver)", () => {
  const dir = tmpRepo("  control_labels: not-a-map\n");
  const r = run(dir, "labels", "--names", "--root", dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /must be a map of role -> name/);
});

// --- the `faff label transition` single-select state-group verb ------------------------------

test("label transition into a grouped role clears other state labels FIRST, then adds", () => {
  const dir = tmpRepo();
  const r = run(dir, "label", "transition", "FAFF-1", "claimed",
    "--present-label", "faff-parked", "--present-label", "faff-awaiting-review", "--root", dir);
  assert.equal(r.code, 0, r.err);
  const block = r.out.replace(/```faff-contract:label-op|```/g, "").trim();
  const parsed = JSON.parse(block);
  assert.equal(parsed.action, "transition");
  assert.equal(parsed.target_role, "claimed");
  assert.deepEqual(parsed.ops, [
    { action: "remove", label: "faff-parked" },
    { action: "remove", label: "faff-awaiting-review" },
    { action: "add", label: "faff-claimed" },
  ]);
});

test("label transition into the ungrouped `stacked` role is a plain add with NO clears", () => {
  const dir = tmpRepo();
  const r = run(dir, "label", "transition", "FAFF-1", "stacked",
    "--present-label", "faff-awaiting-review", "--root", dir);
  assert.equal(r.code, 0, r.err);
  const parsed = JSON.parse(r.out.replace(/```faff-contract:label-op|```/g, "").trim());
  assert.deepEqual(parsed.ops, [{ action: "add", label: "faff-stacked" }]);
});

test("label transition resolves group names through per-role overrides", () => {
  const dir = tmpRepo("  control_labels:\n    parked: \"State: Parked\"\n    claimed: \"State: Claimed\"\n");
  const r = run(dir, "label", "transition", "FAFF-1", "claimed",
    "--present-label", "State: Parked", "--root", dir);
  assert.equal(r.code, 0, r.err);
  const parsed = JSON.parse(r.out.replace(/```faff-contract:label-op|```/g, "").trim());
  assert.deepEqual(parsed.ops, [
    { action: "remove", label: "State: Parked" },
    { action: "add", label: "State: Claimed" },
  ]);
});

test("label transition to an unknown role is rejected", () => {
  const dir = tmpRepo();
  const r = run(dir, "label", "transition", "FAFF-1", "not-a-role", "--root", dir);
  assert.equal(r.code, 1);
  assert.match(r.err, /not a faff control-label role/);
});

test("label transition to the tracker-owned automate role is REFUSED (FAFF-218, not reachable via the verb)", () => {
  const dir = tmpRepo();
  const r = run(dir, "label", "transition", "FAFF-1", "automate", "--present-label", "faff-parked", "--root", dir);
  assert.equal(r.code, 3, "tracker-owned refusal exit code");
  assert.match(r.err, /tracker-owned eligibility label/);
});

test("a renamed automate is STILL refused by the transition verb, by role", () => {
  const dir = tmpRepo("  control_labels:\n    automate: \"Some group: eligible\"\n");
  const r = run(dir, "label", "transition", "FAFF-1", "automate", "--root", dir);
  assert.equal(r.code, 3);
  assert.match(r.err, /tracker-owned eligibility label/);
});

test("a non-scalar control-label leaf (nested map) is rejected loud at read", () => {
  const dir = tmpRepo("  control_labels:\n    parked:\n      nested: oops\n");
  const r = run(dir, "labels", "--names", "--root", dir);
  assert.equal(r.code, 2);
  assert.match(r.err, /must be a scalar, not a map/);
});
