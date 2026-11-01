"use strict";
// ===========================================================================
// === region:factory — spec-review-hold — FAFF-1417: prep's outage and turn-budget holds as one verb ===
//
// `faff spec-review hold` runs the two hold dispositions faff-prep carried as pseudocode: the
// provider-outage hold and the turn-budget hand-back. It reads and writes only the hold store
// `.faff/resume/<ISSUE>/spec-review-hold.json`, under the resume-store issue lock (a concurrent
// `resume-store stash` copies that file, so an unlocked write in between is lost). The decision is
// the pure `decideHold`; the label write, the hold notice comment and the park protocol are
// returned for the skill to perform. A corrupt store parks and is renamed aside, never silently
// read as zero; an exhausted counter parks; the two counters never reset each other.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const resumeStore = require("./resume-store");
const roundApi = require("./spec-review-round");
const convergenceApi = require("./spec-review-convergence");
const churnApi = require("./spec-review-churn");
const sharedInfra = require("./shared-infra");
const argvApi = require("./argv");
// --- Untyped-JSON helpers. ---
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function field(o, key) {
    return isRecord(o) ? Reflect.get(o, key) : undefined;
}
function str(v) {
    return typeof v === "string" ? v : undefined;
}
function errText(e) {
    return e instanceof Error ? e.message : String(e);
}
function isNonNegInt(v) {
    return typeof v === "number" && Number.isInteger(v) && v >= 0;
}
// A fault the verb maps to exit 2; a held lock maps to exit 4.
class HoldFault extends Error {
}
class LockBusy extends Error {
}
const STORE_FILE = "spec-review-hold.json";
const LABEL = "faff-awaiting-spec-review";
const COUNTER = { outage: "outage_holds", "turn-budget": "turn_budget_holds" };
const TOKEN = { outage: "spec-review-held", "turn-budget": "spec-review-pending" };
const LIMIT_KEY = { outage: "prep.spec_review_outage_hold_limit", "turn-budget": "prep.spec_review_turn_budget_hold_limit" };
const ISSUE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function exhaustedCause(cause, count) {
    return cause === "outage"
        ? `spec-review provider outage, ${count} held drains exhausted`
        : `spec-review turn-budget: ${count} held drains exhausted — spec may be too large or a backend degraded`;
}
function corruptCause(cause) {
    return `spec-review-hold.json corrupt — cannot read ${COUNTER[cause]}`;
}
function notice(cause, count, limit) {
    const lead = cause === "outage" ? "spec-review provider unavailable" : "spec-review did not finish this turn";
    return `${lead}; spec attached and held; attempt ${count}/${limit}; auto-resumes at review on the next drain`;
}
// decideHold(store, cause, limit, extra) -> what the locked step does. `extra` carries the
// optional fields the write adds (kind, outaged_lenses, pinned_reviewer, held_at_round, held_at).
function decideHold(store, cause, limit, extra) {
    if (store.state === "corrupt")
        return { kind: "corrupt", cause: corruptCause(cause) };
    const current = {};
    if (store.state === "valid")
        for (const [k, v] of Object.entries(store.value))
            current[k] = v;
    const counter = COUNTER[cause];
    const raw = current[counter];
    if (raw !== undefined && !isNonNegInt(raw))
        return { kind: "corrupt", cause: corruptCause(cause) };
    const holds = isNonNegInt(raw) ? raw : 0;
    if (holds + 1 >= limit)
        return { kind: "exhausted", cause: exhaustedCause(cause, holds + 1), holds: holds + 1 };
    const write = { ...current, cause, [counter]: holds + 1 };
    for (const [k, v] of Object.entries(extra))
        if (v !== undefined)
            write[k] = v;
    return { kind: "hold", holds: holds + 1, write };
}
// readStore(text) classifies a store body: unparseable or not an object is corrupt. A counter
// that is present but not an integer >= 0 is corrupt for that counter's cause (decideHold) and
// for --read.
function classify(text) {
    if (text === null)
        return { state: "absent" };
    let v;
    try {
        v = JSON.parse(text);
    }
    catch {
        return { state: "corrupt" };
    }
    return isRecord(v) ? { state: "valid", value: v } : { state: "corrupt" };
}
function view(store) {
    if (store.state !== "valid")
        return { state: store.state, cause: null, outage_holds: null, turn_budget_holds: null, held_at_round: null };
    const o = field(store.value, "outage_holds");
    const t = field(store.value, "turn_budget_holds");
    if ((o !== undefined && !isNonNegInt(o)) || (t !== undefined && !isNonNegInt(t))) {
        return { state: "corrupt", cause: null, outage_holds: null, turn_budget_holds: null, held_at_round: null };
    }
    const h = field(store.value, "held_at_round");
    return {
        state: "valid",
        cause: str(field(store.value, "cause")) ?? "outage",
        outage_holds: isNonNegInt(o) ? o : null,
        turn_budget_holds: isNonNegInt(t) ? t : null,
        held_at_round: isNonNegInt(h) ? h : null,
    };
}
// --- Disk. ---
function readText(p) {
    try {
        return fs.readFileSync(p, "utf8");
    }
    catch (e) {
        if (field(e, "code") === "ENOENT")
            return null;
        throw new HoldFault(`${p} could not be read: ${errText(e)}`);
    }
}
function writeJsonAtomic(p, value) {
    const tmp = `${p}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tmp, p);
}
function withLock(storeRoot, issue, body) {
    fs.mkdirSync(storeRoot, { recursive: true });
    const lock = resumeStore.takeLock(storeRoot, issue);
    if (lock === null)
        throw new LockBusy(`the resume-store lock for ${issue} is held`);
    try {
        resumeStore.recover(storeRoot, issue);
        return body();
    }
    finally {
        resumeStore.releaseLock(lock);
    }
}
function readRecords(dir) {
    const out = new Map();
    let files;
    try {
        files = convergenceApi.roundFilesInDir(dir);
    }
    catch {
        return out;
    }
    for (const f of files) {
        const r = churnApi.readRoundRecord(f.path);
        if (r.record !== undefined)
            out.set(f.n, r.record);
        else
            throw new HoldFault(`${f.path} is unreadable`);
    }
    return out;
}
function readPin(dir) {
    const text = readText(path.join(dir, "pinned-reviewer.json"));
    if (text === null)
        return undefined;
    try {
        const v = JSON.parse(text);
        return v;
    }
    catch {
        return undefined;
    }
}
function storePaths(root, issue) {
    const storeRoot = path.join(root, ".faff", "resume");
    const issueDir = path.join(storeRoot, issue);
    return { storeRoot, issueDir, file: path.join(issueDir, STORE_FILE) };
}
function emptyResult(action, file) {
    return { action, token: null, cause: null, holds: null, limit: null, label_ops: [], comment: null, store_path: file, store: null };
}
function runHold(o) {
    const p = storePaths(o.root, o.issue);
    // 1. Interactive never auto-holds.
    if (o.mode === "interactive")
        return emptyResult("surface", p.file);
    // 2. The outage precondition: the in-turn ceiling was actually hit.
    let heldAtRound;
    let pinned;
    if (o.dir !== null) {
        const records = readRecords(o.dir);
        const ns = [...records.keys()].sort((a, b) => a - b);
        const latest = ns.length ? ns[ns.length - 1] : undefined;
        heldAtRound = latest;
        pinned = readPin(o.dir);
        if (o.cause === "outage") {
            if (latest === undefined || str(field(records.get(latest), "verdict")) !== "unavailable") {
                throw new HoldFault("--cause outage: the latest round record in --dir is not unavailable");
            }
            const retryLimit = o.retryLimit ?? roundApi.parseLimit(roundApi.configValue(o.root, "prep.spec_review_outage_retry_limit"), "prep.spec_review_outage_retry_limit");
            const prior = view(classify(readText(p.file))).held_at_round ?? 0;
            const attempt = roundApi.outageAttempt(records, latest, prior);
            if (attempt <= retryLimit)
                throw new HoldFault(`--cause outage: ${attempt} unavailable dispatch(es) this round, not above the retry limit ${retryLimit}`);
        }
    }
    else if (o.cause === "outage") {
        throw new HoldFault("--cause outage requires --dir <scratch>");
    }
    const limit = o.holdLimit ?? roundApi.parseLimit(roundApi.configValue(o.root, LIMIT_KEY[o.cause]), LIMIT_KEY[o.cause]);
    // 3. Under the resume-store lock.
    return withLock(p.storeRoot, o.issue, () => {
        const text = readText(p.file);
        const store = classify(text);
        const d = decideHold(store, o.cause, limit, {
            kind: o.kind ?? undefined,
            outaged_lenses: o.lenses ?? undefined,
            pinned_reviewer: pinned,
            held_at_round: heldAtRound,
            held_at: new Date().toISOString(),
        });
        const remove = [{ op: "remove", label: LABEL }];
        if (d.kind === "corrupt") {
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            fs.renameSync(p.file, path.join(p.issueDir, `spec-review-hold.corrupt-${stamp}.json`));
            return { ...emptyResult("park", p.file), token: "parked", cause: d.cause, limit, label_ops: remove };
        }
        if (d.kind === "exhausted") {
            fs.rmSync(p.file, { force: true });
            return { ...emptyResult("park", p.file), token: "parked", cause: d.cause, holds: d.holds, limit, label_ops: remove };
        }
        fs.mkdirSync(p.issueDir, { recursive: true });
        writeJsonAtomic(p.file, d.write);
        return {
            action: "hold", token: TOKEN[o.cause], cause: null, holds: d.holds, limit,
            label_ops: [{ op: "add", label: LABEL }], comment: notice(o.cause, d.holds, limit),
            store_path: p.file, store: view({ state: "valid", value: d.write }),
        };
    });
}
function readHold(root, issue) {
    const p = storePaths(root, issue);
    return { ...emptyResult("read", p.file), store: view(classify(readText(p.file))) };
}
function clearHold(root, issue) {
    const p = storePaths(root, issue);
    return withLock(p.storeRoot, issue, () => {
        fs.rmSync(p.file, { force: true });
        return { ...emptyResult("cleared", p.file), label_ops: [{ op: "remove", label: LABEL }] };
    });
}
// --- The verb. ---
const HOLD_SPEC = {
    flags: {
        "--issue": { arity: 1 },
        "--cause": { arity: 1, enum: ["outage", "turn-budget"] },
        "--mode": { arity: 1, enum: ["interactive", "autonomous"] },
        "--kind": { arity: 1, enum: ["infra-configured", "model-transient"] },
        "--lenses": { arity: 1 },
        "--dir": { arity: 1 },
        "--hold-limit": { arity: 1 },
        "--retry-limit": { arity: 1 },
        "--root": { arity: 1 },
        "--read": { arity: 0 },
        "--clear": { arity: 0 },
        "--json": { arity: 0 },
    },
};
const HOLD_USAGE = [
    "usage: faff spec-review hold --issue <ID> --cause outage|turn-budget --mode interactive|autonomous",
    "                             [--kind infra-configured|model-transient] [--lenses <csv>]",
    "                             [--dir <scratch>] [--hold-limit N] [--retry-limit N] [--root <dir>] [--json]",
    "       faff spec-review hold --read  --issue <ID> [--root <dir>] [--json]",
    "       faff spec-review hold --clear --issue <ID> [--root <dir>] [--json]",
].join("\n");
function printResult(json, r) {
    if (json) {
        process.stdout.write(`${JSON.stringify(r)}\n`);
        return;
    }
    const tail = r.cause !== null ? `: ${r.cause}` : r.store !== null && r.action === "read" ? `: ${r.store.state}` : "";
    process.stdout.write(`${r.action}${r.token === null ? "" : ` ${r.token}`}${tail}\n`);
}
function cmdSpecReviewHold(argv) {
    const { values, errors } = argvApi.parseArgs(argv, HOLD_SPEC);
    if (errors.length)
        return argvApi.usageError(errors, HOLD_USAGE);
    const json = values["--json"] === true;
    const fail = (code, reason) => {
        if (json)
            process.stdout.write(`${JSON.stringify({ action: "errored", reason })}\n`);
        process.stderr.write(`faff spec-review hold: ${reason}\n`);
        return code;
    };
    const issue = str(values["--issue"]);
    if (issue === undefined || !ISSUE_RE.test(issue))
        return fail(2, "--issue <ID> is required and must match ^[A-Za-z0-9][A-Za-z0-9._-]*$");
    try {
        const root = str(values["--root"]) ?? sharedInfra.findRoot();
        if (values["--read"] === true) {
            printResult(json, readHold(root, issue));
            return 0;
        }
        if (values["--clear"] === true) {
            printResult(json, clearHold(root, issue));
            return 0;
        }
        const cause = values["--cause"] === "outage" ? "outage" : values["--cause"] === "turn-budget" ? "turn-budget" : null;
        if (cause === null)
            return fail(2, "--cause outage|turn-budget is required");
        const mode = values["--mode"] === "interactive" ? "interactive" : values["--mode"] === "autonomous" ? "autonomous" : null;
        if (mode === null)
            return fail(2, "--mode interactive|autonomous is required");
        const holdRaw = str(values["--hold-limit"]);
        const retryRaw = str(values["--retry-limit"]);
        const lensesRaw = str(values["--lenses"]);
        const r = runHold({
            issue, cause, mode,
            kind: str(values["--kind"]) ?? null,
            lenses: lensesRaw === undefined ? null : lensesRaw.split(",").map((s) => s.trim()).filter((s) => s !== ""),
            dir: str(values["--dir"]) ?? null,
            holdLimit: holdRaw === undefined ? null : roundApi.parseLimit(holdRaw, "--hold-limit"),
            retryLimit: retryRaw === undefined ? null : roundApi.parseLimit(retryRaw, "--retry-limit"),
            root,
        });
        printResult(json, r);
        return 0;
    }
    catch (e) {
        if (e instanceof LockBusy)
            return fail(4, e.message);
        if (e instanceof HoldFault)
            return fail(2, e.message);
        if (e instanceof roundApi.RoundFault)
            return fail(2, e.message);
        throw e;
    }
}
module.exports = { cmdSpecReviewHold, decideHold, runHold, readHold, clearHold, HOLD_USAGE };
