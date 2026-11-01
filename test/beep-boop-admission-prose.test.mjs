// FAFF-1434 — beep-boop's build-queue admission has one home, `faff graft admit`. These are plain
// string checks over faff-beep-boop/SKILL.md: step 4 and explicit-list mode call the command, shell no
// `faff next`, `faff eligible` or `faff admissible` for admission and run no decision-capture driver,
// route every disposition, send an In Review `proceed` to the endgame landing check, and carry the
// final-call rule. No judgement; an ordinary node --test case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = readFileSync(join(HERE, "..", "plugin", "skills", "faff-beep-boop", "SKILL.md"), "utf8");

// The text from a heading line to the next heading of the given marker.
function section(startHeading, endPrefix) {
  const start = SKILL.indexOf(`\n${startHeading}\n`);
  assert.ok(start >= 0, `heading not found: ${startHeading}`);
  const end = SKILL.indexOf(`\n${endPrefix}`, start + startHeading.length + 2);
  assert.ok(end > start, `no section end after ${startHeading}`);
  return SKILL.slice(start, end);
}
const STEP4 = section("### 4. Build queue assembly", "### 5.");
const EXPLICIT = section("## Explicit-list mode", "## ");

const INVOCATION = /\bfaff"?\s+(next|eligible|admissible)\b/;
// An invocation, not a mention: step 4 itself says it runs no `decision-capture decide` driver.
const DRIVER = /--kernel\s+(next|eligible)\b|\bfaff"?\s+decision-capture\s+(decide|action)\b/;

for (const [name, text] of [["step 4", STEP4], ["explicit-list mode", EXPLICIT]]) {
  test(`${name} calls faff graft admit --mode autonomous and nothing else for admission`, () => {
    assert.ok(text.includes("faff graft admit --mode autonomous"), "the admission call");
    assert.doesNotMatch(text, INVOCATION, "a faff next / eligible / admissible invocation");
    assert.doesNotMatch(text, DRIVER, "a decision-capture driver or action call for next/eligible");
  });
}

test("step 4 passes a run dir and no wave, so each call mints a fresh consult id and writes its own captures", () => {
  assert.match(STEP4, /faff graft admit --mode autonomous --facts - --spec-file "\$run_dir\/<ISSUE>\/admit-spec\.md" --run-dir "\$run_dir" --json`/);
  // An explicit --wave skips the consult counter, so the first call, the final call and graft's own
  // Step 2 call would all mint the same id and only one would grade (FAFF-1394).
  assert.doesNotMatch(STEP4, /graft admit[^`]*--wave/);
});

test("step 4 routes all eight dispositions and a non-zero exit", () => {
  for (const d of ["proceed", "claimed-by-peer", "needs-prep", "ineligible", "blocked", "inadmissible", "needs-human", "excluded"]) {
    assert.ok(STEP4.includes(`\`${d}\``), `disposition not routed: ${d}`);
  }
  assert.match(STEP4, /a non-zero exit \| Routed out[^\n]*`admit-errored:<reason>`[^\n]*never admitted/);
});

test("a proceed with status in-review goes to the endgame landing check, never a build", () => {
  assert.match(STEP4, /\| `proceed` with status `in-review`, `claimed-by-peer` \| Status `in-review`: the endgame landing check[^\n]*Never built, admitted or parked \|/);
  assert.match(STEP4, /\| `proceed`, status not `in-review` \|/);
  assert.match(STEP4, /It runs from a `claimed-by-peer` result, or a `proceed`, whose status is `in-review`/);
});

test("step 4 carries the final-call rule", () => {
  assert.match(STEP4, /\*\*The final call \(the last gate\)\.\*\*[^\n]*immediately before the append to `admitted`, with nothing in between\. Only its `proceed` with status not `in-review` admits/);
});

test("step 4 checks the issue key and replaces the spec file before every call", () => {
  assert.ok(STEP4.includes("`^[A-Za-z][A-Za-z0-9]*-[0-9]+$`"), "issue-key shape");
  assert.ok(STEP4.includes("`admit-errored:issue-key`"), "issue-key route-out");
  assert.match(STEP4, /Delete the previous `admit-spec\.md`/);
});
