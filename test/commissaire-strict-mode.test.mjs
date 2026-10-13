// FAFF-1219 — strict mode (require_pinned_governor = true) turns an otherwise-valid grant whose key is
// not pinned into a `grant-not-pinned` refusal in verifyGrant, and nothing else. Ledgers are hand-built
// with real Ed25519 keys (helpers/governed-run.mjs); the merge-gate legs are driven through checkLeg.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { mkGovernedRun, grantedRun, swapInRunnerKey, trustToml, LEDGER } from "./helpers/governed-run.mjs";
import { trustRepo, localTrustCtx } from "./helpers/trust-context.mjs";
import { signDecision, buildEnvelope } from "../plugin/skills/faff/bin/lib/producer-auth.js";
import { sha256Hex } from "../plugin/skills/faff/bin/lib/events.js";
import { verifyGrant, resolveAdmittedKey } from "../plugin/skills/faff/bin/lib/commissaire-verify.js";
import trust from "../plugin/skills/faff/bin/lib/commissaire-trust.js";
import * as MG from "../plugin/skills/faff/bin/lib/merge-gate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY_TS = join(HERE, "..", "plugin", "skills", "faff", "bin", "lib", "commissaire-verify.ts");
const { readTrustFile } = trust;
const UNIT = "FAFF-1";
const MERGE = { kind: "merge", target: "main" };
const OTHER = "f".repeat(64);
const LEGS = [["merge", "main"], ["branch-delete", "feature"], ["pr-create", "main"]];

const cleanups = [];
after(() => { for (const fn of cleanups) { try { fn(); } catch {} } });
const track = (fn) => { cleanups.push(fn); };
const governed = (opts) => { const r = grantedRun(opts); track(() => r.rm()); return r; };
const bare = (opts) => { const r = mkGovernedRun(opts); track(() => r.rm()); return r; };

const trustFile = (fps, { present = true, requirePinned = false, source = "remote-base" } = {}) => ({
  read: { ok: true, value: { present, source, config: present ? { schema: 1, governorKeyFingerprints: fps, requirePinnedGovernor: requirePinned, pinChangeApprovers: [] } : null } },
});
const NOT_READ = { not_read: true };

const verify = (run, trust, { step = "merge", effect = MERGE } = {}) => verifyGrant({ run_dir: run.runDir, unit_id: UNIT, step, effect, trust });
const summary = (res) => ({ outcome: res.outcome, reason: res.reason, custody: res.custody, classification: res.classification });

// A git repo whose `main` carries the given trust.toml text (or none).
function repoWith(toml) {
  const dir = trustRepo("main");
  track(() => rmSync(dir, { recursive: true, force: true }));
  if (toml !== undefined) {
    mkdirSync(join(dir, ".commissaire"), { recursive: true });
    writeFileSync(join(dir, ".commissaire", "trust.toml"), toml);
    for (const a of [["add", "."], ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "trust"]]) assert.equal(spawnSync("git", ["-C", dir, ...a]).status, 0, `git ${a.join(" ")}`);
  }
  return dir;
}

// Every governed refusal and valid shape the strict branch must leave alone.
function scenarios() {
  const out = {};
  out.governor = governed();
  out.inProcess = governed({ custody: "in-process" });
  out.granted = governed();
  out.swapped = governed(); swapInRunnerKey(out.swapped);
  out.deny = bare(); out.deny.grant("merge", "merge", "main"); out.deny.add("effect-decision-verdict", "merge", { verdict: "deny", effect: MERGE }); out.deny.flush();
  out.orphan = bare();
  {
    const r = out.orphan;
    r.add("producer-note", "merge", { n: 1 });
    const orphanPrev = r.prevHash();
    r.add("producer-note", "merge", { won: true });
    const rec = buildEnvelope(r.runId, 2, orphanPrev, "commissaire", "P1", "r1", { kind_of_entry: "effect-decision-verdict", unit_id: UNIT, step: "merge", payload: { verdict: "grant", effect: MERGE } });
    rec.commissaire_sig = signDecision(rec, r.kp.sk);
    r.lines.push(JSON.stringify(rec));
    r.flush();
  }
  const ungoverned = mkdtempSync(join(tmpdir(), "faff1219-ungov-"));
  track(() => rmSync(ungoverned, { recursive: true, force: true }));
  out.ungoverned = { runDir: ungoverned };
  return out;
}

