// ===========================================================================
// === region:factory — eval-affected — FAFF-752: derive the eval `--kind` subset a change needs ===
// from its touched judgement seams. A plain, advisory, read-only subcommand (like `eligible`):
// given the skill surfaces a change touches, it composes each surface's `judgement_seam:`
// frontmatter (FAFF-280) with `eval/seam-registry.json` (the KIND→surface SSOT) to compute the
// minimal set of grader KINDs whose baselines the change could move — so the operator-owned
// eval-sweep-gate can re-baseline a scoped subset (or skip on `none`) instead of a full frontier
// sweep. FAIL-SAFE to the full sweep: `none` is emitted ONLY when every touched surface is
// confidently non-grading; any doubt (unresolvable diff, a non-skill-dir touch, an undeclared
// surface, a seam that doesn't reconcile, an unavailable registry) resolves to `full`, never a
// narrowed subset. It is NOT a `faff contract` verdict — advisory scoping only. Reuses
// `readJudgementSeam`/`loadSeamRegistryForLint` from validate-adapters.js verbatim (no re-parse).
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const { readJudgementSeam, loadSeamRegistryForLint } = require("./validate-adapters");

// ---------------------------------------------------------------------------
// The pure classifier core — the unit under --selftest. Takes injected data so
// every branch is exercisable without git or the real skill tree.
//
// @param {object} input
//   surfaces:    string[]  the resolved touched skill-surface names (deduped)
//   unclassified:string[]  touched paths outside any plugin/skills/<name>/ dir
//   diffOk:      boolean    false when a --diff ref could not be resolved
//   seamOf:      (name) => null | "none" | string[]   the surface's judgement_seam
//   registry:    object|null   loadSeamRegistryForLint()'s registry ({kinds:{…}})
//   regError:    string|null    loadSeamRegistryForLint()'s error
// @returns {{verdict:"none"|"subset"|"full", kinds:string[], surfaces:string[], reason:string}}
// ---------------------------------------------------------------------------
function classifyAffected(input) {
  const surfaces = [...new Set(input.surfaces || [])].sort();
  const unclassified = input.unclassified || [];
  const mk = (verdict, kinds, reason) => ({ verdict, kinds: [...new Set(kinds || [])].sort(), surfaces, reason });
  const full = (reason) => mk("full", [], reason);
  const none = (reason) => mk("none", [], reason);

  // 1. A diff ref that git could not resolve → fail-safe.
  if (input.diffOk === false) {
    return full("could not resolve touched files from the diff ref");
  }
  // 2. Any touched file outside a skill surface → cannot classify → fail-safe.
  if (unclassified.length) {
    return full(`touched files outside any skill surface: ${unclassified.join(", ")}`);
  }
  // 3. Nothing touched → nothing to sweep.
  if (surfaces.length === 0) {
    return none("no touched surfaces to classify");
  }
  // Registry required to classify a non-empty (potentially-grading) surface set. An error,
  // or a null registry (malformed, or a plugin-only install with no eval/ tree), cannot prove
  // `none` → fail-safe to full. (Matches the spec's "treat identically — full" for {null,null}.)
  if (input.regError || !input.registry || !input.registry.kinds) {
    return full(input.regError || "seam registry unavailable");
  }
  const registry = input.registry;

  // 4. Fold each surface's declared seam into the affected KIND set.
  const affected = [];
  for (const s of surfaces) {
    const declared = input.seamOf(s);
    if (declared === null || declared === undefined) {
      // undeclared ≠ asserted-none — cannot confirm non-grading → fail-safe.
      return full(`surface '${s}' declares no judgement_seam — cannot confirm non-grading`);
    }
    if (declared === "none") continue; // confidently non-grading
    for (const k of declared) {
      const row = registry.kinds[k];
      if (!row || row.surface !== s) {
        return full(`surface '${s}' seam '${k}' does not reconcile against the registry`);
      }
      affected.push(k);
    }
  }
  // 5. Every touched surface reconciled to no graded kind → none.
  if (affected.length === 0) {
    return none("every touched surface declares judgement_seam: none or owns no graded kind");
  }
  // 6. Subset.
  const kinds = [...new Set(affected)].sort();
  return mk("subset", kinds, `${surfaces.length} surface(s) back ${kinds.length} graded kind(s)`);
}

