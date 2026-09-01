// ===========================================================================
// === region:factory — andon — FAFF-386: push alerting/escalation channel for run-critical events. ===
//
// Factory, not governance: unlike budget.js/sentry.js's narrower governance-only
// `readGovernanceConfig`, this module reads the full `andon.*` config block via the
// factory `loadConfig` resolver (mirrors `adr`/`decisions`'s choice) — governance may
// not require factory, so that one dependency places this file in the factory region
// even though it reads the same events.jsonl substrate budget/sentry/events trust.
//
// `faff andon pump` is a cursor-based reader over the run's `events.jsonl` — the same
// hard-floor, append-only, single-writer log every other governance surface (budget,
// sentry) already trusts (FAFF-35). It classifies each new event against a small
// run-critical set (park / sentry-trip / budget-breach / run-end), dedupes persisting
// conditions (a breach/trip that stays true across many checkpoints notifies once,
// not once per checkpoint), and POSTs one skimmable notification per distinct
// condition to a configured webhook.
//
// Fail-open by construction (records/adr/0101 …fail-open-by-construction.md): a
// transport failure is recorded in `andon-state.json` and the command still exits 0
// — the andon is telemetry sitting beside the park protocol / ledger / runcheck /
// Sentry correctness machinery, never inside it. `andon.url` unset ⇒ complete no-op:
// zero network calls, zero state writes.
//
// `events.jsonl` is the sole substrate (records/adr/0102 …sole-andon-notification-
// substrate.md) — the pump never re-derives trip/breach state by re-running
// `faff sentry check` / `faff budget check`; if a condition isn't in the log, the
// andon does not know about it.
//
// Zero new dependencies — `node:http`/`node:https` built-ins only, the first
// outbound-network code in the binary (contained entirely to this module).
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { parseArgs, usageError, requireFlags } = require("./argv");
const { findRoot, dig } = require("./shared-infra");
const { loadConfig } = require("./config");

const ANDON_FORMATS = ["generic", "ntfy", "slack", "discord"];
// FAFF-781 — informational classes (admitted/prep-start/build-start) report lifecycle
// progress rather than a run-critical condition; they are additive members, opt-in
// only (never in ANDON_DEFAULT_EVENTS below), mirroring the existing run-end opt-in.
const ANDON_CLASSES = ["park", "sentry-trip", "budget-breach", "run-end", "admitted", "prep-start", "build-start"];
const ANDON_DEFAULT_EVENTS = ["park", "sentry-trip", "budget-breach"];
// Built-in constants, not config keys (spec §3 — "a user has no basis to tune them").
const ANDON_TIMEOUT_MS = 5000;
const ANDON_RETRY_COUNT = 1; // one retry in-call ⇒ 2 attempts total per event/rollup
const ANDON_FLOOD_CAP = 10;

const ANDON_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--json": { arity: 0 },
    "--run-dir": { arity: 1 },
    "--root": { arity: 1 },
    "--class": { arity: 1, enum: ANDON_CLASSES },
    "--title": { arity: 1 },
    "--body": { arity: 1 },
    "--issue": { arity: 1 },
    "--check": { arity: 0 },
  },
  positionals: { min: 1, max: 1, name: "verb" },
};
const ANDON_USAGE = "usage: faff andon pump --run-dir DIR [--json] | faff andon send --class C --title T --body B [--issue ID] [--run-dir DIR] [--json] | faff andon send --check [--run-dir DIR] [--json]";
// FAFF-628 — declared grammar (cli-surface.js's drift-guard source).
const ANDON_SURFACE = {
  kind: "subcommand_dispatch",
  spec: ANDON_SPEC,
  subcommands: {
    pump: { required_flags: ["--run-dir"] },
    send: { required_flags: ["--class", "--title", "--body"] },
  },
};

// FAFF-926 D1 — a "Slack-shaped" webhook host: `hooks.slack.com` (case-insensitive)
// or any `*.slack.com` host. Pure, total: a malformed/unparseable URL is never
// Slack-shaped (falls through to the "generic" default, unchanged).
function isSlackShapedUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase();
  return host === "hooks.slack.com" || host.endsWith(".slack.com");
}

// ---------------------------------------------------------------------------
// Config resolution — `andon.*` via the factory config resolver (`loadConfig`),
// mirroring `adr.js`'s use of the same reader. Defaults are applied LOCALLY here
// (never baked into config.js's DEFAULTS registry) — same posture budget.js's
// header note documents for its own governance-region defaults.
// ---------------------------------------------------------------------------
function resolveAndonConfig(root) {
  const [data] = loadConfig(root);
  const url = dig(data, "andon.url");
  const rawFormat = dig(data, "andon.format");
  const token = dig(data, "andon.token");
  const eventsCfg = dig(data, "andon.events");
  const events = Array.isArray(eventsCfg) && eventsCfg.length
    ? eventsCfg.filter((e) => ANDON_CLASSES.includes(e))
    : ANDON_DEFAULT_EVENTS.slice();
  const resolvedUrl = typeof url === "string" && url.trim() ? url.trim() : null;

  // FAFF-926 D1 — an EXPLICIT format (including explicit "generic") is always
  // obeyed; inference only fires when the key is genuinely absent. `dig()`
  // (shared-infra.js) resolves an absent key to `null`, never `undefined` — the
  // sentinel checked here matches that actual contract, not the stricter
  // `undefined`-only reading the original spec draft assumed (see the tracker
  // resolve-attempt comment on this issue).
  let format;
  if (ANDON_FORMATS.includes(rawFormat)) {
    format = rawFormat;
  } else if (rawFormat === null && resolvedUrl && isSlackShapedUrl(resolvedUrl)) {
    format = "slack";
  } else {
    format = "generic";
  }

  return {
    url: resolvedUrl,
    format,
    token: typeof token === "string" && token.trim() ? token.trim() : null,
    events,
  };
}

