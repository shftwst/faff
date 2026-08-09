# Spec — FAFF-710: Scope the runtime slot-conformance semantic gate to foreign occupants only

> Spec: faffter-dark-nlspec · 2026-08-02 · interactive · confidence: high. Full spec on Linear FAFF-710.

**Artifact.** A build-ready spec for FAFF-710. Audience: the build agent implementing the fix, and the human reviewer gating it. It closes a defect where faff's runtime slot-conformance validation runs a non-deterministic LLM gate on bundled first-party slot skills, so the same repo with the same config can pass a prep under one harness and be refused under another.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** faff already holds a deterministic, exhaustive enumeration of every bundled first-party slot skill: the `REGISTRY` object in `plugin/skills/faff/bin/lib/validate-adapters.js` (lines 14–34), which lists all the `faffter-noon-*` and `faffter-dark-*` occupants faff ships. The structural CLI already leans on it — `validateConfigured()` exempts any `REGISTRY` member from linting with an explicit "shipped slot skill, conformant by construction" pass (lines 460–463). The runtime slot-conformance gate does not consult `REGISTRY` at all. It is pure prose, and it scopes itself by a different rule: it fires whenever the configured occupant's **name differs from the slot's default name** (gateway `SKILL.md:963`). A bundled first-party alternative — `faffter-dark-nlspec` in the `spec` slot, say — differs from the default name yet is first-party and CI-linted, so the name-keyed rule misclassifies it as foreign and runs the LLM semantic Validate on a skill that is conformant by construction.

**Problem statement.** Today the runtime gate scopes its semantic Validate — an LLM reading the occupant's prose against the prose contract — by "name ≠ default", which sweeps in the three bundled darks this repo configures (`.faffrc.yaml:9–11`). Because that gate is an LLM judgement, its verdict diverges by harness: under Codex a `/faff-prep` was refused with three "violations" that do not hold up against source, while under Claude Code the identical config passes. This change repoints the scope decision to a deterministic `REGISTRY`-membership classification, so a bundled first-party occupant is exempt by mechanical lookup and only a genuinely foreign occupant ever reaches the semantic gate.

**Workstream.** This is one of a family of cross-harness-parity fixes — "same repo, same config, different verdict under a different harness." It is a direct sibling of FAFF-695 (tracker-connector detection under a deferred-tool harness); both remove a place where faff's behaviour depends on which harness runs it. Sequence it alongside that parity work, not as a standalone defect.

**Design principles.**

**Deterministic scope, LLM only for foreign.** faff's first tenet (`SKILL.md:50`) is "same input always same output ⇒ a tool; needs taste or understanding ⇒ the LLM." The classification "is this occupant one faff ships?" is a pure set-membership lookup — it must be a tool, not an LLM prose judgement. The semantic Validate itself stays LLM, because judging a genuinely third-party skill's prose against the contract does need understanding; only the *scope decision in front of it* becomes mechanical. Reject any implementation that leaves the exempt/validate decision as an LLM read of the occupant's identity.

**`REGISTRY` is the single enumeration — never a second list.** `REGISTRY` is the only complete list of bundled skills in the codebase; `config.js` `DEFAULTS` holds one default name per slot, not the alternatives. The fix must key off `REGISTRY` (already exported at `validate-adapters.js:820`), not introduce a parallel "bundled names" list that can drift out of sync.

**Narrowing only — never disabling.** The gate must still fire on a genuinely foreign (third-party or user-authored) occupant. This fix removes bundled first-party skills from the gate's scope; it does not weaken the gate for anything outside `REGISTRY`. A change that lets a foreign occupant skip the semantic Validate is a regression, not this fix.

**Fail toward validating on doubt.** If an occupant's name is not found in `REGISTRY`, it is treated as foreign and validated. The safe direction on any classification ambiguity is to run the gate, never to exempt.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript | Home of `REGISTRY` and `validateConfigured()`; the bundled-vs-foreign distinction already lives here. Gains the new predicate. |
| `plugin/skills/faff/SKILL.md` §"Slot conformance validation (always on)" (~959–972) | Prose (gateway) | The runtime gate. Primary prose edit — repoint the scope rule and reconcile the surrounding absolutism/vocabulary. |
| `plugin/skills/faffter-dark-authoring-adaptors/SKILL.md` | Prose | Hosts the semantic Validate face the gate invokes; restates the gate's scope at `:26`, `:95`. |
| `plugin/skills/faff-prep/SKILL.md` | Prose | Consumer that restates the gate's scope at `:107`, `:160`. |
| `plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md` | Prose | Secondary wording alignment (`:266`, `:277`, `:297–298`) — see Decision 4. |

