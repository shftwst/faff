#!/usr/bin/env node
// FAFF-183 — robust adversarial-review backend call, originally for ollama.
//
// Replaces the agent-hand-rolled API call (which broke five ways on a real backend: no model
// preflight, empty content from reasoning models, dropped connections on long responses, no token
// budget, and diff-only context that made the reviewer hallucinate "this heading doesn't exist").
// Per deterministic-tools-over-prose, the robust call is a tool, not prose.
//
// FAFF-872: the native ollama transport family (a dedicated /api/tags + /api/chat NDJSON path) was
// folded onto the OpenAI-compatible /v1 path below — ollama and oMLX both serve /v1/chat/completions,
// so neither needs a wire format of its own. Two transport families remain: OpenAI-compatible (the
// shape every non-anthropic backend uses, ollama included) and anthropic native (kept — Claude's
// extended thinking cannot cross to a plain /v1/chat/completions).
//
// The pure functions (buildOpenAiPayload / modelServedOpenAi / accumulateSse / assembleUserMessage)
// carry no I/O and are unit-tested directly; the transport (getFn/streamFn) is injectable so CI makes
// ZERO real calls. Zero-dependency: node:http(s)/node:fs only.

import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join as pathJoin, dirname as pathDirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Exit codes the skill maps to a verdict: 0 ok · 4 model-not-served (→ needs-human) ·
// 5 provider-unreachable, explicitly-configured host (→ pass+skip) ·
// 6 provider-unreachable, unconfigured localhost default (→ needs-human, FAFF-213) ·
// 7 auth-failed (cloud creds / unset key env, → needs-human, FAFF-209) · 2 usage · 1 other ·
// 9 mandatory-chain-outage — a MANDATORY (L4 --lights-out) review's chain exhausted with no opinion
//   obtained (all UNREACHABLE/5 or DEADLINE/8), which fails CLOSED → needs-human (FAFF-398).
// 10 malformed (FAFF-194/FAFF-465) — a reachable+served backend's OK content is SUBSTANTIVE (non-empty,
//   not a refusal) but not findings-shaped (no recognised `### <severity>:` section) — a genuine
//   reachable-but-degraded model-quality symptom, per-backend, an AVAILABILITY class (a garble-only
//   exhausted chain collapses to UNREACHABLE/5 — never a needs-human terminal exit on its own).
// 11 no-findings-content (FAFF-465) — a reachable+served backend's OK content is EMPTY/whitespace-only,
//   or a closed-grammar provider REFUSAL — an operator-fixable structural inability (same class as a
//   wrong/incapable model), per-backend, member of CHAIN_NEEDS_HUMAN (never masked by an otherwise-
//   available chain — this is the split that makes a full-chain exhaustion's terminal disposition
//   deterministic on a stable response property, not on the incidental run-to-run failure-class mix).
export const EXIT = { OK: 0, OTHER: 1, USAGE: 2, NOT_SERVED: 4, UNREACHABLE: 5, DEFAULT_HOST_UNREACHABLE: 6, AUTH: 7, DEADLINE: 8, MANDATORY_OUTAGE: 9, MALFORMED: 10, NO_FINDINGS_CONTENT: 11, RATE_LIMITED: 12 };
// FAFF-329: DEADLINE(8) — the Phase-2 total wall-clock budget (--deadline) was hit before any backend
// produced findings. Distinct from UNREACHABLE(5) so a deadline-skip is observable, but the caller routes
// it IDENTICALLY: pass + skip the second opinion, logged loudly (a bounded turn beats an unbounded stall;
// the hard merge gate — AC + CI + Phase-1 pass — is untouched). A config fault (needs-human class) seen on
// an earlier backend still DOMINATES (surfaced instead of 8) — the no-silent-weakening invariant.
export const DEFAULT_NUM_PREDICT = 2000;

// FAFF-928: per-body byte cap for retained raw adversarial-review response bodies. A captured body
// larger than this is truncated with an explicit marker (see captureRawResponseBody); the 2000-token
// default num_predict is far under it, so the common case is retained whole.
export const RAW_BODY_MAX_BYTES = 256 * 1024;   // 256 KB

// FAFF-885: the DEFAULT per-attempt first-byte (time-to-first-token) window, in ms. Applied at the CLI
// boundary (main) as the DEFAULT-ON value when neither a per-backend `first_byte_timeout` nor the
// `--first-byte-timeout` flag is set. 60s is generous relative to the 120s inactivity timeout — a healthy
// streaming backend delivers its first token well inside it — while cutting a buffering backend's idle
// hang from ~3x timeout to ~60s. runReview* default firstByteMs to undefined (pass-through), so a direct
// programmatic/test call is byte-for-byte unchanged; only main() opts in the default.
export const DEFAULT_FIRST_BYTE_MS = 60000;

// PURE (FAFF-213): map an unreachable result to its exit code by host provenance. An explicitly-
// configured host that's down → EXIT.UNREACHABLE (5 → pass+skip, the human's call). A host that's
// only the documented localhost default because nothing was configured → EXIT.DEFAULT_HOST_UNREACHABLE
// (6 → needs-human) — an absent provider block must not invisibly disable the review (cf. exit 4).
// review-call can't infer provenance from the host string (localhost is a legit configured host), so
// the caller signals it via --host-source; this is the one place the policy decision lives.
export function unreachableExit({ hostSource } = {}) {
  return hostSource === "default" ? EXIT.DEFAULT_HOST_UNREACHABLE : EXIT.UNREACHABLE;
}

// Transport families (FAFF-872: down from three to two). openai speaks the OpenAI-compatible
// /v1/models + /v1/chat/completions (SSE) shared by OpenAI, vLLM, OpenRouter, NVIDIA NIM
// (integrate.api.nvidia.com/v1), DeepSeek, etc. gemini rides that same family via Google's documented
// OpenAI-compatibility base URL (https://generativelanguage.googleapis.com/v1beta/openai), so it needs
// no adaptor of its own — just the whitelist entry (FAFF-210). ollama is now an ALIAS into this same
// family rather than a native transport: it also serves /v1/chat/completions, and /v1/models is an
// equivalent model-served preflight to the deleted native /api/tags check (parity confirmed — both
// fail loud, "model-not-served", on a mismatch). A bare (non-/v1) ollama host therefore now fails loud
// at preflight instead of silently routing nowhere — the deliberate migration signal; there is no
// auto-rewrite of a bare host to add /v1 (a config edit, not a runtime rewrite). The unset-provider
// default is now "openai" too (there is no longer a native family to default to). anthropic has a
// native wire format (/v1/messages: top-level system, content blocks, x-api-key + anthropic-version
// headers, max_tokens required) and keeps its own family — Claude's extended thinking cannot cross to
// a plain /v1/chat/completions, so it is the one family kept native by design. An unknown provider
// still returns "unsupported-provider".
export function providerFamily(name) {
  const n = String(name || "openai").toLowerCase();
  if (["openai", "vllm", "openrouter", "nvidia", "deepseek", "openai-compatible", "gemini", "ollama"].includes(n)) return "openai";
  if (n === "anthropic") return "anthropic";
  return n; // unknown — runReview returns status "unsupported-provider"
}

// PURE: join an OpenAI-style base URL (host already ends in /v1) with an endpoint path, without
// the new URL("/models", base) trap that would drop the /v1 prefix.
export function joinUrl(base, path) {
  return String(base).replace(/\/+$/, "") + path;
}

// PURE: the user message — context files (every file the diff touches, so the reviewer can verify
// existence/structure claims) fenced ahead of the diff. This is the fix for diff-only hallucination.
export function assembleUserMessage({ contextFiles = [], diff = "" }) {
  let s = "";
  for (const f of contextFiles) s += `<file path="${f.path}">\n${f.text}\n</file>\n\n`;
  s += `DIFF UNDER REVIEW:\n\n${diff}`;
  return s;
}

// FAFF-445: oversized-diff preflight — a conservative default well below the request-body limits
// commonly enforced by LLM API gateways (frequently 10MB+), chosen so a payload this large already
// all but guarantees either an outright 413 or such a degraded/truncated review that flagging it up
// front is strictly better than attempting the dispatch (see the FAFF-445 spec, Decision 1).
export const DEFAULT_MAX_PAYLOAD_BYTES = 5_000_000; // 5MB

// PURE (FAFF-445): does the assembled payload (system + user — the exact two strings every chain
// element's orchestration function places in its wire request) exceed a size threshold? Checked ONCE,
// before the fallback chain is entered, so an oversized diff is flagged deterministically at zero
// network cost rather than discovered only via a provider 413 mid-chain (FAFF-414 hardened the
// *reaction* to that throw; this guards the *precondition* that produces it — the two compose, neither
// supersedes the other). Strict `>` — a payload sitting exactly on the boundary dispatches normally.
export function checkPayloadSize({ system, user, maxBytes = DEFAULT_MAX_PAYLOAD_BYTES } = {}) {
  const bytes = Buffer.byteLength(String(system == null ? "" : system), "utf8")
    + Buffer.byteLength(String(user == null ? "" : user), "utf8");
  return { oversized: bytes > maxBytes, bytes, maxBytes };
}

// --- FAFF-915: diff-relevance context trim -------------------------------------------------------
//
// Reasoning reviewers empty out on large review payloads: the model spends its whole output budget
// reasoning and emits zero findings. The context bundle (whole source files shipped as --context) is
// most of that payload while the diff only touches a few regions, so trimming the context to the
// diff-relevant regions roughly halves the payload and puts a reasoning-ON review back under the
// empty-out knee. This is the targeted context-trim (the lighter fix), NOT a general decomposer.
//
// The trim is a PURE function of (contextFiles, diff): identical inputs give identical output, so the
// trimmed context stays byte-identical across the four spec-review lenses (only --system differs) and
// remains a stable shared-prefix cache (FAFF-903). It is gated by a byte threshold — below the
// threshold the context passes through unchanged, so every existing review and its golden tests are
// byte-for-byte unaffected — and it never drops a line inside a diff-touched range (the conservative
// guarantee). See the FAFF-915 spec.

// The trim's fixed build defaults. Named constants (not magic numbers) so a later review-bench pass
// (FAFF-904) re-tunes them in one place; the trim's shape and contract never depend on the values.
export const DEFAULT_CONTEXT_TRIM_BYTES = 49152;   // 48 KB — below this assembled-context size the trim is a no-op
export const DEFAULT_MIN_FILE_TRIM_BYTES = 2048;   // 2 KB — a no-anchor file below this passes through untrimmed
export const DEFAULT_TRIM_WINDOW = 24;             // lines of context kept either side of each anchor
export const DEFAULT_TRIM_HEAD_LINES = 12;         // leading lines kept when a large no-anchor file is head-reduced
export const DEFAULT_MAX_ANCHOR_LINES = 40;        // a diff token anchoring more lines than this in a file is too common to anchor
export const DEFAULT_RETAINED_CEILING = 0.8;       // if a trimmed file still retains more than this fraction, head-reduce it instead

// A whole-word identifier token: a run of JS identifier characters. Length >= 3 is applied by the caller.
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
// Closed stoplist (no "and similar"): common JS keywords too generic to be a relevance signal.
const IDENT_STOPLIST = new Set([
  "const", "let", "var", "function", "return", "import", "export", "default", "this", "new",
  "typeof", "void", "await", "async", "class", "extends", "super", "yield", "delete", "instanceof",
]);

// PURE (FAFF-915): the fixed elision-marker sentinel written in place of a dropped span. It carries the
// dropped-line count and can never equal a real source line, so a touched line is never mistaken for a
// marker (the survival oracle depends on this).
export function elisionMarker(n) {
  return `... ${n} line(s) elided (FAFF-915 relevance trim) ...`;
}

