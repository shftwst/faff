// FAFF-224 — the `faff admissible` subcommand: the lights-out quality-IN gate.
// A pure, deterministic structural check over a spec's machine-verifiable DoD
// (## Scenarios + ### N. DONE). Gating R1/R2a/R2b + advisory R3; fail-safe
// inadmissible on doubt; no-op admissible when not lights-out. No LLM, no
// tracker/network — parity with `faff eligible` / `faff next`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
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

// --- FAFF-1291: the advisory now says prose DONE items are delegated, not forced to needs-human ---

test("FAFF-1291: the prose-DONE advisory names the AC checklist and the judged count, and no longer says forced to needs-human", () => {
  const r = run(["--lights-out", "--json"], PROSE_DONE);
  assert.equal(r.status, 0, r.stdout);
  const adv = advisoryOf(verdict(r));
  assert.match(adv, /^prose-DONE advisory: 3 DONE item\(s\)/);
  assert.match(adv, /AC checklist/);
  assert.match(adv, /judged count: 2/);
  assert.doesNotMatch(adv, /forced to needs-human/);
});

test("FAFF-1291: all-prose DONE with nothing judged adds a second advisory line; the exit code is unchanged", () => {
  const spec = [
    "## Scenarios", "",
    "```", "Given an integration case", "When the rollback runs", "Then the schema reverts", "```", "",
    "### 8. DONE", "",
    "- [ ] the dashboard feels fast to operators",
    "- [ ] operators like the onboarding flow",
  ].join("\n");
  const r = run(["--lights-out", "--json"], spec);
  assert.equal(r.status, 0, r.stdout);
  const v = verdict(r);
  const lines = v.warnings.filter((w) => w.startsWith("prose-DONE advisory:"));
  assert.equal(lines.length, 2);
  assert.match(lines[1], /nothing in DONE will be judged code-blind/);
});

// ---------------------------------------------------------------------------
// FAFF-1477: the lights-out gate refuses an untagged human-judgement DONE item (R2c), a spec whose DONE items
// are all tagged human-only (R2d) and a `needs-human:` marker with no reason (R2e).
// ---------------------------------------------------------------------------
const adm = require("../plugin/skills/faff/bin/lib/admissibility.js");

const SCENARIO = ["## Scenarios", "", "```", "Given a lights-out run and a concrete spec", "When the gate evaluates it", "Then the verdict is admissible", "```", ""];
const S0_DONE = ["exit code MUST be 0 admissible", "the verdict MUST list every failing check"];
const specWith = (items) => [...SCENARIO, "## 8. DONE", "", ...items.map((i) => `- [ ] ${i}`), ""].join("\n");
const s0Plus = (...extra) => specWith([...S0_DONE, ...extra]);
const check = (v, id) => v.checks.find((c) => c.id === id);
const lights = (spec) => { const r = run(["--lights-out", "--spec", "-", "--json"], spec); return { r, v: verdict(r) }; };

test("FAFF-1477: an untagged 'confirmed by eye' item is refused by R2c and the reason names the item and the tag", () => {
  const { r, v } = lights(s0Plus("the dashboard layout is confirmed by eye"));
  assert.equal(r.status, 1);
  assert.equal(v.admissible, false);
  assert.equal(check(v, "R2c.human-judgement-untagged").pass, false);
  const reason = v.reasons.find((x) => x.includes("human-judgement phrase"));
  assert.match(reason, /the dashboard layout is confirmed by eye/);
  assert.match(reason, /needs-human/);
});

test("FAFF-1477: the same item tagged needs-human: (with a leading [ac-N] id) is admitted, R2c to R2e all pass", () => {
  const { r, v } = lights(s0Plus("[ac-3] needs-human: the dashboard layout is confirmed by eye"));
  assert.equal(r.status, 0, r.stdout);
  assert.equal(v.admissible, true);
  for (const id of ["R2c.human-judgement-untagged", "R2d.not-all-human-only", "R2e.human-marker-reason"]) assert.equal(check(v, id).pass, true, id);
});

test("FAFF-1477: R2d refuses a spec whose DONE items are all tagged human-only; R2c and R2e still pass", () => {
  const { r, v } = lights(specWith(["needs-human: the copy reads naturally", "needs-human: the colours match the brand sheet"]));
  assert.equal(r.status, 1);
  assert.equal(check(v, "R2d.not-all-human-only").pass, false);
  assert.match(check(v, "R2d.not-all-human-only").detail, /no DONE item is left/);
  assert.equal(check(v, "R2c.human-judgement-untagged").pass, true);
  assert.equal(check(v, "R2e.human-marker-reason").pass, true);
});

