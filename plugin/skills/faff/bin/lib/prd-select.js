"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectPrd = selectPrd;
// === region:factory — share PRD selection between interactive plot and the run trigger ===
function stringField(value, key) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const field = Reflect.get(value, key);
    return typeof field === "string" ? field : null;
}
function selectPrd(list, resolvePath) {
    if (!Array.isArray(list))
        return { action: "intake", reason: "prd-list-failed" };
    const candidates = list.map(entry => ({
        slug: stringField(entry, "slug"),
        container: stringField(entry, "container"),
        status: stringField(entry, "status"),
    }));
    const eligible = candidates.length > 1
        ? candidates.filter(candidate => /^(Active|Frozen)\b/.test(candidate.status ?? ""))
        : candidates;
    if (eligible.length > 1)
        return { action: "choose", candidates: eligible };
    const candidate = eligible[0];
    if (!candidate)
        return { action: "intake", reason: "no-prd" };
    const { container } = candidate;
    if (!container)
        return { action: "intake", reason: "prd-container-missing" };
    const path = resolvePath(container);
    return path ? { action: "use", container, path } : { action: "intake", reason: "prd-file-missing" };
}
