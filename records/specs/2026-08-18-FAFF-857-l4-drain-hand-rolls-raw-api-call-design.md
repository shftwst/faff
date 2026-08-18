# FAFF-857 — Make the bundled helper the only documented network path in the adversarial-transport slot prose

> Spec: faffter-dark-nlspec · 2026-08-17 · autonomous · claude-code/unknown · confidence: high · build-tier: standard · spec-review: approve. Full spec on Linear FAFF-857.

This spec addresses FAFF-857 for the build agent and human reviewers. It is a documentation-only change to two slot skills' `SKILL.md` prose. No code, no config schema, and no CLI behaviour changes.

## 1. WHY — Problem and Principles

**The load-bearing model:** an agent driving the drain reads the slot prose top-to-bottom and imitates the first concrete network recipe it meets. When the sanctioned helper call sits *after* a full backend-endpoint recipe (host base-URLs, `/v1/chat/completions`, `Bearer` auth), the agent's first reflex is to hand-roll that raw request — which the cage blocks — before it ever reaches "use the helper." The fix is ordering and framing, not another injunction.

**Problem statement.** On the P1 link-shortener L4 lights-out drain (2026-08-17, Finding 4), the yagni / spec-review network call was first attempted as a hand-rolled `python3` request to the NVIDIA backend; the cage sandbox refused it (recorded under `permission_denials`), and only then did the agent fall back to the bundled `review-call.mjs` helper (the sanctioned path). The raw-first reflex is avoidable friction and wasted turns, and it signals that the sanctioned transport is not the obvious first choice at the call site.

**Design principles:**

- **Reorder and reframe, do not re-injunct.** A "do not hand-roll an API call" sentence already exists in both slot skills and did not prevent the reflex. The durable fix is that no raw-call recipe (endpoint path + auth + host) appears *before* the sanctioned helper call at the network call site — the helper invocation is the lede, the backend-config detail is explicitly framed as config the helper consumes, not a call the reader makes.
- **Lose no behavioural detail.** Every configuration fact a maintainer needs — the backend-block schema, the provider vocabulary, `reasoning_off`, the fallback-chain semantics, the exit-code table — must survive the reframe. This is a presentation change, not a deletion.
- **One home for the transport detail (dedup).** The canonical backend/transport detail lives in `faffter-dark-adversarial-review` (its owner). `faffter-dark-spec-review` references it rather than restating a reframed recipe, per the skill-authoring standard (`AGENTS.md` → Skill-authoring standard: lean, deduplicated, skimmable).

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Markdown (SKILL prose) | Primary target — owns the backend-config block, the **Transport families** table, the **Backend call** region, and the exit-code table. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Markdown (SKILL prose) | Secondary — its "Backend call — reuse the shared transport" region already leads with reuse + "do not hand-roll"; align for consistency, introduce no raw-call recipe. |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node | The sanctioned transport. **Read-only reference** — its behaviour is unchanged. |
| `AGENTS.md` → Skill-authoring standard | Markdown | Binding authoring rules; `faff validate-adapters` gates the lintable subset. |

**Scope statement.** This tightens the call-site prose of the two `faffter-dark` review slots so the sanctioned helper is the single obvious network path; it is the prose companion to FAFF-816 (which wired the yagni Phase-2 *seam* to the documented transport) and to FAFF-261 (which made chain assembly mechanical).

## 2. OUT OF SCOPE

- **Any change to `review-call.mjs`, `fan-out.mjs`, or `review-spawn.mjs`** — Why excluded: this is a prose fix; transport mechanics are unchanged. Extension point: a separate ticket against those files if transport behaviour must change.
- **A mechanical cage/PreToolUse fence that blocks raw backend egress** — Why excluded: the ticket explicitly scopes the fix to the slot prose, and the friction is "not fatal." Extension point: `faff hooks-ensure` (which already owns the raw-`gh pr merge` merge-fence, FAFF-434) is where a future raw-backend-egress fence would live if the prose fix proves insufficient.
- **Backend-config schema or provider-vocabulary changes** — Why excluded: the schema is correct and needed; only its framing moves. Extension point: the `faffter_dark.adversarial` config block.
- **The yagni Phase-2 seam wiring** — Why excluded: already delivered by FAFF-816 (Done). This spec touches only how the transport is *presented* at the call site.

