// ===========================================================================
// === region:governance — finding-id — FAFF-1266: one code home for a code-review finding's identity ===
// A finding's cross-round identity is `<file>::<normalised title>`. The reviewers emit `title`
// and `location` per finding; this module turns them into the id the build-review dialogue
// readers (`build-review-churn.js`, `build-judge-evidence.js`, `build-judge-casefile.js`) and the
// later code-review collator compare on. Pure, requires nothing. The model never emits the id;
// from round 2 on it may name the prior finding it re-raises by handle, and resolveRoundChain
// decides whether that carry holds (FAFF-1276).
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

const HANDLE = /^P([1-9]\d*)$/;
const ROUND_SCOPED = /^round-[^#]+#\d+$/;

function carriedHandle(f) {
  if (!f || typeof f !== "object" || typeof f.carried_id !== "string") return null;
  const c = f.carried_id.trim();
  return c || null;
}

function carryRefusal(c, f, prior, reserved, untitledStored) {
  if (!Array.isArray(prior)) return { refusal: "no-prior-round" };
  const m = c.match(HANDLE);
  const k = m ? Number(m[1]) : 0;
  if (!k || k > prior.length) return { refusal: "not-in-prior-round" };
  const e = prior[k - 1];
  if (ROUND_SCOPED.test(e.id)) return { refusal: "fallback-id" };
  if (!e.file) return { refusal: "no-file" };
  if (normaliseFindingPath(f.location) !== e.file) return { refusal: "file-differs" };
  if (reserved.has(e.id) || untitledStored.has(e.id)) return { refusal: "claimed-twice" };
  return { id: e.id };
}

// FAFF-1276: a reviewer from round 2 on may name the previous round's finding it re-raises by its
// handle (`carried_id: "P<k>"`). The carry is accepted only when that prior finding exists, has a
// real identity, and sits in the same file; every other finding gets its readerFindingIds id.
function resolveCarriedIds(findings, round, prior) {
  const list = Array.isArray(findings) ? findings : [];
  const titled = list.map((f) => !!(f && typeof f === "object" && normaliseFindingTitle(f.title)));
  const untitledStored = new Set(list.map((f, i) => (titled[i] ? null : storedFindingId(f))).filter(Boolean));
  const reserved = new Set();
  const entries = list.map((f) => ({ id: null, stored: storedFindingId(f), carry: null, refusal: null }));
  list.forEach((f, i) => {
    const c = carriedHandle(f);
    if (!c) return;
    const r = carryRefusal(c, f, prior, reserved, untitledStored);
    if (r.id) {
      reserved.add(r.id);
      Object.assign(entries[i], { id: r.id, carry: "accepted" });
    } else {
      Object.assign(entries[i], { carry: "refused", refusal: r.refusal });
    }
  });
  const seen = new Map(Array.from(reserved, (id) => [id, 1]));
  list.forEach((f, i) => {
    if (entries[i].carry === "accepted") return;
    if (!titled[i]) {
      entries[i].id = entries[i].stored || roundScopedId(round, i);
      return;
    }
    const base = findingId(f, round, i);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    entries[i].id = n === 1 ? base : `${base}#${n}`;
  });
  return entries;
}

function resolveRoundChain(rounds) {
  let prior = null;
  return (Array.isArray(rounds) ? rounds : []).map((r) => {
    const findings = r && Array.isArray(r.findings) ? r.findings : [];
    const entries = resolveCarriedIds(findings, r ? r.round : undefined, prior);
    prior = entries.map((e, i) => ({ id: e.id, file: normaliseFindingPath(findings[i] && findings[i].location) }));
    return entries;
  });
}

// [name, rounds, wantIdsPerRound]
const ROUND_CHAIN_CASES = [
  ["carry keeps the round-1 id across a reworded title", [{ round: 1, findings: [{ location: "lib/page.js:12", title: "pagecount truncates partial last page with math.floor" }] }, { round: 2, findings: [{ location: "lib/page.js:15", title: "pagecount rounds down a partial last page", carried_id: "P1" }] }], [["lib/page.js::pagecount truncates partial last page with math.floor"], ["lib/page.js::pagecount truncates partial last page with math.floor"]]],
  ["carry into another file is refused", [{ round: 1, findings: [{ location: "lib/page.js:12", title: "a" }] }, { round: 2, findings: [{ location: "lib/other.js:3", title: "b", carried_id: "P1" }] }], [["lib/page.js::a"], ["lib/other.js::b"]]],
];

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
  for (const [name, rounds, want] of ROUND_CHAIN_CASES) {
    const got = resolveRoundChain(rounds).map((entries) => entries.map((e) => e.id));
    const pass = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
    if (!pass) fail++;
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (finding-id, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  FINDING_ID_CASES,
  ROUND_CHAIN_CASES,
  assignFindingIds,
  findingId,
  findingIdSelftest,
  normaliseFindingPath,
  normaliseFindingTitle,
  readerFindingIds,
  resolveCarriedIds,
  resolveRoundChain,
};
