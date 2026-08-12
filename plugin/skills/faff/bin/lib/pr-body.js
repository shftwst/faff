// === region:factory — pr-body — FAFF-214: PR-body citation hygiene ===
// Linear's GitHub integration auto-links every bare `FAFF-NN`-shaped token it finds
// in a PR body and fires its "PR opened → In Progress" transition on each linked
// issue — including ones the PR only CITES (not targets), and including already-Done
// ones. A cited sibling therefore reads as claimed/in-flight, corrupting the tracker
// status faff treats as authoritative cross-run control state.
//
// This module is the single deterministic prevention point: `sanitizePrBody` rewrites
// a composed PR body so only the TARGET issue keeps a Linear-recognisable ASCII
// identifier (as the sole closing `Closes <TARGET-ID>` line); every other recognised
// issue token — including earlier target mentions — is rendered display-safe (U+2011
// NON-BREAKING HYPHEN outside URLs, `%2D` inside http(s) URL destinations so the link
// still resolves). `checkPrBody` re-verifies that exact invariant over an already-
// sanitized body, byte-for-byte, with no transformation of its own.
//
// PURE: no filesystem, no tracker, no network, no environment reads. Mirrors the
// `claim-verdict` / `eligible` split — this module owns the deterministic decision,
// the caller (faff-graft Step 9b) owns the stdin/file I/O around it.
// ===========================================================================

"use strict";

