"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdTicketFields = cmdTicketFields;
// === region:factory — return ordered create-template fields or the native template to fetch ===
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const prep_attach_1 = require("./prep-attach");
const { loadConfig, resolveTemplatesPath } = require("./config");
const { dig } = require("./shared-infra");
const { extractLevel2Headings } = require("./adr");
const builtIn = {
    bug: ["Repro", "Expected", "Actual", "Scope", "Open questions"],
    feature: ["Why", "What", "Acceptance", "Open questions"],
    spike: ["Question", "Timebox", "Decision to make", "Open questions"],
    chore: ["What", "Why now", "Open questions"],
    epic: ["Outcome", "Child slices", "Open questions"],
    default: ["Why", "What", "Open questions"],
};
function output(fields) {
    process.stdout.write(JSON.stringify({ fields }) + "\n");
    return 0;
}
function headings(text) {
    const lines = text.split(/\r?\n/);
    const mask = (0, prep_attach_1.fenceMask)(lines);
    return extractLevel2Headings(lines.filter((_, index) => !mask[index]).join("\n"))
        .map(field => field.trim()).filter(Boolean);
}
function cmdTicketFields(root, flags, readMap) {
    const type = flags["--type"];
    const body = flags["--native-body"];
    if (typeof type !== "string" || !Object.hasOwn(builtIn, type) ||
        (body !== undefined && (typeof body !== "string" || flags["--local"]))) {
        process.stderr.write("usage: faff native-map fields --type TYPE [--local | --native-body FILE|-] [--root DIR]\n");
        return 2;
    }
    const defaults = builtIn[type];
    if (!defaults)
        return 2;
    const [config] = loadConfig(root);
    if (typeof body === "string") {
        try {
            const fields = headings((0, node_fs_1.readFileSync)(body === "-" ? 0 : body, "utf8"));
            if (fields.length)
                return output(fields);
            process.stderr.write("native template has no level-2 fields; using local fallback\n");
        }
        catch {
            process.stderr.write("native template body could not be read; using local fallback\n");
        }
    }
    else if (!flags["--local"]) {
        const { tree } = readMap(root, config);
        const id = dig(tree, `mappings.${type}.id`);
        const name = dig(tree, `mappings.${type}.name`);
        if (id !== null && name !== null) {
            process.stdout.write(JSON.stringify({ id, name }) + "\n");
            return 0;
        }
    }
    const file = (0, node_path_1.join)(root, resolveTemplatesPath(root, config, false), type + ".md");
    try {
        const fields = headings((0, node_fs_1.readFileSync)(file, "utf8"));
        if (fields.length)
            return output(fields);
        process.stderr.write(`skipped empty or heading-less template override: ${file}\n`);
    }
    catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            process.stderr.write(`skipped unreadable template override: ${file}\n`);
        }
    }
    return output(defaults);
}