// PURE (FAFF-915): parse a unified diff into { touchedByPath, identifiers }.
// - touchedByPath: Map<full-path, Array<[startLine, endLine]>> of the new-file (+++) line ranges each
//   hunk touches. Keyed by the FULL path (a/ b/ prefixes stripped) — not the basename — so two context
//   files that share a basename (src/foo.js vs lib/foo.js) never cross-apply each other's ranges;
//   pathsMatch() below resolves a context path to a touched path by exact-or-suffix.
// - identifiers: Set of >=3-char identifier tokens named on the diff's +/- body lines, minus the
//   stoplist — a cheap textual stand-in for the diff's direct callers/callees.
// Fail-safe: an unparseable hunk header contributes no range for that hunk (never a wrong range).
export function parseDiffTouched(diff) {
  const touchedByPath = new Map();
  const identifiers = new Set();
  // Strip a trailing CR so a CRLF-terminated diff's blank context lines are recognised (a bare "\r"
  // would otherwise fall through and desync the new-file counter).
  const lines = String(diff == null ? "" : diff).split("\n").map((l) => l.replace(/\r$/, ""));
  let curKey = null;   // full stripped path of the current +++ file
  let newLine = 0;     // running new-file line number inside the current hunk
  let oldRemain = 0;   // old-file body lines still expected in the current hunk (from the @@ header)
  let newRemain = 0;   // new-file body lines still expected in the current hunk
  const inHunk = () => oldRemain > 0 || newRemain > 0;   // a hunk is "open" until its declared counts are consumed
  const addRange = (key, a, b) => {
    if (!key) return;
    if (!touchedByPath.has(key)) touchedByPath.set(key, []);
    touchedByPath.get(key).push([a, b]);
  };
  for (const line of lines) {
    // Structural lines are only recognised BETWEEN hunks (counts exhausted). Inside an open hunk a
    // body line whose content begins with "+++ " / "--- " / "@@" is data, not a header — the declared
    // line counts, not a leading-token guess, decide where the hunk ends, so such content is parsed
    // correctly instead of being misread as the next file header.
    if (!inHunk()) {
      if (line.startsWith("+++ ")) {
        const p = line.slice(4).trim().split("\t")[0];
        curKey = p === "/dev/null" ? null : (p.replace(/^[ab]\//, "") || null);
        continue;
      }
      const m = line.match(/^@@\s+-\d+(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (m) {
        oldRemain = m[1] === undefined ? 1 : Number(m[1]);   // b defaults to 1 when omitted
        newLine = Number(m[2]);
        newRemain = m[3] === undefined ? 1 : Number(m[3]);   // d defaults to 1 when omitted
        continue;
      }
      continue;   // any other between-hunk line (diff --git, index, --- , context noise) is ignored
    }
    // Inside an open hunk: classify by the leading marker and decrement the declared counts.
    const marker = line.charAt(0);
    if (marker === "+") {
      addRange(curKey, newLine, newLine);
      collectIdents(line.slice(1), identifiers);
      newLine += 1;
      if (newRemain > 0) newRemain -= 1;
    } else if (marker === "-") {
      collectIdents(line.slice(1), identifiers);   // a removed line names identifiers but consumes no new-file line
      if (oldRemain > 0) oldRemain -= 1;
    } else if (marker === "\\") {
      // "\ No newline at end of file" — a marker, not a body line; consumes no count.
    } else {
      // a context line (" " prefix, or a truly-empty blank context line) advances the new-file counter
      newLine += 1;
      if (oldRemain > 0) oldRemain -= 1;
      if (newRemain > 0) newRemain -= 1;
    }
  }
  return { touchedByPath, identifiers };
}

// PURE (FAFF-915): does a context-file path resolve to a touched diff path? Exact match, or either is
// a path-component suffix of the other (so a bare "review-call.mjs" matches "plugin/.../review-call.mjs",
// but "src/foo.js" never matches "lib/foo.js"). Strips a/ b/ prefixes on both sides. Full-path context
// paths (the normal caller shape) resolve unambiguously; a BARE-basename context path can still suffix-
// match more than one same-basename diff path, but the trim is keep-only (a wrong match over-retains,
// never under-retains a genuinely-relevant line), so the failure mode is safe.
export function pathsMatch(ctxPath, diffPath) {
  const norm = (p) => String(p || "").replace(/^[ab]\//, "");
  const a = norm(ctxPath);
  const b = norm(diffPath);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith("/" + b) || b.endsWith("/" + a);
}

function collectIdents(text, out) {
  const found = String(text).match(IDENT_RE);
  if (!found) return;
  for (const t of found) {
    if (t.length >= 3 && !IDENT_STOPLIST.has(t)) out.add(t);
  }
}

// PURE (FAFF-915): does `line` contain token `t` as a whole word — delimited by a non-identifier
// character (or line start/end) on both sides, so `parse` does not match inside `parseArgs`?
function lineHasWholeWord(line, t) {
  let from = 0;
  for (;;) {
    const i = line.indexOf(t, from);
    if (i < 0) return false;
    const before = i === 0 ? "" : line[i - 1];
    const after = i + t.length >= line.length ? "" : line[i + t.length];
    const boundary = (c) => c === "" || !/[A-Za-z0-9_$]/.test(c);
    if (boundary(before) && boundary(after)) return true;
    from = i + 1;
  }
}

// PURE (FAFF-915): reduce one file's text to its head (first `headLines` lines) plus one elision
// marker for the dropped body. Used for a large no-anchor file and as the retained-ceiling fallback.
function headReduce(fileLines, headLines) {
  const h = Math.max(0, Math.trunc(headLines) || 0);   // clamp: a negative/NaN headLines never yields a bogus marker count
  if (fileLines.length <= h) return fileLines.join("\n");
  const kept = fileLines.slice(0, h);
  const dropped = fileLines.length - h;
  return kept.concat([elisionMarker(dropped)]).join("\n");
}

// PURE (FAFF-915): trim one file's text to its diff-relevant regions. Returns the trimmed text.
// Retained line set = diff-touched ranges (always) ∪ identifier-anchored lines, each expanded by a
// ±window and merged; a frequency-capped token (anchoring > maxAnchorLines lines) is dropped as too
// common; a file that would still retain > retainedCeiling is head-reduced instead. A no-anchor file
// below minFileBytes is returned unchanged; a larger no-anchor file is head-reduced.
export function trimOneFile(text, touchedRanges, identifiers, opts) {
  const { window, minFileBytes, headLines, maxAnchorLines, retainedCeiling } = opts;
  const fileLines = text.split("\n");
  const n = fileLines.length;
  const anchored = new Array(n).fill(false);   // an anchor line (touched or identifier)
  const touched = new Array(n).fill(false);    // a diff-touched line (never dropped, exempt from caps)

  // 1) diff-touched ranges (1-based, inclusive) — always anchors, and marked touched.
  for (const [a, b] of touchedRanges || []) {
    for (let ln = a; ln <= b; ln++) {
      const idx = ln - 1;
      if (idx >= 0 && idx < n) { anchored[idx] = true; touched[idx] = true; }
    }
  }

  // 2) identifier anchors, frequency-capped per file.
  for (const t of identifiers) {
    const hits = [];
    for (let i = 0; i < n; i++) if (lineHasWholeWord(fileLines[i], t)) hits.push(i);
    if (hits.length === 0 || hits.length > maxAnchorLines) continue;   // absent or too common → no anchors
    for (const i of hits) anchored[i] = true;
  }

  const anyAnchor = anchored.some(Boolean);
  const bytesOf = (s) => Buffer.byteLength(s, "utf8");

  // No anchors at all → protect small files, head-reduce large ones.
  if (!anyAnchor) {
    if (bytesOf(text) < minFileBytes) return text;   // small caller-selected file → untouched
    return headReduce(fileLines, headLines);
  }

  // 3) expand anchors by ±window, merge, emit kept spans + one marker per dropped gap.
  const keep = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!anchored[i]) continue;
    const lo = Math.max(0, i - window);
    const hi = Math.min(n - 1, i + window);
    for (let j = lo; j <= hi; j++) keep[j] = true;
  }
  // Touched lines are always kept regardless of any later reduction (the conservative guarantee).
  for (let i = 0; i < n; i++) if (touched[i]) keep[i] = true;

  const keptCount = keep.filter(Boolean).length;
  // 4) retained-ceiling fallback: if we would still keep too much, head-reduce. This is GUARDED by
  //    `!hasTouched` — a file with ANY diff-touched line is exempt from the ceiling entirely and keeps
  //    its full windowed set, so the head-reduce below can never drop a touched line (the conservative
  //    guarantee). The ceiling only ever reshapes a purely identifier-anchored file.
  const hasTouched = touched.some(Boolean);
  if (!hasTouched && keptCount / n > retainedCeiling) {
    return headReduce(fileLines, headLines);
  }

  const out = [];
  let gap = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      if (gap > 0) { out.push(elisionMarker(gap)); gap = 0; }
      out.push(fileLines[i]);
    } else {
      gap += 1;
    }
  }
  if (gap > 0) out.push(elisionMarker(gap));
  return out.join("\n");
}

// PURE (FAFF-915): the relevance filter over the whole context bundle. Below the byte threshold it is
// an identity no-op (byte-identical to today). thresholdBytes = 0 disables the trim entirely.
export function trimContextFiles({
  contextFiles = [],
  diff = "",
  thresholdBytes = DEFAULT_CONTEXT_TRIM_BYTES,
  window = DEFAULT_TRIM_WINDOW,
  minFileBytes = DEFAULT_MIN_FILE_TRIM_BYTES,
  headLines = DEFAULT_TRIM_HEAD_LINES,
  maxAnchorLines = DEFAULT_MAX_ANCHOR_LINES,
  retainedCeiling = DEFAULT_RETAINED_CEILING,
} = {}) {
  const bytesOf = (s) => Buffer.byteLength(String(s == null ? "" : s), "utf8");
  const bytesBefore = contextFiles.reduce((acc, f) => acc + bytesOf(f.text), 0);
  // Gate: disabled (0), or the whole context is already under the threshold → identity no-op.
  if (!(thresholdBytes > 0) || bytesBefore <= thresholdBytes) {
    return { contextFiles, report: { trimmed: false, bytesBefore, bytesAfter: bytesBefore } };
  }
  const { touchedByPath, identifiers } = parseDiffTouched(diff);
  const opts = { window, minFileBytes, headLines, maxAnchorLines, retainedCeiling };
  const out = contextFiles.map((f) => {
    // Resolve this context file's touched ranges by full-path match (exact-or-suffix), so a shared
    // basename never cross-applies another file's ranges. Aggregate across all matching diff paths.
    const ranges = [];
    for (const [diffPath, rs] of touchedByPath) {
      if (pathsMatch(f.path, diffPath)) ranges.push(...rs);
    }
    const trimmedText = trimOneFile(f.text, ranges, identifiers, opts);
    return { path: f.path, text: trimmedText };
  });
  const bytesAfter = out.reduce((acc, f) => acc + bytesOf(f.text), 0);
  return { contextFiles: out, report: { trimmed: true, bytesBefore, bytesAfter } };
}

// --- FAFF-194: deterministic guards for machine-checkable findings + output-format enforcement ---
//
// The adversarial reviewer's findings are hypotheses from a deliberately fallible LLM; two things the
// harness should settle itself rather than trust to the model: whether a "this is a syntax error" claim
// is true (node --check answers that), and whether the raw output is findings-shaped at ALL (main() used
// to print whatever a backend streamed, even empty, as exit 0). Both move into this pure-function layer
// + one injectable check runner, so the LLM is spent only on judgement a tool can't verify.

// PURE: tolerant split of reviewer output into a preamble (everything before the first `### ` heading —
// e.g. the `## Adversarial findings — provider/model` header line) and an ordered list of finding
// sections. Each section spans from its `### ` heading line to (exclusive) the next one, or EOF. Severity
// is parsed from the heading; a heading with no recognised severity word still yields a section (raw
// findings-shape validation only cares that >=1 section has severity != null). `start`/`end` are the
// section's line-index bounds in `content.split("\n")` — carried so refuteFindings can splice the
// original lines array directly rather than re-stringify (see refuteFindings for why that matters).
// The heading test excludes `####`+ (an h4+ inside a finding body is not a NEW finding boundary).
const HEADING_LINE_RE = /^###\s(?!#)/;
const SEVERITY_HEADING_RE = /^###\s*\[?(critical|major|minor|observation)\]?\s*[:—-]\s*(.*)$/i;

export function splitFindings(content) {
  const text = String(content == null ? "" : content);
  const lines = text.split("\n");
  const headingIdxs = [];
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_LINE_RE.test(lines[i])) headingIdxs.push(i);
  }
  if (headingIdxs.length === 0) return { preamble: text, sections: [] };
  const preamble = lines.slice(0, headingIdxs[0]).join("\n");
  const sections = [];
  for (let i = 0; i < headingIdxs.length; i++) {
    const start = headingIdxs[i];
    const end = i + 1 < headingIdxs.length ? headingIdxs[i + 1] : lines.length;
    const heading = lines[start];
    const body = lines.slice(start + 1, end).join("\n");
    const raw = lines.slice(start, end).join("\n");
    const m = heading.match(SEVERITY_HEADING_RE);
    const severity = m ? m[1].toLowerCase() : null;
    const title = m ? m[2] : heading.replace(/^###\s*/, "");
    sections.push({ heading, severity, title, body, raw, start, end });
  }
  return { preamble, sections };
}

