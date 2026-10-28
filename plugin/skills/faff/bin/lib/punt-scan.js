// ===========================================================================
// === region:factory — punt-scan — FAFF-1078: the blocking-vs-deferred Punt reporter. ===
// PURE: parses a spec file's `**Punt:**` lines into a PuntScanResult so routing and the
// producer self-rating can tell a BLOCKING open Punt (an unresolved decision the increment
// depends on) from a NON-BLOCKING one (a decision the spec has explicitly pushed out of
// scope). It reads no tracker, no network, and no system clock; same input bytes always
// yield the same output, mirroring the tier / park-verdict deterministic-tool shape.
//
// A Punt is eligible to be treated non-blocking only when BOTH facts hold: it carries a
// bare `(non-blocking)` suffix AND its topic names an item listed under the spec's OUT OF
// SCOPE section. The bare tag alone never suffices — that closes the wave-through loophole.
// The crossref key rule reuses the house `headingSlug` transform rather than a second
// normaliser, so a topic and an OUT OF SCOPE item name compare on one dialect.
//
// Fail-safe direction: an untagged or un-crossreferenced Punt is treated as BLOCKING, never
// silently waved through. A degenerate all-punctuation topic slugs to "" and matches nothing.
// ===========================================================================

"use strict";

const fs = require("fs");
const { headingSlug, headingText } = require("./heading-slug");
const { parseArgs, usageError } = require("./argv");

// The ONE place the list-marker rule is written: a bullet (`-`, `*`, `+`) or an ordered marker
// (one to nine digits, then `.` or `)`), followed by whitespace. These are the CommonMark
// list-item markers; the required whitespace keeps the bold token's own leading `**` from
// ever being read as a marker.
const LIST_ITEM_PREFIX = "(?:[-*+]|\\d{1,9}[.)])\\s+";
// A Punt start: optional indentation, at most one list-item prefix, then the bold token. The
// leading `\s*` sits outside the capture group, so indentation never reaches the remainder.
// The remainder may be empty: a tag alone on its line is a Punt whose topic is on the next line.
const PUNT_LINE_RE = new RegExp("^\\s*(?:" + LIST_ITEM_PREFIX + ")?\\*\\*Punt:\\*\\*\\s*(.*)$");
// A line that opens a list item: optional indentation, then the one list-item prefix above.
const LIST_ITEM_OPENER_RE = new RegExp("^\\s*" + LIST_ITEM_PREFIX);
const NON_BLOCKING_RE = /\(non-blocking\)/;
const DECIDES_RE = /\(decides:\s*([^)]+)\)/;

// The canonical three-bullet OUT OF SCOPE form's body bullets (`- **Why excluded** — …`,
// `- **Extension point** — …`) are SUB-LABELS, never item names; emitting them produced the
// spurious keys that under-gated a Punt whose topic contained them.
const RESERVED_SUBLABEL_SLUGS = new Set(["why-excluded", "extension-point", "what-s-excluded", "whats-excluded"]);

// PURE: markdown spec text -> the set of OUT OF SCOPE item-name slugs. Empty when the section
// is absent or every bullet is a reserved sub-label.
function extractOutOfScopeItemKeys(specText) {
  const lines = String(specText).split(/\r?\n/);
  const keys = new Set();

  let sectionLevel = null;
  for (const line of lines) {
    const headingMatch = line.match(/^(#+)\s/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (sectionLevel === null) {
        if (headingSlug(headingText(line)).includes("out-of-scope")) sectionLevel = level;
        continue;
      }
      // Inside the section: a heading of the same-or-higher level closes it.
      if (level <= sectionLevel) break;
      continue;
    }
    if (sectionLevel === null) continue;

    const itemMatch = line.match(/^\s*-\s+\*\*(.+?)\*\*/);
    if (!itemMatch) continue;
    const name = itemMatch[1].replace(/[\s.:—-]+$/, "");
    const slug = headingSlug(name);
    if (!slug || RESERVED_SUBLABEL_SLUGS.has(slug)) continue;
    keys.add(slug);
  }
  return keys;
}

