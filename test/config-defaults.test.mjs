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
