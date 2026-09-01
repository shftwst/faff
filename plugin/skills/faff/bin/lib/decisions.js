// ===========================================================================
// === region:factory — decisions — the decisions register (ADR-lite, FAFF-448). Deterministic ===
// mechanics over a single committed `docs/decisions.md`: settled, small, non-architectural
// precedents the gateway's `needs-decision-first` resolve-attempt consults BEFORE its bounded
// inference. Read-only by design (match/list/validate) — the register is human-authored and
// git-committed; writes are ordinary file edits landed in a human-ratified PR (faff-prep records
// capture intent, faff-graft materialises it), never a CLI-driven runtime write. Pure-function
// contract (mirrors `faff next` / `faff eligible`): the caller passes the punt topic, this CLI
// reads only the committed doc and computes the match — no tracker/network access, no writes.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, requireFlags, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
// FAFF-910: `hasFieldLine` (the lexical-presence check that discriminates a ratified tradeoff) lives
// in the shared `fields` module beside `readField`, both built on one `fieldLineHead` so the presence
// check and the value read can never fork into two grammars. A blank `Ratified-by:` is a present line
// (hence a malformed tradeoff), never a precedent fall-through.
const { readField, hasFieldLine } = require("./fields");

// A ratified tradeoff's Source-issue must be a tracker id shape; validation rejects anything else
// (closes the unvalidated-source_issue fail-open). v1 accepts ONLY `Ratified-by: human`; a `loop`
// value is refused until FAFF-922's deterministic admit gate exists.
const SOURCE_ISSUE_RE = /^[A-Z]+-\d+$/;

// FAFF-929: the fixed marker grammar shared by the tracker-writer (faff-prep's reconcile step)
// and the materialiser (faff-graft Step 4c) — the deterministic half of the reconcile-before-
// materialise design. A `## Decisions-register intent` comment is discriminated from any other
// comment by heading alone (tolerant of a trailing " (superseded)" heading suffix — that suffix
// is descriptive only, never authoritative); supersession is discriminated by the LEXICAL
// PRESENCE of a `> Superseded ...` line, not the heading suffix, so the two can never fork on
// what "superseded" means.
const INTENT_HEADING_RE = /^##\s+Decisions-register intent\b/im;
const SUPERSEDED_MARKER_RE = /^>\s*Superseded\b/im;

// Pure core: classify a tracker comment body as an intent (live/superseded) or not an intent at
// all. No fs, no tracker — a plain string function both the prep-writer and the graft-reader call
// so the marker parse can never drift into two grammars.
function classifyIntentComment(body) {
  const text = String(body ?? "");
  if (!INTENT_HEADING_RE.test(text)) return { kind: "not-intent", status: null };
  return { kind: "intent", status: SUPERSEDED_MARKER_RE.test(text) ? "superseded" : "live" };
}

const DECISIONS_SPEC = { flags: {
  "--json": { arity: 0 }, "--punt": { arity: 1 }, "--root": { arity: 1 }, "--selftest": { arity: 0 },
  "--file": { arity: 1 },
}, positionals: { min: 0, max: null, name: "verb selector" } };
// FAFF-628-style declared grammar for the drift-guard's flag-layer assertions (mirrors adr.js's
// ADR_SURFACE shape) — only the unconditional required-flag check is declared here.
const DECISIONS_SURFACE = {
  kind: "subcommand_dispatch",
  spec: DECISIONS_SPEC,
  subcommands: {
    match: { required_flags: ["--punt"] },
    list: { required_flags: [] },
    validate: { required_flags: [] },
    "intent-status": { required_flags: [] },
  },
};

function decisionsPath(root) { return path.join(root, "docs", "decisions.md"); }

// Stable kebab slug of an entry's topic heading — the citation id. Mirrors adr.js's adrSlug.
function kebabSlug(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "decision";
}

