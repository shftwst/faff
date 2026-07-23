// FAFF-538 — CLI-surface drift-guard for the external-verification scaffolders.
//
// The six SUT scaffolders (docs/external-verification/scaffold-p{1..5}-*.sh + scaffold-faff-lab.sh)
// embed `.faffrc.yaml` + `RUNBOOK.md` here-docs of faff CLI gestures that rot silently as the CLI
// surface moves — already three manual repair passes (FAFF-512/513/524/529), each caught only by a
// human eyeballing the scripts against main. This static guard makes a stale scaffolder fail CI
// instead: it extracts the here-docs and asserts every embedded `faff` verb/subcommand and every
// `.faffrc` slot key still exists on the LIVE CLI surface.
//
// The load-bearing model (per the FAFF-538 spec): the CLI's own registries are the single source of
// truth for "what exists", and the guard checks embedded gestures by IMPORTING those registries,
// never by re-listing them — a hand-maintained allowlist would just be the same drift one layer up.
//   - verbs        ← Object.keys(COMMANDS), imported from the entrypoint (FAFF-538 export).
//   - subcommands  ← each verb's own bare-invocation usage string (memoised probe; FAFF-628 will
//                    replace the parsing with a `faff cli-surface --json` introspection command).
//   - config keys  ← DEFAULTS / VALID_APPETITES / model+effort lane validators from config.js.
//
// v1 SCOPE (both scope Punts closed by a human Decision via /faff-tidy 2026-07-23): verb + subcommand
// EXISTENCE only. Flag-level validation and the introspection command are follow-up FAFF-628. This is
// a surface/parse guard — it never executes an embedded command with real args; the only CLI calls it
// makes are bare, side-effect-free usage probes. It COMPLEMENTS scaffolder-lights-out-dials.test.mjs
// (L4 dial coherence over the same here-docs) — an orthogonal property, no restatement of dial checks.
// Fail loud, never skip: a missing here-doc or an unclassifiable verb is a FAILURE (FAFF-274 posture).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import { extractHeredoc } from "./helpers/scaffolder-heredocs.mjs";
import faffEntry from "../plugin/skills/faff/bin/faff";
import {
  DEFAULTS,
  VALID_APPETITES,
  validateModelLane,
  validateEffortLane,
} from "../plugin/skills/faff/bin/lib/config.js";

const { COMMANDS } = faffEntry;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const EV_DIR = path.join(REPO, "docs", "external-verification");
const SKILLS_DIR = path.join(REPO, "plugin", "skills");

// The six scaffolders the guard iterates. Discovered by glob so a future scaffolder is auto-covered;
// the canonical six are asserted present (a rename/removal is a real finding worth failing on).
const CANONICAL_SIX = [
  "scaffold-p1-link-shortener.sh",
  "scaffold-p2-task-api.sh",
  "scaffold-p3-landing-page.sh",
  "scaffold-p4-stripe-testmode.sh",
  "scaffold-p5-brownfield.sh",
  "scaffold-faff-lab.sh",
];
const SCAFFOLDERS = fs.readdirSync(EV_DIR).filter((f) => /^scaffold-.*\.sh$/.test(f)).sort();

function readScript(name) {
  return fs.readFileSync(path.join(EV_DIR, name), "utf8");
}

// --- verb set (imported, never re-listed) ---------------------------------------------------------

function validVerbs() {
  return new Set(Object.keys(COMMANDS));
}

// --- verb/subcommand surface (bare-invocation usage probe, memoised one spawn per verb per run) ----

