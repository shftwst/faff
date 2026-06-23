// FAFF-212 — `faff intakecheck` / `faff intake-record`: the intake-provenance guard
// that makes "new work entered through /faff-jot" a deterministic, checkable fact
// (CLI-written .faff/provenance/<ISSUE>.json marker + grandfather-label bridge) rather
// than the spoofable faff-jot-intake label (the FAFF-209 bypass). Mirrors prepcheck:
// drives the real entrypoint against fixture roots; PURE (zero tracker/network calls).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(...args) {
  // spawnSync captures stdout AND stderr on every exit code (the typo-coercion case
  // writes a warning to stderr while exiting 0, which execFileSync would let through
  // to the parent's inherited stderr instead of capturing).
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

// A fixture root; optionally seed a provenance marker and/or an intake_gate config.
function rootWith({ markers = {}, gate } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "intakecheck-"));
  mkdirSync(join(dir, ".faff", "provenance"), { recursive: true });
  for (const [issue, body] of Object.entries(markers)) {
    writeFileSync(join(dir, ".faff", "provenance", `${issue}.json`), typeof body === "string" ? body : JSON.stringify(body));
  }
  if (gate) writeFileSync(join(dir, ".faffrc.yaml"), `intake_gate: ${gate}\n`);
  return dir;
}

