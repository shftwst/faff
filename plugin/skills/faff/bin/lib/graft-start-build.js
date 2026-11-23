"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startGraftBuild = startGraftBuild;
// === region:factory — graft-start-build — check the owned run, place the worktree and prepare its builder spec ===
const path = require("node:path");
const spec = require("./spec-commit");
const { governedCheck, STATUS_TIMEOUT_MS } = require("./pr-open");
function write(result, code = 0) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return code;
}
function confirmClaim(args, sha, deps) {
    const result = deps.faff(["build-claim", "confirm", "--issue", args.issue, "--sha", sha, "--json"], args.root);
    if (result.status !== 0)
        return false;
    try {
        const receipt = JSON.parse(result.stdout);
        return receipt?.action === "confirm" && receipt.issue === args.issue && receipt.confirmed === true;
    }
    catch {
        return false;
    }
}
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function startGraftBuild(args, rawTitle, ownedSha, deps, place) {
    const { issue, runDir, root } = args;
    const title = spec.collapseTitle(rawTitle);
    if (!title || (ownedSha !== undefined && !SHA.test(ownedSha)) || !spec.ISSUE_RE.test(issue) || !runDir || !deps.isDir(runDir)) {
        process.stderr.write("faff graft start-build: invalid issue, title, claim SHA or run directory\n");
        return 2;
    }
    const probe = deps.faff(["commissaire", "contract", "status", "--run-dir", runDir], root, { timeout: STATUS_TIMEOUT_MS });
    const status = governedCheck({ ...probe, timedOut: probe.error?.message.includes("ETIMEDOUT") === true });
    if ("fault" in status)
        return write({ issue, disposition: "needs-human", cause: "commissaire-status-failed", detail: { reason: status.fault } }, 3);
    let claimSha = ownedSha;
    let newlyAcquired = false;
    if (claimSha === undefined) {
        const attempt = deps.faff(["build-claim", "acquire", "--issue", issue, "--json"], root, { runDir });
        let receipt;
        try {
            receipt = JSON.parse(attempt.stdout);
        }
        catch { /* invalid receipt */ }
        if (receipt?.action !== "acquire" || receipt.issue !== issue || typeof receipt.acquired !== "boolean") {
            return write({ issue, disposition: "needs-human", cause: "build-claim-read-failed" }, 2);
        }
        if (!receipt.acquired)
            return write({ issue, disposition: "claimed-by-peer", cause: receipt.reason, detail: receipt.detail }, 1);
        if (attempt.status !== 0 || typeof receipt.sha !== "string" || !SHA.test(receipt.sha) || typeof receipt.idempotent !== "boolean") {
            return write({ issue, disposition: "needs-human", cause: "build-claim-read-failed" }, 2);
        }
        claimSha = String(receipt.sha);
        newlyAcquired = !receipt.idempotent;
    }
    let ready = false;
    try {
        if (!confirmClaim(args, claimSha, deps))
            return write({ issue, disposition: "claimed-by-peer", cause: "claim-not-confirmed" }, 1);
        const worktree = place(args, deps);
        const result = { ...worktree, governed: status.governed, claim_sha: claimSha };
        if (worktree.disposition !== "ready")
            return write(result);
        if (worktree.resume_at === "gate" || worktree.resume_at === "review") {
            ready = true;
            return write(result);
        }
        if (!worktree.wt)
            throw new Error("ready worktree has no path");
        if (worktree.resume_at === "start" && !confirmClaim(args, claimSha, deps)) {
            return write({ ...result, disposition: "claimed-by-peer", cause: "claim-not-confirmed" }, 1);
        }
        const inputs = { issue, runDir, worktree: worktree.wt, specPath: path.join(root, ".faff", "graft", issue, "captured-spec.md") };
        const specDeps = spec.defaultDeps();
        let prepared;
        try {
            prepared = worktree.resume_at === "start"
                ? spec.runSpecCommit({ ...inputs, title }, specDeps)
                : spec.runSpecVerify(inputs, specDeps);
        }
        catch (error) {
            prepared = { issue, token: "errored", reason: error instanceof Error ? error.message : String(error) };
        }
        ready = ["committed", "already-committed", "verified"].includes(prepared.token);
        if (ready)
            return write({ ...result, spec: prepared });
        return write({ ...result, disposition: "needs-human", cause: "spec-not-ready", spec: prepared }, prepared.token === "errored" ? 2 : 1);
    }
    finally {
        if (newlyAcquired && !ready) {
            // Release by the acquired SHA. An inherited lease or a successor's ref belongs to its holder.
            const release = deps.faff(["build-claim", "release", "--issue", issue, "--sha", claimSha, "--json"], root);
            let receipt;
            try {
                receipt = JSON.parse(release.stdout);
            }
            catch { /* report failed housekeeping below */ }
            if (release.status !== 0 || (!receipt?.released && !["superseded", "absent", "missing"].includes(receipt?.reason))) {
                process.stderr.write("faff graft start-build: could not confirm release of the new build claim\n");
            }
        }
    }
}
