// FAFF-538/628 — CLI-surface drift-guard for the external-verification scaffolders.
//
// The six SUT scaffolders (verification/external-verification/scaffold-p{1..5}-*.sh + scaffold-faff-lab.sh)
// embed `.faffrc.yaml` + `RUNBOOK.md` here-docs of faff CLI gestures that rot silently as the CLI
// surface moves — already three manual repair passes (FAFF-512/513/524/529), each caught only by a
// human eyeballing the scripts against main. This static guard makes a stale scaffolder fail CI
// instead: it extracts the here-docs and asserts every embedded `faff` verb/subcommand/flag still
// exists on the LIVE CLI surface.
//
// The load-bearing model: the CLI's own registries are the single source of truth for "what
// exists", and the guard checks embedded gestures by IMPORTING those registries, never by
// re-listing them — a hand-maintained allowlist would just be the same drift one layer up.
//   - verbs                 ← Object.keys(COMMANDS), imported from the entrypoint (FAFF-538 export).
//   - subcommands + flags   ← lib/cli-surface.js's SURFACES map (FAFF-628) — the SAME declared
//                             grammar `faff cli-surface --json` emits, imported directly (no spawn).
//   - config keys           ← DEFAULTS / VALID_APPETITES / model+effort lane validators from config.js.
//
// FAFF-628 SCOPE: verb + subcommand existence (unchanged from v1) PLUS flag-layer assertions —
// an unknown flag, or a missing declared-required flag — on 4-space-indented command-block lines
// only (never inline-backtick spans, which legitimately abbreviate). The guard is now FULLY
// STATIC: it spawns ZERO CLI processes (the v1 bare-invocation usage-string probe is retired). It
// COMPLEMENTS scaffolder-lights-out-dials.test.mjs (L4 dial coherence over the same here-docs) —
// an orthogonal property, no restatement of dial checks. Fail loud, never skip: a missing here-doc
// or an unclassifiable verb is a FAILURE (FAFF-274 posture).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractHeredoc } from "./helpers/scaffolder-heredocs.mjs";
import faffEntry from "../plugin/skills/faff/bin/faff";
import cliSurfaceEntry from "../plugin/skills/faff/bin/lib/cli-surface.js";
import {
  DEFAULTS,
  VALID_APPETITES,
  validateModelLane,
  validateEffortLane,
} from "../plugin/skills/faff/bin/lib/config.js";

const { COMMANDS } = faffEntry;
const { assembleSurfaces, acceptedFlags } = cliSurfaceEntry;
// The declared grammar — built ONCE, from the SAME COMMANDS registry `faff cli-surface --json`
// itself reads (assembleSurfaces takes COMMANDS as a parameter — see lib/cli-surface.js's header
// for why it isn't imported from ../faff at module scope).
const SURFACES = assembleSurfaces(COMMANDS);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const EV_DIR = path.join(REPO, "verification", "external-verification");
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

// CONFIG-FREE scaffolders (FAFF-360): a member deliberately writes NO `.faffrc.yaml` here-doc (its
// SUT installs no factory config), so for it the guard asserts that here-doc is ABSENT rather than
// present, while still requiring its `RUNBOOK.md` here-doc and linting every embedded `faff` gesture
// exactly as for the config-bearing rungs.
const CONFIG_FREE = new Set(["scaffold-commissaire-bare-claude.sh"]);

function readScript(name) {
  return fs.readFileSync(path.join(EV_DIR, name), "utf8");
}

// --- verb set (imported, never re-listed) ---------------------------------------------------------

function validVerbs() {
  return new Set(Object.keys(COMMANDS));
}

// --- runbook command parsing ----------------------------------------------------------------------

