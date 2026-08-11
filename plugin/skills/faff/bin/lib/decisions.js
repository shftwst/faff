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

const DECISIONS_SPEC = { flags: {
  "--json": { arity: 0 }, "--punt": { arity: 1 }, "--root": { arity: 1 }, "--selftest": { arity: 0 },
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

// Match a header field "- Chosen: value" / "- **Chosen:** value" (bold optional, colon
// mandatory — a prose line merely starting with the field word is never mis-read as the
// field). Mirrors adr.js's adrField verbatim (same tolerant shape, different field set).
function decisionField(text, name) {
  const m = text.match(new RegExp(`^[\\s>*-]*${name}[\\s*]*:[\\s*]*([^\\s*].*)$`, "mi"));
  return m ? m[1].trim() : null;
}

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
    return {
      topic: s.topic,
      id: kebabSlug(s.topic),
      chosen: decisionField(s.text, "Chosen"),
      rationale: decisionField(s.text, "Rationale"),
      scope: decisionField(s.text, "Scope"),
      matches: parseMatches(matchesRaw),
      date: decisionField(s.text, "Date"),
      adr: decisionField(s.text, "ADR"),
    };
  });
}

// Structure lint: required fields present + non-empty, matches non-empty, unique citation ids.
// Returns a list of problem strings (empty = valid).
function validateEntries(entries) {
  const problems = [];
  const seenIds = new Map();
  for (const e of entries) {
    if (!e.chosen) problems.push(`${e.topic}: missing Chosen field`);
    if (!e.rationale) problems.push(`${e.topic}: missing Rationale field`);
    if (!e.scope) problems.push(`${e.topic}: missing Scope field`);
    if (!e.date) problems.push(`${e.topic}: missing Date field`);
    if (!e.matches.length) problems.push(`${e.topic}: Matches must be non-empty — an entry with no declared keys can never fire`);
    if (seenIds.has(e.id)) problems.push(`duplicate citation id "${e.id}" — ${seenIds.get(e.id)}, ${e.topic}`);
    else seenIds.set(e.id, e.topic);
  }
  return problems;
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
      console.log(JSON.stringify(entries.map(({ id, topic, chosen, date }) => ({ id, topic, chosen, date })), null, 2));
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

  process.stderr.write("faff decisions: expected one of: match | list | validate (or --selftest)\n");
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

  // kebabSlug
  t("kebabSlug kebabs a topic heading", kebabSlug("Logging library!") === "logging-library");

  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = cases.filter(([, ok]) => !ok);
  for (const [name] of failed) process.stderr.write(`decisions --selftest FAIL: ${name}\n`);
  console.log(`RESULT: ${failed.length ? "FAIL" : "PASS"} (${cases.length - failed.length}/${cases.length})`);
  return failed.length ? 1 : 0;
}

module.exports = { cmdDecisions, decisionsPath, kebabSlug, listEntries, matchDecision, normalizeMatchKey, parseMatches, splitSections, validateEntries };
