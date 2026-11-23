"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareApprovedAttachment = prepareApprovedAttachment;
exports.checkReviewedStage = checkReviewedStage;
// === region:factory — prepare the local attachment after an ordinary reviewer approval ===
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const prep_attach_ts_1 = require("./prep-attach.js");
const { markerPath, ISSUE_RE } = require("./prep-attach");
const { specReviewDir } = require("./spec-review-pin");
const { placeSpecReviewEvidence } = require("./evidence");
const { writeEvidenceFrom } = require("./spec-review");
const { resolveKnownSecretValues } = require("./redact");
const { applyDispositions, collateSpecReviewRounds, renderSpecReviewComment } = require("./evidence-collate");
const sha256 = (bytes) => (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex");
function specialHistory(name) {
    return /^ratified-\d+\.json$/.test(name) || name === "cap-reset.json" || name === "judge";
}
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function ownedStage(m, issue, session, runDir) {
    if (!record(m) || m.issue !== issue || m.spec_produced !== true || m.disposition === "parked" || !record(m.owner))
        return false;
    const ownerRun = m.owner.run_dir;
    if (ownerRun !== undefined && typeof ownerRun !== "string")
        return false;
    return (m.owner.session_id ?? "") === session &&
        (ownerRun ? (0, node_fs_1.realpathSync)(ownerRun) : null) === (runDir ? (0, node_fs_1.realpathSync)(runDir) : null);
}
function retainReview(text, retain) {
    const lines = text.split("\n");
    const mask = (0, prep_attach_ts_1.fenceMask)([...lines, ""]);
    if (mask.at(-1))
        return;
    const ratings = lines.flatMap((line, i) => !mask[i] && /^confidence:/i.test(line) ? [i] : []);
    const idx = ratings[0];
    if (ratings.length !== 1 || idx === undefined || !/^confidence:\s*(high|medium|low)\s*$/i.test(lines[idx] ?? ""))
        return;
    const existing = lines.filter((line, i) => !mask[i] && /^spec-review:/i.test(line));
    if (existing.length)
        return existing.length === 1 && existing[0]?.trim() === retain ? text : undefined;
    lines.splice(idx + 1, 0, retain + (lines[idx]?.endsWith("\r") ? "\r" : ""));
    return lines.join("\n");
}
// A human ratification, a new window or a judge can settle objections for different reasons.
function reviewerCleared(dir, latest, rounds, records) {
    if (rounds.length !== latest.round || (0, node_fs_1.readdirSync)(dir).some(specialHistory))
        return false;
    return rounds.every(({ n }, i) => {
        const record = records.get(n);
        const verdict = record && typeof record === "object" && "verdict" in record ? record.verdict : undefined;
        if (n !== i + 1)
            return false;
        const last = n === latest.round;
        const decision = last ? latest : JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(dir, "decision-" + n + ".json"), "utf8"));
        return verdict === (last ? "approve" : "revise") && decision?.verdict === verdict &&
            decision.round === n && decision.window_start === 1 && decision.action === (last ? "approve" : "fix-and-rerun");
    });
}
function prepareApprovedAttachment(ctx, latest, digest, records) {
    const { issue, root, dir, runDir } = ctx;
    let work;
    let sourceVerified = false;
    try {
        if (!ISSUE_RE.test(issue) || !latest.retain || latest.action !== "approve") {
            return { status: "stale", reason: "expected an approved issue" };
        }
        const expected = (0, node_path_1.resolve)(root, specReviewDir(issue, runDir));
        if ((0, node_fs_1.realpathSync)(dir) !== (0, node_fs_1.realpathSync)(expected) || placeSpecReviewEvidence(dir).issue !== issue) {
            return { status: "stale", reason: "review directory does not belong to this issue and run" };
        }
        const m = JSON.parse((0, node_fs_1.readFileSync)(markerPath(root, issue), "utf8"));
        const session = process.env.FAFF_SESSION_ID || "";
        if (!ownedStage(m, issue, session, runDir) || (m.mode !== "tracker" && m.mode !== "git-only") ||
            m.spec_sha256 !== digest || typeof m.body_path !== "string") {
            return { status: "stale", reason: "pre-review stage no longer matches the issue, owner or digest" };
        }
        const bytes = (0, node_fs_1.readFileSync)(m.body_path);
        if (sha256(bytes) !== digest) {
            return { status: "stale", reason: "spec changed since the reviewed stage" };
        }
        if (m.mode === "git-only" && (m.attached !== true || !bytes.equals((0, node_fs_1.readFileSync)((0, node_path_1.join)(root, ".faff", "specs", issue + ".md"))))) {
            return { status: "stale", reason: "git-only attachment changed since the reviewed stage" };
        }
        sourceVerified = true;
        const spec = retainReview(bytes.toString("utf8"), latest.retain);
        if (spec === undefined || /^#{1,6}\s+spec-review evidence\s*$/im.test(spec)) {
            return { status: "manual", reason: "reconcile existing review or confidence metadata" };
        }
        const secrets = resolveKnownSecretValues(root);
        const collated = collateSpecReviewRounds(dir, secrets);
        if (collated.skipped.length || !reviewerCleared(dir, latest, collated.rounds, records)) {
            return { status: "manual", reason: "review history requires explicit dispositions" };
        }
        let comment = "";
        if (collated.record.objections.length) {
            const dispositions = collated.record.objections.map(({ key, lens }) => ({ key, lens, disposition: "fixed" }));
            comment = renderSpecReviewComment(applyDispositions(collated.record, dispositions, secrets), collated.rounds);
        }
        work = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_fs_1.realpathSync)(dir), "attachment-"));
        const specPath = (0, node_path_1.join)(work, "spec.md");
        const commentPath = comment && m.mode === "tracker" ? (0, node_path_1.join)(work, "comment.md") : null;
        if (commentPath)
            (0, node_fs_1.writeFileSync)(commentPath, comment, { mode: 0o600 });
        const body = comment && m.mode === "git-only" ? spec + (spec.endsWith("\n") ? "\n" : "\n\n") + comment : spec;
        (0, node_fs_1.writeFileSync)(specPath, body, { mode: 0o600 });
        const written = comment ? writeEvidenceFrom(dir, comment, secrets) : null;
        const result = {
            status: "prepared", spec_path: specPath, comment_path: commentPath, evidence_path: written?.written ?? null,
            source_path: m.body_path, source_sha256: digest, mode: m.mode, session_id: session,
            spec_sha256: sha256(body), comment_sha256: commentPath ? sha256(comment) : null,
        };
        if (written && !written.written)
            result.warning = "spec-review evidence not written: " +
                (written.refused?.join("; ") || written.fault) + (written.stale ? " (" + written.stale + ")" : "");
        return result;
    }
    catch (error) {
        if (work && (0, node_fs_1.existsSync)(work))
            (0, node_fs_1.rmSync)(work, { recursive: true, force: true });
        return { status: sourceVerified ? "manual" : "stale", reason: error instanceof Error ? error.message : "could not prepare review attachment" };
    }
}
// Stage already holds the spec bytes and marker. Refuse a stale handoff before stage writes either.
function checkReviewedStage(root, issue, file, body, gitOnly, marker, session, runDir) {
    const dir = (0, node_path_1.resolve)(root, specReviewDir(issue, runDir));
    const names = (0, node_fs_1.readdirSync)(dir);
    const latest = names.reduce((n, name) => Math.max(n, Number(/^(?:round|decision)-(\d+)\.json$/.exec(name)?.[1] || 0)), 0);
    if (!latest || names.some(specialHistory))
        throw new Error("review history changed");
    const d = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(dir, "decision-" + latest + ".json"), "utf8"));
    const r = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(dir, "round-" + latest + ".json"), "utf8"));
    const a = d.attachment;
    const path = (0, node_path_1.resolve)(file);
    const mode = gitOnly ? "git-only" : "tracker";
    if (d.round !== latest || d.action !== "approve" || r.verdict !== "approve" || a?.status !== "prepared" ||
        a.spec_path !== path || a.session_id !== session || a.mode !== mode)
        throw new Error("no matching reviewed attachment");
    if (a.comment_path && sha256((0, node_fs_1.readFileSync)(a.comment_path)) !== a.comment_sha256)
        throw new Error("review comment changed");
    if (!ownedStage(marker, issue, session, runDir) || marker.mode !== mode)
        throw new Error("reviewed stage marker or owner changed");
    const attached = marker.attached === true;
    if (gitOnly && (!attached || sha256((0, node_fs_1.readFileSync)((0, node_path_1.join)(root, ".faff", "specs", issue + ".md"))) !== marker.spec_sha256)) {
        throw new Error("git-only attachment changed");
    }
    const preparedSha = sha256(body);
    if (marker.body_path === path && marker.spec_sha256 === preparedSha)
        return attached ? "attached" : "reconcile";
    if (marker.body_path !== a.source_path || marker.spec_sha256 !== a.source_sha256 ||
        sha256((0, node_fs_1.readFileSync)(a.source_path)) !== a.source_sha256 || preparedSha !== a.spec_sha256)
        throw new Error("reviewed bytes changed");
    return "stage";
}
