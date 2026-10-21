// FAFF-1355 — counts live `process.exit(` calls in JS source, ignoring comments, strings,
// regex literals and template text. Dependency-free so it runs in every CI lane.

export const ALLOWLIST = [
  { path: "plugin/skills/faffter-dark-adversarial-review/review-call.mjs", count: 1, why: "FAFF-1239 leak-only exit backstop" },
  { path: "plugin/skills/faff/bin/faff-bridge-node.mjs", count: 1, why: "FAFF-1355 leak-only exit backstop" },
];

const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^");
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);
const LIVE_CALL_PATTERNS = [
  /^process\s*\.\s*exit\s*\(/,
  /^process\s*\?\.\s*exit\s*\(/,
  /^process\s*\[\s*(["'`])exit\1\s*\]\s*\(/,
];
const isIdentChar = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

function skipQuoted(src, i, quote) {
  for (i += 1; i < src.length; i++) {
    if (src[i] === "\\") i++;
    else if (src[i] === quote) return i + 1;
  }
  return src.length;
}

function skipRegex(src, i) {
  let inClass = false;
  for (i += 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i + 1;
    else if (c === "\n") return i;
  }
  return src.length;
}

function previousToken(src, end) {
  let i = end - 1;
  while (i >= 0 && /\s/.test(src[i])) i--;
  if (i < 0) return { char: null, word: "" };
  if (!isIdentChar(src[i])) return { char: src[i], word: "" };
  let start = i;
  while (start > 0 && isIdentChar(src[start - 1])) start--;
  return { char: src[i], word: src.slice(start, i + 1) };
}

function startsRegex(src, i) {
  const { char, word } = previousToken(src, i);
  if (char === null) return true;
  if (word) return REGEX_KEYWORDS.has(word);
  return REGEX_PRECEDERS.has(char);
}

export function countLiveProcessExit(source) {
  const src = source.startsWith("#!") ? source.replace(/^#![^\n]*/, "") : source;
  const braceStack = [];
  let count = 0;
  let i = 0;
  let inTemplate = false;
  while (i < src.length) {
    const c = src[i];
    if (inTemplate) {
      if (c === "\\") i += 2;
      else if (c === "`") { inTemplate = false; i++; }
      else if (c === "$" && src[i + 1] === "{") { braceStack.push("template"); inTemplate = false; i += 2; }
      else i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === "'" || c === '"') {
      i = skipQuoted(src, i, c);
    } else if (c === "`") {
      inTemplate = true; i++;
    } else if (c === "/" && startsRegex(src, i)) {
      i = skipRegex(src, i);
    } else if (c === "{") {
      braceStack.push("code"); i++;
    } else if (c === "}") {
      if (braceStack.pop() === "template") inTemplate = true;
      i++;
    } else if (c === "p" && !isIdentChar(src[i - 1]) && LIVE_CALL_PATTERNS.some((re) => re.test(src.slice(i, i + 64)))) {
      count++; i += "process".length;
    } else {
      i++;
    }
  }
  return count;
}

export function checkLiveProcessExit(files, allowlist = ALLOWLIST) {
  const allowed = new Map(allowlist.map((e) => [e.path, e.count]));
  const problems = [];
  for (const [path, source] of files) {
    const n = countLiveProcessExit(source);
    const want = allowed.get(path) ?? 0;
    if (n !== want) problems.push(`${path}: ${n} live process.exit call(s), allowed ${want}`);
  }
  for (const entry of allowlist) {
    if (!files.has(entry.path)) problems.push(`${entry.path}: allowlisted file not found`);
  }
  if (problems.length) problems.push("set process.exitCode and return (FAFF-1355)");
  return problems;
}
