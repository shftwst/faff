#!/usr/bin/env node
// score.mjs — the mechanical half of the faff-L4-vs-one-shot scoresheet (design §5.A).
//
// v1 does the two things that need only a control repo, no L4 build to compare against:
//   gaps <control>  — the LANGUAGE-RELATIVE qualified-build gap set (§3, §5.A.2)
//   cost <control>  — priced $ per token type from the run's own economics (§5.A.4)
//   baseline        — gaps + cost across all 9 controls -> results/controls-baseline.md
//
// Controls are LINKED, never vendored: a control is resolved by name -> repo@SHA from
// controls.manifest.json and fetched at its pinned commit into a per-SHA cache under the
// OS temp dir. Nothing is copied into this repo. The two axes that need a built L4 arm
// (harness pass-rate, full scorecard) are stubbed at the bottom for Phase 2.
//
// Zero-dependency: node builtins only (fs, path, os, child_process). Matches eval/*.mjs.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.resolve(HERE, "..", "results");
const MANIFEST = path.join(RESULTS_DIR, "controls.manifest.json");
const PRICING = path.join(HERE, "../results/pricing.json");
const CACHE_ROOT = path.join(os.tmpdir(), "faff-l4-rig-cache");

// ---------------------------------------------------------------------------
// Fetch: resolve name -> repo@SHA and check the control out into a per-SHA cache.
// ---------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadManifest() {
  return readJson(MANIFEST);
}

function findControl(manifest, name) {
  const c = manifest.controls.find((x) => x.name === name);
  if (!c) {
    const names = manifest.controls.map((x) => x.name).join(", ");
    throw new Error(`unknown control "${name}" — known: ${names}`);
  }
  return c;
}

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

// Clone once per SHA and reuse. A full (not shallow) clone so an arbitrary pinned
// commit is always reachable for checkout; the control repos are small.
function fetchControl(control) {
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  const dir = path.join(CACHE_ROOT, `${control.name}-${control.sha}`);
  const url = `https://github.com/${control.repo}`;

  const checkedOut = () => {
    try {
      return git(["-C", dir, "rev-parse", "--short=12", "HEAD"]).trim().startsWith(control.sha);
    } catch {
      return false;
    }
  };

  if (fs.existsSync(path.join(dir, ".git")) && checkedOut()) return dir;

  fs.rmSync(dir, { recursive: true, force: true });
  git(["clone", "--quiet", url, dir]);
  git(["-C", dir, "checkout", "--quiet", control.sha]);
  return dir;
}

// ---------------------------------------------------------------------------
// Small filesystem helpers — walk the checkout without pulling in a glob dep.
// ---------------------------------------------------------------------------

const IGNORE_DIRS = new Set([".git", "node_modules", "vendor", "dist", "build", ".gradle", "target"]);

function walk(root, onFile) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        onFile(full, path.relative(root, full));
      }
    }
  }
}

function listFiles(root) {
  const out = [];
  walk(root, (_full, rel) => out.push(rel));
  return out;
}

function fileHas(full, re) {
  let text;
  try {
    text = fs.readFileSync(full, "utf8");
  } catch {
    return false;
  }
  return re.test(text);
}