// PURE (FAFF-465): a conservative, closed, anchored, case-insensitive, length-guarded refusal
// signature — the discriminator between an OK-status, non-empty response that is a provider REFUSAL
// (an operator-fixable structural inability, the SAME class as an empty body — EXIT.NO_FINDINGS_CONTENT)
// and genuine substantive garble (a reachable-but-degraded backend, an availability symptom —
// EXIT.MALFORMED). Anchored near the start of the trimmed content (a refusal typically opens with one
// of these) and length-guarded (a response longer than REFUSAL_MAX_LENGTH_CHARS never matches, however
// it opens), so a long rambling essay that merely mentions "I cannot" partway through is never
// misclassified as a refusal — it falls through to "garbled" instead. A fixed, unit-testable table, not
// an open-ended fuzzy match — mirrors the CLEAN_REFUTATIONS closed-grammar style (:196-202 below).
const REFUSAL_MAX_LENGTH_CHARS = 400;
// Adversarial-review finding (Phase 2, real backend call): two of the six patterns had no `^` anchor at
// all — a substring match anywhere in the (already length-guarded) content. A short, adjacent-but-
// legitimate finding using an unrecognised severity word (so it reaches this check at all — see
// validateFindingsShape below) could still contain "content policy" or the assist/help/comply phrase
// well past its opening and get misclassified `refusal` instead of `garbled`, reintroducing exactly the
// incidental-vocabulary non-determinism this split exists to remove. FIX: every pattern is now bounded to
// the first REFUSAL_PREFIX_CHARS of the trimmed content (`^[\s\S]{0,N}`, `[\s\S]` so an early newline
// doesn't defeat the bound) — a genuine refusal is a short, up-front statement, never something a model
// buries mid-response.
const REFUSAL_PREFIX_CHARS = 100;
const REFUSAL_PATTERNS = [
  /^i\s*(cannot|can'?t|won'?t|am\s+unable|'m\s+unable)\b/i,
  /^(sorry|i'?m sorry|i apologi[sz]e)[,.]?\s+(but\s+)?i\s*(cannot|can'?t|am\s+unable)\b/i,
  /^as an ai\b/i,
  /^i\s+(don'?t|do not)\s+(have|possess)\s+(the\s+)?(ability|capability)\s+to\b/i,
  new RegExp(`^[\\s\\S]{0,${REFUSAL_PREFIX_CHARS}}content policy`, "i"),
  new RegExp(`^[\\s\\S]{0,${REFUSAL_PREFIX_CHARS}}(cannot|can'?t|won'?t)\\s+(assist|help|comply)\\s+with\\s+(that|this)\\s+request`, "i"),
];

export function isProviderRefusal(content) {
  const trimmed = String(content == null ? "" : content).trim();
  if (!trimmed || trimmed.length > REFUSAL_MAX_LENGTH_CHARS) return false;
  return REFUSAL_PATTERNS.some((re) => re.test(trimmed));
}

// PURE: is this content findings-shaped? Non-empty AND at least one `### <severity>: ...` section with a
// severity in the closed set. When it is NOT, `kind` discriminates WHY (FAFF-465): "empty" (whitespace-
// only content), "refusal" (non-empty content matching the closed isProviderRefusal grammar — an
// operator-fixable structural inability), or "garbled" (non-empty, non-refusal content with no
// recognised finding section — a genuine reachable-but-degraded symptom). The caller maps empty/refusal
// to EXIT.NO_FINDINGS_CONTENT(11, needs-human) and garbled to EXIT.MALFORMED(10, availability) — see the
// call site in runReviewChain below.
export function validateFindingsShape(content) {
  const trimmed = String(content == null ? "" : content).trim();
  if (!trimmed) return { ok: false, reason: "empty content", kind: "empty" };
  const { sections } = splitFindings(content);
  if (!sections.some((s) => s.severity != null)) {
    if (isProviderRefusal(trimmed)) {
      return { ok: false, reason: "provider refusal", kind: "refusal" };
    }
    return { ok: false, reason: "no recognised finding section (### <severity>: ...)", kind: "garbled" };
  }
  return { ok: true };
}

// PURE (FAFF-746): the spec-refuter prompts define four exact no-objection responses. Accept only
// that closed grammar and mechanically translate it to the existing findings-shaped no-findings
// token. Matching is provider-neutral and deliberately strict: line endings, outer whitespace, and
// blank separator lines are formatting; every substantive byte remains case- and punctuation-sensitive.
export const CANONICAL_NO_FINDINGS = "### observation: no findings";
// FAFF-990: the exported truncation marker — a dedicated machine string emitted on its OWN stderr line
// (never a substring of the human "[note] response truncated…" sentence) when a served exit-0 response
// hit its token budget (`res.truncated`). `fan-out.mjs` imports THIS constant and sets
// `LensResult.truncated = true` iff a trimmed stderr line equals it exactly, so the truncation fact
// crosses to the spec-review classifier as a structured, unforgeable, single-sourced signal. The shared
// import is the single source of truth — a rename on either side breaks CI (the fan-out drift test),
// never production. Consumed structurally, never re-derived or prose-matched.
export const TRUNCATION_SIGNAL = "[faff:truncated]";
// FAFF-942: a lens may carry an optional `signal` — a lens-specific no-signal diagnostic line the
// refuter emits alongside its no-objection sentence. Only methodology has one (the no-critique case).
// It extends the closed grammar by exactly one recognised three-line `heading` + `signal` + `sentence`
// form; every substantive byte stays exact, so arbitrary trailing prose is still rejected.
export const CLEAN_REFUTATIONS = Object.freeze([
  Object.freeze({ lens: "architectural", heading: "## Refutation — architectural", sentence: "No architectural objection." }),
  Object.freeze({ lens: "infosec", heading: "## Refutation — infosec", sentence: "No infosec objection." }),
  Object.freeze({ lens: "methodology", heading: "## Refutation — methodology", sentence: "No methodology objection.", signal: "no methodology signal available." }),
  Object.freeze({ lens: "QA", heading: "## Refutation — QA", sentence: "No QA objection." }),
]);

// FAFF-927: a decorative header is any single ATX heading line that is NEITHER a severity-worded
// heading (that would make the content genuinely findings-shaped — swallowing it as clean would hide a
// real finding) NOR inside the reserved `## Refutation — <lens>` namespace (whose lens-consistency is
// already enforced by the `headed` arm below — a mismatched pair like `## Refutation — architectural` +
// `No QA objection.` must stay rejected). Every other decorative wrapper a model realistically emits
// (`# Code review`, `## Second opinion`, `### Assessment`) is accepted.
//
// FAFF-927 self-review fix: SEVERITY_HEADING_RE only matches the CANONICAL 3-hash `### <severity>:`
// form splitFindings itself parses. A backend can still state a real finding inside a severity-worded
// heading at a DIFFERENT ATX level — `## Critical: null check removed in parseDiff` followed by
// `No QA objection.` — which SEVERITY_HEADING_RE does not match, so it would have been accepted as
// decorative and the stated finding silently swallowed. SEVERITY_LIKE_HEADING_RE is level-agnostic
// (any of 1-6 hashes) so a severity-worded heading is excluded regardless of level, closing that gap
// without touching SEVERITY_HEADING_RE's own (unrelated) job of parsing genuine finding sections.
//
// FAFF-927 self-review fix: REFUTATION_NAMESPACE_RE originally matched only the exact 2-hash,
// em-dash-only, exact-case canonical spelling. A near-miss spelling — `### Refutation — architectural`
// (3 hashes), `## Refutation - architectural` (plain hyphen), or `## refutation — architectural`
// (lower-case) — fell outside the namespace and was accepted as decorative, letting a lens-mismatched
// clean sentence (e.g. paired with `No QA objection.`) through as `header-wrapped` instead of staying
// rejected like the exact-spelling FAFF-746 fixtures. Widened to any heading level, either dash form,
// and case-insensitive matching so the namespace exclusion holds under punctuation/case/heading-level
// drift, not just the one canonical spelling.
const ATX_HEADING_RE = /^#{1,6}\s+\S/;
const SEVERITY_LIKE_HEADING_RE = /^#{1,6}\s*\[?(critical|major|minor|observation)\]?\s*[:—-]/i;
const REFUTATION_NAMESPACE_RE = /^#{1,6}\s+Refutation\s+[—-]/i;

function isDecorativeHeader(line) {
  if (!ATX_HEADING_RE.test(line)) return false;
  if (SEVERITY_LIKE_HEADING_RE.test(line)) return false;
  if (REFUTATION_NAMESPACE_RE.test(line)) return false;
  return true;
}

export function normaliseCleanRefutation(content) {
  const original = String(content == null ? "" : content);
  const lines = original.replace(/\r\n?/g, "\n").trim().split("\n").filter((line) => line.trim() !== "");
  for (const entry of CLEAN_REFUTATIONS) {
    if (lines.length === 1 && lines[0] === entry.sentence) {
      return { content: CANONICAL_NO_FINDINGS, normalised: true, lens: entry.lens, form: "bare" };
    }
    if (lines.length === 2 && lines[0] === entry.heading && lines[1] === entry.sentence) {
      return { content: CANONICAL_NO_FINDINGS, normalised: true, lens: entry.lens, form: "headed" };
    }
    // FAFF-942: heading + the lens's own no-signal diagnostic line + sentence — the exact three-line
    // no-op the methodology refuter emits when handed no critique. Closed: only an entry that declares a
    // `signal`, and only that exact middle line, ever matches this arm.
    if (entry.signal != null && lines.length === 3 && lines[0] === entry.heading && lines[1] === entry.signal && lines[2] === entry.sentence) {
      return { content: CANONICAL_NO_FINDINGS, normalised: true, lens: entry.lens, form: "headed+signal" };
    }
  }
  // FAFF-927: any single decorative header wrapping a byte-exact affirmation sentence. Tried only after
  // every exact per-entry arm above has failed to match, so a body that also satisfies `headed` or
  // `headed+signal` keeps that more specific label — no existing form regresses to `header-wrapped`.
  if (lines.length === 2 && isDecorativeHeader(lines[0])) {
    for (const entry of CLEAN_REFUTATIONS) {
      if (lines[1] === entry.sentence) {
        return { content: CANONICAL_NO_FINDINGS, normalised: true, lens: entry.lens, form: "header-wrapped" };
      }
    }
  }
  return { content: original, normalised: false, lens: null, form: null };
}

// PURE (FAFF-361): the canonical, harness-authored findings header — provenance is harness data,
// never demanded from the fallible model (FAFF-194 design decision: normalise/prepend rather than
// park on a missing one). Extended by FAFF-361 to also carry the winner's chain position and host
// provenance (chain[<index>], host: <hostSource>) — the mechanical answer to "which configured
// backend actually served this?", the exact provenance a same-day reconstruction incident needed.
// provider defaults to "openai" (FAFF-872; mirrors the `tag` fallback in runReviewChain and the
// providerFamily default — there is no longer a native ollama family to default to) and hostSource
// defaults to "config" (back-compat for a caller that hasn't set it) when either is falsy.
export function attributionHeader(winner, index) {
  const w = winner || {};
  const provider = w.provider || "openai";
  const hostSource = w.hostSource || "config";
  return `## Adversarial findings — ${provider}/${w.model} (chain[${index}], host: ${hostSource})`;
}

const HEADER_LINE_RE = /^##[ \t]*Adversarial findings/i;

// Locate an existing header line's index, searching ONLY the preamble (before the first `### ` finding
// heading, exclusive) — never a finding body. Returns -1 when absent. Shared by ensureHeader (below) and
// main()'s "was a header already present" check, so both use the identical scoped definition of "present".
function findHeaderLineIdx(lines) {
  const firstHeadingIdx = lines.findIndex((l) => HEADING_LINE_RE.test(l));
  const scopeEnd = firstHeadingIdx === -1 ? lines.length : firstHeadingIdx;
  for (let i = 0; i < scopeEnd; i++) if (HEADER_LINE_RE.test(lines[i])) return i;
  return -1;
}

// PURE: does `content` already carry a header line (searched preamble-only, never a finding body)?
export function hasHeader(content) {
  return findHeaderLineIdx(String(content == null ? "" : content).split("\n")) !== -1;
}

// PURE: replace an existing (possibly model-echoed, possibly wrong) header line with the canonical one, or
// prepend it when absent. A no-op (byte-identical) when the existing header already matches canonical.
// The search is scoped to the PREAMBLE (before the first `### ` finding heading) only — a finding BODY
// that legitimately quotes a `## Adversarial findings — …` line (e.g. citing a prior review for
// comparison) must never be rewritten; only the document's own provenance header may be.
export function ensureHeader(content, winner, index) {
  const header = attributionHeader(winner, index);
  const text = String(content == null ? "" : content);
  const lines = text.split("\n");
  const headerIdx = findHeaderLineIdx(lines);
  if (headerIdx !== -1) { lines[headerIdx] = header; return lines.join("\n"); }
  return `${header}\n\n${text}`;
}

// PURE: recall-tuned WITHIN the syntax/parse claim class only (v1 scope) — a finding asserting code
// "won't parse" / "is invalid syntax" / "fails to parse", etc. Crash/test-failure claims are OUT OF SCOPE
// (a green suite doesn't refute an uncovered-path claim); this regex intentionally never matches those.
const SYNTAX_CLAIM_RE = /syntax error|SyntaxError|won'?t parse|will not parse|fails? to parse|invalid (javascript|js|syntax)|not (valid|parseable|parsable)/i;

export function findSyntaxClaims(sectionText) {
  return SYNTAX_CLAIM_RE.test(String(sectionText == null ? "" : sectionText));
}

const JS_FAMILY_RE = /\.(m|c)?js$/i;
function isJsFamily(p) { return JS_FAMILY_RE.test(String(p == null ? "" : p)); }

// A char that continues a path/filename token — used to reject a match that is really a PREFIX of a
// longer named path (e.g. contextPaths containing both "src/foo.js" and "src/foo.js.bak": a mention of
// only the latter must not also count as naming the former).
const PATH_TOKEN_CHAR_RE = /[A-Za-z0-9_./-]/;

// PURE: is `path` named in `text` at a genuine path boundary (not merely a textual prefix of a longer
// path that's the one actually mentioned)? Shared by claimTargets (below) and refuteFindings' "did this
// claim name ANY context path at all" check, so both use the identical definition of "named".
function pathMentionedIn(text, path) {
  const idx = text.indexOf(path);
  if (idx === -1) return false;
  const before = idx > 0 ? text[idx - 1] : "";
  const after = idx + path.length < text.length ? text[idx + path.length] : "";
  return !PATH_TOKEN_CHAR_RE.test(before) && !PATH_TOKEN_CHAR_RE.test(after);
}

// PURE: which context paths does this finding's text name, filtered to JS-family (.js/.mjs/.cjs) — the
// only family `node --check` can settle. A path is "named" by substring match against the section text
// (heading + body), matching how the reviewer's own context files are fenced (assembleUserMessage) —
// BOUNDARY-CHECKED so a shorter path is never counted as named merely because it's a textual prefix of a
// longer one that happens to be mentioned instead.
export function claimTargets(sectionText, contextPaths) {
  const text = String(sectionText == null ? "" : sectionText);
  return (contextPaths || []).filter((p) => isJsFamily(p) && pathMentionedIn(text, p));
}

// The injectable check runner (the only new I/O) — real spawnSync("node", ["--check", path]); ok iff
// exit 0. Injectable exactly as getFn/streamFn are, so CI spawns nothing unless a test opts in.
export function realCheck(path) {
  const r = spawnSync("node", ["--check", path], { encoding: "utf8" });
  const ok = !r.error && r.status === 0;
  const output = String((r.stderr || r.stdout || (r.error && r.error.message) || "")).trim();
  return { ok, output };
}

// PURE-ISH (checkFn is the one injected side-effect): downgrade-only refutation pass over machine-checkable
// syntax claims. Precision over recall — a finding is downgraded ONLY when every file the claim can be tied
// to positively passes the check; any inability to tie the claim to a checkable file, or any check
// failure, leaves it untouched (a wrongly-downgraded true finding is the expensive error; a surviving false
// finding merely costs the implementor the status-quo disproof cycle). Never drops a finding — downgrades
// severity to `observation`, prefixes the title `[auto-refuted]`, and appends an evidence line, so the
// audit trail (what the reviewer got wrong) survives.
//
// Target resolution (contextPaths is the FULL context list, unfiltered — mirrors what the reviewer was
// actually shown): claimTargets() already filters matches to JS-family. When a section names NO context
// path at all (JS or otherwise), fall back to every JS-family context path (a generic "this code has a
// syntax error" claim, uncommitted to one file) — but a claim that names ONLY a non-JS-family file (e.g.
// SKILL.md) stays untouched: it named something, just nothing this pass can settle (precision bias).
//
// Reconstruction: edits are applied by SPLICING the original `content.split("\n")` array in place (heading
// line rewritten, one evidence line inserted) rather than re-joining pre-computed section strings — the
// latter silently collapses blank-line separators between sections whenever at least one sibling section
// is refuted, corrupting untouched findings' spacing (caught in review). Splicing touches only the exact
// lines of a refuted section, so every untouched section's original bytes — including its surrounding
// blank-line separators — survive verbatim. Sections are edited LAST-to-FIRST so an earlier section's
// line-index bounds (computed once, up front) stay valid across the whole pass.
export function refuteFindings(content, contextPaths, { checkFn = realCheck } = {}) {
  const text = String(content == null ? "" : content);
  const paths = contextPaths || [];
  const jsPaths = paths.filter(isJsFamily);
  const { sections } = splitFindings(content);
  const refutations = [];
  const outLines = text.split("\n");

  for (let idx = sections.length - 1; idx >= 0; idx--) {
    const s = sections[idx];
    if (s.severity == null) continue;
    if (!findSyntaxClaims(s.raw)) continue;

    let targets = claimTargets(s.raw, paths);
    if (targets.length === 0) {
      const namedAnyContextPath = paths.some((p) => pathMentionedIn(s.raw, p));
      if (!namedAnyContextPath) targets = jsPaths;   // generic claim, no file named — check every JS file
    }
    if (targets.length === 0) continue;   // cannot tie the claim to a checkable file — untouched

    const results = targets.map((t) => checkFn(t));
    if (!results.every((r) => r && r.ok)) continue;   // any check failure — the reviewer may be right

    refutations.push({ title: s.title, files: targets, from: s.severity });
    const files = targets.join(", ");
    const newTitle = `[auto-refuted] ${s.title}`;
    const evidence = `> auto-refuted: node --check passed on ${files} — syntax claim mechanically disproved (was ${s.severity})`;

    // Insert the evidence line right after the section's LAST non-blank line (searching backward from
    // s.end, exclusive, down to s.start+1) — this lands it after real content and leaves any ORIGINAL
    // trailing blank-line separator before the next heading (or EOF) exactly where it was.
    let insertAt = s.start + 1;   // default: no body lines at all — right after the (rewritten) heading
    for (let li = s.end - 1; li > s.start; li--) {
      if (outLines[li].trim() !== "") { insertAt = li + 1; break; }
    }
    outLines[s.start] = `### observation: ${newTitle}`;
    outLines.splice(insertAt, 0, evidence);
  }

  if (refutations.length === 0) return { content, refutations: [] };
  return { content: outLines.join("\n"), refutations: refutations.reverse() };
}

// --- OpenAI-compatible (/v1) pure functions ---

// FAFF-873: PURE — clamp faff's five-tier effort vocabulary (low|medium|high|xhigh|max)
// onto the three-level wire target the OpenAI reasoning_effort field accepts
// (low|medium|high). Above-ceiling levels clamp to high (never fragment the closed
// lane-uniform vocabulary per-backend). This is a LOCAL MIRROR of config.js's
// `reasoningEffortForTransport` — this file is a standalone .mjs with no faff
// CommonJS imports (see the resolveTokenSource mirror note above, runReviewChain),
// so the switch is duplicated here rather than imported. Keep the two in sync by hand.
function clampEffortToWire(effort) {
  switch (effort) {
    case "low": return "low";
    case "medium": return "medium";
    case "high": return "high";
    case "xhigh": return "high";   // clamp to wire ceiling
    case "max": return "high";     // clamp to wire ceiling
    default: return "high";        // defensive; the config-vocabulary check upstream gates real input
  }
}

// FAFF-914: the allowlist of top-level payload keys a per-backend `reasoning_extra`
// passthrough may set. Reasoning models diverge on the wire shape they read for the
// SAME intent — qwen3 honours top-level `reasoning_effort`; a Cohere/north model reads
// `thinking:{type}`; an OpenRouter/deepseek model reads `reasoning:{enabled|effort}` —
// so no single faff-modelled field (reasoning_off / reasoning_effort) reaches them all.
// `reasoning_extra` is the escape hatch: the operator declares whatever shape THEIR
// model honours and faff merges it verbatim, without hard-coding each provider's API.
// The set is reasoning-control ONLY — never faff-managed transport keys (model /
// messages / stream / max_tokens / temperature), which a merge would corrupt.
//
// FAFF-918: cross-model reasoning gotchas measured on the two spark vLLM builds
// (same vLLM 0.26.1rc1.dev1133). Read before reaching for a reasoning lever:
//   - `thinking_token_budget` (top-level int) hard-caps reasoning tokens so content
//     always emits. It is the ONE lever that works on BOTH qwen3 and cohere_command4
//     (north), and it fixes the empty-content bug (reasoning eating the whole
//     max_tokens, content:null, finish_reason:"length"). It is set per-backend via
//     reasoning_extra, never a shared default.
//   - `reasoning_effort` levels other than "none" are NOT graded on these builds
//     (protocol.py: enable_thinking = reasoning_effort != "none"); "none" turns
//     reasoning off on both.
//   - `chat_template_kwargs.enable_thinking` is model-specific: honoured on qwen3,
//     silently IGNORED on cohere_command4 (its parser has no enable_thinking path).
//   - usage.reasoning_tokens reads 0 on cohere_command4 even while reasoning runs;
//     detect the empty-out via finish_reason=="length" && content==null, not it.
//
// FAFF-986: `custom_params` is the nested-wrapper analogue of `thinking_token_budget`.
// Some Qwen vLLM builds read the budget at `custom_params.thinking_budget` rather than
// the top-level key, so faff must be able to emit `custom_params:{thinking_budget:N}`.
// It is a plain top-level set (faff sets no `custom_params` of its own, so unlike
// `chat_template_kwargs` there is no default on the body to deep-merge with).
export const REASONING_EXTRA_KEYS = ["reasoning", "thinking", "reasoning_effort", "chat_template_kwargs", "thinking_token_budget", "custom_params"];

// PURE: merge an allowlisted `reasoning_extra` object onto an OpenAI payload body, in
// place, returning it. Fail-closed: a key outside REASONING_EXTRA_KEYS throws, so a
// typo or an unmodelled field surfaces at the call boundary rather than silently
// egressing into the request. `chat_template_kwargs` DEEP-merges one level so an
// explicit extra composes with a `reasoning_off` default already on the body (which
// sets thinking/enable_thinking there); every other key is a top-level set. The caller
// applies it AFTER the reasoning_off/reasoning_effort branch, so an explicit extra wins
// per key — the operator's deliberate override for a model faff doesn't model natively.
export function mergeReasoningExtra(body, extra) {
  if (extra == null) return body;
  if (typeof extra !== "object" || Array.isArray(extra)) throw new Error("reasoning_extra must be an object");
  for (const [k, v] of Object.entries(extra)) {
    if (!REASONING_EXTRA_KEYS.includes(k)) {
      throw new Error(`reasoning_extra: unsupported key ${JSON.stringify(k)} (allowed: ${REASONING_EXTRA_KEYS.join(", ")})`);
    }
    if (k === "chat_template_kwargs" && body.chat_template_kwargs && v && typeof v === "object") {
      body.chat_template_kwargs = { ...body.chat_template_kwargs, ...v };
    } else {
      body[k] = v;
    }
  }
  return body;
}

// PURE: the /v1/chat/completions payload. reasoningOff adds
// chat_template_kwargs:{thinking:false, enable_thinking:false} — disables a reasoning
// model's hidden think phase (needed by reasoning models that else stream empty content;
// FAFF-872: the sole reasoning-off lever now — the native ollama family's hardcoded
// think:false is gone). `enable_thinking` is the key Qwen3/vLLM/SGLang/HF/MLX chat
// templates actually read to gate the think phase (FAFF-898); `thinking` is retained
// alongside it for compatibility with any server that reads the older key — unrecognised
// kwargs are ignored, so sending both is free. It is OPT-IN: vanilla OpenAI rejects the
// unknown field, so it is sent only when the provider/model needs it — unlike the deleted
// native path, an UNSET reasoningOff here emits no chat_template_kwargs at all (thinking
// is left to the model's own default, not forced off; see the migration note in
// .faffrc.example.yaml for a folded backend that relied on the old always-off default).
// maxTokens caps output (OpenAI's max_tokens). stream:true keeps a long response's
// connection alive.
// FAFF-873: reasoningEffort emits the wire reasoning_effort field, clamped through
// clampEffortToWire — but ONLY when reasoningOff is false (reasoning_off wins on the
// wire, mirroring engine.js's buildEngineRequest `if/else if` precedent). Unset
// reasoningEffort (the default null) changes nothing — byte-identical to today.
// FAFF-914: reasoningExtra (a per-backend `reasoning_extra` object) is merged LAST via
// mergeReasoningExtra — the per-model escape hatch for a wire shape faff doesn't model
// natively (e.g. deepseek's `reasoning:{enabled:false}`, north's `thinking:{type}`).
// Unset (the default null) changes nothing — byte-identical to today.
export function buildOpenAiPayload({ model, system, user, maxTokens = DEFAULT_NUM_PREDICT, reasoningOff = false, reasoningEffort = null, reasoningExtra = null, temperature = 0.2 }) {
  if (!model) throw new Error("buildOpenAiPayload requires a model");
  const body = {
    model,
    stream: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (reasoningOff) body.chat_template_kwargs = { thinking: false, enable_thinking: false };
  else if (reasoningEffort) body.reasoning_effort = clampEffortToWire(reasoningEffort);
  mergeReasoningExtra(body, reasoningExtra);
  return body;
}

// PURE: is the configured model in the host's /v1/models set? Reads the {data:[{id}]} shape.
export function modelServedOpenAi(modelsJson, model) {
  const obj = typeof modelsJson === "string" ? JSON.parse(modelsJson) : modelsJson;
  const ids = (obj?.data ?? []).map((m) => m.id ?? m.name).filter(Boolean);
  return { served: ids.includes(model), names: ids };
}

// PURE: fold an SSE stream (data: {json}\n\n … data: [DONE]) into the assistant text. Reads
// choices[0].delta.content (streamed) and reports finish_reason==="length" truncation. Tolerant
// fallback: if the body carries no SSE `data:` frames (a provider that ignored stream:true and
// returned one JSON), parse it whole and read choices[0].message.content.
export function accumulateSse(text) {
  let content = "";
  let truncated = false;
  let done = false;
  let sawData = false;
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    sawData = true;
    const payload = t.slice(5).trim();
    if (payload === "[DONE]") { done = true; continue; }
    let j;
    try { j = JSON.parse(payload); } catch { continue; }
    const choice = j?.choices?.[0];
    const piece = choice?.delta?.content ?? choice?.message?.content;
    if (typeof piece === "string") content += piece;
    if (choice?.finish_reason) { done = true; if (choice.finish_reason === "length") truncated = true; }
  }
  if (!sawData) {
    // non-streamed fallback: a single completion object
    try {
      const j = JSON.parse(String(text));
      const choice = j?.choices?.[0];
      if (typeof choice?.message?.content === "string") content = choice.message.content;
      if (choice?.finish_reason) { done = true; if (choice.finish_reason === "length") truncated = true; }
    } catch { /* leave content empty — caller treats empty as needs-human */ }
  }
  return { content, truncated, done };
}

// --- Anthropic (native /v1/messages) pure functions (FAFF-210) ---

// The anthropic-version header value the Messages API requires. Named constant with a temporal anchor:
// stable + documented, but re-verify against the Anthropic API docs if the header is ever rejected.
export const ANTHROPIC_VERSION = "2023-06-01";

// PURE: the /v1/messages payload. Distinct from the OpenAI shape: `system` is a TOP-LEVEL string (not a
// messages[0] entry), `max_tokens` is REQUIRED by the API (no default on the wire), and NO `temperature`
// is sent — current Claude reviewer models reject non-default sampling params under extended thinking with
// a 400 (→ EXIT.OTHER), and the review needs no specific temperature. maxTokens is the analogue of
// openai's max_tokens.
export function buildAnthropicPayload({ model, system, user, maxTokens = DEFAULT_NUM_PREDICT }) {
  if (!model) throw new Error("buildAnthropicPayload requires a model");
  return {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    stream: true,
  };
}

// PURE: fold Anthropic's named-event SSE into the assistant text. The stream is `event: <name>\n data:
// {json}\n\n` frames; we dispatch on each data payload's own `type` (the `event:` lines are redundant and
// ignored, exactly as accumulateSse ignores non-`data:` lines). Reads only text_delta (a thinking_delta is
// the model's hidden reasoning — dropped, we want only the answer). stop_reason==="max_tokens" on the late
// message_delta reports truncation. Tolerant fallback: if the body carries no `data:` frames (a backend
// that ignored stream:true and returned one Messages object), parse it whole and concatenate its
// content[] text blocks. Same {content, truncated, done} contract as accumulateSse.
export function accumulateAnthropic(text) {
  let content = "";
  let truncated = false;
  let done = false;
  let sawData = false;
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    sawData = true;
    const payload = t.slice(5).trim();
    let j;
    try { j = JSON.parse(payload); } catch { continue; }
    if (j?.type === "content_block_delta" && j?.delta?.type === "text_delta" && typeof j.delta.text === "string") {
      content += j.delta.text;
    } else if (j?.type === "message_delta") {
      done = true;
      if (j?.delta?.stop_reason === "max_tokens") truncated = true;
    } else if (j?.type === "message_stop") {
      done = true;
    }
  }
  if (!sawData) {
    // non-streamed fallback: a single Messages response { content: [{type:"text", text}], stop_reason }
    try {
      const j = JSON.parse(String(text));
      for (const block of j?.content ?? []) {
        if (block?.type === "text" && typeof block.text === "string") content += block.text;
      }
      if (j?.stop_reason) { done = true; if (j.stop_reason === "max_tokens") truncated = true; }
    } catch { /* leave content empty — caller treats empty as needs-human */ }
  }
  return { content, truncated, done };
}

// PURE: an HTTP 401/403 from a cloud provider means broken credentials, not infra — needs-human, no retry.
// FAFF-210: Google's OpenAI-compat layer (the gemini family) returns HTTP 400 API_KEY_INVALID for a
// malformed key, NOT 401/403 — so a 400 whose body carries an explicit invalid-key marker is also auth.
// The marker gate keeps this narrow: a generic 400 (bad request shape) has no marker and stays non-auth,
// so no other openai-family provider is affected. Depends on realGet/realStream carrying the body into
// the error message (both do). Direction is fail-safe: this only ever routes MORE to needs-human (exit 7),
// never fewer — it can never turn a real auth fault into a silent pass+skip (the no-silent-weakening invariant).
export function isAuthError(err) {
  const m = String(err && err.message);
  return /HTTP 40[13]/.test(m) || (/HTTP 400/.test(m) && /API_KEY_INVALID|api key not valid/i.test(m));
}

// PURE (FAFF-227; FAFF-942 removed 429): is this a *transient* transport fault that should be retried on
// the SAME endpoint? Mirrors isAuthError. TRUE for a genuinely transient condition — HTTP 5xx, a dropped
// socket (ECONNRESET/ETIMEDOUT/EPIPE or "socket hang up"), or a stream/preflight timeout, all of which the
// same request may clear after a backoff. FALSE for everything else, including HTTP 429: a rate-limited
// endpoint is not cleared by hitting it again — a same-endpoint retry only burns the deadline budget, so a
// 429 must ADVANCE the fallback chain to a different, un-throttled backend instead (see isRateLimited and
// the `rate-limited` status). FALSE for the other 4xx too (auth/usage/model-not-served/anything unknown):
// default-terminal, so the predicate never over-retries a real fault. Do NOT broaden to /HTTP 4\d\d/.
// realGet/realStream reject 5xx as `HTTP <status>: …` and surface socket faults with err.code, so both the
// message and (when present) the code are inspected.
export function isTransientTransport(err) {
  if (!err) return false;
  const msg = String(err.message || "");
  const code = String(err.code || "");
  return /HTTP 5\d\d/.test(msg)                       // 5xx server fault from a reject
    || ["ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(code)
    || /socket hang up/.test(msg)
    || /timed out/.test(msg);                          // realStream / preflight timeout text
}

// PURE (FAFF-942): is this an HTTP 429 rate-limit? A throttled endpoint is up but refusing this request;
// re-hitting it does not clear the limit. Kept OUT of isTransientTransport (no same-endpoint retry) and
// classified as the `rate-limited` status so it advances the fallback chain to a different backend, and so
// a purely-rate-limited exhausted chain surfaces EXIT.RATE_LIMITED — distinct from the genuine-outage
// UNREACHABLE/DEADLINE the dispatch-level retry re-runs.
export function isRateLimited(err) {
  return /HTTP 429/.test(String(err && err.message));
}

// FAFF-885: a first-byte (time-to-first-token) breach. Distinct from a transient stream timeout: it is
// keyed by the `firstByteBreach` MARKER PROPERTY (never message text), and its message deliberately
// EXCLUDES "timed out" so it can never be misread by isTransientTransport's /timed out/ arm.
export class FirstByteBreachError extends Error {
  constructor(message) { super(message); this.name = "FirstByteBreachError"; this.firstByteBreach = true; }
}

// PURE (FAFF-885): is this error a first-byte breach? Keys on the marker property, never the message —
// checked BEFORE isTransientTransport in streamWithTransportRetry so a breach fast-fails (no retry).
export function isFirstByteBreach(err) { return Boolean(err && err.firstByteBreach === true); }

// FAFF-885: wrap the injected streamFn in a first-byte deadline. When firstByteMs is not a number the
// wrapper is a PASS-THROUGH (no timer, opts absent) — byte-for-byte the pre-FAFF-885 call. Otherwise it
// arms a real timer and hands streamFn an { onFirstByte, signal } fifth argument: the first response byte
// disarms the timer (the stream then proceeds under the existing inactivity timeoutMs, unchanged); if the
// timer fires first it aborts the signal (tearing the real socket down) and rejects a FirstByteBreachError.
// opts is ALWAYS passed at the FIFTH positional slot — every caller (streamOnceOpenAi/streamOnceAnthropic)
// passes an explicit headers object so opts never collides with it. The timer is unref'd so it never
// keeps the process alive.
export function streamWithFirstByte(streamFn, url, body, timeoutMs, headers, firstByteMs) {
  // Pass-through unless a POSITIVE finite window is set (mirrors resolveFirstByteMs's <=0-disables
  // guard, and rejects a NaN a direct caller might pass — typeof NaN === "number" would else arm
  // setTimeout(NaN), an immediate breach).
  if (!Number.isFinite(firstByteMs) || firstByteMs <= 0) return streamFn(url, body, timeoutMs, headers);
  let firstByteSeen = false;
  let timer;
  const controller = new AbortController();
  const onFirstByte = () => { firstByteSeen = true; if (timer) { clearTimeout(timer); timer = undefined; } };
  const breach = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      if (!firstByteSeen) { controller.abort(); reject(new FirstByteBreachError(`no first byte within ${firstByteMs}ms`)); }
    }, firstByteMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  });
  const streamP = streamFn(url, body, timeoutMs, headers, { onFirstByte, signal: controller.signal });
  // The losing branch of the race can settle after the winner: swallow a post-breach streamFn rejection
  // (an aborted socket) so it never surfaces as an unhandledRejection, and always clear the timer.
  streamP.then(() => { if (timer) { clearTimeout(timer); timer = undefined; } }, () => { if (timer) { clearTimeout(timer); timer = undefined; } });
  return Promise.race([streamP, breach]);
}

