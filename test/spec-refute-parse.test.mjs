// FAFF-938 — the deterministic parser for the spec-review refuter objection triple: pure
// `parseRefutation` coverage plus the CLI's fail-loud exit-code discipline. Zero live model calls —
// the parser is deterministic. Fixtures are built to match `review-call.mjs`'s actual EXIT-0 wire
// bytes (post-`normaliseCleanRefutation`/`refuteFindings`), never the raw `refute-*.md` prompt
// grammar — this is the exact seam a prior spec-review round corrected the spec on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseRefutation, CANONICAL_NO_FINDINGS, entrypoint_href } from "../plugin/skills/faffter-dark-spec-review/parse-refutation.mjs";
// FAFF-1056: cross-import the transport's shape-gate to pin the one-directional grammar property.
import { validateFindingsShape } from "../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PARSE = join(HERE, "..", "plugin", "skills", "faffter-dark-spec-review", "parse-refutation.mjs");
const AGG = join(HERE, "..", "plugin", "skills", "faffter-dark-spec-review", "aggregate.mjs");
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

const HEADER = "## Adversarial findings — openai/gpt-4 (chain[0], host: config)";

// A complete, well-formed gating section — the exit-0 wire shape a refuter emits for one objection.
function majorSection(title = "loop cannot terminate") {
  return [
    `### major: ${title}`,
    "- claim: the retry loop has no bound.",
    "- evidence: How, step 3.",
    "- predicted_consequence: hangs on empty --dir.",
    "- spec_anchor: how-the-loop",
  ].join("\n");
}

function fixture(...sections) {
  return [HEADER, "", ...sections].join("\n");
}

// ---- pure parseRefutation() ------------------------------------------------------------------

test("a complete gating objection parses with the full triple + anchor, outcome refuted", () => {
  const r = parseRefutation(fixture(majorSection()), "architectural");
  assert.equal(r.ok, true);
  assert.equal(r.entry.lens, "architectural");
  assert.equal(r.entry.outcome, "refuted");
  assert.equal(r.entry.model, "openai/gpt-4");
  assert.deepEqual(r.entry.objections, [{
    severity: "major",
    claim: "the retry loop has no bound.",
    evidence: "How, step 3.",
    predicted_consequence: "hangs on empty --dir.",
    spec_anchor: "how-the-loop",
  }]);
});

test("FAFF-990: a gating objection missing predicted_consequence DEGRADES (exit-0), carried without the key", () => {
  const section = [
    "### major: loop cannot terminate",
    "- claim: the retry loop has no bound.",
    "- evidence: How, step 3.",
    "- spec_anchor: how-the-loop",
  ].join("\n");
  const r = parseRefutation(fixture(section), "architectural");
  assert.equal(r.ok, true, "an absent enrichment field no longer voids the lens");
  assert.equal(r.entry.outcome, "refuted", "a degraded gating objection still gates");
  assert.deepEqual(r.entry.objections, [{
    severity: "major",
    claim: "the retry loop has no bound.",
    evidence: "How, step 3.",
    spec_anchor: "how-the-loop",
  }], "the present fields are carried; predicted_consequence is OMITTED, not sentinel-filled");
  assert.ok(!("predicted_consequence" in r.entry.objections[0]));
});

test("FAFF-990: a claim-ONLY gating objection (no evidence, no predicted_consequence) still gates, refuted", () => {
  const section = ["### major: oversized increment", "- claim: the plan bundles two epics"].join("\n");
  const r = parseRefutation(fixture(section), "methodology");
  assert.equal(r.ok, true);
  assert.equal(r.entry.outcome, "refuted");
  assert.deepEqual(r.entry.objections, [{ severity: "major", claim: "the plan bundles two epics" }]);
});

