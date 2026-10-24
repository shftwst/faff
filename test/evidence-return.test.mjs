// FAFF-1397 — `faff evidence return` and `faff evidence verify-return`: obligation 6 by digest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { validateAgainstSchema } = require("../plugin/skills/faff/bin/lib/contract-engine.js");

const LEDGER_SCHEMA = JSON.parse(readFileSync(join(import.meta.dirname, "..", "plugin", "skills", "faff", "contracts", "evidence-v0.3", "schema", "run-ledger.schema.json"), "utf8"));
const PERSISTED_ITEM = LEDGER_SCHEMA.properties.evidence_persisted.items;
const ISSUE = "ISSUE-1";
const AC = "ac-checklist.json";
const RV = "review-verdict.json";
const sha = (text) => createHash("sha256").update(text).digest("hex");
const AC_BODY = '{"note":"<unknown> -> &","all_verified":true}\n';
const RV_BODY = '{"signal":"pass"}\n';

function fixture(t, { files = { [AC]: AC_BODY, [RV]: RV_BODY }, ledger } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-evidence-return-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, ".faff", "runs", "run-20991231-000000-graft-ISSUE-1");
  const issueDir = join(runDir, ISSUE);
  mkdirSync(issueDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) if (body !== null) writeFileSync(join(issueDir, name), body);
  if (ledger !== undefined) writeFileSync(join(runDir, "run-ledger.json"), typeof ledger === "string" ? ledger : JSON.stringify(ledger));
  const ret = (runDirArg = runDir, issue = ISSUE) => runCli(["evidence", "return", "--run-dir", runDirArg, "--issue", issue], { cwd: root });
  const verify = (input, extra = [], runDirArg = runDir, issue = ISSUE) =>
    runCli(["evidence", "verify-return", ...extra, "--run-dir", runDirArg, "--issue", issue], { input, cwd: root });
  const against = (runDirArg = runDir, issue = ISSUE) => verify(undefined, ["--against-ledger"], runDirArg, issue);
  return { root, runDir, issueDir, ret, verify, against };
}

const line = (r) => JSON.parse(r.stdout.trim());
const digest = (body) => ({ present: true, sha256: sha(body) });
const NONE = { present: false, sha256: null };
const claim = (a, r, issue = ISSUE) => JSON.stringify({ issue, ac_checklist: a, review_verdict: r });
const goodClaim = () => claim(digest(AC_BODY), digest(RV_BODY));
const snapshot = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p); else out[p] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
};

test("return prints one EvidenceReturn line with lowercase hex digests and exits 0", (t) => {
  const f = fixture(t);
  const r = f.ret();
  assert.equal(r.code, 0);
  assert.equal(r.stdout.split("\n").length, 2);
  assert.deepEqual(line(r), { issue: ISSUE, ac_checklist: digest(AC_BODY), review_verdict: digest(RV_BODY) });
  assert.match(line(r).ac_checklist.sha256, /^[0-9a-f]{64}$/);
});

test("return reports an absent file as present:false with a null sha256", (t) => {
  const f = fixture(t, { files: { [AC]: AC_BODY } });
  const r = f.ret();
  assert.equal(r.code, 0);
  assert.deepEqual(line(r), { issue: ISSUE, ac_checklist: digest(AC_BODY), review_verdict: NONE });
});

test("return exits 2 with nothing on stdout for a symlink, a bad run dir, a bad issue id and missing flags", (t) => {
  const f = fixture(t, { files: { [AC]: AC_BODY } });
  const elsewhere = join(f.root, "elsewhere.json");
  writeFileSync(elsewhere, "{}");
  symlinkSync(elsewhere, join(f.issueDir, RV));
  const cases = [
    f.ret(),
    f.ret(f.root),
    f.ret(f.runDir, "../ISSUE-1"),
    f.ret(f.runDir, "bad id"),
    runCli(["evidence", "return", "--issue", ISSUE], { cwd: f.root }),
    runCli(["evidence", "return", "--against-ledger", "--run-dir", f.runDir, "--issue", ISSUE], { cwd: f.root }),
  ];
  for (const r of cases) {
    assert.equal(r.code, 2, r.stderr);
    assert.equal(r.stdout, "");
    assert.notEqual(r.stderr, "");
  }
});

