// FAFF-261 — mechanical adversarial-backends assembly. Replaces agent hand-JSON.parse +
// merge + temp-file of `adversarial.fallbacks` with the deterministic
// `faff adversarial-backends` subcommand. Covers: the pure assembler (legacy primary-only,
// legacy primary+fallbacks inheritance + `nvidia/`-prefix preservation, native `backends:`
// array, unset-host, malformed fallbacks), the CLI exit-code contract (0/2/3), and the
// round-trip contract against `review-call.mjs`'s own `--backends-json` mapper — the emitter
// must feed the exact fields the transport reads, so the FAFF-246 retyping hazard this
// ticket exists to close can never recur. `review-call.mjs` itself is untouched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import {
  BACKEND_KEYS, assembleAdversarialBackends, pickBackendKeys, inheritOptionalFromPrimary,
} from "../plugin/skills/faff/bin/lib/adversarial-backends.js";
import { main as reviewCallMain, EXIT } from "../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";

function fixtureDir(faffrcBody) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff261-"));
  if (faffrcBody !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), faffrcBody);
  return dir;
}

// ===========================================================================
// Pure core — assembleAdversarialBackends
// ===========================================================================

test("legacy primary-only: one-element chain, no fallbacks key at all", () => {
  const cfg = { adversarial: {
    provider: "nvidia", model: "nvidia/nemotron-3-super-120b-a12b",
    host: "https://integrate.api.nvidia.com/v1", api_key_env: "NVIDIA_API_KEY", timeout: 480,
  }  };
  const res = assembleAdversarialBackends(cfg);
  assert.equal(res.error, undefined);
  assert.deepEqual(res.chain, [{
    provider: "nvidia", model: "nvidia/nemotron-3-super-120b-a12b",
    host: "https://integrate.api.nvidia.com/v1", api_key_env: "NVIDIA_API_KEY", timeout: 480,
  }]);
});

test("legacy primary + fallbacks: primary-first order, nvidia/ prefix intact, omitted optional keys inherited", () => {
  const cfg = { adversarial: {
    provider: "nvidia", model: "nvidia/nemotron-3-super-120b-a12b",
    host: "https://integrate.api.nvidia.com/v1", api_key_env: "NVIDIA_API_KEY", timeout: 480,
    fallbacks: JSON.stringify([{ provider: "ollama", model: "qwen3-next:80b", host: "http://studio:11434" }]),
  }  };
  const res = assembleAdversarialBackends(cfg);
  assert.equal(res.chain.length, 2, "primary + one fallback");
  assert.equal(res.chain[0].model, "nvidia/nemotron-3-super-120b-a12b", "the FAFF-246 retyping hazard — the nvidia/ prefix must survive intact");
  assert.deepEqual(res.chain[1], {
    provider: "ollama", model: "qwen3-next:80b", host: "http://studio:11434",
    api_key_env: "NVIDIA_API_KEY", timeout: 480, // inherited from the primary — never hand-typed
  });
});

test("legacy fallback with its OWN api_key_env is never overwritten by inheritance", () => {
  const cfg = { adversarial: {
    provider: "nvidia", model: "m1", host: "https://a/v1", api_key_env: "PRIMARY_KEY",
    fallbacks: JSON.stringify([{ provider: "openai", model: "m2", host: "https://b/v1", api_key_env: "FALLBACK_KEY" }]),
  }  };
  const res = assembleAdversarialBackends(cfg);
  assert.equal(res.chain[1].api_key_env, "FALLBACK_KEY");
});

test("legacy, fallbacks authored as a NATIVE YAML array (not JSON-string) is used as-is, never JSON.parse'd", () => {
  // FAFF-262 lets the config parser turn a block sequence under ANY key into a real JS
  // array. A real .faffrc.yaml's `adversarial.fallbacks` may already be
  // authored this way (not the quoted JSON-string form) — JSON.parse on an array would
  // coerce via toString() and wrongly report "malformed". Must be used as-is.
  const cfg = { adversarial: {
    provider: "nvidia", model: "nvidia/m1", host: "https://a/v1", api_key_env: "NVIDIA_API_KEY",
    fallbacks: [{ provider: "gemini", model: "models/gemma-4-31b-it", host: "https://generativelanguage.googleapis.com/v1beta/openai", api_key_env: "GEMINI_API_KEY" }],
  }  };
  const res = assembleAdversarialBackends(cfg);
  assert.equal(res.error, undefined);
  assert.equal(res.chain.length, 2);
  assert.deepEqual(res.chain[1], {
    provider: "gemini", model: "models/gemma-4-31b-it",
    host: "https://generativelanguage.googleapis.com/v1beta/openai", api_key_env: "GEMINI_API_KEY",
  });
});