// --- strict on: unpinned and in-process grants are refused ---------------------------------------------

test("strict on: an unpinned governor grant is grant-not-pinned, reporting the real classification and the same fields as strict off", () => {
  const run = governed();
  const on = verify(run, trustFile([OTHER], { requirePinned: true }));
  const off = verify(run, trustFile([OTHER]));
  assert.deepEqual(summary(on), { outcome: "absent-or-invalid", reason: "grant-not-pinned", custody: "governor", classification: "unpinned" });
  assert.equal(off.outcome, "valid-grant");
  for (const field of ["signer_fingerprint", "verdict_seq", "trust_source"]) assert.equal(on[field], off[field], field);
  assert.equal(on.signer_fingerprint, run.kp.pk_fingerprint);
  assert.equal(on.verdict_seq, 1);
  assert.equal(on.trust_source, "remote-base");
});

test("strict on: an in-process grant is grant-not-pinned with custody and classification in-process", () => {
  const run = governed({ custody: "in-process" });
  const res = verify(run, trustFile([OTHER], { requirePinned: true }), { step: "pr-create", effect: { kind: "pr-create", target: "main" } });
  assert.deepEqual(summary(res), { outcome: "absent-or-invalid", reason: "grant-not-pinned", custody: "in-process", classification: "in-process" });
  assert.equal(res.signer_fingerprint, run.kp.pk_fingerprint);
  assert.equal(res.verdict_seq, 3);
});

test("strict on: a pinned grant still passes from both a local-ref and a remote-base read", () => {
  const run = governed();
  for (const source of ["local-ref", "remote-base"]) {
    const res = verify(run, trustFile([run.kp.pk_fingerprint], { requirePinned: true, source }));
    assert.deepEqual(summary(res), { outcome: "valid-grant", reason: "valid-grant", custody: "governor", classification: "pinned" }, source);
    assert.equal(res.trust_source, source);
  }
});

// --- strict off, file absent, not read: nothing changes --------------------------------------------------

test("strict off, trust file absent and not-read leave every result identical across the refusal matrix", () => {
  const runs = scenarios();
  const variants = {
    "not-read": { trust: NOT_READ, source: "not-read" },
    "absent file": { trust: trustFile([], { present: false }), source: "remote-base" },
    "flag false, key unlisted": { trust: trustFile([OTHER]), source: "remote-base" },
  };
  const expected = { governor: "valid-grant", inProcess: "valid-grant", granted: "valid-grant", swapped: "governor-key-not-admitted", deny: "decision-not-a-grant", orphan: "chain-position-invalid", ungoverned: "not-governed" };
  for (const [name, run] of Object.entries(runs)) {
    const baseline = verify(run, NOT_READ);
    assert.equal(baseline.reason, expected[name], name);
    for (const [label, { trust, source }] of Object.entries(variants)) {
      const res = verify(run, trust);
      assert.deepEqual({ ...res, trust_source: baseline.trust_source }, baseline, `${name} / ${label}`);
      assert.equal(res.trust_source, source, `${name} / ${label}`);
    }
  }
});

test("strict off with the file absent: an unpinned governor grant is valid-grant, never grant-not-pinned", () => {
  const run = governed();
  for (const trust of [NOT_READ, trustFile([], { present: false }), trustFile([OTHER], { requirePinned: false })]) {
    assert.equal(verify(run, trust).reason, "valid-grant");
  }
});

test("strict on through a real trust file: pinned passes, unlisted is refused, and the same file with the flag removed passes", () => {
  const run = governed();
  const read = (toml) => {
    const dir = repoWith(toml);
    const res = readTrustFile({ repoDir: dir, ref: "main", transport: "local" });
    assert.equal(res.ok, true);
    return { read: res };
  };
  assert.equal(verify(run, read(trustToml([run.kp.pk_fingerprint], "require_pinned_governor = true\n"))).reason, "valid-grant");
  assert.equal(verify(run, read(trustToml([OTHER], "require_pinned_governor = true\n"))).reason, "grant-not-pinned");
  assert.equal(verify(run, read(trustToml([OTHER]))).reason, "valid-grant");
});

