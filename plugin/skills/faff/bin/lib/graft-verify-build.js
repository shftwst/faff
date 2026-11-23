"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERIFY_BUILD_USAGE = void 0;
exports.cmdGraftVerifyBuild = cmdGraftVerifyBuild;
// === region:factory — graft-verify-build — bundled gates through the first AC decision ===
const path = require("node:path");
const argv = require("./argv");
const { cmdGates } = require("./gates-cli");
const { defaultDeps, ISSUE_RE, runSpecVerify } = require("./spec-commit");
exports.VERIFY_BUILD_USAGE = "usage: faff graft verify-build --worktree DIR --issue ID --spec FILE [--run-dir DIR]";
const SPEC = { flags: {
        "--worktree": { arity: 1 }, "--issue": { arity: 1 }, "--spec": { arity: 1 }, "--run-dir": { arity: 1 },
    }, positionals: { max: 0 } };
async function cmdGraftVerifyBuild(args) {
    const { values, errors } = argv.parseArgs(args, SPEC);
    if (errors.length)
        return argv.usageError(errors, exports.VERIFY_BUILD_USAGE);
    if (!values["--worktree"] || !values["--spec"] || values["--run-dir"] === "" || !ISSUE_RE.test(values["--issue"] ?? "")) {
        process.stderr.write(exports.VERIFY_BUILD_USAGE + "\n");
        return 2;
    }
    const worktree = path.resolve(values["--worktree"]);
    const specPath = path.resolve(values["--spec"]);
    const runDir = values["--run-dir"] ? path.resolve(values["--run-dir"]) : null;
    const issue = values["--issue"];
    const gateArgs = ["run", "--json", "--resume", "--root", worktree];
    if (runDir)
        gateArgs.push("--run-dir", runDir, "--unit", issue);
    return cmdGates(gateArgs, (gate) => {
        const emit = (action, code, fields = {}) => {
            process.stdout.write(JSON.stringify({ action, gate, ...fields }) + "\n");
            return code;
        };
        if (gate.receipt.signal !== "pass") {
            return emit(gate.receipt.signal === "fail" ? "fix-gates" : "needs-human", 1);
        }
        const hasRunner = gate.discovery !== "none";
        let spec;
        try {
            spec = runSpecVerify({ worktree, issue, specPath, runDir, includeCriteria: hasRunner }, defaultDeps());
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            spec = { issue, token: "errored", reason: "unexpected: " + reason };
        }
        if (spec.token !== "verified")
            return emit("refuse-spec", spec.token === "mismatch" ? 1 : 2, { spec });
        if (!hasRunner)
            return emit("needs-human", 1, { reason: "no-ac-runner", spec });
        return emit("verify-criteria", 0, { spec });
    });
}
