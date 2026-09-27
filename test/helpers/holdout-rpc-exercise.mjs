// FAFF-1107 - deterministic (non-LLM) reference exerciser for the code-interface holdout path.
//
// The sibling of holdout-exercise.mjs: that driver pokes a running SERVICE over HTTP GET; this one
// drives a code interface over the session RPC wire (FAFF-1102) - the four methods open/call/
// call_static/close POSTed to <endpoint>/faff-rpc - so a docker-gated integration test can prove the
// code-interface loop's PLUMBING end-to-end against a REAL containerised bridge (FAFF-1104). It is a
// test driver, never shipped behaviour.
//
// It reads the wire's two DISJOINT failure planes distinctly, exactly as the wire doc mandates:
//   - a top-level `error` (WireError) is an infrastructure fault  -> needs-human;
//   - a `result.outcome=="threw"` ThrownError is evidence to assert on -> met|unmet;
//   - a `result.outcome=="returned"` value is asserted on           -> met|unmet.
// Collapsing the two planes is wrong, so this module never does.
//
// The aggregate derivation and DoD classification are the service exerciser's; they are imported, not
// re-copied, so the gateway-normative rollup has one home and the contract check stays the backstop.
import { deriveAggregate, classifyDoD } from "./holdout-exercise.mjs";

export { classifyDoD };

// A step's session_id set to this sentinel is filled from the most recent open in the same sequence,
// so a script never hard-codes an opaque bridge-minted id it cannot know in advance.
export const SESSION_REF = "$session";

const WIRE = "faff.session-rpc/1";

const rpcUrl = (endpoint) => `${String(endpoint).replace(/\/+$/, "")}/faff-rpc`;

// POST one wire envelope and return the parsed WireResponse. An optional Authorization header is
// forwarded as-is (the bearer path the spawner already speaks), never synthesised here.
export async function rpc(endpoint, wireRequest, { authHeader } = {}) {
  const headers = { "content-type": "application/json" };
  if (authHeader) headers.authorization = authHeader;
  const res = await fetch(rpcUrl(endpoint), { method: "POST", headers, body: JSON.stringify(wireRequest) });
  return res.json();
}

// Execute an ordered open/call/call_static/close script, threading each open's minted session_id into
// later SESSION_REF steps. ALWAYS closes every session it opened, even when a step fails mid-sequence -
// the close runs in a finally, is idempotent on the wire, and its success is reported as sessionsClosed.
export async function runSequence(endpoint, steps, { authHeader } = {}) {
  const results = [];
  const opened = [];
  const opts = { authHeader };
  let sessionsClosed = true;
  try {
    for (const step of steps) {
      const req = { ...step };
      if ((req.method === "call" || req.method === "close") && req.session_id === SESSION_REF) {
        req.session_id = opened.length ? opened[opened.length - 1] : req.session_id;
      }
      let resp;
      try {
        resp = await rpc(endpoint, req, opts);
      } catch (e) {
        resp = { error: { code: "transport_error", message: e.message } };
        results.push(resp);
        break;
      }
      results.push(resp);
      if (req.method === "open" && resp.result && resp.result.outcome === "returned" && resp.result.session_id) {
        opened.push(resp.result.session_id);
      }
    }
  } finally {
    for (const sid of opened) {
      try {
        const c = await rpc(endpoint, { wire: WIRE, id: `close-${sid}`, method: "close", session_id: sid }, opts);
        if (!(c.result && c.result.outcome === "returned")) sessionsClosed = false;
      } catch {
        sessionsClosed = false;
      }
    }
  }
  return { results, sessionsClosed };
}

// The result the script's assertion reads: an explicit assertIndex, else the last step's result
// (scripts drive the action under test and leave the close to runSequence).
function assertTarget(results, script) {
  if (typeof script.assertIndex === "number") return results[script.assertIndex];
  return results.length ? results[results.length - 1] : undefined;
}

// Assert a WireResponse against a script expectation. WireError -> needs-human (infra plane); a threw
// ThrownError -> type (and optional message substring) match; a returned value -> deep-equal match.
function verdictFor(resp, expect) {
  if (!resp || resp.error) return { verdict: "needs-human", evidence_present: false };
  const r = resp.result;
  if (r && r.outcome === "threw") {
    const e = r.error || {};
    const typeOk = expect.outcome === "threw" && e.type === expect.type;
    const msgOk = expect.message === undefined || (typeof e.message === "string" && e.message.includes(expect.message));
    return { verdict: typeOk && msgOk ? "met" : "unmet", evidence_present: true };
  }
  if (r && r.outcome === "returned") {
    const ok = expect.outcome === "returned" && deepEqual(r.value, expect.value);
    return { verdict: ok ? "met" : "unmet", evidence_present: true };
  }
  return { verdict: "needs-human", evidence_present: false };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Build a holdout-verdict from a classified DoD: prose -> needs-human; each born-verifiable criterion
// drives `script` over the wire and asserts its terminal result. Returns the shape holdout-exercise.mjs
// emits: { aggregate, code_blind:true, criteria[], violations:[] }.
export async function buildVerdict({ classified, endpoint, script, authHeader }) {
  const criteria = [];
  for (const c of classified) {
    if (c.class === "prose") {
      criteria.push({ class: "prose", verdict: "needs-human", evidence_present: false });
      continue;
    }
    const { results } = await runSequence(endpoint, script.steps, { authHeader });
    const target = assertTarget(results, script);
    const { verdict, evidence_present } = verdictFor(target, script.expect);
    criteria.push({ class: c.class, verdict, evidence_present });
  }
  return { aggregate: deriveAggregate(criteria.map((c) => c.verdict)), code_blind: true, criteria, violations: [] };
}
