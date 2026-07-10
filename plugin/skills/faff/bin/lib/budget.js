// ===========================================================================
// === region:governance — budget — FAFF-36: run cost / compute budgeting. ===
//
// `faff budget check` is a PURE CLI (parity with `faff next` / `faff eligible`):
// reads the run-ledger + config + the run's local transcripts and emits a
// BudgetState JSON. NO tracker call, NO network. It generalises beep-boop's
// `--until` / `--max` flags into one BudgetEnvelope across four dimensions
// (until · max_attempts · tokens · cost) with three at-ceiling outcomes
// (stop | narrow | escalate, default stop).
//
// The contract FAFF-38/FAFF-225 consume is the ceiling + outcome; HOW spend is
// accounted is a swappable producer behind it (the issue's slot framing). The
// default accounting producer is the transcript-sum implemented here.
//
// Layering, deliberately split so the judgement-free core is unit-testable
// without disk:
//   - envelopeFrom(config, flags)      → resolve BudgetEnvelope (flags override config)
//   - computeBudgetState(env, spent, tokens_source) → pure BudgetState (no I/O)
//   - measureTokens(...)               → transcript-sum accounting (the only I/O)
//   - cmdBudget(args)                  → wires ledger + config + transcripts → JSON
//
// FAFF-364: a malformed `until` (config `budget.until` or `--until`) is never a
// vacuous ceiling that silently never breaches — `BudgetEnvelope.until_invalid`
// (additive) names the raw offending value (parseHHMM-rejected) while
// `ceilings.until` stays null; `computeBudgetState` ignores `until_invalid`
// entirely. `cmdBudget` surfaces it as `BudgetState.warnings` (additive, present
// only when non-empty) — `breached` can never contain "until" for it, and the
// exit code stays 0 (a hard failure here would fail-open the whole budget signal
// for `sentryReadBudget`/`run-done --budget`, which degrade any non-zero child
// exit to the unbreached default). The `lights-out` L4 preflight is the loud,
// gating counterpart — it refuses to mint a run carrying malformed `until` at all.
//
// FAFF-425: `BudgetState.outcome` gains an `"indeterminate"` member (plus
// additive `indeterminate?:bool` + `reason?:string`) for a DIFFERENT failure
// class than FAFF-364's malformed-until warning: the run's own ledger being
// unreadable (present-but-corrupt, or an explicitly-named run whose ledger is
// gone) rather than a bad config value. That is an own-FAULT, never a legitimate
// unbreached reading — it surfaces via `resolveLedgerOrFault` as a distinct exit
// 3, never silently coerced to `outcome:"none"`. A legitimately empty surface
// (no run requested, none found) is unaffected and stays `outcome:"none"` at
// exit 0, byte-for-byte as before.
// ===========================================================================

// Governance-region config read: resolves ONLY the governance keys (`budget.*`,
// `sentry.*`) via shared-infra parseYamlSubset + dig — never the factory's
// loadConfig/DEFAULTS/resolveAppetite (appetite/L4 ledger semantics are factory-
// flavoured; routing governance reads through them was the one governance→factory
// edge, severed here). Filename resolution mirrors loadConfig for the paths these
// reads exercise: accept ONLY `.faffrc.yaml`; absent → {} (same missing-file
// behaviour); for a linked git worktree lacking its per-checkout copy, fall back to
// the MAIN checkout's config (the worktree seam, replicated locally so budget/sentry
// resolve identically pre/post carve). Legacy-name (`.faffrc.yml` / `.faffrc`)
// detection remains the factory config command's concern — a governance read simply
// does not see a legacy-named file. Defaults stay applied locally at each consumer
// (envelopeFrom's fallbacks, est_tokens_per_attempt, SENTRY_THRESHOLD_DEFAULTS) —
// no default value changes.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { CANONICAL_CONFIG, dig, findConfig, findRoot, parseYamlSubset, resolveLedgerOrFault } = require("./shared-infra");

function readGovernanceConfig(root) {
  // Governance config read (budget.* / sentry.* only). Resolution — canonical name,
  // legacy-name refusal, linked-worktree fallback — is the shared resolver's
  // (findConfig): a governance ceiling must never silently vanish because the rc
  // file is mis-named, so the legacy error is as LOUD here as in the config command.
  let rc;
  try { rc = findConfig(root); } catch (e) {
    if (e.message === "legacy-config-name") {
      const names = e.legacy.join(", ");
      process.stderr.write(
        "faff: legacy config filename found (" + names + "). faff uses only `" + CANONICAL_CONFIG +
        "` — rename it to `" + CANONICAL_CONFIG + "`. (Loud error, never a silent default — " +
        "a governance ceiling must not disappear on a filename mistake.)\n");
      process.exit(2);
    }
    throw e;
  }
  if (rc === null) return {};
  const data = parseYamlSubset(fs.readFileSync(rc, "utf8"));
  return (data && typeof data === "object" && !Array.isArray(data)) ? data : {};
}
const BUDGET_DIMENSIONS = ["until", "max_attempts", "tokens", "cost"];
const AT_CEILING_OUTCOMES = new Set(["stop", "narrow", "escalate"]);
const BUDGET_TOKEN_USAGE_KEYS = [
  "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens",
];
// FAFF-408: the four token-delta CLASSES (pivot-friendly names) and their mapping
// onto the raw transcript usage keys above. `sumTranscriptFileByClass` splits by
// these; the sum of the four equals `sumTranscriptFile` on the same file (parity).
const TOKEN_DELTA_CLASSES = ["input", "output", "cache_write", "cache_read"];
const TOKEN_CLASS_FROM_USAGE = {
  input: "input_tokens",
  output: "output_tokens",
  cache_write: "cache_creation_input_tokens",
  cache_read: "cache_read_input_tokens",
};

