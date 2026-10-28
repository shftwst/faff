// FAFF-1271 — the pure carry classifier: `classifyRefresh` + `normaliseSpec`. A stale-refresh
// whose diff is only a verified directory move, a line reference, the provenance stamp, the
// `build-tier:` line, or the one fixed refresh-note line keeps its prior `spec-review:` line
// instead of re-running the whole Spec-review gate; anything else re-reviews. See
// `plugin/skills/faff/bin/lib/spec-refresh-carry.js` for the full design rationale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRefresh, normaliseSpec, extractPathTokens, extractLineRefTokens } from "../plugin/skills/faff/bin/lib/spec-refresh-carry.js";

// Build a minimal spec with the required stamp/tier/approval/confidence scaffolding plus one
// body line callers vary.
const spec = (bodyLines, { stampDate = "2026-10-10", tier = "standard", confidence = "high", approval = "approve", extra = [] } = {}) => [
  `> Spec: faffter-dark-nlspec . ${stampDate}`,
  "",
  ...bodyLines,
  "",
  ...extra,
  `build-tier: ${tier}`,
  `confidence: ${confidence}`,
  `spec-review: ${approval}`,
].join("\n");

const exists = (...present) => (p) => present.includes(p);

test("verified directory move carries (reason paths-only)", () => {
  const before = spec(["**Chosen:** see docs/design/x.md"]);
  const after = spec(["**Chosen:** see docs/archive/design/x.md"], { stampDate: "2026-10-14" });
  const r = classifyRefresh(before, after, exists("docs/archive/design/x.md"));
  assert.equal(r.carry, true);
  assert.equal(r.reason, "paths-only");
  assert.deepEqual(r.path_moves, [{ before: "docs/design/x.md", after: "docs/archive/design/x.md", verified: true }]);
});

test("move whose old path still exists too → no carry, path-move-unverified", () => {
  const before = spec(["**Chosen:** see docs/design/x.md"]);
  const after = spec(["**Chosen:** see docs/archive/design/x.md"]);
  const r = classifyRefresh(before, after, exists("docs/design/x.md", "docs/archive/design/x.md"));
  assert.equal(r.carry, false);
  assert.equal(r.reason, "path-move-unverified");
  assert.equal(r.path_moves[0].verified, false);
});

test("move where neither path exists → no carry, path-move-unverified", () => {
  const before = spec(["**Chosen:** see docs/design/x.md"]);
  const after = spec(["**Chosen:** see docs/archive/design/x.md"]);
  const r = classifyRefresh(before, after, () => false);
  assert.equal(r.reason, "path-move-unverified");
  assert.equal(r.path_moves[0].verified, false);
});

test("basename rename (same dir) → content-changed, never a verified-move question", () => {
  const before = spec(["**Chosen:** see src/a/foo.js"]);
  const after = spec(["**Chosen:** see src/a/bar.js"]);
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "content-changed");
});

test(":N, #LN and line N references all carry on their own", () => {
  const colonBefore = spec(["see src/a.js:40"]);
  const colonAfter = spec(["see src/a.js:52"], { stampDate: "2026-10-14" });
  assert.equal(classifyRefresh(colonBefore, colonAfter, () => true).carry, true);

  const hashBefore = spec(["see docs/x.md#L10"]);
  const hashAfter = spec(["see docs/x.md#L20"], { stampDate: "2026-10-14" });
  assert.equal(classifyRefresh(hashBefore, hashAfter, () => true).carry, true);

  const wordBefore = spec(["see line 10 of the file"]);
  const wordAfter = spec(["see line 20 of the file"], { stampDate: "2026-10-14" });
  assert.equal(classifyRefresh(wordBefore, wordAfter, () => true).carry, true);

  const pluralBefore = spec(["see lines 10-12 of the file"]);
  const pluralAfter = spec(["see lines 20-22 of the file"], { stampDate: "2026-10-14" });
  assert.equal(classifyRefresh(pluralBefore, pluralAfter, () => true).carry, true);
});

test("one line with both a path and a line-ref change: both counters increment", () => {
  const before = spec(["see docs/design/x.md:40 for it"]);
  const after = spec(["see docs/archive/design/x.md:52 for it"], { stampDate: "2026-10-14" });
  const r = classifyRefresh(before, after, exists("docs/archive/design/x.md"));
  assert.equal(r.carry, true);
  assert.equal(r.changes.paths, 1);
  assert.equal(r.changes.line_refs, 1);
});