function gitTags(dir) {
  try {
    return git(["-C", dir, "tag"]).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// gaps — the language-relative qualified-build gap set (design §3 / §5.A.2).
// Each signal reports { status, evidence }; the gap_set is the ABSENT ones the
// L4 arm has to fill for this control. status is one of:
//   present | absent | n/a (typed language)
// ---------------------------------------------------------------------------

function detectUnitTests(dir, lang, files) {
  if (lang === "go") {
    const testFiles = files.filter((f) => f.endsWith("_test.go"));
    let funcs = 0;
    for (const f of testFiles) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      funcs += (text.match(/func\s+Test\w*\s*\(/g) || []).length;
    }
    return testFiles.length
      ? { status: "present", evidence: `${funcs} go test func(s) across ${testFiles.length} *_test.go file(s)` }
      : { status: "absent", evidence: "no *_test.go files" };
  }
  if (lang === "java") {
    const testFiles = files.filter(
      (f) => /(^|\/)src\/test\//.test(f) && f.endsWith(".java") || /Test\.java$/.test(f)
    );
    return testFiles.length
      ? { status: "present", evidence: `${testFiles.length} JUnit-style test file(s)` }
      : { status: "absent", evidence: "no *Test.java / src/test sources (no JUnit)" };
  }
  // JS/node: real test files, or a real runner in package.json's test script.
  const testFiles = files.filter((f) => /\.(test|spec)\.[cm]?js$/.test(f));
  const pkgRel = files.find((f) => f === "package.json");
  let runner = null;
  if (pkgRel) {
    let pkg;
    try {
      pkg = readJson(path.join(dir, pkgRel));
    } catch {
      pkg = null;
    }
    const script = pkg?.scripts?.test || "";
    const isStub = /no test specified|exit 1/i.test(script) || script.trim() === "";
    if (script && !isStub && /node --test|node:test|vitest|jest|mocha|\btap\b|ava|uvu/.test(script)) {
      runner = script;
    }
  }
  if (testFiles.length) {
    return { status: "present", evidence: `${testFiles.length} *.test.js/*.spec.js file(s)${runner ? ` + test script "${runner}"` : ""}` };
  }
  if (runner) {
    return { status: "present", evidence: `test runner in package.json ("${runner}") but no *.test.js files found` };
  }
  return { status: "absent", evidence: "no *.test.js/*.spec.js and no real test runner in package.json" };
}

function detectAdrs(files) {
  const hits = files.filter(
    (f) => /(^|\/)docs\/adr\//i.test(f) || /(^|\/)adr\//i.test(f) || /(^|\/)ADR-[^/]*\.md$/i.test(f)
  );
  return hits.length
    ? { status: "present", evidence: `${hits.length} ADR file(s): ${hits.slice(0, 3).join(", ")}` }
    : { status: "absent", evidence: "no records/adr, **/adr, or ADR-*.md decision records" };
}

function detectSpecDecomposition(files) {
  // A DISTINCT decomposition/spec artifact beyond the PRD + a release log.
  // The controls carry prd.md + SUMMARY.md + prompt.md + RELEASES.md — none of which
  // is a spec-to-tickets decomposition, so those names are explicitly NOT counted.
  const NOT_DECOMP = /(^|\/)(prd|.*-prd|summary|readme|prompt|economics|releases|changelog)\.md$/i;
  const hits = files.filter((f) => {
    if (NOT_DECOMP.test(f)) return false;
    return (
      /(^|\/)(specs?|decomposition|tickets?|backlog|epics?|stories|breakdown)(\/|[-_.])/i.test(f) ||
      /(spec|decomposition|breakdown)\.md$/i.test(f)
    );
  });
  return hits.length
    ? { status: "present", evidence: `${hits.length} decomposition artifact(s): ${hits.slice(0, 3).join(", ")}` }
    : { status: "absent", evidence: "no spec/decomposition artifact beyond the PRD + release log" };
}

function detectTypedInterfaces(dir, lang, files) {
  if (lang === "go" || lang === "java") {
    return { status: "n/a (typed language)", evidence: `${lang} is statically typed — not a gap this control's L4 arm can claim as a delta` };
  }
  // JS: TypeScript, or a runtime schema-validation lib.
  const hasTsconfig = files.some((f) => /(^|\/)tsconfig[^/]*\.json$/.test(f));
  const hasTs = files.some((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"));
  const SCHEMA_LIBS = /"(zod|joi|ajv|yup|superstruct|valibot|io-ts|typebox|@sinclair\/typebox)"/;
  const pkgRel = files.find((f) => f === "package.json");
  const hasSchemaLib = pkgRel && fileHas(path.join(dir, pkgRel), SCHEMA_LIBS);
  if (hasTsconfig || hasTs) {
    return { status: "present", evidence: hasTsconfig ? "tsconfig.json present (TypeScript)" : "TypeScript sources present" };
  }
  if (hasSchemaLib) {
    return { status: "present", evidence: "schema-validation lib in package.json (zod/joi/ajv/…)" };
  }
  return { status: "absent", evidence: "no TypeScript and no schema-validation lib (zod/joi/ajv) — untyped JS surface" };
}

function detectCi(files) {
  const wf = files.filter((f) => /(^|\/)\.github\/workflows\/.*\.ya?ml$/.test(f));
  return wf.length
    ? { status: "present", evidence: `${wf.length} workflow(s): ${wf.map((f) => path.basename(f)).join(", ")}` }
    : { status: "absent", evidence: "no .github/workflows/*.yml" };
}

function detectReleaseLadder(dir, files) {
  // >=3 releases mapped to a monotone ladder in RELEASES.md/CHANGELOG, OR >=3 real tags.
  const SEMVER = /\bv?\d+\.\d+\.\d+\b/g;
  let logFile = null;
  let logReleases = 0;
  for (const f of files) {
    if (/(^|\/)(RELEASES|CHANGELOG)\.md$/i.test(f)) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const versions = new Set(text.match(SEMVER) || []);
      if (versions.size > logReleases) {
        logReleases = versions.size;
        logFile = f;
      }
    }
  }
  const tags = gitTags(dir);
  const tagVersions = tags.filter((t) => /v?\d+\.\d+\.\d+/.test(t));
  if (logReleases >= 3) {
    return { status: "present", evidence: `${logReleases} versions in ${logFile}${tagVersions.length ? ` + ${tagVersions.length} tags` : ""}` };
  }
  if (tagVersions.length >= 3) {
    return { status: "present", evidence: `${tagVersions.length} release tags: ${tagVersions.slice(0, 4).join(", ")}` };
  }
  const bits = [];
  if (logReleases) bits.push(`only ${logReleases} version(s) in ${logFile}`);
  if (tagVersions.length) bits.push(`only ${tagVersions.length} tag(s)`);
  if (!bits.length) bits.push("no RELEASES/CHANGELOG ladder and no release tags");
  return { status: "absent", evidence: bits.join("; ") + " (single-shot commit, no monotone ladder)" };
}

function detectErrorHandling(dir, lang, files) {
  // Coarse signal: try/catch (or language equivalent) present + a spread of HTTP statuses.
  const srcExt =
    lang === "go" ? /\.go$/ : lang === "java" ? /\.java$/ : /\.[cm]?jsx?$/;
  const isSrc = (f) =>
    srcExt.test(f) && !/\.(test|spec)\./.test(f) && !/(^|\/)harness\//.test(f);
  const src = files.filter(isSrc);
  const guardRe =
    lang === "go" ? /if\s+err\s*!=\s*nil/ : /\b(try|catch)\b|\.catch\s*\(/;
  const statuses = new Set();
  let guarded = 0;
  const statusRe = /\b([45]\d\d)\b/g;
  for (const f of src) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    if (guardRe.test(text)) guarded++;
    for (const m of text.matchAll(statusRe)) statuses.add(m[1]);
  }
  if (guarded > 0) {
    return {
      status: "present",
      evidence: `error guards in ${guarded}/${src.length} source file(s); ${statuses.size} distinct 4xx/5xx status code(s)`,
    };
  }
  return { status: "absent", evidence: "no try/catch (or err!=nil) guards found in source" };
}

function computeGaps(control, dir) {
  const files = listFiles(dir);
  const lang = control.lang;
  const gaps = {
    unit_tests: detectUnitTests(dir, lang, files),
    adrs: detectAdrs(files),
    spec_decomposition: detectSpecDecomposition(files),
    typed_interfaces: detectTypedInterfaces(dir, lang, files),
    ci: detectCi(files),
    release_ladder: detectReleaseLadder(dir, files),
    error_handling: detectErrorHandling(dir, lang, files),
  };
  const gap_set = Object.entries(gaps)
    .filter(([, v]) => v.status === "absent")
    .map(([k]) => k);
  return { control: control.name, lang, gaps, gap_set };
}

// ---------------------------------------------------------------------------
// cost — priced $ per token type from the run's own economics (design §5.A.4).
// The economics.json shape varies across controls, so both the totals object and
// the model id are resolved from a set of candidate locations rather than assumed.
// ---------------------------------------------------------------------------

// Token counts land under one of these keys (top-level or a nested summary object).
const TOTALS_KEYS = ["totals", "usage_totals", "usage", "summary"];
const TOKEN_MAP = {
  input: "input_tokens",
  output: "output_tokens",
  cache_write: "cache_creation_input_tokens",
  cache_read: "cache_read_input_tokens",
};

function hasTokenShape(obj) {
  return obj && typeof obj === "object" && typeof obj.output_tokens === "number";
}

function findTotals(econ) {
  for (const k of TOTALS_KEYS) {
    if (hasTokenShape(econ[k])) return econ[k];
  }
  if (hasTokenShape(econ)) return econ; // some shapes put totals at the root
  return null;
}

function findModel(econ) {
  const s = econ.session || {};
  const m = econ.meta || {};
  return s.model_id || s.model || econ.model || econ.model_id || m.model || m.model_id || null;
}

function computeCost(control, dir, pricing) {
  const econPath = path.join(dir, control.economics);
  if (!fs.existsSync(econPath)) {
    return {
      control: control.name,
      model: null,
      tokens: null,
      priced_usd: null,
      output_tokens: null,
      note: `economics file not found at manifest path "${control.economics}"`,
    };
  }
  const econ = readJson(econPath);
  const totals = findTotals(econ);
  const model = findModel(econ);

  if (!totals) {
    return {
      control: control.name,
      model,
      tokens: null,
      priced_usd: null,
      output_tokens: null,
      note: `unexpected economics shape: no totals object under ${TOTALS_KEYS.join("/")} or root — not guessing token counts`,
    };
  }

  const tokens = {};
  const missing = [];
  for (const [type, key] of Object.entries(TOKEN_MAP)) {
    if (typeof totals[key] === "number") {
      tokens[type] = totals[key];
    } else {
      tokens[type] = 0;
      missing.push(key);
    }
  }

  const result = {
    control: control.name,
    model,
    tokens,
    priced_usd: null,
    output_tokens: tokens.output,
    note: "",
  };

  const rates = pricing.models?.[model];
  if (!model) {
    result.note = "no model id in economics.json — cannot price";
    return result;
  }
  if (!rates) {
    result.note = `model "${model}" not in ../results/pricing.json — add it and fill rates`;
    return result;
  }

  // A rate is "needed" only for a token type with a nonzero count.
  const needed = Object.keys(TOKEN_MAP).filter((t) => tokens[t] > 0);
  const unpriced = needed.filter((t) => rates[t] == null);
  if (unpriced.length) {
    result.note = `unpriced — fill ../results/pricing.json rates for ${model}: ${unpriced.join(", ")} (dated: ${pricing.dated ?? "null"})`;
    return result;
  }

  let usd = 0;
  for (const t of needed) usd += (tokens[t] * rates[t]) / 1e6;
  result.priced_usd = Number(usd.toFixed(4));
  result.note = `priced against ../results/pricing.json dated ${pricing.dated ?? "null"}` + (missing.length ? `; economics missing key(s) ${missing.join(", ")} (treated as 0)` : "");
  return result;
}

// ---------------------------------------------------------------------------
// baseline — gaps + cost across every control -> results/controls-baseline.md
// ---------------------------------------------------------------------------

function cell(g) {
  if (g.status === "present") {
    const n = (g.evidence.match(/^\d+/) || g.evidence.match(/\b(\d+)\b/) || [])[0];
    return n ? `yes (${n})` : "yes";
  }
  if (g.status.startsWith("n/a")) return "n/a";
  return "no";
}

function runBaseline() {
  const manifest = loadManifest();
  const pricing = readJson(PRICING);
  const rows = [];
  for (const control of manifest.controls) {
    process.stderr.write(`baseline: ${control.name} … `);
    const dir = fetchControl(control);
    const g = computeGaps(control, dir);
    const c = computeCost(control, dir, pricing);
    rows.push({ g, c });
    process.stderr.write("done\n");
  }

  const header = [
    "control", "lang", "unit-tests", "ADRs", "spec-decomp", "typed",
    "release-ladder", "gap-set size", "output-tokens", "priced-$",
  ];
  const lines = [];
  lines.push("# Controls baseline — mechanical qualified-build + cost survey");
  lines.push("");
  lines.push(
    `*Mechanically generated by \`rig/score.mjs baseline\` from controls.manifest.json (pinned @ SHA). ` +
      `Priced against \`results/pricing.json\` dated ${pricing.dated ?? "null (unfilled — costs show as \"unpriced\")"}. ` +
      `Do not hand-edit — re-run the rig.*`
  );
  lines.push("");
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const { g, c } of rows) {
    const priced = c.priced_usd == null ? "unpriced" : `$${c.priced_usd}`;
    const out = c.output_tokens == null ? "?" : c.output_tokens.toLocaleString("en-US");
    lines.push(
      `| ${[
        g.control,
        g.lang,
        cell(g.gaps.unit_tests),
        cell(g.gaps.adrs),
        cell(g.gaps.spec_decomposition),
        cell(g.gaps.typed_interfaces),
        cell(g.gaps.release_ladder),
        g.gap_set.length,
        out,
        priced,
      ].join(" | ")} |`
    );
  }
  lines.push("");
  lines.push("gap-set size = count of ABSENT discriminators the L4 arm has to fill (typed on Go/Java is n/a, not counted).");
  lines.push("");

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, "controls-baseline.md");
  fs.writeFileSync(outPath, lines.join("\n"));
  process.stderr.write(`\nwrote ${path.relative(process.cwd(), outPath)}\n`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const [cmd, arg] = process.argv.slice(2);
  const out = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + "\n");

  switch (cmd) {
    case "gaps": {
      if (!arg) throw new Error("usage: score.mjs gaps <control-name>");
      const control = findControl(loadManifest(), arg);
      out(computeGaps(control, fetchControl(control)));
      break;
    }
    case "cost": {
      if (!arg) throw new Error("usage: score.mjs cost <control-name>");
      const control = findControl(loadManifest(), arg);
      out(computeCost(control, fetchControl(control), readJson(PRICING)));
      break;
    }
    case "baseline":
      runBaseline();
      break;
    default:
      process.stderr.write(
        [
          "faff-L4 scoring rig (v1 — mechanical axes, no L4 arm needed yet)",
          "",
          "  score.mjs gaps <control>   language-relative qualified-build gap set (design §3/§5.A.2)",
          "  score.mjs cost <control>   priced $ per token type from the run's economics (§5.A.4)",
          "  score.mjs baseline         gaps + cost over all 9 controls -> results/controls-baseline.md",
          "",
          `  controls: ${loadManifest().controls.map((c) => c.name).join(", ")}`,
          "",
        ].join("\n")
      );
      process.exit(cmd ? 1 : 0);
  }
}

try {
  main();
} catch (e) {
  process.stderr.write(`error: ${e.message}\n`);
  process.exit(1);
}

// ===========================================================================
// PHASE 2 (needs a built L4 arm to compare against):
//
// These two axes can only run once an L4 arm exists for a control — there are no
// L4 builds yet, so they are intentionally NOT implemented. They complete the
// scorecard: the mechanical axes above are the control-only half.
//
//   harness-run <control> <build-dir>
//     Run the control's OWN committed harness (manifest `harness` path) against an
//     L4 build directory and report the PRD-AC pass rate X/N (design §5.A.1). The
//     control built the oracle, so this stays judge-free. Needs: resolve the harness
//     entrypoint per stack (node harness/run.js, go test ./..., the Python check
//     scripts for grocer/showhands), point it at the build's live/local instance,
//     parse X/N out of its output.
//
//   scorecard <control> <l4-build>
//     Assemble the full per-experiment scorecard (design §2 "Presentation"): control
//     vs the L4 arm across all four mechanical axes — AC pass rate (harness-run),
//     qualified-build gap-fill (gaps, both arms), independent-catch count, and the
//     cost premium (cost, both arms) — plus a slot for the blind §B judged score.
//     Emits results/<control>-scorecard.md.
//
// TODO(phase-2, gated on the CI-runner cage FAFF-646/651 + real L4 runs):
//   function harnessRun(control, buildDir) { /* … */ }
//   function scorecard(control, l4Build)  { /* … */ }
// ===========================================================================
