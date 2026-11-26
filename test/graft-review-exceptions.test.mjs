import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const entryUrl = new URL("../plugin/skills/faff-graft/SKILL.md", import.meta.url);
const entry = readFileSync(entryUrl, "utf8");
const routes = [...entry.matchAll(/^.*\]\((references\/review-exceptions\.md)\).*$/gm)];
const review = entry.slice(entry.indexOf("**Step 9: Review phase"), entry.indexOf("**Step 9b: Open the PR"));

test("store resumes find the review procedure before dispatching a reviewer or resuming a judge", () => {
  const resume = entry.slice(entry.indexOf("| `resume_at` |"), entry.indexOf("**Step 4: Commit spec"));
  assert.ok(routes.some(([line]) => resume.includes(line) && line.includes("resume_at: review") && line.includes("carried dialogue")));
  assert.match(resume, /review-outage.*restore `outage_retries`/);
  assert.match(resume, /run no reviewer round.*--reopen-for-hold <resume\.dialogue\.hold_count>/);
});

test("critical, unavailable and incomplete rounds share a procedure, while clean review and terminal cleanup stay inline", () => {
  const route = routes.find(([line]) => review.includes(line));
  assert.ok(route, "Step 9 links its exceptional routes");
  assert.match(route[0], /escalated_criticals\[\].*build_review_judge.*unavailable.*dialogue or judge turn/);
  const procedure = readFileSync(new URL(route[1], entryUrl), "utf8");
  assert.match(procedure, /build-review-round record/);
  assert.match(procedure, /build-judge-evidence --assemble/);
  assert.match(procedure, /resume-store prepare-hold/);
  assert.doesNotMatch(review, /build-review-round record|build-judge-evidence --assemble|resume-store prepare-hold/);
  assert.match(review, /For Phase-2 criticals retain round 1 or the resumed `next_round`/);
  assert.match(review, /Remote-backed review diff/);
  assert.match(review, /evidence record-review-round/);
  assert.match(review, /Clearing a hold[\s\S]*?build-claim release --issue/);
  assert.match(review, /\*\*`pass`\*\*.*Step 9b/);
});