// ---------------------------------------------------------------------------
// Classification — PURE. Maps one events.jsonl record to { cls, key } or null
// (not run-critical). `key` is the per-run dedupe key (spec §4 "why dedupe keys,
// not just the cursor" — a persisting condition collapses to one notification).
// ---------------------------------------------------------------------------
function classifyEvent(event) {
  if (!event || typeof event !== "object" || typeof event.seq !== "number") return null;
  const type = event.type;
  const data = (event.data && typeof event.data === "object") ? event.data : {};
  if (type === "park") {
    if (!event.issue) return null; // issue-scoped by contract; an issue-less park is unclassifiable
    return { cls: "park", key: `park:${event.issue}:${event.seq}` };
  }
  if (type === "sentry-trip") {
    const signals = Array.isArray(data.verdicts)
      ? data.verdicts.map((v) => v && v.signal).filter((s) => typeof s === "string").sort()
      : [];
    return { cls: "sentry-trip", key: `sentry:${signals.join(",")}` };
  }
  if (type === "budget-checkpoint") {
    const breached = Array.isArray(data.breached) ? data.breached.slice().sort() : [];
    if (breached.length === 0) return null; // unbreached checkpoint — not critical
    return { cls: "budget-breach", key: `budget:${breached.join(",")}` };
  }
  if (type === "run-end") {
    return { cls: "run-end", key: "run-end" };
  }
  // FAFF-781 — informational lifecycle classes. Issue-less → unclassifiable (mirrors
  // the park rule above), except "admitted" whose KEY is run-level but which still
  // requires a well-formed source event (the summary needs the ID to list).
  if (type === "issue-admitted") {
    if (!event.issue) return null;
    return { cls: "admitted", key: "admitted" };
  }
  if (type === "prep-start") {
    if (!event.issue) return null;
    return { cls: "prep-start", key: `prep-start:${event.issue}` };
  }
  if (type === "build-start") {
    if (!event.issue) return null;
    return { cls: "build-start", key: `build-start:${event.issue}` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Notification construction — PURE. Minimal payload (spec §"Minimal payload to an
// untrusted sink"): issue IDs, event class, one-line summaries only — never spec
// bodies, diffs, code, or transcript content.
// ---------------------------------------------------------------------------
function buildNotification(runId, seq, ts, cls, event) {
  const data = (event && event.data && typeof event.data === "object") ? event.data : {};
  let title, body, issue;
  if (cls === "park") {
    issue = event.issue;
    title = `faff ${runId}: ${issue} parked`;
    body = `reason: ${typeof data.reason === "string" && data.reason ? data.reason : "unspecified"}`;
  } else if (cls === "sentry-trip") {
    const signals = Array.isArray(data.verdicts)
      ? data.verdicts.map((v) => v && v.signal).filter((s) => typeof s === "string")
      : [];
    title = `faff ${runId}: sentry tripped (${data.intervention || "unknown"})`;
    body = `signals: ${signals.join(", ") || "unknown"}`;
  } else if (cls === "budget-breach") {
    const breached = Array.isArray(data.breached) ? data.breached : [];
    title = `faff ${runId}: budget breached (${breached.join(", ")})`;
    body = `outcome: ${data.outcome || "unknown"}`;
  } else if (cls === "run-end") {
    title = `faff ${runId}: run ended`;
    body = "run complete — see the run log";
  } else if (cls === "admitted") {
    // FAFF-781 — run-level: NO issue field. Caller passes the admitted-IDs list via
    // event.data.admitted (never event.issue) — see runPump's aggregation.
    const admitted = Array.isArray(data.admitted) ? data.admitted : [];
    title = `faff ${runId}: ${admitted.length} ticket(s) admitted`;
    body = `admitted: ${admitted.join(", ")}`;
  } else if (cls === "prep-start") {
    issue = event.issue;
    title = `faff ${runId}: ${issue} prep started`;
    body = "stage: prep";
  } else if (cls === "build-start") {
    issue = event.issue;
    title = `faff ${runId}: ${issue} build started`;
    body = "stage: build";
  } else {
    title = `faff ${runId}: ${cls}`;
    body = "";
  }
  const notif = { run_id: runId, class: cls, title, body, ts, seq: typeof seq === "number" ? seq : null };
  if (issue !== undefined) notif.issue = issue;
  return notif;
}

// ntfy priority per class (spec §3 format presets table).
function ntfyPriority(cls) {
  if (cls === "sentry-trip" || cls === "budget-breach") return "urgent";
  if (cls === "park") return "high";
  return "default";
}

// FAFF-926 D2 — total, pure: the Slack preset's `text` must NEVER be empty or
// whitespace-only (Slack rejects both as HTTP 400 no_text). Non-empty lines of
// [title, body] joined by newline; falls back to "faff <run_id>: <class>", then
// to a fixed literal — always non-empty.
function slackText(notif) {
  const title = notif && typeof notif.title === "string" ? notif.title : "";
  const body = notif && typeof notif.body === "string" ? notif.body : "";
  const parts = [title, body].filter((s) => s.trim() !== "");
  const joined = parts.join("\n");
  if (joined.trim() !== "") return joined;
  if (notif && notif.run_id && notif.class) return `faff ${notif.run_id}: ${notif.class}`;
  return "faff andon notification";
}

// PURE: shape the notification per format preset. Presets RESHAPE the generic
// record, never extend it (spec §3).
function formatPayload(format, notif) {
  if (format === "ntfy") {
    return {
      body: notif.body,
      headers: { "content-type": "text/plain; charset=utf-8", Title: notif.title, Priority: ntfyPriority(notif.class) },
    };
  }
  if (format === "slack") {
    return { body: JSON.stringify({ text: slackText(notif) }), headers: { "content-type": "application/json" } };
  }
  if (format === "discord") {
    return { body: JSON.stringify({ content: `${notif.title}\n${notif.body}` }), headers: { "content-type": "application/json" } };
  }
  return { body: JSON.stringify(notif), headers: { "content-type": "application/json" } }; // generic
}

// ---------------------------------------------------------------------------
// Transport — node:http/https built-ins only (records/adr/0101). Injectable (postFn
// param on runPump/cmdAndon's send path) so tests spin a real loopback server
// rather than mocking the network primitive.
// ---------------------------------------------------------------------------
function realPost(url, body, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(e); return; }
    const lib = u.protocol === "https:" ? https : http;
    const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
    const allHeaders = { "content-length": bodyBuf.length, ...headers };
    const req = lib.request(u, { method: "POST", headers: allHeaders }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ statusCode: res.statusCode, body: data });
        else reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`andon POST timed out after ${timeoutMs}ms`)));
    req.write(bodyBuf);
    req.end();
  });
}

