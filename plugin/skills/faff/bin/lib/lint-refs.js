// ===========================================================================
// === region:factory — lint-refs — FAFF-238: ban external-artifact refs (ticket tags / ADR citations / ===
// numbered docs/adr pointers) in prose the reader EXECUTES or PUBLICLY CONSUMES.
// Slice 1 enforces docs/guide/** (the public user-guide surface); the SKILL.md
// surface is slice 2 (FAFF-239). docs/ outside docs/guide/ is allow-by-default
// (ADRs / specs / contributor guidance legitimately cite provenance); docs/adr/**
// is exempt because `faff adr validate` REQUIRES its supersession back-refs. Within-
// prose anchors (gateway -> Section, sibling skill names like faff/SKILL.md) never
// match the patterns. This source file is not scanned, so its own refs are exempt.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { findRoot } = require("./shared-infra");

const REF_PATTERNS = [
  ["ticket", /\bFAFF-\d+\b/g],            // ticket tag, e.g. FAFF-238 (case-sensitive — a lowercase branch name is not a cite)
  ["adr-cite", /\bADR[-\s]?\d{3,4}\b/gi], // "ADR 0013" / "ADR 013" — canonical 3-4 digit form (ADRs are zero-padded to 4); a 1-2 digit "ADR 9" is not a project ADR id and is not flagged
  ["adr-ptr", /\bdocs\/adr\/\d{1,4}[-\w]*/g], // numbered pointer only — a bare docs/adr/ dir mention does not match
];

// Pure core: every external-artifact ref on one line, each { match, pattern }.
function refsInLine(line) {
  const hits = [];
  for (const [pattern, re] of REF_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      hits.push({ match: m[0], pattern });
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
    }
  }
  return hits;
}

// Recursively collect *.md files under dir (sorted → deterministic order).
function markdownFilesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = fs.lstatSync(full); // lstat, not stat — do NOT follow a symlinked dir out of the enforced surface
    if (st.isDirectory()) out.push(...markdownFilesUnder(full));
    else if (st.isFile() && name.endsWith(".md")) out.push(full);
  }
  return out;
}

const LINT_REFS_SURFACES = ["docs/guide"]; // slice 1; slice 2 (FAFF-239) adds plugin/skills/*/SKILL.md

function cmdLintRefs(args) {
  let root = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else rest.push(args[i]);
  }
  if (rest.includes("--selftest")) return lintRefsSelftest();
  root = root || findRoot();

  const violations = [];
  for (const surface of LINT_REFS_SURFACES) {
    for (const file of markdownFilesUnder(path.join(root, surface))) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const h of refsInLine(line)) {
          violations.push({ file: path.relative(root, file), line: i + 1, match: h.match });
        }
      });
    }
  }
  if (violations.length) {
    for (const v of violations) console.log(`FAIL  ${v.file}:${v.line} ✗ ${v.match}`);
    process.stderr.write(`faff lint-refs: ${violations.length} external-artifact ref(s) in enforced prose (docs/guide/) — inline the rule, drop the ref\n`);
    return 1;
  }
  console.log("PASS  no external-artifact refs in enforced prose (docs/guide/)");
  return 0;
}

// In-memory self-test of the pure matcher (mirrors the `profile` / `contract` selftest style).
function lintRefsSelftest() {
  const cases = [
    ["see FAFF-26 for rationale", 1, "ticket tag"],
    ["resolves FAFF-1 and FAFF-238 both", 2, "two ticket tags"],
    ["per ADR 0013 the split", 1, "adr citation (4-digit)"],
    ["per ADR 013 the split", 1, "adr citation (3-digit)"],
    ["per ADR-9 the call", 0, "1-2 digit ADR ref is below the canonical form — not flagged"],
    ["see docs/adr/0013-storage-split.md", 1, "numbered adr pointer"],
    ["citing ADR 0010 and docs/adr/0010-foo.md", 2, "adr cite + numbered pointer"],
    ["the gateway → Automation eligibility section", 0, "within-prose section anchor"],
    ["the sibling faff/SKILL.md holds it", 0, "sibling skill name"],
    ["the faff adr command operates on docs/adr/", 0, "bare docs/adr dir mention"],
    ["delegated to faffter-dark-nlspec", 0, "slot skill name (no number)"],
    ["build the faff-238-foo branch", 0, "lowercase branch name is not a cite"],
    ["plain prose with no refs at all", 0, "clean line"],
  ];
  let failed = 0;
  for (const [line, want, label] of cases) {
    const got = refsInLine(line).length;
    if (got !== want) { process.stderr.write(`lint-refs --selftest FAIL: ${label} (want ${want}, got ${got})\n`); failed++; }
  }
  if (failed) return 1;
  console.log("lint-refs --selftest: ok");
  return 0;
}


module.exports = { LINT_REFS_SURFACES, REF_PATTERNS, cmdLintRefs, lintRefsSelftest, markdownFilesUnder, refsInLine };
