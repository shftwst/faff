# nlspec — FAFF-221: Wire containment at the autonomous filing chokepoints + outward-new-root surfacing

> Spec: faffter-dark-nlspec · 2026-06-23 · autonomous · confidence: high. Full spec on Linear FAFF-221.

**Artifact:** integration spec for FAFF-221 — *Split C of FAFF-217 (scope-containment provenance).* This is the **wiring** slice: it consumes the `faff contain` primitive (FAFF-219) and the `initiated` provenance field (FAFF-220), and enforces them at the two autonomous-by-construction filing chokepoints. **Audience:** the build agent wiring the chokepoints, serialised behind FAFF-219 + FAFF-220 in this same run. **The full design lives on FAFF-217's spec comment** (`list_comments` FAFF-217 → the `# nlspec — FAFF-217` comment + the four settled-decision comments). This spec does **not** restate that design; it pins the concrete integration contract and references the parent for every rationale.

## 1. WHY — Problem and Principles

**The slice.** FAFF-219 ships the deterministic `faff contain <mandate> --parent <p|--root> --ancestry <json>` primitive (contained=0 / outward=3 / usage=2). FAFF-220 ships the provenance schema 1→2 bump with `initiated: interactive | autonomous`. Neither *enforces* anything on its own — the containment guarantee only exists once **every autonomous create routes through the check before writing**. That wiring is this ticket.

**Why at the chokepoint, not a flag.** The mode signal (autonomous vs interactive) is structural/contextual prose, not a CLI flag (`faff/SKILL.md` ~559) — a flag is the spoofable surface FAFF-217 routes around. Enforcement therefore lives at the code paths that are autonomous *by construction* and hold the mandate: **beep-boop file-discovered-scope (§10)** and **tidy chain-gap auto-fill**. Interactive jot/plot are a different code path with a human present — the human *is* the sanction — so they create freely and only stamp `initiated: interactive`.

**Design principles** (each would reject an otherwise-valid implementation):

- **The two chokepoints are exhaustive — prove it.** The guarantee depends on *no other* autonomous create path existing. The build must enumerate every faff path that creates a tracker ticket and prove only these two file autonomously (graft only *records* discovered scope — `faff-graft/SKILL.md` ~315, ~429). A third autonomous create path found and not wired = an incomplete guarantee = a `fail`.
- **Containment is a precondition, not a replacement for appetite.** A `contained` verdict does not auto-file; it lets the item *proceed to the existing appetite gate* (`faff/SKILL.md` ~627 Execution-discovered row / tidy chain-gap row). Both gates must pass.
- **Outward is never auto-filed, at any appetite including `full`.** This is a new hard floor on the appetite dial (`faff/SKILL.md` ~633), sibling to "no autonomous cancel/delete even at `full`."
- **fast-track is human-only** — no autonomous path self-calls `--via fast-track` to convert its own outward verdict (the FAFF-212/218 family rule).
- **Ancestry is fetched fresh at filing time** — never reused from an earlier pass; a stale chain could make an outward parent look contained.

## 2. OUT OF SCOPE

- **The `faff contain` primitive itself** — FAFF-219. This slice *calls* it; it adds no ancestry-walk code.
- **The provenance schema bump + `initiated` field mechanics** — FAFF-220. This slice *writes* `initiated` at the create paths but does not define the record shape.
- **Container-level (initiative/project) mandates** — FAFF-217 punt; v1 is issue-level only. *Extension point:* FAFF-222.
- **Read-side actor attribution** — FAFF-217 OUT OF SCOPE.
- **Out-of-faff direct-tracker creation** — FAFF-212's `intakecheck` backstop catches it at graft.

## 3. WHAT — the integration contract

**The mandate at each chokepoint:**

- **beep-boop §10:** each `discovered-scope.json` is keyed to the **issue that was built**. That built issue **is the mandate** for its own discovered items. `mandate := <the ISSUE dir it came from>`.
- **tidy chain-gap auto-fill:** the **active ticket whose spec named the gap** is the mandate. `mandate := <the active ticket the gap was detected against>`.

**`autonomous_file_check` — the shared procedure both chokepoints call:**

```
PROCEDURE autonomous_file_check(mandate, candidate):
  1. parent   := candidate.intended_parent            # sanctioned ancestor, or none → --root
  2. ancestry := tracker.fetch_parent_chain(parent)   # FRESH agent-side MCP read at filing time
  3. verdict  := faff contain <mandate> (--parent <parent> | --root) --ancestry <ancestry>   # exit 0/3/2
  4. contained (exit 0): proceed to the EXISTING appetite gate; on create stamp
       initiated: autonomous via `faff intake-record <new> --via jot --initiated autonomous`
  5. outward (exit 3): create NOTHING; record DiscoveredScopeEntry { containment: "outward-new-root" };
       surface via /faff-wtf §4 AND comment on the mandate issue; do NOT park the build
  6. usage (exit 2): malformed ancestry → log, surface, no create, do NOT crash
  # NEVER self-call `--via fast-track` to convert an outward verdict.
```

