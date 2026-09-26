// ===========================================================================
// === region:factory — punt-scan — FAFF-1078: the blocking-vs-deferred Punt reporter. ===
// PURE: parses a spec file's `**Punt:**` lines into a PuntScanResult so routing and the
// producer self-rating can tell a BLOCKING open Punt (an unresolved decision the increment
// depends on) from a NON-BLOCKING one (a decision the spec has explicitly pushed out of
// scope). It reads no tracker, no network, and no system clock; same input bytes always
// yield the same output, mirroring the tier / park-verdict deterministic-tool shape.
//
// A Punt is eligible to be treated non-blocking only when BOTH facts hold: it carries a
// bare `(non-blocking)` suffix AND its topic names an item listed under the spec's OUT OF
// SCOPE section. The bare tag alone never suffices — that closes the wave-through loophole.
// The crossref key rule reuses the house `headingSlug` transform rather than a second
// normaliser, so a topic and an OUT OF SCOPE item name compare on one dialect.
//
// Fail-safe direction: an untagged or un-crossreferenced Punt is treated as BLOCKING, never
// silently waved through. A degenerate all-punctuation topic slugs to "" and matches nothing.
// ===========================================================================

"use strict";

const fs = require("fs");
const { headingSlug, headingText } = require("./heading-slug");
const { parseArgs, usageError } = require("./argv");

const PUNT_LINE_RE = /^\s*\*\*Punt:\*\*\s*(.+)$/;
const NON_BLOCKING_RE = /\(non-blocking\)/;
const DECIDES_RE = /\(decides:\s*([^)]+)\)/;

// The canonical three-bullet OUT OF SCOPE form's body bullets (`- **Why excluded** — …`,
// `- **Extension point** — …`) are SUB-LABELS, never item names; emitting them produced the
// spurious keys that under-gated a Punt whose topic contained them.
const RESERVED_SUBLABEL_SLUGS = new Set(["why-excluded", "extension-point", "what-s-excluded", "whats-excluded"]);

// PURE: markdown spec text -> the set of OUT OF SCOPE item-name slugs. Empty when the section
// is absent or every bullet is a reserved sub-label.
function extractOutOfScopeItemKeys(specText) {
  const lines = String(specText).split(/\r?\n/);
  const keys = new Set();

  let sectionLevel = null;
  for (const line of lines) {
    const headingMatch = line.match(/^(#+)\s/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (sectionLevel === null) {
        if (headingSlug(headingText(line)).includes("out-of-scope")) sectionLevel = level;
        continue;
      }
      // Inside the section: a heading of the same-or-higher level closes it.
      if (level <= sectionLevel) break;
      continue;
    }
    if (sectionLevel === null) continue;

    const itemMatch = line.match(/^\s*-\s+\*\*(.+?)\*\*/);
    if (!itemMatch) continue;
    const name = itemMatch[1].replace(/[\s.:—-]+$/, "");
    const slug = headingSlug(name);
    if (!slug || RESERVED_SUBLABEL_SLUGS.has(slug)) continue;
    keys.add(slug);
  }
  return keys;
}

// PURE: true iff `oosKey` appears as a contiguous hyphen-delimited token run within
// `topicSlug` (equality is the degenerate case). One-directional: the OUT OF SCOPE item name
// must be found within the Punt topic, not the reverse.
function slugTokenRunContains(topicSlug, oosKey) {
  if (!oosKey) return false;
  return ("-" + topicSlug + "-").includes("-" + oosKey + "-");
}

// PURE: markdown spec text -> PuntScanResult. One PuntMarker per `**Punt:**` line, in
// document order.
function puntScan(specText) {
  const oosKeys = extractOutOfScopeItemKeys(specText);
  const punts = [];

  for (const line of String(specText).split(/\r?\n/)) {
    const m = line.match(PUNT_LINE_RE);
    if (!m) continue;
    const rest = m[1];

    const nonBlocking = NON_BLOCKING_RE.test(rest);
    const decidesMatch = rest.match(DECIDES_RE);
    const decides = decidesMatch ? decidesMatch[1].trim() : null;

    // Only the two recognised suffix parens are stripped; any other parenthetical stays.
    const topic = rest
      .replace(/\(non-blocking\)/g, "")
      .replace(/\(decides:[^)]*\)/g, "")
      .trim()
      .replace(/^[\s—-]+/, "")
      .replace(/[\s—-]+$/, "");

    const topicSlug = headingSlug(topic);
    let crossref = false;
    for (const k of oosKeys) {
      if (slugTokenRunContains(topicSlug, k)) { crossref = true; break; }
    }
    const eligible = nonBlocking && crossref;
    punts.push({ topic, decides, non_blocking: nonBlocking, out_of_scope_crossref: crossref, eligible });
  }

  const eligibleCount = punts.filter((p) => p.eligible).length;
  return { punts, eligible_count: eligibleCount, blocking_open_count: punts.length - eligibleCount };
}

