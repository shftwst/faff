// FAFF-513 — SUT scaffolders self-labelling lights-out-eligible must actually clear the L4
// `faff lights-out --check` dial-coherence gate. A static heredoc-text lint (no Docker, no
// scaffolding to disk — mirrors the repo's other test/*.mjs, runs under plain `node --test`).
// The class-fix: this is the durable guard that stops the P1/P2/P3-vs-.faffrc.yaml drift
// (FAFF-513) recurring — a future occupant rename or a new lights-out-labelled scaffolder
// that forgets a dial fails loud here, not silently in an operator's RUNBOOK.
//
// FAFF-524 extended this file: FAFF-522 shipped (fail-closed is now `gates.fallback`'s
// DEFAULT), so the P1/P2/P3 heredocs DROP the explicit `gates.fallback: fail-closed` line —
// dial-coherence now checks only the two remaining explicit dials (`slots.review`,
// `slots.spec_review`) here; the third leg is asserted default-covered, not heredoc-present.
// FAFF-524 also added three new runtime-hole invariants: the `.env.claude-box` box-env secret
// must be gitignored in every L4-eligible scaffolder, a `faffter_dark.adversarial` legacy-shape
// backend block must be emitted, and (P2 only) the PRD moves under `docs/prd/` with a matching
// `tracking.container`.
//
// Expected strings are SOURCED from lights-out.js's own dial-coherence allowlists
// (ADVERSARIAL_REVIEW_OCCUPANTS / ADVERSARIAL_SPEC_REVIEW_OCCUPANTS), not hand-copied, so a
// future occupant rename surfaces here automatically. The third dial — gates.fallback — has no
// exported constant (dialCoherence checks the literal token `"fail-closed"` inline,
// lights-out.js:251); FAIL_CLOSED_TOKEN below mirrors that literal (used only to assert its
// ABSENCE from the P1/P2/P3 heredocs post-FAFF-524, and its continued absence from P4/P5).

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

// Extract the body of the first `cat > <file> <<'EOF' ... EOF` heredoc in a scaffolder script
// writing the given target path. Returns null if no such heredoc is present.
function extractHeredoc(scriptText, target) {
  const re = new RegExp(`cat > ${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} <<'EOF'\\n([\\s\\S]*?)\\nEOF`);
  const m = scriptText.match(re);
  return m ? m[1] : null;
}

function extractFaffrcHeredoc(scriptText) {
  return extractHeredoc(scriptText, ".faffrc.yaml");
}

function extractGitignoreHeredoc(scriptText) {
  return extractHeredoc(scriptText, ".gitignore");
}

// Pure checker over an already-extracted .faffrc.yaml heredoc body: returns the array of the
// two EXPLICIT L4 dial names MISSING (whitespace-tolerant regex per dial). Post-FAFF-524,
// gates.fallback is no longer an explicit-presence dial — see hasExplicitGatesFallback below.
function missingDials(body) {
  const missing = [];
  if (!new RegExp(`review:\\s*${REVIEW_OCCUPANT}\\b`).test(body)) missing.push("slots.review");
  if (!new RegExp(`spec_review:\\s*${SPEC_REVIEW_OCCUPANT}\\b`).test(body)) missing.push("slots.spec_review");
  return missing;
}

// Whether the heredoc body carries an explicit `gates:\n  fallback: fail-closed` (or similar
// whitespace) line — FAFF-524 requires this be ABSENT from P1/P2/P3 (fail-closed is now the
// default, so an explicit line is a restated default) and it was already absent from P4/P5.
function hasExplicitGatesFallback(body) {
  return new RegExp(`fallback:\\s*${FAIL_CLOSED_TOKEN}\\b`).test(body);
}

function hasEnvClaudeBoxGitignored(gitignoreBody) {
  return /^\.env\.claude-box\s*$/m.test(gitignoreBody || "");
}

function hasAdversarialBackendBlock(faffrcBody) {
  return /faffter_dark:\s*\n\s*adversarial:/.test(faffrcBody || "");
}