const _surfaceCache = new Map();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Run `faff <verb>` bare (side-effect-free — usage output only) and classify it:
//   - subcommand_dispatch: bare invocation enumerates its second-token vocabulary, in one of two
//     observed forms — `expected one of[:] a | b | c [(or --selftest)]` (prd/prdr/env/config/adr/
//     profile/…) or a `usage:\n  faff <verb> <sub> …` block (holdout).
//   - positional: bare invocation emits a non-enumeration diagnostic (audit/next/state) — its first
//     argument is data, not a subcommand, so it is validated at verb level only.
function verbSurface(verb) {
  if (_surfaceCache.has(verb)) return _surfaceCache.get(verb);
  const { stdout, stderr } = runCli([verb]);
  const out = (stdout || "") + (stderr || "");
  let surface;
  const m = out.match(/expected one of:?\s*(.+?)\s*(?:\(or\b|$)/);
  if (m) {
    const subs = m[1]
      .split("|")
      .map((s) => s.trim())
      .map((s) => s.replace(/\s*\[--.*$/, "")) // strip a trailing " [--strict]"-style annotation
      .filter(Boolean);
    surface = { name: verb, kind: "subcommand_dispatch", subcommands: new Set(subs) };
  } else {
    const u = out.match(new RegExp(`^faff ${reEsc(verb)}: usage:\\n\\s*faff ${reEsc(verb)} (\\w[\\w-]*)`, "m"));
    if (u) {
      surface = { name: verb, kind: "subcommand_dispatch", subcommands: new Set([u[1]]) };
    } else {
      surface = { name: verb, kind: "positional", subcommands: new Set() };
    }
  }
  _surfaceCache.set(verb, surface);
  return surface;
}

// --- runbook command parsing ----------------------------------------------------------------------

// Collect every `faff …` gesture cited in a RUNBOOK from the two forms the scaffolders use: a
// 4-space-indented command block, or an inline-backtick span. Prose mentions ("the main faff repo",
// "references to faff are lowercase") sit in neither and are excluded; a commented-out (`# faff …`)
// or `/faff-graft` line is excluded because the command token must be exactly `faff`.
function parseEmbeddedFaffCommands(runbookBody, source) {
  const collected = [];
  const push = (tail, rawLine) => {
    const parts = tail.trim().split(/\s+/);
    const verb = parts[0];
    if (!verb || !/^[\w-]+$/.test(verb)) return; // not a real verb token
    // second token is a subcommand iff it is a bare word — not a flag (--…/-…), a placeholder
    // (<…>), a quoted arg ('…/"…), or a $VAR.
    const t = parts[1];
    const subcommand = t && /^[A-Za-z][\w-]*$/.test(t) ? t : null;
    collected.push({ verb, subcommand, raw: rawLine.trim(), source });
  };
  for (const line of runbookBody.split("\n")) {
    const m = line.match(/^\s{4,}faff\s+(.*)$/); // 4-space-indented command block
    if (m) push(m[1], line);
  }
  for (const bm of runbookBody.matchAll(/`faff\s+([^`]+)`/g)) {
    push(bm[1], "`faff " + bm[1] + "`"); // inline-backtick span
  }
  // dedupe identical (verb, subcommand) pairs so one probe covers repeated citations
  const seen = new Set();
  const out = [];
  for (const c of collected) {
    const k = c.verb + "\x00" + (c.subcommand ?? "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// Assert each RUNBOOK verb exists (COMMANDS registry) and each subcommand (where the verb dispatches
// on one) is in that verb's live vocabulary. Returns an array of finding strings (empty == clean).
function runbookFindings(body, source) {
  const findings = [];
  const verbs = validVerbs();
  for (const cmd of parseEmbeddedFaffCommands(body, source)) {
    if (!verbs.has(cmd.verb)) {
      findings.push(`${cmd.source}: \`faff ${cmd.verb}\` is not a live verb (COMMANDS registry) — raw: ${cmd.raw}`);
      continue;
    }
    const surface = verbSurface(cmd.verb);
    if (surface.kind === "positional" || cmd.subcommand == null) continue; // verb-existence only
    if (!surface.subcommands.has(cmd.subcommand)) {
      const set = [...surface.subcommands].sort().join(",");
      findings.push(
        `${cmd.source}: \`faff ${cmd.verb} ${cmd.subcommand}\` — ${cmd.subcommand} ∉ {${set}} — raw: ${cmd.raw}`,
      );
    }
  }
  return findings;
}

// --- config-key half ------------------------------------------------------------------------------

