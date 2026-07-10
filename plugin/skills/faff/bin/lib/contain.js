// ===========================================================================
// === region:factory — contain — FAFF-219 (Split A of FAFF-217), generalized to container mandates by ===
// FAFF-222 (Down the pub / L4). The subtree-of-mandate containment primitive: the
// net-new deterministic core the whole scope-containment family rests on. An
// autonomous run holds a MANDATE (the container the orchestrator dispatched it to
// deliver, from the human-admitted eligible queue); it may create work only INSIDE
// the subtree of that mandate (`parent ∈ subtree(mandate)`). This command answers
// that one question — contained (deepen) vs outward (widen) — and nothing else.
//
// FAFF-222 widens the MANDATE from issue-only to issue | project | initiative, and
// the walk from a homogeneous `parentId` chain to a single chain across TYPED
// containment edges over the mixed Initiative ⊃ Project ⊃ Issue ⊃ sub-issue graph.
// Each node climbs ONE typed edge chosen by its type (container_parent):
//   issue       → parentId, else projectId, else null  (parentId-DOMINANT: the
//                 explicit issue-parent link is the tightest containment edge;
//                 projectId is consulted only at a top-level issue with no parent)
//   project     → initiativeId, else null
//   initiative  → null (top of the hierarchy)
// An untyped {id, parentId} entry is an issue whose edge is parentId — BYTE-identical
// behaviour to FAFF-219, so the full prior selftest + test suite pass unchanged. The
// project-mandate AUTONOMOUS CEILING is a wiring-layer policy, NOT a primitive gate:
// the CLI computes containment for an initiative mandate too; how far up a run may be
// dispatched is enforced at the chokepoints, never here (the primitive is type-agnostic).
//
// PURE — no MCP / tracker / network call, same invariant as `eligible`/`next`/
// `intakecheck`. The agent fetches the (now mixed-graph) ancestry from the tracker
// and passes it in via --ancestry; the CLI only walks it. Schema bump (FAFF-220), the
// `initiated` field, and wiring the autonomous filing chokepoints (FAFF-221) are
// SEPARATE tickets — this command is the primitive they build on, not the enforcement.
//
// CONTAINMENT IS FAIL-CLOSED on every typed edge. A walk that exhausts to a root ≠
// mandate, hits an unknown/absent edge, hits an unknown node type, or hits a cycle
// returns `outward` — the cost of a false outward is a surfaced new-root request a
// human clears; a false contained would silently expand scope. `--root` (an intended
// new top-level container) is outward by definition. The base case mandate == parent
// is contained (the first child of the mandate), for issue/project/initiative alike.
// ===========================================================================

// The one new piece of logic: the single upward containment edge for a node, chosen
// by its type (the parentId-dominant cross-project membership rule — see ADR). Returns
// the container-parent id, or null (a root: no edge of the applicable kind). Pure, no
// throw. An absent `type` defaults to "issue" (backward compat); an unknown `type`
// value never reaches here — parseAncestry rejects it with usage exit 2.


function containerParent(entry) {
  if (!entry || typeof entry !== "object") return null;
  const type = entry.type || "issue";
  if (type === "issue") {
    // parentId FIRST (the tightest, most-intentional edge), then jump to the
    // containing project at a top-level issue; a top-level issue with no project = root.
    if (typeof entry.parentId === "string") return entry.parentId;
    if (typeof entry.projectId === "string") return entry.projectId;
    return null;
  }
  if (type === "project") {
    return typeof entry.initiativeId === "string" ? entry.initiativeId : null;
  }
  // type === "initiative": top of the hierarchy, no container edge.
  return null;
}

