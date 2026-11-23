"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdDispatch = cmdDispatch;
// === region:factory — run a complete bundled spec-review lens batch ===
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const spec_review_results_ts_1 = require("./spec-review-results.js");
const { parseArgs, usageError } = require("./argv");
const { SPEC_REVIEW_LENSES } = require("./review-vocab");
const { nextRoundNumber } = require("./spec-review-window");
const usage = "usage: faff spec-review dispatch --dir DIR --spec FILE [--enabled-lenses CSV] [--context FILE]... [--root DIR] [--turn-budget-secs SECONDS]";
const flags = {
    "--dir": { arity: 1 }, "--spec": { arity: 1 }, "--context": { arity: 1, repeatable: true },
    "--enabled-lenses": { arity: 1 }, "--root": { arity: 1 }, "--turn-budget-secs": { arity: 1 },
};
async function runFanOut(args, out, seconds, supervise) {
    const stdio = ["ignore", out, "inherit"];
    const handlers = new Map();
    try {
        return await supervise({ deadlineSec: seconds ?? null, graceSec: 0, target: [process.execPath, ...args] }, {
            spawnFn: (cmd, argv, options) => (0, node_child_process_1.spawn)(cmd, argv, { ...options, stdio }),
            onSignal: (sig, handler) => { handlers.set(sig, handler); process.on(sig, handler); },
        });
    }
    finally {
        for (const [signal, handler] of handlers)
            process.off(signal, handler);
    }
}
async function cmdDispatch(argv, faff, fanOut, supervise, recorder) {
    const { values, errors } = parseArgs(argv, { flags, positionals: { min: 0, max: 0 } });
    const dir = values["--dir"], spec = values["--spec"];
    const budget = values["--turn-budget-secs"];
    const seconds = budget === undefined ? undefined : Number(budget);
    if (errors.length)
        return usageError(errors, usage);
    if (!dir || !spec || (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > 2147483647))) {
        return usageError([{ code: "bad-value", detail: "provide a directory, spec, and a valid positive budget when supplied" }], usage);
    }
    const lenses = values["--enabled-lenses"]?.split(",").map((lens) => lens.trim()) ?? SPEC_REVIEW_LENSES;
    if (!(0, spec_review_results_ts_1.validLensSet)(lenses)) {
        return usageError([{ code: "bad-value", detail: "--enabled-lenses must name a nonempty, distinct set of review lenses" }], usage);
    }
    const args = ["--dir", dir, "--spec", spec, "--lenses", lenses.join(",")];
    for (const file of values["--context"] ?? [])
        args.push("--context", file);
    if (values["--root"])
        args.push("--root", values["--root"]);
    const prepared = (0, node_child_process_1.spawnSync)(process.execPath, [faff, "spec-review", "prepare-requests", ...args], {
        encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
    });
    if (prepared.error || prepared.signal)
        throw prepared.error ?? new Error("request preparation interrupted");
    let descriptor;
    try {
        descriptor = JSON.parse(prepared.stdout);
    }
    catch { /* Use the ordinary no-results path. */ }
    const round = Number.isSafeInteger(descriptor?.round) && descriptor.round > 0 ? descriptor.round : nextRoundNumber(dir);
    const recordArgs = ["--dir", dir, "--round", String(round)];
    const noResults = () => {
        const code = recorder([...recordArgs, "--no-results"], lenses);
        if (!code)
            process.stderr.write(`spec-review: served 0/${lenses.length} lenses\n`);
        return code;
    };
    if (prepared.status !== 0 || typeof descriptor?.requests_path !== "string" ||
        typeof descriptor.backends_path !== "string" || typeof descriptor.strategy !== "string")
        return noResults();
    // prepare-requests owns this private scratch directory. Both handoff files survive a recording failure.
    const scratch = (0, node_path_1.dirname)(descriptor.requests_path);
    const results = (0, node_path_1.join)(scratch, "results.json");
    let keep = true;
    try {
        process.stderr.write("spec-review dispatch: round " + round + " prepared in " + scratch + "\n");
        const fd = (0, node_fs_1.openSync)(results, "wx", 0o600);
        let outcome;
        try {
            outcome = await runFanOut([fanOut, "--requests", descriptor.requests_path, "--strategy", descriptor.strategy], fd, seconds, supervise);
        }
        finally {
            (0, node_fs_1.closeSync)(fd);
        }
        if (outcome.status === "killed-deadline" || outcome.status === "killed-abort" || outcome.signal) {
            keep = false;
            return outcome.status === "killed-deadline" ? 124 : 130;
        }
        const complete = outcome.status === "exited" && outcome.innerExit === 0;
        if (complete && (0, node_fs_1.readFileSync)(results, "utf8").trim().length > 0) {
            let savedVotes = false;
            const status = recorder([...recordArgs, "--results", results, "--backends-json", descriptor.backends_path, "--strategy", descriptor.strategy], lenses, entries => {
                const votes = (0, node_path_1.join)(scratch, "retry-entries.json");
                (0, node_fs_1.writeFileSync)(votes, JSON.stringify(entries) + "\n", { flag: "wx", mode: 0o600 });
                savedVotes = true;
                process.stderr.write("spec-review dispatch: carry prior lens entries from " + votes + "\n");
            });
            keep = status !== 0 || savedVotes;
            return status;
        }
        const status = noResults();
        keep = status !== 0;
        return status;
    }
    finally {
        if (keep)
            process.stderr.write("spec-review dispatch: retained prepared requests and results for recovery in " + scratch + "\n");
        else
            (0, node_fs_1.rmSync)(scratch, { recursive: true, force: true });
    }
}