test("FAFF-990: a gating objection with NO claim is the one residual fault (missing_field:claim)", () => {
  const section = ["### major: something", "- evidence: only evidence, no claim"].join("\n");
  const r = parseRefutation(fixture(section), "architectural");
  assert.equal(r.ok, false);
  assert.equal(r.fault.lens, "architectural");
  assert.equal(r.fault.severity, "major");
  assert.equal(r.fault.missing_field, "claim");
});

test("a gating objection with an empty (whitespace-only) claim fails loud, same as absent", () => {
  const section = [
    "### critical: broken",
    "- claim:    ",
    "- evidence: e",
    "- predicted_consequence: p",
  ].join("\n");
  const r = parseRefutation(fixture(section), "infosec");
  assert.equal(r.ok, false);
  assert.equal(r.fault.missing_field, "claim");
  assert.equal(r.fault.severity, "critical");
});

test('predicted_consequence: "not separately stated" is a present value, not a fault', () => {
  const section = [
    "### minor: a taste-level nit",
    "- claim: could be cleaner.",
    "- evidence: sec 3.",
    "- predicted_consequence: not separately stated",
  ].join("\n");
  const r = parseRefutation(fixture(section), "QA");
  assert.equal(r.ok, true);
  assert.equal(r.entry.objections[0].predicted_consequence, "not separately stated");
});

test("the transport's canonical clean token parses to outcome clear, no objections, no required-field check", () => {
  const r = parseRefutation(fixture(CANONICAL_NO_FINDINGS), "QA");
  assert.equal(r.ok, true);
  assert.deepEqual(r.entry, { lens: "QA", outcome: "clear", objections: [], model: "openai/gpt-4" });
});

test("a genuine non-clean observation (not the canonical token) is carried, outcome clear, no fault", () => {
  const section = [
    "### observation: a stylistic note",
    "- claim: naming could be tighter.",
  ].join("\n");
  const r = parseRefutation(fixture(section), "methodology");
  assert.equal(r.ok, true);
  assert.equal(r.entry.outcome, "clear");
  assert.deepEqual(r.entry.objections, [{ severity: "observation", claim: "naming could be tighter." }]);
});

test("an observation missing every triple field is carried unchecked — not a parse fault", () => {
  const r = parseRefutation(fixture("### observation: nothing much to say"), "QA");
  assert.equal(r.ok, true);
  assert.equal(r.entry.outcome, "clear");
  assert.deepEqual(r.entry.objections, [{ severity: "observation" }]);
});

test("an [auto-refuted] downgraded gating section is classified observation and carried unchecked", () => {
  // Mirrors refuteFindings' exact rewrite: heading -> `### observation: [auto-refuted] <title>` with
  // a spliced `> auto-refuted: ...` blockquote line — a blockquote, not a `- key:` bullet, so it
  // neither starts nor terminates a triple value.
  const section = [
    "### observation: [auto-refuted] the syntax is broken",
    "- claim: this file has a syntax error.",
    "> auto-refuted: node --check passed on src/foo.js — syntax claim mechanically disproved (was major)",
  ].join("\n");
  const r = parseRefutation(fixture(section), "architectural");
  assert.equal(r.ok, true);
  assert.equal(r.entry.outcome, "clear");
  assert.equal(r.entry.objections[0].severity, "observation");
  assert.equal(r.entry.objections[0].claim.startsWith("this file has a syntax error."), true);
});

test("a wrapped multi-line bullet value is captured up to the next bullet, joined and trimmed", () => {
  const section = [
    "### major: wrapped claim",
    "- claim: the retry loop",
    "  has no upper bound",
    "  at all.",
    "- evidence: How, step 3.",
    "- predicted_consequence: hangs forever.",
  ].join("\n");
  const r = parseRefutation(fixture(section), "architectural");
  assert.equal(r.ok, true);
  assert.equal(r.entry.objections[0].claim, "the retry loop\n  has no upper bound\n  at all.");
});

