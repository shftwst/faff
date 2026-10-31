"use strict";
// ===========================================================================
// === region:factory — run-checkpoint — FAFF-1436: beep-boop's between-units checkpoint as one verb ===
//
// `faff run checkpoint` runs the checkpoint that used to live as prose in faff-beep-boop ("The
// check", "The interrupt"): budget check, effects check, reconcile-merges, the sentry consult, the
// checkpoint events, the abort mark and the andon pump, in that order. Each step spawns the existing
// subcommand, so trigger maths, budget accounting and escape detection stay where they are. The
// ordering and branching is the pure `decideCheckpoint`, which returns one typed `action`; a park, a
// narrowing or a methodology pick is returned for the skill to act on, never performed here. Every
// read that fails is non-clean in the direction that keeps the kill-switch armed.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const sentryApi = require("./sentry");
const budgetApi = require("./budget");
const argvApi = require("./argv");
const ENTRYPOINT = path.resolve(__dirname, "..", "faff");
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
function isStringArray(v) {
    return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function parseJsonObject(text) {
    try {
        const v = JSON.parse(text);
        return isRecord(v) ? v : undefined;
    }
    catch {
        return undefined;
    }
}
function errText(e) {
    return e instanceof Error ? e.message : String(e);
}
// --- The result record (§3). ---
const ACTIONS = ["continue", "narrow", "park-issues", "stop", "escalate", "abort", "fail-closed"];
const INTERVENTIONS = ["continue", "surface", "pause", "correct", "abort"];
const BUDGET_OUTCOMES = ["none", "stop", "narrow", "escalate"];
const STOP_ACTIONS = ["stop", "escalate", "abort", "fail-closed"];
// `until` gates both phases; every other dimension gates build only (the wave boundary is build).
function budgetInScope(phase, budget) {
    if (budget === null)
        return [];
    return phase === "prep" ? budget.breached.filter((d) => d === "until") : budget.breached.slice();
}
// The issues a consult names: over trip-severity verdicts, `member`, `evidence.issue` and each
// `evidence.in_flight` entry, deduplicated in verdict order. Which signal maps to which intervention
// is sentry's; this only reads the fields that name an issue.
function namedIssues(verdicts) {
    const out = [];
    const add = (v) => {
        if (typeof v === "string" && v !== "" && !out.includes(v))
            out.push(v);
    };
    for (const v of verdicts) {
        if (field(v, "severity") !== "trip")
            continue;
        add(field(v, "member"));
        const evidence = field(v, "evidence");
        add(field(evidence, "issue"));
        const inFlight = field(evidence, "in_flight");
        if (Array.isArray(inFlight))
            for (const i of inFlight)
                add(i);
    }
    return out;
}
// Whether this run acts on the intervention. It depends only on the intervention, never on the action.
function actedOn(intervention, level, actsAbort, actsPause) {
    switch (intervention) {
        case "abort": return actsAbort;
        case "pause": return actsPause;
        case "correct": return level === "L4" ? true : actsPause;
        case "surface": return true;
        default: return false;
    }
}
// §4.2: the pure decision. It spawns nothing and reads nothing; `abort_required` is computed first and
// independently of the action, so an escalate that outranks an abort still records the abort mark.
function decideCheckpoint(inputs) {
    const { phase, level, acts_abort, acts_pause, budget, consult } = inputs;
    const intervention = consult === null ? null : consult.intervention;
    const inScope = budgetInScope(phase, budget);
    const dims = inScope.join(",");
    const outcome = budget === null ? null : budget.outcome;
    const abortRequired = intervention === "abort" && acts_abort;
    const acted = actedOn(intervention, level, acts_abort, acts_pause);
    const named = consult === null ? [] : namedIssues(consult.verdicts);
    const base = { acted, abort_required: abortRequired, park_issues: [], needs_judgement: [] };
    if ((consult === null || budget === null) && acts_abort)
        return { ...base, action: "fail-closed", stop_reason: null };
    if (outcome === "escalate" && inScope.length > 0)
        return { ...base, action: "escalate", stop_reason: `budget-escalated(${dims})` };
    if (abortRequired)
        return { ...base, action: "abort", stop_reason: "sentry-abort" };
    if (outcome === "stop" && inScope.length > 0)
        return { ...base, action: "stop", stop_reason: `budget-hit(${dims})` };
    if (intervention === "correct" && level === "L4") {
        const needs = named.length === 0 ? [{ kind: "correct-narrowing" }] : named.map((issue) => ({ kind: "correct-narrowing", issue }));
        return { ...base, action: "continue", stop_reason: null, needs_judgement: needs };
    }
    if ((intervention === "pause" || intervention === "correct") && acts_pause) {
        if (named.length === 0)
            return { ...base, action: "continue", stop_reason: null, needs_judgement: [{ kind: "pause-unattributed" }] };
        return { ...base, action: "park-issues", stop_reason: null, park_issues: named };
    }
    if (outcome === "narrow" && inScope.length > 0)
        return { ...base, action: "narrow", stop_reason: null, needs_judgement: [{ kind: "narrow-subset" }] };
    return { ...base, action: "continue", stop_reason: null };
}
// --- Reads that fail toward supervision (§4.1). ---
function readBudget(r) {
    if (r.status !== 0)
        return null;
    const state = parseJsonObject(r.stdout);
    if (state === undefined)
        return null;
    const outcome = field(state, "outcome");
    const breached = field(state, "breached");
    if (typeof outcome !== "string" || !BUDGET_OUTCOMES.includes(outcome) || !isStringArray(breached))
        return null;
    return { state, outcome, breached };
}
function readConsult(r) {
    if (r.status !== 0)
        return null;
    const payload = parseJsonObject(r.stdout);
    if (payload === undefined || field(payload, "indeterminate") === true)
        return null;
    const intervention = field(payload, "intervention");
    const verdicts = field(payload, "verdicts");
    if (typeof intervention !== "string" || !INTERVENTIONS.includes(intervention) || !Array.isArray(verdicts))
        return null;
    return { payload, intervention, verdicts, tripped: field(payload, "tripped") === true };
}
// --- The run dir, the ledger and the root (§3, §4.1 step 0). ---
class CheckpointUsageError extends Error {
}
function canonical(p) {
    try {
        return fs.realpathSync(p);
    }
    catch {
        return path.resolve(p);
    }
}
function readLedger(runDir) {
    const file = path.join(runDir, "run-ledger.json");
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    }
    catch (e) {
        throw new CheckpointUsageError(`cannot read ${file}: ${errText(e)}`);
    }
    const ledger = parseJsonObject(text);
    if (ledger === undefined)
        throw new CheckpointUsageError(`${file} is not a JSON object`);
    return ledger;
}
// root := the ledger's pinned measure_root, else --root, else the repo root above the run dir. A
// disagreement between the two is `root-drift`; neither present is `root-inferred`.
function resolveRoot(runDir, rootFlag, ledger) {
    const pinned = str(field(field(ledger, "budget"), "measure_root")) ?? null;
    const faults = [];
    let root;
    if (pinned !== null) {
        root = pinned;
        if (rootFlag !== null && canonical(rootFlag) !== canonical(pinned))
            faults.push("root-drift");
    }
    else if (rootFlag !== null) {
        root = rootFlag;
    }
    else {
        root = path.resolve(runDir, "..", "..", "..");
        faults.push("root-inferred");
    }
    const expected = path.join(canonical(root), ".faff", "runs", path.basename(path.resolve(runDir)));
    if (canonical(runDir) !== expected) {
        throw new CheckpointUsageError(`run dir ${runDir} is not ${path.join(root, ".faff", "runs", path.basename(runDir))}`);
    }
    return { root, faults };
}
function realDeps() {
    return {
        faff: (args, opts) => {
            const r = childProcess.spawnSync(process.execPath, [ENTRYPOINT, ...args], { cwd: opts.cwd, encoding: "utf8", input: opts.input ?? "", env: process.env });
            return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
        },
        readConfig: (root) => budgetApi.readGovernanceConfig(root),
    };
}
function runCheckpoint(args, deps) {
    const ledger = readLedger(args.runDir);
    const runId = path.basename(path.resolve(args.runDir));
    const resolved = resolveRoot(args.runDir, args.root, ledger);
    const root = resolved.root;
    const faults = resolved.faults.slice();
    const runDir = path.join(root, ".faff", "runs", runId);
    const level = str(field(ledger, "level")) ?? null;
    const sessionArgs = args.sessionId === null ? [] : ["--session-id", args.sessionId];
    // A spawn that throws is a failed read like any other non-zero exit, so it lands as its step's fault.
    const faff = (argv, input) => {
        try {
            return deps.faff(argv, input === undefined ? { cwd: root } : { cwd: root, input });
        }
        catch (e) {
            return { status: null, stdout: "", stderr: errText(e) };
        }
    };
    // A malformed base config degrades to the built-in defaults exactly as `sentry check` does, and is
    // recorded; any other config fault is the dispatch boundary's loud exit.
    let cfg;
    try {
        cfg = deps.readConfig(root);
    }
    catch (e) {
        if (errText(e) !== "base-parse-error")
            throw e;
        cfg = {};
        faults.push("config-malformed");
    }
    const actsAbort = sentryApi.actsOnSentryAbort(ledger, cfg);
    const actsPause = sentryApi.actsOnSentryPause(ledger, cfg);
    // 1. Budget.
    const budget = readBudget(faff(["budget", "check", "--json", "--run-dir", runDir, "--root", root, ...sessionArgs]));
    if (budget === null)
        faults.push("budget-check-failed");
    // 2. The budget-checkpoint event, token-tagged.
    if (budget !== null) {
        const r = faff(["events", "append", "--run", runId, "--root", root, "--tokens", ...sessionArgs], JSON.stringify({ phase: "run", type: "budget-checkpoint", data: budget.state }));
        if (r.status !== 0)
            faults.push("budget-checkpoint-append-failed");
    }
    // 3–4. Escape detection: a fault reads as no escape for `check`, and as not reconciled for reconcile-merges.
    const checkRun = faff(["effects", "check", "--run", runId, "--root", root, "--json"]);
    const check = checkRun.status === 0 ? parseJsonObject(checkRun.stdout) : undefined;
    let checkEscape = false;
    if (check === undefined)
        faults.push("effects-check-failed");
    else
        checkEscape = field(check, "any_escape") === true;
    const recRun = faff(["effects", "reconcile-merges", "--run", runId, "--root", root, "--json"]);
    const rec = recRun.status === 0 ? parseJsonObject(recRun.stdout) : undefined;
    let recEscape = false;
    let recNotReconciled = false;
    if (rec === undefined) {
        faults.push("reconcile-merges-failed");
        recNotReconciled = true;
    }
    else if (field(rec, "legacy_exempt") !== true) {
        recEscape = field(rec, "any_escape") === true;
        recNotReconciled = field(rec, "reconciled") === false;
    }
    const forbidden = checkEscape || recEscape || recNotReconciled;
    // 5. The consult, and its events on a completed consult only.
    const consult = readConsult(faff(["sentry", "check", "--json", "--run-dir", runDir, ...(forbidden ? ["--forbidden-side-effect"] : [])]));
    if (consult === null)
        faults.push("sentry-consult-failed");
    else {
        const a = faff(["events", "append", "--run", runId, "--root", root], JSON.stringify({ phase: "run", type: "sentry-checkpoint", data: consult.payload }));
        if (a.status !== 0)
            faults.push("sentry-checkpoint-append-failed");
        if (consult.tripped) {
            const t = faff(["events", "append", "--run", runId, "--root", root], JSON.stringify({ phase: "run", type: "sentry-trip", data: { verdicts: consult.verdicts, intervention: consult.intervention } }));
            if (t.status !== 0)
                faults.push("sentry-trip-append-failed");
        }
    }
    // 6. Decide.
    const phase = args.phase;
    const decision = decideCheckpoint({ phase, level, acts_abort: actsAbort, acts_pause: actsPause, budget, consult });
    // 7. The abort mark. The action stands whether or not the CLI could record it.
    let sentryAborted = false;
    if (decision.abort_required) {
        const r = faff(["sentry", "abort", "--run-dir", runDir]);
        if (r.status === 0)
            sentryAborted = true;
        else
            faults.push("sentry-abort-failed");
    }
    // 8. Andon, fail-open.
    if (faff(["andon", "pump", "--run-dir", runDir]).status !== 0)
        faults.push("andon-pump-failed");
    return {
        action: decision.action,
        stop_reason: decision.stop_reason,
        budget: budget === null ? null : budget.state,
        budget_in_scope: budgetInScope(phase, budget),
        forbidden,
        intervention: consult === null ? null : consult.intervention,
        verdicts: consult === null ? [] : consult.verdicts,
        acted: decision.acted,
        sentry_aborted: sentryAborted,
        park_issues: decision.park_issues,
        needs_judgement: decision.needs_judgement,
        faults,
    };
}
// --- The verb. ---
const CHECKPOINT_SPEC = {
    flags: {
        "--run-dir": { arity: 1 },
        "--phase": { arity: 1, enum: ["prep", "build", "wave"] },
        "--root": { arity: 1 },
        "--session-id": { arity: 1 },
        "--json": { arity: 0 },
    },
};
const CHECKPOINT_USAGE = "usage: faff run checkpoint --run-dir DIR --phase prep|build|wave [--root DIR] [--session-id ID] [--json]";
function toPhase(v) {
    return v === "prep" || v === "build" || v === "wave" ? v : null;
}
function exitFor(action) {
    return STOP_ACTIONS.includes(action) ? 3 : 0;
}
function cmdRunCheckpoint(argv, deps = realDeps()) {
    const { values, errors } = argvApi.parseArgs(argv, CHECKPOINT_SPEC);
    if (errors.length)
        return argvApi.usageError(errors, CHECKPOINT_USAGE);
    const runDir = str(values["--run-dir"]);
    if (runDir === undefined || runDir === "")
        return argvApi.usageError([{ code: "missing-required", detail: "--run-dir DIR is required" }], CHECKPOINT_USAGE);
    const phase = toPhase(values["--phase"]);
    if (phase === null)
        return argvApi.usageError([{ code: "missing-required", detail: "--phase prep|build|wave is required" }], CHECKPOINT_USAGE);
    let result;
    try {
        result = runCheckpoint({ runDir, phase, root: str(values["--root"]) ?? null, sessionId: str(values["--session-id"]) ?? null }, deps);
    }
    catch (e) {
        if (e instanceof CheckpointUsageError) {
            process.stderr.write(`faff run checkpoint: ${e.message}\n`);
            return 2;
        }
        throw e;
    }
    if (values["--json"] === true)
        process.stdout.write(`${JSON.stringify(result)}\n`);
    else {
        const lines = [`checkpoint: ${result.action}${result.stop_reason === null ? "" : ` ${result.stop_reason}`}`, ...result.faults.map((f) => `fault: ${f}`)];
        process.stdout.write(`${lines.join("\n")}\n`);
    }
    return exitFor(result.action);
}
module.exports = { cmdRunCheckpoint, decideCheckpoint, runCheckpoint, realDeps, namedIssues, ACTIONS, CHECKPOINT_USAGE };
