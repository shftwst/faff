// FAFF-523 — the shared named model/provider/auth backend config namespace. Covers the pure
// core (deriveAuth/deriveEgress, mergeBackendsNamespace, resolveBackendRefs, checkRealizable,
// resolveTokenSource, backendsConfigCheckFindings), the CLI (`faff backends resolve|realizable`,
// exit codes, --selftest), and the two migration-proof integration points: the adversarial
// review's `refs:` form (assembleAdversarialBackends) and a second, non-adversarial consumer
// (the engine lane, `engine:<name>`) resolving a named backend from the SAME merged namespace.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import {
  CURRENT_HARNESS, RESIDENCY_REQUIRED_VALUES, backendsConfigCheckFindings, checkRealizable, deriveAuth, deriveEgress,
  mergeBackendsNamespace, normalizeBackend, portableMatrixAdmits, resolveBackendRefs,
  resolveTokenSource, validateBackendConstraints,
} from "../plugin/skills/faff/bin/lib/backends.js";
import { assembleAdversarialBackends } from "../plugin/skills/faff/bin/lib/adversarial-backends.js";
import { resolveEngineForLane, validateEngineRef } from "../plugin/skills/faff/bin/lib/config.js";

function fixtureDir(faffrcBody) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff523-"));
  if (faffrcBody !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), faffrcBody);
  return dir;
}

// ===========================================================================
// deriveAuth / deriveEgress — pure derivation, explicit value always wins
// ===========================================================================

test("deriveAuth: api_key_env present -> api-key", () => {
  assert.equal(deriveAuth({ api_key_env: "K" }), "api-key");
});
test("deriveAuth: keyless anthropic -> subscription-seat (binds to the ambient session, no handle)", () => {
  assert.equal(deriveAuth({ provider: "anthropic" }), "subscription-seat");
});
test("deriveAuth: keyless non-anthropic -> none", () => {
  assert.equal(deriveAuth({ provider: "ollama" }), "none");
});
test("deriveEgress: tailscale (*.ts.net) host -> local", () => {
  assert.equal(deriveEgress({ host: "http://studio.x.ts.net:11434" }), "local");
});
test("deriveEgress: a public host -> external", () => {
  assert.equal(deriveEgress({ host: "https://integrate.api.nvidia.com/v1" }), "external");
});
test("deriveEgress: RFC1918 hosts -> local", () => {
  assert.equal(deriveEgress({ host: "http://10.0.0.5:1234" }), "local");
  assert.equal(deriveEgress({ host: "http://192.168.1.5:1234" }), "local");
  assert.equal(deriveEgress({ host: "http://172.20.0.5:1234" }), "local");
});
test("normalizeBackend: explicit auth/egress always wins over derivation", () => {
  const res = normalizeBackend("x", { provider: "anthropic", auth: "api-key", api_key_env: "K", host: "https://api.anthropic.com", egress: "local" });
  assert.equal(res.error, undefined);
  assert.equal(res.backend.auth, "api-key");
  assert.equal(res.backend.egress, "local");
});

// ===========================================================================
// validateBackendConstraints — the three CONSTRAINT rules (spec §3)
// ===========================================================================

test("constraints: auth: subscription-seat MUST NOT carry api_key_env (no seat_ref handle field, FAFF-523)", () => {
  const err = validateBackendConstraints("claude-sub", { auth: "subscription-seat", api_key_env: "SOME_KEY", egress: "external", telemetry: "none" });
  assert.match(err, /must not carry api_key_env/);
});
test("constraints: auth: api-key requires api_key_env", () => {
  const err = validateBackendConstraints("x", { auth: "api-key", egress: "external", telemetry: "none" });
  assert.match(err, /requires api_key_env/);
});
test("constraints: a fully valid record passes", () => {
  assert.equal(validateBackendConstraints("x", { auth: "none", egress: "local", telemetry: "none" }), null);
});

// ===========================================================================
// mergeBackendsNamespace — engines: folds into backends: at load; collision = hard error
// ===========================================================================

