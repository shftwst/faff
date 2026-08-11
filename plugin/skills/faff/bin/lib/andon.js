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
const ANDON_CLASSES = ["park", "sentry-trip", "budget-breach", "run-end"];
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
  },
  positionals: { min: 1, max: 1, name: "verb" },
};
const ANDON_USAGE = "usage: faff andon pump --run-dir DIR [--json] | faff andon send --class C --title T --body B [--issue ID] [--run-dir DIR] [--json]";
// FAFF-628 — declared grammar (cli-surface.js's drift-guard source).
const ANDON_SURFACE = {
  kind: "subcommand_dispatch",
  spec: ANDON_SPEC,
  subcommands: {
    pump: { required_flags: ["--run-dir"] },
    send: { required_flags: ["--class", "--title", "--body"] },
  },
};

// ---------------------------------------------------------------------------
// Config resolution — `andon.*` via the factory config resolver (`loadConfig`),
// mirroring `adr.js`'s use of the same reader. Defaults are applied LOCALLY here
// (never baked into config.js's DEFAULTS registry) — same posture budget.js's
// header note documents for its own governance-region defaults.
// ---------------------------------------------------------------------------
function resolveAndonConfig(root) {
  const [data] = loadConfig(root);
  const url = dig(data, "andon.url");
  const format = dig(data, "andon.format");
  const token = dig(data, "andon.token");
  const eventsCfg = dig(data, "andon.events");
  const events = Array.isArray(eventsCfg) && eventsCfg.length
    ? eventsCfg.filter((e) => ANDON_CLASSES.includes(e))
    : ANDON_DEFAULT_EVENTS.slice();
  return {
    url: typeof url === "string" && url.trim() ? url.trim() : null,
    format: ANDON_FORMATS.includes(format) ? format : "generic",
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
    return { body: JSON.stringify({ text: `${notif.title}\n${notif.body}` }), headers: { "content-type": "application/json" } };
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

    const notif = buildNotification(event.run_id || path.basename(runDir), event.seq, new Date().toISOString(), cls, event);
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
  ok("an ordinary event type → null", classifyEvent({ seq: 10, type: "issue-admitted" }) === null);

  // --- buildNotification: minimal-payload assertion ---
  const parkNotif = buildNotification("run-1", 3, "2026-01-01T00:00:00Z", "park", { issue: "FAFF-1", data: { reason: "needs-human" } });
  ok("park notification names the issue + reason, nothing more", parkNotif.title.includes("FAFF-1") && parkNotif.body.includes("needs-human")
    && Object.keys(parkNotif).sort().join(",") === "body,class,issue,run_id,seq,title,ts");

  // --- formatPayload: all four presets ---
  const n = { run_id: "r", class: "park", issue: "FAFF-1", title: "T", body: "B", ts: "x", seq: 1 };
  ok("generic preset is the JSON record verbatim", JSON.parse(formatPayload("generic", n).body).title === "T");
  const ntfy = formatPayload("ntfy", n);
  ok("ntfy preset is plain-text body + Title/Priority headers", ntfy.body === "B" && ntfy.headers.Title === "T" && ntfy.headers.Priority === "high");
  ok("ntfy priority is urgent for sentry-trip/budget-breach", ntfyPriority("sentry-trip") === "urgent" && ntfyPriority("budget-breach") === "urgent");
  ok("slack preset wraps title+body in {text}", JSON.parse(formatPayload("slack", n).body).text === "T\nB");
  ok("discord preset wraps title+body in {content}", JSON.parse(formatPayload("discord", n).body).content === "T\nB");

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

  return Promise.all([disabledDone, pumpDone]).then(() => {
    console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (andon --selftest, ${fail} failed)`);
    return fail ? 1 : 0;
  });
}

module.exports = {
  ANDON_CLASSES, ANDON_DEFAULT_EVENTS, ANDON_FLOOD_CAP, ANDON_FORMATS, ANDON_SPEC, ANDON_SURFACE,
  andonSelftest, andonStatePath, buildNotification, classifyEvent, cmdAndon, formatPayload,
  ntfyPriority, readAndonState, readEventsSince, realPost, resolveAndonConfig, runPump, writeAndonState,
};
