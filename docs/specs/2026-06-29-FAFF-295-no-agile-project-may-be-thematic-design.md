# Spec — FAFF-295: No agile project may be thematic — diagnose + convert thematic projects to outcome-led

> Spec: faffter-dark-nlspec · 2026-06-29 · autonomous · confidence: high. Full spec on Linear FAFF-295.

## WHY — Problem and principles

Under the agile lens an **outcome-led project is the only legitimate project shape**. Thematic / capability-layer grouping — a project named for a capability or a layer of the system (e.g. the L4 capability layers "Verifiable delivery", "Architecture & infra intelligence", "Lights-out operations") rather than a user-facing or business outcome — is **structural's** territory: it groups by where work *sits* in the system, not by the outcome it ships. That kind of grouping is legitimate for the topology lens (the tracker's structural ground truth), but under the agile lens it is itself a **structural-category error**: the project as a *grouping unit* is the wrong shape, regardless of how it is named.

This is **sharper than Principle 1**. Principle 1 flags an activity-*named* workstream ("Bugs", "Q2 sprint 3") — a naming problem you fix by renaming or regrouping. FAFF-295 flags the project *as a grouping unit*: even a tidily-named thematic project ("Verifiable delivery") is a violation under the agile lens, because thematic grouping itself isn't an outcome. You can't fix it by renaming — the grouping has to be **converted** into outcome-led homes.

The agile lens today has every primitive this needs but does not yet apply them to the thematic-project case:

- The **reparent primitive** — the lens's `## Re-homing gating chains into the stream they gate` already reparents work structurally (a real container / `parentId` move with `blockedBy` edges preserved), governed by the gateway dial. Conversion reuses exactly this primitive to rehome live work into outcome projects.
- The **plain-backlog default-landing rule** — the agile-lens rule that an unsequenced ticket's default home is plain Backlog, no project, until it can be sequenced into an outcome. Conversion routes the remainder (work with no outcome home yet) there.
- The **topology-write-authority dial** — gateway → **Appetite for destruction → Topology-write authority** — already governs how much of that authority the lens holds per appetite level. Conversion is a topology write; it inherits this dial, not a new lens-local authority story.

What is missing is the **diagnostic that recognises a thematic project as a violation** and the **convert path that drains it into outcome homes and retires the shell**. This spec adds both to the agile lens — prose only.

## OUT OF SCOPE

- **The gateway dial, the reparent primitive, the default-landing rule, the lost-vs-rehomed distinction.** All four ship in their own cluster siblings; this spec *consumes* them by section / capability name and does not re-implement, re-derive, or restate any of them.
- **New CLI / code / contract block / eval seam.** Pure prose change to one file, consistent with the cluster's "prose + ADR" shape (no new `faff` subcommand, no `faff-contract:*` block).
- **The thematic (default) lens.** Thematic grouping stays legitimate under `faffter-noon-methodology-thematic` (structural/topology default may keep capability-layer homes). The new diagnostic is an **agile-lens** finding only — it never fires under the thematic default.
- **Cancelling or deleting any work or any project.** Conversion only ever reparents (reversible) and retires a *drained* shell; lost scope stays forbidden at every appetite (hard floor).
- **Re-litigating FAFF-296's vocabulary or FAFF-292's reparent mechanics.** Both shipped; this spec only uses them.

## WHAT — the change

A prose-only change to one file: `plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md`. Three loci change.

### 1. `backlog-diagnostics` gains the thematic-project finding (Outputs table + a new subsection)

Add a new `backlog-diagnostics` finding — *thematic-project* (a structural-category error under the agile lens) — and document it in a dedicated subsection, mirroring how `## Re-homing gating chains into the stream they gate` documents the gating-chain finding. The Outputs-table `backlog-diagnostics` row gains a reference to it alongside the existing principle findings (1, 4, 5, 6).

The finding is **agile-lens-specific and additive over the structural/topology floor** — it does not touch the floor's cycle / ghost-project detection. It is a new seven-principle-family finding, grounded in observable tracker state: a project whose grouping is a capability / system-layer / theme rather than a shippable outcome.