test("P1/P2/P3 heredocs carry both explicit L4 lights-out dials (review + spec_review)", () => {
  for (const name of ELIGIBLE) {
    const body = extractFaffrcHeredoc(readScript(name));
    assert.ok(body, `${name}: no .faffrc.yaml heredoc found`);
    const missing = missingDials(body);
    assert.deepEqual(missing, [], `${name}: missing dial(s): ${missing.join(", ")}`);
  }
});

test("P1/P2/P3 heredocs carry NO explicit gates.fallback line (fail-closed is the default post-FAFF-522)", () => {
  for (const name of ELIGIBLE) {
    const body = extractFaffrcHeredoc(readScript(name));
    assert.ok(body, `${name}: no .faffrc.yaml heredoc found`);
    assert.ok(!hasExplicitGatesFallback(body), `${name}: still carries an explicit gates.fallback: fail-closed line — FAFF-522 made it the default, restating it is the leg FAFF-524 removes`);
  }
});

test("P1/P2/P3 heredocs carry no residual single-model review occupant", () => {
  for (const name of ELIGIBLE) {
    const body = extractFaffrcHeredoc(readScript(name));
    assert.ok(!/review:\s*faffter-noon-review\b/.test(body), `${name}: residual faffter-noon-review still present`);
  }
});

test("P1/P2/P3 .gitignore heredocs cover .env.claude-box", () => {
  for (const name of ELIGIBLE) {
    const body = extractGitignoreHeredoc(readScript(name));
    assert.ok(body, `${name}: no .gitignore heredoc found`);
    assert.ok(hasEnvClaudeBoxGitignored(body), `${name}: .env.claude-box is not gitignored`);
  }
});

test("P1/P2/P3 .gitignore heredoc precedes the box-env copy step (never staged)", () => {
  for (const name of ELIGIBLE) {
    const text = readScript(name);
    const gitignoreIdx = text.indexOf("cat > .gitignore <<'EOF'");
    const copyIdx = text.indexOf(".env.claude-box");
    // .env.claude-box's FIRST mention must be inside the .gitignore heredoc itself, i.e. the
    // gitignore write precedes any copy-step mention of the file.
    assert.ok(gitignoreIdx >= 0, `${name}: no .gitignore heredoc found`);
    assert.ok(copyIdx >= 0, `${name}: .env.claude-box never mentioned`);
    assert.ok(gitignoreIdx < copyIdx, `${name}: .env.claude-box is referenced before .gitignore is written — secret-staging ordering risk`);
  }
});

test("P1/P2/P3 heredocs emit a faffter_dark.adversarial backend block, keyed via .env.claude-box", () => {
  for (const name of ELIGIBLE) {
    const body = extractFaffrcHeredoc(readScript(name));
    assert.ok(hasAdversarialBackendBlock(body), `${name}: no faffter_dark.adversarial block found`);
    assert.match(body, /provider:\s*nvidia/, `${name}: adversarial block missing an nvidia provider`);
    assert.match(body, /api_key_env:\s*NVIDIA_API_KEY/, `${name}: adversarial block missing NVIDIA_API_KEY`);
    assert.match(body, /provider:\s*gemini/, `${name}: adversarial block missing a gemini fallback`);
    assert.match(body, /api_key_env:\s*GEMINI_API_KEY/, `${name}: adversarial block missing GEMINI_API_KEY`);
  }
});

