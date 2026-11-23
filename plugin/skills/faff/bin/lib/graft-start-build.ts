// === region:factory — graft-start-build — check the owned run, place the worktree and prepare its builder spec ===
import type { Deps, EnsureArgs, EnsureResult } from "./worktree-ensure";
import type { CommitOptions, SpecDeps, SpecResult, VerifyOptions } from "./spec-commit";
import type { Spawned } from "./pr-open";
const path: typeof import("node:path") = require("node:path");
const { spawnSync }: typeof import("node:child_process") = require("node:child_process");
const { ensure }: { ensure(args: EnsureArgs, deps: Deps): EnsureResult } = require("./worktree-ensure");
const spec: {
  ISSUE_RE: RegExp; collapseTitle(input: string | undefined): string; defaultDeps(): SpecDeps;
  runSpecCommit(opts: CommitOptions, deps: SpecDeps): SpecResult; runSpecVerify(opts: VerifyOptions, deps: SpecDeps): SpecResult;
} = require("./spec-commit");
const { governedCheck, STATUS_TIMEOUT_MS }: {
  governedCheck(result: Spawned): { governed: boolean } | { fault: string }; STATUS_TIMEOUT_MS: number;
} = require("./pr-open");

function write(result: object, code = 0): number {
  process.stdout.write(JSON.stringify(result) + "\n");
  return code;
}

function confirmClaim(args: EnsureArgs, sha: string, deps: Deps): boolean {
  const result = deps.faff(["build-claim", "confirm", "--issue", args.issue, "--sha", sha, "--json"], args.root);
  if (result.status !== 0) return false;
  try {
    const receipt = JSON.parse(result.stdout);
    return receipt?.action === "confirm" && receipt.issue === args.issue && receipt.confirmed === true;
  } catch { return false; }
}

export function startGraftBuild(args: EnsureArgs, rawTitle: string | undefined, claimSha: string | undefined, deps: Deps): number {
  const { issue, runDir, root } = args;
  const title = spec.collapseTitle(rawTitle);
  if (!title || !claimSha || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(claimSha) || !spec.ISSUE_RE.test(issue) || !runDir || !deps.isDir(runDir)) {
    process.stderr.write("faff graft start-build: a tracker issue ID, nonempty title, acquired claim SHA and an existing run directory are required\n");
    return 2;
  }
  const probe = spawnSync(process.execPath, [path.join(__dirname, "..", "faff"), "commissaire", "contract", "status", "--run-dir", runDir], {
    cwd: root, env: deps.env, encoding: "utf8", timeout: STATUS_TIMEOUT_MS, killSignal: "SIGKILL",
  });
  const status = governedCheck({ status: probe.status, stdout: probe.stdout ?? "", stderr: "", timedOut: probe.error?.message.includes("ETIMEDOUT") === true });
  if ("fault" in status) return write({ issue, disposition: "needs-human", cause: "commissaire-status-failed", detail: { reason: status.fault } }, 3);

  if (!confirmClaim(args, claimSha, deps)) return write({ issue, disposition: "claimed-by-peer", cause: "claim-not-confirmed" }, 1);
  const worktree = ensure(args, deps);
  const result = { ...worktree, governed: status.governed };
  if (worktree.disposition !== "ready" || !worktree.wt || (worktree.resume_at !== "start" && worktree.resume_at !== "existing")) return write(result);

  if (worktree.resume_at === "start" && !confirmClaim(args, claimSha, deps)) {
    return write({ ...result, disposition: "claimed-by-peer", cause: "claim-not-confirmed" }, 1);
  }
  const inputs = { issue, runDir, worktree: worktree.wt, specPath: path.join(root, ".faff", "graft", issue, "captured-spec.md") };
  const specDeps = spec.defaultDeps();
  let prepared: SpecResult;
  try {
    prepared = worktree.resume_at === "start"
      ? spec.runSpecCommit({ ...inputs, title }, specDeps)
      : spec.runSpecVerify(inputs, specDeps);
  } catch (error) {
    prepared = { issue, token: "errored", reason: error instanceof Error ? error.message : String(error) };
  }
  if (["committed", "already-committed", "verified"].includes(prepared.token)) return write({ ...result, spec: prepared });
  return write({ ...result, disposition: "needs-human", cause: "spec-not-ready", spec: prepared }, prepared.token === "errored" ? 2 : 1);
}
