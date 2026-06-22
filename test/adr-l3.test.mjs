// FAFF-198 — ADR L3: the deterministic plumbing around the `detect_contradictions` LLM seam.
// Covers the two CLI-exposed mechanics (input assembly via `adr live-decisions`, and the
// `faff adr supersede` write the confirmed offer drives) plus the end-to-end smoke from the spec.
// The seam JUDGEMENT itself is the swappable LLM occupant — stubbed here (we hand it a known result),
// so these tests assert the plumbing, never the model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const adr = (args, cwd = REPO) => spawnSync(process.execPath, [BIN, "adr", ...args], { cwd, encoding: "utf8" });

function tmpRepo(adrs = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-adrl3-"));
  const dir = join(root, "docs", "adr");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(adrs)) writeFileSync(join(dir, name), body);
  return { root, dir };
}
const fullAdr = (n, title, status, decision) =>
  `# ADR ${n} — ${title}\n\n- **Status:** ${status}\n- **Date:** 2026-06-21\n\n## Context\nc\n\n## Decision\n${decision}\n\n## Consequences\nq\n`;

// The CLI selftest is the line-by-line table; this guards the plumbing-table is wired into CI.
test("adr --selftest passes (includes the L3 input-assembly + offer-routing table)", () => {
  const r = adr(["--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("live-decisions: non-superseded filter, exclude-new, each Decision body read", () => {
  const { root, dir } = tmpRepo({
    "0001-rpc.md": fullAdr("0001", "RPC everywhere", "Accepted", "use RPC for all cross-slice calls"),
    "0002-old.md": fullAdr("0002", "old", "Superseded by ADR-0004", "the old way"),
    "0003-prop.md": fullAdr("0003", "proposed thing", "Proposed", "a not-yet-accepted call"),
    "0004-events.md": fullAdr("0004", "events", "Accepted", "use events, not RPC"),
  });
  const r = adr(["live-decisions", "--exclude", "0004", "--root", root]);
  assert.equal(r.status, 0, r.stderr);
  const live = JSON.parse(r.stdout);
  const ids = live.map((d) => d.adr).sort();
  assert.deepEqual(ids, ["0001", "0003"], "0002 (superseded) and 0004 (the new one) excluded");
  assert.equal(live.find((d) => d.adr === "0001").decision, "use RPC for all cross-slice calls");
  assert.equal(live.find((d) => d.adr === "0001").title, "RPC everywhere");
  rmSync(root, { recursive: true, force: true });
});

test("live-decisions: empty candidate set when only the new ADR is live", () => {
  const { root } = tmpRepo({ "0001-only.md": fullAdr("0001", "only", "Accepted", "x") });
  const r = adr(["live-decisions", "--exclude", "0001", "--root", root]);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), []);
  rmSync(root, { recursive: true, force: true });
});

test("live-decisions: legacy ADR with no bare ## Decision degrades to empty body, never crashes", () => {
  const { root } = tmpRepo({
    "0001-legacy.md": "# ADR 0001 — legacy\n\n- **Status:** Accepted\n- **Date:** 2026-06-21\n\n## Context\nc\n\n## Decisions\n### 1. thing\nsplit decision\n\n## Consequences\nq\n",
    "0002-new.md": fullAdr("0002", "new", "Accepted", "the new decision"),
  });
  const r = adr(["live-decisions", "--exclude", "0002", "--root", root]);
  assert.equal(r.status, 0);
  const live = JSON.parse(r.stdout);
  assert.equal(live.length, 1);
  assert.equal(live[0].decision, "", "no bare `## Decision` → empty seam input, not a throw");
  rmSync(root, { recursive: true, force: true });
});

// Spec §8 integration smoke: live ADR-0001 (use X) + new ADR-0002 (use Y not X);
// the (stubbed) seam returns contradicts:true; the confirmed "supersede" runs the FAFF-197
// write; `faff adr validate` then passes with symmetric back-refs.
test("smoke: confirmed supersede writes symmetric back-refs and validates clean", () => {
  const { root } = tmpRepo({
    "0001-x.md": fullAdr("0001", "use X", "Accepted", "use X for everything"),
    "0002-y.md": fullAdr("0002", "use Y", "Accepted", "use Y, not X"),
  });
  // (seam stubbed: it returned [{adr:"0001", contradicts:true, why:"X vs Y"}]; human confirmed "supersede")
  const sup = adr(["supersede", "0001", "--by", "0002", "--root", root]);
  assert.equal(sup.status, 0, sup.stderr);
  const v = adr(["validate", "--root", root]);
  assert.equal(v.status, 0, v.stdout + v.stderr);
  const oldText = readFileSync(join(root, "docs/adr/0001-x.md"), "utf8");
  const newText = readFileSync(join(root, "docs/adr/0002-y.md"), "utf8");
  assert.match(oldText, /Superseded by ADR-0002/);
  assert.match(newText, /Supersedes:\*?\*?\s*ADR-0001/);
  rmSync(root, { recursive: true, force: true });
});

// Hard floor (Locked Decision 3): the supersede WRITE is only ever a CLI op graft runs on an
// interactive confirm. The selftest's offer-routing table asserts autonomous never returns a
// supersede action at any appetite; this guards the write primitive itself errors loudly rather
// than silently re-pointing an already-superseded record (the already-superseded-at-confirm edge).
test("supersede errors loudly when the old ADR is already superseded (no silent re-point)", () => {
  const { root } = tmpRepo({
    "0001-x.md": fullAdr("0001", "x", "Superseded by ADR-0002", "old"),
    "0002-y.md": fullAdr("0002", "y", "Accepted", "new"),
    "0003-z.md": fullAdr("0003", "z", "Accepted", "newer"),
  });
  const r = adr(["supersede", "0001", "--by", "0003", "--root", root]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already superseded/i);
  rmSync(root, { recursive: true, force: true });
});