// FAFF-926 D4 — raw-status transport variant for the `--check` probe: resolves
// `{ ok, statusCode, body }` for EVERY HTTP response (2xx and non-2xx alike),
// rejecting only on a transport-level error (DNS/connect/timeout). `realPost`
// above is UNCHANGED — its reject-on-non-2xx behaviour still drives the
// pump/send fail-open failure recording (N4).
function realPostRaw(url, body, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(e); return; }
    const lib = u.protocol === "https:" ? https : http;
    const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
    const allHeaders = { "content-length": bodyBuf.length, ...headers };
    const req = lib.request(u, { method: "POST", headers: allHeaders }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body: data });
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`andon POST timed out after ${timeoutMs}ms`)));
    req.write(bodyBuf);
    req.end();
  });
}

// FAFF-926 D4 — cap a reported body at ~200 chars so a large error page doesn't
// flood the terminal (mirrors `realPost`'s existing `data.slice(0,200)`).
function truncate(s, n) {
  if (typeof s !== "string") return s;
  const cap = n || 200;
  return s.length > cap ? s.slice(0, cap) : s;
}

// One retry in-call (spec: "5s timeout, 1 retry") — 2 attempts total, no backoff
// (webhooks are cheap/local; a long backoff would just hold the pump open).
async function postWithRetry(postFn, url, body, headers, timeoutMs, retries) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await postFn(url, body, headers, timeoutMs); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Pump state — `.faff/runs/<run-id>/andon-state.json`, written ONLY by the pump
// (same single-writer discipline as events.jsonl itself). Atomic tmp+rename.
// ---------------------------------------------------------------------------
function andonStatePath(runDir) { return path.join(runDir, "andon-state.json"); }

function readAndonState(runDir) {
  const p = andonStatePath(runDir);
  if (!fs.existsSync(p)) return { cursor: 0, notified: [], failures: [] };
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      cursor: Number.isInteger(j.cursor) ? j.cursor : 0,
      notified: Array.isArray(j.notified) ? j.notified : [],
      failures: Array.isArray(j.failures) ? j.failures : [],
    };
  } catch { return { cursor: 0, notified: [], failures: [] }; } // corrupt state file — restart from scratch rather than crash the pump
}

