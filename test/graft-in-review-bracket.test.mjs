// FAFF-1242 — the Step-9b In Review transition must carry the inline governed
// tracker-write bracket (declare before, observe after the save_issue write).
// The prose cannot be executed, so this slices the block and asserts the
// load-bearing invariants: verbs, ordering and the by-name rule citation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = join(HERE, "..", "plugin", "skills", "faff-graft", "SKILL.md");

function inReviewBlock(md) {
  const start = md.indexOf("**In Review transition");
  const end = md.indexOf("### Discovered scope");
  assert.ok(start !== -1, "In Review transition heading not found");
  assert.ok(end > start, "Discovered scope heading not found after In Review transition");
  return md.slice(start, end);
}

test("In Review transition declares and observes a tracker-write around the save_issue write", () => {
  const block = inReviewBlock(readFileSync(SKILL_MD, "utf8"));

  assert.match(block, /faff effects declare .*--step tracker-write/);
  assert.match(block, /faff effects observe .*--step tracker-write/);
  assert.match(block, /Governed tracker-write record/);

  const declareAt = block.search(/faff effects declare .*--step tracker-write/);
  const observeAt = block.search(/faff effects observe .*--step tracker-write/);
  const bracketStart = block.indexOf("Governed In Review tracker-write record");
  assert.ok(bracketStart !== -1, "inline bracket paragraph not found");
  assert.ok(declareAt > bracketStart, "declare must appear within the inline bracket paragraph");
  assert.ok(declareAt < observeAt, "declare must precede observe");
  assert.match(block.slice(declareAt, observeAt + 200), /save_issue/, "bracket must be tied to the save_issue write");
});
