// FAFF-120 — the skill-authoring charter's lintable subset in `faff validate-adapters`
// (docs/reference/skill-authoring.md): per-file line cap (a downward ratchet for the two hub files,
// FAFF-584), wall-of-text paragraph cap (now counting bold-lead bullets, FAFF-584, as WARN), an
// anchor heading-existence lint (FAFF-584, WARN), stray transcript/retrospective markers, and a
// cross-file duplicated-block detector. Thresholds are calibrated against the post-FAFF-114–119 tree
// as lenient ceilings; the real tree must pass clean.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const require = createRequire(import.meta.url);
const { SKILL_LINE_BASELINE } = require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "validate-adapters.js"));

// Run validate-adapters over a throwaway skills dir of {dirName: SKILL.md body} fixtures.
// Fixture dir names are NOT faffter-/faffidavit-/faff- prefixed (unless a test needs the gateway
// override), so only the repo-wide per-SKILL.md loops — incl. the charter rules — see them.
function runOnFixtures(fixtures) {
  const dir = mkdtempSync(join(tmpdir(), "faff-charter-"));
  for (const [name, body] of Object.entries(fixtures)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "SKILL.md"), body);
  }
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}
const runOne = (body, name = "zz-charter-fixture") => runOnFixtures({ [name]: body });
const has = (r, category) => new RegExp(`\\(${category}\\)`).test(r.stdout);

test("flags a SKILL.md over the line cap", () => {
  const body = Array.from({ length: 601 }, (_, i) => `line ${i}`).join("\n");
  const r = runOne(body);
  assert.ok(has(r, "line cap"), "601-line skill should trip the line cap");
  assert.match(r.stdout, /601 lines \(cap 600\)/);
  assert.notEqual(r.status, 0);
});

test("a hub file gets its own downward-ratchet baseline, not the shared ceiling", () => {
  // a 700-line file named `faff-graft` is a shared-prose hub — SKILL_LINE_BASELINE["faff-graft"] is
  // its own committed-size ratchet (854, above 700), so no line-cap failure, even though 700 is over
  // the shared lenient SKILL_LINE_CAP (600). FAFF-607: the bare-`/faff` gateway is no longer a hub
  // (it dropped to its post-split size, baseline 80); the hub baselines that override the ceiling are
  // faff-beep-boop / faff-graft and the path-keyed KERNEL_LINE_BASELINE.
  const body = Array.from({ length: 700 }, (_, i) => `gateway line ${i}`).join("\n");
  const r = runOne(body, "faff-graft");
  assert.equal(has(r, "line cap"), false, "a hub's SKILL_LINE_BASELINE ratchet must not trip below its own baseline (854)");
});

test("flags a wall-of-text paragraph", () => {
  const para = Array.from({ length: 210 }, () => "word").join(" ");
  const r = runOne(`# Heading\n\n${para}\n`);
  assert.ok(has(r, "paragraph"), "a 210-word single line should trip the paragraph cap");
  assert.match(r.stdout, /210-word paragraph \(cap 200\)/);
  assert.notEqual(r.status, 0);
});

test("flags a transcript run-id marker", () => {
  const r = runOne("Calibrated against run 2026-06-12 of the suite.\n");
  assert.ok(has(r, "stray marker"));
  assert.match(r.stdout, /transcript run-id/);
  assert.notEqual(r.status, 0);
});

test("flags a retrospective war-story phrase", () => {
  const r = runOne("This widened definition fixes a real failure in the queue.\n");
  assert.ok(has(r, "stray marker"));
  assert.match(r.stdout, /retrospective war-story phrase/);
  assert.notEqual(r.status, 0);
});

// FAFF-337 — a literal minted canonical run-id (8 digits, 6 digits, launcher word) pasted
// into prose is exactly the transcript-breadcrumb idiom this lint targets; the
// letter-template shape used to DOCUMENT the format (`YYYY-MM-DD`/`HHMMSS` placeholders,
// no real digits) must NOT trip it.
test("flags a literal canonical run-id (beepboop)", () => {
  const r = runOne("Calibrated against .faff/runs/run-20260707-130600-beepboop-full/summary.md.\n");
  assert.ok(has(r, "stray marker"));
  assert.match(r.stdout, /transcript run-id/);
  assert.notEqual(r.status, 0);
});

