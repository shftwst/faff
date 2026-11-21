"use strict";
// === region:factory — build-review-round — record the review return and choose its next action ===
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdBuildReviewRound = cmdBuildReviewRound;
const fs = require("node:fs");
const path = require("node:path");
const node_util_1 = require("node:util");
const { parseArgs, usageError } = require("./argv");
const { guardWriterPaths, recordReviewRound } = require("./evidence");
const { computeChurn } = require("./build-review-churn");
const { computeConvergence } = require("./build-review-convergence");
const { collectAdjudicationSet } = require("./build-judge-evidence");
const { nextRoundNumber, readWindowStart } = require("./spec-review-window");
const { contractReviewVerdict } = require("./contract-defs-review");
const { resolveKnownSecretValues, redactKnownSecrets } = require("./redact");
const { scrubSpecField, hasDiffMarkers } = require("./adversarial-judge-scrub");
const { DEFAULTS, loadConfig } = require("./config-core");
const { resolveAppetite } = require("./config-resolve");
const { resolveReviewIterationCap } = require("./review-iteration-cap");
const { findRoot, dig, writeOwnerOnlyJson } = require("./shared-infra");
const { takeLock, releaseLock } = require("./resume-store");
class Refused extends Error {
}
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const nonblank = (value) => typeof value === "string" && value.trim().length > 0;
const isCount = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const diffHash = /^[a-f0-9]{64}$/;
const commitHash = /^[a-f0-9]{40}$/;
const signals = new Set(["pass", "fail", "needs-human", "unavailable"]);
const isSignal = (value) => signals.has(value);
const actions = new Set(["reply", "pass", "fix", "judge", "park"]);
const severities = new Set(["critical", "major", "minor", "observation"]);
const fieldsOnly = (obj, keys) => Object.keys(obj).every((key) => keys.includes(key));
const evidenceFields = new Set(["title", "location", "action", "location_present", "action_present",
    "severity", "source", "model", "disposition", "refutation", "disposition_rationale", "carried_id"]);
