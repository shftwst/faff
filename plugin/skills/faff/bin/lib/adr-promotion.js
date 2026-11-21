"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.promotionSourceSpec = void 0;
exports.cmdPromotionSource = cmdPromotionSource;
// === region:factory — select the existing ADR promotion channel for graft ===
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const { loadConfig, resolveAdrDocsPath } = require("./config");
const { dig, findRoot } = require("./shared-infra");
const { parseArgs, usageError } = require("./argv");
const usage = "usage: faff adr promotion-source [--root DIR] (--tracker-intent | --file SPEC)";
exports.promotionSourceSpec = { positionals: { max: 0 }, flags: { "--root": { arity: 1 }, "--tracker-intent": { arity: 0 }, "--file": { arity: 1 } } };
function cmdPromotionSource(args, extract) {
    const { values, errors } = parseArgs(args, exports.promotionSourceSpec);
    if (errors.length)
        return usageError(errors, usage);
    if (Boolean(values["--tracker-intent"]) === Boolean(values["--file"])) {
        process.stderr.write(usage + "\n");
        return 2;
    }
    const root = values["--root"] || findRoot();
    const [config] = loadConfig(root);
    if (dig(config, "adr.mode") === "off") {
        console.log('{"source":"off"}');
        return 0;
    }
    const adr_docs_path = resolveAdrDocsPath(root, config, false);
    if (values["--tracker-intent"]) {
        console.log(JSON.stringify({ source: "tracker", adr_docs_path }));
        return 0;
    }
    let section;
    try {
        section = extract((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(root, values["--file"]), "utf8"));
    }
    catch (error) {
        process.stderr.write("faff adr promotion-source: could not read the committed spec: " +
            (error instanceof Error ? error.message : String(error)) + "\n");
        section = null;
    }
    console.log(JSON.stringify(section === null ? { source: "absent" } : { source: "spec", adr_docs_path, section }));
    return 0;
}