test("flags a literal canonical run-id (lights-out)", () => {
  const r = runOne("The run-20260707-130600-lights-out ledger recorded the outcome.\n");
  assert.ok(has(r, "stray marker"));
  assert.match(r.stdout, /transcript run-id/);
  assert.notEqual(r.status, 0);
});

test("FP-guard: the letter-template canonical run-id shape (documentation, no real digits) is NOT a stray marker", () => {
  const r = runOne("Mint the run directory as `run-YYYYMMDD-HHMMSS-beepboop-<mode>`.\n");
  assert.equal(has(r, "stray marker"), false, "a placeholder template must not read as a pasted transcript id");
});

// FAFF-757: the beep-boop prose mint now appends an entropy suffix after <mode> — the
// letter-template placeholder shape (still no real digits) must keep passing the FP-guard.
test("FP-guard: the entropy-suffixed letter-template run-id shape is NOT a stray marker", () => {
  const r = runOne("Mint the run directory as `run-YYYYMMDD-HHMMSS-beepboop-<mode>-<entropy>`.\n");
  assert.equal(has(r, "stray marker"), false, "an entropy-suffixed placeholder template must not read as a pasted transcript id");
});

// FAFF-757: a REAL literal run-id carrying the new entropy suffix must still be flagged —
// STRAY_TRANSCRIPT's `\b` after (?:beepboop|lights-out) is unanchored, so it already
// tolerates a trailing `-<hex>` without a regex change; this pins that behaviour down.
test("flags a literal canonical run-id with an entropy suffix (beepboop)", () => {
  const r = runOne("Calibrated against .faff/runs/run-20260707-130600-beepboop-full-5c010e/summary.md.\n");
  assert.ok(has(r, "stray marker"));
  assert.match(r.stdout, /transcript run-id/);
  assert.notEqual(r.status, 0);
});

test("flags a literal canonical run-id with an entropy suffix (lights-out)", () => {
  const r = runOne("The run-20260707-130600-lights-out-5c010e ledger recorded the outcome.\n");
  assert.ok(has(r, "stray marker"));
  assert.match(r.stdout, /transcript run-id/);
  assert.notEqual(r.status, 0);
});

test("FP-guard: a load-bearing FAFF-NN reference is NOT a stray marker", () => {
  const r = runOne("The producer emits its contract block (FAFF-109); see gateway → Contract loading.\n");
  assert.equal(has(r, "stray marker"), false, "issue-tag anchors are load-bearing, not war-stories");
});

test("flags a duplicated block shared across two skills", () => {
  const block = Array.from({ length: 6 }, (_, i) =>
    `This is a substantial shared sentence number ${i} that exceeds the significance length.`).join("\n");
  const r = runOnFixtures({ "zz-charter-a": block + "\n", "zz-charter-b": block + "\n" });
  assert.ok(has(r, "duplicated block"), "an identical 6-line block across two skills should be flagged");
  assert.notEqual(r.status, 0);
});

test("FP-guard: the same block within ONE skill is not a cross-file duplicate", () => {
  const block = Array.from({ length: 6 }, (_, i) =>
    `This is a substantial shared sentence number ${i} that exceeds the significance length.`).join("\n");
  const r = runOne(block + "\n\n" + block + "\n");
  assert.equal(has(r, "duplicated block"), false, "dedup is cross-file only");
});

// FAFF-112 — the negative case FAFF-92 deferred: a REGISTRY-matched, slot-named skill that
// FAILS its type-specific `checksFor` check (exit 1), complementing FAFF-92's PASS coverage.
// The fixture is named `faffter-noon-spec` (a producer-spec REGISTRY entry) so the linter
// selects the producer-spec type-checks; the body keeps `user-invocable: false` + "confidence"
// present and omits ONLY the `faff-contract:spec-readiness` block, so exactly one check fails
// and the FAIL is unambiguously the type-specific contract-block check, not an incidental trip.
const NON_CONFORMANT_SPEC = [
  "---",
  "user-invocable: false", // => the universal user-invocable check PASSES
  "---",
  "# faffter-noon-spec (non-conformant fixture)",
  "",
  "This crafted producer-spec fixture emits a confidence self-rating but deliberately",
  "omits its contract block, so the type-specific producer-spec check is the one that fails.",
  "",
].join("\n");

