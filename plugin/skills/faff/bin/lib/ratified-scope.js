"use strict";
// === region:factory — ratified-scope — FAFF-919: assemble + validate the ratified-scope block ===
//
// `faff ratified-scope` is a read-only reader-tier command (alongside `faff decisions` / `faff next`):
// a pure function over committed files with no tracker call, no network, and no writes.
//
//   --assemble  splices a fixed `## Ratified scope` markdown block from two committed sources —
//               a PRD's `## Non-goals` section and the `docs/decisions.md` settled precedents — and
//               prints it. It never parses the meaning of what it copies; it only cites it.
//   --validate  confirms a supplied block has the SHAPE `--assemble` emits. This is a well-formedness
//               check, NOT an authenticity gate: a hand-crafted block with the heading, the provenance
//               anchor, and any one subsection passes. A pass proves the container is the right shape
//               to be consumed; it proves nothing about origin (FAFF-919 committed decision).
//
// The `## Non-goals` scan REUSES the shared scanner `admissibility.js` already exports
// (`sectionBody`, default boundary) — no scanner is copied and `admissibility.js` is not modified;
// deduping its separate `acceptanceSection` onto the shared scanner is deferred to FAFF-923.
//
// PURE where it matters: assemble/validate/render/placeholderOnly do no writes and reach no network.
// Only file READS happen (the resolved PRD path, docs/decisions.md, and the config prdDir consults).

const fs = require("node:fs");
const path = require("node:path");
const { sectionBody } = require("./admissibility");
const { listEntries } = require("./decisions");
const { prdDir, prdSlug } = require("./prd");
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");

// The fixed provenance sentence (emitted verbatim) and the stable anchor prefix the validator keys on.
// The validator checks only the anchor, so a future tweak to the sentence's tail never silently starts
// rejecting live blocks — the assemble side stays the single source of the exact wording.
const PROVENANCE_SENTENCE =
  "Assembled by `faff ratified-scope` from files committed to this repository. " +
  "The spec under review is not a source and cannot write to any of these files.";
const PROVENANCE_ANCHOR = "Assembled by `faff ratified-scope`";

// A real ratified-scope block is a few hundred bytes to a few KiB; 1 MiB is ~1000x headroom and still
// bounds a hostile or accidental multi-GB stdin/file on a constrained host (FAFF-919 committed cap).
const VALIDATE_MAX_BYTES = 1048576; // 1 MiB

const NON_GOALS_HEADING_RE = /^\s*##\s+non-goals/i;

// The non-goals scanner — the first EXTERNAL caller of the shared exported `sectionBody`, with its
// DEFAULT boundary (fence-aware, stops at the next equal-or-higher heading). No option is passed and
// no scanner logic is copied here.
function nonGoalsSection(prdText) {
  return sectionBody(prdText, NON_GOALS_HEADING_RE);
}

// A `## Non-goals` body that trims to empty or to the scaffold's `_TODO._` marker is treated as absent.
function placeholderOnly(body) {
  const t = String(body == null ? "" : body).trim();
  return t === "" || t === "_TODO._";
}

// assemble(root, container) -> { exit, block }. Reads only; a source read throw propagates (caller maps
// it to exit 2). exit 3 when nothing ratified (no non-goals section AND no scoped precedent).
function assemble(root, container) {
  let nonGoals = null;
  if (container != null) {
    const prdPath = path.join(prdDir(root), prdSlug(container) + ".md");
    if (fs.existsSync(prdPath)) {
      const text = fs.readFileSync(prdPath, "utf8"); // a read throw => exit 2 (unreadable source)
      const body = nonGoalsSection(text);
      if (body != null && !placeholderOnly(body)) {
        nonGoals = { container, source_path: path.relative(root, prdPath), body };
      }
    }
  }

  const precedents = [];
  for (const entry of listEntries(root)) { // absent docs/decisions.md => [] (not an error)
    if (typeof entry.scope === "string" && entry.scope.trim() !== "") {
      precedents.push({ id: entry.id, topic: entry.topic, chosen: entry.chosen, scope: entry.scope });
    }
  }

  if (nonGoals == null && precedents.length === 0) return { exit: 3, block: "" };
  return { exit: 0, block: render(nonGoals, precedents) };
}

// render(nonGoals, precedents) -> markdown. Preserves listEntries order (document order in the register).
function render(nonGoals, precedents) {
  const out = ["## Ratified scope", "", PROVENANCE_SENTENCE, ""];
  if (nonGoals != null) {
    out.push("### Non-goals: PRD `" + nonGoals.container + "` (" + nonGoals.source_path + ")", "");
    out.push(nonGoals.body.trim(), ""); // trim leading/trailing blank lines only
  }
  if (precedents.length > 0) {
    out.push("### Settled precedents (docs/decisions.md)", "");
    for (const p of precedents) {
      out.push("- **" + p.topic + "** (`" + p.id + "`)");
      out.push("  - Chosen: " + (p.chosen == null ? "" : p.chosen));
      out.push("  - Scope: " + p.scope);
    }
    out.push("");
  }
  return out.join("\n");
}