**Scope statement.** This sits at the seam between the deterministic adaptor-lint CLI (`faff validate-adapters`) and the runtime prose gate that both cover slot-occupant conformance; it makes the runtime gate's scope decision consult the same source of truth the CLI already uses.

---

## 2. OUT OF SCOPE

- **The semantic Validate's own judgement logic.** — What the `faffter-dark-authoring-adaptors` Validate face checks, and how it forms `pass`/`fail`, is unchanged. — *Why:* the defect is the *scope* that decides whether to run it, not the check itself. — *Extension point:* `faffter-dark-authoring-adaptors/SKILL.md` conformance checklist, if the check ever needs sharpening.

- **Adjudicating the three specific "violations" from the Codex run.** — The `Decision:`-as-`Chosen:`-synonym, the "missing gateway-binding", and the "writes to Linear" claims are symptoms of the gate firing where it shouldn't. — *Why:* once bundled darks are exempt, those spurious verdicts can no longer be produced against them; there is nothing to individually rebut in code. — *Extension point:* none needed; the scope fix moots them. (The "writes to Linear" wording surface is separately tidied — Decision 4.)

- **Path-identity / name-collision hardening.** — `REGISTRY` is keyed by occupant *name*; a user who names an unrelated skill `faffter-dark-nlspec` would be classified bundled. — *Why:* the existing `validateConfigured()` already keys by name (`REGISTRY[occupant]`, `:460`), so this is the status quo, not a new hole this fix opens. — *Extension point:* `validate-adapters.js` `REGISTRY` lookup, if identity-by-path is ever wanted (a separate ticket, both CLI and runtime together).

- **The CI structural lint over shipped skills** (`faff validate-adapters` with no `--configured`). — *Why:* it already treats `REGISTRY` members correctly; untouched. — *Extension point:* n/a.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Bundled first-party occupant | A slot occupant faff itself ships — precisely, a name present in `REGISTRY` (`validate-adapters.js:14–34`). Includes every `faffter-noon-*` and `faffter-dark-*` skill. Conformant by construction (CI-linted). |
| Foreign occupant | A configured occupant **not** in `REGISTRY` — a third-party or user-authored skill. The only thing the runtime semantic gate should fire on. |
| Semantic Validate | The runtime LLM gate: invoke `faffter-dark-authoring-adaptors` → Validate face, which reads the occupant's prose against the prose contract and returns `pass`/`fail` + violations. Non-deterministic. |
| Structural lint | The deterministic CLI half (`faff validate-adapters [--configured]`) — a mechanical checklist, already `REGISTRY`-aware. |
| Bundled-membership predicate | The new deterministic check this spec adds: given an occupant name **and the slot it occupies**, is it a `REGISTRY` member registered for that slot's type? |
| Wrong-slot occupant | A bundled skill placed in a slot whose type it is not registered for (e.g. `spec: faffter-noon-ship`). A real misconfiguration — it is **not** exempt (it fails the slot-type match and is validated), so this fix never silences the gate for it. |

**The predicate interface.** A new mode on the existing CLI, so `REGISTRY` stays the single source and no new module is created:

```
COMMAND faff validate-adapters --is-bundled <occupant-name> --slot <slot>
  Resolves REGISTRY and SLOT_TYPES (both already in validate-adapters.js).
  EXIT 0  → <occupant-name> is in REGISTRY AND REGISTRY[name].type === SLOT_TYPES[slot].type
            (a bundled first-party skill occupying a slot it is registered for)
  EXIT 1  → foreign (not in REGISTRY) OR wrong-slot (in REGISTRY but type ≠ this slot's type)
            — either way, the semantic Validate applies
  EXIT 2  → usage error (missing/blank <occupant-name>, or missing/unknown <slot>)
  Writes a single human-readable line to stdout naming the classification; the exit code is the contract.
```

