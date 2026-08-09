// FAFF-678 — the voice-pointer lint in `faff validate-adapters`: the gateway's `House voice:`
// clause names a canonical path; every other SKILL.md quoting it must name the same path, and (only
// when linting faff's own source tree) that path must resolve on disk. This is the guard that would
// have caught PR #500, which repointed contributor guidance from `.agents/STYLE.md` to `AGENTS.md`
// without updating the five skill-prose references — silently, because the runtime clause fails open
// by design and nothing else was watching the pointer.
//
// Fixture isolation (per the spec): leg 3 (on-disk resolution) is gated on the RESOLVED ROOT looking
// like faff's own source tree (an `eval/` dir present), and `--root` drives that resolution
// explicitly rather than falling back to the real repo root — so a fixture's verdict never depends on
// files outside the fixture. Every fixture below passes its own `--root`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const GATEWAY_CLAUSE_FIXED =
  "**Voice clause.** Every dispatch stamps: *\"House voice: read the `# Writing style` section of " +
  "`AGENTS.md` at the repo root (worktree included) and apply it to all durable prose you write — " +
  "specs, PR bodies, commit messages, tracker comments. File or section absent → skip this " +
  "instruction.\"*\n";

// The pre-fix clause, copied verbatim as a static string literal — NOT re-derived from origin/main,
// NOT a moving ref. DONE criterion 7 is explicit that a checkout-based regression fixture inverts the
// day this PR merges (the ref would then name a path that resolves); this string is what stays true
// regardless of what `main` looks like tomorrow.
const GATEWAY_CLAUSE_PRE_FIX =
  "**Voice clause.** Every dispatch stamps: *\"House voice: read `.agents/STYLE.md` at the repo root " +
  "(worktree included) and apply it to all durable prose you write — specs, PR bodies, commit " +
  "messages, tracker comments. File absent → skip this instruction.\"*\n";

// Build a throwaway {skillsDir, root} pair. `skillsDir` gets one subdir per fixtures entry (always
// including "faff" when `gateway` is supplied). `root` optionally gets an `eval/` marker dir (to
// flip on the source-tree leg) and any extra files (e.g. a real AGENTS.md for the "resolves" case).
//
// FAFF-616: `--root` now also drives `loadSeamRegistryForLint` (previously it silently fell through
// to the real repo root regardless of `--root` — exactly the shared-root gap FAFF-616 closed), so an
// `eval/` marker with no `seam-registry.json` inside it now correctly fails loud (FAFF-280/281) —
// this fixture is about the UNRELATED voice-pointer lint, so it seeds a minimal well-formed empty
// registry (`{"kinds":{}}`) alongside the `eval/` marker to keep the seam-registry block a silent
// no-op, same as it always was for this suite's purposes.
function runOnFixtures({ gateway, others = {}, rootHasEval = false, rootFiles = {} } = {}) {
  const skillsDir = mkdtempSync(join(tmpdir(), "faff-voice-pointer-skills-"));
  const rootDir = mkdtempSync(join(tmpdir(), "faff-voice-pointer-root-"));
  if (gateway !== undefined) {
    mkdirSync(join(skillsDir, "faff"));
    writeFileSync(join(skillsDir, "faff", "SKILL.md"), gateway);
  }
  for (const [name, body] of Object.entries(others)) {
    mkdirSync(join(skillsDir, name));
    writeFileSync(join(skillsDir, name, "SKILL.md"), body);
  }
  if (rootHasEval) {
    mkdirSync(join(rootDir, "eval"));
    writeFileSync(join(rootDir, "eval", "seam-registry.json"), JSON.stringify({ kinds: {} }));
  }
  for (const [name, body] of Object.entries(rootFiles)) writeFileSync(join(rootDir, name), body);

  const r = spawnSync(
    process.execPath,
    [BIN, "validate-adapters", "--skills-dir", skillsDir, "--root", rootDir],
    { encoding: "utf8" },
  );
  rmSync(skillsDir, { recursive: true, force: true });
  rmSync(rootDir, { recursive: true, force: true });
  return r;
}

test("(a) a gateway clause naming a path that does not resolve fails, naming the unresolved path", () => {
  const r = runOnFixtures({ gateway: GATEWAY_CLAUSE_FIXED, rootHasEval: true }); // no AGENTS.md in root
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /voice-pointer/);
  assert.match(r.stdout, /does not resolve.*AGENTS\.md/);
});

test("(b) a quoting skill naming a different path from the gateway's fails, naming both", () => {
  const other =
    "**Stamps the voice clause:** *\"House voice: read `.agents/STYLE.md` at the repo root " +
    "(worktree included) and apply it to all durable prose you write. File absent → skip this " +
    "instruction.\"*\n";
  const r = runOnFixtures({
    gateway: GATEWAY_CLAUSE_FIXED,
    others: { "zz-quoter": other },
    rootHasEval: true,
    rootFiles: { "AGENTS.md": "# Writing style\n" },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /voice-pointer/);
  assert.match(r.stdout, /\.agents\/STYLE\.md/);
  assert.match(r.stdout, /AGENTS\.md/);
});

test("(c) a fixture matching the fixed tree passes", () => {
  const r = runOnFixtures({
    gateway: GATEWAY_CLAUSE_FIXED,
    others: { "zz-quoter": GATEWAY_CLAUSE_FIXED },
    rootHasEval: true,
    rootFiles: { "AGENTS.md": "# Writing style\n" },
  });
  assert.doesNotMatch(r.stdout, /voice-pointer/);
});

test("(d) a gateway present but with its `House voice:` line removed fails rather than skipping", () => {
  const noClause = "**Voice clause.** (rewritten without the anchor sentence.)\n";
  const r = runOnFixtures({ gateway: noClause, rootHasEval: true });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /voice-pointer/);
  assert.match(r.stdout, /no `House voice:` clause/);
});

test("(e) a fixture dir with no faff/ at all passes (the sibling fixture-suite case)", () => {
  const r = runOnFixtures({ others: { "zz-lonely": "# fixture\n\nno gateway present in this dir.\n" } });
  assert.doesNotMatch(r.stdout, /voice-pointer/);
  assert.equal(r.status, 0);
});

test("(7) regression: the pre-fix .agents/STYLE.md clause fails against a source-tree root, from static text", () => {
  // This is the guard that would have caught PR #500 — asserted from a string literal copy of the
  // pre-fix clause, never by checking out a moving ref (see the module comment above).
  const r = runOnFixtures({ gateway: GATEWAY_CLAUSE_PRE_FIX, rootHasEval: true }); // no .agents/STYLE.md in root
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /voice-pointer/);
  assert.match(r.stdout, /does not resolve.*\.agents\/STYLE\.md/);
});

test("outside the source tree (no eval/ marker), an unresolved path is not checked", () => {
  const r = runOnFixtures({ gateway: GATEWAY_CLAUSE_FIXED, rootHasEval: false });
  assert.doesNotMatch(r.stdout, /voice-pointer/);
});

test("the shipped tree stays clean (no reintroduced voice-pointer drift)", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  assert.doesNotMatch(r.stdout, /voice-pointer/, "the post-FAFF-678 tree must carry zero voice-pointer findings");
  assert.equal(r.status, 0);
});
