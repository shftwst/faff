// ===========================================================================
// === region:factory — github-templates — FAFF-1112: the pure offline GitHub issue-template scanner ===
//   github-templates scan [--type <faff-type>] [--json] [--root DIR]
//     Scans <root>/.github/ISSUE_TEMPLATE/*.md (directory form) and the legacy bare
//     <root>/.github/ISSUE_TEMPLATE.md, parses each file's front matter, and buckets it onto the
//     closed faff-type taxonomy. Emits the classified candidate set the (later) selection verb
//     consumes. Discovery + parsing + type-gating only: no scoring, no selection, no body parse.
//
// PURE: NO MCP, NO network, NO git, NO env discovery, NO subprocess. The whole input is a
// filesystem root; the whole output is a data structure. The detection axis is the REPO (the
// working tree), never `tracking.tracker` — a Linear-pinned, GitHub-hosted repo is still scanned.
//
// Seed, never constrain: every absence and every malformation is a clean miss recorded in
// `dropped`/`notes` at exit 0 — scanning can never throw at its caller.
//
// Classification never fabricates: the type gate returns a substantive type or UNCLASSIFIED and
// NEVER `default`. A directory-form file that fails to classify is dropped; a bare-form file that
// fails to classify becomes a universal candidate (eligible for every type).
//
// `labels: [bug, triage]` (unquoted flow sequence) reads back from parseYamlSubset as a STRING
// (its scalar() only accepts strict JSON). That shared parser is deliberately untouched; the
// shapes are normalised locally by normalizeLabels.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { findRoot, parseYamlSubset } = require("./shared-infra");
const { FAFF_TYPES } = require("./native-map");

const UNCLASSIFIED = "UNCLASSIFIED";

// The five types a template can actually be. `default` is a ticket-type fallback, not a kind of
// template a repo ships, so the gate never emits it.
const SUBSTANTIVE_TYPES = FAFF_TYPES.filter((t) => t !== "default");
const FAFF_TYPE_SET = new Set(FAFF_TYPES);

// Ordered, deterministic: first match wins, top to bottom. `spike` sits ahead of `feature` so an
// RFC-shaped "proposal" is a spike; `feature` is last because request/enhancement are the broadest.
const CLASSIFIER_TABLE = [
  ["bug", /\b(?:bug|defect|regression|crash|fault)\b/i],
  ["spike", /\b(?:spike|investigat(?:e|ion)|research|discovery|rfc)\b/i],
  ["chore", /\b(?:chore|maintenance|dependenc(?:y|ies)|refactor|cleanup|housekeeping)\b/i],
  ["epic", /\b(?:epic|initiative|tracking issue|meta|parent)\b/i],
  ["feature", /\b(?:feature|enhancement|request|idea|proposal)\b/i],
];

const DIR_REL = ".github/ISSUE_TEMPLATE";
const BARE_REL = ".github/ISSUE_TEMPLATE.md";

const GITHUB_TEMPLATES_SPEC = {
  flags: {
    "--type": { arity: 1 },
    "--json": { arity: 0 },
    "--root": { arity: 1 },
    "--selftest": { arity: 0 },
  },
  positionals: { min: 0, max: 1, name: "verb" },
};

const GITHUB_TEMPLATES_SURFACE = {
  kind: "subcommand_dispatch",
  spec: GITHUB_TEMPLATES_SPEC,
  subcommands: {
    scan: { required_flags: [] },
  },
};

const GITHUB_TEMPLATES_USAGE =
  `usage: faff github-templates scan [--type <${FAFF_TYPES.join("|")}>] [--json] [--root DIR]`;

// ---------------------------------------------------------------------------
// Front matter. Never throws.
// ---------------------------------------------------------------------------

function stringOrNull(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

function stripMatchingQuotes(s) {
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' || a === "'") && a === b) return s.slice(1, -1);
  }
  return s;
}

// Every shape the GitHub `labels:` key takes -> List<String>. Absent / boolean / number -> [].
function normalizeLabels(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value
      .map((x) => (x === null || x === undefined || typeof x === "object" ? "" : String(x).trim()))
      .filter((x) => x !== "");
  }
  if (typeof value === "string") {
    let s = value.trim();
    if (s.startsWith("[") && s.endsWith("]")) {
      s = s.slice(1, -1);
    } else if (s.startsWith("[")) {
      return []; // an unterminated flow sequence is a malformation, never a label
    } else {
      return s === "" ? [] : [s];
    }
    return s
      .split(",")
      .map((p) => stripMatchingQuotes(p.trim()).trim())
      .filter((p) => p !== "");
  }
  return [];
}