**DiscoveredScopeEntry — `containment` field** (additive): `containment: contained | outward-new-root | null`; `outward-new-root` ⇒ never auto-filed, surface-only.

**Appetite dial — the new outward hard floor** (`faff/SKILL.md` ~633): an `outward / new-root` item is `never` auto-filed at every level — low/medium/high/full — sibling to the no-autonomous-cancel/delete floor.

## 4. HOW — Behavior

Three edits, one proof. (1) Insert `autonomous_file_check` ahead of the create in **beep-boop §10**. (2) Insert the same check ahead of the create in **tidy chain-gap auto-fill**. (3) Add the outward hard-floor row to the appetite table (`faff/SKILL.md`) + the `containment` field note to the graft discovered-scope schema. The *proof* (AC) is enumerating every autonomous create path and showing only these two exist.

**Interactive create (unconstrained).** jot/plot create freely, no containment check, stamp `initiated: interactive`. This slice touches the interactive paths **only** to confirm they pass `initiated: interactive`.

**"Approval" = the human creating it later, interactively.** The outward-new-root request queues on already-sanctioned surfaces until a human creates the root via `/faff-jot` (→ `interactive`) or fast-tracks it.

**Composition:** create-then-re-parent-out is blocked by FAFF-216's L3 guard; out-of-faff direct create is caught by FAFF-212's `intakecheck`. Neither is re-implemented here.

**Edge cases:** `--root`/cycle/unknown-parentId → outward (fail-closed, FAFF-219); malformed `--ancestry` → exit 2 → log + surface, no create; mandate == parent → contained; graft already tagged `outward-new-root` → §10 never files (surface-only).

## 5. Scenarios

```
Given a beep-boop run with mandate FAFF-300, discovered item parented under FAFF-300
When §10 runs autonomous_file_check(FAFF-300, item)
Then faff contain returns contained (exit 0), the item proceeds to the appetite gate,
  is filed at high appetite, provenance { schema:2, initiated: autonomous }
```

```
Given a discovered item whose intended parent is a new root (--root) or out-of-subtree
When §10 runs the check
Then faff contain returns outward (exit 3); nothing is created;
  a DiscoveredScopeEntry { containment: "outward-new-root" } is recorded;
  it surfaces in /faff-wtf §4 AND a comment is posted on FAFF-300; the run is NOT parked
```

```
Given tidy detects an upstream chain gap under FAFF-410 whose prerequisite is a new root
When chain-gap auto-fill runs the check with mandate FAFF-410
Then the verdict is outward; no gap ticket is created at any appetite including full (hard floor)
```

```
Given the enumerate-all-autonomous-create-paths audit
When every faff path that creates a tracker ticket is listed
Then exactly two file autonomously (beep-boop §10, tidy chain-gap); graft only records
```

## 6. DESIGN DECISION RATIONALE

**Surfacing channel — chosen:** record the `outward-new-root` discovered-scope entry **and** post a comment on the mandate issue. The discovered-scope record + `/faff-wtf §4` is the authoritative always-on channel; the mandate-issue comment is the tracker-native breadcrumb. Volume is self-limiting.

**Enforcement — chosen:** the by-construction chokepoint, not a mode flag.

**Is `contained` sufficient to file? — chosen:** no — containment is a precondition; the existing appetite gate still decides.

**Interactive paths — chosen:** only confirm they pass `initiated: interactive`; no containment check.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none blocking (surfacing channel settled in §6).

**Assumptions** (validated this build): FAFF-219 (`faff contain`) + FAFF-220 (`--initiated`) are on origin/main (bf6a3fc) — confirmed `cmdContain` + `PROVENANCE_SCHEMA == 2` + `intake-record --initiated`. The two chokepoints are exhaustive — confirmed by the enumerate-all-paths audit. The tracker exposes `parentId` for the fresh ancestry read — confirmed (`get_issue`).

## 8. DONE — Definition of Done

- [ ] beep-boop §10 calls `faff contain` (fresh ancestry) before any create; contained → appetite gate + stamp `initiated: autonomous`; outward → record `outward-new-root`, surface (wtf + mandate comment), no create, no park.
- [ ] tidy chain-gap calls `faff contain` (fresh ancestry) before any auto-create; same contained/outward handling.
- [ ] Appetite table gains the outward column: **never** at any level including `full`.
- [ ] graft DiscoveredScopeEntry schema gains `containment` field.
- [ ] Interactive jot/plot stamp `initiated: interactive`, no containment check.
- [ ] No autonomous path self-calls `--via fast-track`.
- [ ] Enumerate every autonomous create path; prove only the two chokepoints file (graft records, never files).
- [ ] Composition: re-parent-out blocked by FAFF-216 L3; out-of-faff create caught by FAFF-212 intakecheck (not re-implemented).

confidence: high
