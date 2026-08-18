// FAFF-182 — `config get` is default-aware: an unset registry key resolves to its baked default
// (exit 0), so no caller supplies a default via prose `-d`. Non-registry keys keep exit-3 behaviour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// run the CLI in `cwd`; returns { code, out }
function run(cwd, ...args) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
    return { code: 0, out: out.trim() };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim() };
  }
}

function withConfig(yaml) {
  const dir = mkdtempSync(join(tmpdir(), "faff182-"));
  if (yaml != null) writeFileSync(join(dir, ".faffrc.yaml"), yaml);
  return dir;
}

test("config defaults --selftest passes (registry covers slots + scalars)", () => {
  const dir = withConfig(null);
  try { assert.equal(run(dir, "config", "defaults", "--selftest").code, 0); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unset registry SCALAR resolves to its baked default, exit 0 (no -d needed)", () => {
  const dir = withConfig(null);
  try {
    assert.deepEqual(run(dir, "config", "get", "logging"), { code: 0, out: "full" });
    assert.deepEqual(run(dir, "config", "get", "automation_default"), { code: 0, out: "opt-in" });
    assert.deepEqual(run(dir, "config", "get", "concurrency_max"), { code: 0, out: "4" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unset registry SLOT resolves to its default occupant, exit 0", () => {
  const dir = withConfig(null);
  try { assert.deepEqual(run(dir, "config", "get", "slots.review"), { code: 0, out: "faffter-noon-review" }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-191: slots.prd was documented (gateway Slots table) and relied on by faff-beep-boop's
// prose parenthetical, but missing from the registry — a gap-fill, not a new slot.
test("unset slots.prd resolves to its default occupant faffter-noon-prd, exit 0", () => {
  const dir = withConfig(null);
  try { assert.deepEqual(run(dir, "config", "get", "slots.prd"), { code: 0, out: "faffter-noon-prd" }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-403: graft's own namespace for the outage-retry-later bound — no .faffrc entry needed.
test("unset graft.review_outage_retry_limit resolves to its baked default \"3\", exit 0", () => {
  const dir = withConfig(null);
  try { assert.deepEqual(run(dir, "config", "get", "graft.review_outage_retry_limit"), { code: 0, out: "3" }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-333: the lights-out host-socket boundedness attestation — default false (refuse
// on positive evidence), read via `faff config get` per its own DONE item.
test("unset autonomous.engine_bounded resolves to its baked default \"false\", exit 0", () => {
  const dir = withConfig(null);
  try { assert.deepEqual(run(dir, "config", "get", "autonomous.engine_bounded"), { code: 0, out: "false" }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("configured autonomous.engine_bounded: true wins over the registry default", () => {
  const dir = withConfig("autonomous:\n  engine_bounded: true\n");
  try { assert.deepEqual(run(dir, "config", "get", "autonomous.engine_bounded"), { code: 0, out: "true" }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-42/350/333: `config resolved` surfaces a non-default engine_bounded, alongside its
// sibling preflight knobs, so it's visible in the run banner rather than silent.
test("config resolved surfaces a non-default autonomous.engine_bounded", () => {
  const dir = withConfig("autonomous:\n  engine_bounded: true\n");
  try {
    const r = run(dir, "config", "resolved");
    assert.equal(r.code, 0);
    assert.match(r.out, /autonomous\.engine_bounded: true/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-536: the self-hosting core-defect intake lane — default false (lane off, chokepoint
// byte-identical to today), read via `faff config get` through the default-aware registry.
test("unset containment.self_hosting_intake resolves to its baked default \"false\", exit 0", () => {
  const dir = withConfig(null);
  try { assert.deepEqual(run(dir, "config", "get", "containment.self_hosting_intake"), { code: 0, out: "false" }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("configured containment.self_hosting_intake: true wins over the registry default", () => {
  const dir = withConfig("containment:\n  self_hosting_intake: true\n");
  try { assert.deepEqual(run(dir, "config", "get", "containment.self_hosting_intake"), { code: 0, out: "true" }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a configured value wins over the registry default (the bug this fixes)", () => {
  const dir = withConfig("slots:\n  review: faffter-dark-adversarial-review\n");
  try { assert.deepEqual(run(dir, "config", "get", "slots.review"), { code: 0, out: "faffter-dark-adversarial-review" }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an unset NON-registry key keeps the old behaviour: exit 3, empty (no silent guess)", () => {
  const dir = withConfig(null);
  try {
    const r = run(dir, "config", "get", "tracking.nonexistent");
    assert.equal(r.code, 3);
    assert.equal(r.out, "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config defaults prints the registry as JSON", () => {
  const dir = withConfig(null);
  try {
    const r = run(dir, "config", "defaults");
    assert.equal(r.code, 0);
    const reg = JSON.parse(r.out);
    assert.equal(reg["slots.review"], "faffter-noon-review");
    assert.equal(reg["logging"], "full");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-262 — native YAML block sequences parse to real arrays; `config get --json` returns them.
test("config get --json returns a real array for a block sequence of maps", () => {
  const dir = withConfig(
    "adversarial:\n  backends:\n    - provider: nvidia\n      model: nemotron\n    - provider: ollama\n      model: qwen3\n",
  );
  try {
    const r = run(dir, "config", "get", "--json", "adversarial.backends");
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), [
      { provider: "nvidia", model: "nemotron" },
      { provider: "ollama", model: "qwen3" },
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config get --json returns a real array for a block sequence of scalars", () => {
  const dir = withConfig("hosts:\n  - alpha\n  - beta\n");
  try {
    const r = run(dir, "config", "get", "--json", "hosts");
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), ["alpha", "beta"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("block sequences don't regress scalars, nested maps, or JSON-string scalars", () => {
  const dir = withConfig(
    "tracking:\n  team_key: SHF\nlist:\n  - one\nfallbacks: '[{\"provider\":\"x\"}]'\n",
  );
  try {
    assert.deepEqual(run(dir, "config", "get", "tracking.team_key"), { code: 0, out: "SHF" });
    assert.deepEqual(JSON.parse(run(dir, "config", "get", "--json", "list").out), ["one"]);
    // a JSON-string scalar stays a string (back-compat consumer JSON.parses it itself)
    assert.equal(run(dir, "config", "get", "fallbacks").out, '[{"provider":"x"}]');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