test("integration smoke: an in-process run is refused under strict mode and passes once the flag is turned off", () => {
  const run = governed({ custody: "in-process" });
  const dir = repoWith(trustToml([OTHER], "require_pinned_governor = true\n"));
  const read = () => ({ read: readTrustFile({ repoDir: dir, ref: "main", transport: "local" }) });
  assert.deepEqual(summary(verify(run, read())), { outcome: "absent-or-invalid", reason: "grant-not-pinned", custody: "in-process", classification: "in-process" });
  writeFileSync(join(dir, ".commissaire", "trust.toml"), trustToml([OTHER], "require_pinned_governor = false\n"));
  for (const a of [["add", "."], ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "off"]]) assert.equal(spawnSync("git", ["-C", dir, ...a]).status, 0, `git ${a.join(" ")}`);
  assert.deepEqual(summary(verify(run, read())), { outcome: "valid-grant", reason: "valid-grant", custody: "in-process", classification: "in-process" });
});

// --- strict on never changes an existing refusal ----------------------------------------------------------

test("strict on never changes a refusal: every result equals the strict-off result for the same inputs", () => {
  const runs = scenarios();
  const expected = {
    noStep: ["no-verdict-for-step", { step: "branch-delete", effect: { kind: "branch-delete", target: "feature" } }],
    swapped: ["governor-key-not-admitted", {}],
    deny: ["decision-not-a-grant", {}],
    orphan: ["chain-position-invalid", {}],
    ungoverned: ["not-governed", {}],
  };
  runs.noStep = (() => { const r = bare(); r.grant("merge", "merge", "main"); r.flush(); return r; })();
  for (const [name, [reason, opts]] of Object.entries(expected)) {
    const on = verify(runs[name], trustFile([OTHER], { requirePinned: true }), opts);
    const off = verify(runs[name], trustFile([OTHER]), opts);
    assert.equal(on.reason, reason, name);
    assert.deepEqual(on, off, name);
  }
});

test("a swapped pk.json under strict mode is governor-key-not-admitted, not grant-not-pinned", () => {
  const run = governed();
  swapInRunnerKey(run);
  const res = verify(run, trustFile([run.kp.pk_fingerprint], { requirePinned: true }));
  assert.equal(res.reason, "governor-key-not-admitted");
});

// --- strict on with an empty list, and with an unreadable file ---------------------------------------------

test("strict on with an empty fingerprint list is refused by the reader, and the governed run is trust-file-invalid", () => {
  for (const custody of ["governor", "in-process"]) {
    const run = governed({ custody });
    const dir = repoWith(`schema = 1\ngovernor_key_fingerprints = []\nrequire_pinned_governor = true\n`);
    const read = readTrustFile({ repoDir: dir, ref: "main", transport: "local" });
    assert.equal(read.ok, false);
    assert.match(read.error.message, /strict mode requires at least one fingerprint/);
    const res = verify(run, { read, attempted: "local-ref" });
    assert.deepEqual({ outcome: res.outcome, reason: res.reason }, { outcome: "absent-or-invalid", reason: "trust-file-invalid" }, custody);
  }
});

// --- ungoverned runs stay not-applicable ---------------------------------------------------------------------

test("strict on: an ungoverned run, and a governed run whose governance material was deleted, stay not-applicable", () => {
  const strict = trustFile([OTHER], { requirePinned: true });
  const empty = mkdtempSync(join(tmpdir(), "faff1219-empty-"));
  track(() => rmSync(empty, { recursive: true, force: true }));
  assert.deepEqual(summary(verifyGrant({ run_dir: empty, unit_id: UNIT, step: "merge", effect: MERGE, trust: strict })), { outcome: "not-applicable", reason: "not-governed", custody: null, classification: null });

  const run = governed();
  assert.equal(verify(run, strict).reason, "grant-not-pinned");
  rmSync(join(run.runDir, "commissaire"), { recursive: true, force: true });
  rmSync(join(run.runDir, LEDGER), { force: true });
  const res = verify(run, strict);
  assert.deepEqual(summary(res), { outcome: "not-applicable", reason: "not-governed", custody: null, classification: null });
  assert.equal(res.trust_source, "remote-base", "an ungoverned run reports the supplied transport, and the flag is not consulted");

  for (const leg of ["merge", "branch-delete", "pr-create"]) {
    const check = MG.checkLeg(run.runDir, UNIT, leg, "main", localTrustCtx(repoWith(trustToml([OTHER], "require_pinned_governor = true\n"))));
    assert.deepEqual(check, { state: "not-applicable", detail: null }, leg);
  }
});

