# FAFF-522 — Default gates.fallback to fail-closed — secure-by-default merge-gate floor

> Spec: faffter-dark-nlspec · 2026-07-16 · autonomous · confidence: high. Full spec on Linear FAFF-522.

This spec is for the build agent implementing FAFF-522, and for the human reviewer gating it. It describes a one-line-intent default flip — `gates.fallback` from `advisory` to `fail-closed` — hardened against a second, easily-missed default source. The audience needs to know exactly which code and doc surfaces move, why both defaults must move together, and which behaviours must NOT change.

## 1. WHY — Problem and Principles

**The load-bearing mechanism.** `gates.fallback` governs one case only: a repo where `faff gates discover` finds NO declared engineering gates (`discovery: none` in `gates.js`). Today that case defaults to `advisory`, which yields `signal: pass` — a repo with zero gates silently merges "green". The flip makes the same case default to `fail-closed`, yielding `signal: needs-human`. Nothing else about the ladder changes.

**Problem statement:** A gate-less repo under the current `advisory` default sails through `faff gates run` with a green `pass` even though nothing was actually verified — faff asserts quality by silence. This change flips the default so an unverified repo routes to a human (`needs-human`) instead, and leaves `advisory` available as an explicit, loud opt-out for a repo that legitimately has no gates.

**Design principle — never green by silence.** A `pass` signal must mean "checks ran and passed", never "no checks existed". An empty gate set is an absence of evidence, not evidence of quality; the secure default treats absence as `needs-human`. This principle is the whole reason for the flip and outranks the convenience of a gate-less repo building unattended without config.

**Design principle — one default, two enforcing sites, kept in lockstep.** The `gates.fallback` default is resolved in TWO independent places (see Reference context): `gatesFallbackPolicy` in `gates.js` (drives the actual ladder signal) and the `DEFAULTS` map in `config.js` (drives `faff config get` and the L4 lights-out dial-coherence preflight). They share no code. Flipping only one leaves the product internally incoherent — e.g. the ladder fails closed but the preflight still refuses because it read the stale `advisory` default. Both MUST read `fail-closed` after this change, and a DONE item pins each.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` `gatesFallbackPolicy` (~L146–153) | JavaScript | Primary default; returns the ladder's fallback policy. Hardcoded `advisory` default lives here. |
| `plugin/skills/faff/bin/lib/gates.js` `runLadder` (~L157–176) | JavaScript | Consumer: `discovery === "none"` branch maps the policy to `needs-human` (fail-closed) or `pass` (advisory). UNCHANGED by this ticket. |
| `plugin/skills/faff/bin/lib/gates.js` `gatesSelftest` (case 4, ~L252–259) | JavaScript | Selftest asserting `advisory default → pass`; must be re-pointed. |
| `plugin/skills/faff/bin/lib/config.js` `DEFAULTS["gates.fallback"]` (L44) | JavaScript | SECOND default source. Read by `configGet` (L197) and by lights-out (`lights-out.js` L736). Ticket's enumerated changes omitted this — it must flip too. |
| `plugin/skills/faff/bin/lib/lights-out.js` `dialReckoning` (L736) + Rule B (L249–255) | JavaScript | Consumer of the `config.js` default. Rule B logic UNCHANGED; it passes out of the box once the default it reads is `fail-closed`. |

**Scope statement:** This sits at the L3 engineering-gate ladder (`faff-graft` Step 7.5) and the L4 lights-out preflight; it is a default-value change plus its selftests and docs, touching no control flow.

## 2. OUT OF SCOPE

- **`advisory` opt-out mechanism** — the `advisory` value stays fully supported as the documented explicit opt-out. Only its status as the *default* changes. Extension point: none needed; the resolver already branches on the value.
- **`runLadder` / Rule B control flow** — the `discovery: none → policy` mapping and the lights-out Rule B refusal predicate are correct as written; this ticket only changes the default the predicates resolve to. Extension point: `gates.js` `runLadder`, `lights-out.js` `dialReckoning`.
- **Repos WITH declared gates** — any repo where `discovery: confident` never touches `gates.fallback` at all; wholly unaffected at any setting. Faff's own repo has real gates, so faff-on-faff is unaffected. No code path change guards this — it falls out of the fact that the fallback is consulted only in the `discovery: none` arm.
- **Unifying the two default sources** — collapsing `gatesFallbackPolicy`'s hardcoded default and `config.js` `DEFAULTS` into one source is a tempting refactor but a separate concern; this ticket keeps both and only flips their values. Extension point: a future ticket could make `gatesFallbackPolicy` read `DEFAULTS`.
- **Greenfield-scaffold gate declaration** — that a freshly-scaffolded L4 app has no gates early (so fail-closed routes its first builds to `needs-human`) is a real consequence, but the coherent fix is scaffolding declaring gates up front, tracked under FAFF-513 — NOT weakening this default. See Design Decision Rationale. Extension point: FAFF-513 scaffolder config.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| `discovery: none` | `discoverRungs` resolved zero engineering-gate rungs from the repo's own config (no pre-commit / package.json / Makefile gate). The ONLY case `gates.fallback` governs. |
| fail-closed | The fallback policy that maps `discovery: none` → `signal: needs-human` (surface to a human; no silent green). |
| advisory | The fallback policy that maps `discovery: none` → `signal: pass` (surface "no declared gates found" and pass). Remains the explicit opt-out. |

**Resolver surfaces (both must default fail-closed after this change):**

```
FUNCTION gatesFallbackPolicy(root) -> "advisory" | "fail-closed":   # gates.js
  read config gates.fallback
  IF value == "fail-closed": return "fail-closed"
  IF value == "advisory":    return "advisory"     # explicit opt-out preserved
  return <DEFAULT>            # <-- flips: "advisory" -> "fail-closed"

