// FAFF-872 — config-lint regression guard: no `.faffrc.yaml` adversarial backend may resolve to
// `provider: ollama` (or an unset provider — providerFamily's own unset-default alias,
// review-call.mjs:84) on a bare, non-/v1 host. review-call.mjs's native ollama transport family
// (a dedicated /api/tags + /api/chat NDJSON path) is gone (D-fold); an un-migrated bare-host ollama
// backend now silently routes to the OpenAI-compatible family (D-default) and fails LOUD at
// preflight rather than the deleted native /api/tags check. This is the atomic-migration guard
// (D-host: no auto-rewrite of a bare host — a config edit is required) that keeps that failure from
// landing unnoticed in the committed config, folded in from the prior spec-review's residual QA-minor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../plugin/skills/faff/bin/lib/config.js";
import { assembleAdversarialBackends } from "../plugin/skills/faff/bin/lib/adversarial-backends.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

// PURE: does this ONE backend need a /v1-suffixed host? Scoped to the exact migration hazard the
// fold introduced — a backend whose provider is "ollama" (case-insensitive) or unset (the
// providerFamily default alias) now resolves to the OpenAI-compatible family, which GETs
// {host}/models and POSTs {host}/chat/completions. An explicit openai/vllm/nvidia/etc backend
// already carried that host contract before this ticket and stays the operator's own responsibility
// (this guard is not a general host validator). Returns a violation message, or null when clean.
const RISK_PROVIDERS = new Set(["ollama", ""]);

export function lintBackendHost(backend) {
  const rawProvider = backend && backend.provider;
  const provider = rawProvider == null ? "" : String(rawProvider).toLowerCase();
  if (!RISK_PROVIDERS.has(provider)) return null;
  const host = backend && backend.host;
  if (!host) return null;   // an absent host is FAFF-213's own unset signal, not this guard's concern
  const normalised = String(host).replace(/\/+$/, "");
  if (/\/v1$/.test(normalised)) return null;
  return `provider ${JSON.stringify(rawProvider ?? null)} host ${JSON.stringify(host)} lacks a /v1 suffix `
    + "— review-call.mjs's native ollama transport is gone (FAFF-872); this host now routes through "
    + "the OpenAI-compatible family and must end in /v1, or preflight fails loud";
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

test("FAFF-872 config-lint: lintBackendHost flags a bare ollama/unset-provider host, passes a /v1 one", () => {
  assert.notEqual(lintBackendHost({ provider: "ollama", host: "http://h:11434" }), null, "bare ollama host flagged");
  assert.equal(lintBackendHost({ provider: "ollama", host: "http://h:11434/v1" }), null, "/v1 host passes");
  assert.equal(lintBackendHost({ provider: "OLLAMA", host: "http://h:11434/v1" }), null, "provider match is case-insensitive");
  assert.notEqual(lintBackendHost({ host: "http://h:11434" }), null, "unset-provider bare host flagged (FAFF-872 default is openai)");
  assert.equal(lintBackendHost({ host: "http://h:11434/v1" }), null, "unset-provider /v1 host passes");
  assert.equal(lintBackendHost({ provider: "openai", host: "http://h:11434" }), null, "an explicit non-ollama provider is out of this guard's scope");
  assert.equal(lintBackendHost({ provider: "ollama", host: "http://h:11434/v1/" }), null, "a trailing slash after /v1 still passes");
  assert.equal(lintBackendHost({ provider: "ollama", host: undefined }), null, "an absent host is FAFF-213's own signal, not this guard's");
});

test("FAFF-872 config-lint: the live .faffrc.yaml carries no provider:ollama / unset-provider backend on a bare (non-/v1) host", () => {
  const [cfg] = loadConfig(REPO_ROOT);
  const violations = [];
  for (const { consumer, chain } of allChains(cfg)) {
    for (const backend of chain) {
      const msg = lintBackendHost(backend);
      if (msg) violations.push(`${consumer ? `adversarial.${consumer}` : "adversarial"} — ${backend.model || "?"}: ${msg}`);
    }
  }
  assert.deepEqual(violations, [], `atomic-migration regression guard (FAFF-872) tripped:\n${violations.join("\n")}`);
});
