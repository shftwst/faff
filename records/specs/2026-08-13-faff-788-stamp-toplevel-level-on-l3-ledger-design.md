# FAFF-788 — Stamp a top-level `level` on the L3/beep-boop run-ledger at genesis

> Spec: faffter-dark-nlspec · 2026-08-13 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-788.
> build-tier: standard

This spec is for the build agent and human reviewers. It closes a contract gap between how an ordinary L3 (`/faff-beep-boop`) run **mints** its run-ledger and what the merge-gate / reconcile consumers **require** of that ledger's committed anchor. The change is confined to prose and a documented JSON shape in one skill file; no CLI code path changes.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff merge-gate` never trusts a live ledger for the autonomy level it enforces — it reads the level from a HEAD-SHA-pinned, committed **anchor** (a byte-copy of `run-ledger.json`). `resolveAnchorLevel` (merge-gate.js) parses that anchor and refuses `anchor-malformed` unless the top-level `level` is a member of `FLOOR_LEVELS` (`["L1","L2","L3","L4"]`). So the level the consumer needs must already be present at ledger **genesis**, because that is what gets anchored.

**Problem statement.** An ordinary L3 beep-boop run mints its `run-ledger.json` from prose in `faff-beep-boop/SKILL.md` (the L2 and L4 mints are CLI-owned; the L3 mint is the one owned by prose), and that prose writes `owner`, `budget`, `admitted`, etc. but never a top-level `level`. The anchor built from such a ledger has no `level`, so the first build to reach its merge gate is refused `anchor-malformed` and cannot merge until an agent hand-repairs the ledger to `level: "L3"` and re-anchors. This was hit in run `run-20260812-195243-fly-l3` during the build of FAFF-771.

**Design principles.**

- **Well-formed from genesis, not repaired downstream.** The anchor must be valid the moment it is minted; a consumer-side default (fix direction (b)) would paper over a mint that is structurally incomplete. Set the level at mint (fix direction (a)).
- **Mirror the sibling mints, don't invent a new mechanism.** The interactive L2 mint (`run-ledger.js`) writes `level: "L2"` as a genesis constant, and the L4 mint (`mintLightsOut`, `lights-out.js`) hardcodes `"L4"`. The L3 prose mint is the lone gap in an otherwise-consistent pattern; this change brings it into line, it does not redesign minting.
- **Prose owns the L3 mint; do not migrate it to a CLI here.** The ticket scopes the fix to the prose mint plus its documented shape. A deterministic CLI mint for L3 (mirroring `run-ledger init-interactive`) is a legitimate future hardening but is out of scope (see OUT OF SCOPE).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` → *Run ledger* / *Owner stamp & heartbeat* | Markdown (skill prose) | The mint being fixed: documented shape + run-start mint instruction |
| `plugin/skills/faff/bin/lib/merge-gate.js` → `resolveAnchorLevel` | JavaScript | The consumer: refuses `anchor-malformed` when `parsed.level` ∉ `FLOOR_LEVELS` (read-only reference) |
| `plugin/skills/faff/bin/lib/reconcile.js` | JavaScript | Second consumer: level-gates disposition; requires `level` via `--level` or stdin (read-only reference) |
| `plugin/skills/faff/bin/lib/run-ledger.js` → `INTERACTIVE_LEVEL` | JavaScript | Sibling pattern: L2 mint stamps `level` at genesis (read-only reference) |
| `plugin/skills/faff/bin/lib/lights-out.js` → `mintLightsOut` | JavaScript | Sibling pattern: L4 mint stamps `level` at genesis (read-only reference) |

**Scope statement.** This is a one-file documentation/prose correction to the L3 run-ledger mint so its anchor is merge-gate-valid from genesis; it sits at the beep-boop orchestrator ↔ merge-gate contract boundary.

## 2. OUT OF SCOPE

- **A CLI mint verb for the L3 ledger** — mirroring `run-ledger init-interactive` (L2) / `mintLightsOut` (L4) so the L3 level is CLI-stamped rather than prose-stamped. *Why excluded:* the ticket picks fix direction (a) scoped to the prose mint + documented shape; a new CLI is a larger, separable change. *Extension point:* `plugin/skills/faff/bin/lib/run-ledger.js`.
- **Consumer-side tolerance of an absent `level`** (fix direction (b): `merge-gate` / `reconcile` defaulting a missing level to `L3`). *Why excluded:* the ticket prefers a well-formed anchor at genesis over a lenient consumer. *Extension point:* `merge-gate.js` `resolveAnchorLevel`, `reconcile.js` shape validation.
- **The L2 and L4 mints** — already stamp `level` correctly; untouched.
- **Retroactive repair of legacy level-less ledgers** — the hand-repair path (`faff events append --type ledger-write`) already exists and is unchanged; this fix prevents the need for it going forward, it does not migrate old ledgers.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Anchor | The HEAD-SHA-pinned, committed byte-copy of `run-ledger.json` that `merge-gate` reads the enforced level from |
| `anchor-malformed` | `resolveAnchorLevel`'s refusal status when the anchor is bad JSON, or its `level` is not a `FLOOR_LEVELS` member |
| Genesis / mint | The run-start write that creates `run-ledger.json` before step 4 |
| Lights-out level | The one level `faff lights-out` stamps (`"L4"`); the sole level signal for the L4 path |

**The documented ledger shape gains one top-level field.** In `faff-beep-boop/SKILL.md` → *Run ledger*, the example JSON object adds a top-level `level`:

```
RECORD RunLedger (documented shape — additive):
  level: "L1" | "L2" | "L3" | "L4"    # NEW top-level field; a FLOOR_LEVELS member; the merge-gate/reconcile anchor level
  run_id: string
  admitted: string[]
  outcomes: { issue-id: terminal-state-string }
  ...existing fields (discovered_scope_filed, budget, owner, ...) unchanged
