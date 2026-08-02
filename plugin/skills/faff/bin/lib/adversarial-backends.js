// ===========================================================================
// === region:factory — adversarial-backends — FAFF-261: mechanical assembly of ===
// the adversarial-review fallback chain from config, replacing agent hand-
// assembly (JSON.parse the fallbacks string + merge + temp-file) with one
// deterministic emitter. Emits the exact primary-first, snake_case shape
// `review-call.mjs`'s `--backends-json` mapper already consumes verbatim
// ({provider,model,host,api_key_env?,reasoning_off?,timeout?}) — review-call.mjs
// itself is UNCHANGED by this command. Preserves the FAFF-213 unset-provider
// signal (exit 3) so a calling skill's existing --host-source default →
// needs-human path is byte-for-byte unchanged; a malformed `fallbacks` value
// fails loud (exit 2) rather than silently emitting a [primary]-only chain.
//
// FAFF-523: a `refs:` block sequence of backend NAMES is a third, newest form
// (checked first) — an ordered reference into the shared top-level `backends:`
// namespace (subsumes FAFF-261's own un-filed "flip to the native array"
// follow-up onto a by-NAME reference). `assembleAdversarialBackends` stays the
// single entry point; the native inline `backends:` array (FAFF-262) and the
// legacy primary+fallbacks form are both accepted unchanged for back-compat.
// ===========================================================================

const { dig, findRoot } = require("./shared-infra");
const { loadConfig } = require("./config");
const { resolveBackendRefs } = require("./backends");

// The Backend record's field set (snake_case — the shape review-call.mjs's
// mapper reads verbatim: b.api_key_env || b.apiKeyEnv, b.reasoning_off ??
// b.reasoningOff ?? false, b.timeout != null — see review-call.mjs's
// --backends-json mapper). provider/model/host are required by the mapper's
// own usage contract; the rest are optional.
// FAFF-696: `auth` + `seat_token_env` carry a subscription-seat's identity through to
// review-call.mjs's mapper (which resolves the seat token as Bearer/x-api-key, FAFF-481).
// Without them a seat backend referenced via `refs:` (FAFF-523) arrives stripped of its
// seat identity and falls back to the absent api_key_env path. Absent on every metered
// backend, so those emit byte-identically (present() gates the copy).
const BACKEND_KEYS = ["provider", "model", "host", "api_key_env", "seat_token_env", "auth", "reasoning_off", "timeout"];

function present(v) { return v !== null && v !== undefined && v !== ""; }

// PURE: copy only the known Backend fields present on `obj` (a config-shaped
// object — the `adversarial` scalar block, or one `backends[]`/parsed-
// `fallbacks[]` array element). Never leaks an unrelated config key into the
// emitted chain.
function pickBackendKeys(obj) {
  const out = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const k of BACKEND_KEYS) {
    if (!present(obj[k])) continue;
    // FAFF-696: `auth` is carried ONLY for a subscription-seat — that's the value
    // review-call.mjs keys on to resolve the seat token. A derived `api-key`/`none`
    // auth is redundant with api_key_env (review-call's absent-auth fallback maps to
    // it), and emitting it on a refs-resolved metered backend would break the
    // FAFF-523 refs↔legacy byte-equivalence. `seat_token_env` is only ever present
    // on a seat, so it needs no such guard.
    if (k === "auth" && obj[k] !== "subscription-seat") continue;
    out[k] = obj[k];
  }
  return out;
}

// PURE: a legacy fallback inherits any OMITTED optional key (api_key_env /
// reasoning_off / timeout) from the primary — provider/model/host are always
// self-contained (a fallback names its own backend; there is nothing sensible
// to inherit there). An explicit value on the fallback is never overwritten.
function inheritOptionalFromPrimary(fallback, primary) {
  const out = pickBackendKeys(fallback);
  for (const k of ["api_key_env", "reasoning_off", "timeout"]) {
    if (!(k in out) && present(primary[k])) out[k] = primary[k];
  }
  return out;
}