// FAFF-364 — the ONE `HH:MM` parser: hour 0-23, two-digit minute 0-59, `\d{1,2}`
// hour, `trim()`'d. Returns `{h, min}` on a well-formed value, `null` on anything
// else (never throws) — `untilToEpoch` and `resolve_until` (envelopeFrom /
// envelopeFromLedger) both delegate here so a malformed `until` is classified
// identically wherever it is read.
function parseHHMM(value) {
  if (value == null) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}

// `--until HH:MM` → an absolute epoch-ms relative to `nowMs`, next-day if already past
// (mirrors beep-boop's `--until` semantic: `--until 06:00` at 23:00 means 06:00 tomorrow).
// Returns null on a malformed value (treated as no ceiling — never throws). Defensive:
// unreachable from real callers since FAFF-364 (resolve_until already rejected a
// malformed value before it can reach here), kept so a direct call stays safe.
function untilToEpoch(hhmm, nowMs) {
  const parsed = parseHHMM(hhmm);
  if (!parsed) return null;
  const { h, min } = parsed;
  const now = new Date(nowMs);
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min, 0, 0);
  let t = target.getTime();
  if (t <= nowMs) t += 24 * 60 * 60 * 1000; // past → next-day same time
  return t;
}

// FAFF-364 — resolve a raw `until` value (already flag-over-config selected) into
// its ceiling + invalid-flag pair: null raw → no ceiling, no error; a well-formed
// HH:MM → the ceiling (stringified), no error; anything else (garbage, `""`) →
// no ceiling AND `until_invalid` names the raw value so it surfaces instead of
// silently vanishing. `--until ""` takes this malformed branch (flagged garbage
// is loud, not treated as "unset").
function resolveUntil(raw) {
  if (raw == null) return { until: null, until_invalid: null };
  if (parseHHMM(raw)) return { until: String(raw), until_invalid: null };
  return { until: null, until_invalid: String(raw) };
}

// Resolve the BudgetEnvelope from config (the `budget:` block) + CLI flag overrides.
// Flags (--until / --max) override config (parity with beep-boop's existing flags).
// An unset dimension is `null` (unbounded). `price_per_mtok` 0 disables the cost dim.
// Returns { ceilings: {until,max_attempts,tokens,cost}, at_ceiling, price_per_mtok }.
function envelopeFrom(cfg, flags) {
  const b = (cfg && typeof cfg === "object" && cfg.budget && typeof cfg.budget === "object") ? cfg.budget : {};
  const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  // Flag-over-config precedence UNCHANGED: --until wins over budget.until when present.
  const rawUntil = (flags && flags.until != null) ? flags.until : (b.until != null ? String(b.until) : null);
  const { until, until_invalid } = resolveUntil(rawUntil); // FAFF-364: malformed → null ceiling + loud flag
  const maxAttempts = (flags && flags.max_attempts != null) ? num(flags.max_attempts) : num(b.max_attempts);
  const tokens = num(b.tokens);
  const price = num(b.price_per_mtok) || 0;
  // cost ceiling only meaningful when a price is configured; price 0 disables the cost dimension.
  const cost = price > 0 ? num(b.cost) : null;
  let atCeiling = b.at_ceiling != null ? String(b.at_ceiling).trim().toLowerCase() : "stop";
  if (!AT_CEILING_OUTCOMES.has(atCeiling)) atCeiling = "stop"; // unknown coerces to the safe default
  return {
    ceilings: { until, max_attempts: maxAttempts, tokens, cost },
    until_invalid,
    at_ceiling: atCeiling,
    price_per_mtok: price,
  };
}

