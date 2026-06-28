// Deterministic (non-LLM) reference exerciser for the holdout evaluator loop (FAFF-34).
//
// The production `evaluator` occupant (faffter-noon-evaluate) is an LLM skill — its exercise+judge step
// cannot run in headless CI. This module is the scripted STAND-IN for that step, so a docker-gated
// integration test can prove the loop's PLUMBING end-to-end against a REAL stood-up env:
//   classify (faff dod classify) → exercise the born-verifiable criteria → roll up → validate (faff
//   contract holdout-verdict) → teardown.
// It is a test driver, never shipped behaviour.
import { spawnSync } from "node:child_process";

// Mirrors the gateway-normative aggregate derivation the CLI enforces. If this mirror ever diverges from
// `faff contract holdout-verdict`, the contract check in the test fails — the contract is the backstop.
export function deriveAggregate(verdicts) {
  if (verdicts.some((v) => v === "needs-human")) return "needs-human";
  if (verdicts.length === 0) return "needs-human";
  if (verdicts.every((v) => v === "met")) return "meets-spec";
  if (verdicts.every((v) => v === "unmet")) return "fails";
  return "gaps";
}

// Classify a spec's DoD via the real CLI — the deterministic boundary the producer also uses.
export function classifyDoD(faffBin, specText) {
  const r = spawnSync("node", [faffBin, "dod", "classify", "--spec", "-", "--json"], { input: specText, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`dod classify failed (exit ${r.status}): ${r.stderr}`);
  return JSON.parse(r.stdout).criteria;
}

// Exercise one born-verifiable criterion against the running env: GET the endpoint and assert the expected
// substring appears in the body. Deterministic, code-blind (it only ever sees the env's HTTP responses).
export async function exercise(endpoint, expectSubstring) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(endpoint, { signal: ctrl.signal });
    const body = await res.text();
    const met = res.ok && body.includes(expectSubstring);
    return { verdict: met ? "met" : "unmet", evidence: `GET ${endpoint} → ${res.status} "${body.trim().slice(0, 80)}"` };
  } catch (e) {
    return { verdict: "unmet", evidence: `GET ${endpoint} → error: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// Build a holdout-verdict from a classified DoD: exercise the born-verifiable criteria, force prose to
// needs-human — the same shape (and the same prose rule) the LLM producer emits.
export async function buildVerdict({ classified, endpoint, expectSubstring }) {
  const criteria = [];
  for (const c of classified) {
    if (c.class === "prose") {
      criteria.push({ class: "prose", verdict: "needs-human", evidence_present: false });
      continue;
    }
    const ex = await exercise(endpoint, expectSubstring);
    criteria.push({ class: c.class, verdict: ex.verdict, evidence_present: true });
  }
  return { aggregate: deriveAggregate(criteria.map((c) => c.verdict)), code_blind: true, criteria, violations: [] };
}