test("verify-return agrees on an untouched return and the evidence_persisted entry validates", (t) => {
  const f = fixture(t);
  const r = f.verify(goodClaim());
  assert.equal(r.code, 0);
  const v = line(r);
  assert.equal(v.verdict, "agree");
  assert.equal(v.issue, ISSUE);
  assert.deepEqual(v.files.map((x) => x.file), [AC, RV]);
  assert.deepEqual(v.files.map((x) => x.result), ["match", "match"]);
  assert.deepEqual(v.evidence_persisted, { issue: ISSUE, ac_sha256: sha(AC_BODY), review_verdict_sha256: sha(RV_BODY) });
  assert.deepEqual(validateAgainstSchema(v.evidence_persisted, PERSISTED_ITEM), []);
  assert.equal(v.park_cause, null);
  assert.deepEqual(v.paths, []);
  assert.deepEqual(v.tampered_paths, []);
});

test("round trip: the printed line survives an HTML-entity escape of <, > and & and still agrees", (t) => {
  const f = fixture(t);
  const printed = f.ret().stdout;
  const escaped = printed.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  assert.equal(escaped, printed, "a digest line carries none of the escaped characters");
  const r = f.verify(escaped);
  assert.equal(r.code, 0);
  assert.equal(line(r).verdict, "agree");
  assert.equal(line(r).evidence_persisted.ac_sha256, sha(AC_BODY));
});

test("evidence_persisted is null when no file is present and both are absent on disk", (t) => {
  const f = fixture(t, { files: {} });
  const r = f.verify(claim(NONE, NONE));
  assert.equal(r.code, 0);
  assert.equal(line(r).verdict, "agree");
  assert.deepEqual(line(r).files.map((x) => x.result), ["absent-both", "absent-both"]);
  assert.equal(line(r).evidence_persisted, null);
});

test("a one-byte change after the return is a hash-mismatch, tampered, with the verbatim cause", (t) => {
  const f = fixture(t);
  appendFileSync(join(f.issueDir, AC), "x");
  const r = f.verify(goodClaim());
  assert.equal(r.code, 1);
  const v = line(r);
  assert.equal(v.verdict, "mismatch");
  assert.equal(v.files[0].result, "hash-mismatch");
  assert.equal(v.files[1].result, "match");
  assert.equal(v.park_cause, `evidence-return mismatch — ${ISSUE}/${AC} (returned copy ≠ on-disk copy)`);
  assert.deepEqual(v.paths, [`${ISSUE}/${AC}`]);
  assert.deepEqual(v.tampered_paths, [`${ISSUE}/${AC}`]);
  assert.equal(v.evidence_persisted, null);
});

test("presence disagreement in both directions is a tampered mismatch", (t) => {
  const f = fixture(t, { files: { [AC]: AC_BODY } });
  const claimedAbsent = line(f.verify(claim(NONE, NONE)));
  assert.equal(claimedAbsent.files[0].result, "presence-disagreement");
  assert.equal(claimedAbsent.park_cause, `evidence-return mismatch — ${ISSUE}/${AC} (presence disagreement)`);
  assert.deepEqual(claimedAbsent.tampered_paths, [`${ISSUE}/${AC}`]);
  const claimedPresent = f.verify(claim(digest(AC_BODY), digest(RV_BODY)));
  assert.equal(claimedPresent.code, 1);
  const v = line(claimedPresent);
  assert.equal(v.files[1].result, "presence-disagreement");
  assert.equal(v.park_cause, `evidence-return mismatch — ${ISSUE}/${RV} (presence disagreement)`);
});

test("when both files fail the cause names the first and paths lists both", (t) => {
  const f = fixture(t);
  appendFileSync(join(f.issueDir, AC), "x");
  appendFileSync(join(f.issueDir, RV), "x");
  const v = line(f.verify(goodClaim()));
  assert.equal(v.park_cause, `evidence-return mismatch — ${ISSUE}/${AC} (returned copy ≠ on-disk copy)`);
  assert.deepEqual(v.paths, [`${ISSUE}/${AC}`, `${ISSUE}/${RV}`]);
  assert.deepEqual(v.tampered_paths, v.paths);
});

test("a symlink at an evidence path is not-regular-file and tampered", (t) => {
  const f = fixture(t, { files: { [AC]: AC_BODY } });
  const elsewhere = join(f.root, "elsewhere.json");
  writeFileSync(elsewhere, RV_BODY);
  symlinkSync(elsewhere, join(f.issueDir, RV));
  const r = f.verify(claim(digest(AC_BODY), digest(RV_BODY)));
  assert.equal(r.code, 1);
  const v = line(r);
  assert.equal(v.files[1].result, "not-regular-file");
  assert.equal(v.files[1].disk_sha256, null);
  assert.equal(v.park_cause, `evidence-return mismatch — ${ISSUE}/${RV} (on-disk copy is not a regular file)`);
  assert.deepEqual(v.tampered_paths, [`${ISSUE}/${RV}`]);
});

