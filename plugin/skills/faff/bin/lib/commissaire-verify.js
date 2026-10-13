"use strict";
// ===========================================================================
// === region:governance — commissaire-verify — FAFF-1178: verify Commissaire grants against the key the seq-0 admission names ===
//
// One key-resolution and grant-verify core for every reader (verifyAuthLeg, `audit verify`, and the
// merge chokepoint once FAFF-1212 lands). A key is trusted only when its fingerprint equals the
// `pk_fingerprint` in the run's seq-0 admission and that admission verifies under it at its genesis
// position; `producer/pk.json` and `governor.json` only supply key bytes, they never decide trust.
// The admitted key is then classified against the trust input the caller read from the base branch.
//
// Reading rules for consumers:
//   - Only trust_source "remote-base" with classification "pinned" is evidence that a grant came from a
//     pinned governor. "local-ref" and "not-read" never are (ADR 0135 decisions 6 and 7).
//   - signer_fingerprint is authenticated (bound to the admission); a pk_fingerprint read from pk.json is unauthenticated.
//
// Pure apart from reading files under the run directory; neither export reads the trust file or
// throws on a malformed run directory. Requires only governance modules, so it stays inside the
// standalone Commissaire import-independence closure.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const producerAuth = require("./producer-auth");
const { verifyDecision, pkFingerprint } = producerAuth;
const events = require("./events");
const { matchesUnit } = require("./effects");
const { chokepointPermit } = require("./decision-policy");
const LEDGER_FILE = "declared-effects.jsonl";
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v) => (typeof v === "string" ? v : undefined);
function loadLedger(runDir, runId) {
    let buf;
    try {
        buf = fs.readFileSync(path.join(runDir, LEDGER_FILE));
    }
    catch {
        buf = Buffer.alloc(0);
    }
    const walk = events.walkPhysicalChain(buf);
    const lines = walk.records.map((r) => (isRecord(r) ? r : null));
    const schema3 = [];
    for (const rec of lines)
        if (rec !== null && rec.schema === 3)
            schema3.push(rec);
    return { runId: runId !== undefined && runId !== "" ? runId : path.basename(runDir), walk, lines, schema3 };
}
// The single physical line carrying this signed record, or null when none or several do.
function locate(view, record) {
    const sig = str(record.commissaire_sig);
    let found = null;
    for (let i = 0; i < view.lines.length; i++) {
        const rec = view.lines[i];
        if (rec == null || rec.seq !== record.seq || sig === undefined || rec.commissaire_sig !== sig)
            continue;
        if (found !== null)
            return null;
        found = i;
    }
    return found;
}
function atSignedPosition(view, record) {
    if (view.walk.status === "malformed")
        return false;
    const first = view.lines[0];
    if (first == null || first.prev !== events.sha256Hex(Buffer.from(view.runId, "utf8")))
        return false;
    const at = locate(view, record);
    if (at === null)
        return false;
    for (let i = 0; i <= at; i++) {
        const rec = view.lines[i];
        if (rec == null || rec.run_id !== view.runId)
            return false;
    }
    const broke = view.walk.status === "broken" ? view.walk.first_break : null;
    if (broke !== null && broke.line <= at + 1)
        return false;
    return record.seq === at;
}
function runIdsBound(view, upTo) {
    for (let i = 0; i <= upTo && i < view.lines.length; i++) {
        const rec = view.lines[i];
        if (rec != null && rec.schema === 3 && rec.run_id !== view.runId)
            return false;
    }
    return true;
}
// --- Key resolution -------------------------------------------------------------------------------
function readJsonRecord(file) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        return null;
    }
    return isRecord(parsed) ? parsed : null;
}
function fingerprintOf(pk) {
    try {
        return pkFingerprint(pk);
    }
    catch {
        return null;
    }
}
function trustFacts(trust) {
    if ("not_read" in trust)
        return { source: "not-read", requirePinned: false };
    if (!trust.read.ok)
        return { source: trust.attempted ?? "not-read", requirePinned: false };
    const read = trust.read.value;
    return { source: read.source, requirePinned: read.config !== null && read.config.requirePinnedGovernor };
}
function classify(custody, fingerprint, trust) {
    if (custody === "in-process")
        return "in-process";
    if ("not_read" in trust || !trust.read.ok)
        return "unpinned";
    const config = trust.read.value.config;
    return trust.read.value.present && config !== null && config.governorKeyFingerprints.includes(fingerprint) ? "pinned" : "unpinned";
}
function resolveOn(view, runDir, trust, governorDir, producerDir) {
    const facts = trustFacts(trust);
    const settle = (custody, failure, key = null, classification = null) => ({
        custody, pk: key ? key.pk : null, signer_fingerprint: key ? key.fingerprint : null, classification,
        trust_source: facts.source, require_pinned_governor: facts.requirePinned, failure,
        failure_detail: failure === "trust-file-invalid" && "read" in trust && !trust.read.ok ? trust.read.error.message : null,
    });
    const governorFile = path.join(governorDir || path.join(runDir, "commissaire", "governor"), "governor.json");
    const pkFile = path.join(producerDir || path.join(runDir, "commissaire", "producer"), "pk.json");
    if (view.schema3.length === 0 && !fs.existsSync(governorFile) && !fs.existsSync(pkFile))
        return settle(null, null);
    const governorRec = readJsonRecord(governorFile);
    const pkRec = readJsonRecord(pkFile);
    const unauthenticatedCustody = fs.existsSync(governorFile) ? "in-process" : "governor";
    if (view.walk.status === "malformed")
        return settle(unauthenticatedCustody, "ledger-malformed");
    const head = view.schema3[0];
    const admission = head !== undefined && head.author === "commissaire" && head.kind_of_entry === "admission" && head.seq === 0 ? head : null;
    if (admission === null)
        return settle(unauthenticatedCustody, "admission-missing");
    const payload = isRecord(admission.payload) ? admission.payload : {};
    const custody = payload.custody === "governor" ? "governor" : "in-process";
    if (admission.run_id !== view.runId)
        return settle(custody, "run-id-mismatch");
    if (!atSignedPosition(view, admission))
        return settle(custody, "admission-position-invalid");
    const admitted = str(payload.pk_fingerprint);
    const candidates = custody === "governor" ? [pkRec] : [governorRec !== null ? governorRec : pkRec];
    let bound = null;
    for (const candidate of candidates) {
        const pk = candidate === null ? undefined : str(candidate.pk);
        if (pk !== undefined && admitted !== undefined && fingerprintOf(pk) === admitted && verifyDecision(admission, pk))
            bound = pk;
    }
    if (bound === null || admitted === undefined)
        return settle(custody, custody === "governor" ? "governor-key-not-admitted" : "key-not-admitted");
    const key = { pk: bound, fingerprint: admitted };
    if (custody === "in-process" && governorRec !== null && pkRec !== null && fingerprintOf(pkRec.pk) !== governorRec.pk_fingerprint) {
        return settle(custody, "pk-fingerprint-tampered", key, classify(custody, admitted, trust));
    }
    if ("read" in trust && !trust.read.ok)
        return settle(custody, "trust-file-invalid", key);
    return settle(custody, null, key, classify(custody, admitted, trust));
}
function resolveAdmittedKey(runDir, trust, governorDir, producerDir, runId) {
    return resolveOn(loadLedger(runDir, runId), runDir, trust, governorDir, producerDir);
}
// --- Grant verification ---------------------------------------------------------------------------
function permitReason(reason) {
    switch (reason) {
        case "not-a-commissaire-decision":
        case "decision-signature-invalid":
        case "decision-not-a-grant":
        case "grant-does-not-cover-effect":
            return reason;
        default:
            return "pk-unreadable";
    }
}
function verifyGrant(input) {
    const unresolved = (outcome, reason) => ({
        outcome, reason, custody: null, classification: null, signer_fingerprint: null, verdict_seq: null, trust_source: trustFacts(input.trust).source,
    });
    const target = input.effect?.target;
    if (typeof target !== "string" || target === "")
        return unresolved("absent-or-invalid", "effect-target-missing");
    const view = loadLedger(input.run_dir, input.run_id);
    const key = resolveOn(view, input.run_dir, input.trust, input.governor_dir, input.producer_dir);
    const report = (outcome, reason, verdictSeq = null) => ({
        outcome, reason, custody: key.custody, classification: key.classification, signer_fingerprint: key.signer_fingerprint,
        verdict_seq: verdictSeq, trust_source: key.trust_source,
    });
    if (key.custody === null)
        return report("not-applicable", "not-governed");
    // A damaged ledger has no trustworthy verdicts to look for, so it is named before the verdict lookup.
    if (key.failure === "admission-missing" || key.failure === "ledger-malformed")
        return report("absent-or-invalid", key.failure);
    const atStep = view.schema3.filter((e) => e.author === "commissaire" && e.kind_of_entry === "effect-decision-verdict" && matchesUnit(e, input.unit_id) && e.step === input.step);
    if (atStep.length === 0)
        return report("absent-or-invalid", "no-verdict-for-step");
    const ofKind = atStep.filter((e) => isRecord(e.payload) && isRecord(e.payload.effect) && e.payload.effect.kind === input.effect.kind);
    const verdict = ofKind[ofKind.length - 1];
    if (verdict === undefined)
        return report("absent-or-invalid", "no-verdict-for-kind");
    if (key.failure !== null || key.pk === null)
        return report("absent-or-invalid", key.failure ?? "admission-missing");
    const at = locate(view, verdict);
    if (!runIdsBound(view, at === null ? view.lines.length - 1 : at))
        return report("absent-or-invalid", "run-id-mismatch");
    if (!atSignedPosition(view, verdict))
        return report("absent-or-invalid", "chain-position-invalid");
    const permit = chokepointPermit({ kind: input.effect.kind, target }, verdict, key.pk, key.signer_fingerprint);
    const verdictSeq = typeof verdict.seq === "number" ? verdict.seq : null;
    if (permit.permit && key.require_pinned_governor && key.classification !== "pinned")
        return report("absent-or-invalid", "grant-not-pinned", verdictSeq);
    return permit.permit ? report("valid-grant", "valid-grant", verdictSeq) : report("absent-or-invalid", permitReason(permit.reason), verdictSeq);
}
module.exports = { verifyGrant, resolveAdmittedKey };
