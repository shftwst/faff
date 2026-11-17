"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReviewCommentSession = createReviewCommentSession;
// === region:factory — review-comment-session - stored plans and tracker handoff ===
const node_crypto_1 = require("node:crypto");
const review_comment_ts_1 = require("./review-comment.js");
function fields(value, keys) {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
        throw new Error('unexpected input fields');
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string' || (key !== 'faff_body' && !item))
            throw new Error(`invalid ${key}`);
        result[key] = item;
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024)
        throw new Error('input exceeds 1 MiB');
    return result;
}
function digest(value) {
    const json = JSON.stringify(value);
    if (json === undefined || Buffer.byteLength(json) > 1024 * 1024)
        throw new Error('comments exceed 1 MiB');
    return (0, node_crypto_1.createHash)('sha256').update(json).digest('hex');
}
function createReviewCommentSession(ports, options = {}) {
    const now = options.now ?? Date.now;
    const ttlMs = options.ttlMs ?? 300_000;
    const maxPlans = options.maxPlans ?? 16;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 300_000 || !Number.isSafeInteger(maxPlans) || maxPlans <= 0 || maxPlans > 16)
        throw new Error('invalid session limits');
    const plans = new Map();
    const busy = new Set();
    let preparing = 0;
    const prune = () => { for (const [ref, stored] of plans)
        if (now() >= stored.expires)
            plans.delete(ref); };
    const refused = (diagnostic) => ({ status: 'refused', diagnostic });
    return {
        async prepare(value) {
            const input = fields(value, ['issue_id', 'faff_body']);
            const issueId = input.issue_id ?? '';
            const replacement = input.faff_body ?? '';
            (0, review_comment_ts_1.planReviewComment)({ schema: 1, issue_id: issueId, faff_body: replacement, comments: [] });
            prune();
            if (busy.has(issueId))
                throw new Error('issue has an apply in progress');
            if (plans.size + preparing >= maxPlans)
                throw new Error('plan capacity reached');
            preparing++;
            try {
                const comments = await ports.listComments(issueId);
                const snapshot = digest(comments);
                const plan = Object.freeze((0, review_comment_ts_1.planReviewComment)({ schema: 1, issue_id: issueId, faff_body: replacement, comments }));
                if (busy.has(issueId))
                    throw new Error('issue has an apply in progress');
                const ref = (0, node_crypto_1.randomUUID)();
                const expires = now() + ttlMs;
                plans.set(ref, { issueId, replacement, snapshot, plan, expires });
                return { plan_ref: ref, expires_at: new Date(expires).toISOString(), plan: { ...plan } };
            }
            finally {
                preparing--;
            }
        },
        async apply(value) {
            const input = fields(value, ['plan_ref']);
            prune();
            const ref = input.plan_ref ?? '';
            const stored = plans.get(ref);
            if (!stored)
                return refused('unknown, expired or consumed plan reference; prepare from a new live read');
            plans.delete(ref);
            if (busy.has(stored.issueId))
                return refused('issue has an apply in progress');
            busy.add(stored.issueId);
            for (const [other, plan] of plans)
                if (plan.issueId === stored.issueId)
                    plans.delete(other);
            try {
                try {
                    const comments = await ports.listComments(stored.issueId);
                    (0, review_comment_ts_1.planReviewComment)({ schema: 1, issue_id: stored.issueId, faff_body: stored.replacement, comments });
                    if (now() >= stored.expires)
                        return refused('plan expired during live read');
                    if (digest(comments) !== stored.snapshot)
                        return refused('comments changed; prepare from a new live read');
                }
                catch {
                    return refused('live comment read failed; no write attempted');
                }
                try {
                    return { ...await ports.writeComment(stored.issueId, stored.plan), reason: stored.plan.reason };
                }
                catch {
                    return { status: 'uncertain', reason: stored.plan.reason, diagnostic: 'write acknowledgement missing; inspect a new live read before any further write' };
                }
            }
            finally {
                busy.delete(stored.issueId);
            }
        },
    };
}