// Collect every `faff …` gesture cited in a RUNBOOK from the two forms the scaffolders use: a
// 4-space-indented command block, or an inline-backtick span. Prose mentions ("the main faff repo",
// "references to faff are lowercase") sit in neither and are excluded; a commented-out (`# faff …`)
// or `/faff-graft` line is excluded because the command token must be exactly `faff`.
//
// FAFF-628: command-block lines also capture their ordered `--flag` tokens (name only — a
// `--flag=value` form is split on `=`; nothing after a bare `--` end-of-flags sentinel is
// collected). Flag-layer assertions fire ONLY on command-block lines (`isCommandBlock: true`) —
// inline-backtick spans legitimately abbreviate a mention without its flags.
function parseEmbeddedFaffCommands(runbookBody, source) {
  const collected = [];
  const push = (tail, rawLine, isCommandBlock) => {
    const parts = tail.trim().split(/\s+/);
    const verb = parts[0];
    if (!verb || !/^[\w-]+$/.test(verb)) return; // not a real verb token
    // second token is a subcommand iff it is a bare word — not a flag (--…/-…), a placeholder
    // (<…>), a quoted arg ('…/"…), or a $VAR.
    const t = parts[1];
    const subcommand = t && /^[A-Za-z][\w-]*$/.test(t) ? t : null;
    const flags = [];
    if (isCommandBlock) {
      for (const tok of parts.slice(1)) {
        if (tok === "--") break;
        if (tok.startsWith("--")) flags.push(tok.split("=")[0]);
      }
    }
    collected.push({ verb, subcommand, raw: rawLine.trim(), source, flags, isCommandBlock });
  };
  for (const line of runbookBody.split("\n")) {
    const m = line.match(/^\s{4,}faff\s+(.*)$/); // 4-space-indented command block
    if (m) push(m[1], line, true);
  }
  for (const bm of runbookBody.matchAll(/`faff\s+([^`]+)`/g)) {
    push(bm[1], "`faff " + bm[1] + "`", false); // inline-backtick span
  }
  // dedupe identical (verb, subcommand, flags) triples so repeated citations are checked once each
  // — but two invocations of the SAME command with DIFFERENT flags are each checked (FAFF-628).
  const seen = new Set();
  const out = [];
  for (const c of collected) {
    const k = c.verb + "\x00" + (c.subcommand ?? "") + "\x00" + c.flags.slice().sort().join(",");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// Assert each RUNBOOK verb exists (COMMANDS registry), each subcommand (where the verb dispatches
// on one) is in that verb's declared set, and — command-block lines only — every flag is accepted
// and every declared-required flag is present. Returns an array of finding strings (empty == clean).
// FULLY STATIC: every check is a set-membership lookup against the imported SURFACES map — zero
// CLI processes spawned (FAFF-628; the v1 verbSurface() bare-invocation probe is retired).
function runbookFindings(body, source) {
  const findings = [];
  const verbs = validVerbs();
  for (const cmd of parseEmbeddedFaffCommands(body, source)) {
    if (!verbs.has(cmd.verb)) {
      findings.push(`${cmd.source}: \`faff ${cmd.verb}\` is not a live verb (COMMANDS registry) — raw: ${cmd.raw}`);
      continue;
    }
    const surface = SURFACES[cmd.verb];
    if (surface.kind === "subcommand_dispatch" && cmd.subcommand != null) {
      if (!Object.prototype.hasOwnProperty.call(surface.subcommands, cmd.subcommand)) {
        const set = Object.keys(surface.subcommands).sort().join(",");
        findings.push(
          `${cmd.source}: \`faff ${cmd.verb} ${cmd.subcommand}\` — ${cmd.subcommand} ∉ {${set}} — raw: ${cmd.raw}`,
        );
        continue; // unknown subcommand — skip flag checks on this line, no cascading noise
      }
    }
    if (!cmd.isCommandBlock) continue; // flag-layer assertions: command-block lines only

    const accepted = acceptedFlags(surface); // null = unknown accepted set (no spec declared) — skip
    if (accepted !== null) {
      for (const f of cmd.flags) {
        if (!accepted.has(f)) {
          findings.push(`${cmd.source}: \`faff ${cmd.verb}\` — ${f} is not an accepted flag of faff ${cmd.verb} — raw: ${cmd.raw}`);
        }
      }
    }
    if (cmd.subcommand != null && surface.subcommands && surface.subcommands[cmd.subcommand]) {
      for (const r of surface.subcommands[cmd.subcommand].required_flags || []) {
        if (!cmd.flags.includes(r)) {
          findings.push(`${cmd.source}: \`faff ${cmd.verb} ${cmd.subcommand}\` — missing required flag ${r} — raw: ${cmd.raw}`);
        }
      }
    }
  }
  return findings;
}

// --- config-key half ------------------------------------------------------------------------------

// Extract dotted keys + scalar values from an embedded `.faffrc.yaml` body. A minimal indent-stack
// walk of the documented YAML subset — enough to key `slots.*`, `appetite`, `models.*`, `effort.*`;
// deeper namespaced blocks (backends.*, budget.*, adversarial.*, tracking.*) round-trip as tolerated
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
    assert.ok(SCAFFOLDERS.includes(name), `expected scaffolder ${name} under verification/external-verification/`);
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
    if (CONFIG_FREE.has(name)) {
      // a config-free scaffolder must NOT embed a `.faffrc.yaml` here-doc.
      assert.strictEqual(body, null, `${name}: config-free scaffolder must not embed a .faffrc.yaml here-doc`);
      return;
    }
    assert.notStrictEqual(body, null, `${name}: no .faffrc.yaml here-doc (fail loud, never skip)`);
    const findings = faffrcFindings(body, name);
    assert.deepStrictEqual(findings, [], "\n" + findings.join("\n"));
  });
}