// Pure subtree-membership walk. `parent` is the intended parent id, or the ROOT
// sentinel (null) for an intended new root. `entryOf` maps id → the typed AncestryEntry
// (undefined when unknown/absent — the agent's fetched ancestry). Walks from `parent`
// upward following each node's TYPED containment edge (containerParent); reaching
// `mandate` → "contained"; exhausting to a root ≠ mandate, an unknown link, an unknown
// node, or a cycle → "outward" (fail-closed). Returns "contained" | "outward". No I/O,
// no throw. Note ids are compared by id only — Linear's issue/project/initiative id
// namespaces are disjoint, so the walk needs no mandate-type argument.
const CONTAIN_ROOT = null; // the --root sentinel: an intended new root
function subtreeContains(mandate, parent, entryOf) {
  if (parent === CONTAIN_ROOT) return "outward";  // intended new root — never contained
  const lookup = entryOf instanceof Map ? (id) => entryOf.get(id) : (id) => entryOf[id];
  let cursor = parent;
  const visited = new Set();
  while (cursor !== null && cursor !== undefined && !visited.has(cursor)) {
    if (cursor === mandate) return "contained";    // base case + transitive ancestor reached
    visited.add(cursor);
    const entry = lookup(cursor);                  // undefined if unknown/absent → null below
    cursor = entry ? containerParent(entry) : null;
  }
  return "outward"; // walked to a root ≠ mandate, hit an unknown link, an unknown node, or a cycle
}

// Build the id→entry lookup from the agent-supplied ancestry array. Each entry is a
// typed AncestryEntry {id, type?, parentId?, projectId?, initiativeId?} (FAFF-222) —
// a typed SUPERSET of FAFF-219's {id, parentId}. An absent `type` ⇒ "issue"; absent
// edge fields ⇒ no edge of that kind (→ fail-closed outward when the walk exhausts
// there). Throws on a non-array / malformed shape / UNKNOWN `type` value so the
// caller can map it to a usage exit (2) rather than a silent wrong verdict.
const CONTAIN_ENTRY_TYPES = new Set(["issue", "project", "initiative"]);
function parseAncestry(json) {
  const arr = JSON.parse(json); // may throw → caught by caller
  if (!Array.isArray(arr)) throw new Error("--ancestry must be a JSON array of {id, type?, parentId?, projectId?, initiativeId?}");
  const m = new Map();
  for (const e of arr) {
    if (!e || typeof e !== "object" || typeof e.id !== "string") {
      throw new Error("--ancestry entries must be objects with a string id");
    }
    if (e.type !== undefined && !CONTAIN_ENTRY_TYPES.has(e.type)) {
      throw new Error(`--ancestry entry type must be one of issue|project|initiative (got ${JSON.stringify(e.type)})`);
    }
    // Store the whole typed entry, coercing absent/non-string edges to null so
    // containerParent reads a clean shape. Untyped {id, parentId} ⇒ {type:"issue",
    // parentId, projectId:null, initiativeId:null} ⇒ edge = parentId ⇒ FAFF-219 walk.
    m.set(e.id, {
      id: e.id,
      type: e.type !== undefined ? e.type : "issue",
      parentId: typeof e.parentId === "string" ? e.parentId : null,
      projectId: typeof e.projectId === "string" ? e.projectId : null,
      initiativeId: typeof e.initiativeId === "string" ? e.initiativeId : null,
    });
  }
  return m;
}