function writeAndonState(runDir, state) {
  const target = andonStatePath(runDir);
  const tmp = `${target}.tmp.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
  const body = JSON.stringify(state, null, 2) + "\n";
  try {
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best-effort — tmp may never have been created, or is already gone */ }
    throw e;
  }
}

// Read events.jsonl, tolerating malformed lines (skip + count, never abort — spec §4 step 3a).
function readEventsSince(runDir, cursor) {
  const p = path.join(runDir, "events.jsonl");
  if (!fs.existsSync(p)) return { events: [], malformed: 0 };
  const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "");
  const events = [];
  let malformed = 0;
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { malformed++; continue; }
    if (!ev || typeof ev.seq !== "number") { malformed++; continue; }
    if (ev.seq >= cursor) events.push(ev);
  }
  events.sort((a, b) => a.seq - b.seq);
  return { events, malformed };
}

// ---------------------------------------------------------------------------
// The pump — spec §4 PROCEDURE andon_pump. `postFn` is injectable (tests only;
// production always calls with the default `realPost`).
// ---------------------------------------------------------------------------
async function runPump(root, runDir, postFn) {
  postFn = postFn || realPost;
  const config = resolveAndonConfig(root);
  if (!config.url) return { disabled: true, sent: 0, failed: 0, skipped: 0, cursor: null, malformed: 0 };

  const state = readAndonState(runDir);
  const { events, malformed } = readEventsSince(runDir, state.cursor);

  const notified = new Set(state.notified);
  const failures = state.failures.slice();
  let cursor = state.cursor;
  let sent = 0, failed = 0, skipped = 0;
  const rollup = [];
  let stopped = false;

  const authHeaders = config.token ? { authorization: `Bearer ${config.token}` } : {};

  for (const event of events) {
    if (stopped) break;
    const classified = classifyEvent(event);
    if (!classified) { cursor = event.seq + 1; continue; } // not run-critical — always advances
    const { cls, key } = classified;
    if (!config.events.includes(cls) || notified.has(key)) { cursor = event.seq + 1; skipped++; continue; }

    if (sent >= ANDON_FLOOD_CAP) {
      // Flood cap: bundle into the rollup — mark notified + advance past it now
      // (spec §4 step 5), independent of the rollup send's own outcome below.
      notified.add(key);
      rollup.push(key);
      cursor = event.seq + 1;
      continue;
    }

    // FAFF-781 — "admitted" is run-level: aggregate every issue-admitted event in THIS
    // batch (the `events` array already read via readEventsSince — no second file read)
    // rather than the single triggering event, so the summary lists every ticket the
    // run admitted, not just the one that happened to be first past the notified check.
    const runId = event.run_id || path.basename(runDir);
    const buildSrc = cls === "admitted"
      ? { data: { admitted: events.filter((e) => e.type === "issue-admitted" && e.issue).map((e) => e.issue) } }
      : event;
    const notifSeq = cls === "admitted" ? null : event.seq;
    const notif = buildNotification(runId, notifSeq, new Date().toISOString(), cls, buildSrc);
    const { body, headers } = formatPayload(config.format, notif);
    try {
      await postWithRetry(postFn, config.url, body, { ...headers, ...authHeaders }, ANDON_TIMEOUT_MS, ANDON_RETRY_COUNT);
      notified.add(key);
      cursor = event.seq + 1;
      sent++;
    } catch (e) {
      failures.push({ ts: new Date().toISOString(), seq: event.seq, error: String((e && e.message) || e) });
      failed++;
      stopped = true; // cursor stays put — at-least-once retry next pump (spec §4 step 4d)
    }
  }

  if (!stopped && rollup.length > 0) {
    const runId = events.length ? (events[events.length - 1].run_id || path.basename(runDir)) : path.basename(runDir);
    const rollupNotif = {
      run_id: runId, class: "rollup",
      title: `faff ${runId}: ${rollup.length} more run-critical event(s)`,
      body: `...and ${rollup.length} more run-critical events — see the run log`,
      ts: new Date().toISOString(), seq: null,
    };
    const { body, headers } = formatPayload(config.format, rollupNotif);
    try { await postWithRetry(postFn, config.url, body, { ...headers, ...authHeaders }, ANDON_TIMEOUT_MS, ANDON_RETRY_COUNT); sent++; }
    catch (e) { failures.push({ ts: new Date().toISOString(), seq: null, error: String((e && e.message) || e) }); failed++; }
  }

  writeAndonState(runDir, { cursor, notified: [...notified], failures });
  return { disabled: false, sent, failed, skipped, cursor, malformed };
}

// FAFF-926 D3 — the `--check` probe's notification record: if the operator
// supplied --class/--title/--body, honour them; otherwise synthesize a
// clearly-labelled diagnostic record. Payload minimisation (N2): a fixed title
// + timestamp only — no spec/diff/transcript content. `get` is the same
// `(flag) => value|null` accessor `cmdAndon` already builds from `parsed.values`.
function synthesizeProbeNotification(get) {
  const runDirFlag = get("--run-dir");
  const notif = {
    run_id: runDirFlag ? path.basename(runDirFlag) : null,
    class: get("--class"),
    title: get("--title") || "faff andon --check",
    body: get("--body") || `end-to-end delivery probe — ${new Date().toISOString()}`,
    ts: new Date().toISOString(),
    seq: null,
  };
  const issue = get("--issue");
  if (issue) notif.issue = issue;
  return notif;
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------
async function cmdAndon(args) {
  if (Array.isArray(args) && args.includes("--selftest")) return andonSelftest();
  const parsed = parseArgs(args, ANDON_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, ANDON_USAGE);
  const sub = parsed.positionals[0];
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const asJson = !!parsed.values["--json"];
  const root = get("--root") || findRoot();

  if (sub === "pump") {
    const reqErr = requireFlags(parsed.values, ANDON_SURFACE.subcommands.pump, "andon", "pump");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    const runDir = get("--run-dir");
    if (!fs.existsSync(runDir)) { process.stderr.write(`faff andon pump: run dir not found: ${runDir}\n`); return 2; }
    const result = await runPump(root, runDir);
    if (asJson) console.log(JSON.stringify(result));
    else if (result.disabled) console.log("andon: disabled (no andon.url configured)");
    else console.log(`andon: sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}`);
    return 0; // fail-open — the pump never signals failure via its own exit code
  }

  if (sub === "send") {
    // FAFF-926 D3 — `--check` is handled BEFORE requireFlags: the probe does not
    // require --class/--title/--body (it synthesizes a diagnostic record when
    // they're absent), unlike an ordinary send.
    if (parsed.values["--check"]) {
      const config = resolveAndonConfig(root);
      if (!config.url) {
        if (asJson) console.log(JSON.stringify({ check: true, ok: false, configured: false, error: "not configured (no andon.url)" }));
        else console.log("andon: not configured (no andon.url) — nothing to check");
        return 1; // D5 — nothing to check is a failed check
      }
      const notif = synthesizeProbeNotification(get);
      const { body, headers } = formatPayload(config.format, notif);
      const authHeaders = config.token ? { authorization: `Bearer ${config.token}` } : {};
      try {
        const res = await realPostRaw(config.url, body, { ...headers, ...authHeaders }, ANDON_TIMEOUT_MS);
        if (asJson) console.log(JSON.stringify({ check: true, ok: res.ok, statusCode: res.statusCode, body: truncate(res.body) }));
        else console.log(`andon check: HTTP ${res.statusCode}${res.ok ? " ok" : " FAILED"} — ${truncate(res.body)}`);
        return res.ok ? 0 : 1; // D5
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (asJson) console.log(JSON.stringify({ check: true, ok: false, error: msg }));
        else console.log(`andon check: transport error — ${msg}`);
        return 1; // D5 — transport error (DNS/connect/timeout)
      }
    }
    const reqErr = requireFlags(parsed.values, ANDON_SURFACE.subcommands.send, "andon", "send");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    const config = resolveAndonConfig(root);
    if (!config.url) {
      if (asJson) console.log(JSON.stringify({ disabled: true, sent: 0, failed: 0 }));
      else console.log("andon: disabled (no andon.url configured)");
      return 0;
    }
    const runDirFlag = get("--run-dir");
    const notif = {
      run_id: runDirFlag ? path.basename(runDirFlag) : null,
      class: get("--class"), title: get("--title"), body: get("--body"),
      ts: new Date().toISOString(), seq: null,
    };
    const issue = get("--issue");
    if (issue) notif.issue = issue;
    const { body, headers } = formatPayload(config.format, notif);
    const authHeaders = config.token ? { authorization: `Bearer ${config.token}` } : {};
    let sent = 0, failed = 0, error = null;
    try { await postWithRetry(realPost, config.url, body, { ...headers, ...authHeaders }, ANDON_TIMEOUT_MS, ANDON_RETRY_COUNT); sent = 1; }
    catch (e) { failed = 1; error = String((e && e.message) || e); }
    if (asJson) console.log(JSON.stringify({ disabled: false, sent, failed, ...(error ? { error } : {}) }));
    else console.log(failed ? `andon: send failed (${error})` : "andon: sent");
    return 0; // fail-open
  }

  return usageError([{ code: "bad-enum", detail: `unknown andon subcommand '${sub}' — expected pump|send` }], ANDON_USAGE);
}

// ---------------------------------------------------------------------------
// Selftest — exercises the pure core (classify/build/format) plus runPump's
// dedupe/flood-cap/fail-open logic against a tmp run dir with an INJECTED
// postFn (no real sockets — the CLI-level loopback-server exercise lives in
// test/andon.test.mjs, per the spec's own "loopback-testable" principle).
// ---------------------------------------------------------------------------
function andonSelftest() {
  const os = require("node:os");
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

  // --- classifyEvent ---
  ok("park classifies with issue+seq dedupe key",
    JSON.stringify(classifyEvent({ seq: 3, type: "park", issue: "FAFF-1" })) === JSON.stringify({ cls: "park", key: "park:FAFF-1:3" }));
  ok("park with no issue → unclassifiable", classifyEvent({ seq: 3, type: "park" }) === null);
  ok("sentry-trip keys on sorted signal names",
    classifyEvent({ seq: 5, type: "sentry-trip", data: { verdicts: [{ signal: "wall-clock-runaway" }, { signal: "budget-breach" }] } }).key
      === "sentry:budget-breach,wall-clock-runaway");
  ok("budget-checkpoint with breached → budget-breach, sorted dims",
    classifyEvent({ seq: 7, type: "budget-checkpoint", data: { breached: ["tokens", "cost"] } }).key === "budget:cost,tokens");
  ok("budget-checkpoint unbreached → null (not critical)",
    classifyEvent({ seq: 8, type: "budget-checkpoint", data: { breached: [] } }) === null);
  ok("run-end classifies, one dedupe key", classifyEvent({ seq: 9, type: "run-end" }).key === "run-end");
  ok("an ordinary event type → null", classifyEvent({ seq: 10, type: "tidy-done" }) === null);

  // --- classifyEvent: FAFF-781 informational lifecycle classes ---
  ok("issue-admitted with issue → run-level 'admitted' key",
    JSON.stringify(classifyEvent({ seq: 11, type: "issue-admitted", issue: "FAFF-1" })) === JSON.stringify({ cls: "admitted", key: "admitted" }));
  ok("issue-admitted with no issue → unclassifiable", classifyEvent({ seq: 11, type: "issue-admitted" }) === null);
  ok("prep-start with issue → per-issue dedupe key",
    JSON.stringify(classifyEvent({ seq: 12, type: "prep-start", issue: "FAFF-7" })) === JSON.stringify({ cls: "prep-start", key: "prep-start:FAFF-7" }));
  ok("prep-start with no issue → unclassifiable", classifyEvent({ seq: 12, type: "prep-start" }) === null);
  ok("build-start with issue → per-issue dedupe key",
    JSON.stringify(classifyEvent({ seq: 13, type: "build-start", issue: "FAFF-7" })) === JSON.stringify({ cls: "build-start", key: "build-start:FAFF-7" }));
  ok("build-start with no issue → unclassifiable", classifyEvent({ seq: 13, type: "build-start" }) === null);

  // --- buildNotification: minimal-payload assertion ---
  const parkNotif = buildNotification("run-1", 3, "2026-01-01T00:00:00Z", "park", { issue: "FAFF-1", data: { reason: "needs-human" } });
  ok("park notification names the issue + reason, nothing more", parkNotif.title.includes("FAFF-1") && parkNotif.body.includes("needs-human")
    && Object.keys(parkNotif).sort().join(",") === "body,class,issue,run_id,seq,title,ts");

  // --- buildNotification: FAFF-781 informational classes ---
  const admittedNotif = buildNotification("run-1", null, "2026-01-01T00:00:00Z", "admitted", { data: { admitted: ["FAFF-1", "FAFF-2", "FAFF-3"] } });
  ok("admitted notification has NO issue field, lists every admitted id, seq null",
    !("issue" in admittedNotif) && admittedNotif.body.includes("FAFF-1") && admittedNotif.body.includes("FAFF-2") && admittedNotif.body.includes("FAFF-3")
    && admittedNotif.title.includes("3") && admittedNotif.seq === null);
  const prepStartNotif = buildNotification("run-1", 4, "2026-01-01T00:00:00Z", "prep-start", { issue: "FAFF-7" });
  ok("prep-start notification names the run, issue, and stage",
    prepStartNotif.issue === "FAFF-7" && prepStartNotif.title.includes("FAFF-7") && prepStartNotif.body.includes("prep"));
  const buildStartNotif = buildNotification("run-1", 5, "2026-01-01T00:00:00Z", "build-start", { issue: "FAFF-7" });
  ok("build-start notification names the run, issue, and stage",
    buildStartNotif.issue === "FAFF-7" && buildStartNotif.title.includes("FAFF-7") && buildStartNotif.body.includes("build"));
  ok("informational classes get ntfy priority 'default', matching run-end",
    ntfyPriority("admitted") === "default" && ntfyPriority("prep-start") === "default" && ntfyPriority("build-start") === "default");

  // --- formatPayload: all four presets ---
  const n = { run_id: "r", class: "park", issue: "FAFF-1", title: "T", body: "B", ts: "x", seq: 1 };
  ok("generic preset is the JSON record verbatim", JSON.parse(formatPayload("generic", n).body).title === "T");
  const ntfy = formatPayload("ntfy", n);
  ok("ntfy preset is plain-text body + Title/Priority headers", ntfy.body === "B" && ntfy.headers.Title === "T" && ntfy.headers.Priority === "high");
  ok("ntfy priority is urgent for sentry-trip/budget-breach", ntfyPriority("sentry-trip") === "urgent" && ntfyPriority("budget-breach") === "urgent");
  ok("slack preset wraps title+body in {text}", JSON.parse(formatPayload("slack", n).body).text === "T\nB");
  ok("discord preset wraps title+body in {content}", JSON.parse(formatPayload("discord", n).body).content === "T\nB");

  // --- FAFF-926 D2: slackText is total — never empty/whitespace-only `text` ---
  ok("slackText: empty title+body falls back to 'faff <run_id>: <class>'",
    slackText({ run_id: "run-x", class: "sentry-trip", title: "", body: "" }) === "faff run-x: sentry-trip");
  ok("slackText: no run_id/class either → fixed literal fallback",
    slackText({ title: "", body: "  " }) === "faff andon notification");
  ok("slackText: whitespace-only title+body treated as empty (falls back)",
    slackText({ run_id: "r", class: "park", title: "   ", body: "\n" }) === "faff r: park");
  ok("slackText: only body present → body alone (no leading blank line)", slackText({ title: "", body: "B" }) === "B");
  ok("formatPayload slack branch on an all-empty notif never emits whitespace-only text",
    JSON.parse(formatPayload("slack", { title: "", body: "" }).body).text.trim() !== "");

  // --- resolveAndonConfig: defaults + disabled-by-default ---
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-andon-cfg-"));
  try {
    fs.writeFileSync(path.join(tmpRoot, ".faffrc.yaml"), "tracking:\n  repo: x/y\n");
    const cfgDefault = resolveAndonConfig(tmpRoot);
    ok("no andon.url configured ⇒ disabled by default", cfgDefault.url === null);
    ok("default format is generic", cfgDefault.format === "generic");
    ok("default events set is park/sentry-trip/budget-breach", JSON.stringify(cfgDefault.events) === JSON.stringify(ANDON_DEFAULT_EVENTS));

    fs.writeFileSync(path.join(tmpRoot, ".faffrc.yaml"),
      "andon:\n  url: http://localhost:9/hook\n  format: ntfy\n  token: shh\n  events:\n    - park\n    - run-end\n");
    const cfg = resolveAndonConfig(tmpRoot);
    ok("andon.url resolves", cfg.url === "http://localhost:9/hook");
    ok("andon.format resolves", cfg.format === "ntfy");
    ok("andon.token resolves", cfg.token === "shh");
    ok("andon.events resolves + filters to the closed class set", JSON.stringify(cfg.events) === JSON.stringify(["park", "run-end"]));

    fs.writeFileSync(path.join(tmpRoot, ".faffrc.yaml"),
      "andon:\n  url: http://localhost:9/hook\n  events:\n    - admitted\n    - prep-start\n    - build-start\n    - bogus-class\n");
    const cfgInfo = resolveAndonConfig(tmpRoot);
    ok("andon.events accepts the three FAFF-781 informational classes, still drops unknown names",
      JSON.stringify(cfgInfo.events) === JSON.stringify(["admitted", "prep-start", "build-start"]));

    // --- FAFF-926 D1: unset format + Slack-shaped host ⇒ inferred "slack" ---
    ok("isSlackShapedUrl: hooks.slack.com is Slack-shaped", isSlackShapedUrl("https://hooks.slack.com/services/X/Y/Z") === true);
    ok("isSlackShapedUrl: any *.slack.com host is Slack-shaped", isSlackShapedUrl("https://foo.slack.com/hook") === true);
    ok("isSlackShapedUrl: a non-Slack host is not", isSlackShapedUrl("https://example.com/hook") === false);
    ok("isSlackShapedUrl: a malformed URL is not (never throws)", isSlackShapedUrl("not a url") === false);

    fs.writeFileSync(path.join(tmpRoot, ".faffrc.yaml"), "andon:\n  url: https://hooks.slack.com/services/T/B/C\n");
    const cfgSlackInferred = resolveAndonConfig(tmpRoot);
    ok("D1: format UNSET + hooks.slack.com URL ⇒ format inferred 'slack' (the live-box bug)",
      cfgSlackInferred.format === "slack");

    fs.writeFileSync(path.join(tmpRoot, ".faffrc.yaml"), "andon:\n  url: https://hooks.slack.com/services/T/B/C\n  format: generic\n");
    const cfgSlackExplicitGeneric = resolveAndonConfig(tmpRoot);
    ok("D1: an EXPLICIT format (incl. explicit generic) is always obeyed, never overridden by host inference",
      cfgSlackExplicitGeneric.format === "generic");

    fs.writeFileSync(path.join(tmpRoot, ".faffrc.yaml"), "andon:\n  url: https://example.com/hook\n");
    const cfgNonSlackUnset = resolveAndonConfig(tmpRoot);
    ok("D1: format unset + non-Slack URL ⇒ format stays 'generic' (unchanged default)",
      cfgNonSlackUnset.format === "generic");

    fs.writeFileSync(path.join(tmpRoot, ".faffrc.yaml"), "andon:\n  url: https://hooks.slack.com/services/T/B/C\n  format: banana\n");
    const cfgSlackGarbageFormat = resolveAndonConfig(tmpRoot);
    ok("D1: a present-but-garbage format string is NOT treated as unset — falls through to 'generic', no inference",
      cfgSlackGarbageFormat.format === "generic");
  } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }

  // --- runPump: disabled short-circuit writes NO state file ---
  const disabledRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-andon-disabled-"));
  const disabledRun = fs.mkdtempSync(path.join(os.tmpdir(), "faff-andon-disabled-run-"));
  const disabledDone = (async () => {
    try {
      fs.writeFileSync(path.join(disabledRoot, ".faffrc.yaml"), "tracking:\n  repo: x/y\n");
      fs.writeFileSync(path.join(disabledRun, "events.jsonl"), JSON.stringify({ schema: 2, run_id: "r", seq: 0, type: "park", issue: "FAFF-1", phase: "prep", data: { reason: "x" } }) + "\n");
      const r = await runPump(disabledRoot, disabledRun);
      ok("disabled config → { disabled:true }, zero sends", r.disabled === true && r.sent === 0);
      ok("disabled config → no andon-state.json written", !fs.existsSync(andonStatePath(disabledRun)));
    } finally { fs.rmSync(disabledRoot, { recursive: true, force: true }); fs.rmSync(disabledRun, { recursive: true, force: true }); }
  })();

  // --- runPump: dedupe across repeated checkpoints, flood cap, fail-open cursor-hold ---
  const pumpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-andon-pump-"));
  const pumpRun = fs.mkdtempSync(path.join(os.tmpdir(), "faff-andon-pump-run-"));
  const pumpDone = (async () => {
    try {
      fs.writeFileSync(path.join(pumpRoot, ".faffrc.yaml"), "andon:\n  url: http://fixture.invalid/hook\n");
      // Five budget-checkpoint events, all breached:["tokens"] — spec scenario: exactly one notification.
      const lines = [];
      for (let i = 0; i < 5; i++) lines.push(JSON.stringify({ schema: 2, run_id: "r", seq: i, type: "budget-checkpoint", phase: "run", data: { breached: ["tokens"] } }));
      fs.writeFileSync(path.join(pumpRun, "events.jsonl"), lines.join("\n") + "\n");
      let calls = 0;
      const alwaysOk = async () => { calls++; return { statusCode: 200, body: "" }; };
      const r1 = await runPump(pumpRoot, pumpRun, alwaysOk);
      ok("5 persisting budget-checkpoints → exactly ONE send (dedupe)", r1.sent === 1 && calls === 1);
      ok("cursor advances past all 5 processed events", r1.cursor === 5);
      const r2 = await runPump(pumpRoot, pumpRun, alwaysOk);
      ok("second pump, no new events → zero sends", r2.sent === 0 && r2.skipped === 0);

      // Fail-open: a failing postFn records the failure and HOLDS the cursor.
      fs.writeFileSync(path.join(pumpRun, "events.jsonl"), JSON.stringify({ schema: 2, run_id: "r", seq: 5, type: "park", issue: "FAFF-9", phase: "build", data: { reason: "y" } }) + "\n");
      const alwaysFail = async () => { throw new Error("refused"); };
      const r3 = await runPump(pumpRoot, pumpRun, alwaysFail);
      ok("send failure → exit-0 semantics preserved by the caller (runPump itself never throws)", r3.failed === 1 && r3.sent === 0);
      ok("send failure → cursor does NOT advance past the failed event", r3.cursor === 5);
      const r4 = await runPump(pumpRoot, pumpRun, alwaysOk);
      ok("a later pump against a recovered endpoint delivers the held park", r4.sent === 1 && r4.cursor === 6);

      // Flood cap: 15 distinct budget dimension-sets → 10 sends + 1 rollup = 11 total.
      const floodLines = [];
      for (let i = 0; i < 15; i++) floodLines.push(JSON.stringify({ schema: 2, run_id: "r", seq: 100 + i, type: "budget-checkpoint", phase: "run", data: { breached: [`dim${i}`] } }));
      fs.writeFileSync(path.join(pumpRun, "events.jsonl"), floodLines.join("\n") + "\n");
      writeAndonState(pumpRun, { cursor: 100, notified: [], failures: [] });
      let floodCalls = 0;
      const countOk = async () => { floodCalls++; return { statusCode: 200, body: "" }; };
      const r5 = await runPump(pumpRoot, pumpRun, countOk);
      ok("15 pending critical events → 10 sends + 1 rollup = 11 POSTs (flood cap)", floodCalls === 11 && r5.sent === 11);
      ok("flood cap still advances the cursor past every covered event", r5.cursor === 115);
    } finally { fs.rmSync(pumpRoot, { recursive: true, force: true }); fs.rmSync(pumpRun, { recursive: true, force: true }); }
  })();

  // --- runPump: FAFF-781 informational classes — admission aggregation, per-issue
  // start dedupe, and the "default config sees zero informational sends" floor ---
  const infoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-andon-info-"));
  const infoRun = fs.mkdtempSync(path.join(os.tmpdir(), "faff-andon-info-run-"));
  const informationalDone = (async () => {
    try {
      // Default config (no andon.events override) sees the informational events but sends nothing.
      fs.writeFileSync(path.join(infoRoot, ".faffrc.yaml"), "andon:\n  url: http://fixture.invalid/hook\n");
      fs.writeFileSync(path.join(infoRun, "events.jsonl"), [
        { schema: 2, run_id: "r", seq: 0, type: "issue-admitted", issue: "FAFF-1", phase: "run" },
        { schema: 2, run_id: "r", seq: 1, type: "prep-start", issue: "FAFF-1", phase: "prep" },
        { schema: 2, run_id: "r", seq: 2, type: "build-start", issue: "FAFF-1", phase: "build" },
      ].map((e) => JSON.stringify(e)).join("\n") + "\n");
      let defaultCalls = 0;
      const countOk = async () => { defaultCalls++; return { statusCode: 200, body: "" }; };
      const rDefault = await runPump(infoRoot, infoRun, countOk);
      ok("default andon.events (no informational classes opted in) → zero informational sends", rDefault.sent === 0 && defaultCalls === 0);

      // Opt into all three; re-pump the SAME (already-cursor-advanced) run — reset state
      // to re-classify from scratch, this time with an admission summary + two starts.
      writeAndonState(infoRun, { cursor: 0, notified: [], failures: [] });
      fs.writeFileSync(path.join(infoRoot, ".faffrc.yaml"),
        "andon:\n  url: http://fixture.invalid/hook\n  events:\n    - admitted\n    - prep-start\n    - build-start\n");
      fs.writeFileSync(path.join(infoRun, "events.jsonl"), [
        { schema: 2, run_id: "r", seq: 0, type: "issue-admitted", issue: "FAFF-1", phase: "run" },
        { schema: 2, run_id: "r", seq: 1, type: "issue-admitted", issue: "FAFF-2", phase: "run" },
        { schema: 2, run_id: "r", seq: 2, type: "issue-admitted", issue: "FAFF-3", phase: "run" },
        { schema: 2, run_id: "r", seq: 3, type: "prep-start", issue: "FAFF-1", phase: "prep" },
        { schema: 2, run_id: "r", seq: 4, type: "build-start", issue: "FAFF-1", phase: "build" },
        { schema: 2, run_id: "r", seq: 5, type: "build-start", issue: "FAFF-1", phase: "build" }, // re-dispatch — must dedupe
      ].map((e) => JSON.stringify(e)).join("\n") + "\n");
      const posted = [];
      const capture = async (url, body) => { posted.push(JSON.parse(body)); return { statusCode: 200, body: "" }; };
      const rInfo = await runPump(infoRoot, infoRun, capture);
      ok("3 issue-admitted + 1 prep-start + 2 build-start(dup) → exactly 3 sends (1 admitted summary, deduped build-start)",
        rInfo.sent === 3 && posted.length === 3);
      const admitted = posted.find((p) => p.class === "admitted");
      ok("admitted summary lists FAFF-1/2/3 and carries no issue field",
        !!admitted && !("issue" in admitted) && ["FAFF-1", "FAFF-2", "FAFF-3"].every((id) => admitted.body.includes(id)));
      const prep = posted.find((p) => p.class === "prep-start");
      ok("prep-start notification names the run, issue FAFF-1, and stage", !!prep && prep.issue === "FAFF-1" && prep.body.includes("prep"));
      const build = posted.filter((p) => p.class === "build-start");
      ok("build-start sent exactly once despite two events (dedupe key build-start:FAFF-1)", build.length === 1 && build[0].issue === "FAFF-1");
      ok("run-critical classification/behaviour is untouched by the informational additions",
        JSON.stringify(ANDON_DEFAULT_EVENTS) === JSON.stringify(["park", "sentry-trip", "budget-breach"]));
    } finally { fs.rmSync(infoRoot, { recursive: true, force: true }); fs.rmSync(infoRun, { recursive: true, force: true }); }
  })();

  return Promise.all([disabledDone, pumpDone, informationalDone]).then(() => {
    console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (andon --selftest, ${fail} failed)`);
    return fail ? 1 : 0;
  });
}

module.exports = {
  ANDON_CLASSES, ANDON_DEFAULT_EVENTS, ANDON_FLOOD_CAP, ANDON_FORMATS, ANDON_SPEC, ANDON_SURFACE,
  andonSelftest, andonStatePath, buildNotification, classifyEvent, cmdAndon, formatPayload,
  isSlackShapedUrl, ntfyPriority, readAndonState, readEventsSince, realPost, realPostRaw,
  resolveAndonConfig, runPump, slackText, synthesizeProbeNotification, writeAndonState,
};
