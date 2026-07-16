// FAFF-219 (Split A of FAFF-217) — `faff contain`: the subtree-of-mandate
// containment primitive. Answers `parent ∈ subtree(mandate)` by walking the
// AGENT-SUPPLIED ancestry (--ancestry) from <parent> up to <mandate>:
// contained (exit 0) / outward (exit 3, fail-closed) / usage (exit 2). PURE —
// zero tracker/network calls (parity with eligible/next/intakecheck). Drives the
// real entrypoint, like intakecheck.test.mjs.
//
// FAFF-222 generalizes the mandate from issue-only to issue|project|initiative and
// the ancestry from an untyped {id, parentId} chain to a TYPED superset
// {id, type?, parentId?, projectId?, initiativeId?} walked across mixed-graph
// containment edges. The FAFF-219 cases below use the untyped form and must keep
// passing UNCHANGED (backward compat); the FAFF-222 block adds the typed cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(...args) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

// FAFF-354: --record resolves the run dir off `findRoot()` (walks up from cwd looking
// for .git or .faff) — so these tests spawn with `cwd` pointed at a tmp dir carrying
// its own `.faff/runs/<run-id>/`, never the real repo's run history.
function runIn(cwd, ...args) {
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}
function tmpRunDir(runId = "r1") {
  const root = mkdtempSync(join(tmpdir(), "faff-contain-record-"));
  mkdirSync(join(root, ".faff", "runs", runId), { recursive: true });
  return root;
}
// FAFF-219 untyped form: a list of [id, parentId] pairs → [{id, parentId}, ...].
const anc = (...pairs) => JSON.stringify(pairs.map(([id, parentId]) => ({ id, parentId })));
// FAFF-222 typed form: pass entry objects through verbatim → JSON array.
const tanc = (...entries) => JSON.stringify(entries);