// ---------------------------------------------------------------------------
// I/O seams (impure): the surface-seam reader and the git diff-classifier.
// ---------------------------------------------------------------------------

// Read a surface's judgement_seam from plugin/skills/<name>/SKILL.md under `root`.
// A missing/unreadable SKILL.md → null (undeclared), which the core fails safe on.
function seamOfSurface(name, root) {
  const p = path.join(root, "plugin", "skills", name, "SKILL.md");
  let text;
  try { text = fs.readFileSync(p, "utf8"); }
  catch { return null; }
  return readJudgementSeam(text);
}

// `git diff --name-only <ref>...HEAD` via an argv-array (never a shell string — the
// operator-supplied ref is never shell-interpolated). Returns {files, ok}.
function gitChangedFiles(ref, root) {
  const r = spawnSync("git", ["diff", "--name-only", `${ref}...HEAD`], { cwd: root, encoding: "utf8" });
  if (r.error || r.status !== 0) return { files: [], ok: false };
  const files = (r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return { files, ok: true };
}

const SKILL_PATH_RE = /^plugin\/skills\/([^/]+)\//;

// Resolve the touched surface set from --surfaces and/or --diff.
// @returns {{surfaces:string[], unclassified:string[], diffOk:boolean}}
function resolveSurfaces(values, root) {
  const surfaces = new Set();
  const unclassified = new Set();
  let diffOk = true;

  const rawSurfaces = values["--surfaces"];
  if (rawSurfaces) {
    for (const n of String(rawSurfaces).split(",").map((s) => s.trim()).filter(Boolean)) surfaces.add(n);
  }

  const ref = values["--diff"];
  if (ref) {
    const { files, ok } = gitChangedFiles(ref, root);
    if (!ok) return { surfaces: [...surfaces], unclassified: [...unclassified], diffOk: false };
    for (const f of files) {
      const m = f.match(SKILL_PATH_RE);
      if (m) surfaces.add(m[1]);
      else unclassified.add(f);
    }
  }
  return { surfaces: [...surfaces], unclassified: [...unclassified], diffOk };
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------
function renderPlain(v) {
  if (v.verdict === "subset") return v.kinds.join(",");
  if (v.verdict === "none") return "none — no eval-graded judgement seam touched";
  return `full — ${v.reason}`;
}

// ---------------------------------------------------------------------------
// Selftest — the in-module case table over the pure core (no git, no real tree).
// ---------------------------------------------------------------------------
function evalAffectedCases() {
  const reg = { kinds: { dupe: { surface: "faff-tidy" }, vague: { surface: "faff-tidy" }, roadmap: { surface: "faff-map" } } };
  const seam = (map) => (name) => (name in map ? map[name] : null);
  return [
    ["all-none → none",
      { surfaces: ["a", "b"], unclassified: [], diffOk: true, registry: reg, regError: null, seamOf: seam({ a: "none", b: "none" }) },
      { verdict: "none", kinds: [] }],
    ["declared covered KIND(s) → subset",
      { surfaces: ["faff-tidy"], unclassified: [], diffOk: true, registry: reg, regError: null, seamOf: seam({ "faff-tidy": ["vague", "dupe"] }) },
      { verdict: "subset", kinds: ["dupe", "vague"] }],
    ["undeclared (null frontmatter) → full",
      { surfaces: ["mystery"], unclassified: [], diffOk: true, registry: reg, regError: null, seamOf: seam({}) },
      { verdict: "full", kinds: [] }],
    ["non-reconciling seam (registry names a different surface) → full",
      { surfaces: ["faff-map"], unclassified: [], diffOk: true, registry: reg, regError: null, seamOf: seam({ "faff-map": ["dupe"] }) },
      { verdict: "full", kinds: [] }],
    ["unclassified non-skill-dir touch → full",
      { surfaces: ["faff-tidy"], unclassified: ["eval/grader.mjs"], diffOk: true, registry: reg, regError: null, seamOf: seam({ "faff-tidy": ["dupe"] }) },
      { verdict: "full", kinds: [] }],
    ["empty touched set → none",
      { surfaces: [], unclassified: [], diffOk: true, registry: reg, regError: null, seamOf: seam({}) },
      { verdict: "none", kinds: [] }],
    ["unresolvable diff ref → full",
      { surfaces: [], unclassified: [], diffOk: false, registry: reg, regError: null, seamOf: seam({}) },
      { verdict: "full", kinds: [] }],
    ["registry unavailable + non-empty surfaces → full",
      { surfaces: ["faff-tidy"], unclassified: [], diffOk: true, registry: null, regError: "seam registry unavailable", seamOf: seam({ "faff-tidy": ["dupe"] }) },
      { verdict: "full", kinds: [] }],
    ["union de-dupes backing kinds → subset (each kind once)",
      { surfaces: ["faff-tidy", "faff-tidy"], unclassified: [], diffOk: true, registry: reg, regError: null, seamOf: seam({ "faff-tidy": ["dupe", "dupe", "vague"] }) },
      { verdict: "subset", kinds: ["dupe", "vague"] }],
  ];
}

function runEvalAffectedCases() {
  let fail = 0;
  for (const [name, input, want] of evalAffectedCases()) {
    const got = classifyAffected(input);
    const ok = got.verdict === want.verdict && JSON.stringify(got.kinds) === JSON.stringify(want.kinds) && typeof got.reason === "string" && got.reason.length > 0;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name} → ${got.verdict} [${got.kinds.join(",")}]`);
  }
  return fail;
}

function evalAffectedSelftest() {
  const cases = evalAffectedCases();
  const fail = runEvalAffectedCases();
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${cases.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Dispatch.
// ---------------------------------------------------------------------------
const EVAL_SPEC = {
  flags: {
    "--surfaces": { arity: 1 },
    "--diff": { arity: 1 },
    "--json": { arity: 0 },
    "--root": { arity: 1 },
    "--selftest": { arity: 0 },
  },
};
const EVAL_USAGE = "usage: faff eval affected [--surfaces a,b,…] [--diff <ref>] [--json] [--root DIR] [--selftest]";

function cmdEval(args) {
  const sub = args[0];
  if (sub !== "affected") {
    return usageError([{ code: "unknown-subverb", detail: `unknown eval sub-verb '${sub || ""}' (expected 'affected')` }], EVAL_USAGE);
  }
  const rest = args.slice(1);
  if (rest.includes("--selftest")) return evalAffectedSelftest();

  const { values, errors } = parseArgs(rest, EVAL_SPEC);
  if (errors.length) return usageError(errors, EVAL_USAGE);

  if (!values["--surfaces"] && !values["--diff"]) {
    return usageError([{ code: "missing-input", detail: "at least one of --surfaces or --diff is required" }], EVAL_USAGE);
  }

  const root = values["--root"] ? path.resolve(values["--root"]) : findRoot();
  const { surfaces, unclassified, diffOk } = resolveSurfaces(values, root);
  const { registry, error: regError } = loadSeamRegistryForLint();

  const verdict = classifyAffected({
    surfaces,
    unclassified,
    diffOk,
    registry,
    regError,
    seamOf: (name) => seamOfSurface(name, root),
  });

  if (values["--json"]) console.log(JSON.stringify(verdict));
  else console.log(renderPlain(verdict));
  return 0;
}

module.exports = { cmdEval, classifyAffected, resolveSurfaces, seamOfSurface, gitChangedFiles, renderPlain, evalAffectedCases, runEvalAffectedCases, evalAffectedSelftest };
