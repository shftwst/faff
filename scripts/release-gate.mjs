#!/usr/bin/env node
// scripts/release-gate.mjs — FAFF-174
//
// Repo-internal release gate. Asserts that a PR title is a "releasing" conventional-commit
// subject (type `feat` or `fix`) so that release-please cuts a release for the change.
//
// Why this is needed: this repo is squash-only with squash_merge_commit_title using the PR
// title as the squash subject, and release-please (release-type: simple) bumps ONLY on a
// `feat:`/`fix:` subject — it ignores the squash body. A PR titled `FAFF-NNN: …` (no type)
// therefore yields a squash subject with no releasing type, and release-please cuts nothing.
// Skills prose (`plugin/skills/**`) and the plugin manifest (`plugin/.claude-plugin/**`) are
// the user-facing product, so a user-facing change MUST carry a releasing title.
//
// This is repo-only tooling — deliberately NOT a `faff` CLI subcommand. The bundled CLI
// (`plugin/skills/faff/bin/faff`) ships to adopters and must hold only commands a user would
// call on their own project; a release gate for faff's own repo has no place there. The
// path-detection half lives in `.github/workflows/release-gate.yml`; this script owns the
// pure title-type assertion. Zero-dependency ESM; covered by `test/release-gate.test.mjs`
// (picked up by the existing `node --test` CI step) and an inline `--selftest` fixtures table.
//
// Usage:
//   node scripts/release-gate.mjs --title "<pr title>"   exit 0 if releasing, 1 otherwise
//   node scripts/release-gate.mjs --selftest             run the fixtures table

// A releasing title: lowercase type `feat` or `fix`, optional `(scope)`, optional `!`,
// then `: ` and a non-empty description. Matches conventional-commit subjects that
// release-please's default sections bump on. `docs:`/`chore:`/`refactor:`/`Feat:`/bare
// `FAFF-164:` are all non-releasing.
const RELEASING = /^(feat|fix)(\([^)]+\))?!?: .+/;

export function isReleasingTitle(title) {
  if (typeof title !== "string") return false;
  return RELEASING.test(title.trim());
}

const REMEDIATION =
  "release-gate: user-facing paths changed (plugin/skills/** or plugin/.claude-plugin/**), " +
  "but the PR title is not a releasing conventional-commit subject.\n" +
  "Fix: prefix the PR title with `feat: ` (minor) or `fix: ` (patch) so release-please cuts " +
  "a release — this repo is squash-only and uses the PR title as the squash subject, and " +
  "release-please bumps only on a feat:/fix: subject (the squash body is ignored).";

// --- self-test fixtures -----------------------------------------------------
const FIXTURES = [
  // releasing
  ["feat: add a thing", true],
  ["fix: correct a thing", true],
  ["fix(FAFF-1): scoped patch", true],
  ["feat(faff-tidy): scoped feature", true],
  ["feat!: breaking feature", true],
  ["feat(scope)!: breaking scoped feature", true],
  // non-releasing
  ["docs: tweak prose", false],
  ["chore: tidy", false],
  ["refactor: reshape", false],
  ["FAFF-164: bare ticket prefix", false],
  ["Feat: capitalised type", false],
  ["feat:no space after colon", false],
  ["feat: ", false],
  ["", false],
];

function selftest() {
  let failures = 0;
  for (const [title, expected] of FIXTURES) {
    const got = isReleasingTitle(title);
    const ok = got === expected;
    if (!ok) failures++;
    process.stdout.write(
      `${ok ? "ok  " : "FAIL"}  releasing=${String(got).padEnd(5)} expected=${String(expected).padEnd(5)} title=${JSON.stringify(title)}\n`,
    );
  }
  process.stdout.write(`RESULT ${failures === 0 ? "PASS" : "FAIL"} (${FIXTURES.length - failures}/${FIXTURES.length})\n`);
  return failures === 0 ? 0 : 1;
}

function getFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  return argv[i + 1];
}

function main(argv) {
  if (argv.includes("--selftest")) return selftest();

  if (argv.includes("--title")) {
    const title = getFlag(argv, "--title");
    if (isReleasingTitle(title)) return 0;
    process.stderr.write(REMEDIATION + "\n");
    process.stderr.write(`Offending title: ${JSON.stringify(title ?? null)}\n`);
    return 1;
  }

  process.stderr.write("usage: node scripts/release-gate.mjs --title \"<pr title>\" | --selftest\n");
  return 2;
}

// Run only when invoked directly (not when imported by the test file).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