## 3. WHAT — Vocabulary and target regions

**Vocabulary:**

| Term | Definition |
|---|---|
| Call site | The point in a slot's prose where the agent decides how to make the adversarial network call. |
| Raw-call recipe | Prose that gives the endpoint path, host base-URL, and auth header in a form an agent can imitate to construct a raw HTTP/`python3`/`curl` request. |
| Sanctioned path | Invoking the bundled `review-call.mjs` helper (via `review-spawn.mjs`) — the only network path the cage permits. |

**Target regions in `faffter-dark-adversarial-review/SKILL.md`** (current line references, indicative — the build agent locates by heading, not line number):

- The backend-config block and the **Transport families** table (~L116–L152): today these present provider / host base-URL / `/v1/...` endpoint / `Bearer` auth as a top-to-bottom read *before* the "use the helper" injunction.
- The **Backend call — the bundled `review-call.mjs` helper (do not hand-roll the API call)** paragraph (~L154) and the `review-spawn.mjs` wrapper paragraph (~L179–L181): the sanctioned invocation, currently downstream of the recipe.

**Design decision — reframe in place vs. relocate the config detail.**

- Option A — relocate: move the backend-config block + Transport-families table below the sanctioned-call lede, under a heading that names them as backend *configuration*.
- Option B — reframe in place: keep ordering but re-lead the region with the sanctioned call and re-label the table as helper-internal.

**Chosen:** Whichever of A/B the build agent judges cleaner against the current file, provided the acceptance criteria hold — the sanctioned call is the lede of the network-call region and the endpoint/auth detail is unambiguously framed as backend configuration the helper consumes, not a call the reader makes. Rationale: the outcome (no raw-call recipe before the sanctioned call) is what matters; the exact edit shape is an implementation choice, not an architecture decision.