test("intakecheck --selftest passes (the shipped four-bases table)", () => {
  const r = run("intakecheck", "--selftest");
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

test("intake-record --selftest passes (the fast-track-requires-reason table)", () => {
  const r = run("intake-record", "--selftest");
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

test("a recorded jot marker satisfies the guard (basis jot, no warn, exit 0)", () => {
  const root = rootWith({ markers: { "FAFF-1": { schema: 1, issue: "FAFF-1", intake: { via: "jot", ts: "2026-06-22T00:00:00Z" } } }, gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--root", root);
    assert.equal(r.code, 0);
    assert.match(r.out, /basis=jot/);
    assert.doesNotMatch(r.out, /\[warn\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("legacy faff-jot-intake label, no marker, block → grandfathered + warn, exit 0 (legacy not bricked)", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "faff-jot-intake", "--root", root);
    assert.equal(r.code, 0, "grandfathered legacy ticket passes during migration");
    assert.match(r.out, /grandfathered-label/);
    assert.match(r.out, /\[warn\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("no marker, no label, block → unsatisfied, exit 3, names the override path", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root);
    assert.equal(r.code, 3, "block mode blocks");
    assert.match(r.out, /no genuine intake provenance/);
    assert.match(r.out, /fast-track/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("WARN never blocks: no provenance under default (warn) still exits 0", () => {
  const root = rootWith({}); // no gate config → default warn (FAFF-182)
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root);
    assert.equal(r.code, 0, "warn prints guidance but never blocks");
    assert.match(r.out, /\[warn\]/);
    assert.match(r.out, /no genuine intake provenance/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intake_gate: off is always satisfied, exit 0, even with no marker and no label", () => {
  const root = rootWith({ gate: "off" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root);
    assert.equal(r.code, 0);
    assert.match(r.out, /gate-off/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a malformed marker is treated as absent + warn, never crashes", () => {
  const root = rootWith({ markers: { "FAFF-1": "not json{" }, gate: "block" });
  try {
    // malformed marker gates as absent; with no label + block → exit 3, no crash
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root);
    assert.equal(r.code, 3, "malformed gates as absent (block), does not crash");
    assert.match(r.out, /no genuine intake provenance/);
    // and with the grandfather label it still passes (with warn)
    const r2 = run("intakecheck", "FAFF-1", "--labels", "faff-jot-intake", "--root", root);
    assert.equal(r2.code, 0);
    assert.match(r2.out, /grandfathered-label/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("tracker-less (--labels omitted) gates on the marker alone", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--root", root); // no --labels at all
    assert.equal(r.code, 3, "no marker, no labels → unsatisfied under block");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intake-record --via jot writes the marker and emits the faff-contract:intake-record descriptor", () => {
  const root = rootWith({});
  try {
    const r = run("intake-record", "FAFF-1", "--via", "jot", "--root", root);
    assert.equal(r.code, 0);
    assert.match(r.out, /```faff-contract:intake-record/);
    const p = join(root, ".faff", "provenance", "FAFF-1.json");
    assert.ok(existsSync(p), "marker written");
    const m = JSON.parse(readFileSync(p, "utf8"));
    assert.equal(m.schema, 2); // FAFF-220: PROVENANCE_SCHEMA bumped 1→2
    assert.equal(m.intake.via, "jot");
    assert.ok(m.intake.ts, "timestamp recorded");
    assert.ok(!("initiated" in m), "no --initiated → key omitted, never written as null"); // FAFF-220
    // and now the guard is satisfied
    assert.equal(run("intakecheck", "FAFF-1", "--root", root).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// FAFF-220: the optional --initiated audit field.
test("intake-record --initiated interactive|autonomous stamps the audit field", () => {
  const root = rootWith({});
  try {
    assert.equal(run("intake-record", "FAFF-1", "--via", "jot", "--initiated", "interactive", "--root", root).code, 0);
    let m = JSON.parse(readFileSync(join(root, ".faff", "provenance", "FAFF-1.json"), "utf8"));
    assert.equal(m.schema, 2);
    assert.equal(m.initiated, "interactive");
    assert.equal(run("intake-record", "FAFF-2", "--via", "jot", "--initiated", "autonomous", "--root", root).code, 0);
    m = JSON.parse(readFileSync(join(root, ".faff", "provenance", "FAFF-2.json"), "utf8"));
    assert.equal(m.initiated, "autonomous");
    // intakecheck behaviour is unchanged — initiated never enters the verdict
    assert.equal(run("intakecheck", "FAFF-1", "--root", root).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intake-record --initiated <invalid> exits 2 and writes nothing (parity with --via)", () => {
  const root = rootWith({});
  try {
    const r = run("intake-record", "FAFF-1", "--via", "jot", "--initiated", "bogus", "--root", root);
    assert.equal(r.code, 2);
    assert.ok(!existsSync(join(root, ".faff", "provenance", "FAFF-1.json")), "no marker on a rejected --initiated");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intake-record merge-preserves an existing initiated when --initiated is absent", () => {
  const root = rootWith({});
  try {
    // record a mutable (backfill) marker WITH initiated, then re-record without the flag
    assert.equal(run("intake-record", "FAFF-1", "--via", "backfill", "--initiated", "autonomous", "--root", root).code, 0);
    assert.equal(run("intake-record", "FAFF-1", "--via", "backfill", "--root", root).code, 0);
    const m = JSON.parse(readFileSync(join(root, ".faff", "provenance", "FAFF-1.json"), "utf8"));
    assert.equal(m.initiated, "autonomous", "existing initiated survives a re-record with no --initiated");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("legacy schema:1 marker reads back without error and gates exactly as before (initiated grandfathered to null)", () => {
  const root = rootWith({ gate: "block" });
  try {
    const p = join(root, ".faff", "provenance", "FAFF-V1.json");
    writeFileSync(p, JSON.stringify({ schema: 1, issue: "FAFF-V1", intake: { via: "jot", ts: "2026-01-01T00:00:00Z" } }) + "\n");
    // v1 marker (no initiated key) still satisfies the guard — no error, no schema assertion in the reader
    assert.equal(run("intakecheck", "FAFF-V1", "--labels", "", "--root", root).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intake-record --via fast-track without --reason exits 2 and writes nothing", () => {
  const root = rootWith({});
  try {
    const r = run("intake-record", "FAFF-1", "--via", "fast-track", "--root", root);
    assert.equal(r.code, 2);
    assert.ok(!existsSync(join(root, ".faff", "provenance", "FAFF-1.json")), "no marker on a rejected fast-track");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intake-record --via fast-track with --reason records the reason on the marker", () => {
  const root = rootWith({});
  try {
    const r = run("intake-record", "FAFF-1", "--via", "fast-track", "--reason", "prod outage", "--root", root);
    assert.equal(r.code, 0);
    const m = JSON.parse(readFileSync(join(root, ".faff", "provenance", "FAFF-1.json"), "utf8"));
    assert.equal(m.intake.via, "fast_track");
    assert.equal(m.intake.reason, "prod outage");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intake-record --via backfill stamps a legacy ticket (migration path)", () => {
  const root = rootWith({});
  try {
    assert.equal(run("intake-record", "FAFF-1", "--via", "backfill", "--root", root).code, 0);
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root);
    assert.equal(r.code, 0);
    assert.match(r.out, /basis=backfill/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intake-record preserves a reserved prep block on re-record (observability only)", () => {
  // jot → fast-track re-record: prep survives AND a deliberate act re-asserts provenance.
  const root = rootWith({ markers: { "FAFF-1": { schema: 1, issue: "FAFF-1", intake: { via: "jot", ts: "x" }, prep: { specced: true } } } });
  try {
    run("intake-record", "FAFF-1", "--via", "fast-track", "--reason", "re-assert", "--root", root);
    const m = JSON.parse(readFileSync(join(root, ".faff", "provenance", "FAFF-1.json"), "utf8"));
    assert.deepEqual(m.prep, { specced: true }, "reserved prep block survives a re-record");
    assert.equal(m.intake.via, "fast_track", "intake updated by a deliberate act");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- FAFF-212 adversarial-review fixes (F1/F2/F3/F4) ---

test("backfill never downgrades genuine jot provenance (no-downgrade guard, F2)", () => {
  const root = rootWith({ markers: { "FAFF-1": { schema: 1, issue: "FAFF-1", intake: { via: "jot", ts: "orig" } } } });
  try {
    const r = run("intake-record", "FAFF-1", "--via", "backfill", "--root", root);
    assert.equal(r.code, 0, "no-downgrade is a benign no-op, exit 0");
    const m = JSON.parse(readFileSync(join(root, ".faff", "provenance", "FAFF-1.json"), "utf8"));
    assert.equal(m.intake.via, "jot", "genuine jot record is NOT overwritten by backfill");
    assert.equal(m.intake.ts, "orig", "original timestamp untouched");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("backfill never downgrades a fast_track record either (F2)", () => {
  const root = rootWith({ markers: { "FAFF-1": { schema: 1, issue: "FAFF-1", intake: { via: "fast_track", ts: "orig", reason: "outage" } } } });
  try {
    run("intake-record", "FAFF-1", "--via", "backfill", "--root", root);
    const m = JSON.parse(readFileSync(join(root, ".faff", "provenance", "FAFF-1.json"), "utf8"));
    assert.equal(m.intake.via, "fast_track", "fast_track is genuine provenance, not downgraded");
    assert.equal(m.intake.reason, "outage");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a deliberate jot/fast-track DOES overwrite a prior backfill (re-assert is legitimate, F2)", () => {
  const root = rootWith({ markers: { "FAFF-1": { schema: 1, issue: "FAFF-1", intake: { via: "backfill", ts: "old" } } } });
  try {
    run("intake-record", "FAFF-1", "--via", "jot", "--root", root);
    const m = JSON.parse(readFileSync(join(root, ".faff", "provenance", "FAFF-1.json"), "utf8"));
    assert.equal(m.intake.via, "jot", "a genuine jot upgrade over a backfill is allowed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intakecheck refuses a dangling --labels (quoting slip) rather than silently blocking (F1)", () => {
  const root = rootWith({ gate: "block" });
  try {
    // --labels immediately followed by another flag → no value reached the CLI
    const r = run("intakecheck", "FAFF-1", "--labels", "--json", "--root", root);
    assert.equal(r.code, 2, "fail loud — do not treat as unlabelled and block");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intakecheck --labels \"\" is still the valid tracker-less form (distinct from dangling, F1)", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root);
    assert.equal(r.code, 3, "explicit empty labels gates on the marker alone (no crash, not a usage error)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resolveIntakeGate warns on a typo'd value and coerces fail-safe to warn (F3)", () => {
  const root = rootWith({ gate: "blok" }); // typo
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root);
    assert.equal(r.code, 0, "coerced to warn (fail-safe) → never blocks");
    assert.match(r.err ?? "", /not warn\|block\|off/, "typo is surfaced on stderr, not silent");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("config resolved surfaces a set intake_gate (F3)", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("config", "resolved", "--root", root);
    assert.equal(r.code, 0);
    assert.match(r.out, /intake_gate: block/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("intakecheck guidance points at intake-record, not /faff-jot ISSUE (F4)", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root);
    assert.match(r.out, /--via backfill/, "names the legacy-stamp remedy");
    assert.match(r.out, /--via fast-track/, "names the override remedy");
    assert.doesNotMatch(r.out, /\/faff-jot FAFF-1\b/, "does NOT tell the user to run the eligibility interactor on the ticket");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- FAFF-223: human-side provenance — eligibility-gesture basis + --interactive bypass ---

test("AC: a human-set faff-automate (no marker) passes under block — basis eligibility-gesture, no warn, no CLI", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "faff-automate", "--root", root);
    assert.equal(r.code, 0, "a human-set write-abstained faff-automate is admissible intake provenance");
    assert.match(r.out, /eligibility-gesture/, "the new, distinctly-named basis (not jot/backfill)");
    assert.doesNotMatch(r.out, /\[warn\]/, "trustworthy by construction (FAFF-218) → clean pass, no warn");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AC: eligibility-gesture is a DISTINCT basis in --json (axes not collapsed)", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "faff-automate", "--root", root, "--json");
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.satisfied, true);
    assert.equal(j.basis, "eligibility-gesture", "legible audit trail — distinct from a real jot marker");
    assert.ok(!("warn" in j), "no warn field");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AC: precedence — a recorded marker still wins over the eligibility-gesture label", () => {
  const root = rootWith({ markers: { "FAFF-1": { schema: 2, issue: "FAFF-1", intake: { via: "jot", ts: "x" } } }, gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "faff-automate", "--root", root);
    assert.equal(r.code, 0);
    assert.match(r.out, /basis=jot/, "marker > eligibility-gesture");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AC: precedence — grandfathered-label (and its warn) wins over eligibility-gesture", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "faff-jot-intake,faff-automate", "--root", root);
    assert.equal(r.code, 0);
    assert.match(r.out, /grandfathered-label/, "grandfathered-label > eligibility-gesture — migration warn preserved");
    assert.match(r.out, /\[warn\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AC: --interactive bypasses a block-mode miss (exit 0, [warn] notice) — human is the sanction", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root, "--interactive");
    assert.equal(r.code, 0, "interactive build is never sent to a terminal");
    assert.match(r.out, /\[warn\]/);
    assert.match(r.out, /human at the keyboard is the sanction/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AC: the interactive bypass notice contains NO instruction to run a faff CLI command (zero-CLI)", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root, "--interactive");
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /intake-record/, "no CLI ceremony in the interactive notice");
    assert.doesNotMatch(r.out, /faff intakecheck/, "the [warn] is the bypass notice, not the guidance text");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AC: autonomous (no --interactive) STILL exits 3 under block with no provenance — paired against the bypass", () => {
  const root = rootWith({ gate: "block" });
  try {
    const blocked = run("intakecheck", "FAFF-1", "--labels", "", "--root", root);
    assert.equal(blocked.code, 3, "the block stays in force for autonomous callers");
    const bypassed = run("intakecheck", "FAFF-1", "--labels", "", "--root", root, "--interactive");
    assert.equal(bypassed.code, 0, "...and only --interactive relaxes it (paired assertion)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AC: --interactive is a no-op when provenance is already satisfied (no spurious bypass)", () => {
  const root = rootWith({ markers: { "FAFF-1": { schema: 2, issue: "FAFF-1", intake: { via: "jot", ts: "x" } } }, gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root, "--interactive", "--json");
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.basis, "jot");
    assert.ok(!("bypassed" in j), "no bypass flag when the verdict is genuinely satisfied");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AC: intakeGuidance reframes --via backfill as migration/agent-only and names the zero-CLI human remedy", () => {
  const root = rootWith({ gate: "block" });
  try {
    const r = run("intakecheck", "FAFF-1", "--labels", "", "--root", root);
    assert.equal(r.code, 3);
    assert.match(r.out, /set the faff-automate label/i, "the documented human remedy is the tracker gesture");
    assert.match(r.out, /Migration \/ agent-orchestrator only/, "backfill reframed as migration/agent tooling");
    assert.match(r.out, /zero-CLI/i, "the human path is explicitly zero-CLI");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