test("spec_anchor is optional: absent stays absent, empty string stays absent, present is carried", () => {
  const noAnchor = [
    "### minor: no anchor named",
    "- claim: c",
    "- evidence: e",
    "- predicted_consequence: p",
  ].join("\n");
  let r = parseRefutation(fixture(noAnchor), "QA");
  assert.equal(r.ok, true);
  assert.ok(!("spec_anchor" in r.entry.objections[0]));

  const emptyAnchor = [
    "### minor: blank anchor",
    "- claim: c",
    "- evidence: e",
    "- predicted_consequence: p",
    "- spec_anchor:   ",
  ].join("\n");
  r = parseRefutation(fixture(emptyAnchor), "QA");
  assert.equal(r.ok, true);
  assert.ok(!("spec_anchor" in r.entry.objections[0]));

  r = parseRefutation(fixture(majorSection()), "QA");
  assert.equal(r.entry.objections[0].spec_anchor, "how-the-loop");
});

test("severity classification is case-insensitive and accepts bracketed form", () => {
  const bracketed = "### [Critical]: broken\n- claim: c\n- evidence: e\n- predicted_consequence: p";
  const r = parseRefutation(fixture(bracketed), "infosec");
  assert.equal(r.ok, true);
  assert.equal(r.entry.objections[0].severity, "critical");
  assert.equal(r.entry.outcome, "refuted");
});

test("a repeated bullet key: last one wins", () => {
  const section = [
    "### major: double claim",
    "- claim: first version",
    "- claim: second version",
    "- evidence: e",
    "- predicted_consequence: p",
  ].join("\n");
  const r = parseRefutation(fixture(section), "architectural");
  assert.equal(r.ok, true);
  assert.equal(r.entry.objections[0].claim, "second version");
});

test("two gating objections, one with no claim: the whole lens fails loud (not a partial pass)", () => {
  const good = majorSection("first");
  const bad = ["### critical: second", "- evidence: e", "- predicted_consequence: p"].join("\n");  // no claim
  const r = parseRefutation(fixture(good, bad), "architectural");
  assert.equal(r.ok, false);
  assert.equal(r.fault.title, "second");
  assert.equal(r.fault.missing_field, "claim");
});

test("a heading naming no recognised severity fails loud (defensive — the shape-gate should already reject it)", () => {
  const section = ["### not-a-severity: weird heading", "- claim: c"].join("\n");
  const r = parseRefutation(fixture(section), "QA");
  assert.equal(r.ok, false);
  assert.equal(r.fault.missing_field, null);
});

test("no ### section at all fails loud rather than silently passing as clean (defensive)", () => {
  const r = parseRefutation("just some prose, no findings heading", "QA");
  assert.equal(r.ok, false);
  assert.equal(r.fault.missing_field, null);
});

test("model is read verbatim from the preamble header line, absent when no header present", () => {
  const withHeader = parseRefutation(fixture(majorSection()), "architectural");
  assert.equal(withHeader.entry.model, "openai/gpt-4");
  const noHeader = parseRefutation(majorSection(), "architectural");
  assert.equal(noHeader.ok, true);
  assert.ok(!("model" in noHeader.entry));
});

test("regression: aggregate.mjs's verdict for a complete-triple set is unchanged by routing it through the parser first", () => {
  const r = parseRefutation(fixture(majorSection()), "architectural");
  assert.equal(r.ok, true);
  // hand-built equivalent of what the old prose hand-parse would have produced
  const handBuilt = {
    lens: "architectural", outcome: "refuted",
    objections: [{ severity: "major", claim: "the retry loop has no bound.", evidence: "How, step 3.", predicted_consequence: "hangs on empty --dir.", spec_anchor: "how-the-loop" }],
  };
  assert.deepEqual(r.entry.objections, handBuilt.objections);
});

test("entrypoint_href builds a comparable file: URL from a realpath-resolvable path", () => {
  assert.equal(entrypoint_href(null), null);
  assert.equal(entrypoint_href(PARSE), pathToFileURL(PARSE).href);
});

// ---- FAFF-1056: parser tolerance + model-transient reclassification + one-directional grammar ----