test("FAFF-1477: R2e refuses a marker with no reason, and R2c does not also refuse it", () => {
  const { r, v } = lights(s0Plus("needs-human:   "));
  assert.equal(r.status, 1);
  assert.equal(check(v, "R2e.human-marker-reason").pass, false);
  assert.ok(v.reasons.some((x) => x.includes("with no reason")));
  assert.equal(check(v, "R2c.human-judgement-untagged").pass, true);
});

test("FAFF-1477: all-empty-reason markers fail R2e and pass R2d; giving them reasons then fails R2d", () => {
  const empties = lights(specWith(["needs-human:", "needs-human:   "]));
  assert.equal(check(empties.v, "R2e.human-marker-reason").pass, false);
  assert.equal(check(empties.v, "R2d.not-all-human-only").pass, true);
  const reasoned = lights(specWith(["needs-human: the copy reads naturally", "needs-human: the colours match the brand sheet"]));
  assert.equal(check(reasoned.v, "R2e.human-marker-reason").pass, true);
  assert.equal(check(reasoned.v, "R2d.not-all-human-only").pass, false);
});

test("FAFF-1477: a listed phrase inside an inline code span passes R2c", () => {
  const { v } = lights(s0Plus("the help text no longer uses the phrase `by eye` and exit code MUST be 0"));
  assert.equal(check(v, "R2c.human-judgement-untagged").pass, true);
});

test("FAFF-1477: bare nouns do not match; 'manual confirmation' does", () => {
  assert.equal(check(lights(s0Plus("the confirmation dialog closes", "the inspection log lists the failing check")).v, "R2c.human-judgement-untagged").pass, true);
  assert.equal(check(lights(s0Plus("manual confirmation of the layout")).v, "R2c.human-judgement-untagged").pass, false);
});

test("FAFF-1477: patterns 4 to 7 refuse untagged and pass once tagged", () => {
  for (const item of ["a person confirms the wording", "the page is visually checked", "the result looks right", "the copy is a subjective call"]) {
    assert.equal(check(lights(s0Plus(item)).v, "R2c.human-judgement-untagged").pass, false, item);
    assert.equal(check(lights(s0Plus(`needs-human: ${item}`)).v, "R2c.human-judgement-untagged").pass, true, item);
  }
});

test("FAFF-1477: the phrases match case-insensitively and the detail joins items with ' | '", () => {
  const { v } = lights(s0Plus("Confirmed by eye", "Manually verified"));
  const c = check(v, "R2c.human-judgement-untagged");
  assert.equal(c.pass, false);
  assert.match(c.detail, /Confirmed by eye \| Manually verified/);
});

test("FAFF-1477: an item over 50 characters is cut to 50 in the R2c detail", () => {
  const long = "the quarterly summary page layout is acceptable to the reader and confirmed by eye";
  const { v } = lights(s0Plus(long, "manual verification of the second page"));
  const detail = check(v, "R2c.human-judgement-untagged").detail;
  const cut = long.slice(0, 50).trim();
  assert.ok(detail.includes(`${cut} | manual verification`), detail);
  assert.ok(!detail.includes(long.slice(0, 55)), detail);
});

test("FAFF-1477: a spec with no DONE section fails R2a only; R2d and R2e pass", () => {
  const { v } = lights(SCENARIO.join("\n"));
  assert.equal(check(v, "R2a.done-present").pass, false);
  assert.equal(check(v, "R2d.not-all-human-only").pass, true);
  assert.equal(check(v, "R2e.human-marker-reason").pass, true);
});

test("FAFF-1477: the passing details are the pinned strings", () => {
  const v = lights(s0Plus()).v;
  assert.equal(check(v, "R2c.human-judgement-untagged").detail, "0 untagged human-judgement DONE item(s)");
  assert.equal(check(v, "R2d.not-all-human-only").detail, "2 DONE item(s) not tagged human-only (need at least 1)");
  assert.equal(check(v, "R2e.human-marker-reason").detail, "0 DONE item(s) begin needs-human: with no reason");
});

test("FAFF-1477: the new checks follow R2b in order and a failing check adds its detail to reasons", () => {
  const { v } = lights(s0Plus("needs-human:", "confirmed by eye"));
  const ids = v.checks.map((c) => c.id);
  assert.deepEqual(ids.slice(ids.indexOf("R2b.done-concrete")), ["R2b.done-concrete", "R2c.human-judgement-untagged", "R2d.not-all-human-only", "R2e.human-marker-reason"]);
  assert.equal(v.reasons.length, v.checks.filter((c) => !c.pass).length);
});