// Bounded transport-retry policy (FAFF-227): named constants, not magic numbers. attempts counts the
// first try too (3 ⇒ 2 retries). Backoff before retry k (1-indexed) is base_ms * 2^(k-1), each *sleep*
// capped by the time remaining against the caller's --timeout deadline so a backoff never overruns budget.
// TIMEOUT BOUND (FAFF-228 — correction): --timeout bounds each individual stream attempt and the
// inter-retry sleeps, NOT the total wall-clock. Each streamOnce gets the full timeoutMs; the truncation
// retry adds a second streamOnce; this loop runs up to `attempts` (3) times — so worst-case total
// wall-clock is ~6× timeoutMs (3 attempts × 2 streamOnce) under stream + truncation + transport-retry
// composition. There is no overall deadline across attempts (a true cap is a deferred behavioural change).
export const TRANSPORT_RETRY = { attempts: 3, baseMs: 1500 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wrap a stream call (streamOnce + its truncation retry) in a bounded retry that fires solely on
// isTransientTransport. Terminal faults (auth/4xx/usage) throw straight out — unchanged. On exhaustion,
// or when no budget remains for the next backoff, returns a sentinel so the caller surfaces
// status "transport-failed" (→ main() maps it through unreachableExit, never the unmapped EXIT.OTHER).
async function streamWithTransportRetry(streamCall, { policy = TRANSPORT_RETRY, deadlineMs } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      return { ok: true, out: await streamCall() };
    } catch (e) {
      if (isFirstByteBreach(e)) { lastErr = e; break; }  // FAFF-885: fast-fail — no retry, surface transport-failed
      if (!isTransientTransport(e)) throw e;            // terminal → out immediately (auth handled by caller's catch)
      lastErr = e;
      if (attempt === policy.attempts) break;           // exhausted
      let delay = policy.baseMs * 2 ** (attempt - 1);
      if (typeof deadlineMs === "number") delay = Math.min(delay, deadlineMs - Date.now());
      if (delay <= 0) break;                            // no budget left to retry
      await sleep(delay);
    }
  }
  return { ok: false, error: lastErr };
}

