#!/usr/bin/env node
// FAFF-1378: the state-authority map's eight-step integration smoke test, made repeatable.
// FAFF-825 and FAFF-1162 ran the steps by hand; this script runs the mechanical part of each
// against a pinned commit and prints what a reader must still judge (step 6 attribution).
//
//   node scripts/state-map-smoke.mjs [--map PATH] [--prior REV ...] [--added-path P ...] [--at REV] [--since REV [--since-map REV]] [--json]
//
// The pin is the commit the map's header names; `--at REV` checks the map against another commit
// instead (to see what a re-pin must change), and step 1 then fails by design. `--prior` names an
// earlier map revision whose row keys must survive; `--added-path` names a path the revision itself
// adds, which step 3 cannot resolve at the pin. `--since REV` flags every `file:N` citation the
// committed map already carries whose cited text differs between REV and the pin, which catches a
// carried-over citation whose line moved even when no quote sits beside it; the committed map is
// read at `--since-map REV` (default HEAD), so a run can be repeated after the revision lands. Steps 4 and 8 read the working tree's CLI and
// sources, so the script refuses to run unless the working tree's code matches the pin. This
// file itself is left out of that check: it postdates the pin it was first run against.
// Exit 0 when every step passes, 1 when any step fails, 2 on a usage or environment fault.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i === -1 ? dflt : args[i + 1]; };
const MAP = opt("--map", "docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md");
const PRIORS = args.flatMap((a, i) => (a === "--prior" ? [args[i + 1]] : []));
const AS_JSON = args.includes("--json");
const SINCE = opt("--since", null);
const SINCE_MAP = opt("--since-map", "HEAD");
const POINTER_FILE = "docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md";

