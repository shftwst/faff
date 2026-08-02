# Spec — FAFF-695: robust tracker-connector detection under a deferred-tool harness

> Spec: faffter-dark-nlspec · 2026-08-02 · interactive · confidence: medium. Full spec on Linear FAFF-695.

## 1. WHY — problem and principle

faff decides "is an issue tracker available?" by having the model inspect its **immediately-visible tool set**. The gateway tells the model to "auto-detect which issue tracker and git host MCP servers are available … If no tracker MCP is available, it falls back to git-only mode" (`plugin/skills/faff/SKILL.md:179`), and there is **no deterministic probe of tracker-MCP availability** — every `bin/lib` module is pure and explicitly has no MCP access (`state.js`, `contain.js`, `label.js`, `prepcheck.js`). So tracker availability is whatever the model can see in its tool list. (The *git-host* side is different and instructive: `merge-gate --local` (FAFF-526) is a deterministic git-only detector via git plumbing, and faff-beep-boop resolves a whole-lifecycle structural git-only signal **asserted once, never re-sniffed per wave** (FAFF-559). That assert-once idiom is the pattern the tracker side should borrow — see WHAT.)

Under Claude Code the MCP surface is always visible, so this works. Under a **deferred-tool harness (Codex)** tools are not listed until discovered, so the model sees no tracker tool and concludes "no tracker MCP → git-only mode." Three consequences observed in the FAFF-694 run:

- faff-graft refused to build a legitimately-prepped ticket because it read the tracker as absent — the spec was a tracker comment it never looked for.
- **Spec discovery** branches on the same signal: location 4 (`.faff/specs/`) is checked "only in git-only mode (a tracker MCP being absent)" (`SKILL.md:532`). A wrongly-inferred git-only mode sends discovery to the wrong place and yields a false "no spec."
- The **prep marker** attests that attach *happened*, not that the spec is *reachable this session* (`prepcheck.js` is pure, never calls the tracker), so `prepcheck --hook` passed (`attached:true`) while graft still couldn't retrieve the body — false confidence.

The through-line: **absence is inferred from "not immediately listed,"** which is invalid on a harness that defers tools.

## 2. WHAT — design

**Chosen: conclude "no tracker" only after a discovery attempt, never from the immediately-visible list alone.** Everywhere a skill decides tracker-vs-git-only (gateway Configuration `SKILL.md:179`, Spec discovery `SKILL.md:523–532`), it must first attempt to *discover* the connector via the harness's tool-discovery mechanism before concluding absence. "Not in the immediately-visible set" stops being evidence of absence.

**Chosen: honour a config pin as an authoritative override — the cheapest immediate mitigation.** `.faffrc tracking.tracker` already pins the tracker (`SKILL.md:138` for the key; the "pin the choice when autodetection is ambiguous" semantics at `SKILL.md:179`). When it is set, a skill MUST NOT downgrade to git-only merely because the tool isn't immediately visible — a pin is an assertion the connector exists, so the skill discovers or fails loud rather than inferring absence.

**Chosen: at the graft prep-gate, distinguish "no spec" from "tracker unreachable this session."** When the prep marker says `attached:true` but spec discovery (locations 1–3) returns nothing because the tracker read failed, graft must fail **loud** with a distinct "tracker configured/pinned but connector not reachable this session" signal — it must not silently refuse as if unprepped, and must not silently drop to git-only.

**Chosen: resolve the mode once, don't re-infer per skill — reusing the existing assert-once idiom.** faff-prep, faff-graft, faff-jot, faff-tidy, faff-wtf, **faff-beep-boop** and **faff-map** all branch on the same availability signal; each re-inferring from the visible list multiplies the failure. faff-beep-boop already resolves a structural git-only signal once per run and never re-sniffs it per wave (FAFF-559) — extend that same assert-once resolution to the tracker side rather than inventing a new mechanism, so the whole suite consumes one resolved answer.

**Punt (decides: eng, during build):** the discovery *mechanism* is harness-specific — Codex exposes a tool-search/catalogue step; Claude Code already shows the tools. Whether faff grows a small helper (e.g. `faff tracker probe` returning `resolved | pinned-unreachable | git-only`) or the skills carry harness-aware discovery prose is the builder's call. Note the constraint: a CLI helper **cannot call MCP** (the pure-CLI invariant), so a probe is either "read the config pin" (pure CLI) or a prose instruction to the model to run discovery — likely the pin-read is CLI and catalogue discovery is prose.

**Punt (decides: eng):** how the resolved mode is shared — a session marker vs recompute-per-skill. A marker risks staleness across a harness switch; recompute is safe but repeats discovery. Lean: recompute per skill but make discovery correct, rather than caching a possibly-wrong answer.

**Assumes:** the deferred-tool harness exposes *some* discovery mechanism the model can invoke (Codex's tool-search does). If a harness genuinely hides connected tools with no discovery path, git-only is the correct fallback and this ticket's discovery step degrades to today's behaviour — validate against the harness in play.

## 3. HOW — acceptance

- The gateway Configuration section and the Spec discovery rule are reworded so "tracker absent → git-only" is reached only after a discovery attempt, or is overridden by a config pin — not from the immediately-visible tool list alone.
- With `tracking.tracker` pinned, no skill downgrades to git-only on tool-invisibility; it discovers or fails loud.
- faff-graft's prep-gate distinguishes "no spec" from "tracker configured but unreachable this session," failing loud on the latter.
- Behaviour verified on both Codex (deferred tools) and Claude Code (visible tools): a prepped ticket whose spec is a tracker comment is buildable under both.

### Scenarios

```
Given Codex defers tools and Linear MCP is connected
When faff-graft resolves tracker availability
Then it discovers the connector (or honours the config pin) and reads the spec comment
And it does not conclude git-only.
```

```
Given tracking.tracker: linear is pinned and the tool is not immediately visible
When any faff skill resolves tracker mode
Then it does not downgrade to git-only.
```

```
Given the prep marker says attached:true but the tracker connector is unreachable this session
When faff-graft runs its prep-gate
Then it fails loud with "tracker unreachable this session", not "no spec".
```

## 4. DONE — definition of done

- [ ] "Absent → git-only" is reached only after a discovery attempt, or is overridden by a config pin — in both the gateway Configuration section and the Spec discovery rule.
- [ ] A pinned `tracking.tracker` suppresses the tool-invisibility downgrade across faff-prep / graft / jot / tidy / wtf / beep-boop / map.
- [ ] The tracker-side resolution reuses faff-beep-boop's assert-once idiom (FAFF-559) rather than a new per-skill mechanism.
- [ ] faff-graft distinguishes "no spec" from "tracker unreachable this session" and fails loud on the latter.
- [ ] Behaviour verified on both Codex (deferred) and Claude Code (visible) for a prepped ticket whose spec is a tracker comment. **(Manual live-harness check — the CLI cannot probe MCP, so this is not an automatable gate.)**

confidence: medium

```faff-contract:spec-readiness
{"confidence":"medium","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"punt"},{"marker":"punt"},{"marker":"assumes"}]}
```