// --- transport (real impls; injectable in runReview for tests) ---

function realGet(url, timeoutMs = 5000, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const r = lib.request(u, { method: "GET", headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300
        ? resolve(data)
        // FAFF-210: include the body (as realStream already does) so isAuthError can see a gemini
        // 400 API_KEY_INVALID at the preflight GET — without it that bad-key 400 would misroute to
        // unreachable/pass+skip and silently disable the gate.
        : reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`))));
    });
    r.on("error", reject);
    r.setTimeout(timeoutMs, () => r.destroy(new Error(`preflight timed out after ${timeoutMs}ms`)));
    r.end();
  });
}

// POST the payload and consume the streamed response, concatenating chunks as they arrive (the act of
// reading keeps the connection alive on a long generation). Returns the raw NDJSON text.
function realStream(url, body, timeoutMs = 580000, extraHeaders = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    let firstByte = true;                               // FAFF-885: fire opts.onFirstByte once, on the first body byte
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...extraHeaders };
    const r = lib.request(u, { method: "POST", headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        // FAFF-885: the FIRST body byte disarms the first-byte window. A buffering server that flushes
        // nothing until done never reaches here, so its window breaches and the chain fails over fast.
        if (firstByte) { firstByte = false; if (typeof opts.onFirstByte === "function") opts.onFirstByte(); }
        data += c;
      });
      res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300
        ? resolve(data)
        : reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`))));
    });
    r.on("error", reject);
    r.setTimeout(timeoutMs, () => r.destroy(new Error(`stream timed out after ${timeoutMs}ms`)));
    // FAFF-885: on a first-byte breach the wrapper aborts this signal → tear the socket down promptly
    // rather than leaving it to linger until the inactivity timeout above.
    if (opts.signal) {
      if (opts.signal.aborted) r.destroy(new Error("first-byte breach: aborted before send"));
      else opts.signal.addEventListener("abort", () => r.destroy(new Error("first-byte breach: socket torn down")), { once: true });
    }
    r.write(body);
    r.end();
  });
}

// OpenAI-compatible preflight: GET /v1/models with Bearer auth. unreachable (infra) and auth-failed
// (401/403 creds) are distinct from not-served (config fault).
export async function preflightOpenAi({ host, model, apiKey, getFn = realGet, timeoutMs = 5000 }) {
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  let body;
  try { body = await getFn(joinUrl(host, "/models"), timeoutMs, headers); }
  catch (e) {
    if (isAuthError(e)) return { authFailed: true, error: e.message };
    if (isRateLimited(e)) return { rateLimited: true, error: e.message };  // FAFF-942: advance the chain, don't retry the throttled host
    return { unreachable: true, error: e.message };
  }
  const { served, names } = modelServedOpenAi(body, model);
  return { unreachable: false, served, names };
}

async function streamOnceOpenAi({ host, model, system, user, numPredict, reasoningOff, reasoningEffort, reasoningExtra, apiKey, streamFn, timeoutMs, firstByteMs }) {
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const body = JSON.stringify(buildOpenAiPayload({ model, system, user, maxTokens: numPredict, reasoningOff, reasoningEffort, reasoningExtra }));
  const raw = await streamWithFirstByte(streamFn, joinUrl(host, "/chat/completions"), body, timeoutMs, headers, firstByteMs);  // FAFF-885
  return accumulateSse(raw);
}

// OpenAI-compatible orchestration: preflight → stream → one 2× truncation retry, with Bearer auth and
// an auth-failed branch (the same shape the deleted native ollama orchestration used, minus auth). The
// stream (+ truncation retry) is wrapped in the FAFF-227 bounded transport retry: a transient mid-stream
// fault retries; an auth fault is terminal (isTransientTransport is FALSE for 401/403, so the wrapper
// rethrows it into the auth catch); an exhausted transport fault surfaces status "transport-failed" → a
// documented exit, never EXIT.OTHER.
async function runReviewOpenAi({
  host, model, system, user, numPredict = DEFAULT_NUM_PREDICT, reasoningOff = false, reasoningEffort = null, reasoningExtra = null, apiKey,
  getFn = realGet, streamFn = realStream, timeoutMs, hardDeadlineMs, firstByteMs,
}) {
  const pf = await preflightOpenAi({ host, model, apiKey, getFn });
  if (pf.authFailed) return { status: "auth-failed", note: pf.error };
  if (pf.rateLimited) return { status: "rate-limited", note: pf.error };  // FAFF-942
  if (pf.unreachable) return { status: "unreachable", note: pf.error };
  if (!pf.served) return { status: "model-not-served", names: pf.names };

  // FAFF-329: re-clamp every attempt to the remaining total budget when hardDeadlineMs is set, so a single backend's retry composition can never overrun the total deadline. Unset ⇒ the per-attempt timeoutMs unchanged (byte-for-byte today; mirrored in runReviewAnthropic below).
  const perAttempt = () => (typeof hardDeadlineMs === "number"
    ? Math.max(1, Math.min(typeof timeoutMs === "number" ? timeoutMs : hardDeadlineMs - Date.now(), hardDeadlineMs - Date.now()))
    : timeoutMs);
  try {
    const streamCall = async () => {
      let out = await streamOnceOpenAi({ host, model, system, user, numPredict, reasoningOff, reasoningEffort, reasoningExtra, apiKey, streamFn, timeoutMs: perAttempt(), firstByteMs });
      if (out.truncated) {
        out = await streamOnceOpenAi({ host, model, system, user, numPredict: numPredict * 2, reasoningOff, reasoningEffort, reasoningExtra, apiKey, streamFn, timeoutMs: perAttempt(), firstByteMs });
      }
      return out;
    };
    const deadlineMs = typeof hardDeadlineMs === "number" ? hardDeadlineMs
      : (typeof timeoutMs === "number" ? Date.now() + timeoutMs : undefined);
    const r = await streamWithTransportRetry(streamCall, { deadlineMs });
    if (!r.ok) return { status: "transport-failed", note: r.error && r.error.message };
    return { status: "ok", content: r.out.content, truncated: r.out.truncated };
  } catch (e) {
    if (isAuthError(e)) return { status: "auth-failed", note: e.message };
    if (isRateLimited(e)) return { status: "rate-limited", note: e.message };  // FAFF-942: no same-endpoint retry — advance the chain
    throw e;
  }
}

async function streamOnceAnthropic({ host, model, system, user, numPredict, apiKey, streamFn, timeoutMs, firstByteMs }) {
  const headers = { "anthropic-version": ANTHROPIC_VERSION };
  if (apiKey) headers["x-api-key"] = apiKey;   // absent key ⇒ the API 401s → auth-failed (mirrors openai's Bearer)
  const body = JSON.stringify(buildAnthropicPayload({ model, system, user, maxTokens: numPredict }));
  const raw = await streamWithFirstByte(streamFn, joinUrl(host, "/v1/messages"), body, timeoutMs, headers, firstByteMs);  // FAFF-885
  return accumulateAnthropic(raw);
}

// Anthropic native orchestration (FAFF-210): mirrors the openai path (stream → one 2× truncation retry,
// wrapped in the same FAFF-227 bounded transport retry) with two differences. (1) NO preflight — Anthropic
// exposes no model-list endpoint used here, so a bad model id can't be caught up front; it surfaces as a
// 404/not_found on the first stream call and is classified in the catch → model-not-served (exit 4), the
// same needs-human class the other families' preflight not-served yields. (2) The catch also maps that 404.
// Auth (401/403) is terminal via isAuthError (isTransientTransport is FALSE for it, so the wrapper rethrows
// into this catch); an exhausted transient fault surfaces transport-failed → a documented exit, never EXIT.OTHER.
async function runReviewAnthropic({
  host, model, system, user, numPredict = DEFAULT_NUM_PREDICT, apiKey,
  getFn = realGet, streamFn = realStream, timeoutMs, hardDeadlineMs, firstByteMs,
}) {
  // FAFF-329: re-clamp every attempt to the remaining total budget (see runReviewOpenAi above for the full rationale).
  const perAttempt = () => (typeof hardDeadlineMs === "number"
    ? Math.max(1, Math.min(typeof timeoutMs === "number" ? timeoutMs : hardDeadlineMs - Date.now(), hardDeadlineMs - Date.now()))
    : timeoutMs);
  try {
    const streamCall = async () => {
      let out = await streamOnceAnthropic({ host, model, system, user, numPredict, apiKey, streamFn, timeoutMs: perAttempt(), firstByteMs });
      if (out.truncated) {
        out = await streamOnceAnthropic({ host, model, system, user, numPredict: numPredict * 2, apiKey, streamFn, timeoutMs: perAttempt(), firstByteMs });
      }
      return out;
    };
    const deadlineMs = typeof hardDeadlineMs === "number" ? hardDeadlineMs
      : (typeof timeoutMs === "number" ? Date.now() + timeoutMs : undefined);
    const r = await streamWithTransportRetry(streamCall, { deadlineMs });
    if (!r.ok) return { status: "transport-failed", note: r.error && r.error.message };
    return { status: "ok", content: r.out.content, truncated: r.out.truncated };
  } catch (e) {
    if (isAuthError(e)) return { status: "auth-failed", note: e.message };
    if (isRateLimited(e)) return { status: "rate-limited", note: e.message };  // FAFF-942: no same-endpoint retry — advance the chain
    const m = String(e && e.message);
    if (/HTTP 404/.test(m) || /not_found/i.test(m)) return { status: "model-not-served", note: e.message };
    throw e;
  }
}

// Dispatcher: routes on the configured provider's transport family. Default (no provider) is now
// "openai" (FAFF-872 — there is no longer a native ollama family to default to); ollama itself is an
// OpenAI-compatible alias, so it also dispatches here, never to a native path.
export async function runReview(opts = {}) {
  const fam = providerFamily(opts.provider);
  if (fam === "openai") return runReviewOpenAi(opts);
  if (fam === "anthropic") return runReviewAnthropic(opts);
  return { status: "unsupported-provider", note: `provider '${opts.provider}' has no transport in review-call.mjs (use an OpenAI-compatible base URL, or anthropic)` };
}

// --- CLI ---

export function parseArgs(argv) {
  // hostSource defaults to "config" so existing callers (which never pass --host-source) keep the
  // exit-5 pass+skip behaviour unchanged. "default" signals the host is only the localhost fallback.
  const a = { context: [], hostSource: "config" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--host") a.host = argv[++i];
    else if (k === "--model") a.model = argv[++i];
    else if (k === "--system") a.system = argv[++i];
    else if (k === "--diff") a.diff = argv[++i];
    else if (k === "--context") a.context.push(argv[++i]);
    else if (k === "--max-tokens") a.numPredict = Number(argv[++i]);
    else if (k === "--timeout") a.timeoutMs = Number(argv[++i]) * 1000;
    else if (k === "--deadline") a.totalDeadlineMs = Number(argv[++i]) * 1000;   // FAFF-329: TOTAL wall-clock ceiling across ALL attempts + fallback backends (distinct from --timeout, which bounds ONE stream attempt)
    else if (k === "--host-source") a.hostSource = argv[++i];
    else if (k === "--provider") a.provider = argv[++i];
    else if (k === "--api-key-env") a.apiKeyEnv = argv[++i];
    else if (k === "--reasoning-off") a.reasoningOff = true;
    else if (k === "--reasoning-effort") a.reasoningEffort = argv[++i];   // FAFF-873: low|medium|high|xhigh|max — clamped to the wire ceiling in buildOpenAiPayload
    else if (k === "--reasoning-extra") {   // FAFF-914: JSON object merged verbatim onto the OpenAI body (per-model reasoning-control passthrough) — e.g. '{"reasoning":{"enabled":false}}'
      const raw = argv[++i];
      try { a.reasoningExtra = JSON.parse(raw); }
      catch (e) { throw new Error(`--reasoning-extra: not valid JSON: ${e.message}`); }
    }
    else if (k === "--backends-json") a.backendsJson = argv[++i];   // FAFF-232: ordered fallback chain
    else if (k === "--lights-out") a.mandatory = true;   // FAFF-398: mark this review MANDATORY (L4) — a no-opinion chain exhaustion fails closed → needs-human
    else if (k === "--run-dir") a.runDir = argv[++i];   // FAFF-401: the run whose run-ledger.json derives mandatory-ness (level:"L4"); FAFF_RUN_DIR is the ambient fallback
    else if (k === "--max-payload-bytes") a.maxPayloadBytes = Number(argv[++i]);   // FAFF-445: oversized-diff preflight threshold override (test-only escape hatch; default DEFAULT_MAX_PAYLOAD_BYTES applies when absent)
    else if (k === "--context-trim-bytes") a.contextTrimBytes = Number(argv[++i]);   // FAFF-915: relevance-trim threshold override; 0 disables the trim (default DEFAULT_CONTEXT_TRIM_BYTES applies when absent)
    else if (k === "--first-byte-timeout") a.firstByteMs = Number(argv[++i]) * 1000;   // FAFF-885: per-attempt first-byte (TTFT) window override; 0 disables (pass-through)
    else if (k === "--expect") {   // FAFF-940: `--expect contract` opts into contract-output mode (skip the findings-shape gate; the consumer validates the block)
      const v = argv[++i];
      // Fail loud on any other value (mirrors --reasoning-extra / --backends-json): a silent coerce
      // to the default path would turn a one-character typo in the flag the judge dispatch is told to
      // pass into a silent park, indistinguishable from a dead judge backend.
      if (v !== "contract") throw new Error(`--expect: only "contract" is supported, got ${JSON.stringify(v)}`);
      a.expectContract = true;
    }
    else if (k === "--no-findings-shape") a.expectContract = true;   // FAFF-940: bare alias for --expect contract
    else if (k === "--raw-dir") a.rawDir = argv[++i];   // FAFF-928: retain each backend's raw response body under this dir (per lens × backend × round); absent ⇒ no capture (byte-for-byte today)
    else if (k === "--lens") a.lens = argv[++i];        // FAFF-928: lens name for the raw-body artifact filename + preamble
    else if (k === "--round") a.round = argv[++i];      // FAFF-928: spec-review round for the raw-body artifact filename + preamble
  }
  return a;
}