// `faff contain <mandate> (--parent <id> | --root) --ancestry <json> [--json]`
// PURE: walks the supplied ancestry, no tracker call. exit 0 contained · 3 outward
// (fail-closed: --root / unknown / cycle / out-of-subtree) · 2 usage/malformed-args.
const CONTAIN_VALUE_FLAGS = new Set(["--parent", "--ancestry", "--root"]);
function cmdContain(args) {
  if (args.includes("--selftest")) return containSelftest();
  // Parse: first bare token is the mandate; --parent takes a value, --root is a
  // boolean (mutually exclusive with --parent), --ancestry takes a value.
  let mandate = null;
  const flags = {};
  let danglingValueFlag = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") { flags["--root"] = true; continue; } // boolean despite naming overlap
    if (CONTAIN_VALUE_FLAGS.has(a)) {
      const nxt = args[i + 1];
      if (nxt === undefined || nxt.startsWith("--")) { danglingValueFlag = a; continue; }
      flags[a] = nxt; i++;
    } else if (a.startsWith("--")) {
      flags[a] = true;
    } else if (mandate === null) {
      mandate = a;
    }
  }
  const asJson = flags["--json"] === true;
  const usage = "faff contain: usage: faff contain <mandate> (--parent <id> | --root) --ancestry <json> [--json]";

  if (danglingValueFlag) { process.stderr.write(`faff contain: ${danglingValueFlag} needs a value.\n`); return 2; }
  if (!mandate) { process.stderr.write(`${usage}\n`); return 2; }

  const wantRoot = flags["--root"] === true;
  const parentArg = flags["--parent"];
  if (wantRoot && parentArg !== undefined) {
    process.stderr.write("faff contain: --parent and --root are mutually exclusive.\n"); return 2;
  }
  if (!wantRoot && parentArg === undefined) {
    process.stderr.write("faff contain: supply exactly one of --parent <id> or --root.\n"); return 2;
  }

  // --ancestry is required EXCEPT for --root (which is unconditionally outward) and
  // the mandate==parent base case (the walk reaches the mandate before any lookup);
  // we still require it for any other --parent so an omitted chain can't masquerade
  // as a verdict. Parse fail-loud (malformed JSON / shape / unknown type → usage, no verdict).
  let entryOf = new Map();
  const ancestryArg = flags["--ancestry"];
  if (typeof ancestryArg === "string") {
    try { entryOf = parseAncestry(ancestryArg); }
    catch { process.stderr.write("faff contain: --ancestry must be a JSON array of {id, type?, parentId?, projectId?, initiativeId?} objects (type ∈ issue|project|initiative).\n"); return 2; }
  } else if (!wantRoot && parentArg !== mandate) {
    // No ancestry given and the parent isn't the mandate itself → can't compute → usage.
    process.stderr.write("faff contain: --ancestry <json> is required unless --root or --parent equals the mandate.\n"); return 2;
  }

  const parent = wantRoot ? CONTAIN_ROOT : parentArg;
  const verdict = subtreeContains(mandate, parent, entryOf);
  const exit = verdict === "contained" ? 0 : 3;
  const out = { mandate, parent: wantRoot ? null : parentArg, root: wantRoot, verdict };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else if (verdict === "contained") {
    console.log(`contained: ${parentArg} ∈ subtree(${mandate}).`);
  } else {
    console.log(`outward: ${wantRoot ? "intended new root" : `${parentArg} not in subtree(${mandate})`} — needs human sanction (fail-closed).`);
  }
  return exit;
}

