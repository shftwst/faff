// FAFF-1157 — spec-review evidence carry + additive objection enrichment.
// Covers: the `faff spec-review extract-evidence` section-locator + fence-extractor (the git-only
// carry fallback graft's materialise step reads), its `--selftest`, the extract→`faff contract
// spec-review-verdict` round-trip, and the field-agnostic invariant: the reviewer-blind
// convergence/churn detectors produce byte-identical results whether or not the round records
// carry the new disposition/refutation/disposition_rationale objection fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { specReviewSelftest, extractSpecReviewEvidence } from "../plugin/skills/faff/bin/lib/spec-review.js";

const BLOCK = '```faff-contract:spec-review-verdict\n{"verdict":"revise","objections":[{"lens":"architectural","severity":"major","disposition":"fixed"}]}\n```';
const SPEC_WITH_EVIDENCE = `# A spec\n\nBody.\n\n## Spec-review evidence\n\n${BLOCK}\n`;
const EVIDENCE_JSON = '{"verdict":"revise","objections":[{"lens":"architectural","severity":"major","disposition":"fixed"}]}';

test("specReviewSelftest() returns 0 in-process", () => {
  assert.equal(specReviewSelftest(), 0);
});

test("extractSpecReviewEvidence returns the fenced JSON body under the heading", () => {
  assert.equal(extractSpecReviewEvidence(SPEC_WITH_EVIDENCE), EVIDENCE_JSON);
});

test("extractSpecReviewEvidence returns null with no heading or no fenced block", () => {
  assert.equal(extractSpecReviewEvidence("# spec\n\nbody only\n"), null);
  assert.equal(extractSpecReviewEvidence("## Spec-review evidence\n\nprose, no fence\n"), null);
});

test("extractSpecReviewEvidence ignores a fenced block outside the section", () => {
  const outside = `## Spec-review evidence\n\nno fence\n\n## Later\n\n${BLOCK}\n`;
  assert.equal(extractSpecReviewEvidence(outside), null);
});

test("CLI extract-evidence hit → exit 0 prints the body; miss → exit 1; read error → exit 2", () => {
  const hit = runCli(["spec-review", "extract-evidence", "--file", "-"], { input: SPEC_WITH_EVIDENCE });
  assert.equal(hit.code, 0);
  assert.equal(hit.stdout.trim(), EVIDENCE_JSON);

  const miss = runCli(["spec-review", "extract-evidence", "--file", "-"], { input: "# spec\n\nnothing\n" });
  assert.equal(miss.code, 1);

  const unreadable = runCli(["spec-review", "extract-evidence", "--file", "/no/such/spec.md"]);
  assert.equal(unreadable.code, 2);
});

test("extract-evidence output pipes conformant to `faff contract spec-review-verdict`", () => {
  const extracted = runCli(["spec-review", "extract-evidence", "--file", "-"], { input: SPEC_WITH_EVIDENCE });
  assert.equal(extracted.code, 0);
  const validated = runCli(["contract", "spec-review-verdict"], { input: extracted.stdout });
  assert.equal(validated.code, 0);
});

// The reviewer-blind convergence/churn detectors read only {verdict, objections[].lens/severity}.
// The FAFF-1157 objection enrichment must be inert to them: identical results with and without it.
test("convergence + churn are byte-identical with and without the new objection fields", () => {
  const bare = (n, lens, sev) => ({ verdict: n, objections: [{ lens, severity: sev }] });
  const enriched = (n, lens, sev) => ({ verdict: n, objections: [{ lens, severity: sev, disposition: "fixed", refutation: "r", disposition_rationale: "why" }] });

  const write = (records) => {
    const dir = mkdtempSync(join(tmpdir(), "faff-1157-conv-"));
    records.forEach((rec, i) => writeFileSync(join(dir, `round-${i + 1}.json`), JSON.stringify(rec)));
    return dir;
  };

  const r1bare = { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }, { lens: "QA", severity: "minor" }] };
  const r2bare = { verdict: "approve", objections: [] };
  const r1rich = { verdict: "revise", objections: [{ lens: "architectural", severity: "major", disposition: "fixed", refutation: "r" }, { lens: "QA", severity: "minor", disposition: "fixed" }] };
  const r2rich = { verdict: "approve", objections: [] };

  const bareDir = write([r1bare, r2bare]);
  const richDir = write([r1rich, r2rich]);
  try {
    const convBare = runCli(["spec-review-convergence", "--dir", bareDir]);
    const convRich = runCli(["spec-review-convergence", "--dir", richDir]);
    assert.equal(convBare.code, convRich.code);
    assert.equal(convBare.stdout, convRich.stdout);

    const churnBare = runCli(["spec-review-churn", "--prev", join(bareDir, "round-1.json"), "--curr", join(bareDir, "round-2.json")]);
    const churnRich = runCli(["spec-review-churn", "--prev", join(richDir, "round-1.json"), "--curr", join(richDir, "round-2.json")]);
    assert.equal(churnBare.code, churnRich.code);
    assert.equal(churnBare.stdout, churnRich.stdout);
  } finally {
    rmSync(bareDir, { recursive: true, force: true });
    rmSync(richDir, { recursive: true, force: true });
  }
});