test("native backends: array is emitted as-is, primary-first order preserved, no cross-element inheritance", () => {
  const cfg = { adversarial: { backends: [
    { provider: "nvidia", model: "nvidia/m1", host: "https://a/v1", api_key_env: "K1" },
    { provider: "ollama", model: "m2", host: "http://b:11434" },
  ] }  };
  const res = assembleAdversarialBackends(cfg);
  assert.deepEqual(res.chain, [
    { provider: "nvidia", model: "nvidia/m1", host: "https://a/v1", api_key_env: "K1" },
    { provider: "ollama", model: "m2", host: "http://b:11434" },
  ], "no primary-key inheritance applied inside the native form");
});

test("native empty backends[] falls through to the legacy branch; unset host there → unset", () => {
  assert.equal(assembleAdversarialBackends({ adversarial: { backends: [] }  }).error, "unset");
});

test("absent adversarial block → unset", () => {
  assert.equal(assembleAdversarialBackends({}).error, "unset");
  assert.equal(assembleAdversarialBackends({ }).error, "unset");
});

test("legacy scalars present but host unset (FAFF-213 signal) → unset, never a localhost default", () => {
  const cfg = { adversarial: { provider: "nvidia", model: "m1" }  };
  const res = assembleAdversarialBackends(cfg);
  assert.equal(res.error, "unset");
  assert.equal(res.chain, undefined, "no chain — the caller must never synthesize a localhost-defaulted chain");
});

test("malformed fallbacks (not valid JSON) → malformed, never a silent [primary]-only chain", () => {
  const cfg = { adversarial: { provider: "nvidia", model: "m1", host: "https://a/v1", fallbacks: "{not json" } } ;
  const res = assembleAdversarialBackends(cfg);
  assert.equal(res.error, "malformed");
  assert.equal(res.chain, undefined);
});

test("fallbacks parses but is not an array → malformed", () => {
  const cfg = { adversarial: { provider: "nvidia", model: "m1", host: "https://a/v1", fallbacks: '{"a":1}' }  };
  assert.equal(assembleAdversarialBackends(cfg).error, "malformed");
});

test("pickBackendKeys never leaks an unrelated config key", () => {
  const out = pickBackendKeys({ provider: "p", model: "m", host: "h", some_other_key: "leak?" });
  assert.deepEqual(out, { provider: "p", model: "m", host: "h" });
});

test("inheritOptionalFromPrimary only fills OMITTED optional keys, never provider/model/host", () => {
  const primary = { provider: "primary-p", model: "primary-m", host: "primary-h", api_key_env: "PK", timeout: 100 };
  const fb = { provider: "fb-p", model: "fb-m", host: "fb-h" };
  const out = inheritOptionalFromPrimary(fb, primary);
  assert.deepEqual(out, { provider: "fb-p", model: "fb-m", host: "fb-h", api_key_env: "PK", timeout: 100 });
});

// ===========================================================================
// CLI contract — exit codes 0 / 2 / 3, --selftest, --json accepted-and-ignored
// ===========================================================================