// PURE BudgetState core — no I/O. Given the resolved envelope, the measured spend
// across dimensions, and the token source label, compute which ceilings are
// breached and the resulting outcome. `breached ≠ ∅` is the terminating signal.
// `spent` = { elapsed_ms, until_epoch, attempts, tokens, cost }. A dimension with
// a null ceiling is unbounded and can never breach.
function computeBudgetState(env, spent, tokensSource) {
  const c = env.ceilings;
  const breached = [];
  // until: breach when the wall clock has reached/passed the resolved until-epoch.
  if (c.until != null && spent.until_epoch != null && spent.now_epoch != null && spent.now_epoch >= spent.until_epoch) {
    breached.push("until");
  }
  if (c.max_attempts != null && spent.attempts >= c.max_attempts) breached.push("max_attempts");
  if (c.tokens != null && spent.tokens >= c.tokens) breached.push("tokens");
  if (c.cost != null && spent.cost != null && spent.cost >= c.cost) breached.push("cost");
  const outcome = breached.length ? env.at_ceiling : "none";
  return {
    spent: {
      elapsed_ms: spent.elapsed_ms ?? null,
      attempts: spent.attempts ?? 0,
      tokens: spent.tokens ?? 0,
      cost: spent.cost ?? null,
    },
    tokens_source: tokensSource,
    breached,
    outcome,
  };
}

// Encode a cwd to its ~/.claude/projects/<encoded> directory name: '/' → '-'.
// (Claude Code's transcript project-dir convention.) Honours $CLAUDE_CONFIG_DIR.
function transcriptBaseDir(cwd, env) {
  const home = env.HOME || env.USERPROFILE || "";
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const encoded = String(cwd).replace(/\//g, "-");
  return path.join(configDir, "projects", encoded);
}

// Sum usage tokens across a single transcript .jsonl file, SPLIT BY CLASS. Each
// line is a JSON record; assistant messages carry message.usage. Malformed lines
// are skipped (a partial/in-flight transcript must never crash the budget check).
// FAFF-408: this is the single read/parse loop; `sumTranscriptFile` derives its
// scalar total by summing the four classes, so there is exactly ONE token
// attribution path (never a divergent private recount — the FAFF-229 guard-rail).
function sumTranscriptFileByClass(file) {
  const acc = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return acc; }
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; }
    const usage = rec && rec.message && rec.message.usage ? rec.message.usage
      : (rec && rec.usage ? rec.usage : null);
    if (!usage || typeof usage !== "object") continue;
    for (const cls of TOKEN_DELTA_CLASSES) {
      const v = usage[TOKEN_CLASS_FROM_USAGE[cls]];
      if (typeof v === "number" && Number.isFinite(v)) acc[cls] += v;
    }
  }
  return acc;
}

// Scalar total for a single transcript file — the sum of the four classes on the
// same file (parity holds by construction, since the class keys are exactly
// BUDGET_TOKEN_USAGE_KEYS mapped 1:1).
function sumTranscriptFile(file) {
  const c = sumTranscriptFileByClass(file);
  return c.input + c.output + c.cache_write + c.cache_read;
}

// The owning session of a child agent-*.jsonl transcript: the top-level
// `sessionId` on its first parseable record, which Claude Code stamps equal to
// the parent orchestrator's session id (the `<sessionId>.jsonl` filename stem).
// That field — not the file's mtime — is the reliable "which run owns this
// child" signal (FAFF-229). Returns the id, or null when no record carries a
// non-empty string sessionId (malformed/partial/legacy → unattributable, which
// the caller excludes — undercount-not-overcount). Reads only up to the first
// parseable record that carries a sessionId; pure (local read, no network).
function childOwningSession(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; }
    if (rec && typeof rec.sessionId === "string" && rec.sessionId) return rec.sessionId;
  }
  return null;
}

// Measure this-run token spend SPLIT BY CLASS: the orchestrator transcript (keyed
// off $CLAUDE_CODE_SESSION_ID — NEVER mtime-newest, which can be a different
// session) + every child agent-*.jsonl whose own records carry that same session
// id (subagent grafts dominate run spend and live in separate files, not sidechain
// entries). Returns { tokens, source }: source 'transcript' with the four-class
// object when the session file was read, 'estimate' with tokens:null when no
// transcript is available (caller supplies the estimate).
// FAFF-408: this is the ONE attribution loop — `measureTokens` (the scalar total)
// derives from it, so the by-class deltas and the budget total share a single
// child-attribution gate and can never drift (the FAFF-229 over-count guard-rail).
// The ordered set of transcript files a run OWNS: its `<sid>.jsonl` orchestrator
// transcript first, then every child `agent-*.jsonl` whose own first-record
// sessionId === sid (the FAFF-229 attribution gate; mtime is a cheap pre-filter
// only, NEVER the gate). Returns null — the estimate-degrade signal — when the
// transcript is unavailable (no sid, dir missing, session file absent). This is
// the SINGLE file-selection resolver: `measureTokensByClass` (the budget/economics
// scalar total) and the FAFF-410 `--by` breakdown both walk it, so the breakdown
// reconciles to the top-line total by construction — never a divergent census.
function sessionOwnedTranscriptFiles(base, sid, runStartMs) {
  const sessionFile = sid ? path.join(base, `${sid}.jsonl`) : null;
  if (!sid || !fs.existsSync(base) || !sessionFile || !fs.existsSync(sessionFile)) return null;
  const files = [sessionFile];
  // Aggregate this run's child subagent transcripts — attributed by their OWNING
  // SESSION (childOwningSession === sid), NOT by mtime. mtime is a wall-clock touch
  // time, not an ownership signal: a prior/parallel run's child touched after this
  // run's start would otherwise be swept in and OVER-count (FAFF-229). The
  // `mtime >= runStartMs` comparison is kept only as a cheap PRE-FILTER (skip
  // obviously-old files without opening them) — a same-session child necessarily
  // post-dates run start, so the pre-filter can only skip files the session match
  // would also reject; removing it changes speed, never the total. A child whose
  // session is unattributable/foreign is excluded — lowering, never raising, the
  // figure (undercount-not-overcount). The null-runStartMs degenerate path can't
  // pre-filter; the session match alone decides (still correct).
  let entries = [];
  try { entries = fs.readdirSync(base); } catch { entries = []; }
  for (const name of entries) {
    if (!/^agent-.*\.jsonl$/.test(name)) continue;
    const f = path.join(base, name);
    if (runStartMs != null) {
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < runStartMs) continue; // cheap pre-filter (NOT the attribution gate)
    }
    if (childOwningSession(f) !== sid) continue; // attribution gate: owned by THIS run only
    files.push(f);
  }
  return files;
}

