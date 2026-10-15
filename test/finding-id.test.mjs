// FAFF-1266 — finding identity: the path and title normalisers, findingId, assignFindingIds and the
// dialogue readers' readerFindingIds accessor (plugin/skills/faff/bin/lib/finding-id.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fid = require("../plugin/skills/faff/bin/lib/finding-id.js");

test("normaliseFindingPath: strips ./, a/ and b/ prefixes, backslashes and line suffixes", () => {
  const n = fid.normaliseFindingPath;
  assert.equal(n("./src/x.js"), "src/x.js");
  assert.equal(n("a/src/x.js"), "src/x.js");
  assert.equal(n("b/src/x.js"), "src/x.js");
  assert.equal(n("./b/src/x.js"), "src/x.js");
  assert.equal(n("src\\lib\\x.js"), "src/lib/x.js");
  assert.equal(n("src/x.js:12"), "src/x.js");
  assert.equal(n("src/x.js:12-20"), "src/x.js");
  assert.equal(n("src/x.js:12:5"), "src/x.js");
});

test("normaliseFindingPath: keeps the text before the first whitespace; blank or non-string is empty", () => {
  const n = fid.normaliseFindingPath;
  assert.equal(n("  src/x.js:3 (the loop)"), "src/x.js");
  assert.equal(n("src/x.js\tline 3"), "src/x.js");
  assert.equal(n(""), "");
  assert.equal(n("   "), "");
  assert.equal(n(undefined), "");
  assert.equal(n(42), "");
});

test("normaliseFindingPath: a colon not followed by a digit is kept", () => {
  assert.equal(fid.normaliseFindingPath("C:/repo/x.js"), "C:/repo/x.js");
});

test("normaliseFindingTitle: control characters, backticks, case, whitespace and trailing punctuation", () => {
  const n = fid.normaliseFindingTitle;
  assert.equal(n("Leaks\u0000fd\u0085now"), "leaks fd now");
  assert.equal(n("Missing `null` check"), "missing null check");
  assert.equal(n("  LEAKS   \t FD  "), "leaks fd");
  assert.equal(n("Leaks fd."), "leaks fd");
  assert.equal(n("Leaks fd:"), "leaks fd");
  assert.equal(n("Leaks fd ;"), "leaks fd");
  assert.equal(n(undefined), "");
  assert.equal(n(7), "");
});

test("findingId: file::title, nolocation::title, and the round-scoped fallback", () => {
  assert.equal(fid.findingId({ location: "./a.js:3", title: "Leaks fd." }, 1, 0), "a.js::leaks fd");
  assert.equal(fid.findingId({ title: "Leaks fd" }, 1, 0), "nolocation::leaks fd");
  assert.equal(fid.findingId({ location: "a.js:3" }, 4, 2), "round-4#2");
  assert.equal(fid.findingId({ title: "  " }, 4, 2), "round-4#2");
  assert.equal(fid.findingId(null, 1, 0), "round-1#0");
});

test("assignFindingIds: scenario — same-round duplicates get #2, an untitled finding gets round-<n>#<index>", () => {
  const ids = fid.assignFindingIds([
    { location: "b/src/x.js:3", title: "Leaks fd" },
    { location: "src/x.js:40", title: "leaks  FD" },
    { title: "" },
  ], 2);
  assert.deepEqual(ids, ["src/x.js::leaks fd", "src/x.js::leaks fd#2", "round-2#2"]);
});

test("assignFindingIds: #2 and #3 in input order; non-array is empty", () => {
  const f = { location: "a.js", title: "T" };
  assert.deepEqual(fid.assignFindingIds([f, f, f], 1), ["a.js::t", "a.js::t#2", "a.js::t#3"]);
  assert.deepEqual(fid.assignFindingIds(undefined, 1), []);
});

test("readerFindingIds: computed id wins over a stored id when a title exists", () => {
  const [x] = fid.readerFindingIds([{ location: "a.js:1", title: "T", finding_id: "wrong" }], 1);
  assert.deepEqual(x, { id: "a.js::t", stored: "wrong" });
});

