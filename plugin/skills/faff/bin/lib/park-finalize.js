"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// === region:factory — prepare and finalize a park from caller-owned observations ===
const node_path_1 = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { ROOT_CAUSE_CLASSES, addParkRecord, fingerprintFile } = require("./park-history");
const { readStdinCapped, VALIDATE_MAX_BYTES } = require("./ratified-scope");
const { findRoot } = require("./shared-infra");
const usage = "usage: faff park prepare|finalize [--root DIR] < facts.json";
const spec = {
    flags: { "--root": { arity: 1 } },
    positionals: { min: 1, max: 1 },
};
function object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseIdentity(value) {
    if (!object(value))
        throw new Error("expected a park record");
    const { issue_id, root_cause_class, timestamp } = value;
    if (typeof issue_id !== "string" || !issue_id.trim())
        throw new Error("issue_id is required");
    if (typeof root_cause_class !== "string" || !ROOT_CAUSE_CLASSES.has(root_cause_class)) {
        throw new Error("root_cause_class must be assigned by the routing caller");
    }
    if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) {
        throw new Error("timestamp must be the stable transition instant");
    }
    return { issue_id, root_cause_class, timestamp };
}
function configCitation(value) {
    if (!object(value) || value.kind !== "config-file" || typeof value.ref !== "string" ||
        !value.ref.trim() || (0, node_path_1.isAbsolute)(value.ref))
        return null;
    const { keys } = value;
    if (keys !== undefined && (!Array.isArray(keys) || !keys.every(key => typeof key === "string")))
        return null;
    return { kind: "config-file", ref: value.ref, ...(keys === undefined ? {} : { keys }) };
}
function prepare(facts, root) {
    const identity = parseIdentity(facts);
    const cited = facts.reconsider === "machine" ? configCitation(facts.cited_input) : null;
    const fingerprint = cited ? fingerprintFile(root, cited.ref) : null;
    return cited && fingerprint
        ? { ...identity, reconsider: "machine", cited_input: { ...cited, fingerprint } }
        : { ...identity, reconsider: "human", cited_input: null };
}
function observation(value) {
    if (value === "confirmed" || value === "missing")
        return value;
    if (value === undefined || value === "unknown")
        return "unknown";
    throw new Error("effect observation must be confirmed, missing or unknown");
}
function finalize(facts) {
    const { record, park_records, comment, label, marker, backstop } = facts;
    if (!object(record))
        throw new Error("expected a park record");
    const identity = parseIdentity(record);
    if (park_records !== undefined && !Array.isArray(park_records))
        throw new Error("park_records must be an array");
    if (backstop !== undefined && typeof backstop !== "boolean")
        throw new Error("backstop must be boolean");
    if (marker !== undefined && (comment !== undefined || label !== undefined)) {
        throw new Error("git-only marker and tracker observations are mutually exclusive");
    }
    const prior = park_records ?? [];
    const cited = configCitation(record.cited_input);
    const fingerprint = object(record.cited_input) && record.cited_input.fingerprint;
    const machine = record.reconsider === "machine" && cited && typeof fingerprint === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(fingerprint);
    const prepared = machine
        ? { ...identity, reconsider: "machine", cited_input: { ...cited, fingerprint } }
        : { ...identity, reconsider: "human", cited_input: null };
    const next = addParkRecord(prior, prepared);
    if (next === prior)
        return { action: "already-recorded" };
    const effects = marker === undefined ? { comment, label } : { marker };
    for (const [effect, value] of Object.entries(effects)) {
        const status = observation(value);
        const canWrite = effect === "label" || (effect === "comment" && !backstop);
        if (status === "unknown" || (status === "missing" && !canWrite))
            return { action: "reconcile", effect };
        if (status === "missing")
            return { action: effect };
    }
    return { action: "record", park_records: next };
}
function cmdPark(args) {
    const { values, positionals, errors } = parseArgs(args, spec);
    if (errors.length)
        return usageError(errors, usage);
    const [sub] = positionals;
    if (sub !== "prepare" && sub !== "finalize") {
        process.stderr.write(usage + "\n");
        return 2;
    }
    try {
        const input = readStdinCapped(VALIDATE_MAX_BYTES);
        if (input.over)
            throw new Error("could not read park facts within the input limit");
        const facts = JSON.parse(input.text);
        if (!object(facts))
            throw new Error("expected a park facts object");
        const result = sub === "prepare" ? prepare(facts, values["--root"] || findRoot()) : finalize(facts);
        console.log(JSON.stringify(result));
        return 0;
    }
    catch (error) {
        process.stderr.write("faff park: " + (error instanceof Error ? error.message : String(error)) + "\n");
        return 2;
    }
}
module.exports = { cmdPark };