test("P2's PRD is emitted at docs/prd/task-api.md (not root PRD.md), with a matching tracking.container", () => {
  const text = readScript("scaffold-p2-task-api.sh");
  assert.ok(!/cat > PRD\.md <<'EOF'/.test(text), "scaffold-p2-task-api.sh: still writes a root PRD.md heredoc");
  const prdBody = extractHeredoc(text, "docs/prd/task-api.md");
  assert.ok(prdBody, "scaffold-p2-task-api.sh: no docs/prd/task-api.md heredoc found");
  assert.match(prdBody, /^#\s*PRD\s*[—-]/m, "docs/prd/task-api.md: missing the '# PRD — ' title faff prd list matches on");
  assert.match(prdBody, /Container:\*\*\s*task-api/, "docs/prd/task-api.md: missing a Container: task-api metadata line");

  const faffrcBody = extractFaffrcHeredoc(text);
  assert.match(faffrcBody, /container:\s*task-api/, "scaffold-p2-task-api.sh: .faffrc.yaml missing tracking.container: task-api");
});

test("P1/P3 keep their brief at root (no PRD relocation) and P2 has no residual root PRD.md reference in RUNBOOK/BRIEF", () => {
  for (const name of ["scaffold-p1-link-shortener.sh", "scaffold-p3-landing-page.sh"]) {
    const text = readScript(name);
    assert.match(text, /cat > BRIEF\.md <<'EOF'/, `${name}: expected an unchanged root BRIEF.md heredoc`);
  }
  const p2Text = readScript("scaffold-p2-task-api.sh");
  // Scope the staleness check to the two prose deliverables an operator actually reads
  // (BRIEF.md / RUNBOOK.md) — script-level comments are free to say "a root-level PRD.md" when
  // explaining WHY the file moved (FAFF-524), which a whole-script scan would misflag.
  for (const heredocTarget of ["BRIEF.md", "RUNBOOK.md"]) {
    const body = extractHeredoc(p2Text, heredocTarget);
    assert.ok(body, `scaffold-p2-task-api.sh: no ${heredocTarget} heredoc found`);
    const staleRefs = [...body.matchAll(/(?<!docs\/prd\/)\bPRD\.md\b/g)];
    assert.deepEqual(staleRefs.map((m) => m[0]), [], `scaffold-p2-task-api.sh ${heredocTarget}: stale bare PRD.md reference(s) found outside docs/prd/`);
  }
});

test("P4/P5 heredocs do NOT claim either explicit L4 dial, nor an explicit gates.fallback line", () => {
  for (const name of GATED) {
    const body = extractFaffrcHeredoc(readScript(name));
    assert.ok(body, `${name}: no .faffrc.yaml heredoc found`);
    const missing = missingDials(body);
    assert.deepEqual(missing.sort(), ["slots.review", "slots.spec_review"],
      `${name}: expected both explicit L4 dials absent (gated SUT), got missing=${missing.join(", ")}`);
    assert.ok(!hasExplicitGatesFallback(body), `${name}: unexpectedly carries an explicit gates.fallback: fail-closed line`);
  }
});

test("P4/P5 have no .env.claude-box copy step and no faffter_dark.adversarial block", () => {
  for (const name of GATED) {
    const text = readScript(name);
    assert.ok(!text.includes(".env.claude-box"), `${name}: unexpectedly references .env.claude-box`);
    const body = extractFaffrcHeredoc(text);
    assert.ok(!hasAdversarialBackendBlock(body), `${name}: unexpectedly carries a faffter_dark.adversarial block`);
  }
});

test('P4/P5 scripts still carry a "not lights-out"/"gated" marker', () => {
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

test("missingDials / hasExplicitGatesFallback fail loud naming the missing/residual dial (spot-check a deliberate removal)", () => {
  const full = [
    "slots:",
    `  review: ${REVIEW_OCCUPANT}`,
    `  spec_review: ${SPEC_REVIEW_OCCUPANT}`,
  ].join("\n");
  assert.deepEqual(missingDials(full), [], "sanity: a complete synthetic body reports no missing dials");
  assert.ok(!hasExplicitGatesFallback(full), "sanity: a synthetic body with no gates: block has no explicit gates.fallback");

  const droppedSpecReview = full.replace(`  spec_review: ${SPEC_REVIEW_OCCUPANT}`, "");
  assert.deepEqual(missingDials(droppedSpecReview), ["slots.spec_review"]);

  const droppedAll = "slots:\n  methodology: faffter-dark-methodology-agile-delivery";
  assert.deepEqual(missingDials(droppedAll).sort(), ["slots.review", "slots.spec_review"]);

  const withExplicitFallback = `${full}\ngates:\n  fallback: ${FAIL_CLOSED_TOKEN}`;
  assert.ok(hasExplicitGatesFallback(withExplicitFallback), "sanity: an explicit gates.fallback: fail-closed line is detected");
});
