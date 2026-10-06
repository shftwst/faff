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
// `faff spec-review select-evidence --dir <scratch>` is the deterministic EVIDENCE SELECTOR
// prep runs at its terminal review seam before stamping dispositions. It picks the highest-`n`
// objection-bearing `round-<n>.json` across the WHOLE loop, else the empty terminal approve.
// It deliberately does NOT scope to the convergence `window_start`: FAFF-1157 scoped selection
// to `[window_start .. n]`, but that window resets to the current round on a reviewer swap /
// unpinnable-reset / pin-capture miss (spec-review-window --govern), so a genuinely multi-round
// review anchored EMPTY evidence whenever every objection-bearing round sat before the last
// reset. Selection only — prep still stamps `disposition` mechanically on the returned record.
// Pure + fail-safe: a malformed round file is skipped, an absent/unreadable dir yields the
// empty approve (audit-only, never blocks).
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");

const EVIDENCE_HEADING = "spec-review evidence";
const EVIDENCE_FENCE_RE = /```faff-contract:spec-review-verdict\s*\n([\s\S]*?)\n```/;

// extractSpecReviewEvidence(text) -> the JSON body of the `faff-contract:spec-review-verdict`
// fenced block found under a `## Spec-review evidence` heading (case-insensitive, any heading
// level), or null when no such section or no fenced block is present. The section runs to the
// next heading at the same-or-shallower level, so a fenced block after the section is ignored.
function extractSpecReviewEvidence(text) {
  const lines = String(text).split(/\r?\n/);
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/;
  let startIdx = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[2].trim().toLowerCase() === EVIDENCE_HEADING) {
      startIdx = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[1].length <= startLevel) { endIdx = i; break; }
  }
  const section = lines.slice(startIdx, endIdx).join("\n");
  const fence = section.match(EVIDENCE_FENCE_RE);
  return fence ? fence[1] : null;
}

// selectEvidenceVerdict(dir) -> the raw { verdict, objections } evidence record prep stamps.
// The highest-`n` round-<n>.json whose `objections` array is non-empty, scanned across EVERY
// round in the dir (never the convergence window — see the header), else the empty terminal
// approve `{verdict:"approve", objections:[]}`. Pure + fail-safe: a malformed round is skipped,
// an absent/unreadable dir yields the empty approve.
function selectEvidenceVerdict(dir) {
  let names;
  try { names = fs.readdirSync(dir); }
  catch { return { verdict: "approve", objections: [] }; }
  const rounds = [];
  for (const name of names) {
    const m = name.match(/^round-(\d+)\.json$/);
    if (m) rounds.push({ n: parseInt(m[1], 10), path: path.join(dir, name) });
  }
  rounds.sort((a, b) => b.n - a.n); // highest-n first
  for (const r of rounds) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(r.path, "utf8")); }
    catch { continue; } // malformed round — skip, never crash
    if (rec && typeof rec === "object" && !Array.isArray(rec) && Array.isArray(rec.objections) && rec.objections.length > 0) {
      return { verdict: typeof rec.verdict === "string" ? rec.verdict : "revise", objections: rec.objections };
    }
  }
  return { verdict: "approve", objections: [] };
}

const SPEC_REVIEW_SPEC = { flags: { "--selftest": { arity: 0 }, "--file": { arity: 1 }, "--dir": { arity: 1 } }, positionals: { min: 0, max: 1, name: "verb selector" } };
const SPEC_REVIEW_USAGE = "usage: faff spec-review (extract-evidence [--file <spec> | --file -] | select-evidence --dir <scratch>)";