// --- merge-gate legs --------------------------------------------------------------------------------------------

test("strict on: the merge, pr-create and branch-delete legs refuse an unpinned governor grant and an in-process grant with grant-not-pinned", () => {
  const strictRepo = repoWith(trustToml([OTHER], "require_pinned_governor = true\n"));
  for (const [label, run, custody, classification] of [
    ["unpinned governor", governed(), "governor", "unpinned"],
    ["in-process", governed({ custody: "in-process" }), "in-process", "in-process"],
  ]) {
    for (const [leg, target] of LEGS) {
      const check = MG.checkLeg(run.runDir, UNIT, leg, target, localTrustCtx(strictRepo));
      assert.equal(check.state, "absent-or-invalid", `${label} ${leg}`);
      assert.equal(check.detail.reason, "grant-not-pinned", `${label} ${leg}`);
      assert.equal(check.detail.custody, custody);
      assert.equal(check.detail.classification, classification);
      assert.equal(check.detail.signer_fingerprint, run.kp.pk_fingerprint);
      assert.equal(check.detail.evidence, false);
    }
  }
});

test("strict on: the three legs pass a pinned grant; strict off passes the same unpinned grant", () => {
  const run = governed();
  const pinned = repoWith(trustToml([run.kp.pk_fingerprint], "require_pinned_governor = true\n"));
  const lax = repoWith(trustToml([OTHER]));
  for (const [leg, target] of LEGS) {
    const strict = MG.checkLeg(run.runDir, UNIT, leg, target, localTrustCtx(pinned));
    assert.equal(strict.state, "valid-grant", leg);
    assert.equal(strict.detail.classification, "pinned");
    const off = MG.checkLeg(run.runDir, UNIT, leg, target, localTrustCtx(lax));
    assert.equal(off.state, "valid-grant", leg);
    assert.equal(off.detail.classification, "unpinned");
  }
});

test("strict on: existing leg refusals keep their reasons", () => {
  const strictRepo = repoWith(trustToml([OTHER], "require_pinned_governor = true\n"));
  const swapped = governed();
  swapInRunnerKey(swapped);
  for (const [leg, target] of LEGS) {
    assert.equal(MG.checkLeg(swapped.runDir, UNIT, leg, target, localTrustCtx(strictRepo)).detail.reason, "governor-key-not-admitted", leg);
  }
  const merged = governed();
  assert.equal(MG.checkLeg(merged.runDir, UNIT, "merge", "release", localTrustCtx(strictRepo)).detail.reason, "grant-does-not-cover-effect");
  for (const [leg, target] of LEGS) {
    assert.equal(MG.checkLeg(merged.runDir, UNIT, leg, target, undefined).detail.reason, "trust-context-missing", leg);
  }
});

// --- the switch lives only in the trust argument ----------------------------------------------------------------------

test("the strict flag is read only from the trust argument", () => {
  const src = readFileSync(VERIFY_TS, "utf8");
  assert.doesNotMatch(src, /process\.env|\.faffrc|readFileSync\([^)]*trust/);
  assert.equal(src.match(/requirePinnedGovernor/g).length, 1, "one read, in trustFacts");
  const run = governed();
  process.env.REQUIRE_PINNED_GOVERNOR = "true";
  try {
    assert.equal(verify(run, trustFile([OTHER])).reason, "valid-grant");
    assert.equal(resolveAdmittedKey(run.runDir, NOT_READ).require_pinned_governor, false);
  } finally { delete process.env.REQUIRE_PINNED_GOVERNOR; }
});
