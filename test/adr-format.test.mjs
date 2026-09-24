// FAFF-1085 — repo-specific ADR format resolution: the read-only `faff adr format` resolver, its
// threading through `faff adr new` (scaffold) and `faffter-noon-adr` (body producer wiring), and
// the byte-identical Nygard regression floor. Covers the spec's DONE checklist:
//   - a golden-file test on the deterministic scaffold, against an INDEPENDENT pre-change fixture
//     (never regenerated from post-change code)
//   - a born-verifiable static check that faffter-noon-adr's Output section drives its section
//     list from `faff adr format --json` and no longer hardcodes the Nygard heading triple
//   - the file-presence activation, degrade-and-log, and no-Decision-heading edge cases
//   - the Integration smoke test procedure (spec section 8)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const adr = (args, cwd = REPO) => spawnSync(process.execPath, [BIN, "adr", ...args], { cwd, encoding: "utf8" });
const cli = (args, cwd = REPO) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), "faff-adr-format-"));
}
function writeTemplate(root, body) {
  mkdirSync(join(root, ".faff-templates"), { recursive: true });
  writeFileSync(join(root, ".faff-templates", "adr.md"), body);
}

// --- Golden-file test: the byte-identical Nygard regression floor -------------------------------
// The fixture is an INDEPENDENT baseline captured from the pre-refactor `adrTemplate()` for these
// exact inputs, committed once, never regenerated from the post-change code. A failing diff means
// fix the refactor, not re-record the fixture.
test("golden: faff adr new (no template) is byte-identical to the committed pre-change fixture", () => {
  const root = tmpRoot();
  const r = adr(["new", "--title", "Golden fixture check", "--date", "2026-01-01", "--issue", "FAFF-1085", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const got = readFileSync(r.stdout.trim(), "utf8");
  const want = readFileSync(join(HERE, "fixtures", "adr-nygard-golden.md"), "utf8");
  assert.equal(got, want, "faff adr new output for a repo with no .faff-templates/adr.md drifted from the pinned Nygard golden fixture");
  rmSync(root, { recursive: true, force: true });
});

// --- format: file-presence activation + resolution ----------------------------------------------
test("format: no .faff-templates/adr.md resolves to nygard/default with the three verbatim sections", () => {
  const root = tmpRoot();
  const r = adr(["format", "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const resolved = JSON.parse(r.stdout);
  assert.equal(resolved.format, "nygard");
  assert.equal(resolved.source, "default");
  assert.equal(resolved.degraded, false);
  assert.equal(resolved.notes, null);
  assert.equal(resolved.decision_section, "Decision");
  assert.deepEqual(resolved.sections.map((s) => s.name), ["Context", "Decision", "Consequences"]);
  rmSync(root, { recursive: true, force: true });
});

test("format: bare output line names the token, source, and section list", () => {
  const root = tmpRoot();
  const r = adr(["format", "--root", root]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "adr format: nygard (default; sections: Context/Decision/Consequences)");
  rmSync(root, { recursive: true, force: true });
});

test("format: a committed template's level-2 headings become the section list, in order", () => {
  const root = tmpRoot();
  writeTemplate(root, "## Status\nguidance\n\n## Context\nguidance\n\n## Options\nguidance\n\n## Decision\nguidance\n\n## Consequences\nguidance\n");
  const r = adr(["format", "--json", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const resolved = JSON.parse(r.stdout);
  assert.equal(resolved.format, "template");
  assert.equal(resolved.source, "template");
  assert.equal(resolved.template_path, ".faff-templates/adr.md");
  assert.equal(resolved.degraded, false);
  assert.deepEqual(resolved.sections.map((s) => s.name), ["Status", "Context", "Options", "Decision", "Consequences"]);
  assert.equal(resolved.decision_section, "Decision");
  rmSync(root, { recursive: true, force: true });
});

test("format: a present-but-empty template degrades to nygard, logs to stderr, and mirrors the text in notes", () => {
  const root = tmpRoot();
  writeTemplate(root, "");
  const r = adr(["format", "--json", "--root", root]);
  assert.equal(r.status, 0);
  const resolved = JSON.parse(r.stdout);
  assert.equal(resolved.format, "nygard");
  assert.equal(resolved.degraded, true);
  const expected = "faff adr format: .faff-templates/adr.md is empty or has no level-2 headings; using the Nygard default";
  assert.equal(resolved.notes, expected);
  assert.match(r.stderr, /is empty or has no level-2 headings; using the Nygard default/);
  rmSync(root, { recursive: true, force: true });
});

test("format: a heading-less (prose-only) template degrades exactly like empty", () => {
  const root = tmpRoot();
  writeTemplate(root, "Just some prose. No level-2 headings anywhere in this file.\n");
  const resolved = JSON.parse(adr(["format", "--json", "--root", root]).stdout);
  assert.equal(resolved.format, "nygard");
  assert.equal(resolved.degraded, true);
  rmSync(root, { recursive: true, force: true });
});

test("format: a present-but-unreadable template (permission-denied) degrades exactly like empty", { skip: process.getuid && process.getuid() === 0 }, () => {
  const root = tmpRoot();
  writeTemplate(root, "## Context\nx\n");
  const tplPath = join(root, ".faff-templates", "adr.md");
  chmodSync(tplPath, 0o000);
  try {
    const r = adr(["format", "--json", "--root", root]);
    const resolved = JSON.parse(r.stdout);
    assert.equal(resolved.format, "nygard");
    assert.equal(resolved.degraded, true);
    assert.match(resolved.notes, /is empty or has no level-2 headings; using the Nygard default/);
  } finally {
    chmodSync(tplPath, 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

test("format: a template with headings but no ## Decision disables L3, never degrades to nygard", () => {
  const root = tmpRoot();
  writeTemplate(root, "## Summary\nx\n\n## Rationale\ny\n");
  const r = adr(["format", "--json", "--root", root]);
  const resolved = JSON.parse(r.stdout);
  assert.equal(resolved.format, "template");
  assert.equal(resolved.degraded, false);
  assert.equal(resolved.decision_section, null);
  assert.match(resolved.notes, /no `## Decision` heading; L3 contradiction-detection disabled/);
  assert.match(r.stderr, /L3 contradiction-detection disabled for this repo/);
  rmSync(root, { recursive: true, force: true });
});

// --- new: the scaffold honours the resolved format ------------------------------------------------
test("new: a committed template drives the scaffold — exactly those headings, in order, generic TODO placeholder", () => {
  const root = tmpRoot();
  writeTemplate(root, "## Status\nx\n\n## Context\nx\n\n## Options\nx\n\n## Decision\nx\n\n## Consequences\nx\n");
  const r = adr(["new", "--title", "Templated decision", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const body = readFileSync(r.stdout.trim(), "utf8");
  const order = ["Status", "Context", "Options", "Decision", "Consequences"];
  let idx = -1;
  for (const name of order) {
    const found = body.indexOf(`## ${name}`, idx + 1);
    assert.ok(found > idx, `expected heading '## ${name}' after position ${idx}`);
    idx = found;
  }
  assert.ok(body.includes("_TODO: ..._"), "template sections carry the generic placeholder");
  assert.ok(!body.includes("_TODO: what forces this decision._"), "must not carry the Nygard-specific placeholder under a template format");
  rmSync(root, { recursive: true, force: true });
});

// --- live-decisions threads the resolved decision_section -----------------------------------------
test("live-decisions: a repo template's own Decision-equivalent heading is what L3 reads", () => {
  const root = tmpRoot();
  writeTemplate(root, "## Background\nx\n\n## Decision\nuse the new approach\n\n## Impact\nx\n");
  const dir = join(root, "docs", "adr");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0001-x.md"), "# ADR 0001 — x\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Background\nb\n\n## Decision\nuse the new approach\n\n## Impact\ni\n");
  const r = adr(["live-decisions", "--exclude", "0002", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const live = JSON.parse(r.stdout);
  assert.equal(live.length, 1);
  assert.equal(live[0].decision, "use the new approach");
  rmSync(root, { recursive: true, force: true });
});

// --- CLI surface / drift guard --------------------------------------------------------------------
test("cli-surface: adr format is a declared subcommand faff cli-surface --json reports", () => {
  const r = cli(["cli-surface", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const surface = JSON.parse(r.stdout);
  assert.ok(surface.adr.subcommands.includes("format"), "expected 'format' in the declared adr subcommands");
});

test("cli-surface --selftest passes (the bijection + pinned-classification floor)", () => {
  assert.equal(cli(["cli-surface", "--selftest"]).status, 0);
});

// --- born-verifiable static check: faffter-noon-adr's Output section drives from `faff adr format`,
// no longer hardcodes the Nygard heading triple as literal `## ` declarations. --------------------
test("static: faffter-noon-adr SKILL.md Output section names the CLI resolver, not a literal Nygard heading triple", () => {
  const skillPath = join(REPO, "plugin", "skills", "faffter-noon-adr", "SKILL.md");
  const text = readFileSync(skillPath, "utf8");
  const outputSection = text.slice(text.indexOf("## Output"), text.indexOf("## Rules"));
  assert.match(outputSection, /faff adr format/, "Output section must name the `faff adr format` resolver as the section-list source");
  assert.doesNotMatch(outputSection, /##\s*Context.*##\s*Decision.*##\s*Consequences/s,
    "Output section must not hardcode the literal Nygard `## Context` / `## Decision` / `## Consequences` heading triple");
  // still Nygard-aware in plain prose (keeps the producer-adr lint's Nygard/Consequences check satisfied)
  assert.match(text, /nygard/i);
  assert.match(text, /Consequences/);
});

// --- Integration smoke test (spec section 8, verbatim procedure) ----------------------------------
test("smoke: template activation, scaffold, removal reverts to Nygard, no-Decision disables L3", () => {
  const root = tmpRoot();
  writeTemplate(root, "## Status\nx\n\n## Context\nx\n\n## Options\nx\n\n## Decision\nx\n\n## Consequences\nx\n");

  const f1 = JSON.parse(adr(["format", "--json", "--root", root]).stdout);
  assert.equal(f1.format, "template");
  assert.deepEqual(f1.sections.map((s) => s.name), ["Status", "Context", "Options", "Decision", "Consequences"]);
  assert.equal(f1.decision_section, "Decision");
  assert.equal(f1.source, "template");
  assert.equal(f1.degraded, false);
  assert.equal(f1.notes, null);

  const n1 = adr(["new", "--title", "Test decision", "--root", root]);
  assert.equal(n1.status, 0);
  const body1 = readFileSync(n1.stdout.trim(), "utf8");
  for (const h of ["## Status", "## Context", "## Options", "## Decision", "## Consequences"]) assert.ok(body1.includes(h));

  rmSync(join(root, ".faff-templates", "adr.md"));
  const f2 = JSON.parse(adr(["format", "--json", "--root", root]).stdout);
  assert.equal(f2.format, "nygard");
  assert.equal(f2.source, "default");
  const n2 = adr(["new", "--title", "Test decision 2", "--root", root]);
  const body2 = readFileSync(n2.stdout.trim(), "utf8");
  for (const h of ["## Context", "## Decision", "## Consequences"]) assert.ok(body2.includes(h));
  assert.ok(!body2.includes("## Status") && !body2.includes("## Options"));

  writeTemplate(root, "## Status\nx\n\n## Context\nx\n\n## Options\nx\n");   // omits Decision
  const f3 = JSON.parse(adr(["format", "--json", "--root", root]).stdout);
  assert.equal(f3.decision_section, null);
  assert.match(f3.notes, /disablement|disabled/);

  rmSync(root, { recursive: true, force: true });
});