function cmdSpecReview(args) {
  if (args.includes("--selftest")) return specReviewSelftest();
  const { values, positionals, errors } = parseArgs(args, SPEC_REVIEW_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_USAGE);
  const action = positionals[0];
  if (action === "select-evidence") {
    const dir = values["--dir"];
    if (dir == null) {
      process.stderr.write("faff spec-review select-evidence: --dir <scratch> is required\n");
      return 2;
    }
    process.stdout.write(JSON.stringify(selectEvidenceVerdict(dir)) + "\n");
    return 0;
  }
  if (action !== "extract-evidence") {
    process.stderr.write("faff spec-review: expected: extract-evidence | select-evidence (or --selftest)\n");
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

  // --- select-evidence: whole-loop selection, never window-scoped ---
  {
    const os = require("node:os");
    const objs = (lens) => [{ lens, severity: "major", claim: "c" }];
    const mk = (dir, n, verdict, objections) => fs.writeFileSync(path.join(dir, `round-${n}.json`), JSON.stringify({ verdict, objections }));

    // The regression this verb exists to kill: an objection-bearing round-1 followed by a
    // clean round-2 approve. A window-scoped selector that reset window_start to 2 would
    // anchor EMPTY evidence; the whole-loop selector picks round-1's objections.
    const t1 = fs.mkdtempSync(path.join(os.tmpdir(), "faff-sel-reset-"));
    try {
      mk(t1, 1, "revise", objs("architectural"));
      mk(t1, 2, "approve", []);
      const r = selectEvidenceVerdict(t1);
      ok("select: objection-bearing round-1 before a clean approve is NOT dropped", r.verdict === "revise" && r.objections.length === 1 && r.objections[0].lens === "architectural");
    } finally { fs.rmSync(t1, { recursive: true, force: true }); }

    // Highest-n objection-bearing round wins, numerically (round-10 beats round-2).
    const t2 = fs.mkdtempSync(path.join(os.tmpdir(), "faff-sel-maxn-"));
    try {
      mk(t2, 2, "revise", objs("qa"));
      mk(t2, 10, "reject-approach", objs("infosec"));
      mk(t2, 11, "approve", []);
      const r = selectEvidenceVerdict(t2);
      ok("select: highest-n objection-bearing round wins (numeric, not lexical)", r.verdict === "reject-approach" && r.objections[0].lens === "infosec");
    } finally { fs.rmSync(t2, { recursive: true, force: true }); }

    // No objection-bearing round (only a clean approve) → the empty terminal approve.
    const t3 = fs.mkdtempSync(path.join(os.tmpdir(), "faff-sel-clean-"));
    try {
      mk(t3, 1, "approve", []);
      const r = selectEvidenceVerdict(t3);
      ok("select: no objections anywhere → empty terminal approve", r.verdict === "approve" && r.objections.length === 0);
    } finally { fs.rmSync(t3, { recursive: true, force: true }); }

    // Malformed round is skipped, never crashes; a lower-n valid round still wins.
    const t4 = fs.mkdtempSync(path.join(os.tmpdir(), "faff-sel-malformed-"));
    try {
      mk(t4, 1, "revise", objs("architectural"));
      fs.writeFileSync(path.join(t4, "round-2.json"), "{ not json");
      const r = selectEvidenceVerdict(t4);
      ok("select: malformed highest round skipped, lower valid round selected", r.objections.length === 1 && r.objections[0].lens === "architectural");
    } finally { fs.rmSync(t4, { recursive: true, force: true }); }

    // Absent/unreadable dir → empty approve (audit-only, never blocks).
    ok("select: absent dir → empty approve, no throw", (() => { const r = selectEvidenceVerdict(path.join(os.tmpdir(), "faff-sel-nope-" + Date.now())); return r.verdict === "approve" && r.objections.length === 0; })());

    // CLI round-trip.
    const t5 = fs.mkdtempSync(path.join(os.tmpdir(), "faff-sel-cli-"));
    try {
      mk(t5, 1, "revise", objs("architectural"));
      mk(t5, 2, "approve", []);
      const origWrite = process.stdout.write.bind(process.stdout);
      let out = "";
      process.stdout.write = (s) => { out += String(s); return true; };
      let code;
      try { code = cmdSpecReview(["select-evidence", "--dir", t5]); } finally { process.stdout.write = origWrite; }
      ok("CLI select-evidence → exit 0, prints the objection-bearing record", code === 0 && JSON.parse(out).objections[0].lens === "architectural");
      const noDir = cmdSpecReview(["select-evidence"]);
      ok("CLI select-evidence without --dir → exit 2", noDir === 2);
    } finally { fs.rmSync(t5, { recursive: true, force: true }); }
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { extractSpecReviewEvidence, selectEvidenceVerdict, cmdSpecReview, specReviewSelftest };
