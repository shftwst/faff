// FAFF-968 — gives ADR promotion intent a git-only channel: graft Step 4b reads the
// `## ADR promotion intent` section from the COMMITTED SPEC BODY (via the new deterministic
// `faff adr extract-intent` primitive) when no tracker comment carries it. Two oracles, per the
// approved spec §6:
//
//   (1) MECHANISM test — spawns the real CLI (execFileSync, mirroring
//       test/decision-capture-wiring.test.mjs's conventions): `extract-intent` locates the
//       section for BOTH producer shapes (architecture-proposal per-entry, prep tail-step
//       title+section), a title drawn from the extracted section is handed to `faff adr new`,
//       and the resulting file is asserted on disk under the configured `adr-docs-path` — the
//       end-to-end "an ADR lands" property that actually regressed, not merely "extract-intent
//       returned non-empty". The negative (no section) asserts exit 1 and NO file created.
//
//   (2) WIRING oracle — the unspawnable Step 4b PROSE in faff-graft/SKILL.md cannot be executed,
//       so a wrong file path, a dropped call, or a mis-gated conjunct would ship green under the
//       mechanism test alone (the mechanism test hand-stitches the composition; real Step 4b's
//       LLM enumeration does the title derivation). This locates the Step 4b heading block and
//       asserts it literally names `faff adr extract-intent`, reads from `spec-docs-path` on the
//       no-tracker-comment branch, constructs the exact committed-spec path template Step 4
//       writes, and — the FAFF-969 seam — leaves the first conjunct (`adr.mode` ≠ `off`) and all
//       downstream sub-steps (1-4, the final skip line's `adr.mode: off` clause) textually
//       unchanged from a known-good baseline snapshot of the untouched pieces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const SKILL_MD = join(REPO, "plugin", "skills", "faff-graft", "SKILL.md");

function run(cwd, args, input) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
    return { code: 0, out, err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() };
  }
}

function scratchRoot() {
  const root = mkdtempSync(join(tmpdir(), "faff-adr-intent-"));
  writeFileSync(join(root, ".faffrc.yaml"),
    "tracking:\n  adr_docs_path: records/adr/\n  spec_docs_path: records/specs/\nadr:\n  mode: offer\n");
  return root;
}

// Producer shape 1 — the architecture-proposal per-entry block (`faffter-noon-architecture`).
const ARCH_PROPOSAL_SHAPE =
  "# Spec — FAFF-9999: some feature\n\n" +
  "## 1. WHY\n\nSome rationale.\n\n" +
  "## ADR promotion intent\n\n" +
  "- **Decision:** Persist links in PostgreSQL via a startup SQL migration.\n" +
  "  **Rationale:** durable relational storage fits the access pattern.\n" +
  "- **Decision:** Generate 7-char base62 codes from crypto random with a unique-constraint retry.\n" +
  "  **Rationale:** collision-safe without a central sequence.\n\n" +
  "## 2. OUT OF SCOPE\n\nNothing else.\n";

// Producer shape 2 — prep's tail-step title+section shape.
const PREP_TAIL_SHAPE =
  "## ADR promotion intent\n" +
  "### Persist links in PostgreSQL\n" +
  "Chosen: a startup SQL migration over an ORM-managed schema.\n" +
  "\n" +
  "## Next section\n" +
  "unrelated trailing content\n";

const NO_SECTION = "# Spec — FAFF-9999\n\nNo ADR promotion intent here at all.\n";