test("stdin null with both files absent agrees and persists nothing", (t) => {
  const f = fixture(t, { files: {} });
  const r = f.verify("null\n");
  assert.equal(r.code, 0);
  assert.equal(line(r).verdict, "agree");
  assert.equal(line(r).evidence_persisted, null);
});

test("stdin null with a file on disk is no-claim: a missing cause, no tampered path", (t) => {
  const f = fixture(t, { files: { [AC]: AC_BODY } });
  const r = f.verify("null");
  assert.equal(r.code, 1);
  const v = line(r);
  assert.equal(v.verdict, "mismatch");
  assert.equal(v.files[0].result, "no-claim");
  assert.equal(v.park_cause, `evidence-return missing — ${ISSUE}/${AC} (no digest returned for a file on disk)`);
  assert.deepEqual(v.paths, [`${ISSUE}/${AC}`]);
  assert.deepEqual(v.tampered_paths, []);
});

test("a mixed no-claim and hash-mismatch run lists only the changed file as tampered", (t) => {
  const f = fixture(t, { ledger: {} });
  const v = line(f.against());
  assert.deepEqual(v.files.map((x) => x.result), ["no-claim", "no-claim"]);
  const f2 = fixture(t, { ledger: { evidence_persisted: [{ issue: ISSUE, ac_sha256: sha(AC_BODY) }] } });
  const v2 = line(f2.against());
  assert.deepEqual(v2.files.map((x) => x.result), ["match", "presence-disagreement"]);
  assert.deepEqual(v2.tampered_paths, [`${ISSUE}/${RV}`]);
});

test("the malformed family: bad JSON, legacy body, uppercase or short hex, null sha with present, extra key, other issue", (t) => {
  const f = fixture(t);
  const good = { issue: ISSUE, ac_checklist: digest(AC_BODY), review_verdict: digest(RV_BODY) };
  const variants = {
    "bad json": '{"issue":',
    "empty stdin": "",
    "not an object": "[]",
    "legacy body": JSON.stringify({ ...good, ac_checklist: { present: true, body: AC_BODY } }),
    "legacy body plus sha": JSON.stringify({ ...good, ac_checklist: { ...good.ac_checklist, body: AC_BODY } }),
    "uppercase hex": JSON.stringify({ ...good, ac_checklist: { present: true, sha256: sha(AC_BODY).toUpperCase() } }),
    "short hex": JSON.stringify({ ...good, ac_checklist: { present: true, sha256: sha(AC_BODY).slice(0, 63) } }),
    "present false with sha": JSON.stringify({ ...good, review_verdict: { present: false, sha256: sha(RV_BODY) } }),
    "present true with null": JSON.stringify({ ...good, review_verdict: { present: true, sha256: null } }),
    "non-boolean present": JSON.stringify({ ...good, review_verdict: { present: "yes", sha256: sha(RV_BODY) } }),
    "extra key": JSON.stringify({ ...good, extra: 1 }),
    "missing key": JSON.stringify({ issue: ISSUE, ac_checklist: good.ac_checklist }),
    "other issue": JSON.stringify({ ...good, issue: "ISSUE-2" }),
  };
  for (const [label, input] of Object.entries(variants)) {
    const r = f.verify(input);
    assert.equal(r.code, 1, label);
    const v = line(r);
    assert.equal(v.verdict, "malformed", label);
    assert.deepEqual(v.files, [], label);
    assert.equal(v.evidence_persisted, null, label);
    assert.equal(v.issue, ISSUE, label);
    assert.equal(v.park_cause, `evidence-return malformed — ${ISSUE}/EvidenceReturn (malformed return)`, label);
    assert.deepEqual(v.tampered_paths, [], label);
  }
});

test("verify-return exits 2 with nothing on stdout for a rejected path, bad issue id and missing flags", (t) => {
  const f = fixture(t);
  const cases = [
    f.verify(goodClaim(), [], f.root),
    f.verify(goodClaim(), [], f.runDir, "../ISSUE-1"),
    runCli(["evidence", "verify-return", "--issue", ISSUE], { cwd: f.root, input: goodClaim() }),
  ];
  for (const r of cases) {
    assert.equal(r.code, 2, r.stderr);
    assert.equal(r.stdout, "");
    assert.notEqual(r.stderr, "");
  }
});

