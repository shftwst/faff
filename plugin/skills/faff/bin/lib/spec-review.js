// ===========================================================================
// === region:factory — spec-review — FAFF-1157: the spec-review evidence carry channel ===
// The `## Spec-review evidence` block prep embeds in the committed spec (git-only carry
// fallback) holds the fenced `faff-contract:spec-review-verdict` evidence — the objections
// and their dispositions. `faff spec-review extract-evidence` is the deterministic reader
// graft's materialise step uses when no tracker comment carries the evidence, the sibling of
// `faff adr extract-intent`. Section-locate + fence-extract only: it does not validate the
// block (the caller pipes the output to `faff contract spec-review-verdict`). Pure: fs/stdin
// read only, no tracker, no network, no git.
//
// `faff spec-review collate-evidence --dir <scratch>` (FAFF-1267) is the deterministic collator prep
// runs at its terminal review seam: every objection from every valid `round-<n>.json` as its own
// item, optionally with a dispositions file folded in, and `--comment` renders the whole carried
// comment with its sha256 line. The collator and renderer live in the governance module
// `evidence-collate.js`; this verb is the thin factory shell over them.
//
// `faff spec-review carry-check --before F --after F [--root DIR]` (FAFF-1271) is the deterministic
// gate that lets a stale-refresh whose diff is only a verified directory move, a line reference,
// the provenance stamp, the `build-tier:` line, or the fixed refresh-note line keep its prior
// review instead of re-running the whole Spec-review gate. The classifier is the pure
// `spec-refresh-carry.js` module; this verb is the thin I/O shell (two file reads + the on-disk
// existence checks `classifyRefresh`'s injected `pathExists` needs) over it.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES } = require("./review-vocab");
const { resolveKnownSecretValues } = require("./redact");
const { findRoot } = require("./shared-infra");
const { classifyRefresh } = require("./spec-refresh-carry");
const {
  EvidenceRefusal, applyDispositions, collateSpecReviewRounds, extractSpecReviewEvidence, renderSpecReviewComment,
} = require("./evidence-collate");

// routeRejectApproach(record) -> { route } | { error }. Pure partition of a validated
// `reject-approach` verdict's objections over {lens, severity}: a methodology objection at
// blocker/major sends the spec to plot (carrying every design-lens objection as {lens, severity});
// anything else re-specs in place on prep (nothing carried). Accepts the raw block body or the
// `faff contract spec-review-verdict` stdout. No fs, no network.
function routeRejectApproach(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return { error: "verdict record must be a JSON object" };
  if (record.verdict !== "reject-approach") return { error: `route applies to reject-approach only (got ${record.verdict})` };
  if (record.conformant === false) return { error: "verdict is not conformant" };
  if (!Array.isArray(record.objections) || record.objections.length === 0) return { error: "reject-approach carries no objections" };
  for (let i = 0; i < record.objections.length; i++) {
    const o = record.objections[i];
    const lens = o && o.lens;
    const severity = o && o.severity;
    if (!SPEC_REVIEW_LENSES.includes(lens)) return { error: `objection[${i}] lens ${JSON.stringify(lens)} not in {${SPEC_REVIEW_LENSES.join(",")}}` };
    if (!SPEC_REVIEW_SEVERITIES.includes(severity)) return { error: `objection[${i}] severity ${JSON.stringify(severity)} not in {${SPEC_REVIEW_SEVERITIES.join(",")}}` };
  }
  const scope = record.objections.filter((o) => o.lens === "methodology" && (o.severity === "blocker" || o.severity === "major"));
  if (scope.length > 0) {
    const design = record.objections.filter((o) => o.lens !== "methodology").map((o) => ({ lens: o.lens, severity: o.severity }));
    return { route: { destination: "plot", reason: "methodology-major-or-above", carried_design_objections: design } };
  }
  return { route: { destination: "prep", reason: "no-methodology-major", carried_design_objections: [] } };
}

const SPEC_REVIEW_SPEC = { flags: { "--selftest": { arity: 0 }, "--file": { arity: 1 }, "--dir": { arity: 1 }, "--dispositions": { arity: 1 }, "--comment": { arity: 0 }, "--before": { arity: 1 }, "--after": { arity: 1 }, "--root": { arity: 1 } }, positionals: { min: 0, max: 1, name: "verb selector" } };
const SPEC_REVIEW_USAGE = "usage: faff spec-review (extract-evidence [--file <spec> | --file -] | collate-evidence --dir <scratch> [--dispositions <file>] [--comment] | carry-check --before <file> --after <file> [--root <dir>] | route [--file <verdict.json> | --file -])";
const CARRY_CHECK_USAGE = "usage: faff spec-review carry-check --before <file> --after <file> [--root <dir>]";