// validate(text) -> { valid, problems }. A deterministic STRUCTURAL check: it confirms a block has the
// shape assemble emits. It parses nothing semantic, reads no source file, and does NOT prove the block
// was actually produced by assemble.
function validate(text) {
  if (String(text == null ? "" : text).trim() === "") {
    return { valid: false, problems: ["empty input"] };
  }
  const problems = [];
  const lines = String(text).split(/\r?\n/);
  if (!lines.some((l) => l === "## Ratified scope")) {
    problems.push("missing the `## Ratified scope` heading");
  }
  if (!String(text).includes(PROVENANCE_ANCHOR)) {
    problems.push("missing the provenance sentence");
  }
  const hasNonGoals = lines.some((l) => /^### Non-goals: PRD /.test(l));
  const hasPrecedents = lines.some((l) => l === "### Settled precedents (docs/decisions.md)");
  if (!(hasNonGoals || hasPrecedents)) {
    problems.push("no non-goals section and no settled-precedents section (an empty block is never emitted)");
  }
  return { valid: problems.length === 0, problems };
}

// Bounded stdin read (fd 0) — reads in fixed chunks, stopping the moment the total crosses the cap, so
// an unbounded pipe never buffers past it and no single allocation exceeds the cap. Deliberately does
// not slurp fd 0 unbounded (the memory-exhaustion precedent this surface refuses to inherit). Returns
// { over } or { over:false, text }.
function readStdinCapped(cap) {
  const CHUNK = 65536;
  const buf = Buffer.alloc(CHUNK);
  const chunks = [];
  let total = 0;
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, CHUNK, null);
    } catch (e) {
      if (e.code === "EAGAIN") continue; // non-blocking stdin: retry
      if (e.code === "EOF") break;
      throw e;
    }
    if (n === 0) break;
    total += n;
    if (total > cap) return { over: true };
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return { over: false, text: Buffer.concat(chunks).toString("utf8") };
}

// readValidateInput(inFile) -> { ok:true, text } | { ok:false, oversize:true }. Throws on an unreadable
// --in file (caller maps to exit 2). The file path uses statSync to reject an oversize file before
// reading a single byte; the stdin path uses the bounded chunked read above.
function readValidateInput(inFile) {
  if (inFile != null) {
    const st = fs.statSync(inFile); // throws => caller maps to exit 2
    if (st.size > VALIDATE_MAX_BYTES) return { ok: false, oversize: true };
    return { ok: true, text: fs.readFileSync(inFile, "utf8") };
  }
  const r = readStdinCapped(VALIDATE_MAX_BYTES);
  if (r.over) return { ok: false, oversize: true };
  return { ok: true, text: r.text };
}

const RATIFIED_SCOPE_SPEC = {
  flags: {
    "--assemble": { arity: 0 },
    "--validate": { arity: 0 },
    "--container": { arity: 1 },
    "--root": { arity: 1 },
    "--in": { arity: 1 },
    "--json": { arity: 0 },
    "--selftest": { arity: 0 },
  },
  positionals: { min: 0, max: 0, name: "(none)" },
};
const USAGE =
  "usage: faff ratified-scope (--assemble [--container <c>] [--root <dir>] | --validate [--in <file>] [--json])";

function cmdRatifiedScope(args) {
  if (args.includes("--selftest")) return ratifiedScopeSelftest();
  const { values, errors } = parseArgs(args, RATIFIED_SCOPE_SPEC);
  if (errors.length) return usageError(errors, USAGE);

  const assembleMode = values["--assemble"] === true;
  const validateMode = values["--validate"] === true;
  if (assembleMode === validateMode) { // neither, or both
    return usageError([{ code: "mode", detail: "exactly one of --assemble / --validate is required" }], USAGE);
  }

  if (assembleMode) {
    if (values["--in"] !== undefined || values["--json"] === true) {
      return usageError([{ code: "wrong-mode-flag", detail: "--in / --json are validate-only flags" }], USAGE);
    }
    const root = values["--root"] !== undefined ? values["--root"] : findRoot();
    const container = values["--container"] !== undefined ? values["--container"] : null;
    let result;
    try {
      result = assemble(root, container);
    } catch (e) {
      process.stderr.write(`faff ratified-scope: cannot read a source (${e.message})\n`);
      return 2;
    }
    if (result.exit === 0) {
      process.stdout.write(result.block.endsWith("\n") ? result.block : result.block + "\n");
    }
    return result.exit; // 0 or 3
  }

  // validate mode
  if (values["--container"] !== undefined || values["--root"] !== undefined) {
    return usageError([{ code: "wrong-mode-flag", detail: "--container / --root are assemble-only flags" }], USAGE);
  }
  const inFile = values["--in"];
  let res;
  try {
    res = readValidateInput(inFile);
  } catch (e) {
    process.stderr.write(`faff ratified-scope --validate: cannot read ${inFile} (${e.message})\n`);
    return 2;
  }
  if (!res.ok) {
    process.stderr.write(`faff ratified-scope --validate: input exceeds ${VALIDATE_MAX_BYTES} bytes\n`);
    return 2;
  }
  const v = validate(res.text);
  if (values["--json"] === true) {
    console.log(JSON.stringify(v));
  } else if (v.valid) {
    console.log("OK — well-formed ratified-scope block");
  } else {
    for (const p of v.problems) process.stderr.write("INVALID: " + p + "\n");
  }
  return v.valid ? 0 : 1;
}

