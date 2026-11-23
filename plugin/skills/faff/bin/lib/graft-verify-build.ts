// === region:factory — graft-verify-build — bundled gates through the first AC decision ===
const path: typeof import("node:path") = require("node:path");
const argv = require("./argv");
const { cmdGates } = require("./gates-cli");
import type { SpecResult, SpecDeps, VerifyOptions } from "./spec-commit";
const { defaultDeps, ISSUE_RE, runSpecVerify }: {
  defaultDeps(): SpecDeps; ISSUE_RE: RegExp; runSpecVerify(options: VerifyOptions, deps: SpecDeps): SpecResult;
} = require("./spec-commit");

type GateReport = { receipt: { signal: "pass" | "fail" | "needs-human" }; discovery: string };

export const VERIFY_BUILD_USAGE = "usage: faff graft verify-build --worktree DIR --issue ID --spec FILE [--run-dir DIR]";
const SPEC = { flags: {
  "--worktree": { arity: 1 }, "--issue": { arity: 1 }, "--spec": { arity: 1 }, "--run-dir": { arity: 1 },
}, positionals: { max: 0 } };

export async function cmdGraftVerifyBuild(args: string[]): Promise<number> {
  const { values, errors } = argv.parseArgs(args, SPEC);
  if (errors.length) return argv.usageError(errors, VERIFY_BUILD_USAGE);
  if (!values["--worktree"] || !values["--spec"] || values["--run-dir"] === "" || !ISSUE_RE.test(values["--issue"] ?? "")) {
    process.stderr.write(VERIFY_BUILD_USAGE + "\n");
    return 2;
  }
  const worktree = path.resolve(values["--worktree"]);
  const specPath = path.resolve(values["--spec"]);
  const runDir = values["--run-dir"] ? path.resolve(values["--run-dir"]) : null;
  const issue = values["--issue"];
  const gateArgs = ["run", "--json", "--resume", "--root", worktree];
  if (runDir) gateArgs.push("--run-dir", runDir, "--unit", issue);

  return cmdGates(gateArgs, (gate: GateReport) => {
    const emit = (action: string, code: number, fields = {}): number => {
      process.stdout.write(JSON.stringify({ action, gate, ...fields }) + "\n");
      return code;
    };
    if (gate.receipt.signal !== "pass") {
      return emit(gate.receipt.signal === "fail" ? "fix-gates" : "needs-human", 1);
    }
    const hasRunner = gate.discovery !== "none";
    let spec: SpecResult;
    try {
      spec = runSpecVerify({ worktree, issue, specPath, runDir, includeCriteria: hasRunner }, defaultDeps());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      spec = { issue, token: "errored", reason: "unexpected: " + reason };
    }
    if (spec.token !== "verified") return emit("refuse-spec", spec.token === "mismatch" ? 1 : 2, { spec });
    if (!hasRunner) return emit("needs-human", 1, { reason: "no-ac-runner", spec });
    return emit("verify-criteria", 0, { spec });
  });
}