// makePathExists(root) -> pathExists(token) -> boolean. The sole I/O the carry-check verb adds
// on top of classifyRefresh's two file reads: joins a repo-relative token to `root`, resolves its
// real path (following symlinks), and returns true only when it exists AND that real path lies
// inside root's own real path. An absolute token, a ".." escape, or a symlink pointing outside
// root all resolve the same way here (the relative-path containment check catches every one
// uniformly) — none of them count as existing. No git.
function makePathExists(root) {
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { return () => false; }
  return function pathExists(token) {
    if (path.isAbsolute(token)) return false;
    const joined = path.join(root, token);
    let real;
    try { real = fs.realpathSync(joined); } catch { return false; }
    const rel = path.relative(realRoot, real);
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  };
}

function cmdCarryCheck(values) {
  const fail = (code, message) => { process.stderr.write(`faff spec-review carry-check: ${message}\n`); return code; };
  if (values["--before"] == null || values["--after"] == null) return fail(2, "--before <file> and --after <file> are required");
  let beforeText;
  let afterText;
  try { beforeText = fs.readFileSync(values["--before"], "utf8"); } catch (e) { return fail(2, `cannot read ${values["--before"]}: ${e.message}`); }
  try { afterText = fs.readFileSync(values["--after"], "utf8"); } catch (e) { return fail(2, `cannot read ${values["--after"]}: ${e.message}`); }
  let root;
  try { root = values["--root"] || findRoot(); } catch (e) { return fail(2, `cannot resolve --root: ${e.message}`); }
  const pathExists = makePathExists(root);
  const result = classifyRefresh(beforeText, afterText, pathExists);
  process.stdout.write(JSON.stringify(result) + "\n");
  return result.carry ? 0 : 1;
}

function cmdCollateEvidence(values) {
  const fail = (code, message) => { process.stderr.write(`faff spec-review collate-evidence: ${message}\n`); return code; };
  const dir = values["--dir"];
  if (dir == null) return fail(2, "--dir <scratch> is required");
  let secrets;
  try { secrets = resolveKnownSecretValues(findRoot()); } catch { return fail(2, "the redaction config could not be read; nothing printed"); }
  let collated;
  try { collated = collateSpecReviewRounds(dir, secrets); } catch { return fail(2, `cannot read round files from ${dir}`); }
  for (const name of collated.skipped) process.stderr.write(`faff spec-review collate-evidence: skipped ${name} (not a conformant round)\n`);
  let record = collated.record;
  const dispositionsPath = values["--dispositions"];
  if (dispositionsPath != null) {
    let raw;
    try { raw = fs.readFileSync(dispositionsPath, "utf8"); } catch { return fail(2, `cannot read ${dispositionsPath}`); }
    let dispositions;
    try { dispositions = JSON.parse(raw); } catch { return fail(1, "the dispositions file is not valid JSON"); }
    try { record = applyDispositions(record, dispositions, secrets); } catch (e) {
      if (e instanceof EvidenceRefusal) return fail(1, e.message);
      throw e;
    }
  }
  process.stdout.write(values["--comment"] ? renderSpecReviewComment(record, collated.rounds) : JSON.stringify(record) + "\n");
  return 0;
}

function cmdSpecReview(args) {
  if (args.includes("--selftest")) return specReviewSelftest();
  const { values, positionals, errors } = parseArgs(args, SPEC_REVIEW_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_USAGE);
  const action = positionals[0];
  if (action === "collate-evidence") return cmdCollateEvidence(values);
  if (action === "carry-check") {
    if (positionals.length > 1) return usageError([{ code: "too-many-positionals", detail: "unexpected argument(s)" }], CARRY_CHECK_USAGE);
    return cmdCarryCheck(values);
  }
  if (action === "route") {
    const routePath = values["--file"];
    const fromFile = routePath != null && routePath !== "-";
    let rec;
    try {
      rec = JSON.parse(fromFile ? fs.readFileSync(routePath, "utf8") : fs.readFileSync(0, "utf8"));
    } catch (e) {
      process.stderr.write(`faff spec-review route: cannot read verdict JSON from ${fromFile ? routePath : "stdin"}: ${e.message}\n`);
      return 2;
    }
    const r = routeRejectApproach(rec);
    if (r.error) {
      process.stderr.write(`faff spec-review route: ${r.error}\n`);
      return 2;
    }
    process.stdout.write(JSON.stringify(r.route) + "\n");
    return 0;
  }
  if (action !== "extract-evidence") {
    process.stderr.write("faff spec-review: expected: extract-evidence | collate-evidence | carry-check | route (or --selftest)\n");
    return 2;
  }
  const filePath = values["--file"];
  const readFromFile = filePath != null && filePath !== "-";
  let body;
  try {
    body = readFromFile ? fs.readFileSync(filePath, "utf8") : fs.readFileSync(0, "utf8");
  } catch (e) {
    process.stderr.write(`faff spec-review extract-evidence: cannot read ${readFromFile ? filePath : "stdin"}: ${e.message}\n`);
    return 2;
  }
  const evidence = extractSpecReviewEvidence(body);
  if (evidence == null) {
    process.stderr.write("faff spec-review extract-evidence: no '## Spec-review evidence' block found\n");
    return 1;
  }
  process.stdout.write(evidence.replace(/\s+$/, "") + "\n");
  return 0;
}