// A severity-less `### ` heading (leaked reasoning), the exact shape that used to void the lens.
function reasoningHeading(title = "Analysis") {
  return [`### ${title}`, "Let me re-read the spec's scope section before deciding.", "It looks internally consistent."].join("\n");
}

test("FAFF-1056: a leaked severity-less `### Analysis` preamble ahead of a well-formed gating section parses ok, carries the gating objection", () => {
  const r = parseRefutation(fixture(reasoningHeading("Analysis"), majorSection()), "methodology");
  assert.equal(r.ok, true, "the leaked reasoning heading no longer voids the lens");
  assert.equal(r.entry.outcome, "refuted");
  assert.equal(r.entry.objections.length, 1, "the severity-less section is skipped as prose; the gating objection survives");
  assert.equal(r.entry.objections[0].severity, "major");
  assert.equal(r.entry.objections[0].claim, "the retry loop has no bound.");
});

test("FAFF-1056: a clean `### observation: no findings` preceded by a severity-less reasoning heading parses clear, [] (fast-path re-keyed off recognised sections)", () => {
  const r = parseRefutation(fixture(reasoningHeading("My reasoning"), CANONICAL_NO_FINDINGS), "QA");
  assert.equal(r.ok, true);
  assert.equal(r.entry.outcome, "clear");
  assert.deepEqual(r.entry.objections, [], "the clean sentinel is never pushed as an objection");
});

test("FAFF-1056: N severity-less headings + one gating section — all preamble skipped, the objection survives", () => {
  const r = parseRefutation(fixture(reasoningHeading("Step 1"), reasoningHeading("Step 2"), majorSection("bounded?")), "architectural");
  assert.equal(r.ok, true);
  assert.equal(r.entry.objections.length, 1);
  assert.equal(r.entry.objections[0].severity, "major");
});

test("FAFF-1056: a body whose `###` sections are ALL severity-less still FAULTS (no findings to grade), missing_field null, distinctive reason", () => {
  const r = parseRefutation(fixture(reasoningHeading("Analysis"), reasoningHeading("More thoughts")), "infosec");
  assert.equal(r.ok, false, "a findings-less body is a genuine fault, never a silent clean pass");
  assert.equal(r.fault.missing_field, null);
  assert.match(r.fault.reason, /no recognised finding section/);
  assert.doesNotMatch(r.fault.reason, /names no known severity/, "the old per-section reason is gone — the one-directional property");
});

test("FAFF-1056: headerModel still extracts the model past a severity-less `### Analysis` preamble", () => {
  const r = parseRefutation(fixture(reasoningHeading("Analysis"), majorSection()), "architectural");
  assert.equal(r.ok, true);
  assert.equal(r.entry.model, "openai/gpt-4", "the header scan is preamble-scoped and unaffected by the tolerated `### ` reasoning heading");
});

// The one-directional grammar property (spec DONE — From WHY): for every body the transport shape-gate
// ADMITS, parseRefutation either parses (ok:true) or faults for a reason OTHER THAN "a section names no
// known severity". Deliberately NOT two-way agreement — the parser is strictly MORE permissive than the
// gate (it skips every severity-less section; the gate only requires one severity-bearing section to
// exist). Enumerated body table so the FAFF-1056 incident class cannot silently reopen.
test("FAFF-1056: one-directional grammar — every gate-admitted body parses or faults for a non-severity-less reason", () => {
  const bodies = {
    "(a) leaked `### Analysis` + gating major": fixture(reasoningHeading("Analysis"), majorSection()),
    "(b) clean sentinel after a severity-less preamble": fixture(reasoningHeading("My reasoning"), CANONICAL_NO_FINDINGS),
    "(c) two severity-less headings + one gating": fixture(reasoningHeading("Step 1"), reasoningHeading("Step 2"), majorSection()),
    "(d) only a well-formed `### minor:`": fixture(["### minor: a small nit", "- claim: could be tighter."].join("\n")),
    "well-formed critical only": fixture(["### critical: broken", "- claim: c", "- evidence: e", "- predicted_consequence: p"].join("\n")),
  };
  for (const [name, body] of Object.entries(bodies)) {
    assert.equal(validateFindingsShape(body).ok, true, `precondition: the shape-gate must ADMIT ${name}`);
    const r = parseRefutation(body, "architectural");
    if (r.ok) continue;  // parsed — property holds
    assert.doesNotMatch(
      r.fault.reason || "",
      /names no known severity/,
      `${name}: a gate-admitted body must never fault for the severity-less-heading reason`,
    );
  }
});

