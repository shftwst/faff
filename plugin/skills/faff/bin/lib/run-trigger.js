"use strict";
// ===========================================================================
// === region:factory — run-trigger — FAFF-1418: beep-boop's L4 run-start trigger as one verb ===
//
// `faff run trigger` runs the signal assembly that used to live as prose in faff-beep-boop §0a
// ("Run-start trigger — PLAN / drain / refuse", L4 lights-out only). It classifies the inherited
// handoff, performs the PRD, target, outward, readiness and coverage reads, coerces each result to
// one of the seven `faff run-start` signals, spawns `faff run-start` for the verdict, and records the
// creative licence on `drain` (or after `plan`). Each read spawns its existing producer, so no ladder
// is re-derived here. The two judgement steps (invoking the `prd` slot, reading the PRD's goals) stay
// with the skill: the command stops at `needs-judgement:prd-inputs` and takes their results as files.
// Every failed read lands on the refuse-biased value.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const runRecordPrd = require("./run-record-prd");
const decisionCapture = require("./decision-capture");
const argvApi = require("./argv");
const sharedInfra = require("./shared-infra");
const ENTRYPOINT = path.resolve(__dirname, "..", "faff");
const RUN_ISSUE = "__run__";
const READINESS_MAX_BYTES = 1024 * 1024;
const READINESS_FENCE = /^```faff-contract:prd-readiness[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;
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
function parseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
function parseJsonObject(text) {
    const v = parseJson(text);
    return isRecord(v) ? v : undefined;
}
function errText(e) {
    return e instanceof Error ? e.message : String(e);
}
const TOKENS = ["skip", "fault", "needs-judgement:prd-inputs", "plan", "drain", "refuse", "record-failed", "recorded"];
const STOP_TOKENS = ["refuse", "fault", "record-failed"];
// §4.2: the pure decision. It spawns nothing and reads nothing. Every signal is strictly `=== true`,
// so a missing or non-boolean read can never turn into an affirmative signal.
function decideTrigger(reads) {
    if (reads.needs_prd_inputs === true)
        return { signals: null, token_if_no_kernel: "needs-judgement:prd-inputs" };
    return {
        signals: {
            target_resolved: reads.target_resolved === true,
            outward: reads.outward === true,
            prd_present: reads.prd_present === true,
            prd_ambiguous: reads.prd_ambiguous === true,
            prd_admissible: reads.prd_admissible === true,
            coverage_measurable: reads.coverage_measurable === true,
            coverage_covered: reads.coverage_covered === true,
        },
        token_if_no_kernel: null,
    };
}
function realDeps() {
    const spawn = (args, opts) => {
        const r = childProcess.spawnSync(process.execPath, [ENTRYPOINT, ...args], { cwd: opts.cwd, encoding: "utf8", input: opts.input ?? "", env: opts.env ?? process.env });
        return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    };
    return {
        faff: spawn,
        configGet: (root, key) => {
            const r = spawn(["config", "get", key], { cwd: root });
            if (r.status !== 0)
                return null;
            const v = r.stdout.trim();
            return v === "" ? null : v;
        },
        classify: (runDir) => runRecordPrd.classifyInheritedRunDir(runDir === undefined ? {} : { FAFF_RUN_DIR: runDir }),
        mintId: (root, run, kernel) => decisionCapture.mintConsultCorrelationId(root, run, RUN_ISSUE, kernel, undefined),
        marker: (root, run, kernel, id, action) => {
            decisionCapture.appendActionMarker({ root, run, issue: RUN_ISSUE, kernel, correlation_id: id, selected_action: action });
        },
        readFile: (file) => fs.readFileSync(file, "utf8"),
        fileSize: (file) => fs.statSync(file).size,
        exists: (file) => fs.existsSync(file) && fs.statSync(file).isFile(),
    };
}
class TriggerUsageError extends Error {
}
// Steps 2–3. One PRD → it; zero → no-PRD; several → keep Active/Frozen: one survivor → it, zero →
// no-PRD, several → ambiguous. A failed list is ambiguous (refuses), never a silent no-PRD drain.
function readPrd(call, exists, root, diagnostics) {
    const none = { present: false, ambiguous: false, container: null, path: null };
    const listRun = call(["prd", "list", "--json", "--root", root]);
    const list = listRun.status === 0 ? parseJson(listRun.stdout) : undefined;
    if (!Array.isArray(list)) {
        diagnostics.push("prd-list-failed");
        return { ...none, ambiguous: true };
    }
    let candidates = list;
    if (candidates.length > 1) {
        candidates = candidates.filter((p) => {
            const status = str(field(p, "status")) ?? "";
            return /^(Active|Frozen)\b/.test(status);
        });
        if (candidates.length > 1)
            return { ...none, ambiguous: true };
    }
    if (candidates.length === 0)
        return none;
    const container = str(field(candidates[0], "container"));
    if (container === undefined || container === "") {
        diagnostics.push("prd-container-missing");
        return none;
    }
    const pathRun = call(["prd", "path", container, "--root", root]);
    const prdPath = pathRun.status === 0 ? pathRun.stdout.trim() : "";
    if (prdPath === "" || !exists(prdPath)) {
        diagnostics.push("prd-file-missing");
        return none;
    }
    return { present: true, ambiguous: false, container, path: prdPath };
}
// Step 7. Exactly one fenced block, piped to `faff contract prd-readiness`; the licence is the contract
// verb's validated output, never the raw block.
function readReadiness(args, deps, call, diagnostics) {
    const refused = { admissible: false, licence: null };
    if (args.slotUnreachable) {
        diagnostics.push("prd-slot-unreachable");
        return refused;
    }
    if (args.readinessFile === null)
        return refused;
    let text;
    try {
        if (deps.fileSize(args.readinessFile) > READINESS_MAX_BYTES) {
            diagnostics.push("prd-readiness-block-malformed");
            return refused;
        }
        text = deps.readFile(args.readinessFile);
    }
    catch {
        diagnostics.push("prd-readiness-block-missing");
        return refused;
    }
    const blocks = [...text.matchAll(READINESS_FENCE)].map((m) => m[1]);
    if (blocks.length === 0) {
        diagnostics.push("prd-readiness-block-missing");
        return refused;
    }
    if (blocks.length > 1) {
        diagnostics.push("prd-readiness-block-malformed");
        return refused;
    }
    const block = parseJsonObject(blocks[0] ?? "");
    if (block === undefined) {
        diagnostics.push("prd-readiness-block-malformed");
        return refused;
    }
    const r = call(["contract", "prd-readiness"], JSON.stringify(block));
    const out = r.status === 0 ? parseJsonObject(r.stdout) : undefined;
    if (out === undefined || field(out, "verdict") !== "admissible") {
        if (r.status !== 0 || out === undefined)
            diagnostics.push("prd-readiness-contract-failed");
        return refused;
    }
    const licence = str(field(out, "creative_licence"));
    return { admissible: true, licence: licence === "broad" || licence === "tight" ? licence : null };
}
// Step 8. Missing, unparseable, non-string or EMPTY goals make coverage unmeasurable: an empty set is
// vacuously covered by `prdr coverage`, and a PRD whose goals nobody read must never drain as covered.
function readCoverage(goals, container, root, call, diagnostics) {
    const unmeasurable = { measurable: false, covered: false, block: null };
    if (goals === undefined) {
        diagnostics.push("prd-goals-missing");
        return unmeasurable;
    }
    if (!isStringArray(goals)) {
        diagnostics.push("prd-goals-missing");
        return unmeasurable;
    }
    if (goals.length === 0) {
        diagnostics.push("prd-goals-empty");
        return unmeasurable;
    }
    const r = call(["prdr", "coverage", "--container", container, "--prd-goals", JSON.stringify(goals), "--root", root]);
    const block = r.status === 0 ? parseJsonObject(r.stdout) : undefined;
    if (block === undefined || typeof field(block, "covered") !== "boolean") {
        diagnostics.push("coverage-failed");
        return unmeasurable;
    }
    return { measurable: true, covered: field(block, "covered") === true, block };
}
// --- The procedure (§4.1). ---
function emptyResult(token, classify, runDir) {
    return {
        token,
        classify,
        run_dir: runDir,
        prd: { present: false, ambiguous: false, container: null, path: null, slot: null },
        target: { container: null, repo: null },
        self: { container: null, repo: null, is_self: false },
        outward: null,
        creative_licence: null,
        coverage: null,
        signals: null,
        verdict: null,
        run_start_correlation_id: null,
        recorded: null,
        diagnostics: [],
    };
}
function runTrigger(args, deps) {
    // A. Classify, every call. Nothing else is read on `not-l4` or `fault`.
    const c = deps.classify(args.runDir);
    const classify = { verdict: c.verdict, reason: c.reason ?? null };
    if (c.verdict === "not-l4")
        return emptyResult("skip", classify, null);
    if (c.verdict !== "inherited-l4" || c.runDir === undefined)
        return emptyResult("fault", { verdict: "fault", reason: classify.reason }, null);
    const runDir = c.runDir;
    const root = args.root;
    const runId = path.basename(path.resolve(runDir));
    const result = emptyResult("refuse", classify, runDir);
    const diagnostics = result.diagnostics;
    // Usage checks that need the L4 path: an unreadable goals file is a usage error, no result.
    let goals = undefined;
    if (args.goalsFile !== null) {
        let text;
        try {
            text = deps.readFile(args.goalsFile);
        }
        catch (e) {
            throw new TriggerUsageError(`cannot read --prd-goals ${args.goalsFile}: ${errText(e)}`);
        }
        goals = parseJson(text);
        if (goals === undefined)
            goals = null;
    }
    // Children run against this run dir with the capture env of the consult they serve, and only that: a
    // correlation id or issue exported in the caller's shell never reaches a child, so a base can only be
    // written under an id this command minted.
    const childEnv = (extra) => {
        const env = { ...process.env, FAFF_RUN_DIR: runDir };
        delete env.FAFF_DECISION_CORRELATION_ID;
        delete env.FAFF_DECISION_ISSUE;
        return { ...env, ...extra };
    };
    const call = (argv, input, env) => {
        const opts = input === undefined ? { cwd: root, env: env ?? childEnv({}) } : { cwd: root, input, env: env ?? childEnv({}) };
        try {
            return deps.faff(argv, opts);
        }
        catch (e) {
            return { status: null, stdout: "", stderr: errText(e) };
        }
    };
    const safeMint = (kernel) => {
        try {
            return deps.mintId(root, runId, kernel);
        }
        catch {
            return null;
        }
    };
    const safeMarker = (kernel, id, action) => {
        if (id === null)
            return;
        try {
            deps.marker(root, runId, kernel, id, action);
        }
        catch { /* capture is best-effort */ }
    };
    // B2–B4. PRD, target, self.
    const prd = readPrd((argv) => call(argv), deps.exists, root, diagnostics);
    const configContainer = deps.configGet(root, "tracking.container");
    const repo = deps.configGet(root, "tracking.repo");
    const container = prd.container ?? configContainer;
    result.prd = { present: prd.present, ambiguous: prd.ambiguous, container: prd.container, path: prd.path, slot: null };
    result.target = { container, repo };
    result.self = { container: configContainer, repo, is_self: repo !== null && result.target.repo === repo };
    const targetResolved = container !== null || repo !== null;
    const readinessGiven = args.readinessFile !== null || args.slotUnreachable;
    // B5. The judgement seam: no kernel is consulted, so no capture base is written that no marker closes.
    if (!args.afterPlan && prd.present && !prd.ambiguous && !readinessGiven) {
        result.prd.slot = deps.configGet(root, "slots.prd");
        result.token = "needs-judgement:prd-inputs";
        return result;
    }
    // B7 (and C13). Readiness.
    const readiness = prd.present && !prd.ambiguous ? readReadiness(args, deps, call, diagnostics) : { admissible: false, licence: null };
    result.creative_licence = readiness.licence;
    // B8 (and C13). Coverage, only for a present and admissible PRD.
    let coverage = { measurable: false, covered: false, block: null };
    if (prd.present && readiness.admissible && prd.container !== null) {
        coverage = readCoverage(goals, prd.container, root, (argv) => call(argv), diagnostics);
    }
    result.coverage = coverage.block;
    if (args.afterPlan) {
        // C14. Record licence and container; a non-zero record is fail-loud.
        if (readiness.licence !== null || container !== null) {
            const argv = ["run-record-prd", "--run-dir", runDir];
            if (readiness.licence !== null)
                argv.push("--prd-creative-licence", readiness.licence);
            if (container !== null)
                argv.push("--prd-root-container", container);
            const r = call(argv);
            if (r.status !== 0) {
                diagnostics.push(`run-record-prd-exit-${r.status === null ? "spawn" : String(r.status)}`);
                result.token = "record-failed";
                return result;
            }
            result.recorded = { licence: readiness.licence, root_container: container };
        }
        // C15. The plan marker on the deciding call's id.
        safeMarker("run-start", args.correlationId, "plan");
        result.run_start_correlation_id = args.correlationId;
        result.token = "recorded";
        return result;
    }
    // B6. Outward, under the run-outward correlation env.
    const outwardId = safeMint("run-outward");
    const target = { container, repo };
    const self = { container: configContainer, repo, is_self: result.self.is_self };
    const outRun = call(["run-outward", "--target", JSON.stringify(target), "--self", JSON.stringify(self), "--json"], undefined, childEnv(outwardId === null ? {} : { FAFF_DECISION_CORRELATION_ID: outwardId, FAFF_DECISION_ISSUE: RUN_ISSUE }));
    const outward = outRun.status === 0 ? parseJsonObject(outRun.stdout) : undefined;
    let outwardSignal = false;
    if (outward === undefined || typeof field(outward, "outward") !== "boolean")
        diagnostics.push("run-outward-failed");
    else {
        result.outward = outward;
        outwardSignal = field(outward, "outward") === true;
    }
    // B9. The kernel decides.
    const decision = decideTrigger({
        prd_present: prd.present,
        prd_ambiguous: prd.ambiguous,
        target_resolved: targetResolved,
        outward: outwardSignal,
        prd_admissible: readiness.admissible,
        coverage_measurable: coverage.measurable,
        coverage_covered: coverage.covered,
        needs_prd_inputs: false,
    });
    result.signals = decision.signals;
    const startId = safeMint("run-start");
    const startRun = call(["run-start", "--signals", JSON.stringify(decision.signals ?? {})], undefined, childEnv(startId === null ? {} : { FAFF_DECISION_CORRELATION_ID: startId, FAFF_DECISION_ISSUE: RUN_ISSUE }));
    const startOut = startRun.status === 0 ? parseJsonObject(startRun.stdout) : undefined;
    const verdict = str(field(startOut, "verdict"));
    if (startOut === undefined || (verdict !== "plan" && verdict !== "drain" && verdict !== "refuse")) {
        diagnostics.push("run-start-failed");
        result.verdict = { verdict: "refuse", reason: null };
    }
    else {
        result.verdict = { verdict, reason: str(field(startOut, "reason")) ?? null };
    }
    result.run_start_correlation_id = startId;
    // B10. Markers, best-effort: they never change the token.
    const outwardAction = outward === undefined ? "run-outward-failed" : outwardSignal ? "outward-adopter" : (str(field(outward, "reason")) ?? "run-outward-failed");
    safeMarker("run-outward", outwardId, outwardAction);
    const v = result.verdict.verdict;
    if (v === "refuse" || v === "drain")
        safeMarker("run-start", startId, v);
    // B11. Record the licence on drain.
    if (v === "drain" && readiness.licence !== null) {
        const r = call(["run-record-prd", "--run-dir", runDir, "--prd-creative-licence", readiness.licence]);
        if (r.status !== 0) {
            diagnostics.push(`run-record-prd-exit-${r.status === null ? "spawn" : String(r.status)}`);
            result.token = "record-failed";
            return result;
        }
        result.recorded = { licence: readiness.licence, root_container: null };
    }
    // B12.
    result.token = v === "plan" ? "plan" : v === "drain" ? "drain" : "refuse";
    return result;
}
// --- The verb. ---
const TRIGGER_SPEC = {
    flags: {
        "--run-dir": { arity: 1 },
        "--root": { arity: 1 },
        "--prd-readiness": { arity: 1 },
        "--prd-slot-unreachable": { arity: 0 },
        "--prd-goals": { arity: 1 },
        "--after-plan": { arity: 0 },
        "--correlation-id": { arity: 1 },
        "--json": { arity: 0 },
    },
};
const TRIGGER_USAGE = "usage: faff run trigger [--run-dir DIR] [--root DIR] [--prd-readiness FILE | --prd-slot-unreachable] [--prd-goals FILE] [--after-plan --correlation-id ID] [--json]";
function exitFor(token) {
    return STOP_TOKENS.includes(token) ? 3 : 0;
}
function usage(detail) {
    return argvApi.usageError([{ code: "invalid-combination", detail }], TRIGGER_USAGE);
}
function cmdRunTrigger(argv, deps = realDeps()) {
    const { values, errors } = argvApi.parseArgs(argv, TRIGGER_SPEC);
    if (errors.length)
        return argvApi.usageError(errors, TRIGGER_USAGE);
    const readinessFile = str(values["--prd-readiness"]) ?? null;
    const slotUnreachable = values["--prd-slot-unreachable"] === true;
    const afterPlan = values["--after-plan"] === true;
    const correlationId = str(values["--correlation-id"]) ?? null;
    if (readinessFile !== null && slotUnreachable)
        return usage("--prd-readiness and --prd-slot-unreachable are mutually exclusive");
    if (afterPlan && (correlationId === null || correlationId === ""))
        return usage("--after-plan requires --correlation-id ID");
    if (!afterPlan && correlationId !== null)
        return usage("--correlation-id is only valid with --after-plan");
    if (afterPlan && readinessFile === null && !slotUnreachable)
        return usage("--after-plan requires --prd-readiness FILE or --prd-slot-unreachable");
    const runDirFlag = str(values["--run-dir"]);
    const envRunDir = process.env.FAFF_RUN_DIR;
    const runDir = runDirFlag !== undefined && runDirFlag !== "" ? runDirFlag : envRunDir !== undefined && envRunDir !== "" ? envRunDir : undefined;
    let root;
    try {
        root = str(values["--root"]) ?? sharedInfra.findRoot();
    }
    catch (e) {
        process.stderr.write(`faff run trigger: ${errText(e)}\n`);
        return 2;
    }
    let result;
    try {
        result = runTrigger({ runDir, root, readinessFile, slotUnreachable, goalsFile: str(values["--prd-goals"]) ?? null, afterPlan, correlationId }, deps);
    }
    catch (e) {
        if (e instanceof TriggerUsageError) {
            process.stderr.write(`faff run trigger: ${e.message}\n${TRIGGER_USAGE}\n`);
            return 2;
        }
        throw e;
    }
    if (result.token === "fault" && result.classify.reason !== null)
        process.stderr.write(`faff run trigger: fault: ${result.classify.reason}\n`);
    if (values["--json"] === true)
        process.stdout.write(`${JSON.stringify(result)}\n`);
    else {
        const reason = result.verdict !== null && result.verdict.reason !== null ? result.verdict.reason : result.classify.reason;
        const lines = [`trigger: ${result.token}`];
        if (reason !== null)
            lines.push(`reason: ${reason}`);
        for (const d of result.diagnostics)
            lines.push(`diagnostic: ${d}`);
        process.stdout.write(`${lines.join("\n")}\n`);
    }
    return exitFor(result.token);
}
module.exports = { cmdRunTrigger, decideTrigger, runTrigger, realDeps, TOKENS, TRIGGER_USAGE };
