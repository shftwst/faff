"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmdVerifyMember = cmdVerifyMember;
// === region:factory — verify run custody before member evidence ===
const node_crypto_1 = require("node:crypto");
const node_util_1 = require("node:util");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const { parseArgs, usageError } = require("./argv");
const { MANIFEST_VERSION, memberRels, diffAgainstManifest } = require("./integrity-digest");
const { guardWriterPaths, claimFromStdin, verifyReturn } = require("./evidence");
const { mutateLedgerUnderLock, atomicWriteSingleValueFile, redactLedgerDocument } = require("./heartbeat");
const { appendEventRecord, walkPhysicalChain } = require("./events");
const { readLeafNoFollow } = require("./leaf-read");
const { rebaselineFold } = require("./integrity-digest");
const usage = "usage: faff dispatch verify-member [--record] --run-dir DIR --issue ID --return JSON|null < held-manifest";
const spec = {
    flags: { "--record": { arity: 0 }, "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--return": { arity: 1 } },
    positionals: { min: 0, max: 0 },
};
function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readManifest(dir) {
    const manifest = JSON.parse((0, node_fs_1.readFileSync)(0, "utf8"));
    if (!object(manifest) || manifest.version !== MANIFEST_VERSION || manifest.grain !== "run" || !object(manifest.members)) {
        throw new Error("expected the held run-grain manifest on stdin");
    }
    const roster = memberRels(dir, null, true);
    const members = manifest.members;
    if (Object.keys(members).length !== roster.length || !roster.every((key) => {
        const member = members[key];
        return Object.hasOwn(members, key) && object(member) && typeof member.present === "boolean";
    })) {
        throw new Error("incomplete run-grain manifest with events");
    }
    return { ...manifest, members };
}
function unavailable(scope, issue, err) {
    const reason = err instanceof Error ? err.message : String(err);
    const label = scope === "run" ? "integrity-digest" : "evidence-return";
    console.log(JSON.stringify({ scope, issue, verdict: "unavailable", park_cause: label + " verification unavailable — " + reason.split("\n")[0], tampered_paths: [] }));
    return 2;
}
const ledgerName = "run-ledger.json";
const digest = (bytes) => (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex");
function readBytes(file) {
    const leaf = readLeafNoFollow(file);
    if (leaf.kind !== "regular")
        throw new Error("expected a regular file: " + (0, node_path_1.basename)(file));
    return leaf.bytes;
}
function appended(ledger, entry) {
    const entries = ledger.evidence_persisted ?? [];
    if (!Array.isArray(entries))
        throw new Error("invalid evidence_persisted");
    return { ...ledger, evidence_persisted: [...entries, entry] };
}
// The recovery copy is untrusted. Authenticate the exact input bytes with the
// caller's held digest and derive the permitted output from the verified entry.
function intendedHash(before, held, entry) {
    if (digest(before) !== held)
        throw new Error("recovery preimage differs from held ledger");
    const ledger = JSON.parse(before.toString("utf8"));
    const doc = { schema_version: 1, ...appended(ledger, entry) };
    return digest(JSON.stringify(redactLedgerDocument(doc), null, 2) + "\n");
}
function recordEntry(dir, manifest, entry) {
    const member = manifest.members[ledgerName];
    const events = manifest.members["events.jsonl"];
    if (!object(member) || typeof member.sha256 !== "string" || !object(events) || !object(events.events)) {
        throw new Error("recording requires a held ledger and an existing event log");
    }
    const held = member.sha256;
    const recovery = (0, node_path_1.join)(dir, ".verified-return-before");
    let intended = held;
    const write = mutateLedgerUnderLock(dir, (ledger, state) => {
        const differences = diffAgainstManifest(dir, manifest);
        if (differences.some(p => p !== ledgerName))
            throw new Error("shared custody changed: " + differences.join(", "));
        const current = readBytes((0, node_path_1.join)(dir, ledgerName));
        if (digest(current) !== state.beforeSha256)
            throw new Error("ledger changed during verification");
        if (state.beforeSha256 !== held) {
            intended = intendedHash(readBytes(recovery), held, entry);
            if (intended !== state.beforeSha256)
                throw new Error("ledger differs from intended write");
            // A crash can occur between the ledger rename and its chained event.
            const chain = walkPhysicalChain(readBytes((0, node_path_1.join)(dir, "events.jsonl")));
            if (chain.status !== "verified" || chain.torn_tail)
                throw new Error("event chain unavailable for retry");
            const last = chain.records.filter((r) => r.type === "ledger-write").at(-1);
            if (last?.data?.ledger_sha256 !== intended) {
                if (last && last.data?.ledger_sha256 !== held)
                    throw new Error("unexpected intervening ledger write");
                appendEventRecord(dir, (0, node_path_1.basename)(dir), { phase: "run", type: "ledger-write", data: { ledger_sha256: intended } });
            }
            return null;
        }
        if (!Array.isArray(ledger.admitted) || !ledger.admitted.includes(entry.issue))
            throw new Error("member not admitted");
        const rows = ledger.evidence_persisted ?? [];
        if (!Array.isArray(rows))
            throw new Error("invalid evidence_persisted");
        const last = rows.filter(r => r.issue === entry.issue).at(-1);
        if ((0, node_util_1.isDeepStrictEqual)(last, entry))
            return null;
        intended = intendedHash(current, held, entry);
        atomicWriteSingleValueFile(recovery, current);
        return appended(ledger, entry);
    });
    if (write.written && write.after_sha256 !== intended)
        throw new Error("ledger writer returned an unexpected digest");
    if (intended === held) {
        if (diffAgainstManifest(dir, manifest).length)
            throw new Error("custody changed after verification");
        return manifest;
    }
    const next = rebaselineFold(dir, manifest, ledgerName, intended, null, true);
    if (!next.ok)
        throw new Error(next.reason);
    const chain = walkPhysicalChain(readBytes((0, node_path_1.join)(dir, "events.jsonl")));
    const last = chain.records.filter((r) => r?.type === "ledger-write").at(-1);
    if (chain.status !== "verified" || chain.torn_tail || last?.data?.ledger_sha256 !== intended) {
        throw new Error("ledger write event unconfirmed; retry with original manifest");
    }
    return next.manifest;
}
function cmdVerifyMember(args) {
    const { values, errors } = parseArgs(args, spec);
    const dir = values["--run-dir"], issue = values["--issue"];
    if (errors.length || !dir || !issue || values["--return"] === undefined)
        return usageError(errors, usage);
    let manifest;
    let retry = false;
    try {
        manifest = readManifest(dir);
        const paths = diffAgainstManifest(dir, manifest);
        retry = values["--record"] && paths.length === 1 && paths[0] === ledgerName;
        if (paths.length && !retry) {
            console.log(JSON.stringify({ scope: "run", issue, verdict: "tampered", park_cause: "integrity-digest tampered — " + paths.join(", "), tampered_paths: paths }));
            return 1;
        }
    }
    catch (err) {
        return unavailable("run", issue, err);
    }
    try {
        const issueDir = guardWriterPaths(dir, issue);
        const claim = claimFromStdin(values["--return"], issue);
        const { verdict, park_cause, tampered_paths, evidence_persisted } = verifyReturn(issueDir, issue, claim);
        if (retry && (verdict !== "agree" || !evidence_persisted))
            return unavailable("run", issue, "unconfirmed ledger change");
        let baseline;
        if (values["--record"] && verdict === "agree") {
            try {
                baseline = evidence_persisted ? recordEntry(dir, manifest, evidence_persisted) : manifest;
            }
            catch (err) {
                return unavailable("run", issue, err);
            }
        }
        console.log(JSON.stringify({ scope: "member", issue, verdict, park_cause, tampered_paths, evidence_persisted, baseline }));
        return verdict === "agree" ? 0 : 1;
    }
    catch (err) {
        return unavailable(retry ? "run" : "member", issue, err);
    }
}