function measureTokensByClass(opts) {
  const { cwd, env, runStartMs } = opts;
  const sid = env.CLAUDE_CODE_SESSION_ID;
  const base = transcriptBaseDir(cwd, env);
  const files = sessionOwnedTranscriptFiles(base, sid, runStartMs);
  // Transcript unavailable (no session id, dir missing, or session file absent —
  // e.g. CLAUDE_CODE_SKIP_PROMPT_HISTORY) → estimate fallback (caller computes).
  if (!files) return { tokens: null, source: "estimate" };
  const acc = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  for (const f of files) {
    const c = sumTranscriptFileByClass(f);
    for (const cls of TOKEN_DELTA_CLASSES) acc[cls] += c[cls];
  }
  return { tokens: acc, source: "transcript" };
}

// Scalar this-run total: the sum of the four classes measureTokensByClass returns
// (same session file + same child-attribution gate). Returns { total, source }:
// 'transcript' + summed total, or 'estimate' + null (caller supplies the estimate).
function measureTokens(opts) {
  const m = measureTokensByClass(opts);
  if (m.source !== "transcript") return { total: null, source: "estimate" };
  const t = m.tokens;
  return { total: t.input + t.output + t.cache_write + t.cache_read, source: "transcript" };
}

// Count build attempts from the ledger: every issue with a recorded terminal
// outcome that represents a dispatched build (launch-counted, parity with
// beep-boop's --max which "counts every build-queue dispatch regardless of
// outcome"). routed-out / unreached-budget never got a graft invocation, so they
// don't count. Falls back to the admitted count when outcomes are absent.
const BUDGET_NON_ATTEMPT_OUTCOMES = new Set(["routed-out", "unreached-budget"]);
function attemptsFromLedger(ledger) {
  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object") ? ledger.outcomes : {};
  const keys = Object.keys(outcomes);
  if (keys.length) return keys.filter((k) => !BUDGET_NON_ATTEMPT_OUTCOMES.has(outcomes[k])).length;
  return Array.isArray(ledger && ledger.admitted) ? ledger.admitted.length : 0;
}

// Hermetic, TEST-ONLY clock seam for `budget check` (FAFF-302) — the structural
// twin of `resolveSentryNow` (FAFF-301). Resolves the instant the time-based
// fields (spent.elapsed_ms, the resolved --until wall-clock) are computed against,
// so a test can pin `now` and stop flaking on the time of day the suite runs at.
// Precedence: --now-ms > --now <ISO> > Date.now() (the unchanged production
// default; no production caller passes a flag). An injected-but-unparseable value
// is a HARD ERROR (never a silent Date.now() fall-through), mirroring `sentry check`
// and `park-history --now`.
//
// Deliberately EXPLICIT-FLAG-ONLY — no ambient/env form. The only override is a
// per-invocation flag a caller types; there is no inherited `$FAFF_NOW_MS` a child
// process could carry into a parent's invocation, so an isolated build subagent has
// no ambient channel into budget's clock. (Budget breaches are config-and-ledger
// driven regardless — a clock value can never relax max_attempts/tokens/cost.)
function resolveBudgetNow(get) {
  const nowMsArg = get("--now-ms");
  if (nowMsArg != null) {
    const n = Number(nowMsArg);
    if (!Number.isFinite(n)) return { error: `--now-ms '${nowMsArg}' is not a finite epoch-millis value` };
    return { now_ms: n };
  }
  const nowArg = get("--now");
  if (nowArg != null) {
    const n = Date.parse(nowArg);
    if (Number.isNaN(n)) return { error: `--now '${nowArg}' is not a parseable ISO-8601 timestamp` };
    return { now_ms: n };
  }
  return { now_ms: Date.now() }; // unchanged production default
}

