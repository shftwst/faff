// FAFF-513 — SUT scaffolders self-labelling lights-out-eligible must actually clear the L4
// `faff lights-out --check` dial-coherence gate. A static heredoc-text lint (no Docker, no
// scaffolding to disk — mirrors the repo's other test/*.mjs, runs under plain `node --test`).
// The class-fix: this is the durable guard that stops the P1/P2/P3-vs-.faffrc.yaml drift
// (FAFF-513) recurring — a future occupant rename or a new lights-out-labelled scaffolder
// that forgets a dial fails loud here, not silently in an operator's RUNBOOK.
//
// Expected strings are SOURCED from lights-out.js's own dial-coherence allowlists
// (ADVERSARIAL_REVIEW_OCCUPANTS / ADVERSARIAL_SPEC_REVIEW_OCCUPANTS), not hand-copied, so a
// future occupant rename surfaces here automatically. The third dial — gates.fallback —
// has no exported constant (dialCoherence checks the literal token `"fail-closed"` inline,
// lights-out.js:251); FAIL_CLOSED_TOKEN below mirrors that literal.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADVERSARIAL_REVIEW_OCCUPANTS,
  ADVERSARIAL_SPEC_REVIEW_OCCUPANTS,
} from "../plugin/skills/faff/bin/lib/lights-out.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const EV_DIR = path.join(REPO, "docs", "external-verification");

// The allowlists are Sets of exactly one occupant each today (FAFF-513's fix target); take the
// sole member rather than hardcoding the string literal.
const REVIEW_OCCUPANT = [...ADVERSARIAL_REVIEW_OCCUPANTS][0];
const SPEC_REVIEW_OCCUPANT = [...ADVERSARIAL_SPEC_REVIEW_OCCUPANTS][0];
const FAIL_CLOSED_TOKEN = "fail-closed"; // mirrors the literal Rule (B) checks (lights-out.js:251)

const ELIGIBLE = ["scaffold-p1-link-shortener.sh", "scaffold-p2-task-api.sh", "scaffold-p3-landing-page.sh"];
const GATED = ["scaffold-p4-stripe-testmode.sh", "scaffold-p5-brownfield.sh"];

const NOT_LIGHTS_OUT_RE = /not[\s-]lights-out|NOT lights-out|\bGATED\b/i;

function readScript(name) {
  return fs.readFileSync(path.join(EV_DIR, name), "utf8");
}

// Extract the body of the first `cat > .faffrc.yaml <<'EOF' ... EOF` heredoc in a scaffolder
// script. Returns null if no such heredoc is present (a gated scaffolder without a bare-EOF
// heredoc marker, or a malformed script).
function extractFaffrcHeredoc(scriptText) {
  const m = scriptText.match(/cat > \.faffrc\.yaml <<'EOF'\n([\s\S]*?)\nEOF/);
  return m ? m[1] : null;
}

// Pure checker over an already-extracted heredoc body: returns the array of dial names
// MISSING (whitespace-tolerant regex per dial), empty when all three L4 dials are present.
function missingDials(body) {
  const missing = [];
  if (!new RegExp(`review:\\s*${REVIEW_OCCUPANT}\\b`).test(body)) missing.push("slots.review");
  if (!new RegExp(`spec_review:\\s*${SPEC_REVIEW_OCCUPANT}\\b`).test(body)) missing.push("slots.spec_review");
  if (!new RegExp(`fallback:\\s*${FAIL_CLOSED_TOKEN}\\b`).test(body)) missing.push("gates.fallback");
  return missing;
}

test("P1/P2/P3 heredocs carry all three L4 lights-out dials", () => {
  for (const name of ELIGIBLE) {
    const body = extractFaffrcHeredoc(readScript(name));
    assert.ok(body, `${name}: no .faffrc.yaml heredoc found`);
    const missing = missingDials(body);
    assert.deepEqual(missing, [], `${name}: missing dial(s): ${missing.join(", ")}`);
  }
});

test("P1/P2/P3 heredocs carry no residual single-model review occupant", () => {
  for (const name of ELIGIBLE) {
    const body = extractFaffrcHeredoc(readScript(name));
    assert.ok(!/review:\s*faffter-noon-review\b/.test(body), `${name}: residual faffter-noon-review still present`);
  }
});

test("P4/P5 heredocs do NOT claim any of the three L4 dials", () => {
  for (const name of GATED) {
    const body = extractFaffrcHeredoc(readScript(name));
    assert.ok(body, `${name}: no .faffrc.yaml heredoc found`);
    const missing = missingDials(body);
    assert.deepEqual(missing.sort(), ["gates.fallback", "slots.review", "slots.spec_review"],
      `${name}: expected all three L4 dials absent (gated SUT), got missing=${missing.join(", ")}`);
  }
});

test("P4/P5 scripts still carry a \"not lights-out\"/\"gated\" marker", () => {
  for (const name of GATED) {
    const text = readScript(name);
    assert.match(text, NOT_LIGHTS_OUT_RE, `${name}: no "not lights-out"/"gated" marker found`);
  }
});

test("P1/P2/P3 RUNBOOKs carry a FAFF_INTEGRITY_BOUNDARY operator reminder", () => {
  for (const name of ELIGIBLE) {
    const text = readScript(name);
    assert.match(text, /FAFF_INTEGRITY_BOUNDARY/, `${name}: no FAFF_INTEGRITY_BOUNDARY reminder found`);
  }
});

test("missingDials fails loud naming the missing dial (spot-check a deliberate removal)", () => {
  const full = [
    "slots:",
    `  review: ${REVIEW_OCCUPANT}`,
    `  spec_review: ${SPEC_REVIEW_OCCUPANT}`,
    "gates:",
    `  fallback: ${FAIL_CLOSED_TOKEN}`,
  ].join("\n");
  assert.deepEqual(missingDials(full), [], "sanity: a complete synthetic body reports no missing dials");

  const droppedSpecReview = full.replace(`  spec_review: ${SPEC_REVIEW_OCCUPANT}\n`, "");
  assert.deepEqual(missingDials(droppedSpecReview), ["slots.spec_review"]);

  const droppedGates = full.replace(`gates:\n  fallback: ${FAIL_CLOSED_TOKEN}`, "");
  assert.deepEqual(missingDials(droppedGates), ["gates.fallback"]);

  const droppedAll = "slots:\n  methodology: faffter-dark-methodology-agile-delivery";
  assert.deepEqual(missingDials(droppedAll).sort(), ["gates.fallback", "slots.review", "slots.spec_review"]);
});
