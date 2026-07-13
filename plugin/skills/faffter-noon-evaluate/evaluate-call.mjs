#!/usr/bin/env node
// ===========================================================================
// === evaluate-call.mjs — the code-blind holdout evaluator SPAWNER (FAFF-384) ===
//
// The rung-2 second slice of the ADR-0041 isolation ladder. `review-call.mjs` is
// the PROCESS PATTERN this mirrors (fresh OS-level process, zero-dependency, pure
// functions + injectable spawn, a deadline, a stable exit-code family, a
// --selftest table) — NOT its wire format: review speaks chat-completions over a
// diff; evaluation must ACT (exercise a running feature against an endpoint), so
// the spawner launches an AGENTIC engine (FAFF-380's bounded nested engine).
//
// WHY it exists: the holdout verdict is the 4th L4 merge-floor condition, and its
// `code_blind: true` was, until this slice, a SELF-attestation by the judged party
// (`computeHoldoutVerdict` checked only `code_blind === true`). A code-reading,
// lying evaluator would gate-pass a bad merge to main. This spawner moves the
// attestation OUTSIDE the judged process: it PROVABLY withholds the codebase (no
// repo path in argv/env/cwd), runs `faff evaluator-preflight` IN the cage, and
// stamps `code_blind` + `spawner_attested` into the verdict envelope itself —
// blindness derived from what was withheld, never from what the inner claims. The
// paired contract ratchet (`faff contract holdout-verdict --require-spawner-attested`)
// then rejects any verdict lacking the spawner attestation when the run promised a
// cage.
//
// TRUST TOPOLOGY (the one rule this file exists for): the INNER evaluator emits
// criteria + aggregate ONLY. The SPAWNER owns the envelope — it derives code_blind,
// stamps the attestation, and writes the verdict file. The inner process never
// writes `.faff/holdout/<key>.json`. An inner claim of code_blind:true is IGNORED
// (the spawner derives its own); an inner claim of non-blindness (code_blind:false
// or saw_code:true) is a REFUSE — never laundered into an attested-blind envelope.
//
// PURE CORE + INJECTABLE I/O: the derivation/envelope/exit-mapping functions are
// pure and covered by --selftest; the cage-entering preflight, the agentic spawn,
// and the verdict-file write are injected (so CI spawns nothing unless a test opts
// in), defaulting to real implementations for the CLI.
// ===========================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Exit family — mirrors review-call.mjs's family, plus 10 = preflight-refused (this slice).
// 0 ok · 1 other · 2 usage · 5 engine-unreachable · 8 deadline · 10 preflight-refused.
export const EXIT = { OK: 0, OTHER: 1, USAGE: 2, UNREACHABLE: 5, DEADLINE: 8, PREFLIGHT_REFUSED: 10 };

export const SPAWNER_NAME = "evaluate-call.mjs";

// The withheld-set is TRUE BY CONSTRUCTION: this spawner never puts a repo path, a
// worktree cwd, or a diff into the child's argv/env/cwd, so all three are provably
// withheld. Kept as a function (not a constant) so the by-construction guarantee is
// the single documented source of the attestation basis.
export function buildWithheldSet() {
  return { repo: true, worktree_cwd: true, diff: true };
}

// PURE: derive the spawner attestation from the in-cage preflight result + the inner
// evaluator's output + the withheld-set. Never trusts an inner code_blind:true (the
// spawner derives its own). Refuses to attest — spawner_attested:false, a violation,
// and code_blind:false — on ANY inner non-blind signal, so a lying inner can never be
// laundered into an attested-blind verdict. Preflight-refused is handled UPSTREAM
// (exit 10) and never reaches here.
export function deriveAttestation(preflightHolds, innerVerdict, withheld) {
  if (!preflightHolds) {
    // Defensive: a caller that reaches derivation without a passing preflight gets a
    // hard non-attested, non-blind result (the exit-10 path is the real handler).
    return { code_blind: false, spawner_attested: false, attestation: null, violations: ["in-cage preflight did not hold — blindness is not physically established"] };
  }
  const inner = innerVerdict && typeof innerVerdict === "object" ? innerVerdict : {};
  const innerSawCode = inner.code_blind === false || inner.saw_code === true;
  if (innerSawCode) {
    return { code_blind: false, spawner_attested: false, attestation: null, violations: ["inner evaluator signalled it read the codebase (code_blind:false / saw_code:true) — refusing to attest blindness"] };
  }
  if (!withheld.repo) {
    return { code_blind: false, spawner_attested: false, attestation: null, violations: ["the codebase was not withheld from the child launch — blindness is not spawner-derived"] };
  }
  return {
    code_blind: true,
    spawner_attested: true,
    attestation: { spawner: SPAWNER_NAME, withheld, preflight: "pass" },
    violations: [],
  };
}