function readInput() {
    const text = fs.readFileSync(0, "utf8");
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Refused("stdin must contain valid JSON");
    }
}
function isFinding(value) {
    return isObject(value) && severities.has(value.severity) && typeof value.location === "string"
        && typeof value.title === "string" && (value.carried_id == null || nonblank(value.carried_id));
}
function isReply(value) {
    if (!isObject(value) || !nonblank(value.finding_ref))
        return false;
    if (value.kind === "fix")
        return fieldsOnly(value, ["kind", "finding_ref", "fix_commit"]) && nonblank(value.fix_commit);
    return value.kind === "rebuttal" && fieldsOnly(value, ["kind", "finding_ref", "rebuttal_text"])
        && nonblank(value.rebuttal_text);
}
function isReceipt(value) {
    if (!isObject(value))
        return false;
    const { decision, counts } = value;
    return typeof value.diff_hash === "string" && diffHash.test(value.diff_hash)
        && isCount(value.evidence_round) && value.evidence_round > 0 && isObject(value.verdict)
        && isObject(counts) && isCount(counts.fix_rounds_used) && isCount(counts.rebuttal_rounds_used)
        && isObject(decision) && actions.has(decision.action) && nonblank(decision.reason)
        && Array.isArray(decision.curr_critical_ids) && decision.curr_critical_ids.every(nonblank)
        && Array.isArray(decision.carried_critical_ids) && decision.carried_critical_ids.every(nonblank)
        && isCount(decision.refused_carries);
}
function readRounds(dir) {
    const entries = fs.readdirSync(dir).flatMap((name) => {
        const match = /^round-([1-9]\d*)\.json$/.exec(name);
        return match ? [{ round: Number(match[1]), name }] : [];
    }).sort((a, b) => a.round - b.round);
    return entries.map(({ name, round }, i) => {
        const file = path.join(dir, name);
        if (round !== i + 1 || !fs.lstatSync(file).isFile())
            throw new Error("invalid build-review round sequence at " + name);
        let doc;
        try {
            doc = JSON.parse(fs.readFileSync(file, "utf8"));
        }
        catch {
            throw new Error("unreadable build-review/" + name);
        }
        if (!isObject(doc))
            throw new Error("malformed build-review/" + name);
        const replies = doc.author_replies ?? [];
        if (!isSignal(doc.signal) || !Array.isArray(doc.findings) || !doc.findings.every(isFinding)
            || !Array.isArray(replies) || !replies.every(isReply)
            || (doc.receipt !== undefined && !isReceipt(doc.receipt)))
            throw new Error("malformed build-review/" + name);
        return { round, record: {
                signal: doc.signal, findings: doc.findings, author_replies: replies,
                ...(doc.receipt === undefined ? {} : { receipt: doc.receipt }),
            } };
    });
}
function prepareReturn(input, secrets) {
    if (!isObject(input) || input.author_replies !== undefined || input.receipt !== undefined) {
        throw new Refused("expected a reviewer verdict block without author replies or a receipt");
    }
    const signal = input.signal;
    const verdict = redactKnownSecrets(input, secrets);
    const parsed = contractReviewVerdict(verdict).contractData;
    if (!parsed?.conformant || parsed.signal !== signal)
        throw new Refused("invalid review-verdict contract");
    if (parsed.signal === "unavailable")
        return { signal: parsed.signal, findings: [], verdict };
    if (!Array.isArray(verdict.findings) || !verdict.findings.every(isObject)) {
        throw new Refused("findings must be an array of objects");
    }
    const escalated = verdict.escalated_criticals ?? [];
    if (!Array.isArray(escalated) || !escalated.every((f) => isFinding(f)
        && f.severity === "critical" && nonblank(f.location) && nonblank(f.title)
        && fieldsOnly(f, ["severity", "location", "title", "carried_id"]))) {
        throw new Refused("invalid escalated criticals");
    }
    if (escalated.length && (parsed.signal !== "needs-human" || verdict.adversarial_outcome != null)) {
        throw new Refused("escalation requires a needs-human review with available adversarial findings");
    }
    const findings = verdict.findings;
    if (escalated.some((f) => !findings.some((g) => g.severity === "critical" && g.title === f.title && g.location === f.location))) {
        throw new Refused("escalated critical has no matching verdict finding");
    }
    return {
        signal: parsed.signal,
        findings: escalated,
        verdict: {
            signal: parsed.signal,
            adversarial_outcome: verdict.adversarial_outcome ?? null,
            findings: findings.map((f) => Object.fromEntries(Object.entries(f).filter(([key]) => evidenceFields.has(key)))),
            escalated_criticals: escalated,
        },
    };
}
function tally(counts, replies) {
    return {
        fix_rounds_used: counts.fix_rounds_used + Number(replies.some((reply) => reply.kind === "fix")),
        rebuttal_rounds_used: counts.rebuttal_rounds_used + Number(replies.some((reply) => reply.kind === "rebuttal")),
    };
}
function configuredCount(config, key) {
    const value = dig(config, key) ?? DEFAULTS[key];
    const number = /^\d+$/.test(String(value)) ? Number(value) : NaN;
    if (!isCount(number))
        throw new Error("invalid configured " + key);
    return number;
}
function decide(earlier, current, counts, dir, config, verdict) {
    const previous = earlier.at(-1);
    const { churn, curr_critical_ids, carried_critical_ids, refused_carries } = computeChurn(previous?.record ?? null, current.record, previous?.round ?? null, current.round, earlier.slice(0, -1));
    const decideAs = (action, reason) => ({ action, reason, curr_critical_ids, carried_critical_ids, refused_carries });
    if (churn)
        return decideAs("judge", "new-critical");
    const history = [...earlier, current];
    const rounds = history.map((entry) => entry.record);
    const numbers = history.map((entry) => entry.round);
    if (curr_critical_ids.length === 0) {
        if (current.record.signal === "fail")
            return decideAs("fix", "ordinary-fail");
        if (current.record.signal !== "pass")
            return decideAs("park", "needs-human");
        if (previous && verdict.adversarial_outcome === "chain-outage-skipped") {
            return decideAs("park", "independent-review-missing");
        }
        return collectAdjudicationSet(rounds).some((finding) => finding.requires_confirm)
            ? decideAs("judge", "rebuttal-withdrawal")
            : decideAs("pass", "reviewer-pass");
    }
    const { cap, error } = resolveReviewIterationCap(resolveAppetite(config));
    if (cap === undefined)
        throw new Error(error ?? "invalid review iteration cap");
    const exhausted = counts.fix_rounds_used >= cap;
    if (exhausted && !computeConvergence(rounds, readWindowStart(dir), numbers).converging) {
        return decideAs("judge", "fix-cap");
    }
    if (counts.rebuttal_rounds_used >= configuredCount(config, "graft.review_rebuttal_round_cap")) {
        return decideAs("judge", "rebuttal-cap");
    }
    return decideAs("reply", exhausted ? "converging" : "standing-criticals");
}
function persistEvidence(options, dir, entry, secrets) {
    const receipt = entry.record.receipt;
    if (receipt === undefined)
        return; // Dialogue rounds from before this command.
    // The first dialogue return may follow ordinary review and its evidence-directory handles.
    const prior = entry.round === 1 ? undefined : dir;
    const result = recordReviewRound(options.runDir, options.issue, JSON.stringify(receipt.verdict), secrets, prior, { round: receipt.evidence_round, priorRound: entry.round - 1 });
    if (result.refused)
        throw new Error("could not record pinned terminal evidence");
    for (const warning of result.warnings ?? [])
        process.stderr.write("faff build-review-round: " + warning + "\n");
}
function roundPath(dir, n) {
    return path.join(dir, "round-" + n + ".json");
}
function resultFor(entry, dir) {
    const { record, round } = entry;
    const receipt = record.receipt;
    if (receipt === undefined)
        throw new Refused("use the next round after a legacy record");
    return {
        round,
        next_round: round + 1,
        path: roundPath(dir, round),
        ...receipt.decision,
        reply_recorded: record.author_replies.length > 0,
        ...tally(receipt.counts, record.author_replies),
    };
}
function recordReturn(options, input, dir, history, secrets, config) {
    const latest = history.at(-1);
    const { round, hash } = options;
    const { signal, findings, verdict } = prepareReturn(input, secrets);
    if (latest && latest.round === round) {
        const receipt = latest.record.receipt;
        if (!receipt || receipt.diff_hash !== hash || !(0, node_util_1.isDeepStrictEqual)(receipt.verdict, verdict)) {
            throw new Refused("round already belongs to a different review return");
        }
        persistEvidence(options, dir, latest, secrets);
        return resultFor(latest, dir);
    }
    if (round !== (latest?.round ?? 0) + 1)
        throw new Refused("expected the next dialogue round");
    const predecessor = latest?.record;
    const counts = predecessor?.receipt
        ? tally(predecessor.receipt.counts, predecessor.author_replies)
        : options.legacyCounts ?? { fix_rounds_used: 0, rebuttal_rounds_used: 0 };
    if (options.legacyCounts && (!predecessor || (predecessor.receipt && !(0, node_util_1.isDeepStrictEqual)(options.legacyCounts, counts)))) {
        throw new Refused("legacy counters may only seed a preserved dialogue");
    }
    if (latest && predecessor?.receipt) {
        const { action } = predecessor.receipt.decision;
        if (action !== "fix" && (action !== "reply" || predecessor.author_replies.length === 0)) {
            throw new Refused("previous round has no pending independent review");
        }
        if (action === "reply") {
            const fixed = predecessor.author_replies.some((reply) => reply.kind === "fix");
            const changed = hash !== predecessor.receipt.diff_hash;
            if (fixed && !changed)
                throw new Refused("fix review requires a changed diff");
            if (!fixed && changed)
                throw new Refused("rebuttal-only review requires the same diff");
        }
        persistEvidence(options, dir, latest, secrets);
    }
    if (signal === "unavailable")
        return { action: "unavailable", next_round: round, ...counts };
    const record = { signal, findings, author_replies: [] };
    const current = { round, record };
    record.receipt = {
        diff_hash: hash ?? "",
        evidence_round: nextRoundNumber(path.join(dir, "..", "review-rounds")),
        verdict, counts, decision: decide(history, current, counts, dir, config, verdict),
    };
    writeOwnerOnlyJson(roundPath(dir, round), record);
    persistEvidence(options, dir, current, secrets);
    return resultFor(current, dir);
}
function recordReply(options, input, dir, latest, secrets, config) {
    const receipt = latest?.record.receipt;
    if (!latest || latest.round !== options.round || receipt?.decision.action !== "reply") {
        throw new Refused("reply requires the latest round awaiting an author reply");
    }
    const limit = configuredCount(config, "graft.rebuttal_max_chars");
    const standing = new Set(receipt.decision.curr_critical_ids);
    if (!Array.isArray(input) || !input.every(isReply) || input.length !== standing.size) {
        throw new Refused("submit one fix or rebuttal per standing critical");
    }
    const replies = input.map((reply) => {
        if (!standing.delete(reply.finding_ref))
            throw new Refused("reply does not target a unique standing critical");
        if (reply.kind === "fix") {
            if (!commitHash.test(reply.fix_commit))
                throw new Refused("fix_commit must be a full commit SHA");
            return reply;
        }
        if (reply.rebuttal_text.length > limit || hasDiffMarkers(reply.rebuttal_text)) {
            throw new Refused("rebuttal exceeds its bound or contains diff markers");
        }
        const scrubbed = scrubSpecField(redactKnownSecrets(reply.rebuttal_text, secrets));
        if (!nonblank(scrubbed) || scrubbed.length > limit || scrubSpecField(scrubbed) !== scrubbed) {
            throw new Refused("rebuttal could not be scrubbed to usable text");
        }
        return { ...reply, rebuttal_text: scrubbed };
    });
    persistEvidence(options, dir, latest, secrets);
    if (latest.record.author_replies.length > 0) {
        if (!(0, node_util_1.isDeepStrictEqual)(latest.record.author_replies, replies))
            throw new Refused("round already has different author replies");
    }
    else {
        latest.record.author_replies = replies;
        writeOwnerOnlyJson(roundPath(dir, latest.round), latest.record);
    }
    const { path: file, next_round, fix_rounds_used, rebuttal_rounds_used } = resultFor(latest, dir);
    return { action: "review", path: file, next_round, fix_rounds_used, rebuttal_rounds_used };
}
function guardedDirectory(dir) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    if (!fs.lstatSync(dir).isDirectory())
        throw new Error(path.basename(dir) + " must be a real directory");
}
const spec = { flags: {
        "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--round": { arity: 1 }, "--diff-hash": { arity: 1 },
        "--fix-rounds-used": { arity: 1 }, "--rebuttal-rounds-used": { arity: 1 },
    } };