The predicate is a pure function of its two arguments, `REGISTRY`, and `SLOT_TYPES` — same input, same output, every harness. It reads no `.faffrc` and does no filesystem probe (unlike `--configured`); it answers only "is this name one faff ships *for this slot*?". The `--slot` guard is what stops the exemption widening: a bundled skill in the wrong slot fails the type match and is validated, so the fix never exempts on bare name-membership across all ~19 keys.

**The set it consults.**

```
REGISTRY: Map<occupant-name, { type, slot?, contract? }>   # validate-adapters.js:14–34, exported :820
  # The complete, authoritative enumeration of bundled first-party slot skills.
  # Membership — not the metadata — is what the predicate returns.
```

---

## 4. HOW — Behavior

**Architecture.** The runtime gate becomes two-tier, mirroring the split the CLI already embodies. A deterministic classification runs first; the LLM semantic Validate runs only for occupants it classifies foreign.

```
PROCEDURE runtime_slot_conformance_gate(slot, configured_occupant):
  # Behaviour summary: decide — mechanically — whether this occupant needs the
  # LLM semantic Validate at all, then run it only if it does.
  1. IF slot is unset (shipped default in use):
        return  # unchanged: defaults are never validated
  2. classification := run `faff validate-adapters --is-bundled <configured_occupant> --slot <slot>`
                       (resolve the faff executable per gateway → Resolver)
  3. IF classification exit 0 (bundled first-party, registered for THIS slot):
        skip the semantic Validate  # conformant by construction; nothing to LLM-judge
        return
  4. # exit 1 (foreign OR bundled-but-wrong-slot) — OR the predicate could not be resolved/errored: fail toward validating
     invoke faffter-dark-authoring-adaptors → Validate face on configured_occupant, passing slot
     cache the pass/fail per (occupant) for the run   # unchanged caching
     branch on pass/fail exactly as today (park autonomous / surface interactive)
```

Two things stay exactly as they are today: a slot left on its shipped default is still never validated (step 1), and the `pass`/`fail` dispositions for a foreign occupant (step 4 — cache once per run; autonomous park with the violations, interactive surface-and-stop) are unchanged. The only new behaviour is step 2–3: a mechanical `REGISTRY` lookup that exempts bundled first-party occupants before any LLM is asked.

**The predicate.**

```
PROCEDURE cmd_is_bundled(occupant_name, slot):
  1. IF occupant_name is missing or blank: exit 2  (usage error)
  2. IF slot is missing OR SLOT_TYPES has no entry for slot: exit 2  (usage error — unknown slot)
  3. IF REGISTRY has no key occupant_name:
        print "<name>: foreign (not in REGISTRY) — semantic Validate applies"
        exit 1
  4. IF REGISTRY[occupant_name].type !== SLOT_TYPES[slot].type:
        print "<name>: bundled but wrong slot (registered <regType>, occupies <slot>:<slotType>) — semantic Validate applies"
        exit 1
  5. print "<name>: bundled first-party for slot <slot> — conformant by construction"
     exit 0
```

The slot-type match reuses the same `SLOT_TYPES[slot]` lookup `validateConfigured()` already performs at `:458`, so the predicate and the CLI's `--configured` path agree on what "the right skill for this slot" means.

**Gateway prose edits (`plugin/skills/faff/SKILL.md`).** One place — the gate is ambient (`:972`: every consumer loads the gateway on entry), so the logic changes here and the satellites only echo it.

- `:963` — the scope rule. Repoint from "differs from the slot's default (a third-party or user-authored skill)" to: the gate fires on a **foreign** occupant only — one **not** in the bundled set `Object.keys(REGISTRY)` — and the exempt/validate split is decided by the deterministic `faff validate-adapters --is-bundled <occupant> --slot <slot>` predicate, **not** by an LLM reading of the occupant's identity. State that a bundled first-party occupant (any `REGISTRY` member, `faffter-dark-*` included) is exempt because it is conformant by construction and CI-linted.
- `:961` — reconcile the "always on … no case where you'd want it off" absolutism. The gate is still always on; it is not a config knob. But "always on" governs *foreign* occupants — a bundled first-party occupant is not an exemption from the gate so much as out of its scope by mechanical classification. Reword so the always-on claim and the exemption are consistent, not contradictory.
- `:970` — the pre-flight twin already says "non-shipped". Align the runtime prose to the same axis so both halves speak of **bundled/shipped vs foreign**, not "default vs non-default". This is the anchor vocabulary.
- `:972` — "a default occupant is never validated" → a **bundled first-party** occupant is never semantically validated (defaults included, since a default is a `REGISTRY` member too). The ambient/one-place claim is unchanged.
- `:955`, `:957` — supporting conformance prose. `:957`'s binding conformance clause applies to *all* occupants (map onto the fixed contract) and is not the validate-scope rule — leave its normative content intact; touch only if a stray "non-default" phrasing there needs aligning to the bundled/foreign axis. Do not broaden or narrow the clause's binding.