test("contain --selftest passes (the contained/outward/fail-closed table)", () => {
  const r = run("contain", "--selftest");
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

test("direct child is contained, exit 0 (C.parentId = M)", () => {
  const r = run("contain", "M", "--parent", "C", "--ancestry", anc(["C", "M"]));
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
});

test("transitive descendant is contained (G -> C -> M)", () => {
  const r = run("contain", "M", "--parent", "G", "--ancestry", anc(["G", "C"], ["C", "M"]));
  assert.equal(r.code, 0);
});

test("base case mandate == parent is contained without ancestry", () => {
  const r = run("contain", "M", "--parent", "M");
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
});

test("out-of-subtree parent is outward, exit 3 (fail-closed)", () => {
  const r = run("contain", "M", "--parent", "U", "--ancestry", anc(["U", "OTHER_ROOT"]));
  assert.equal(r.code, 3);
  assert.match(r.out, /outward/);
});

test("the mandate's ancestor (expanding upward) is outward", () => {
  // parent P is the mandate's parent — deepening would go down, not up.
  const r = run("contain", "M", "--parent", "P", "--ancestry", anc(["M", "P"]));
  assert.equal(r.code, 3);
});

test("--root (intended new root) is outward, exit 3", () => {
  const r = run("contain", "M", "--root");
  assert.equal(r.code, 3);
  assert.match(r.out, /outward/);
  assert.match(r.out, /new root/);
});

test("unknown/absent parentId is outward (fail-closed)", () => {
  // X has no entry in the supplied chain → the link is unknown → outward.
  const r = run("contain", "M", "--parent", "X", "--ancestry", anc(["Z", "M"]));
  assert.equal(r.code, 3);
});

test("explicit null parentId (a root that isn't the mandate) is outward", () => {
  const r = run("contain", "M", "--parent", "R", "--ancestry", anc(["R", null]));
  assert.equal(r.code, 3);
});

test("a cycle in the supplied ancestry is outward (visited guard, fail-closed)", () => {
  const r = run("contain", "M", "--parent", "A", "--ancestry", anc(["A", "B"], ["B", "A"]));
  assert.equal(r.code, 3);
});

test("--json emits the structured verdict for contained", () => {
  const r = run("contain", "M", "--parent", "C", "--ancestry", anc(["C", "M"]), "--json");
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out);
  assert.deepEqual(o, { mandate: "M", parent: "C", root: false, verdict: "contained" });
});

test("--json emits the structured verdict for an outward root", () => {
  const r = run("contain", "M", "--root", "--json");
  assert.equal(r.code, 3);
  const o = JSON.parse(r.out);
  assert.deepEqual(o, { mandate: "M", parent: null, root: true, verdict: "outward" });
});

// --- usage / malformed-args (exit 2, never a silent verdict) ---

test("missing mandate is a usage error (exit 2)", () => {
  assert.equal(run("contain").code, 2);
});

test("neither --parent nor --root is a usage error (exit 2)", () => {
  const r = run("contain", "M");
  assert.equal(r.code, 2);
  assert.match(r.err, /exactly one of --parent .* or --root/);
});

test("--parent and --root together is a usage error (exit 2)", () => {
  const r = run("contain", "M", "--parent", "C", "--root");
  assert.equal(r.code, 2);
  assert.match(r.err, /mutually exclusive/);
});

test("malformed --ancestry JSON is a usage error, no verdict (exit 2)", () => {
  const r = run("contain", "M", "--parent", "C", "--ancestry", "not json");
  assert.equal(r.code, 2);
  assert.match(r.err, /JSON array/);
});

test("--ancestry that isn't an array is a usage error (exit 2)", () => {
  const r = run("contain", "M", "--parent", "C", "--ancestry", '{"id":"C"}');
  assert.equal(r.code, 2);
});

test("a non-root --parent (≠ mandate) with no ancestry is a usage error (exit 2)", () => {
  // Can't compute containment for a real parent without the chain → fail loud,
  // never silently outward.
  const r = run("contain", "M", "--parent", "C");
  assert.equal(r.code, 2);
  assert.match(r.err, /--ancestry .* is required/);
});

test("a dangling value flag is a usage error (exit 2)", () => {
  const r = run("contain", "M", "--parent", "--ancestry", anc(["C", "M"]));
  assert.equal(r.code, 2);
  assert.match(r.err, /needs a value/);
});

test("the command is PURE — no tracker/network call (smoke: succeeds offline)", () => {
  // No tracker env, no network — a real verdict still computes from the supplied
  // ancestry alone. (The CLI makes no MCP call by construction.)
  const r = run("contain", "M", "--parent", "C", "--ancestry", anc(["C", "M"]));
  assert.equal(r.code, 0);
});

// ===========================================================================
// FAFF-222 — container-level mandates (issue | project | initiative): typed
// AncestryEntry + the mixed-graph containment walk. The untyped cases above are
// the backward-compat contract and stay unchanged; these exercise the new edges.
// ===========================================================================

test("FAFF-222: issue created under its mandate-PROJECT is contained (top-level issue → projectId)", () => {
  // Mandate P is a project; intended parent I is a top-level issue whose projectId is P.
  const r = run("contain", "P", "--parent", "I", "--ancestry", tanc({ id: "I", type: "issue", projectId: "P" }));
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
});

test("FAFF-222: project created under its mandate-INITIATIVE is contained (project → initiativeId)", () => {
  // Mandate N is an initiative; intended parent Q is a project whose initiativeId is N.
  // (The walk computes containment regardless of the autonomous ceiling — that's a wiring policy.)
  const r = run("contain", "N", "--parent", "Q", "--ancestry", tanc({ id: "Q", type: "project", initiativeId: "N" }));
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
});

test("FAFF-222: sub-issue whose parent issue is in a DIFFERENT project is outward (S→I→Q≠P)", () => {
  const r = run("contain", "P", "--parent", "S", "--ancestry",
    tanc({ id: "S", type: "issue", parentId: "I" }, { id: "I", type: "issue", projectId: "Q" }));
  assert.equal(r.code, 3);
  assert.match(r.out, /outward/);
});

test("FAFF-222: parentId-DOMINANT — sub-issue's own projectId differs but its parent is in mandate-project P → contained (S→I→P)", () => {
  // S.projectId = OTHER, but S.parentId = I and I.projectId = P. parentId is climbed first,
  // so S lives under I's subtree under P. The ADR-promoted membership rule.
  const r = run("contain", "P", "--parent", "S", "--ancestry",
    tanc({ id: "S", type: "issue", parentId: "I", projectId: "OTHER" }, { id: "I", type: "issue", projectId: "P" }));
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
});

test("FAFF-222: node with no container edge of its kind (project, null initiativeId) ≠ mandate is outward (fail-closed)", () => {
  const r = run("contain", "N", "--parent", "Q", "--ancestry", tanc({ id: "Q", type: "project", initiativeId: null }));
  assert.equal(r.code, 3);
  assert.match(r.out, /outward/);
});

test("FAFF-222: an initiative node (top of hierarchy, no edge) that isn't the mandate is outward", () => {
  const r = run("contain", "N", "--parent", "X", "--ancestry", tanc({ id: "X", type: "initiative" }));
  assert.equal(r.code, 3);
});

test("FAFF-222: transitive issue→project→initiative chain up to an initiative mandate is contained", () => {
  const r = run("contain", "N", "--parent", "I", "--ancestry",
    tanc({ id: "I", type: "issue", projectId: "Q" }, { id: "Q", type: "project", initiativeId: "N" }));
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
});

test("FAFF-222: a cycle across TYPED edges is outward (visited guard, fail-closed)", () => {
  // Q (project) → N (initiative); N has no edge but we point it back implicitly by reusing
  // a project node with the same id chain would loop — model an explicit cross-type cycle:
  const r = run("contain", "M", "--parent", "Q", "--ancestry",
    tanc({ id: "Q", type: "project", initiativeId: "N" }, { id: "N", type: "project", initiativeId: "Q" }));
  assert.equal(r.code, 3);
  assert.match(r.out, /outward/);
});

test("FAFF-222: mixed typed + untyped entries in one ancestry — untyped defaults to issue (S→C→M contained)", () => {
  const r = run("contain", "M", "--parent", "S", "--ancestry",
    '[{"id":"S","type":"issue","parentId":"C"},{"id":"C","parentId":"M"}]');
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
});

test("FAFF-222: a project-mandate base case (parent == mandate) is contained without ancestry", () => {
  const r = run("contain", "P", "--parent", "P");
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
});

test("FAFF-222: an unknown type value is a usage error, no verdict (exit 2)", () => {
  const r = run("contain", "M", "--parent", "X", "--ancestry", tanc({ id: "X", type: "epic" }));
  assert.equal(r.code, 2);
  assert.match(r.err, /type/);
});

test("FAFF-222: --json shape is byte-identical for a typed contained verdict (no new fields)", () => {
  const r = run("contain", "P", "--parent", "I", "--ancestry", tanc({ id: "I", type: "issue", projectId: "P" }), "--json");
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out);
  assert.deepEqual(o, { mandate: "P", parent: "I", root: false, verdict: "contained" });
});

