import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const { buildPreflightReport } = createRequire(import.meta.url)("../plugin/skills/faff/bin/lib/run-entry-preflight.js");
const cli = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));

function fixture(t, config, probes, flags = []) {
  const root = mkdtempSync(join(tmpdir(), "faff-entry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "gh-argv");
  const gh = join(bin, "gh");
  writeFileSync(join(root, ".faffrc.yaml"), config);
  writeFileSync(gh, [
    "#!/bin/sh",
    'echo "$*" >> "$FAFF_TEST_PREFLIGHT_LOG"',
    'case "$*" in',
    "  'api user') " + probes.auth + " ;;",
    "  'repo view --json nameWithOwner') echo '{\"nameWithOwner\":\"test/repo\"}' ;;",
    "  'repo view --json defaultBranchRef') echo '{\"defaultBranchRef\":{\"name\":\"default-test\"}}' ;;",
    "  'api repos/test/repo/rules/branches/default-test') " + probes.branch + " ;;",
    "  *) exit 90 ;;",
    "esac",
  ].join("\n") + "\n");
  chmodSync(gh, 0o755);
  const result = spawnSync(process.execPath, [cli, "run", "preflight", ...flags], {
    cwd: root, encoding: "utf8", env: { ...process.env, container: "podman", PATH: bin + delimiter + process.env.PATH,
      GH_TOKEN: "fixture-token-should-not-leak", FAFF_TEST_PREFLIGHT_LOG: log },
  });
  assert.equal(existsSync(join(root, ".faff")), false, "preflight must not mint a run");
  return { result, calls: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [] };
}

const noRules = "echo '[]'";
const requiredRules = "echo '[{\"type\":\"required_status_checks\",\"parameters\":{\"required_status_checks\":[{\"context\":\"validate\"}]}}]'";

test("composes existing GitHub reads once in their real order and returns a compact success", t => {
  const { result, calls } = fixture(t, "{}", { auth: "echo '{\"login\":\"runner\"}'", branch: requiredRules });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.decision, "proceed");
  assert.ok(report.findings.every(finding => finding.probe === "host-socket"));
  assert.deepEqual(calls(), ["api user", "repo view --json nameWithOwner", "repo view --json defaultBranchRef",
    "api repos/test/repo/rules/branches/default-test"]);
});

test("auth failure follows its own block knob and redacts actual credentials in probe basis", t => {
  const auth = 'echo "Bad credentials (HTTP 401) $GH_TOKEN" >&2; exit 1';
  const { result } = fixture(t, "autonomous:\n  require_github_auth: block\n", { auth, branch: noRules });
  assert.equal(result.status, 3, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.decision, "block");
  assert.match(report.findings.find(f => f.probe === "github-auth").message, /re-auth/i);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-token-should-not-leak/);
  assert.equal(report.findings.find(f => f.probe === "branch-protection").action, "warn");
});

test("indeterminate auth stays advisory even when block is configured", t => {
  const { result } = fixture(t, "autonomous:\n  require_github_auth: block\n", {
    auth: "echo 'connection timed out' >&2; exit 1", branch: requiredRules,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.find(f => f.probe === "github-auth").action, "warn");
  assert.doesNotMatch(report.findings.find(f => f.probe === "github-auth").message, /re-auth/i);
});

test("branch-rule failures honour an independent block policy", t => {
  const { result } = fixture(t, "autonomous:\n  require_branch_protection: block\n", {
    auth: "echo '{\"login\":\"runner\"}'",
    branch: "echo 'proxy returned no JSON'",
  });
  assert.equal(result.status, 3, result.stderr);
  const report = JSON.parse(result.stdout);
  const branch = report.findings.find(finding => finding.probe === "branch-protection");
  assert.equal(branch.action, "block");
  assert.equal(branch.status, "indeterminate");
});

test("socket and indeterminate auth remain advisory even when the container policy blocks", () => {
  const report = buildPreflightReport(
    { result: "not_confirmed", basis: "no runtime marker" },
    { present: true, path: "/run/docker.sock" },
    { status: "indeterminate", basis: "offline" },
    { status: "protected", basis: "required check" },
    { container: true, auth: true, branch: true },
  );
  assert.equal(report.decision, "block");
  assert.deepEqual(report.findings.map(({ probe, action }) => [probe, action]),
    [["github-auth", "warn"], ["container", "block"], ["host-socket", "warn"]]);
});

test("malformed config fails before probing or minting", t => {
  const { result, calls } = fixture(t, "- unexpected top-level sequence\n", { auth: "exit 90", branch: "exit 90" });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /faff run preflight:/);
  assert.deepEqual(calls(), []);
});

test("explicit JSON keeps the same probes, policy and output on pass and block", t => {
  for (const config of ["{}", "autonomous:\n  require_github_auth: block\n"]) {
    const probes = { auth: "echo 'HTTP 401' >&2; exit 1", branch: requiredRules };
    const implicit = fixture(t, config, probes);
    const explicit = fixture(t, config, probes, ["--json"]);
    assert.equal(explicit.result.status, implicit.result.status);
    assert.equal(explicit.result.stdout, implicit.result.stdout);
    assert.deepEqual(explicit.calls(), implicit.calls());
  }
});