const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const gitOk = (...a) => spawnSync("git", ["-C", ROOT, ...a], { stdio: "ignore" }).status === 0;
const SINCE_EARLY = (() => { const i = process.argv.indexOf("--since"); return i === -1 ? null : process.argv[i + 1]; })();
const text = fs.readFileSync(path.join(ROOT, MAP), "utf8");
const lines = text.split("\n");
// The smoke-test section reports what earlier runs caught, quoting the wrong forms on purpose, so
// steps 6 and 7 read the map above it.
const SMOKE_AT = lines.findIndex((l) => /^## Integration smoke test/.test(l));
// A "Changes since <rev>" section older than --since records an earlier revision as it stood at its
// own pin, so it is blanked too (line numbers kept).
let inOld = false;
const body = (SMOKE_AT === -1 ? lines : lines.slice(0, SMOKE_AT)).map((l) => {
  if (/^## /.test(l)) inOld = !!SINCE_EARLY && /^## Changes since /.test(l) && !l.includes(SINCE_EARLY);
  return inOld ? "" : l;
});
const headings = new Set(lines.filter((l) => /^#+ /.test(l)).map((l) => l.replace(/^#+ /, "").trim().toLowerCase()));
const results = [];
const step = (n, name, ok, detail, extra = {}) => results.push({ step: n, name, ok, detail, ...extra });

// ---- helpers ---------------------------------------------------------------------------------
function section(startRe, endRe) {
  const s = lines.findIndex((l) => startRe.test(l));
  if (s === -1) return [];
  const e = lines.findIndex((l, i) => i > s && endRe.test(l));
  return lines.slice(s + 1, e === -1 ? lines.length : e);
}
const cells = (row) => row.replace(/^\|/, "").replace(/\|\s*$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
const tableRows = (body) => body.filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map(cells);
const stripTicks = (s) => s.replace(/^`|`$/g, "");
function keysOf(body, header) {
  return tableRows(body).filter((c) => c[0] !== header).map((c) => stripTicks(c[0]));
}
const fileAt = (rev, p) => { try { return git("show", `${rev}:${p}`); } catch { return null; } };

// ---- step 1: the recorded commit ---------------------------------------------------------------
const pinShort = (text.match(/^Built against commit `([0-9a-f]{7,40})`/m) || [])[1];
let PIN = null;
if (pinShort) { try { PIN = git("rev-parse", "--verify", `${pinShort}^{commit}`).trim(); } catch { /* unresolved */ } }
step(1, "recorded commit resolves", !!PIN, PIN ? `\`${pinShort}\` resolves to ${PIN}` : `header pin ${pinShort ?? "(none)"} does not resolve`);
if (!PIN) finish();
if (opt("--at")) {
  PIN = git("rev-parse", "--verify", `${opt("--at")}^{commit}`).trim();
  results[0] = { ...results[0], ok: false, detail: `${results[0].detail}; checked --at ${PIN} instead` };
}
const codeDrift = !gitOk("diff", "--quiet", PIN, "--", "plugin/skills/faff/bin", "eval", "scripts", "verification/external-verification", "records/spikes", ":(exclude)scripts/state-map-smoke.mjs");
if (codeDrift) {
  process.stderr.write(`state-map-smoke: the working tree's code differs from the pin ${pinShort}; check out the pin first\n`);
  process.exit(2);
}
const TREE = new Set(git("ls-tree", "-r", "--name-only", PIN).split("\n").filter(Boolean));

// ---- steps 2 and 3: cited paths ------------------------------------------------------------------
const pointerText = (() => {
  const td = fileAt(PIN, POINTER_FILE) ?? "";
  return td.split("\n").filter((l) => /STATE-AUTHORITY-MAP-v5\.md/.test(l)).join("\n");
})();
const PATH_RE = /(?<![\w./-])((?:plugin|test|docs|records|scripts|eval|verification|bin)\/[A-Za-z0-9_.\/-]+\.[A-Za-z0-9]+)(?![\w\/-])/g;
const fencedSpans = new Set();
{ let inFence = false; lines.forEach((l, i) => { if (/^```/.test(l)) inFence = !inFence; else if (inFence) fencedSpans.add(i); }); }
const unfenced = lines.filter((_, i) => !fencedSpans.has(i)).join("\n") + "\n" + pointerText;
const cited = new Set();
for (const m of unfenced.matchAll(PATH_RE)) {
  const p = m[1].replace(/[.,;:]+$/, "");
  if (/[*?[\]<>{}]/.test(p) || /\s::\s/.test(p)) continue;
  cited.add(p);
}
step(2, "cited repo paths extracted", cited.size > 0, `${cited.size} distinct paths`);
const rejected = [...cited].filter((p) => p.startsWith("/") || p.split("/").includes("..") || /[;&|$`\\'"\s]/.test(p));
const added = new Set(args.flatMap((a, i) => (a === "--added-path" ? [args[i + 1]] : [])));
const missing = [...cited].filter((p) => !rejected.includes(p) && !TREE.has(p) && !added.has(p));
step(3, "cited paths exist at the pin", rejected.length === 0 && missing.length === 0,
  `${[...cited].filter((p) => TREE.has(p)).length} resolve at ${PIN.slice(0, 8)}; ${[...added].filter((p) => cited.has(p)).length} added by this revision; ${rejected.length} rejected; ${missing.length} missing`,
  { rejected, missing, resolved_elsewhere: [...added].filter((p) => cited.has(p)) });

// ---- step 4: classification rows against REGION_MAP -------------------------------------------
const CLI = path.join(ROOT, "plugin/skills/faff/bin/faff");
const regionMap = JSON.parse(execFileSync(process.execPath, [CLI, "regions", "list", "--json"], { encoding: "utf8" }));
const selftest = spawnSync(process.execPath, [CLI, "regions", "selftest", "--region", "all"], { encoding: "utf8" });
const memberLine = (selftest.stdout.match(/RESULT: \w+ \((\d+) members?[^)]*\)/) || []);
const members = memberLine[1] ? Number(memberLine[1]) : null;
const classRows = tableRows(section(/^## Classification table/, /^## /)).filter((c) => c[0] !== "command");
const classKeys = classRows.map((c) => stripTicks(c[0]));
const dupes = classKeys.filter((k, i) => classKeys.indexOf(k) !== i);
const unknown = classKeys.filter((k) => !(k in regionMap));
const absent = Object.keys(regionMap).filter((k) => !classKeys.includes(k));
const regionWrong = classRows.filter((c) => regionMap[stripTicks(c[0])] && regionMap[stripTicks(c[0])] !== c[1]).map((c) => stripTicks(c[0]));
const nKeys = Object.keys(regionMap).length;
step(4, "classification rows match REGION_MAP",
  classKeys.length === nKeys && members === nKeys && !dupes.length && !unknown.length && !absent.length && !regionWrong.length,
  `${classKeys.length} rows; ${nKeys} keys; ${members} members (${memberLine[0] ?? "no RESULT line"})`,
  { dupes, unknown, absent, regionWrong });

// ---- step 5: the three row-triple tables ---------------------------------------------------------
const own = keysOf(section(/^### Ownership table/, /^### Migration table/), "row_key");
const mig = keysOf(section(/^### Migration table/, /^### Assurance table/), "row_key");
const asr = keysOf(section(/^### Assurance table/, /^## /), "row_key");
const setEq = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
const retired = new Set(tableRows(section(/^\*\*Row change list\.\*\*/, /^## /)).filter((c) => /retired/.test(c[2] || "")).map((c) => c[1]));
const priorMissing = {};
for (const rev of PRIORS) {
  const prior = fileAt(rev, MAP);
  if (!prior) { priorMissing[rev] = ["(map absent at that revision)"]; continue; }
  const pl = prior.split("\n");
  const s = pl.findIndex((l) => /^### Ownership table/.test(l)); const e = pl.findIndex((l, i) => i > s && /^### Migration table/.test(l));
  const pk = keysOf(pl.slice(s + 1, e), "row_key");
  priorMissing[rev] = pk.filter((k) => !own.includes(k) && !retired.has(k));
}
const ownDupes = own.filter((k, i) => own.indexOf(k) !== i);
step(5, "ownership, migration and assurance keys agree",
  setEq(own, mig) && setEq(own, asr) && !ownDupes.length && Object.values(priorMissing).every((v) => !v.length),
  `${own.length} / ${mig.length} / ${asr.length} keys; prior keys missing: ${JSON.stringify(Object.fromEntries(Object.entries(priorMissing).map(([k, v]) => [k, v.length])))}`,
  { ownDupes, onlyOwn: own.filter((k) => !mig.includes(k) || !asr.includes(k)), priorMissing });

// ---- step 6: quoted fragments ----------------------------------------------------------------------
// A fragment is a straight- or curly-double-quoted run of 12+ characters. It passes when it
// appears in a file the same table cell or paragraph names; failing that, anywhere in the tree at
// the pin. Ellipses split a fragment into parts. Only an attributed fragment (one introduced by a
// cue such as "reads", "states" or "banner") can fail the step: an uncued one may be the map's own
// wording, so it is listed for the reader. So is a fragment found only in a file the cell does not
// name, since the script cannot judge whether that attribution is right.
const SEARCH_ROOTS = ["plugin", "docs", "records", "scripts", "eval", "verification", "AGENTS.md", "test"];
const corpusCache = new Map();
const readAtPin = (p) => { if (!corpusCache.has(p)) corpusCache.set(p, fileAt(PIN, p)); return corpusCache.get(p); };
const basenameIndex = new Map();
for (const p of TREE) { const b = path.basename(p); if (!basenameIndex.has(b)) basenameIndex.set(b, []); basenameIndex.get(b).push(p); }
const norm = (s) => s.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const fragments = [];
const CUE = /(?:reads?|states?|stated|says?|said|quotes?|quoted|Quote[^:]*\)|banner|comment|wording|text|calls (?:it|itself)|names (?:it|itself)|verbatim|line \d+|:)\s*\**\s*$/i;
const unesc = (s) => s.replace(/\\([|`])/g, "$1");
const units = [];
body.forEach((l, i) => { if (!fencedSpans.has(i)) { if (/^\|/.test(l)) units.push(...cells(l).map((c) => ({ t: c, line: i + 1 }))); else units.push({ t: l, line: i + 1 }); } });
for (const u of units) {
  const named = [...new Set([...u.t.matchAll(/([A-Za-z0-9_.-]+\.(?:js|mjs|ts|md|json|sh|yaml))/g)].map((x) => x[1]))];
  // Italic quotes (*"…"*) may hold inner double quotes; take them first, then drop code spans that
  // carry a quote mark (source text, not a quotation), then read plain quotes.
  let rest = u.t;
  const cued = (src, idx) => CUE.test(src.slice(Math.max(0, idx - 60), idx));
  for (const m of u.t.matchAll(/\*"(.+?)"\*/g)) {
    if (m[1].length >= 12) fragments.push({ frag: unesc(m[1]), line: u.line, named, cued: cued(u.t, m.index) });
    rest = rest.replace(m[0], " ".repeat(m[0].length));
  }
  rest = rest.replace(/`[^`]*["“”][^`]*`/g, (c) => " ".repeat(c.length));
  // Pair every quote, short ones included, so a short quote never shifts the pairing of a long one.
  for (const m of rest.matchAll(/"([^"]*)"|“([^”]*)”/g)) {
    const frag = unesc((m[1] ?? m[2]).trim());
    if (frag.length < 12 || headings.has(frag.toLowerCase())) continue; // short, or a reference to one of this map's own sections
    fragments.push({ frag, line: u.line, named, cued: cued(rest, m.index) });
  }
}
const grepTree = (needle) => {
  const r = spawnSync("git", ["-C", ROOT, "grep", "-l", "-F", "-e", needle, PIN, "--", ...SEARCH_ROOTS], { encoding: "utf8", maxBuffer: 1 << 26 });
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean).map((l) => l.slice(PIN.length + 1)) : [];
};
const notFound = [], elsewhere = [], unattributed = [];
let quoteOk = 0;
for (const f of fragments) {
  const parts = f.frag.split(/\s*(?:…|\.\.\.)\s*/).map((p) => p.trim()).filter((p) => p.length >= 6);
  if (!parts.length) continue;
  const candidates = f.named.flatMap((b) => basenameIndex.get(b) || []);
  const inFile = (p, part) => { const t = readAtPin(p); return t != null && (norm(t).includes(norm(part)) || norm(t.replace(/`/g, "")).includes(norm(part.replace(/`/g, "")))); };
  const hit = candidates.find((p) => parts.every((part) => inFile(p, part)));
  if (hit) { quoteOk++; continue; }
  const anywhere = grepTree(parts[0]).filter((p) => p !== MAP);
  if (anywhere.length) { if (f.cued && f.named.length) elsewhere.push({ line: f.line, frag: f.frag, named: f.named, found_in: anywhere.slice(0, 3) }); else quoteOk++; }
  else if (f.cued) notFound.push({ line: f.line, frag: f.frag, named: f.named });
  else unattributed.push({ line: f.line, frag: f.frag });
}
step(6, "quoted fragments appear verbatim", notFound.length === 0,
  `${fragments.length} fragments; ${quoteOk} found; ${elsewhere.length} attributed to a named file but found only elsewhere (judge); ` +
  `${unattributed.length} uncued and found nowhere (read as the map's own words; judge); ${notFound.length} attributed and found nowhere`,
  { not_found: notFound, located_elsewhere: elsewhere, unattributed });

// ---- step 7: function citations, mechanisms, line citations ----------------------------------------
const LIB = "plugin/skills/faff/bin/lib/";
const resolveModule = (b) => (TREE.has(LIB + b) ? LIB + b : (basenameIndex.get(b) || []).filter((p) => !p.startsWith("test/"))[0]);
const declares = (src, fn) => new RegExp(`(?:function\\s*\\*?\\s*${fn}\\s*\\(|\\b(?:const|let|var)\\s+${fn}\\s*=|^\\s*(?:async\\s+)?${fn}\\s*\\([^)]*\\)\\s*\\{|\\b${fn}\\s*:\\s*(?:async\\s*)?(?:function|\\()|exports\\.${fn}\\s*=)`, "m").test(src);
const fnCites = new Map();
// `a.js :: fn (declared in `b.js`…)` cites b.js, where the map says the function lives.
for (const m of body.join("\n").matchAll(/(?<![\w-])([A-Za-z0-9_-]+\.(?:js|mjs)) :: ([A-Za-z_$][\w$]*(?:\s*\/\s*[A-Za-z_$][\w$]*)*)(?![\w.-])(`?\s*\(declared in `([A-Za-z0-9_-]+\.js)`)?/g)) {
  for (const fn of m[2].split("/").map((s) => s.trim())) fnCites.set(`${m[4] ?? m[1]} :: ${fn}`, { mod: m[4] ?? m[1], fn });
}
const badFn = [];
for (const [k, { mod, fn }] of fnCites) {
  const p = resolveModule(mod);
  const src = p && readAtPin(p);
  if (!src || !declares(src, fn)) badFn.push(k + (p ? "" : " (module not found)"));
}
const MECHANISMS = [
  ["bundle.js", "push"], ["judge-trail.js", "update-ref"], ["judge-trail.js", "push"], ["worktree-heal.js", "repair"],
  ["gates.js", "link-skills.sh"], ["merge-gate.js", "--force-with-lease"], ["merge-gate.js", "update-ref"],
  ["merge-gate.js", "--ff-only"], ["merge-gate.js", "\"create\""], ["merge-gate.js", "governance-required.json"],
  ["governor-admin.js", "\"push\""], ["governor-admin.js", "\"create\""], ["governor-install.js", "useradd"], ["governor-install.js", "systemctl"],
];
const badMech = MECHANISMS.filter(([mod, needle]) => !(readAtPin(resolveModule(mod)) || "").includes(needle)).map((x) => x.join(" "));
if (!TREE.has("scripts/link-skills.sh")) badMech.push("scripts/link-skills.sh missing");
// 7c: single-line citations name a line holding the quoted text on the same map line, and inline
// selftest ranges start on the function's declaration and end on its closing brace.
const badLines = [];
const PRIOR_MAP = SINCE ? (() => { try { return git("show", `${SINCE_MAP}:${MAP}`); } catch { return ""; } })() : "";
let lineChecks = 0;
body.forEach((l, i) => {
  for (const m of l.matchAll(/([A-Za-z0-9_-]+\.(?:js|mjs|md)):(\d+)(?:-(\d+))?/g)) {
    const p = resolveModule(m[1]) || (basenameIndex.get(m[1]) || [])[0];
    const src = p && readAtPin(p);
    lineChecks++;
    if (!src) { badLines.push(`${m[0]} (map line ${i + 1}): file not found`); continue; }
    const srcLines = src.split("\n");
    const n = Number(m[2]);
    if (n < 1 || n > srcLines.length) { badLines.push(`${m[0]} (map line ${i + 1}): past end of file`); continue; }
    const tail = l.slice(m.index + m[0].length, m.index + m[0].length + 400);
    // The text a line cite vouches for: an immediately following `(code span)` or quote.
    const q = (tail.match(/^`?\s*\(`([^`]{8,})`\)/) || tail.match(/^`?\)?:?\s*\*?["“]([^"”]{8,}?)["”]/) || [])[1];
    // With --since, a citation the committed map already carried whose cited text differs between
    // that revision and the pin has moved or changed. A citation new to this revision is not checked.
    if (SINCE && p && PRIOR_MAP.includes(m[0])) {
      const old = (fileAt(SINCE, p) || "").split("\n");
      const a = Number(m[2]), b = m[3] ? Number(m[3]) : a;
      if (old.slice(a - 1, b).join("\n") !== srcLines.slice(a - 1, b).join("\n")) badLines.push(`${m[0]} (map line ${i + 1}): text differs from ${SINCE}`);
    }
    if (q) {
      const head = norm(q.split(/…|\.\.\./)[0]).slice(0, 40).trim();
      const window = norm(srcLines.slice(n - 1, (m[3] ? Number(m[3]) : n) + 1).join(" "));
      if (!window.includes(head) && !norm(window.replace(/`/g, "")).includes(head.replace(/`/g, ""))) badLines.push(`${m[0]} (map line ${i + 1}): line does not hold "${head}"`);
    }
  }
  for (const m of l.matchAll(/([A-Za-z0-9_-]+\.js)'s inline (\w+) \(lines (\d+)-(\d+)\)/g)) {
    const src = readAtPin(resolveModule(m[1]) || "");
    lineChecks++;
    if (!src) { badLines.push(`${m[0]}: file not found`); continue; }
    const srcLines = src.split("\n");
    const a = Number(m[3]), b = Number(m[4]);
    const declLine = srcLines.findIndex((s) => new RegExp(`function\\s+${m[2]}\\s*\\(`).test(s)) + 1;
    let depth = 0, end = 0, seen = false;
    for (let j = declLine - 1; declLine && j < srcLines.length; j++) {
      for (const ch of srcLines[j].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "").replace(/\/\/.*$/, "")) {
        if (ch === "{") { depth++; seen = true; } else if (ch === "}") depth--;
      }
      if (seen && depth === 0) { end = j + 1; break; }
    }
    if (declLine !== a || end !== b) badLines.push(`${m[1]} ${m[2]}: cited ${a}-${b}, actual ${declLine}-${end}`);
  }
});
step(7, "function citations, mechanisms and line citations resolve", !badFn.length && !badMech.length && !badLines.length,
  `(a) ${fnCites.size} citations, ${badFn.length} unresolved; (b) ${MECHANISMS.length + 1} mechanisms, ${badMech.length} missing; (c) ${lineChecks} line citations, ${badLines.length} wrong`,
  { unresolved: badFn, mechanisms_missing: badMech, lines_wrong: badLines });

// ---- step 8: the write-site sweep ----------------------------------------------------------------
const fence = (headingRe) => {
  const s = lines.findIndex((l) => headingRe.test(l));
  const a = lines.findIndex((l, i) => i > s && /^```/.test(l));
  const b = lines.findIndex((l, i) => i > a && /^```/.test(l));
  return lines.slice(a + 1, b).map((l) => l.trim().replace(/\s+\[[^\]]*\]$/, "")).filter((l) => l && !l.startsWith("-"));
};
const derived = fence(/^### \(a\) Derived set/);
const swept = fence(/^### \(b\) Swept set/);
const sweptNotDerived = swept.filter((f) => !derived.includes(f));
const derivedNotSwept = derived.filter((f) => !swept.includes(f));
const SEED = ["writeFileSync", "appendFileSync", "renameSync", "mkdirSync", "unlinkSync", "rmSync", "copyFileSync", "cpSync", "writeSync"];
const seedOut = spawnSync("git", ["-C", ROOT, "grep", "-l", "-E", `\\b(${SEED.join("|")})\\b`, PIN, "--", "*.js", "*.mjs", ":!test/**", ":!**/node_modules/**"], { encoding: "utf8" });
const seed = seedOut.stdout.split("\n").filter(Boolean).map((l) => l.slice(PIN.length + 1)).sort();
const sweepText = section(/^### \(b\) Swept set/, /^### \(c\)/).join("\n");
const statedSeed = Number((sweepText.match(/\((\d+) files\)/) || [])[1]);
const statedTotal = Number((sweepText.match(/\((\d+) in total\)/) || [])[1]);
const derivedText = section(/^### \(a\) Derived set/, /^### \(b\)/).join("\n");
const statedDerived = Number((derivedText.match(/\((\d+) files\)/) || [])[1]);
const diffText = section(/^### \(c\) The two-way diff/, /^## /).join("\n");
const statedSND = Number((diffText.match(/In \(b\) and not \(a\): (\d+) files/) || [])[1]);
const statedDNS = Number((diffText.match(/In \(a\) and not \(b\): (\d+) files/) || [])[1]);
const seedNotSwept = seed.filter((f) => !swept.includes(f));
const unexplained = sweptNotDerived.filter((f) => !diffText.includes(path.basename(f, path.extname(f))));
const scopeStated = /excluding only `test\/` and `node_modules\/`/.test(text) && /`\.ts` files are excluded/.test(text);
step(8, "write-site sweep diff recomputes",
  derived.length === statedDerived && swept.length === statedTotal && seed.length === statedSeed && !seedNotSwept.length &&
  sweptNotDerived.length === statedSND && derivedNotSwept.length === statedDNS && !unexplained.length && scopeStated,
  `derived ${derived.length} (stated ${statedDerived}); seed ${seed.length} (stated ${statedSeed}); swept ${swept.length} (stated ${statedTotal}); ` +
  `swept-not-derived ${sweptNotDerived.length} (stated ${statedSND}); derived-not-swept ${derivedNotSwept.length} (stated ${statedDNS}); scope stated: ${scopeStated}`,
  { seed_not_in_swept_list: seedNotSwept, swept_not_seed_closure: swept.filter((f) => !seed.includes(f)), unexplained, derived_not_swept: derivedNotSwept });

finish();

function finish() {
  const ok = results.every((r) => r.ok);
  if (AS_JSON) console.log(JSON.stringify({ pin: PIN, ok, steps: results }, null, 2));
  else {
    for (const r of results) {
      console.log(`${r.ok ? "PASS" : "FAIL"}  step ${r.step}: ${r.name}: ${r.detail}`);
      for (const [k, v] of Object.entries(r)) {
        if (["step", "name", "ok", "detail"].includes(k) || (Array.isArray(v) && !v.length)) continue;
        if (v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => Array.isArray(x) && !x.length)) continue;
        console.log(`        ${k}: ${JSON.stringify(v, null, 0).slice(0, 4000)}`);
      }
    }
    console.log(`RESULT: ${ok ? "PASS" : "FAIL"} (${results.filter((r) => r.ok).length} of ${results.length} steps)`);
  }
  process.exit(ok ? 0 : 1);
}