**Consumer pointer-restatements (echoes — wording, not logic).**

- `faff-prep/SKILL.md:107` and `:160` — "a non-default occupant is validated before first use" → a **foreign** (non-bundled) occupant is validated before first use.
- `faffter-dark-authoring-adaptors/SKILL.md:26` and `:95` — "always invokes … on a configured non-default occupant … a default occupant is never validated" → on a configured **foreign** occupant; a **bundled first-party** occupant is never validated.
- faff-graft / beep-boop / tidy / jot / map / wtf restate nothing — they inherit ambiently; no edit.

**Agile wording alignment (`faffter-dark-methodology-agile-delivery/SKILL.md`, Decision 4).** Purely wording, no authority change. The methodology envelope (`SKILL.md:1070`) says a methodology "never writes to the tracker (that's the orchestrator lane)"; the Topology-write-authority dial (`:731–745`) grants the *authority* per appetite but the *write* is orchestrator-executed. Align the phrasing so the methodology reads as *driving* the orchestrator's write, not holding the pen:

- `:266` "creates the sub-tickets, links them" → drives the orchestrator to create/link them.
- `:277` "moves … tickets" → drives the reparent/move.
- `:297–298` "mutations are limited to: creating tickets, moving status …" → the authority it holds is over these ops; the writes are orchestrator-executed.

Keep every appetite-level guarantee, every "never cancel/delete" floor, and every principle reference exactly as-is — this touches verbs, not semantics.

**Failure modes.**

- **The failure — `REGISTRY` drift.** A future bundled dark added to `.faffrc` support but not to `REGISTRY` would classify foreign and get the semantic Validate. **How you'd know:** a shipped skill unexpectedly triggers a validate/park. **What it means:** this is the *safe* direction (validate on doubt), and the CI `validate-adapters` pass over shipped skills already forces new bundled skills into `REGISTRY` — so proceed; fix by adding the name to the single source. Not a reason to add a fallback list.
- **The failure — residual LLM judgement in the scope decision.** If the gate prose still asks the model to *also* judge the occupant's identity after the predicate returns, cross-harness divergence survives the fix. **How you'd know:** the same `.faffrc` with a bundled dark still diverges between two harnesses in the acceptance test. **What it means:** the prose must hand the exempt/validate decision *entirely* to the predicate's exit code — no "and also consider". Narrow the prose until the decision is solely the tool's.
- **The failure — predicate unresolvable at runtime.** If `faff` can't be resolved in a given harness, the gate has no classification. **How you'd know:** the gate log shows a predicate resolution error. **What it means:** fail toward validating (treat as foreign, step 4) — never fail toward exempting, which would silence the gate for a genuinely foreign occupant.

**Anti-patterns.**

- **Anti-pattern:** adding a second hard-coded list of bundled skill names in the gateway or a satellite. **Why:** `REGISTRY` is the single enumeration; a parallel list drifts and reintroduces exactly the noon/dark asymmetry this fixes.
- **Anti-pattern:** keeping the scope decision prose-only ("is this a bundled first-party skill?" answered by the reading model). **Why:** that is still an LLM judgement of identity and can still diverge by harness — the class of gate the defect indicts. The classification must be the predicate's exit code.
- **Anti-pattern:** exempting foreign occupants "to be safe" when the predicate errors. **Why:** the safe direction is to validate, not to exempt — exempting silences the gate for the exact case it exists for.

