// ===========================================================================
// === region:factory — gates-config — the gates.* config knobs (readGatesConfig, gatesFallbackPolicy) and the host facts they default from (shard concurrency, local OS) ===
// Split out of gates.js (FAFF-1390), which re-exports every name it exported before.
// ===========================================================================

const os = require("node:os");
const { loadConfig } = require("./config");
const { dig } = require("./shared-infra");

// Resolve the fallback policy for `discovery: none` from config: fail-closed (default) | advisory.
function gatesFallbackPolicy(root) {
  try {
    const [data] = loadConfig(root);
    const v = dig(data, "gates.fallback");
    if (v === "advisory") return "advisory";
  } catch { /* default */ }
  return "fail-closed";
}

// Read the gates.* config knobs via the loadConfig + dig idiom (mirrors gatesFallbackPolicy),
// each defaulting on absent/malformed. gates.exclude is a list read via dig (not a DEFAULTS scalar).
function readGatesConfig(root) {
  let data = {};
  try { [data] = loadConfig(root); } catch { data = {}; }
  const get = (k) => { try { return dig(data, k); } catch { return undefined; } };
  const fallback = get("gates.fallback") === "advisory" ? "advisory" : "fail-closed";
  const partial = get("gates.partial") === "needs-human" ? "needs-human" : "warn";
  // `dig` returns null for an absent key; Number(null) === 0 is an in-range value, so guard the
  // present-ness of the raw value BEFORE coercing — else an unset key coerces to a spurious 0.
  const num = (k) => { const v = get(k); return (v === null || v === undefined || v === "") ? NaN : Number(v); };
  let max_rungs_per_kind = 5;
  const mr = Math.floor(num("gates.max_rungs_per_kind"));
  if (Number.isFinite(mr) && mr >= 1) max_rungs_per_kind = mr;
  let partial_threshold = 0.5;
  const pt = num("gates.partial_threshold");
  if (Number.isFinite(pt) && pt >= 0 && pt <= 1) partial_threshold = pt;
  const rawExclude = get("gates.exclude");
  const exclude = Array.isArray(rawExclude) ? rawExclude.filter((x) => typeof x === "string") : [];
  // FAFF-984: per-rung spawnSync timeout, raised from a hardcoded 600s to a configurable 30-minute
  // default so a slow-but-green whole-suite UNIT rung isn't killed before it can finish.
  let rung_timeout_ms = 1_800_000;
  const rt = Math.floor(num("gates.rung_timeout_ms"));
  if (Number.isFinite(rt) && rt >= 1) rung_timeout_ms = rt;
  // FAFF-1002: gates.local_shards — the shard count (== max concurrency) for a shard-capable local
  // rung. Present-ness-before-coerce, mirroring the other gates.* guards above: an absent/malformed/
  // non-numeric/<2 value falls back to the DEFAULT (os.availableParallelism()), never to a spurious
  // literal like 1 or 0.
  let local_shards = safeAvailableParallelism();
  const ls = Math.floor(num("gates.local_shards"));
  if (Number.isFinite(ls) && ls >= 2) local_shards = ls;
  // FAFF-1137: gates.local_shard_concurrency — how many of the N shards run at once (a bounded pool
  // in runShardedRung). The default is a quarter of the shard count (defaultShardConcurrency) so a resource-heavy
  // shard can't starve a co-running shard into a spurious RED; the knob only tunes it. Present-ness-
  // before-coerce, mirroring local_shards above: absent/non-numeric/<1 → default; a present value
  // >=1 is honoured verbatim (set it == local_shards to opt back into full-width single-wave, or
  // lower it on a docker-saturating box).
  let local_shard_concurrency = defaultShardConcurrency(local_shards);
  const lsc = Math.floor(num("gates.local_shard_concurrency"));
  if (Number.isFinite(lsc) && lsc >= 1) local_shard_concurrency = lsc;
  // FAFF-1382: gates.local_test_files (a glob, relative to the rung's cwd) opts the local UNIT rung
  // into the gate-owned file pool (runFilePoolRung); gates.serial_tests lists files or globs from
  // that set that run one at a time after the pool drains. The pool runs one file per process, so
  // its width defaults to the core count, not the shard default: Node's own per-process file pool
  // (about one per core) is what multiplied the pressure under sharding. A present
  // local_shard_concurrency still sets the width.
  const rawFiles = get("gates.local_test_files");
  const local_test_files = (typeof rawFiles === "string" && rawFiles.trim()) ? rawFiles.trim() : null;
  const rawSerial = get("gates.serial_tests");
  const serial_tests = Array.isArray(rawSerial) ? rawSerial.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
  const file_pool_concurrency = (Number.isFinite(lsc) && lsc >= 1) ? lsc : safeAvailableParallelism();
  return { fallback, partial, exclude, max_rungs_per_kind, partial_threshold, rung_timeout_ms, local_shards, local_shard_concurrency, local_test_files, serial_tests, file_pool_concurrency };
}

// FAFF-1356: a quarter of the shard count keeps peak pressure on timing-sensitive tests well below the
// old one-core-spare width (half still tripped a sentry-poller timing test on the 8-core reference
// host); the floor of 1 means a host with fewer than 8 shards runs serially.
function defaultShardConcurrency(local_shards) {
  return Math.max(1, Math.floor(local_shards / 4));
}

// os.availableParallelism() is the FAFF-1002 default shard count (mirrors CI's own "N=4 matches the
// 4-vCPU runner" reasoning, adapted to the actual host). Defensive fallback for an older/unusual
// Node build where the function is absent or throws: os.cpus().length, or 1 as the final floor.
function safeAvailableParallelism() {
  try {
    if (typeof os.availableParallelism === "function") {
      const n = os.availableParallelism();
      if (Number.isFinite(n) && n >= 1) return Math.floor(n);
    }
  } catch { /* fall through */ }
  try {
    const n = os.cpus().length;
    if (Number.isFinite(n) && n >= 1) return n;
  } catch { /* fall through */ }
  return 1;
}

// The local host OS family (process.platform → the runs-on families we compare against).
function localOs() {
  const p = process.platform;
  if (p === "darwin") return "macos";
  if (p === "win32") return "windows";
  return "linux";                     // linux + anything unmapped → the default GitHub runner family
}

module.exports = { defaultShardConcurrency, gatesFallbackPolicy, localOs, readGatesConfig, safeAvailableParallelism };
