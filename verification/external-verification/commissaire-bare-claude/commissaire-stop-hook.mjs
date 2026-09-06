#!/usr/bin/env node
// FAFF-360 — hand-written Claude Code Stop-hook wrapper for the bare Commissaire consumer.
//
// This is the SUT's only integration surface with the governance layer at hook time. It reads a
// Claude Code Stop-hook stdin, resolves the flight-recorder binary from a scaffolder-substituted
// absolute constant (no PATH, no inherited env), runs `faff runcheck --hook` to decide block/allow,
// derives a provenance label from the stdin SHAPE (never a caller-supplied value), and appends a
// secret-free HookObservation. It fails CLOSED: a malformed stdin, a non-Stop event, an escaping or
// malformed pointer, an unresolvable FAFF_BIN, a runcheck spawn failure, or a garbled runcheck exit-0
// (non-empty unparseable stdout) all emit a block JSON.
// The wrapper always exits 0; blocking is communicated through Claude Code's stdout JSON contract.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Scaffolder-substituted absolute path to the flight-recorder binary. Resolved with no PATH and no
// inherited environment (rationale: the repository reads env only from /proc/1/environ and treats
// inherited process env as a poisoning surface).
const FAFF_BIN = "__FAFF_BIN__";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUT_ROOT = path.resolve(SCRIPT_DIR, "..");
const POINTER_PATH = path.join(SUT_ROOT, ".faff", "active-run.json");
const HOOK_STORE = path.join(SUT_ROOT, ".faff", "hook-observations.jsonl");

function blockAndExit(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
  process.exit(0);
}
function silentAllow() {
  process.exit(0);
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function pointerContainmentError(ptr) {
  if (!ptr || typeof ptr !== "object") return "pointer-not-object";
  if (ptr.schema !== 1) return "pointer-bad-schema";
  const rd = ptr.run_dir;
  if (typeof rd !== "string" || rd.length === 0) return "pointer-missing-run_dir";
  if (path.isAbsolute(rd)) return "pointer-run_dir-absolute";
  const segs = rd.split(/[\\/]/);
  if (segs.some((s) => s === "." || s === "..")) return "pointer-run_dir-traversal";
  const resolved = path.resolve(SUT_ROOT, rd);
  const rel = path.relative(SUT_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return "pointer-escapes-sut";
  if (path.basename(rd) !== ptr.run_id) return "pointer-basename-ne-run_id";
  return null;
}

function main() {
  // 1. parse stdin.
  let stdin;
  try {
    stdin = JSON.parse(readStdin());
  } catch {
    return blockAndExit("malformed-stdin");
  }
  if (!stdin || typeof stdin !== "object") return blockAndExit("malformed-stdin");
  // 2. require a Stop event.
  if (stdin.hook_event_name !== "Stop") return blockAndExit("not-a-stop-event");
  // 3. no active-run pointer -> silent allow.
  if (!fs.existsSync(POINTER_PATH)) return silentAllow();
  let ptr;
  try {
    ptr = JSON.parse(fs.readFileSync(POINTER_PATH, "utf8"));
  } catch {
    return blockAndExit("pointer-unreadable");
  }
  // 4. validate the pointer + containment BEFORE reading the run directory.
  const cerr = pointerContainmentError(ptr);
  if (cerr) return blockAndExit(cerr);
  const runId = ptr.run_id;
  const absRunDir = path.resolve(SUT_ROOT, ptr.run_dir);

  // 5. resolve FAFF_BIN from the substituted constant (no PATH, no inherited env).
  let faffStat;
  try {
    faffStat = fs.statSync(FAFF_BIN);
  } catch {
    faffStat = null;
  }
  if (!faffStat || !faffStat.isFile()) return blockAndExit("faff-bin-unresolvable");

  // 6. invoke runcheck --hook; a spawn error or a non-zero exit without a decision JSON blocks.
  const rc = spawnSync(FAFF_BIN, ["runcheck", absRunDir, "--hook"], {
    encoding: "utf8",
    env: { ...process.env, FAFF_RUN_DIR: absRunDir },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (rc.error) return blockAndExit("runcheck-spawn-failed");
  const rcOut = (rc.stdout || "").trim();
  let rcDecision = null;
  if (rcOut) {
    try {
      const parsed = JSON.parse(rcOut);
      if (parsed && parsed.decision) rcDecision = parsed;
    } catch {
      rcDecision = null;
    }
  }
  if (rc.status !== 0 && !rcDecision) return blockAndExit("runcheck-spawn-failed");
  // Fail closed on a garbled exit-0. runcheck's hook contract is exit 0 with EITHER a block
  // decision JSON OR nothing (silent allow). Non-empty, unparseable stdout on exit 0 is a
  // contract violation we cannot read as a founded allow, so block rather than fall through to it.
  if (rc.status === 0 && rcOut && !rcDecision) return blockAndExit("runcheck-malformed-output");

  // 7. derive the source label from the stdin shape (never caller-supplied).
  let source = "ci-fixture";
  let provenance = null;
  const hasShape =
    typeof stdin.session_id === "string" &&
    typeof stdin.transcript_path === "string" &&
    typeof stdin.cwd === "string" &&
    "stop_hook_active" in stdin;
  if (hasShape) {
    let transcriptExists = false;
    try {
      transcriptExists = fs.statSync(stdin.transcript_path).isFile();
    } catch {
      transcriptExists = false;
    }
    const cwdMatched = path.resolve(stdin.cwd) === SUT_ROOT;
    if (transcriptExists && cwdMatched) {
      source = "claude-code-observed";
      provenance = {
        session_id_sha256: crypto.createHash("sha256").update(runId + stdin.session_id).digest("hex"),
        transcript_existed: true,
        cwd_matched: true,
      };
    }
  }

  // 8. derive the per-run_id ordinal and append the observation (never into the run directory).
  const result = rcDecision && rcDecision.decision === "block" ? "block" : "allow";
  let existing = 0;
  if (fs.existsSync(HOOK_STORE)) {
    for (const line of fs.readFileSync(HOOK_STORE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        if (JSON.parse(line).run_id === runId) existing++;
      } catch {
        /* ignore */
      }
    }
  }
  const observation = {
    schema: 2,
    ordinal: existing + 1,
    hook_event_name: "Stop",
    input_shape_validated: true,
    source,
    ...(provenance ? { provenance } : {}),
    run_id: runId,
    result,
  };
  // A failed observation write must never swallow a pending block: guard the write so a throw
  // here (an unwritable .faff) falls through to the decision emission below rather than crashing
  // the hook and losing the block. A missing observation is caught downstream by verify's
  // two-observation gate, so the allow path stays fail-closed at the verify layer too.
  try {
    fs.mkdirSync(path.dirname(HOOK_STORE), { recursive: true });
    fs.appendFileSync(HOOK_STORE, JSON.stringify(observation) + "\n");
  } catch {
    /* keep going to the block/allow emission below */
  }

  // 9-11. forward a block unchanged; otherwise stay silent.
  if (rcDecision && rcDecision.decision === "block") {
    process.stdout.write(JSON.stringify(rcDecision) + "\n");
  }
  process.exit(0);
}

main();