---

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a slot configured with a genuinely foreign occupant (a third-party skill whose name is not in REGISTRY)
When a sub-skill delegates to that slot for the first time in the run
Then the --is-bundled predicate exits 1 AND the faffter-dark-authoring-adaptors Validate face is invoked before first use, with pass/fail dispositioned exactly as today
```

```
Given `faff validate-adapters --is-bundled faffter-dark-methodology-agile-delivery --slot methodology`
When the predicate runs
Then it exits 0 (bundled, registered for the methodology slot); and `--is-bundled some-user-skill --slot spec` (not in REGISTRY) exits 1
```

```
Given a bundled skill placed in the wrong slot — `spec: faffter-noon-ship` (a REGISTRY member whose type is not the spec-producer type)
When the runtime gate evaluates it
Then `--is-bundled faffter-noon-ship --slot spec` exits 1 (bundled-but-wrong-slot) AND the semantic Validate fires — the exemption does not widen to bare name-membership
```

- The gate remains always-on for foreign occupants: no config knob disables it, and a foreign occupant is never exempted by this change.

---

## 6. Design Decision Rationale

**Decision 1 — Mechanism for the scope narrowing.**
Options: **(a)** keep the gate prose-only but repoint its scope from "≠ default name" to "not a bundled first-party skill", naming `Object.keys(REGISTRY)` as the set the prose refers to; **(b)** introduce a deterministic seam — a small CLI predicate the runtime gate consults *before* deciding to run the semantic Validate.
- (a) pro: no code change, one prose edit. Con: the scope decision stays an LLM read of the occupant's identity against a list — a milder version of the very judgement that diverged by harness. It narrows the blast radius but does not change the *kind* of gate, so a future divergence on the membership read is still possible.
- (b) pro: the scope decision becomes a pure function of the name and `REGISTRY` — identical across harnesses by construction, directly discharging the first tenet ("same input, same output ⇒ a tool"). It is also the exact defect's remedy: a deterministic classification gates a non-deterministic check. Con: a small CLI mode + tests, and the runtime prose gains a tool call (cheap — one lookup, adjacent to the existing per-run cache).
**Chosen:** (b), a deterministic `faff validate-adapters --is-bundled <occupant> --slot <slot>` predicate the gate consults first — because the whole defect is a non-deterministic gate firing where a deterministic classification should have decided, and faff's own tenet says a same-input-same-output decision belongs in a tool. The semantic Validate stays LLM for genuinely foreign occupants; only the scope decision becomes mechanical. `REGISTRY` is reused as the single source, so no new list is introduced. (decides: architecture)

**Decision 2 — Vocabulary reconciliation.**
The CLI already says "shipped slot skill / non-shipped"; the runtime prose says "non-default"; the pre-flight twin (`:970`) already says "non-shipped". That split — "non-shipped/foreign" vs "non-default" — is the seam that let bundled darks fall on the wrong side.
**Chosen:** unify the gateway and satellites on the **bundled first-party (in `REGISTRY`) vs foreign** axis, anchored on the CLI's existing "shipped" vocabulary. Edit the gateway at `:963` (scope rule), `:961` (always-on reconciliation), `:970` (align to the runtime half), `:972` ("bundled" not "default"), and lightly `:955`/`:957` only where a stray "non-default" needs aligning without changing the binding clause's meaning; and the four satellite restatements (`faff-prep:107,:160`; `authoring-adaptors:26,:95`). — because a single axis across CLI, gateway, and satellites is what stops the classification drifting again. (decides: any)

**Decision 3 — Slot-aware membership; name-shadowing left pre-existing.**
Two distinct exposure surfaces sit under "classify by `REGISTRY`":
1. **Wrong-slot occupant** — a bundled skill placed in a slot it is not registered for (`spec: faffter-noon-ship`). The runtime gate genuinely *does* change its exemption surface here: today it fires on any occupant whose name ≠ the slot default, so a misplaced bundled skill is still validated; a bare name-membership check would newly exempt it across all ~19 keys. This is a real widening introduced by the fix, not a pre-existing risk — so the predicate is **slot-aware**: exit 0 requires `REGISTRY[name].type === SLOT_TYPES[slot].type`, and a wrong-slot occupant falls to the validate branch. This makes the runtime gate at least as strict as it is today for this case, and reuses the same `SLOT_TYPES[slot]` lookup `validateConfigured()` already does (`:458`).
2. **Name-shadowing** — a user names an unrelated skill `faffter-dark-nlspec` to be classified bundled. This is keyed by name (`REGISTRY[occupant]`) exactly as the CLI's `validateConfigured()` already is (`:460`), so it is genuinely pre-existing — the fix opens no new axis here. Path-identity hardening (classify by resolved path, not name) is a separate concern that must change both the CLI and the runtime gate together; it is called out in Out of Scope.
**Chosen:** make the predicate slot-aware to close the wrong-slot widening this fix would otherwise introduce; retain name-keying for the shadowing case, matching the CLI's shipped classification rather than opening a new CLI-vs-runtime divergence. (decides: architecture)

**Decision 4 — Scope of the agile wording tweak.**
Options: fold the methodology wording alignment into this ticket, or split it to a follow-up.
- Split pro: keeps this ticket tightly on the scope gate. Con: leaves the exact prose surface ("creates the sub-tickets", "writes to Linear") that a semantic reviewer latched onto as one of the three spurious violations.
- Fold pro: it is three verb edits with no logic change — too thin to stand as its own ticket, and it rides along on a diff that already touches this family of skills. Con: a second file in the diff.
**Chosen:** fold it in, scoped strictly to wording (`:266`, `:277`, `:297–298`) with every appetite guarantee and "never cancel/delete" floor untouched — because it is too small to warrant a standalone ticket and lands cleanly alongside a change already in this skill family. (Note: once this fix ships, the agile skill is a `REGISTRY` member the semantic gate never reads again — so the fold is a trivial cleanup, *not* protection against a future misread of this skill; the only thing that would still misread it is a hypothetical third-party fork, which is not this ticket's concern.) (decides: product)

---

## 7. Open Questions and Assumptions

**Open Questions.** None — all four decisions are closed with `**Chosen:**`.

**Assumptions.**

- **No blocker on FAFF-695.** The predicate is invoked exactly the way the gate's pre-flight twin already invokes `faff validate-adapters --configured` (`:970`) — the gateway → **Resolver** path for the bundled `faff` CLI, which is independent of FAFF-695's *tracker-connector* (MCP) resolution. So the reachability the predicate needs is a live, shipped surface, not pending work; no `blockedBy` edge is owed. If a harness genuinely cannot resolve `faff`, the fail-toward-validating branch (step 4) covers it — no exempt-on-error. (The dependency on the `faffter-dark-authoring-adaptors` Validate face is likewise a live surface the gate already invokes — not a blocker.)
- **Assumes:** `REGISTRY` is and remains the complete enumeration of bundled first-party skills, kept honest by the CI `validate-adapters` pass over shipped skills. *Validation:* grep the tree for any second bundled-name list before implementing; there should be none (confirmed at spec time — `config.js` `DEFAULTS` holds only per-slot default names, not the alternatives).

---

## 8. DONE — Definition of Done

### From WHY
- [ ] Configuring a bundled first-party dark (`spec: faffter-dark-nlspec`, `methodology: faffter-dark-methodology-agile-delivery`, `spec_review: faffter-dark-spec-review`, as `.faffrc.yaml` does) no longer causes the runtime semantic Validate to fire on that occupant.
- [ ] The exempt/validate scope decision is a deterministic function of the occupant name and `REGISTRY` — identical across harnesses.

### From WHAT (interface)
- [ ] `faff validate-adapters --is-bundled <name> --slot <slot>` exits 0 only when `<name>` is in `REGISTRY` **and** `REGISTRY[name].type === SLOT_TYPES[slot].type`; exits 1 for a foreign name **or** a bundled name whose type ≠ the slot's type; exits 2 on missing/blank `<name>` or missing/unknown `<slot>`.
- [ ] The predicate consults `REGISTRY` + `SLOT_TYPES` only — no `.faffrc` read, no filesystem probe.
- [ ] No new bundled-names list is introduced anywhere; `REGISTRY` remains the single enumeration.

### From HOW (runtime gate)
- [ ] The runtime gate consults `--is-bundled` before deciding to run the semantic Validate; on exit 0 it skips, on exit 1 it runs the Validate face.
- [ ] A slot left on its shipped default is still never validated (unchanged step 1).
- [ ] For a foreign occupant, the `pass`/`fail` dispositions (cache once per run; autonomous park citing violations; interactive surface-and-stop) are unchanged from today.
- [ ] **Must-preserve invariant:** a genuinely foreign occupant (name not in `REGISTRY`) STILL triggers the semantic Validate before first use — the gate is narrowed, not disabled.
- [ ] **No-widening invariant:** a bundled skill in the wrong slot (in `REGISTRY` but type ≠ the slot's type) is NOT exempted — it falls to the validate branch, so the runtime gate is at least as strict here as it is today.

### From HOW (gateway + satellite prose)
- [ ] `SKILL.md:963` scope rule repointed to bundled-vs-foreign, deferring the split to the predicate rather than an LLM identity read.
- [ ] `SKILL.md:961` always-on absolutism reconciled with the bundled-first-party exemption (still not a config knob).
- [ ] `SKILL.md:970`, `:972` (and `:955`/`:957` only where needed) speak the bundled/foreign axis, matching the CLI's "shipped" vocabulary, with `:957`'s binding conformance clause meaning unchanged.
- [ ] `faff-prep/SKILL.md:107`, `:160` and `faffter-dark-authoring-adaptors/SKILL.md:26`, `:95` restated to "foreign / bundled first-party".

### From HOW (agile wording — Decision 4)
- [ ] `faffter-dark-methodology-agile-delivery/SKILL.md:266`, `:277`, `:297–298` read as driving the orchestrator's write, not holding the tracker pen; all appetite guarantees and the never-cancel/delete floor unchanged.

### From HOW (failure modes)
- [ ] Predicate-unresolvable and foreign both fall to the validate branch; only exit 0 exempts (no exempt-on-error).

### Eval / test coverage
- [ ] The `--is-bundled` predicate has deterministic unit tests covering every branch: a `REGISTRY` member in its right slot → 0, a non-member → 1, a `REGISTRY` member in the wrong slot → 1, a blank name → 2, a missing/unknown slot → 2. **No LLM-judgement seam is introduced or changed** — this fix *replaces* an LLM scope decision with a tool and leaves the semantic Validate's grader untouched, so no eval case / seam-registry row is required.

### Integration smoke test
```
PROCEDURE smoke:
  1. On this repo (.faffrc.yaml sets the three darks), run the runtime gate path for the `spec` slot.
  2. Assert `faff validate-adapters --is-bundled faffter-dark-nlspec --slot spec` exits 0.
  3. Assert the gate skips the semantic Validate for it (no faffter-dark-authoring-adaptors dispatch logged).
  4. Point `spec` at a throwaway skill name not in REGISTRY; assert `--is-bundled … --slot spec` exits 1 and the gate invokes the Validate face.
  5. Assert `--is-bundled faffter-noon-ship --slot spec` (bundled, wrong slot) exits 1 and the gate invokes the Validate face.
  # If both branches hold, the deterministic scope and the preserved foreign-path are connected.