test("FAFF-1477: without --lights-out a tagged item changes nothing: one scope check and no warnings", () => {
  const r = run(["--spec", "-", "--json"], s0Plus("needs-human: the dashboard layout is confirmed by eye"));
  const v = verdict(r);
  assert.equal(r.status, 0);
  assert.deepEqual(v.checks.map((c) => c.id), ["scope"]);
  assert.deepEqual(v.warnings, []);
});

test("FAFF-1477: the withheld scenario: two untagged and two tagged prose items name only the untagged in the advisory", () => {
  const { v } = lights(s0Plus("the footer text is suitable", "the sidebar wording is suitable", "needs-human: the page looks fine to the designer", "needs-human: the empty state tone is judged by the product owner"));
  const lines = v.warnings.filter((w) => w.startsWith("prose-DONE advisory: 2 DONE item(s)"));
  assert.equal(lines.length, 1, JSON.stringify(v.warnings));
  assert.match(lines[0], /footer/);
  assert.match(lines[0], /sidebar/);
  assert.doesNotMatch(lines[0], /designer|product owner/);
});

test("FAFF-1477: a spec with one untagged and one tagged prose item never gets the all-prose line", () => {
  const adv = adm.proseDoneAdvisory(specWith(["the footer text is suitable", "needs-human: the page looks fine to the designer"]));
  assert.equal(adv.count, 1);
  assert.equal(adv.allProseDone, false);
});

test("FAFF-1477: the new checks add no stderr of their own", () => {
  const r = run(["--lights-out", "--spec", "-", "--json"], s0Plus("the dashboard layout is confirmed by eye", "needs-human: the copy reads naturally"));
  assert.equal(r.stderr, "");
});

test("FAFF-1477: the admissibleVerdict body reads ids through parseLocalAcId and never assignLocalAcIds", () => {
  const src = readFileSync(join(REPO, "plugin", "skills", "faff", "bin", "lib", "admissibility.js"), "utf8");
  const body = src.slice(src.indexOf("function admissibleVerdict("), src.indexOf("// Verdict-table selftest"));
  assert.ok(body.includes("parseLocalAcId"));
  assert.ok(!body.includes("assignLocalAcIds"));
});

test("FAFF-1477: the needs-human marker pattern is written once in admissibility.js", () => {
  const src = readFileSync(join(REPO, "plugin", "skills", "faff", "bin", "lib", "admissibility.js"), "utf8");
  assert.equal(src.split("needs-human:[ \\t]*").length - 1, 1);
});

test("FAFF-1477: the verdict treats as tagged exactly the items dodClassify marks human_only", () => {
  const items = ["needs-human: a reason", "needs-human:", "needs-human:    ", "NEEDS-HUMAN: upper case marker", "[ac-4] needs-human: after an id", "[AC-5] needs-human: near-miss id", "an ordinary item MUST pass"];
  const spec = specWith(items);
  const classified = adm.dodClassify(spec).criteria.filter((c) => c.source === "done").map((c) => c.human_only);
  const texts = adm.parseDoneChecklist(spec).map((t) => require("../plugin/skills/faff/bin/lib/ac-id.js").parseLocalAcId(t).text);
  assert.deepEqual(texts.map((t) => adm.parseHumanMarker(t).human_only), classified);
  assert.deepEqual(classified, [true, false, false, true, true, false, false]);
});

test("FAFF-1477: HUMAN_JUDGEMENT holds the seven patterns of the spec", () => {
  assert.deepEqual(adm.HUMAN_JUDGEMENT.map((re) => re.source), [
    "\\bby\\s+eye\\b",
    "\\bmanually\\s+(?:verif(?:y|ied|ies)|confirm(?:s|ed)?|inspect(?:s|ed)?)\\b",
    "\\bmanual\\s+(?:verification|confirmation|inspection)\\b",
    "\\ba\\s+(?:person|human)\\s+(?:confirms|checks|verifies|inspects|signs\\s+off)\\b",
    "\\bvisually\\s+(?:inspect|confirm|check|verif|review)\\w*",
    "\\blooks\\s+right\\b",
    "\\bsubjective(?:ly)?\\s+(?:judg(?:e)?ment|call|assessment|review)\\b",
  ]);
  assert.ok(adm.HUMAN_JUDGEMENT.every((re) => re.flags === "i"));
});

// Corpus pin. A new match here means: tag the item, or change HUMAN_JUDGEMENT and this list in one reviewed diff.
// No total spec count is asserted, since the corpus grows. The first four are shipped specs whose items are
// genuine operator judgements; the fifth is FAFF-1477's own design, which quotes the listed phrases as examples.
const CORPUS_R2C_PIN = [
  "2026-07-26-FAFF-654-the-probe-and-what-a-github-hosted-actions-job-exposes-design.md",
  "2026-08-02-FAFF-657-take-the-two-github-hosted-readings-design.md",
  "2026-10-10-FAFF-1211-authenticate-callers-on-commissaire-governor-socket-design.md",
  "2026-10-26-faff-1403-fix-hyphenated-max-tokens-key-spelling-design.md",
  "2026-11-16-FAFF-1477-the-lights-out-admissibility-gate-refuses-an-untagged-human-judgement-done-item-and-a-spec-whose-items-are-all-needs-human-design.md",
];

