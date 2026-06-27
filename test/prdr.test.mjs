// FAFF-245 — the `faff prdr` subcommand: the product-axis DECISION record (PRD content,
// ADR mechanics). Deterministic mechanics over docs/prdr/NNNN-slug.md (path / new / list /
// supersede / validate). Globally-numbered + immutable + supersedable; lean presence-only
// validate (the four body sections exist, never their content). `supersede` is a pure
// mechanical linker (no actor/authority — that is FAFF-255). Reuses the ADR machinery verbatim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const run = (args, cwd = REPO) => spawnSync(process.execPath, [BIN, "prdr", ...args], { cwd, encoding: "utf8" });

// A temp repo root with a docs/ dir (so the default resolver lands on docs/prdr) + optional fixtures.
function tmpRepo(prdrs = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-prdr-it-"));
  const dir = join(root, "docs", "prdr");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(prdrs)) writeFileSync(join(dir, name), body);
  return root;
}
const validPrdr = (num, slug, status = "Proposed", provenance = "human") =>
  `# PRDR ${num} — ${slug}\n\n- **Status:** ${status}\n- **Provenance:** ${provenance}\n- **Date:** 2026-06-27\n- **Container:** portal\n- **PRD-goal:** ship the booking flow\n\n## Context\nx\n\n## Decision\ny\n\n## Scope\nz\n\n## Definition of done\nw\n`;

test("--selftest passes", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /prdr --selftest: ok/);
});

test("path: no arg → the docs/prdr dir; <number> → the record path", () => {
  const root = tmpRepo({ "0001-a.md": validPrdr("0001", "a") });
  assert.match(run(["path", "--root", root]).stdout.trim(), /docs\/prdr$/);
  const r = run(["path", "1", "--root", root]);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /docs\/prdr\/0001-a\.md$/);
  assert.equal(run(["path", "9", "--root", root]).status, 1);   // missing → exit 1
  rmSync(root, { recursive: true, force: true });
});

