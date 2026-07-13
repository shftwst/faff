// ===========================================================================
// === region:factory — admissibility — FAFF-441: spec DoD-classification + admissible / holdout / spec-review-lens engines (DoD cluster hoisted from prd; handlers rehomed out of the lint-cli-doc span) ===
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { adrFlag } = require("./adr");
const { SPEC_REVIEW_LENSES, computeHoldoutVerdictsMap, holdoutGateResult } = require("./contract-defs");

function prdHasComparator(s) {
  if (/[<>≤≥]/.test(s)) return true;                 // < > <= >= ≤ ≥ all contain one of these
  return /(?:^|[\s(])=(?:[\s)]|\d|$)/.test(s);        // a bare relational `=` (e.g. "x = 5")
}

// Classify one criterion's text. scenario (Then) > assertion (MUST/comparator) > prose.
// GWT keywords are capitalised by convention (FAFF-10 / the template) — match a
// capitalised `Then` so lowercase prose ("…and then…") is not mistaken for a scenario.
function classifyCriterion(text) {
  if (/\bThen\b/.test(text)) return "scenario";
  if (/\bmust\b/i.test(text) || prdHasComparator(text)) return "assertion";
  return "prose";
}

// FAFF-275: a fence-open line whose info string is EXACTLY `holdout` (case-insensitive) — every
// criterion unit formed inside that fence is a holdout. Both fence styles recognised, matching
// the fence-toggle regex every other scanner in this file already shares.
function isHoldoutFenceOpen(line) {
  return /^\s*(?:```|~~~)\s*holdout\s*$/i.test(line);
}

// Pure function over the `## Acceptance criteria` / `## Scenarios` section body. No filesystem /
// tracker I/O, so it is unit-testable in isolation. Returns [{text, kind, holdout}].
//  - strips blank lines, code-fence markers, and whole-line italic placeholders (^_.*_$)
//  - a unit is one markdown list item ("- "/"* "/"N.") OR a Given/When/Then block
// FAFF-275: the marker is read HERE, at unit-formation time, so classify's flags and dodSplit's
// removals (holdoutRemovalSpans, below) can never disagree — both share isHoldoutFenceOpen + the
// same `/^holdout:\s*/i` bullet-prefix test. A bullet's explicit `holdout:` prefix wins over an
// enclosing fence's state (irrelevant in practice — bullets don't appear inside GWT fences).
function classifyAcceptanceCriteria(sectionText) {
  const lines = String(sectionText == null ? "" : sectionText).split(/\r?\n/);
  const units = [];
  let cur = null;
  let curHoldout = false;
  let fence = false;
  let fenceHoldout = false;
  const pushCur = () => { if (cur != null) { const t = cur.trim(); if (t) units.push({ text: t, holdout: curHoldout }); } cur = null; curHoldout = false; };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*(?:```|~~~)/.test(line)) {                          // drop fence markers, keep content
      if (!fence) { fence = true; fenceHoldout = isHoldoutFenceOpen(line); }
      else { fence = false; fenceHoldout = false; }
      continue;
    }
    if (line.trim() === "") { pushCur(); continue; }             // blank closes a unit
    if (/^_.*_$/.test(line.trim())) { pushCur(); continue; }     // whole-line italic placeholder — not a criterion
    if (!fence && /^\s*>/.test(line)) { pushCur(); continue; }   // FAFF-275: a blockquote line (e.g. dodSplit's withheld-note) is never a criterion
    const li = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      pushCur();
      const m = li[1].match(/^holdout:\s*(.*)$/i);
      if (m) { cur = m[1]; curHoldout = true; }                  // FAFF-275: bullet-prefix marker, stripped before classifying
      else { cur = li[1]; curHoldout = fence && fenceHoldout; }
      continue;
    }
    if (/^\s*Given\b/i.test(line)) { pushCur(); cur = line.trim(); curHoldout = fence && fenceHoldout; continue; }  // GWT block start
    if (cur != null) cur += "\n" + line.trim();                  // continuation (When/Then/And/wrap)
    else { cur = line.trim(); curHoldout = fence && fenceHoldout; }  // a bare leading prose/assertion line
  }
  pushCur();
  return units.map((u) => ({ text: u.text, kind: classifyCriterion(u.text), holdout: u.holdout }));
}

// --- dod classify (FAFF-34) ---
// The LINE-INDEX extent of a heading section (`## Scenarios`, `### N. DONE`, …), up to the next
// equal/higher heading. Fence-aware: a `#` inside a code fence is not a heading. Returns null when
// the heading is absent. Pure. `sectionBody` (below) is a thin text-joining wrapper over this; FAFF-275's
// `dodSplit` needs the INDICES themselves (to remove/keep specific lines), so the range-finding walk
// lives here once and both callers share it — never two independently-drifting boundary scanners.
// FAFF-306: `opts.extraStop(line)` is an OPTIONAL boundary extension consulted outside fences — the
// scenarios caller passes `scenariosBoundaryStop` (stop at a DONE heading / contract fence / confidence
// line regardless of relative level); other callers omit it and keep the equal/higher-heading break alone.
function sectionBodyRange(lines, headingRe, opts) {
  const extraStop = opts && opts.extraStop;
  let start = -1, level = 0, fence = false;
  for (let k = 0; k < lines.length; k++) {
    if (/^\s*(?:```|~~~)/.test(lines[k])) { fence = !fence; continue; }
    if (!fence && headingRe.test(lines[k])) { start = k; level = headingLevel(lines[k]); break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  fence = false;
  for (let k = start + 1; k < lines.length; k++) {
    // The extra boundary is checked OUTSIDE a fence and BEFORE the fence toggle, so a
    // `faff-contract:` fence-open stops the section instead of being entered as fence content.
    if (!fence && extraStop && extraStop(lines[k])) { end = k; break; }
    if (/^\s*(?:```|~~~)/.test(lines[k])) { fence = !fence; continue; }
    const lvl = fence ? 0 : headingLevel(lines[k]);
    if (lvl > 0 && lvl <= level) { end = k; break; }
  }
  return { headingLine: start, bodyStart: start + 1, bodyEnd: end };
}

// The body TEXT of a heading section — a thin join over sectionBodyRange (see above for the shared
// boundary walk). Unchanged behaviour/signature; existing callers (admissible, dod classify) are
// unaffected by the refactor.
function sectionBody(specText, headingRe, opts) {
  const lines = String(specText == null ? "" : specText).split(/\r?\n/);
  const range = sectionBodyRange(lines, headingRe, opts);
  if (range == null) return null;
  return lines.slice(range.bodyStart, range.bodyEnd).join("\n");
}

// Classify a spec's DoD criteria by born-verifiability class, reusing classifyCriterion VERBATIM (no forked
// rule — the same scenario>assertion>prose function `faff admissible` applies). Criteria are drawn from the
// SAME structures admissible reads: the `## Scenarios` section (each Given/When/Then block + each assertion
// bullet, via classifyAcceptanceCriteria) and the `### N. DONE` checklist (each `- [ ]` item). Pure — no I/O.
// FAFF-275: additive `holdout` per-criterion flag + top-level `holdout_counts` — `counts` is untouched and
// still sums to `criteria.length`, so every existing consumer keeps working unread.
function dodClassify(specText) {
  const criteria = [];
  const scenBody = sectionBody(specText, SCENARIOS_HEADING_RE, { extraStop: scenariosBoundaryStop });
  if (scenBody != null) {
    for (const u of classifyAcceptanceCriteria(scenBody)) criteria.push({ text: u.text, class: u.kind, source: "scenarios", holdout: u.holdout });
  }
  const doneAdvisories = [];
  for (const t of parseDoneChecklist(specText)) {
    // FAFF-275: DONE mirrors the body 1:1 and is NEVER withheld (the closed-loop rule — a withheld
    // DONE item would silently break graft's AC checklist + the merge-gate floor). A `holdout:`-prefixed
    // DONE item is left LITERAL (no strip, holdout stays false) and draws an advisory, never a strip/removal.
    if (/^holdout:\s*/i.test(t)) doneAdvisories.push(t);
    criteria.push({ text: t, class: classifyCriterion(t), source: "done", holdout: false });
  }
  for (const t of doneAdvisories) {
    process.stderr.write(`dod classify: DONE item begins "holdout:" but DONE items are never withheld (marker ignored, text kept literal): ${t.replace(/\s+/g, " ").slice(0, 60)}\n`);
  }
  const counts = { scenario: 0, assertion: 0, prose: 0 };
  for (const c of criteria) counts[c.class]++;
  const holdout_counts = { holdout: 0, visible: 0 };
  for (const c of criteria) { if (c.holdout) holdout_counts.holdout++; else holdout_counts.visible++; }
  return { criteria, counts, holdout_counts };
}

// FAFF-275: within a Scenarios-section BODY (already isolated by sectionBodyRange), find the
// line-index spans to REMOVE for the builder view — a holdout fence (open..close inclusive) or a
// holdout bullet (its start line + continuation lines, up to the next blank/unit/fence/heading).
// Independent scan from classifyAcceptanceCriteria, but shares its two marker predicates
// (isHoldoutFenceOpen, the `/^holdout:\s*/i` bullet-prefix test) and its unit-boundary rules
// (blank / new-bullet / new-Given closes the current unit) — one shared vocabulary, two projections
// (classify's flags, split's removals), never two independently-drifting parsers.
function holdoutRemovalSpans(bodyLines) {
  const spans = [];
  let fence = false, fenceHoldout = false, fenceStart = -1;
  let bulletStart = -1;   // -1 == not currently inside a holdout-bullet unit
  const closeBullet = (endIdx) => { if (bulletStart !== -1) { spans.push({ start: bulletStart, end: endIdx }); bulletStart = -1; } };
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i].replace(/\s+$/, "");
    if (/^\s*(?:```|~~~)/.test(line)) {
      if (!fence) { fence = true; fenceHoldout = isHoldoutFenceOpen(line); fenceStart = i; closeBullet(i - 1); }
      else { if (fenceHoldout) spans.push({ start: fenceStart, end: i }); fence = false; fenceHoldout = false; fenceStart = -1; }
      continue;
    }
    if (fence) continue;                                          // in-fence content is handled as ONE span above
    if (line.trim() === "") { closeBullet(i - 1); continue; }      // blank closes the current holdout-bullet unit
    const li = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) { closeBullet(i - 1); bulletStart = /^holdout:\s*/i.test(li[1]) ? i : -1; continue; }
    if (/^\s*Given\b/i.test(line)) { closeBullet(i - 1); continue; }  // a new GWT unit is never itself holdout outside a fence
    // a continuation line belongs to the currently-open holdout bullet, if any — no-op otherwise
  }
  closeBullet(bodyLines.length - 1);
  return spans;
}

// FAFF-275: the deterministic split behind `faff dod split --view builder|full`. `full` is the
// identity (byte-for-byte). `builder` removes each holdout-marked scenario unit and inserts one
// withheld-count note directly under the Scenarios heading — a no-marker spec is a guaranteed,
// byte-identical no-op (the input is returned UNTOUCHED, never reconstructed from split lines).
// Pure: no tracker/network/LLM. Returns { text, warnings } — warnings is the over-withholding
// advisory (never gates; the CLI wrapper prints it to stderr, mirroring admissibleVerdict's
// return-don't-print convention elsewhere in this file).
function dodSplit(specText, view) {
  const text = String(specText == null ? "" : specText);
  if (view === "full") return { text, warnings: [] };

  const lines = text.split(/\r?\n/);
  const range = sectionBodyRange(lines, SCENARIOS_HEADING_RE, { extraStop: scenariosBoundaryStop });
  if (range == null) return { text, warnings: [] };                // no Scenarios section — nothing the marker's jurisdiction covers

  const bodyLines = lines.slice(range.bodyStart, range.bodyEnd);
  const classified = classifyAcceptanceCriteria(bodyLines.join("\n"));
  const holdoutCount = classified.filter((c) => c.holdout).length;
  if (holdoutCount === 0) return { text, warnings: [] };            // guaranteed byte-identical no-op

  const spans = holdoutRemovalSpans(bodyLines);
  const removed = new Set();
  for (const s of spans) for (let i = s.start; i <= s.end; i++) removed.add(i);
  const kept = [];
  for (let i = 0; i < bodyLines.length; i++) if (!removed.has(i)) kept.push(bodyLines[i]);
  // Collapse a doubled blank line LEFT BY a removal (array-level — never touch bytes outside
  // removed spans), then drop a leading blank: the note becomes the section's new first line.
  const collapsed = [];
  for (const l of kept) {
    if (l.trim() === "" && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === "") continue;
    collapsed.push(l);
  }
  while (collapsed.length > 0 && collapsed[0].trim() === "") collapsed.shift();

  const bornBefore = classified.filter((c) => c.kind === "scenario" || c.kind === "assertion").length;
  const bornAfter = classified.filter((c) => !c.holdout && (c.kind === "scenario" || c.kind === "assertion")).length;
  const warnings = [];
  if (bornBefore >= 1 && bornAfter === 0) {
    warnings.push("over-withholding advisory: the builder view retains ZERO born-verifiable Scenarios-section criteria (the full spec had >= 1) — consider marking fewer scenarios as holdout");
  }

  const note = `> ${holdoutCount} holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.`;
  const before = lines.slice(0, range.headingLine + 1);   // everything up to + including the Scenarios heading, untouched
  const after = lines.slice(range.bodyEnd);               // everything from the section's end onward, untouched
  const middleLines = ["", note, "", ...collapsed];
  return { text: [...before, ...middleLines, ...after].join("\n"), warnings };
}

// The `## Acceptance criteria` section body (case-insensitive heading PREFIX, so
// "## Acceptance Criteria" / "## Acceptance criteria (release)" match), up to the
// next "## " heading or EOF. null when no such section exists.
function acceptanceSection(prdText) {
  const lines = String(prdText == null ? "" : prdText).split(/\r?\n/);
  let start = -1;
  for (let k = 0; k < lines.length; k++) {
    if (/^\s*##\s+acceptance criteria/i.test(lines[k])) { start = k; break; }
  }
  if (start === -1) return null;
  const body = [];
  for (let k = start + 1; k < lines.length; k++) {
    if (/^\s*##\s+\S/.test(lines[k])) break;
    body.push(lines[k]);
  }
  return body.join("\n");
}

const BANNED_VAGUE = [
  "works correctly", "works as expected", "handled properly",
  "behaves correctly", "as appropriate", "etc.", "and so on", "properly handled",
];

function matchesBannedVague(text) {
  const t = String(text == null ? "" : text).toLowerCase();
  return BANNED_VAGUE.some((p) => t.includes(p));
}

// The `## Scenarios` heading matcher, shared by parseScenarios (R1, `faff
// admissible`) and dodClassify's sectionBody call (`faff dod classify`) so the two
// recognise the SAME heading forms by construction. Tolerant of an optional leading
// list-number (`5. ` / `5) `, matching the file's `\d+[.)]` numbering convention) and
// case-insensitive, so the producer's own `### 5. SCENARIOS` form is recognised (the
// DONE matcher is already number-tolerant — it keys on the word `\bdone\b`). Recognition
// only — the R1/R2a/R2b counting logic is unchanged (FAFF-300).
const SCENARIOS_HEADING_RE = /^\s*#{1,6}\s+(?:\d+[.)]\s+)?scenarios\b/i;

// Heading level of a markdown ATX heading line (count of leading #), else 0.
function headingLevel(line) {
  const m = String(line).match(/^\s*(#{1,6})\s+\S/);
  return m ? m[1].length : 0;
}

// --- Shared DoD-section boundary recognisers (FAFF-306) ---
// One source of truth for where the SCENARIOS section ends, so `dod classify`
// (via sectionBody) and `admissible` (via parseScenarios) cannot disagree on the
// section extent. The defect was a heading-LEVEL break (`lvl <= level`) that let a
// DEEPER DONE heading (`## Scenarios` h2 → `### N. DONE` h3) fail to stop the
// section, so it ran to EOF and swallowed the DONE heading, the trailing
// `confidence:` line, and the `faff-contract:` block as phantom criteria.

// A DONE heading: any ATX heading whose text contains the word `done` (the SAME
// predicate parseDoneChecklist keys its section START on — name-keyed, level-agnostic).
function isDoneHeading(line) {
  return headingLevel(line) > 0 && /\bdone\b/i.test(line);
}

// The producer's standalone trailing confidence line (`confidence: high|medium|low`).
// Never a criterion (not a GWT scenario, not a MUST/comparator assertion).
function isConfidenceLine(line) {
  return /^\s*confidence:\s*(?:high|medium|low)\s*$/i.test(line);
}

// A fence-open line whose info string carries `faff-contract:` (the trailing
// spec-readiness block). Keys on the info string ONLY — a generic GWT / bash fence
// (no `faff-contract:`) is NOT a stop, so scenario fence content is still kept.
function opensContractFence(line) {
  return /^\s*(?:```|~~~)\s*faff-contract:/i.test(line);
}

// The shared scenarios-section boundary extension: stop at a DONE heading (any
// level), the trailing contract block, or a standalone confidence line. Consulted
// OUTSIDE a fence only (in-fence GWT blocks never end the section). The `lvl <= level`
// equal/higher-heading break stays in each loop — this is the additive part both share.
function scenariosBoundaryStop(line) {
  return isDoneHeading(line) || opensContractFence(line) || isConfidenceLine(line);
}

// Level of the first heading (outside fences) matching `pred`, else 0. Used by the
// advisory DoD heading-level-mismatch check.
function firstHeadingLevelMatching(specText, pred) {
  const lines = String(specText == null ? "" : specText).split(/\r?\n/);
  let fence = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    if (pred(line)) return headingLevel(line);
  }
  return 0;
}

// Advisory (never gating) warning when SCENARIOS and DONE headings sit at different
// levels — the historical over-capture trap. Surfacing it is the reconciliation
// signal: admissible now flags the exact structural smell that used to silently
// desync it from `dod classify`. Empty array when levels match or either is absent.
function doneScenariosLevelWarning(specText) {
  const s = firstHeadingLevelMatching(specText, (l) => SCENARIOS_HEADING_RE.test(l));
  const d = firstHeadingLevelMatching(specText, (l) => isDoneHeading(l));
  if (s > 0 && d > 0 && s !== d) {
    return [`R4 advisory: SCENARIOS heading (h${s}) and DONE heading (h${d}) are at different levels — normalise them; dod classify reads the same section by name regardless, but a level mismatch is the historical over-capture trap (FAFF-306)`];
  }
  return [];
}

// Count born-verifiable scenarios under a `## Scenarios` heading: each
// Given/When/Then group (a `Given` line is enough to count one) PLUS each
// standalone assertion/constraint bullet (non-functional objectives are valid
// born-verifiable items per both producers). Pure — no I/O.
function parseScenarios(specText) {
  const lines = String(specText == null ? "" : specText).split(/\r?\n/);
  const isFence = (l) => /^\s*(?:```|~~~)/.test(l);
  let start = -1, level = 0, fence = false;
  for (let k = 0; k < lines.length; k++) {
    if (isFence(lines[k])) { fence = !fence; continue; }
    if (!fence && SCENARIOS_HEADING_RE.test(lines[k])) { start = k; level = headingLevel(lines[k]); break; }
  }
  if (start === -1) return 0;
  let count = 0;
  fence = false;
  for (let k = start + 1; k < lines.length; k++) {
    const line = lines[k];
    // FAFF-306: the SAME boundary `dod classify` uses — stop at a DONE heading / contract
    // fence / confidence line (outside a fence) so admissible cannot over-count past DONE.
    if (!fence && scenariosBoundaryStop(line)) break;
    if (isFence(line)) { fence = !fence; continue; }
    const lvl = fence ? 0 : headingLevel(line);               // a `#` inside a code fence is not a heading
    if (lvl > 0 && lvl <= level) break;                       // next equal/higher heading ends the section
    if (/^\s*Given\b/i.test(line)) { count++; continue; }     // a Given line counts one GWT group (in-fence GWT included)
    if (fence) continue;                                      // other in-fence lines are scenario prose, not bullets
    // a standalone assertion/constraint bullet (e.g. "- **Assertion:** …")
    if (/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)) {
      const body = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
      if (/\bassert(?:ion)?\b|\bconstraint\b|\bmust\b/i.test(body)) count++;
    }
  }
  return count;
}

// Collect `- [ ]` / `- [x]` checklist item texts under the DoD heading — matched
// by NAME (a heading whose text contains "DONE"), not by number, so it works for
// both `## 8. DONE` and `### 4. DONE`. Collect until the next heading of
// equal-or-higher level (sub-headings under DONE are included). Pure — no I/O.
function parseDoneChecklist(specText) {
  const lines = String(specText == null ? "" : specText).split(/\r?\n/);
  const isFence = (l) => /^\s*(?:```|~~~)/.test(l);
  let start = -1, level = 0, fence = false;
  for (let k = 0; k < lines.length; k++) {
    if (isFence(lines[k])) { fence = !fence; continue; }
    const lvl = fence ? 0 : headingLevel(lines[k]);           // a `#` inside a code fence is not a heading
    if (lvl > 0 && isDoneHeading(lines[k])) { start = k; level = lvl; break; }   // name-keyed (shared, FAFF-306)
  }
  if (start === -1) return [];
  const items = [];
  fence = false;
  for (let k = start + 1; k < lines.length; k++) {
    if (isFence(lines[k])) { fence = !fence; continue; }
    const lvl = fence ? 0 : headingLevel(lines[k]);
    if (lvl > 0 && lvl <= level) break;                       // next equal/higher heading ends the section
    if (fence) continue;                                      // checklist items live outside fences
    const m = lines[k].match(/^\s*[-*+]\s+\[[ xX]\]\s+(.*)$/);
    if (m) items.push(m[1].trim());
  }
  return items;
}

// R3 (advisory): does the spec carry a runnable check command? A fenced ```verify
// block, an "Integration smoke test" block, or a fenced shell/console command.
// Its absence only warns — never fails admissibility. Pure — no I/O.
function detectRunnableCheck(specText) {
  const t = String(specText == null ? "" : specText);
  if (/```\s*verify\b/i.test(t)) return true;
  if (/integration smoke test/i.test(t)) return true;
  if (/```\s*(?:bash|sh|shell|console)\b/i.test(t)) return true;
  return false;
}

// --- prose-DONE punt-prediction advisory (FAFF-304) ---
// The holdout evaluator forces EVERY prose-class DoD criterion to needs-human (a
// fixed rule — a code-blind judge can't machine-verify loose prose). So the count of
// prose DONE items is a deterministic, knowable-in-advance predictor of the
// evaluator's punt count. This advisory surfaces that prediction on `admissible`'s
// existing warnings[] channel — additive only, NEVER gating (it can't flip
// `admissible`). It reuses dodClassify (the SAME classifier the evaluator uses), so
// the count agrees with the evaluator by construction and inherits FAFF-306's
// corrected `## Scenarios` / `### N. DONE` section boundaries for free.

// Recall-biased duplicate threshold + stopwords — tunable constants (a floor, by
// design; tune from real misses, never escalate to an LLM), mirroring BANNED_VAGUE.
const DUP_THRESHOLD = 0.6;
const PROSE_DONE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "by", "for",
  "with", "is", "are", "be", "was", "were", "been", "it", "its", "this", "that",
  "these", "those", "as", "so", "if", "then", "when", "given", "than", "into",
  "from", "over", "via", "not", "will", "must", "should", "can", "may", "each",
  "any", "all", "no", "new",
]);

// Content tokens of a criterion: lowercase, strip markdown/backticks/punctuation,
// drop 1-char tokens and stopwords (incl. Given/When/Then scaffolding). Returns a Set.
function proseDoneTokens(text) {
  const cleaned = String(text == null ? "" : text)
    .toLowerCase()
    .replace(/`+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ");
  const out = new Set();
  for (const w of cleaned.split(/\s+/)) {
    if (w.length > 1 && !PROSE_DONE_STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

// One-directional containment of the DONE item's tokens in a born-verifiable
// criterion's tokens (NOT symmetric Jaccard) — a restated DONE item is typically a
// near-subset of the fuller scenario, which carries extra Given/When/Then scaffolding
// a symmetric score would under-weight. Returns the fraction of the DONE item's tokens
// the born-verifiable one covers, in [0,1].
function proseDoneContainment(doneText, bornText) {
  const dt = proseDoneTokens(doneText);
  if (dt.size === 0) return 0;
  const bt = proseDoneTokens(bornText);
  let inter = 0;
  for (const w of dt) if (bt.has(w)) inter++;
  return inter / dt.size;
}

// Pure: given the spec text, return the prose-DONE advisory data, or null when there
// is no prose DONE item (no warning). Reuses dodClassify — the single source of truth,
// no second parser. The duplicate flag is a recall-biased advisory refinement; it
// annotates, never gates.
function proseDoneAdvisory(specText) {
  let classified;
  try { classified = dodClassify(specText); } catch (e) { return null; }
  const proseDone = classified.criteria.filter((c) => c.source === "done" && c.class === "prose");
  if (proseDone.length === 0) return null;
  const bornVerifiable = classified.criteria.filter((c) => c.class === "scenario" || c.class === "assertion");
  const duplicates = proseDone.filter((p) => bornVerifiable.some((b) => proseDoneContainment(p.text, b.text) >= DUP_THRESHOLD));
  return { count: proseDone.length, items: proseDone, duplicates };
}

// Render the single-line advisory (deterministic "prose-DONE advisory:" prefix). Items
// whitespace-collapsed + truncated ~50 chars, mirroring the R2b detail style. The
// duplicate clause is omitted entirely when no item looks like a restatement.
function renderProseDoneWarning(adv) {
  const trunc = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 50);
  const items = adv.items.map((p) => trunc(p.text)).join(" | ");
  let s = `prose-DONE advisory: ${adv.count} DONE item(s) are loose prose and will be forced to needs-human by the holdout evaluator: ${items}`;
  if (adv.duplicates.length >= 1) {
    const dups = adv.duplicates.map((p) => trunc(p.text)).join(" | ");
    s += `  (${adv.duplicates.length} appear to restate a born-verifiable scenario — candidates to remove: ${dups})`;
  }
  return s;
}

// The pure verdict. Any parse exception coerces to inadmissible (fail-safe).
function admissibleVerdict(specText, lightsOut) {
  if (!lightsOut) {
    return { admissible: true, reasons: [], checks: [{ id: "scope", pass: true, detail: "not lights-out — gate inactive" }], warnings: [] };
  }
  let scenarios, doneItems;
  try {
    scenarios = parseScenarios(specText);
    doneItems = parseDoneChecklist(specText);
  } catch (e) {
    return { admissible: false, reasons: ["spec unparseable — fail-safe inadmissible"], checks: [], warnings: [] };
  }
  const checks = [];
  checks.push({ id: "R1.scenarios", pass: scenarios >= 1, detail: `${scenarios} born-verifiable scenario(s) (need >=1)` });
  checks.push({ id: "R2a.done-present", pass: doneItems.length >= 1, detail: `${doneItems.length} DONE checklist item(s) (need >=1)` });
  const vague = doneItems.filter((it) => matchesBannedVague(it));
  checks.push({ id: "R2b.done-concrete", pass: vague.length === 0, detail: `${vague.length} vague DONE item(s)${vague.length ? ": " + vague.map((v) => v.replace(/\s+/g, " ").slice(0, 50)).join(" | ") : ""}` });
  const warnings = detectRunnableCheck(specText) ? [] : ["R3 advisory: no runnable check command found (recommended for lights-out, not required)"];
  warnings.push(...doneScenariosLevelWarning(specText));   // FAFF-306: advisory only — never flips admissible
  const adv = proseDoneAdvisory(specText);                 // FAFF-304: predict the evaluator's prose-DONE punts
  if (adv) warnings.push(renderProseDoneWarning(adv));     // advisory only — never flips admissible
  const admissible = checks.every((c) => c.pass);
  const reasons = checks.filter((c) => !c.pass).map((c) => c.detail);
  return { admissible, reasons, checks, warnings };
}

// Verdict-table selftest — one case per spec'd branch.
const ADMISSIBLE_GOOD = [
  "## Scenarios", "",
  "```", "Given a lights-out run and a concrete spec", "When the gate evaluates it", "Then the verdict is admissible", "```", "",
  "## 8. DONE", "", "- [ ] `faff admissible` MUST emit the verdict JSON", "- [ ] exit code MUST be 0 admissible / 1 inadmissible", "",
  "**Integration smoke test.**", "```", "faff admissible --selftest", "```", "",
].join("\n");

// The producer's own default heading form: numbered + H3 + uppercase
// (`### 5. SCENARIOS` / `### 8. DONE`). Same content as ADMISSIBLE_GOOD; only the
// heading style differs — recognition must not gate on it (FAFF-300).
const ADMISSIBLE_GOOD_NUMBERED = [
  "### 5. SCENARIOS", "",
  "```", "Given a lights-out run and a concrete spec", "When the gate evaluates it", "Then the verdict is admissible", "```", "",
  "### 8. DONE", "", "- [ ] `faff admissible` MUST emit the verdict JSON", "- [ ] exit code MUST be 0 admissible / 1 inadmissible", "",
].join("\n");

// FAFF-304 fixtures — prose DONE items trip the holdout evaluator's prose→needs-human
// punt rule. ADMISSIBLE_PROSE_DONE: 3 prose DONE that do NOT restate the scenario (no
// duplicate clause). ADMISSIBLE_DUP_DONE: 3 prose DONE, 2 of which restate the scenario
// (the duplicate clause names those 2 as candidates to remove).
const ADMISSIBLE_PROSE_DONE = [
  "## Scenarios", "",
  "```", "Given a request to /healthz", "When the server is running", "Then it responds 200", "```", "",
  "## 8. DONE", "",
  "- [ ] The dashboard surfaces deployment status to operators",
  "- [ ] Operators can filter the audit log by actor",
  "- [ ] The onboarding flow welcomes new users",
].join("\n");

const ADMISSIBLE_DUP_DONE = [
  "## Scenarios", "",
  "```", "Given a user submits a shortened link request", "When the server stores the mapping", "Then the api returns the short code", "```", "",
  "## 8. DONE", "",
  "- [ ] the server stores the mapping for a shortened link request",
  "- [ ] the api returns the short code to the user",
  "- [ ] operators receive a weekly analytics digest",
].join("\n");

function admissibleSelftest() {
  const noScenarios = ADMISSIBLE_GOOD.replace(/## Scenarios[\s\S]*?\n\n(?=## 8\. DONE)/, "");
  const cases = [
    { name: "admissible (R1+R2 pass, R3 ok)", text: ADMISSIBLE_GOOD, lights: true, wantAdmissible: true, wantWarn: false },
    { name: "admissible numbered headings (### N. SCENARIOS / ### N. DONE)", text: ADMISSIBLE_GOOD_NUMBERED, lights: true, wantAdmissible: true },
    { name: "R1-fail (no Scenarios)", text: noScenarios, lights: true, wantAdmissible: false, wantReason: /R1|scenario/i },
    { name: "R2a-fail (empty DONE)", text: "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n(no items)\n", lights: true, wantAdmissible: false, wantReason: /DONE checklist/i },
    { name: "R2b-fail (vague DONE item)", text: "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the feature works correctly\n", lights: true, wantAdmissible: false, wantReason: /vague DONE/i },
    { name: "R3-advisory-warn (no runnable check)", text: "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n", lights: true, wantAdmissible: true, wantWarn: true },
    { name: "unparseable-failsafe (empty body)", text: "", lights: true, wantAdmissible: false },
    { name: "scope-inactive (no --lights-out)", text: "", lights: false, wantAdmissible: true, wantScope: true },
    // FAFF-306: a DoD heading-level mismatch (`## Scenarios` h2 / `### N. DONE` h3) stays admissible
    // but MUST surface the advisory level-mismatch warning — never flipping the boolean.
    { name: "FAFF-306 level-mismatch advisory (h2 Scenarios / h3 DONE)", text: "## Scenarios\n```\nGiven x\nThen y\n```\n\n### 2. DONE\n\n- [ ] the parser returns >=1 item\n", lights: true, wantAdmissible: true, wantWarnMatch: /different levels.*FAFF-306/ },
    // Consistent levels (both h2) must emit NO level-mismatch warning (regression guard).
    { name: "FAFF-306 consistent levels → no level warning", text: "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n", lights: true, wantAdmissible: true, wantNoLevelWarn: true },
    // FAFF-304: prose DONE items predict the holdout evaluator's needs-human punts —
    // advisory only, never flipping the boolean.
    { name: "FAFF-304 prose-DONE-fires-advisory (3 prose DONE)", text: ADMISSIBLE_PROSE_DONE, lights: true, wantAdmissible: true, wantAdvisory: true, wantAdvisoryCount: 3, wantDuplicate: false },
    { name: "FAFF-304 born-verifiable-DONE-no-advisory", text: ADMISSIBLE_GOOD, lights: true, wantAdmissible: true, wantAdvisory: false },
    { name: "FAFF-304 duplicate-annotation-present (2 restate a scenario)", text: ADMISSIBLE_DUP_DONE, lights: true, wantAdmissible: true, wantAdvisory: true, wantAdvisoryCount: 3, wantDuplicate: true },
    { name: "FAFF-304 advisory-never-flips-admissible (prose DONE stays admissible)", text: ADMISSIBLE_PROSE_DONE, lights: true, wantAdmissible: true, wantAdvisory: true },
  ];
  let failed = 0;
  for (const c of cases) {
    const v = admissibleVerdict(c.text, c.lights);
    let ok = v.admissible === c.wantAdmissible;
    if (ok && c.wantReason) ok = v.reasons.some((r) => c.wantReason.test(r));
    if (ok && c.wantWarn === true) ok = v.warnings.length >= 1;
    if (ok && c.wantWarn === false) ok = v.warnings.length === 0;
    if (ok && c.wantWarnMatch) ok = v.warnings.some((w) => c.wantWarnMatch.test(w));    // FAFF-306
    if (ok && c.wantNoLevelWarn) ok = !v.warnings.some((w) => /different levels/.test(w));  // FAFF-306
    // FAFF-304: the prose-DONE punt-prediction advisory (a warnings[] string, never gating)
    const advWarn = v.warnings.find((w) => w.startsWith("prose-DONE advisory:"));
    if (ok && c.wantAdvisory === true) ok = !!advWarn;
    if (ok && c.wantAdvisory === false) ok = !advWarn;
    if (ok && typeof c.wantAdvisoryCount === "number") ok = !!advWarn && new RegExp(`^prose-DONE advisory: ${c.wantAdvisoryCount} DONE item`).test(advWarn);
    if (ok && c.wantDuplicate === true) ok = !!advWarn && /candidates to remove:/.test(advWarn);
    if (ok && c.wantDuplicate === false) ok = !!advWarn && !/candidates to remove:/.test(advWarn);
    if (ok && c.wantScope) ok = v.checks.length === 1 && v.checks[0].id === "scope" && v.warnings.length === 0;
    // invariant: reasons non-empty IFF inadmissible; warnings never flip admissible
    if (ok) ok = (v.reasons.length > 0) === (v.admissible === false);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${c.name} → admissible=${v.admissible}`);
  }
  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}

function cmdAdmissible(args) {
  if (args.includes("--selftest")) return admissibleSelftest();
  const lightsOut = args.includes("--lights-out");
  const json = args.includes("--json");
  const specIdx = args.indexOf("--spec");
  const specArg = specIdx !== -1 ? args[specIdx + 1] : null;
  let specText;
  try {
    if (specArg && specArg !== "-") specText = fs.readFileSync(specArg, "utf8");
    else specText = fs.readFileSync(0, "utf8");   // --spec - or no --spec → stdin
  } catch (e) {
    process.stderr.write(`faff admissible: cannot read spec: ${e.message}\n`);
    return 2;
  }
  const v = admissibleVerdict(specText, lightsOut);
  if (json) {
    process.stdout.write(JSON.stringify(v) + "\n");
  } else {
    process.stdout.write(JSON.stringify(v, null, 2) + "\n");
  }
  return v.admissible ? 0 : 1;
}

// faff dod classify — FAFF-34: classify a spec's DoD criteria by born-verifiability class (reusing
// classifyCriterion verbatim), for the evaluator to decide which it may machine-judge (scenario/assertion)
// vs force to needs-human (prose). Pure: file/stdin in, JSON out, no tracker/network/LLM.
// FAFF-275: `dod split` is a sibling action in this same namespace — see cmdDodSplit.
function cmdDod(args) {
  if (args.includes("--selftest")) return dodSelftest();
  const action = args.find((a) => !a.startsWith("--"));
  if (action === "split") return cmdDodSplit(args);
  if (action !== "classify") {
    process.stderr.write("faff dod: usage:\n  faff dod classify --spec <path|-> [--json]\n  faff dod split --spec <path|-> --view builder|full\n");
    return 2;
  }
  const json = args.includes("--json");
  const specIdx = args.indexOf("--spec");
  const specArg = specIdx !== -1 ? args[specIdx + 1] : null;
  let specText;
  try {
    if (specArg && specArg !== "-") specText = fs.readFileSync(specArg, "utf8");
    else specText = fs.readFileSync(0, "utf8");   // --spec - or no --spec → stdin
  } catch (e) {
    process.stderr.write(`faff dod classify: cannot read spec: ${e.message}\n`);
    return 2;
  }
  const r = dodClassify(specText);
  process.stdout.write(JSON.stringify(r, null, json ? 0 : 2) + "\n");
  return 0;   // a successful parse is exit 0 (an empty criteria set is valid data the evaluator handles)
}

// faff dod split --spec <path|-> --view builder|full — FAFF-275: print the requested visibility
// view of a spec. `full` is the identity (byte-for-byte); `builder` removes each holdout-marked
// scenario unit (see dodSplit) and inserts one withheld-count note. Pure beyond the single
// file/stdin read (no tracker/network/LLM) — the over-withholding advisory (if any) is printed to
// stderr, never gating (exit stays 0). Exit 2: missing/unknown --view, or unreadable spec.
function cmdDodSplit(args) {
  const view = adrFlag(args, "--view");
  if (view !== "builder" && view !== "full") {
    process.stderr.write("faff dod split: usage: faff dod split --spec <path|-> --view builder|full\n");
    return 2;
  }
  const specIdx = args.indexOf("--spec");
  const specArg = specIdx !== -1 ? args[specIdx + 1] : null;
  let specText;
  try {
    if (specArg && specArg !== "-") specText = fs.readFileSync(specArg, "utf8");
    else specText = fs.readFileSync(0, "utf8");   // --spec - or no --spec → stdin
  } catch (e) {
    process.stderr.write(`faff dod split: cannot read spec: ${e.message}\n`);
    return 2;
  }
  const { text, warnings } = dodSplit(specText, view);
  process.stdout.write(text);
  for (const w of warnings) process.stderr.write(`faff dod split: ${w}\n`);
  return 0;
}

// In-memory selftest of dodClassify + classifyCriterion parity (mirrors admissible --selftest). No I/O.
function dodSelftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`dod --selftest FAIL: ${label}\n`); failed++; } };
  const spec = [
    "## Scenarios",
    "```",
    "Given a user is logged in",
    "When they click checkout",
    "Then the order is submitted",
    "```",
    "",
    "- The p99 latency MUST be < 200ms",
    "",
    "## 8. DONE",
    "",
    "### From WHY",
    "- [ ] Given X is set, When Y runs, Then Z holds",
    "- [ ] The API MUST return 200 on /healthz",
    "- [ ] The onboarding copy reads warmly",
  ].join("\n");
  const r = dodClassify(spec);
  check("a Given/When/Then unit → scenario", r.criteria.some((c) => c.class === "scenario"));
  check("a MUST/comparator unit → assertion", r.criteria.some((c) => c.class === "assertion"));
  check("anything else → prose", r.criteria.some((c) => c.class === "prose"));
  check("scenarios + done sources both present", r.criteria.some((c) => c.source === "scenarios") && r.criteria.some((c) => c.source === "done"));
  check("counts sum equals criteria length", r.counts.scenario + r.counts.assertion + r.counts.prose === r.criteria.length);
  check("classifyCriterion parity: Then → scenario", classifyCriterion("Then it happens") === "scenario");
  check("classifyCriterion parity: MUST → assertion", classifyCriterion("It MUST be fast") === "assertion");
  check("classifyCriterion parity: comparator → assertion", classifyCriterion("count = 5") === "assertion");
  check("classifyCriterion parity: plain prose → prose", classifyCriterion("It feels nice") === "prose");
  const empty = dodClassify("# Spec with no DoD sections\n\njust prose.\n");
  check("no DoD sections → empty criteria, parse still succeeds", empty.criteria.length === 0);
  // FAFF-300: the shared SCENARIOS_HEADING_RE means a numbered `### 5. SCENARIOS`
  // heading (the producer's own form) is recognised by dodClassify, not just by admissible.
  const numbered = dodClassify("### 5. SCENARIOS\n```\nGiven x\nWhen y\nThen z\n```\n\n### 8. DONE\n- [ ] the parser returns >=1 item\n");
  check("numbered `### N. SCENARIOS` heading → scenarios source recognised", numbered.criteria.some((c) => c.source === "scenarios"));
  // FAFF-306: a `## Scenarios` (h2) followed by a DEEPER `### N. DONE` (h3) must NOT over-capture
  // past the DONE heading — the DONE heading line, the trailing `confidence:` line, and the
  // `faff-contract:` block must never become phantom `prose` criteria, and DONE items must not be
  // double-counted under `source:"scenarios"`. Correcting only the heading level must not change the result.
  const mmUnnumbered = [
    "## Scenarios", "",
    "```", "Given a user is logged in", "When they checkout", "Then the order is submitted", "```", "",
    "### 2. DONE", "",
    "- [ ] The API MUST return 200 on /healthz",
    "",
    "confidence: high", "",
    "```faff-contract:spec-readiness", '{ "confidence": "high" }', "```", "",
  ].join("\n");
  const mmNumbered = mmUnnumbered.replace(/^## Scenarios/m, "### 1. SCENARIOS");
  const mmU = dodClassify(mmUnnumbered), mmN = dodClassify(mmNumbered);
  check("FAFF-306: h2-Scenarios/h3-DONE → no phantom prose (DONE heading/confidence/contract excluded)", mmU.counts.prose === 0);
  check("FAFF-306: DONE items not double-counted (source scenarios holds only the real GWT)", mmU.criteria.filter((c) => c.source === "scenarios").length === 1 && mmU.criteria.filter((c) => c.source === "done").length === 1);
  check("FAFF-306: classification is identical whether SCENARIOS is h2 or h3 (heading level no longer matters)", JSON.stringify(mmU) === JSON.stringify(mmN));
  check("FAFF-306: parseScenarios count == dod source:scenarios scenario count (cross-parser agreement)", parseScenarios(mmUnnumbered) === mmU.criteria.filter((c) => c.source === "scenarios" && c.class === "scenario").length);

  // --- FAFF-275: holdout marker + `dod split` ---
  const holdoutSpec = [
    "## Scenarios", "",
    "```holdout",
    "Given a fenced holdout scenario",
    "When it runs",
    "Then it is withheld from the builder",
    "```", "",
    "```",
    "Given a plain visible scenario",
    "When it runs",
    "Then it is NOT withheld",
    "```", "",
    "- holdout: The p99 latency MUST be < 200ms",
    "- The onboarding copy reads warmly",
    "",
    "## 8. DONE", "",
    "- [ ] the parser returns >=1 item",
  ].join("\n");
  const hc = dodClassify(holdoutSpec);
  const scenarioCriteria = hc.criteria.filter((c) => c.source === "scenarios");
  check("FAFF-275: fenced-holdout GWT criterion → holdout true", scenarioCriteria.some((c) => c.class === "scenario" && c.holdout === true && /withheld from the builder/.test(c.text)));
  check("FAFF-275: plain-fence GWT criterion → holdout false", scenarioCriteria.some((c) => c.class === "scenario" && c.holdout === false && /NOT withheld/.test(c.text)));
  check("FAFF-275: `holdout:` bullet → prefix stripped, class assertion, holdout true", scenarioCriteria.some((c) => c.text === "The p99 latency MUST be < 200ms" && c.class === "assertion" && c.holdout === true));
  check("FAFF-275: unmarked bullet → holdout false", scenarioCriteria.some((c) => /onboarding copy/.test(c.text) && c.holdout === false));
  check("FAFF-275: holdout_counts sums to criteria.length, holdout+visible split correct", hc.holdout_counts.holdout + hc.holdout_counts.visible === hc.criteria.length && hc.holdout_counts.holdout === 2);
  check("FAFF-275: counts is UNCHANGED shape and still sums to criteria.length", hc.counts.scenario + hc.counts.assertion + hc.counts.prose === hc.criteria.length);

  const builderView = dodSplit(holdoutSpec, "builder");
  check("FAFF-275: dod split --view full is the identity (byte-for-byte)", dodSplit(holdoutSpec, "full").text === holdoutSpec);
  check("FAFF-275: dod split --view builder omits the fenced-holdout block", !/withheld from the builder/.test(builderView.text));
  check("FAFF-275: dod split --view builder omits the holdout bullet", !/p99 latency/.test(builderView.text));
  check("FAFF-275: dod split --view builder retains the visible scenario + bullet", /NOT withheld/.test(builderView.text) && /onboarding copy/.test(builderView.text));
  check("FAFF-275: dod split --view builder inserts the withheld-count note under the Scenarios heading", /^## Scenarios\n\n> 2 holdout scenario\(s\) withheld/.test(builderView.text));
  check("FAFF-275: dod split --view builder retains the DONE section untouched", /## 8\. DONE[\s\S]*the parser returns >=1 item/.test(builderView.text));

  // Coherence invariant: dodClassify(dodSplit(spec, builder)) == full classification minus the holdout criteria.
  const bviewClassified = dodClassify(builderView.text);
  const expectedRemaining = hc.criteria.filter((c) => !c.holdout);
  check("FAFF-275 coherence invariant: builder-view classification == full minus holdout criteria", JSON.stringify(bviewClassified.criteria) === JSON.stringify(expectedRemaining));
  check("FAFF-275 coherence invariant: builder-view holdout_counts.holdout is 0", bviewClassified.holdout_counts.holdout === 0);

  // A marker-free spec's builder view MUST be a byte-identical no-op.
  const noMarkerSpec = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n";
  check("FAFF-275: no-marker spec → builder view is byte-identical to the input", dodSplit(noMarkerSpec, "builder").text === noMarkerSpec);

  // A marker OUTSIDE the Scenarios section is not recognised — no flag, no strip, no removal.
  const markerOutside = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] holdout: the parser returns >=1 item\n";
  const outsideClassified = dodClassify(markerOutside);
  check("FAFF-275: a `holdout:`-prefixed DONE item stays literal (not stripped), holdout false", outsideClassified.criteria.some((c) => c.source === "done" && c.text === "holdout: the parser returns >=1 item" && c.holdout === false));
  check("FAFF-275: dod split never removes a DONE-section holdout-prefixed item", dodSplit(markerOutside, "builder").text === markerOutside);

  // ~~~ fences are recognised too, matching the shared fence recognisers.
  const tildeSpec = "## Scenarios\n\n~~~holdout\nGiven x\nWhen y\nThen z\n~~~\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n";
  const tildeClassified = dodClassify(tildeSpec);
  check("FAFF-275: ~~~holdout fence recognised same as ```holdout", tildeClassified.criteria.some((c) => c.source === "scenarios" && c.holdout === true));
  check("FAFF-275: dod split removes a ~~~holdout fence", !/Given x/.test(dodSplit(tildeSpec, "builder").text));

  // Over-withholding: builder view retains ZERO born-verifiable scenarios-section criteria while
  // the full spec had >= 1 → advisory warning, never a gate (dodSplit still succeeds, just warns).
  const allHoldoutSpec = "## Scenarios\n```holdout\nGiven x\nWhen y\nThen z\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n";
  const allHoldoutSplit = dodSplit(allHoldoutSpec, "builder");
  check("FAFF-275: over-withholding fires an advisory warning (never a gate)", allHoldoutSplit.warnings.length >= 1 && /over-withholding/.test(allHoldoutSplit.warnings[0]));

  // Marked-vs-unmarked parity: `faff admissible` on the FULL spec is marker-blind (a holdout-marked
  // scenario counts toward R1 exactly as unmarked — fence info never mattered to parseScenarios).
  const unmarkedEquivalent = holdoutSpec.replace(/```holdout/, "```").replace(/- holdout: /, "- ");
  const vMarked = admissibleVerdict(holdoutSpec, true), vUnmarked = admissibleVerdict(unmarkedEquivalent, true);
  check("FAFF-275: marked-vs-unmarked admissible parity (same admissible verdict + reasons)", vMarked.admissible === vUnmarked.admissible && JSON.stringify(vMarked.reasons) === JSON.stringify(vUnmarked.reasons));

  if (failed) { console.log(`dod --selftest: FAIL (${failed} failed)`); return 1; }
  console.log("dod --selftest: ok"); return 0;
}

// faff holdout verdicts — FAFF-277: the pure, trust-gated bridge from the evaluator's persisted holdout
// verdicts (`.faff/holdout/<key>.json`) to the already-shipped `faff prdr coverage --dod-verdicts` flag.
// Reads each verdict, re-validates it through the SAME `computeHoldoutVerdict` gate (never a forked rule),
// translates a passing `meets-spec` → the literal `met`, folds conservatively per PRDR, and emits the
// `{prdr-id: value}` map keyed by the supplied issue→PRDR association. Pure: filesystem read of --dir +
// args only (no tracker/network/LLM) — parity with `dod classify` / `prdr coverage`.
function cmdHoldout(args) {
  if (args.includes("--selftest")) return holdoutVerdictsSelftest();
  const action = args.find((a) => !a.startsWith("--"));
  if (action === "verdict") return cmdHoldoutVerdict(args);   // FAFF-311: the singular per-issue graft gate
  if (action !== "verdicts") {
    process.stderr.write("faff holdout: usage:\n  faff holdout verdicts --association <json|@file|-> [--dir .faff/holdout] [--json]\n  faff holdout verdict --issue <id> [--dir .faff/holdout] [--json]\n");
    return 2;
  }
  // --association (required): inline JSON, @path, or - for stdin. A broken association is operator error
  // (fail-loud exit 2), NOT a silent empty map.
  const assocRaw = adrFlag(args, "--association");
  if (assocRaw == null) { process.stderr.write("faff holdout verdicts: --association is required (JSON object { holdout-key: prdr-id }, @path, or - for stdin)\n"); return 2; }
  let assocText;
  try {
    if (assocRaw === "-") assocText = fs.readFileSync(0, "utf8");
    else if (assocRaw.startsWith("@")) assocText = fs.readFileSync(assocRaw.slice(1), "utf8");
    else assocText = assocRaw;
  } catch (e) { process.stderr.write(`faff holdout verdicts: cannot read --association: ${e.message}\n`); return 2; }
  let association;
  try { association = JSON.parse(assocText); } catch (e) { process.stderr.write(`faff holdout verdicts: --association is not valid JSON: ${e.message}\n`); return 2; }
  if (association === null || typeof association !== "object" || Array.isArray(association)) {
    process.stderr.write("faff holdout verdicts: --association must be a JSON object { holdout-key: prdr-id }\n"); return 2;
  }
  const dir = adrFlag(args, "--dir") || ".faff/holdout";
  // Read the store. An ABSENT dir (ENOENT) is the valid "nothing trusted yet" case → empty map, exit 0
  // (coverage already handles it). An UNREADABLE dir (a file, a permission error) is operator error → exit 2.
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch (e) {
    if (e.code === "ENOENT") names = [];
    else { process.stderr.write(`faff holdout verdicts: cannot read --dir ${JSON.stringify(dir)}: ${e.message}\n`); return 2; }
  }
  const files = names.map((name) => {
    const key = name.slice(0, -".json".length);
    try { return { key, text: fs.readFileSync(path.join(dir, name), "utf8") }; }
    catch { return { key, unreadable: true }; }
  });
  // FAFF-384: --require-spawner-attested arms the spawner-attestation ratchet inside the shared trust gate.
  // The caller (the run bridge) sets it iff the run's lane-boundary intent promised the evaluator cage.
  const requireSpawnerAttested = args.includes("--require-spawner-attested");
  const out = computeHoldoutVerdictsMap(association, files, { requireSpawnerAttested });
  const json = args.includes("--json");   // accepted for symmetry with `dod classify`; output is always JSON
  process.stdout.write(JSON.stringify(out, null, json ? 0 : 2) + "\n");
  // The skipped audit trail also goes to stderr so a missing/untrusted PRDR is visible, never silent.
  if (out.skipped.length) {
    process.stderr.write(`faff holdout verdicts: skipped ${out.skipped.length} file(s): ${out.skipped.map((s) => `${s.key}(${s.reason})`).join(", ")}\n`);
  }
  return 0;   // report-only (parity with coverage/yagni): an empty map is a valid conservative answer, exit 0
}

// faff holdout verdict --issue <id> — FAFF-311: the per-issue merge-floor GATE lookup for `faff-graft`
// Step 10 (Decision 4 → Option A, persist-once/consume-twice). Reads the SINGLE per-issue verdict
// `.faff/holdout/<id>.json`, re-validates it through the SAME `computeHoldoutVerdict` gate (never a forked
// rule — via holdoutGateResult), and reduces it to a pass/block decision keyed to the issue being built,
// BEFORE the FAFF-277 PRDR fold. Fail-closed: a missing/unreadable/malformed/non-blind/incoherent verdict,
// or any aggregate ≠ meets-spec, is `block` (exit 1) — never a silent pass. Exit 0 = pass, 1 = block,
// 2 = usage. PURE beyond the single-file read (no tracker/network/LLM). The same file still feeds the
// unchanged `faff holdout verdicts --association` run roll-up (one artifact, two consumers).
function cmdHoldoutVerdict(args) {
  const issue = adrFlag(args, "--issue");
  if (!issue) { process.stderr.write("faff holdout verdict: --issue <id> is required\n"); return 2; }
  // The issue id is a filename component — a safe ticket token only (letters/digits/._-, no leading dash).
  // Reject anything else (path separators, `..`, a stray flag captured as the value) so `--issue` can never
  // traverse out of --dir; usage error (exit 2), never a silent read of an unintended path.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) || issue.includes("..")) {
    process.stderr.write(`faff holdout verdict: --issue ${JSON.stringify(issue)} is not a valid issue id (letters/digits/._- only, no path separators)\n`); return 2;
  }
  const dir = adrFlag(args, "--dir") || ".faff/holdout";
  const file = path.join(dir, `${issue}.json`);
  const json = args.includes("--json");
  const emit = (res, status) => {
    process.stdout.write(JSON.stringify({ issue, ...res }, null, json ? 0 : 2) + "\n");
    if (res.gate === "block") process.stderr.write(`faff holdout verdict: ${issue} BLOCKED (${res.reason})\n`);
    return status;
  };
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { return emit({ gate: "block", reason: e.code === "ENOENT" ? "missing" : "unreadable", detail: e.message }, 1); }
  let block;
  try { block = JSON.parse(text); }
  catch (e) { return emit({ gate: "block", reason: "unreadable", detail: e.message }, 1); }
  // FAFF-384: --require-spawner-attested arms the spawner-attestation ratchet inside the SAME trust gate.
  // faff-graft Step-10 sets it iff the run's lane-boundary intent promised the evaluator cage; absent, the
  // gate is byte-for-byte today's per-issue behaviour (legacy uncaged runs unaffected).
  const requireSpawnerAttested = args.includes("--require-spawner-attested");
  const res = holdoutGateResult(block, { requireSpawnerAttested });
  return emit(res, res.gate === "pass" ? 0 : 1);
}

// In-memory selftest of computeHoldoutVerdictsMap + holdoutGateResult — the gate + translate + conservative
// fold + the singular per-issue gate (mirrors dod --selftest; the map/gate fns are pure).
function holdoutVerdictsSelftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`holdout --selftest FAIL: ${label}\n`); failed++; } };
  const block = (aggregate, verdict, code_blind = true) => JSON.stringify({
    aggregate, code_blind,
    criteria: [{ class: "assertion", verdict, evidence_present: true }],
    violations: [],
  });
  const meets = block("meets-spec", "met");
  const fails = block("fails", "unmet");

  // 1. conformant meets-spec + association → {prdr:"met"}
  const r1 = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, [{ key: "FAFF-34", text: meets }]);
  check("conformant meets-spec → {prdr:met}", JSON.stringify(r1.verdicts) === JSON.stringify({ "0007": "met" }) && r1.skipped.length === 0);

  // 2. code_blind:false → PRDR absent, skipped contract-rejected
  const r2 = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, [{ key: "FAFF-34", text: block("meets-spec", "met", false) }]);
  check("code_blind:false → absent + contract-rejected", !("0007" in r2.verdicts) && r2.skipped.some((s) => s.key === "FAFF-34" && s.reason === "contract-rejected"));

  // 3. conformant fails → verdicts[prdr]=="fails" (≠ met)
  const r3 = computeHoldoutVerdictsMap({ "FAFF-B": "0008" }, [{ key: "FAFF-B", text: fails }]);
  check("conformant fails → 'fails' (≠ met)", r3.verdicts["0008"] === "fails");

  // 4. empty dir → {}
  const r4 = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, []);
  check("empty files → {} verdicts", Object.keys(r4.verdicts).length === 0);

  // 5. conservative fold: meets-spec + fails on one PRDR → not met
  const r5 = computeHoldoutVerdictsMap({ "FAFF-A": "0007", "FAFF-B": "0007" }, [{ key: "FAFF-A", text: meets }, { key: "FAFF-B", text: fails }]);
  check("two files one PRDR (meets+fails) → not met", r5.verdicts["0007"] !== "met" && r5.verdicts["0007"] === "fails");

  // 6. fold: met + met on one PRDR → met
  const r6 = computeHoldoutVerdictsMap({ "FAFF-A": "0007", "FAFF-C": "0007" }, [{ key: "FAFF-A", text: meets }, { key: "FAFF-C", text: meets }]);
  check("two files one PRDR (met+met) → met", r6.verdicts["0007"] === "met");

  // 7. no association entry → skipped no-association, contributes nothing
  const r7 = computeHoldoutVerdictsMap({}, [{ key: "FAFF-X", text: meets }]);
  check("no-association → skipped, nothing contributed", Object.keys(r7.verdicts).length === 0 && r7.skipped.some((s) => s.reason === "no-association"));

  // 8. unreadable / malformed JSON → skipped unreadable
  const r8 = computeHoldoutVerdictsMap({ "FAFF-A": "0007", "FAFF-B": "0007" }, [{ key: "FAFF-A", unreadable: true }, { key: "FAFF-B", text: "{not json" }]);
  check("unreadable + malformed → skipped unreadable, never met", !("0007" in r8.verdicts) && r8.skipped.filter((s) => s.reason === "unreadable").length === 2);

  // 9. trusted non-'met' passes through as its own string (gaps/needs-human are ≠ met)
  const r9 = computeHoldoutVerdictsMap({ "FAFF-G": "0009" }, [{ key: "FAFF-G", text: JSON.stringify({ aggregate: "gaps", code_blind: true, criteria: [{ class: "assertion", verdict: "met", evidence_present: true }, { class: "assertion", verdict: "unmet", evidence_present: true }], violations: [] }) }]);
  check("trusted 'gaps' passes through (≠ met)", r9.verdicts["0009"] === "gaps");

  // --- FAFF-311: the singular per-issue graft gate (holdoutGateResult) ---
  // g1. conformant meets-spec, code-blind → pass
  check("gate: meets-spec code-blind → pass", holdoutGateResult(JSON.parse(meets)).gate === "pass");
  // g2. fails → block, reason carries the aggregate
  const g2 = holdoutGateResult(JSON.parse(fails));
  check("gate: fails → block (reason=fails)", g2.gate === "block" && g2.reason === "fails");
  // g3. code_blind:false meets-spec → block (non-blind is structurally inadmissible), never pass
  check("gate: non-blind meets-spec → block", holdoutGateResult(JSON.parse(block("meets-spec", "met", false))).gate === "block");
  // g4. incoherent (aggregate lies about the criteria) → block via contract violation
  const g4 = holdoutGateResult({ aggregate: "meets-spec", code_blind: true, criteria: [{ class: "assertion", verdict: "unmet", evidence_present: true }], violations: [] });
  check("gate: incoherent meets-spec → block (contract-rejected)", g4.gate === "block" && g4.reason === "contract-rejected");
  // g5. non-object → block, never throw
  check("gate: non-object → block", holdoutGateResult(null).gate === "block");
  // g6. gaps → block (mixed verdicts never merge)
  const g6 = holdoutGateResult({ aggregate: "gaps", code_blind: true, criteria: [{ class: "assertion", verdict: "met", evidence_present: true }, { class: "assertion", verdict: "unmet", evidence_present: true }], violations: [] });
  check("gate: gaps → block (reason=gaps)", g6.gate === "block" && g6.reason === "gaps");

  // --- FAFF-384: the spawner-attestation ratchet threaded through both consumers ---
  const attested = JSON.stringify({ aggregate: "meets-spec", code_blind: true, criteria: [{ class: "assertion", verdict: "met", evidence_present: true }], violations: [], spawner_attested: true, attestation: { spawner: "evaluate-call.mjs", withheld: { repo: true, worktree_cwd: true, diff: true }, preflight: "pass" } });
  // gate: a self-attested meets-spec passes with the flag OFF (legacy) but BLOCKS with the flag ON.
  check("gate: self-attested meets-spec, ratchet OFF → pass", holdoutGateResult(JSON.parse(meets)).gate === "pass");
  check("gate: self-attested meets-spec, ratchet ON → block", holdoutGateResult(JSON.parse(meets), { requireSpawnerAttested: true }).gate === "block");
  // gate: a spawner-attested meets-spec passes even with the flag ON.
  check("gate: spawner-attested meets-spec, ratchet ON → pass", holdoutGateResult(JSON.parse(attested), { requireSpawnerAttested: true }).gate === "pass");
  // map bridge: same self-attested file is trusted with the flag OFF, contract-rejected with the flag ON.
  const rOff = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, [{ key: "FAFF-34", text: meets }]);
  check("bridge: self-attested, ratchet OFF → met", rOff.verdicts["0007"] === "met");
  const rOn = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, [{ key: "FAFF-34", text: meets }], { requireSpawnerAttested: true });
  check("bridge: self-attested, ratchet ON → contract-rejected", !("0007" in rOn.verdicts) && rOn.skipped.some((s) => s.reason === "contract-rejected"));
  const rOnA = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, [{ key: "FAFF-34", text: attested }], { requireSpawnerAttested: true });
  check("bridge: spawner-attested, ratchet ON → met", rOnA.verdicts["0007"] === "met");

  if (failed) { console.log(`holdout --selftest: FAIL (${failed} failed)`); return 1; }
  console.log("holdout --selftest: ok"); return 0;
}

// --- spec-review lens selection (FAFF-268) ---
// The cost-gate that runs IN FRONT OF the spec_review producer: given a spec's classified
// change-surface tags + the runtime level + the configured appetite, choose WHICH of the
// four frozen lenses fire and HOW DEEP (mode). Pure + deterministic — the heuristic
// signal→tag classification is the prose layer's job (faff-prep, reusing the already-shipped
// -scan surface extraction); this maps a *classified* surface to a LensSelection.
//
// v1 is ADDITIVE-ONLY / safe-direction (ADR 0028): only the `architectural` (and
// `methodology` where no tag adds it) lens is ever dropped, and only on a confidently
// -classified surface; `infosec` + `QA` are STICKY (always fire at L1–L3); an unclassified
// or unrecognised surface fires all four (fail-safe); L4 is pinned to the full adversarial
// set and never narrowed by appetite; low/medium appetite widens to all four. Symmetric /
// aggressive skipping (dropping the sticky lenses) is a deferred follow-up.
const SPEC_REVIEW_SURFACE_TAGS = [
  "config", "auth-security", "data-schema", "public-api",
  "infra-deploy", "ui", "pure-logic", "architecture-bearing",
];
// Lenses each tag adds ON TOP OF the {infosec, QA} v1 baseline (positive-fire only). The
// only lens that can be absent from a tag's add-set is the one that surface does not need —
// that absence is the only v1 skip. infosec/QA never depend on this table (they are sticky).
const SPEC_REVIEW_SURFACE_FIRES = {
  "config": [],                                  // trivial — architectural skipped
  "auth-security": ["infosec"],                  // infosec already baseline; explicit for intent
  "data-schema": ["architectural", "infosec"],
  "public-api": ["architectural", "methodology"],
  "infra-deploy": ["architectural", "infosec"],  // deploy/infra structure + secrets surface
  "ui": ["methodology"],
  "pure-logic": ["architectural"],
  "architecture-bearing": ["architectural"],
};
const SPEC_REVIEW_ALL_LENSES = SPEC_REVIEW_LENSES; // ["architectural","infosec","methodology","QA"]

// Pure: { tags:[SurfaceTag], level:"L1".."L4", appetite:"low|medium|high|full" } → LensSelection.
function selectLenses({ tags = [], level = "L3", appetite = "high" } = {}) {
  const lvl = String(level).toUpperCase();
  const app = String(appetite).toLowerCase();
  const mode = lvl === "L4" ? "adversarial" : "single-pass";
  const order = (arr) => SPEC_REVIEW_ALL_LENSES.filter((l) => arr.includes(l));
  const all = () => SPEC_REVIEW_ALL_LENSES.slice();

  const tagList = Array.isArray(tags) ? tags.filter((t) => t != null && t !== "") : [];
  const unknown = tagList.filter((t) => !SPEC_REVIEW_SURFACE_TAGS.includes(t));

  // Fail-safe (principle 1): no signal at all → fire all four.
  if (tagList.length === 0) {
    return { lenses: all(), mode, rationale: `unclassified surface (no tags) → fail-safe all-four; mode=${mode} (level ${lvl})` };
  }
  // Fail-safe: a tag we cannot confidently classify → fire all four (never under-review on doubt).
  if (unknown.length > 0) {
    return { lenses: all(), mode, rationale: `unrecognised surface tag(s) [${unknown.join(", ")}] → fail-safe all-four; mode=${mode} (level ${lvl})` };
  }
  // L4: pinned to the full adversarial set; appetite never narrows below the fail-safe set.
  if (lvl === "L4") {
    return { lenses: all(), mode, rationale: `L4 → adversarial all-four (never narrowed by appetite); tags=[${tagList.join(", ")}]` };
  }
  // L1–L3, low/medium appetite: widen to all four (fires more, skips less — safe direction).
  if (app === "low" || app === "medium") {
    return { lenses: all(), mode, rationale: `${app} appetite → widen to all-four (no skip); tags=[${tagList.join(", ")}]; mode=${mode}` };
  }
  // L1–L3, high/full appetite: additive set — sticky {infosec, QA} baseline + each tag's fires.
  const set = new Set(["infosec", "QA"]);
  for (const t of tagList) for (const l of SPEC_REVIEW_SURFACE_FIRES[t]) set.add(l);
  const lenses = order([...set]);
  const skipped = SPEC_REVIEW_ALL_LENSES.filter((l) => !set.has(l));
  const rationale = `tags=[${tagList.join(", ")}]; baseline=infosec,QA (sticky); fired=[${lenses.join(", ")}]`
    + (skipped.length ? `; skipped=[${skipped.join(", ")}] (safe-direction, additive-only v1)` : "; skipped=none")
    + `; mode=${mode} (level ${lvl}, appetite ${app})`;
  return { lenses, mode, rationale };
}

function specReviewLensesSelftest() {
  const has = (s, l) => s.lenses.includes(l);
  const cases = [
    { name: "config-only L2 high → architectural skipped, infosec+QA fire, single-pass",
      in: { tags: ["config"], level: "L2", appetite: "high" },
      check: (s) => !has(s, "architectural") && has(s, "infosec") && has(s, "QA") && s.mode === "single-pass" && /config/.test(s.rationale) },
    { name: "auth-security any level → infosec always present",
      in: { tags: ["auth-security"], level: "L3", appetite: "full" },
      check: (s) => has(s, "infosec") },
    { name: "ambiguous (no tags) → all four (fail-safe)",
      in: { tags: [], level: "L2", appetite: "high" },
      check: (s) => s.lenses.length === 4 },
    { name: "unknown tag → fail-safe all four",
      in: { tags: ["mystery"], level: "L2", appetite: "high" },
      check: (s) => s.lenses.length === 4 && /unrecognised/.test(s.rationale) },
    { name: "L4 → adversarial mode, all four, not narrowed by appetite",
      in: { tags: ["config"], level: "L4", appetite: "full" },
      check: (s) => s.mode === "adversarial" && s.lenses.length === 4 },
    { name: "low appetite widens to all four (no skip)",
      in: { tags: ["config"], level: "L2", appetite: "low" },
      check: (s) => s.lenses.length === 4 },
    { name: "medium appetite widens to all four (safe-direction)",
      in: { tags: ["config"], level: "L3", appetite: "medium" },
      check: (s) => s.lenses.length === 4 },
    { name: "public-api L3 high → architectural + methodology fire",
      in: { tags: ["public-api"], level: "L3", appetite: "high" },
      check: (s) => has(s, "architectural") && has(s, "methodology") && has(s, "infosec") && has(s, "QA") },
    { name: "data-schema L3 high → architectural + infosec, methodology skipped",
      in: { tags: ["data-schema"], level: "L3", appetite: "high" },
      check: (s) => has(s, "architectural") && has(s, "infosec") && has(s, "QA") && !has(s, "methodology") },
    { name: "invariant: infosec+QA sticky in every L1–L3 selection",
      in: { tags: ["config"], level: "L1", appetite: "full" },
      check: (s) => has(s, "infosec") && has(s, "QA") },
    { name: "invariant: lenses ⊆ the four frozen lenses, mode in enum",
      in: { tags: ["ui", "config"], level: "L2", appetite: "high" },
      check: (s) => s.lenses.every((l) => SPEC_REVIEW_ALL_LENSES.includes(l)) && ["single-pass", "adversarial"].includes(s.mode) },
  ];
  let failed = 0;
  for (const c of cases) {
    const s = selectLenses(c.in);
    const ok = !!c.check(s);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${c.name} → {${s.lenses.join(",")}} ${s.mode}`);
  }
  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}

function cmdSpecReviewLenses(args) {
  if (args.includes("--selftest")) return specReviewLensesSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const tagsArg = get("--tags");
  const tags = tagsArg ? tagsArg.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const level = get("--level") || "L3";
  const appetite = get("--appetite") || "high";
  process.stdout.write(JSON.stringify(selectLenses({ tags, level, appetite })) + "\n");
  return 0;
}


module.exports = { ADMISSIBLE_DUP_DONE, ADMISSIBLE_GOOD, ADMISSIBLE_GOOD_NUMBERED, ADMISSIBLE_PROSE_DONE, BANNED_VAGUE, DUP_THRESHOLD, PROSE_DONE_STOPWORDS, SCENARIOS_HEADING_RE, SPEC_REVIEW_ALL_LENSES, SPEC_REVIEW_SURFACE_FIRES, SPEC_REVIEW_SURFACE_TAGS, acceptanceSection, admissibleSelftest, admissibleVerdict, classifyAcceptanceCriteria, classifyCriterion, cmdAdmissible, cmdDod, cmdDodSplit, cmdHoldout, cmdHoldoutVerdict, cmdSpecReviewLenses, detectRunnableCheck, dodClassify, dodSelftest, dodSplit, doneScenariosLevelWarning, firstHeadingLevelMatching, headingLevel, holdoutRemovalSpans, holdoutVerdictsSelftest, isConfidenceLine, isDoneHeading, isHoldoutFenceOpen, matchesBannedVague, opensContractFence, parseDoneChecklist, parseScenarios, prdHasComparator, proseDoneAdvisory, proseDoneContainment, proseDoneTokens, renderProseDoneWarning, scenariosBoundaryStop, sectionBody, sectionBodyRange, selectLenses, specReviewLensesSelftest };