**Assumes:** The observed raw-first reflex is driven by the call-site prose ordering/framing (the ticket's own hypothesis: "the sanctioned transport is not the obvious first choice at the call site"). Validation before building: re-read the two target regions and confirm the endpoint/auth recipe currently precedes the sanctioned-helper injunction — if it does not, narrow the change to the framing/anti-pattern additions only.

## 4. HOW — Behaviour

**Approach.** Edit the two `SKILL.md` files so the sanctioned helper is the single documented network path at each call site:

1. In `faffter-dark-adversarial-review/SKILL.md`, hoist the sanctioned-call statement to the **lede** of the network-call region: the first thing an agent reaching "how is the network call made" sees is that the call is made **only** by `review-call.mjs` (via `review-spawn.mjs`), never a hand-rolled raw request — the cage blocks a raw call and it wastes turns.
2. Re-frame the backend-config block and **Transport families** table as **backend configuration the helper consumes / what `review-call.mjs` does internally on each provider**, not call-site instructions. Keep every field and row; change only the framing so it no longer reads as a raw-request recipe.
3. Add a co-located **Anti-pattern** at the call site: reconstructing the endpoint/host/auth detail into a hand-rolled `python3`/`curl`/raw-HTTP request. Why: the cage blocks raw backend egress (`permission_denials`) and the reflex wastes turns; `review-call.mjs` is the only sanctioned path.
4. In `faffter-dark-spec-review/SKILL.md`, keep its already-correct "reuse the shared transport … do not hand-roll an API call" lede; verify it introduces no raw-call recipe and that it *references* the adversarial-review transport as the one home rather than restating a reframed recipe.

**Anti-pattern:** appending another "do not hand-roll" sentence while leaving the endpoint/auth recipe ahead of the sanctioned call. Why: a defensive injunction already exists downstream of the recipe and did not stop the reflex; only removing the raw-first ordering fixes it.

**Failure modes:**

- **The failure** — prose reframing may not fully eliminate the raw-first reflex; an agent could still hand-roll despite the reordering. **How you'd know** — a future L3/L4 drain log again records a `permission_denials` raw-backend entry before the `review-call.mjs` fallback. **What it means** — the prose lever is insufficient; escalate to the out-of-scope mechanical fence (a `hooks-ensure`-owned PreToolUse fence on raw backend egress). A null result (no such reflex recurs) confirms the prose fix sufficed.
- **The failure** — the reframe silently drops a config fact (a provider row, `reasoning_off`, a fallback-chain rule). **How you'd know** — a maintainer configuring a backend can no longer find the field; or `faff validate-adapters` flags a structural regression. **What it means** — restore the dropped detail; the change is presentation-only by construction.

## Scenarios

```
Given the faffter-dark-adversarial-review SKILL prose after this change
When an agent reads the network-call region top-to-bottom to decide how to make the adversarial call
Then the first concrete instruction it meets is to invoke review-call.mjs (via review-spawn.mjs), and the endpoint/host/auth detail is framed as backend configuration the helper consumes, not a raw request to construct
```

```
Given the reframed prose
When a maintainer looks up how to configure an NVIDIA (or other OpenAI-compatible) backend
Then the provider vocabulary, host/base-URL rule, Bearer/api_key_env rule, reasoning_off, and the fallback-chain semantics are all still present (relocated/reframed, not deleted)
```

- The two edited `SKILL.md` files pass `faff validate-adapters` (line caps, no stray markers, no duplicated blocks).

## 5. DESIGN DECISION RATIONALE

**Reframe-and-reorder vs. add-another-injunction.** Options: (a) add a stronger "do not hand-roll" warning; (b) reorder so the sanctioned call leads and reframe the recipe as helper-internal config. **Chosen:** (b) — the injunction already existed and failed; the load-bearing cause is that the raw recipe reads first, so removing that ordering is the fix. Rationale in WHY design principles.

**Where the canonical transport detail lives.** Options: duplicate the reframed recipe into both slot skills, or keep one home. **Chosen:** one home in `faffter-dark-adversarial-review`; `faffter-dark-spec-review` references it. Rationale: the skill-authoring standard requires dedup (shared prose has one home); duplication also risks `faff validate-adapters` duplicated-block findings.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none blocking.

**Assumptions:** the raw-first reflex is prose-ordering-driven (see WHAT → **Assumes**), with the validation instruction stated there.

## 7. DONE — Definition of Done

### From WHY
- [ ] The network-call region of `faffter-dark-adversarial-review/SKILL.md` leads with the sanctioned `review-call.mjs` (via `review-spawn.mjs`) call as the single documented network path; the "never hand-roll a raw request" statement is at the lede, before any backend endpoint/auth detail.

### From WHAT / HOW (framing)
- [ ] The backend-config block and **Transport families** table are framed as backend configuration the helper consumes / helper-internal provider dispatch, not as call-site instructions to construct a request.
- [ ] A co-located **Anti-pattern** names reconstructing the endpoint/host/auth detail into a hand-rolled `python3`/`curl`/raw-HTTP request, with the cage-blocks-it / wasted-turns rationale.
- [ ] `faffter-dark-spec-review/SKILL.md` retains its reuse-first lede, introduces no raw-call recipe, and references the adversarial-review transport as the single home.

### From HOW (no-loss invariant)
- [ ] Every pre-existing config fact survives: provider vocabulary, host/base-URL rule, `Bearer`/`api_key_env`, `reasoning_off`, fallback-chain semantics, and the exit-code table are all still present.

### From constraints
- [ ] No change to `review-call.mjs`, `fan-out.mjs`, `review-spawn.mjs`, the `.faffrc` schema, or any CLI behaviour (git diff touches only the two `SKILL.md` files).
- [ ] Both edited `SKILL.md` files pass `faff validate-adapters`.

**Integration smoke test:** run `faff validate-adapters` after the edits and confirm exit 0 (no new findings on the two touched skills).

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "chosen" } ] }
```