// Positive control: the SAME harness + fixture name, but a conformant body (it DOES carry the
// contract block) passes. Proves the negative FAIL above is the omitted block, not a temp-dir
// artifact. Double-quoted strings hold the ``` fences literally — no backtick escaping needed.
const CONFORMANT_SPEC = [
  "---",
  "user-invocable: false",
  "judgement_seam: confidence, marker, specqual", // FAFF-281 C1: a registry surface must declare its seam (FAFF-241 added specqual)
  "---",
  "# faffter-noon-spec (conformant fixture)",
  "",
  "This producer-spec fixture emits a confidence self-rating and its contract block below.",
  "",
  "```faff-contract:spec-readiness",
  '{ "confidence": "high", "decisions": [] }',
  "```",
  "",
].join("\n");

test("FAFF-112: flags a non-conformant slot-named skill with a type-specific FAIL (exit 1)", () => {
  const r = runOnFixtures({ "faffter-noon-spec": NON_CONFORMANT_SPEC });
  assert.notEqual(r.status, 0, "a registered slot skill failing a type check must exit non-zero");
  assert.ok(has(r, "producer-spec"), "the FAIL line must be tagged with the (producer-spec) kind");
  assert.match(r.stdout, /faff-contract:spec-readiness/,
    "the specific failing check (the omitted contract block) must be surfaced");
  assert.match(r.stdout, /RESULT:\s*FAIL/, "the overall result line must be FAIL");
});

test("FAFF-112 positive control: a conformant slot-named skill passes (exit 0)", () => {
  const r = runOnFixtures({ "faffter-noon-spec": CONFORMANT_SPEC });
  assert.equal(r.status, 0, "a conformant producer-spec fixture must exit 0");
  assert.match(r.stdout, /pass\s+faffter-noon-spec \(producer-spec\)/,
    "the conformant fixture must be reported as a producer-spec pass");
});

// FAFF-439 — a concurrency executor (REGISTRY `type: "mechanism"`) must declare a turn-safe
// dispatch posture: the Agent tool backgrounds by default, so an omitted posture lets the
// orchestrator end its turn with a build still in flight (idle-reaped mid-work). Two valid arms:
// foreground `run_in_background: false` (sequential) OR a "never end a turn" await-all gate
// (parallel). The check is one two-arm case-insensitive substring lint in the mechanism case;
// `SLOT_TYPES.concurrency` routes third-party occupants through the same check. Fixtures are named
// after the REGISTRY concurrency entries so the mechanism type-checks fire; MECH_BASE carries the
// other required mechanism phrases so the turn-safe line is the only posture check in play.
// Assertions key on the specific failure LABEL, not overall exit, to stay robust to unrelated checks.
const MECH_BASE = [
  "---",
  "user-invocable: false",
  "judgement_seam: none",
  "---",
  "# mechanism fixture",
  "",
  "Refers back to the gateway Mechanism slots / slot contract; never weakens the merge gate;",
  "records every terminal outcome to the run ledger.",
  "",
].join("\n");
const POSTURE = /turn-safe dispatch posture/;

test("FAFF-439: a concurrency executor missing both posture phrases fails the turn-safe check", () => {
  const r = runOnFixtures({ "faffter-noon-concurrency-sequential": MECH_BASE + "\n" });
  assert.match(r.stdout, POSTURE, "the turn-safe posture failure must be reported");
  assert.notEqual(r.status, 0);
});

test("FAFF-439: `run_in_background: false` satisfies the turn-safe check (foreground arm)", () => {
  const body = MECH_BASE + "\nDispatch the build subagent with run_in_background: false.\n";
  const r = runOnFixtures({ "faffter-noon-concurrency-sequential": body });
  assert.doesNotMatch(r.stdout, POSTURE, "the foreground pin must pass the posture check");
});