test("mechanism: extract-intent (architecture-proposal shape) -> adr new -> file lands under adr-docs-path", () => {
  const root = scratchRoot();
  const specFile = join(root, "spec.md");
  writeFileSync(specFile, ARCH_PROPOSAL_SHAPE);

  const extracted = run(root, ["adr", "extract-intent", "--file", specFile]);
  assert.equal(extracted.code, 0, extracted.err);
  assert.match(extracted.out, /^## ADR promotion intent/);
  assert.match(extracted.out, /Persist links in PostgreSQL/);
  assert.doesNotMatch(extracted.out, /OUT OF SCOPE/); // stopped at the next sibling heading

  const created = run(root, ["adr", "new", "--title", "Persist links in PostgreSQL via a startup SQL migration", "--issue", "FAFF-968", "--provenance", "loop"]);
  assert.equal(created.code, 0, created.err);
  const filePath = created.out.trim();
  assert.ok(existsSync(filePath), `expected ADR file to exist at ${filePath}`);
  assert.match(filePath, /records[\\/]adr[\\/]0001-persist-links-in-postgresql/);

  const listed = run(root, ["adr", "list", "--json"]);
  assert.equal(listed.code, 0, listed.err);
  const adrs = JSON.parse(listed.out);
  assert.equal(adrs.length, 1);
  assert.match(adrs[0].title, /Persist links in PostgreSQL/);
});

test("mechanism: extract-intent (prep tail title+section shape) also extracts and materialises", () => {
  const root = scratchRoot();
  const specFile = join(root, "spec.md");
  writeFileSync(specFile, PREP_TAIL_SHAPE);

  const extracted = run(root, ["adr", "extract-intent", "--file", specFile]);
  assert.equal(extracted.code, 0, extracted.err);
  assert.match(extracted.out, /^## ADR promotion intent/);
  assert.match(extracted.out, /Persist links in PostgreSQL/);
  assert.doesNotMatch(extracted.out, /unrelated trailing content/); // stopped at the next `##` sibling

  const created = run(root, ["adr", "new", "--title", "Persist links in PostgreSQL", "--issue", "FAFF-968", "--provenance", "loop"]);
  assert.equal(created.code, 0, created.err);
  assert.ok(existsSync(created.out.trim()));
});

test("mechanism: extract-intent also reads a tracker-comment-shaped blob (same heading contract)", () => {
  const root = scratchRoot();
  // A tracker comment carries the identical heading/body shape — extract-intent is agnostic to
  // WHICH channel the text arrived on; it locates the section in whatever blob it is given.
  const commentBody =
    "## ADR promotion intent\n\n- **Decision:** Use pino for structured logging.\n\n" +
    "_end of comment_\n";
  const r = run(root, ["adr", "extract-intent", "--file", "-"], commentBody);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Use pino for structured logging/);
});

test("negative: no `## ADR promotion intent` section -> extract-intent exits 1, and no ADR file is created", () => {
  const root = scratchRoot();
  const specFile = join(root, "spec.md");
  writeFileSync(specFile, NO_SECTION);

  const extracted = run(root, ["adr", "extract-intent", "--file", specFile]);
  assert.equal(extracted.code, 1);
  assert.equal(extracted.out, "");

  // Step 4b's prescribed behaviour on ABSENT intent: skip — never call `faff adr new`. Assert the
  // directory the CLI would have written to genuinely holds no ADR file.
  const adrDir = join(root, "records", "adr");
  assert.ok(!existsSync(adrDir), `expected no ADR directory to have been created, found ${adrDir}`);
  const listed = run(root, ["adr", "list", "--json"]);
  assert.equal(listed.code, 0, listed.err);
  assert.equal(JSON.parse(listed.out).length, 0);
});

test("negative: an unreadable source exits 2 and names the source", () => {
  const root = scratchRoot();
  const missing = join(root, "does-not-exist.md");
  const r = run(root, ["adr", "extract-intent", "--file", missing]);
  assert.equal(r.code, 2);
  assert.match(r.err, /does-not-exist\.md/);
});

// --- Wiring oracle over the unspawnable Step 4b prose ---------------------------------------

function extractStep4bBlock(md) {
  const startMarker = "**Step 4b: Materialise ADR promotions";
  const endMarker = "**Step 4c: Reconcile-before-materialise";
  const start = md.indexOf(startMarker);
  const end = md.indexOf(endMarker);
  assert.ok(start !== -1, "Step 4b heading not found in faff-graft/SKILL.md");
  assert.ok(end !== -1 && end > start, "Step 4c heading not found (or precedes Step 4b) in faff-graft/SKILL.md");
  return md.slice(start, end);
}

test("wiring: Step 4b prose names `faff adr extract-intent` and reads from spec-docs-path on the no-tracker-comment branch", () => {
  const md = readFileSync(SKILL_MD, "utf8");
  const block = extractStep4bBlock(md);

  // The primitive is literally named — a dropped call can't ship silently past a string match.
  assert.match(block, /faff adr extract-intent --file/, "Step 4b must literally invoke `faff adr extract-intent --file`");

  // The fallback source is spec-docs-path, and the exact committed-spec path template Step 4
  // constructs — a wrong path (git-only's one real failure mode) fails this string match.
  assert.match(block, /\$\(faff config spec-docs-path\)\/YYYY-MM-DD-<issue>-<slug>-design\.md/,
    "Step 4b must read the committed spec at the exact path template Step 4 writes");

  // The gate is comment-first: the tracker comment branch is named, and precedence is explicit —
  // "comment-first" language must survive, and the no-tracker-comment case must be gated on
  // absence of a comment (not an unconditional read of the spec body).
  assert.match(block, /comment-first/i);
  assert.match(block, /tracker comment always wins|tracker comment.*precedence|spec body is never consulted/i);

  // The first conjunct — FAFF-969's seam — is untouched: still gated on `adr.mode` != off, still
  // the literal phrase graft has always used.
  assert.match(block, /If `faff config get adr\.mode` ≠ `off` \*\*and\*\*/,
    "the first conjunct (adr.mode gate) must remain byte-identical — this is FAFF-969's seam");
});

test("wiring: all four Step 4b sub-steps (scaffold / author / 3b supersede / commit) are textually unchanged", () => {
  const md = readFileSync(SKILL_MD, "utf8");
  const block = extractStep4bBlock(md);

  // Spot-check load-bearing fragments from each unchanged sub-step — a change to any of these
  // (FAFF-969's territory or an accidental edit) fails this test rather than shipping silently.
  assert.match(block, /1\. \*\*Scaffold\*\* — `faff adr new --title "<decision>" --issue <ISSUE-XX>/);
  assert.match(block, /2\. \*\*Author the body via the `adr` slot\*\*/);
  assert.match(block, /3\. \*\*Confidence handling \(advisory, never a hard gate/);
  assert.match(block, /3b\. \*\*Detect contradictions \+ offer\/admit supersession/);
  assert.match(block, /4\. \*\*Fill \+ commit\*\* the scaffold's three sections/);

  // The trailing skip line: still gated on adr.mode: off, and now also names "No intent located"
  // (the renamed absent-intent condition covering both channels) rather than only "no comment".
  assert.match(md, /No intent located \(no tracker comment and no `## ADR promotion intent` section in the committed spec body, or the spec file was unreadable\), or `adr\.mode: off` → skip/);
});

test("the edited SKILL.md passes the authoring gate", () => {
  const r = run(REPO, ["validate-adapters"]);
  assert.equal(r.code, 0, r.err || r.out.split("\n").filter((l) => /FAIL/.test(l)).join("\n"));
  assert.match(r.out, /RESULT: PASS/);
});
