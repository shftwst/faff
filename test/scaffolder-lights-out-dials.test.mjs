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
// must be gitignored in every L4-eligible scaffolder, an `adversarial` legacy-shape
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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  ADVERSARIAL_REVIEW_OCCUPANTS,
  ADVERSARIAL_SPEC_REVIEW_OCCUPANTS,
} from "../plugin/skills/faff/bin/lib/lights-out.js";
import { extractHeredoc } from "./helpers/scaffolder-heredocs.mjs"; // FAFF-538: promoted shared extractor

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const EV_DIR = path.join(REPO, "verification", "external-verification");

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

// extractHeredoc is now imported from ./helpers/scaffolder-heredocs.mjs (FAFF-538) — the regex
// and behaviour are unchanged; the local copy was promoted to a shared helper both scaffolder-lint
// files import.

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
  return /^adversarial:\s*\n\s+\S/m.test(faffrcBody || "");
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
    // Match the ACTUAL cp command line, not just any mention of the filename — the naive
    // text.indexOf(".env.claude-box") this test used pre-FAFF-524 matched the string's occurrence
    // INSIDE the .gitignore heredoc body itself (line 33/34), making gitignoreIdx < copyIdx
    // trivially/tautologically true regardless of where the real copy step lived.
    const copyMatch = text.match(/cp\s+"\$FAFF_ROOT\/\.env\.claude-box"\s+\.env\.claude-box/);
    assert.ok(gitignoreIdx >= 0, `${name}: no .gitignore heredoc found`);
    assert.ok(copyMatch, `${name}: no cp "$FAFF_ROOT/.env.claude-box" .env.claude-box copy step found`);
    const copyIdx = text.indexOf(copyMatch[0]);
    assert.ok(gitignoreIdx < copyIdx, `${name}: the box-env copy step precedes .gitignore being written — secret-staging ordering risk`);
  }
});

test("P1/P2/P3 unstage .env.claude-box (git rm --cached) before git add -A, guarding against a stale-tracked secret", () => {
  for (const name of ELIGIBLE) {
    const text = readScript(name);
    const rmIdx = text.indexOf("git rm --cached --ignore-unmatch .env.claude-box");
    // Anchor to the actual command line (start of line), not any prose mention of "git add -A" —
    // the guard's own explanatory comment above it names both commands.
    const addMatch = text.match(/^git add -A$/m);
    const addIdx = addMatch ? addMatch.index : -1;
    // A prior scaffold over a re-used (FORCE=1) $SUT_ROOT can carry a stale .git where
    // .env.claude-box was already tracked — .gitignore never untracks an already-tracked file,
    // so `git add -A` alone would re-stage the secret and the commit below would carry it
    // forward. The unstage step must run first, unconditionally (FAFF-524 critical fix).
    assert.ok(rmIdx >= 0, `${name}: no "git rm --cached --ignore-unmatch .env.claude-box" unstage guard found`);
    assert.ok(addIdx >= 0, `${name}: no "git add -A" found`);
    assert.ok(rmIdx < addIdx, `${name}: the unstage guard must run BEFORE git add -A`);
  }
});