function cmdBudget(args) {
  if (args.includes("--selftest")) return budgetSelftest();
  const sub = args.find((a) => !a.startsWith("-"));
  if (sub !== "check") { process.stderr.write("usage: faff budget check [--run-dir DIR] [--until HH:MM] [--max N] [--now-ms MS | --now ISO] [--json]\n"); return 2; }

  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const flags = { until: get("--until"), max_attempts: get("--max") };
  const root = get("--root") || findRoot();

  // --now-ms/--now is a usage error (exit 2) — resolved BEFORE ledger evaluation,
  // same as before FAFF-425 (distinct from the ledger-fault exit 3 below).
  const nowRes = resolveBudgetNow(get); // hermetic test-only clock seam (FAFF-302)
  if (nowRes.error) { process.stderr.write(`faff budget check: ${nowRes.error}\n`); return 2; }
  const nowMs = nowRes.now_ms;

  // FAFF-425: the run's own inability to read its ledger is a distinct, loud
  // "indeterminate" fault (exit 3) — never silently coerced into the all-clear/
  // unbreached JSON a swallowed exception used to produce here. A legitimately
  // empty surface (no run requested, none found) is NOT a fault and keeps the
  // unchanged byte-for-byte all-clear path below.
  const resolved = resolveLedgerOrFault(get, root);
  if (resolved.fault) {
    console.log(JSON.stringify({
      spent: { elapsed_ms: null, attempts: 0, tokens: 0, cost: null },
      tokens_source: null,
      breached: [],
      outcome: "indeterminate",
      indeterminate: true,
      reason: resolved.fault,
    }));
    return 3;
  }
  const runDir = resolved.empty ? null : resolved.runDir;
  const ledger = resolved.empty ? {} : resolved.ledger;

  const cfg = readGovernanceConfig(root);
  // A ledger may carry a pre-resolved envelope (recorded at run start by the
  // orchestrator); CLI flags still override. Else resolve fresh from config+flags.
  const ledgerEnv = (ledger.budget && typeof ledger.budget === "object" && ledger.budget.envelope) || null;
  const env = ledgerEnv ? envelopeFromLedger(ledgerEnv, flags, cfg) : envelopeFrom(cfg, flags);

  const ownerStart = ledger.owner && ledger.owner.started_at ? Date.parse(ledger.owner.started_at) : null;
  const runStartMs = Number.isFinite(ownerStart) ? ownerStart : null;
  const tokensAtStart = (ledger.budget && typeof ledger.budget.tokens_at_start === "number") ? ledger.budget.tokens_at_start : 0;

  // Token accounting (the only I/O). Estimate fallback when the transcript is gone.
  const measured = measureTokens({ cwd: root, env: process.env, runStartMs });
  let tokens, tokensSource;
  if (measured.source === "transcript") {
    tokens = Math.max(0, measured.total - tokensAtStart); // this-run delta, baselined at run start
    tokensSource = "transcript";
  } else {
    const attemptsForEst = attemptsFromLedger(ledger);
    const estPer = Number(dig(cfg, "budget.est_tokens_per_attempt")) || 200000;
    tokens = attemptsForEst * estPer;
    tokensSource = "estimate";
  }

  const attempts = attemptsFromLedger(ledger);
  const cost = env.price_per_mtok > 0 ? (tokens / 1_000_000) * env.price_per_mtok : null;
  const untilEpoch = untilToEpoch(env.ceilings.until, nowMs);

  const state = computeBudgetState(env, {
    now_epoch: nowMs,
    until_epoch: untilEpoch,
    elapsed_ms: runStartMs != null ? nowMs - runStartMs : null,
    attempts,
    tokens,
    cost,
  }, tokensSource);

  // FAFF-364 — a malformed until (config or --until) degrades to a WARNING, never a
  // hard failure: sentryReadBudget/run-done --budget treat any non-zero exit as the
  // unbreached default, so exiting non-zero here would fail-OPEN the whole budget
  // signal and mask a real live tokens/cost breach. `breached` can never contain
  // "until" for a malformed value (computeBudgetState never saw a ceiling for it).
  // Additive: `warnings` is present ONLY when non-empty, so a clean envelope's JSON
  // stays byte-identical to before this change.
  if (env.until_invalid != null) {
    const msg = `budget.until '${env.until_invalid}' is not a valid HH:MM — until ceiling ignored`;
    state.warnings = [msg];
    process.stderr.write(`faff budget check: ${msg}\n`);
  }

  console.log(JSON.stringify(state));
  return 0;
}

