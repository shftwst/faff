"use strict";
// ===========================================================================
// === region:factory — governor — FAFF-1177: the out-of-process Commissaire governor (server side, ADR 0135) ===
//
// A long-running process that is the only holder of SK_commissaire and the HMAC root secret. A runner
// sends it a ledger and a chain position over a Unix socket (or an opt-in network listener); the
// governor verifies the chain itself, evaluates with the shared decision-policy core, and returns a
// verdict signed at that position. It never reads or writes a run directory: it persists only its key
// file, and its own append-only log, in a key directory outside every run.
//
// Three operations over one NDJSON request per connection: admit, authorize, conclude. Requires the
// governance cores and shared-infra; NEVER ./commissaire (commissaire dispatches here, so that would
// be a require cycle). A plain `start` under the runner's own OS user is not independent (ADR 0135
// decision 7); the caller check on the socket and the install are separate tickets.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSourceAllowList = makeSourceAllowList;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const producerAuth = require("./producer-auth");
const ids = require("./ids");
const { evaluateDecisionRequest, evaluateLevelPolicy, composeDecision, grantCoverage } = require("./decision-policy");
const { computeEscapes, matchesUnit, conclusionKindOf, isProtectedKind, CONCLUSION_KIND } = require("./effects");
const { sha256Hex, walkPhysicalChain, splitPhysicalLines } = require("./events");
const { ensureOwnerOnlyDir, writeOwnerOnlyJson } = require("./shared-infra");
const { makePeerCredReader, resolveTrustedInterpreter, TRUSTED_PYTHON_PATHS } = require("./peer-cred");
const KEY_FILE_NAME = "governor-key.json";
const CONFIG_FILE_NAME = "governor-config.json";
const SOCKET_FILE_NAME = "governor.sock";
const LOG_FILE_NAME = "governor-log.jsonl";
const MAX_REQUEST_CHARS = 64 * 1024 * 1024;
// The operations an admin caller (the human who installed the governor) may send. A code constant,
// never configuration: widening what a human may ask the governor is a reviewed code change.
const ADMIN_OPS = new Set(["identify"]);
const SPAWN_BURST = 20;
const SPAWN_REFILL_PER_MS = SPAWN_BURST / 1000;
const MAX_REFUSAL_LINES_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
const DNS_CACHE_MS = 30_000;
const FORCED_RESOLVE_MIN_GAP_MS = 5_000;
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v) => (typeof v === "string" ? v : undefined);
const num = (v) => (typeof v === "number" ? v : undefined);
const refuse = (reason, detail = {}) => ({ ok: false, reason, ...detail });
function parsePosition(v) {
    if (!isRecord(v))
        return null;
    const seq = num(v.seq), prev = str(v.prev);
    return seq !== undefined && Number.isInteger(seq) && seq >= 0 && prev !== undefined ? { seq, prev } : null;
}
// --- Key custody ---------------------------------------------------------------------------
function keyDirOf(flags) {
    const flag = flags["--key-dir"];
    if (typeof flag === "string" && flag !== "")
        return flag;
    return process.env.COMMISSAIRE_KEY_DIR || path.join(os.homedir(), ".local", "state", "commissaire");
}
function parseKeyFile(raw) {
    if (!isRecord(raw))
        return null;
    const { sk, pk, pk_fingerprint, root_secret, created_at, prior_fingerprints } = raw;
    if (typeof sk !== "string" || typeof pk !== "string" || typeof pk_fingerprint !== "string" || typeof root_secret !== "string" || typeof created_at !== "string")
        return null;
    if (!Array.isArray(prior_fingerprints) || !prior_fingerprints.every((f) => typeof f === "string"))
        return null;
    if (!/^[0-9a-f]{64}$/.test(root_secret))
        return null;
    return { sk, pk, pk_fingerprint, root_secret, created_at, prior_fingerprints };
}
const modeOf = (p) => fs.statSync(p).mode & 0o777;
// The key file is read only when the directory is 0700 and the file 0600: a looser mode means another
// user could have read (or replaced) the signing key, so the governor refuses rather than serve.
function loadKeyFile(keyDir) {
    const keyFile = path.join(keyDir, KEY_FILE_NAME);
    if (modeOf(keyDir) !== 0o700)
        return { ok: false, error: `${keyDir} is mode ${modeOf(keyDir).toString(8)}, want 700` };
    if (modeOf(keyFile) !== 0o600)
        return { ok: false, error: `${keyFile} is mode ${modeOf(keyFile).toString(8)}, want 600` };
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(keyFile, "utf8"));
    }
    catch {
        return { ok: false, error: `${keyFile} is not valid JSON` };
    }
    const key = parseKeyFile(raw);
    return key ? { ok: true, key } : { ok: false, error: `${keyFile} is missing key material` };
}
function mintKeyFile(keyDir) {
    const keyFile = path.join(keyDir, KEY_FILE_NAME);
    const kp = producerAuth.mintGovernorKeypair();
    const key = {
        sk: kp.sk, pk: kp.pk, pk_fingerprint: kp.pk_fingerprint,
        root_secret: crypto.randomBytes(32).toString("hex"),
        created_at: new Date().toISOString(), prior_fingerprints: [],
    };
    ensureOwnerOnlyDir(keyDir);
    writeOwnerOnlyJson(keyFile, key);
}
function openState(keyDir) {
    if (!fs.existsSync(path.join(keyDir, KEY_FILE_NAME)))
        mintKeyFile(keyDir);
    const loaded = loadKeyFile(keyDir);
    if (!loaded.ok)
        return loaded;
    const { key } = loaded;
    return {
        ok: true,
        state: {
            sk: key.sk, pk: key.pk, pk_fingerprint: key.pk_fingerprint,
            root_secret: Buffer.from(key.root_secret, "hex"),
            logPath: path.join(keyDir, LOG_FILE_NAME),
            keyFile: path.resolve(keyDir, KEY_FILE_NAME),
            lastHead: new Map(), admissions: new Map(),
        },
    };
}
const RUNNER_CHECK_KEYS = ["schema", "runner_user", "runner_uid", "platform", "socket_group", "docker_group", "sudo_rules", "sudo_absent", "admin_group", "independent", "checked_at", "install_version", "source_tag"];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const isUidList = (v) => Array.isArray(v) && v.every((u) => typeof u === "number" && Number.isInteger(u) && u >= 0);
const nonEmptyString = (v) => typeof v === "string" && v !== "";
function runnerChecksProblem(rc) {
    if (!isRecord(rc))
        return "runner_checks must be an object";
    const keys = Object.keys(rc);
    const missing = RUNNER_CHECK_KEYS.filter((k) => !keys.includes(k));
    if (missing.length > 0)
        return `runner_checks is missing ${missing.join(", ")}`;
    const extra = keys.filter((k) => !RUNNER_CHECK_KEYS.includes(k));
    if (extra.length > 0)
        return `runner_checks has unknown keys ${extra.join(", ")}`;
    if (rc.schema !== 1)
        return "runner_checks.schema must be 1";
    if (!nonEmptyString(rc.runner_user))
        return "runner_checks.runner_user must be a non-empty string";
    if (typeof rc.runner_uid !== "number" || !Number.isInteger(rc.runner_uid) || rc.runner_uid < 0)
        return "runner_checks.runner_uid must be a non-negative integer";
    if (rc.platform !== "linux" && rc.platform !== "macos")
        return "runner_checks.platform must be linux or macos";
    if (!nonEmptyString(rc.socket_group))
        return "runner_checks.socket_group must be a non-empty string";
    for (const k of ["docker_group", "sudo_rules", "sudo_absent", "independent"]) {
        if (typeof rc[k] !== "boolean")
            return `runner_checks.${k} must be a boolean`;
    }
    if (rc.admin_group !== null && typeof rc.admin_group !== "boolean")
        return "runner_checks.admin_group must be a boolean or null";
    if (typeof rc.checked_at !== "string" || !ISO_UTC.test(rc.checked_at))
        return "runner_checks.checked_at must be an ISO-8601 UTC timestamp";
    if (!nonEmptyString(rc.install_version))
        return "runner_checks.install_version must be a non-empty string";
    if (!nonEmptyString(rc.source_tag))
        return "runner_checks.source_tag must be a non-empty string";
    if (rc.sudo_absent === true && rc.sudo_rules !== false)
        return "runner_checks.sudo_absent true requires sudo_rules false";
    if (rc.platform === "linux" && rc.admin_group !== null)
        return "runner_checks.admin_group must be null on linux";
    if (rc.independent !== (rc.sudo_rules !== true && rc.docker_group !== true && rc.admin_group !== true))
        return "runner_checks.independent contradicts sudo_rules, docker_group and admin_group";
    return null;
}
function parseGovernorConfig(raw) {
    if (!isRecord(raw))
        return { ok: false, error: "must be a JSON object" };
    const allow = raw.allow_uids === undefined ? [] : raw.allow_uids;
    if (!isUidList(allow))
        return { ok: false, error: "allow_uids must be an array of non-negative integers" };
    const admin = raw.admin_uids === undefined ? [] : raw.admin_uids;
    if (!isUidList(admin))
        return { ok: false, error: "admin_uids must be an array of non-negative integers" };
    const shared = admin.filter((u) => allow.includes(u));
    if (shared.length > 0)
        return { ok: false, error: `admin_uids and allow_uids both list uid ${shared.join(", ")}; a uid has exactly one role` };
    const config = { allow_uids: allow, admin_uids: admin };
    if (raw.runner_checks !== undefined) {
        const problem = runnerChecksProblem(raw.runner_checks);
        if (problem !== null)
            return { ok: false, error: problem };
        if (isRecord(raw.runner_checks))
            config.runner_checks = raw.runner_checks;
    }
    return { ok: true, config };
}
function loadGovernorConfig(keyDir) {
    const configFile = path.join(keyDir, CONFIG_FILE_NAME);
    if (modeOf(keyDir) !== 0o700)
        return { ok: false, error: `${keyDir} is mode ${modeOf(keyDir).toString(8)}, want 700` };
    if (!fs.existsSync(configFile))
        return { ok: true, config: { allow_uids: [], admin_uids: [] } };
    if (modeOf(configFile) !== 0o600)
        return { ok: false, error: `${configFile} is mode ${modeOf(configFile).toString(8)}, want 600` };
    let stat;
    try {
        stat = fs.statSync(configFile);
    }
    catch {
        return { ok: false, error: `${configFile} is unreadable` };
    }
    const myUid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (myUid !== undefined && stat.uid !== myUid) {
        return { ok: false, error: `${configFile} is owned by uid ${stat.uid}, want ${myUid} (the governor's own user)` };
    }
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(configFile, "utf8"));
    }
    catch {
        return { ok: false, error: `${configFile} is not valid JSON` };
    }
    const parsed = parseGovernorConfig(raw);
    return parsed.ok ? parsed : { ok: false, error: `${configFile} ${parsed.error}` };
}
function rotateKeyFile(keyDir) {
    if (!fs.existsSync(path.join(keyDir, KEY_FILE_NAME)))
        return { ok: false, error: `no governor key in ${keyDir} (run \`governor start\` first)` };
    const loaded = loadKeyFile(keyDir);
    if (!loaded.ok)
        return loaded;
    const { key } = loaded;
    const kp = producerAuth.mintGovernorKeypair();
    writeOwnerOnlyJson(path.join(keyDir, KEY_FILE_NAME), {
        ...key, sk: kp.sk, pk: kp.pk, pk_fingerprint: kp.pk_fingerprint,
        prior_fingerprints: [...key.prior_fingerprints, key.pk_fingerprint],
    });
    return { ok: true, prior: key.pk_fingerprint, current: kp.pk_fingerprint };
}
// --- Records ------------------------------------------------------------------------------
function signedByGovernor(state, runId, at, producerId, contractRevision, body) {
    const rec = producerAuth.buildEnvelope(runId, at.seq, at.prev, "commissaire", producerId, contractRevision, body);
    rec.commissaire_sig = producerAuth.signDecision(rec, state.sk);
    return rec;
}
const admissionKey = (runId, producerId) => `${runId}\u0000${producerId}`;
const runMasterOf = (state, runId) => producerAuth.deriveRunMaster(state.root_secret, runId);
// --- Ledger acceptance: chain verify (1) and head extension (2) ------------------------------
function chainInvalid(detail, seq) {
    return { ok: false, reply: refuse("chain-invalid", seq === undefined ? { detail } : { detail, seq }) };
}
// The ledger arrives as the raw NDJSON bytes the runner holds: the chain walk, the head and the next
// `prev` all hash physical-line bytes, so a parse-then-restringify round trip is never trusted.
function verifyLedger(state, runId, ledgerText) {
    const buf = Buffer.from(ledgerText, "utf8");
    const walk = walkPhysicalChain(buf);
    if (walk.status !== "verified" || walk.torn_tail || walk.line_count === 0)
        return chainInvalid(walk.detail ?? `ledger walk ${walk.status}`);
    const lines = splitPhysicalLines(buf).lines;
    const records = [];
    const master = runMasterOf(state, runId);
    for (let i = 0; i < lines.length; i++) {
        const rec = walk.records[i];
        if (!isRecord(rec))
            return chainInvalid("a ledger line is not a record", i);
        if (rec.schema !== 3 || rec.run_id !== runId || rec.seq !== i)
            return chainInvalid("record is not schema 3 of this run at its line position", i);
        if (rec.author === "producer") {
            const key = producerAuth.deriveKey(master, str(rec.producer_id), str(rec.contract_revision));
            if (!producerAuth.verifyRecord(rec, key))
                return chainInvalid("producer HMAC does not verify", i);
        }
        else if (rec.author === "commissaire") {
            if (!producerAuth.verifyDecision(rec, state.pk))
                return chainInvalid("commissaire signature does not verify", i);
        }
        else {
            return chainInvalid("record author is neither producer nor commissaire", i);
        }
        records.push(rec);
    }
    const lastLine = lines[lines.length - 1];
    if (lastLine === undefined)
        return chainInvalid("empty ledger");
    const head = { seq: records.length - 1, head_hash: sha256Hex(lastLine) };
    return { ok: true, view: { records, lines, head, next: { seq: records.length, prev: head.head_hash } } };
}
// lastHead advances only from the verified INCOMING head, never from a position the governor signed:
// a raced verdict can be an orphan the runner never appends.
function requireExtendsLastHead(state, runId, view) {
    const prior = state.lastHead.get(runId);
    if (prior !== undefined) {
        const priorLine = view.lines[prior.seq];
        if (view.head.seq < prior.seq || priorLine === undefined || sha256Hex(priorLine) !== prior.head_hash) {
            return refuse("ledger-not-extending-head");
        }
    }
    state.lastHead.set(runId, view.head);
    return null;
}
function acceptLedger(state, runId, ledgerText) {
    const verified = verifyLedger(state, runId, ledgerText);
    if (!verified.ok)
        return verified;
    const refusal = requireExtendsLastHead(state, runId, verified.view);
    return refusal ? { ok: false, reply: refusal } : verified;
}
const positionMatches = (view, at) => at.seq === view.next.seq && at.prev === view.next.prev;
// --- admit ------------------------------------------------------------------------------
// runner_checks is the install-time snapshot, copied verbatim; a governor started without one emits the
// payload it always has.
function admissionPayload(state, producerId, revision, scope) {
    const payload = { producer_id: producerId, contract_revision: revision, admitted_scope: scope, pk_fingerprint: state.pk_fingerprint, admitted_at: new Date().toISOString(), custody: "governor" };
    if (state.runnerChecks !== undefined)
        payload.runner_checks = state.runnerChecks;
    return payload;
}
function handleAdmit(state, req) {
    const runId = ids.parseRunId(req.run_id), producerId = ids.parseProducerId(req.producer_id), revision = ids.parseContractRevisionId(req.contract_revision);
    const scope = req.admitted_scope;
    if (!runId.ok || !producerId.ok || !revision.ok)
        return refuse("malformed-request");
    if (!Array.isArray(scope) || !scope.every((k) => typeof k === "string"))
        return refuse("malformed-request");
    const key = producerAuth.admitProducerKey(runMasterOf(state, runId.value), producerId.value, revision.value);
    const record = signedByGovernor(state, runId.value, { seq: 0, prev: sha256Hex(Buffer.from(runId.value, "utf8")) }, producerId.value, revision.value, {
        kind_of_entry: "admission", unit_id: "-", step: "admit",
        payload: admissionPayload(state, producerId.value, revision.value, scope),
    });
    state.admissions.set(admissionKey(runId.value, producerId.value), {
        producer_id: producerId.value, contract_revision: revision.value, admitted_scope: scope, pk_fingerprint: state.pk_fingerprint, status: "admitted",
    });
    return {
        ok: true, custody: "governor", producer_id: producerId.value, k_producer_hex: key.toString("hex"),
        pk: state.pk, pk_fingerprint: state.pk_fingerprint, admitted_scope: scope, admission_record: record,
    };
}
// --- authorize ----------------------------------------------------------------------------
const CROSS_CHECKED_FIELDS = ["effect", "declared_ref", "evidence_seq", "level", "attended", "holdout"];
function handleAuthorize(state, req) {
    const runId = ids.parseRunId(req.run_id), producerId = ids.parseProducerId(req.producer_id), unitId = ids.parseUnitId(req.unit_id);
    const step = str(req.step), at = parsePosition(req.at), ledgerText = str(req.ledger);
    if (!runId.ok || !producerId.ok || !unitId.ok || step === undefined || at === null || ledgerText === undefined)
        return refuse("malformed-request");
    const admission = state.admissions.get(admissionKey(runId.value, producerId.value));
    if (!admission)
        return refuse("producer-not-admitted");
    const accepted = acceptLedger(state, runId.value, ledgerText);
    if (!accepted.ok)
        return accepted.reply;
    const { view } = accepted;
    if (!positionMatches(view, at))
        return refuse("position-mismatch");
    const wantSeq = num(req.request_seq);
    const requests = view.records.filter((r) => r.kind_of_entry === "effect-decision-request" && r.author === "producer" && r.producer_id === producerId.value
        && matchesUnit(r, unitId.value) && r.step === step && (wantSeq === undefined || r.seq === wantSeq));
    const requestRecord = requests[requests.length - 1];
    if (requestRecord === undefined)
        return refuse("assurance-floor", { detail: "no effect-decision-request in the verified ledger" });
    const payload = isRecord(requestRecord.payload) ? requestRecord.payload : {};
    for (const field of CROSS_CHECKED_FIELDS) {
        if (req[field] !== undefined && producerAuth.canonicalStringify(req[field]) !== producerAuth.canonicalStringify(payload[field])) {
            return refuse("request-payload-mismatch", { field });
        }
    }
    const key = producerAuth.deriveKey(runMasterOf(state, runId.value), producerId.value, admission.contract_revision);
    const { level, attended, holdout } = payload;
    const pure = evaluateDecisionRequest(admission, requestRecord, key, view.records);
    const levelPolicy = evaluateLevelPolicy({ level, attended, holdout });
    const composed = composeDecision(pure, levelPolicy);
    const verdictPayload = { request_seq: requestRecord.seq, verdict: composed.verdict, reason: composed.reason, effect: payload.effect, level, attended, holdout };
    if (level != null) {
        verdictPayload.level_policy = levelPolicy;
        verdictPayload.pure_verdict = pure.verdict;
        verdictPayload.pure_reason = pure.reason;
    }
    const verdictRecord = signedByGovernor(state, runId.value, at, producerId.value, admission.contract_revision, {
        kind_of_entry: "effect-decision-verdict", unit_id: unitId.value, step, payload: verdictPayload,
    });
    return { ok: true, verdict: composed.verdict, reason: composed.reason, verdict_record: verdictRecord };
}
// --- conclude -----------------------------------------------------------------------------
function refusedConclusion(reason, detail = {}) {
    return { ok: false, verdict: "refused", reason, ...detail };
}
const withUnitId = (escapes) => escapes.map((e) => ({ ...e, unit_id: e.issue }));
function handleConclude(state, req) {
    const runId = ids.parseRunId(req.run_id), unitId = ids.parseUnitId(req.unit_id);
    const at = parsePosition(req.at), ledgerText = str(req.ledger), explicitProducer = req.producer_id;
    if (!runId.ok || !unitId.ok || at === null || ledgerText === undefined)
        return refuse("malformed-request");
    const accepted = acceptLedger(state, runId.value, ledgerText);
    if (!accepted.ok)
        return accepted.reply;
    const { view } = accepted;
    const unit = unitId.value;
    const entries = view.records.filter((e) => matchesUnit(e, unit));
    if (entries.length === 0)
        return refusedConclusion("no-evidence");
    const existing = entries.find((e) => conclusionKindOf(e) !== null && e.author === "commissaire");
    if (existing)
        return { ok: true, verdict: CONCLUSION_KIND, kind_of_entry: conclusionKindOf(existing), idempotent: true, record: existing };
    if (!positionMatches(view, at))
        return refuse("position-mismatch");
    const producerIds = [...new Set(entries.map((e) => str(e.producer_id)).filter((x) => x !== undefined && x !== "-"))];
    let producerId;
    if (explicitProducer !== undefined) {
        const wanted = ids.parseProducerId(explicitProducer);
        if (!wanted.ok || !producerIds.includes(wanted.value))
            return refusedConclusion("no-evidence", { producer_id: explicitProducer });
        producerId = wanted.value;
    }
    else if (producerIds.length === 1 && producerIds[0] !== undefined) {
        producerId = producerIds[0];
    }
    else {
        return refusedConclusion("ambiguous-producer", { producers: producerIds });
    }
    const admission = state.admissions.get(admissionKey(runId.value, producerId));
    if (!admission)
        return refusedConclusion("producer-not-admitted", { producer_id: producerId });
    const escapeResult = computeEscapes(view.records, unit);
    if (escapeResult.any_escape)
        return refusedConclusion("unreconciled-escape", { escapes: withUnitId(escapeResult.escapes) });
    if (admission.pk_fingerprint !== state.pk_fingerprint) {
        return refusedConclusion("pk-fingerprint-mismatch", { producer_id: producerId, producer_pk_fingerprint: admission.pk_fingerprint, governor_pk_fingerprint: state.pk_fingerprint });
    }
    const observedProtected = view.records.filter((e) => e.kind_of_entry === "observe" && matchesUnit(e, unit) && isRecord(e.effect) && isProtectedKind(e.effect.kind));
    if (observedProtected.length > 0) {
        const coverage = grantCoverage(view.records, unit, state.pk, state.pk_fingerprint);
        if (!coverage.covered)
            return refusedConclusion("ungranted-protected-effect", { uncovered: coverage.uncovered });
    }
    const revisions = [...new Set(entries.map((e) => str(e.contract_revision)).filter((x) => x !== undefined))];
    if (revisions.length > 1)
        return refusedConclusion("ambiguous-contract-revision", { contract_revisions: revisions.slice().sort() });
    const concludedRevision = revisions[0] ?? admission.contract_revision;
    const seqs = entries.map((e) => num(e.seq)).filter((s) => s !== undefined && Number.isInteger(s));
    const record = signedByGovernor(state, runId.value, at, producerId, concludedRevision, {
        kind_of_entry: CONCLUSION_KIND, unit_id: unit, step: "conclude",
        payload: { producer_id: producerId, contract_revision: concludedRevision, evidence_seq_range: [Math.min(...seqs), Math.max(...seqs)], escapes_checked: true },
    });
    return { ok: true, verdict: CONCLUSION_KIND, kind_of_entry: CONCLUSION_KIND, record };
}
// --- dispatch and the governor's own log ----------------------------------------------------
// One line per request, signed verdicts (orphans the runner never appends included) in `signed_record`.
// The governor is the log's sole writer and appendFileSync is synchronous, so appends are serialised.
// The log never feeds lastHead.
function appendLog(state, request, reply, peerUid, role) {
    const { ledger, ...summary } = request;
    const signed = [reply.verdict_record, reply.record, reply.admission_record].find(isRecord);
    const line = {
        ts: new Date().toISOString(), op: request.op, run_id: request.run_id, unit_id: request.unit_id,
        peer_uid: peerUid === undefined ? null : peerUid,
        caller_role: role,
        request_summary: { ...summary, ledger_bytes: typeof ledger === "string" ? Buffer.byteLength(ledger, "utf8") : undefined },
        verdict: reply.ok === true ? reply.verdict : undefined,
        refusal: reply.ok === true ? undefined : reply.reason,
        signed_record: signed,
        appended_hint: signed ? { seq: signed.seq, prev: signed.prev } : undefined,
    };
    fs.appendFileSync(state.logPath, JSON.stringify(line) + "\n", { mode: 0o600 });
}
// A connection-level log line for a caller refused BEFORE its request is read (no request/reply to
// summarise, so appendLog does not fit). A failed uid read logs peer_uid null. Best-effort: a throw
// is swallowed rather than crashing the accept loop, since the socket is already being refused.
function appendConnectLog(state, entry) {
    const line = { ts: new Date().toISOString(), op: "connect", peer_uid: entry.peer_uid, refusal: entry.refusal };
    if (entry.error !== undefined)
        line.error = entry.error;
    try {
        fs.appendFileSync(state.logPath, JSON.stringify(line) + "\n", { mode: 0o600 });
    }
    catch {
        /* best-effort — never crash the accept loop on a log append */
    }
}
// FAFF-1217: the read-only key lookup `commissaire governor pin|status` makes. Answered on the Unix
// listener only (a caller carries a role there); the unauthenticated TCP listener never discloses the
// key path or the runner checks record. It writes no admission and mints no run state.
function handleIdentify(state, role) {
    if (role === undefined)
        return refuse("op-unix-only");
    return { ok: true, pk: state.pk, pk_fingerprint: state.pk_fingerprint, key_file: state.keyFile, runner_checks: state.runnerChecks ?? null };
}
function dispatchOp(state, request, role) {
    switch (request.op) {
        case "identify": return handleIdentify(state, role);
        case "admit": return handleAdmit(state, request);
        case "authorize": return handleAuthorize(state, request);
        case "conclude": return handleConclude(state, request);
        default: return refuse("unknown-op");
    }
}
// The selftest seam: a request in, a reply out, no socket involved. peerUid is the kernel-read uid of
// the allowed caller when the request arrived over the guarded Unix socket (stamped on the log line);
// it is undefined on the socket-less selftest path.
// The role check runs before dispatchOp: an admin caller never reaches an operation that signs, so
// nothing it sends is written to governor state.
function handleRequest(state, request, peerUid, role) {
    if (!isRecord(request))
        return refuse("malformed-request");
    const permitted = role !== "admin" || (typeof request.op === "string" && ADMIN_OPS.has(request.op));
    const reply = permitted ? dispatchOp(state, request, role) : refuse("op-not-permitted-for-admin", { op: request.op });
    try {
        appendLog(state, request, reply, peerUid, role);
    }
    catch {
        return refuse("governor-log-failed");
    }
    return reply;
}
// --- Server ------------------------------------------------------------------------------
function answer(state, socket, raw, peerUid, role) {
    let reply;
    try {
        reply = handleRequest(state, JSON.parse(raw), peerUid, role);
    }
    catch (e) {
        reply = e instanceof SyntaxError ? refuse("malformed-request") : refuse("internal-error");
    }
    socket.end(JSON.stringify(reply) + "\n");
}
function onConnection(state, socket, peerUid, role) {
    let buffered = "";
    let answered = false;
    const answerOnce = (raw) => { if (!answered) {
        answered = true;
        answer(state, socket, raw, peerUid, role);
    } };
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
        if (answered)
            return;
        buffered += chunk;
        if (buffered.length > MAX_REQUEST_CHARS) {
            answered = true;
            socket.end(JSON.stringify(refuse("request-too-large")) + "\n");
            return;
        }
        const newline = buffered.indexOf("\n");
        if (newline !== -1)
            answerOnce(buffered.slice(0, newline));
    });
    socket.on("end", () => { if (buffered.trim() !== "")
        answerOnce(buffered); });
    socket.on("error", () => socket.destroy());
}
function makeConnectionBounds(state, now = Date.now) {
    let tokens = SPAWN_BURST;
    let lastRefill = now();
    let window = Math.floor(lastRefill / WINDOW_MS);
    let spawnLimited = 0;
    let refusalLines = 0;
    let suppressed = 0;
    const summary = (event, count, closed) => {
        appendEventLog(state, { event, count, window_start: new Date(closed * WINDOW_MS).toISOString(), window_end: new Date((closed + 1) * WINDOW_MS).toISOString() });
    };
    const roll = () => {
        const current = Math.floor(now() / WINDOW_MS);
        if (current === window)
            return;
        if (spawnLimited > 0)
            summary("spawn-limited", spawnLimited, window);
        if (suppressed > 0)
            summary("refusals-suppressed", suppressed, window);
        window = current;
        spawnLimited = 0;
        refusalLines = 0;
        suppressed = 0;
    };
    return {
        allowSpawn() {
            roll();
            const t = now();
            tokens = Math.min(SPAWN_BURST, tokens + Math.max(0, t - lastRefill) * SPAWN_REFILL_PER_MS);
            lastRefill = t;
            if (tokens < 1) {
                spawnLimited++;
                return false;
            }
            tokens -= 1;
            return true;
        },
        allowRefusalLine() {
            roll();
            if (refusalLines >= MAX_REFUSAL_LINES_PER_MINUTE) {
                suppressed++;
                return false;
            }
            refusalLines++;
            return true;
        },
        flush: roll,
    };
}
function appendEventLog(state, entry) {
    try {
        fs.appendFileSync(state.logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", { mode: 0o600 });
    }
    catch {
        /* best-effort — never crash the accept loop on a log append */
    }
}
// The Unix-listener guard (FAFF-1211). Reads the peer uid synchronously — before any `data` listener
// attaches, so no request bytes can arrive before the decision (net does not flow a socket until a
// data listener is attached). A caller whose uid cannot be read, or whose uid has no role, is refused
// here and never reaches onConnection / handleRequest. The check is independent of the socket's file
// mode: even a socket widened past 0600 is still gated by the uid. An allowed caller carries its uid and
// role forward so every accepted request's log line is stamped with them. With `bounds`, a connection
// over the spawn cap is closed before the helper is spawned.
function guardUnixConnection(state, callers, reader, socket, bounds) {
    // A refused caller is handled before onConnection attaches its own error handler, so attach one
    // first: a refused peer that resets the connection (the socket.end write fails ECONNRESET/EPIPE)
    // would otherwise emit an unhandled 'error' and crash the single-runner governor — a trivial DoS
    // from exactly the untrusted callers this guard exists to refuse.
    socket.on("error", () => socket.destroy());
    if (bounds !== undefined && !bounds.allowSpawn()) {
        socket.destroy();
        return;
    }
    const logRefusal = (entry) => {
        if (bounds === undefined || bounds.allowRefusalLine())
            appendConnectLog(state, entry);
    };
    const result = reader.readPeerUid(socket);
    if (!result.ok) {
        logRefusal({ peer_uid: null, refusal: "peer-credentials-unreadable", error: result.error });
        socket.end(JSON.stringify({ ok: false, reason: "peer-credentials-unreadable" }) + "\n");
        return;
    }
    const role = callers.get(result.uid);
    if (role === undefined) {
        logRefusal({ peer_uid: result.uid, refusal: "caller-not-allowed" });
        socket.end(JSON.stringify({ ok: false, reason: "caller-not-allowed", peer: { uid: result.uid } }) + "\n");
        return;
    }
    onConnection(state, socket, result.uid, role);
}
const MAPPED_V4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
function normaliseAddress(address) {
    const bare = address.replace(/%.*$/, "");
    const mapped = MAPPED_V4.exec(bare);
    if (mapped !== null && mapped[1] !== undefined)
        return mapped[1];
    if (net.isIPv6(bare)) {
        try {
            return new URL(`http://[${bare}]/`).hostname.slice(1, -1);
        }
        catch {
            return bare.toLowerCase();
        }
    }
    return bare;
}
const systemResolver = async (name) => {
    const found = await require("node:dns").promises.lookup(name, { all: true });
    return found.map((f) => f.address);
};
function makeSourceAllowList(target, resolver, now) {
    const literal = net.isIP(target) !== 0 ? normaliseAddress(target) : null;
    let cache = null;
    let lastForced = Number.NEGATIVE_INFINITY;
    let inflight = null;
    const lookup = () => {
        inflight ??= resolver(target).then((list) => { cache = { addresses: new Set(list.map(normaliseAddress)), at: now() }; return cache.addresses; }, () => { cache = null; return null; }).finally(() => { inflight = null; });
        return inflight;
    };
    return async (source) => {
        if (source === undefined)
            return false;
        const from = normaliseAddress(source);
        if (literal !== null)
            return from === literal;
        const fresh = cache !== null && now() - cache.at < DNS_CACHE_MS;
        const addresses = fresh && cache !== null ? cache.addresses : await lookup();
        if (addresses === null)
            return false;
        if (addresses.has(from))
            return true;
        if (fresh && now() - lastForced >= FORCED_RESOLVE_MIN_GAP_MS) {
            lastForced = now();
            return (await lookup())?.has(from) ?? false;
        }
        return false;
    };
}
function guardTcpConnection(state, allowed, bounds, socket) {
    socket.on("error", () => socket.destroy());
    const source = socket.remoteAddress;
    allowed(source).then((ok) => {
        if (ok) {
            onConnection(state, socket);
            return;
        }
        if (bounds.allowRefusalLine())
            appendEventLog(state, { op: "tcp-refused", source: source === undefined ? null : normaliseAddress(source) });
        socket.destroy();
    }, () => socket.destroy());
}
const isLoopbackHost = (host) => host === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(host) || normaliseAddress(host) === "::1";
const HOSTNAME_OR_IP = /^[A-Za-z0-9._:-]+$/;
function parseListen(spec) {
    const at = spec.lastIndexOf(":");
    const port = Number(spec.slice(at + 1));
    const host = spec.slice(0, at);
    return at > 0 && Number.isInteger(port) && port > 0 && port < 65536 ? { host, port } : null;
}
function governorStart(flags, deps = {}) {
    const keyDir = keyDirOf(flags);
    const opened = openState(keyDir);
    if (!opened.ok) {
        process.stderr.write(`faff commissaire governor start: ${opened.error}\n`);
        return 2;
    }
    const { state } = opened;
    const configLoaded = loadGovernorConfig(keyDir);
    if (!configLoaded.ok) {
        process.stderr.write(`faff commissaire governor start: ${configLoaded.error}\n`);
        return 2;
    }
    const callers = new Map();
    for (const uid of configLoaded.config.allow_uids)
        callers.set(uid, "runner");
    for (const uid of configLoaded.config.admin_uids)
        callers.set(uid, "admin");
    if (configLoaded.config.runner_checks !== undefined)
        state.runnerChecks = configLoaded.config.runner_checks;
    const groupAccess = flags["--socket-group-access"] === true;
    const bounds = groupAccess ? makeConnectionBounds(state) : undefined;
    const reader = makePeerCredReader();
    // Start-time interpreter probe: without a trusted python3 the governor would bind, print `listening`,
    // then silently refuse every Unix caller `peer-credentials-unreadable`. Surface it loudly instead.
    if (resolveTrustedInterpreter() === null) {
        process.stderr.write(`faff commissaire governor start: WARNING no trusted python3 interpreter at ${TRUSTED_PYTHON_PATHS.join(", ")}; every Unix caller will be refused peer-credentials-unreadable\n`);
        try {
            fs.appendFileSync(path.join(keyDir, LOG_FILE_NAME), JSON.stringify({ ts: new Date().toISOString(), op: "start", warning: "interpreter-missing", trusted_paths: TRUSTED_PYTHON_PATHS }) + "\n", { mode: 0o600 });
        }
        catch { /* best-effort start-time record */ }
    }
    const socketFlag = flags["--socket"];
    const socketPath = typeof socketFlag === "string" && socketFlag !== "" ? socketFlag : path.join(keyDir, SOCKET_FILE_NAME);
    const listenFlag = flags["--listen"];
    const listen = typeof listenFlag === "string" ? parseListen(listenFlag) : null;
    if (typeof listenFlag === "string" && listen === null) {
        process.stderr.write("faff commissaire governor start: --listen must be host:port\n");
        return 2;
    }
    const allowFlag = flags["--listen-allow-dns"];
    const unrestricted = flags["--listen-unrestricted"] === true;
    const allowDns = typeof allowFlag === "string" && allowFlag !== "" ? allowFlag : null;
    if ("--listen-allow-dns" in flags && (allowDns === null || !HOSTNAME_OR_IP.test(allowDns))) {
        process.stderr.write("faff commissaire governor start: --listen-allow-dns needs a DNS name or an IP address\n");
        return 2;
    }
    if (listen === null && (allowDns !== null || unrestricted)) {
        process.stderr.write("faff commissaire governor start: --listen-allow-dns and --listen-unrestricted apply only with --listen\n");
        return 2;
    }
    if (listen !== null && allowDns === null && !unrestricted && !isLoopbackHost(listen.host)) {
        process.stderr.write("faff commissaire governor start: --listen on a non-loopback address needs --listen-allow-dns <runner-app>.internal (or --listen-unrestricted)\n");
        return 2;
    }
    try {
        if (fs.lstatSync(socketPath).isSocket())
            fs.unlinkSync(socketPath);
    }
    catch { /* no stale socket to clear */ }
    const servers = [];
    const stop = () => { for (const s of servers)
        s.close(); try {
        fs.unlinkSync(socketPath);
    }
    catch { /* already gone */ } };
    const make = (connectionListener) => {
        const server = net.createServer({ allowHalfOpen: true }, connectionListener);
        server.on("error", (e) => { process.stderr.write(`faff commissaire governor start: ${e.message}\n`); process.exitCode = 1; stop(); });
        servers.push(server);
        return server;
    };
    // The Unix listener is guarded by the peer-credential check. The optional TCP listener has no
    // SO_PEERCRED: it is source-address checked with --listen-allow-dns, and otherwise runs unchecked
    // (loopback only, or an explicit --listen-unrestricted that leaves one log line).
    make((socket) => guardUnixConnection(state, callers, reader, socket, bounds)).listen(socketPath, () => {
        fs.chmodSync(socketPath, groupAccess ? 0o660 : 0o600);
        console.log(JSON.stringify({ listening: { socket: socketPath }, pk_fingerprint: state.pk_fingerprint }));
    });
    let tcpBounds;
    if (listen) {
        let connectionListener = (socket) => onConnection(state, socket);
        if (allowDns !== null) {
            const now = deps.now ?? Date.now;
            const allowed = makeSourceAllowList(allowDns, deps.resolver ?? systemResolver, now);
            tcpBounds = makeConnectionBounds(state, now);
            const refusals = tcpBounds;
            connectionListener = (socket) => guardTcpConnection(state, allowed, refusals, socket);
        }
        else if (!isLoopbackHost(listen.host)) {
            appendEventLog(state, { op: "tcp-unrestricted", listen: `${listen.host}:${listen.port}` });
        }
        make(connectionListener).listen(listen.port, listen.host, () => console.log(JSON.stringify({ listening: { tcp: `${listen.host}:${listen.port}` } })));
    }
    if (bounds !== undefined)
        setInterval(bounds.flush, 1000).unref();
    if (tcpBounds !== undefined)
        setInterval(tcpBounds.flush, 1000).unref();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return 0;
}
function governorRotate(flags) {
    const rotated = rotateKeyFile(keyDirOf(flags));
    if (!rotated.ok) {
        process.stderr.write(`faff commissaire governor rotate: ${rotated.error}\n`);
        return 2;
    }
    console.log(JSON.stringify({ rotated: true, pk_fingerprint: rotated.current, prior_fingerprint: rotated.prior }));
    return 0;
}
const MERGE_MAIN = { kind: "merge", target: "main", reversible: true };
function governorSelftest() {
    let failed = 0;
    const fail = (m) => { process.stderr.write(`governor selftest FAIL: ${m}\n`); failed++; };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-governor-"));
    try {
        const keyDir = path.join(tmp, "keys");
        const opened = openState(keyDir);
        if (!opened.ok) {
            fail(`first start: ${opened.error}`);
            return 1;
        }
        const { state } = opened;
        const keyFile = path.join(keyDir, KEY_FILE_NAME);
        if (modeOf(keyDir) !== 0o700)
            fail("first start: key dir is not mode 700");
        if (modeOf(keyFile) !== 0o600)
            fail("first start: key file is not mode 600");
        const stored = parseKeyFile(JSON.parse(fs.readFileSync(keyFile, "utf8")));
        if (!stored || stored.pk_fingerprint !== state.pk_fingerprint)
            fail("first start: key file holds sk, root secret and the fingerprint");
        const newRun = (runId, scope) => {
            const admitted = handleRequest(state, { op: "admit", run_id: runId, producer_id: "P1", contract_revision: "r1", admitted_scope: scope });
            if (admitted.ok !== true || admitted.custody !== "governor")
                fail(`${runId}: admit replies custody governor`);
            const lines = [JSON.stringify(admitted.admission_record)];
            const key = Buffer.from(str(admitted.k_producer_hex) ?? "", "hex");
            const at = () => ({ seq: lines.length, prev: sha256Hex(Buffer.from(lines[lines.length - 1] ?? runId, "utf8")) });
            const run = {
                runId, key, lines, at,
                text: () => lines.join("\n") + "\n",
                producer: (unit, step, kind, body, signKey = key) => {
                    const pos = at();
                    const rec = producerAuth.buildEnvelope(runId, pos.seq, pos.prev, "producer", "P1", "r1", { kind_of_entry: kind, unit_id: unit, step, ...body });
                    rec.producer_hmac = producerAuth.signRecord(rec, signKey);
                    lines.push(JSON.stringify(rec));
                },
                append: (record) => { lines.push(JSON.stringify(record)); },
                authorize: (unit, step, extra = {}) => handleRequest(state, {
                    op: "authorize", run_id: runId, producer_id: "P1", unit_id: unit, step, ledger: run.text(), at: at(), ...extra,
                }),
            };
            return run;
        };
        const requestOf = (effect, extra = {}) => ({ payload: { effect, ...extra } });
        const verdictOf = (reply) => (isRecord(reply.verdict_record) ? reply.verdict_record : {});
        const headOf = (runId) => state.lastHead.get(runId);
        // 1. grant
        const grant = newRun("RUN-GRANT", ["merge"]);
        grant.producer("FAFF-1", "merge", "declare", { effect: MERGE_MAIN });
        grant.producer("FAFF-1", "merge", "effect-decision-request", requestOf(MERGE_MAIN));
        const granted = grant.authorize("FAFF-1", "merge", { effect: MERGE_MAIN });
        if (granted.ok !== true || granted.verdict !== "grant")
            fail(`grant: covered request grants (got ${JSON.stringify(granted)})`);
        if (!producerAuth.verifyDecision(verdictOf(granted), state.pk))
            fail("grant: the verdict record verifies under the governor key");
        if (verdictOf(granted).seq !== grant.at().seq)
            fail("grant: the verdict is signed at the requested position");
        const missAt = grant.authorize("FAFF-1", "merge", { at: { seq: grant.at().seq + 1, prev: grant.at().prev } });
        if (missAt.reason !== "position-mismatch" || "verdict_record" in missAt)
            fail("position: a wrong seq is position-mismatch and signs nothing");
        // 2. deny
        const deny = newRun("RUN-DENY", ["merge"]);
        const deploy = { kind: "deploy", target: "prod", reversible: true };
        deny.producer("FAFF-2", "merge", "effect-decision-request", requestOf(deploy));
        const denied = deny.authorize("FAFF-2", "merge");
        if (denied.ok !== true || denied.verdict !== "deny" || denied.reason !== "effect-out-of-scope")
            fail(`deny: out-of-scope effect is a signed deny (got ${JSON.stringify(denied)})`);
        if (!producerAuth.verifyDecision(verdictOf(denied), state.pk))
            fail("deny: the deny verdict verifies");
        // 3. forged request
        const forged = newRun("RUN-FORGED", ["merge"]);
        forged.producer("FAFF-3", "merge", "declare", { effect: MERGE_MAIN });
        forged.producer("FAFF-3", "merge", "effect-decision-request", requestOf(MERGE_MAIN), producerAuth.deriveKey("not-the-master", "P1", "r1"));
        const forgedReply = forged.authorize("FAFF-3", "merge");
        if (forgedReply.ok !== false || forgedReply.reason !== "chain-invalid" || "verdict_record" in forgedReply)
            fail(`forged: a request HMAC that does not verify is chain-invalid (got ${JSON.stringify(forgedReply)})`);
        // 4. unadmitted producer
        const stranger = newRun("RUN-STRANGER", ["merge"]);
        const unadmitted = handleRequest(state, { op: "authorize", run_id: "RUN-NEVER", producer_id: "P1", unit_id: "FAFF-4", step: "merge", ledger: stranger.text(), at: stranger.at() });
        if (unadmitted.reason !== "producer-not-admitted")
            fail(`unadmitted: a never-admitted run is producer-not-admitted (got ${JSON.stringify(unadmitted)})`);
        // 5. stale evidence
        const stale = newRun("RUN-STALE", ["merge"]);
        stale.producer("FAFF-5", "merge", "declare", { effect: MERGE_MAIN });
        stale.producer("FAFF-5", "merge", "observe", { effect: MERGE_MAIN });
        stale.producer("FAFF-5", "merge", "effect-decision-request", requestOf(MERGE_MAIN, { evidence_seq: 1 }));
        const staleReply = stale.authorize("FAFF-5", "merge");
        if (staleReply.verdict !== "deny" || staleReply.reason !== "stale-evidence")
            fail(`stale: evidence older than the latest observe denies (got ${JSON.stringify(staleReply)})`);
        // 6. lost race: both lanes are signed at one position, the loser's verdict is an orphan, and the
        // loser's re-request on the ledger the winner extended is answered, not refused.
        const race = newRun("RUN-RACE", ["merge"]);
        race.producer("U-A", "merge", "declare", { effect: MERGE_MAIN });
        race.producer("U-B", "merge", "declare", { effect: MERGE_MAIN });
        race.producer("U-A", "merge", "effect-decision-request", requestOf(MERGE_MAIN));
        race.producer("U-B", "merge", "effect-decision-request", requestOf(MERGE_MAIN));
        const contested = race.at();
        const winner = race.authorize("U-A", "merge");
        const headAfterWinner = headOf("RUN-RACE");
        const orphan = race.authorize("U-B", "merge");
        const headAfterOrphan = headOf("RUN-RACE");
        if (winner.ok !== true || orphan.ok !== true)
            fail("race: both lanes are signed at the contested position");
        if (verdictOf(winner).seq !== contested.seq || verdictOf(orphan).seq !== contested.seq || verdictOf(orphan).prev !== contested.prev)
            fail("race: the orphan is signed at the same (seq, prev)");
        if (!headAfterWinner || headAfterOrphan?.seq !== headAfterWinner.seq || headAfterOrphan.head_hash !== headAfterWinner.head_hash)
            fail("race: lastHead stays the verified incoming head");
        if (headAfterWinner && headAfterWinner.seq !== contested.seq - 1)
            fail("race: lastHead was not advanced to the signed position");
        race.append(winner.verdict_record);
        const retried = race.authorize("U-B", "merge");
        if (retried.reason === "ledger-not-extending-head")
            fail("race: the loser's re-request is falsely refused ledger-not-extending-head");
        if (retried.ok !== true || retried.verdict !== "grant" || verdictOf(retried).seq !== contested.seq + 1)
            fail(`race: the loser re-requests at the new head and is signed (got ${JSON.stringify(retried)})`);
        // 7. truncated ledger
        const trunc = newRun("RUN-TRUNC", ["merge"]);
        trunc.producer("FAFF-7", "merge", "declare", { effect: MERGE_MAIN });
        trunc.producer("FAFF-7", "merge", "effect-decision-request", requestOf(MERGE_MAIN));
        if (trunc.authorize("FAFF-7", "merge").ok !== true)
            fail("truncated: the full ledger is accepted first");
        const full = trunc.lines.slice();
        trunc.lines.pop();
        const truncatedReply = trunc.authorize("FAFF-7", "merge");
        if (truncatedReply.reason !== "ledger-not-extending-head")
            fail(`truncated: a ledger below the stored head is refused (got ${JSON.stringify(truncatedReply)})`);
        trunc.lines.splice(0, trunc.lines.length, ...full);
        // conclude: a granted-and-observed merge concludes (and re-concludes idempotently); without the grant it is refused
        const conclude = (run) => handleRequest(state, { op: "conclude", run_id: run.runId, unit_id: "FAFF-8", ledger: run.text(), at: run.at() });
        const done = newRun("RUN-DONE", ["merge"]);
        done.producer("FAFF-8", "merge", "declare", { effect: MERGE_MAIN });
        done.producer("FAFF-8", "merge", "effect-decision-request", requestOf(MERGE_MAIN));
        done.append(done.authorize("FAFF-8", "merge").verdict_record);
        done.producer("FAFF-8", "merge", "observe", { effect: MERGE_MAIN });
        const concluded = conclude(done);
        const conclusion = isRecord(concluded.record) ? concluded.record : {};
        if (concluded.ok !== true || concluded.verdict !== CONCLUSION_KIND || !producerAuth.verifyDecision(conclusion, state.pk))
            fail(`conclude: a granted observed merge concludes (got ${JSON.stringify(concluded)})`);
        done.append(conclusion);
        if (conclude(done).idempotent !== true)
            fail("conclude: a repeat conclude returns the prior record");
        const ungrantedRun = newRun("RUN-UNGRANTED", ["merge"]);
        ungrantedRun.producer("FAFF-8", "merge", "declare", { effect: MERGE_MAIN });
        ungrantedRun.producer("FAFF-8", "merge", "observe", { effect: MERGE_MAIN });
        const ungranted = conclude(ungrantedRun);
        if (ungranted.ok !== false || ungranted.reason !== "ungranted-protected-effect")
            fail(`conclude: an observed merge with no grant is refused (got ${JSON.stringify(ungranted)})`);
        // admit/authorize/conclude each wrote their log lines
        const logOps = fs.readFileSync(state.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l).op);
        if (!logOps.includes("admit") || !logOps.includes("authorize"))
            fail("log: admit and authorize requests are logged");
        const orphanLogged = fs.readFileSync(state.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => isRecord(l.signed_record) && l.signed_record.seq === contested.seq && l.run_id === "RUN-RACE");
        if (orphanLogged.length !== 2)
            fail("log: the orphan verdict is logged beside the winner's");
        // rotate: new keypair, same root secret, prior fingerprint retained, modes kept
        const before = loadKeyFile(keyDir);
        const rotated = rotateKeyFile(keyDir);
        const after = loadKeyFile(keyDir);
        if (!before.ok || !rotated.ok || !after.ok)
            fail("rotate: the key file stays loadable");
        else {
            if (after.key.pk_fingerprint === before.key.pk_fingerprint)
                fail("rotate: mints a new keypair");
            if (after.key.root_secret !== before.key.root_secret)
                fail("rotate: leaves the root secret unchanged");
            if (!after.key.prior_fingerprints.includes(before.key.pk_fingerprint))
                fail("rotate: retains the prior fingerprint");
        }
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    if (failed)
        return 1;
    console.log("governor selftest: ok");
    return 0;
}
module.exports = { governorStart, governorRotate, handleRequest, governorSelftest, openState, loadGovernorConfig, parseGovernorConfig, guardUnixConnection, makeConnectionBounds, appendConnectLog, onConnection, makeSourceAllowList, ADMIN_OPS };
