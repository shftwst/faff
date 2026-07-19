// FAFF-556 — git-only queue-state via stable item-keys.
//
// Integration smoke over the real CLI seam: `faff queue-state new-key` mints a
// stable gitkey, and `faff queue-state derive` diffs the union of emitted
// item-keys (intake markers + spec-store filenames) against a run-ledger's
// outcomes by exact match. The pure classifier + mint-format table lives in
// `faff queue-state --selftest` (run in CI); this proves the real filesystem
// wiring (glob + marker regex + ledger read) end-to-end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const faffBin = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");

function faff(args) {
  const env = { ...process.env, FAFF_RUN_DIR: "" };
  const r = spawnSync("node", [faffBin, ...args], { cwd: repoRoot, encoding: "utf8", env });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "faff-queue-state-test-"));
  fs.mkdirSync(path.join(root, ".faff", "intake"), { recursive: true });
  fs.mkdirSync(path.join(root, ".faff", "specs"), { recursive: true });
  return root;
}

test("queue-state --selftest passes (the pure classifier + mint table)", () => {
  const r = faff(["queue-state", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("new-key: emits a gk-<YYYYMMDD>-<6xbase36> key, two calls differ", () => {
  const a = faff(["queue-state", "new-key"]);
  const b = faff(["queue-state", "new-key"]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  const k1 = a.stdout.trim();
  const k2 = b.stdout.trim();
  assert.match(k1, /^gk-\d{8}-[0-9a-z]{6}$/);
  assert.notEqual(k1, k2);
});

test("derive: intake marker + spec filename, all shipped -> queue_empty true (AC 1)", (t) => {
  const root = mkRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ".faff", "intake", "roadmap.md"),
    "- [ ] Build the auth module <!-- gitkey:gk-20260719-aaaaaa -->\n", "utf8");
  fs.writeFileSync(path.join(root, ".faff", "specs", "gk-20260719-bbbbbb.md"), "# spec\n", "utf8");
  const runDir = path.join(root, ".faff", "runs", "run-1");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({
    outcomes: { "gk-20260719-aaaaaa": "shipped", "gk-20260719-bbbbbb": "pr-open" },
  }), "utf8");

  const r = faff(["queue-state", "derive", "--root", root, "--run-dir", runDir]);
  assert.equal(r.code, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.queue_empty, true);
  assert.equal(payload.all_parked, false);
  assert.equal(payload.items_total, 2);
  assert.equal(payload.reason, "drained");
});

test("derive: a key absent from outcomes -> queue_empty false, fail-safe (AC 2)", (t) => {
  const root = mkRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ".faff", "intake", "roadmap.md"),
    "- [ ] Item A <!-- gitkey:gk-20260719-cccccc -->\n- [ ] Item B <!-- gitkey:gk-20260719-dddddd -->\n", "utf8");
  const runDir = path.join(root, ".faff", "runs", "run-1");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({
    outcomes: { "gk-20260719-cccccc": "shipped" }, // dddddd absent
  }), "utf8");

  const r = faff(["queue-state", "derive", "--root", root, "--run-dir", runDir]);
  assert.equal(r.code, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.queue_empty, false);
  assert.equal(payload.all_parked, false);
  assert.deepEqual(payload.items_pending, ["gk-20260719-dddddd"]);
});

test("derive: every item parked -> all_parked true, queue_empty false (AC 3)", (t) => {
  const root = mkRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ".faff", "specs", "gk-20260719-eeeeee.md"), "# spec\n", "utf8");
  const runDir = path.join(root, ".faff", "runs", "run-1");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({
    outcomes: { "gk-20260719-eeeeee": "parked" },
  }), "utf8");

  const r = faff(["queue-state", "derive", "--root", root, "--run-dir", runDir]);
  assert.equal(r.code, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.queue_empty, false);
  assert.equal(payload.all_parked, true);
  assert.equal(payload.reason, "all-parked");
});

test("derive: empty item set -> queue_empty false, reason no-item-keys (AC 4)", (t) => {
  const root = mkRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = faff(["queue-state", "derive", "--root", root]);
  assert.equal(r.code, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.queue_empty, false);
  assert.equal(payload.all_parked, false);
  assert.equal(payload.reason, "no-item-keys");
  assert.equal(payload.items_total, 0);
});

test("derive: no run-ledger.json at all -> exit 0, queue_empty false (valid state, not an error) (AC 5)", (t) => {
  const root = mkRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ".faff", "specs", "gk-20260719-ffffff.md"), "# spec\n", "utf8");
  const runDir = path.join(root, ".faff", "runs", "run-empty");
  fs.mkdirSync(runDir, { recursive: true }); // no run-ledger.json written

  const r = faff(["queue-state", "derive", "--root", root, "--run-dir", runDir]);
  assert.equal(r.code, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.queue_empty, false);
});

test("derive: a present-but-unparseable ledger -> exit 2, loud (AC 5)", (t) => {
  const root = mkRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runDir = path.join(root, ".faff", "runs", "run-corrupt");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-ledger.json"), "{ this is not json", "utf8");

  const r = faff(["queue-state", "derive", "--root", root, "--run-dir", runDir]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unparseable/);
});

test("derive + new-key: a minted key round-trips through a spec-store filename (AC 6/7)", (t) => {
  const root = mkRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const minted = faff(["queue-state", "new-key"]);
  const key = minted.stdout.trim();
  assert.match(key, /^gk-\d{8}-[0-9a-z]{6}$/);
  fs.writeFileSync(path.join(root, ".faff", "specs", `${key}.md`), "# spec\n", "utf8");

  const before = faff(["queue-state", "derive", "--root", root]);
  const beforePayload = JSON.parse(before.stdout);
  assert.equal(beforePayload.items_total, 1);
  assert.deepEqual(beforePayload.items_pending, [key]);

  // renaming the FILE to a DIFFERENT gitkey-shaped stem changes the key (store
  // B: the key IS the filename stem — no frontmatter, no content parse) — the
  // original key's item disappears and the new stem appears, proving the
  // store reads the filename verbatim rather than any persisted identity
  // inside the file.
  const key2 = "gk-20260719-zzz999";
  fs.renameSync(path.join(root, ".faff", "specs", `${key}.md`), path.join(root, ".faff", "specs", `${key2}.md`));
  const after = faff(["queue-state", "derive", "--root", root]);
  const afterPayload = JSON.parse(after.stdout);
  assert.equal(afterPayload.items_total, 1);
  assert.deepEqual(afterPayload.items_pending, [key2]);
  assert.equal(afterPayload.items_pending.includes(key), false);
});

test("derive: a non-gitkey-shaped file/marker is never trusted as an item-key", (t) => {
  const root = mkRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // a stray file in the spec store that predates gitkeys, or just isn't one
  fs.writeFileSync(path.join(root, ".faff", "specs", "README.md"), "# not a gitkey\n", "utf8");
  // a pasted/malformed marker value in the intake store — must never collide
  // with a ledger outcome string via exact-match (e.g. "shipped")
  fs.writeFileSync(path.join(root, ".faff", "intake", "roadmap.md"),
    "- [ ] some line <!-- gitkey:shipped -->\n", "utf8");

  const r = faff(["queue-state", "derive", "--root", root]);
  assert.equal(r.code, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.items_total, 0);
  assert.equal(payload.reason, "no-item-keys");
});

test("unknown subverb -> exit 2 usage error", () => {
  const r = faff(["queue-state", "bogus"]);
  assert.equal(r.code, 2);
});