```

The accompanying field-bullet list under the JSON gains a `level` entry describing it as: the run's autonomy level, a `FLOOR_LEVELS` member, written **once at genesis**, and read by `merge-gate`'s `resolveAnchorLevel` (and level-gated by `reconcile`) off the committed anchor — an absent `level` is what makes the anchor `anchor-malformed`.

**Design decision — where the L3 level value comes from.** The genesis `level` is the run's lights-out level when one was stamped, else `"L3"`.

**Chosen:** `level := "L4"` when the run was minted under an `faff lights-out` signal (that path is already CLI-minted with `level:"L4"` by `mintLightsOut`, so the prose must not overwrite it), else `"L3"` for the ordinary prose-minted L3 self-drain. Rationale: this is exactly the ticket's "from the lights-out level, defaulting `L3`", and it keeps the one prose write from clobbering the CLI-minted L4 ledger.

## 4. HOW — Behavior

**Approach.** Two edits to `plugin/skills/faff-beep-boop/SKILL.md`, no code:

1. **Documented shape (Run ledger section).** Add `"level": "L3"` as a top-level key to the example JSON object, and add a field-bullet documenting it (per WHAT above).
2. **Mint instruction (Owner stamp & heartbeat → "At run start").** Extend the run-start mint step so that, alongside the `owner` stamp written at genesis, the ledger carries a top-level `level`.

**Mint behaviour.**

```
PROCEDURE mint_run_ledger_level (prose instruction, at run start):
  1. IF the run was minted under an faff lights-out signal (L4):
     a. The ledger was already minted by `faff lights-out` with level:"L4" — do NOT overwrite it.
  2. ELSE (ordinary L3 prose mint):
     a. Write top-level `level: "L3"` into run-ledger.json at genesis, in the same write as the owner stamp.
  3. The written `level` MUST be a FLOOR_LEVELS member ("L1".."L4"); for the prose-owned path the only value ever written is "L3".
