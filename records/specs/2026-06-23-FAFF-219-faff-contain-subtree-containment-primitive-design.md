# FAFF-219 — `faff contain`: subtree-of-mandate containment primitive (issue-level)

> Split A of **FAFF-217** (scope-containment provenance). This ticket ships the
> net-new, highest-risk core + the de-risking spike: the pure `faff contain` CLI
> primitive and its `subtree_contains` ancestry walk. The provenance schema 1→2
> bump (FAFF-220), the chokepoint wiring + outward-new-root surfacing (FAFF-221),
> and container/initiative-level mandates (FAFF-222) are SEPARATE tickets and are
> out of scope here. The full family design is reproduced below from FAFF-217's
> spec comment; **Section 3's containment primitive is what FAFF-219 builds.**

## Scope of FAFF-219 (this ticket)

A new **pure** CLI command — no MCP / tracker / network call, the same invariant
as `eligible` / `next` / `intakecheck`:

```
faff contain <mandate> (--parent <id> | --root) --ancestry <json> [--json]
  # --ancestry: the agent-fetched parentId chain, a JSON array of {id, parentId}
  # --root:     signals an intended new root (no parent)
  contained  → exit 0   # parent == mandate OR parent ∈ transitive descendants(mandate)
  outward    → exit 3   # --root, or parent not in subtree(mandate); FAIL-CLOSED
  usage      → exit 2   # malformed ancestry / missing or conflicting args
```

`subtreeContains(mandate, parent, parentOf)` walks the supplied ancestry from
`<parent>` upward following `parentId`; reaching the mandate = contained,
exhausting to a different root / an unknown link / a cycle = outward (fail-closed).

### Acceptance (FAFF-219)

- `faff contain` exists, pure, three exit codes; `subtree_contains` per spec §3.
- Fail-closed on `--root`, cycle, unknown/absent parentId, out-of-subtree parent.
- `mandate == parent` → contained (base case).
- Selftest cases covering contained / outward / fail-closed (`faff contain --selftest`,
  the `CONTAIN_SELFTEST_CASES` table), plus `test/contain.test.mjs` driving the
  real entrypoint and a CI selftest gate.

### Out of scope (separate tickets)

- Provenance schema 1→2 + `initiated` audit field — **FAFF-220**.
- Wiring the autonomous filing chokepoints + outward-new-root surfacing — **FAFF-221**.
- Container-level (initiative / project) mandates, the mixed-graph L4 walk — **FAFF-222**.
- v1 is **issue-level mandates only** (sub-issue `parentId` chain).

---

## Source design (FAFF-217 — Scope-containment provenance)

> Reproduced verbatim from FAFF-217's `# nlspec` comment (faffter-dark-nlspec,
> 2026-06-23, confidence: medium). FAFF-219 implements Section 3's containment
> primitive; the rest is the family context it slots into.

### 1. WHY — Problem and Principles

Containment is enforced by *refusing the write*, not by reading a marker after
the fact. An autonomous run holds a **mandate** — the single issue (or, later,
container) the orchestrator dispatched it to build, drawn from the human-admitted
eligible queue. The run may create tickets only **inside the subtree of that
mandate** (`parent ∈ subtree(mandate)`); a create that would land a new root or an
out-of-subtree ticket is refused at the create op. The distinguisher is
**initiation mode** (autonomous vs interactive), not the writer (faff is the writer
in both cases) and not a spoofable parent.

Design principles:

- **Containment is `parent ∈ subtree(mandate)`, never "has a parent".** The mandate
  is orchestrator-supplied; the build agent cannot pick or widen it.
- **The mode signal is structural, not a CLI flag.** Enforcement lives at the
  autonomous orchestrator's filing chokepoint, not at a flag the agent could set.
- **fast-track is human-only.** An autonomous run that wants a new root parks; it
  never self-serves the override.
- **The `initiated` field is an audit breadcrumb, not the guarantee.**
- **Deterministic primitive, agent-fed ancestry.** The CLI computes subtree
  membership purely (no MCP); the agent fetches the tracker ancestry and passes it in.

### 3. WHAT — the containment primitive (FAFF-219)

```
PROCEDURE subtree_contains(mandate, parent, ancestry):
  IF parent is --root: RETURN outward
  cursor := parent
  VISITED := {}
  WHILE cursor is not null AND cursor not in VISITED:
    IF cursor == mandate: RETURN contained
    VISITED.add(cursor)
    cursor := ancestry.parentId_of(cursor)   # null if unknown/absent
  RETURN outward      # walked to a root ≠ mandate, or hit a cycle/unknown
```

### Edge cases (FAFF-219)

- **Unknown/absent parentId** → walk exhausts to a non-mandate root → outward (fail-closed).
- **Cycle in supplied ancestry** → VISITED guard terminates → outward (fail-closed).
- **Malformed `--ancestry` JSON** → exit 2 (usage), no verdict; the chokepoint logs
  and surfaces, does not crash.
- **mandate == parent** (first child of the mandate) → contained (base case).

### Non-functional assertions

- `faff contain` performs **no tracker/MCP call** — pure, ancestry passed in
  (parity with `eligible` / `next` / `intakecheck`).

### Integration smoke test (FAFF-219 portion)

```
faff contain M --parent C --ancestry [{"id":"C","parentId":"M"}]            ⇒ exit 0 (contained)
faff contain M --parent UNRELATED --ancestry [{"id":"UNRELATED","parentId":"OTHER_ROOT"}] ⇒ exit 3 (outward)
faff contain M --root                                                       ⇒ exit 3 (outward)
faff contain M --parent M                                                   ⇒ exit 0 (base case)
```

---

confidence: medium (inherited from FAFF-217; FAFF-219 is the de-risking spike that
resolves the net-new ancestry-walk).