// Documented (NOT asserted-as-fixed) residual the fixture does not pin (spec DONE): a severity-WORDED
// but off-grammar heading (e.g. `### Critical Issue Found`) fails SEVERITY_HEADING_RE and is skipped as
// prose — an out-of-scope follow-up (fuzzy-severity), named so a later reader does not misread the green
// test as closing it. This asserts the current (tolerated-as-prose) behaviour, not a desired end-state.
test("FAFF-1056 (documented residual, out of scope): a severity-WORDED off-grammar heading is skipped as prose, not gated", () => {
  const body = fixture("### Critical Issue Found\nThe env teardown never runs.", majorSection());
  const r = parseRefutation(body, "infosec");
  assert.equal(r.ok, true);
  assert.equal(r.entry.objections.length, 1, "only the well-formed `### major:` gates; `### Critical Issue Found` is prose");
  assert.equal(r.entry.objections[0].severity, "major");
});

test("FAFF-1056: a model-transient unavailable lens routes through aggregate.mjs to `unavailable`, never needs-human", () => {
  const clearEntry = (lens) => ({ lens, outcome: "clear", objections: [] });
  const input = JSON.stringify({
    enabled_lenses: ["architectural", "infosec", "methodology", "QA"],
    refutations: [
      { lens: "methodology", outcome: "unavailable", kind: "model-transient", objections: [] },
      clearEntry("architectural"), clearEntry("infosec"), clearEntry("QA"),
    ],
  });
  const agg = spawnSync(process.execPath, [AGG], { input, encoding: "utf8" });
  assert.equal(agg.status, 0, agg.stderr);
  const json = agg.stdout.split("\n").find((l) => l.trim().startsWith("{"));
  const verdict = JSON.parse(json);
  assert.equal(verdict.verdict, "unavailable", "a model-transient swing lens surfaces the outage verdict");
  assert.notEqual(verdict.verdict, "needs-human", "a model-transient fault never hits the config-fault floor");
  assert.ok(verdict.objections.some((o) => o.lens === "methodology" && o.severity === "major"));
});

// ---- CLI --------------------------------------------------------------------------------------

