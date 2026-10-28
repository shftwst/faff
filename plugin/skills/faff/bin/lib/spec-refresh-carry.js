// ===========================================================================
// === region:factory — spec-refresh-carry — FAFF-1271: carry a paths-only refresh's review forward ===
// faff-tidy tags a spec stale when a path it cites moves; faff-prep's stale-refresh path then
// re-ran the whole spec-review gate on the path-fixed spec as if it were new, reopening a design
// that never actually changed. This module is the deterministic classifier: given a before and
// after spec text, decide whether the only differences are a verified directory move, a line
// reference, the provenance stamp, the `build-tier:` line, or the one fixed refresh-note line —
// in which case the prior review is safe to carry forward — or whether anything else changed, in
// which case the gate must re-run. The decision is the CLI exit code (see `faff spec-review
// carry-check` in spec-review.js); no model judgement is involved.
//
// PURE. `classifyRefresh` and `normaliseSpec` do no I/O — `classifyRefresh` takes `pathExists` as
// an injected function so the CLI shell (the only I/O: two file reads + filesystem existence
// checks) stays the sole impure caller.
// ===========================================================================

"use strict";

const { headingSlug, headingText } = require("./heading-slug");

// Every path-token character class plus the "/" separator. At least two non-empty segments
// joined by "/", an optional trailing "/". See the spec's "path token" vocabulary entry.
const PATH_TOKEN_RE = /[A-Za-z0-9_.@~+-]+(?:\/[A-Za-z0-9_.@~+-]+)+\/?/g;

// "line N" / "lines N-M", case-insensitive, hyphen or en dash.
const LINE_WORD_RE = /\b(line|lines)[ \t]+(\d+)(?:[ \t]*[-–][ \t]*(\d+))?\b/gi;

// "#LN", "#LN-LM", "#LN-M".
const HASH_L_RE = /#L\d+(?:-L?\d+)?/g;

// A colon-number suffix immediately after a path token: ":N" or ":N-M".
const COLON_REF_RE = /^:(\d+)(-\d+)?/;

// The one forgiven refresh-note line (an ISO date, the fixed text, nothing else).
const REFRESH_NOTE_RE = /^> Revised on \d{4}-\d{2}-\d{2}: paths refreshed$/;

// The last `spec-review:` line, trimmed. null when absent.
const SPEC_REVIEW_LINE_RE = /^spec-review:\s*(.+)$/;

// The last `confidence:` line, trimmed. null when absent.
const CONFIDENCE_LINE_RE = /^confidence:\s*(.+)$/i;

function isStampLine(trimmed) {
  return trimmed.startsWith("> Spec:");
}
function isBuildTierLine(trimmed) {
  return /^build-tier:/.test(trimmed);
}
function isRefreshNoteLine(trimmed) {
  return REFRESH_NOTE_RE.test(trimmed);
}
function isVolatileLine(trimmed) {
  return isStampLine(trimmed) || isBuildTierLine(trimmed) || isRefreshNoteLine(trimmed);
}

// CRLF -> LF, split into lines. (normalisation step 1)
function splitLines(text) {
  return String(text).replace(/\r\n/g, "\n").split("\n");
}

// Collapse runs of spaces/tabs to one, trim both ends. (step 3c)
function collapseWhitespace(line) {
  return line.replace(/[ \t]+/g, " ").trim();
}

// A table separator row: only |, :, -, and spaces (after whitespace collapse).
function isTableSeparatorRow(line) {
  return line.length > 0 && /^[|:\- ]+$/.test(line);
}

// Collapse a table separator row's dash runs of 3+ to exactly "---". (step 3d)
function collapseTableDashes(line) {
  return line.replace(/-{3,}/g, "---");
}

// Collapse runs of blank lines to one; drop leading/trailing blanks. (step 4)
function collapseBlankRuns(lines) {
  const out = [];
  let prevBlank = false;
  for (const l of lines) {
    const blank = l.length === 0;
    if (blank && prevBlank) continue;
    out.push(l);
    prevBlank = blank;
  }
  while (out.length > 0 && out[0].length === 0) out.shift();
  while (out.length > 0 && out[out.length - 1].length === 0) out.pop();
  return out;
}

// Replace "line N"/"lines N-M" and "#LN.." occurrences — NOT tied to a path token. (part of 3a)
function replaceLineWordsAndHash(line) {
  let s = line.replace(LINE_WORD_RE, (_m, word) => (word.toLowerCase() === "lines" ? "lines #" : "line #"));
  s = s.replace(HASH_L_RE, "#L#");
  return s;
}

