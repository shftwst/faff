// FAFF-872 — config-lint regression guard: no `.faffrc.yaml` adversarial backend may resolve to an
// unset provider (providerFamily's default is the OpenAI-compatible family) on a bare, non-/v1 host.
// That family GETs {host}/models and POSTs {host}/chat/completions, so a bare host fails LOUD at
// preflight; this guard keeps that failure from landing unnoticed in the committed config
// (no auto-rewrite of a bare host — a config edit is required).
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../plugin/skills/faff/bin/lib/config.js";
import { assembleAdversarialBackends } from "../plugin/skills/faff/bin/lib/adversarial-backends.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

// PURE: does this ONE backend need a /v1-suffixed host? Scoped to a backend whose provider is unset
// (the providerFamily default), which resolves to the OpenAI-compatible family. An explicit
// openai/vllm/nvidia/etc backend carries that host contract itself and stays the operator's own
// responsibility (this guard is not a general host validator). Returns a violation message, or null when clean.
const RISK_PROVIDERS = new Set([""]);

export function lintBackendHost(backend) {
  const rawProvider = backend && backend.provider;
  const provider = rawProvider == null ? "" : String(rawProvider).toLowerCase();
  if (!RISK_PROVIDERS.has(provider)) return null;
  const host = backend && backend.host;
  if (!host) return null;   // an absent host is FAFF-213's own unset signal, not this guard's concern
  const normalised = String(host).replace(/\/+$/, "");
  if (/\/v1$/.test(normalised)) return null;
  return `provider ${JSON.stringify(rawProvider ?? null)} host ${JSON.stringify(host)} lacks a /v1 suffix `
    + "— an unset provider routes through the OpenAI-compatible family, so this host must end in /v1, "
    + "or preflight fails loud";
}

// Reserved adversarial: field names (spec section 4's own list) — anything else at that level is a
// per-consumer sub-block name (FAFF-870: spec_review / code_review / prdr_review, or any future
// name — open-ended by design).
const RESERVED_ADVERSARIAL_KEYS = new Set([
  "refs", "backends", "fallbacks", "host", "provider", "model", "api_key_env", "seat_token_env",
  "auth", "reasoning_off", "reasoning_effort", "reasoning_extra", "timeout", "first_byte_timeout",
  "deadline", "requires", "max_tokens",
]);

function discoverConsumers(cfg) {
  const adv = cfg && cfg.adversarial;
  if (!adv || typeof adv !== "object" || Array.isArray(adv)) return [];
  return Object.keys(adv).filter((k) => !RESERVED_ADVERSARIAL_KEYS.has(k)
    && adv[k] && typeof adv[k] === "object" && !Array.isArray(adv[k]));
}

// Every chain a real build could dispatch: the shared adversarial chain, plus every per-consumer
// chain (assembleAdversarialBackends resolves each by name; an consumer with no usable refs falls
// through to the shared chain byte-identically, so it contributes nothing new here).
function allChains(cfg) {
  const chains = [];
  const shared = assembleAdversarialBackends(cfg);
  if (shared.chain) chains.push({ consumer: null, chain: shared.chain });
  for (const consumer of discoverConsumers(cfg)) {
    const res = assembleAdversarialBackends(cfg, consumer);
    if (res.chain) chains.push({ consumer, chain: res.chain });
  }
  return chains;
}

test("FAFF-872 config-lint: lintBackendHost flags a bare unset-provider host, passes a /v1 one", () => {
  assert.notEqual(lintBackendHost({ host: "http://h:8000" }), null, "unset-provider bare host flagged (the default is openai)");
  assert.equal(lintBackendHost({ host: "http://h:8000/v1" }), null, "unset-provider /v1 host passes");
  assert.equal(lintBackendHost({ host: "http://h:8000/v1/" }), null, "a trailing slash after /v1 still passes");
  assert.equal(lintBackendHost({ provider: "openai", host: "http://h:8000" }), null, "an explicit provider is out of this guard's scope");
  assert.equal(lintBackendHost({ host: undefined }), null, "an absent host is FAFF-213's own signal, not this guard's");
});

test("FAFF-872 config-lint: the live .faffrc.yaml carries no unset-provider backend on a bare (non-/v1) host", () => {
  const [cfg] = loadConfig(REPO_ROOT);
  const violations = [];
  for (const { consumer, chain } of allChains(cfg)) {
    for (const backend of chain) {
      const msg = lintBackendHost(backend);
      if (msg) violations.push(`${consumer ? `adversarial.${consumer}` : "adversarial"} — ${backend.model || "?"}: ${msg}`);
    }
  }
  assert.deepEqual(violations, [], `bare-host regression guard (FAFF-872) tripped:\n${violations.join("\n")}`);
});
