# FAFF-64 — Wire faff skills to consult `faff next` for sequencing

## WHY — Problem and scope
FAFF-63 shipped `faff next` — a pure transition function returning the legal next step `{next, reason}` from an issue's `(status, spec, held, parked, blocked)` — but nothing calls it; the skills still prose-decide sequencing. This wires the consumers to consult `faff next`, making the base "what's the next step for this issue?" decision deterministic and identical everywhere (engine→wiring, mirroring FAFF-52→FAFF-53). The agent still fetches tracker state (MCP), still asks the FAFF-57 chain-to-build gate, and still executes the step — `faff next` only reports what's legal next.

Design principles:
- **faff next is the BASE transition, not the whole router. Chosen.** No inputs for the diagnostic verdicts (gap-blocked / circular-blocked / repeat-parked); those stay in the `routing_adaptor` verdict computation and layer ON TOP where `faff next` returns `graft`.
- **Caller maps state→flags; faff next stays pure. Chosen.** Each consumer already reads status, spec+confidence, the `faff-automation-hold`/`faff-parked` labels, and blockedBy relations — wiring passes them, adds no new fetch.
- **`--blocked` = external blockers only. Chosen.** In-queue dependencies remain beep-boop's conflict-analysis/collision-group concern, never passed as `--blocked`.
- **Reports, never enforces/executes. Chosen.** Wiring replaces the prose DECISION; the FAFF-57 gate and skill execution stay with the caller.
- **prep's confidence gate and faff next are related but distinct. Chosen.** prep's gate moves tracker state (high→promote / medium→retain / low→park); `faff next` then reads the resulting state (rating → `--spec`) on the next pass. prep does not emit `skip-held`/`blocked`/`done`.

### Out of scope
- New CLI state (deferred `faff state` ledger). Changing the transition table (FAFF-63) or the diagnostic verdict computation (layered on top, unchanged).

## WHAT — the wiring recipe + per-consumer points
**State→flags mapping — shared rule. Chosen:** documented once in the gateway (`faff/SKILL.md`) as a shared rule each consumer references, computed per-issue at the decision point (not cached across passes):
- `--status` ← tracker state → backlog|todo|in-progress|in-review|done|cancelled|duplicate (in-review → graft-eligible).
- `--spec` ← Spec-discovery: `none` if no spec; else retained confidence (low|medium|high).
- `--held` ← `faff-automation-hold`. `--parked` ← `faff-parked`. `--blocked` ← any open external blockedBy.
- Call `faff next`; branch on `{next}` ∈ prep|graft|skip-held|needs-human|blocked|done|none (held ordered before parked).

**Per-consumer (replace the prose decision; keep fetch, gate, execution):**
1. **faff-beep-boop**: §2 Prep-queue build, §4 Build-queue assembly, §8.3 Wave re-entry consult `faff next` per issue. On `next=graft`, beep-boop then runs the existing `routing_adaptor` verdict (fire-and-forget / likely-fire / gap / cycle / repeat) for admission. `prep`→prep queue; `skip-held`→On-hold; `needs-human`→needs-decision-first; `blocked`→hold; `done`/`none`→exclude.
2. **faff-prep**: consult `faff next` for the post-attach next-step; prep's promote/retain/park gate unchanged.
3. **faff-graft** Step 2 prep-gate: consult; `prep`→prep, `graft`→proceed.
4. **faff-tidy** §2 readiness: consult; `graft`→promote candidate, `skip-held`→On-hold, `prep`→prep candidate.
5. **gateway/interactive**: per-issue next-step suggestion consults `faff next`; FAFF-57 gate still gates.

### Open Questions
**Punt (phasing):** beep-boop alone vs all five. Recommendation was a split (64a/64b); user chose to **build all five in one PR**. DONE items tagged [64a]/[64b] for traceability only.

## HOW — behaviour
Per consumer: locate the decision point by heading, replace the prose "decide next step" with "shell out to `faff next` with the mapped flags (per the gateway shared rule), branch on `{next}`", leaving fetch, gate, and execution intact. `faff next` is invoked via the resolved `faff` binary (same resolution as other CLI calls). On `error`/unknown status, fall back to existing prose behaviour and log — never crash the pass.

**Risks/edges.** Don't swallow the diagnostic verdicts (beep-boop runs the `routing_adaptor` verdict after a `graft`). Don't pass in-queue deps as `--blocked`. Keep the FAFF-57 gate — `graft` is not consent to build.

## DONE — Definition of Done
- [ ] [shared] The state→flags mapping is documented once in the gateway as a shared rule, referenced by each consumer, computed per-issue (not cross-pass cached).
- [ ] [64a] faff-beep-boop §2/§4/§8.3 consult `faff next` per issue and branch on `{next}`; on `next=graft` the `routing_adaptor` verdict still runs (gap/cycle/repeat preserved).
- [ ] [64a] beep-boop passes `--blocked` for external blockers only; in-queue deps still go through conflict analysis.
- [ ] [64b] faff-prep, faff-graft, faff-tidy, and the gateway interactive next-step each consult `faff next` at their decision point.
- [ ] [64b] The FAFF-57 chain-to-build gate and skill execution remain with the caller (faff next reports only).
- [ ] [all] `faff next --selftest` still passes (engine untouched); no consumer re-implements the transition table inline.

confidence: medium
