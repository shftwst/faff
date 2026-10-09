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

import type { Server, Socket } from "node:net";
import type { ProducerAuthApi } from "./producer-auth";
import type { IdsApi } from "./ids";
import type { GovernedRecord } from "./decision-policy";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const producerAuth: ProducerAuthApi = require("./producer-auth");
const ids: IdsApi = require("./ids");
const { evaluateDecisionRequest, evaluateLevelPolicy, composeDecision, grantCoverage } = require("./decision-policy");
const { computeEscapes, matchesUnit, conclusionKindOf, isProtectedKind, CONCLUSION_KIND } = require("./effects");
const { sha256Hex, walkPhysicalChain, splitPhysicalLines } = require("./events");
const { ensureOwnerOnlyDir, writeOwnerOnlyJson } = require("./shared-infra");

type Json = { [k: string]: unknown };
type Position = { seq: number; prev: string };
type Head = { seq: number; head_hash: string };
type FlagBag = { [k: string]: string | boolean | undefined };
type EnvelopeBody = { kind_of_entry: string; unit_id: string; step: string; effect?: unknown; payload?: unknown };

interface RunAdmission {
  producer_id: string;
  contract_revision: string;
  admitted_scope: string[];
  pk_fingerprint: string;
  status: "admitted";
}

interface KeyFile {
  sk: string;
  pk: string;
  pk_fingerprint: string;
  root_secret: string;
  created_at: string;
  prior_fingerprints: string[];
}

export interface GovernorState {
  sk: string;
  pk: string;
  pk_fingerprint: string;
  root_secret: Buffer;
  logPath: string;
  lastHead: Map<string, Head>;
  admissions: Map<string, RunAdmission>;
}

type LedgerView = { records: GovernedRecord[]; lines: Buffer[]; head: Head; next: Position };
type Accepted = { ok: true; view: LedgerView } | { ok: false; reply: Json };

const KEY_FILE_NAME = "governor-key.json";
const SOCKET_FILE_NAME = "governor.sock";
const LOG_FILE_NAME = "governor-log.jsonl";
const MAX_REQUEST_CHARS = 64 * 1024 * 1024;

function isRecord(v: unknown): v is { [k: string]: unknown } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

const refuse = (reason: string, detail: Json = {}): Json => ({ ok: false, reason, ...detail });

function parsePosition(v: unknown): Position | null {
  if (!isRecord(v)) return null;
  const seq = num(v.seq), prev = str(v.prev);
  return seq !== undefined && Number.isInteger(seq) && seq >= 0 && prev !== undefined ? { seq, prev } : null;
}

// --- Key custody ---------------------------------------------------------------------------

function keyDirOf(flags: FlagBag): string {
  const flag = flags["--key-dir"];
  if (typeof flag === "string" && flag !== "") return flag;
  return process.env.COMMISSAIRE_KEY_DIR || path.join(os.homedir(), ".local", "state", "commissaire");
}

function parseKeyFile(raw: unknown): KeyFile | null {
  if (!isRecord(raw)) return null;
  const { sk, pk, pk_fingerprint, root_secret, created_at, prior_fingerprints } = raw;
  if (typeof sk !== "string" || typeof pk !== "string" || typeof pk_fingerprint !== "string" || typeof root_secret !== "string" || typeof created_at !== "string") return null;
  if (!Array.isArray(prior_fingerprints) || !prior_fingerprints.every((f): f is string => typeof f === "string")) return null;
  if (!/^[0-9a-f]{64}$/.test(root_secret)) return null;
  return { sk, pk, pk_fingerprint, root_secret, created_at, prior_fingerprints };
}

const modeOf = (p: string): number => fs.statSync(p).mode & 0o777;

