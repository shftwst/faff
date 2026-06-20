// FAFF-178 — `faff prepcheck`: the Stop-hook backstop that makes "attach the produced
// spec in the same prep turn" mechanical, not prose. Mirrors runcheck: it reads an
// externalised attach-state marker prep writes (.faff/prep/<ISSUE>.json) and blocks on
// any produced-but-not-attached spec. Drives the real entrypoint against fixture roots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(...args) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString() }; }
}

// Build a fixture root with .faff/prep/<issue>.json markers; returns the root path.
function rootWith(markers) {
  const dir = mkdtempSync(join(tmpdir(), "prepcheck-"));
  mkdirSync(join(dir, ".faff", "prep"), { recursive: true });
  for (const [issue, body] of Object.entries(markers)) {
    writeFileSync(join(dir, ".faff", "prep", `${issue}.json`), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

test("prepcheck --selftest passes (the shipped case table)", () => {
  const r = run("prepcheck", "--selftest");
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

test("prepcheck --hook blocks on a produced-but-not-attached spec (decision payload, exit 0)", () => {
  const root = rootWith({ "FAFF-99": { issue: "FAFF-99", spec_produced: true, attached: false, mode: "tracker" } });
  try {
    const r = run("prepcheck", "--hook", "--root", root);
    assert.equal(r.code, 0, "hook blocks via the decision payload, not the exit code (mirrors runcheck)");
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block");
    assert.match(payload.reason, /FAFF-99/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck --hook is silent once the spec is attached", () => {
  const root = rootWith({ "FAFF-99": { issue: "FAFF-99", spec_produced: true, attached: true, mode: "tracker" } });
  try {
    const r = run("prepcheck", "--hook", "--root", root);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "", "no block when the attach happened");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck does not false-block a spec parked by design", () => {
  const root = rootWith({ "FAFF-99": { issue: "FAFF-99", spec_produced: true, attached: false, disposition: "parked" } });
  try {
    const hook = run("prepcheck", "--hook", "--root", root);
    assert.equal(hook.out.trim(), "", "parked is a legitimate non-attach, not a dropped spec");
    const plain = run("prepcheck", "--root", root);
    assert.equal(plain.code, 0);
    assert.match(plain.out, /clean/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck plain report exits 3 and names the open issue; git-only drop counts the same", () => {
  const root = rootWith({ "FAFF-77": { issue: "FAFF-77", spec_produced: true, attached: false, mode: "git-only" } });
  try {
    const r = run("prepcheck", "--root", root);
    assert.equal(r.code, 3, "non-zero so CI / manual runs fail loud");
    assert.match(r.out, /OPEN \(1\): FAFF-77/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck blocks on any one open marker among several issues", () => {
  const root = rootWith({
    "FAFF-1": { issue: "FAFF-1", spec_produced: true, attached: true },
    "FAFF-2": { issue: "FAFF-2", spec_produced: true, attached: false },
  });
  try {
    const r = run("prepcheck", "--hook", "--root", root);
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block");
    assert.match(payload.reason, /FAFF-2/);
    assert.doesNotMatch(payload.reason, /FAFF-1\b/, "the attached one is not flagged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck tolerates a malformed marker (skips it, never crashes)", () => {
  const root = rootWith({
    "FAFF-bad": "not json{",
    "FAFF-9": { issue: "FAFF-9", spec_produced: true, attached: true },
  });
  try {
    const r = run("prepcheck", "--root", root);
    assert.equal(r.code, 0, "a malformed marker is skipped, not fatal");
    assert.match(r.out, /clean/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prepcheck is clean when no markers exist at all", () => {
  const dir = mkdtempSync(join(tmpdir(), "prepcheck-empty-"));
  try {
    const r = run("prepcheck", "--root", dir);
    assert.equal(r.code, 0);
    assert.match(r.out, /clean/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