test("--against-ledger agrees with the last evidence_persisted entry for the issue", (t) => {
  const ledger = { evidence_persisted: [
    { issue: ISSUE, ac_sha256: sha("stale") },
    { issue: "OTHER-9", ac_sha256: sha("other") },
    { issue: ISSUE, ac_sha256: sha(AC_BODY), review_verdict_sha256: sha(RV_BODY) },
  ] };
  const f = fixture(t, { ledger });
  const r = f.against();
  assert.equal(r.code, 0);
  assert.equal(line(r).verdict, "agree");
  assert.deepEqual(line(r).evidence_persisted, { issue: ISSUE, ac_sha256: sha(AC_BODY), review_verdict_sha256: sha(RV_BODY) });
});

test("--against-ledger catches a change after the ledger entry as hash-mismatch", (t) => {
  const f = fixture(t, { ledger: { evidence_persisted: [{ issue: ISSUE, ac_sha256: sha(AC_BODY), review_verdict_sha256: sha(RV_BODY) }] } });
  appendFileSync(join(f.issueDir, AC), "x");
  const r = f.against();
  assert.equal(r.code, 1);
  assert.equal(line(r).files[0].result, "hash-mismatch");
  assert.deepEqual(line(r).tampered_paths, [`${ISSUE}/${AC}`]);
});

test("--against-ledger with no entry and a file on disk is no-claim; with both absent it agrees", (t) => {
  const f = fixture(t, { ledger: { evidence_persisted: [{ issue: "OTHER-9", ac_sha256: sha("x") }] } });
  const r = f.against();
  assert.equal(r.code, 1);
  assert.equal(line(r).files[0].result, "no-claim");
  assert.deepEqual(line(r).tampered_paths, []);
  const empty = fixture(t, { files: {}, ledger: {} });
  const e = empty.against();
  assert.equal(e.code, 0);
  assert.equal(line(e).evidence_persisted, null);
});

test("--against-ledger exits 2 for a missing or unparseable ledger and does not read stdin", (t) => {
  const missing = fixture(t);
  const a = missing.against();
  assert.equal(a.code, 2);
  assert.equal(a.stdout, "");
  const broken = fixture(t, { ledger: "{not json" });
  const b = broken.against();
  assert.equal(b.code, 2);
  assert.equal(b.stdout, "");
  const ok = fixture(t, { ledger: { evidence_persisted: [{ issue: ISSUE, ac_sha256: sha(AC_BODY), review_verdict_sha256: sha(RV_BODY) }] } });
  assert.equal(ok.verify("garbage that is not read", ["--against-ledger"]).code, 0);
});

test("neither verb creates, modifies or deletes any file", (t) => {
  const f = fixture(t, { ledger: { evidence_persisted: [{ issue: ISSUE, ac_sha256: sha(AC_BODY), review_verdict_sha256: sha(RV_BODY) }] } });
  const before = snapshot(f.root);
  f.ret();
  f.verify(goodClaim());
  f.verify("null");
  f.verify("not json");
  f.against();
  appendFileSync(join(f.issueDir, AC), "x");
  const mid = snapshot(f.root);
  f.verify(goodClaim());
  f.against();
  assert.deepEqual(mid, snapshot(f.root));
  assert.deepEqual({ ...mid, [join(f.issueDir, AC)]: AC_BODY }, { ...before });
});

test("--against-ledger exits 2 on a malformed digest in the ledger entry, but an omitted digest is an absence claim", (t) => {
  const bad = fixture(t, { ledger: { evidence_persisted: [{ issue: ISSUE, ac_sha256: "NOT-HEX", review_verdict_sha256: sha(RV_BODY) }] } });
  const r = bad.against();
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  const omitted = fixture(t, { ledger: { evidence_persisted: [{ issue: ISSUE, review_verdict_sha256: sha(RV_BODY) }] } });
  const o = omitted.against();
  assert.equal(o.code, 1);
  assert.equal(line(o).files[0].result, "presence-disagreement");
});

test("return and verify-return refuse flags that belong to other evidence verbs", (t) => {
  const f = fixture(t);
  for (const flag of [["--park", "needs-human"], ["--prior-dir", f.root], ["--terminal-only"], ["--judge-admitted"]]) {
    const r = runCli(["evidence", "return", ...flag, "--run-dir", f.runDir, "--issue", ISSUE], { cwd: f.root });
    assert.equal(r.code, 2, `return ${flag[0]}`);
    assert.equal(r.stdout, "");
    const v = f.verify(goodClaim(), flag);
    assert.equal(v.code, 2, `verify-return ${flag[0]}`);
    assert.equal(v.stdout, "");
  }
});