test("FAFF-1477: over every committed spec the R2c refusals are exactly the pinned set, and R2d and R2e refuse none", () => {
  const dir = join(REPO, "records", "specs");
  const refused = [];
  const otherRefusals = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const failing = adm.admissibleVerdict(readFileSync(join(dir, f), "utf8"), true).checks.filter((c) => !c.pass).map((c) => c.id);
    if (failing.includes("R2c.human-judgement-untagged")) {
      refused.push(f);
      assert.deepEqual(failing, ["R2c.human-judgement-untagged"], f);
    }
    if (failing.some((id) => /^R2[de]/.test(id))) otherRefusals.push(f);
  }
  assert.deepEqual(otherRefusals, []);
  assert.deepEqual(refused, CORPUS_R2C_PIN);
});

test("author diagnostics deduplicate overlapping Scenarios findings without changing the gate", () => {
  const spec = [
    "## Scenarios",
    "```holdout",
    "Given test/health.test.mjs",
    "When exercising the route",
    "```",
    "## DONE",
    "- [ ] the route returns HTTP 200",
  ].join("\n");
  const author = run(["--author-diagnostics", "--spec", "-"], spec);
  assert.equal(author.status, 0, author.stderr);
  assert.deepEqual(verdict(author), {
    major: [{ prose: ["scenarios:1"], test_file: ["scenarios:1"] }], notes: [],
  });
  const gate = run(["--lights-out", "--spec", "-", "--json"], spec);
  assert.equal(gate.status, 0, gate.stdout);
  assert.ok(verdict(gate).warnings.some(line => line.startsWith("scenarios-prose advisory:")));
  assert.ok(verdict(gate).warnings.some(line => line.startsWith("scenarios-code-surface advisory:")));
});

test("author distinguishes R1 with a Scenarios unit from a legitimately absent section", () => {
  const spec = "## Scenarios\n\nOnly narrative.\n\n## DONE\n- [ ] HTTP 200 is returned";
  const author = run(["--author-diagnostics"], spec);
  assert.equal(author.status, 0, author.stderr);
  assert.deepEqual(verdict(author), { major: [{ r1: ["scenarios:1"], prose: ["scenarios:1"] }], notes: [] });
  const empty = run(["--author-diagnostics"], "## DONE\n- [ ] HTTP 200 is returned");
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(verdict(empty), { major: [], notes: ["R1.scenarios: no Scenarios units"] });
  assert.equal(run(["--lights-out", "--json"], spec).status, 1);
  assert.equal(run(["--lights-out", "--json"], "## DONE\n- [ ] HTTP 200 is returned").status, 1);
  const ambiguous = run(["--author-diagnostics", "--lights-out"], spec);
  assert.equal(ambiguous.status, 2);
  assert.equal(ambiguous.stdout, "");
});

test("author diagnostics retain disjoint findings and leave a clean draft clear", () => {
  const spec = [
    "## Scenarios",
    "```",
    "Given the route exists",
    "When exercising it",
    "```",
    "```",
    "Given the route exists",
    "When exercising it again",
    "Then test/route.test.mjs MUST pass",
    "```",
    "## DONE",
    "- [ ] the route returns HTTP 200",
  ].join("\n");
  const author = run(["--author-diagnostics"], spec);
  assert.equal(author.status, 0, author.stderr);
  assert.deepEqual(verdict(author), {
    major: [{ prose: ["scenarios:1"] }, { test_file: ["scenarios:2"] }], notes: [],
  });
  const good = run(["--author-diagnostics"], GOOD);
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(verdict(good), { major: [], notes: [] });
});

test("author reports the same DONE human-marker failures as the actual lights-out gate", () => {
  for (const spec of [
    s0Plus("manual confirmation of the layout", "needs-human:"),
    specWith(["needs-human: manual inspection of keyboard order"]),
  ]) {
    const gate = run(["--lights-out", "--json"], spec);
    assert.equal(gate.status, 1, gate.stdout);
    const author = run(["--author-diagnostics"], spec);
    assert.equal(author.status, 0, author.stderr);
    const failing = verdict(gate).checks.filter(({ id, pass }) => !pass && /^R2[cde]\./.test(id));
    assert.ok(failing.length > 0);
    assert.deepEqual(verdict(author).major, failing.map(({ id, detail }) => ({ done_check: id, detail })));
  }
});