// PURE: true iff `oosKey` appears as a contiguous hyphen-delimited token run within
// `topicSlug` (equality is the degenerate case). One-directional: the OUT OF SCOPE item name
// must be found within the Punt topic, not the reverse.
function slugTokenRunContains(topicSlug, oosKey) {
  if (!oosKey) return false;
  return ("-" + topicSlug + "-").includes("-" + oosKey + "-");
}

// PURE: one physical line -> the remainder after the bold `**Punt:**` token (list prefix and
// indentation already consumed), or null when the line does not open a Punt. Stateless: it
// looks at one line only. The list prefix is presentation and the Punt is content, so a
// listed Punt and its de-prefixed twin yield the same remainder.
//
// The remainder is "" for a tag alone on its line; null only when the line opens no Punt.
function matchPuntStart(line) {
  const m = String(line).match(PUNT_LINE_RE);
  return m ? m[1] : null;
}

// PURE: true iff the line opens a list item. Built from LIST_ITEM_PREFIX, the one list-item
// rule in this module; the terminator set below calls it and never restates the rule.
function opensListItem(line) {
  return LIST_ITEM_OPENER_RE.test(String(line));
}

// A Chosen, Decision (the contract's alias for Chosen) or Assumes marker at line start. A
// listed one is already a list-item opener; this row names the unlisted marker explicitly.
const DECISION_MARKER_RE = /^\s*\*\*(?:Chosen|Decision|Assumes):\*\*/;
const HEADING_RE = /^\s*#+(?:\s|$)/;
// Any line leading with a non-empty bold token: a label (`**Rationale:**`), never a wrapped topic.
const BOLD_LED_RE = /^\s*\*\*\S/;
const FENCE_RE = /^\s*(?:`{3,}|~{3,})/;
const BLOCK_QUOTE_RE = /^\s*>/;
const TABLE_ROW_RE = /^\s*\|/;
// A run of three or more of one break character (spaces allowed) at line start. Deliberately not
// anchored at the end: a line that opens with a break run is in doubt, and a line in doubt ends the
// continuation, so a trailing remark never lets the line lend its tag.
const THEMATIC_BREAK_RE = /^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})/;

// PURE: true iff the physical line ends a Punt's logical line and is never absorbed into it
// (FAFF-1340). The set is the safety boundary: an over-greedy continuation could absorb a
// `(non-blocking)` from an unrelated line and wave a blocking Punt through. Every row only
// ever ends a continuation earlier, which makes a Punt look more blocking, never less; when a
// line is in doubt, it ends the continuation.
function endsLogicalLine(line) {
  return /^\s*$/.test(line)                // blank line (a whitespace-only line included)
    || HEADING_RE.test(line)               // heading
    || matchPuntStart(line) !== null       // next Punt, listed or not
    || DECISION_MARKER_RE.test(line)       // Chosen / Decision / Assumes marker
    || BOLD_LED_RE.test(line)              // bold-led label
    || FENCE_RE.test(line)                 // code fence
    || opensListItem(line)                 // any list-item opener, which includes a listed marker
    || BLOCK_QUOTE_RE.test(line)           // block quote
    || TABLE_ROW_RE.test(line)             // table row
    || THEMATIC_BREAK_RE.test(line);       // thematic break
}

// PURE: markdown spec text -> PuntScanResult. One PuntMarker per Punt-start line (a
// `**Punt:**` line, optionally behind a list marker), in document order. A marker is read over
// its logical line: the text after the tag plus every directly following line up to the first
// terminator, each trimmed and joined with one space, so where a producer broke the line does
// not change the reading. The terminator is handed back to the loop, never consumed.
function puntScan(specText) {
  const oosKeys = extractOutOfScopeItemKeys(specText);
  const punts = [];
  const lines = String(specText).split(/\r?\n/);

  for (let i = 0; i < lines.length;) {
    const first = matchPuntStart(lines[i]);
    if (first === null) { i += 1; continue; }

    const parts = [first.trim()];
    let j = i + 1;
    while (j < lines.length && !endsLogicalLine(lines[j])) {
      parts.push(lines[j].trim());
      j += 1;
    }
    i = j;
    const rest = parts.filter((p) => p !== "").join(" ");

    const nonBlocking = NON_BLOCKING_RE.test(rest);
    const decidesMatch = rest.match(DECIDES_RE);
    const decides = decidesMatch ? decidesMatch[1].trim() : null;

    // Only the two recognised suffix parens are stripped; any other parenthetical stays.
    const topic = rest
      .replace(/\(non-blocking\)/g, "")
      .replace(/\(decides:[^)]*\)/g, "")
      .trim()
      .replace(/^[\s—-]+/, "")
      .replace(/[\s—-]+$/, "");

    const topicSlug = headingSlug(topic);
    let crossref = false;
    for (const k of oosKeys) {
      if (slugTokenRunContains(topicSlug, k)) { crossref = true; break; }
    }
    const eligible = nonBlocking && crossref;
    punts.push({ topic, decides, non_blocking: nonBlocking, out_of_scope_crossref: crossref, eligible });
  }

  const eligibleCount = punts.filter((p) => p.eligible).length;
  return { punts, eligible_count: eligibleCount, blocking_open_count: punts.length - eligibleCount };
}

// Cases: [name, spec_text, assert(result, extractedKeys)]. The table exercises every branch
// the spec's HOW names, keyed to the DoD boundary rows.
// The ticket's repro Punt (FAFF-1340) and the OUT OF SCOPE section it crossrefs.
const WRAP_OOS = "## OUT OF SCOPE\n\n- **Scrub asymmetry** — deferred to its own ticket.\n\n## Open Questions\n\n";
const WRAP_TEXT = "scrub asymmetry in the window comparison, left to its own ticket (decides: architecture) (non-blocking)";
const WRAP_SINGLE = WRAP_OOS + "**Punt:** " + WRAP_TEXT + "\n";
const sameReading = (specA, specB) => JSON.stringify(puntScan(specA)) === JSON.stringify(puntScan(specB));

// One row per terminator kind: an untagged Punt directly followed (no blank line) by a line of
// that kind carrying `(non-blocking)`. The Punt must stay blocking and never absorb the tag.
const TERMINATOR_LINES = [
  ["heading", "## Next section (non-blocking)"],
  ["next Punt", "**Punt:** another decision (non-blocking)"],
  ["Chosen marker", "**Chosen:** pino (non-blocking)"],
  ["Decision marker", "**Decision:** pino (non-blocking)"],
  ["Assumes marker", "**Assumes:** the store is local (non-blocking)"],
  ["indented Chosen marker", "   **Chosen:** pino (non-blocking)"],
  ["bold-led label", "**Rationale:** a label (non-blocking)"],
  ["backtick fence", "```js (non-blocking)"],
  ["tilde fence", "~~~ (non-blocking)"],
  ["dash list item", "- a neighbour (non-blocking)"],
  ["ordered list item", "3. a neighbour (non-blocking)"],
  ["block quote", "> a quote (non-blocking)"],
  ["table row", "| a | b (non-blocking) |"],
  ["thematic break", "---\n(non-blocking)"],
  ["thematic break carrying the tag on its own line", "--- (non-blocking)"],
  ["asterisk break carrying the tag on its own line", "*** see below (non-blocking)"],
  ["spaced thematic break", "* * *\n(non-blocking)"],
  ["blank line then paragraph", "\n(non-blocking) a separate paragraph"],
  ["whitespace-only line then paragraph", "   \n(non-blocking) a separate paragraph"],
];
const TERMINATOR_CASES = TERMINATOR_LINES.map(([kind, line]) => [
  `terminator: ${kind} is not absorbed`,
  `**Punt:** cron vs queue — needs human\n${line}\n`,
  (r) => r.punts[0].non_blocking === false && r.punts[0].eligible === false
      && r.punts[0].topic === "cron vs queue — needs human" && r.blocking_open_count >= 1,
]);

