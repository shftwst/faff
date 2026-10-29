#!/usr/bin/env node
// One-time equivalence check for a JavaScript-to-TypeScript conversion (FAFF-1432). For each emit
// path it compares the committed tsc emit on disk with the hand-written file at a base git ref:
// both are parsed and printed by the TypeScript compiler with comments removed, so formatting and
// comments drop out; a leading "use strict" directive is dropped from both sides and the emit's
// `Object.defineProperty(exports, "__esModule", …)` statement is dropped. Every remaining line-level
// difference must match an entry in the allow file, and every entry must match a difference.
//
//   node scripts/ts-equivalence.js --base REF --allow FILE PATH...
//
// Exits 0 when every difference is allowed and every entry is used, 1 with each unmatched
// difference or unused entry, 2 on a usage error, an unreadable base or emit, a malformed allow
// file, or a missing typescript package. Paths are relative to the working directory.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const KINDS = new Set(["reflect-get-helper", "reflect-get-read", "undefined-guard"]);
const USAGE = "usage: node scripts/ts-equivalence.js --base REF --allow FILE PATH...";

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { base: null, allow: null, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base" || a === "--allow") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else if (a.startsWith("--")) {
      throw new UsageError(`unknown flag ${a}`);
    } else {
      out.paths.push(a);
    }
  }
  if (!out.base) throw new UsageError("--base is required");
  if (!out.allow) throw new UsageError("--allow is required");
  if (!out.paths.length) throw new UsageError("at least one emit path is required");
  return out;
}

// The allow file: a JSON array of { path, kind, before, after, reason }.
function readAllow(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new UsageError(`allow file ${file} is unreadable: ${e.message}`); }
  if (!Array.isArray(raw)) throw new UsageError(`allow file ${file} must be a JSON array`);
  raw.forEach((e, i) => {
    const at = `allow entry ${i}`;
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new UsageError(`${at} is not an object`);
    if (typeof e.path !== "string" || !e.path) throw new UsageError(`${at} has no path`);
    if (!KINDS.has(e.kind)) throw new UsageError(`${at} has kind ${JSON.stringify(e.kind)}, not one of ${[...KINDS].join(", ")}`);
    if (typeof e.before !== "string" || typeof e.after !== "string") throw new UsageError(`${at} needs string before and after`);
    if (!e.before && !e.after) throw new UsageError(`${at} has both before and after empty`);
    if (typeof e.reason !== "string" || !e.reason.trim()) throw new UsageError(`${at} has an empty reason`);
  });
  return raw;
}

function readBase(ref, rel) {
  const r = spawnSync("git", ["show", `${ref}:./${rel}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new UsageError(`cannot read ${rel} at ${ref}: ${(r.stderr || (r.error && r.error.message) || "").trim()}`);
  return r.stdout;
}

function readEmit(rel) {
  try { return fs.readFileSync(rel, "utf8"); } catch (e) { throw new UsageError(`cannot read the emit ${rel}: ${e.code || e.message}`); }
}

const isUseStrict = (ts, st) => ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression) && st.expression.text === "use strict";

function isEsModuleMarker(ts, st) {
  if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) return false;
  const call = st.expression;
  const callee = call.expression;
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Object"
    && callee.name.text === "defineProperty" && call.arguments.length >= 2
    && ts.isIdentifier(call.arguments[0]) && call.arguments[0].text === "exports"
    && ts.isStringLiteral(call.arguments[1]) && call.arguments[1].text === "__esModule";
}

// Detach a parsed tree from its source layout. The printer keeps a node's original layout (a block
// written on one line stays on one line), and tsc's emit can re-lay-out a construct it rewrote, so
// layout alone would show up as a difference. With every position cleared and every block and
// literal marked multi-line, both sides print in the printer's one canonical layout.
function detachLayout(ts, node) {
  node.pos = -1;
  node.end = -1;
  if (ts.isBlock(node) || ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) node.multiLine = true;
  ts.forEachChild(node, (child) => detachLayout(ts, child), (list) => {
    list.pos = -1;
    list.end = -1;
    for (const child of list) detachLayout(ts, child);
  });
}

// The program text as printed lines, comments removed and the toolchain preamble dropped.
function printedLines(ts, rel, text, isEmit) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let statements = [...sf.statements];
  if (statements.length && isUseStrict(ts, statements[0])) statements = statements.slice(1);
  if (isEmit) statements = statements.filter((st) => !isEsModuleMarker(ts, st));
  for (const st of statements) detachLayout(ts, st);
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const out = printer.printFile(ts.factory.updateSourceFile(sf, statements));
  return out.split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

// Line-level hunks between a and b: runs of removed and added lines, by longest common subsequence.
function hunks(a, b) {
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out = [];
  let cur = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; continue; }
    if (!cur) cur = { baseLine: i + 1, emitLine: j + 1, removed: [], added: [] };
    if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) cur.added.push(b[j++]);
    else cur.removed.push(a[i++]);
  }
  flush();
  return out.map((h) => ({ ...h, before: h.removed.join("\n"), after: h.added.join("\n") }));
}

function run(argv, ts) {
  const opts = parseArgs(argv);
  const allow = readAllow(opts.allow);
  const used = new Set();
  const problems = [];
  for (const rel of opts.paths) {
    const baseLines = printedLines(ts, rel, readBase(opts.base, rel), false);
    const emitLines = printedLines(ts, rel, readEmit(rel), true);
    for (const h of hunks(baseLines, emitLines)) {
      const idx = allow.findIndex((e, k) => !used.has(k) && e.path === rel && e.before === h.before && e.after === h.after);
      if (idx >= 0) { used.add(idx); continue; }
      problems.push([
        `${rel}: unallowed difference at printed base line ${h.baseLine}, emit line ${h.emitLine}`,
        `--- ${opts.base}:${rel}`, `+++ ${rel}`,
        ...h.removed.map((l) => `-${l}`), ...h.added.map((l) => `+${l}`),
      ].join("\n"));
    }
  }
  allow.forEach((e, k) => {
    if (used.has(k)) return;
    if (!opts.paths.includes(e.path)) problems.push(`allow entry ${k} (${e.kind}) names ${e.path}, which was not checked`);
    else problems.push(`allow entry ${k} (${e.kind}) for ${e.path} matches no difference:\n-${e.before.split("\n").join("\n-")}\n+${e.after.split("\n").join("\n+")}`);
  });
  if (problems.length) {
    process.stdout.write(problems.join("\n\n") + "\n");
    return 1;
  }
  process.stdout.write(`ts-equivalence: ok — ${opts.paths.length} path(s), ${used.size} allowed difference(s)\n`);
  return 0;
}

function main() {
  let ts;
  try { ts = require("typescript"); } catch {
    process.stderr.write("ts-equivalence: the typescript package is not installed — run `npm install` under plugin/skills/faff\n");
    return 2;
  }
  try { return run(process.argv.slice(2), ts); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`ts-equivalence: ${e.message}\n${USAGE}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { hunks, printedLines, readAllow, KINDS };