test("CLI: exit 0, stdout is the primary-first JSON array", () => {
  const dir = fixtureDir("adversarial:\n  provider: nvidia\n  model: nvidia/nemotron\n  host: https://a/v1\n");
  try {
    const r = runCli(["adversarial-backends"], { cwd: dir });
    assert.equal(r.code, 0);
    const chain = JSON.parse(r.stdout);
    assert.deepEqual(chain, [{ provider: "nvidia", model: "nvidia/nemotron", host: "https://a/v1" }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: exit 3 when adversarial is entirely absent", () => {
  const dir = fixtureDir("appetite: high\n");
  try {
    const r = runCli(["adversarial-backends"], { cwd: dir });
    assert.equal(r.code, 3);
    assert.equal(r.stdout.trim(), "", "no chain on stdout for an unconfigured provider");
    assert.match(r.stderr, /unset/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: exit 3 when the legacy host key is unset (provider/model present)", () => {
  const dir = fixtureDir("adversarial:\n  provider: nvidia\n  model: m1\n");
  try {
    const r = runCli(["adversarial-backends"], { cwd: dir });
    assert.equal(r.code, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: exit 2 on malformed fallbacks JSON", () => {
  const dir = fixtureDir('adversarial:\n  provider: nvidia\n  model: m1\n  host: https://a/v1\n  fallbacks: "{not json"\n');
  try {
    const r = runCli(["adversarial-backends"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), "");
    assert.match(r.stderr, /fallbacks/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: --json is accepted-and-ignored (same JSON array either way)", () => {
  const dir = fixtureDir("adversarial:\n  provider: nvidia\n  model: m1\n  host: https://a/v1\n");
  try {
    const plain = runCli(["adversarial-backends"], { cwd: dir });
    const withJson = runCli(["adversarial-backends", "--json"], { cwd: dir });
    assert.equal(plain.code, 0);
    assert.equal(withJson.code, 0);
    assert.equal(plain.stdout, withJson.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: fallbacks authored as a real YAML block sequence (the shape this repo's own .faffrc.yaml uses) resolves cleanly, not malformed", () => {
  const dir = fixtureDir(
    "adversarial:\n" +
    "  provider: nvidia\n" +
    "  model: nvidia/nemotron-3-super-120b-a12b\n" +
    "  host: https://integrate.api.nvidia.com/v1\n" +
    "  api_key_env: NVIDIA_API_KEY\n" +
    "  fallbacks:\n" +
    "      - provider: gemini\n" +
    "        model: models/gemma-4-31b-it\n" +
    "        host: https://generativelanguage.googleapis.com/v1beta/openai\n" +
    "        api_key_env: GEMINI_API_KEY\n",
  );
  try {
    const r = runCli(["adversarial-backends"], { cwd: dir });
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
    const chain = JSON.parse(r.stdout);
    assert.equal(chain.length, 2);
    assert.equal(chain[0].model, "nvidia/nemotron-3-super-120b-a12b");
    assert.equal(chain[1].provider, "gemini");
    assert.equal(chain[1].model, "models/gemma-4-31b-it");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: --selftest passes", () => {
  const r = runCli(["adversarial-backends", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

// ===========================================================================
// Round-trip contract: emitter output ⊆ review-call.mjs's --backends-json mapper's
// accepted keys, AND the mapper actually reads every field correctly (not just a
// key-name subset check — a real integration through review-call.mjs's own main()).
// ===========================================================================

test("round-trip: emitted keys are a subset of the fields review-call.mjs's mapper reads", () => {
  // The mapper (review-call.mjs, --backends-json handling) reads exactly:
  //   b.provider, b.model, b.host, b.api_key_env (|| b.apiKeyEnv), b.reasoning_off (?? b.reasoningOff ?? false),
  //   b.reasoning_effort (?? b.reasoningEffort), b.timeout, b.first_byte_timeout
  //   plus (FAFF-481) b.auth + b.seat_token_env — the subscription-seat identity it resolves the seat token from.
  const MAPPER_ACCEPTED_KEYS = new Set(["provider", "model", "host", "api_key_env", "seat_token_env", "auth", "reasoning_off", "reasoning_effort", "timeout", "first_byte_timeout"]);
  assert.deepEqual(new Set(BACKEND_KEYS), MAPPER_ACCEPTED_KEYS);

  const cfg = { adversarial: {
    provider: "nvidia", model: "nvidia/nemotron", host: "https://a/v1",
    api_key_env: "K", reasoning_off: true, reasoning_effort: "xhigh", timeout: 30,
  }  };
  const { chain } = assembleAdversarialBackends(cfg);
  for (const backend of chain) {
    for (const key of Object.keys(backend)) assert.ok(MAPPER_ACCEPTED_KEYS.has(key), `emitted key '${key}' must be mapper-accepted`);
  }
  assert.equal(chain[0].reasoning_effort, "xhigh", "reasoning_effort MUST be among the emitted keys when set");
});

// The spec's own integration smoke test: a real .faffrc (nvidia primary + ollama fallback),
// `faff adversarial-backends` piped to a temp file, fed to review-call.mjs's `--backends-json`
// (getFn/streamFn stubbed via runReviewFn) — assert the 2-element chain, the primary's
// `nvidia/`-prefix survives end-to-end, and each backend's fields land correctly on the far side.
test("integration smoke: faff adversarial-backends output feeds review-call.mjs --backends-json correctly (both backends captured)", async () => {
  const dir = fixtureDir(
    "adversarial:\n" +
    "  provider: nvidia\n" +
    "  model: nvidia/nemotron-3-super-120b-a12b\n" +
    "  host: https://integrate.api.nvidia.com/v1\n" +
    "  api_key_env: NVIDIA_API_KEY\n" +
    "  reasoning_off: true\n" +
    "  reasoning_effort: xhigh\n" +
    "  timeout: 30\n" +
    '  fallbacks: \'[{"provider":"ollama","model":"qwen3-next:80b","host":"http://studio:11434"}]\'\n',
  );
  // review-call.mjs resolves each backend's api_key_env against the AMBIENT process.env
  // (never injectable) — force it deterministically set here (some dev machines legitimately
  // export NVIDIA_API_KEY; CI never does) so this test's outcome never depends on whichever
  // happens to be true of the runtime environment it executes in.
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, "NVIDIA_API_KEY");
  const savedKey = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = "test-dummy-key";
  try {
    const emitted = runCli(["adversarial-backends"], { cwd: dir });
    assert.equal(emitted.code, 0, emitted.stderr);
    const chain = JSON.parse(emitted.stdout);
    assert.equal(chain.length, 2);
    assert.equal(chain[0].model, "nvidia/nemotron-3-super-120b-a12b", "nvidia/ prefix intact end-to-end");

    const backendsFile = path.join(dir, "backends.json");
    writeFileSync(backendsFile, emitted.stdout);
    const sysFile = path.join(dir, "system.txt"); writeFileSync(sysFile, "REVIEW LENS");
    const diffFile = path.join(dir, "diff.txt"); writeFileSync(diffFile, "DIFF");

    const captured = [];
    const code = await reviewCallMain(
      ["--backends-json", backendsFile, "--system", sysFile, "--diff", diffFile],
      { runReviewFn: async (opts) => { captured.push(opts); return { status: "unreachable", note: "no real network in a test" }; } },
    );
    // Both backends are unreachable (nothing calls out in a test) → the fully-exhausted
    // availability-only chain lands on the documented pass+skip exit, never OTHER (1).
    assert.equal(code, EXIT.UNREACHABLE);
    assert.equal(captured.length, 2, "the transport iterated BOTH chain elements — the emitted array actually drove it");
    assert.equal(captured[0].provider, "nvidia");
    assert.equal(captured[0].model, "nvidia/nemotron-3-super-120b-a12b");
    assert.equal(captured[0].host, "https://integrate.api.nvidia.com/v1");
    assert.equal(captured[0].reasoningOff, true, "reasoning_off (snake_case, config) correctly read as reasoningOff (camelCase, transport)");
    assert.equal(captured[0].reasoningEffort, "xhigh", "reasoning_effort (snake_case, config) correctly read as reasoningEffort (camelCase, transport)");
    assert.equal(captured[0].timeoutMs, 30000, "timeout (seconds, config) correctly converted to timeoutMs (ms, transport)");
    assert.equal(captured[1].provider, "ollama");
    assert.equal(captured[1].model, "qwen3-next:80b");
    assert.equal(captured[1].host, "http://studio:11434");
    assert.equal(captured[1].reasoningEffort, "xhigh", "the fallback inherited the primary's reasoning_effort, matching reasoning_off inheritance");
    assert.equal(captured[1].timeoutMs, 30000, "the fallback inherited the primary's timeout, and the transport read it correctly");
  } finally {
    if (hadKey) process.env.NVIDIA_API_KEY = savedKey; else delete process.env.NVIDIA_API_KEY;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// FAFF-897 — first_byte_timeout survives the refs: namespace-normalisation
// path (normalizeBackend), not just the legacy/inline forms that call
// pickBackendKeys directly.
// ===========================================================================

test("refs: a backends: entry's first_byte_timeout survives normalizeBackend and reaches the emitted chain", () => {
  const cfg = {
    backends: {
      "slow-local": { provider: "ollama", model: "q", host: "http://studio.x.ts.net:11434", first_byte_timeout: 300 },
    },
    adversarial: { refs: ["slow-local"] },
  };
  const res = assembleAdversarialBackends(cfg);
  assert.equal(res.error, undefined);
  assert.equal(res.chain[0].first_byte_timeout, 300, "the refs:-resolved backend must carry first_byte_timeout — it must not be dropped at namespace-normalisation");
});

// ===========================================================================
// FAFF-870 — per-consumer chain selection (--consumer <name>)
// ===========================================================================

test("per-consumer refs: a named consumer resolves its OWN refs chain from the shared backends namespace", () => {
  const cfg = {
    backends: {
      A: { provider: "nvidia", model: "mA", host: "https://a/v1", api_key_env: "KA" },
      B: { provider: "ollama", model: "mB", host: "http://b:11434" },
    },
    adversarial: { host: "http://base:11434", model: "base", provider: "ollama", spec_review: { refs: ["B", "A"] } },
  };
  const res = assembleAdversarialBackends(cfg, "spec_review");
  assert.equal(res.chain.length, 2);
  assert.equal(res.chain[0].model, "mB", "refs order preserved: index 0 first-served");
  assert.equal(res.chain[1].model, "mA");
});

test("per-consumer: an unconfigured consumer is BYTE-IDENTICAL to the no-consumer shared chain (the zero-change guarantee)", () => {
  const cfg = {
    backends: { A: { provider: "nvidia", model: "mA", host: "https://a/v1", api_key_env: "KA" } },
    adversarial: { host: "http://base:11434", model: "base", provider: "ollama", spec_review: { refs: ["A"] } },
  };
  const shared = assembleAdversarialBackends(cfg);
  const codeReview = assembleAdversarialBackends(cfg, "code_review"); // no code_review sub-block
  assert.deepEqual(codeReview, shared);
  assert.equal(shared.chain.length, 1);
  assert.equal(shared.chain[0].model, "base", "the shared chain is the legacy primary, unaffected by the spec_review sub-block");
});

test("per-consumer: omitting the consumer arg entirely ignores every sub-block (byte-for-byte today)", () => {
  const cfg = {
    backends: { A: { provider: "nvidia", model: "mA", host: "https://a/v1", api_key_env: "KA" } },
    adversarial: { host: "http://base:11434", model: "base", provider: "ollama", spec_review: { refs: ["A"] }, code_review: { refs: ["A"] } },
  };
  assert.deepEqual(assembleAdversarialBackends(cfg), assembleAdversarialBackends(cfg, undefined));
  assert.equal(assembleAdversarialBackends(cfg).chain[0].model, "base");
});

test("per-consumer: an empty or non-string refs sub-block falls through to the shared assembly, never an error", () => {
  const cfg = {
    backends: { A: { provider: "nvidia", model: "mA", host: "https://a/v1", api_key_env: "KA" } },
    adversarial: { refs: ["A"], spec_review: { refs: [] }, code_review: { refs: [{ provider: "x" }] } },
  };
  const shared = assembleAdversarialBackends(cfg);
  assert.deepEqual(assembleAdversarialBackends(cfg, "spec_review"), shared, "empty refs → shared");
  assert.deepEqual(assembleAdversarialBackends(cfg, "code_review"), shared, "non-string refs → shared");
  assert.equal(shared.chain[0].model, "mA");
});

test("per-consumer: an unknown ref NAME in a consumer chain is fail-loud malformed (same as the shared refs path)", () => {
  const cfg = { backends: { A: { provider: "nvidia", model: "mA", host: "https://a/v1" } }, adversarial: { spec_review: { refs: ["nope"] } } };
  assert.equal(assembleAdversarialBackends(cfg, "spec_review").error, "malformed");
});

test("CLI: --consumer X with no sub-block emits stdout BYTE-IDENTICAL to the no-flag call", () => {
  const dir = fixtureDir("adversarial:\n  provider: nvidia\n  model: m1\n  host: https://a/v1\n");
  try {
    const plain = runCli(["adversarial-backends"], { cwd: dir });
    const withConsumer = runCli(["adversarial-backends", "--consumer", "spec_review"], { cwd: dir });
    assert.equal(plain.code, 0);
    assert.equal(withConsumer.code, 0);
    assert.equal(withConsumer.stdout, plain.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: --consumer selects the per-consumer chain when its sub-block is set; a different consumer falls through", () => {
  const dir = fixtureDir(
    "backends:\n" +
    "  A:\n    provider: nvidia\n    model: mA\n    host: https://a/v1\n    api_key_env: KA\n" +
    "  B:\n    provider: ollama\n    model: mB\n    host: http://b:11434\n" +
    "adversarial:\n" +
    "  provider: ollama\n  model: base\n  host: http://base:11434\n" +
    "  spec_review:\n    refs:\n      - B\n      - A\n",
  );
  try {
    const spec = runCli(["adversarial-backends", "--consumer", "spec_review"], { cwd: dir });
    assert.equal(spec.code, 0, spec.stderr);
    const specChain = JSON.parse(spec.stdout);
    assert.equal(specChain.length, 2);
    assert.equal(specChain[0].model, "mB");
    assert.equal(specChain[1].model, "mA");
    // code_review has no sub-block → the shared legacy primary chain, unchanged.
    const code = runCli(["adversarial-backends", "--consumer", "code_review"], { cwd: dir });
    const shared = runCli(["adversarial-backends"], { cwd: dir });
    assert.equal(code.stdout, shared.stdout);
    assert.equal(JSON.parse(shared.stdout)[0].model, "base");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