// The key file is read only when the directory is 0700 and the file 0600: a looser mode means another
// user could have read (or replaced) the signing key, so the governor refuses rather than serve.
function loadKeyFile(keyDir: string): { ok: true; key: KeyFile } | { ok: false; error: string } {
  const keyFile = path.join(keyDir, KEY_FILE_NAME);
  if (modeOf(keyDir) !== 0o700) return { ok: false, error: `${keyDir} is mode ${modeOf(keyDir).toString(8)}, want 700` };
  if (modeOf(keyFile) !== 0o600) return { ok: false, error: `${keyFile} is mode ${modeOf(keyFile).toString(8)}, want 600` };
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(keyFile, "utf8")); } catch { return { ok: false, error: `${keyFile} is not valid JSON` }; }
  const key = parseKeyFile(raw);
  return key ? { ok: true, key } : { ok: false, error: `${keyFile} is missing key material` };
}

function mintKeyFile(keyDir: string): void {
  const keyFile = path.join(keyDir, KEY_FILE_NAME);
  const kp = producerAuth.mintGovernorKeypair();
  const key: KeyFile = {
    sk: kp.sk, pk: kp.pk, pk_fingerprint: kp.pk_fingerprint,
    root_secret: crypto.randomBytes(32).toString("hex"),
    created_at: new Date().toISOString(), prior_fingerprints: [],
  };
  ensureOwnerOnlyDir(keyDir);
  writeOwnerOnlyJson(keyFile, key);
}

function openState(keyDir: string): { ok: true; state: GovernorState } | { ok: false; error: string } {
  if (!fs.existsSync(path.join(keyDir, KEY_FILE_NAME))) mintKeyFile(keyDir);
  const loaded = loadKeyFile(keyDir);
  if (!loaded.ok) return loaded;
  const { key } = loaded;
  return {
    ok: true,
    state: {
      sk: key.sk, pk: key.pk, pk_fingerprint: key.pk_fingerprint,
      root_secret: Buffer.from(key.root_secret, "hex"),
      logPath: path.join(keyDir, LOG_FILE_NAME),
      lastHead: new Map(), admissions: new Map(),
    },
  };
}

function rotateKeyFile(keyDir: string): { ok: true; prior: string; current: string } | { ok: false; error: string } {
  if (!fs.existsSync(path.join(keyDir, KEY_FILE_NAME))) return { ok: false, error: `no governor key in ${keyDir} (run \`governor start\` first)` };
  const loaded = loadKeyFile(keyDir);
  if (!loaded.ok) return loaded;
  const { key } = loaded;
  const kp = producerAuth.mintGovernorKeypair();
  writeOwnerOnlyJson(path.join(keyDir, KEY_FILE_NAME), {
    ...key, sk: kp.sk, pk: kp.pk, pk_fingerprint: kp.pk_fingerprint,
    prior_fingerprints: [...key.prior_fingerprints, key.pk_fingerprint],
  });
  return { ok: true, prior: key.pk_fingerprint, current: kp.pk_fingerprint };
}

// --- Records ------------------------------------------------------------------------------

function signedByGovernor(state: GovernorState, runId: string, at: Position, producerId: string, contractRevision: string, body: EnvelopeBody): GovernedRecord {
  const rec = producerAuth.buildEnvelope(runId, at.seq, at.prev, "commissaire", producerId, contractRevision, body);
  rec.commissaire_sig = producerAuth.signDecision(rec, state.sk);
  return rec;
}

const admissionKey = (runId: string, producerId: string): string => `${runId}\u0000${producerId}`;
const runMasterOf = (state: GovernorState, runId: string): Buffer => producerAuth.deriveRunMaster(state.root_secret, runId);

// --- Ledger acceptance: chain verify (1) and head extension (2) ------------------------------

function chainInvalid(detail: string, seq?: number): Accepted {
  return { ok: false, reply: refuse("chain-invalid", seq === undefined ? { detail } : { detail, seq }) };
}