const usage = "usage: faff build-review-round record|reply|resume --run-dir DIR --issue ID --round N"
    + "\n       record requires --diff-hash SHA256 and accepts legacy --fix-rounds-used N --rebuttal-rounds-used N"
    + "\n       resume takes the saved next round and accepts legacy --fix-rounds-used N --rebuttal-rounds-used N";
function cmdBuildReviewRound(argv) {
    const [verb, ...args] = argv;
    const { values, errors } = parseArgs(args, spec);
    const runDir = values["--run-dir"];
    const issue = values["--issue"];
    const n = values["--round"];
    const hash = values["--diff-hash"];
    const fix = values["--fix-rounds-used"];
    const rebuttal = values["--rebuttal-rounds-used"];
    const round = Number(n);
    const legacy = fix !== undefined || rebuttal !== undefined;
    const counts = { fix_rounds_used: Number(fix), rebuttal_rounds_used: Number(rebuttal) };
    if (errors.length)
        return usageError(errors, usage);
    if (!runDir || !issue || !n || !/^[1-9]\d*$/.test(n) || !isCount(round)
        || (verb !== "record" && verb !== "reply" && verb !== "resume")
        || (verb === "record" ? !hash || !diffHash.test(hash) : hash !== undefined)
        || (verb === "reply" && legacy)
        || (legacy && (!/^\d+$/.test(fix ?? "") || !/^\d+$/.test(rebuttal ?? "")
            || !isCount(counts.fix_rounds_used) || !isCount(counts.rebuttal_rounds_used)))) {
        return usageError([{ code: "invalid-value", detail: "invalid dialogue command or options" }], usage);
    }
    const options = { runDir, issue, round, ...(hash === undefined ? {} : { hash }),
        ...(legacy ? { legacyCounts: counts } : {}) };
    try {
        const input = verb === "resume" ? undefined : readInput();
        const issueDir = guardWriterPaths(runDir, issue);
        const root = findRoot();
        const secrets = resolveKnownSecretValues(root);
        const [config] = loadConfig(root);
        const dir = path.join(issueDir, "build-review");
        guardedDirectory(dir);
        const evidenceDir = path.join(issueDir, "review-rounds");
        // The evidence writer retains its own exclusive publication. Refuse redirected histories.
        if (fs.existsSync(evidenceDir))
            guardedDirectory(evidenceDir);
        const lock = takeLock(dir, "record");
        if (!lock)
            throw new Error("another build-review writer holds the round");
        try {
            const history = readRounds(dir);
            const latest = history.at(-1);
            let result;
            if (verb === "record")
                result = recordReturn(options, input, dir, history, secrets, config);
            else if (verb === "reply")
                result = recordReply(options, input, dir, latest, secrets, config);
            else {
                if (!latest || latest.round + 1 !== round)
                    throw new Refused("saved next round does not match the dialogue");
                if (latest.record.receipt) {
                    persistEvidence(options, dir, latest, secrets);
                    result = resultFor(latest, dir);
                }
                else {
                    result = { action: "review", next_round: round, legacy: true, ...options.legacyCounts };
                }
            }
            console.log(JSON.stringify(result));
            return 0;
        }
        finally {
            releaseLock(lock);
        }
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : "review round failed";
        process.stderr.write("faff build-review-round: " + reason + "\n");
        return error instanceof Refused ? 1 : 2;
    }
}
