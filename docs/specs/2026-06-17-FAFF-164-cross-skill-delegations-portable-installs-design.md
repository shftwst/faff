# Spec — FAFF-164: Cross-skill delegations resolve in both linked-dev and distributed-plugin installs

> Spec: faffter-dark-nlspec · 2026-06-16 · interactive · confidence: high.

This is the build spec for FAFF-164. Audience: the build agent who will edit the faff `SKILL.md` files, and the human reviewer gating the change. It defines a single portability convention for how one faff skill invokes another, and the mechanical rewrite of every in-prose delegation site to use it.

## 1. WHY — Problem and Principles

**Problem statement.** faff skills appear under different names depending on install mode — bare `faff-prep` when linked for dev, plugin-namespaced `faff:faff-prep` when installed as a plugin — but ~20+ SKILL.md delegation sites hardcode a single literal (`invoke /faff-prep via the Skill tool`). A hardcoded literal is correct in at most one mode, so cross-skill chaining is fragile or broken under a plugin install. This change replaces every hardcoded delegation with a single install-mode-portable resolution convention.

**Design principles.**

**Name-independent.** The fix must work whether skills are named `faff-prep` (today) or `prep` (after the blocked FAFF-165 rename). It keys off *whatever the canonical skill name is*, never a frozen string — so it lands cleanly before or after the rename.

**Correct regardless of the undocumented question.** Claude Code's same-plugin bare-name resolution is undocumented (see Assumptions). The convention must be correct *whether or not* bare names happen to auto-resolve — it must never depend on the unknown. A design that's only correct if auto-resolution exists is rejected.

**Proportionate to a prose change.** This is a documentation/convention change to skill prompts, not new runtime machinery. The lightest mechanism that makes all sites correct in both modes wins; automated tooling is justified only if a documented convention plus a smoke matrix proves insufficient.

**Reference context.**

