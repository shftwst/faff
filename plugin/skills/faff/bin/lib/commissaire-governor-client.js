"use strict";
// ===========================================================================
// === region:factory — commissaire-governor-client — FAFF-1179: the runner-side Commissaire governor client (ADR 0135) ===
//
// The runner half of the out-of-process governor (server side: governor.ts, FAFF-1177). When a
// governor is configured (the `commissaire.governor` switch, or the COMMISSAIRE_GOVERNOR env
// override), commissaire.ts's admit / authorize / conclude verbs ask this client for a
// governor-signed record instead of signing one in-process: the runner then holds only K_producer
// and the public key, never SK_commissaire or the HMAC master.
//
// This module speaks the FAFF-1177 wire protocol — one newline-delimited JSON request per
// connection over a Unix socket or TCP, one reply — and never falls back to in-process signing
// under honest operation (ADR 0135, decision 1): an unreachable or unverifiable governor stops the
// unit, it does not degrade. Every governor-returned record is Ed25519-verified before it is
// appended, so a substituted key or a man-in-the-middle on the cleartext TCP path is caught.
//
// Region FACTORY (committed .js emit, ADR-0132): it reaches only budget (readGovernanceConfig — the
// switch read path ADR 0135 decision 11 mandates, NOT config.js), shared-infra (dig), and
// producer-auth (verifyDecision / pkFingerprint). It MUST NOT require config.js, MUST NOT be
// required by governor.ts, and stays out of the standalone binary's denylisted closure — the ledger
// mechanics (position read, append-under-lock) are injected by commissaire.ts, so this module needs
// no events import either. node:net transport runs only in the self-spawned request subprocess, so
// a plain require of this module has no network side-effect.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.governorConfigError = governorConfigError;
exports.parseEndpoint = parseEndpoint;
exports.resolveGovernor = resolveGovernor;
exports.runStartGovernorDecision = runStartGovernorDecision;
exports.resolveTimeouts = resolveTimeouts;
exports.verifyAdmitReply = verifyAdmitReply;
exports.governorRequest = governorRequest;
exports.classifyAskResult = classifyAskResult;
exports.appendGovernorRecordWithRetry = appendGovernorRecordWithRetry;
const { spawnSync } = require("node:child_process");
const producerAuth = require("./producer-auth");
const { readGovernanceConfig } = require("./budget");
const { dig } = require("./shared-infra");
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v) => (typeof v === "string" ? v : undefined);
// A malformed switch value is a CONFIGURATION FAULT, never a silent in-process fallback. The caller
// surfaces it as exit 2; the marker lets commissaire.ts distinguish it from a governance read-error
// (legacy-config-name / base-parse-error), which must propagate unchanged to the dispatch boundary.
function governorConfigError(message) {
    const e = new Error(message);
    e.governorConfigFault = true;
    return e;
}
// Endpoint string shape: a `.sock` suffix is always a Unix path; a `host:port` with an integer port
// in 1..65535 (and no `/` in the host) is TCP; a value with no `:`, or any value containing `/`, is a
// Unix socket path; anything else is a configuration fault.
function parseEndpoint(raw) {
    if (raw.endsWith(".sock"))
        return { kind: "unix", socket_path: raw };
    const at = raw.lastIndexOf(":");
    if (at > 0) {
        const host = raw.slice(0, at);
        const portStr = raw.slice(at + 1);
        const port = Number(portStr);
        if (!host.includes("/") && /^[0-9]+$/.test(portStr) && Number.isInteger(port) && port >= 1 && port <= 65535) {
            return { kind: "tcp", host, port };
        }
    }
    if (!raw.includes(":") || raw.includes("/"))
        return { kind: "unix", socket_path: raw };
    throw governorConfigError(`commissaire.governor: "${raw}" is neither a usable socket path nor a valid host:port`);
}
// Resolve the governor switch: env over rc, an empty env value is an explicit disable, unset defers
// to the rc, a missing rc is in-process. readGovernanceConfig MAY THROW (legacy-config-name /
// base-parse-error) — that throw propagates (fail-closed, never a silent degrade to in-process).
function resolveGovernor(root, env) {
    const raw = env["COMMISSAIRE_GOVERNOR"];
    if (raw !== undefined) {
        if (raw === "")
            return { configured: false };
        return { configured: true, endpoint: parseEndpoint(raw) };
    }
    const cfg = readGovernanceConfig(root);
    const value = dig(cfg, "commissaire.governor");
    if (value === null || value === undefined)
        return { configured: false };
    return { configured: true, endpoint: parseEndpoint(String(value)) };
}
// The run-start branch (ADR 0135 decision 1): a not-configured run is ungoverned by configuration
// (the zero-config default, never a fallback); any configured run must reach its governor. A pure
// classifier over resolveGovernor so the run-start decision is unit-testable.
function runStartGovernorDecision(root, env) {
    const r = resolveGovernor(root, env);
    return r.configured ? { governed: true, endpoint: r.endpoint } : { governed: false };
}
// Connect and reply timeouts (bounded, conservative defaults, overridable via the commissaire
// namespace). Best-effort: any config read error falls back to the defaults rather than throwing.
function resolveTimeouts(root) {
    let cfg = {};
    try {
        cfg = readGovernanceConfig(root);
    }
    catch {
        cfg = {};
    }
    const c = Number(dig(cfg, "commissaire.connect_timeout_ms"));
    const r = Number(dig(cfg, "commissaire.reply_timeout_ms"));
    return {
        connect_ms: Number.isFinite(c) && c > 0 ? c : 3000,
        reply_ms: Number.isFinite(r) && r > 0 ? r : 10000,
    };
}
// --- Record verification ------------------------------------------------------------------
// Admit reply: verify the admission record's Ed25519 signature under the REPLY's pk AND that
// pkFingerprint(pk) matches the reply's pk_fingerprint. This anchors the persisted public key to a
// key that actually signed the admission, closing the attacker-key-anchoring path. Any failure is
// false (fail-closed).
function verifyAdmitReply(reply) {
    if (!isRecord(reply))
        return false;
    if (!producerAuth.verifyDecision(reply.admission_record, reply.pk))
        return false;
    try {
        if (producerAuth.pkFingerprint(reply.pk) !== reply.pk_fingerprint)
            return false;
    }
    catch {
        return false;
    }
    return true;
}
// --- Transport: one NDJSON request per connection -----------------------------------------
const GOVERNOR_REQUEST_FLAG = "--governor-request";
const TRANSPORT_MAX_BUFFER = 256 * 1024 * 1024;
// Make one governor request and return the single JSON reply, or an `unreachable` classification.
// The async socket round-trip runs in a short-lived self-spawned subprocess so the Commissaire CLI
// verbs stay synchronous (every COMMISSAIRE_DISPATCH handler returns a plain number) and byte-
// identical across the faff and standalone entrypoints. The request (including the raw ledger bytes)
// is handed to the child on stdin, never argv; the reply is small.
function governorRequest(endpoint, request, timeouts) {
    const payload = JSON.stringify({ endpoint, request, connect_ms: timeouts.connect_ms, reply_ms: timeouts.reply_ms });
    const r = spawnSync(process.execPath, [__filename, GOVERNOR_REQUEST_FLAG], { input: payload, encoding: "utf8", maxBuffer: TRANSPORT_MAX_BUFFER });
    if (r.status !== 0 || typeof r.stdout !== "string" || r.stdout === "")
        return { unreachable: true, detail: "transport-subprocess-failed" };
    let out;
    try {
        out = JSON.parse(r.stdout);
    }
    catch {
        return { unreachable: true, detail: "transport-bad-output" };
    }
    if (!isRecord(out))
        return { unreachable: true, detail: "transport-bad-output" };
    if (out.unreachable === true)
        return { unreachable: true, detail: str(out.detail) ?? "unreachable" };
    if (out.ok === true && isRecord(out.reply))
        return { ok: true, reply: out.reply };
    return { unreachable: true, detail: "transport-bad-output" };
}
function classifyAskResult(res) {
    if ("unreachable" in res)
        return { unreachable: true, detail: res.detail };
    const reply = res.reply;
    if (reply.ok === false)
        return { refused: { reason: str(reply.reason) ?? "unknown" } };
    if (reply.idempotent === true && isRecord(reply.record))
        return { idempotent: true, record: reply.record };
    const record = isRecord(reply.verdict_record) ? reply.verdict_record : (isRecord(reply.record) ? reply.record : null);
    if (!record)
        return { refused: { reason: "governor-reply-missing-record" } };
    return { ok: true, record };
}
// The append-with-retry core, parametrised purely by injected ledger/transport seams so it is unit-
// testable without a live governor:
//   ask()                -> read the ledger tail, send the request at that position, return an
//                           AskResult (one ledger read per attempt so the sent bytes and the signed
//                           position are always consistent; a re-send reuses the same request_seq)
//   verify(record)       -> true iff the returned record's Ed25519 signature verifies under the held public key
//   appendVerbatim(rec)  -> the appended record, or null when the lock-assigned position differs
//                           from the record's (a lost race — the append wrote nothing)
// A lost race (a `position-mismatch` refusal, or a null append) re-reads the tail and re-sends with
// the same request_seq, up to `maxExtraAttempts` further attempts (four in total), then parks
// `governor-lost-race`. `ledger-not-extending-head` and `producer-not-admitted` park immediately.
function appendGovernorRecordWithRetry(seams) {
    const maxExtra = seams.maxExtraAttempts ?? 3;
    let attempts = 0;
    for (;;) {
        const reply = seams.ask();
        if ("unreachable" in reply)
            return { unreachable: true };
        if ("idempotent" in reply) {
            // An idempotent reply still carries a governor-returned record; verify it under the held key
            // before reporting its seq, so a compromised governor cannot pass off a fabricated record.
            if (!seams.verify(reply.record))
                return { park: "governor-record-unverified" };
            return { idempotent: true, record: reply.record };
        }
        if ("refused" in reply) {
            const reason = reply.refused.reason;
            if (reason === "position-mismatch") {
                attempts++;
                if (attempts > maxExtra)
                    return { park: "governor-lost-race" };
                continue;
            }
            if (reason === "ledger-not-extending-head")
                return { park: "ledger-not-extending-head" };
            if (reason === "producer-not-admitted")
                return { park: "governor-admission-lost" };
            return { refused: { reason } };
        }
        if (!seams.verify(reply.record))
            return { park: "governor-record-unverified" };
        const appended = seams.appendVerbatim(reply.record);
        if (appended === null) {
            attempts++;
            if (attempts > maxExtra)
                return { park: "governor-lost-race" };
            continue;
        }
        return { ok: true, record: appended };
    }
}
// --- The request subprocess (self-spawn) --------------------------------------------------
// Runs only when this module is invoked as `node commissaire-governor-client.js --governor-request`
// (the transport child). It reads one { endpoint, request, connect_ms, reply_ms } payload from stdin,
// performs the async socket round-trip, and writes exactly one classification JSON to stdout, always
// exiting 0 — the result (ok / unreachable) lives in stdout, never the exit code. Connect and reply
// timeouts, ENOENT / ECONNREFUSED, and a disconnect before a complete reply line all map to
// `unreachable`; a reply that is not one complete JSON line is discarded as `unreachable`.
function runRequestSubprocess() {
    const fs = require("node:fs");
    const net = require("node:net");
    let input = "";
    try {
        input = fs.readFileSync(0, "utf8");
    }
    catch {
        process.stdout.write(JSON.stringify({ unreachable: true, detail: "no-input" }));
        return;
    }
    let payload;
    try {
        payload = JSON.parse(input);
    }
    catch {
        process.stdout.write(JSON.stringify({ unreachable: true, detail: "bad-input" }));
        return;
    }
    const { endpoint, request, connect_ms, reply_ms } = payload;
    const connectOpts = endpoint.kind === "unix" ? { path: endpoint.socket_path } : { host: endpoint.host, port: endpoint.port };
    const socket = net.connect(connectOpts);
    socket.setEncoding("utf8");
    let settled = false;
    let buffered = "";
    let replyTimer = null;
    const emit = (r) => {
        if (settled)
            return;
        settled = true;
        if (replyTimer)
            clearTimeout(replyTimer);
        try {
            socket.destroy();
        }
        catch { /* best-effort */ }
        process.stdout.write(JSON.stringify(r));
    };
    const connectTimer = setTimeout(() => emit({ unreachable: true, detail: "connect-timeout" }), connect_ms);
    const tryParse = () => {
        const nl = buffered.indexOf("\n");
        if (nl === -1)
            return false;
        const line = buffered.slice(0, nl);
        try {
            emit({ ok: true, reply: JSON.parse(line) });
        }
        catch {
            emit({ unreachable: true, detail: "reply-not-json" });
        }
        return true;
    };
    socket.on("connect", () => {
        clearTimeout(connectTimer);
        try {
            socket.write(JSON.stringify(request) + "\n");
        }
        catch {
            emit({ unreachable: true, detail: "write-failed" });
            return;
        }
        replyTimer = setTimeout(() => emit({ unreachable: true, detail: "reply-timeout" }), reply_ms);
    });
    socket.on("data", (chunk) => { buffered += chunk; tryParse(); });
    socket.on("end", () => {
        if (settled)
            return;
        if (!tryParse()) {
            const t = buffered.trim();
            if (t) {
                try {
                    emit({ ok: true, reply: JSON.parse(t) });
                }
                catch {
                    emit({ unreachable: true, detail: "reply-not-json" });
                }
            }
            else
                emit({ unreachable: true, detail: "closed-before-reply" });
        }
    });
    socket.on("error", (e) => { clearTimeout(connectTimer); emit({ unreachable: true, detail: (isRecord(e) && str(e.code)) || "socket-error" }); });
}
if (require.main === module && process.argv.includes(GOVERNOR_REQUEST_FLAG))
    runRequestSubprocess();
module.exports = {
    governorConfigError, parseEndpoint, resolveGovernor, runStartGovernorDecision, resolveTimeouts,
    verifyAdmitReply, governorRequest, classifyAskResult, appendGovernorRecordWithRetry,
};