// ===========================================================================
// FAFF-354 — hardening against agent-supplied ancestry: `--record <run-id>` binds
// each verdict to the exact payload it was computed from via a `containment-check`
// event; `--phase` tags that event; both are purely additive (no --record ⇒
// byte-identical to every case above).
// ===========================================================================

test("FAFF-354: --record happy path — verdict/exit unchanged, one containment-check event appended", () => {
  const root = tmpRunDir("r1");
  const r = runIn(root, "contain", "M", "--parent", "C", "--ancestry", anc(["C", "M"]), "--record", "r1");
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
  const raw = readFileSync(join(root, ".faff", "runs", "r1", "events.jsonl"), "utf8").trim();
  const ev = JSON.parse(raw);
  assert.equal(ev.schema, 1);
  assert.equal(ev.run_id, "r1");
  assert.equal(ev.seq, 0);
  assert.equal(ev.phase, "run");
  assert.equal(ev.type, "containment-check");
  assert.equal(ev.issue, "M");
  assert.deepEqual(ev.data, { mandate: "M", parent: "C", root: false, ancestry_raw: anc(["C", "M"]), verdict: "contained", exit: 0 });
});

test("FAFF-354: --record on an outward verdict records verdict:outward, exit:3 unchanged", () => {
  const root = tmpRunDir("r1");
  const r = runIn(root, "contain", "M", "--root", "--record", "r1", "--phase", "tidy");
  assert.equal(r.code, 3);
  const ev = JSON.parse(readFileSync(join(root, ".faff", "runs", "r1", "events.jsonl"), "utf8").trim());
  assert.equal(ev.phase, "tidy");
  assert.deepEqual(ev.data, { mandate: "M", parent: null, root: true, ancestry_raw: null, verdict: "outward", exit: 3 });
});

