// A published Phase 0 bundle for FAFF-1 copied into a fresh root, plus a `faff bundle-recover` runner,
// shared by the bundle-recover upgrade (FAFF-1258) and ledger-lock (FAFF-1281) tests.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { publishBundle, localBundleStore } = require("../../plugin/skills/faff/bin/lib/bundle.js");
const { mintIssueAnchor } = require("../../plugin/skills/faff/bin/lib/events.js");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PLUGIN = path.join(REPO, "plugin", "skills", "faff");
const GIT = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.t" };

export function faff(args, { cli = path.join(PLUGIN, "bin", "faff"), cwd = REPO, input } = {}) {
  const env = { ...process.env, ...GIT };
  delete env.FAFF_RUN_DIR; delete env.FAFF_SESSION_ID;
  const r = spawnSync("node", [cli, ...args], { encoding: "utf8", cwd, env, input });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

export const LANDING = {
  issue: "FAFF-1", fix_cycles: 1, last_head_sha: "abc",
  history: [{ cycle: 1, kind: "conflict", failing_checks: [], tried: ["rebase"], at: "2026-01-01T00:00:00.000Z", note: "legacy" }],
  updated_at: "2026-01-01T00:00:00.000Z",
};

// A published bundle for FAFF-1 copied into a fresh root.
export function bundleFixture({ stamped = false, landing = false } = {}) {
  const src = mkdtempSync(path.join(tmpdir(), "faff-1258-brsrc-"));
  const fresh = mkdtempSync(path.join(tmpdir(), "faff-1258-brfresh-"));
  spawnSync("git", ["-C", src, "init", "-q", "-b", "main"], { env: { ...process.env, ...GIT } });
  spawnSync("git", ["-C", src, "commit", "-q", "--allow-empty", "-m", "seed"], { env: { ...process.env, ...GIT } });
  const mint = faff(["run-ledger", "init-interactive", "--issue", "FAFF-1", "--root", src, "--json"]);
  assert.equal(mint.code, 0, mint.err);
  const runDir = JSON.parse(mint.out).run_dir;
  const runId = path.basename(runDir);
  if (!stamped) {
    const led = JSON.parse(readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
    delete led.schema_version;
    writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(led, null, 2) + "\n");
    const note = faff(["events", "append", "--run", runId, "--root", src], { cwd: src, input: JSON.stringify({ phase: "run", type: "ledger-write" }) });
    assert.equal(note.code, 0, note.err);
  }
  mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
  writeFileSync(path.join(runDir, "FAFF-1", "ac-checklist.json"), '{"all_verified":true}');
  if (landing) writeFileSync(path.join(runDir, "FAFF-1", "landing-progress.json"), JSON.stringify(LANDING));
  const anchorDest = path.join(src, ".faff", "anchors", runId, "FAFF-1");
  assert.equal(mintIssueAnchor(runDir, "FAFF-1", anchorDest).ok, true);
  const pub = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root: src, store: localBundleStore(src), boundarySeq: 0 });
  assert.equal(pub.ok, true);
  mkdirSync(path.join(fresh, ".faff", "bundles"), { recursive: true });
  cpSync(path.join(src, ".faff", "bundles"), path.join(fresh, ".faff", "bundles"), { recursive: true });
  const snapshot = readFileSync(path.join(runDir, "run-ledger.json"));
  const cleanup = () => { rmSync(src, { recursive: true, force: true }); rmSync(fresh, { recursive: true, force: true }); };
  return { src, fresh, runId, snapshot, cleanup, ledgerPath: path.join(fresh, ".faff", "runs", runId, "run-ledger.json") };
}

export const recover = (fx, extra = [], opts = {}) => faff(["bundle-recover", "--issue", "FAFF-1", "--root", fx.fresh, "--json", ...extra], { cwd: fx.fresh, ...opts });

