# Spec — FAFF-172: Delegation-conformance lint

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high.

A static lint, added to `faff validate-adapters`, that fails any SKILL.md which hardcodes an install-mode-specific invoke literal at a Skill-tool delegation site — the mechanical regression guard for the prose convention FAFF-164 shipped.

## 1. WHY

FAFF-164 made cross-skill delegations resolve in both install modes (linked-dev bare + plugin `faff:`-namespaced) via a prose convention plus a manual two-mode smoke. Nothing mechanically stops a future edit re-introducing a hardcoded `/faff-…` or `faff:…` invoke literal at a delegation site (correct in at most one mode). FAFF-164 named this lint as its deferred extension point. This is the cheap, deterministic, static half — a presence check (the literal is absent), not an invocation test.

**Principles.** Static check, no sibling resolution/execution (the runtime two-mode smoke is FAFF-173). Zero-dependency, joins the existing `validate-adapters` gate. No gateway prose edit (phrase-anchored, survives FAFF-115's restructure). Near-zero false positives over recall.

## 2. OUT OF SCOPE

- Runtime two-mode live-smoke (FAFF-173).
- Any gateway prose edit (FAFF-115 owns `faff/SKILL.md`).
- Policing non-delegation slash prose (`type /faff-prep`, routing tables — keep their slash).
- Generalised `<any-plugin>:` namespace detection (slice flags `/` and `faff:` specifically).

## 3. WHAT — the detection rule

Inside `cmdValidateAdapters`, over every `SKILL.md` in `allSkills` (skipping `.example` lines): a line is a **delegation site** if it contains `via the Skill tool`. On such a line, the delegation **target** is the backtick bound to the word `skill` — i.e. matches of `` `<target>` skill `` (the FAFF-164 convention's notation: `invoke the \`<name>\` skill … via the Skill tool`). A **violation** is a target that is install-mode-specific: starts with `/` (leading-slash form) or `faff:` (plugin namespace).

```
FUNCTION isInstallModeLiteral(tok): tok.startsWith("/") || tok.startsWith("faff:")
per line with /via the Skill tool/i:
  targets = matchAll(/`([^`]+)`\s+skill\b/gi)
  if any target isInstallModeLiteral → FAIL <name> (delegation conformance), name the literal + line
```

Exit: a violation sets `failed` → `validate-adapters` returns non-zero (joins the FAFF-48 CI gate). Fail, not warn.

**As-built refinement (discovered at build — the spec's "hard part").** The first-draft rule flagged *any* backticked install-mode literal on a `via the Skill tool` line. That false-positived on the real tree: faff-wtf/map/graft/etc. put a human-command reference (`"Prep now via \`/faff-prep\`?"`) and the delegation (`invoke the \`faff-prep\` skill via the Skill tool`) on the **same line**. A human-command `/faff-…` reference is never in `` `…` skill `` form, so keying on the `` `target` skill `` construction (the convention's actual notation) is what cleanly discriminates — verified zero-FP across all shipped skills, and still catches a canonical-shaped `` `/faff-prep` skill `` / `` `faff:faff-graft` skill `` violation. Known bound: a violation that drops the word "skill" (`invoke \`/faff-prep\` via the Skill tool`) is not caught — but that also breaks the convention's shape; widening is a future option.

## 4. DESIGN DECISIONS (all Chosen)

- **Discrimination:** phrase anchor (`via the Skill tool`) + the `` `target` skill `` construction (not any backtick on the line). Backstopped by the mandatory real-tree-passes test.
- **Literals flagged:** `/` and `faff:` (precise; avoids colliding with non-invoke colon-tokens like `faff-contract:spec-readiness`).
- **Fail vs warn:** fail.
- **Location:** extend `cmdValidateAdapters`, reusing its `allSkills` loop + FAIL format.
- **No gateway edit** this slice (sentinel-exemption escape hatch deferred, sequenced after FAFF-115).

## 5. SCENARIOS

- `` invoke the `/faff-prep` skill via the Skill tool `` → FAIL, exit non-zero, names `/faff-prep`.
- `` invoke the `faff:faff-graft` skill via the Skill tool `` → FAIL, names the namespace literal.
- Canonical `` `faff-prep` skill `` delegation → passes.
- Human prose `type /faff-prep` / counter-example `… to the Skill tool` / a mixed human-slash + canonical-delegation line → all pass.
- The real shipped tree → passes the lint clean (regression guard).

Non-functional: deterministic, zero-dependency, no new CI step, never resolves/executes a sibling.

## 8. DONE

- [x] Check runs in `cmdValidateAdapters` over every `SKILL.md` (gateway + slot + user-command), skipping `.example`.
- [x] A `via the Skill tool` line whose `` `target` skill `` is `/`- or `faff:`-prefixed → FAIL (non-zero) naming the literal + line + canonical-name fix.
- [x] Human-command prose and counter-example phrasing are not flagged.
- [x] The current shipped tree passes clean (regression-guard test).
- [x] `node --test` covers: slash violation, `faff:` violation, canonical pass, three FP-guards, real-tree-clean.
- [x] No gateway prose edit; no runtime sibling resolution.

confidence: high
