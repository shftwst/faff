# Spec: Route the tagging sites through `faff label` (retire per-skill prose ensure+write)

> Spec: faffter-dark-nlspec · 2026-06-22 · autonomous · confidence: high.

This is the buildable design spec for **FAFF-188**. Audience: the build agent that will perform the migration, and the human reviewers who gate skill-prose edits. It is a **mechanical-routing refactor of skill prose** — it changes *how* a control-label mutation is expressed at each site (invoke the CLI op, execute its descriptor) without changing *which* label applies *where*.

## 1. WHY — Problem and Principles

**Problem statement.** Every faff tagging site (jot, plot, tidy, beep-boop, graft, prep) carries its own prose copy of *ensure-the-label-exists-then-write* — the same ensure-before-tag intent duplicated across ~8 skills, with the "which label, ensured-first" decision re-derived inline each time. FAFF-187 makes that decision mechanical (`faff label add|remove` emits a deterministic op descriptor), but the primitive only pays off once the sites adopt it. This spec routes every site through the op and retires the duplicated inline prose.

**Design principles.**

- **Deterministic decision, agent-side write.** The *which-label / ensure-first* decision is mechanical and belongs in the CLI; the single tracker MCP write stays agent-side because the CLI has no tracker access. This is the same split FAFF-187 establishes and `faff next` / `faff eligible` already embody — the build must preserve it, not collapse the write into the CLI.
- **No behaviour change.** This is a refactor: the set of labels, the sites that apply them, and the conditions under which each fires are **identical** before and after. An implementation that changes *which* label fires *where*, or *when*, is wrong even if it compiles and reads cleanly.
- **Manifest stays the single source of truth.** The control-label set lives in `CONTROL_LABELS` in `bin/faff` and is not moved, duplicated, or re-homed. The op validates against it; the sites read it through the op.
- **Don't touch tidy's content-label guards.** faff-tidy's "never add labels" / "never add/remove/restructure labels (that's prep's domain)" rules govern *prep-domain content labels*, a different label class from faff control labels. They are out of scope and must remain byte-for-byte unchanged.

## 2. OUT OF SCOPE

- **Building `faff label add/remove` itself** — that is FAFF-187 (the blocking primitive). This spec only *consumes* the op.
- **Changing the control-label manifest** — `CONTROL_LABELS` in `bin/faff` stays the single source of truth, unchanged.
- **tidy's prep-domain content-label guards** — those govern *content* labels, a different class from faff control labels.
- **Adding new tagging sites or new labels** — this is a routing refactor of the *existing* sites and the *existing* manifest.
- **Behaviour/eligibility logic changes** — only the label-write *expression* changes.

## 3. WHAT — The consume-and-write shape

```
PROCEDURE apply_control_label(issue, label, action):   # action ∈ {add, remove}
  1. descriptor := faff label <action> <issue> <label>   # CLI, pure, no tracker I/O
     #  → rejects label if not in the manifest (control-labels-only)
     #  → descriptor carries ensure-first intent
  2. IF tracker MCP available:
     a. Honour the descriptor's ensure-first intent (create the label from its
        manifest entry if absent — idempotent), then perform the single MCP write.
  3. ELSE (git-only mode):
     a. No-op the tracker write — there is no tracker MCP and no labels to ensure.
```

Each site keeps its *policy* (which label, under which condition). Each site delegates the *mechanism* (ensure-first + write) to the op. The inline "ensure the label exists first" clause is retired at each site and replaced with the op invocation.

**Chosen:** Sites invoke `faff label add|remove` to obtain the ensure-first op descriptor, then perform the single tracker write it describes; the per-site inline ensure-before-tag clause is retired.

**Chosen:** The `CONTROL_LABELS` manifest in `bin/faff` stays the single, unmoved source of truth.

**Chosen:** The single tracker MCP write stays agent-side; the CLI emits only the descriptor.

**Chosen:** The gateway **Control-label provisioning** section is repointed to describe the op-descriptor flow, retaining manifest-as-source-of-truth language and **one** canonical description of ensure-first. Park-protocol step 3 and Unpark auto-clear repointed to the same op flow.

**Chosen — ensure-before-tag wording.** Fold the per-site ensure-before-tag prose into the op invocation; keep one ensure-first description on the gateway side.

## 4. HOW — Per-site migration inventory

- **faff-jot** — `faff-jot-intake` on create; crank up/down (`faff-automate` add/remove); hold (`faff-automation-hold` add). Inline ensure clause retired.
- **faff-plot** — skeleton tag `faff-jot-intake`.
- **faff-tidy** — batch + single crank-up (`faff-automate`), chain-gap tags (`faff-chain-gap-fill`), stale-park removal (`faff-parked` remove). Content-label guards UNTOUCHED.
- **faff-beep-boop** — discovered-scope tag (`faff-chain-gap-fill`); park ensure (`faff-parked`).
- **faff-graft** — discovered-scope tag (`faff-chain-gap-fill`); park ensure (`faff-parked`); park-protocol ref resolves to repointed gateway section.
- **faff-prep** — crank-up gate (`faff-automate`); park tags (`faff-parked`); git-only line reframed as the op's no-op.
- **gateway** — Control-label provisioning repointed to op-descriptor flow (manifest-as-truth + one ensure-first description retained); Park protocol step 3 and Unpark auto-clear repointed to the op. `CONTROL_LABELS` in bin/faff UNCHANGED.

## 5. DONE

- No tagging site carries a per-site inline "ensure the label exists first" clause for a control label.
- The set of control labels, the sites that apply them, and the firing conditions are unchanged.
- Every migrated mutation invokes `faff label add|remove <issue> <label>` and executes the single agent-side tracker write the descriptor describes.
- `CONTROL_LABELS` in `bin/faff` is unchanged.
- Git-only mode stays a clean no-op through the op.
- tidy's content-label guards are byte-for-byte unchanged.
- `faff validate-adapters` passes, with no increase in duplicated-block findings.

confidence: high