const PUNT_SCAN_CASES = [
  ["bare tag + crossref → eligible", `## OUT OF SCOPE

- **Repeat-park collapse** — deferred to a future ticket.

## Open Questions

**Punt:** repeat-park collapse — needs human (non-blocking)
`, (r) => r.punts[0].eligible === true && r.eligible_count === 1 && r.blocking_open_count === 0],

  ["order-independent suffixes → identical markers", `**Punt:** cron vs queue — needs human (decides: architecture) (non-blocking)
**Punt:** cron vs queue — needs human (non-blocking) (decides: architecture)
`, (r) => JSON.stringify(r.punts[0]) === JSON.stringify(r.punts[1])
      && r.punts[0].decides === "architecture" && r.punts[0].non_blocking === true
      && r.punts[0].topic === "cron vs queue — needs human"],

  ["tag without crossref → eligible false", `## OUT OF SCOPE

- **Something else** — unrelated.

**Punt:** totally unrelated thing (non-blocking)
`, (r) => r.punts[0].non_blocking === true && r.punts[0].out_of_scope_crossref === false
      && r.punts[0].eligible === false && r.blocking_open_count === 1],

  ["crossref without tag → eligible false", `## OUT OF SCOPE

- **Repeat-park collapse** — deferred.

**Punt:** repeat-park collapse — needs human
`, (r) => r.punts[0].non_blocking === false && r.punts[0].out_of_scope_crossref === true
      && r.punts[0].eligible === false && r.blocking_open_count === 1],

  ["no OUT OF SCOPE section → all blocking", `**Punt:** anything at all (non-blocking)
`, (r) => r.punts[0].out_of_scope_crossref === false && r.punts[0].eligible === false
      && r.blocking_open_count === 1],

  ["degenerate empty-slug topic never false-matches", `## OUT OF SCOPE

- **Repeat-park collapse** — deferred.

**Punt:** — (non-blocking)
`, (r) => r.punts[0].topic === "" && r.punts[0].non_blocking === true
      && r.punts[0].out_of_scope_crossref === false && r.punts[0].eligible === false],

  ["multiple mixed Punts", `## OUT OF SCOPE

- **Repeat-park collapse** — deferred.
- **Schema versioning** — out of scope.

**Punt:** repeat-park collapse handling — needs human (non-blocking)
**Punt:** cron vs queue — needs human
**Punt:** schema versioning approach (decides: architecture)
`, (r) => r.punts.length === 3 && r.punts[0].eligible === true
      && r.punts[1].eligible === false && r.punts[2].eligible === false
      && r.punts[2].decides === "architecture"
      && r.eligible_count === 1 && r.blocking_open_count === 2],

  ["canonical three-bullet item → sub-labels not emitted", `## OUT OF SCOPE

- **Repeat-park collapse** — the per-reason mechanism.
- **Why excluded** — root cause (b) is dropped.
- **Extension point** — a future ticket.

**Punt:** why excluded consideration (non-blocking)
`, (r, keys) => keys.has("repeat-park-collapse")
      && !keys.has("why-excluded") && !keys.has("extension-point") && keys.size === 1
      && r.punts[0].eligible === false],

  ["flat trailing-period item → one name key", `## OUT OF SCOPE

- **Standing-park collapse.** What's excluded: any per-reason mechanism. Why excluded: dropped. Extension point: a future ticket.

**Punt:** standing-park collapse — needs human (non-blocking)
`, (r, keys) => keys.has("standing-park-collapse") && keys.size === 1
      && r.punts[0].eligible === true && r.eligible_count === 1],

  // --- a Punt written as a list item (FAFF-1351): the prefix is presentation, the Punt is content ---
  ["dash bullet → one blocking Punt", `- **Punt:** cron vs queue — needs human
`, (r) => r.punts.length === 1 && r.blocking_open_count === 1
      && r.punts[0].topic === "cron vs queue — needs human"],

  ["star bullet → identical marker", `* **Punt:** cron vs queue — needs human
`, (r) => r.punts.length === 1 && r.punts[0].topic === "cron vs queue — needs human" && r.punts[0].eligible === false],

  ["plus bullet → identical marker", `+ **Punt:** cron vs queue — needs human
`, (r) => r.punts.length === 1 && r.punts[0].topic === "cron vs queue — needs human" && r.punts[0].eligible === false],

  ["ordered dot → identical marker", `1. **Punt:** cron vs queue — needs human
`, (r) => r.punts.length === 1 && r.punts[0].topic === "cron vs queue — needs human" && r.punts[0].eligible === false],

  ["ordered paren → identical marker", `2) **Punt:** cron vs queue — needs human
`, (r) => r.punts.length === 1 && r.punts[0].topic === "cron vs queue — needs human" && r.punts[0].eligible === false],

  ["nested dash → identical marker", `    - **Punt:** cron vs queue — needs human
`, (r) => r.punts.length === 1 && r.punts[0].topic === "cron vs queue — needs human" && r.punts[0].eligible === false],

  ["nested ordered → identical marker", `  1. **Punt:** cron vs queue — needs human
`, (r) => r.punts.length === 1 && r.punts[0].topic === "cron vs queue — needs human" && r.punts[0].eligible === false],

  ["ten-digit ordered marker → no Punt", `1234567890. **Punt:** cron vs queue — needs human
`, (r) => r.punts.length === 0 && r.blocking_open_count === 0],

  ["listed and eligible → non-blocking with crossref", `## OUT OF SCOPE

- **Repeat-park collapse** — deferred.

## Open Questions

- **Punt:** repeat-park collapse — needs human (non-blocking)
`, (r) => r.punts.length === 1 && r.punts[0].eligible === true
      && r.eligible_count === 1 && r.blocking_open_count === 0],

  ["listed, tag order → identical markers", `- **Punt:** cron vs queue — needs human (decides: architecture) (non-blocking)
- **Punt:** cron vs queue — needs human (non-blocking) (decides: architecture)
`, (r) => r.punts.length === 2 && JSON.stringify(r.punts[0]) === JSON.stringify(r.punts[1])
      && r.punts[0].decides === "architecture" && r.punts[0].non_blocking === true],

  ["the ticket repro → two listed untagged Punts block", `- **Punt:** first open decision
- **Punt:** second open decision
`, (r) => r.punts.length === 2 && r.blocking_open_count === 2 && r.eligible_count === 0],

  ["inline mention on a listed Chosen line → no Punt", `- **Chosen:** pino — the earlier **Punt:** is closed
`, (r) => r.punts.length === 0],

  ["backticked token → no Punt", `- \`**Punt:**\` marks an open decision
`, (r) => r.punts.length === 0],

  ["listed Chosen marker → no Punt", `- **Chosen:** pino
`, (r) => r.punts.length === 0],

  // --- a wrapped Punt reads as its logical line (FAFF-1340): the line break is presentation ---
  ["wrapped tags (the ticket repro) → identical to single-line",
    WRAP_OOS + "**Punt:** scrub asymmetry in the window comparison, left to its own ticket\n(decides: architecture) (non-blocking)\n",
    (r) => sameReading(WRAP_SINGLE, WRAP_OOS + "**Punt:** scrub asymmetry in the window comparison, left to its own ticket\n(decides: architecture) (non-blocking)\n")
      && r.punts[0].decides === "architecture" && r.punts[0].non_blocking === true
      && r.punts[0].out_of_scope_crossref === true && r.punts[0].eligible === true
      && r.punts[0].topic === "scrub asymmetry in the window comparison, left to its own ticket"
      && r.eligible_count === 1 && r.blocking_open_count === 0],

  ["wrapped topic: OUT OF SCOPE name split across the wrap → crossref and eligible",
    WRAP_OOS + "**Punt:** the scrub\nasymmetry in the window comparison (non-blocking)\n",
    (r) => r.punts.length === 1 && r.punts[0].out_of_scope_crossref === true && r.punts[0].eligible === true
      && sameReading(WRAP_OOS + "**Punt:** the scrub asymmetry in the window comparison (non-blocking)\n", WRAP_OOS + "**Punt:** the scrub\nasymmetry in the window comparison (non-blocking)\n")],

  ["three-line span → identical to single-line",
    WRAP_OOS + "**Punt:** scrub asymmetry in the window\ncomparison, left to its own ticket\n(decides: architecture) (non-blocking)\n",
    (r) => sameReading(WRAP_SINGLE, WRAP_OOS + "**Punt:** scrub asymmetry in the window\ncomparison, left to its own ticket\n(decides: architecture) (non-blocking)\n")
      && r.punts.length === 1 && r.punts[0].eligible === true],

  ["wrapped untagged Punt → still blocking",
    WRAP_OOS + "**Punt:** scrub asymmetry in the window\ncomparison, left to its own ticket\n",
    (r) => r.punts[0].out_of_scope_crossref === true && r.punts[0].non_blocking === false
      && r.punts[0].eligible === false && r.blocking_open_count === 1],

  ["wrapped tag without crossref → still blocking",
    "## OUT OF SCOPE\n\n- **Something else** — unrelated.\n\n**Punt:** an unrelated\ndecision (non-blocking)\n",
    (r) => r.punts[0].non_blocking === true && r.punts[0].out_of_scope_crossref === false
      && r.punts[0].eligible === false && r.blocking_open_count === 1],

  ["wrapped decides value: split `(decides:` still parses",
    "**Punt:** cron vs queue (decides:\narchitecture)\n",
    (r) => r.punts[0].decides === "architecture" && r.punts[0].topic === "cron vs queue"],

  ["following paragraph after a blank line is not absorbed",
    "**Punt:** cron vs queue — needs human\n\nA separate paragraph (non-blocking) about something else.\n",
    (r) => r.punts[0].non_blocking === false && r.blocking_open_count === 1
      && r.punts[0].topic === "cron vs queue — needs human"],

  ["Chosen marker carrying the tag, no blank line → not absorbed",
    "**Punt:** cron vs queue — needs human\n**Chosen:** pino (non-blocking)\n",
    (r) => r.punts[0].non_blocking === false && r.blocking_open_count === 1],

  ["two adjacent Punts, no blank line → two markers",
    WRAP_OOS + "**Punt:** scrub asymmetry in the window\ncomparison (non-blocking)\n**Punt:** cron vs queue — needs human\n",
    (r) => r.punts.length === 2 && r.punts[0].eligible === true && r.punts[1].eligible === false
      && r.punts[1].topic === "cron vs queue — needs human" && r.eligible_count === 1 && r.blocking_open_count === 1],

  ["bare tag, topic and tag on the next line → one marker",
    WRAP_OOS + "**Punt:**\nscrub asymmetry in the window comparison (non-blocking)\n",
    (r) => r.punts.length === 1 && r.punts[0].topic === "scrub asymmetry in the window comparison"
      && r.punts[0].eligible === true],

  ["bare tag with nothing after → one blocking empty-topic marker",
    WRAP_OOS + "**Punt:**\n\nA paragraph (non-blocking).\n",
    (r) => r.punts.length === 1 && r.punts[0].topic === "" && r.punts[0].eligible === false
      && r.blocking_open_count === 1],

  ["CRLF wrapped Punt → identical to the LF form",
    WRAP_OOS.replace(/\n/g, "\r\n") + "**Punt:** scrub asymmetry in the window comparison, left to its own ticket\r\n(decides: architecture) (non-blocking)\r\n",
    (r) => sameReading(WRAP_SINGLE, WRAP_OOS.replace(/\n/g, "\r\n") + "**Punt:** scrub asymmetry in the window comparison, left to its own ticket\r\n(decides: architecture) (non-blocking)\r\n")
      && r.punts[0].eligible === true],

  ["continuation starting with a hyphen-dash ends the logical line (known safe price)",
    WRAP_OOS + "**Punt:** scrub asymmetry in the window comparison, left to its own ticket\n- (non-blocking)\n",
    (r) => r.punts[0].non_blocking === false && r.punts[0].eligible === false && r.blocking_open_count === 1],

  // --- the terminator table: an untagged Punt followed by each kind of line carrying the tag ---
  ...TERMINATOR_CASES,

  // --- composed with the list-item half (FAFF-1351): listed and wrapped ---
  ["listed Punt wrapped, tags on line two → identical to the single-line form",
    WRAP_OOS + "- **Punt:** scrub asymmetry in the window comparison, left to its own ticket\n  (decides: architecture) (non-blocking)\n",
    (r) => r.punts.length === 1 && r.punts[0].eligible === true && r.punts[0].decides === "architecture"
      && JSON.stringify(r) === JSON.stringify(puntScan(WRAP_SINGLE))],

  ["listed Punt followed by a listed Chosen carrying the tag → not absorbed",
    "- **Punt:** cron vs queue — needs human\n- **Chosen:** pino (non-blocking)\n",
    (r) => r.punts.length === 1 && r.punts[0].non_blocking === false && r.blocking_open_count === 1],

  ["two adjacent listed Punts → two markers",
    "- **Punt:** first open decision\n- **Punt:** second open decision (non-blocking)\n",
    (r) => r.punts.length === 2 && r.punts[0].non_blocking === false && r.punts[1].non_blocking === true
      && r.punts[0].topic === "first open decision" && r.punts[1].topic === "second open decision"],
];