// Self-test: pin the SURFACES map against a known member of each dispatch verb's live
// vocabulary + the positional verbs — the same pins `faff cli-surface --selftest` asserts (a
// cheap duplication of pins, not of parsing logic, per the FAFF-628 spec's Layer-3 note). A
// future SURFACE declaration drift (a verb un-migrated, a subcommand renamed) fails HERE loudly.
test("SURFACES classifies all live dispatch verbs, matching cli-surface --selftest's pins", () => {
  const expectDispatch = {
    prd: "new",
    prdr: "coverage",
    adr: "new",
    env: "up",
    config: "get",
    profile: "show",
    holdout: "verdicts",
  };
  for (const [verb, member] of Object.entries(expectDispatch)) {
    const s = SURFACES[verb];
    assert.strictEqual(s.kind, "subcommand_dispatch", `${verb} should be subcommand_dispatch`);
    assert.ok(Object.keys(s.subcommands).length > 0, `${verb} should declare a non-empty subcommand set`);
    assert.ok(Object.prototype.hasOwnProperty.call(s.subcommands, member), `${verb} vocabulary should contain '${member}' — got {${Object.keys(s.subcommands).sort()}}`);
  }
  for (const verb of ["audit", "next", "state"]) {
    const s = SURFACES[verb];
    assert.strictEqual(s.kind, "positional", `${verb} should be positional`);
    assert.strictEqual(Object.keys(s.subcommands).length, 0, `${verb} should carry no subcommand set`);
  }
});

// Bijection: SURFACES covers every live COMMANDS key (mirrors cli-surface --selftest's own
// assertion — re-asserted here so this test file's own import path is also covered).
test("SURFACES is in bijection with COMMANDS", () => {
  assert.deepStrictEqual(Object.keys(SURFACES).sort(), Object.keys(COMMANDS).sort());
});

// `faff cli-surface --json` MUST emit valid JSON whose keys equal COMMANDS' keys and whose `prd`
// entry declares `link` requiring `--url` (spec §5) — asserted via the pure builder (no spawn).
test("cli-surface --json's shape matches the ticket's named contract", () => {
  const { buildCliSurface } = cliSurfaceEntry;
  const built = JSON.parse(JSON.stringify(buildCliSurface(SURFACES)));
  assert.deepStrictEqual(Object.keys(built).sort(), Object.keys(COMMANDS).sort());
  assert.strictEqual(built.prd.kind, "subcommand_dispatch");
  assert.deepStrictEqual(built.prd.required_flags.link, ["--url"]);
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

// --- FAFF-628 flag-layer scenarios (spec §5) --------------------------------------------------

test("a RUNBOOK command-block line missing a declared required flag fails, naming the flag", () => {
  const findings = runbookFindings("    faff prd link my-container\n", "fixture:RUNBOOK.md");
  assert.strictEqual(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /missing required flag --url/);
});

test("a RUNBOOK command-block line supplying a flag outside the verb's accepted set fails, naming it", () => {
  const findings = runbookFindings("    faff prd list --bogus-flag\n", "fixture:RUNBOOK.md");
  assert.strictEqual(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /--bogus-flag is not an accepted flag of faff prd/);
});

test("supplying the declared required flag produces no finding", () => {
  assert.deepStrictEqual(
    runbookFindings("    faff prd link my-container --url https://x/y\n", "fixture:RUNBOOK.md"),
    [],
  );
});

test("a `--flag=value` command-block token is membership-checked on the name", () => {
  assert.deepStrictEqual(
    runbookFindings("    faff prd link my-container --url=https://x/y\n", "fixture:RUNBOOK.md"),
    [],
  );
});

test("flag-layer assertions do not fire on inline-backtick spans (verb/subcommand checks still apply)", () => {
  assert.deepStrictEqual(runbookFindings("See `faff prd link my-container` for the linked-mode flow.\n", "fixture"), []);
});

test("two command-block lines for the same command with different flags are each checked", () => {
  const body = "    faff prd link my-container\n    faff prd link my-container --url https://x/y\n";
  const findings = runbookFindings(body, "fixture:RUNBOOK.md");
  assert.strictEqual(findings.length, 1, findings.join("\n")); // only the first (missing --url) fires
  assert.match(findings[0], /missing required flag --url/);
});

test("the rewritten guard spawns zero CLI processes — no run-cli helper import in this file", () => {
  const text = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const importsRunCliHelper = /^import\s.*helpers\/run-cli\.mjs/m.test(text);
  assert.strictEqual(importsRunCliHelper, false);
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
