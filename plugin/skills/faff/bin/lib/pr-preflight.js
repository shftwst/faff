"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// === region:factory — observe the default delivery path's diff-independent preconditions. ===
const node_child_process_1 = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { runGh } = require("./merge-gate-gh");
const { loadConfig } = require("./config");
const { resolveConvention } = require("./conventions");
const { parseWorktreeEntries, ownMatches, tokenMatch } = require("./worktree-prune");
const { detectClobber } = require("./worktree-heal");
const { selectIssueBranch } = require("./worktree-ensure");
const usage = "faff pr preflight (--branch NAME | --issue ID --slug SLUG [--tracker-branch NAME])";
const flags = { flags: { "--branch": { arity: 1 }, "--issue": { arity: 1 }, "--slug": { arity: 1 }, "--tracker-branch": { arity: 1 } } };
function git(args) {
    return (0, node_child_process_1.spawnSync)("git", args, { encoding: "utf8", timeout: 15000, killSignal: "SIGKILL",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } });
}
// Use the issue-owned worktree when resuming, otherwise the same naming convention and tracker
// hint as worktree ensure. Computing the fresh convention in memory leaves its cache untouched.
function featureBranch(root, target) {
    if ("branch" in target)
        return target.branch;
    const entries = parseWorktreeEntries(root);
    if (entries === null)
        return null;
    const matches = entries.filter(e => ownMatches(e, { paths: [], branch: null, issue: target.issue }));
    if (matches.length) {
        const branch = matches.length === 1 ? matches[0]?.branch : null;
        // The main checkout's directory can itself contain the issue ID. Its current branch
        // is only evidence for this probe when the branch also names the issue.
        return branch && (matches[0]?.path !== root || tokenMatch(branch, target.issue)) ? branch : null;
    }
    const orphan = detectClobber(root, target.issue);
    if (orphan)
        return orphan.branch ?? null;
    const cfg = loadConfig(root)[0];
    const scheme = resolveConvention(root, "branch_naming", cfg).value;
    return selectIssueBranch(target.issue, target.slug, target.hint, scheme, (name) => git(["check-ref-format", "--branch", name]).status === 0, []);
}
function probePush(branch, run) {
    if (!branch || run(["check-ref-format", "--branch", branch]).status !== 0)
        return "indeterminate";
    const dest = "refs/heads/" + branch;
    const ref = run(["show-ref", "--verify", "--quiet", dest]).status;
    if (ref !== 0 && ref !== 1)
        return "indeterminate";
    const r = run(["push", "--dry-run", "--no-verify", "--porcelain", "origin", (ref === 0 ? dest : "HEAD") + ":" + dest]);
    if (r.status === 0)
        return "clear";
    // A stale/reused ref, missing remote, expired request or network fault needs a real attempt.
    const why = [r.stderr, r.stdout].join("\n");
    return r.status !== null && /write access to repository not granted|permission to [^\r\n]+ denied to |protected branch hook declined|GH006: Protected branch update failed/i.test(why)
        ? "blocked" : "indeterminate";
}
function probeSquash(r) {
    if (r.status !== 0 || !r.stdout)
        return "indeterminate";
    try {
        const repo = JSON.parse(r.stdout);
        return repo?.allow_squash_merge === true ? "clear" : repo?.allow_squash_merge === false ? "blocked" : "indeterminate";
    }
    catch {
        return "indeterminate";
    }
}
function preflight(target) {
    const remotes = git(["remote"]);
    if (remotes.status === 0 && remotes.stdout?.trim() === "")
        return { status: "git-only" };
    if (remotes.status !== 0)
        return { status: "indeterminate" };
    let branch = null;
    const root = git(["rev-parse", "--show-toplevel"]);
    if (root.status === 0 && root.stdout) {
        try {
            branch = featureBranch(root.stdout.trim(), target);
        }
        catch { /* cannot establish the branch */ }
    }
    const push = probePush(branch, git);
    const mergeMethod = probeSquash(runGh(["api", "repos/{owner}/{repo}"], { cwd: process.cwd(), timeout: 15000, killSignal: "SIGKILL" }));
    const checks = { push, "merge-method": mergeMethod };
    if (push === "blocked")
        return { status: "blocked", branch, checks, cause: "not-ready:precondition:push \u2014 the remote rejected write access to the feature branch; remedy: grant branch push access or use an authorized identity" };
    if (mergeMethod === "blocked")
        return { status: "blocked", branch, checks, cause: "not-ready:precondition:merge-method \u2014 squash merging is disabled; remedy: enable squash merging in the destination repository" };
    return { status: push === "clear" && mergeMethod === "clear" ? "clear" : "indeterminate", branch, checks };
}
function cmdPrPreflight(args) {
    if (args.length === 1 && args[0] === "--help") {
        console.log(usage);
        return 0;
    }
    const { values: v, errors } = parseArgs(args, flags);
    if (errors.length)
        return usageError(errors, usage);
    const bad = () => usageError([{ code: "bad-value", detail: "supply the feature branch, or the issue and title slug used by worktree ensure" }], usage);
    let target;
    if (v["--branch"] !== undefined) {
        if (v["--issue"] !== undefined || v["--slug"] !== undefined || v["--tracker-branch"] !== undefined)
            return bad();
        const syntax = git(["check-ref-format", "--branch", v["--branch"]]).status;
        if (syntax !== null && syntax !== 0)
            return bad();
        target = { branch: v["--branch"] };
    }
    else {
        if (typeof v["--issue"] !== "string" || !/^[a-z0-9][a-z0-9_.-]*$/i.test(v["--issue"]) || v["--issue"].includes("..")
            || typeof v["--slug"] !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v["--slug"]))
            return bad();
        target = { issue: v["--issue"], slug: v["--slug"], hint: v["--tracker-branch"] ?? null };
    }
    const result = preflight(target);
    console.log(JSON.stringify(result));
    return result.status === "blocked" ? 1 : 0;
}
module.exports = { cmdPrPreflight };