// The ledger arrives as the raw NDJSON bytes the runner holds: the chain walk, the head and the next
// `prev` all hash physical-line bytes, so a parse-then-restringify round trip is never trusted.
function verifyLedger(state: GovernorState, runId: string, ledgerText: string): Accepted {
  const buf = Buffer.from(ledgerText, "utf8");
  const walk = walkPhysicalChain(buf);
  if (walk.status !== "verified" || walk.torn_tail || walk.line_count === 0) return chainInvalid(walk.detail ?? `ledger walk ${walk.status}`);
  const lines: Buffer[] = splitPhysicalLines(buf).lines;
  const records: GovernedRecord[] = [];
  const master = runMasterOf(state, runId);
  for (let i = 0; i < lines.length; i++) {
    const rec: unknown = walk.records[i];
    if (!isRecord(rec)) return chainInvalid("a ledger line is not a record", i);
    if (rec.schema !== 3 || rec.run_id !== runId || rec.seq !== i) return chainInvalid("record is not schema 3 of this run at its line position", i);
    if (rec.author === "producer") {
      const key = producerAuth.deriveKey(master, str(rec.producer_id), str(rec.contract_revision));
      if (!producerAuth.verifyRecord(rec, key)) return chainInvalid("producer HMAC does not verify", i);
    } else if (rec.author === "commissaire") {
      if (!producerAuth.verifyDecision(rec, state.pk)) return chainInvalid("commissaire signature does not verify", i);
    } else {
      return chainInvalid("record author is neither producer nor commissaire", i);
    }
    records.push(rec);
  }
  const lastLine = lines[lines.length - 1];
  if (lastLine === undefined) return chainInvalid("empty ledger");
  const head: Head = { seq: records.length - 1, head_hash: sha256Hex(lastLine) };
  return { ok: true, view: { records, lines, head, next: { seq: records.length, prev: head.head_hash } } };
}