// Scan a line left-to-right for path tokens. For each NON-url token, replace it with its last
// non-empty segment and, when a ":N"/":N-M" suffix directly follows, collapse that too — the
// combined 3a(colon part)+3b transform the spec's worked example requires ("src/a.js:40" ->
// "a.js:#", not a token that swallowed the colon). A URL-prefixed token (immediately preceded by
// "://") is left exactly as written, colon suffix included. (steps 3a[colon]+3b)
function replacePathsAndColonRefs(line) {
  let result = "";
  let lastIndex = 0;
  PATH_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = PATH_TOKEN_RE.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    result += line.slice(lastIndex, start);
    const isUrl = line.slice(Math.max(0, start - 3), start) === "://";
    if (isUrl) {
      result += m[0];
      lastIndex = end;
      continue;
    }
    let tok = m[0];
    if (tok.endsWith("/")) tok = tok.slice(0, -1);
    const segments = tok.split("/");
    result += segments[segments.length - 1];
    lastIndex = end;
    const refMatch = line.slice(end).match(COLON_REF_RE);
    if (refMatch) {
      result += ":#";
      lastIndex = end + refMatch[0].length;
    }
  }
  result += line.slice(lastIndex);
  return result;
}

// normaliseSpec(text) -> List<String> — pure, exported for tests. Turns a spec into a list of
// comparable lines: drop volatile lines, replace line references with placeholders, replace path
// tokens with their basename, collapse whitespace (and table-separator dash runs), collapse blank
// runs, trim leading/trailing blanks.
function normaliseSpec(text) {
  const kept = splitLines(text).filter((l) => !isVolatileLine(l.trim()));
  const transformed = kept.map((l) => {
    let s = replaceLineWordsAndHash(l);
    s = replacePathsAndColonRefs(s);
    s = collapseWhitespace(s);
    if (isTableSeparatorRow(s)) s = collapseTableDashes(s);
    return s;
  });
  return collapseBlankRuns(transformed);
}

// The "raw" pairing list classification step 6 compares path tokens/line-refs over: steps 1
// (split), 2 (drop volatile), 3c (collapse whitespace), 4 (collapse blank runs) — but NOT 3a/3b
// (line-ref/path replace) or 3d (table-separator collapse), so the actual path/line-ref text
// survives for diffing. Line-preserving (3a/3b/3d never add/remove a line), so this list is the
// same length as normaliseSpec(text) on the same input.
function rawPairLines(text) {
  const kept = splitLines(text).filter((l) => !isVolatileLine(l.trim()));
  const collapsed = kept.map((l) => collapseWhitespace(l));
  return collapseBlankRuns(collapsed);
}

// Raw refresh-note lines (step 1 only — before the volatile drop) for counting status_notes: a
// refresh-note line present in one raw text and not the other.
function rawRefreshNoteLines(text) {
  return splitLines(text).filter((l) => isRefreshNoteLine(l.trim()));
}

// Ordered list of non-URL path tokens occurring in a line (raw text — not basenamed).
function extractPathTokens(line) {
  const out = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = PATH_TOKEN_RE.exec(line)) !== null) {
    const start = m.index;
    const isUrl = line.slice(Math.max(0, start - 3), start) === "://";
    if (!isUrl) out.push(m[0]);
  }
  return out;
}

// Ordered list of raw line-reference substrings in a line: a colon-suffix directly after a path
// token, a "#LN.." span, or a "line N"/"lines N-M" phrase — used only to decide whether the two
// sides' line references differ (no placeholder substitution here).
function extractLineRefTokens(line) {
  const out = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = PATH_TOKEN_RE.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const isUrl = line.slice(Math.max(0, start - 3), start) === "://";
    if (isUrl) continue;
    const refMatch = line.slice(end).match(COLON_REF_RE);
    if (refMatch) out.push(refMatch[0]);
  }
  const hashMatches = line.match(HASH_L_RE);
  if (hashMatches) out.push(...hashMatches);
  const wordMatches = line.match(LINE_WORD_RE);
  if (wordMatches) out.push(...wordMatches.map((w) => w.toLowerCase().replace(/[ \t]+/g, " ")));
  return out;
}

// The last line matching `re`, with its capture group trimmed. null when no match.
function lastMatchingLine(lines, re) {
  let result = null;
  for (const l of lines) {
    const m = l.trim().match(re);
    if (m) result = m[1].trim();
  }
  return result;
}