// PURE: assemble the final holdout-verdict envelope the SPAWNER owns. The inner
// evaluator contributes criteria + aggregate ONLY; the spawner overwrites code_blind
// with its derived value and stamps spawner_attested + attestation. The shape is
// exactly what `faff contract holdout-verdict` validates (criteria items:
// {class, verdict, evidence_present}; aggregate a string; violations a string[]).
export function assembleEnvelope(innerVerdict, att) {
  const inner = innerVerdict && typeof innerVerdict === "object" ? innerVerdict : {};
  const criteria = Array.isArray(inner.criteria) ? inner.criteria : [];
  const aggregate = typeof inner.aggregate === "string" ? inner.aggregate : "needs-human";
  const violations = [];
  if (Array.isArray(inner.violations)) for (const v of inner.violations) if (typeof v === "string" && v.trim()) violations.push(v);
  for (const v of att.violations) violations.push(v);
  const env = { aggregate, code_blind: att.code_blind, criteria, violations, spawner_attested: att.spawner_attested };
  if (att.attestation) env.attestation = att.attestation;
  return env;
}

// PURE: map an injected spawn result's status to the documented exit class.
export function mapSpawnStatusExit(status) {
  switch (status) {
    case "ok": return EXIT.OK;
    case "unreachable": return EXIT.UNREACHABLE;
    case "deadline": return EXIT.DEADLINE;
    default: return EXIT.OTHER;   // "error"/unknown — an inner fault the caller reads as needs-human
  }
}

// --- CLI ---

export function parseArgs(argv) {
  const a = { endpoints: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--spec") a.spec = argv[++i];
    else if (k === "--endpoint") a.endpoints.push(argv[++i]);
    else if (k === "--endpoints") a.endpointsJson = argv[++i];   // JSON array of endpoint URLs
    else if (k === "--key") a.key = argv[++i];
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--intent") a.intent = argv[++i];             // lane-boundary intent artifact (the cage promise)
    else if (k === "--deadline") a.deadlineMs = Number(argv[++i]) * 1000;
    else if (k === "--json") a.json = true;
    else if (k === "--selftest") a.selftest = true;
  }
  return a;
}

// The real in-cage preflight: shell `faff evaluator-preflight --json` INSIDE the cage
// (cwd is the neutral scratch the caller already placed us in). Returns {holds, refusals}.
// A spawn failure fail-CLOSES to holds:false (the cage is unprovable ⇒ refuse), never a throw.
function realPreflight(faffBin) {
  return () => {
    try {
      const r = spawnSync(faffBin, ["evaluator-preflight", "--json"], { encoding: "utf8" });
      if (r.status === 0) return { holds: true, refusals: [] };
      let parsed = null;
      try { parsed = JSON.parse(r.stdout || "{}"); } catch { /* fall through */ }
      return { holds: false, refusals: (parsed && parsed.refusals) || [{ leg: "preflight", detail: `exit ${r.status}` }] };
    } catch (e) {
      return { holds: false, refusals: [{ leg: "preflight", detail: `spawn failed: ${e.message}` }] };
    }
  };
}