function runPuntScanCases() {
  let fail = 0;
  for (const [name, spec, assertFn] of PUNT_SCAN_CASES) {
    let ok;
    try {
      const result = puntScan(spec);
      const keys = extractOutOfScopeItemKeys(spec);
      // Structural invariant every case must hold.
      const invariant = result.eligible_count + result.blocking_open_count === result.punts.length;
      ok = invariant && assertFn(result, keys) === true;
    } catch (e) {
      ok = false;
      console.log(`     (threw: ${e.message})`);
    }
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  }
  return fail;
}

function puntScanSelftest() {
  const fail = runPuntScanCases();
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${PUNT_SCAN_CASES.length} cases, ${fail} failed) — no tracker, no network, no system clock consulted`);
  return fail ? 1 : 0;
}

const PUNT_SCAN_SPEC = { flags: { "--selftest": { arity: 0 } }, positionals: { min: 0, max: 1, name: "spec-file" } };
const PUNT_SCAN_USAGE = "usage: faff punt-scan <spec-file> [--selftest]";

function cmdPuntScan(args) {
  if (args.includes("--selftest")) return puntScanSelftest();
  const { positionals, errors } = parseArgs(args, PUNT_SCAN_SPEC);
  if (errors.length) return usageError(errors, PUNT_SCAN_USAGE);
  const specFile = positionals[0];
  if (!specFile) return usageError([{ code: "too-few-positionals", detail: "spec-file is required" }], PUNT_SCAN_USAGE);

  let specText;
  try {
    specText = fs.readFileSync(specFile, "utf8");
  } catch (e) {
    process.stderr.write(`faff punt-scan: cannot read ${specFile} (${e.message})\n`);
    return 2;
  }

  console.log(JSON.stringify(puntScan(specText)));
  return 0;
}

module.exports = {
  PUNT_SCAN_CASES,
  cmdPuntScan,
  extractOutOfScopeItemKeys,
  matchPuntStart,
  puntScan,
  puntScanSelftest,
  runPuntScanCases,
  slugTokenRunContains,
};
