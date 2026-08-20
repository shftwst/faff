// FAFF-384 — evaluate-call.mjs: the code-blind holdout evaluator SPAWNER + the spawner-attestation ratchet.
// The spawner PROVABLY withholds the codebase, runs the in-cage preflight, and stamps code_blind +
// spawner_attested into the verdict envelope the inner (judged) process never wrote. These tests exercise
// the spawner's main() end-to-end with injected stubs (no cage/engine touched) AND the end-to-end pipe into
// `faff contract holdout-verdict --require-spawner-attested` — the integration smoke test from the spec.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { main, EXIT, deriveAttestation, assembleEnvelope, buildWithheldSet, deriveAuthHeaders, redactCredential } from "../plugin/skills/faffter-noon-evaluate/evaluate-call.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const contract = (args, input) => spawnSync(process.execPath, [BIN, "contract", ...args], { encoding: "utf8", input });

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "faff-eval-"));
  writeFileSync(join(dir, "spec.md"), "# spec\n## DONE\n- [ ] AC1\n- [ ] AC2\n");
  return dir;
}

// An inner evaluator output: criteria + aggregate ONLY (the spawner owns code_blind).
const innerBlind = { aggregate: "meets-spec", criteria: [{ class: "scenario", verdict: "met", evidence_present: true }, { class: "assertion", verdict: "met", evidence_present: true }] };

test("evaluate-call --selftest passes", () => {
  const r = spawnSync(process.execPath, [join(HERE, "..", "plugin", "skills", "faffter-noon-evaluate", "evaluate-call.mjs"), "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /evaluate-call --selftest: ok/);
});

test("caged run: preflight holds + inner blind → verdict file with spawner_attested:true, code_blind spawner-derived", async () => {
  const dir = scratch();
  const out = join(dir, "holdout.json");
  const code = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://localhost:8080", "--key", "FAFF-384", "--out", out], {
    preflightFn: () => ({ holds: true, refusals: [] }),
    spawnFn: async () => ({ status: "ok", verdict: innerBlind }),
  });
  assert.equal(code, EXIT.OK);
  const v = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(v.spawner_attested, true);
  assert.equal(v.code_blind, true);
  assert.equal(v.attestation.spawner, "evaluate-call.mjs");
  assert.equal(v.attestation.withheld.repo, true);
  assert.equal(v.attestation.preflight, "pass");
  rmSync(dir, { recursive: true, force: true });
});

test("integration smoke: spawner verdict passes the ratchet ON; stripped attestation blocks; flag OFF passes (legacy)", async () => {
  const dir = scratch();
  const out = join(dir, "holdout.json");
  await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://localhost:8080", "--key", "FAFF-384", "--out", out], {
    preflightFn: () => ({ holds: true, refusals: [] }),
    spawnFn: async () => ({ status: "ok", verdict: innerBlind }),
  });
  const verdict = readFileSync(out, "utf8");

  // (3) ratchet ON → exit 0
  assert.equal(contract(["holdout-verdict", "--require-spawner-attested"], verdict).status, 0);
  // (3) strip the attestation → a self-attested verdict → ratchet ON blocks (exit 1)
  const stripped = JSON.parse(verdict);
  delete stripped.spawner_attested; delete stripped.attestation;
  assert.equal(contract(["holdout-verdict", "--require-spawner-attested"], JSON.stringify(stripped)).status, 1);
  // (4) same stripped/legacy verdict WITHOUT the flag → exit 0 (byte-for-byte back-compat)
  assert.equal(contract(["holdout-verdict"], JSON.stringify(stripped)).status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("preflight REFUSED (cage boundary absent) → exit 10, no verdict written", async () => {
  const dir = scratch();
  const out = join(dir, "holdout.json");
  let wrote = false;
  const code = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://localhost:8080", "--key", "K", "--out", out], {
    preflightFn: () => ({ holds: false, refusals: [{ leg: "repo-absent", detail: "repo readable" }] }),
    spawnFn: async () => { throw new Error("must not spawn after a refused preflight"); },
    writeFn: () => { wrote = true; },
  });
  assert.equal(code, EXIT.PREFLIGHT_REFUSED);
  assert.equal(wrote, false, "no verdict may be written on a refused preflight");
  rmSync(dir, { recursive: true, force: true });
});