// The closed grammar for a recognisable tracker issue identifier (FAFF-214 §3):
// one uppercase letter, then 1-15 more uppercase letters/digits, a hyphen, then a
// number with no leading zero. Anchored with \b on both sides so a token embedded in
// a longer word/identifier (e.g. "XFAFF-214" or "FAFF-214x") is never partially
// matched — \b only falls exactly where the grammar's own boundary is.
const TARGET_RE = /^[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*$/;
const TOKEN_RE_G = /\b[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*\b/g;

// A "URL span" is an http(s) destination — the run of non-whitespace/closing-
// delimiter characters starting at the scheme. Bounded at typical Markdown/URL
// terminators (whitespace, `)`, `]`, `>`, a quote, or a backtick) so a URL embedded
// in `[label](https://…)` or a bare `<https://…>` is captured without swallowing the
// trailing Markdown syntax.
const URL_RE_G = /https?:\/\/[^\s)\]>"'`]+/g;

class PrBodyError extends Error {}

function validateTarget(target) {
  if (typeof target !== "string" || !TARGET_RE.test(target)) {
    throw new PrBodyError(`--target is not a recognisable issue identifier (want [A-Z][A-Z0-9]{1,15}-[1-9][0-9]*): ${target}`);
  }
}

// Collect [start, end) intervals (end exclusive) of every URL span in `text`.
function urlIntervals(text) {
  const out = [];
  URL_RE_G.lastIndex = 0;
  let m;
  while ((m = URL_RE_G.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

const insideAnyInterval = (idx, intervals) => intervals.some(([s, e]) => idx >= s && idx < e);

// Apply rules 1-3 (FAFF-214 §3) to `text`: every recognised ASCII token — target and
// sibling alike — has its hyphen replaced with U+2011 outside a URL span, or with the
// literal `%2D` inside one. Token boundaries and URL spans are computed independently
// over the ORIGINAL text so overlapping matches never shift each other's offsets.
function neutralizeTokens(text) {
  const urls = urlIntervals(text);
  const matches = [];
  TOKEN_RE_G.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE_G.exec(text))) matches.push({ start: m.index, end: m.index + m[0].length, tok: m[0] });
  if (matches.length === 0) return text;

  let out = "";
  let cursor = 0;
  for (const { start, end, tok } of matches) {
    out += text.slice(cursor, start);
    const hyphenIdx = tok.indexOf("-");
    const replaced = insideAnyInterval(start, urls)
      ? tok.slice(0, hyphenIdx) + "%2D" + tok.slice(hyphenIdx + 1)
      : tok.slice(0, hyphenIdx) + "‑" + tok.slice(hyphenIdx + 1);
    out += replaced;
    cursor = end;
  }
  out += text.slice(cursor);
  return out;
}

// Escape regex metacharacters in a literal target for embedding in a RegExp.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Does `text` already end with a canonical closing block for `target` — either the
// whole body IS just that line, or it is preceded by a blank-line separator? Matching
// this on the RAW (pre-neutralization) text is what makes the transform idempotent:
// an already-sanitized body's closing line is excluded from the neutralization pass
// (so it survives byte-for-byte) rather than being neutralized-then-re-appended,
// which would otherwise grow a fresh duplicate line on every re-run.
function trailingClosingSplit(body, target) {
  const re = new RegExp("(?:^|\\n\\n+)Closes " + escapeRegex(target) + "\\n*$");
  const m = body.match(re);
  if (!m) return null;
  return body.slice(0, m.index);
}

// sanitize(body, target) -> transformed body (FAFF-214 §3, rules 1-4). Pure string ->
// string. Throws PrBodyError on a malformed target.
function sanitizePrBody(body, target) {
  validateTarget(target);
  if (typeof body !== "string") throw new PrBodyError("body must be a string");

  const already = trailingClosingSplit(body, target);
  const core = already === null ? body : already;
  const neutralized = neutralizeTokens(core);
  // Rule 4: remove trailing blank lines, then append exactly one blank line, the
  // closing reference, and one final newline.
  const trimmed = neutralized.replace(/\s+$/, "");
  return `${trimmed}\n\nCloses ${target}\n`;
}

// check(body, target) -> { ok, violations: [{rule, detail}] }. No transformation;
// diagnostics name only the broken rule + offending identifier/count, never body
// content (FAFF-214 §3).
function checkPrBody(body, target) {
  validateTarget(target);
  if (typeof body !== "string") throw new PrBodyError("body must be a string");

  const violations = [];

  TOKEN_RE_G.lastIndex = 0;
  const matches = [...body.matchAll(TOKEN_RE_G)];
  const targetMatches = matches.filter((m) => m[0] === target);
  const otherTokens = matches.filter((m) => m[0] !== target).map((m) => m[0]);

  if (targetMatches.length === 0) {
    violations.push({ rule: "missing-target", detail: `target ${target} does not occur` });
  } else if (targetMatches.length > 1) {
    violations.push({ rule: "target-count", detail: `target ${target} occurs ${targetMatches.length} times, want exactly 1` });
  } else {
    const lines = body.split("\n");
    // Drop a single trailing "" from a final newline, but not further blanks — the
    // closing line must be the true final NON-BLANK line with nothing after it but
    // the one terminating newline rule 4 requires.
    const lastLine = lines[lines.length - 1] === "" ? lines[lines.length - 2] : lines[lines.length - 1];
    if (lastLine !== `Closes ${target}`) {
      violations.push({ rule: "target-not-closing-line", detail: `sole occurrence of ${target} is not the final line "Closes ${target}"` });
    }
  }

  if (otherTokens.length > 0) {
    const counts = new Map();
    for (const t of otherTokens) counts.set(t, (counts.get(t) || 0) + 1);
    const summary = [...counts.entries()].map(([t, n]) => `${t}×${n}`).join(", ");
    violations.push({ rule: "sibling-token-present", detail: `non-target issue token(s) present: ${summary}` });
  }

  if (!(body.endsWith("\n") && !body.endsWith("\n\n"))) {
    violations.push({ rule: "trailing-newline", detail: "body must end with exactly one newline" });
  }

  return { ok: violations.length === 0, violations };
}

// --- --selftest ---------------------------------------------------------------

const PR_BODY_SANITIZE_CASES = [
  {
    name: "target-only prose, no siblings",
    target: "FAFF-900",
    input: "See FAFF-900 for details.\n",
    expect: "See FAFF‑900 for details.\n\nCloses FAFF-900\n",
  },
  {
    name: "repeated target + siblings, target neutralized everywhere but the closing line",
    target: "FAFF-900",
    input: "Fixes FAFF-900. Related: FAFF-19 and FAFF-82. Also FAFF-900 again.\n",
    expect: "Fixes FAFF‑900. Related: FAFF‑19 and FAFF‑82. Also FAFF‑900 again.\n\nCloses FAFF-900\n",
  },
  {
    name: "sibling inside a Markdown link destination is percent-encoded, label text is not",
    target: "FAFF-900",
    input: "See [related](https://linear.app/team/issue/OPS-42/slug) for context.\n",
    expect: "See [related](https://linear.app/team/issue/OPS%2D42/slug) for context.\n\nCloses FAFF-900\n",
  },
  {
    name: "multiple prefixes across prose and fenced code",
    target: "FAFF-900",
    input: "Siblings: FAFF-19, OPS-42, APP7-3.\n\n```\ntest FAFF-19 output\n```\n",
    expect: "Siblings: FAFF‑19, OPS‑42, APP7‑3.\n\n```\ntest FAFF‑19 output\n```\n\nCloses FAFF-900\n",
  },
  {
    name: "idempotent: re-sanitizing an already-sanitized body is a no-op",
    target: "FAFF-900",
    // Fed as a two-step case below (see runSanitizeCases).
    input: "Body with sibling FAFF-19.\n",
    expect: null, // computed via double-application in the runner
  },
];

function runSanitizeCases() {
  let fail = 0;
  for (const c of PR_BODY_SANITIZE_CASES) {
    if (c.expect === null) {
      const once = sanitizePrBody(c.input, c.target);
      const twice = sanitizePrBody(once, c.target);
      const ok = once === twice;
      if (!ok) fail++;
      console.log(`${ok ? "ok  " : "FAIL"} ${c.name}`);
      continue;
    }
    let got;
    try { got = sanitizePrBody(c.input, c.target); }
    catch (e) { got = `ERROR(${e.message})`; }
    const ok = got === c.expect;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${c.name}`);
  }
  return fail;
}

const PR_BODY_CHECK_CASES = [
  { name: "valid: sanitized single-target body", target: "FAFF-900", input: "Prose FAFF‑900.\n\nCloses FAFF-900\n", ok: true },
  { name: "invalid: missing target", target: "FAFF-900", input: "No target here.\n", ok: false },
  { name: "invalid: target appears twice", target: "FAFF-900", input: "FAFF-900 and again FAFF-900.\n", ok: false },
  { name: "invalid: sibling token remains", target: "FAFF-900", input: "Cites FAFF-19.\n\nCloses FAFF-900\n", ok: false },
  { name: "invalid: no trailing newline", target: "FAFF-900", input: "Prose.\n\nCloses FAFF-900", ok: false },
  { name: "invalid: closing line not final", target: "FAFF-900", input: "Closes FAFF-900\n\nmore text\n", ok: false },
];

function runCheckCases() {
  let fail = 0;
  for (const c of PR_BODY_CHECK_CASES) {
    let got;
    try { got = checkPrBody(c.input, c.target).ok; }
    catch (e) { got = `ERROR(${e.message})`; }
    const ok = got === c.ok;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${c.name}`);
  }
  return fail;
}

function prBodySelftest() {
  let fail = 0;
  fail += runSanitizeCases();
  fail += runCheckCases();
  // Malformed target is refused by both entrypoints.
  try { sanitizePrBody("x\n", "not-a-target"); console.log("FAIL malformed target accepted by sanitize"); fail++; }
  catch (e) { console.log(e instanceof PrBodyError ? "ok   malformed target refused by sanitize" : `FAIL wrong error type: ${e}`); if (!(e instanceof PrBodyError)) fail++; }
  try { checkPrBody("x\n", "not-a-target"); console.log("FAIL malformed target accepted by check"); fail++; }
  catch (e) { console.log(e instanceof PrBodyError ? "ok   malformed target refused by check" : `FAIL wrong error type: ${e}`); if (!(e instanceof PrBodyError)) fail++; }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} — no filesystem, tracker, network, or env consulted`);
  return fail ? 1 : 0;
}

// --- CLI -----------------------------------------------------------------------

const fs = require("node:fs");
const { parseArgs, usageError } = require("./argv");

const PR_BODY_SPEC = { flags: { "--target": { arity: 1 }, "--selftest": { arity: 0 } } };
const PR_BODY_USAGE = "usage: faff pr-body sanitize|check --target <TARGET-ID> [--selftest]  (body on stdin)";

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function cmdPrBody(args) {
  if (args.includes("--selftest")) return prBodySelftest();

  const [mode, ...rest] = args;
  if (mode !== "sanitize" && mode !== "check") {
    return usageError([{ code: "bad-mode", detail: `unknown mode '${mode}', want sanitize|check` }], PR_BODY_USAGE);
  }
  const { values, errors } = parseArgs(rest, PR_BODY_SPEC);
  if (errors.length) return usageError(errors, PR_BODY_USAGE);
  if (values["--target"] === undefined) {
    return usageError([{ code: "missing-flag", detail: "missing required flag(s): --target" }], PR_BODY_USAGE);
  }

  let body;
  try { body = readStdin(); }
  catch (e) { process.stderr.write(`faff pr-body: cannot read stdin: ${e.message}\n`); return 2; }

  try {
    if (mode === "sanitize") {
      process.stdout.write(sanitizePrBody(body, values["--target"]));
      return 0;
    }
    const result = checkPrBody(body, values["--target"]);
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof PrBodyError) return usageError([{ code: "invalid-input", detail: e.message }], PR_BODY_USAGE);
    throw e;
  }
}

module.exports = {
  PrBodyError,
  TARGET_RE,
  sanitizePrBody,
  checkPrBody,
  cmdPrBody,
  prBodySelftest,
  runSanitizeCases,
  runCheckCases,
  PR_BODY_SANITIZE_CASES,
  PR_BODY_CHECK_CASES,
};
