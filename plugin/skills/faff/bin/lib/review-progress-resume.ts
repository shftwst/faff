// === region:governance — interpret a saved review checkpoint for one captured diff ===
import { accessSync, constants, statSync } from "node:fs";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readableFile(file: unknown): file is string {
  if (typeof file !== "string" || !file.trim()) return false;
  try {
    accessSync(file, constants.R_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// A checkpoint selects the next review step. Only the existing verdict and merge gate authorize delivery.
export function reviewResume(checkpoint: unknown, issue: string, hash: string) {
  if (!record(checkpoint) || checkpoint.issue !== issue || !record(checkpoint.phase1) ||
      checkpoint.phase1.verdict !== "pass" || checkpoint.phase1.diff_hash !== hash) {
    return { action: "fresh" };
  }
  const phase2 = checkpoint.phase2;
  if (!record(phase2)) return { action: "fresh" };
  switch (phase2.status) {
    case "complete":
      return readableFile(phase2.findings_ref)
        ? { action: "dispose-findings", findings_ref: phase2.findings_ref }
        : { action: "phase2" };
    case "pending":
    case "in_flight":
      return { action: "phase2" };
    case "skipped_unreachable":
    case "skipped_deadline":
      return { action: "reconcile-skip", status: phase2.status };
    default:
      return { action: "fresh" };
  }
}
