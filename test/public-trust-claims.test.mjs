import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VALIDATOR = join(ROOT, "verification/audits/tools/faff-732/validate-report.mjs");
const LEDGER = join(ROOT, "verification/audits/2026-08-07-FAFF-732-public-trust-claims/claim-ledger.json");
const REPORT = join(ROOT, "verification/audits/2026-08-07-FAFF-732-public-trust-claims.md");
// Catches a claim pointed at a known-closed owner; cannot notice an owner closing after merge.
const CLOSED_OWNER_ISSUES = ["FAFF-732", "FAFF-734", "FAFF-735", "FAFF-736", "FAFF-739", "FAFF-740", "FAFF-741", "FAFF-743"];
const run = (...args) => spawnSync(process.execPath, [VALIDATOR, ...args], { cwd: ROOT, encoding: "utf8" });

test("FAFF-732 validator self-test covers the validation rule families", () => {
  const result = run("--selftest");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ok \(3 cases\)/);
});

test("FAFF-732 claim ledger is valid and covers the immutable source tree", () => {
  const result = run(LEDGER, REPORT);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.valid, true);
  assert.equal(output.files, 715);
  assert.ok(output.claims > 0);
});

test("FAFF-732 committed report equals deterministic renderer output", () => {
  const result = run("--render", LEDGER);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, readFileSync(REPORT, "utf8"));
});

const withLedgerCopy = (edit, use) => {
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
  const claim = (id) => ledger.claims.find((item) => item.id === id);
  edit(claim);
  const directory = mkdtempSync(join(tmpdir(), "faff-732-ledger-"));
  try {
    const copy = join(directory, "claim-ledger.json");
    writeFileSync(copy, JSON.stringify(ledger));
    return use(copy);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("FAFF-740 pointers a reader follows resolve in the working tree", () => {
  const result = run("--check-live", LEDGER);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '{"live":true,"checked":20,"skipped":0}');
});

test("FAFF-740 undoing the path repairs reproduces exactly the six original errors", () => {
  const result = withLedgerCopy((claim) => {
    claim("readme-claude-only-harness-wording").evidence[0].target = "docs/architecture/codex-cli-observed.md";
    claim("codex-observed-capability").evidence[0].target = "docs/architecture/codex-cli-observed.md";
    delete claim("codex-observed-capability").source.current_path;
    claim("harness-portability-boundary").evidence[0].target = "docs/architecture/harness-coupling.md";
    delete claim("harness-portability-boundary").source.current_path;
    claim("l4-completion-claim").evidence[0].target = "docs/evidence/README.md";
  }, (copy) => run("--check-live", copy));
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, [
    "readme-claude-only-harness-wording: evidence target docs/architecture/codex-cli-observed.md does not exist in the working tree",
    "codex-observed-capability: source path docs/architecture/codex-cli-observed.md does not exist in the working tree; record the move in source.current_path",
    "codex-observed-capability: evidence target docs/architecture/codex-cli-observed.md does not exist in the working tree",
    "harness-portability-boundary: source path docs/architecture/harness-coupling.md does not exist in the working tree; record the move in source.current_path",
    "harness-portability-boundary: evidence target docs/architecture/harness-coupling.md does not exist in the working tree",
    "l4-completion-claim: evidence target docs/evidence/README.md does not exist in the working tree",
  ].join("\n") + "\n");
});

test("FAFF-740 an empty source.current_path is rejected", () => {
  const result = withLedgerCopy((claim) => {
    claim("codex-observed-capability").source.current_path = "";
  }, (copy) => run(copy));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /codex-observed-capability: invalid source\.current_path/);
});

test("FAFF-740 no claim names a closed owner issue", () => {
  const { claims } = JSON.parse(readFileSync(LEDGER, "utf8"));
  for (const claim of claims.filter((item) => item.owner_issue)) {
    assert.ok(!CLOSED_OWNER_ISSUES.includes(claim.owner_issue), `${claim.id} names closed owner ${claim.owner_issue}`);
  }
});
