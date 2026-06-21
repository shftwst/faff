// FAFF-16 — the `faff adr` subcommand: deterministic mechanics over the docs/adr/ Nygard log
// (next-number / new / list / validate). Append-only; the real repo tree must validate clean.
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

const run = (args, cwd = REPO) => spawnSync(process.execPath, [BIN, "adr", ...args], { cwd, encoding: "utf8" });

// A temp repo root with a docs/adr/ holding the given {name: body} ADR fixtures.
function tmpRepo(adrs = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-adr-it-"));
  const dir = join(root, "docs", "adr");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(adrs)) writeFileSync(join(dir, name), body);
  return root;
}
const validAdr = (n, slug, status = "Accepted") =>
  `# ADR ${n} — ${slug}\n\n- **Status:** ${status}\n- **Date:** 2026-06-21\n\n## Context\nx\n## Decision\ny\n## Consequences\nz\n`;

test("next-number: 0001 on an empty log", () => {
  const root = tmpRepo();
  const r = run(["next-number", "--root", root]);
  assert.equal(r.stdout.trim(), "0001");
  assert.equal(r.status, 0);
  rmSync(root, { recursive: true, force: true });
});

test("next-number: max+1 over existing", () => {
  const root = tmpRepo({ "0001-a.md": validAdr("0001", "a"), "0002-b.md": validAdr("0002", "b") });
  assert.equal(run(["next-number", "--root", root]).stdout.trim(), "0003");
  rmSync(root, { recursive: true, force: true });
});

test("new: scaffolds Nygard ADR, prints path, refuses overwrite", () => {
  const root = tmpRepo();
  const r = run(["new", "--title", "Events not RPC", "--issue", "FAFF-16", "--date", "2026-06-21", "--root", root]);
  assert.equal(r.status, 0);
  const p = r.stdout.trim();
  assert.match(p, /docs\/adr\/0001-events-not-rpc\.md$/);
  const body = readFileSync(p, "utf8");
  assert.match(body, /# ADR 0001 — Events not RPC/);
  assert.match(body, /\*\*Status:\*\* Proposed/);
  assert.match(body, /\*\*Issue:\*\* FAFF-16/);
  for (const s of ["## Context", "## Decision", "## Consequences"]) assert.ok(body.includes(s));
  // append-only: re-running gets the NEXT number (never clobbers the first), and 0001 still exists
  const r2 = run(["new", "--title", "Events not RPC", "--date", "2026-06-21", "--root", root]);
  assert.equal(r2.status, 0);
  assert.match(r2.stdout.trim(), /0002-events-not-rpc\.md$/);
  assert.ok(existsSync(p), "the first ADR is untouched");
  rmSync(root, { recursive: true, force: true });
});

test("validate: passes a clean tree, fails on a gap and on a missing field", () => {
  const clean = tmpRepo({ "0001-a.md": validAdr("0001", "a"), "0002-b.md": validAdr("0002", "b") });
  assert.equal(run(["validate", "--root", clean]).status, 0);

  const gap = tmpRepo({ "0001-a.md": validAdr("0001", "a"), "0003-c.md": validAdr("0003", "c") });
  const rg = run(["validate", "--root", gap]);
  assert.equal(rg.status, 1);
  assert.match(rg.stdout, /0002/);

  const noStatus = tmpRepo({ "0001-a.md": "# ADR 0001 — a\n\n- **Date:** 2026-06-21\n\n## Context\n" });
  const rs = run(["validate", "--root", noStatus]);
  assert.equal(rs.status, 1);
  assert.match(rs.stdout, /Status/i);

  // a body line beginning with the bare field word must NOT be mis-read as the field (colon required)
  const decoyStatus = tmpRepo({ "0001-a.md": "# ADR 0001 — a\n\n- **Date:** 2026-06-21\n\n## Context\nStatus quo before this decision was unclear.\n" });
  const rd = run(["validate", "--root", decoyStatus]);
  assert.equal(rd.status, 1, "a colon-less 'Status …' prose line must not satisfy the Status field");
  assert.match(rd.stdout, /Status/i);

  for (const root of [clean, gap, noStatus, decoyStatus]) rmSync(root, { recursive: true, force: true });
});

test("list --json: enumerates number/title/status/date", () => {
  const root = tmpRepo({ "0001-a.md": validAdr("0001", "Alpha decision") });
  const r = run(["list", "--json", "--root", root]);
  assert.equal(r.status, 0);
  const arr = JSON.parse(r.stdout);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].id, "0001");
  assert.equal(arr[0].title, "Alpha decision");
  assert.equal(arr[0].status, "Accepted");
  rmSync(root, { recursive: true, force: true });
});

test("--selftest passes", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("regression: the real repo docs/adr tree validates clean", () => {
  const r = run(["validate"]);
  assert.equal(r.status, 0, `shipped docs/adr/ must validate:\n${r.stdout}`);
  assert.match(r.stdout, /^OK —/m);
});

test("adr.mode defaults to offer (CLI-enforced, FAFF-182 registry)", () => {
  const r = spawnSync(process.execPath, [BIN, "config", "get", "adr.mode"], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.stdout.trim(), "offer");
});

// FAFF-197 — supersession
test("supersede: links two ADRs (Status + Supersedes), body untouched, validates symmetric", () => {
  const root = tmpRepo({
    "0001-old.md": validAdr("0001", "old") + "\nThe original decision body.\n",
    "0002-new.md": validAdr("0002", "new") + "\nThe replacement body.\n",
  });
  const r = run(["supersede", "0001", "--by", "0002", "--root", root]);
  assert.equal(r.status, 0);
  const oldText = readFileSync(join(root, "docs", "adr", "0001-old.md"), "utf8");
  const newText = readFileSync(join(root, "docs", "adr", "0002-new.md"), "utf8");
  assert.match(oldText, /\*\*Status:\*\* Superseded by ADR-0002/);
  assert.match(newText, /\*\*Supersedes:\*\* ADR-0001/);
  assert.match(oldText, /The original decision body\./, "body must be untouched");
  assert.equal(run(["validate", "--root", root]).status, 0, "symmetric supersession validates clean");
  rmSync(root, { recursive: true, force: true });
});

test("supersede: errors on self / missing / already-superseded", () => {
  const root = tmpRepo({ "0001-a.md": validAdr("0001", "a"), "0002-b.md": validAdr("0002", "b") });
  assert.notEqual(run(["supersede", "0001", "--by", "0001", "--root", root]).status, 0); // self
  assert.notEqual(run(["supersede", "0001", "--by", "0099", "--root", root]).status, 0); // missing new
  run(["supersede", "0001", "--by", "0002", "--root", root]);
  const again = run(["supersede", "0001", "--by", "0002", "--root", root]);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /already superseded/);
  rmSync(root, { recursive: true, force: true });
});

test("validate: fails on asymmetric and dangling canonical supersession refs", () => {
  const asym = tmpRepo({ "0001-a.md": validAdr("0001", "a", "Superseded by ADR-0002"), "0002-b.md": validAdr("0002", "b") });
  const ra = run(["validate", "--root", asym]);
  assert.equal(ra.status, 1);
  assert.match(ra.stdout, /asymmetric/i);

  const dang = tmpRepo({ "0001-a.md": validAdr("0001", "a", "Superseded by ADR-0099") });
  const rd = run(["validate", "--root", dang]);
  assert.equal(rd.status, 1);
  assert.match(rd.stdout, /missing ADR-0099/);

  for (const root of [asym, dang]) rmSync(root, { recursive: true, force: true });
});
