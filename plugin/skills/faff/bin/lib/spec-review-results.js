"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheAdvisory = cacheAdvisory;
exports.validLensSet = validLensSet;
exports.cmdRecordResults = cmdRecordResults;
// === region:factory — record an already-returned batch of spec-review lens results ===
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { withFileLock } = require("./fs-lock");
const { SPEC_REVIEW_LENSES } = require("./review-vocab");
const { captureNoLensServed, capturePin, captureReadFailure } = require("./spec-review-pin");
const usage = "usage: faff spec-review record-results --dir DIR --round N [--lenses CSV] [--receipts-only] [--strategy NAME] (--results FILE --backends-json FILE | --no-results)";
const argumentSpec = {
    positionals: { min: 0, max: 0 },
    flags: {
        "--dir": { arity: 1 }, "--round": { arity: 1 }, "--lenses": { arity: 1 },
        "--results": { arity: 1 }, "--backends-json": { arity: 1 }, "--no-results": { arity: 0 },
        "--receipts-only": { arity: 0 }, "--strategy": { arity: 1 },
    },
};
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isLensResult(value) {
    return record(value) && typeof value.lens === "string" && typeof value.exit === "number" &&
        Number.isInteger(value.exit) && value.exit >= 0 &&
        typeof value.stdout === "string" && typeof value.stderr === "string" && typeof value.truncated === "boolean";
}
function cacheAdvisory(strategy, timings) {
    if (strategy !== "prime-then-parallel")
        return null;
    const times = timings.map(row => row.ttftMs);
    if (times.length < 2 || !times.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) || !times[0]) {
        return "prefill-cache: not-computed";
    }
    const ratio = Math.max(...times.slice(1)) / times[0];
    return ratio >= 1 / 5
        ? `prime-then-parallel showed no prefill-cache benefit on this backend (post-prime/prime TTFT ratio ≥ 1/5); consider adversarial.spec_review.dispatch_strategy: parallel (ratio ${ratio})`
        : null;
}
function readBatch(file, lenses) {
    const rows = JSON.parse((0, node_fs_1.readFileSync)(file, "utf8"));
    if (!Array.isArray(rows) || rows.length !== lenses.length ||
        !rows.every((row, index) => isLensResult(row) && row.lens === lenses[index])) {
        throw new Error("expected exactly one ordered result per enabled lens");
    }
    return rows;
}
function unavailable(lens, kind = "config-fault") {
    return { lens, outcome: "unavailable", kind, objections: [] };
}
function writeTranscript(dir, round, lens, diagnostic) {
    const base = (0, node_path_1.join)(dir, `round-${round}-${lens.lens}`);
    const full = lens.stdout + (lens.stderr ? "\n\n## Transport stderr\n" + lens.stderr : "") +
        (diagnostic ? "\n\n## Parser diagnostics\n" + diagnostic + "\n" : "");
    for (let attempt = 0; attempt <= 1000; attempt++) {
        const path = (attempt === 0 ? base : `${base}.retry-${attempt}`) + ".md";
        try {
            (0, node_fs_1.writeFileSync)(path, full, { flag: "wx", mode: 0o600 });
            return;
        }
        catch (error) {
            if (!record(error) || error.code !== "EEXIST")
                throw error;
        }
    }
    throw new Error("too many transcript retries for " + lens.lens);
}
function captureServed(dir, round, rows, file, tools) {
    const chain = JSON.parse((0, node_fs_1.readFileSync)(file, "utf8"));
    if (!Array.isArray(chain) || !chain.length)
        throw new Error("prepared chain must contain at least one backend");
    let winner = Infinity;
    for (const row of rows) {
        const attribution = tools.servingAttribution(row.stdout);
        const backend = attribution === null ? undefined : chain[attribution.index];
        if (!attribution || !record(backend) ||
            typeof backend.provider !== "string" || typeof backend.model !== "string" || typeof backend.host !== "string" ||
            attribution.model !== `${backend.provider}/${backend.model}`) {
            throw new Error(row.lens + " serving attribution does not match the prepared chain");
        }
        winner = Math.min(winner, attribution.index);
    }
    const capture = capturePin(dir, chain, winner, round);
    if (capture.error)
        throw new Error(capture.detail);
}
function validLensSet(lenses) {
    return lenses.length > 0 && new Set(lenses).size === lenses.length && lenses.every(lens => SPEC_REVIEW_LENSES.includes(lens));
}
function cmdRecordResults(argv, tools, retainVotes, enabledLenses) {
    const { values, errors } = parseArgs(argv, argumentSpec);
    if (errors.length)
        return usageError(errors, usage);
    const dir = values["--dir"];
    const round = Number(values["--round"]);
    const resultsFile = values["--results"];
    const chainFile = values["--backends-json"];
    const noResults = Boolean(values["--no-results"]);
    const receiptsOnly = Boolean(values["--receipts-only"]);
    if (!dir || !/^\d+$/.test(values["--round"] ?? "") || !Number.isSafeInteger(round) || round < 1 ||
        (noResults ? (resultsFile || chainFile) : (!resultsFile || !chainFile))) {
        return usageError([{ code: "missing-value", detail: "a round, directory and exactly one batch source are required" }], usage);
    }
    const lenses = enabledLenses ?? (values["--lenses"] === undefined
        ? SPEC_REVIEW_LENSES
        : values["--lenses"].split(",").map((lens) => lens.trim()).filter(Boolean));
    if (!validLensSet(lenses)) {
        return usageError([{ code: "bad-value", detail: "--lenses must list distinct enabled lenses" }], usage);
    }
    // Only dispatch owns the full upstream selection. A standalone subset may be a retry.
    if (!enabledLenses && lenses.length !== SPEC_REVIEW_LENSES.length && !receiptsOnly) {
        return usageError([{ code: "bad-value", detail: "partial lens sets require --receipts-only" }], usage);
    }
    try {
        const results = resultsFile ? readBatch(resultsFile, lenses) : [];
        const refutations = results.map(row => row.exit === 0
            ? tools.classifyRefutation(row.stdout, row.lens, row.truncated)
            : { entry: unavailable(row.lens, [5, 8, 12].includes(row.exit) ? "infra-configured" : "config-fault") });
        const entries = noResults ? lenses.map(lens => unavailable(lens)) : refutations.map(item => item.entry);
        const verdict = receiptsOnly ? undefined : tools.aggregate(entries, lenses.length);
        const output = receiptsOnly ? JSON.stringify(entries) + "\n" : tools.renderBlock(verdict);
        const served = results.filter(row => row.exit === 0);
        (0, node_fs_1.mkdirSync)(dir, { recursive: true });
        for (const [index, row] of results.entries()) {
            if (row.exit !== 0)
                continue;
            const parsed = refutations[index];
            writeTranscript(dir, round, row, parsed && "diagnostic" in parsed ? parsed.diagnostic : undefined);
        }
        withFileLock((0, node_path_1.join)(dir, "spec-review-capture.lock"), () => {
            if (served.length === 0) {
                captureNoLensServed(dir, round);
            }
            else if (chainFile) {
                try {
                    captureServed(dir, round, served, chainFile, tools);
                }
                catch (error) {
                    captureReadFailure(dir, round, error instanceof Error ? error.message : String(error));
                    throw error;
                }
            }
        });
        if (retainVotes && record(verdict) && verdict.verdict === "unavailable")
            retainVotes(entries);
        if (values["--strategy"] !== undefined) {
            const message = cacheAdvisory(values["--strategy"], results);
            if (message)
                process.stderr.write(message + "\n");
            process.stderr.write("spec-review: served " + served.length + "/" + lenses.length + " lenses\n");
        }
        process.stdout.write(output);
        return 0;
    }
    catch (error) {
        process.stderr.write("faff spec-review record-results: " + (error instanceof Error ? error.message : String(error)) + "\n");
        return 2;
    }
}
