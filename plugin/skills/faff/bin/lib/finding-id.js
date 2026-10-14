// ===========================================================================
// === region:governance — finding-id — FAFF-1266: one code home for a code-review finding's identity ===
// A finding's cross-round identity is `<file>::<normalised title>`. The reviewers emit `title`
// and `location` per finding; this module turns them into the id the build-review dialogue
// readers (`build-review-churn.js`, `build-judge-evidence.js`, `build-judge-casefile.js`) and the
// later code-review collator compare on. Pure, requires nothing. The model never emits the id.
// ===========================================================================

"use strict";

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function normaliseFindingPath(location) {
  if (typeof location !== "string" || !location.trim()) return "";
  let p = location.trim().split(/\s/)[0];
  p = p.replace(/\\/g, "/");
  if (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("a/") || p.startsWith("b/")) p = p.slice(2);
  const cut = p.search(/:\d/);
  return cut === -1 ? p : p.slice(0, cut);
}

function normaliseFindingTitle(title) {
  if (typeof title !== "string") return "";
  const t = title
    .replace(CONTROL_CHARS, " ")
    .replace(/`/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return t.replace(/[.:;]+$/, "").trimEnd();
}

function roundScopedId(round, index) {
  return `round-${round}#${index}`;
}

function findingId(finding, round, index) {
  const f = finding && typeof finding === "object" ? finding : {};
  const file = normaliseFindingPath(f.location);
  const title = normaliseFindingTitle(f.title);
  if (title && file) return `${file}::${title}`;
  if (title) return `nolocation::${title}`;
  return roundScopedId(round, index);
}

function suffixDuplicates(ids, suffixable = () => true) {
  const seen = new Map();
  return ids.map((id, i) => {
    if (!suffixable(i)) return id;
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}#${n}`;
  });
}

function assignFindingIds(findings, round) {
  const list = Array.isArray(findings) ? findings : [];
  return suffixDuplicates(list.map((f, i) => findingId(f, round, i)));
}

function storedFindingId(f) {
  return f && typeof f.finding_id === "string" && f.finding_id ? f.finding_id : null;
}

// A stored id with no title is a reviewer or agent's own identity for the finding, so a repeat of
// it is one finding reported twice and stays one identity; only title-derived ids are suffixed.
function readerFindingIds(findings, round) {
  const list = Array.isArray(findings) ? findings : [];
  const titled = list.map((f) => !!(f && typeof f === "object" && normaliseFindingTitle(f.title)));
  const base = list.map((f, i) => {
    if (titled[i]) return findingId(f, round, i);
    return storedFindingId(f) || roundScopedId(round, i);
  });
  const ids = suffixDuplicates(base, (i) => titled[i]);
  return list.map((f, i) => ({ id: ids[i], stored: storedFindingId(f) }));
}

// [name, findings, round, wantIds]
const FINDING_ID_CASES = [
  ["diff prefix, line suffix and case fold", [{ location: "b/src/x.js:3", title: "Leaks fd" }, { location: "src/x.js:40", title: "leaks  FD" }, { title: "" }], 2, ["src/x.js::leaks fd", "src/x.js::leaks fd#2", "round-2#2"]],
  ["dot-slash path, backticks and trailing punctuation", [{ location: "./a.js:14", title: "Missing `null` check." }], 1, ["a.js::missing null check"]],
  ["title without location", [{ title: "Race in cache" }], 1, ["nolocation::race in cache"]],
];

function findingIdSelftest() {
  let fail = 0;
  for (const [name, findings, round, want] of FINDING_ID_CASES) {
    const got = assignFindingIds(findings, round);
    const pass = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
    if (!pass) fail++;
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (finding-id, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  FINDING_ID_CASES,
  assignFindingIds,
  findingId,
  findingIdSelftest,
  normaliseFindingPath,
  normaliseFindingTitle,
  readerFindingIds,
};