```

**Anti-pattern:** writing `level` only after the first build fails its merge gate (the current hand-repair). Why: the anchor is byte-copied at genesis, so a late write never reaches the already-committed anchor — the level must be present before anchoring.

**Anti-pattern:** having the L3 prose overwrite `level` unconditionally. Why: it would clobber the CLI-minted `level:"L4"` on a lights-out run.

**Failure modes.**

- **The failure:** the documented shape is updated but the mint *instruction* is not (or vice versa), so a compliant orchestrator still mints a level-less ledger. **How you'd know:** a freshly minted L3 ledger has no top-level `level`; its anchor trips `resolveAnchorLevel` → `anchor-malformed` at the first merge gate. **What it means:** both edits are required; neither alone closes the gap.
- **The failure:** a value outside `FLOOR_LEVELS` is documented (e.g. lowercase `"l3"`). **How you'd know:** `resolveAnchorLevel` still returns `anchor-malformed` (membership is exact). **What it means:** the documented literal must be exactly `"L3"`.

## 5. Scenarios

```
Given an ordinary /faff-beep-boop (L3) run following the updated mint prose
When it mints run-ledger.json at run start (before step 4)
Then the ledger carries top-level level: "L3"
And the committed anchor byte-copied from it resolves via merge-gate's resolveAnchorLevel to status "ok" (level "L3"), not "anchor-malformed"
And the first build to reach its merge gate is not refused for a missing level
```

- The documented Run-ledger JSON in `faff-beep-boop/SKILL.md` includes a top-level `level` key whose value is a `FLOOR_LEVELS` member.
- The L4 lights-out mint (`mintLightsOut`, `level:"L4"`) and the interactive L2 mint (`run-ledger init-interactive`, `level:"L2"`) are unchanged — no regression to either genesis stamp.

## 6. Design Decision Rationale

**Fix at mint (a) vs tolerate-absent at the consumer (b)?**
- (a) Set `level` at genesis: anchor is well-formed from the start; mirrors L2/L4 mints; the consumer stays strict (a strict `resolveAnchorLevel` is a deliberate safety property).
- (b) Default a missing level to `L3` in `merge-gate`/`reconcile`: papers over an incomplete mint and loosens a fail-closed check.
- **Chosen:** (a) — set it at mint. Rationale: the ticket's stated preference, and it keeps the merge-floor check strict rather than teaching it to accept malformed anchors.

**Value source: constant `"L3"` vs derived from a level signal?**
- **Chosen:** derive from the lights-out level, defaulting `"L3"` — i.e. the prose only ever writes `"L3"` (the L4 ledger is CLI-minted and must not be overwritten). Rationale: matches the ticket wording and avoids clobbering an L4 mint, while being trivially the constant `"L3"` on the only path the prose actually mints.

## 7. Open Questions and Assumptions

**Open Questions:** none — the fix direction, value, and file are all pinned by the ticket and corroborated by the sibling mints and this run's own ledger (which already carries `level: "L3"`).

**Assumptions.**

- **Assumes:** the L3 beep-boop `run-ledger.json` is minted by `faff-beep-boop/SKILL.md` prose (not a CLI verb). *Validation:* confirmed — `run-ledger.js` documents itself as the L2-only interactive mint and `lights-out.js` as the L4 mint; there is no L3 mint verb, and the *Owner stamp & heartbeat* → "At run start" prose is what creates the L3 ledger.
- **Assumes:** `FLOOR_LEVELS` = `["L1","L2","L3","L4"]` and `"L3"` is a member. *Validation:* confirmed in `contract-defs.js`.

## 8. DONE — Definition of Done

### From WHY
- [ ] An ordinary L3 beep-boop run, minted per the updated prose, produces a `run-ledger.json` with top-level `level: "L3"` — no hand-repair needed for its anchor to pass merge-gate.

### From WHAT (documented shape)
- [ ] The Run-ledger example JSON in `faff-beep-boop/SKILL.md` has a top-level `level` key (value a `FLOOR_LEVELS` member, shown as `"L3"`).
- [ ] A field-bullet documents `level`: the run's autonomy level, a `FLOOR_LEVELS` member, written once at genesis, read by `merge-gate`'s `resolveAnchorLevel` / level-gated by `reconcile` off the committed anchor.

### From HOW (mint instruction)
- [ ] The *Owner stamp & heartbeat* → "At run start" step instructs writing top-level `level` at genesis, sourced from the lights-out level and defaulting `"L3"`, in the same write as the owner stamp.
- [ ] The prose is explicit that the L4 (lights-out) ledger is already CLI-minted with `level:"L4"` and must not be overwritten by this write.

### From HOW (no regression)
- [ ] No change to the L2 (`run-ledger init-interactive`) or L4 (`mintLightsOut`) genesis level stamps.

### Verification smoke path
```
Mint an L3 ledger object per the updated documented shape (level:"L3");
byte-copy it to the anchor path; run merge-gate's resolveAnchorLevel against it;
assert status == "ok" and level == "L3" (not "anchor-malformed").
```

## Methodology critique

Agile-delivery lens (`issue-critique`):

- **Right-sized?** Yes. One file, two edits (documented shape + mint instruction), no code — a single sub-day unit. No split warranted; no independent second concern to peel off.
- **Workstream fit?** Yes. Sits cleanly on the beep-boop-orchestrator ↔ merge-gate contract line the surrounding tickets (FAFF-424 / FAFF-690 / FAFF-761) already work.
- **Deps surfaced?** Yes. The consumer this unblocks (`resolveAnchorLevel`, FAFF-424 / FAFF-690) is already Done, so there is no implicit blocker to link.
- **Risk profile?** Low. Mechanical prose/doc change with a strict, existing consumer as the check; no novel integration or external dependency, so no de-risking spike is needed.

confidence: high
spec-review: approve
