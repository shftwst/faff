// FAFF-1052 (Rev 6, QA-major-2) — closes the "occupant stops recording after round 1"
// recurrence BEHAVIOURALLY, not only by a static prose match against faffter-dark-spec-
// review/SKILL.md. This extracts the occupant's own fenced bash capture snippet VERBATIM
// (the house idiom test/spec-review-dispatch-resolution.test.mjs already established for
// occupant prose) and drives it through a real shell against the real `faff` binary, so a
// future edit that reintroduces a conditional skip on round >= 2 fails THIS test even if
// the static SKILL-wiring lint in test/spec-review-pin.test.mjs is somehow satisfied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { backendIdentity } from "../plugin/skills/faff/bin/lib/spec-review-pin.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const OCCUPANT_SKILL = join(REPO, "plugin", "skills", "faffter-dark-spec-review", "SKILL.md");
const FAFF_BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const BACKENDS = [
  { provider: "openai", model: "mA", host: "https://a/v1" },
  { provider: "nvidia", model: "mB", host: "https://b/v1" },
];

// Extract the occupant's own fenced ```bash ... ``` capture snippet (the block immediately
// following the served/no-lens-served bullet list) VERBATIM — this is what makes the test a
// real regression check on the SKILL's actual documented behaviour, not a re-implementation
// that could silently drift from it.
function extractCaptureSnippet() {
  const body = readFileSync(OCCUPANT_SKILL, "utf8");
  const marker = "The unconditional capture call";
  const idx = body.indexOf(marker);
  assert.ok(idx >= 0, "occupant SKILL still documents the unconditional capture call snippet");
  const fenceStart = body.lastIndexOf("```bash", idx);
  const fenceEnd = body.indexOf("```", idx);
  assert.ok(fenceStart >= 0 && fenceEnd > fenceStart, "found the fenced bash block around the marker");
  return body.slice(fenceStart + "```bash".length, fenceEnd);
}

function runSnippet(snippet, vars, scratch) {
  const preamble = Object.entries(vars).map(([k, v]) => `${k}=${JSON.stringify(String(v))}`).join("\n");
  const script = `set -e\nfaff="${FAFF_BIN}"\n${preamble}\n${snippet}\n`;
  const r = spawnSync("/bin/sh", ["-c", script], { encoding: "utf8", cwd: scratch });
  return r;
}

test("occupant dispatch (extracted verbatim from SKILL.md): round >= 2 idempotent no-op capture STILL writes served-<n>.json", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-occ-dispatch-"));
  const snippet = extractCaptureSnippet();
  try {
    const backendsJson = join(scratch, "backends.json");
    writeFileSync(backendsJson, JSON.stringify(BACKENDS));
    const pinDir = join(scratch, "pin");

    // Round 1: served, winner_index 0 -> captures the pin.
    const r1 = runSnippet(snippet, { pin_dir: pinDir, backends_json: backendsJson, winner_index: 0, n: 1, served_count: 1 }, scratch);
    assert.equal(r1.status, 0, `round 1 dispatch failed: ${r1.stderr}`);
    assert.ok(existsSync(join(pinDir, "pinned-reviewer.json")), "round 1 pinned the reviewer");
    assert.ok(existsSync(join(pinDir, "served-1.json")), "round 1 recorded its served identity");

    // Round 2: served by a DIFFERENT backend (winner_index 1) — the pin write is an
    // idempotent no-op (pin already exists), but this is the exact regression FAFF-996
    // exhibited: served-2.json must STILL be written so a later --govern can detect the swap.
    const r2 = runSnippet(snippet, { pin_dir: pinDir, backends_json: backendsJson, winner_index: 1, n: 2, served_count: 1 }, scratch);
    assert.equal(r2.status, 0, `round 2 dispatch failed: ${r2.stderr}`);
    const pinAfter = JSON.parse(readFileSync(join(pinDir, "pinned-reviewer.json"), "utf8"));
    assert.deepEqual(pinAfter, BACKENDS[0], "the pin is unchanged (idempotent no-op) after round 2");
    assert.ok(existsSync(join(pinDir, "served-2.json")), "round 2 STILL recorded served-2.json despite the idempotent pin no-op");
    const served2 = JSON.parse(readFileSync(join(pinDir, "served-2.json"), "utf8"));
    assert.equal(served2.served_identity, backendIdentity(BACKENDS[1]), "served-2.json names round 2's ACTUAL served backend");

    // And a later --govern reads a served identity for round 2 rather than falling into the
    // pin-present-no-served-identity exit-2 / unpinnable fail-safe.
    const gov = spawnSync(FAFF_BIN, ["spec-review-window", "--govern", "--dir", pinDir, "--round", "2", "--any-served"], { encoding: "utf8" });
    assert.equal(gov.status, 0, `--govern should succeed once served-2.json exists: ${gov.stderr}`);
    const result = JSON.parse(gov.stdout);
    assert.equal(result.action, "swap-reset", "the swap is detected because served-2.json diverges from the pin");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("occupant dispatch (extracted verbatim from SKILL.md): the no-lens-served branch fires when served_count is 0", () => {
  const scratch = mkdtempSync(join(tmpdir(), "faff-occ-dispatch-nolens-"));
  const snippet = extractCaptureSnippet();
  try {
    const pinDir = join(scratch, "pin");
    const r = runSnippet(snippet, { pin_dir: pinDir, backends_json: "/nonexistent", winner_index: 0, n: 1, served_count: 0 }, scratch);
    assert.equal(r.status, 0, `no-lens dispatch failed: ${r.stderr}`);
    assert.equal(existsSync(join(pinDir, "pinned-reviewer.json")), false, "no pin written on the empty exit-0 set");
    const cap = JSON.parse(readFileSync(join(pinDir, "pin-capture.json"), "utf8"));
    assert.equal(cap.state, "skipped-no-lens");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
