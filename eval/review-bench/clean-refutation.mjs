// clean-refutation.mjs: the review bench's subset mirror of production's clean-refutation normaliser.
// The subset guarantee (never clean where production rejects) covers heading-guard bodies only: this
// mirror does not carry the FAFF-1223 triple-bullet guard, so a bullet-bearing body can read clean here
// while production rejects it (pinned in test/adversarial-call.test.mjs).
// Node built-ins only (none needed); kept importable on its own so test/adversarial-call.test.mjs can
// pin it to production with a parity test, while the kit stays copyable as a directory.

// FAFF-905: mirrors the closed bare-or-headed clean-refutation grammar production accepts
// (CLEAN_REFUTATIONS / normaliseCleanRefutation in
// plugin/skills/faffter-dark-adversarial-review/review-call.mjs) — no looser, no stricter.
export const CLEAN_REFUTATIONS = [
  { heading: "## Refutation — architectural", sentence: "No architectural objection." },
  { heading: "## Refutation — infosec", sentence: "No infosec objection." },
  { heading: "## Refutation — methodology", sentence: "No methodology objection." },
  { heading: "## Refutation — QA", sentence: "No QA objection." },
];
// FAFF-1053: segment-matched, mirroring production's normaliseCleanRefutation — the line(s) directly
// above the affirmation decide the form, so a reasoning backend's preamble no longer defeats this
// mirror either, and (mirroring production's "bare" arm) any non-heading text directly above the
// affirmation is tolerated as preamble too, not just an entirely absent line.
// FAFF-1154: the affirmation need no longer be the final non-blank line — it is located as the last
// line equal to an affirmation sentence, and guard-clean prose after it is tolerated; a trailing
// severity or `## Refutation —` heading after the affirmation still rejects (the trailing twin of the
// preamble guard), mirroring production. Still a subset mirror:
// only the bare/headed forms move (this file never carried headed+signal/header-wrapped) — a heading
// directly above the affirmation that isn't this entry's own heading stays unrecognised (production
// would resolve it to either header-wrapped or a rejection; this mirror has no decorative-header
// detection, so it conservatively stays "not clean" either way, exactly as before this change). The
// preamble guard below (FAFF-1238: also another lens's `## Refutation —` heading, own heading exempt) is
// what stops a preceding genuine finding from being masked as a clean-pass — shape() gives clean-pass
// precedence over SEV, so without the guard a preambled body carrying a real finding would misclassify
// here exactly as it would in production without
// normaliseCleanRefutation's own guard. The guard reuses SEVERITY_LIKE_HEADING_RE below (level-agnostic,
// #{1,6}) rather than the canonical-3-hash SEV — production's own preamble guard is level-agnostic (see
// review-call.mjs's SEVERITY_LIKE_HEADING_RE), so a `## Critical: …` preamble line (2 hashes) must be
// caught here too, not only the canonical `### critical:` form SEV parses for genuine finding sections.
const BENCH_ATX_HEADING_RE = /^#{1,6}\s+\S/;
const SEVERITY_LIKE_HEADING_RE = /^#{1,6}\s*\[?(critical|major|minor|observation)\]?\s*[:—-]/i;
const BENCH_REFUTATION_NAMESPACE_RE = /^#{1,6}\s+Refutation\s+[—-]/i;
// FAFF-1238: guard scans test a line with its leading spaces and tabs removed (severity or
// `## Refutation —` heading), mirroring production's isGuardHeading.
function isGuardHeading(line) {
  const t = line.replace(/^[ \t]+/, "");
  return SEVERITY_LIKE_HEADING_RE.test(t) || BENCH_REFUTATION_NAMESPACE_RE.test(t);
}
export function isCleanRefutation(content) {
  const lines = String(content == null ? "" : content)
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "");
  if (lines.length === 0) return false;
  // FAFF-1154: locate the affirmation as the last line equal to an affirmation sentence (last-wins),
  // not merely the final non-blank line, mirroring production.
  let affirmationIdx = -1;
  let entry = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = CLEAN_REFUTATIONS.find((e) => e.sentence === lines[i]);
    if (candidate) { affirmationIdx = i; entry = candidate; break; }
  }
  if (!entry) return false;
  // Trailing-segment guard (mirrors production): a severity or wrong-lens/`## Refutation —` heading
  // after the affirmation rejects, never swallowed as clean (indented or not, FAFF-1238).
  for (let i = affirmationIdx + 1; i < lines.length; i++) {
    if (isGuardHeading(lines[i])) return false;
  }
  const above1 = affirmationIdx - 1 >= 0 ? lines[affirmationIdx - 1] : null;
  let start;
  if (above1 === entry.heading) start = affirmationIdx - 1; // headed form
  else if (above1 != null && BENCH_ATX_HEADING_RE.test(above1)) return false; // a mismatched heading directly above — not mirrored, stays unrecognised
  else start = affirmationIdx; // bare form — above1 is null or non-heading preamble, tolerated
  for (let i = 0; i < start; i++) {
    if (lines[i].trim() === entry.heading) continue; // the entry's own heading is exempt (exact, full trim)
    if (isGuardHeading(lines[i])) return false; // preamble guard: never mask a genuine finding or another lens's section
  }
  return true;
}