test("CLI: exit 0, emits the RefutationEntry JSON on stdout for a complete objection", () => {
  const res = spawnSync(process.execPath, [PARSE, "--lens", "architectural"], { input: fixture(majorSection()), encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  const entry = JSON.parse(res.stdout);
  assert.equal(entry.lens, "architectural");
  assert.equal(entry.outcome, "refuted");
  assert.equal(entry.objections[0].claim, "the retry loop has no bound.");
  assert.equal(entry.objections[0].evidence, "How, step 3.");
  assert.equal(entry.objections[0].predicted_consequence, "hangs on empty --dir.");
  assert.equal(entry.model, "openai/gpt-4");
});

test("FAFF-990 CLI: predicted_consequence absent now DEGRADES to exit 0 with the claim carried", () => {
  const section = ["### major: loop cannot terminate", "- claim: c", "- evidence: e"].join("\n");
  const res = spawnSync(process.execPath, [PARSE, "--lens", "architectural"], { input: fixture(section), encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  const entry = JSON.parse(res.stdout);
  assert.equal(entry.outcome, "refuted");
  assert.equal(entry.objections[0].claim, "c");
  assert.ok(!("predicted_consequence" in entry.objections[0]));
});

test("FAFF-1056 CLI: a residual fault (no claim) WITHOUT --truncated -> exit 1, stdout kind model-transient (was config-fault)", () => {
  const section = ["### major: something", "- evidence: e"].join("\n");  // no claim
  const res = spawnSync(process.execPath, [PARSE, "--lens", "qa"], { input: fixture(section), encoding: "utf8" });
  assert.equal(res.status, 1);
  // FAFF-1056: a served, shape-valid, off-grammar body is a model-quality transient, not a human
  // config bug — so the non-truncated residual fault now carries `model-transient` and routes to the
  // swing `unavailable` verdict (retry/hold), never the config-fault floor -> needs-human park.
  assert.deepEqual(JSON.parse(res.stdout), { lens: "qa", outcome: "unavailable", kind: "model-transient", objections: [] });
  assert.match(res.stderr, /missing_field=claim/);
  assert.match(res.stderr, /truncated=false/);
});

test("FAFF-990 CLI: the same residual fault WITH --truncated -> exit 3, stdout kind infra-configured", () => {
  const section = ["### major: something", "- evidence: e"].join("\n");  // no claim
  const res = spawnSync(process.execPath, [PARSE, "--lens", "qa", "--truncated"], { input: fixture(section), encoding: "utf8" });
  assert.equal(res.status, 3);
  assert.deepEqual(JSON.parse(res.stdout), { lens: "qa", outcome: "unavailable", kind: "infra-configured", objections: [] });
  assert.match(res.stderr, /truncated=true/);
});

test("FAFF-990 CLI: a truncated-but-complete gating objection parses exit 0 refuted (no hold, --truncated irrelevant)", () => {
  const res = spawnSync(process.execPath, [PARSE, "--lens", "architectural", "--truncated"], { input: fixture(majorSection()), encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).outcome, "refuted");
});

test("CLI: the canonical clean token exits 0 with outcome clear and empty objections", () => {
  const res = spawnSync(process.execPath, [PARSE, "--lens", "QA"], { input: fixture(CANONICAL_NO_FINDINGS), encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  const entry = JSON.parse(res.stdout);
  assert.equal(entry.outcome, "clear");
  assert.deepEqual(entry.objections, []);
});

test("CLI: missing --lens exits non-zero", () => {
  const res = spawnSync(process.execPath, [PARSE], { input: fixture(majorSection()), encoding: "utf8" });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /--lens/);
});

// ---- Integration smoke test (spec section 8) ---------------------------------------------------

test("smoke: a parsed refutation entry pipes through aggregate.mjs to a founded verdict block", () => {
  const parsed = spawnSync(process.execPath, [PARSE, "--lens", "architectural"], { input: fixture(majorSection()), encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr);
  const entry = JSON.parse(parsed.stdout);

  const clearEntry = (lens) => ({ lens, outcome: "clear", objections: [] });
  const input = JSON.stringify({
    enabled_lenses: ["architectural", "infosec", "methodology", "QA"],
    refutations: [entry, clearEntry("infosec"), clearEntry("methodology"), clearEntry("QA")],
  });
  const agg = spawnSync(process.execPath, [AGG], { input, encoding: "utf8" });
  assert.equal(agg.status, 0, agg.stderr);
  assert.match(agg.stdout, /```faff-contract:spec-review-verdict/);
  const json = agg.stdout.split("\n").find((l) => l.trim().startsWith("{"));
  const contract = spawnSync(process.execPath, [BIN, "contract", "spec-review-verdict"], { input: json, encoding: "utf8" });
  assert.equal(contract.status, 0, `contract validation failed: ${contract.stdout}${contract.stderr}`);
  const verdict = JSON.parse(json);
  assert.equal(verdict.verdict, "revise");
  assert.equal(verdict.objections[0].claim, "the retry loop has no bound.");
});
