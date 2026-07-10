// ===========================================================================
// === region:factory — corrective-integrity — FAFF-373: fail-safe gate over the FAFF-278 forge surface. ===
// Under a shared uid faff cannot cryptographically stop a same-uid build lane
// from forging a corrective artifact or rewriting run-ledger.json (bin/faff:1683 —
// "Guardrail, not cryptographic control: a local agent can always write a
// marker"). So the safe posture is DISTRUST BY DEFAULT: the probe proves no
// integrity boundary (asserted:false for ALL inputs) and the gate degrades
// corrective authority to Channel D (human relay) / ledger content to
// reconcile-only. No crypto, no secret, no signature — a shared-uid secret is
// itself forgeable, so it is false assurance. The `signal` parameter is the inert
// forward-compatible SEAM FAFF-325 will wire to an un-forgeable channel; in THIS
// ticket no trusted source exists, so it is NEVER honoured (honouring a signal
// from any build-lane-writable source would re-open the exact forge this closes).
// Assert + degrade, never refuse (ADR-0039 names Channel D the fallback; a still-
// safe run proceeds stop-only, no `correct` rung). PURE over (env, fsq) like
// container-check; the CLI wrapper does the I/O.
// ===========================================================================

// Pure probe. Returns { asserted, basis }. `signal` is the inert FAFF-325 seam:
// no trusted source exists here, so the probe returns asserted:false for EVERY
// input — a `signal` from any build-lane-writable source is never honoured. No
// crypto, no secret, no fs read of `signal` as trust.

const path = require("node:path");
const { realFsq } = require("./container-check");

function correctiveIntegrityProbe(env, fsq, signal) {
  // signal is the FAFF-325 seam — intentionally unread here. When it is wired, ONLY
  // signal (the un-forgeable channel) may ever set asserted:true; env and fsq are
  // NEVER trust sources. TODO(FAFF-325): before honouring signal, validate its source
  // ∉ build-lane-writable paths — until then, distrust by default (asserted:false).
  return { asserted: false, basis: "no-boundary-signal" };
}

// Pure gate. Given a probe result + a consumer, decide trust + disposition.
// asserted:true → trusted (the FAFF-325 seam, unreachable in this ticket).
// Unasserted degrades: `corrective` → Channel D (human relay); `detection` →
// reconcile-only (ledger content cross-checked vs git). An UNKNOWN consumer fails
// safe to Channel D — never trusted.
function integrityGate(probeResult, consumer) {
  if (probeResult && probeResult.asserted === true) return { trusted: true, disposition: "trusted" };
  if (consumer === "detection") return { trusted: false, disposition: "reconcile-only" };
  return { trusted: false, disposition: "channel-D" };
}

// The forge-surface path set for a run — the corrective-artifact dir + the
// run-ledger.json path — single-sourced from the SAME run-dir layout readLedger
// uses (path.join(runDir, "run-ledger.json")); never a divergent hand-written
// absolute list (a second list is a real bypass). PURE — derives paths only.
// FORWARD-COMPAT: exported for the FAFF-326 Channel-A consumer; the probe/gate in
// THIS ticket are dir-blind (the probe is inert), so nothing calls it yet — the
// single-source invariant is structural (one path.join expression), made real when
// FAFF-326 wires the boundary. Kept + tested now so the seam can't drift.
function correctiveIntegrityDirs(runDir) {
  return [
    path.join(runDir, "corrective"),
    path.join(runDir, "run-ledger.json"),
  ];
}