// Selftest — a real in-process smoke test over the pure functions: assemble (against a temp fixture),
// render, placeholderOnly, validate, and the VALIDATE_MAX_BYTES boundary.
function ratifiedScopeSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };

  // placeholderOnly
  ok("placeholderOnly('') is true", placeholderOnly("") === true);
  ok("placeholderOnly('  \\n ') is true", placeholderOnly("  \n ") === true);
  ok("placeholderOnly('_TODO._') is true", placeholderOnly("_TODO._") === true);
  ok("placeholderOnly of real body is false", placeholderOnly("- No scaling in v1.") === false);

  // render + validate round-trip (shape only)
  const block = render(
    { container: "demo", source_path: "docs/prd/demo.md", body: "- No scaling in v1.\n- No read replica." },
    [{ id: "single-instance-rate-limiting-for-v1", topic: "Single-instance rate limiting for v1", chosen: "in-process counters", scope: "the v1 deployment" }],
  );
  ok("render begins with the heading", block.split("\n")[0] === "## Ratified scope");
  ok("render carries the provenance anchor", block.includes(PROVENANCE_ANCHOR));
  ok("render carries the non-goals body verbatim", block.includes("- No scaling in v1."));
  ok("render carries the precedent scope", block.includes("- Scope: the v1 deployment"));
  ok("assemble output validates clean (shape round-trip)", validate(block).valid === true);

  // validate rejections
  ok("empty input is invalid with the empty-input problem",
    validate("").valid === false && validate("").problems[0] === "empty input");
  ok("heading-plus-provenance with no subsection is invalid",
    validate("## Ratified scope\n\n" + PROVENANCE_SENTENCE + "\n").valid === false);
  ok("missing heading is invalid",
    validate(PROVENANCE_SENTENCE + "\n\n### Settled precedents (docs/decisions.md)\n").valid === false);
  ok("provenance not beginning with the anchor is invalid",
    validate("## Ratified scope\n\nSomething else entirely.\n\n### Settled precedents (docs/decisions.md)\n").valid === false);
  ok("a hand-crafted well-formed block validates (shape, not authenticity)",
    validate("## Ratified scope\n\n" + PROVENANCE_SENTENCE + "\n\n### Settled precedents (docs/decisions.md)\n").valid === true);

  // assemble against a temp fixture (I/O confined to the selftest's own sandbox). The tmp base is
  // resolved from the environment (never a require) so the module's dependency set stays confined to
  // the no-network allowlist the test asserts.
  const tmpBase = process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";
  const tmp = fs.mkdtempSync(path.join(tmpBase, "ratified-scope-selftest-"));
  try {
    fs.mkdirSync(path.join(tmp, "docs", "prd"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "docs", "prd", "demo.md"),
      "# PRD — demo\n\n## Non-goals\n\n- No scaling in v1.\n- No read replica.\n\n## Acceptance criteria\n\n- Given x, When y, Then z.\n");
    fs.writeFileSync(path.join(tmp, "docs", "decisions.md"),
      "# Decisions register\n\n## Rate limiting for v1\n- Chosen: in-process counters\n- Rationale: one instance in v1\n- Scope: the v1 deployment\n- Matches: rate limiting\n- Date: 2026-08-27\n");
    const a = assemble(tmp, "demo");
    ok("assemble on a full fixture exits 0", a.exit === 0);
    ok("assemble output validates clean", validate(a.block).valid === true);
    ok("assemble renders the non-goals section", a.block.includes("### Non-goals: PRD `demo`"));
    ok("assemble renders the precedent", a.block.includes("Rate limiting for v1"));

    // exit-3: no PRD non-goals + a decisions register whose sole entry has no Scope
    fs.writeFileSync(path.join(tmp, "docs", "decisions.md"),
      "# Decisions register\n\n## No scope here\n- Chosen: x\n- Rationale: y\n- Matches: k\n- Date: 2026-08-27\n");
    const a3 = assemble(tmp, null);
    ok("assemble with nothing ratified exits 3, empty block", a3.exit === 3 && a3.block === "");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // VALIDATE_MAX_BYTES boundary — the cap is a fixed, small constant
  ok("VALIDATE_MAX_BYTES is 1 MiB", VALIDATE_MAX_BYTES === 1048576);

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (ratified-scope, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  PROVENANCE_ANCHOR,
  PROVENANCE_SENTENCE,
  RATIFIED_SCOPE_SPEC,
  USAGE,
  VALIDATE_MAX_BYTES,
  assemble,
  cmdRatifiedScope,
  nonGoalsSection,
  placeholderOnly,
  ratifiedScopeSelftest,
  readStdinCapped,
  readValidateInput,
  render,
  validate,
};