test("FAFF-439: `never end a turn` satisfies the turn-safe check (await-all arm)", () => {
  const body = MECH_BASE + "\nThe await-all gate: never end a turn with builds in flight.\n";
  const r = runOnFixtures({ "faffter-dark-concurrency-parallel": body });
  assert.doesNotMatch(r.stdout, POSTURE, "the await-all gate phrase must pass the posture check");
});

test("FAFF-439: the turn-safe check is case-insensitive (`Never end a turn`)", () => {
  const body = MECH_BASE + "\nThe await-all gate: Never end a turn with builds in flight.\n";
  const r = runOnFixtures({ "faffter-dark-concurrency-parallel": body });
  assert.doesNotMatch(r.stdout, POSTURE, "capitalised `Never end a turn` must still pass");
});

// --- FAFF-584: line-cap downward ratchet -----------------------------------------------------

// Fixtures below use "faff-beep-boop" (a SKILL_LINE_BASELINE key with no name-specific content
// checks) rather than "faff-graft", whose real skill carries an UNRELATED name-keyed lint (the
// FAFF-491/530 build-phase foreground-posture anchor check) that would false-fail a minimal fixture.
test("FAFF-584: a baselined fixture at exactly its baseline plus one line FAILs the line cap", () => {
  const cap = SKILL_LINE_BASELINE["faff-beep-boop"];
  const body = Array.from({ length: cap + 1 }, (_, i) => `beep-boop line ${i}`).join("\n");
  const r = runOne(body, "faff-beep-boop");
  assert.ok(has(r, "line cap"), "one line over a baselined file's ratchet should FAIL");
  assert.match(r.stdout, new RegExp(`${cap + 1} lines \\(cap ${cap}\\)`));
  assert.notEqual(r.status, 0);
});

test("FAFF-584: a baselined fixture below its baseline gets a non-failing RATCHET advisory", () => {
  // a faff-* fixture name also pulls in the unrelated FAFF-54 rendering-pass content check and the
  // FAFF-884 turn-survival anchor check (faff-beep-boop is an ANCHOR_PHRASES skill); satisfy both with
  // a harmless rendering_adaptor mention + the turn-survival anchors so this test isolates the RATCHET
  // behaviour alone.
  const r = runOne("This fixture routes through the rendering_adaptor. never end a turn with an in-flight marker open; turncheck refuses a non-terminal turn-end.\n\none line only\n", "faff-beep-boop");
  assert.match(r.stdout, /RATCHET\s+faff-beep-boop/, "a baselined file below its baseline should print a RATCHET advisory");
  assert.equal(has(r, "line cap"), false, "shrinking below baseline must not FAIL");
  assert.equal(r.status, 0, "a RATCHET advisory alone must not force a non-zero exit");
});

// --- FAFF-584: paragraph cap counts bold-lead bullets (WARN, house style no longer exempt) -----

test("FAFF-584: a 260-word bold-lead bullet WARNs the paragraph cap without forcing a non-zero exit", () => {
  // "- **Foo.**" itself contributes 2 whitespace-split tokens; 258 filler words brings the total to 260.
  const words = Array.from({ length: 258 }, () => "word").join(" ");
  const r = runOne(`- **Foo.** ${words}\n`);
  assert.match(r.stdout, /WARN\s+.*\(paragraph\).*260-word bold-lead bullet/, "a bold-lead bullet over cap should WARN");
  assert.equal(has(r, "paragraph") && /FAIL/.test(r.stdout), false, "the bold-lead-bullet WARN must not also FAIL");
  assert.equal(r.status, 0, "a bold-lead-bullet WARN alone must not force a non-zero exit");
});

test("FAFF-584: a 260-word non-bullet prose line still FAILs the paragraph cap (plain-prose teeth retained)", () => {
  const words = Array.from({ length: 260 }, () => "word").join(" ");
  const r = runOne(`${words}\n`);
  assert.ok(has(r, "paragraph"), "a 260-word plain-prose line should still FAIL");
  assert.match(r.stdout, /FAIL.*\(paragraph\)/);
  assert.notEqual(r.status, 0);
});

// --- FAFF-584: anchor heading-existence lint (WARN) ---------------------------------------------