```

---

## Methodology critique

_Methodology: faffter-dark-methodology-agile-delivery · issue-critique (agile-delivery lens)_

**right-sized? (principle 4)** The predicate and the gateway edit are one concern — the predicate exists only to feed the gate, they have no value apart, and splitting would leave half a fix that can't ship. A single 1–3 day unit. The agile wording tweak is the only split candidate; folding it is right, but because it is too small to stand alone (three verb edits, no logic), not because of a causal-connection story. _Folded into Decision 4's rationale._

**workstream fit? (principles 1+5)** Cohesive on one outcome, but the spec didn't originally name the cross-harness-parity workstream or its sibling FAFF-695 — which invited it being sequenced alone rather than with the same-root-cause family. _Folded: the WHY now carries a **Workstream** line naming the parity family and FAFF-695._

**deps surfaced? (principle 6)** The gate shelling out to `faff validate-adapters --is-bundled` needs the `faff` executable resolvable under the running harness — originally carried as an Assumption, not resolved. _Folded: settled as **not** blocked on FAFF-695 — it's the same CLI-resolution the gate already does for `--configured` at `:970`, a live surface; the assumption is retired to a plain statement._

**risk profile? (principle 7)** No de-risking spike warranted — a set-membership lookup over an already-exported `REGISTRY`, plus prose edits and deterministic tests. The one real risk (predicate reachability under the strict harness) is de-risked in place by the fail-toward-validating branch and the integration smoke test. Low-risk.

---
_confidence: high_
_spec-review: approve (architectural / infosec / QA lenses, single-pass; infosec revise resolved in iteration 1)_