test("one line with two path changes: paths increments once, two path_moves", () => {
  const before = spec(["see docs/design/x.md and docs/design/y.md"]);
  const after = spec(["see docs/archive/design/x.md and docs/archive/design/y.md"], { stampDate: "2026-10-14" });
  const r = classifyRefresh(before, after, exists("docs/archive/design/x.md", "docs/archive/design/y.md"));
  assert.equal(r.carry, true);
  assert.equal(r.changes.paths, 1);
  assert.equal(r.path_moves.length, 2);
});

test("stamp date and build-tier change alone → carry (both volatile)", () => {
  const before = spec(["plain body text"], { stampDate: "2026-10-10", tier: "standard" });
  const after = spec(["plain body text"], { stampDate: "2026-10-14", tier: "complex" });
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.carry, true);
  assert.equal(r.reason, "paths-only");
});

test("fixed refresh note added → carries, counted in changes.status_notes", () => {
  const before = spec(["plain body text"]);
  const after = spec(["plain body text"], { stampDate: "2026-10-14", extra: ["> Revised on 2026-10-14: paths refreshed", ""] });
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.carry, true);
  assert.equal(r.changes.status_notes, 1);
});

test("refresh note with extra text → content-changed (not the fixed line)", () => {
  const before = spec(["plain body text"]);
  const after = spec(["plain body text"], {
    stampDate: "2026-10-14",
    extra: ["> Revised on 2026-10-14: paths refreshed, and switched to Postgres", ""],
  });
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "content-changed");
});

test("refresh note without an ISO date → content-changed", () => {
  const before = spec(["plain body text"]);
  const after = spec(["plain body text"], { extra: ["> Revised on sometime: paths refreshed", ""] });
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "content-changed");
});

test("earlier free-text note edited → content-changed", () => {
  const before = spec(["plain body"], { extra: ["> Revised on 2026-09-01: an earlier free-text reason", ""] });
  const after = spec(["plain body"], { extra: ["> Revised on 2026-09-01: a DIFFERENT free-text reason", ""] });
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "content-changed");
});

test("prose edit outside any decision section → content-changed", () => {
  const before = spec(["Some ordinary prose about the feature."]);
  const after = spec(["Some ordinary prose about the FEATURE, reworded."]);
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "content-changed");
});

test("**Chosen:**, **Punt:**, and **Assumes:** line edits → content-changed", () => {
  for (const marker of ["**Chosen:**", "**Punt:**", "**Assumes:**"]) {
    const before = spec([`${marker} use approach A`]);
    const after = spec([`${marker} use approach B`]);
    const r = classifyRefresh(before, after, () => true);
    assert.equal(r.reason, "content-changed", marker);
  }
});

test("an acceptance-criterion edit → content-changed", () => {
  const before = spec(["## Acceptance", "", "* The thing happens exactly once."]);
  const after = spec(["## Acceptance", "", "* The thing happens at least once."]);
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "content-changed");
});

test("a DONE item edit → content-changed, first_divergence names the DONE heading", () => {
  const before = spec(["## 8. DONE", "", "- [ ] a done item"]);
  const after = spec(["## 8. DONE", "", "- [ ] a DIFFERENT done item"]);
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "content-changed");
  assert.equal(r.first_divergence.section, "8-done");
});

test("a URL path change → content-changed (URLs left exactly as written)", () => {
  const before = spec(["see https://github.com/a/b for it"]);
  const after = spec(["see https://github.com/a/c for it"]);
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "content-changed");
});

test("table padding change alone → carry", () => {
  const before = spec(["| a | b |", "|---|---|", "| 1 | 2 |"]);
  const after = spec(["| a | b |", "|----|---|", "| 1 | 2 |"], { stampDate: "2026-10-14" });
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.carry, true);
});

test("CRLF line endings on one side alone → carry", () => {
  const before = spec(["plain body text"]).replace(/\n/g, "\r\n");
  const after = spec(["plain body text"]);
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.carry, true);
});

// --- each no-carry reason ---

test("no-prior-approval: before has no spec-review line at all", () => {
  const before = spec(["plain body"]).replace(/\nspec-review: approve/, "");
  const after = before;
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "no-prior-approval");
  assert.equal(r.approval, null);
});

test("no-prior-approval: before's spec-review line doesn't start with approve/accept", () => {
  const before = spec(["plain body"], { approval: "revise" });
  const after = before;
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "no-prior-approval");
});