// Adversarial review (Phase-2 re-run, nvidia glm-5.2) major finding: an earlier version of this
// integration test covered ONLY scaffold-p1-link-shortener.sh — P2/P3 carry the byte-identical
// guard line but a future edit reordering just one of them would pass the (P1-only) behavioral
// proof while silently breaking P2/P3. Parameterised across all three ELIGIBLE scaffolders so the
// guard is behaviorally proven for every scaffolder that claims it, not spot-checked on one.
for (const name of ELIGIBLE) {
  test(`${name}: re-scaffold over a stale .git with .env.claude-box already tracked does NOT leak it into the new commit (integration, actually executes the scaffolder)`, () => {
    const sutRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-stale-scaffold-"));
    try {
      // Simulate the leak precondition: a PRIOR scaffold run (or an old, pre-FAFF-524 version of
      // this script) left .env.claude-box tracked in $SUT_ROOT's git history.
      const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@test", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@test" };
      const run = (args) => spawnSync("git", args, { cwd: sutRoot, env: gitEnv, encoding: "utf8" });
      assert.equal(run(["init", "-q"]).status, 0);
      fs.writeFileSync(path.join(sutRoot, ".env.claude-box"), "NVIDIA_API_KEY=super-secret-stale-value\n");
      assert.equal(run(["add", "-A"]).status, 0);
      assert.equal(run(["commit", "-q", "-m", "stale prior scaffold (simulated leak precondition)"]).status, 0);
      // Precondition check: the secret really is tracked going in.
      const preFiles = run(["ls-files"]).stdout;
      assert.match(preFiles, /\.env\.claude-box/, "test setup did not actually track .env.claude-box");

      // Re-scaffold over it, FORCE=1 (non-empty $SUT_ROOT) — this is the exact re-use path the
      // critical describes. No FAFF_ROOT/.env.claude-box source is provided, so the copy step
      // warns-and-continues; the leak comes from the FILE ALREADY ON DISK from the stale repo,
      // which `git add -A` would otherwise re-stage.
      const scriptPath = path.join(EV_DIR, name);
      // Carry the SAME git identity env into the scaffolder's own `git commit` — a CI runner
      // (or any fresh machine/container) has no global user.name/user.email configured, which
      // makes the scaffolder's `git commit -q -m ... || true` fail SILENTLY (swallowed by the
      // `|| true`, a pre-existing masked-failure the adversarial review separately flagged).
      // Without an identity, HEAD never advances past the stale precondition commit created
      // above, so `git ls-tree HEAD` would still show the OLD (pre-fix) tree and the test would
      // misreport that as a fresh leak, when no new commit was made at all.
      const result = spawnSync("bash", [scriptPath], {
        cwd: sutRoot,
        env: { ...process.env, ...gitEnv, SUT_ROOT: sutRoot, FORCE: "1", PATH: "/usr/bin:/bin:/usr/local/bin" },
        encoding: "utf8",
        // FAFF-715: the scaffolder is a real bash+git process; its FIRST (cold git/filesystem) run
        // measures ~22s even on an idle box. Under the concurrent full `node --test` suite on a
        // contended `validate` runner that cold spawn exceeds a 30s cap and returns a null status,
        // spuriously failing the `result.status === 0` assert below (the `not ok 2317` flake). Size
        // the ceiling to ~5-6x the cold worst case (the FAFF-635 rationale) — generous on a healthy
        // run, yet a genuinely hung scaffolder still trips it. Do NOT tighten back.
        timeout: 120_000,
      });
      assert.equal(result.status, 0, `${name}: scaffolder exited non-zero: ${result.stderr}`);

      const postFiles = run(["ls-files"]).stdout;
      assert.doesNotMatch(postFiles, /\.env\.claude-box/, `${name}: the secret leaked back into the tracked file list on re-scaffold`);

      // git ls-tree walks the committed TREE at HEAD (the file's actual content-bearing presence in
      // the snapshot that would be pushed) — unlike `git show --stat`, which legitimately mentions
      // the filename when it records the file being DELETED (the correct, intended diff here).
      const headTree = run(["ls-tree", "-r", "--name-only", "HEAD"]).stdout;
      assert.doesNotMatch(headTree, /\.env\.claude-box/, `${name}: the secret leaked into the new HEAD commit's tree on re-scaffold`);
    } finally {
      fs.rmSync(sutRoot, { recursive: true, force: true });
    }
  });
}

