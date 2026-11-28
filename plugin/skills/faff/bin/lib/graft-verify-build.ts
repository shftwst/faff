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

export const RECORD_CRITERIA_USAGE = "usage: faff graft record-criteria --worktree DIR --issue ID --spec FILE --run-dir DIR --builder-sha SHA256 < JSON array of {ac_id, verified: string (observation), passed: boolean, verifications: [method, ...]}";
const RECORD_SPEC = { ...SPEC, flags: { ...SPEC.flags, "--builder-sha": { arity: 1 } } };

export function cmdRecordCriteria(args: string[]): number {
  const { values, errors } = argv.parseArgs(args, RECORD_SPEC);
  if (errors.length) return argv.usageError(errors, RECORD_CRITERIA_USAGE);
  const issue = values["--issue"];
  if (!ISSUE_RE.test(issue ?? "") || !values["--spec"] || !values["--worktree"] ||
      !values["--run-dir"] || !/^[a-f0-9]{64}$/.test(values["--builder-sha"] ?? "")) {
    process.stderr.write(RECORD_CRITERIA_USAGE + "\n");
    return 2;
  }
  const fs: typeof import("node:fs") = require("node:fs");
  const { runWriter, writeAcChecklist } = require("./evidence");
  return runWriter("faff graft record-criteria", values, (secrets: string[]) => {
    let verified: SpecResult;
    try {
      verified = runSpecVerify({ worktree: path.resolve(values["--worktree"]), issue,
        specPath: values["--spec"], runDir: values["--run-dir"], includeCriteria: true }, defaultDeps());
    } catch {
      return { refused: ["could not verify builder spec"] };
    }
    if (verified.token !== "verified" || !verified.criteria || verified.builder_sha256 !== values["--builder-sha"]) {
      return { refused: ["builder spec no longer matches the graded revision"] };
    }
    let rows: unknown;
    try { rows = JSON.parse(fs.readFileSync(0, "utf8")); }
    catch { return { refused: ["expected a JSON array of grade rows"] }; }
    if (!Array.isArray(rows) || rows.length !== verified.criteria.length) return { refused: ["expected one grade per DONE criterion"] };
    const grades = new Map();
    for (const row of rows) {
      if (!row || typeof row.ac_id !== "string" || grades.has(row.ac_id) || typeof row.passed !== "boolean" ||
          typeof row.verified !== "string" || !Array.isArray(row.verifications) || !row.verifications.length) {
        return { refused: ["each grade needs a unique ac_id, verified as a string describing the observed result, passed as a boolean, and a nonempty verifications array"] };
      }
      grades.set(row.ac_id, row);
    }
    const criteria = [];
    for (const { ac_id, text, human_only } of verified.criteria) {
      const row = grades.get(ac_id);
      if (!row) return { refused: ["missing or mismatched criterion ID"] };
      grades.delete(ac_id);
      if (human_only && (row.passed || row.verifications.length !== 1 || row.verifications[0]?.kind !== "human")) {
        return { refused: ["a human-only criterion needs an unchecked human verification"] };
      }
      criteria.push({ ac_id, ac: text, verified: row.verified, passed: row.passed, verifications: row.verifications });
    }
    const input = criteria.length ? { all_verified: criteria.every(row => row.passed), criteria } : { all_verified: true };
    return writeAcChecklist(values["--run-dir"], issue, JSON.stringify(input), secrets);
  });
}