// PURE-ISH (FAFF-401): derive "is this review MANDATORY?" mechanically from the run ledger, so no LLM step
// sits between the resolved L4 level and the flag. Mirrors bin/faff's appetite resolver ("ledger brace":
// FAFF_RUN_DIR → run-ledger.json → level === "L4") — the same machine-written state, read a second time by
// deterministic code. Fail-safe direction: ANY resolution miss (absent runDir, missing/unreadable/garbled
// ledger, or a non-L4 level) returns false ⇒ advisory, byte-for-byte today's behaviour. It only ever ADDS
// mandatory-ness on positive L4 evidence; it never blocks an L1–L3 flow, and it never throws.
//
// Deliberately NO liveness/heartbeat check (unlike the appetite resolver's runIsHeld brace): here the derived
// direction REDUCES agency (mandatory ⇒ fail-closed ⇒ needs-human park), so a stale L4 ledger can only cause a
// visible false park, never a false merge — the staleness confound inverts, and replicating heartbeat math into
// a second file would add drift risk for no directional safety (spec §6).
export function ledgerMandatory(runDir) {
  if (!runDir) return false;
  let ledger;
  try { ledger = JSON.parse(readFileSync(pathJoin(runDir, "run-ledger.json"), "utf8")); }
  catch { return false; }   // missing file, unreadable, or garbled JSON — advisory
  return !!(ledger && ledger.level === "L4");
}

// PURE (FAFF-414): map a throw that escaped a family's orchestration function (runReviewOpenAi/
// Anthropic — a bad request shape, an oversized payload/413, or any other non-transient fault those
// functions don't already convert into a status) to a stable per-backend status string. Mirrors
// isAuthError so an escaped 401/403 still routes distinctly (defense-in-depth: each family already
// classifies its OWN auth faults internally and returns a status rather than throwing, so this branch is
// a backstop, not the primary path). Everything else is a generic non-transient REQUEST fault — a
// config/request problem, not an availability one — so it must never be confused with "unreachable" (a
// pass+skip class); it needs its own needs-human-class exit (mapResultExit below).
export function mapThrowStatus(err) {
  return isAuthError(err) ? "auth-failed" : "request-failed";
}

// PURE (FAFF-232): map a runReview() result + host provenance to the documented exit class for ONE backend.
// Extracted from main()'s old inline if-ladder so the single-backend path and runReviewChain map identically.
export function mapResultExit(result, hostSource) {
  switch (result && result.status) {
    case "ok": return EXIT.OK;
    case "unsupported-provider": return EXIT.USAGE;
    case "model-not-served": return EXIT.NOT_SERVED;
    case "auth-failed": return EXIT.AUTH;
    // FAFF-414: a non-transient throw that escaped a run function (see safeCall/mapThrowStatus) — reuse
    // USAGE(2), already a needs-human class (CHAIN_NEEDS_HUMAN below), rather than minting a new exit code.
    case "request-failed": return EXIT.USAGE;
    // FAFF-942: a rate-limited (HTTP 429) backend — an availability class distinct from unreachable, so an
    // all-429 exhausted chain is separable from a genuine-outage one (see chainTerminalExit) and is not
    // re-run by the dispatch-level retry (see judgeDispatchDisposition).
    case "rate-limited": return EXIT.RATE_LIMITED;
    case "unreachable":
    case "transport-failed": return unreachableExit({ hostSource });
    default: return EXIT.OTHER;
  }
}

// PURE (FAFF-232/FAFF-465): the terminal exit of an EXHAUSTED chain (no backend produced findings). A
// structural-inability class — USAGE(2)/NOT_SERVED(4)/DEFAULT_HOST_UNREACHABLE(6)/AUTH(7)/
// NO_FINDINGS_CONTENT(11, FAFF-465 — an empty body or a closed-grammar provider refusal), all of which
// the skill maps to needs-human — DOMINATES the availability/degradation class UNREACHABLE(5 → pass+skip;
// MALFORMED/10's substantive-garble is an availability symptom too and is NOT a member — a garble-only
// exhausted chain collapses to UNREACHABLE/5, never a needs-human terminal exit on its own). So a chain of
// purely configured-host availability/degradation failures still pass+skips exactly as a lone configured
// backend does today, but a structural fault ANYWHERE in a fully-failed chain surfaces needs-human (never
// masked by "all down" — the FAFF-213/228/194 no-silent-weakening invariant, now keyed on a STABLE
// response property rather than the incidental run-to-run failure-class mix). Returns the FIRST
// needs-human class in chain order; else UNREACHABLE(5). Empty list → 5 (no faults to surface).
export const CHAIN_NEEDS_HUMAN = new Set([EXIT.USAGE, EXIT.NOT_SERVED, EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.AUTH, EXIT.NO_FINDINGS_CONTENT]);
export function chainTerminalExit(failureClasses = []) {
  for (const c of failureClasses) if (CHAIN_NEEDS_HUMAN.has(c)) return c;
  // FAFF-942: a PURELY rate-limited exhausted chain (every non-needs-human fault was a 429) collapses to
  // RATE_LIMITED — a distinct availability class the dispatch-level retry does not re-run (re-hitting a
  // throttled chain does not clear the limit). A chain that mixes in ANY genuine availability fault
  // (unreachable/deadline/transport-failed/garble) stays UNREACHABLE, so a real transient blip still earns
  // its bounded dispatch retry. Empty list → UNREACHABLE unchanged (no faults to surface).
  const nonHuman = failureClasses.filter((c) => !CHAIN_NEEDS_HUMAN.has(c));
  if (nonHuman.length > 0 && nonHuman.every((c) => c === EXIT.RATE_LIMITED)) return EXIT.RATE_LIMITED;
  return EXIT.UNREACHABLE;
}

// PURE (FAFF-398): a MANDATORY review (an L4 lights-out run, where dialCoherence already REQUIRES the
// adversarial occupant) whose chain exhausted with only a "no-opinion" class — UNREACHABLE(5, all
// configured hosts down) or DEADLINE(8, budget hit before any findings) — must FAIL CLOSED: no second
// opinion was obtained and no human is watching, so map to MANDATORY_OUTAGE(9), which the skill reads as
// unavailable (FAFF-405 — park the PR). Structural-inability classes (2/4/6/7/11 — 11 added FAFF-465)
// already map to needs-human and pass through UNCHANGED — the remap must not upgrade or MASK a specific
// cause; NO_FINDINGS_CONTENT(11) is human-actionable, not a fail-closed outage, even at L4. Advisory reviews (mandatory=false,
// L1–L3) are byte-for-byte unchanged. Applied ONCE at main()'s single caller boundary on runReviewChain's
// terminal exit, so every exhaustion path (all three deadline returns + the chain-exhausted return) is
// covered by construction — runReviewChain itself never learns "mandatory" (stays level-agnostic).
export function mandatoryRemap(exit, mandatory) {
  if (!mandatory) return exit;
  // FAFF-942: an all-429 chain (RATE_LIMITED) is a no-opinion outage for a mandatory review exactly as
  // UNREACHABLE/DEADLINE are — no second opinion was obtained — so it fails closed to MANDATORY_OUTAGE too.
  if (exit === EXIT.UNREACHABLE || exit === EXIT.DEADLINE || exit === EXIT.RATE_LIMITED) return EXIT.MANDATORY_OUTAGE;
  return exit;
}

// PURE (FAFF-941): the spec-review JUDGE dispatch's in-turn disposition for a review-call terminal
// exit — one of "ruling" (an OK result to validate), "retry" (a transient no-opinion outage: the
// faff-prep dispatch re-dispatches up to the bounded limit before parking), or "park" (a config
// fault, a garbled ruling, or an empty result — a human call a retry never rescues). The retry class
// is UNREACHABLE(5 — all configured judge hosts down) and DEADLINE(8 — the judge budget hit before any
// ruling): the swing-capable, infra-configured outage the spec-review outage disposition already rides out
// one altitude up, so a single blip in a would-be-park pass no longer escalates it to needs-human.
// RATE_LIMITED(12 — an all-429 chain, FAFF-942) is deliberately NOT in the retry set: re-dispatching a
// throttled chain does not clear the limit, so it PARKS directly (the next drain, not an in-turn re-run,
// is the recovery path). Every needs-human/config-fault class (CHAIN_NEEDS_HUMAN = 2/4/6/7/11), OTHER(1),
// and a garbled ruling (MALFORMED/10) PARK directly — a broken backend or a garbled verdict is not a
// transient blip. MANDATORY_OUTAGE(9) never arises (the judge is never a --lights-out mandatory review)
// and is classified park for completeness. Total over the whole EXIT taxonomy — the faff-prep dispatch
// reads this, never an ad-hoc per-exit branch.
export const JUDGE_RETRY_OUTAGE_EXITS = new Set([EXIT.UNREACHABLE, EXIT.DEADLINE]);
export function judgeDispatchDisposition(exit) {
  if (exit === EXIT.OK) return "ruling";
  if (JUDGE_RETRY_OUTAGE_EXITS.has(exit)) return "retry";
  return "park";
}

// PURE (FAFF-617): advisory, non-gating config check surfaced once before the chain runs. The per-backend
// slice (runReviewChain) makes a bad timeout/deadline combination NON-FATAL — fail-over still happens — but
// a per-backend `timeout` set so high that no single backend can finish its full retry composition inside
// its slice still silently TRUNCATES that backend's retries, a real misconfiguration the operator should
// SEE. Returns a (possibly empty) list of human-readable warning strings; never throws, never gates, never
// changes an exit code (main() writes them to stderr, that is all). `multiplier` is the ~6× worst-case
// wall-clock factor (TRANSPORT_RETRY.attempts=3 × 2 streamOnce) between one `--timeout` and one backend's
// worst-case wall-clock — if that composition changes, this default should track it.
export function budgetWarnings(chain = [], totalDeadlineMs, multiplier = 6) {
  if (typeof totalDeadlineMs !== "number") return [];   // unbounded ⇒ no per-backend budget to compare against
  const n = Array.isArray(chain) ? chain.length : 0;
  if (n === 0) return [];
  const perBackendBudget = totalDeadlineMs / n;
  const out = [];
  for (const b of chain) {
    const t = b && b.timeoutMs;
    if (typeof t !== "number") continue;                // a backend with no explicit timeout can't be judged
    if (t * multiplier >= perBackendBudget) {
      const tag = `${(b && b.provider) || "openai"}/${(b && b.model) || "?"}`;
      out.push(
        `budget: backend ${tag}: timeout ${Math.round(t / 1000)}s × ~${multiplier} worst-case ` +
        `(~${Math.round((t * multiplier) / 1000)}s) >= per-backend budget ${Math.round(perBackendBudget / 1000)}s ` +
        `(deadline ${Math.round(totalDeadlineMs / 1000)}s / ${n} backends) — retries/truncation may be cut short; ` +
        `lower this backend's timeout or raise --deadline`,
      );
    }
  }
  return out;
}

// FAFF-361: maps a per-backend runReview() result `status` to the short cause token the reshaped
// `[chain] <tag> <reason> → advancing` note names. Falls back to the raw status string for anything
// unlisted (e.g. "unsupported-provider") so an unrecognised status still logs something greppable
// rather than silently dropping the reason.
const CHAIN_ADVANCE_REASON = {
  unreachable: "unreachable",
  "transport-failed": "transport-failed",
  "model-not-served": "not-served",
  "auth-failed": "auth",
};

// Non-rejecting wrapper around a per-backend callReview() invocation (FAFF-414). The per-family
// orchestration functions (runReviewOpenAi/Anthropic) are BYTE-UNCHANGED — they still throw
// straight out on a non-transient, non-auth error (a bad request shape, an oversized payload/413, etc.);
// the catch lives ONLY here, at the chain boundary, OUTSIDE streamWithTransportRetry (which already owns
// the transient-retry catch). A throw that escapes a run function is exactly as informative as any other
// per-backend fault the chain already advances past (unreachable / auth-failed / model-not-served /
// transport-failed) — so it must never abort the WHOLE review at the unmapped EXIT.OTHER; it resolves to
// a status-shaped result the loop below treats identically to a returned status.
async function safeCall(callFn) {
  try {
    return await callFn();
  } catch (err) {
    // Adversarial review (FAFF-414): every throw site in THIS file only ever throws `new Error(...)`, so
    // `err.message` always exists in practice — but a non-Error throw (`throw "x"` / `throw null`) must
    // still surface SOMETHING in the log, not a lost/empty note (the needs-human signal is only actionable
    // if the human can see what actually failed). `err instanceof Error` covers every real case; the
    // String() fallback is a defensive backstop for a value that isn't.
    const note = err instanceof Error ? err.message : String(err);
    return { status: mapThrowStatus(err), note };
  }
}

// FAFF-232: run an ORDERED chain of backends, returning the first that produces findings. A backend that
// does not (any non-OK class) is recorded and the chain ADVANCES — the value is a real second opinion from
// SOMEONE, so a per-backend fault never sinks the chain if a healthy fallback exists. Only when every
// backend has failed is one terminal exit computed (chainTerminalExit). A 1-element chain reproduces the
// single-backend path exactly (one runReviewFn call, same exit), so back-compat is structural, not bolted on.
//
// chain element: { provider, model, host, hostSource, apiKey?, apiKeyEnv?, apiKeyMissing?, reasoningOff?, timeoutMs? }
// shared:        { system, user, numPredict, runReviewFn?, getFn?, streamFn?, log? }
// returns:       { exit, content?, truncated?, winner?, winnerIndex?, failureClasses }
//
// FAFF-361: every per-skipped-backend log line below is reshaped to the greppable
// `[chain] <provider>/<model> <reason> → advancing (exit <n>)` form ONLY when the chain is actually
// ADVANCING (verb === "advancing", i.e. a fallback remains) — a clean stdout must never hide which
// elements failed. The terminal ("exhausted", last backend, no fallback left) log line is deliberately
// UNCHANGED — reshaping it is out of scope (the design spec §2: "Restructuring the existing
// exhausted/success stderr log lines").
// FAFF-928 — retained raw adversarial-review response bodies (per lens × backend × round).
// The chain discards every backend's raw bytes the moment it classifies them, so a misclassification
// can never be inspected after the fact and there is no corpus to calibrate the classifier against.
// These helpers persist each backend's raw body (or a metadata stub for a no-body failure) to a
// bounded, self-describing artifact, keyed on the SAME provenance fields FAFF-361's attribution header
// carries. Capture is a pure add-on gated entirely on shared.rawDir, so an absent flag is byte-for-today.

