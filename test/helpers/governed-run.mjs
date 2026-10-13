// FAFF-1212: hand-built governed runs with real Ed25519 keys, so the merge-gate chokepoint legs can
// be driven against a genuine admission and signed grants without a governor process. Mirrors the
// builders in commissaire-verify.test.mjs (FAFF-1178).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mintGovernorKeypair, signDecision, buildEnvelope } from "../../plugin/skills/faff/bin/lib/producer-auth.js";
import { sha256Hex } from "../../plugin/skills/faff/bin/lib/events.js";

export const LEDGER = "declared-effects.jsonl";
const sha = (s) => sha256Hex(Buffer.from(s, "utf8"));

function sealed(runId, seq, prev, kind, unit, step, payload, sk) {
  const rec = buildEnvelope(runId, seq, prev, "commissaire", "P1", "r1", { kind_of_entry: kind, unit_id: unit, step, payload });
  rec.commissaire_sig = signDecision(rec, sk);
  return rec;
}

// One admission at seq 0; `grant(step, kind, target)` appends signed verdicts; `flush()` writes the ledger.
export function mkGovernedRun({ runId = "RUN-V1", kp = mintGovernorKeypair(), custody = "governor", unit = "FAFF-1" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff1212-run-"));
  const runDir = join(root, runId);
  mkdirSync(join(runDir, "commissaire", "producer"), { recursive: true });
  const lines = [];
  const run = {
    root, runDir, runId, kp, lines, unit,
    prevHash: () => (lines.length === 0 ? sha(runId) : sha(lines[lines.length - 1])),
    add(kind, step, payload, o = {}) {
      const rec = sealed(runId, lines.length, run.prevHash(), kind, unit, step, payload, o.sk ?? kp.sk);
      lines.push(JSON.stringify(rec));
      return rec;
    },
    grant(step, kind, target, o = {}) { return run.add("effect-decision-verdict", step, { verdict: "grant", effect: { kind, target } }, o); },
    flush(tail = "") { writeFileSync(join(runDir, LEDGER), lines.map((l) => `${l}\n`).join("") + tail); },
    writePk(key = kp) { writeFileSync(join(runDir, "commissaire", "producer", "pk.json"), JSON.stringify({ pk: key.pk, pk_fingerprint: key.pk_fingerprint })); },
    // The floor artifacts the PR path reads, so the only open question is the grant.
    seedFloor() {
      mkdirSync(join(runDir, unit), { recursive: true });
      writeFileSync(join(runDir, unit, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
      writeFileSync(join(runDir, unit, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
    },
    rm() { rmSync(root, { recursive: true, force: true }); },
  };
  run.admission = run.add("admission", "admit", {
    producer_id: "P1", contract_revision: "r1", admitted_scope: ["merge", "branch-delete", "pr-create"], pk_fingerprint: kp.pk_fingerprint,
    admitted_at: "2026-01-01T00:00:00Z", ...(custody === "governor" ? { custody: "governor" } : {}),
  });
  run.writePk();
  return run;
}

// A run with grants for merge(main), branch-delete(feature) and pr-create(main), already flushed.
export function grantedRun(opts = {}) {
  const run = mkGovernedRun(opts);
  run.grant("merge", "merge", "main");
  run.grant("merge", "branch-delete", "feature");
  run.grant("pr-create", "pr-create", "main");
  run.flush();
  run.seedFloor();
  return run;
}

// The runner's attack: replace producer/pk.json with a key pair it minted and append self-signed
// grants for all three legs (the real governor's key is untouched on its side).
export function swapInRunnerKey(run) {
  const runner = mintGovernorKeypair();
  run.writePk(runner);
  run.grant("merge", "merge", "main", { sk: runner.sk });
  run.grant("merge", "branch-delete", "feature", { sk: runner.sk });
  run.grant("pr-create", "pr-create", "main", { sk: runner.sk });
  run.flush();
  return runner;
}

export const trustToml = (fps, extra = "") => `schema = 1\ngovernor_key_fingerprints = [${fps.map((f) => `"${f}"`).join(", ")}]\n${extra}`;
