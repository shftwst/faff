// FAFF-252 — the `faff prd` subcommand: the PRODUCT-axis counterpart to `faff adr`.
// Deterministic mechanics over docs/prd/<container-slug>.md (path / new / link / list /
// validate). One PRD per container, slug-keyed; lean/format-flexible validate (presence,
// never section shape). The CLI writes + emits the link line; the caller commits + applies it.
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

const run = (args, cwd = REPO) => spawnSync(process.execPath, [BIN, "prd", ...args], { cwd, encoding: "utf8" });

// A temp repo root with a docs/ dir (so the default resolver lands on docs/prd) + optional fixtures.
function tmpRepo(prds = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-prd-it-"));
  const dir = join(root, "docs", "prd");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(prds)) writeFileSync(join(dir, name), body);
  return root;
}
const validPrd = (container, status = "Draft") =>
  `# PRD — ${container}\n\n- **Container:** ${container}\n- **Status:** ${status}\n- **Date:** 2026-06-26\n- **Mode:** authored\n\n## Problem / objective\nx\n`;

test("--selftest passes", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /prd --selftest: ok/);
});

test("path: resolves <docs/prd>/<container-slug>.md", () => {
  const root = tmpRepo();
  const r = run(["path", "Alpha Project", "--root", root]);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /docs\/prd\/alpha-project\.md$/);
  rmSync(root, { recursive: true, force: true });
});

test("new: scaffolds the lean template, prints path + link line, refuses overwrite", () => {
  const root = tmpRepo();
  const r = run(["new", "Immutable Ends — the human PRD", "--date", "2026-06-26", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  const p = lines[0];
  assert.match(p, /docs\/prd\/immutable-ends-the-human-prd\.md$/);
  assert.match(lines[1], /^\*\*PRD:\*\* docs\/prd\/immutable-ends-the-human-prd\.md$/);
  const body = readFileSync(p, "utf8");
  assert.match(body, /# PRD — Immutable Ends/);
  assert.match(body, /\*\*Status:\*\* Draft/);
  assert.match(body, /\*\*Mode:\*\* authored/);
  for (const s of ["## Problem / objective", "## Acceptance criteria", "## Open questions"]) assert.ok(body.includes(s), s);
  // append-only: re-running the SAME container errors and never clobbers (one PRD per container)
  const r2 = run(["new", "Immutable Ends — the human PRD", "--root", root]);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /already exists — never overwrite/);
  assert.ok(existsSync(p), "the first PRD is untouched");
  rmSync(root, { recursive: true, force: true });
});

test("new: missing container is a usage error (exit 2)", () => {
  const root = tmpRepo();
  const r = run(["new", "--root", root]);
  assert.equal(r.status, 2);
  rmSync(root, { recursive: true, force: true });
});

test("link: prints the **PRD:** line, makes no tracker call, exit 0", () => {
  const root = tmpRepo();
  const r = run(["link", "Some Initiative", "--url", "https://notion.so/prd-x", "--root", root]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "**PRD:** https://notion.so/prd-x");
  // link never writes a file
  assert.equal(run(["list", "--json", "--root", root]).stdout.trim(), "[]");
  rmSync(root, { recursive: true, force: true });
});

test("link: missing --url is a usage error (exit 2)", () => {
  const root = tmpRepo();
  assert.equal(run(["link", "X", "--root", root]).status, 2);
  rmSync(root, { recursive: true, force: true });
});

test("list --json: one entry per file with the parsed metadata", () => {
  const root = tmpRepo({ "alpha-project.md": validPrd("Alpha Project") });
  const r = run(["list", "--json", "--root", root]);
  assert.equal(r.status, 0);
  const got = JSON.parse(r.stdout);
  assert.equal(got.length, 1);
  assert.equal(got[0].slug, "alpha-project");
  assert.equal(got[0].container, "Alpha Project");
  assert.equal(got[0].status, "Draft");
  assert.equal(got[0].mode, "authored");
  rmSync(root, { recursive: true, force: true });
});

test("validate: clean fixtures pass", () => {
  const root = tmpRepo({ "alpha.md": validPrd("Alpha") });
  const r = run(["validate", "--root", root]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /OK — 1 PRD\(s\)/);
  rmSync(root, { recursive: true, force: true });
});

test("validate: missing Status flagged (lenient — never checks section shape)", () => {
  const root = tmpRepo({ "beta.md": "# PRD — Beta\n\n- **Container:** Beta\n- **Date:** 2026-06-26\n\n## Anything\nx\n" });
  const r = run(["validate", "--root", root]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /beta\.md: missing Status field/);
  rmSync(root, { recursive: true, force: true });
});

test("validate: linked-and-authored collision flagged", () => {
  const root = tmpRepo({ "delta.md": "# PRD — Delta\n\n- **Container:** Delta\n- **Status:** Draft\n- **Date:** 2026-06-26\n- **PRD:** https://x/y\n\n## Problem\nx\n" });
  const r = run(["validate", "--root", root]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /delta\.md: both a \*\*PRD:\*\* link line and/);
  rmSync(root, { recursive: true, force: true });
});

test("the real repo tree validates clean (or has no docs/prd yet)", () => {
  const r = run(["validate"]);
  assert.equal(r.status, 0, r.stdout);
});
