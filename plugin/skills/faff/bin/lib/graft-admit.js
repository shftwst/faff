"use strict";
// ===========================================================================
// === region:factory — graft-admit — FAFF-1414: graft's Step 2 admission chain as one read-only command ===
//
// `faff graft admit` runs the mechanical half of graft's build-admission decision in one call and
// returns one disposition. The agent reads the issue once and passes a facts object; this command
// reads no tracker. It calls the existing kernels in-process (nextStep, automationEligible,
// intakeVerdict, admissibleVerdict, claimVerdict) and the build-claim store's read, re-implementing
// none of them. Read-only: its only writes are best-effort decision-capture records, which gate
// nothing. Any input it cannot establish exits 2, and callers refuse before a worktree exists.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const nextApi = require("./next");
const eligibleApi = require("./eligible");
const intakeApi = require("./intake-provenance");
const admissibilityApi = require("./admissibility");
const claimVerdictApi = require("./claim-verdict");
const bundleApi = require("./bundle");
const labelsApi = require("./labels");
const configApi = require("./config");
const decisionCapture = require("./decision-capture");
const argvApi = require("./argv");
const sharedInfra = require("./shared-infra");
// Same shape `faff spec commit` accepts; also keeps the issue id safe as a path and ref component.
const ISSUE_RE = /^[A-Za-z][A-Za-z0-9]*-[0-9]+$/;
const TRACKER_MODES = ["tracker", "git-only"];
const CLAIM_STATUSES = ["in-progress", "in-review"];
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v) {
    return Array.isArray(v) && v.every((x) => typeof x === "string");
}
// Validate the agent-built facts object. Every field is required; nothing is defaulted, so a
// half-built object is a loud exit 2 rather than a guessed admission.
function validateFacts(raw) {
    if (!isRecord(raw))
        return { error: "facts must be a JSON object" };
    const { issue, status, labels, spec, externally_blocked, claimed_at, tracker } = raw;
    if (typeof issue !== "string" || !ISSUE_RE.test(issue))
        return { error: `facts.issue must match ${ISSUE_RE.source}` };
    if (typeof status !== "string" || !nextApi.NEXT_STATUSES.includes(status))
        return { error: `facts.status must be one of ${nextApi.NEXT_STATUSES.join("|")}` };
    if (!isStringArray(labels))
        return { error: "facts.labels must be an array of strings" };
    if (!isRecord(spec) || typeof spec.found !== "boolean" || typeof spec.confidence !== "string" || !nextApi.NEXT_SPECS.includes(spec.confidence)) {
        return { error: `facts.spec must be { found: boolean, confidence: ${nextApi.NEXT_SPECS.join("|")} }` };
    }
    if (typeof externally_blocked !== "boolean")
        return { error: "facts.externally_blocked must be a boolean" };
    if (claimed_at !== null && (typeof claimed_at !== "string" || Number.isNaN(Date.parse(claimed_at)))) {
        return { error: "facts.claimed_at must be an ISO-8601 timestamp or null" };
    }
    if (!isRecord(tracker) || typeof tracker.mode !== "string" || !TRACKER_MODES.includes(tracker.mode)
        || typeof tracker.configured !== "boolean" || typeof tracker.pinned !== "boolean" || typeof tracker.reachable !== "boolean") {
        return { error: `facts.tracker must be { mode: ${TRACKER_MODES.join("|")}, configured: boolean, pinned: boolean, reachable: boolean }` };
    }
    return {
        facts: {
            issue,
            status,
            labels,
            spec: { found: spec.found, confidence: spec.confidence },
            externally_blocked,
            claimed_at,
            tracker: { mode: tracker.mode, configured: tracker.configured, pinned: tracker.pinned, reachable: tracker.reachable },
        },
    };
}
// The holder's session id from a build-claim read, or null when the claim carries none.
function holderSession(claim) {
    if (!isRecord(claim))
        return null;
    const owner = claim.owner;
    if (!isRecord(owner))
        return null;
    const sid = owner.session_id;
    return typeof sid === "string" && sid !== "" ? sid : null;
}
class AdmitFailure extends Error {
    reason;
    constructor(reason, detail) {
        super(detail);
        this.reason = reason;
    }
}
// Writes the base records as kernels are consulted and the action markers once the disposition is
// known. Everything is a no-op without a run; decision-capture itself no-ops when capture is off.
class Capture {
    ids = new Map();
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    base(kernel, inputs, verdict) {
        const { run, root, wave, facts } = this.opts;
        if (run === null)
            return;
        const id = decisionCapture.mintConsultCorrelationId(root, run, facts.issue, kernel, wave);
        this.ids.set(kernel, id);
        decisionCapture.captureDecision({ kernel, normalised_inputs: inputs, verdict, issue: facts.issue, run, correlationId: id, root });
    }
    marker(kernel, action) {
        const { run, root, facts } = this.opts;
        const id = this.ids.get(kernel);
        if (run === null || id === undefined)
            return;
        decisionCapture.appendActionMarker({ root, run, issue: facts.issue, kernel, correlation_id: id, selected_action: action });
    }
}
// The marker table (spec section 3): the action actually taken at the admission boundary.
function writeMarkers(cap, out) {
    const d = out.disposition;
    const step = out.kernels.next ? out.kernels.next.step : null;
    if (d === null)
        return;
    switch (d) {
        case "proceed":
            cap.marker("next", "graft");
            cap.marker("eligible", "eligible");
            cap.marker("claim-verdict", "proceed");
            return;
        case "needs-prep":
            cap.marker("next", "prep");
            cap.marker("eligible", "eligible");
            return;
        case "needs-human":
            cap.marker("next", "needs-human");
            cap.marker("eligible", "eligible");
            return;
        case "excluded":
            if (step !== null)
                cap.marker("next", step);
            cap.marker("eligible", "eligible");
            return;
        case "ineligible":
            cap.marker("next", "skip-ineligible");
            cap.marker("eligible", "ineligible");
            return;
        case "claimed-by-peer":
            cap.marker("next", "none");
            cap.marker("claim-verdict", "claimed-by-peer");
            return;
        case "blocked":
        case "inadmissible":
            cap.marker("next", "none");
            return;
    }
}
function resolveLabelNames(root) {
    const p = configApi.resolveLabelPrefix(root);
    if (p.error !== undefined || p.prefix === undefined)
        throw new AdmitFailure("config-invalid", p.error ?? "tracking.label_prefix did not resolve");
    const n = configApi.resolveControlLabels(root);
    if (n.error !== undefined || n.names === undefined)
        throw new AdmitFailure("config-invalid", n.error ?? "tracking.control_labels did not resolve");
    return { prefix: p.prefix, names: n.names };
}
// The chain (spec section 4.1). Throws AdmitFailure for every exit-2 cause.
function admit(opts) {
    const { mode, facts, root, now, env } = opts;
    const interactive = mode === "interactive";
    const out = {
        issue: facts.issue,
        disposition: null,
        reason: "",
        kernels: { eligible: null, next: null, claim: null, intake: null, admissible: null },
        warnings: [],
    };
    const decide = (d, reason) => { out.disposition = d; out.reason = reason; return out; };
    // 1. A configured or pinned tracker that this session cannot reach is never read as "no spec".
    if ((facts.tracker.configured || facts.tracker.pinned) && !facts.tracker.reachable) {
        throw new AdmitFailure("tracker-unreachable", "the tracker is configured or pinned but not reachable this session");
    }
    const cap = new Capture(opts);
    // 2. Eligibility, with the control labels resolved the way cmdEligible resolves them.
    const { prefix, names } = resolveLabelNames(root);
    const automateName = names.automate;
    const roleName = (role) => {
        const hit = labelsApi.controlLabels(prefix, names).find((l) => l.role === role);
        return hit ? hit.name : `${prefix}-${role}`;
    };
    const labelSet = new Set(facts.labels);
    const parked = labelSet.has(roleName("parked"));
    const awaitingSpecReview = labelSet.has(roleName("awaiting-spec-review"));
    const trackerPresent = facts.tracker.mode === "tracker";
    const normLabels = eligibleApi.normalizeEligibilityLabels(facts.labels, prefix, automateName);
    const eligible = eligibleApi.automationEligible(normLabels, "opt-in", trackerPresent);
    out.kernels.eligible = { eligible };
    cap.base("eligible", { labels: normLabels, automationDefault: "opt-in", trackerPresent }, { eligible });
    // 3. next, always consulted. Terminal statuses win, as nextStep itself orders them.
    const nextInput = {
        status: facts.status,
        spec: facts.spec.found ? facts.spec.confidence : "none",
        eligible,
        parked,
        blocked: facts.externally_blocked,
        ifEligible: interactive,
        awaitingSpecReview,
    };
    const [step, rawReason] = nextApi.nextStep(nextInput);
    if (step === "error")
        throw new AdmitFailure("facts-invalid", rawReason);
    const nextReason = nextApi.renderNextReason(rawReason, prefix, automateName);
    out.kernels.next = { step, reason: nextReason };
    cap.base("next", nextInput, step);
    const finish = (d, reason) => { decide(d, reason); writeMarkers(cap, out); return out; };
    if (step === "done" || step === "none")
        return finish("excluded", step);
    if (!eligible) {
        if (!interactive)
            return finish("ineligible", nextReason);
        out.warnings.push(`not automation-eligible (no ${automateName ?? `${prefix}-automate`}); proceeding interactively, eligibility is unchanged`);
    }
    // 4. The claim check, for the two claim statuses only (a Todo candidate costs no git round trip).
    if (CLAIM_STATUSES.includes(facts.status)) {
        const read = bundleApi.buildClaimStore(root).readHolder({ issue: facts.issue });
        if (read.status === "store_unavailable")
            throw new AdmitFailure("claim-store-unavailable", "the build-claim store could not be reached");
        if (read.status !== "ok" && read.status !== "missing")
            throw new AdmitFailure("claim-store-unavailable", `the build-claim ref could not be read cleanly (${read.status})`);
        const held = read.status === "ok";
        const holder = held ? holderSession(read.claim) : null;
        const own = held && holder !== null && opts.sessionId !== "" && holder === opts.sessionId;
        const nowMs = Date.parse(now);
        const stale = held && !own ? !bundleApi.buildClaimStaleAware(root, read.claim, nowMs, env) : null;
        let ttl = null;
        if (facts.claimed_at !== null) {
            const ttlHours = bundleApi.resolveClaimTtlHours(root, env);
            ttl = claimVerdictApi.claimVerdict(facts.claimed_at, now, ttlHours);
            cap.base("claim-verdict", { claimedAtISO: facts.claimed_at, nowISO: now, ttlHours }, ttl);
        }
        out.kernels.claim = { status: facts.status, ref: held ? "held" : "missing", own, stale, ttl };
        if (!own) {
            if (interactive) {
                out.warnings.push(held
                    ? (holder === null
                        ? "the build-claim ref records no holder session, so it cannot be matched to this caller; Step 5's acquire decides"
                        : `the build claim is held by another claimant (${holder}); Step 5's acquire decides`)
                    : `status ${facts.status} was set by someone else and no build-claim ref exists; Step 5's acquire decides`);
            }
            else if (stale === true) {
                out.warnings.push(`stale build claim held by ${holder ?? "a session the ref does not record"}; Step 5's acquire reclaims it`);
            }
            else {
                return finish("claimed-by-peer", held
                    ? `${facts.status} with a live build-claim ref held by another session`
                    : `${facts.status} set by someone else, with no build-claim ref`);
            }
        }
    }
    // 5. next's spec routing.
    if (step === "prep")
        return finish("needs-prep", nextReason);
    if (step === "needs-human")
        return finish("needs-human", nextReason);
    if (step === "blocked")
        return finish("excluded", "blocked");
    if (step === "skip-ineligible")
        return finish("ineligible", nextReason);
    // 6. The intake guard, under the configured gate mode (never the admit --mode).
    const gate = intakeApi.resolveIntakeGate(root);
    const { marker, malformed } = intakeApi.readProvenanceMarker(root, facts.issue);
    const intake = intakeApi.intakeVerdict(marker, facts.labels, gate, prefix, automateName);
    const intakeExit = intakeApi.intakeExit(intake, gate, interactive);
    let intakeWarn = null;
    if (malformed)
        intakeWarn = "the intake provenance marker is malformed and was treated as absent";
    else if (!intake.satisfied)
        intakeWarn = interactive && gate === "block"
            ? "no intake provenance; the human at the keyboard is the sanction"
            : `no intake provenance (intake_gate: ${gate})`;
    out.kernels.intake = { verdict: intakeExit === 3 ? "block" : (intakeWarn === null ? "pass" : "warn"), basis: intake.basis, gate, warn: intakeWarn };
    if (intakeExit === 3)
        return finish("blocked", `intake guard refused: ${intake.basis}`);
    if (intakeWarn !== null)
        out.warnings.push(`intake: ${intakeWarn}`);
    // 7. Admissibility, on every automated run; interactive graft skips it (the human is the gate).
    if (!interactive) {
        if (opts.specText === null)
            throw new AdmitFailure("spec-file-unreadable", "autonomous mode needs --spec-file for a found spec");
        const adm = admissibilityApi.admissibleVerdict(opts.specText, true);
        out.kernels.admissible = { admissible: adm.admissible, reasons: adm.reasons, warnings: adm.warnings };
        if (!adm.admissible)
            return finish("inadmissible", adm.reasons.join("; "));
        out.warnings.push(...adm.warnings);
    }
    // 8.
    return finish("proceed", "build-eligible");
}
// --- The command layer. ---
const ADMIT_SPEC = {
    flags: {
        "--mode": { arity: 1, enum: ["interactive", "autonomous"] },
        "--facts": { arity: 1 },
        "--spec-file": { arity: 1 },
        "--session-id": { arity: 1 },
        "--run-dir": { arity: 1 },
        "--wave": { arity: 1 },
        "--now": { arity: 1 },
        "--root": { arity: 1 },
        "--json": { arity: 0 },
    },
};
const ADMIT_USAGE = "usage: faff graft admit --mode interactive|autonomous --facts <file|-> [--spec-file <path>] [--session-id <S>] [--run-dir <dir>] [--wave <N>] [--now <ISO>] [--root DIR] [--json]";
const str = (v) => (typeof v === "string" ? v : undefined);
function fail(json, issue, reason, detail) {
    process.stderr.write(`faff graft admit: ${reason} — ${detail}\n`);
    if (json)
        process.stdout.write(JSON.stringify({ issue, disposition: null, reason, error: detail }) + "\n");
    return 2;
}
function readText(file) {
    try {
        return fs.readFileSync(file === "-" ? 0 : file, "utf8");
    }
    catch {
        return null;
    }
}
function cmdGraftAdmit(args) {
    const { values, errors } = argvApi.parseArgs(args, ADMIT_SPEC);
    if (errors.length)
        return argvApi.usageError(errors, ADMIT_USAGE);
    const json = values["--json"] === true;
    const modeArg = str(values["--mode"]);
    if (modeArg !== "interactive" && modeArg !== "autonomous")
        return fail(json, null, "usage", "--mode interactive|autonomous is required");
    const mode = modeArg;
    const factsArg = str(values["--facts"]);
    if (factsArg === undefined)
        return fail(json, null, "facts-invalid", "--facts <file|-> is required");
    const factsText = readText(factsArg);
    if (factsText === null)
        return fail(json, null, "facts-invalid", `cannot read --facts ${factsArg}`);
    let raw;
    try {
        raw = JSON.parse(factsText);
    }
    catch {
        return fail(json, null, "facts-invalid", "the facts object is not valid JSON");
    }
    const v = validateFacts(raw);
    if ("error" in v)
        return fail(json, null, "facts-invalid", v.error);
    const facts = v.facts;
    const now = str(values["--now"]) ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(now)))
        return fail(json, facts.issue, "usage", "--now must be an ISO-8601 timestamp");
    let specText = null;
    if (mode === "autonomous" && facts.spec.found) {
        const specFile = str(values["--spec-file"]);
        specText = specFile === undefined ? null : readText(specFile);
        if (specText === null)
            return fail(json, facts.issue, "spec-file-unreadable", "autonomous mode with a found spec needs a readable --spec-file");
    }
    const runArg = str(values["--run-dir"]) ?? str(process.env.FAFF_RUN_DIR);
    const run = runArg !== undefined && runArg !== "" ? path.basename(runArg.replace(/[\\/]+$/, "")) : null;
    const root = str(values["--root"]) ?? sharedInfra.findRoot();
    const sessionId = str(values["--session-id"]) ?? str(process.env.FAFF_SESSION_ID) ?? "";
    let out;
    try {
        out = admit({ mode, facts, specText, sessionId, run, wave: str(values["--wave"]), now, root, env: process.env });
    }
    catch (e) {
        if (e instanceof AdmitFailure)
            return fail(json, facts.issue, e.reason, e.message);
        throw e;
    }
    if (json) {
        process.stdout.write(JSON.stringify(out) + "\n");
    }
    else {
        process.stdout.write(`${out.issue}: ${out.disposition} (${out.reason})\n`);
        for (const w of out.warnings)
            process.stdout.write(`[warn] ${w}\n`);
    }
    return 0;
}
const GRAFT_USAGE = ADMIT_USAGE;
function cmdGraft(args) {
    if (args[0] !== "admit")
        return argvApi.usageError([{ code: "bad-value", detail: "expected a verb: admit" }], GRAFT_USAGE);
    return cmdGraftAdmit(args.slice(1));
}
module.exports = { cmdGraft, admit, validateFacts, AdmitFailure };