// main — pure orchestration over injected I/O. preflightFn/spawnFn/writeFn default to real
// implementations; the selftest injects stubs so no cage/engine/file is touched.
export async function main(argv, { preflightFn, spawnFn, writeFn = (p, c) => writeFileSync(p, c) } = {}) {
  const a = parseArgs(argv);
  if (a.selftest) return selftest();
  if (!a.spec || !a.out || (a.endpoints.length === 0 && !a.endpointsJson)) {
    process.stderr.write("usage: evaluate-call.mjs --spec FILE (--endpoint URL | --endpoints JSON) --key KEY --out FILE [--intent FILE] [--deadline S] [--json]\n");
    return EXIT.USAGE;
  }

  let specText, intentText = "";
  try { specText = readFileSync(a.spec, "utf8"); }
  catch (e) { process.stderr.write(`evaluate-call: cannot read --spec ${a.spec}: ${e.message}\n`); return EXIT.USAGE; }
  if (a.intent) {
    try { intentText = readFileSync(a.intent, "utf8"); }
    catch (e) { process.stderr.write(`evaluate-call: cannot read --intent ${a.intent}: ${e.message}\n`); return EXIT.USAGE; }
  }
  let endpoints = a.endpoints;
  if (a.endpointsJson) {
    try { const parsed = JSON.parse(a.endpointsJson); if (Array.isArray(parsed)) endpoints = endpoints.concat(parsed); }
    catch (e) { process.stderr.write(`evaluate-call: --endpoints is not a JSON array: ${e.message}\n`); return EXIT.USAGE; }
  }

  const faffBin = process.env.FAFF_BIN || "faff";
  const preflight = preflightFn || realPreflight(faffBin);
  const spawn = spawnFn;   // no real default here: the agentic-engine launch is FAFF-380's cage; the CLI
                           // path requires an injected/host-provided spawn (see the SKILL wiring).

  // Step 3a — the in-cage preflight MUST hold before judging. A refusal is exit 10 → needs-human; teardown
  // is the caller's (holdout_step step 6), unchanged. Never retried here (the cage is wrong, not flaky).
  const pf = preflight({ intent: intentText });
  if (!pf.holds) {
    process.stderr.write(`evaluate-call: in-cage preflight REFUSED — ${(pf.refusals || []).map((r) => `${r.leg}: ${r.detail}`).join("; ")}; exit ${EXIT.PREFLIGHT_REFUSED} → needs-human\n`);
    return EXIT.PREFLIGHT_REFUSED;
  }
  if (typeof spawn !== "function") {
    process.stderr.write("evaluate-call: no agentic-engine spawn provided (the cage launches it — pass a spawnFn or set the host launch hook)\n");
    return EXIT.OTHER;
  }

  // Step 3b — the inner evaluator (the configured `evaluator` slot's judging arc) runs in the caged agentic
  // engine, handed ONLY spec text + endpoint(s) + intent — never a repo path/cwd/diff (the withheld-set).
  let res;
  try { res = await spawn({ specText, endpoints, intentText, deadlineMs: a.deadlineMs }); }
  catch (e) { process.stderr.write(`evaluate-call: engine spawn threw: ${e.message}; exit ${EXIT.OTHER}\n`); return EXIT.OTHER; }
  const exit = mapSpawnStatusExit(res && res.status);
  if (exit !== EXIT.OK) {
    process.stderr.write(`evaluate-call: engine ${res && res.status}; exit ${exit} → needs-human\n`);
    return exit;
  }

  // Step 3c — the spawner derives code_blind + stamps the attestation, and writes the envelope. The inner
  // process NEVER wrote the verdict file — this is the whole ticket.
  const withheld = buildWithheldSet();
  const att = deriveAttestation(pf.holds, res.verdict, withheld);
  const envelope = assembleEnvelope(res.verdict, att);
  try { writeFn(a.out, JSON.stringify(envelope, null, 2) + "\n"); }
  catch (e) { process.stderr.write(`evaluate-call: cannot write --out ${a.out}: ${e.message}; exit ${EXIT.OTHER}\n`); return EXIT.OTHER; }
  if (a.json) process.stdout.write(JSON.stringify(envelope) + "\n");
  else process.stderr.write(`evaluate-call: wrote ${a.out} (spawner_attested:${att.spawner_attested}, code_blind:${att.code_blind})\n`);
  return EXIT.OK;
}

