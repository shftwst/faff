"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sdkTurnReceipts = sdkTurnReceipts;
exports.recordClaudeResult = recordClaudeResult;
// === region:factory — SDK turn counts from isolated Claude print-mode drains ===
const fs = require("node:fs");
const path = require("node:path");
const node_crypto_1 = require("node:crypto");
const { readLeafNoFollow } = require("./leaf-read");
function obj(value) {
    if (value !== null && typeof value === "object" && !Array.isArray(value))
        return Object.fromEntries(Object.entries(value));
    return {};
}
function receiptPath(dir, epoch) {
    return path.join(dir, `sdk-turns-${epoch}.json`);
}
function digest(s) {
    return (0, node_crypto_1.createHash)("sha256").update(s).digest("hex");
}
function epochs(ledger) {
    const budget = obj(ledger.budget);
    if (Array.isArray(budget.sessions) && budget.sessions.length) {
        return budget.sessions.map(s => obj(s).session_id);
    }
    return [budget.measure_session_id];
}
function validTurns(t) {
    return typeof t === "number" && Number.isSafeInteger(t) && t >= 0;
}
function readJson(file) {
    const leaf = readLeafNoFollow(file);
    return leaf.kind === "regular" ? obj(JSON.parse(leaf.bytes.toString("utf8"))) : {};
}
function sdkTurnReceipts(dir, ledger) {
    const ids = epochs(ledger);
    let observed = 0, total = 0;
    for (const [i, id] of ids.entries()) {
        if (typeof id !== "string" || ids.indexOf(id) !== ids.lastIndexOf(id))
            continue;
        try {
            const receipt = readJson(receiptPath(dir, i));
            if (receipt.schema === 1 && receipt.run_id === ledger.run_id && receipt.session_sha256 === digest(id) && validTurns(receipt.num_turns)) {
                observed++;
                total += receipt.num_turns;
            }
        }
        catch { /* unavailable or malformed sidecar */ }
    }
    return { turns: observed === ids.length ? total : null, observed_turns: observed ? total : null, observed_epochs: observed, expected_epochs: ids.length };
}
// Consume only the final envelope of a fresh, UUID-pinned claude -p invocation. Keep the
// operator's usual text output; the private answer and SDK metadata never enter the receipt.
function recordClaudeResult() {
    try {
        const result = obj(JSON.parse(fs.readFileSync(0, "utf8")));
        if (result.type !== "result")
            throw Error();
        if (typeof result.result === "string")
            process.stdout.write(result.result + (result.result.endsWith("\n") ? "" : "\n"));
        const id = process.env.CLAUDE_CODE_SESSION_ID, dir = process.env.FAFF_RUN_DIR;
        if (!dir || !id || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ||
            result.session_id !== id || !validTurns(result.num_turns))
            throw Error();
        const ledger = readJson(path.join(dir, "run-ledger.json"));
        const ids = epochs(ledger), index = ids.indexOf(id);
        if (ledger.run_id !== path.basename(path.resolve(dir)) || index < 0 || index !== ids.lastIndexOf(id))
            throw Error();
        const file = receiptPath(dir, index);
        const receipt = { schema: 1, run_id: ledger.run_id, session_sha256: digest(id), num_turns: result.num_turns };
        const tmp = file + "." + (0, node_crypto_1.randomUUID)();
        try {
            fs.writeFileSync(tmp, JSON.stringify(receipt) + "\n", { flag: "wx", mode: 0o600 });
            try {
                fs.linkSync(tmp, file);
            }
            catch (e) {
                if (obj(e).code !== "EEXIST")
                    throw e;
                const old = readJson(file);
                if (old.schema !== 1 || old.run_id !== receipt.run_id || old.session_sha256 !== receipt.session_sha256 || old.num_turns !== receipt.num_turns)
                    throw e;
            }
        }
        finally {
            fs.rmSync(tmp, { force: true });
        }
    }
    catch {
        process.stderr.write("faff economics: isolated Claude SDK turn receipt unavailable\n");
    }
    // The launcher propagates Claude's exit, including when receipt capture fails.
    return 0;
}
