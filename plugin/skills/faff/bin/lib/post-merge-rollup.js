"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rollUpPostMerge = rollUpPostMerge;
// === region:factory — collect post-merge annotations from completed delivery units ===
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const { readLeafNoFollow } = require("./leaf-read");
const { computePostMergeVerification } = require("./contract-defs-delivery");
const { postMergeVerificationPath } = require("./post-merge");
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readVerification(runDir, issue) {
    if (issue === "." || issue === ".." || !issue || /[/\\\x00-\x1f]/.test(issue))
        throw new Error("invalid issue path");
    const dir = (0, node_fs_1.lstatSync)((0, node_path_1.join)(runDir, issue), { throwIfNoEntry: false });
    if (!dir)
        return null;
    if (!dir.isDirectory())
        throw new Error("invalid issue directory");
    const file = readLeafNoFollow(postMergeVerificationPath(runDir, issue));
    if (file.kind === "absent")
        return null;
    if (file.kind !== "regular")
        throw new Error("expected a regular artifact file");
    const artifact = JSON.parse(file.bytes.toString("utf8"));
    if (!isRecord(artifact) || artifact.issue !== issue)
        throw new Error("artifact does not name this issue");
    return artifact;
}
// Called inside the owner-fenced close. Historical annotations for which no artifact survives
// are retained. A replay of the same artifact never appends a second annotation.
function rollUpPostMerge(runDir, ledger, faults) {
    if (!isRecord(ledger) || !isRecord(ledger.outcomes))
        return;
    const failures = ledger.post_merge_verification_failures ?? [];
    const unverified = ledger.post_merge_verification_unverified ?? [];
    if (!Array.isArray(failures) || !Array.isArray(unverified)) {
        faults.push("post-merge annotations: existing ledger fields are malformed");
        return;
    }
    const failedIds = new Set(failures.map(row => isRecord(row) ? row.issue : undefined));
    const unverifiedIds = new Set(unverified);
    for (const [issue, outcome] of Object.entries(ledger.outcomes)) {
        if (outcome !== "shipped")
            continue;
        try {
            const artifact = readVerification(runDir, issue);
            if (!artifact)
                continue;
            const { contractData } = computePostMergeVerification(artifact);
            if (contractData?.verdict === "verified-fail") {
                // Older receipts may omit command or PR. Preserve their failure and only its observed fields.
                if (!contractData.conformant || !Number.isSafeInteger(artifact.pr)) {
                    faults.push(`post-merge verification ${issue}: incomplete failure evidence`);
                }
                if (!failedIds.has(issue)) {
                    const failure = { issue };
                    if (Number.isSafeInteger(artifact.pr))
                        failure.pr = artifact.pr;
                    if (artifact.merge_sha === null || typeof artifact.merge_sha === "string")
                        failure.merge_sha = artifact.merge_sha;
                    if (contractData.command)
                        failure.command = contractData.command;
                    failures.push(failure);
                    ledger.post_merge_verification_failures = failures;
                }
                continue;
            }
            if (!contractData?.conformant)
                throw new Error("invalid verification verdict");
            if (contractData.verdict === "verified-ok")
                continue;
        }
        catch (error) {
            faults.push(`post-merge verification ${issue}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!unverifiedIds.has(issue) && !failedIds.has(issue)) {
            unverified.push(issue);
            ledger.post_merge_verification_unverified = unverified;
        }
    }
}
