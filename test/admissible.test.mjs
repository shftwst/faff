// FAFF-224 — the `faff admissible` subcommand: the lights-out quality-IN gate.
// A pure, deterministic structural check over a spec's machine-verifiable DoD
// (## Scenarios + ### N. DONE). Gating R1/R2a/R2b + advisory R3; fail-safe
// inadmissible on doubt; no-op admissible when not lights-out. No LLM, no
// tracker/network — parity with `faff eligible` / `faff next`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

// run with the spec piped on stdin (mirrors the graft call-site, which has no file yet)
const run = (args, stdin = "") =>
  spawnSync(process.execPath, [BIN, "admissible", ...args], { cwd: REPO, encoding: "utf8", input: stdin });

const verdict = (r) => JSON.parse(r.stdout);

// A minimal admissible spec: one GWT scenario + a concrete born-verifiable DONE
// checklist (assertions — so the FAFF-304 prose-DONE advisory does NOT fire) + a
// runnable check.
const GOOD = [
  "## Scenarios", "",
  "```", "Given a lights-out run and a concrete spec", "When the gate evaluates it", "Then the verdict is admissible", "```", "",
  "## 8. DONE", "",
  "- [ ] `faff admissible` MUST emit the verdict JSON with admissible/reasons/checks/warnings", "- [ ] exit code MUST be 0 admissible / 1 inadmissible / 2 usage", "",
  "**Integration smoke test.**", "```", "faff admissible --selftest", "```", "",
].join("\n");

test("--selftest verdict table passes (exit 0)", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
  // every spec'd branch is named in the table
  for (const name of ["admissible", "R1-fail", "R2a-fail", "R2b-fail", "R3-advisory-warn", "unparseable-failsafe", "scope-inactive"]) {
    assert.match(r.stdout, new RegExp(name));
  }
});

test("admissible: GWT + concrete DONE + runnable check → exit 0, admissible, no warnings", () => {
  const r = run(["--lights-out", "--json"], GOOD);
  assert.equal(r.status, 0, r.stdout);
  const v = verdict(r);
  assert.equal(v.admissible, true);
  assert.deepEqual(v.reasons, []);
  assert.equal(v.warnings.length, 0);
  assert.ok(v.checks.every((c) => c.pass));
});