// Cases: [name, spec_text, assert(result, extractedKeys)]. The table exercises every branch
// the spec's HOW names, keyed to the DoD boundary rows.
const PUNT_SCAN_CASES = [
  ["bare tag + crossref → eligible", `## OUT OF SCOPE

- **Repeat-park collapse** — deferred to a future ticket.

## Open Questions

**Punt:** repeat-park collapse — needs human (non-blocking)
`, (r) => r.punts[0].eligible === true && r.eligible_count === 1 && r.blocking_open_count === 0],

  ["order-independent suffixes → identical markers", `**Punt:** cron vs queue — needs human (decides: architecture) (non-blocking)
**Punt:** cron vs queue — needs human (non-blocking) (decides: architecture)
`, (r) => JSON.stringify(r.punts[0]) === JSON.stringify(r.punts[1])
      && r.punts[0].decides === "architecture" && r.punts[0].non_blocking === true
      && r.punts[0].topic === "cron vs queue — needs human"],

  ["tag without crossref → eligible false", `## OUT OF SCOPE

- **Something else** — unrelated.

**Punt:** totally unrelated thing (non-blocking)
`, (r) => r.punts[0].non_blocking === true && r.punts[0].out_of_scope_crossref === false
      && r.punts[0].eligible === false && r.blocking_open_count === 1],

  ["crossref without tag → eligible false", `## OUT OF SCOPE

- **Repeat-park collapse** — deferred.

**Punt:** repeat-park collapse — needs human
`, (r) => r.punts[0].non_blocking === false && r.punts[0].out_of_scope_crossref === true
      && r.punts[0].eligible === false && r.blocking_open_count === 1],

  ["no OUT OF SCOPE section → all blocking", `**Punt:** anything at all (non-blocking)
`, (r) => r.punts[0].out_of_scope_crossref === false && r.punts[0].eligible === false
      && r.blocking_open_count === 1],

  ["degenerate empty-slug topic never false-matches", `## OUT OF SCOPE

- **Repeat-park collapse** — deferred.

**Punt:** — (non-blocking)
`, (r) => r.punts[0].topic === "" && r.punts[0].non_blocking === true
      && r.punts[0].out_of_scope_crossref === false && r.punts[0].eligible === false],

  ["multiple mixed Punts", `## OUT OF SCOPE

- **Repeat-park collapse** — deferred.
- **Schema versioning** — out of scope.

**Punt:** repeat-park collapse handling — needs human (non-blocking)
**Punt:** cron vs queue — needs human
**Punt:** schema versioning approach (decides: architecture)
`, (r) => r.punts.length === 3 && r.punts[0].eligible === true
      && r.punts[1].eligible === false && r.punts[2].eligible === false
      && r.punts[2].decides === "architecture"
      && r.eligible_count === 1 && r.blocking_open_count === 2],

  ["canonical three-bullet item → sub-labels not emitted", `## OUT OF SCOPE

- **Repeat-park collapse** — the per-reason mechanism.
- **Why excluded** — root cause (b) is dropped.
- **Extension point** — a future ticket.

**Punt:** why excluded consideration (non-blocking)
`, (r, keys) => keys.has("repeat-park-collapse")
      && !keys.has("why-excluded") && !keys.has("extension-point") && keys.size === 1
      && r.punts[0].eligible === false],

  ["flat trailing-period item → one name key", `## OUT OF SCOPE

- **Standing-park collapse.** What's excluded: any per-reason mechanism. Why excluded: dropped. Extension point: a future ticket.

**Punt:** standing-park collapse — needs human (non-blocking)
`, (r, keys) => keys.has("standing-park-collapse") && keys.size === 1
      && r.punts[0].eligible === true && r.eligible_count === 1],
];

function runPuntScanCases() {
  let fail = 0;
  for (const [name, spec, assertFn] of PUNT_SCAN_CASES) {
    let ok;
    try {
      const result = puntScan(spec);
      const keys = extractOutOfScopeItemKeys(spec);
      // Structural invariant every case must hold.
      const invariant = result.eligible_count + result.blocking_open_count === result.punts.length;
      ok = invariant && assertFn(result, keys) === true;
    } catch (e) {
      ok = false;
      console.log(`     (threw: ${e.message})`);
    }
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  }
  return fail;
}

function puntScanSelftest() {
  const fail = runPuntScanCases();
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${PUNT_SCAN_CASES.length} cases, ${fail} failed) — no tracker, no network, no system clock consulted`);
  return fail ? 1 : 0;
}

const PUNT_SCAN_SPEC = { flags: { "--selftest": { arity: 0 } }, positionals: { min: 0, max: 1, name: "spec-file" } };
const PUNT_SCAN_USAGE = "usage: faff punt-scan <spec-file> [--selftest]";

function cmdPuntScan(args) {
  if (args.includes("--selftest")) return puntScanSelftest();
  const { positionals, errors } = parseArgs(args, PUNT_SCAN_SPEC);
  if (errors.length) return usageError(errors, PUNT_SCAN_USAGE);
  const specFile = positionals[0];
  if (!specFile) return usageError([{ code: "too-few-positionals", detail: "spec-file is required" }], PUNT_SCAN_USAGE);

  let specText;
  try {
    specText = fs.readFileSync(specFile, "utf8");
  } catch (e) {
    process.stderr.write(`faff punt-scan: cannot read ${specFile} (${e.message})\n`);
    return 2;
  }

  console.log(JSON.stringify(puntScan(specText)));
  return 0;
}

module.exports = {
  PUNT_SCAN_CASES,
  cmdPuntScan,
  extractOutOfScopeItemKeys,
  puntScan,
  puntScanSelftest,
  runPuntScanCases,
  slugTokenRunContains,
};
