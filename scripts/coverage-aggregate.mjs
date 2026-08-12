#!/usr/bin/env node
// FAFF-581 — zero-dependency coverage aggregator (publish-only).
//
// Rolls the pile of V8 coverage dumps that the spawned `bin/faff` children fan into
// NODE_V8_COVERAGE (wired at the single runCli() seam, test/helpers/run-cli.mjs) into
// ONE published line/function percentage over the CLI's own source (bin/faff + bin/lib/*.js),
// and prints a markdown block (CI tees it to $GITHUB_STEP_SUMMARY).
//
// PUBLISH-ONLY (FAFF-581 change 4): the number is measured and reported, never gated. The
// spawn-per-assertion architecture OVER-reports vs in-process coverage (a line counts as
// covered if ANY assertion's child executed it), so the first number is a baseline to
// interpret, not a target — the enforcement floor / publish→gate flip is a separate human
// QA call (the §7 Punt). An empty dir (NODE_V8_COVERAGE unset in a plain `node --test`)
// yields `n/a` and exit 0 — never a throw, never a non-zero exit.
//
// ZERO-DEP (ADR 0002): stock Node 20 built-ins only (no c8/nyc/istanbul — those are npm
// packages, disqualified by the no-package.json constraint). V8's own block ranges give
// per-byte execution counts; we map those onto each source file's lines with no tooling.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB_DIR = path.join(repoRoot, "plugin", "skills", "faff", "bin", "lib");
const ENTRYPOINT = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");

// Resolve the coverage dir: --dir ARG wins, else $NODE_V8_COVERAGE.
function resolveDir(argv) {
  const i = argv.indexOf("--dir");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return process.env.NODE_V8_COVERAGE || "";
}

// In-scope iff the covered file is the entrypoint or a bin/lib/*.js module — the
// modules under test, never the harness or node internals.
function inScope(filePath) {
  if (filePath === ENTRYPOINT) return true;
  return filePath.startsWith(LIB_DIR + path.sep) && filePath.endsWith(".js");
}

function scriptUrlToPath(url) {
  if (!url) return null;
  if (url.startsWith("file://")) { try { return fileURLToPath(url); } catch { return null; } }
  if (url.startsWith("/")) return url;
  return null;
}

// Build the covered-byte bitmap for one file from its V8 function ranges. Ranges nest
// (block coverage); the innermost range covering a byte wins, so we fill outer→inner
// (start asc, end desc) and let inner ranges overwrite. A byte is covered iff its
// innermost range's count > 0. Merged across dumps by the caller (covered in ANY dump).
function markCoveredBytes(bitmap, functions) {
  const ranges = [];
  for (const fn of functions) for (const r of fn.ranges) ranges.push(r);
  ranges.sort((a, b) => (a.startOffset - b.startOffset) || (b.endOffset - a.endOffset));
  for (const r of ranges) {
    const v = r.count > 0 ? 1 : 0;
    const end = Math.min(r.endOffset, bitmap.length);
    for (let i = r.startOffset; i < end; i++) bitmap[i] = v;
  }
}

// Map a per-byte covered bitmap onto lines: a line is covered iff any of its
// non-whitespace bytes is covered; a line is countable iff it has any non-whitespace
// byte (blank lines are neither covered nor total). Returns { covered, total }.
function linesFromBitmap(source, bitmap) {
  let covered = 0, total = 0;
  let lineHasCode = false, lineCovered = false;
  const flush = () => {
    if (lineHasCode) { total++; if (lineCovered) covered++; }
    lineHasCode = false; lineCovered = false;
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\n") { flush(); continue; }
    if (ch !== " " && ch !== "\t" && ch !== "\r") {
      lineHasCode = true;
      if (bitmap[i]) lineCovered = true;
    }
  }
  flush();
  return { covered, total };
}