// { name, about, labels } from a template's text. parseYamlSubset runs on the fence CONTENTS only
// (it is not document-aware: a whole-file parse would read body headings as key lines).
function parseFrontMatter(text) {
  const empty = { name: null, about: null, labels: [] };
  try {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text).replace(/^﻿/, ""));
    if (!m) return empty;
    const map = parseYamlSubset(m[1]);
    if (map === null || typeof map !== "object" || Array.isArray(map)) return empty;
    return { name: stringOrNull(map.name), about: stringOrNull(map.about), labels: normalizeLabels(map.labels) };
  } catch {
    return empty;
  }
}

// SubstantiveType | UNCLASSIFIED. Signal precedence labels > name > about; first table match wins.
function classify(parsed) {
  const signals = [parsed.labels.join(" "), parsed.name || "", parsed.about || ""];
  for (const signal of signals) {
    if (signal.trim() === "") continue;
    for (const [type, pattern] of CLASSIFIER_TABLE) {
      if (pattern.test(signal)) return type;
    }
  }
  return UNCLASSIFIED;
}

// ---------------------------------------------------------------------------
// Scan. Never throws.
// ---------------------------------------------------------------------------

function readText(abs) {
  try {
    return { ok: true, text: fs.readFileSync(abs, "utf8") };
  } catch (e) {
    return { ok: false, reason: (e && e.code) || "read error" };
  }
}

function isDirectory(abs) {
  try { return fs.statSync(abs).isDirectory(); } catch { return false; }
}

// lstat, not stat: a symlink (possibly pointing outside the tree) or a FIFO is not a regular
// file, so it is skipped rather than read (a FIFO read would block the scan indefinitely).
function isFile(abs) {
  try { return fs.lstatSync(abs).isFile(); } catch { return false; }
}

const byteCompare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

function scan(root) {
  const result = { root, candidates: [], dropped: [], notes: [] };
  const dropped = (p, reason) => result.dropped.push({ path: p, reason });
  const unreadable = (p, why) => {
    dropped(p, "unreadable");
    result.notes.push(`${p}: unreadable (${why})`);
  };

  const dirAbs = path.join(root, ".github", "ISSUE_TEMPLATE");
  if (isDirectory(dirAbs)) {
    let names = [];
    try { names = fs.readdirSync(dirAbs); } catch (e) {
      result.notes.push(`${DIR_REL}: directory unreadable (${(e && e.code) || "read error"})`);
    }
    names.sort(byteCompare);
    for (const name of names) {
      const rel = `${DIR_REL}/${name}`;
      const abs = path.join(dirAbs, name);
      if (!isFile(abs)) continue; // a nested directory is not a candidate
      const lower = name.toLowerCase();
      if (lower === "config.yml" || lower === "config.yaml") { dropped(rel, "excluded-config"); continue; }
      if (path.extname(lower) !== ".md") { dropped(rel, "not-markdown"); continue; }
      const read = readText(abs);
      if (!read.ok) { unreadable(rel, read.reason); continue; }
      const parsed = parseFrontMatter(read.text);
      const type = classify(parsed);
      if (type === UNCLASSIFIED) { dropped(rel, "unclassified"); continue; }
      result.candidates.push({
        path: rel, form: "directory", name: parsed.name, about: parsed.about,
        labels: parsed.labels, type, universal: false,
      });
    }
  }

  // The bare arm is independent of the directory arm (not an else branch).
  const bareAbs = path.join(root, ".github", "ISSUE_TEMPLATE.md");
  if (isFile(bareAbs)) {
    const read = readText(bareAbs);
    if (!read.ok) {
      unreadable(BARE_REL, read.reason);
    } else {
      const parsed = parseFrontMatter(read.text);
      const type = classify(parsed);
      const universal = type === UNCLASSIFIED;
      result.candidates.push({
        path: BARE_REL, form: "bare", name: parsed.name, about: parsed.about,
        labels: parsed.labels, type: universal ? null : type, universal,
      });
    }
  }

  result.candidates.sort((a, b) => {
    if (a.universal !== b.universal) return a.universal ? 1 : -1;
    return byteCompare(a.path, b.path);
  });
  return result;
}