test("approval-line-changed: the after spec's line differs", () => {
  const before = spec(["plain body"]);
  const after = spec(["plain body"], { approval: "approve (carried)" });
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "approval-line-changed");
});

test("approval-line-changed: the after spec has no spec-review line at all", () => {
  const before = spec(["plain body"]);
  const after = before.replace(/\nspec-review: approve/, "");
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "approval-line-changed");
});

test("confidence-changed: the trailing confidence line differs", () => {
  const before = spec(["plain body"], { confidence: "high" });
  const after = spec(["plain body"], { confidence: "medium" });
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "confidence-changed");
});

test("confidence-changed: confidence line missing from one side", () => {
  const before = spec(["plain body"]);
  const after = before.replace(/\nconfidence: high/, "");
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "confidence-changed");
});

test("content-changed: a length-mismatch divergence (after runs longer than before)", () => {
  // Hand-built (not the `spec()` helper) so the normalised line count is exactly
  // controlled: before's body is a strict prefix of after's, so the divergence falls past
  // the end of `nb` and `first_divergence.before` is genuinely null, not an empty string.
  const before = ["build-tier: standard", "confidence: high", "spec-review: approve", "one body line"].join("\n");
  const after = `${before}\na whole new second body line`;
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.reason, "content-changed");
  assert.equal(r.first_divergence.before, null);
  assert.equal(r.first_divergence.after, "a whole new second body line");
});

test("path-move-unverified names each unverified entry", () => {
  const before = spec(["see docs/a/x.md"]);
  const after = spec(["see docs/b/x.md"]);
  const r = classifyRefresh(before, after, () => false);
  assert.equal(r.reason, "path-move-unverified");
  assert.deepEqual(r.path_moves, [{ before: "docs/a/x.md", after: "docs/b/x.md", verified: false }]);
});

test("the last spec-review: line wins when there are several", () => {
  const before = [
    "> Spec: faffter-dark-nlspec . 2026-10-10",
    "",
    "plain body",
    "",
    "spec-review: revise",
    "build-tier: standard",
    "confidence: high",
    "spec-review: approve",
  ].join("\n");
  const after = before.replace("2026-10-10", "2026-10-14");
  const r = classifyRefresh(before, after, () => true);
  assert.equal(r.carry, true);
  assert.equal(r.approval, "approve");
});

test("a refresh with no textual change at all still carries with zero counts", () => {
  const text = spec(["plain body"]);
  const r = classifyRefresh(text, text, () => true);
  assert.equal(r.carry, true);
  assert.deepEqual(r.changes, { paths: 0, line_refs: 0, status_notes: 0 });
  assert.deepEqual(r.path_moves, []);
});

// --- normaliseSpec / pathExists-adjacent pure helpers ---

test("normaliseSpec: CRLF and LF normalise identically", () => {
  const lf = "a\nb\n";
  const crlf = "a\r\nb\r\n";
  assert.deepEqual(normaliseSpec(crlf), normaliseSpec(lf));
});

test("normaliseSpec drops the stamp, build-tier and refresh-note lines", () => {
  const text = [
    "> Spec: faffter-dark-nlspec . 2026-10-10",
    "body",
    "> Revised on 2026-10-14: paths refreshed",
    "build-tier: standard",
  ].join("\n");
  assert.deepEqual(normaliseSpec(text), ["body"]);
});

test("extractPathTokens skips URL-prefixed tokens", () => {
  assert.deepEqual(extractPathTokens("see https://github.com/a/b and docs/x.md"), ["docs/x.md"]);
});

test("extractLineRefTokens collects colon, hash and word forms in order", () => {
  assert.deepEqual(extractLineRefTokens("src/a.js:40 then docs/x.md#L10 then line 7"), [":40", "#L10", "line 7"]);
});

// --- pathExists containment (exercised via the CLI shell's makePathExists, through the real
// carry-check entrypoint — see test/spec-review-carry-check.test.mjs for the symlink/absolute/..
// escape cases that need a real filesystem). This file keeps to the pure classifier.
test("classifyRefresh never calls pathExists for a reason that already short-circuits", () => {
  let calls = 0;
  const before = spec(["plain body"]).replace(/\nspec-review: approve/, "");
  classifyRefresh(before, before, () => { calls++; return true; });
  assert.equal(calls, 0);
});