// When the ledger carries a pre-resolved envelope, honour it but let live CLI
// flags override the until/max dimensions (config supplies price/at_ceiling
// fallbacks the recorded envelope may predate).
function envelopeFromLedger(rec, flags, cfg) {
  const fresh = envelopeFrom(cfg, flags);
  const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const recCeil = (rec.ceilings && typeof rec.ceilings === "object") ? rec.ceilings : {};
  let atCeiling = rec.at_ceiling != null ? String(rec.at_ceiling).trim().toLowerCase() : fresh.at_ceiling;
  if (!AT_CEILING_OUTCOMES.has(atCeiling)) atCeiling = "stop";
  // FAFF-364: flags.until still wins over the recorded ceiling; either source is
  // reclassified through resolveUntil so a legacy ledger carrying malformed garbage
  // directly in ceilings.until (minted before this validation existed) surfaces
  // until_invalid on read too. Defence-in-depth: when NOT overridden by a flag and
  // re-derivation finds nothing wrong with ceilings.until (typically because it is
  // null), a record that ALREADY carries an explicit until_invalid is honoured
  // rather than silently dropped — a ledger shape this envelope's own mint path
  // never produces today (cmdLightsOut refuses to mint whenever until_invalid is
  // set), but the read path must not assume it is the only writer forever.
  const usingFlag = !!(flags && flags.until != null);
  const rawUntil = usingFlag ? flags.until : (recCeil.until ?? null);
  const derived = resolveUntil(rawUntil);
  const until = derived.until;
  const until_invalid = !usingFlag && derived.until_invalid == null && rec.until_invalid != null
    ? String(rec.until_invalid)
    : derived.until_invalid;
  return {
    ceilings: {
      until,
      max_attempts: flags && flags.max_attempts != null ? num(flags.max_attempts) : (num(recCeil.max_attempts)),
      tokens: num(recCeil.tokens),
      cost: num(recCeil.cost),
    },
    until_invalid,
    at_ceiling: atCeiling,
    price_per_mtok: num(rec.price_per_mtok) || fresh.price_per_mtok || 0,
  };
}