// Selftest — drives the pure subtree walk over the contained / outward / fail-closed
// matrix, no filesystem. [mandate, parent, ancestry, want] where parent === CONTAIN_ROOT
// (null) models --root. `ancestry` accepts BOTH legacy [[id, parentId], ...] pairs
// (FAFF-219 — an untyped issue edge, kept byte-identical to prove backward compat) AND
// typed [{id, type, parentId?, projectId?, initiativeId?}, ...] entries (FAFF-222). The
// builder normalizes a pair [id, p] to {id, type:"issue", parentId:p} so both run through
// the same containerParent walk the CLI uses.
const CONTAIN_SELFTEST_CASES = [
  // ---- FAFF-219 cases: legacy [id, parentId] pairs, UNCHANGED (backward-compat proof) ----
  // base case: mandate == parent (first child of the mandate) → contained
  ["M", "M", [], "contained"],
  // direct child: parent C, C.parentId = M → contained
  ["M", "C", [["C", "M"]], "contained"],
  // transitive descendant: G -> C -> M → contained
  ["M", "G", [["G", "C"], ["C", "M"]], "contained"],
  // out-of-subtree: parent under a different root → outward
  ["M", "U", [["U", "OTHER"]], "outward"],
  // ancestor of the mandate (expanding upward, sibling under same root) → outward
  ["M", "P", [["M", "P"]], "outward"],
  // intended new root (--root) → outward
  ["M", CONTAIN_ROOT, [], "outward"],
  // unknown/absent parentId (walk hits a link not in the chain) → outward (fail-closed)
  ["M", "X", [], "outward"],
  // parentId present but null (explicit root that isn't the mandate) → outward
  ["M", "R", [["R", null]], "outward"],
  // cycle in the supplied ancestry (A -> B -> A) → outward (visited guard, fail-closed)
  ["M", "A", [["A", "B"], ["B", "A"]], "outward"],
  // long contained chain terminating at the mandate → contained
  ["M", "L3", [["L3", "L2"], ["L2", "L1"], ["L1", "M"]], "contained"],
  // long chain that just misses (terminates at a non-mandate root) → outward
  ["M", "L3", [["L3", "L2"], ["L2", "L1"], ["L1", "ROOT"]], "outward"],

  // ---- FAFF-222 cases: typed mixed-graph edges (issue/project/initiative) ----
  // issue created directly under its mandate-PROJECT (top-level issue → projectId=P) → contained
  ["P", "I", [{ id: "I", type: "issue", projectId: "P" }], "contained"],
  // project created under its mandate-INITIATIVE (project → initiativeId=N) → contained (walk only)
  ["N", "Q", [{ id: "Q", type: "project", initiativeId: "N" }], "contained"],
  // sub-issue S whose parent issue I is in a DIFFERENT project Q → outward (S→I→Q≠P)
  ["P", "S", [{ id: "S", type: "issue", parentId: "I" }, { id: "I", type: "issue", projectId: "Q" }], "outward"],
  // parentId-DOMINANT: sub-issue S's OWN projectId differs, but parent I is in mandate-project P → contained (S→I→P)
  ["P", "S", [{ id: "S", type: "issue", parentId: "I", projectId: "OTHER" }, { id: "I", type: "issue", projectId: "P" }], "contained"],
  // node with no container edge of its kind (project, null initiativeId) and id ≠ mandate → outward (fail-closed)
  ["N", "Q", [{ id: "Q", type: "project", initiativeId: null }], "outward"],
  // initiative node (top of hierarchy, no edge) that isn't the mandate → outward
  ["N", "X", [{ id: "X", type: "initiative" }], "outward"],
  // transitive container chain issue→project→initiative all the way up to an initiative mandate → contained
  ["N", "I", [{ id: "I", type: "issue", projectId: "Q" }, { id: "Q", type: "project", initiativeId: "N" }], "contained"],
  // cycle across TYPED edges (project Q → initiative N → ... → project Q) → outward (visited guard)
  ["M", "Q", [{ id: "Q", type: "project", initiativeId: "N" }, { id: "N", type: "initiative" }], "outward"],
  // mixed typed + untyped entries in one ancestry: untyped C defaults to issue, chains C→M → contained
  ["M", "S", [{ id: "S", type: "issue", parentId: "C" }, ["C", "M"]], "contained"],
  // project mandate, base case mandate == parent (create directly under the mandate) → contained
  ["P", "P", [], "contained"],
];

// Normalize a selftest ancestry element: a legacy [id, parentId] pair → an untyped issue
// entry; a typed object → itself. (The CLI path always builds typed entries via
// parseAncestry; this mirrors that so the selftest exercises the same walk.)
function containSelftestEntries(ancestry) {
  const m = new Map();
  for (const e of ancestry) {
    if (Array.isArray(e)) {
      const [id, parentId] = e;
      m.set(id, { id, type: "issue", parentId: typeof parentId === "string" ? parentId : null, projectId: null, initiativeId: null });
    } else {
      m.set(e.id, {
        id: e.id,
        type: e.type || "issue",
        parentId: typeof e.parentId === "string" ? e.parentId : null,
        projectId: typeof e.projectId === "string" ? e.projectId : null,
        initiativeId: typeof e.initiativeId === "string" ? e.initiativeId : null,
      });
    }
  }
  return m;
}

function containSelftest() {
  let fail = 0;
  for (const [mandate, parent, ancestry, want] of CONTAIN_SELFTEST_CASES) {
    const entryOf = containSelftestEntries(ancestry);
    const got = subtreeContains(mandate, parent, entryOf);
    const ok = got === want;
    if (!ok) fail++;
    const p = parent === CONTAIN_ROOT ? "--root" : parent;
    console.log(`${ok ? "ok  " : "FAIL"} mandate=${mandate} parent=${p} ancestry=${JSON.stringify(ancestry)} → ${got}${ok ? "" : ` (want ${want})`}`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${CONTAIN_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { CONTAIN_ENTRY_TYPES, CONTAIN_ROOT, CONTAIN_SELFTEST_CASES, CONTAIN_VALUE_FLAGS, cmdContain, containSelftest, containSelftestEntries, containerParent, parseAncestry, subtreeContains };
