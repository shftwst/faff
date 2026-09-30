// ===========================================================================
// === region:factory — spec-review — FAFF-1157: the spec-review evidence carry channel ===
// The `## Spec-review evidence` block prep embeds in the committed spec (git-only carry
// fallback) holds the fenced `faff-contract:spec-review-verdict` evidence — the objections
// and their dispositions. `faff spec-review extract-evidence` is the deterministic reader
// graft's materialise step uses when no tracker comment carries the evidence, the sibling of
// `faff adr extract-intent`. Section-locate + fence-extract only: it does not validate the
// block (the caller pipes the output to `faff contract spec-review-verdict`). Pure: fs/stdin
// read only, no tracker, no network, no git.
// ===========================================================================

"use strict";

const fs = require("node:fs");
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

const SPEC_REVIEW_SPEC = { flags: { "--selftest": { arity: 0 }, "--file": { arity: 1 } }, positionals: { min: 0, max: 1, name: "verb selector" } };
const SPEC_REVIEW_USAGE = "usage: faff spec-review extract-evidence [--file <spec> | --file -]";

function cmdSpecReview(args) {
  if (args.includes("--selftest")) return specReviewSelftest();
  const { values, positionals, errors } = parseArgs(args, SPEC_REVIEW_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_USAGE);
  const action = positionals[0];
  if (action !== "extract-evidence") {
    process.stderr.write("faff spec-review: expected: extract-evidence (or --selftest)\n");
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

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { extractSpecReviewEvidence, cmdSpecReview, specReviewSelftest };