// Split the committed doc into one section per "## " heading. Pure string -> [{topic, text}].
function splitSections(text) {
  const lines = String(text).split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (current) sections.push(current);
      current = { topic: m[1], body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ topic: s.topic, text: s.body.join("\n") }));
}

// The metadata-field reader is the shared one home (./fields readField, FAFF-850) — the same
// reader adr.js / prd.js / prdr.js use. `decisionField` was a byte-identical fork; it is now a
// thin alias so the register's Chosen/Rationale/Scope/Date/ADR/Matches reads share the one regex
// (and its blank-field fix) instead of drifting from a second copy.
const decisionField = readField;

// Matches: is semicolon-separated (a comma may legitimately appear inside one key's prose).
function parseMatches(raw) {
  if (!raw) return [];
  return raw.split(";").map((s) => s.trim()).filter(Boolean);
}

// Normalize a punt topic or a declared Matches key for equality comparison: lowercase,
// collapse internal whitespace, strip surrounding punctuation/quotes. Never used for
// substring/containment — callers compare normalized strings for FULL equality only, which is
// what closes the cross-domain false-positive (a generic key contained in a longer, unrelated
// punt must never fire).
function normalizeMatchKey(s) {
  let t = String(s).toLowerCase().replace(/\s+/g, " ").trim();
  t = t.replace(/^[\s'"“”‘’.,;:!?()]+/, "").replace(/[\s'"“”‘’.,;:!?()]+$/, "");
  return t;
}

// Read + parse every entry in the committed register. An absent file is a clean empty list
// (never an error — the register is optional infrastructure a repo may not have yet).
function listEntries(root) {
  const p = decisionsPath(root);
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, "utf8");
  return splitSections(text).map((s) => {
    const matchesRaw = decisionField(s.text, "Matches");
    // FAFF-910: derive the kind from the lexical presence of a `Ratified-by:` field line (see
    // hasFieldLine) — a separate check from the value read, so a blank `Ratified-by:` is a
    // ratified_tradeoff (which then fails validation) rather than a precedent fall-through.
    const kind = hasFieldLine(s.text, "Ratified-by") ? "ratified_tradeoff" : "precedent";
    return {
      kind,
      topic: s.topic,
      id: kebabSlug(s.topic),
      chosen: decisionField(s.text, "Chosen"),
      rationale: decisionField(s.text, "Rationale"),
      scope: decisionField(s.text, "Scope"),
      matches: parseMatches(matchesRaw),
      date: decisionField(s.text, "Date"),
      adr: decisionField(s.text, "ADR"),
      // FAFF-910 ratified-tradeoff fields (null on a precedent — the value read, not the presence check)
      source_issue: decisionField(s.text, "Source-issue"),
      ratified_by: decisionField(s.text, "Ratified-by"),
    };
  });
}

// Structure lint for a PRECEDENT entry: required fields present + non-empty, matches non-empty.
// Returns a list of problem strings (empty = valid) — the citation-id column is checked globally.
function validatePrecedent(e) {
  const problems = [];
  if (!e.chosen) problems.push(`${e.topic}: missing Chosen field`);
  if (!e.rationale) problems.push(`${e.topic}: missing Rationale field`);
  if (!e.scope) problems.push(`${e.topic}: missing Scope field`);
  if (!e.date) problems.push(`${e.topic}: missing Date field`);
  if (!e.matches.length) problems.push(`${e.topic}: Matches must be non-empty — an entry with no declared keys can never fire`);
  return problems;
}

// FAFF-910: structure lint for a RATIFIED-TRADEOFF entry. Requires Chosen/Rationale/Scope/
// Source-issue/Ratified-by/Date; Source-issue matches the tracker-id shape; Ratified-by is exactly
// `human` in v1 (a `loop` value names FAFF-922 as the future admit gate; a blank/other value is a
// malformed tradeoff — it never falls through to precedent because kind was fixed lexically). Matches
// is optional here and never consulted by matchDecision for this kind.
function validateTradeoff(e) {
  const problems = [];
  if (!e.chosen) problems.push(`${e.topic}: missing Chosen field`);
  if (!e.rationale) problems.push(`${e.topic}: missing Rationale field`);
  if (!e.scope) problems.push(`${e.topic}: missing Scope field`);
  if (!e.date) problems.push(`${e.topic}: missing Date field`);
  if (!e.source_issue) problems.push(`${e.topic}: ratified tradeoff missing Source-issue field`);
  else if (!SOURCE_ISSUE_RE.test(e.source_issue)) problems.push(`${e.topic}: Source-issue "${e.source_issue}" is not a tracker id (^[A-Z]+-\\d+$)`);
  if (!e.ratified_by) problems.push(`${e.topic}: ratified tradeoff has a blank or missing Ratified-by (a blank Ratified-by: is a malformed tradeoff, not a precedent)`);
  else if (e.ratified_by === "loop") problems.push(`${e.topic}: Ratified-by: loop is not honourable in v1 — a deterministic loop-provenance admit gate (FAFF-922) must exist first`);
  else if (e.ratified_by !== "human") problems.push(`${e.topic}: Ratified-by must be "human" in v1 (got "${e.ratified_by}")`);
  return problems;
}

// Structure lint over the whole register: per-entry rules dispatched by kind, plus a GLOBAL
// citation-id uniqueness check across both kinds. Returns a list of problem strings (empty = valid).
function validateEntries(entries) {
  const problems = [];
  const seenIds = new Map();
  for (const e of entries) {
    if (e.kind === "ratified_tradeoff") problems.push(...validateTradeoff(e));
    else problems.push(...validatePrecedent(e));
    if (seenIds.has(e.id)) problems.push(`duplicate citation id "${e.id}" — ${seenIds.get(e.id)}, ${e.topic}`);
    else seenIds.set(e.id, e.topic);
  }
  return problems;
}

// FAFF-910: the ratified-tradeoff reader `ratified-scope.js` consumes. Returns only fully-valid
// `ratified_tradeoff` entries carrying `Ratified-by: human`; a malformed or `loop` entry is never
// honourable. An absent register is a clean empty list (listEntries already yields []).
function listRatifiedTradeoffs(root) {
  return listEntries(root)
    .filter((e) => e.kind === "ratified_tradeoff")
    .filter((e) => validateTradeoff(e).length === 0)
    .filter((e) => e.ratified_by === "human")
    .map((e) => ({ id: e.id, topic: e.topic, chosen: e.chosen, scope: e.scope, source_issue: e.source_issue, ratified_by: e.ratified_by }));
}

// The match core (HOW §4, WHAT's "Design decision — match / citation form"): normalized FULL
// equality only, never substring/containment. Two or more entries equal-matching the same
// normalized punt topic is ambiguous -> no-match (fall through to the bounded inference,
// never a guess). Scope is descriptive-only and never consulted here. Pure: (entries, punt) ->
// {id, chosen, rationale, scope} | null.
function matchDecision(entries, punt) {
  const target = normalizeMatchKey(punt);
  const hits = [];
  for (const e of entries) {
    // FAFF-910: matchDecision considers PRECEDENT entries only. A ratified tradeoff may carry an
    // optional Matches, but it is a distinct register consumer (the ratified-scope reader) and is
    // never returned here. An untagged hand-built entry (no kind) is treated as a precedent.
    if (e.kind === "ratified_tradeoff") continue;
    if (e.matches.some((k) => normalizeMatchKey(k) === target)) hits.push(e);
  }
  if (hits.length !== 1) return null;
  const e = hits[0];
  return { id: e.id, chosen: e.chosen, rationale: e.rationale, scope: e.scope };
}

function readEntriesOrFail(root, verb) {
  try {
    return { entries: listEntries(root), err: null };
  } catch (e) {
    process.stderr.write(`faff decisions ${verb}: cannot read ${path.relative(root, decisionsPath(root)) || "docs/decisions.md"}: ${e.message}\n`);
    return { entries: null, err: e };
  }
}

function cmdDecisions(args) {
  if (args.includes("--selftest")) return decisionsSelftest();
  const parsed = parseArgs(args, DECISIONS_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, 'usage: faff decisions <match --punt "<topic>"|list|validate> [flags]');
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const action = args[0];
  const root = get("--root") || findRoot();
  const json = args.includes("--json");

  if (action === "match") {
    const reqErr = requireFlags(parsed.values, DECISIONS_SURFACE.subcommands.match, "decisions", "match");
    if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
    const { entries, err } = readEntriesOrFail(root, "match");
    if (err) return 2;
    const hit = matchDecision(entries, get("--punt"));
    if (json) console.log(JSON.stringify(hit ? { id: hit.id, chosen: hit.chosen, rationale: hit.rationale, scope: hit.scope } : { match: null }));
    else console.log(hit ? `${hit.id}  ${hit.chosen}` : "no match");
    return 0; // always 0 — a no-match is data, not an error (exit 2 is reserved for an unreadable register)
  }

  if (action === "list") {
    const { entries, err } = readEntriesOrFail(root, "list");
    if (err) return 2;
    if (json) {
      // FAFF-910: the `kind` field is ADDITIVE — the existing id/topic/chosen/date keys are unchanged
      // in name, order, and value for a precedent, so an existing consumer reading those keys is unaffected.
      console.log(JSON.stringify(entries.map(({ id, topic, chosen, date, kind }) => ({ id, topic, chosen, date, kind })), null, 2));
    } else if (!entries.length) {
      console.log(`No decisions register entries in ${path.relative(root, decisionsPath(root)) || decisionsPath(root)}.`);
    } else {
      for (const e of entries) console.log(`${e.id}  ${e.chosen || "?"}  ${e.date || ""}`.trimEnd());
    }
    return 0;
  }

  if (action === "validate") {
    const { entries, err } = readEntriesOrFail(root, "validate");
    if (err) return 2;
    const problems = validateEntries(entries);
    const rel = path.relative(root, decisionsPath(root)) || "docs/decisions.md";
    if (!problems.length) { console.log(`OK — ${entries.length} decision(s) in ${rel} valid.`); return 0; }
    for (const p of problems) console.log(`FAIL ${rel} ✗ ${p}`);
    return 1;
  }

  if (action === "intent-status") {
    // FAFF-929: the deterministic skip decision both faff-prep (the tracker-writer) and
    // faff-graft Step 4c (the materialiser) shell out to — no fs write, no tracker call. Reads
    // the comment body from --file, else stdin (never both; --file wins when given).
    const filePath = get("--file");
    let body;
    try {
      body = filePath != null ? fs.readFileSync(filePath, "utf8") : fs.readFileSync(0, "utf8");
    } catch (e) {
      process.stderr.write(`faff decisions intent-status: cannot read ${filePath != null ? filePath : "stdin"}: ${e.message}\n`);
      return 2;
    }
    const result = classifyIntentComment(body);
    if (json) console.log(JSON.stringify(result));
    else console.log(result.kind === "not-intent" ? "not-intent" : result.status);
    if (result.kind === "not-intent") return 2;
    return result.status === "superseded" ? 1 : 0;
  }

  process.stderr.write("faff decisions: expected one of: match | list | validate | intent-status (or --selftest)\n");
  return 2;
}

function decisionsSelftest() {
  const os = require("node:os");
  const cases = [];
  const t = (name, ok) => cases.push([name, !!ok]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-decisions-"));

  const writeRegister = (root, body) => {
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(decisionsPath(root), body);
  };

  const loggingEntry =
    "## Logging library\n" +
    "- Chosen: pino\n" +
    "- Rationale: pino is the house structured-JSON logger.\n" +
    "- Scope: all backend services.\n" +
    "- Matches: pino vs winston; logging library\n" +
    "- Date: 2026-07-11\n";

  // match: exact-equal hit
  {
    const root = path.join(tmp, "hit");
    writeRegister(root, loggingEntry);
    const hit = matchDecision(listEntries(root), "pino vs winston");
    t("match: exact-equal hit returns the entry", hit && hit.id === "logging-library" && hit.chosen === "pino");
    t("match: normalizes case/whitespace before comparing", matchDecision(listEntries(root), "  Pino   VS Winston  ") !== null);
  }

  // no-match: a declared key not present
  {
    const root = path.join(tmp, "nomatch");
    writeRegister(root, loggingEntry);
    t("match: no declared key -> no-match", matchDecision(listEntries(root), "redis vs memcached") === null);
  }

  // containment-false-positive: a generic key contained in a longer, unrelated punt must never fire
  {
    const root = path.join(tmp, "containment");
    writeRegister(root, loggingEntry);
    t("match: containment never fires (equality only)",
      matchDecision(listEntries(root), "structured logging library for the audit subsystem") === null);
  }

  // ambiguous: two entries equal-match the same normalized topic -> no-match
  {
    const root = path.join(tmp, "ambiguous");
    writeRegister(root,
      "## Logging library\n- Chosen: pino\n- Rationale: r\n- Scope: s\n- Matches: which logger\n- Date: 2026-07-11\n\n" +
      "## Logging library take two\n- Chosen: bunyan\n- Rationale: r2\n- Scope: s2\n- Matches: which logger\n- Date: 2026-07-12\n");
    t("match: 2+ equal-matching entries -> no-match (never a guess)", matchDecision(listEntries(root), "which logger") === null);
  }

  // absent file: clean no-match, never an error
  {
    const root = path.join(tmp, "absent");
    fs.mkdirSync(root, { recursive: true });
    t("listEntries: absent docs/decisions.md -> empty list", listEntries(root).length === 0);
    t("match: absent register -> clean no-match", matchDecision(listEntries(root), "anything") === null);
  }

  // list
  {
    const root = path.join(tmp, "list");
    writeRegister(root, loggingEntry);
    const entries = listEntries(root);
    t("list: parses 1 entry with expected fields", entries.length === 1 && entries[0].id === "logging-library" && entries[0].date === "2026-07-11");
  }

  // FAFF-850: a PRESENT-BUT-BLANK field must read back null, never steal the next field's line.
  {
    const root = path.join(tmp, "blank");
    writeRegister(root,
      "## Blank chosen\n- Chosen: \n- Rationale: pino is the house logger\n- Scope: s\n- Matches: blank chosen\n- Date: 2026-07-11\n");
    const e = listEntries(root)[0];
    t("FAFF-850: blank Chosen reads back null, not the Rationale line", e.chosen === null);
    t("FAFF-850: blank Chosen did not steal the next field", e.rationale === "pino is the house logger");
  }

  // validate: clean tree
  {
    const root = path.join(tmp, "valid");
    writeRegister(root, loggingEntry);
    t("validate: clean entry -> no problems", validateEntries(listEntries(root)).length === 0);
  }

  // validate: missing required field
  {
    const root = path.join(tmp, "missing-field");
    writeRegister(root, "## Storage engine\n- Chosen: postgres\n- Rationale: r\n- Matches: db choice\n- Date: 2026-07-11\n");
    const problems = validateEntries(listEntries(root));
    t("validate: missing Scope field flagged", problems.some((p) => /Scope/.test(p)));
  }

  // validate: empty Matches list
  {
    const root = path.join(tmp, "empty-matches");
    writeRegister(root, "## Storage engine\n- Chosen: postgres\n- Rationale: r\n- Scope: s\n- Date: 2026-07-11\n");
    const problems = validateEntries(listEntries(root));
    t("validate: empty Matches flagged", problems.some((p) => /Matches must be non-empty/.test(p)));
  }

  // validate: duplicate citation id (two entries with the same topic-derived slug)
  {
    const root = path.join(tmp, "dup-id");
    writeRegister(root,
      "## Logging Library\n- Chosen: pino\n- Rationale: r\n- Scope: s\n- Matches: m1\n- Date: 2026-07-11\n\n" +
      "## logging library\n- Chosen: bunyan\n- Rationale: r2\n- Scope: s2\n- Matches: m2\n- Date: 2026-07-12\n");
    const problems = validateEntries(listEntries(root));
    t("validate: duplicate citation id flagged", problems.some((p) => /duplicate citation id/.test(p)));
  }

  // FAFF-910: ratified-tradeoff kind detection + validation + reader
  const goodTradeoff =
    "## Single-region health readout\n" +
    "- Chosen: single-region health, no failover probe\n" +
    "- Rationale: the v1 dashboard reads one region only\n" +
    "- Scope: the v1 single-region deployment\n" +
    "- Source-issue: FAFF-910\n" +
    "- Ratified-by: human\n" +
    "- Date: 2026-08-28\n";
  {
    const root = path.join(tmp, "tradeoff-good");
    writeRegister(root, goodTradeoff);
    const e = listEntries(root)[0];
    t("FAFF-910: a Ratified-by line makes kind ratified_tradeoff", e.kind === "ratified_tradeoff");
    t("FAFF-910: valid tradeoff has no validation problems", validateTradeoff(e).length === 0);
    t("FAFF-910: validateEntries clean on a valid tradeoff", validateEntries(listEntries(root)).length === 0);
    const honourable = listRatifiedTradeoffs(root);
    t("FAFF-910: listRatifiedTradeoffs returns the human tradeoff", honourable.length === 1 && honourable[0].id === "single-region-health-readout" && honourable[0].source_issue === "FAFF-910");
    t("FAFF-910: matchDecision ignores a tradeoff (even if it declared Matches)",
      matchDecision(listEntries(root), "single-region health readout") === null);
  }
  // a precedent with no Ratified-by line stays a precedent and is still topic-matchable
  {
    const root = path.join(tmp, "precedent-still");
    writeRegister(root, loggingEntry);
    t("FAFF-910: no Ratified-by line -> kind precedent", listEntries(root)[0].kind === "precedent");
    t("FAFF-910: precedent still matches by topic", matchDecision(listEntries(root), "pino vs winston") !== null);
  }
  // a tradeoff carrying an optional Matches is still absent from matchDecision
  {
    const root = path.join(tmp, "tradeoff-matches");
    writeRegister(root, goodTradeoff.replace("- Date: 2026-08-28\n", "- Matches: single region health\n- Date: 2026-08-28\n"));
    t("FAFF-910: a tradeoff with Matches is absent from matchDecision", matchDecision(listEntries(root), "single region health") === null);
    t("FAFF-910: a tradeoff with Matches still validates + is honourable", listRatifiedTradeoffs(root).length === 1);
  }
  // blank Ratified-by: is a MALFORMED tradeoff, never a precedent fall-through
  {
    const root = path.join(tmp, "tradeoff-blank-rb");
    writeRegister(root,
      "## Blank ratified-by\n- Chosen: x\n- Rationale: y\n- Scope: s\n- Source-issue: FAFF-910\n- Ratified-by: \n- Date: 2026-08-28\n");
    const e = listEntries(root)[0];
    t("FAFF-910: blank Ratified-by: is still kind ratified_tradeoff (lexical presence)", e.kind === "ratified_tradeoff");
    t("FAFF-910: blank Ratified-by: fails validation as a malformed tradeoff", validateTradeoff(e).some((p) => /blank or missing Ratified-by/.test(p)));
    t("FAFF-910: blank Ratified-by: is not honourable", listRatifiedTradeoffs(root).length === 0);
  }
  // Ratified-by: loop is refused, naming FAFF-922
  {
    const root = path.join(tmp, "tradeoff-loop");
    writeRegister(root, goodTradeoff.replace("- Ratified-by: human\n", "- Ratified-by: loop\n"));
    const e = listEntries(root)[0];
    t("FAFF-910: Ratified-by: loop is refused and names FAFF-922", validateTradeoff(e).some((p) => /FAFF-922/.test(p)));
    t("FAFF-910: Ratified-by: loop is not honourable", listRatifiedTradeoffs(root).length === 0);
  }
  // Source-issue shape is enforced
  {
    const root = path.join(tmp, "tradeoff-bad-source");
    writeRegister(root, goodTradeoff.replace("- Source-issue: FAFF-910\n", "- Source-issue: not-a-ticket\n"));
    t("FAFF-910: a bad Source-issue is flagged", validateTradeoff(listEntries(root)[0]).some((p) => /Source-issue/.test(p)));
  }
  // citation-id uniqueness stays GLOBAL across both kinds
  {
    const root = path.join(tmp, "cross-kind-dup");
    writeRegister(root,
      "## Shared topic\n- Chosen: a\n- Rationale: r\n- Scope: s\n- Matches: k\n- Date: 2026-08-28\n\n" +
      "## shared topic\n- Chosen: b\n- Rationale: r2\n- Scope: s2\n- Source-issue: FAFF-910\n- Ratified-by: human\n- Date: 2026-08-28\n");
    t("FAFF-910: duplicate citation id across a precedent and a tradeoff is flagged",
      validateEntries(listEntries(root)).some((p) => /duplicate citation id/.test(p)));
  }

  // kebabSlug
  t("kebabSlug kebabs a topic heading", kebabSlug("Logging library!") === "logging-library");

  // FAFF-929: classifyIntentComment — the deterministic marker classifier shared by faff-prep's
  // reconcile step and faff-graft Step 4c's materialise guard.
  {
    const liveIntent =
      "## Decisions-register intent\n" +
      "- topic: pino vs winston\n" +
      "- Chosen: pino\n" +
      "- Rationale: house structured-JSON logger.\n" +
      "- Scope: all backend services.\n" +
      "- Matches: pino vs winston\n";
    t("classifyIntentComment: an intent comment with no marker line is live",
      (() => { const r = classifyIntentComment(liveIntent); return r.kind === "intent" && r.status === "live"; })());

    const supersededIntent = liveIntent + "\n> Superseded 2026-09-01 (FAFF-929): design dropped the sha256 digest\n";
    t("classifyIntentComment: a marker line makes it superseded",
      (() => { const r = classifyIntentComment(supersededIntent); return r.kind === "intent" && r.status === "superseded"; })());

    const suffixOnly = "## Decisions-register intent (superseded)\n- topic: x\n- Chosen: y\n";
    t("classifyIntentComment: a '(superseded)' heading suffix alone (no marker line) is still live — the marker line, not the suffix, is authoritative",
      (() => { const r = classifyIntentComment(suffixOnly); return r.kind === "intent" && r.status === "live"; })());

    const notIntent = "## ADR promotion intent\n- Decision: use pino\n";
    t("classifyIntentComment: an unrelated comment (e.g. ADR promotion) is not-intent",
      (() => { const r = classifyIntentComment(notIntent); return r.kind === "not-intent" && r.status === null; })());

    t("classifyIntentComment: empty/absent body is not-intent, never throws",
      (() => { const r = classifyIntentComment(""); return r.kind === "not-intent"; })());
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = cases.filter(([, ok]) => !ok);
  for (const [name] of failed) process.stderr.write(`decisions --selftest FAIL: ${name}\n`);
  console.log(`RESULT: ${failed.length ? "FAIL" : "PASS"} (${cases.length - failed.length}/${cases.length})`);
  return failed.length ? 1 : 0;
}

module.exports = { cmdDecisions, classifyIntentComment, decisionsPath, hasFieldLine, kebabSlug, listEntries, listRatifiedTradeoffs, matchDecision, normalizeMatchKey, parseMatches, splitSections, validateEntries, validatePrecedent, validateTradeoff };