function runSpecReviewForSelftest(args, stdin) {
  const origWrite = process.stdout.write.bind(process.stdout);
  let stdout = "";
  process.stdout.write = (s) => { stdout += String(s); return true; };
  const os = require("node:os");
  const path = require("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-sre-cli-"));
  const spec = path.join(tmp, "spec.md");
  fs.writeFileSync(spec, stdin);
  try {
    const code = cmdSpecReview([...args, "--file", spec]);
    return { code, stdout };
  } finally {
    process.stdout.write = origWrite;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function specReviewSelftest() {
  let fail = 0;
  const ok = (label, cond) => { console.log(`${cond ? "ok  " : "FAIL"} ${label}`); if (!cond) fail++; };

  const block = '```faff-contract:spec-review-verdict\n{"verdict":"revise","objections":[{"lens":"architectural","severity":"major","disposition":"fixed"}]}\n```';
  const withEvidence = `# A spec\n\nBody.\n\n## Spec-review evidence\n\n${block}\n`;
  ok("extract returns the fenced JSON body", extractSpecReviewEvidence(withEvidence) === '{"verdict":"revise","objections":[{"lens":"architectural","severity":"major","disposition":"fixed"}]}');

  ok("no heading → null", extractSpecReviewEvidence("# A spec\n\nBody only.\n") === null);
  ok("heading but no fenced block → null", extractSpecReviewEvidence("## Spec-review evidence\n\nprose, no fence\n") === null);

  // A fenced block AFTER the section (under a later same-level heading) is not extracted.
  const fenceOutside = `## Spec-review evidence\n\nno fence here\n\n## Later\n\n${block}\n`;
  ok("fenced block outside the section → null", extractSpecReviewEvidence(fenceOutside) === null);

  // Case-insensitive heading match.
  ok("case-insensitive heading", extractSpecReviewEvidence(`### SPEC-REVIEW EVIDENCE\n\n${block}\n`) !== null);

  // CLI round-trip.
  const cliHit = runSpecReviewForSelftest(["extract-evidence"], withEvidence);
  ok("CLI extract-evidence hit → exit 0, prints body", cliHit.code === 0 && cliHit.stdout.trim() === '{"verdict":"revise","objections":[{"lens":"architectural","severity":"major","disposition":"fixed"}]}');
  const cliMiss = runSpecReviewForSelftest(["extract-evidence"], "# spec\n\nnothing\n");
  ok("CLI no evidence → exit 1", cliMiss.code === 1);
  const cliBadVerb = runSpecReviewForSelftest(["nope"], withEvidence);
  ok("CLI unknown verb → exit 2", cliBadVerb.code === 2);

  // --- collate-evidence: whole-loop collation, one item per objection ---
  {
    const os = require("node:os");
    const mk = (dir, n, verdict, objections) => fs.writeFileSync(path.join(dir, `round-${n}.json`), JSON.stringify({ verdict, objections }));
    const obj = (lens) => ({ lens, severity: "major", claim: "c" });
    const t = fs.mkdtempSync(path.join(os.tmpdir(), "faff-collate-"));
    try {
      mk(t, 1, "revise", [obj("architectural"), obj("QA")]);
      mk(t, 2, "approve", []);
      const { record } = collateSpecReviewRounds(t, []);
      ok("collate: an objection-bearing round before a clean approve is kept, one item per objection", record.verdict === "revise" && record.final_verdict === "approve" && record.rounds_total === 2 && record.objections.length === 2);
      ok("collate: objection keys are <round>#<index>", record.objections[0].key === "1#0" && record.objections[1].key === "1#1");
      fs.writeFileSync(path.join(t, "round-3.json"), "{ not json");
      ok("collate: a malformed round is skipped and named", collateSpecReviewRounds(t, []).skipped.join() === "round-3.json");
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = () => true;
      let code;
      try { code = cmdSpecReview(["collate-evidence", "--dir", t]); } finally { process.stdout.write = origWrite; }
      ok("CLI collate-evidence → exit 0", code === 0);
      ok("CLI collate-evidence without --dir → exit 2", cmdSpecReview(["collate-evidence"]) === 2);
    } finally { fs.rmSync(t, { recursive: true, force: true }); }
  }

  // --- carry-check: paths-only refresh keeps its prior review ---
  {
    const os = require("node:os");
    const t = fs.mkdtempSync(path.join(os.tmpdir(), "faff-carry-"));
    try {
      fs.mkdirSync(path.join(t, "docs", "archive", "design"), { recursive: true });
      fs.writeFileSync(path.join(t, "docs", "archive", "design", "x.md"), "x");
      const beforeFile = path.join(t, "before.md");
      const afterFile = path.join(t, "after.md");
      const before = [
        "> Spec: faffter-dark-nlspec . 2026-10-10",
        "",
        "**Chosen:** see docs/design/x.md",
        "",
        "build-tier: standard",
        "confidence: high",
        "spec-review: approve",
      ].join("\n");
      const after = [
        "> Spec: faffter-dark-nlspec . 2026-10-14",
        "",
        "**Chosen:** see docs/archive/design/x.md",
        "",
        "> Revised on 2026-10-14: paths refreshed",
        "",
        "build-tier: complex",
        "confidence: high",
        "spec-review: approve",
      ].join("\n");
      fs.writeFileSync(beforeFile, before);
      fs.writeFileSync(afterFile, after);

      const origWrite = process.stdout.write.bind(process.stdout);
      let stdout = "";
      process.stdout.write = (s) => { stdout += String(s); return true; };
      let code;
      try { code = cmdSpecReview(["carry-check", "--before", beforeFile, "--after", afterFile, "--root", t]); } finally { process.stdout.write = origWrite; }
      ok("carry-check: verified directory move → exit 0, carry:true", code === 0 && JSON.parse(stdout).carry === true && JSON.parse(stdout).reason === "paths-only");

      // No carry: the old path still exists too (unverified move).
      fs.mkdirSync(path.join(t, "docs", "design"), { recursive: true });
      fs.writeFileSync(path.join(t, "docs", "design", "x.md"), "x");
      stdout = "";
      process.stdout.write = (s) => { stdout += String(s); return true; };
      try { code = cmdSpecReview(["carry-check", "--before", beforeFile, "--after", afterFile, "--root", t]); } finally { process.stdout.write = origWrite; }
      ok("carry-check: both paths exist → exit 1, path-move-unverified", code === 1 && JSON.parse(stdout).reason === "path-move-unverified");

      ok("carry-check without --before/--after → exit 2", cmdSpecReview(["carry-check", "--after", afterFile]) === 2 && cmdSpecReview(["carry-check", "--before", beforeFile]) === 2);
      ok("carry-check unreadable file → exit 2, nothing printed", (() => {
        let out = "";
        const w = process.stdout.write.bind(process.stdout);
        process.stdout.write = (s) => { out += String(s); return true; };
        let c;
        try { c = cmdSpecReview(["carry-check", "--before", path.join(t, "no-such.md"), "--after", afterFile]); } finally { process.stdout.write = w; }
        return c === 2 && out === "";
      })());
    } finally { fs.rmSync(t, { recursive: true, force: true }); }
  }

  // --- route: severity-aware reject-approach destination ---
  {
    const rv = (objections, extra) => JSON.stringify({ verdict: "reject-approach", objections, ...extra });
    const prep = runSpecReviewForSelftest(["route"], rv([{ lens: "methodology", severity: "minor" }, { lens: "QA", severity: "minor" }]));
    ok("route: methodology minor + design → prep, nothing carried", prep.code === 0 && (() => { const j = JSON.parse(prep.stdout); return j.destination === "prep" && j.carried_design_objections.length === 0; })());
    const plot = runSpecReviewForSelftest(["route"], rv([{ lens: "methodology", severity: "major" }, { lens: "QA", severity: "minor", claim: "x" }]));
    ok("route: methodology major + design → plot, design carried", plot.code === 0 && (() => { const j = JSON.parse(plot.stdout); return j.destination === "plot" && JSON.stringify(j.carried_design_objections) === '[{"lens":"QA","severity":"minor"}]'; })());
    const bad = runSpecReviewForSelftest(["route"], JSON.stringify({ verdict: "revise", objections: [{ lens: "architectural", severity: "major" }] }));
    ok("route: non-reject-approach → exit 2, empty stdout", bad.code === 2 && bad.stdout === "");
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { routeRejectApproach, extractSpecReviewEvidence, cmdSpecReview, specReviewSelftest, makePathExists };