test("FAFF-584: an anchor whose target matches a real heading emits no anchor warning", () => {
  const r = runOne("## Automation eligibility\n\nsee gateway → **Automation eligibility**\n");
  assert.equal(/\(anchor\)/.test(r.stdout), false, "an exact-match anchor must not warn");
});

test("FAFF-584: an anchor whose leaf is a word-boundary prefix of a longer heading resolves", () => {
  const r = runOne("## Next-step transition — consult faff next\n\nsee gateway → **Next-step transition**\n");
  assert.equal(/\(anchor\)/.test(r.stdout), false, "a whole-word-prefix anchor must not warn");
});

test("FAFF-584: a mid-word (non-word-boundary) prefix does NOT resolve — negative lenience boundary", () => {
  const r = runOne("## Parking lot\n\nsee gateway → **Park**\n");
  assert.match(r.stdout, /WARN\s+.*\(anchor\)/, "\"Park\" must not spuriously resolve against \"Parking lot\"");
});

test("FAFF-584: an anchor with no matching heading anywhere WARNs, without forcing a non-zero exit", () => {
  const r = runOne("see gateway → **Nonexistent Section**\n");
  assert.match(r.stdout, /WARN\s+.*\(anchor\).*Nonexistent Section/);
  assert.equal(r.status, 0, "an anchor WARN alone must not force a non-zero exit");
});

test("FAFF-584: two identical headings in one fixture file WARN as an ambiguous anchor", () => {
  const r = runOne("## Routing\n\nsome text\n\n## Routing\n\nmore text\n");
  assert.match(r.stdout, /WARN\s+.*\(ambiguous anchor\)/);
});

test("FAFF-584: .example lines are exempt from the anchor lint", () => {
  const r = runOne("see gateway → **Nonexistent Section** .example\n");
  assert.equal(/\(anchor\)/.test(r.stdout), false, ".example lines must be skipped, mirroring every other per-line lint");
});

// FAIL-only (not WARN) severity check: `has()` matches any "(category)" occurrence regardless of
// verb, and FAFF-584's paragraph check now legitimately WARNs on 15 pre-existing bold-lead bullets
// on the real tree (the ticket's own point — visible, non-blocking) — a blanket `has()` would
// false-fail this regression guard on exactly the advisory it's meant to introduce.
const hasFail = (r, category) => new RegExp(`^FAIL\\s+\\S.*\\(${category}\\)`, "m").test(r.stdout);

// Adversarial-review follow-up (Phase 2, FAFF-584): the FAIL-absence check above proves the real
// hub files aren't OVER their baseline, but says nothing about headroom creeping back in below it —
// a baseline raised above the file's actual size would print a silent (non-failing) RATCHET advisory
// forever, unnoticed, defeating the zero-headroom invariant without ever going red. Assert directly
// that the two hub files sit AT their baseline (no RATCHET) on the real tree.
test("FAFF-584: the two hub files' real committed size sits exactly at their SKILL_LINE_BASELINE (zero headroom, no RATCHET)", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  for (const name of ["faff", "faff-beep-boop"]) {
    assert.equal(new RegExp(`RATCHET\\s+${name}\\b`).test(r.stdout), false,
      `${name}'s SKILL_LINE_BASELINE entry should equal its exact committed size — a RATCHET advisory means the baseline has headroom above the real file`);
  }
});

test("regression guard: the real shipped tree passes every charter rule clean", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  for (const cat of ["line cap", "paragraph", "stray marker", "duplicated block"]) {
    assert.equal(hasFail(r, cat), false, `shipped tree should pass the '${cat}' charter rule`);
  }
  assert.equal(r.status, 0, "validate-adapters is green on the shipped tree");
});

test("FAFF-584: the real gateway's duplicate ## Routing has been deduped — no ambiguous-anchor WARN", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  // Scoped to the "Routing" heading specifically — other pre-existing, out-of-scope ambiguous
  // headings elsewhere in the tree are not this ticket's concern (WARN-severity, non-blocking).
  assert.equal(/heading "Routing"/.test(r.stdout), false, "the gateway's ## Routing / ## Routing fallbacks split must not read as ambiguous");
});