// The injectable write path (mirrors getFn/streamFn/checkFn): real mkdir -p + writeFile, so CI writes
// nothing to disk unless a test injects its own writeFn.
export function realWrite(filePath, content) {
  mkdirSync(pathDirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

// PURE: filename-safe a path segment (provider/model/lens can carry "/" and other unsafe chars).
function sanitizeSegment(s) {
  return String(s == null ? "" : s).replace(/[^A-Za-z0-9._-]/g, "-") || "unknown";
}

// PURE (FAFF-928): the per-backend outcome token that names the artifact — derived from the runReview
// RESULT alone, so it is computed at the single capture site AHEAD of the classification branch (and so
// composes with FAFF-927, which re-partitions that branch, in either merge order). For an OK result it
// reuses the SAME primitives the classification branch keys off (validateFindingsShape /
// normaliseCleanRefutation on the raw content), so the token matches the outcome the loop would record.
// A null `result` (a pre-dispatch config/deadline stub) is handled by the callers, never here.
export function classifyCapturedResult(result, hostSource, expectContract) {
  const status = result && result.status;
  if (status === "ok") {
    const content = (result && result.content) || "";
    if (expectContract) {
      return content.trim() ? { token: "contract", exit: EXIT.OK } : { token: "empty", exit: EXIT.NO_FINDINGS_CONTENT };
    }
    if (!content.trim()) return { token: "empty", exit: EXIT.NO_FINDINGS_CONTENT };
    const shape = validateFindingsShape(content);
    if (shape.ok) return { token: "findings", exit: EXIT.OK };
    const normalisation = normaliseCleanRefutation(content);
    if (normalisation.normalised) return { token: "clean", exit: EXIT.OK };
    if (shape.kind === "empty") return { token: "empty", exit: EXIT.NO_FINDINGS_CONTENT };
    if (shape.kind === "refusal") return { token: "refusal", exit: EXIT.NO_FINDINGS_CONTENT };
    return { token: "malformed", exit: EXIT.MALFORMED };
  }
  const exit = mapResultExit(result, hostSource);
  const byStatus = {
    unreachable: "unreachable", "transport-failed": "transport-failed", "auth-failed": "auth",
    "rate-limited": "rate-limited", "model-not-served": "not-served", "request-failed": "request-failed",
    "unsupported-provider": "unsupported-provider",
  };
  return { token: byStatus[status] || status || "failed", exit };
}

// The one side-effecting capture call. No-op unless shared.rawDir is set — so an absent --raw-dir writes
// NOTHING and never touches writeFn (the byte-for-byte-today invariant). Writes one file per lens ×
// backend × round: a self-describing metadata preamble then the raw body, byte-capped at
// RAW_BODY_MAX_BYTES with an explicit truncation marker. `result` may be null for a no-body stub.
export function captureRawResponseBody(shared, { chainIndex, backend, result, token, exit }) {
  if (!shared || !shared.rawDir) return;
  const writeFn = shared.writeFn || realWrite;
  const b = backend || {};
  const lens = shared.lens || "lens";
  const round = shared.round == null ? "0" : String(shared.round);
  const provider = b.provider || "openai";
  const model = b.model || "unknown";
  const hostSource = b.hostSource || "config";
  const content = (result && result.content) || "";
  const byteLength = Buffer.byteLength(content, "utf8");
  const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
  let body = content;
  let truncated = false;
  if (byteLength > RAW_BODY_MAX_BYTES) {
    body = Buffer.from(content, "utf8").subarray(0, RAW_BODY_MAX_BYTES).toString("utf8")
      + `\n…[truncated ${byteLength - RAW_BODY_MAX_BYTES} bytes]`;
    truncated = true;
  }
  const fname = `round-${sanitizeSegment(round)}.${sanitizeSegment(lens)}.${chainIndex}-${sanitizeSegment(provider)}-${sanitizeSegment(model)}.${sanitizeSegment(token)}.txt`;
  const preamble = [
    "# faff-raw-adversarial-body (FAFF-928)",
    `# lens: ${lens}`,
    `# round: ${round}`,
    `# provider: ${provider}`,
    `# model: ${model}`,
    `# chain_index: ${chainIndex}`,
    `# host_source: ${hostSource}`,
    `# classification: ${token}`,
    `# exit: ${exit}`,
    `# truncated: ${truncated}`,
    `# byte_length: ${byteLength}`,
    `# sha256: ${sha256}`,
    "# ---",
    "",
  ].join("\n");
  try {
    writeFn(pathJoin(shared.rawDir, fname), preamble + body);
  } catch (e) {
    const log = shared.log || ((m) => process.stderr.write(m + "\n"));
    log(`[raw-capture] FAFF-928: failed to write ${fname}: ${e && e.message}`);
  }
}

export async function runReviewChain(chain = [], shared = {}) {
  const runReviewFn = shared.runReviewFn || runReview;
  const log = shared.log || ((m) => process.stderr.write(m + "\n"));
  const now = shared.nowFn || (() => Date.now());   // FAFF-329: injectable clock for deterministic deadline tests
  const totalDeadlineMs = shared.totalDeadlineMs;   // FAFF-329: total wall-clock budget across ALL backends (undefined ⇒ no bound, byte-for-byte today)
  const start = now();
  const n = chain.length;
  const failureClasses = [];
  for (let i = 0; i < n; i++) {
    // FAFF-329 deadline gate — checked at the TOP of the loop so no NEW backend starts past the budget.
    // On a hit: a needs-human-class fault seen on an earlier backend DOMINATES (no-silent-weakening); else
    // DEADLINE(8) → pass+skip. This is the prevention half — it caps the ~6×timeout×backends blowup.
    if (typeof totalDeadlineMs === "number" && now() - start >= totalDeadlineMs) {
      const nh = failureClasses.find((c) => CHAIN_NEEDS_HUMAN.has(c));
      const exit = nh != null ? nh : EXIT.DEADLINE;
      log(`deadline: Phase-2 total wall-clock budget ${Math.round(totalDeadlineMs / 1000)}s exceeded after ${i} backend(s) (exit ${exit})`);
      return { exit, deadlineExceeded: true, failureClasses };
    }
    const b = chain[i] || {};
    const tag = `${b.provider || "openai"}/${b.model || "?"}`;
    const verb = i === n - 1 ? "exhausted" : "advancing";
    // A backend missing model or host is a per-element config fault (USAGE) — advance, never abort the chain.
    // provider is optional (omitted ⇒ openai, via runReview/providerFamily — FAFF-872), preserving the
    // legacy single-backend path where callers never passed --provider.
    if (!b.model || !b.host) {
      failureClasses.push(EXIT.USAGE);
      if (shared.rawDir) captureRawResponseBody(shared, { chainIndex: i, backend: b, result: null, token: "invalid", exit: EXIT.USAGE });   // FAFF-928: no-body stub — the record of this round stays complete
      log(verb === "advancing"
        ? `[chain] ${tag} invalid (missing model/host) → advancing (exit ${EXIT.USAGE})`
        : `${verb}: backend ${i + 1}/${n} invalid (missing model/host) (exit ${EXIT.USAGE})`);
      continue;
    }
    // A declared-but-unset api key env is that backend's auth fault — no point calling, advance.
    if (b.apiKeyMissing) {
      failureClasses.push(EXIT.AUTH);
      if (shared.rawDir) captureRawResponseBody(shared, { chainIndex: i, backend: b, result: null, token: "auth", exit: EXIT.AUTH });   // FAFF-928: no-body stub (the FAFF-927 unset-key first-backend case)
      log(verb === "advancing"
        ? `[chain] ${tag} unset-key (env '${b.apiKeyEnv}') → advancing (exit ${EXIT.AUTH})`
        : `${verb}: ${tag} api key env '${b.apiKeyEnv}' unset (exit ${EXIT.AUTH})`);
      continue;
    }
    // FAFF-617: PER-BACKEND SLICE. The whole chain shares one total budget (totalDeadlineMs), but each
    // backend is granted only an EQUAL SHARE of what REMAINS — divided by how many backends are still to
    // try (this one plus the untried ones, n - i) — so a hung/slow backend is abandoned at its slice and
    // the healthy fallbacks still fit inside the deadline (the fail-over the chain exists for). The
    // division is recomputed each iteration, so it is WORK-CONSERVING: a fast-failing backend hands its
    // unspent budget back to be re-divided among the survivors. Edge cases fall out of the formula with no
    // special case: n=1, and the last backend (i = n-1), both have backendsLeft=1 ⇒ slice == remaining
    // (byte-for-byte the pre-slice single-backend / final-attempt path); no totalDeadlineMs ⇒ no slice is
    // computed and backendDeadline stays undefined (unbounded, byte-for-byte today).
    let backendDeadline;   // absolute per-backend deadline (undefined ⇒ unbounded)
    let sliceMs;
    if (typeof totalDeadlineMs === "number") {
      const remaining = totalDeadlineMs - (now() - start);
      sliceMs = Math.floor(remaining / (n - i));
      // Slice underflow — no meaningful window left. Route EXACTLY as the top-of-loop total-budget gate
      // (return; a needs-human-class fault seen earlier dominates, else DEADLINE) — never dispatch a
      // zero-window backend that would instantly time out.
      if (remaining <= 0 || sliceMs <= 0) {
        const nh = failureClasses.find((c) => CHAIN_NEEDS_HUMAN.has(c));
        return { exit: nh != null ? nh : EXIT.DEADLINE, deadlineExceeded: true, failureClasses };
      }
      backendDeadline = now() + sliceMs;
    }
    // The backend is handed backendDeadline as its hardDeadlineMs; the per-family perAttempt clamp then
    // bounds every attempt to min(timeoutMs, backendDeadline - now) FOR FREE — so an over-large configured
    // timeout is clamped to the slice with no rewrite of the configured value (see the anti-pattern note).
    const callReview = () => runReviewFn({
      host: b.host, model: b.model, provider: b.provider,
      system: shared.system, user: shared.user, numPredict: shared.numPredict,
      reasoningOff: b.reasoningOff, reasoningEffort: b.reasoningEffort, reasoningExtra: b.reasoningExtra, apiKey: b.apiKey, timeoutMs: b.timeoutMs,
      hardDeadlineMs: backendDeadline,   // FAFF-617: the per-backend SLICE, not the shared start+total deadline
      firstByteMs: b.firstByteMs,        // FAFF-885: per-attempt first-byte window (per-backend; undefined ⇒ pass-through)
      getFn: shared.getFn, streamFn: shared.streamFn,
    });
    let result;
    if (typeof totalDeadlineMs === "number") {
      // Race the backend against ITS SLICE (not the full remaining budget). On a slice win the in-flight
      // backend is ABANDONED (its socket carries the perAttempt idle timeout, so it self-closes shortly;
      // the timer is unref'd so it never keeps the process alive).
      const SENTINEL = { __deadline: true };
      let timer;
      const deadlineP = new Promise((res) => { timer = setTimeout(() => res(SENTINEL), sliceMs); if (timer && timer.unref) timer.unref(); });
      result = await Promise.race([safeCall(callReview), deadlineP]);
      clearTimeout(timer);
      if (result === SENTINEL) {
        // FAFF-617: this backend used its whole SLICE — NOT the whole deadline. Record a DEADLINE-class
        // failure and ADVANCE while untried backends remain (the behavioural inversion from FAFF-329, where
        // the mid-call race WAS the whole-deadline race and firing it terminated the chain). Terminate at
        // EXIT.DEADLINE only on the LAST backend (chain exhausted); every earlier slice expiry advances, so
        // a hung primary loses its slice, not the fallbacks' windows. A needs-human-class fault seen on an
        // earlier backend still dominates the terminal exit (no-silent-weakening). Chain termination at
        // EXIT.DEADLINE thus still occurs ONLY via the top-of-loop total-budget gate or this last-backend
        // exhaustion — never mid-chain.
        failureClasses.push(EXIT.DEADLINE);
        if (shared.rawDir) captureRawResponseBody(shared, { chainIndex: i, backend: b, result: null, token: "deadline", exit: EXIT.DEADLINE });   // FAFF-928: dispatched-then-abandoned backend — no-body stub
        log(verb === "advancing"
          ? `[chain] ${tag} slice ${Math.round(sliceMs / 1000)}s exhausted → advancing (exit ${EXIT.DEADLINE})`
          : `deadline: Phase-2 backend ${tag} exhausted its ${Math.round(sliceMs / 1000)}s slice, chain exhausted (exit ${EXIT.DEADLINE})`);
        if (i < n - 1) continue;
        const nh = failureClasses.find((c) => CHAIN_NEEDS_HUMAN.has(c));
        return { exit: nh != null ? nh : EXIT.DEADLINE, deadlineExceeded: true, failureClasses };
      }
    } else {
      result = await safeCall(callReview);
    }
    const exit = mapResultExit(result, b.hostSource);
    // FAFF-928: retain this backend's raw body BEFORE/independently of the classification branch below,
    // so retention never depends on which class it lands in (and composes with FAFF-927 re-partitioning
    // that branch). Gated on rawDir so an absent flag is byte-for-byte today.
    if (shared.rawDir) {
      const cap = classifyCapturedResult(result, b.hostSource, shared.expectContract);
      captureRawResponseBody(shared, { chainIndex: i, backend: b, result, token: cap.token, exit: cap.exit });
    }
    if (exit === EXIT.OK) {
      // FAFF-194/FAFF-465: per-backend shape validation — a non-findings-shaped OK result advances to the
      // next backend rather than short-circuiting the whole chain, so a healthy fallback still gets a
      // chance (mirrors every other per-backend fault class). The `kind` FAFF-465 added maps to one of two
      // exit classes: empty/refusal (a structural inability) → NO_FINDINGS_CONTENT(11); garbled (a
      // reachable-but-degraded symptom) → MALFORMED(10) — the split the terminal CHAIN_NEEDS_HUMAN
      // membership above keys on. The "malformed" log label is retained for the garbled kind only (the
      // pre-existing greppable wording); empty/refusal log their own kind.
      // FAFF-806: `shape` (hence `kind`) is derived from the RAW `originalContent`, never from
      // `normalisation.content` — this is what makes the `kind` discriminator a pure function of the
      // backend's returned bytes, independent of whether normalisation succeeded (the FAFF-465 invariant).
      // The non-findings `continue` below is gated on `!shape.ok && !normalisation.normalised` so a
      // successfully-normalised clean refutation (raw bytes fail shape, but normalisation accepts it) still
      // takes the accepted path with the canonical token — preserving FAFF-746 acceptance.
      const originalContent = result.content || "";
      // FAFF-940: contract-output mode. A consumer that expects a contract block (e.g. the spec-review
      // judge's `faff-contract:spec-judge-verdict`, which is JSON, not `### <severity>:`-shaped) opts out
      // of the findings-shape/clean-refutation gate and validates the block itself downstream. The
      // fallback-chain semantics are otherwise unchanged: a non-empty OK result is accepted verbatim, but
      // an empty/whitespace result still ADVANCES (a dead backend never short-circuits the chain). The
      // default (refuter) path below is untouched — `shared.expectContract` is falsy unless set.
      if (shared.expectContract) {
        if (!originalContent.trim()) {
          failureClasses.push(EXIT.NO_FINDINGS_CONTENT);
          log(verb === "advancing"
            ? `[chain] ${tag} empty (contract mode: empty content) → advancing (exit ${EXIT.NO_FINDINGS_CONTENT})`
            : `${verb}: ${tag} produced empty output (contract mode) (exit ${EXIT.NO_FINDINGS_CONTENT})`);
          continue;
        }
        if (i > 0) log(`backend ${i + 1}/${n} ${tag} produced contract output (after ${i} skipped)`);
        return { exit: EXIT.OK, content: originalContent, truncated: !!result.truncated, winner: b, winnerIndex: i, failureClasses };
      }
      const shape = validateFindingsShape(originalContent);
      const normalisation = normaliseCleanRefutation(originalContent);
      if (!shape.ok && !normalisation.normalised) {
        const cls = (shape.kind === "empty" || shape.kind === "refusal") ? EXIT.NO_FINDINGS_CONTENT : EXIT.MALFORMED;
        const label = shape.kind === "garbled" ? "malformed" : shape.kind;
        failureClasses.push(cls);
        log(verb === "advancing"
          ? `[chain] ${tag} ${label} (${shape.reason}) → advancing (exit ${cls})`
          : `${verb}: ${tag} produced non-findings output (${shape.reason}) (exit ${cls})`);
        continue;
      }
      if (normalisation.normalised) {
        const responseSha256 = createHash("sha256").update(originalContent, "utf8").digest("hex");
        log(`normalized: clean refutation backend=${tag} lens=${normalisation.lens} form=${normalisation.form} response_sha256=${responseSha256}`);
      }
      if (i > 0) log(`backend ${i + 1}/${n} ${tag} produced findings (after ${i} skipped)`);
      return { exit: EXIT.OK, content: normalisation.content, truncated: !!result.truncated, winner: b, winnerIndex: i, failureClasses };
    }
    failureClasses.push(exit);
    const detail = (result && result.note) || (result && result.names ? `available: ${result.names.join(", ")}` : "");
    log(verb === "advancing"
      ? `[chain] ${tag} ${(result && CHAIN_ADVANCE_REASON[result.status]) || (result && result.status) || "failed"}${detail ? ` (${detail})` : ""} → advancing (exit ${exit})`
      : `${verb}: ${tag} failed (${result && result.status}${detail ? ": " + detail : ""}) (exit ${exit})`);
  }
  return { exit: chainTerminalExit(failureClasses), failureClasses };
}

// `runReviewFn` is injectable so the CLI exit-mapping (notably the FAFF-227 transport-failed → 5/6 path)
// is unit-testable with a stubbed orchestration result; it defaults to the real runReview for the CLI.
// `checkFn` (FAFF-194) is injectable exactly the same way for the refutation pass's node --check calls,
// so CI spawns nothing unless a test opts in; it defaults to the real realCheck for the CLI.
// FAFF-885: resolve the per-attempt first-byte (TTFT) window (ms) at the CLI boundary. Precedence:
// per-backend first_byte_timeout (seconds) > the --first-byte-timeout flag > DEFAULT_FIRST_BYTE_MS
// (DEFAULT-ON). A resolved value <= 0 disables the window (pass-through) — the explicit opt-out. Applied
// only here, so a direct runReview*/runReviewChain call with no firstByteMs stays byte-for-byte today.
function resolveFirstByteMs(perBackendSeconds, flagMs) {
  let ms;
  if (perBackendSeconds != null) ms = Number(perBackendSeconds) * 1000;
  else if (typeof flagMs === "number") ms = flagMs;
  else ms = DEFAULT_FIRST_BYTE_MS;
  return (Number.isFinite(ms) && ms > 0) ? ms : undefined;
}

export async function main(argv, { runReviewFn = runReview, checkFn = realCheck } = {}) {
  const a = parseArgs(argv);
  if (!a.system || !a.diff) {
    process.stderr.write("usage: review-call.mjs (--host H --model M | --backends-json FILE) --system FILE --diff FILE [--context FILE]... [--max-tokens N] [--timeout S] [--deadline S] [--host-source config|default] [--provider P] [--api-key-env VAR] [--reasoning-off] [--reasoning-effort E] [--reasoning-extra JSON] [--max-payload-bytes N] [--expect contract] [--raw-dir DIR --lens NAME --round N]\n");
    return EXIT.USAGE;
  }

  // Build the ordered chain (FAFF-232). --backends-json is the COMPLETE chain (a JSON array of backend
  // objects, the skill assembles it from primary scalars + the fallbacks JSON-string); when absent the
  // legacy single-backend flags form a 1-element chain that reproduces the old path byte-for-byte.
  // --backends-json wins when both are present.
  let chain;
  if (a.backendsJson) {
    let raw;
    try { raw = JSON.parse(readFileSync(a.backendsJson, "utf8")); }
    catch (e) { process.stderr.write(`--backends-json: cannot read/parse ${a.backendsJson}: ${e.message}\n`); return EXIT.USAGE; }
    if (!Array.isArray(raw) || raw.length === 0) {
      process.stderr.write("--backends-json must be a non-empty JSON array of backends\n");
      return EXIT.USAGE;
    }
    chain = raw.map((b) => ({
      provider: b.provider, model: b.model, host: b.host,
      hostSource: "config",   // host_source is DERIVED, not authored: every listed backend is explicitly
                              // configured, so it is always "config" (→ unreachable maps to 5/pass+skip,
                              // never 6). The unconfigured-localhost-default (6) only arises in the legacy
                              // single-backend path below, never inside an explicit chain.
      apiKeyEnv: b.api_key_env || b.apiKeyEnv,
      auth: b.auth,                                   // FAFF-481: carried so a subscription-seat resolves its handle
      seatTokenEnv: b.seat_token_env || b.seatTokenEnv,
      reasoningOff: b.reasoning_off ?? b.reasoningOff ?? false,
      reasoningEffort: b.reasoning_effort ?? b.reasoningEffort,   // FAFF-873: snake_case (config) tolerated alongside camelCase, matching reasoning_off
      reasoningExtra: b.reasoning_extra ?? b.reasoningExtra ?? null,   // FAFF-914: per-model reasoning-control passthrough (snake_case config / camelCase tolerated)
      timeoutMs: (b.timeout != null) ? Number(b.timeout) * 1000 : a.timeoutMs,
      firstByteMs: resolveFirstByteMs(b.first_byte_timeout ?? b.firstByteTimeout, a.firstByteMs),   // FAFF-885
    }));
  } else {
    if (!a.host || !a.model) {
      process.stderr.write("usage: review-call.mjs --host H --model M ... (or --backends-json FILE)\n");
      return EXIT.USAGE;
    }
    chain = [{
      provider: a.provider, model: a.model, host: a.host, hostSource: a.hostSource,
      apiKeyEnv: a.apiKeyEnv, reasoningOff: a.reasoningOff, reasoningEffort: a.reasoningEffort, reasoningExtra: a.reasoningExtra, timeoutMs: a.timeoutMs,
      firstByteMs: resolveFirstByteMs(undefined, a.firstByteMs),   // FAFF-885
    }];
  }

  // Resolve each backend's token from its NAMED env var (never the key on the command line / in config).
  // An unset env for a declared handle is flagged per-backend (a class-7 fault that ADVANCES) rather than a
  // whole-run abort — so a misconfigured primary falls through to a healthy fallback.
  //
  // FAFF-481: which env var holds the token follows backends.js `resolveTokenSource` (mirrored here — this
  // is a standalone .mjs with no faff CommonJS imports): auth: api-key → api_key_env; auth: subscription-seat
  // → seat_token_env (the headless seat handle — a spawned review subprocess has no ambient session, so a
  // handle-LESS seat resolves no token and fails auth-failed, correctly). The resolved token is sent as
  // Bearer (openai) or x-api-key (the FAFF-210 anthropic adaptor) downstream — one field, either header shape.
  // A legacy chain entry with no `auth` field falls back to api_key_env — byte-for-byte today.
  for (const b of chain) {
    const tokenEnv = (b.auth === "subscription-seat") ? b.seatTokenEnv
      : (b.auth === "api-key") ? b.apiKeyEnv
      : (b.apiKeyEnv || null);   // legacy / unspecified auth → api_key_env, unchanged
    if (tokenEnv) {
      b.apiKey = process.env[tokenEnv];
      if (!b.apiKey) b.apiKeyMissing = true;
    }
  }

  const system = readFileSync(a.system, "utf8");
  const diff = readFileSync(a.diff, "utf8");
  const contextFilesRaw = a.context.map((p) => ({ path: p, text: readFileSync(p, "utf8") }));
  if (!system.trim() || !diff.trim()) {
    process.stderr.write("review inputs must contain a non-empty system prompt and diff\n");
    return EXIT.USAGE;
  }
  // FAFF-915: trim the context bundle to the diff-relevant regions before assembly. A no-op below the
  // byte threshold (byte-identical to today) and when --context-trim-bytes is 0. Only the winning
  // backend's content is affected via the assembled user message; the trim is pure and identical across
  // lenses, so the shared-prefix cache (FAFF-903) still holds.
  const { contextFiles, report: trimReport } = trimContextFiles({
    contextFiles: contextFilesRaw,
    diff,
    thresholdBytes: a.contextTrimBytes === undefined ? DEFAULT_CONTEXT_TRIM_BYTES : a.contextTrimBytes,
  });
  if (trimReport.trimmed) {
    process.stderr.write(`[note] FAFF-915 context trim: ${trimReport.bytesBefore} → ${trimReport.bytesAfter} context bytes (diff-relevant regions kept)\n`);
  }
  const user = assembleUserMessage({ contextFiles, diff });

  // FAFF-445: oversized-diff preflight — size-check the assembled payload BEFORE any chain element is
  // dispatched (before mandatory-ness is even resolved, before runReviewChain is called). An oversized
  // payload is flagged and refused, never silently trimmed — the exact material a preflight would drop is
  // what the reviewer needs to do its job. Reuses EXIT.USAGE (2), the same needs-human-class terminal
  // FAFF-414 established for a caught non-transient throw (see the FAFF-445 spec, Decision 2) — no new
  // exit code, no new SKILL.md table row beyond broadening the existing exit-2 description.
  const sizeCheck = checkPayloadSize({ system, user, maxBytes: a.maxPayloadBytes });
  if (sizeCheck.oversized) {
    process.stderr.write(`oversized-diff preflight: assembled payload ${sizeCheck.bytes} bytes exceeds the ${sizeCheck.maxBytes} byte threshold — flagged before dispatch, no backend called (exit ${EXIT.USAGE})\n`);
    return EXIT.USAGE;
  }

  // FAFF-401: derive mandatory-ness mechanically from the run ledger BEFORE the mandatoryRemap chokepoint,
  // so no model step sits between the resolved L4 level and the flag. The explicit --lights-out flag still
  // FORCES mandatory (OR, never AND — a caller that resolved L4-ness itself is trusted); the explicit
  // --run-dir wins over the ambient FAFF_RUN_DIR env on conflict (mirrors the appetite resolver).
  a.mandatory = a.mandatory || ledgerMandatory(a.runDir ?? process.env.FAFF_RUN_DIR);

  // FAFF-617: advisory budget warning — surfaced once to stderr before dispatch, never gating. The
  // per-backend slice (runReviewChain) makes a bad timeout/deadline combination non-fatal (fail-over still
  // happens), but a timeout so high no backend can finish its retry composition inside its slice still
  // silently truncates that backend's retries. This is where the assembled chain (with each element's
  // timeoutMs) and a.totalDeadlineMs both exist, so it is where the check belongs. It never changes an
  // exit code and never blocks dispatch.
  for (const w of budgetWarnings(chain, a.totalDeadlineMs)) process.stderr.write(w + "\n");

  // FAFF-903: reorder the wire payload so the shared context/diff block is the cacheable prefix and
  // the per-lens brief trails it. One swap, here at the caller seam: the shared block (the
  // assembleUserMessage output) goes to the builders' `system` argument (their prefix slot: messages[0]
  // for OpenAI-compatible, top-level `system` for Anthropic) and the lens brief (--system) to their
  // `user` argument. No builder edit and no streaming-path change: both families place the shared block
  // in their prefix position for free. The `system`/`user` locals above keep their CLI-flag meaning
  // (`system` = --system = the lens brief); the two aliases below make the swapped roles explicit.
  const sharedBlock = user;   // assembleUserMessage output — byte-identical across the four spec-review lenses
  const lensBrief = system;   // the --system refuter brief — the only per-lens-differing part
  const res = await runReviewChain(chain, { system: sharedBlock, user: lensBrief, numPredict: a.numPredict, runReviewFn, totalDeadlineMs: a.totalDeadlineMs, expectContract: a.expectContract, rawDir: a.rawDir, lens: a.lens, round: a.round });

  if (res.exit === EXIT.OK) {
    if (res.truncated) {
      // Human note (audit trail; wording is NOT a contract — reword freely).
      process.stderr.write("[note] response truncated at token budget even after retry; findings may be partial\n");
      // FAFF-990: the MACHINE contract — a dedicated, exported constant on its own stderr line. The
      // shared fan-out layer resolves it into a `LensResult.truncated` boolean (line-anchored equality,
      // never a substring of the human note), so a spec-review-only downstream can distinguish a
      // truncation transient from a config fault WITHOUT re-deriving res.truncated or substring-matching
      // prose. Additive stderr only — no control-flow, exit-code, stdout, or chain-behaviour change, so
      // the code-review consumer and the transport's golden tests are unaffected.
      process.stderr.write(TRUNCATION_SIGNAL + "\n");
    }
    // FAFF-940: contract-output mode emits the winning backend's block verbatim. The findings-only
    // refutation pass and the `## Adversarial findings` header prepend below both assume findings-shaped
    // content, so they would corrupt a contract block (e.g. a JSON verdict) — skip them entirely.
    if (a.expectContract) {
      process.stdout.write((res.content || "").trim() + "\n");
      return EXIT.OK;
    }
    // FAFF-194: refutation pass (machine-checkable syntax claims, downgrade-only) then header
    // normalisation (harness-authored provenance), in that order — both run on the winning content only.
    const { content: refuted, refutations } = refuteFindings(res.content || "", a.context, { checkFn });
    for (const r of refutations) {
      process.stderr.write(`refuted: "${r.title}" — node --check clean on ${r.files.join(", ")}; ${r.from} → observation\n`);
    }
    const hadHeader = hasHeader(refuted);
    const finalContent = ensureHeader(refuted, res.winner, res.winnerIndex);
    if (!hadHeader) process.stderr.write("normalized: findings header missing — prepended canonical provenance\n");
    process.stdout.write((finalContent || "").trim() + "\n");
    return EXIT.OK;
  }
  // FAFF-398: single-chokepoint mandatory remap. On a MANDATORY review (L4 --lights-out), an exhausted chain
  // that yielded NO opinion (UNREACHABLE/5 or DEADLINE/8) fails CLOSED → MANDATORY_OUTAGE(9 → needs-human).
  // Applied ONCE here on runReviewChain's terminal exit, so every exhaustion path (the three deadline returns
  // + the chain-exhausted return) is covered by construction; config-fault classes (2/4/6/7) pass through.
  const finalExit = mandatoryRemap(res.exit, a.mandatory);
  if (finalExit === EXIT.MANDATORY_OUTAGE) {
    process.stderr.write(`adversarial review: MANDATORY second opinion unavailable — chain exhausted, no opinion obtained (mandatory-chain-outage); exit ${EXIT.MANDATORY_OUTAGE} → needs-human\n`);
  } else if (finalExit === EXIT.DEADLINE) {
    // FAFF-329: a deadline-skip is surfaced loudly (never silent) — its own line so the run log + /faff-wtf see it.
    process.stderr.write(`adversarial review: phase2 skipped-deadline (total wall-clock budget hit before findings); exit ${EXIT.DEADLINE} → pass+skip\n`);
  } else if (chain.length > 1) {
    const provenance = res.exit === EXIT.UNREACHABLE ? "pass+skip"
      : res.exit === EXIT.DEFAULT_HOST_UNREACHABLE ? "needs-human (default host)" : "needs-human";
    process.stderr.write(`adversarial chain exhausted (${chain.length} backends, none produced findings); terminal exit ${res.exit} → ${provenance}\n`);
  }
  return finalExit;
}

if (process.argv[1] && process.argv[1].endsWith("review-call.mjs")) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { process.stderr.write(`review-call: ${e.message}\n`); process.exitCode = EXIT.OTHER; });
}