test("refuse-to-attest: inner declares it read the codebase → spawner_attested:false + code_blind:false → contract blocks", async () => {
  const dir = scratch();
  const out = join(dir, "holdout.json");
  await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://localhost:8080", "--key", "K", "--out", out], {
    preflightFn: () => ({ holds: true, refusals: [] }),
    spawnFn: async () => ({ status: "ok", verdict: { ...innerBlind, code_blind: false } }),
  });
  const v = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(v.spawner_attested, false);
  assert.equal(v.code_blind, false);
  // base gate (code_blind must be true) AND the ratchet both block it
  assert.equal(contract(["holdout-verdict"], JSON.stringify(v)).status, 1);
  assert.equal(contract(["holdout-verdict", "--require-spawner-attested"], JSON.stringify(v)).status, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("engine deadline → exit 8; engine unreachable → exit 5 (merge-floor leg never pass+skips)", async () => {
  const dir = scratch();
  const out = join(dir, "holdout.json");
  const deadline = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://x", "--key", "K", "--out", out], {
    preflightFn: () => ({ holds: true, refusals: [] }),
    spawnFn: async () => ({ status: "deadline" }),
  });
  assert.equal(deadline, EXIT.DEADLINE);
  const unreach = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://x", "--key", "K", "--out", out], {
    preflightFn: () => ({ holds: true, refusals: [] }),
    spawnFn: async () => ({ status: "unreachable" }),
  });
  assert.equal(unreach, EXIT.UNREACHABLE);
  rmSync(dir, { recursive: true, force: true });
});

test("pure core: the inner code_blind:true claim is ignored, never laundered", () => {
  const withheld = buildWithheldSet();
  const att = deriveAttestation(true, { aggregate: "meets-spec", criteria: [], code_blind: true }, withheld);
  // spawner derives its OWN true from the withheld-set + preflight, not from the inner's claim
  assert.equal(att.spawner_attested, true);
  assert.equal(att.attestation.spawner, "evaluate-call.mjs");
  const env = assembleEnvelope({ aggregate: "meets-spec", criteria: [] }, att);
  assert.equal(env.code_blind, true);
});

// --- FAFF-852: evaluator per-request auth plumbing ---

test("no --credentials, no handle credentials → spawn payload has no credentials key, output byte-identical to pre-FAFF-852", async () => {
  const dir = scratch();
  const out = join(dir, "holdout.json");
  let capturedPayload;
  const code = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://localhost:8080", "--key", "K", "--out", out], {
    preflightFn: () => ({ holds: true, refusals: [] }),
    spawnFn: async (payload) => { capturedPayload = payload; return { status: "ok", verdict: innerBlind }; },
  });
  assert.equal(code, EXIT.OK);
  assert.equal("credentials" in capturedPayload, false, "the spawn payload must omit the credentials key entirely when --credentials is absent");
  const v = JSON.parse(readFileSync(out, "utf8"));
  assert.equal("credentials" in v, false, "the written envelope must never carry a credentials field");
  rmSync(dir, { recursive: true, force: true });
});

test("--credentials FILE with a valid bearer object → threaded into the spawn payload; deriveAuthHeaders derives the Authorization header", async () => {
  const dir = scratch();
  const out = join(dir, "holdout.json");
  const credsPath = join(dir, "credentials.json");
  writeFileSync(credsPath, JSON.stringify({ scheme: "bearer", token: "tok-smoke" }));
  let capturedPayload;
  const code = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://localhost:8080", "--key", "K", "--out", out, "--credentials", credsPath], {
    preflightFn: () => ({ holds: true, refusals: [] }),
    spawnFn: async (payload) => { capturedPayload = payload; return { status: "ok", verdict: innerBlind }; },
  });
  assert.equal(code, EXIT.OK);
  assert.deepEqual(capturedPayload.credentials, { scheme: "bearer", token: "tok-smoke" });
  assert.deepEqual(deriveAuthHeaders(capturedPayload.credentials), { Authorization: "Bearer tok-smoke" });
  const written = readFileSync(out, "utf8");
  assert.equal(written.includes("tok-smoke"), false, "the token value must never reach the written verdict file");
  assert.equal(JSON.parse(written).hasOwnProperty("credentials"), false);
  rmSync(dir, { recursive: true, force: true });
});