test("readerFindingIds: no title falls back to the stored id, then to round-<n>#<i>", () => {
  const out = fid.readerFindingIds([{ finding_id: "a.js::x" }, {}, { finding_id: "" }], 3);
  assert.deepEqual(out, [
    { id: "a.js::x", stored: "a.js::x" },
    { id: "round-3#1", stored: null },
    { id: "round-3#2", stored: null },
  ]);
});

test("readerFindingIds: same-round computed ids are suffixed; a repeated stored id is one finding", () => {
  const t = { location: "a.js", title: "T" };
  assert.deepEqual(fid.readerFindingIds([t, t], 1).map((x) => x.id), ["a.js::t", "a.js::t#2"]);
  assert.deepEqual(fid.readerFindingIds([{ finding_id: "k" }, { finding_id: "k" }], 1).map((x) => x.id), ["k", "k"]);
});

test("readerFindingIds: tolerates non-array input and non-object entries", () => {
  assert.deepEqual(fid.readerFindingIds(undefined, 1), []);
  assert.deepEqual(fid.readerFindingIds([null, "x"], 2).map((x) => x.id), ["round-2#0", "round-2#1"]);
});

test("--selftest style fixture list passes", () => {
  assert.equal(fid.findingIdSelftest(), 0);
});

// FAFF-1276 — carried ids: resolveCarriedIds and resolveRoundChain.
const churn = require("../plugin/skills/faff/bin/lib/build-review-churn.js");
const conv = require("../plugin/skills/faff/bin/lib/build-review-convergence.js");

const r1 = (findings) => ({ round: 1, findings });
const r2 = (findings) => ({ round: 2, findings });
const chainIds = (rounds) => fid.resolveRoundChain(rounds).map((entries) => entries.map((e) => e.id));
const last = (rounds) => fid.resolveRoundChain(rounds).at(-1);

test("resolveCarriedIds: with no carried_id every id equals readerFindingIds (property over the existing fixtures)", () => {
  const lists = [
    ...fid.FINDING_ID_CASES.map(([, findings, round]) => [findings, round]),
    ...churn.BUILD_REVIEW_CHURN_CASES.flatMap(([, prev, curr]) => [prev, curr].filter(Boolean).map((r) => [r.findings, 2])),
    ...conv.BUILD_REVIEW_CONVERGENCE_CASES.flatMap(([, rounds]) => rounds.map((r, i) => [r.findings, i + 1])),
    [[{ finding_id: "hand-derived", severity: "critical", location: "a.js:1", title: "Leaks fd" }, { severity: "critical" }, { finding_id: "x" }, { finding_id: "x" }], 3],
  ];
  const prior = [{ id: "a.js::leaks fd", file: "a.js" }];
  for (const [findings, round] of lists) {
    const want = fid.readerFindingIds(findings, round);
    for (const p of [null, prior]) {
      const got = fid.resolveCarriedIds(findings, round, p);
      assert.deepEqual(got.map((e) => ({ id: e.id, stored: e.stored })), want);
      assert.ok(got.every((e) => e.carry === null && e.refusal === null));
    }
  }
});

test("resolveRoundChain: scenario — a carry keeps the round-1 id across a reworded title", () => {
  const rounds = [
    r1([{ location: "lib/page.js:12", title: "pagecount truncates partial last page with math.floor" }]),
    r2([{ location: "lib/page.js:15", title: "pagecount rounds down a partial last page", carried_id: "P1" }]),
  ];
  const want = "lib/page.js::pagecount truncates partial last page with math.floor";
  assert.deepEqual(chainIds(rounds), [[want], [want]]);
  assert.equal(last(rounds)[0].carry, "accepted");
});

test("resolveRoundChain: scenario — a carry into another file is refused file-differs", () => {
  const got = last([r1([{ location: "lib/page.js:12", title: "t" }]), r2([{ location: "lib/other.js:3", title: "u", carried_id: "P1" }])]);
  assert.deepEqual(got, [{ id: "lib/other.js::u", stored: null, carry: "refused", refusal: "file-differs" }]);
});

