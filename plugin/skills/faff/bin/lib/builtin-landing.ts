// === region:factory — orchestrate the built-in ship producer after readiness ===
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

type Result = { status: number; stdout: string; stderr: string };
type Invoke = (args: string[], input?: string) => Result;
type CheckReplay = (dir: string, issue: string, pr: string | null, base: string | null, branch: string | null, sha: string | null) => boolean;
const { parseArgs } = require("./argv");
const { mergeRecordPath } = require("./merge-gate-floor");
const usage = "faff merge land-default --execute --run-dir DIR --issue ID --level L1|L2|L3|L4 (--pr N | --local [--base B] [--branch R]) [--custody-verdict FILE --custody-verdict-sha256 SHA]";
const values = ["--run-dir", "--issue", "--level", "--pr", "--base", "--branch", "--custody-verdict", "--custody-verdict-sha256"];
const flags = Object.fromEntries(values.map(key => [key, { arity: 1 }]));
const spec = { flags: { ...flags, "--execute": { arity: 0 }, "--local": { arity: 0 } }, positionals: { min: 0, max: 0 } };

function error(stage: string, detail: string, status = 2): Result {
  return { status, stdout: "", stderr: `faff merge land-default (${stage}): ${detail.trim()}\n` };
}

function recordSha(dir: string, issue: string, pr: string | null): string | null {
  let raw: string;
  try { raw = readFileSync(mergeRecordPath(dir, issue), "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  const r = JSON.parse(raw);
  if (r?.merged !== true || r.pr !== Number(pr) || typeof r.head_sha !== "string" || !/^[a-f0-9]{40,64}$/i.test(r.head_sha)) {
    throw new Error("invalid merge record for requested target");
  }
  return r.head_sha;
}

export function runBuiltinLanding(args: string[], run: Invoke, checkReplay: CheckReplay = require("./merge-authorize").checkLandingReplay): Result {
  const { values: v, errors } = parseArgs(args, spec);
  const dir = v["--run-dir"], issue = v["--issue"], level = v["--level"];
  const pr = v["--pr"] ?? null, local = v["--local"] === true;
  const custody = v["--custody-verdict"], digest = v["--custody-verdict-sha256"];
  if (errors.length || !v["--execute"] || !dir || !issue || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) || issue.includes("..") ||
      !/^L[1-4]$/.test(level) || local === (pr !== null) || (pr !== null && !/^[1-9]\d*$/.test(pr)) ||
      (!local && (v["--base"] || v["--branch"])) || Boolean(custody) !== Boolean(digest) || (digest && !/^[a-f0-9]{64}$/i.test(digest))) return error("arguments", usage);
  const target = ["--run-dir", dir, "--issue", issue, ...(local ? ["--local"] : ["--pr", pr])];
  for (const flag of ["--base", "--branch"]) if (v[flag]) target.push(flag, v[flag]);
  const effect = [...target, ...(local ? [] : ["--delete-branch"]), "--json"];
  let gate: Result;
  try {
    const sha = recordSha(dir, issue, pr);
    if (checkReplay(dir, issue, pr, v["--base"] ?? null, v["--branch"] ?? null, sha)) {
      gate = { status: 0, stdout: JSON.stringify({ verdict: "merge-ok", merged: true, blockers: [], head_sha: sha, note: "confirmed existing merge record" }), stderr: "" };
    } else {
      const grant = run(["merge", "authorize", ...effect]);
      if (grant.status !== 0) return error("authorize", grant.stderr || grant.stdout, grant.status);
      gate = run(["merge-gate", ...target, "--level", level, "--execute", "--json",
        ...(local ? [] : ["--merge-args", "--squash --delete-branch"]), ...(custody ? ["--custody-verdict", custody, "--custody-verdict-sha256", digest] : [])]);
      if (gate.status === 0) {
        const body = JSON.parse(gate.stdout);
        if (body?.verdict !== "merge-ok" || body.merged !== true || !Array.isArray(body.blockers) || body.blockers.length ||
          !body.head_sha || body.head_sha !== recordSha(dir, issue, pr)) return error("receipt", "gate did not confirm a matching recorded merge");
      }
    }
  } catch (e) { return error("receipt", String(e)); }
  if (gate.status === 0) {
    const observed = run(["merge", "observe", ...effect]);
    if (observed.status !== 0) return error("observe", observed.stderr || observed.stdout, 2);
  }
  const receipt = run(["merge-gate", "delivery-receipt", "--merge-exit", String(gate.status)], gate.stdout);
  return { ...receipt, stderr: gate.stderr + receipt.stderr };
}

export function cmdBuiltinLanding(args: string[]): number {
  const result = runBuiltinLanding(args, (argv, input) => {
    const r = spawnSync(process.execPath, [join(__dirname, "..", "faff"), ...argv], { encoding: "utf8", input });
    return { status: r.status ?? 2, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error?.message ?? "") };
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result.status;
}
