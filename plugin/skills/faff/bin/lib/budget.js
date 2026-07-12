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

// FAFF-427: per-model x per-class USD pricing — MOVED here from economics.js
// (factory). budget.js (governance) is the region that GOVERNS spend (the
// budget.cost ceiling), so the price map lives where it is consulted for real,
// never imported back from factory (FAFF-359 region direction: governance must
// never reference factory). `economics.js` re-imports these three symbols from
// here and re-exports them under its own module.exports, so existing callers
// (including its own extensive --selftest table) are untouched.
//
// Per-model × per-class USD price per 1M tokens. Built-in default (seeded from
// the FAFF-407 reference). An optional `budget.price_per_mtok_by_model` config
// map is consulted FIRST (per-model; see resolveEconomicsPriceMap). A model
// absent from BOTH prices to null (cost:null, kept distinct from $0). A dated
// model-id suffix (-YYYYMMDD) is stripped before lookup, exactly as the reference.
const PRICE_PER_MTOK = {
  "claude-fable-5": { input: 10, output: 50, cache_write: 12.5, cache_read: 1.0 },
  "claude-opus-4-8": { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  "claude-opus-4-5": { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  "claude-sonnet-5": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  "claude-sonnet-4-6": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
};

// Resolve a model's per-class price row, or null when unknown in BOTH the config
// override and the built-in map (caller renders cost:null). A missing class within
// a resolved row defaults to 0 (a partial price → $0 for that class).
function economicsPriceForModel(model, priceMap) {
  const m = priceMap || PRICE_PER_MTOK;
  const row = m[model] || m[String(model).replace(/-\d{8}$/, "")];
  if (!row || typeof row !== "object") return null;
  return {
    input: Number(row.input) || 0,
    output: Number(row.output) || 0,
    cache_write: Number(row.cache_write) || 0,
    cache_read: Number(row.cache_read) || 0,
  };
}

// Merge an optional `budget.price_per_mtok_by_model` config map OVER the built-in
// defaults (config wins per-model). Pure; returns the built-in map unchanged when
// no valid override is present.
function resolveEconomicsPriceMap(cfg) {
  const override = dig(cfg, "budget.price_per_mtok_by_model");
  if (!override || typeof override !== "object" || Array.isArray(override)) return PRICE_PER_MTOK;
  const merged = { ...PRICE_PER_MTOK };
  for (const [model, row] of Object.entries(override)) {
    if (row && typeof row === "object" && !Array.isArray(row)) merged[model] = row;
  }
  return merged;
}

// FAFF-427 — the fail-safe "unpriced model" rate: per class, the MAX rate present
// across every row of the resolved price map. A model the map doesn't know about
// is priced at this conservative row (never at $0) so a pricing gap can only make
// the GOVERNOR breach early, never silently pass unmetered (fail toward breaching,
// never toward silence — the same posture as FAFF-364's vacuous-ceiling refusal).
// This is deliberately the GOVERNOR's rule only; `economics` (a reporting, not a
// governing, surface) keeps its existing cost:null-for-unpriced convention.
function conservativePriceRow(priceMap) {
  const row = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  for (const r of Object.values(priceMap || {})) {
    if (!r || typeof r !== "object") continue;
    for (const cls of TOKEN_DELTA_CLASSES) {
      const v = Number(r[cls]) || 0;
      if (v > row[cls]) row[cls] = v;
    }
  }
  return row;
}

// FAFF-427 — price a per-model token-delta map against the resolved price map.
// Pure. A model present in the map prices at its own row; a model ABSENT from
// the map prices at `conservativePriceRow` (the costliest known rate per class)
// and is named in the returned `unpriced_models` list so the caller can warn.
// Returns { cost, unpriced_models }.
function priceModelClassSums(byModel, priceMap) {
  const conservative = conservativePriceRow(priceMap);
  let cost = 0;
  const unpriced = [];
  for (const [model, counts] of (byModel instanceof Map ? byModel.entries() : Object.entries(byModel || {}))) {
    const known = economicsPriceForModel(model, priceMap);
    if (!known) unpriced.push(model);
    const rate = known || conservative;
    for (const cls of TOKEN_DELTA_CLASSES) {
      const tok = (counts && counts[cls]) || 0;
      cost += (tok / 1_000_000) * rate[cls];
    }
  }
  return { cost, unpriced_models: unpriced };
}

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
// An unset dimension is `null` (unbounded).
//
// FAFF-427: `budget.cost` is now parsed UNCONDITIONALLY — it no longer waits on
// `price_per_mtok > 0` to mean something, because the per-model x per-class price
// map (above) can always price it by default. `pricing` names WHICH rule governs
// the cost dimension: `"flat"` when a human has explicitly set `price_per_mtok >
// 0` (byte-for-byte legacy behaviour, human-explicit outranks the default), else
// `"map"` (the ADR-0048 map prices every model it can, and the costliest-known-rate
// fallback prices the rest — so `pricing:"map"` always has SOME price to apply).
// Returns { ceilings: {until,max_attempts,tokens,cost}, at_ceiling, price_per_mtok, pricing }.
function envelopeFrom(cfg, flags) {
  const b = (cfg && typeof cfg === "object" && cfg.budget && typeof cfg.budget === "object") ? cfg.budget : {};
  const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  // Flag-over-config precedence UNCHANGED: --until wins over budget.until when present.
  const rawUntil = (flags && flags.until != null) ? flags.until : (b.until != null ? String(b.until) : null);
  const { until, until_invalid } = resolveUntil(rawUntil); // FAFF-364: malformed → null ceiling + loud flag
  const maxAttempts = (flags && flags.max_attempts != null) ? num(flags.max_attempts) : num(b.max_attempts);
  const tokens = num(b.tokens);
  const price = num(b.price_per_mtok) || 0;
  // FAFF-427: cost is no longer gated on price>0 — the map prices it by default.
  const cost = num(b.cost);
  const pricing = price > 0 ? "flat" : "map";
  let atCeiling = b.at_ceiling != null ? String(b.at_ceiling).trim().toLowerCase() : "stop";
  if (!AT_CEILING_OUTCOMES.has(atCeiling)) atCeiling = "stop"; // unknown coerces to the safe default
  return {
    ceilings: { until, max_attempts: maxAttempts, tokens, cost },
    until_invalid,
    at_ceiling: atCeiling,
    price_per_mtok: price,
    pricing,
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

// FAFF-427: the ONE per-file read/parse loop, extended to ALSO bucket by model —
// `sumTranscriptFileByClass` (below) derives its by-class totals from THIS
// function's `by_class` accumulator, so the two can never drift (by_class is
// exactly the sum over `by_model`, by construction — parity, not a second scan).
// Each line is a JSON record; assistant messages carry message.usage. Malformed
// lines are skipped (a partial/in-flight transcript must never crash the budget
// check). Model id defaults to "unknown" when a record carries no message.model
// (mirrors economics.js's existing per-model pivot rule).
function sumTranscriptFileByModelClass(file) {
  const by_class = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  const by_model = new Map();
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return { by_model, by_class }; }
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; }
    const usage = rec && rec.message && rec.message.usage ? rec.message.usage
      : (rec && rec.usage ? rec.usage : null);
    if (!usage || typeof usage !== "object") continue;
    const model = (rec.message && typeof rec.message.model === "string" && rec.message.model) || "unknown";
    if (!by_model.has(model)) by_model.set(model, { input: 0, output: 0, cache_write: 0, cache_read: 0 });
    const mb = by_model.get(model);
    for (const cls of TOKEN_DELTA_CLASSES) {
      const v = usage[TOKEN_CLASS_FROM_USAGE[cls]];
      if (typeof v === "number" && Number.isFinite(v)) { by_class[cls] += v; mb[cls] += v; }
    }
  }
  return { by_model, by_class };
}

// Sum usage tokens across a single transcript .jsonl file, SPLIT BY CLASS. Each
// line is a JSON record; assistant messages carry message.usage. Malformed lines
// are skipped (a partial/in-flight transcript must never crash the budget check).
// FAFF-408: this is the single read/parse loop; `sumTranscriptFile` derives its
// scalar total by summing the four classes, so there is exactly ONE token
// attribution path (never a divergent private recount — the FAFF-229 guard-rail).
// FAFF-427: now a thin derivation over `sumTranscriptFileByModelClass` — same
// parse, byte-identical totals (parity-tested), never a second loop.
function sumTranscriptFileByClass(file) {
  return sumTranscriptFileByModelClass(file).by_class;
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

// FAFF-427: the SAME file-selection resolver + per-file parse as
// `measureTokensByClass` above, additionally bucketed by model — the input the
// `budget.cost` map-pricing rule needs. `totals` is exactly the sum over
// `by_model` (parity by construction, same underlying `sumTranscriptFileByModelClass`
// call per file); a caller wanting only the scalar/by-class figure keeps using
// `measureTokens`/`measureTokensByClass` unchanged — this is an ADDITIVE sibling,
// not a replacement, so neither of those two call sites' behaviour changes.
// Returns `{ by_model: Map<model,{classes}>, totals:{classes}, source:"transcript" }`
// or `{ source: "estimate" }` (mirrors measureTokensByClass's estimate shape).
function measureTokensByModelClass(opts) {
  const { cwd, env, runStartMs } = opts;
  const sid = env.CLAUDE_CODE_SESSION_ID;
  const base = transcriptBaseDir(cwd, env);
  const files = sessionOwnedTranscriptFiles(base, sid, runStartMs);
  if (!files) return { source: "estimate" };
  const totals = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  const by_model = new Map();
  for (const f of files) {
    const { by_model: fm, by_class: fc } = sumTranscriptFileByModelClass(f);
    for (const cls of TOKEN_DELTA_CLASSES) totals[cls] += fc[cls];
    for (const [model, counts] of fm) {
      if (!by_model.has(model)) by_model.set(model, { input: 0, output: 0, cache_write: 0, cache_read: 0 });
      const mb = by_model.get(model);
      for (const cls of TOKEN_DELTA_CLASSES) mb[cls] += counts[cls];
    }
  }
  return { by_model, totals, source: "transcript" };
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
  const tokensAtStartByModel = (ledger.budget && ledger.budget.tokens_at_start_by_model_class
    && typeof ledger.budget.tokens_at_start_by_model_class === "object" && !Array.isArray(ledger.budget.tokens_at_start_by_model_class))
    ? ledger.budget.tokens_at_start_by_model_class : null;

  // Token accounting (the only I/O) — ONE walk via the per-model resolver
  // (FAFF-427): `measureTokensByModelClass` carries the SAME scalar total
  // `measureTokens` would (its `totals` is the sum over `by_model`, by
  // construction), so this is not a second walk — it is the one walk, now also
  // carrying what map-pricing needs. Estimate fallback when the transcript is gone.
  const measuredFull = measureTokensByModelClass({ cwd: root, env: process.env, runStartMs });
  let tokens, tokensSource;
  let tokensByModelDelta = null;   // per-model this-run delta, only populated on the transcript path
  const costWarnings = [];         // accumulated unconditionally; the single costConfigured gate is at the flush point
  const costConfigured = env.ceilings.cost != null;
  if (measuredFull.source === "transcript") {
    const wholeSessionTotal = measuredFull.totals.input + measuredFull.totals.output
      + measuredFull.totals.cache_write + measuredFull.totals.cache_read;
    tokens = Math.max(0, wholeSessionTotal - tokensAtStart); // this-run delta, baselined at run start
    tokensSource = "transcript";

    // FAFF-427: per-model delta for map pricing. A real per-model baseline
    // (`tokens_at_start_by_model_class`, written at mint) subtracts cleanly; a
    // pre-change ledger carrying none pro-rates the whole-session per-model
    // buckets by the scalar this-run fraction and warns — deterministic,
    // proportional, transitional (see ADR 0059).
    tokensByModelDelta = new Map();
    if (tokensAtStartByModel) {
      for (const [model, counts] of measuredFull.by_model) {
        const base = tokensAtStartByModel[model] || {};
        const delta = {};
        for (const cls of TOKEN_DELTA_CLASSES) delta[cls] = Math.max(0, (counts[cls] || 0) - (Number(base[cls]) || 0));
        tokensByModelDelta.set(model, delta);
      }
    } else {
      const scale = wholeSessionTotal > 0 ? tokens / wholeSessionTotal : 0;
      for (const [model, counts] of measuredFull.by_model) {
        const delta = {};
        for (const cls of TOKEN_DELTA_CLASSES) delta[cls] = (counts[cls] || 0) * scale;
        tokensByModelDelta.set(model, delta);
      }
      if (wholeSessionTotal > 0) costWarnings.push("cost pro-rated (no per-model baseline — tokens_at_start_by_model_class absent from this run's ledger)");
    }
  } else {
    const attemptsForEst = attemptsFromLedger(ledger);
    const estPer = Number(dig(cfg, "budget.est_tokens_per_attempt")) || 200000;
    tokens = attemptsForEst * estPer;
    tokensSource = "estimate";
  }

  const attempts = attemptsFromLedger(ledger);

  // FAFF-427: `budget.cost` prices from the SAME map + rate source the `economics`
  // top-line uses. Each branch accumulates its diagnostic into `costWarnings`
  // UNCONDITIONALLY; the single `costConfigured` gate lives at the flush point below
  // (so an unconfigured cost dimension stays silent — a clean envelope's JSON must
  // not sprout warnings nobody asked for — without every branch re-deriving that
  // guard, the one place a future branch would forget it).
  let cost;
  if (env.pricing === "flat") {
    cost = env.price_per_mtok > 0 ? (tokens / 1_000_000) * env.price_per_mtok : null;
    if (env.price_per_mtok > 0) {
      costWarnings.push("budget.price_per_mtok is deprecated — unset it (or set budget.price_per_mtok_by_model to override specific models) to price per-model x per-class from the ADR-0048 map");
    }
  } else if (tokensSource === "estimate") {
    cost = null;
    costWarnings.push("cost ceiling not meterable from estimates (no per-model data) — resolve a transcript, or set budget.price_per_mtok for the flat-scalar estimate path");
  } else {
    const priceMap = resolveEconomicsPriceMap(cfg);
    const priced = priceModelClassSums(tokensByModelDelta, priceMap);
    cost = priced.cost;
    if (priced.unpriced_models.length) {
      costWarnings.push(`unpriced model(s) priced at the costliest known rate (fail-safe overcount): ${priced.unpriced_models.join(", ")}`);
    }
  }
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
  // stays byte-identical to before this change (and to before FAFF-427: no cost
  // ceiling configured ⇒ no cost warnings, ever).
  const warnings = [];
  if (env.until_invalid != null) {
    const msg = `budget.until '${env.until_invalid}' is not a valid HH:MM — until ceiling ignored`;
    warnings.push(msg);
    process.stderr.write(`faff budget check: ${msg}\n`);
  }
  // FAFF-428 — at L4 only, an estimate-only token figure is a metering DEGRADE, not
  // merely a fallback: the preflight's own meter sample can go stale mid-run (env
  // change across resume, deleted history) even when the run started measurable, so
  // this is the persistent net. Rides the existing warnings[] mechanism — NEVER a new
  // exit code: sentryReadBudget / run-done --budget treat any non-zero child exit as
  // the unbreached default (fail-open), so signalling here via the exit code would
  // MASK a real breach instead of revealing a broken meter (the exact inversion of
  // intent). No ledger, no `level` field, or `level != "L4"` → byte-for-byte
  // unchanged (L1-L3 estimate-fallback is an unwarned, ordinary count-idiom).
  if (tokensSource === "estimate" && ledger.level === "L4") {
    const msg = "L4 budget metering degraded: transcripts unreadable — token figure is attempts x est_tokens_per_attempt (may under-report ~10x)";
    warnings.push(msg);
    process.stderr.write(`faff budget check: ${msg}\n`);
  }
  // Single cost-warning gate (FAFF-427): only surface cost diagnostics when a cost
  // ceiling is actually configured — the one place the "stay silent when
  // unconfigured" invariant lives, rather than repeated at every push site.
  if (costConfigured) for (const w of costWarnings) warnings.push(w);
  if (warnings.length) state.warnings = warnings;

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
  const price_per_mtok = num(rec.price_per_mtok) || fresh.price_per_mtok || 0;
  // FAFF-427: honour a recorded `pricing` field when present (post-change ledgers);
  // else derive it from the resolved price — a pre-change ledger (minted before this
  // field existed) never carries `pricing`, so it degrades to the same rule
  // `envelopeFrom` applies: an explicit priced flat scalar means "flat", anything
  // else means "map" (the ADR-0048 map prices it by default).
  const pricing = (rec.pricing === "flat" || rec.pricing === "map") ? rec.pricing : (price_per_mtok > 0 ? "flat" : "map");
  return {
    ceilings: {
      until,
      max_attempts: flags && flags.max_attempts != null ? num(flags.max_attempts) : (num(recCeil.max_attempts)),
      tokens: num(recCeil.tokens),
      cost: num(recCeil.cost),
    },
    until_invalid,
    at_ceiling: atCeiling,
    price_per_mtok,
    pricing,
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
  // FAFF-427: `budget.cost` is now UNCONDITIONAL — the map prices it by default,
  // so it is no longer gated on price_per_mtok>0 (that dead zone is gone).
  const e5 = envelopeFrom({ budget: { cost: 5, price_per_mtok: 0 } }, {});
  ok("no explicit price → cost still SET, pricing:map (the dollar ceiling now needs no flat scalar)",
    e5.ceilings.cost === 5 && e5.pricing === "map");
  const e6 = envelopeFrom({ budget: { cost: 5, price_per_mtok: 3 } }, {});
  ok("explicit price>0 → cost set AND pricing:flat (human-explicit wins)",
    e6.ceilings.cost === 5 && e6.price_per_mtok === 3 && e6.pricing === "flat");
  const e7 = envelopeFrom({ budget: {} }, {});
  ok("no budget.cost at all → ceilings.cost null regardless of pricing", e7.ceilings.cost === null && e7.pricing === "map");

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

  // --- FAFF-427: moved price-map primitives (from economics.js) live here now ---
  ok("PRICE_PER_MTOK seeds the shipped models", PRICE_PER_MTOK["claude-opus-4-8"].input === 5);
  ok("economicsPriceForModel known model", (() => { const p = economicsPriceForModel("claude-sonnet-4-6", PRICE_PER_MTOK); return p.input === 3 && p.cache_read === 0.3; })());
  ok("economicsPriceForModel dated-suffix strip", JSON.stringify(economicsPriceForModel("claude-opus-4-8-20260101", PRICE_PER_MTOK)) === JSON.stringify(economicsPriceForModel("claude-opus-4-8", PRICE_PER_MTOK)));
  ok("economicsPriceForModel unknown model → null", economicsPriceForModel("mystery-model", PRICE_PER_MTOK) === null);
  const pm427 = resolveEconomicsPriceMap({ budget: { price_per_mtok_by_model: { "claude-opus-4-8": { input: 99, output: 99, cache_write: 99, cache_read: 99 } } } });
  ok("resolveEconomicsPriceMap: config override wins per-model, built-ins retained", pm427["claude-opus-4-8"].input === 99 && pm427["claude-sonnet-4-6"].input === 3);
  ok("resolveEconomicsPriceMap: no override → built-in map (identity)", resolveEconomicsPriceMap({}) === PRICE_PER_MTOK);

  // --- FAFF-427: conservativePriceRow / priceModelClassSums (fail-safe unpriced pricing) ---
  const consRow = conservativePriceRow(PRICE_PER_MTOK);
  ok("conservativePriceRow: max per-class rate across the map", consRow.input === 10 && consRow.output === 50 && consRow.cache_write === 12.5 && consRow.cache_read === 1.0);
  const priced1 = priceModelClassSums(new Map([["claude-sonnet-4-6", { input: 1_000_000, output: 0, cache_write: 0, cache_read: 0 }]]), PRICE_PER_MTOK);
  ok("priceModelClassSums: known model priced at its own rate, no unpriced", Math.abs(priced1.cost - 3) < 1e-9 && priced1.unpriced_models.length === 0);
  const priced2 = priceModelClassSums(new Map([["totally-unknown-model", { input: 1_000_000, output: 0, cache_write: 0, cache_read: 0 }]]), PRICE_PER_MTOK);
  ok("priceModelClassSums: unknown model priced at the CONSERVATIVE (costliest) rate, named as unpriced", Math.abs(priced2.cost - 10) < 1e-9 && priced2.unpriced_models[0] === "totally-unknown-model");
  const priced3 = priceModelClassSums({}, PRICE_PER_MTOK);
  ok("priceModelClassSums: empty by-model map → cost 0, no unpriced", priced3.cost === 0 && priced3.unpriced_models.length === 0);

  // --- FAFF-427: sumTranscriptFileByModelClass — parity with sumTranscriptFileByClass ---
  const smcd = fs.mkdtempSync(path.join(os.tmpdir(), "faff-budget-modelclass-"));
  try {
    const mf = path.join(smcd, "mixed.jsonl");
    fs.writeFileSync(mf, [
      JSON.stringify({ message: { model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 1000 } } }),
      JSON.stringify({ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 50, output_tokens: 5 } } }),
      JSON.stringify({ usage: { input_tokens: 7 } }),   // no message.model at all → "unknown" bucket
      "not json — skipped",
    ].join("\n"));
    const byModelClass = sumTranscriptFileByModelClass(mf);
    const byClassDirect = sumTranscriptFileByClass(mf);
    ok("sumTranscriptFileByClass delegates to sumTranscriptFileByModelClass (byte-identical totals)",
      JSON.stringify(byModelClass.by_class) === JSON.stringify(byClassDirect));
    ok("sumTranscriptFileByModelClass: by_class equals the sum over by_model (parity)", (() => {
      const summed = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
      for (const counts of byModelClass.by_model.values()) for (const cls of TOKEN_DELTA_CLASSES) summed[cls] += counts[cls];
      return JSON.stringify(summed) === JSON.stringify(byModelClass.by_class);
    })());
    ok("sumTranscriptFileByModelClass: buckets by model id, defaults to 'unknown'",
      byModelClass.by_model.has("claude-opus-4-8") && byModelClass.by_model.has("claude-sonnet-4-6") && byModelClass.by_model.has("unknown")
      && byModelClass.by_model.get("unknown").input === 7);
    ok("sumTranscriptFileByModelClass: unreadable file → empty accumulators, no throw",
      (() => { const r = sumTranscriptFileByModelClass(path.join(smcd, "nope.jsonl")); return r.by_class.input === 0 && r.by_model.size === 0; })());
  } finally { fs.rmSync(smcd, { recursive: true, force: true }); }

  // --- FAFF-427: measureTokensByModelClass — same file-selection resolver, per-model split ---
  const mtmc = fs.mkdtempSync(path.join(os.tmpdir(), "faff-budget-mtmc-"));
  try {
    const sidMc = "sess-mc";
    const cwdMc = mtmc;
    const projdir = path.join(mtmc, "cfg", "projects", cwdMc.replace(/\//g, "-"));
    fs.mkdirSync(projdir, { recursive: true });
    fs.writeFileSync(path.join(projdir, `${sidMc}.jsonl`), [
      JSON.stringify({ sessionId: sidMc, message: { model: "claude-opus-4-8", usage: { input_tokens: 200 } } }),
    ].join("\n"));
    const envMc = { CLAUDE_CONFIG_DIR: path.join(mtmc, "cfg"), CLAUDE_CODE_SESSION_ID: sidMc };
    const full = measureTokensByModelClass({ cwd: cwdMc, env: envMc, runStartMs: null });
    ok("measureTokensByModelClass: transcript source, totals sum over by_model", full.source === "transcript"
      && full.totals.input === 200 && full.by_model.get("claude-opus-4-8").input === 200);
    const noSid = measureTokensByModelClass({ cwd: cwdMc, env: {}, runStartMs: null });
    ok("measureTokensByModelClass: no session id → estimate degrade, mirrors measureTokensByClass's shape", noSid.source === "estimate" && noSid.by_model === undefined);
  } finally { fs.rmSync(mtmc, { recursive: true, force: true }); }

  // --- FAFF-427: envelopeFromLedger derives `pricing` for a pre-change ledger ---
  const elNoPricing = envelopeFromLedger({ ceilings: { cost: 5, tokens: null, until: null, max_attempts: null }, at_ceiling: "stop", price_per_mtok: 0 }, {}, {});
  ok("envelopeFromLedger: legacy record (no `pricing` field), price_per_mtok=0 → derives pricing:map", elNoPricing.pricing === "map");
  const elNoPricingFlat = envelopeFromLedger({ ceilings: { cost: 5, tokens: null, until: null, max_attempts: null }, at_ceiling: "stop", price_per_mtok: 7 }, {}, {});
  ok("envelopeFromLedger: legacy record, price_per_mtok>0 → derives pricing:flat", elNoPricingFlat.pricing === "flat" && elNoPricingFlat.price_per_mtok === 7);
  const elWithPricing = envelopeFromLedger({ ceilings: { cost: 5, tokens: null, until: null, max_attempts: null }, at_ceiling: "stop", price_per_mtok: 0, pricing: "map" }, {}, {});
  ok("envelopeFromLedger: a recorded `pricing` field is honoured verbatim", elWithPricing.pricing === "map");

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${36} checks, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { AT_CEILING_OUTCOMES, BUDGET_DIMENSIONS, BUDGET_NON_ATTEMPT_OUTCOMES, BUDGET_TOKEN_USAGE_KEYS, PRICE_PER_MTOK, TOKEN_CLASS_FROM_USAGE, TOKEN_DELTA_CLASSES, attemptsFromLedger, budgetSelftest, childOwningSession, cmdBudget, computeBudgetState, conservativePriceRow, economicsPriceForModel, envelopeFrom, envelopeFromLedger, measureTokens, measureTokensByClass, measureTokensByModelClass, parseHHMM, priceModelClassSums, readGovernanceConfig, resolveBudgetNow, resolveEconomicsPriceMap, resolveUntil, sessionOwnedTranscriptFiles, sumTranscriptFile, sumTranscriptFileByClass, sumTranscriptFileByModelClass, transcriptBaseDir, untilToEpoch };
