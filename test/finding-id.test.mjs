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