// lastHead advances only from the verified INCOMING head, never from a position the governor signed:
// a raced verdict can be an orphan the runner never appends.
function requireExtendsLastHead(state: GovernorState, runId: string, view: LedgerView): Json | null {
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

function acceptLedger(state: GovernorState, runId: string, ledgerText: string): Accepted {
  const verified = verifyLedger(state, runId, ledgerText);
  if (!verified.ok) return verified;
  const refusal = requireExtendsLastHead(state, runId, verified.view);
  return refusal ? { ok: false, reply: refusal } : verified;
}

const positionMatches = (view: LedgerView, at: Position): boolean => at.seq === view.next.seq && at.prev === view.next.prev;

// --- admit ------------------------------------------------------------------------------

function handleAdmit(state: GovernorState, req: Json): Json {
  const runId = ids.parseRunId(req.run_id), producerId = ids.parseProducerId(req.producer_id), revision = ids.parseContractRevisionId(req.contract_revision);
  const scope = req.admitted_scope;
  if (!runId.ok || !producerId.ok || !revision.ok) return refuse("malformed-request");
  if (!Array.isArray(scope) || !scope.every((k): k is string => typeof k === "string")) return refuse("malformed-request");
  const key = producerAuth.admitProducerKey(runMasterOf(state, runId.value), producerId.value, revision.value);
  const record = signedByGovernor(state, runId.value, { seq: 0, prev: sha256Hex(Buffer.from(runId.value, "utf8")) }, producerId.value, revision.value, {
    kind_of_entry: "admission", unit_id: "-", step: "admit",
    payload: { producer_id: producerId.value, contract_revision: revision.value, admitted_scope: scope, pk_fingerprint: state.pk_fingerprint, admitted_at: new Date().toISOString(), custody: "governor" },
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

function handleAuthorize(state: GovernorState, req: Json): Json {
  const runId = ids.parseRunId(req.run_id), producerId = ids.parseProducerId(req.producer_id), unitId = ids.parseUnitId(req.unit_id);
  const step = str(req.step), at = parsePosition(req.at), ledgerText = str(req.ledger);
  if (!runId.ok || !producerId.ok || !unitId.ok || step === undefined || at === null || ledgerText === undefined) return refuse("malformed-request");
  const admission = state.admissions.get(admissionKey(runId.value, producerId.value));
  if (!admission) return refuse("producer-not-admitted");

  const accepted = acceptLedger(state, runId.value, ledgerText);
  if (!accepted.ok) return accepted.reply;
  const { view } = accepted;
  if (!positionMatches(view, at)) return refuse("position-mismatch");

  const wantSeq = num(req.request_seq);
  const requests = view.records.filter((r) => r.kind_of_entry === "effect-decision-request" && r.author === "producer" && r.producer_id === producerId.value
    && matchesUnit(r, unitId.value) && r.step === step && (wantSeq === undefined || r.seq === wantSeq));
  const requestRecord = requests[requests.length - 1];
  if (requestRecord === undefined) return refuse("assurance-floor", { detail: "no effect-decision-request in the verified ledger" });
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
  const verdictPayload: Json = { request_seq: requestRecord.seq, verdict: composed.verdict, reason: composed.reason, effect: payload.effect, level, attended, holdout };
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

function refusedConclusion(reason: string, detail: Json = {}): Json {
  return { ok: false, verdict: "refused", reason, ...detail };
}

const withUnitId = (escapes: Json[]): Json[] => escapes.map((e) => ({ ...e, unit_id: e.issue }));

function handleConclude(state: GovernorState, req: Json): Json {
  const runId = ids.parseRunId(req.run_id), unitId = ids.parseUnitId(req.unit_id);
  const at = parsePosition(req.at), ledgerText = str(req.ledger), explicitProducer = req.producer_id;
  if (!runId.ok || !unitId.ok || at === null || ledgerText === undefined) return refuse("malformed-request");
  const accepted = acceptLedger(state, runId.value, ledgerText);
  if (!accepted.ok) return accepted.reply;
  const { view } = accepted;
  const unit = unitId.value;
  const entries = view.records.filter((e) => matchesUnit(e, unit));
  if (entries.length === 0) return refusedConclusion("no-evidence");

  const existing = entries.find((e) => conclusionKindOf(e) !== null && e.author === "commissaire");
  if (existing) return { ok: true, verdict: CONCLUSION_KIND, kind_of_entry: conclusionKindOf(existing), idempotent: true, record: existing };
  if (!positionMatches(view, at)) return refuse("position-mismatch");

  const producerIds = [...new Set(entries.map((e) => str(e.producer_id)).filter((x): x is string => x !== undefined && x !== "-"))];
  let producerId: string;
  if (explicitProducer !== undefined) {
    const wanted = ids.parseProducerId(explicitProducer);
    if (!wanted.ok || !producerIds.includes(wanted.value)) return refusedConclusion("no-evidence", { producer_id: explicitProducer });
    producerId = wanted.value;
  } else if (producerIds.length === 1 && producerIds[0] !== undefined) {
    producerId = producerIds[0];
  } else {
    return refusedConclusion("ambiguous-producer", { producers: producerIds });
  }
  const admission = state.admissions.get(admissionKey(runId.value, producerId));
  if (!admission) return refusedConclusion("producer-not-admitted", { producer_id: producerId });
  const escapeResult = computeEscapes(view.records, unit);
  if (escapeResult.any_escape) return refusedConclusion("unreconciled-escape", { escapes: withUnitId(escapeResult.escapes) });
  if (admission.pk_fingerprint !== state.pk_fingerprint) {
    return refusedConclusion("pk-fingerprint-mismatch", { producer_id: producerId, producer_pk_fingerprint: admission.pk_fingerprint, governor_pk_fingerprint: state.pk_fingerprint });
  }
  const observedProtected = view.records.filter((e) => e.kind_of_entry === "observe" && matchesUnit(e, unit) && isRecord(e.effect) && isProtectedKind(e.effect.kind));
  if (observedProtected.length > 0) {
    const coverage = grantCoverage(view.records, unit, state.pk, state.pk_fingerprint);
    if (!coverage.covered) return refusedConclusion("ungranted-protected-effect", { uncovered: coverage.uncovered });
  }
  const revisions = [...new Set(entries.map((e) => str(e.contract_revision)).filter((x): x is string => x !== undefined))];
  if (revisions.length > 1) return refusedConclusion("ambiguous-contract-revision", { contract_revisions: revisions.slice().sort() });
  const concludedRevision = revisions[0] ?? admission.contract_revision;
  const seqs = entries.map((e) => num(e.seq)).filter((s): s is number => s !== undefined && Number.isInteger(s));
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
function appendLog(state: GovernorState, request: Json, reply: Json): void {
  const { ledger, ...summary } = request;
  const signed = [reply.verdict_record, reply.record, reply.admission_record].find(isRecord);
  const line = {
    ts: new Date().toISOString(), op: request.op, run_id: request.run_id, unit_id: request.unit_id,
    request_summary: { ...summary, ledger_bytes: typeof ledger === "string" ? Buffer.byteLength(ledger, "utf8") : undefined },
    verdict: reply.ok === true ? reply.verdict : undefined,
    refusal: reply.ok === true ? undefined : reply.reason,
    signed_record: signed,
    appended_hint: signed ? { seq: signed.seq, prev: signed.prev } : undefined,
  };
  fs.appendFileSync(state.logPath, JSON.stringify(line) + "\n", { mode: 0o600 });
}

function dispatchOp(state: GovernorState, request: Json): Json {
  switch (request.op) {
    case "admit": return handleAdmit(state, request);
    case "authorize": return handleAuthorize(state, request);
    case "conclude": return handleConclude(state, request);
    default: return refuse("unknown-op");
  }
}

// The selftest seam: a request in, a reply out, no socket involved.
function handleRequest(state: GovernorState, request: unknown): Json {
  if (!isRecord(request)) return refuse("malformed-request");
  const reply = dispatchOp(state, request);
  try {
    appendLog(state, request, reply);
  } catch {
    return refuse("governor-log-failed");
  }
  return reply;
}

// --- Server ------------------------------------------------------------------------------

function answer(state: GovernorState, socket: Socket, raw: string): void {
  let reply: Json;
  try {
    reply = handleRequest(state, JSON.parse(raw));
  } catch (e) {
    reply = e instanceof SyntaxError ? refuse("malformed-request") : refuse("internal-error");
  }
  socket.end(JSON.stringify(reply) + "\n");
}

function onConnection(state: GovernorState, socket: Socket): void {
  let buffered = "";
  let answered = false;
  const answerOnce = (raw: string): void => { if (!answered) { answered = true; answer(state, socket, raw); } };
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    if (answered) return;
    buffered += chunk;
    if (buffered.length > MAX_REQUEST_CHARS) { answered = true; socket.end(JSON.stringify(refuse("request-too-large")) + "\n"); return; }
    const newline = buffered.indexOf("\n");
    if (newline !== -1) answerOnce(buffered.slice(0, newline));
  });
  socket.on("end", () => { if (buffered.trim() !== "") answerOnce(buffered); });
  socket.on("error", () => socket.destroy());
}

function parseListen(spec: string): { host: string; port: number } | null {
  const at = spec.lastIndexOf(":");
  const port = Number(spec.slice(at + 1));
  const host = spec.slice(0, at);
  return at > 0 && Number.isInteger(port) && port > 0 && port < 65536 ? { host, port } : null;
}

function governorStart(flags: FlagBag): number {
  const keyDir = keyDirOf(flags);
  const opened = openState(keyDir);
  if (!opened.ok) { process.stderr.write(`faff commissaire governor start: ${opened.error}\n`); return 2; }
  const { state } = opened;
  const socketFlag = flags["--socket"];
  const socketPath = typeof socketFlag === "string" && socketFlag !== "" ? socketFlag : path.join(keyDir, SOCKET_FILE_NAME);
  const listenFlag = flags["--listen"];
  const listen = typeof listenFlag === "string" ? parseListen(listenFlag) : null;
  if (typeof listenFlag === "string" && listen === null) {
    process.stderr.write("faff commissaire governor start: --listen must be host:port\n");
    return 2;
  }

  try { if (fs.lstatSync(socketPath).isSocket()) fs.unlinkSync(socketPath); } catch { /* no stale socket to clear */ }
  const servers: Server[] = [];
  const stop = (): void => { for (const s of servers) s.close(); try { fs.unlinkSync(socketPath); } catch { /* already gone */ } };
  const make = (): Server => {
    const server: Server = net.createServer({ allowHalfOpen: true }, (socket: Socket) => onConnection(state, socket));
    server.on("error", (e: Error) => { process.stderr.write(`faff commissaire governor start: ${e.message}\n`); process.exitCode = 1; stop(); });
    servers.push(server);
    return server;
  };
  make().listen(socketPath, () => {
    fs.chmodSync(socketPath, 0o600);
    console.log(JSON.stringify({ listening: { socket: socketPath }, pk_fingerprint: state.pk_fingerprint }));
  });
  if (listen) {
    make().listen(listen.port, listen.host, () => console.log(JSON.stringify({ listening: { tcp: `${listen.host}:${listen.port}` } })));
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return 0;
}

function governorRotate(flags: FlagBag): number {
  const rotated = rotateKeyFile(keyDirOf(flags));
  if (!rotated.ok) { process.stderr.write(`faff commissaire governor rotate: ${rotated.error}\n`); return 2; }
  console.log(JSON.stringify({ rotated: true, pk_fingerprint: rotated.current, prior_fingerprint: rotated.prior }));
  return 0;
}

// --- Selftest ------------------------------------------------------------------------------

type SelftestRun = {
  runId: string;
  key: Buffer;
  lines: string[];
  text(): string;
  at(): Position;
  producer(unit: string, step: string, kind: string, body: { effect?: unknown; payload?: unknown }, signKey?: Buffer): void;
  append(record: unknown): void;
  authorize(unit: string, step: string, extra?: Json): Json;
};

const MERGE_MAIN = { kind: "merge", target: "main", reversible: true };

function governorSelftest(): number {
  let failed = 0;
  const fail = (m: string): void => { process.stderr.write(`governor selftest FAIL: ${m}\n`); failed++; };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-governor-"));
  try {
    const keyDir = path.join(tmp, "keys");
    const opened = openState(keyDir);
    if (!opened.ok) { fail(`first start: ${opened.error}`); return 1; }
    const { state } = opened;
    const keyFile = path.join(keyDir, KEY_FILE_NAME);
    if (modeOf(keyDir) !== 0o700) fail("first start: key dir is not mode 700");
    if (modeOf(keyFile) !== 0o600) fail("first start: key file is not mode 600");
    const stored = parseKeyFile(JSON.parse(fs.readFileSync(keyFile, "utf8")));
    if (!stored || stored.pk_fingerprint !== state.pk_fingerprint) fail("first start: key file holds sk, root secret and the fingerprint");

    const newRun = (runId: string, scope: string[]): SelftestRun => {
      const admitted = handleRequest(state, { op: "admit", run_id: runId, producer_id: "P1", contract_revision: "r1", admitted_scope: scope });
      if (admitted.ok !== true || admitted.custody !== "governor") fail(`${runId}: admit replies custody governor`);
      const lines: string[] = [JSON.stringify(admitted.admission_record)];
      const key = Buffer.from(str(admitted.k_producer_hex) ?? "", "hex");
      const at = (): Position => ({ seq: lines.length, prev: sha256Hex(Buffer.from(lines[lines.length - 1] ?? runId, "utf8")) });
      const run: SelftestRun = {
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
    const requestOf = (effect: unknown, extra: Json = {}): { payload: Json } => ({ payload: { effect, ...extra } });
    const verdictOf = (reply: Json): GovernedRecord => (isRecord(reply.verdict_record) ? reply.verdict_record : {});
    const headOf = (runId: string): Head | undefined => state.lastHead.get(runId);

    // 1. grant
    const grant = newRun("RUN-GRANT", ["merge"]);
    grant.producer("FAFF-1", "merge", "declare", { effect: MERGE_MAIN });
    grant.producer("FAFF-1", "merge", "effect-decision-request", requestOf(MERGE_MAIN));
    const granted = grant.authorize("FAFF-1", "merge", { effect: MERGE_MAIN });
    if (granted.ok !== true || granted.verdict !== "grant") fail(`grant: covered request grants (got ${JSON.stringify(granted)})`);
    if (!producerAuth.verifyDecision(verdictOf(granted), state.pk)) fail("grant: the verdict record verifies under the governor key");
    if (verdictOf(granted).seq !== grant.at().seq) fail("grant: the verdict is signed at the requested position");
    const missAt = grant.authorize("FAFF-1", "merge", { at: { seq: grant.at().seq + 1, prev: grant.at().prev } });
    if (missAt.reason !== "position-mismatch" || "verdict_record" in missAt) fail("position: a wrong seq is position-mismatch and signs nothing");

    // 2. deny
    const deny = newRun("RUN-DENY", ["merge"]);
    const deploy = { kind: "deploy", target: "prod", reversible: true };
    deny.producer("FAFF-2", "merge", "effect-decision-request", requestOf(deploy));
    const denied = deny.authorize("FAFF-2", "merge");
    if (denied.ok !== true || denied.verdict !== "deny" || denied.reason !== "effect-out-of-scope") fail(`deny: out-of-scope effect is a signed deny (got ${JSON.stringify(denied)})`);
    if (!producerAuth.verifyDecision(verdictOf(denied), state.pk)) fail("deny: the deny verdict verifies");

    // 3. forged request
    const forged = newRun("RUN-FORGED", ["merge"]);
    forged.producer("FAFF-3", "merge", "declare", { effect: MERGE_MAIN });
    forged.producer("FAFF-3", "merge", "effect-decision-request", requestOf(MERGE_MAIN), producerAuth.deriveKey("not-the-master", "P1", "r1"));
    const forgedReply = forged.authorize("FAFF-3", "merge");
    if (forgedReply.ok !== false || forgedReply.reason !== "chain-invalid" || "verdict_record" in forgedReply) fail(`forged: a request HMAC that does not verify is chain-invalid (got ${JSON.stringify(forgedReply)})`);

    // 4. unadmitted producer
    const stranger = newRun("RUN-STRANGER", ["merge"]);
    const unadmitted = handleRequest(state, { op: "authorize", run_id: "RUN-NEVER", producer_id: "P1", unit_id: "FAFF-4", step: "merge", ledger: stranger.text(), at: stranger.at() });
    if (unadmitted.reason !== "producer-not-admitted") fail(`unadmitted: a never-admitted run is producer-not-admitted (got ${JSON.stringify(unadmitted)})`);

    // 5. stale evidence
    const stale = newRun("RUN-STALE", ["merge"]);
    stale.producer("FAFF-5", "merge", "declare", { effect: MERGE_MAIN });
    stale.producer("FAFF-5", "merge", "observe", { effect: MERGE_MAIN });
    stale.producer("FAFF-5", "merge", "effect-decision-request", requestOf(MERGE_MAIN, { evidence_seq: 1 }));
    const staleReply = stale.authorize("FAFF-5", "merge");
    if (staleReply.verdict !== "deny" || staleReply.reason !== "stale-evidence") fail(`stale: evidence older than the latest observe denies (got ${JSON.stringify(staleReply)})`);

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
    if (winner.ok !== true || orphan.ok !== true) fail("race: both lanes are signed at the contested position");
    if (verdictOf(winner).seq !== contested.seq || verdictOf(orphan).seq !== contested.seq || verdictOf(orphan).prev !== contested.prev) fail("race: the orphan is signed at the same (seq, prev)");
    if (!headAfterWinner || headAfterOrphan?.seq !== headAfterWinner.seq || headAfterOrphan.head_hash !== headAfterWinner.head_hash) fail("race: lastHead stays the verified incoming head");
    if (headAfterWinner && headAfterWinner.seq !== contested.seq - 1) fail("race: lastHead was not advanced to the signed position");
    race.append(winner.verdict_record);
    const retried = race.authorize("U-B", "merge");
    if (retried.reason === "ledger-not-extending-head") fail("race: the loser's re-request is falsely refused ledger-not-extending-head");
    if (retried.ok !== true || retried.verdict !== "grant" || verdictOf(retried).seq !== contested.seq + 1) fail(`race: the loser re-requests at the new head and is signed (got ${JSON.stringify(retried)})`);

    // 7. truncated ledger
    const trunc = newRun("RUN-TRUNC", ["merge"]);
    trunc.producer("FAFF-7", "merge", "declare", { effect: MERGE_MAIN });
    trunc.producer("FAFF-7", "merge", "effect-decision-request", requestOf(MERGE_MAIN));
    if (trunc.authorize("FAFF-7", "merge").ok !== true) fail("truncated: the full ledger is accepted first");
    const full = trunc.lines.slice();
    trunc.lines.pop();
    const truncatedReply = trunc.authorize("FAFF-7", "merge");
    if (truncatedReply.reason !== "ledger-not-extending-head") fail(`truncated: a ledger below the stored head is refused (got ${JSON.stringify(truncatedReply)})`);
    trunc.lines.splice(0, trunc.lines.length, ...full);

    // conclude: a granted-and-observed merge concludes (and re-concludes idempotently); without the grant it is refused
    const conclude = (run: SelftestRun): Json => handleRequest(state, { op: "conclude", run_id: run.runId, unit_id: "FAFF-8", ledger: run.text(), at: run.at() });
    const done = newRun("RUN-DONE", ["merge"]);
    done.producer("FAFF-8", "merge", "declare", { effect: MERGE_MAIN });
    done.producer("FAFF-8", "merge", "effect-decision-request", requestOf(MERGE_MAIN));
    done.append(done.authorize("FAFF-8", "merge").verdict_record);
    done.producer("FAFF-8", "merge", "observe", { effect: MERGE_MAIN });
    const concluded = conclude(done);
    const conclusion = isRecord(concluded.record) ? concluded.record : {};
    if (concluded.ok !== true || concluded.verdict !== CONCLUSION_KIND || !producerAuth.verifyDecision(conclusion, state.pk)) fail(`conclude: a granted observed merge concludes (got ${JSON.stringify(concluded)})`);
    done.append(conclusion);
    if (conclude(done).idempotent !== true) fail("conclude: a repeat conclude returns the prior record");
    const ungrantedRun = newRun("RUN-UNGRANTED", ["merge"]);
    ungrantedRun.producer("FAFF-8", "merge", "declare", { effect: MERGE_MAIN });
    ungrantedRun.producer("FAFF-8", "merge", "observe", { effect: MERGE_MAIN });
    const ungranted = conclude(ungrantedRun);
    if (ungranted.ok !== false || ungranted.reason !== "ungranted-protected-effect") fail(`conclude: an observed merge with no grant is refused (got ${JSON.stringify(ungranted)})`);

    // admit/authorize/conclude each wrote their log lines
    const logOps = fs.readFileSync(state.logPath, "utf8").trim().split("\n").map((l: string) => JSON.parse(l).op);
    if (!logOps.includes("admit") || !logOps.includes("authorize")) fail("log: admit and authorize requests are logged");
    const orphanLogged = fs.readFileSync(state.logPath, "utf8").trim().split("\n").map((l: string) => JSON.parse(l)).filter((l: Json) => isRecord(l.signed_record) && l.signed_record.seq === contested.seq && l.run_id === "RUN-RACE");
    if (orphanLogged.length !== 2) fail("log: the orphan verdict is logged beside the winner's");

    // rotate: new keypair, same root secret, prior fingerprint retained, modes kept
    const before = loadKeyFile(keyDir);
    const rotated = rotateKeyFile(keyDir);
    const after = loadKeyFile(keyDir);
    if (!before.ok || !rotated.ok || !after.ok) fail("rotate: the key file stays loadable");
    else {
      if (after.key.pk_fingerprint === before.key.pk_fingerprint) fail("rotate: mints a new keypair");
      if (after.key.root_secret !== before.key.root_secret) fail("rotate: leaves the root secret unchanged");
      if (!after.key.prior_fingerprints.includes(before.key.pk_fingerprint)) fail("rotate: retains the prior fingerprint");
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failed) return 1;
  console.log("governor selftest: ok");
  return 0;
}

module.exports = { governorStart, governorRotate, handleRequest, governorSelftest, openState };