test("--credentials FILE missing, invalid JSON, or a non-object → EXIT.USAGE, spawns nothing, writes no verdict", async () => {
  const dir = scratch();
  const mustNotSpawn = async () => { throw new Error("must not spawn on a --credentials read/parse failure"); };
  const mustNotWrite = () => { throw new Error("must not write a verdict on a --credentials read/parse failure"); };

  // missing file
  let code = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://x", "--key", "K", "--out", join(dir, "o1.json"), "--credentials", join(dir, "nope.json")], {
    preflightFn: () => ({ holds: true, refusals: [] }), spawnFn: mustNotSpawn, writeFn: mustNotWrite,
  });
  assert.equal(code, EXIT.USAGE);

  // invalid JSON
  const badJsonPath = join(dir, "bad.json");
  writeFileSync(badJsonPath, "{ not json");
  code = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://x", "--key", "K", "--out", join(dir, "o2.json"), "--credentials", badJsonPath], {
    preflightFn: () => ({ holds: true, refusals: [] }), spawnFn: mustNotSpawn, writeFn: mustNotWrite,
  });
  assert.equal(code, EXIT.USAGE);

  // valid JSON but not an object (array)
  const arrayPath = join(dir, "array.json");
  writeFileSync(arrayPath, "[1,2,3]");
  code = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://x", "--key", "K", "--out", join(dir, "o3.json"), "--credentials", arrayPath], {
    preflightFn: () => ({ holds: true, refusals: [] }), spawnFn: mustNotSpawn, writeFn: mustNotWrite,
  });
  assert.equal(code, EXIT.USAGE);

  // valid JSON but a scalar
  const scalarPath = join(dir, "scalar.json");
  writeFileSync(scalarPath, "42");
  code = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://x", "--key", "K", "--out", join(dir, "o4.json"), "--credentials", scalarPath], {
    preflightFn: () => ({ holds: true, refusals: [] }), spawnFn: mustNotSpawn, writeFn: mustNotWrite,
  });
  assert.equal(code, EXIT.USAGE);

  rmSync(dir, { recursive: true, force: true });
});

test("redaction: a token echoed into the inner verdict's aggregate/violations is scrubbed before writeFn — the round-1 structural fix", async () => {
  const dir = scratch();
  const out = join(dir, "holdout.json");
  const credsPath = join(dir, "credentials.json");
  writeFileSync(credsPath, JSON.stringify({ scheme: "bearer", token: "sekret" }));
  const tokenEchoingInner = { aggregate: "unmet", criteria: [{ class: "scenario", verdict: "unmet", evidence_present: true }], violations: ["401 for Authorization: Bearer sekret"] };
  const code = await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://localhost:8080", "--key", "K", "--out", out, "--credentials", credsPath], {
    preflightFn: () => ({ holds: true, refusals: [] }),
    spawnFn: async () => ({ status: "ok", verdict: tokenEchoingInner }),
  });
  assert.equal(code, EXIT.OK);
  const written = readFileSync(out, "utf8");
  assert.equal(written.includes("sekret"), false, "the raw token substring must never reach the persisted envelope");
  assert.equal(written.includes("<redacted-credential>"), true, "the scrubbed placeholder must replace the token in the persisted envelope");
  const v = JSON.parse(written);
  assert.equal(v.violations[0], "401 for Authorization: Bearer <redacted-credential>");
  rmSync(dir, { recursive: true, force: true });
});

test("no credential value ever appears in stderr diagnostics, on either the success or the EXIT.USAGE path", async () => {
  const dir = scratch();
  const credsPath = join(dir, "credentials.json");
  writeFileSync(credsPath, JSON.stringify({ scheme: "bearer", token: "sekret-diagnostic" }));

  const origWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = (chunk) => { captured += chunk; return true; };
  try {
    // success path
    await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://localhost:8080", "--key", "K", "--out", join(dir, "o1.json"), "--credentials", credsPath], {
      preflightFn: () => ({ holds: true, refusals: [] }),
      spawnFn: async () => ({ status: "ok", verdict: innerBlind }),
    });
    // USAGE path: unreadable credentials file
    await main(["--spec", join(dir, "spec.md"), "--endpoint", "http://x", "--key", "K", "--out", join(dir, "o2.json"), "--credentials", join(dir, "does-not-exist.json")], {
      preflightFn: () => ({ holds: true, refusals: [] }),
      spawnFn: async () => { throw new Error("must not spawn"); },
    });
  } finally {
    process.stderr.write = origWrite;
  }
  assert.equal(captured.includes("sekret-diagnostic"), false, "no diagnostic may ever echo the credential value — name the path and failure class only");
  rmSync(dir, { recursive: true, force: true });
});