CONST DEFAULTS["gates.fallback"] = <DEFAULT>        # config.js  <-- flips: "advisory" -> "fail-closed"
```

**Design decision:** default fallback policy for an empty gate set.
**Chosen:** `fail-closed` — an unverified repo routes to a human rather than emitting a silent `pass`. `advisory` is retained as an explicit opt-out.

## 4. HOW — Behavior

**Approach.** Change two literal default values from `"advisory"` to `"fail-closed"`, update the selftest that asserts the old default, and reword the four doc/prose surfaces that state "default advisory". No procedure, branch, or signature changes.

**Primary flip — `gates.js` `gatesFallbackPolicy`:** the final `return "advisory"` becomes `return "fail-closed"`. The two explicit-value branches (`=== "fail-closed"`, and the implicit else that today falls through to `advisory`) must both still be reachable — after the flip, an explicit `advisory` in config must still return `advisory`. Confirm the function returns `advisory` ONLY when config explicitly says so.

**Anti-pattern:** collapsing the explicit-`advisory` branch when flipping the default. Why: `advisory` must remain selectable as the opt-out; a flip that makes every path return `fail-closed` breaks the documented opt-out.

**Second flip — `config.js` `DEFAULTS`:** `"gates.fallback": "advisory"` becomes `"gates.fallback": "fail-closed"`. This is the surface the ticket's enumerated change list omitted. Without it, `faff config get gates.fallback` (unset) still reports `advisory`, and — critically — the L4 lights-out preflight's `dialReckoning` (which reads `dig(cfg,"gates.fallback") || DEFAULTS["gates.fallback"]`, `lights-out.js` L736) still resolves `advisory` and Rule B still refuses `dial-coherence:gates-fallback` out of the box. The advertised side-effect win depends on this flip.

**Edge cases:**
- Repo WITH gates (`discovery: confident`): fallback never consulted → identical signal at any `gates.fallback` value.
- Explicit `gates.fallback: advisory`: both resolvers return `advisory` → silent `pass` restored (opt-out honoured); L4 lights-out still refuses it (Rule B unchanged — advisory is not fail-closed).
- Explicit `gates.fallback: fail-closed`: unchanged (already the value being made default).
- Errored rung under `discovery: none`: an errored rung already forces `needs-human` regardless of fallback; the fallback only decides the all-clear-but-no-gates case.

**Failure modes:**

- **The failure:** the second default source (`config.js` `DEFAULTS`) is missed, so only the ladder flips. **How you'd know:** `faff lights-out --check` on a gate-less repo with no `gates.fallback` config still refuses on `dial-coherence:gates-fallback`; `faff config get gates.fallback` prints `advisory`. **What it means:** incomplete — the DONE items for both surfaces catch it.
- **The failure:** the explicit-`advisory` branch is broken while flipping, silently disabling the opt-out. **How you'd know:** the "advisory opt-out restores pass" selftest case fails. **What it means:** narrow the flip to the default-only path.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Given a repo with NO declared engineering gates and no `gates.fallback` in config
When `faff gates run` executes the ladder
Then the emitted signal is `needs-human` (was `pass`) and the process exits non-zero

Given the same gate-less repo but with `gates.fallback: advisory` set in config
When `faff gates run` executes the ladder
Then the signal is `pass` — the explicit opt-out restores the previous silent-pass behaviour

Given a repo WITH at least one declared gate (`discovery: confident`)
When `faff gates run` executes at any `gates.fallback` value (unset / advisory / fail-closed)
Then the signal is identical to before this change — the fallback is never consulted

## 5. DESIGN DECISION RATIONALE

**What default should an empty gate set resolve to?**
- *advisory (status quo)* — pro: a gate-less repo builds unattended with zero config; con: violates "never green by silence" — asserts quality that was never checked.
- *fail-closed (chosen)* — pro: secure-by-default, routes unverified work to a human, and makes the L4 lights-out preflight pass without an explicit `.faffrc.local.yaml` dial; con: a legitimately gate-less repo must now set `advisory` explicitly to build unattended (an acceptable, loud one-line opt-out).
- **Chosen:** `fail-closed`, with `advisory` retained as the explicit opt-out.

**Should the greenfield-scaffold interaction weaken this to advisory?** A greenfield app scaffolded at L4 has no gates early, so fail-closed routes its first builds to `needs-human`. The coherent fix is the scaffolder declaring gates up front (FAFF-513), not weakening this default — weakening it would reintroduce silent-green for every gate-less repo to serve one lifecycle moment.
- **Chosen:** hold the fail-closed default; pair with FAFF-513 for greenfield gate declaration. This ticket does NOT weaken the default. (This is a decided consequence, documented, not an open question — the greenfield fix lives in its own ticket.)

**Temporal anchor:** at the time of writing, faff parses gate sources from pre-commit / package.json / Makefile only; a repo declaring checks solely in CLAUDE.md or CI resolves `discovery: none` and is therefore subject to this default — an argument that reinforces routing such a repo to a human rather than passing it green.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. The greenfield-scaffold interaction is a decided consequence (hold the default; fix in FAFF-513), not an open decision.

**Assumptions:**
- **Assumes:** no other faff code path reads a hardcoded `"advisory"` default for `gates.fallback` beyond the two identified resolvers. *Validation:* before editing, `grep -rn 'gates.fallback\|"advisory"' plugin/skills/faff/bin/lib/` and confirm the only default-producing sites are `gates.js` `gatesFallbackPolicy` and `config.js` `DEFAULTS`; the `lights-out.js` `coherentDial()` already hardcodes `fail-closed` (no change).

## 7. DONE — Definition of Done

### From WHY (principles)
- [ ] A gate-less repo with no `gates.fallback` config yields `signal: needs-human` from `faff gates run` (never a silent `pass`).
- [ ] The two default sources (`gates.js` `gatesFallbackPolicy`, `config.js` `DEFAULTS`) both resolve `fail-closed` when config is unset — verified independently.

### From WHAT / HOW (behaviour)
- [ ] `gatesFallbackPolicy` returns `fail-closed` when `gates.fallback` is unset, `fail-closed` when explicitly set, and `advisory` ONLY when explicitly set to `advisory`.
- [ ] `config.js` `DEFAULTS["gates.fallback"] === "fail-closed"`; `faff config get gates.fallback` (unset) prints `fail-closed`.
- [ ] A repo WITH declared gates emits an identical signal at unset / advisory / fail-closed (fallback not consulted).
- [ ] `faff lights-out --check` on a gate-less repo with no `gates.fallback` config does NOT refuse on `dial-coherence:gates-fallback`.

### From selftests
- [ ] `gates.js` selftest case 4 asserts the NEW default: `discovery: none` with no config → `signal: needs-human` (replacing the `advisory default → pass` assertion).
- [ ] A `gates.js` selftest case asserts the explicit opt-out: `gates.fallback: advisory` → `signal: pass` still holds.
- [ ] `node plugin/skills/faff/bin/lib/gates.js --selftest` and the `config.js` / `lights-out.js` selftests all pass.

### From docs
- [ ] `.faffrc.example.yaml` (~L148–153): comment and inline default reworded — `fallback: fail-closed` shown as default; `advisory` documented as the explicit opt-out.
- [ ] `docs/guide/unattended.md`: the `.faffrc.local.yaml` remedy (~L115–125) no longer implies `gates.fallback` must be overlaid to satisfy dial-coherence out of the box (fail-closed is now the default; only the `spec_review` dial remains operator-set).
- [ ] `plugin/skills/faff-graft/SKILL.md` (Step 7.5 discovery-fallback prose, ~L279–285): "default is advisory" statements flipped to fail-closed; `advisory` shown as the opt-out. Kept within skill-authoring line caps (`faff validate-adapters`).
- [ ] `plugin/skills/faff/SKILL.md` (~L154): the `gates.fallback` gloss line flipped to state fail-closed as default.

**Integration smoke test:**
```
PROCEDURE smoke:
  1. mktemp dir with only a README (no package.json/Makefile/pre-commit).
  2. faff gates run --root <dir> --json  -> assert .signal == "needs-human", exit != 0.
  3. write .faffrc.yaml `gates:\n  fallback: advisory` into <dir>.
  4. faff gates run --root <dir> --json  -> assert .signal == "pass", exit 0.
  5. faff config get gates.fallback (no config) -> assert prints "fail-closed".
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