// PURE core (FAFF-261): assemble the primary-first backend chain from the
// `faffter_dark.adversarial` config block. Returns { chain } on success, or
// { error: "unset" } — no provider configured, or its host is unset (the
// FAFF-213 signal; the caller maps this to exit 3, never a localhost-defaulted
// chain) — or { error: "malformed", detail } — unparseable/non-array
// `fallbacks` JSON (the caller maps this to exit 2, fail-loud, never a
// silently-emitted [primary]-only chain on a broken config).
function assembleAdversarialBackends(cfg) {
  const adv = dig(cfg, "faffter_dark.adversarial");
  if (!adv || typeof adv !== "object" || Array.isArray(adv)) return { error: "unset" };

  // FAFF-523: named `refs:` block sequence — an ordered reference into the
  // shared top-level `backends:` namespace (checked first; a list of STRINGS
  // distinguishes it from the native `backends:` array below, a list of MAPS).
  // An unknown name or a namespace merge error (e.g. an engines:/backends:
  // collision) is fail-loud malformed — never a silent fallback to legacy.
  if (Array.isArray(adv.refs) && adv.refs.length > 0 && adv.refs.every((r) => typeof r === "string")) {
    const res = resolveBackendRefs(cfg, adv.refs);
    if (res.error) return { error: "malformed", detail: res.error };
    return { chain: res.chain.map(pickBackendKeys) };
  }

  // Native `backends:` array form (FAFF-262) — each element stands alone, used
  // as-is (no primary-key inheritance; review-call.mjs's mapper supplies its
  // own reasoning_off/timeout defaults for a bare element). An explicit EMPTY
  // array is not a valid chain (spec §4 edge cases) — fall through to legacy.
  if (Array.isArray(adv.backends) && adv.backends.length > 0) {
    return { chain: adv.backends.map(pickBackendKeys) };
  }

  // Legacy `primary + fallbacks` form. An unset host is the FAFF-213 signal —
  // never emit a localhost-defaulted chain.
  if (!present(adv.host)) return { error: "unset" };
  const primary = pickBackendKeys(adv);
  let fallbacks = [];
  if (Array.isArray(adv.fallbacks)) {
    // The config parser has handled native YAML block sequences under ANY key
    // since FAFF-262 — a `fallbacks:` value authored as a real YAML list (not
    // the quoted JSON-string form) already arrives here as a JS array; no
    // JSON.parse is needed or correct (JSON.parse on a non-string coerces via
    // toString, which would misreport a perfectly valid native list as
    // malformed). Real repo configs use exactly this shape.
    fallbacks = adv.fallbacks.map((fb) => inheritOptionalFromPrimary(fb, primary));
  } else if (present(adv.fallbacks)) {
    // The documented canonical shape: a quoted JSON-string array.
    let parsed;
    try { parsed = JSON.parse(adv.fallbacks); }
    catch (e) { return { error: "malformed", detail: `faffter_dark.adversarial.fallbacks is not valid JSON: ${e.message}` }; }
    if (!Array.isArray(parsed)) {
      return { error: "malformed", detail: "faffter_dark.adversarial.fallbacks must be a JSON array of backend objects" };
    }
    fallbacks = parsed.map((fb) => inheritOptionalFromPrimary(fb, primary));
  }
  const chain = [primary, ...fallbacks];
  if (chain.length === 0) return { error: "unset" };
  return { chain };
}

const { parseArgs, usageError } = require("./argv");
// --json is accepted-and-ignored: the default output is already the JSON array
// `review-call.mjs`'s --backends-json wants, so the flag exists for CLI-convention parity.
const ADVERSARIAL_BACKENDS_SPEC = { flags: { "--selftest": { arity: 0 }, "--root": { arity: 1 }, "--json": { arity: 0 } } };

function cmdAdversarialBackends(args) {
  if (args.includes("--selftest")) return adversarialBackendsSelftest();
  const { values, errors } = parseArgs(args, ADVERSARIAL_BACKENDS_SPEC);
  if (errors.length) return usageError(errors, "usage: faff adversarial-backends [--root DIR] [--json]");
  const root = values["--root"] || findRoot();
  const [cfg] = loadConfig(root);
  const res = assembleAdversarialBackends(cfg);
  if (res.error === "unset") {
    process.stderr.write(
      "faff adversarial-backends: faffter_dark.adversarial is unset (or its host is unset) — " +
      "no adversarial provider configured; the calling skill's --host-source default → needs-human path applies\n");
    return 3;
  }
  if (res.error === "malformed") {
    process.stderr.write(`faff adversarial-backends: ${res.detail}\n`);
    return 2;
  }
  console.log(JSON.stringify(res.chain));
  return 0;
}