**Detection.** A project is flagged thematic when its grouping unit is a capability, a system layer, a technology area, or a theme rather than a user-facing / business outcome — the project-as-grouping-unit test, distinct from Principle 1's name test. The judgement is the lens's call, backed by observable evidence (the project's name + the spread of outcomes across its member tickets), and **names the project in every finding**. When the input envelope surfaces a project's machine-readable Definition of Done, a project carrying a real outcome DoD is **not** flagged; absent that signal the lens falls back to the name + member-spread evidence and names the project so the call is auditable. Reuses the same DoD-presence / fall-back-and-name discipline the re-homing section already established.

**Diagnosis template** — follows the lens's three-part educational shape (what's there / why it's a problem / what to do).

### 2. A new `## Converting a thematic project to outcome-led` subsection (the convert path)

Document the convert path as an ordered procedure, reusing the existing primitives by name. It runs only under the agile lens, governed by the gateway dial. Steps:

1. **Identify the live work** in the flagged project — its non-terminal tickets (terminal ones stay where they are as historical record; conversion never reopens them).
2. **Rehome each live ticket into the outcome project it serves** via the lens's existing **reparent primitive**. The outcome home is the MVP it belongs to, or a follow-up outcome project (*harden / enhance / simplify the MVP*). Relies on the lost-vs-rehomed scope distinction — conversion rehomes, so it stays on the allowed side of that line.
3. **Land the remainder in plain backlog** — any live ticket with no outcome home yet is reparented to **no project, plain Backlog** via the **default-landing rule**, never into another thematic bucket and never into the void.
4. **Retire the drained shell** — once the project holds no live work, retire / close the now-empty project (a reversible state move). The shell and its terminal history survive; only its role as a live grouping unit ends.

**No scope is ever lost.** Every live ticket lands in a real home before the shell is retired. Retirement is gated on the project being drained of live work.

### 3. Appetite ladder for the convert path

The convert path is a **topology write**, so its per-level authority is the gateway **Appetite for destruction → Topology-write authority** dial — referenced, not re-derived:

- **low** — diagnose only.
- **medium** — surface the finding with the recommended conversion; no reparent / retire.
- **high (default)** — propose the conversion: per-ticket rehome plan + remainder-to-backlog + shell retirement, acting on clear rehomes, proposing the judgement where the outcome home is ambiguous.
- **full** — convert in one pass: rehome all live work, land the remainder in backlog, retire the drained shell, fully logged.

**Invariants, inherited from the dial (named, not restated):** reversibility floor (never cancel/delete); idempotent / anti-thrash (a converted project stays converted); human-curated-structure floor (a human-curated grouping stays propose-and-confirm).

## HOW — authoring rules

1. **Reuse, never re-implement.** New prose names each primitive by its section / capability name and adds only the thematic-project *diagnostic* and the *convert procedure*.
2. **Sharper-than-Principle-1 framing is explicit.**
3. **Self-contained-prose floor (`faff lint-refs`).** All new prose carries **no** external `FAFF-NN` / `ADR-NNNN` reference.
4. **Skill-authoring standard.** Lean / deduplicated / skimmable; `faff validate-adapters` stays green.
5. **Agile-lens-only.**

## DONE — Definition of Done

1. The agile lens's `backlog-diagnostics` flags a thematic / capability-layer **project** (as a grouping unit, distinct from Principle 1's name test) as a structural-category error, names the project, and offers conversion.
2. A documented convert path rehomes live work to outcome homes (reparent primitive) + lands the remainder in plain backlog (default-landing rule) + retires the drained shell, **no scope lost**.
3. The convert path's per-appetite authority is the gateway **Appetite for destruction → Topology-write authority** dial (low diagnoses / high proposes / full converts), referenced by section name, not re-derived.
4. Conversion is reversible (retire/close, never cancel/delete) and idempotent; the human-curated-structure floor is honoured.
5. The change is agile-lens-only; the thematic default lens is untouched.
6. `faff lint-refs` exits 0; `faff validate-adapters` green; node `--test` / CLI selftests pass.

confidence: high
spec-review: approve