test("P1/P2/P3 heredocs emit an adversarial backend block, keyed via .env.claude-box", () => {
  for (const name of ELIGIBLE) {
    const body = extractFaffrcHeredoc(readScript(name));
    assert.ok(hasAdversarialBackendBlock(body), `${name}: no adversarial block found`);
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

test("P4/P5 have no .env.claude-box copy step and no adversarial block", () => {
  for (const name of GATED) {
    const text = readScript(name);
    assert.ok(!text.includes(".env.claude-box"), `${name}: unexpectedly references .env.claude-box`);
    const body = extractFaffrcHeredoc(text);
    assert.ok(!hasAdversarialBackendBlock(body), `${name}: unexpectedly carries an adversarial block`);
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

// ---------------------------------------------------------------------------
// FAFF-547 — paste-hygiene guard. Operator intent framing must be structurally
// unable to reach the loop under test: pasting "what the SUT measures" into the
// loop is teaching-to-the-test (the observer changes the observed, a clean pass
// proves nothing). This is a STRUCTURAL allowlist + RELOCATION-verified check,
// NOT a fixed phrase denylist — a denylist only proves N listed strings absent,
// so a re-worded leak (e.g. P1's "zero needs-human punts") ships green. Per
// P1–P4: parse the RUNBOOK loop-entry line → the file(s) it names; assert each
// named loop-facing file carries no `## N. DONE`/rubric heading and (P1/P3 BRIEF)
// only neutral-allowlist headings; assert each captured intent sentence is ABSENT
// from every loop-facing file and PRESENT in the operator-only home (relocation,
// not deletion); assert `## Stack preference` still reaches the loop. The phrase
// backstop below is secondary, NOT the primary signal.

const NEUTRAL_SECTION_ALLOWLIST = ["Stack preference", "What to build", "Scenarios", "Out of scope"];

// Per-SUT config. `expectPaste` is the file set the loop-entry line MUST name
// (also parsed live and cross-checked). `operatorHome` is where relocated intent
// framing must land. `briefAllowlisted` gates the P1/P3 neutral-heading rule.
// `intentSentences` are captured verbatim from today's briefs (maintain as the
// briefs evolve) — ABSENT from every loop-facing file, PRESENT in operatorHome.
const PASTE_HYGIENE = {
  "scaffold-p1-link-shortener.sh": {
    expectPaste: ["BRIEF.md"], operatorHome: "RUNBOOK.md", briefAllowlisted: true,
    intentSentences: ["the code-blind evaluator should produce clean verdicts with zero needs-human punts"],
  },
  "scaffold-p2-task-api.sh": {
    expectPaste: ["docs/prd/task-api.md"], operatorHome: "BRIEF.md", briefAllowlisted: false,
    // Captured as two clauses (not just the opening prefix) so a future edit that
    // relocates only the prefix while leaving the scope-creep/setpoint framing
    // behind is still caught (FAFF-547 adversarial review finding).
    intentSentences: [
      "the interesting behaviour is not the app",
      "converges across waves, and terminates when the stop conditions are met without ever editing the setpoint",
    ],
  },
  "scaffold-p3-landing-page.sh": {
    expectPaste: ["BRIEF.md"], operatorHome: "RUNBOOK.md", briefAllowlisted: true,
    intentSentences: ["green-washing a prose dod as done is the single most dangerous failure in the suite"],
  },
  "scaffold-p4-stripe-testmode.sh": {
    expectPaste: ["PRD.md"], operatorHome: "BRIEF.md", briefAllowlisted: false,
    // Captured as two clauses — see the P2 note above (FAFF-547 adversarial review finding).
    intentSentences: [
      "the interesting behaviour is the safety floor",
      "should surface the secret-store gap rather than papering over it",
    ],
  },
};

// Backstop denylist (SECONDARY — the structural + relocation checks above are the
// primary signal). Seeded from the ACTUAL current framing per FAFF-547 §4 step 4;
// only ever asserted ABSENT from loop-facing files (these markers live legitimately
// in the operator-only homes).
const INTENT_MARKER_BACKSTOP = [
  "the interesting behaviour is",
  "the whole point",
  "teaching-to-the-test",
  "zero needs-human punts",
  "clean verdicts",
  "green-washing",
  "single most dangerous failure",
];

// Collapse whitespace + lowercase + strip markdown emphasis so line-wrapping or a
// trivial **bold**/*italic* formatting edit never hides a match, nor makes the
// present-side relocation check false-fail on semantically-identical prose
// (the captured sentences are compared normalised on both sides — FAFF-547
// adversarial review finding).
function norm(s) { return (s || "").replace(/\*\*?/g, "").replace(/\s+/g, " ").toLowerCase(); }

// Parse a RUNBOOK heredoc's loop-entry line: /faff-jot|plot "<paste FILES>" → the
// file list (separated by "+" and/or whitespace/commas). Generalises to WHATEVER
// files a future loop-entry names (per FAFF-547 §4 failure-mode note).
function parseLoopEntryFiles(runbookBody) {
  const m = (runbookBody || "").match(/\/faff-(?:jot|plot)\s+"<paste\s+([^">]+)>"/);
  if (!m) return null;
  return m[1].split(/\s*\+\s*|\s*,\s*|\s+/).map((f) => f.trim()).filter(Boolean);
}

// Every "## <heading>" heading-text in a heredoc body.
function headings(body) {
  return [...(body || "").matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);
}
function isRubricHeading(h) {
  return /\bN\.\s*DONE\b/i.test(h) || /\b(scoring|rubric)\b/i.test(h);
}
function isAllowlistedHeading(h) {
  return NEUTRAL_SECTION_ALLOWLIST.some((a) => h.startsWith(a));
}

for (const [name, cfg] of Object.entries(PASTE_HYGIENE)) {
  test(`${name}: paste-hygiene — no operator intent framing reaches the loop (FAFF-547 structural + relocation)`, () => {
    const text = readScript(name);
    const runbook = extractHeredoc(text, "RUNBOOK.md");
    assert.ok(runbook, `${name}: no RUNBOOK.md heredoc found`);

    // 1. Parse the loop-entry paste line → the file(s) it names, and cross-check.
    const pasted = parseLoopEntryFiles(runbook);
    assert.ok(pasted, `${name}: no /faff-jot|plot "<paste …>" loop-entry line found in RUNBOOK.md`);
    assert.deepEqual(pasted, cfg.expectPaste,
      `${name}: loop-entry pastes [${pasted.join(", ")}], expected [${cfg.expectPaste.join(", ")}]`);
    if (!cfg.briefAllowlisted) {
      assert.ok(!pasted.includes("BRIEF.md"),
        `${name}: PRD-backed SUT must NOT paste BRIEF.md into the loop`);
    }

    // Operator-only home body — where relocated intent framing must live.
    const homeBody = extractHeredoc(text, cfg.operatorHome);
    assert.ok(homeBody, `${name}: no operator-only ${cfg.operatorHome} heredoc found`);

    for (const file of pasted) {
      const body = extractHeredoc(text, file);
      assert.ok(body, `${name}: loop-facing file ${file} has no heredoc in the script`);
      const hs = headings(body);

      // 2a. No scoring-rubric heading in any loop-facing file.
      const rubric = hs.filter(isRubricHeading);
      assert.deepEqual(rubric, [], `${name}: loop-facing ${file} carries rubric heading(s): ${rubric.join(" | ")}`);

      // 2b. P1/P3 BRIEF.md: every heading is from the neutral-section allowlist.
      if (cfg.briefAllowlisted && file === "BRIEF.md") {
        const stray = hs.filter((h) => !isAllowlistedHeading(h));
        assert.deepEqual(stray, [], `${name}: loop-facing BRIEF.md carries out-of-allowlist heading(s): ${stray.join(" | ")}`);
      }

      // 2c. Positive: the stack preference still reaches the loop.
      assert.ok(hs.some((h) => h.startsWith("Stack preference")),
        `${name}: loop-facing ${file} has no "## Stack preference" — the architecture proposer would regress to an unguided stack pick`);

      // 3. Relocation (absent side): captured intent sentences must NOT appear.
      const nb = norm(body);
      for (const sent of cfg.intentSentences) {
        assert.ok(!nb.includes(norm(sent)),
          `${name}: captured intent sentence leaked into loop-facing ${file}: "${sent}"`);
      }

      // 4. Backstop denylist (secondary): none of the obvious markers in a loop-facing file.
      for (const marker of INTENT_MARKER_BACKSTOP) {
        assert.ok(!nb.includes(norm(marker)),
          `${name}: backstop intent marker "${marker}" found in loop-facing ${file}`);
      }
    }

    // 3. Relocation (present side): captured intent sentences MUST live in the operator home.
    const nh = norm(homeBody);
    for (const sent of cfg.intentSentences) {
      assert.ok(nh.includes(norm(sent)),
        `${name}: captured intent sentence missing from operator-only ${cfg.operatorHome} (relocation must preserve it, not delete it): "${sent}"`);
    }
  });
}

test("parseLoopEntryFiles parses single + multi-file paste lines (spot-check)", () => {
  assert.deepEqual(parseLoopEntryFiles('    /faff-jot   "<paste BRIEF.md>"'), ["BRIEF.md"]);
  assert.deepEqual(parseLoopEntryFiles('    /faff-plot "<paste docs/prd/task-api.md>"'), ["docs/prd/task-api.md"]);
  assert.deepEqual(parseLoopEntryFiles('/faff-plot "<paste BRIEF.md + PRD.md>"'), ["BRIEF.md", "PRD.md"]);
  assert.equal(parseLoopEntryFiles("no loop entry here"), null);
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