// Candidate set for one faff type: that type's candidates plus every universal candidate.
function candidateSetFor(candidates, type) {
  return candidates.filter((c) => c.universal || c.type === type);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function cmdGithubTemplatesScan(values, root) {
  const json = !!values["--json"];
  const type = values["--type"];
  if (type !== undefined && !FAFF_TYPE_SET.has(type)) {
    return usageError(
      [{ code: "bad-enum", flag: "--type", detail: `unknown faff type '${type}'. Accepted: ${FAFF_TYPES.join(", ")}` }],
      GITHUB_TEMPLATES_USAGE,
    );
  }
  const result = scan(root);
  const out = type === undefined
    ? result
    : { root: result.root, type, candidates: candidateSetFor(result.candidates, type), dropped: result.dropped, notes: result.notes };
  if (json) {
    console.log(JSON.stringify(out));
    return 0;
  }
  if (!out.candidates.length) console.log("no candidates");
  for (const c of out.candidates) {
    console.log(`${c.universal ? "universal" : c.type}\t${c.form}\t${c.path}`);
  }
  for (const d of out.dropped) console.log(`dropped\t${d.reason}\t${d.path}`);
  for (const n of out.notes) console.log(`note\t${n}`);
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test (fixtures built with fs.mkdtempSync; no os module needed).
// ---------------------------------------------------------------------------

function githubTemplatesSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };
  const base = process.env.TMPDIR || process.env.TEMP || "/tmp";
  const roots = [];
  const mk = (files) => {
    const r = fs.mkdtempSync(path.join(base, "faff-ght-"));
    roots.push(r);
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(r, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    return r;
  };
  const fm = (lines, body = "## Repro\n") => `---\n${lines.join("\n")}\n---\n${body}`;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  try {
    const bug = scan(mk({ ".github/ISSUE_TEMPLATE/bug_report.md": fm(["name: Bug report", "about: Report a defect", "labels: [bug, triage]"]) }));
    check("bug: one candidate, typed bug, not universal",
      bug.candidates.length === 1 && bug.candidates[0].type === "bug" && bug.candidates[0].universal === false);
    check("bug: unquoted flow labels normalised", eq(bug.candidates[0].labels, ["bug", "triage"]));
    check("bug: nothing dropped", bug.dropped.length === 0);

    const none = scan(mk({ "README.md": "x" }));
    check("none: zero candidates, zero notes", none.candidates.length === 0 && none.notes.length === 0);
    check("missing root is a miss, not a throw", scan(path.join(base, "faff-ght-does-not-exist")).candidates.length === 0);

    const cfg = scan(mk({ ".github/ISSUE_TEMPLATE/config.yml": "blank_issues_enabled: false\n" }));
    check("config-only: no candidates, dropped excluded-config",
      cfg.candidates.length === 0 && eq(cfg.dropped, [{ path: ".github/ISSUE_TEMPLATE/config.yml", reason: "excluded-config" }]));
    const cfgBare = scan(mk({ ".github/ISSUE_TEMPLATE/CONFIG.YAML": "x: 1\n", ".github/ISSUE_TEMPLATE.md": "generic\n" }));
    check("config-only + bare: bare arm still runs, universal", cfgBare.candidates.length === 1 && cfgBare.candidates[0].universal === true);

    const unc = scan(mk({ ".github/ISSUE_TEMPLATE/notes.md": fm(["name: Notes"]) }));
    check("directory unclassified: dropped, no universal fallback",
      unc.candidates.length === 0 && eq(unc.dropped, [{ path: ".github/ISSUE_TEMPLATE/notes.md", reason: "unclassified" }]));

    const bareU = scan(mk({ ".github/ISSUE_TEMPLATE.md": "## Describe\n" }));
    check("bare, no fence: universal, type null, form bare",
      bareU.candidates.length === 1 && bareU.candidates[0].type === null && bareU.candidates[0].universal === true && bareU.candidates[0].form === "bare");
    check("bare universal appears in all six candidate sets", FAFF_TYPES.every((t) => candidateSetFor(bareU.candidates, t).length === 1));

    const bareBug = scan(mk({ ".github/ISSUE_TEMPLATE.md": fm(["name: Bug report"]) }));
    check("bare, classifies: single-type candidate",
      bareBug.candidates[0].type === "bug" && bareBug.candidates[0].universal === false
      && candidateSetFor(bareBug.candidates, "feature").length === 0);

    const typed = scan(mk({ ".github/ISSUE_TEMPLATE/bug.md": fm(["name: Bug"]) }));
    check("--type default with only typed templates: empty set", candidateSetFor(typed.candidates, "default").length === 0);
    check("gate never emits default", FAFF_TYPES.every((t) => t !== "default" || classify({ name: "default", about: null, labels: [] }) === UNCLASSIFIED));

    const rfc = scan(mk({ ".github/ISSUE_TEMPLATE/rfc.md": fm(["name: RFC proposal"]) }));
    check("RFC proposal is a spike, not a feature", rfc.candidates[0].type === "spike");
    check("labels beat name", classify({ labels: ["chore"], name: "Bug report", about: null }) === "chore");
    check("name beats about", classify({ labels: [], name: "Feature", about: "a bug" }) === "feature");

    const mixed = scan(mk({
      ".github/ISSUE_TEMPLATE/z.md": fm(["name: Bug"]),
      ".github/ISSUE_TEMPLATE/a.md": fm(["name: Bug"]),
      ".github/ISSUE_TEMPLATE/form.yml": "name: Form\n",
      ".github/ISSUE_TEMPLATE/nested/x.md": fm(["name: Bug"]),
      ".github/ISSUE_TEMPLATE.md": "generic\n",
    }));
    check("same-type templates both kept, sorted by path, universal last",
      eq(mixed.candidates.map((c) => c.path), [".github/ISSUE_TEMPLATE/a.md", ".github/ISSUE_TEMPLATE/z.md", ".github/ISSUE_TEMPLATE.md"]));
    check("non-markdown dropped; nested dir silent",
      eq(mixed.dropped, [{ path: ".github/ISSUE_TEMPLATE/form.yml", reason: "not-markdown" }]));
    check("invariants: universal === (type === null), universal => bare",
      mixed.candidates.every((c) => c.universal === (c.type === null) && (!c.universal || c.form === "bare")));
    check("deterministic output", JSON.stringify(scan(mixed.root)) === JSON.stringify(mixed));

    const nofm = scan(mk({ ".github/ISSUE_TEMPLATE/p.md": "# Bug\n## name: Bug\nlabels: [bug]\n" }));
    check("no fence: body is not read as keys", nofm.candidates.length === 0);

    const lab = (line) => parseFrontMatter(fm([line])).labels;
    check("labels: unquoted flow", eq(lab("labels: [bug, triage]"), ["bug", "triage"]));
    check("labels: JSON flow", eq(lab('labels: ["bug","triage"]'), ["bug", "triage"]));
    check("labels: quoted flow string", eq(lab("labels: '[bug, triage]'"), ["bug", "triage"]));
    check("labels: block sequence", eq(parseFrontMatter(fm(["labels:", "  - bug", "  - triage"])).labels, ["bug", "triage"]));
    check("labels: scalar", eq(lab("labels: bug"), ["bug"]));
    check("labels: empty / boolean / number / absent",
      eq(lab("labels: []"), []) && eq(lab("labels: true"), []) && eq(lab("labels: 3"), []) && eq(parseFrontMatter(fm(["name: x"])).labels, []));
    check("labels: single-element flow", eq(lab("labels: [bug]"), ["bug"]));
    check("labels: unterminated flow is a miss", eq(lab("labels: [bug, triage"), []));
    {
      const sl = mk({ ".github/ISSUE_TEMPLATE/real.md": fm(["name: Bug"]) });
      fs.symlinkSync(path.join(sl, ".github/ISSUE_TEMPLATE/real.md"), path.join(sl, ".github/ISSUE_TEMPLATE/link.md"));
      check("symlinked template is skipped, not read", eq(scan(sl).candidates.map((c) => c.path), [".github/ISSUE_TEMPLATE/real.md"]));
    }

    if (process.getuid && process.getuid() !== 0) {
      const un = mk({ ".github/ISSUE_TEMPLATE/ok.md": fm(["name: Bug"]), ".github/ISSUE_TEMPLATE/locked.md": fm(["name: Bug"]) });
      fs.chmodSync(path.join(un, ".github/ISSUE_TEMPLATE/locked.md"), 0o000);
      const r = scan(un);
      check("unreadable: dropped + noted, scan continues",
        r.candidates.length === 1 && r.dropped.some((d) => d.reason === "unreadable") && r.notes.length === 1);
      fs.chmodSync(path.join(un, ".github/ISSUE_TEMPLATE/locked.md"), 0o600);
    }

    check("classifier table types are all in the taxonomy", CLASSIFIER_TABLE.every(([t]) => SUBSTANTIVE_TYPES.includes(t)));
  } finally {
    for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (github-templates, ${fail} failed)`);
  return fail ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Dispatch. `github-templates scan [flags]`.
// ---------------------------------------------------------------------------

function cmdGithubTemplates(args) {
  const gate = parseArgs(args, GITHUB_TEMPLATES_SPEC);
  if (gate.errors.length) return usageError(gate.errors, GITHUB_TEMPLATES_USAGE);
  if (gate.values["--selftest"]) return githubTemplatesSelftest();

  const root = gate.values["--root"] || findRoot();
  if (gate.positionals[0] === "scan") return cmdGithubTemplatesScan(gate.values, root);

  process.stderr.write("faff github-templates: expected the subcommand 'scan' (or --selftest)\n");
  return 2;
}

module.exports = {
  UNCLASSIFIED, CLASSIFIER_TABLE, GITHUB_TEMPLATES_SPEC, GITHUB_TEMPLATES_SURFACE,
  cmdGithubTemplates, cmdGithubTemplatesScan, githubTemplatesSelftest,
  scan, candidateSetFor, classify, parseFrontMatter, normalizeLabels,
};