test("merge: engines: and backends: fold into one namespace, no collision", () => {
  const cfg = {
    backends: { a: { provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K1" } },
    engines: { b: { provider: "ollama", model: "m2", host: "http://studio.x.ts.net:11434" } },
  };
  const res = mergeBackendsNamespace(cfg);
  assert.equal(res.error, undefined);
  assert.ok(res.backends.a && res.backends.b, "both sources present in the merged namespace");
});

test("merge: a name in BOTH engines: and backends: is a hard error, never last-wins", () => {
  const cfg = {
    backends: { shared: { provider: "nvidia", model: "m1", host: "https://a/v1" } },
    engines: { shared: { provider: "ollama", model: "m2", host: "http://h:1" } },
  };
  const res = mergeBackendsNamespace(cfg);
  assert.match(res.error, /name collision/);
});

// ===========================================================================
// resolveBackendRefs — ordered list of NAMES, no "primary" (FAFF-261's flip)
// ===========================================================================

test("resolveBackendRefs: refs order is preserved, index 0 first-served", () => {
  const cfg = { backends: {
    a: { provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K1" },
    b: { provider: "gemini", model: "m2", host: "https://b/v1", api_key_env: "K2" },
  } };
  const res = resolveBackendRefs(cfg, ["b", "a"]);
  assert.deepEqual(res.chain.map((b) => b.name), ["b", "a"]);
});

test("resolveBackendRefs: an unknown name hard-fails (fail loud, never a silent skip)", () => {
  const res = resolveBackendRefs({ backends: {} }, ["nope"]);
  assert.match(res.error, /unknown backend: nope/);
});

// ===========================================================================
// checkRealizable — run-start fail-closed realizability (the security surface)
// ===========================================================================

test("checkRealizable: requires:local + an egress:external ref -> refuse residency-violation naming it, before any dispatch", () => {
  const cfg = { backends: {
    "studio-ollama": { provider: "ollama", model: "m1", host: "http://studio.x.ts.net:11434" },
    "gemini-gemma": { provider: "gemini", model: "m2", host: "https://generativelanguage.googleapis.com/v1beta/openai", api_key_env: "GEMINI_API_KEY" },
  } };
  const res = checkRealizable(cfg, { refs: ["studio-ollama", "gemini-gemma"], requires: "local" });
  assert.equal(res.refuse, true);
  assert.match(res.reason, /^residency-violation: gemini-gemma/);
});

test("checkRealizable: egress derivation for a requires:local check (studio-ollama local, nvidia-glm external)", () => {
  assert.equal(deriveEgress({ host: "http://studio.x.ts.net:11434" }), "local");
  assert.equal(deriveEgress({ host: "https://integrate.api.nvidia.com/v1" }), "external");
});

// --- fix for the parked Phase-2 adversarial critical: checkRealizable must re-derive egress
// at CHECK time (spec §4's literal deriveEgress(b) call), not trust the stored/normalized
// value — an explicit egress: local LIE on a genuinely public host must not pass the gate.
test("checkRealizable: an EXPLICIT egress:local lie on a public host is re-derived and still refuses", () => {
  const cfg = { backends: {
    "lying-backend": { provider: "nvidia", model: "m1", host: "https://integrate.api.nvidia.com/v1", api_key_env: "K", egress: "local" },
  } };
  const res = checkRealizable(cfg, { refs: ["lying-backend"], requires: "local" });
  assert.equal(res.refuse, true);
  assert.match(res.reason, /^residency-violation: lying-backend/);
});

test("checkRealizable: the stored/normalized b.egress still honors 'explicit value wins' — only the GATE re-derives", () => {
  const cfg = {
    backends: { "lying-backend": { provider: "nvidia", model: "m1", host: "https://integrate.api.nvidia.com/v1", api_key_env: "K", egress: "local" } },
  };
  const merged = mergeBackendsNamespace(cfg);
  assert.equal(merged.backends["lying-backend"].egress, "local", "the stored field is untouched by the gate's re-derivation");
});

test("checkRealizable: an explicit egress:local claim that IS actually local (host agrees) still passes", () => {
  const cfg = { backends: {
    "honest-backend": { provider: "ollama", model: "m1", host: "http://10.0.0.5:11434", egress: "local" },
  } };
  const res = checkRealizable(cfg, { refs: ["honest-backend"], requires: "local" });
  assert.equal(res.ok, true);
});

// --- fix: consumer.requires is a CLOSED enum ("local", alias "no-egress"), FAIL-CLOSED on
// an unrecognized value — a typo must never silently skip the residency gate.
test("checkRealizable: requires: no-egress (documented alias) behaves identically to requires: local", () => {
  assert.deepEqual(RESIDENCY_REQUIRED_VALUES, ["local", "no-egress"]);
  const cfg = { backends: { ext: { provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K" } } };
  const res = checkRealizable(cfg, { refs: ["ext"], requires: "no-egress" });
  assert.equal(res.refuse, true);
  assert.match(res.reason, /^residency-violation: ext/);
});

test("checkRealizable: an unrecognized requires value fails closed (never a silent skip of the residency gate)", () => {
  const cfg = { backends: { ext: { provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K" } } };
  for (const bad of ["locla", "Local", "local ", ""]) {
    if (bad === "") continue; // empty is "absent" — no residency constraint, not a typo
    const res = checkRealizable(cfg, { refs: ["ext"], requires: bad });
    assert.equal(res.refuse, true, `requires: ${JSON.stringify(bad)} must refuse, not silently pass`);
    assert.equal(res.needsHuman, true);
    assert.match(res.reason, /unrecognized consumer\.requires/);
  }
});

test("checkRealizable: requires absent entirely -> no residency constraint, chain can still be realizable", () => {
  const cfg = { backends: { ext: { provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "K" } } };
  const res = checkRealizable(cfg, { refs: ["ext"] });
  assert.equal(res.ok, true);
});

test("checkRealizable: a whole chain unrealizable on this harness -> refuse chain-unrealizable, never pass+skip", () => {
  const cfg = { backends: { a: { provider: "nvidia", model: "m1" } } }; // host unset
  const res = checkRealizable(cfg, { refs: ["a"] });
  assert.equal(res.refuse, true);
  assert.equal(res.reason, "chain-unrealizable");
});

test("checkRealizable: a served fallback admits — not any single backend being down", () => {
  const cfg = { backends: {
    down: { provider: "nvidia", model: "m1" }, // host unset, unrealizable
    up: { provider: "nvidia", model: "m2", host: "https://a/v1", api_key_env: "K" },
  } };
  const res = checkRealizable(cfg, { refs: ["down", "up"] });
  assert.equal(res.ok, true);
});

test("checkRealizable: auth: subscription-seat resolves only on the interactive/claude-code harness", () => {
  const cfg = { backends: { a: { provider: "anthropic", model: "claude-frontier", host: "https://api.anthropic.com" } } };
  assert.equal(checkRealizable(cfg, { refs: ["a"] }, CURRENT_HARNESS).ok, true);
  const off = checkRealizable(cfg, { refs: ["a"] }, "some-other-harness");
  assert.equal(off.refuse, true);
  assert.equal(off.reason, "chain-unrealizable");
});

test("portableMatrixAdmits: api-key/none are harness-agnostic; subscription-seat is claude-code-only", () => {
  assert.equal(portableMatrixAdmits("anything", "nvidia", "api-key"), true);
  assert.equal(portableMatrixAdmits("anything", "ollama", "none"), true);
  assert.equal(portableMatrixAdmits(CURRENT_HARNESS, "anthropic", "subscription-seat"), true);
  assert.equal(portableMatrixAdmits("other", "anthropic", "subscription-seat"), false);
});

// ===========================================================================
// resolveTokenSource — auth: api-key -> named env var; auth: subscription-seat -> ambient session
// ===========================================================================

test("resolveTokenSource: api-key -> the named env var", () => {
  const t = resolveTokenSource({ auth: "api-key", api_key_env: "NVIDIA_API_KEY" });
  assert.deepEqual(t, { source: "env", env: "NVIDIA_API_KEY" });
});
test("resolveTokenSource: subscription-seat -> the ambient interactive session, no handle", () => {
  assert.deepEqual(resolveTokenSource({ auth: "subscription-seat" }), { source: "ambient-session" });
});

// ===========================================================================
// backendsConfigCheckFindings — the derived-egress residency-soundness guard
// ===========================================================================

test("configCheck guard: requires:local chain on a DERIVED (not explicit) egress:local backend -> warns", () => {
  const cfg = {
    backends: { "studio-ollama": { provider: "ollama", model: "m1", host: "http://studio.x.ts.net:11434" } },
    faffter_dark: { adversarial: { refs: ["studio-ollama"], requires: "local" } },
  };
  const findings = backendsConfigCheckFindings(cfg);
  assert.ok(findings.some((f) => f.severity === "warn" && /DERIVED/.test(f.message)));
});

test("configCheck guard: requires:local chain on an EXPLICIT egress:local backend -> silent", () => {
  const cfg = {
    backends: { "studio-ollama": { provider: "ollama", model: "m1", host: "http://studio.x.ts.net:11434", egress: "local" } },
    faffter_dark: { adversarial: { refs: ["studio-ollama"], requires: "local" } },
  };
  const findings = backendsConfigCheckFindings(cfg);
  assert.ok(!findings.some((f) => /DERIVED/.test(f.message)));
});

test("configCheck guard: requires: no-egress (documented alias) processes the chain same as requires: local", () => {
  const cfg = {
    backends: { "studio-ollama": { provider: "ollama", model: "m1", host: "http://studio.x.ts.net:11434" } }, // derived local
    faffter_dark: { adversarial: { refs: ["studio-ollama"], requires: "no-egress" } },
  };
  const findings = backendsConfigCheckFindings(cfg);
  assert.ok(findings.some((f) => f.severity === "warn" && /DERIVED/.test(f.message)));
});

test("configCheck guard: an unrecognized requires value -> fail-loud error finding, never a silent skip", () => {
  const cfg = {
    backends: { "studio-ollama": { provider: "ollama", model: "m1", host: "http://studio.x.ts.net:11434" } },
    faffter_dark: { adversarial: { refs: ["studio-ollama"], requires: "Local" } }, // case-typo
  };
  const findings = backendsConfigCheckFindings(cfg);
  assert.ok(findings.some((f) => f.severity === "error" && /unrecognized value/.test(f.message) && /Local/.test(f.message)));
});

// ===========================================================================
// CLI — faff backends resolve|realizable
// ===========================================================================

test("CLI: backends resolve — exit 0, JSON chain in refs order", () => {
  const dir = fixtureDir(
    "backends:\n" +
    "  a:\n    provider: nvidia\n    model: m1\n    host: https://a/v1\n    api_key_env: K1\n" +
    "  b:\n    provider: ollama\n    model: m2\n    host: http://h.ts.net:1\n",
  );
  try {
    const r = runCli(["backends", "resolve", "--refs", "b,a"], { cwd: dir });
    assert.equal(r.code, 0, r.stderr);
    const chain = JSON.parse(r.stdout);
    assert.deepEqual(chain.map((b) => b.name), ["b", "a"]);
    assert.equal(chain[0].auth, "none");
    assert.equal(chain[0].egress, "local");
    assert.equal(chain[1].auth, "api-key");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: backends resolve — exit 2 on an unknown backend name", () => {
  const dir = fixtureDir("backends:\n  a:\n    provider: nvidia\n    model: m1\n    host: https://a/v1\n");
  try {
    const r = runCli(["backends", "resolve", "--refs", "nope"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown backend/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: backends realizable — exit 1 + residency-violation JSON on requires:local + an external ref", () => {
  const dir = fixtureDir(
    "backends:\n" +
    "  local-one:\n    provider: ollama\n    model: m1\n    host: http://h.ts.net:1\n" +
    "  ext-one:\n    provider: nvidia\n    model: m2\n    host: https://a/v1\n    api_key_env: K\n",
  );
  try {
    const r = runCli(["backends", "realizable", "--refs", "local-one,ext-one", "--requires", "local", "--json"], { cwd: dir });
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.refuse, true);
    assert.match(out.reason, /^residency-violation: ext-one/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: backends realizable — exit 0 ok on a realizable chain", () => {
  const dir = fixtureDir("backends:\n  a:\n    provider: nvidia\n    model: m1\n    host: https://a/v1\n    api_key_env: K\n");
  try {
    const r = runCli(["backends", "realizable", "--refs", "a", "--json"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.stdout), { ok: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: backends --selftest passes", () => {
  const r = runCli(["backends", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

// ===========================================================================
// Migration-proof integration point 1: the adversarial review's `refs:` form
// resolves against the shared backends: namespace, byte-equivalent output to
// an equivalent legacy primary+fallbacks block (the DONE-listed migration proof).
// ===========================================================================

test("integration: faffter_dark.adversarial refs: resolves against backends:, byte-equivalent to the legacy chain (optionals restated — named backends: never inherit)", () => {
  const legacyCfg = { faffter_dark: { adversarial: {
    provider: "nvidia", model: "nvidia/nemotron", host: "https://integrate.api.nvidia.com/v1", api_key_env: "NVIDIA_API_KEY", timeout: 480,
    fallbacks: [{ provider: "ollama", model: "qwen3-next:80b", host: "http://studio.x.ts.net:11434" }],
  } } };
  const legacy = assembleAdversarialBackends(legacyCfg);
  // The legacy fallback carries no api_key_env/timeout of its own, so it INHERITS both from
  // the primary (inheritOptionalFromPrimary) — spec-documented legacy behaviour.
  assert.deepEqual(legacy.chain[1], { provider: "ollama", model: "qwen3-next:80b", host: "http://studio.x.ts.net:11434", api_key_env: "NVIDIA_API_KEY", timeout: 480 });

  // Named backends: entries do NOT inherit (spec §4 edge cases) — byte-equivalence for THIS
  // scenario requires restating both previously-inherited optionals explicitly.
  const migratedCfg = {
    backends: {
      "nvidia-glm": { provider: "nvidia", model: "nvidia/nemotron", host: "https://integrate.api.nvidia.com/v1", api_key_env: "NVIDIA_API_KEY", timeout: 480 },
      "studio-ollama": { provider: "ollama", model: "qwen3-next:80b", host: "http://studio.x.ts.net:11434", api_key_env: "NVIDIA_API_KEY", timeout: 480 },
    },
    faffter_dark: { adversarial: { refs: ["nvidia-glm", "studio-ollama"] } },
  };
  const migrated = assembleAdversarialBackends(migratedCfg);

  assert.equal(migrated.error, undefined);
  assert.deepEqual(migrated.chain, legacy.chain, "refs: form over backends: is byte-identical to the equivalent legacy primary+fallbacks chain, once inherited optionals are restated");
});

test("integration: migration MAY instead consciously drop a spurious inherited optional (documented deviation, per spec's own example)", () => {
  // The spec explicitly names this exact case as an acceptable documented deviation: a
  // keyless local ollama fallback spuriously inheriting the primary's NVIDIA_API_KEY under
  // the legacy form. Not restating it on the named backend is a legitimate, one-line
  // documented choice — the migrated chain then correctly drops the spurious key, rather
  // than being forced to carry it forward just to stay byte-identical to a legacy artifact.
  const migratedCfg = {
    backends: { "studio-ollama": { provider: "ollama", model: "qwen3-next:80b", host: "http://studio.x.ts.net:11434" } },
    faffter_dark: { adversarial: { refs: ["studio-ollama"] } },
  };
  const migrated = assembleAdversarialBackends(migratedCfg);
  assert.deepEqual(migrated.chain, [{ provider: "ollama", model: "qwen3-next:80b", host: "http://studio.x.ts.net:11434" }]);
  assert.ok(!("api_key_env" in migrated.chain[0]), "no spurious key carried forward once the deviation is deliberate");
});

test("integration: an unresolvable refs: name is malformed (exit 2 class), never a silent partial chain", () => {
  const cfg = { faffter_dark: { adversarial: { refs: ["nope"] } } };
  const res = assembleAdversarialBackends(cfg);
  assert.equal(res.error, "malformed");
  assert.match(res.detail, /unknown backend/);
});

test("CLI: adversarial-backends with a refs: config resolves cleanly", () => {
  const dir = fixtureDir(
    "backends:\n" +
    "  nvidia-glm:\n    provider: nvidia\n    model: nvidia/nemotron\n    host: https://integrate.api.nvidia.com/v1\n    api_key_env: NVIDIA_API_KEY\n" +
    "faffter_dark:\n  adversarial:\n    refs:\n      - nvidia-glm\n",
  );
  try {
    const r = runCli(["adversarial-backends"], { cwd: dir });
    assert.equal(r.code, 0, r.stderr);
    const chain = JSON.parse(r.stdout);
    assert.deepEqual(chain, [{ provider: "nvidia", model: "nvidia/nemotron", host: "https://integrate.api.nvidia.com/v1", api_key_env: "NVIDIA_API_KEY" }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ===========================================================================
// Migration-proof integration point 2: a SECOND, non-adversarial consumer
// (the engine lane) resolves a named backend from the SAME merged namespace —
// a backend declared only under top-level `backends:` (never `engines:`) is
// equally reachable via engine:<name>.
// ===========================================================================

test("integration: models.<lane> = engine:<name> resolves a backend declared ONLY under backends: (not engines:)", () => {
  const cfg = {
    backends: { "studio-ollama": { provider: "ollama", model: "qwen3-next:80b", host: "http://studio.x.ts.net:11434" } },
    models: { methodology: "engine:studio-ollama", intake: "sonnet" },
  };
  const res = resolveEngineForLane(cfg, "methodology");
  assert.equal(res.error, undefined);
  assert.equal(res.name, "studio-ollama");
  assert.equal(res.family, "ollama");
  assert.equal(res.host, "http://studio.x.ts.net:11434");
});

test("integration: engine: consumer still refuses provider: anthropic, even though the namespace accepts it", () => {
  const cfg = { backends: { "claude-sub": { provider: "anthropic", model: "claude-frontier", host: "https://api.anthropic.com" } } };
  const err = validateEngineRef(cfg, "engine:claude-sub");
  assert.match(err, /anthropic.*refused/);
});

test("integration: engines:/backends: name collision surfaces at the engine-lane resolution boundary too", () => {
  const cfg = {
    backends: { shared: { provider: "nvidia", model: "m1", host: "https://a/v1" } },
    engines: { shared: { provider: "ollama", model: "m2", host: "http://h:1" } },
    models: { intake: "engine:shared" },
  };
  const res = resolveEngineForLane(cfg, "intake");
  assert.match(res.error, /name collision/);
});

// --- FAFF-604: the telemetry field -----------------------------------------

test("telemetry derives per family and is carried on the normalized record", () => {
  const codex = normalizeBackend("seat", { provider: "codex", model: "gpt-5-codex" });
  assert.equal(codex.backend.telemetry, "exec-json-events");
  const local = normalizeBackend("lan", { provider: "ollama", model: "q", host: "http://localhost:11434" });
  assert.equal(local.backend.telemetry, "none", "a family with no readable spend source must derive none, never a false-metered claim");
});

test("an explicit telemetry value wins over the derivation", () => {
  const r = normalizeBackend("seat", { provider: "codex", model: "m", telemetry: "none" });
  assert.equal(r.backend.telemetry, "none");
});

test("a backend cannot claim a spend source its family cannot serve", () => {
  const r = normalizeBackend("lan", { provider: "ollama", model: "q", host: "http://localhost:11434", telemetry: "exec-json-events" });
  assert.match(r.error, /requires provider codex/);
  const r2 = normalizeBackend("seat", { provider: "codex", model: "m", telemetry: "transcript-jsonl" });
  assert.match(r2.error, /requires provider anthropic/);
});

test("an off-vocabulary telemetry value fails loud at normalize time, naming the legal set", () => {
  const r = normalizeBackend("seat", { provider: "codex", model: "m", telemetry: "transcript" });
  assert.match(r.error, /invalid telemetry "transcript"/);
  assert.match(r.error, /transcript-jsonl \| exec-json-events \| none/);
});

test("FAFF-604: a budget.allow_unmetered entry naming no configured backend warns as a dead waiver", () => {
  const findings = backendsConfigCheckFindings({
    backends: { lan: { provider: "ollama", model: "q", host: "http://localhost:11434" } },
    budget: { allow_unmetered: ["lan", "ghost"] },
  });
  const dead = findings.filter((f) => f.surface === "budget.allow_unmetered");
  assert.equal(dead.length, 1, "only the unknown name is flagged, never the live one");
  assert.equal(dead[0].severity, "warn", "a renamed backend must not brick the config");
  assert.match(dead[0].message, /"ghost"/);
});