// Extract dotted keys + scalar values from an embedded `.faffrc.yaml` body. A minimal indent-stack
// walk of the documented YAML subset — enough to key `slots.*`, `appetite`, `models.*`, `effort.*`;
// deeper namespaced blocks (backends.*, budget.*, faffter_dark.*, tracking.*) round-trip as tolerated
// keys their own validators own (see OUT OF SCOPE — deep grammar).
function extractFaffrcKeys(body) {
  const out = [];
  const parents = []; // {indent, key}
  for (const rawLine of body.split("\n")) {
    if (/^\s*#/.test(rawLine) || /^\s*$/.test(rawLine)) continue; // comment / blank
    const line = rawLine.replace(/\s+#.*$/, ""); // strip a trailing " # comment"
    if (/^\s*-\s/.test(line)) continue; // list item
    const m = line.match(/^(\s*)([\w.-]+):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2];
    const value = m[3].trim();
    while (parents.length && parents[parents.length - 1].indent >= indent) parents.pop();
    const dotted = [...parents.map((p) => p.key), key].join(".");
    out.push({ key: dotted, value });
    if (value === "") parents.push({ indent, key }); // a block header
  }
  return out;
}

const slotKeysOfDefaults = new Set(Object.keys(DEFAULTS).filter((k) => k.startsWith("slots.")));

function skillDirExists(name) {
  return fs.existsSync(path.join(SKILLS_DIR, name, "SKILL.md"));
}

// Assert every slot key is a recognised slot, every in-repo slot occupant resolves to a real skill,
// and enumerated scalars (appetite, model/effort lanes) carry legal values. Returns finding strings.
function faffrcFindings(body, source) {
  const findings = [];
  for (const { key, value } of extractFaffrcKeys(body)) {
    if (key.startsWith("slots.")) {
      if (!slotKeysOfDefaults.has(key)) {
        findings.push(`${source}: unknown slot key ${key} (not in the config schema)`);
      } else if (value && !value.includes(":") && /^[\w-]+$/.test(value) && !skillDirExists(value)) {
        // a bare (in-repo) occupant must resolve; a namespaced `plugin:skill` value is out-of-repo, skipped
        findings.push(`${source}: slot ${key} points at ${value}, which is not a skill under plugin/skills/`);
      }
    } else if (key === "appetite") {
      if (value && !VALID_APPETITES.has(value)) {
        findings.push(`${source}: appetite=${value} ∉ {${[...VALID_APPETITES].join(", ")}}`);
      }
    } else if (key.startsWith("models.")) {
      const err = validateModelLane(key, value);
      if (err) findings.push(`${source}: ${err}`);
    } else if (key.startsWith("effort.")) {
      const err = validateEffortLane(key, value);
      if (err) findings.push(`${source}: ${err}`);
    }
    // else: namespaced blocks tolerated — validated by their own commands, not a central schema.
  }
  return findings;
}

// ==================================================================================================
// TESTS
// ==================================================================================================

test("all six canonical scaffolders are present and discovered", () => {
  for (const name of CANONICAL_SIX) {
    assert.ok(SCAFFOLDERS.includes(name), `expected scaffolder ${name} under docs/external-verification/`);
  }
  assert.ok(SCAFFOLDERS.length >= 6, `expected >=6 scaffolders, found ${SCAFFOLDERS.length}`);
});

// The main guard: every live scaffolder's RUNBOOK commands + .faffrc keys must be current. GREEN on
// the repo as-is (a regression guard, not a standing red); a stale gesture turns it red in CI.
for (const name of SCAFFOLDERS) {
  test(`${name}: RUNBOOK.md faff verbs/subcommands exist on the live CLI surface`, () => {
    const script = readScript(name);
    const body = extractHeredoc(script, "RUNBOOK.md");
    assert.notStrictEqual(body, null, `${name}: no RUNBOOK.md here-doc (fail loud, never skip)`);
    const findings = runbookFindings(body, `${name}:RUNBOOK.md`);
    assert.deepStrictEqual(findings, [], "\n" + findings.join("\n"));
  });

  test(`${name}: .faffrc.yaml slot keys/occupants/scalars are valid against config.js`, () => {
    const script = readScript(name);
    const body = extractHeredoc(script, ".faffrc.yaml");
    assert.notStrictEqual(body, null, `${name}: no .faffrc.yaml here-doc (fail loud, never skip)`);
    const findings = faffrcFindings(body, name);
    assert.deepStrictEqual(findings, [], "\n" + findings.join("\n"));
  });
}

// Self-test: pin the verbSurface parser against each observed usage-format variant + the positional
// verbs, so a future usage-string format drift fails HERE loudly (and is the trigger to graduate to
// the FAFF-628 `cli-surface --json` introspection command).
test("verbSurface classifies all observed usage-format variants", () => {
  // subcommand-dispatch verbs, with a known member from each's live vocabulary
  const expectDispatch = {
    prd: "new", // colon form: `expected one of: …`
    prdr: "coverage",
    adr: "new",
    env: "up", // no-colon form: `expected one of …`
    config: "get",
    profile: "show",
    holdout: "verdicts", // `usage:\n  faff holdout <sub> …` form
  };
  for (const [verb, member] of Object.entries(expectDispatch)) {
    const s = verbSurface(verb);
    assert.strictEqual(s.kind, "subcommand_dispatch", `${verb} should be subcommand_dispatch`);
    assert.ok(s.subcommands.size > 0, `${verb} should parse a non-empty subcommand set`);
    assert.ok(s.subcommands.has(member), `${verb} vocabulary should contain '${member}' — got {${[...s.subcommands].sort()}}`);
  }
  for (const verb of ["audit", "next", "state"]) {
    const s = verbSurface(verb);
    assert.strictEqual(s.kind, "positional", `${verb} should be positional`);
    assert.strictEqual(s.subcommands.size, 0, `${verb} should carry no subcommand set`);
  }
});

// Negative scenarios (spec §5) — the guard FAILS on the drift classes it exists to catch.
test("a phantom subcommand (prd admit) is caught, naming prd's live set", () => {
  const findings = runbookFindings("    faff prd admit\n", "fixture:RUNBOOK.md");
  assert.strictEqual(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /admit ∉ \{/);
  assert.match(findings[0], /new/); // prd's live set is named
});

test("a phantom top-level verb (frobnicate) is caught against the COMMANDS registry", () => {
  const findings = runbookFindings("    faff frobnicate x\n", "fixture:RUNBOOK.md");
  assert.strictEqual(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /frobnicate/);
  assert.match(findings[0], /not a live verb/);
});

test("a valid embedded command (prd list) produces no finding", () => {
  assert.deepStrictEqual(runbookFindings("    faff prd list\n", "fixture:RUNBOOK.md"), []);
});

test("an empty embedded-command list passes without firing assertions", () => {
  assert.deepStrictEqual(runbookFindings("Some prose about the faff-lab repo, no commands here.\n", "fixture"), []);
});

test("an unknown .faffrc slot key (slots.spec_reviewer) is caught", () => {
  const findings = faffrcFindings("slots:\n  spec_reviewer: faffter-noon-spec\n", "fixture");
  assert.strictEqual(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /spec_reviewer/);
  assert.match(findings[0], /not in the config schema/);
});

test("a slot pointing at a non-existent in-repo skill (the FAFF-513 rename class) is caught", () => {
  const findings = faffrcFindings("slots:\n  review: no-such-skill-zzz\n", "fixture");
  assert.strictEqual(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /no-such-skill-zzz/);
  assert.match(findings[0], /not a skill under plugin\/skills\//);
});

test("a namespaced (plugin:skill) slot occupant is skipped, not failed", () => {
  assert.deepStrictEqual(faffrcFindings("slots:\n  review: gstack:review\n", "fixture"), []);
});

test("an illegal appetite value is caught", () => {
  const findings = faffrcFindings("appetite: reckless\n", "fixture");
  assert.strictEqual(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /appetite=reckless/);
});

// Integration smoke test (spec §8) — inject a phantom into a REAL scaffolder body, prove it fails,
// then prove the untouched body is green.
test("integration smoke: a phantom line injected into a real scaffolder body fails; the original passes", () => {
  const script = readScript("scaffold-p2-task-api.sh");
  const body = extractHeredoc(script, "RUNBOOK.md");
  assert.notStrictEqual(body, null);
  const injected = body + "\n    faff prd admit\n";
  const injectedFindings = runbookFindings(injected, "scaffold-p2-task-api.sh:RUNBOOK.md");
  assert.ok(injectedFindings.some((f) => /admit ∉ \{/.test(f)), injectedFindings.join("\n"));
  assert.deepStrictEqual(runbookFindings(body, "scaffold-p2-task-api.sh:RUNBOOK.md"), []);
});