| System | Type | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` | skill prose (gateway) | Home of shared conventions; the new resolution rule lives here as single source |
| `plugin/skills/*/SKILL.md` | skill prose | Hold the ~20+ delegation sites to rewrite |
| `plugin/skills/faff/bin/faff` + `validate-adapters` | Node CLI | Existing conformance-lint host; candidate (deferred) for an automated check |
| `scripts/link-skills.sh` | dev tooling | Produces the bare-name dev install; one half of the two-mode test matrix |

**Scope statement.** This sits in the gateway's shared-rules layer (alongside Rendering, Chaining, Spec discovery) — a cross-skill convention every faff sub-skill obeys.

## 2. OUT OF SCOPE

- **Human-facing "type `/faff-prep`" prose** — the references that tell a *user* what to type. *Why excluded:* they're not Skill-tool delegations; their correctness is the FAFF-165 rename doc-sweep. *Extension point:* FAFF-165.
- **The `faff-`→bare skill rename** — *Why excluded:* cosmetic, separately tracked (FAFF-165, blocked-by this). *Extension point:* FAFF-165; this spec's convention is name-independent so it composes either way.
- **An automated delegation-conformance lint** in `faff validate-adapters`. *Why excluded:* proportionality — a documented convention + two-mode smoke matrix is the minimal sufficient fix; a heuristic lint risks false positives against legitimate human-facing slash prose. *Extension point:* the `validate-adapters` subcommand — a later ticket can add a check once the notation (§3) gives it a clean signal to match on. *(Filed as FAFF-172.)*
- **A runtime `faff skillref <name>` resolver CLI.** *Why excluded:* adds a CLI round-trip per delegation and plugin-name-detection complexity for marginal gain over a reliable name-match (see §6). *Extension point:* the CLI, if the prose convention ever proves unreliable in practice.
- **The `faff` CLI commands** (`faff config`/`next`/`eligible`). *Why excluded:* a binary on `PATH`, not a skill — install mode doesn't affect it.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| **Canonical skill name** | A skill's directory/`name:` value, with no namespace and no leading slash — e.g. `faff-prep` today, `prep` post-rename |
| **Delegation site** | A point in SKILL.md prose instructing the agent to invoke a *sibling skill* via the Skill tool (scope of this ticket) |
| **Human-command reference** | Prose telling a *user* what slash command to type (`/faff-prep`) — out of scope |
| **Resolved tool name** | The string actually passed to the Skill tool: `<canonical>` (linked) or `faff:<canonical>` (plugin) |
| **Bundled-default slot** | A slot left at its faff default — a `faffter-*`/`faffidavit-*` skill shipped inside the plugin, so it namespaces like a sibling |

**The resolution rule (the artifact).** A new gateway shared-rules subsection, `### Sibling-skill invocation (install-mode portable)`, whose normative content is:

```
Sibling-skill invocation. faff skills appear in your available-skills list under
one of two name forms, depending on install mode:
  - bare `<canonical>`        when linked for development
  - `faff:<canonical>`        when installed as a plugin
Wherever a faff skill tells you to invoke another faff skill "via the Skill tool",
it names the sibling by its CANONICAL name (e.g. `faff-prep`). To invoke it:
  1. Take the canonical name the instruction gives you.
  2. Find the matching entry in your available-skills list: the entry equal to the
     canonical name, OR the canonical name prefixed with `faff:`. Prefer the
     `faff:`-prefixed entry if both appear.
  3. Pass THAT resolved name to the Skill tool. Never pass a leading-slash form,
     and never assume the literal — always resolve against the live list.
Configured slots resolve the same way: a bundled-default value (`faffter-*` /
`faffidavit-*`) is a canonical name resolved per the rule above; a slot value that
already carries a `:` namespace (e.g. `gstack:autoplan`) is used verbatim.
```

**Delegation-site notation.** Every delegation site is rewritten to a uniform shape that (a) names the sibling by canonical name in backticks, (b) says "via the Skill tool", (c) points at the convention once:

```
invoke the `faff-prep` skill via the Skill tool (resolve per gateway →
Sibling-skill invocation)
```

The `(resolve per gateway → Sibling-skill invocation)` pointer may appear once per skill file (first delegation) rather than on every line, to avoid noise — the gateway rule is ambient. Leading-slash forms (`/faff-prep`) are removed *from delegation sites only*; human-command references keep their slash and are untouched.

**Design decision — where the rule lives.** Options: (a) state it once in the gateway, sites point at it; (b) repeat the full resolution logic at each site. (b) is duplicative and drifts. **Chosen:** (a) single gateway subsection, sites carry only a canonical name + lightweight pointer — consistent with how Rendering/Chaining/Spec-discovery already work.

**Design decision — delegation vs human-command notation.** The Skill tool takes a skill *name*, not a slash command; mixing `/faff-prep` for both a delegation and a "type this" instruction is the root ambiguity. **Chosen:** delegations use backticked canonical name + "via the Skill tool" with no slash; human-command references keep `/`. This cleanly partitions the two reference classes (and hands FAFF-165's doc-sweep a clean signal).

## 4. HOW — Behavior

**Approach.** Two mechanical passes plus a verification pass:

```
PROCEDURE apply_portable_delegation:
  1. Add the `### Sibling-skill invocation` subsection to plugin/skills/faff/SKILL.md
     (gateway shared-rules region, near Rendering / Chaining).
  2. For each delegation site (inventory below):
     a. Confirm it is a DELEGATION (agent invokes sibling via Skill tool), not a
        human-command reference. When a single sentence is BOTH (e.g. "Run
        `/faff-prep`? (y/n) — on confirm, invoke it via the Skill tool"), keep the
        human-facing `/faff-prep` for the prompt the user reads, and ensure the
        invoke-clause resolves per the convention (it now refers back to the same
        sibling — no second literal needed).
     b. Rewrite the invoke-clause to the §3 notation: backticked canonical name,
        "via the Skill tool", drop any leading slash on the invoke target.
     c. First delegation in each file gets the `(resolve per gateway → …)` pointer.
  3. For slot invocations (intake/spec/review/ship/methodology/concurrency/
     routing_adaptor/rendering_adaptor/authoring-adaptors): confirm the prose
     resolves the slot value per the convention. A bundled default is a canonical
     name; an explicitly-namespaced third-party value is verbatim. Add a one-line
     note at each slot-invocation point only where the current prose implies a bare
     literal.
  4. Run the two-mode verification matrix (§5 scenarios).
```

**Delegation-site inventory (the work-list).** Grep-confirmed; the build agent re-greps to catch any missed by line drift:

```
gateway faff/SKILL.md   → faff-onboard (first-run); faffter-dark-authoring-adaptors
                          (validate); faff-prep (autonomous respec row)
faff-jot                → intake slot (faffter-noon-intake); faff-plot; faff-prep
faff-prep               → faff-graft (×2)
faff-wtf                → faff-prep (×2)
faff-graft              → faff-prep (×5); review slot; faff-wtf
faff-map                → faff-prep; faff-plot; faff-tidy; methodology slot
faff-tidy               → faff-prep
faffter-noon-concurrency-sequential → faff-graft
```

Re-discovery command (don't trust frozen line numbers):
```
grep -rniE 'invoke|delegate|hand .* to|via the .?Skill.? tool|chain to' \
  plugin/skills --include=SKILL.md | grep -iE 'skill tool|invoke|delegate'
```

**Edge cases.**

- **Combined prompt + invoke** ("Run `/faff-prep`? … on confirm invoke it"): the user-facing `/faff-prep` slash stays (it's a human-command reference); only the invoke-clause obeys the convention. Do not strip the slash from the question the human reads.
- **Both name forms present in the list** (pathological — a repo that both links bare and installs the plugin): prefer the `faff:`-prefixed entry, per the rule. Deterministic, no ambiguity.
- **Neither form present** (sibling genuinely absent): unchanged from today's behavior — the skill's existing "missing slot/skill is never a blocker" handling applies; the convention doesn't invent a skill that isn't installed.

**Anti-pattern:** rewriting a human-command reference (`/faff-prep` in a "what next?" prompt) into the delegation notation. Why: it breaks the user-facing instruction and conflates the two reference classes this spec exists to separate.

**Anti-pattern:** passing a leading-slash form (`faff:/prep` or `/faff:prep`) to the Skill tool. Why: the Skill tool takes a skill name; the slash is a user-typed-command affordance only.

## 5. SCENARIOS — born-verifiable objectives

```
Given faff linked for development (bare names, via link-skills.sh)
When a skill instructs "invoke the `faff-prep` skill via the Skill tool"
Then the agent resolves `faff-prep` from its available-skills list and runs it
```

```
Given faff installed as a distributed plugin (skills namespaced `faff:<name>`)
When the same skill instructs "invoke the `faff-prep` skill via the Skill tool"
Then the agent resolves `faff:faff-prep` from its available-skills list and runs it
```

```
Given the gateway → Sibling-skill invocation convention is in context
When the agent encounters a canonical name whose only available-skills entry is the
     `faff:`-prefixed form
Then the agent passes the `faff:`-prefixed name to the Skill tool, not the bare literal
```

```
Given a slot left at a bundled default (e.g. methodology = faffter-noon-...)
When a skill invokes that slot under a plugin install
Then the bundled-default value resolves via the same convention (faff:<default>)
```

Constraint assertion: **No delegation site passes a hardcoded, install-mode-specific literal to the Skill tool** after this change (every invoke target is a canonical name resolved per the convention).

## 6. DESIGN DECISION RATIONALE

**How should portability be achieved — runtime prose convention, CLI resolver, or build-time codegen?**

- **Prose convention (gateway rule + agent resolves from live list).** Pros: zero new runtime; name-independent; correct whether or not bare auto-resolves; the agent already must pick a name from its list, so this just disambiguates that pick. Cons: leans on the agent (the deterministic-tools-over-prose tenet — see tension note below).
- **`faff skillref <name>` CLI resolver** (detect plugin mode via `CLAUDE_PLUGIN_ROOT`, emit `faff:<name>` else `<name>`). Pros: more deterministic. Cons: a CLI round-trip per delegation; must map `CLAUDE_PLUGIN_ROOT` path → the actual namespace (which may differ from the dir name); the agent *still* has to feed the result to the Skill tool against its list — so it doesn't remove the list-match, only adds a step.
- **Build-time codegen** (canonical source → packaged plugin with rewritten literals). Pros: fully deterministic in plugin artifact. Cons: dev-linked still needs bare; two maintained forms; interacts awkwardly with FAFF-165; heaviest option.

**Chosen:** the prose convention — proportionate, name-independent, and *robust to the undocumented auto-resolution question* (it's correct either way). The CLI resolver and codegen are documented here as rejected-for-now alternatives so they aren't re-proposed; the CLI remains a clean extension point if real-world unreliability ever surfaces.

**Deterministic-tools-over-prose tension (explicit).** faff's tenet prefers deterministic tools over agent prose. Here Claude Code exposes **no** deterministic primitive for portable sibling resolution (confirmed undocumented), and any tool still terminates in the agent matching a name against its available-skills list. So a well-specified convention is the *best achievable*, not a lazy choice — and the convention reduces the agent's freedom to a single mechanical name-match, which is the least-prose form available. Recorded so the tradeoff is visible.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the design is closed (the convention is correct independent of the one unknown, so that unknown is an assumption-to-validate, not a blocking punt).

**Assumptions.**

- **Assumes:** Claude Code provides no undocumented bare-name → same-plugin auto-resolution that would already make delegations work under a plugin. *Validation:* package faff as a plugin (or simulate via a namespaced install), invoke a delegating skill, and observe whether a bare literal resolves. *Why non-blocking:* the convention is correct whether this holds or not.
- **Assumes:** the available-skills list is visible to the agent at delegation time in both modes (it is surfaced via system-reminders today). *Validation:* confirm the list appears in a plugin-mode session before relying on list-matching.

## 8. DONE — Definition of Done

### From WHY
- [ ] No delegation site passes an install-mode-specific hardcoded literal to the Skill tool (grep shows every invoke target is a canonical name + convention, not a bare `/faff-…` invoke literal).
- [ ] The change references canonical skill names only — applying or reverting FAFF-165's rename requires no edit to the convention itself.

### From WHAT
- [ ] `plugin/skills/faff/SKILL.md` contains a `### Sibling-skill invocation (install-mode portable)` subsection with the §3 normative content (two name forms, the 3-step resolve, the slot clause).
- [ ] Delegation sites use the §3 notation: backticked canonical name + "via the Skill tool", no leading slash on the invoke target.
- [ ] Human-command references (`/faff-prep` in "what next?" prompts) are unchanged — slash retained.

### From HOW (the rewrite)
- [ ] Every site in the §4 inventory is rewritten (gateway ×3, jot ×3, prep ×2, wtf ×2, graft ×7, map ×4, tidy ×1, concurrency-sequential ×1), confirmed by re-greping rather than frozen line numbers.
- [ ] Slot-invocation points resolve per the convention; explicitly-namespaced third-party slot values are used verbatim.
- [ ] First delegation in each edited file carries the `(resolve per gateway → Sibling-skill invocation)` pointer.

### From HOW (edge cases)
- [ ] A combined prompt+invoke sentence keeps the user-facing slash and resolves the invoke-clause per the convention.
- [ ] The "both forms present → prefer `faff:`" and "neither present → existing missing-skill handling" rules are stated in the convention.

### From SCENARIOS
- [ ] Two-mode verification performed: a delegation resolves and runs the correct sibling in (a) linked-dev and (b) plugin-namespaced install — recorded as a short test-matrix note in the PR.

**Integration smoke test:**
```
1. Linked-dev: from a faff-jot chain, trigger "invoke the `faff-prep` skill" →
   assert faff-prep starts.
2. Plugin install (or namespaced simulation): repeat the same chain →
   assert faff:faff-prep (or faff:prep post-rename) starts.
3. If both runs invoke the correct sibling with no edit to the skill prose between
   them, the convention holds.
```

confidence: high
