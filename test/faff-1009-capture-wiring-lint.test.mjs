// FAFF-1009 — the capture-wiring gate in `faff validate-adapters`. It derives the captureDecision
// kernel set from source (brace-aware, so the multi-line `captureDecision({` form is read) and asserts
// each kernel has an adjacent `decide --export` in some SKILL.md, fail-closed. This exercises the gate
// through the real CLI entrypoint (pass, the missing-`decide --export` fail, and the source-read
// fail-closed exit-2), plus a couple of direct checks on the exported helpers. Modeled on
// test/validate-adapters-prose-defaults.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const LIB = join(REPO, "plugin", "skills", "faff", "bin", "lib");
const SKILLS = join(REPO, "plugin", "skills");

const require = createRequire(import.meta.url);
const va = require(join(LIB, "validate-adapters.js"));

// Build a throwaway skills-dir carrying its own faff/bin/lib kernel source (so the lint's libDir
// exists) plus a single fixture SKILL.md, then run validate-adapters over it. `root` defaults to the
// real repo, so the seam/gateway blocks resolve and never short-circuit before the capture-wiring gate.
function runOnFixture({ kernelSrc, skillBody }) {
  const dir = mkdtempSync(join(tmpdir(), "faff-1009-lint-"));
  mkdirSync(join(dir, "faff", "bin", "lib"), { recursive: true });
  writeFileSync(join(dir, "faff", "bin", "lib", "fixkernel.js"), kernelSrc);
  mkdirSync(join(dir, "zz-capture-fixture"));
  writeFileSync(join(dir, "zz-capture-fixture", "SKILL.md"), skillBody);
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}

const KERNEL_SRC = `const { captureDecision } = require("./decision-capture");
function cmdFix() {
  captureDecision({
    kernel: "fixkernel",
    normalised_inputs: {},
    verdict: {},
    issue: "__run__",
  });
}
module.exports = { cmdFix };
`;

test("pass: a derived kernel with an adjacent `decide --export` passes the gate", () => {
  const skill = [
    "Wire the fixkernel consult with the driver:",
    "`eval \"$(faff decision-capture decide --run <run> --issue <i> --kernel fixkernel --export)\"`",
    "then run `faff fixkernel --json` and emit the marker.",
    "",
  ].join("\n");
  const r = runOnFixture({ kernelSrc: KERNEL_SRC, skillBody: skill });
  assert.match(r.stdout, /pass\s+capture-wiring/);
  assert.doesNotMatch(r.stdout, /FAIL\s+capture-wiring/);
});

test("fail: removing the `decide --export` leaves the consult unwired (fail-closed, exit 1)", () => {
  const skill = [
    "The fixkernel consult with no driver:",
    "run `faff fixkernel --json` and read the verdict.",
    "",
  ].join("\n");
  const r = runOnFixture({ kernelSrc: KERNEL_SRC, skillBody: skill });
  assert.match(r.stdout, /FAIL\s+capture-wiring/);
  assert.match(r.stdout, /kernel "fixkernel" mints a base in-kernel but no SKILL\.md states its `decide --kernel fixkernel --export` runs before the `faff fixkernel` consult/);
  assert.equal(r.status, 1);
});

// FAFF-1014 — order-aware predicate cases.

test("fail: a same-line driver+consult with no `before` order assertion is UNWIRED (exit 1)", () => {
  // The one capture line is both the driver and the consult (d == c), so predicate (b) (d < c) can
  // never fire; without the word "before" plus a consult reference, predicate (a) also fails.
  const skill = [
    "The fixkernel wiring on one line:",
    "run `faff fixkernel` via `eval \"$(faff decision-capture decide --kernel fixkernel --export)\"`.",
    "",
  ].join("\n");
  const r = runOnFixture({ kernelSrc: KERNEL_SRC, skillBody: skill });
  assert.match(r.stdout, /FAIL\s+capture-wiring/);
  assert.match(r.stdout, /kernel "fixkernel" mints a base in-kernel but no SKILL\.md states its `decide --kernel fixkernel --export` runs before the `faff fixkernel` consult/);
  assert.equal(r.status, 1);
});

test("pass: a distinct driver line preceding its consult within the window is wired via predicate (b)", () => {
  // project-next-shaped: driver at index d, consult at a later index c, d < c and (c - d) <= 15, and
  // NO "before" assertion on the driver line — so only predicate (b) can carry it.
  const skill = [
    "Mint the driver first:",
    "`eval \"$(faff decision-capture decide --kernel fixkernel --export)\"`",
    "then later in the flow",
    "run `faff fixkernel --json` and read the verdict.",
    "",
  ].join("\n");
  const r = runOnFixture({ kernelSrc: KERNEL_SRC, skillBody: skill });
  assert.match(r.stdout, /pass\s+capture-wiring/);
  assert.doesNotMatch(r.stdout, /FAIL\s+capture-wiring/);
});

test("fail: a driver placed AFTER its consult (d > c) with no `before` assertion is UNWIRED (exit 1)", () => {
  // Consult first, driver later: predicate (b) requires d < c, and the driver line has no "before"
  // assertion, so predicate (a) cannot rescue it. This is the ordering defect the change closes.
  const skill = [
    "run `faff fixkernel --json` and read the verdict,",
    "then afterwards",
    "`eval \"$(faff decision-capture decide --kernel fixkernel --export)\"`.",
    "",
  ].join("\n");
  const r = runOnFixture({ kernelSrc: KERNEL_SRC, skillBody: skill });
  assert.match(r.stdout, /FAIL\s+capture-wiring/);
  assert.match(r.stdout, /kernel "fixkernel"/);
  assert.equal(r.status, 1);
});

