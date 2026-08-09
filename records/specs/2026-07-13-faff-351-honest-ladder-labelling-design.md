# Spec — FAFF-351: Honest ladder labelling — per-level mechanical-vs-model-compliance guarantee table; ship L4 as "preview"

> Spec: producer faffter-dark-nlspec · 2026-07-12 · mode autonomous · confidence high · Full spec on the FAFF-351 tracker issue.

This spec is the buildable design for FAFF-351. Audience: the build agent that will edit the gateway prompt (`plugin/skills/faff/SKILL.md`) and the lights-out banner, and the human reviewer who signs off that the levels table now tells the truth about what is enforced by a machine versus what rests on the model complying. It is a **documentation + banner-copy** change: no runtime logic, no CLI, no contract moves.

## 1. WHY — Problem and Principles

**The load-bearing idea.** The levels table's "What keeps it honest" column names *mechanisms* ("park protocol + run-ledger", "adversarial review + isolated holdout") for rungs whose safety is in large part **model-compliance** — the agent choosing to present a gate, consult an oracle, or park honestly — not a machine refusing to do otherwise. The honesty already exists in the prose but is **scattered** across the gateway ("prose contract, not statically lintable"; "best-effort, not a hard mutex"; "assertion, not enforcement") and never **aggregated at the point a reader decides how much to trust a level**. This ticket adds one per-level table that separates, for each rung, the guarantees a named artifact **mechanically enforces** from the ones that hold only while the **model complies**, and re-labels shipped L4 as **"L4 (preview)"** until the holdout lane has completed a real end-to-end run.

**Problem statement.** Today an adopter reading the levels table extends trust to a *name* ("adversarial review + isolated holdout") and cannot tell, without hunting through the gateway, which parts a hook/CLI/CI actually guarantees. The first L3/L4 failure then gets measured against the implied promise instead of the real mechanism — a reputational time-bomb (independent critical review ranked this change #5; graded the ladder L1:A / L2:B / L3:C+ / L4:D on claim-vs-mechanism). This change makes the mechanical-vs-model boundary explicit and honest at the exact place trust is extended.

**Design principles.**

- **Understandable, not unapproachable** (governing tenet) is the whole point here: the table exists so a human can follow *why* a level is or isn't safe to walk away from, and calibrate trust accordingly. Honesty outranks a flattering claim.
- **Ground every cell in a real artifact.** A "mechanical" cell is only allowed to exist if it can name the enforcing artifact — a Stop-hook, a CLI contract, a CI/branch-protection gate, or the revert-via-PR flow. If no artifact enforces it, it is a model-compliance cell. No aspirational mechanisms.
- **Don't re-litigate the scattered honesty — aggregate it.** The honest limits already in the gateway ("prose contract, not statically lintable"; "best-effort, not a hard mutex"; "assertion, not enforcement"; "runtime discipline, prose-enforced — not statically lintable") are the *source* the model-compliance column cites. The table references them; it does not invent a new honesty story or contradict them.
- **Preview is a caveat, not a downgrade.** "L4 (preview)" keeps L4 shipped and reachable; it flags that the holdout lane has not yet been proven on a real run. It must not read as "removed" or "disabled".

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` (levels table + narrative, lines ~14–31) | Markdown prompt | The table and bullets this edits; the single home of the levels story |
| `plugin/skills/faff/bin/lib/lights-out.js` (`renderLightsOutBanner`, `LIGHTS_OUT_GUARDRAILS`, `FLOOR_MODES`) | Node | The L4 banner that must carry the "preview" label; source of ground truth for which guardrails are `enforced` vs reachable-only and which floor entries are `static` vs `checked` |
| `docs/reference/skill-authoring.md` + `faff validate-adapters` | — | Lint gate the edited `SKILL.md` must still pass (line caps, no duplicated blocks) |

**Scope statement.** This sits in the gateway's opening "levels" section — the first thing every faff session reads — and the L4 lights-out banner. It is the trust-calibration surface above all four entry-point commands.

## 2. OUT OF SCOPE

- **Retiring the "Not built yet, mind." line on L4 / naming faff-lights-out in the narrative** — *Why excluded:* owned by peer **FAFF-339** (relatedTo). This ticket owns the *guarantee framing* + the *preview tag*; 339 owns retiring the stale "not built yet" framing and naming lights-out with v1 caveats in the levels narrative. *Extension point:* the same levels section in `SKILL.md` — see **Coordination** in §4 for the edit-overlap serialisation note.
- **README / architecture-doc sweep of the same claims** — *Why excluded:* owned by peer **FAFF-432** (README/arch sweep). *Extension point:* `README.md` and `docs/reference/architecture/*` carry their own copies of the ladder claims; 432 reconciles them against this table once it lands.
- **Re-running the frontier adversarial audit against hardened L4 gates** — *Why excluded:* owned by **FAFF-435** (relatedTo); that run is the exit criterion that would let L4 drop the "preview" tag. *Extension point:* when 435 passes, a follow-up removes "(preview)".
- **Changing any actual enforcement** — no hook, CLI, contract, or gate behaviour changes. *Extension point:* the guardrail/floor mechanisms themselves live in `lights-out.js`, `runcheck`, `prepcheck`; this ticket only *describes* them.
- **Adding a "preview" concept to L1–L3** — only L4 carries the tag; the others are shipped-and-proven. *Extension point:* n/a.

## 3. WHAT — the per-level guarantee table

(Full WHAT/HOW/SCENARIOS/DONE detail is on the FAFF-351 tracker comment; this committed copy is the build-time snapshot. §4–§7 — HOW, SCENARIOS, DESIGN DECISION RATIONALE, OPEN QUESTIONS — live only on the tracker comment and are intentionally omitted here; the snapshot jumps §3 → §8.)

Add a per-level guarantee table to the gateway levels section separating mechanically-enforced guarantees (each naming its artifact) from model-compliance ones (citing existing honest-limit prose), label L4 "(preview)" in both the levels table and the lights-out banner, and add one honest-axis line: decreasing scheduled human attention, with mechanical safety rising only where named.

## 8. DONE — Definition of Done

- A per-level guarantee table exists in the gateway levels section, one row per level (L1–L4), with a mechanically-enforced column and a model-compliance column.
- Every non-empty "mechanical" cell names its enforcing artifact (Stop-hook / `faff` CLI contract / CI-branch-protection gate / revert-via-PR flow).
- Each model-compliance cell references (does not restate) the gateway's existing honest-limit prose.
- The L4 row in the levels table reads "(preview)"; the lights-out banner (`renderLightsOutBanner`) carries a "preview" label on L4.
- One honest-axis sentence/caption states: decreasing scheduled human attention, with mechanical safety rising only where named.
- `faff validate-adapters` passes on the edited `SKILL.md`.

confidence: high
spec-review: approve