function aggregate(dir) {
  const perFile = new Map(); // path -> { source, bitmap }
  let fnTotal = 0, fnCovered = 0;
  let dumpFiles = [];
  try {
    dumpFiles = fs.readdirSync(dir).filter((f) => f.startsWith("coverage-") && f.endsWith(".json"));
  } catch {
    return { ok: false, reason: "no coverage directory", files: 0 };
  }
  for (const df of dumpFiles) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, df), "utf8")); } catch { continue; }
    for (const entry of parsed.result || []) {
      const fp = scriptUrlToPath(entry.url);
      if (!fp || !inScope(fp)) continue;
      let rec = perFile.get(fp);
      if (!rec) {
        let source;
        try { source = fs.readFileSync(fp, "utf8"); } catch { continue; }
        rec = { source, bitmap: new Uint8Array(source.length) };
        perFile.set(fp, rec);
      }
      // Function coverage: a function counts as covered if its outermost range ran.
      for (const fn of entry.functions || []) {
        fnTotal++;
        if (fn.ranges && fn.ranges.length && fn.ranges[0].count > 0) fnCovered++;
      }
      markCoveredBytes(rec.bitmap, entry.functions || []);
    }
  }
  if (perFile.size === 0) {
    return { ok: false, reason: dumpFiles.length ? "no in-scope coverage in dumps" : "empty coverage directory", files: 0 };
  }
  let lineCovered = 0, lineTotal = 0;
  for (const { source, bitmap } of perFile.values()) {
    const { covered, total } = linesFromBitmap(source, bitmap);
    lineCovered += covered; lineTotal += total;
  }
  return {
    ok: true,
    files: perFile.size,
    dumps: dumpFiles.length,
    lineCovered, lineTotal,
    linePct: lineTotal ? (100 * lineCovered / lineTotal) : 0,
    fnTotal, fnCovered,
    fnPct: fnTotal ? (100 * fnCovered / fnTotal) : 0,
  };
}

function render(r) {
  if (!r.ok) {
    return `### CLI coverage (publish-only)\n\nn/a — ${r.reason}. (No gate; NODE_V8_COVERAGE was likely unset.)\n`;
  }
  const l = r.linePct.toFixed(1), f = r.fnPct.toFixed(1);
  return [
    "### CLI coverage (publish-only — FAFF-581)",
    "",
    `- Line coverage: **${l}%** (${r.lineCovered}/${r.lineTotal} code lines) over ${r.files} source file(s)`,
    `- Function coverage: **${f}%** (${r.fnCovered}/${r.fnTotal} functions)`,
    `- Aggregated from ${r.dumps} V8 dump(s).`,
    "",
    "_Advisory only: spawn-per-assertion over-reports vs in-process coverage. No CI gate on this number (the enforcement floor is a separate QA decision)._",
    "",
  ].join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) return selftest();
  const dir = resolveDir(argv);
  const r = dir ? aggregate(dir) : { ok: false, reason: "NODE_V8_COVERAGE unset and no --dir given", files: 0 };
  process.stdout.write(render(r));
  return 0; // publish-only: NEVER fails the job, whatever the number
}

// Self-check of the pure cores against synthetic V8-shaped ranges — no real dumps.
function selftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`coverage-aggregate --selftest FAIL: ${label}\n`); failed++; } };

  // Source: 3 code lines. Cover bytes of line 1 only.
  const src = "aa\nbb\ncc\n";
  const bm = new Uint8Array(src.length);
  // function ranges: whole file count 1 (outer), line-2 block count 0 (inner).
  markCoveredBytes(bm, [{ ranges: [
    { startOffset: 0, endOffset: src.length, count: 1 },
    { startOffset: 3, endOffset: 5, count: 0 }, // "bb" uncovered
  ] }]);
  const lines = linesFromBitmap(src, bm);
  check("3 countable lines", lines.total === 3);
  check("2 covered (line 2 masked by inner count-0)", lines.covered === 2);

  // Blank lines are neither counted nor covered.
  const src2 = "aa\n\n\nbb\n";
  const bm2 = new Uint8Array(src2.length);
  markCoveredBytes(bm2, [{ ranges: [{ startOffset: 0, endOffset: src2.length, count: 1 }] }]);
  const lines2 = linesFromBitmap(src2, bm2);
  check("blank lines excluded (2 total)", lines2.total === 2);
  check("both code lines covered", lines2.covered === 2);

  // Empty/missing dir → not-ok, never throws.
  const empty = aggregate(path.join(repoRoot, "nonexistent-coverage-dir-xyz"));
  check("missing dir is not-ok", empty.ok === false);
  check("render of not-ok yields n/a", /n\/a/.test(render(empty)));

  if (failed) { process.stdout.write(`\nRESULT: FAIL (${failed} failed)\n`); return 1; }
  process.stdout.write("coverage-aggregate --selftest: ok\n");
  return 0;
}

process.exitCode = main();