// classifyRefresh(beforeText, afterText, pathExists) -> CarryResult — pure given pathExists.
function classifyRefresh(beforeText, afterText, pathExists) {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);

  const approval = lastMatchingLine(beforeLines, SPEC_REVIEW_LINE_RE);
  if (approval === null || !(approval.startsWith("approve") || approval.startsWith("accept"))) {
    return { carry: false, reason: "no-prior-approval", approval: null, changes: { paths: 0, line_refs: 0, status_notes: 0 }, path_moves: [], first_divergence: null };
  }

  const afterApproval = lastMatchingLine(afterLines, SPEC_REVIEW_LINE_RE);
  if (afterApproval === null || afterApproval !== approval) {
    return { carry: false, reason: "approval-line-changed", approval, changes: { paths: 0, line_refs: 0, status_notes: 0 }, path_moves: [], first_divergence: null };
  }

  const beforeConfidence = lastMatchingLine(beforeLines, CONFIDENCE_LINE_RE);
  const afterConfidence = lastMatchingLine(afterLines, CONFIDENCE_LINE_RE);
  if (beforeConfidence === null || afterConfidence === null || beforeConfidence !== afterConfidence) {
    return { carry: false, reason: "confidence-changed", approval, changes: { paths: 0, line_refs: 0, status_notes: 0 }, path_moves: [], first_divergence: null };
  }

  const nb = normaliseSpec(beforeText);
  const na = normaliseSpec(afterText);
  const maxLen = Math.max(nb.length, na.length);
  let firstDiff = -1;
  for (let i = 0; i < maxLen; i++) {
    if (nb[i] !== na[i]) { firstDiff = i; break; }
  }
  if (firstDiff !== -1) {
    const src = firstDiff < na.length ? na : nb;
    let section = "";
    for (let i = Math.min(firstDiff, src.length - 1); i >= 0; i--) {
      if (/^#+\s/.test(src[i])) { section = headingSlug(headingText(src[i])); break; }
    }
    return {
      carry: false,
      reason: "content-changed",
      approval,
      changes: { paths: 0, line_refs: 0, status_notes: 0 },
      path_moves: [],
      first_divergence: {
        section,
        before: firstDiff < nb.length ? nb[firstDiff] : null,
        after: firstDiff < na.length ? na[firstDiff] : null,
      },
    };
  }

  // Step 6/7: pair the raw (path/line-ref-preserving) lines and count differences.
  const rb = rawPairLines(beforeText);
  const ra = rawPairLines(afterText);
  let paths = 0;
  let lineRefs = 0;
  const pathMoves = [];
  const seenMoves = new Set();
  const rawLen = Math.max(rb.length, ra.length);
  for (let i = 0; i < rawLen; i++) {
    const lb = i < rb.length ? rb[i] : "";
    const la = i < ra.length ? ra[i] : "";
    if (lb === la) continue;
    const tb = extractPathTokens(lb);
    const ta = extractPathTokens(la);
    const tokLen = Math.max(tb.length, ta.length);
    let linePathsDiffer = false;
    for (let j = 0; j < tokLen; j++) {
      const before = j < tb.length ? tb[j] : "";
      const after = j < ta.length ? ta[j] : "";
      if (before === after) continue;
      linePathsDiffer = true;
      const key = `${before}|${after}`;
      if (!seenMoves.has(key)) {
        seenMoves.add(key);
        pathMoves.push({ before, after });
      }
    }
    if (linePathsDiffer) paths++;

    const refsB = extractLineRefTokens(lb);
    const refsA = extractLineRefTokens(la);
    if (JSON.stringify(refsB) !== JSON.stringify(refsA)) lineRefs++;
  }

  // status_notes: refresh-note lines counted on the raw texts after step 1 only (before the
  // volatile drop removes them) — present in one text and not the other (set membership, so a
  // line unchanged on both sides never counts, regardless of how many times it repeats).
  const beforeNotes = new Set(rawRefreshNoteLines(beforeText));
  const afterNotes = new Set(rawRefreshNoteLines(afterText));
  let statusNotes = 0;
  for (const n of beforeNotes) if (!afterNotes.has(n)) statusNotes++;
  for (const n of afterNotes) if (!beforeNotes.has(n)) statusNotes++;

  const changes = { paths, line_refs: lineRefs, status_notes: statusNotes };

  const path_moves = pathMoves.map((mv) => ({
    before: mv.before,
    after: mv.after,
    verified: !pathExists(mv.before) && pathExists(mv.after),
  }));

  const anyUnverified = path_moves.some((mv) => !mv.verified);
  if (anyUnverified) {
    return { carry: false, reason: "path-move-unverified", approval, changes, path_moves, first_divergence: null };
  }

  return { carry: true, reason: "paths-only", approval, changes, path_moves, first_divergence: null };
}

module.exports = {
  classifyRefresh,
  normaliseSpec,
  extractPathTokens,
  extractLineRefTokens,
};