// In-memory selftest table (mirrors eligible/models' --selftest shape). Covers
// the DONE-listed cases: legacy primary-only, legacy primary+fallbacks
// (inheritance + `nvidia/`-prefix preservation), native `backends:` array,
// unset-host (exit-3 class), malformed `fallbacks` (exit-2 class), plus the
// round-trip contract (emitted keys ⊆ the --backends-json mapper's accepted set).
function adversarialBackendsSelftest() {
  let fail = 0;
  const ok = (label, cond) => { console.log(`${cond ? "ok  " : "FAIL"} ${label}`); if (!cond) fail++; };

  // legacy, primary-only (no fallbacks key at all) — one-element chain.
  {
    const cfg = { faffter_dark: { adversarial: {
      provider: "nvidia", model: "nvidia/nemotron-3-super-120b-a12b",
      host: "https://integrate.api.nvidia.com/v1", api_key_env: "NVIDIA_API_KEY", timeout: 480,
    } } };
    const res = assembleAdversarialBackends(cfg);
    ok("legacy primary-only: one-element chain", !!res.chain && res.chain.length === 1);
    ok("legacy primary-only: nvidia/ prefix intact", res.chain[0].model === "nvidia/nemotron-3-super-120b-a12b");
    ok("legacy primary-only: api_key_env carried", res.chain[0].api_key_env === "NVIDIA_API_KEY");
  }

  // legacy, primary + fallbacks — inheritance of omitted optional keys + nvidia/ prefix preserved.
  {
    const cfg = { faffter_dark: { adversarial: {
      provider: "nvidia", model: "nvidia/nemotron-3-super-120b-a12b",
      host: "https://integrate.api.nvidia.com/v1", api_key_env: "NVIDIA_API_KEY", timeout: 480,
      fallbacks: JSON.stringify([{ provider: "ollama", model: "qwen3-next:80b", host: "http://studio:11434" }]),
    } } };
    const res = assembleAdversarialBackends(cfg);
    ok("legacy+fallbacks: two-element primary-first chain", !!res.chain && res.chain.length === 2);
    ok("legacy+fallbacks: primary nvidia/ prefix intact", res.chain[0].model === "nvidia/nemotron-3-super-120b-a12b");
    ok("legacy+fallbacks: fallback provider/model/host self-contained",
      res.chain[1].provider === "ollama" && res.chain[1].model === "qwen3-next:80b" && res.chain[1].host === "http://studio:11434");
    ok("legacy+fallbacks: fallback inherits omitted api_key_env from primary", res.chain[1].api_key_env === "NVIDIA_API_KEY");
    ok("legacy+fallbacks: fallback inherits omitted timeout from primary", res.chain[1].timeout === 480);
  }

  // legacy, fallback with its OWN api_key_env — inheritance never overwrites an explicit value.
  {
    const cfg = { faffter_dark: { adversarial: {
      provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "PRIMARY_KEY",
      fallbacks: JSON.stringify([{ provider: "openai", model: "m2", host: "https://b/v1", api_key_env: "FALLBACK_KEY" }]),
    } } };
    const res = assembleAdversarialBackends(cfg);
    ok("legacy+fallbacks: an explicit fallback api_key_env is never overwritten by inheritance", res.chain[1].api_key_env === "FALLBACK_KEY");
  }

  // legacy, `fallbacks` authored as a NATIVE YAML array (not the JSON-string form) — the
  // config parser has handled block sequences under any key since FAFF-262, so a real
  // .faffrc.yaml may already hand this a JS array; it must be used as-is, never JSON.parse'd
  // (which would misreport a valid native list as malformed via toString() coercion).
  {
    const cfg = { faffter_dark: { adversarial: {
      provider: "nvidia", model: "nvidia/m1", host: "https://a/v1", api_key_env: "NVIDIA_API_KEY",
      fallbacks: [{ provider: "gemini", model: "models/gemma-4-31b-it", host: "https://generativelanguage.googleapis.com/v1beta/openai", api_key_env: "GEMINI_API_KEY" }],
    } } };
    const res = assembleAdversarialBackends(cfg);
    ok("legacy, native-array fallbacks: not misreported as malformed", res.error === undefined);
    ok("legacy, native-array fallbacks: two-element primary-first chain", !!res.chain && res.chain.length === 2);
    ok("legacy, native-array fallbacks: fallback fields carried through untouched",
      res.chain[1].provider === "gemini" && res.chain[1].model === "models/gemma-4-31b-it" && res.chain[1].api_key_env === "GEMINI_API_KEY");
  }

  // native backends: array — each element used as-is, no inheritance applied.
  {
    const cfg = { faffter_dark: { adversarial: { backends: [
      { provider: "nvidia", model: "nvidia/m1", host: "https://a/v1", api_key_env: "K1" },
      { provider: "ollama", model: "m2", host: "http://b:11434" },
    ] } } };
    const res = assembleAdversarialBackends(cfg);
    ok("native backends: two-element chain, primary-first order preserved",
      !!res.chain && res.chain.length === 2 && res.chain[0].model === "nvidia/m1" && res.chain[1].model === "m2");
    ok("native backends: no cross-element inheritance (fallback has no api_key_env)", !("api_key_env" in res.chain[1]));
  }

  // native backends: empty array falls through to legacy — unset host here → exit-3 class.
  {
    const cfg = { faffter_dark: { adversarial: { backends: [] } } };
    ok("native empty backends[] + no legacy host → unset (exit-3 class)", assembleAdversarialBackends(cfg).error === "unset");
  }

  // unset: no faffter_dark.adversarial block at all.
  ok("absent adversarial block → unset (exit-3 class)", assembleAdversarialBackends({}).error === "unset");

  // unset: legacy scalars present but host is unset (the FAFF-213 signal) — must
  // NEVER fall back to a localhost-defaulted chain.
  {
    const cfg = { faffter_dark: { adversarial: { provider: "nvidia", model: "m1" } } };
    ok("legacy with unset host → unset (exit-3 class), never a localhost default", assembleAdversarialBackends(cfg).error === "unset");
  }

  // malformed: fallbacks is not valid JSON.
  {
    const cfg = { faffter_dark: { adversarial: { provider: "nvidia", model: "m1", host: "https://a/v1", fallbacks: "{not json" } } };
    ok("malformed fallbacks JSON → malformed (exit-2 class), never a silent [primary]-only chain",
      assembleAdversarialBackends(cfg).error === "malformed");
  }

  // malformed: fallbacks parses but is not an array.
  {
    const cfg = { faffter_dark: { adversarial: { provider: "nvidia", model: "m1", host: "https://a/v1", fallbacks: '{"a":1}' } } };
    ok("non-array fallbacks JSON → malformed (exit-2 class)", assembleAdversarialBackends(cfg).error === "malformed");
  }

  // round-trip contract: emitted keys are exactly the snake_case shape review-call.mjs's
  // --backends-json mapper reads (provider/model/host/api_key_env/reasoning_off/timeout) —
  // no camelCase, no stray keys leaked from the config object.
  {
    const cfg = { faffter_dark: { adversarial: {
      provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K", reasoning_off: true, timeout: 30,
      some_other_key: "must-not-leak",
    } } };
    const res = assembleAdversarialBackends(cfg);
    const keys = Object.keys(res.chain[0]);
    const allowed = new Set(BACKEND_KEYS);
    ok("emitted keys ⊆ the mapper's accepted key set", keys.every((k) => allowed.has(k)));
    ok("unrelated config keys never leak into the emitted backend", !("some_other_key" in res.chain[0]));
  }

  // FAFF-696: a refs: chain into a subscription-seat backend carries auth + seat_token_env
  // through to review-call.mjs (which resolves the seat token, FAFF-481). Without them the
  // seat arrives stripped and can't authenticate.
  {
    const cfg = {
      backends: { seat: { provider: "anthropic", model: "claude-opus-4-8", auth: "subscription-seat", seat_token_env: "CLAUDE_SEAT_TOKEN" } },
      faffter_dark: { adversarial: { refs: ["seat"] } },
    };
    const res = assembleAdversarialBackends(cfg);
    ok("refs→seat: chain assembled", !!res.chain && res.chain.length === 1);
    ok("refs→seat: auth carried", res.chain[0].auth === "subscription-seat");
    ok("refs→seat: seat_token_env carried", res.chain[0].seat_token_env === "CLAUDE_SEAT_TOKEN");
    ok("refs→seat: no stray api_key_env", !("api_key_env" in res.chain[0]));
  }

  // FAFF-696: a legacy metered backend (no auth/seat handle) emits byte-identically —
  // the two new keys are simply absent (present() gates the copy).
  {
    const cfg = { faffter_dark: { adversarial: {
      provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K", timeout: 480,
    } } };
    const res = assembleAdversarialBackends(cfg);
    ok("legacy metered: no auth key leaked", !("auth" in res.chain[0]));
    ok("legacy metered: no seat_token_env key leaked", !("seat_token_env" in res.chain[0]));
    ok("legacy metered: api_key_env still carried", res.chain[0].api_key_env === "K");
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (adversarial-backends, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  BACKEND_KEYS, adversarialBackendsSelftest, assembleAdversarialBackends, cmdAdversarialBackends,
  inheritOptionalFromPrimary, pickBackendKeys,
};