test("new: scaffolds the record (metadata + 4 sections), prints path only, refuses overwrite", () => {
  const root = tmpRepo();
  const r = run(["new", "Booking flow", "--container", "portal", "--prd-goal", "ship bookings", "--provenance", "loop", "--date", "2026-06-27", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const p = r.stdout.trim();
  assert.match(p, /docs\/prdr\/0001-booking-flow\.md$/);
  const body = readFileSync(p, "utf8");
  assert.match(body, /# PRDR 0001 — Booking flow/);
  assert.match(body, /\*\*Status:\*\* Proposed/);
  assert.match(body, /\*\*Provenance:\*\* loop/);
  assert.match(body, /\*\*Container:\*\* portal/);
  assert.match(body, /\*\*PRD-goal:\*\* ship bookings/);
  for (const s of ["## Context", "## Decision", "## Scope", "## Definition of done"]) assert.ok(body.includes(s), s);
  // append-only: a second record gets the next number, never clobbers
  const r2 = run(["new", "Booking flow", "--container", "portal", "--prd-goal", "ship bookings", "--root", root]);
  assert.equal(r2.status, 0);
  assert.match(r2.stdout.trim(), /0002-booking-flow\.md$/);
  assert.ok(existsSync(p), "the first record is untouched");
  rmSync(root, { recursive: true, force: true });
});

test("new: provenance defaults to human (fail-safe tier)", () => {
  const root = tmpRepo();
  const p = run(["new", "X", "--container", "portal", "--prd-goal", "g", "--root", root]).stdout.trim();
  assert.match(readFileSync(p, "utf8"), /\*\*Provenance:\*\* human/);
  rmSync(root, { recursive: true, force: true });
});

test("new: missing title / container / prd-goal are usage errors (exit 2)", () => {
  const root = tmpRepo();
  assert.equal(run(["new", "--root", root]).status, 2);                                        // no title
  assert.equal(run(["new", "X", "--prd-goal", "g", "--root", root]).status, 2);                // no container
  assert.equal(run(["new", "X", "--container", "portal", "--root", root]).status, 2);          // no prd-goal
  assert.equal(run(["new", "X", "--container", "portal", "--prd-goal", "g", "--provenance", "robot", "--root", root]).status, 2); // bad provenance
  rmSync(root, { recursive: true, force: true });
});

test("list --json / --container / --live filter as specified", () => {
  const root = tmpRepo({
    "0001-a.md": validPrdr("0001", "a"),
    "0002-b.md": validPrdr("0002", "b").replace("**Container:** portal", "**Container:** other"),
  });
  const all = JSON.parse(run(["list", "--json", "--root", root]).stdout);
  assert.equal(all.length, 2);
  assert.equal(all[0].container, "portal");
  const portal = JSON.parse(run(["list", "--json", "--container", "portal", "--root", root]).stdout);
  assert.equal(portal.length, 1);
  assert.equal(portal[0].id, "0001");
  // --live drops a superseded record
  run(["supersede", "1", "--by", "2", "--root", root]);
  const live = JSON.parse(run(["list", "--json", "--live", "--root", root]).stdout);
  assert.equal(live.length, 1);
  assert.equal(live[0].id, "0002");
  rmSync(root, { recursive: true, force: true });
});

test("supersede: links two records (Status + Supersedes), body untouched, validates symmetric", () => {
  const root = tmpRepo({
    "0001-old.md": validPrdr("0001", "old") + "\nThe original product decision.\n",
    "0002-new.md": validPrdr("0002", "new") + "\nThe replacement decision.\n",
  });
  const r = run(["supersede", "0001", "--by", "0002", "--root", root]);
  assert.equal(r.status, 0);
  const oldText = readFileSync(join(root, "docs", "prdr", "0001-old.md"), "utf8");
  const newText = readFileSync(join(root, "docs", "prdr", "0002-new.md"), "utf8");
  assert.match(oldText, /\*\*Status:\*\* Superseded by PRDR-0002/);
  assert.match(newText, /\*\*Supersedes:\*\* PRDR-0001/);
  assert.match(oldText, /The original product decision\./, "body must be untouched");
  assert.equal(run(["validate", "--root", root]).status, 0, "symmetric supersession validates clean");
  rmSync(root, { recursive: true, force: true });
});

test("supersede: errors on self / missing / already-superseded (pure mechanical linker, no actor concept)", () => {
  const root = tmpRepo({ "0001-a.md": validPrdr("0001", "a"), "0002-b.md": validPrdr("0002", "b") });
  assert.notEqual(run(["supersede", "0001", "--by", "0001", "--root", root]).status, 0); // self
  assert.notEqual(run(["supersede", "0001", "--by", "0099", "--root", root]).status, 0); // missing new
  run(["supersede", "0001", "--by", "0002", "--root", root]);
  const again = run(["supersede", "0001", "--by", "0002", "--root", root]);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already superseded/);
  rmSync(root, { recursive: true, force: true });
});

test("validate: a vacuous _TODO_ DoD passes (presence-only, P2)", () => {
  const root = tmpRepo();
  run(["new", "X", "--container", "portal", "--prd-goal", "g", "--root", root]); // template DoD is "_TODO: ..._"
  const r = run(["validate", "--root", root]);
  assert.equal(r.status, 0, r.stdout);
  rmSync(root, { recursive: true, force: true });
});

test("validate: a missing body section is flagged", () => {
  const noScope = validPrdr("0001", "a").replace("\n## Scope\nz\n", "\n");
  const root = tmpRepo({ "0001-a.md": noScope });
  const r = run(["validate", "--root", root]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing "## Scope" section/);
  rmSync(root, { recursive: true, force: true });
});

test("validate: missing metadata fields flagged (Status / Provenance / Container / PRD-goal)", () => {
  const root = tmpRepo({ "0001-a.md": "# PRDR 0001 — a\n\n- **Date:** 2026-06-27\n\n## Context\nx\n\n## Decision\ny\n\n## Scope\nz\n\n## Definition of done\nw\n" });
  const out = run(["validate", "--root", root]).stdout;
  for (const f of [/missing Status/, /missing Provenance/, /missing Container/, /missing PRD-goal/]) assert.match(out, f);
  rmSync(root, { recursive: true, force: true });
});

test("validate: numbering gap + asymmetric supersession flagged (shared validator)", () => {
  const gap = tmpRepo({ "0001-a.md": validPrdr("0001", "a"), "0003-c.md": validPrdr("0003", "c") });
  assert.match(run(["validate", "--root", gap]).stdout, /numbering gap: PRDR 0002/);
  const asym = tmpRepo({ "0001-a.md": validPrdr("0001", "a", "Superseded by PRDR-0002"), "0002-b.md": validPrdr("0002", "b") });
  assert.match(run(["validate", "--root", asym]).stdout, /asymmetric/i);
  for (const root of [gap, asym]) rmSync(root, { recursive: true, force: true });
});

test("the real repo tree validates clean (or has no docs/prdr yet)", () => {
  const r = run(["validate"]);
  assert.equal(r.status, 0, r.stdout);
});