test("resolveCarriedIds: every refusal reason", () => {
  const prior = [{ id: "a.js::x", file: "a.js" }, { id: "round-1#1", file: "a.js" }, { id: "nolocation::y", file: "" }];
  const refusal = (f, p = prior, extra = []) => fid.resolveCarriedIds([...extra, f], 2, p).at(-1);
  assert.equal(refusal({ location: "a.js:1", title: "z", carried_id: "P1" }, null).refusal, "no-prior-round");
  assert.equal(refusal({ location: "a.js:1", title: "z", carried_id: "P4" }).refusal, "not-in-prior-round");
  assert.equal(refusal({ location: "a.js:1", title: "z", carried_id: "P0" }).refusal, "not-in-prior-round");
  assert.equal(refusal({ location: "a.js:1", title: "z", carried_id: "a.js::x" }).refusal, "not-in-prior-round");
  assert.equal(refusal({ location: "a.js:1", title: "z", carried_id: "P2" }).refusal, "fallback-id");
  assert.equal(refusal({ location: "a.js:1", title: "z", carried_id: "P3" }).refusal, "no-file");
  assert.equal(refusal({ location: "b.js:1", title: "z", carried_id: "P1" }).refusal, "file-differs");
  const twice = refusal({ location: "a.js:9", title: "w", carried_id: "P1" }, prior, [{ location: "a.js:1", title: "z", carried_id: "P1" }]);
  assert.deepEqual(twice, { id: "a.js::w", stored: null, carry: "refused", refusal: "claimed-twice" });
  const storedClash = refusal({ location: "a.js:1", title: "z", carried_id: "P1" }, prior, [{ finding_id: "a.js::x" }]);
  assert.equal(storedClash.refusal, "claimed-twice");
  assert.equal(storedClash.id, "a.js::z");
});

test("resolveCarriedIds: a non-handle carried_id gets the computed id; a blank one is no carry", () => {
  const got = fid.resolveCarriedIds([{ location: "a.js:1", title: "Z", carried_id: "a.js::x" }, { location: "a.js:2", title: "Q", carried_id: "  " }], 2, [{ id: "a.js::x", file: "a.js" }]);
  assert.deepEqual(got.map((e) => [e.id, e.carry]), [["a.js::z", "refused"], ["a.js::q", null]]);
});

test("resolveCarriedIds: a handle whose prior id has a #2 suffix carries the suffixed id", () => {
  const rounds = [r1([{ location: "a.js:1", title: "dup" }, { location: "a.js:2", title: "dup" }]), r2([{ location: "a.js:3", title: "reworded", carried_id: "P2" }])];
  assert.deepEqual(chainIds(rounds), [["a.js::dup", "a.js::dup#2"], ["a.js::dup#2"]]);
});

test("resolveCarriedIds: a computed id equal to a carried id is suffixed, wherever it sits", () => {
  const prior = [{ id: "a.js::x", file: "a.js" }];
  const got = fid.resolveCarriedIds([{ location: "a.js:1", title: "x" }, { location: "a.js:5", title: "other words", carried_id: "P1" }, { location: "a.js:9", title: "X." }], 2, prior);
  assert.deepEqual(got.map((e) => e.id), ["a.js::x#2", "a.js::x", "a.js::x#3"]);
});

test("resolveRoundChain: round 3 carries round 2's carried id back to round 1", () => {
  const rounds = [
    r1([{ location: "a.js:1", title: "leaks fd" }]),
    r2([{ location: "a.js:4", title: "fd never closed", carried_id: "P1" }]),
    { round: 3, findings: [{ location: "a.js:7", title: "descriptor left open", carried_id: "P1" }] },
  ];
  assert.deepEqual(chainIds(rounds), [["a.js::leaks fd"], ["a.js::leaks fd"], ["a.js::leaks fd"]]);
});

test("resolveRoundChain: a carry in round 1 is refused no-prior-round; a carry onto an id-less prior finding is refused fallback-id", () => {
  assert.equal(last([r1([{ location: "a.js:1", title: "t", carried_id: "P1" }])])[0].refusal, "no-prior-round");
  assert.equal(last([r1([{ location: "a.js:1" }]), r2([{ location: "a.js:1", title: "t", carried_id: "P1" }])])[0].refusal, "fallback-id");
});

test("resolveRoundChain: tolerates non-array rounds and findings", () => {
  assert.deepEqual(fid.resolveRoundChain(undefined), []);
  assert.deepEqual(fid.resolveRoundChain([{ round: 1 }, null]), [[], []]);
});