test("FAFF-354: --record with a missing run dir → exit 2, no verdict printed, nothing appended", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-contain-record-")); // .faff/runs/nope never created
  const r = runIn(root, "contain", "M", "--parent", "M", "--record", "nope");
  assert.equal(r.code, 2);
  assert.match(r.err, /run dir missing/);
  assert.doesNotMatch(r.out, /contained|outward/);
  assert.equal(existsSync(join(root, ".faff", "runs", "nope", "events.jsonl")), false);
});

test("FAFF-354: --phase outside EVENT_PHASES is a usage error, no verdict, nothing appended", () => {
  const root = tmpRunDir("r1");
  const r = runIn(root, "contain", "M", "--parent", "M", "--record", "r1", "--phase", "bogus");
  assert.equal(r.code, 2);
  assert.match(r.err, /--phase must be one of/);
  assert.equal(existsSync(join(root, ".faff", "runs", "r1", "events.jsonl")), false);
});

test("FAFF-354: --phase without --record is a usage error (exit 2)", () => {
  const r = run("contain", "M", "--parent", "M", "--phase", "tidy");
  assert.equal(r.code, 2);
  assert.match(r.err, /--phase only makes sense alongside --record/);
});

// FAFF-494: `plot` is a first-class event phase — the autonomous plot re-entry
// harness records each write-time containment-check with `--phase plot`, so audit
// can recompute-and-compare the pass's creates. Before FAFF-494 `--phase plot`
// exited 2 ("must be one of run, tidy, prep, build"); it is now accepted and tags
// the recorded containment-check event `phase: "plot"`, identical mechanics to the
// other phases.
test("FAFF-494: --phase plot is accepted and tags the recorded containment-check event", () => {
  const root = tmpRunDir("r1");
  const r = runIn(root, "contain", "R", "--parent", "R", "--record", "r1", "--phase", "plot");
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
  const ev = JSON.parse(readFileSync(join(root, ".faff", "runs", "r1", "events.jsonl"), "utf8").trim());
  assert.equal(ev.phase, "plot");
  assert.equal(ev.type, "containment-check");
  assert.deepEqual(ev.data, { mandate: "R", parent: "R", root: false, ancestry_raw: null, verdict: "contained", exit: 0 });
});

test("FAFF-354: --record with a run-id containing a path separator is a usage error (traversal guard)", () => {
  const root = tmpRunDir("r1");
  const r = runIn(root, "contain", "M", "--parent", "M", "--record", "nested/path");
  assert.equal(r.code, 2);
  assert.match(r.err, /path separator/);
});

test("FAFF-354: --record with a '..' run-id segment is a usage error (traversal guard)", () => {
  const root = tmpRunDir("r1");
  const r = runIn(root, "contain", "M", "--parent", "M", "--record", "../evil");
  assert.equal(r.code, 2);
  assert.match(r.err, /path separator/);
});

test("FAFF-354: isSafeRunId rejects a control character (e.g. embedded NUL) in the run-id", async () => {
  // A real CLI invocation can never carry a NUL byte in argv — Node's own
  // child_process.spawnSync (and every POSIX shell) rejects/strips it before the
  // process even starts — so this exercises the pure predicate directly (the
  // in-process call path `cmdContain` is also exported for direct use).
  const { isSafeRunId } = await import("../plugin/skills/faff/bin/lib/contain.js");
  assert.equal(isSafeRunId(`run${String.fromCharCode(0)}trav`), false);
  assert.equal(isSafeRunId(`run${String.fromCharCode(10)}trav`), false);
});

test("FAFF-354: without --record, behaviour is byte-identical to before (back-compat)", () => {
  const r = run("contain", "M", "--parent", "C", "--ancestry", anc(["C", "M"]), "--json");
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out);
  assert.deepEqual(o, { mandate: "M", parent: "C", root: false, verdict: "contained" });
});

test("FAFF-354: two --record calls into the same run append two events with monotonic seq", () => {
  const root = tmpRunDir("r1");
  runIn(root, "contain", "M", "--parent", "M", "--record", "r1");
  runIn(root, "contain", "M", "--parent", "C", "--ancestry", anc(["C", "M"]), "--record", "r1");
  const lines = readFileSync(join(root, ".faff", "runs", "r1", "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.seq), [0, 1]);
});