// In-process selftest of the pure core (no cage/engine/file touched).
export function selftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`evaluate-call --selftest FAIL: ${label}\n`); fail++; } };
  const withheld = buildWithheldSet();

  // withheld-set is true-by-construction
  check("withheld-set all true", withheld.repo && withheld.worktree_cwd && withheld.diff);

  // happy path: preflight held, inner blind → attested-blind
  const a1 = deriveAttestation(true, { aggregate: "meets-spec", criteria: [] }, withheld);
  check("attest: blind inner + preflight → spawner_attested:true code_blind:true", a1.spawner_attested === true && a1.code_blind === true && a1.attestation.preflight === "pass" && a1.violations.length === 0);

  // refuse-to-attest: inner declares code_blind:false
  const a2 = deriveAttestation(true, { aggregate: "meets-spec", criteria: [], code_blind: false }, withheld);
  check("attest: inner code_blind:false → refuse (spawner_attested:false, code_blind:false, violation)", a2.spawner_attested === false && a2.code_blind === false && a2.attestation === null && a2.violations.length === 1);

  // refuse-to-attest: inner declares saw_code
  const a3 = deriveAttestation(true, { aggregate: "meets-spec", criteria: [], saw_code: true }, withheld);
  check("attest: inner saw_code:true → refuse", a3.spawner_attested === false && a3.code_blind === false);

  // inner code_blind:true is IGNORED (spawner derives its own true) — never trusted, never laundered
  const a4 = deriveAttestation(true, { aggregate: "meets-spec", criteria: [], code_blind: true }, withheld);
  check("attest: inner code_blind:true ignored, spawner derives its own", a4.spawner_attested === true && a4.attestation.spawner === SPAWNER_NAME);

  // preflight not held → non-attested, non-blind (defensive; exit-10 is the real path)
  const a5 = deriveAttestation(false, { aggregate: "meets-spec", criteria: [] }, withheld);
  check("attest: preflight not held → non-attested non-blind", a5.spawner_attested === false && a5.code_blind === false);

  // envelope assembly: inner criteria/aggregate carried, spawner fields stamped
  const e1 = assembleEnvelope({ aggregate: "meets-spec", criteria: [{ class: "scenario", verdict: "met", evidence_present: true }] }, a1);
  check("envelope: carries inner criteria+aggregate, stamps spawner_attested+attestation", e1.aggregate === "meets-spec" && e1.criteria.length === 1 && e1.spawner_attested === true && e1.attestation.spawner === SPAWNER_NAME);
  check("envelope: code_blind is the SPAWNER-derived value, not the inner's", e1.code_blind === true);

  // refuse envelope carries the violation + code_blind:false (base gate ALSO blocks it)
  const e2 = assembleEnvelope({ aggregate: "meets-spec", criteria: [], code_blind: false }, a2);
  check("envelope: refuse case → code_blind:false + violation", e2.code_blind === false && e2.spawner_attested === false && e2.violations.some((v) => v.includes("refusing to attest")));

  // exit mapping
  check("exit: ok→0", mapSpawnStatusExit("ok") === EXIT.OK);
  check("exit: unreachable→5", mapSpawnStatusExit("unreachable") === EXIT.UNREACHABLE);
  check("exit: deadline→8", mapSpawnStatusExit("deadline") === EXIT.DEADLINE);
  check("exit: error→1", mapSpawnStatusExit("error") === EXIT.OTHER);

  // parseArgs
  const p = parseArgs(["--spec", "s.md", "--endpoint", "http://localhost:8080", "--key", "FAFF-384", "--out", "o.json", "--intent", "lb.json", "--deadline", "60"]);
  check("parseArgs", p.spec === "s.md" && p.endpoints[0] === "http://localhost:8080" && p.key === "FAFF-384" && p.out === "o.json" && p.intent === "lb.json" && p.deadlineMs === 60000);

  if (fail) { console.log(`\nevaluate-call --selftest: FAIL (${fail} failed)`); return EXIT.OTHER; }
  console.log("evaluate-call --selftest: ok"); return EXIT.OK;
}

if (process.argv[1] && process.argv[1].endsWith("evaluate-call.mjs")) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { process.stderr.write(`evaluate-call: ${e.message}\n`); process.exitCode = EXIT.OTHER; });
}