test("R1-fail: no ## Scenarios section → exit 1, inadmissible, reason cites R1", () => {
  const bad = GOOD.replace(/## Scenarios[\s\S]*?(?=## 8\. DONE)/, "");
  const r = run(["--lights-out", "--json"], bad);
  assert.equal(r.status, 1);
  const v = verdict(r);
  assert.equal(v.admissible, false);
  assert.ok(v.reasons.some((x) => /scenario/i.test(x)));
  assert.ok(v.checks.find((c) => c.id === "R1.scenarios" && c.pass === false));
});

test("R2a-fail: empty DONE checklist → exit 1, inadmissible, reason cites DONE checklist", () => {
  const bad = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\nno items here\n";
  const r = run(["--lights-out", "--json"], bad);
  assert.equal(r.status, 1);
  const v = verdict(r);
  assert.equal(v.admissible, false);
  assert.ok(v.reasons.some((x) => /DONE checklist/i.test(x)));
});

test("R2b-fail: a vague DONE item ('works correctly') → exit 1, inadmissible, reason cites vague DONE", () => {
  const bad = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the feature works correctly\n";
  const r = run(["--lights-out", "--json"], bad);
  assert.equal(r.status, 1);
  const v = verdict(r);
  assert.equal(v.admissible, false);
  assert.ok(v.reasons.some((x) => /vague DONE/i.test(x)));
});

test("R3-advisory: passes R1+R2 but no runnable check → exit 0, admissible, one warning (never gates)", () => {
  const warn = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the parser MUST return at least one item\n";
  const r = run(["--lights-out", "--json"], warn);
  assert.equal(r.status, 0);
  const v = verdict(r);
  assert.equal(v.admissible, true);
  assert.equal(v.warnings.length, 1);
  assert.match(v.warnings[0], /R3/);
});

test("DONE matched by name: works for both '### 4. DONE' (lite) and '## 8. DONE' (nlspec)", () => {
  const lite = "## Scenarios\n```\nGiven x\nThen y\n```\n\n### 4. DONE\n\n- [ ] a concrete done item that is checkable\n\n```verify\necho ok\n```\n";
  const r = run(["--lights-out", "--json"], lite);
  assert.equal(r.status, 0, r.stdout);
  const v = verdict(r);
  assert.equal(v.admissible, true);
  assert.ok(v.checks.find((c) => c.id === "R2a.done-present" && c.pass === true));
});

test("fail-safe: an empty/unparseable spec under lights-out → exit 1, inadmissible (not a crash)", () => {
  const r = run(["--lights-out", "--json"], "");
  assert.equal(r.status, 1);
  const v = verdict(r);
  assert.equal(v.admissible, false);
  assert.ok(v.reasons.length >= 1);
});

test("scope no-op: no --lights-out → exit 0, admissible, single scope:pass check, no warnings", () => {
  const r = run(["--json"], "garbage with no structure at all");
  assert.equal(r.status, 0);
  const v = verdict(r);
  assert.equal(v.admissible, true);
  assert.equal(v.checks.length, 1);
  assert.equal(v.checks[0].id, "scope");
  assert.equal(v.warnings.length, 0);
});

test("invariant: reasons non-empty IFF admissible == false", () => {
  for (const [spec, lights] of [[GOOD, true], ["", true], ["", false]]) {
    const r = run(lights ? ["--lights-out", "--json"] : ["--json"], spec);
    const v = verdict(r);
    assert.equal(v.reasons.length > 0, v.admissible === false);
  }
});

test("usage error: an unreadable --spec path → exit 2", () => {
  const r = run(["--spec", "/no/such/spec/path", "--lights-out"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read spec/);
});

test("zero tracker/network: GOOD spec on stdin produces a verdict with no MCP (pure)", () => {
  // a smoke proxy for purity — the command runs to completion with only stdin, no env/tracker.
  const r = run(["--lights-out"], GOOD);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /"admissible": true/);
});

// --- FAFF-304: prose-DONE punt-prediction advisory (additive warning, never gates) ---

// A spec with born-verifiable scenarios + 3 prose DONE items that DO restate the
// scenario outcomes — the observed P1 link-shortener case.
const PROSE_DONE = [
  "## Scenarios", "",
  "```", "Given a user submits a shortened link request", "When the server stores the mapping", "Then the api returns the short code", "```", "",
  "- The redirect latency MUST be < 50ms",
  "", "### 8. DONE", "",
  "- [ ] the server stores the mapping for a shortened link request",
  "- [ ] the api returns the short code to the user",
  "- [ ] the redirect latency stays low for operators",
].join("\n");

const advisoryOf = (v) => v.warnings.find((w) => w.startsWith("prose-DONE advisory:"));

test("FAFF-304: prose DONE items → admissible true AND a 'prose-DONE advisory:' warning naming the count", () => {
  const r = run(["--lights-out", "--json"], PROSE_DONE);
  assert.equal(r.status, 0, r.stdout);          // gate is UNTOUCHED — still exit 0 admissible
  const v = verdict(r);
  assert.equal(v.admissible, true);
  const adv = advisoryOf(v);
  assert.ok(adv, "expected a prose-DONE advisory warning");
  assert.match(adv, /^prose-DONE advisory: 3 DONE item\(s\)/);
});

test("FAFF-304: the advisory count equals dodClassify's source:done, class:prose criteria (no forked classifier)", () => {
  const r = run(["--lights-out", "--json"], PROSE_DONE);
  const adv = advisoryOf(verdict(r));
  const m = adv.match(/^prose-DONE advisory: (\d+) DONE item/);
  assert.ok(m);
  const dod = spawnSync(process.execPath, [BIN, "dod", "classify", "--json"], { cwd: REPO, encoding: "utf8", input: PROSE_DONE });
  const proseDone = JSON.parse(dod.stdout).criteria.filter((c) => c.source === "done" && c.class === "prose").length;
  assert.equal(Number(m[1]), proseDone);
});

test("FAFF-304: prose DONE items that restate a scenario are named as 'candidates to remove'", () => {
  const r = run(["--lights-out", "--json"], PROSE_DONE);
  const adv = advisoryOf(verdict(r));
  // 2 of the 3 restate the GWT scenario; the third (latency stays low) does not.
  assert.match(adv, /2 appear to restate a born-verifiable scenario — candidates to remove:/);
});

test("FAFF-304: an all born-verifiable DONE checklist produces NO prose-DONE advisory", () => {
  const r = run(["--lights-out", "--json"], GOOD);
  const v = verdict(r);
  assert.equal(v.admissible, true);
  assert.equal(advisoryOf(v), undefined);
});

test("FAFF-304: when no prose DONE item restates a scenario, the duplicate clause is omitted", () => {
  const noDup = [
    "## Scenarios", "",
    "```", "Given a request to /healthz", "When the server is running", "Then it responds 200", "```", "",
    "## 8. DONE", "",
    "- [ ] The dashboard surfaces deployment status to operators",
    "- [ ] Operators can filter the audit log by actor",
  ].join("\n");
  const r = run(["--lights-out", "--json"], noDup);
  const adv = advisoryOf(verdict(r));
  assert.match(adv, /^prose-DONE advisory: 2 DONE item\(s\)/);
  assert.doesNotMatch(adv, /candidates to remove/);
});

test("FAFF-304: the advisory never fires without --lights-out (scope-inactive)", () => {
  const r = run(["--json"], PROSE_DONE);   // no --lights-out
  const v = verdict(r);
  assert.equal(v.admissible, true);
  assert.equal(v.warnings.length, 0);
  assert.equal(advisoryOf(v), undefined);
});

test("FAFF-304: the advisory never flips admissible — a prose+vague DONE is still inadmissible (R2b), advisory rides alongside", () => {
  const proseVague = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the feature works correctly for the user\n";
  const r = run(["--lights-out", "--json"], proseVague);
  assert.equal(r.status, 1);                 // R2b still gates — inadmissible
  const v = verdict(r);
  assert.equal(v.admissible, false);
  assert.ok(v.reasons.some((x) => /vague DONE/i.test(x)));
  assert.ok(advisoryOf(v), "advisory and R2b are independent signals — both present");
});