test("fail: a `decide --export` outside the 15-line window does not count as wired", () => {
  const far = ["`faff fixkernel --json`"].concat(new Array(20).fill("filler line"))
    .concat(["`faff decision-capture decide --kernel fixkernel --export`", ""]).join("\n");
  const r = runOnFixture({ kernelSrc: KERNEL_SRC, skillBody: far });
  assert.match(r.stdout, /FAIL\s+capture-wiring/);
  assert.match(r.stdout, /kernel "fixkernel"/);
});

test("fail-closed: a source read error on the kernel dir is a hard tooling failure (exit 2)", () => {
  // fixkernel.js is written as a DIRECTORY, so readdirSync lists it but readFileSync throws EISDIR —
  // the derivation cannot complete and the gate must exit 2, never a silent pass.
  const dir = mkdtempSync(join(tmpdir(), "faff-1009-lint2-"));
  mkdirSync(join(dir, "faff", "bin", "lib", "fixkernel.js"), { recursive: true });
  mkdirSync(join(dir, "zz-capture-fixture"));
  writeFileSync(join(dir, "zz-capture-fixture", "SKILL.md"), "noop\n");
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /FAIL\s+capture-wiring \(kernel-set derivation\)/);
});

// --- direct helper checks (the shipped tree) ---

test("deriveCaptureKernels returns exactly the nine shipped captureDecision kernels", () => {
  const kernels = va.deriveCaptureKernels(LIB);
  assert.deepEqual(kernels, ["claim-verdict", "eligible", "next", "park-verdict", "project-next", "queue-state", "run-done", "run-outward", "run-start"]);
});

test("captureWiringUnwired reports nothing unwired on the shipped tree", () => {
  const kernels = va.deriveCaptureKernels(LIB);
  const inProcess = va.inProcessWiredKernels(SKILLS, va.deriveInProcessCapture(LIB));
  assert.deepEqual(va.captureWiringUnwired(SKILLS, kernels, inProcess), []);
  assert.deepEqual(va.captureSameCommandUnwired(SKILLS, kernels, inProcess), []);
  // FAFF-1434: beep-boop's admission captures next and eligible through `faff graft admit`, so only
  // those two rely on the in-process route; every other kernel still has its own driver.
  assert.deepEqual(va.captureWiringUnwired(SKILLS, kernels), ["eligible", "next"]);
});

// --- FAFF-1434: in-process capture through a composing command ---

// A fixture lib with the kernel plus a stand-in graft-admit.js, and one SKILL.md.
function runOnInProcessFixture({ admitSrc, skillBody }) {
  const dir = mkdtempSync(join(tmpdir(), "faff-1434-lint-"));
  mkdirSync(join(dir, "faff", "bin", "lib"), { recursive: true });
  writeFileSync(join(dir, "faff", "bin", "lib", "fixkernel.js"), KERNEL_SRC);
  writeFileSync(join(dir, "faff", "bin", "lib", "graft-admit.js"), admitSrc);
  mkdirSync(join(dir, "zz-capture-fixture"));
  writeFileSync(join(dir, "zz-capture-fixture", "SKILL.md"), skillBody);
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}
const ADMIT_SRC = `const decisionCapture = require("./decision-capture");
function base(kernel) { return decisionCapture.mintConsultCorrelationId(".", "run", "X-1", kernel, undefined); }
const cap = { base };
cap.base("fixkernel", {}, {});
`;
const ADMIT_CALL = 'run `printf \'%s\' "$facts_json" | faff graft admit --mode autonomous --facts - --run-dir "$run_dir" --wave <w> --json` per candidate.\n';

test("pass: a SKILL.md running `faff graft admit` with a run dir wires the kernels it captures in-process", () => {
  const r = runOnInProcessFixture({ admitSrc: ADMIT_SRC, skillBody: ADMIT_CALL });
  assert.match(r.stdout, /pass\s+capture-wiring[^\n]*fixkernel via `faff graft admit`'s in-process capture/);
  assert.match(r.stdout, /pass\s+capture-same-command[^\n]*fixkernel via/);
});

test("fail: the same call with no run dir mints no consult id, so the kernel stays unwired", () => {
  const r = runOnInProcessFixture({ admitSrc: ADMIT_SRC, skillBody: 'run `faff graft admit --mode autonomous --facts - --json` per candidate.\n' });
  assert.match(r.stdout, /FAIL\s+capture-wiring/);
  assert.match(r.stdout, /FAIL\s+capture-same-command/);
  assert.equal(r.status, 1);
});

test("fail: a kernel the composing command does not capture is not wired by calling it", () => {
  const r = runOnInProcessFixture({ admitSrc: ADMIT_SRC.replace('cap.base("fixkernel"', 'cap.base("other"'), skillBody: ADMIT_CALL });
  assert.match(r.stdout, /kernel "fixkernel" mints a base in-kernel/);
  assert.equal(r.status, 1);
});

test("fail: a composing module that mints no consult id wires nothing", () => {
  const r = runOnInProcessFixture({ admitSrc: ADMIT_SRC.replace("mintConsultCorrelationId", "noMint"), skillBody: ADMIT_CALL });
  assert.match(r.stdout, /FAIL\s+capture-wiring/);
  assert.equal(r.status, 1);
});

test("deriveInProcessCapture reads graft-admit's captured kernels from its source", () => {
  assert.deepEqual(va.deriveInProcessCapture(LIB).map((e) => e.kernels), [["claim-verdict", "eligible", "next"]]);
});