function cmdCorrectiveIntegrity(args) {
  if (args.includes("--selftest")) return correctiveIntegritySelftest();
  const json = args.includes("--json");
  const ci = args.indexOf("--consumer");
  const consumer = ci !== -1 && args[ci + 1] ? args[ci + 1] : "corrective";
  // Closed vocabulary — reject an unknown --consumer loudly (usage error, exit 2),
  // matching the CLI's other flag validation. The gate's unknown→channel-D fail-safe
  // is defence-in-depth, not a licence for the CLI to accept garbage silently.
  if (consumer !== "corrective" && consumer !== "detection") {
    process.stderr.write(`corrective-integrity: unknown --consumer '${consumer}' (expected: corrective | detection)\n`);
    return 2;
  }
  const probe = correctiveIntegrityProbe(process.env, realFsq());
  const gate = integrityGate(probe, consumer);
  const out = { asserted: probe.asserted, basis: probe.basis, trusted: gate.trusted, disposition: gate.disposition };
  if (json) console.log(JSON.stringify(out));
  else console.log(`corrective-integrity: asserted=${out.asserted} basis=${out.basis} → trusted=${out.trusted} disposition=${out.disposition} (consumer: ${consumer})`);
  // Report/degrade, never a hard failure — an unasserted boundary is the shipped
  // posture (degrade to Channel D), NOT an error. Always exit 0.
  return 0;
}

// In-memory selftest over synthetic fixtures — mirrors the container-check shape
// (per-case ok/FAIL + a RESULT line, non-zero on any fail). Asserts: the probe is
// asserted:false for every input incl. a shared-fs-sourced signal; the gate
// degrades corrective→channel-D / detection→reconcile-only when unasserted; only
// a synthetic asserted:true reaches trusted; and the dir set is under the run dir.
function correctiveIntegritySelftest() {
  let fail = 0;
  const ok = (cond, label) => { if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };
  // A "shared-fs-like" fsq + signal: the security-critical case — a signal sourced
  // from a build-lane-writable location must NOT flip the probe to trusted.
  const sharedFsFsq = { exists: () => true, readEnviron: () => "container=forged" };
  const PROBE_CASES = [
    [{}, realFsq(), undefined, "bare (no env, no signal)"],
    [{ FAFF_RUN_DIR: "/x" }, realFsq(), undefined, "run env set"],
    [{}, sharedFsFsq, { asserted: true, source: "shared-fs" }, "shared-fs signal (security-critical)"],
    [{}, sharedFsFsq, "trust-me", "string signal from shared fs"],
  ];
  for (const [env, fsq, sig, label] of PROBE_CASES) {
    const p = correctiveIntegrityProbe(env, fsq, sig);
    ok(p.asserted === false && p.basis === "no-boundary-signal", `probe → asserted:false/no-boundary-signal (${label})`);
  }
  const unasserted = { asserted: false, basis: "no-boundary-signal" };
  const gc = integrityGate(unasserted, "corrective");
  ok(gc.trusted === false && gc.disposition === "channel-D", "gate corrective/unasserted → channel-D");
  const gd = integrityGate(unasserted, "detection");
  ok(gd.trusted === false && gd.disposition === "reconcile-only", "gate detection/unasserted → reconcile-only");
  const gu = integrityGate(unasserted, "wat");
  ok(gu.trusted === false && gu.disposition === "channel-D", "gate unknown consumer → not trusted / channel-D");
  const gt = integrityGate({ asserted: true }, "corrective");
  ok(gt.trusted === true && gt.disposition === "trusted", "gate synthetic asserted:true → trusted (the FAFF-325 seam)");
  const runDir = path.join("/tmp", "faff-run-xyz");
  const dirs = correctiveIntegrityDirs(runDir);
  ok(dirs.every((d) => d === runDir || d.startsWith(runDir + path.sep)), "all integrity dirs under runDir");
  ok(dirs.includes(path.join(runDir, "run-ledger.json")), "integrity dirs include the ledger path");
  ok(dirs.includes(path.join(runDir, "corrective")), "integrity dirs include the corrective-artifact dir");
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${PROBE_CASES.length + 7} checks, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { cmdCorrectiveIntegrity, correctiveIntegrityDirs, correctiveIntegrityProbe, correctiveIntegritySelftest, integrityGate };
