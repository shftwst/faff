"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewResume = reviewResume;
// === region:governance — interpret a saved review checkpoint for one captured diff ===
const node_fs_1 = require("node:fs");
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readableFile(file) {
    if (typeof file !== "string" || !file.trim())
        return false;
    try {
        (0, node_fs_1.accessSync)(file, node_fs_1.constants.R_OK);
        return (0, node_fs_1.statSync)(file).isFile();
    }
    catch {
        return false;
    }
}
// A checkpoint selects the next review step. Only the existing verdict and merge gate authorize delivery.
function reviewResume(checkpoint, issue, hash) {
    if (!record(checkpoint) || checkpoint.issue !== issue || !record(checkpoint.phase1) ||
        checkpoint.phase1.verdict !== "pass" || checkpoint.phase1.diff_hash !== hash) {
        return { action: "fresh" };
    }
    const phase2 = checkpoint.phase2;
    if (!record(phase2))
        return { action: "fresh" };
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
