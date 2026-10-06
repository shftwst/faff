// FAFF-1176 — the custody seam stays inside commissaire.ts. Two plain string checks, no judgement:
//
//  1. The two skills decide "is this run governed?" only through one governed-run check sentence,
//     byte-identical in both files, which fails closed on any failed `commissaire contract status` call
//     (human decision on FAFF-1176, comments 08c09091 and dcb4ad5c). No skill names the governor file.
//  2. No production module under bin/lib/ outside commissaire.ts/.js builds a governor or producer
//     key-file path, except the anchor's public-key copy inside events.js's mintIssueAnchor (events.js is
//     in the governance region and may not require the factory-region commissaire module).
//
// A later ticket that adds a governed step updates SITES; one that moves the key changes commissaire.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(HERE, "..", "plugin", "skills");
const LIB = join(SKILLS, "faff", "bin", "lib");

const CANONICAL = 'Governed-run check: run `"$faff" commissaire contract status --run-dir <run dir>`. If the call exits non-zero, has not returned within 30 seconds, or its stdout is anything other than exactly one parseable JSON object with a boolean `governed`, stop with the error `commissaire-status-failed` and take neither the governed nor the ungoverned path, whatever `"governed"` appears to say; otherwise the run is governed when that object\'s `governed` is `true` and not governed when it is `false`.';
const SITE_PHRASE = "the governed-run check reports governed";
const SITES = { "faff-graft": 9, "faff-beep-boop": 1 };
const FORBIDDEN = ["governor.json", "governor material", "commissaire-status-fault", "run the bracket"];

const count = (hay, needle) => hay.split(needle).length - 1;
const skillText = (name) => readFileSync(join(SKILLS, name, "SKILL.md"), "utf8");

for (const [name, sites] of Object.entries(SITES)) {
  test(`${name}: one governed-run check sentence, ${sites} site(s) refer to it, and no file-path check survives`, () => {
    const text = skillText(name);
    assert.equal(count(text, CANONICAL), 1, "the canonical sentence appears exactly once");
    const lines = text.split("\n");
    assert.equal(lines.filter((l) => l.includes(SITE_PHRASE)).length, sites, "site count");
    for (const phrase of FORBIDDEN) assert.equal(count(text, phrase), 0, `forbidden phrase: ${phrase}`);
    for (const line of lines.filter((l) => l.includes("commissaire contract status"))) {
      assert.ok(line.includes(CANONICAL), "the verb is called only through the one check");
    }
  });
}

test("no other skill names the governor file or calls the status verb", () => {
  for (const name of readdirSync(SKILLS)) {
    if (name in SITES) continue;
    const p = join(SKILLS, name, "SKILL.md");
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    assert.equal(count(text, "governor.json"), 0, `${name} names governor.json`);
    assert.equal(count(text, "commissaire contract status"), 0, `${name} calls the status verb directly`);
  }
});

const SEAM_TOKENS = ["pk.json", "governor.json", "pkFileOf", "producerDirOf", "governorFileOf", "governorDirOf"];

// The mintIssueAnchor body in events.js: from its declaration line to the next column-0 top-level
// declaration (not brace counting, so braces inside strings or nested functions cannot widen it).
function mintIssueAnchorRange(lines) {
  const start = lines.findIndex((l) => l.startsWith("function mintIssueAnchor("));
  assert.ok(start >= 0, "events.js declares mintIssueAnchor at column 0");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(function |async function |module\.exports)/.test(lines[i])) { end = i; break; }
  }
  return [start, end];
}

test("seam: outside commissaire.ts/.js, only events.js's mintIssueAnchor names a key-file path or path helper", () => {
  const offenders = [];
  for (const file of readdirSync(LIB).filter((f) => f.endsWith(".js") || f.endsWith(".ts"))) {
    if (file === "commissaire.js" || file === "commissaire.ts") continue;
    const lines = readFileSync(join(LIB, file), "utf8").split("\n");
    const allowed = file === "events.js" ? mintIssueAnchorRange(lines) : [0, 0];
    lines.forEach((line, i) => {
      if (i >= allowed[0] && i < allowed[1]) return;
      for (const token of SEAM_TOKENS) if (line.includes(token)) offenders.push(`${file}:${i + 1} ${token}`);
    });
  }
  assert.deepEqual(offenders, []);
});