// Selftest — drives the pure cores (envelopeFrom · untilToEpoch · computeBudgetState
// · attemptsFromLedger) over in-memory cases; no filesystem, no tracker. Mirrors the
// contain/next selftest shape: per-case ok/FAIL + a RESULT line, non-zero on any fail.
function budgetSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };
  const NOW = Date.parse("2026-06-23T12:00:00Z");

  // --- envelopeFrom: config + flag override ---
  const e1 = envelopeFrom({ budget: { max_attempts: 3, at_ceiling: "escalate" } }, {});
  ok("envelope reads config max_attempts", e1.ceilings.max_attempts === 3 && e1.at_ceiling === "escalate");
  const e2 = envelopeFrom({ budget: { max_attempts: 3 } }, { max_attempts: "9" });
  ok("flag --max overrides config", e2.ceilings.max_attempts === 9);
  const e3 = envelopeFrom({}, {});
  ok("unset dims are null + default stop", e3.ceilings.max_attempts === null && e3.ceilings.tokens === null && e3.at_ceiling === "stop");
  const e4 = envelopeFrom({ budget: { at_ceiling: "bogus" } }, {});
  ok("unknown at_ceiling coerces to stop", e4.at_ceiling === "stop");
  const e5 = envelopeFrom({ budget: { cost: 5, price_per_mtok: 0 } }, {});
  ok("price 0 disables cost dimension", e5.ceilings.cost === null);
  const e6 = envelopeFrom({ budget: { cost: 5, price_per_mtok: 3 } }, {});
  ok("price>0 enables cost dimension", e6.ceilings.cost === 5 && e6.price_per_mtok === 3);

  // --- untilToEpoch: next-day-if-past ---
  const future = untilToEpoch("13:00", NOW);
  ok("until future same-day", future > NOW && future - NOW < 2 * 3600 * 1000);
  const past = untilToEpoch("11:00", NOW);
  ok("until past rolls to next day", past > NOW && past - NOW > 22 * 3600 * 1000);
  ok("until malformed → null", untilToEpoch("nope", NOW) === null && untilToEpoch("25:00", NOW) === null);

  // --- FAFF-364: parseHHMM accept/reject table (the one shared parser) ---
  ok("parseHHMM '7:30' ok", (() => { const p = parseHHMM("7:30"); return p && p.h === 7 && p.min === 30; })());
  ok("parseHHMM '07:05' ok", (() => { const p = parseHHMM("07:05"); return p && p.h === 7 && p.min === 5; })());
  ok("parseHHMM ' 23:59 ' trims and ok", (() => { const p = parseHHMM(" 23:59 "); return p && p.h === 23 && p.min === 59; })());
  ok("parseHHMM '07:5' rejected (minute must be two digits)", parseHHMM("07:5") === null);
  ok("parseHHMM '24:00' rejected (hour out of range)", parseHHMM("24:00") === null);
  ok("parseHHMM '07:60' rejected (minute out of range)", parseHHMM("07:60") === null);
  ok("parseHHMM 'always' rejected", parseHHMM("always") === null);
  ok("parseHHMM '' rejected", parseHHMM("") === null);
  ok("parseHHMM null → null", parseHHMM(null) === null);

  // --- FAFF-364: a malformed until resolves to a null ceiling + until_invalid ---
  // (the L4 spend/time-governor consequence — spendTimeCeilingSet lives in the
  // factory/lights-out region and is exercised there, in lightsOutSelftest, per
  // the governance→factory direction invariant this region must not cross).
  const eBadUntil = envelopeFrom({}, { until: "garbage" });
  ok("malformed --until → ceilings.until null, until_invalid names the raw value",
    eBadUntil.ceilings.until === null && eBadUntil.until_invalid === "garbage");
  const eGoodUntil = envelopeFrom({}, { until: "06:00" });
  ok("well-formed --until → ceilings.until set, until_invalid null",
    eGoodUntil.ceilings.until === "06:00" && eGoodUntil.until_invalid === null);
  const eEmptyUntil = envelopeFrom({}, { until: "" });
  ok("--until '' takes the malformed branch (flagged garbage is loud)",
    eEmptyUntil.ceilings.until === null && eEmptyUntil.until_invalid === "");

  // --- computeBudgetState: per-dimension breach + outcome ---
  const env3 = envelopeFrom({ budget: { max_attempts: 3, at_ceiling: "stop" } }, {});
  const s1 = computeBudgetState(env3, { now_epoch: NOW, attempts: 3, tokens: 0 }, "transcript");
  ok("max_attempts breached at ceiling → stop", s1.breached.length === 1 && s1.breached[0] === "max_attempts" && s1.outcome === "stop");
  const s2 = computeBudgetState(env3, { now_epoch: NOW, attempts: 2, tokens: 0 }, "transcript");
  ok("below ceiling → not breached, outcome none", s2.breached.length === 0 && s2.outcome === "none");
  const envTok = envelopeFrom({ budget: { tokens: 100000, at_ceiling: "escalate" } }, {});
  const s3 = computeBudgetState(envTok, { now_epoch: NOW, attempts: 0, tokens: 150000 }, "transcript");
  ok("tokens breached → escalate, source transcript", s3.breached[0] === "tokens" && s3.outcome === "escalate" && s3.tokens_source === "transcript");
  const s3e = computeBudgetState(envTok, { now_epoch: NOW, attempts: 0, tokens: 150000 }, "estimate");
  ok("estimate source preserved", s3e.tokens_source === "estimate");
  const envUntil = envelopeFrom({ budget: { until: "11:00" } }, {});
  const s4 = computeBudgetState(envUntil, { now_epoch: NOW, until_epoch: NOW - 1000, attempts: 0, tokens: 0 }, "transcript");
  ok("until breached when now >= until-epoch", s4.breached[0] === "until" && s4.outcome === "stop");
  const s4b = computeBudgetState(envUntil, { now_epoch: NOW, until_epoch: NOW + 1000, attempts: 0, tokens: 0 }, "transcript");
  ok("until not breached when now < until-epoch", s4b.breached.length === 0);
  const envCost = envelopeFrom({ budget: { cost: 4, price_per_mtok: 2 } }, {});
  const s5 = computeBudgetState(envCost, { now_epoch: NOW, attempts: 0, tokens: 0, cost: 5 }, "transcript");
  ok("cost breached → stop", s5.breached[0] === "cost");
  const envMulti = envelopeFrom({ budget: { max_attempts: 1, tokens: 10, at_ceiling: "stop" } }, {});
  const s6 = computeBudgetState(envMulti, { now_epoch: NOW, attempts: 5, tokens: 99 }, "transcript");
  ok("multiple dims breach together", s6.breached.includes("max_attempts") && s6.breached.includes("tokens"));

  // --- attemptsFromLedger: dispatched outcomes count, routed-out/unreached don't ---
  ok("attempts excludes routed-out/unreached", attemptsFromLedger({
    admitted: ["A", "B", "C", "D"],
    outcomes: { A: "shipped", B: "parked", C: "routed-out", D: "unreached-budget" },
  }) === 2);
  ok("attempts falls back to admitted when no outcomes", attemptsFromLedger({ admitted: ["A", "B"], outcomes: {} }) === 2);

  // --- childOwningSession: attribution helper (FAFF-229) — pure, tmpdir only ---
  const cd = fs.mkdtempSync(path.join(os.tmpdir(), "faff-budget-self-"));
  const wj = (name, lines) => { const p = path.join(cd, name); fs.writeFileSync(p, lines.join("\n")); return p; };
  try {
    const owned = wj("agent-mine.jsonl", [JSON.stringify({ sessionId: "sid-1", message: { usage: { input_tokens: 1 } } })]);
    ok("childOwningSession reads first-record sessionId", childOwningSession(owned) === "sid-1");
    const skip = wj("agent-skip.jsonl", ["", "not json", JSON.stringify({ noSession: true }), JSON.stringify({ sessionId: "sid-2" })]);
    ok("childOwningSession skips blank/unparseable/no-sessionId lines", childOwningSession(skip) === "sid-2");
    const none = wj("agent-none.jsonl", [JSON.stringify({ message: { usage: { input_tokens: 9 } } }), JSON.stringify({ sessionId: "" })]);
    ok("childOwningSession → null when no record carries a non-empty sessionId", childOwningSession(none) === null);
    ok("childOwningSession → null on unreadable file (no crash)", childOwningSession(path.join(cd, "does-not-exist.jsonl")) === null);
  } finally { fs.rmSync(cd, { recursive: true, force: true }); }

  // --- resolveBudgetNow: hermetic clock seam (FAFF-302) — twin of resolveSentryNow ---
  const mkGet = (m) => (f) => (f in m ? m[f] : null);
  ok("resolveBudgetNow defaults to Date.now() when no flag", (() => {
    const before = Date.now(); const r = resolveBudgetNow(mkGet({})); const after = Date.now();
    return !r.error && r.now_ms >= before && r.now_ms <= after;
  })());
  ok("resolveBudgetNow --now-ms pins the epoch", resolveBudgetNow(mkGet({ "--now-ms": "1750000000000" })).now_ms === 1750000000000);
  ok("resolveBudgetNow --now-ms > --now precedence", resolveBudgetNow(mkGet({ "--now-ms": "1750000000000", "--now": "2026-06-23T15:00:00Z" })).now_ms === 1750000000000);
  ok("resolveBudgetNow --now ISO resolves", resolveBudgetNow(mkGet({ "--now": "2026-06-23T15:00:00Z" })).now_ms === Date.parse("2026-06-23T15:00:00Z"));
  ok("resolveBudgetNow unparseable --now-ms → error (no silent fall-through)", !!resolveBudgetNow(mkGet({ "--now-ms": "nope" })).error);
  ok("resolveBudgetNow unparseable --now → error", !!resolveBudgetNow(mkGet({ "--now": "not-a-date" })).error);

  // --- resolveLedgerOrFault: own-fault ≠ legitimately empty (FAFF-425) — guards
  // over-firing: a run genuinely absent must NOT be classed as a fault, and a run
  // present-but-unreadable (or explicitly named and gone) must NEVER be silently
  // coerced into that same empty/all-clear reading. ---
  const lfRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-budget-ledgerfault-"));
  try {
    // legitimately empty: nothing requested, no runs at all under root.
    const lfEmpty = resolveLedgerOrFault(mkGet({}), lfRoot);
    ok("resolveLedgerOrFault: no run requested + none found → empty, not a fault", lfEmpty.empty === true && !lfEmpty.fault);

    // explicit --run-dir named but its ledger is absent → own-fault, NEVER falls
    // back to latestRunDir (the "quietly blind" failure this closes).
    const lfMissing = path.join(lfRoot, "does-not-exist");
    const lfMissingRes = resolveLedgerOrFault(mkGet({ "--run-dir": lfMissing }), lfRoot);
    ok("resolveLedgerOrFault: explicit --run-dir with absent ledger → fault (no fallback)",
      !!lfMissingRes.fault && !lfMissingRes.empty && /explicit run named but its ledger is absent/.test(lfMissingRes.fault));

    // present-but-corrupt ledger → own-fault, names the path + parse error.
    const lfCorrupt = path.join(lfRoot, ".faff", "runs", "run-corrupt");
    fs.mkdirSync(lfCorrupt, { recursive: true });
    fs.writeFileSync(path.join(lfCorrupt, "run-ledger.json"), "{ not json");
    const lfCorruptRes = resolveLedgerOrFault(mkGet({ "--run-dir": lfCorrupt }), lfRoot);
    ok("resolveLedgerOrFault: present-but-corrupt ledger → fault, names the run dir",
      !!lfCorruptRes.fault && lfCorruptRes.runDir === lfCorrupt && /ledger unreadable/.test(lfCorruptRes.fault));

    // a clean, readable ledger at the latest run → the happy path, distinct from fault/empty.
    const lfGoodDir = path.join(lfRoot, ".faff", "runs", "run-good");
    fs.mkdirSync(lfGoodDir, { recursive: true });
    fs.writeFileSync(path.join(lfGoodDir, "run-ledger.json"), JSON.stringify({ run_id: "run-good" }));
    fs.rmSync(lfCorrupt, { recursive: true, force: true }); // remove the corrupt dir so latestRunDir picks the clean one
    const lfGoodRes = resolveLedgerOrFault(mkGet({}), lfRoot);
    ok("resolveLedgerOrFault: readable latest ledger → happy path, not fault/empty",
      !lfGoodRes.fault && !lfGoodRes.empty && lfGoodRes.ledger.run_id === "run-good");
  } finally { fs.rmSync(lfRoot, { recursive: true, force: true }); }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${36} checks, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { AT_CEILING_OUTCOMES, BUDGET_DIMENSIONS, BUDGET_NON_ATTEMPT_OUTCOMES, BUDGET_TOKEN_USAGE_KEYS, TOKEN_CLASS_FROM_USAGE, TOKEN_DELTA_CLASSES, attemptsFromLedger, budgetSelftest, childOwningSession, cmdBudget, computeBudgetState, envelopeFrom, envelopeFromLedger, measureTokens, measureTokensByClass, parseHHMM, readGovernanceConfig, resolveBudgetNow, resolveUntil, sessionOwnedTranscriptFiles, sumTranscriptFile, sumTranscriptFileByClass, transcriptBaseDir, untilToEpoch };
