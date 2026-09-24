# FAFF-1080 — Support a functional team-set per repo, with cross-team blockers first-class

> Spec: faffter-dark-nlspec · 2026-09-22 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1080.

_Revised 2026-09-22: folded three ratified decisions (cell grouping, cross-team risk work, onboarding acquisition). Confidence lifted from medium to high, as the three Punts that drove the medium rating are now closed._

This is the buildable spec for FAFF-1080. Its readers are the build agent that will implement the change and the human reviewers who gate it. It turns faff's single-team tracking model into a set of purpose-specific teams whose load-bearing structure is the blockers between them, while keeping today's single-team behaviour byte-identical.

## 1. WHY — Problem and Principles

**The load-bearing model: faff should see one graph over many teams, not one team.** A repo's real working surface can be several purpose-specific teams (an ideas team for questions and spikes, a product team, a risks team). What matters is not any one team's list but the blocker edges *between* them: a product feature blocked by an open spike in ideas, or by an unmitigated risk. This spec makes the configured team a *set*, makes reads fan out across that set in one pass, makes cross-team blocker edges first-class in the graph the diagnostics already walk, and routes a newly created ticket to the team matching its kind.

**Problem statement.** Today `tracking.team_key` is a single scalar (config.js `TRACKING_KEYS`), so faff sees exactly one team: one read filter, one create target. It can neither pull the cross-team blocker graph nor sequence across it, and it cannot file a new item into the team matching its kind. This change replaces the single team with a validated team-set, fans reads across it, treats cross-team edges as one chain, and routes creates by kind.

**Design principles.**

**Back-compat is a hard floor, not a goal.** A legacy `tracking.team_key`-only config must resolve to a one-element team-set and behave byte-identically to today. The golden self-intake table (test/self-intake.test.mjs) is the regression anchor; if any legacy-single-team row changes, the shim is wrong. This principle rejects any implementation that special-cases the multi-team path in a way that perturbs the single-team path.

**The self-intake containment floor must not weaken.** `decideSelfIntake` (shared-infra.js:178-197) gates an autonomous-filing hard floor (FAFF-539) on strict single-team equality. Generalising equality to set-membership must not let a foreign team read as self (weakening the floor) nor break self-hosting by over-tightening it. This is the highest-risk site in the change.

**Reads and traversal are prose seams; the config is the code seam.** No CLI code filters `list_issues` by team, and no bin/lib helper walks the blocker graph; both are agent prose driven by SKILL.md reading `faff config get`. So "one team to a set" lands as prose edits for reads and traversal, and as real code plus tests for config resolution, validation, and the self-intake shim. An implementation that tries to build a code-level team-filtered read path is over-building against the grain of the existing design.

**The scalar-only config writer invariant is preserved.** The config writer has emitted only scalar values since FAFF-667; `teams` and `team_routing` are a sequence and a map by construction. Rather than teach the writer to serialise structures (and break the surgical scalar-only invariant), this spec routes those two keys through the existing sequence-value refusal (the `adversarial.refs` precedent). Only the scalar `default_team` goes through the writer.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` | JavaScript | `TRACKING_KEYS`, `DEFAULTS`, `SEQUENCE_VALUED_KEYS`, `cmdConfigSet`, `knownKeyLint`, `fmt` — the config schema and write seam |
| `plugin/skills/faff/bin/lib/shared-infra.js` | JavaScript | YAML-subset parser (`scalar`, `parseSeq`, `parseMap`) and `decideSelfIntake` — the parse and self-intake code |
| `plugin/skills/faff/bin/lib/self-intake.js` | JavaScript | `deriveSelfFromConfig` reads `tracking.team_key`; `SELF_INTAKE_REASONS` golden table |
| `plugin/skills/faff-wtf/SKILL.md` | Markdown prose | The one explicit team-scoping read line (line 47) |
| `plugin/skills/faff-tidy/SKILL.md` | Markdown prose | "the team / project" scope prose (line 36) |
| `plugin/skills/faff-jot/SKILL.md` | Markdown prose | Create discipline; where team-routing prose is authored |
| `plugin/skills/faff-plot/SKILL.md` | Markdown prose | Reuses jot's create discipline by reference |
| `plugin/skills/faff/references/create.md` | Markdown prose | Type taxonomy and type determination that routing keys select on |

**Scope statement.** This change sits at the `tracking.*` config surface and the read/create/self-intake seams that consume it; it is the multiplicity upgrade of the team dimension only.

## Already shipped against this surface

Related Done work worth following as precedent; none supersedes this issue's premise (no shipped ticket delivers a team-set, `team_routing`, or cross-team blocker traversal):

- **FAFF-1044** — configurable control-label prefix `tracking.label_prefix`: the pattern for adding a scalar `tracking.*` key end to end (writer allowlist plus default plus docs).
- **FAFF-768 / FAFF-1048** — `resolveDocsPath` extensions for `tracking.adr_docs_path` and `tracking.adr_superseded_docs_path`: the config-resolve extension pattern for a new `tracking.*` key.
- **FAFF-5 / FAFF-531 / FAFF-667** — the `faff config init` / `config set` writer and the sequence-value refusal invariant: the precedent that governs the config-write-seam decision below.
- **FAFF-794 / FAFF-965** — `faff config check` unknown/misspelled-key handling: the validation surface that must recognise the new keys (note `knownKeyLint` is namespace-level only today).
- **FAFF-539** — the mechanical same-team gate for outward-self-intake: the single-team equality this change generalises to set-membership without weakening the floor.

## 2. OUT OF SCOPE

- **Multi-project (`tracking.project_id` as a set).** Excluded because `project_id` is documented-but-unimplemented (no bin/lib `.js` reads it; `config init` exits 2 on it), so making it a set has no existing behaviour to generalise and is orthogonal to the team dimension. Extension point: a later issue mirrors the `teams`/`default_team` treatment onto `tracking.projects`/`tracking.default_project` in `TRACKING_KEYS` and the resolver, once single `project_id` reads exist to preserve.
- **Adding `risk` to the type taxonomy.** Excluded because the taxonomy (bug/feature/spike/chore/epic/default, create.md:11-18) is a closed product decision, and routing does not need it (routing keys are free-form type tokens, see WHAT). Extension point: `plugin/skills/faff/references/create.md` type taxonomy and the `methodology` slot's `ticket-shaping` output.
- **Teaching the config writer to serialise sequences and maps.** Excluded to preserve the scalar-only writer invariant (FAFF-667); `teams` and `team_routing` are hand-edited in the committed base like `adversarial.refs`. Extension point: `emitTrackingBlock`/`mergeConfigPath` in config.js if a structured writer is ever justified.
- **A "cell" dimension above teams.** Excluded by ratified decision: v1 is a flat validated team-set, and a cell dimension is a named extension point added only if a repo needs org-level grouping (see Design Decision Rationale). Extension point: a `tracking.cells` map keyed above `teams`, resolved in the same config layer.
- **faff-map / faff-beep-boop read-path code changes.** faff-map already fetches by initiative and project nesting with no team filter, and faff-beep-boop has no team-scoped read logic, so both are team-agnostic already. Extension point: none needed; they inherit the widened graph input.
- **Onboarding auto-detection of a team-set.** Excluded by ratified decision: onboarding keeps writing a single team, and a team-set is a hand-edited `.faffrc` opt-in with no tracker auto-detection in v1 (see Design Decision Rationale). Extension point: `plugin/skills/faff-onboard/SKILL.md` config-init flow.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| team-set | The set of team keys faff reads across and creates into for a repo, expressed as `tracking.teams` |
| default team | The fallback create target (`tracking.default_team`) when routing does not resolve a team |
| team routing | An optional map from a ticket's kind (type token) to the team it is created into (`tracking.team_routing`) |
| routing key | A left-hand key in `team_routing`; a free-form type token matched against the determined ticket type |
| legacy single-team | A config carrying only `tracking.team_key` and no `teams`; resolves to a one-element team-set |
| cross-team edge | A blocker link whose two issues live in different configured teams |

**Config schema.**

```
RECORD TrackingTeamConfig:
  teams: List<TeamKey>           # the team-set; non-empty when present; hand-edited (sequence-valued)
  default_team: TeamKey          # scalar; writable via config init/set; MUST be a member of teams
  team_routing: Map<TypeToken, TeamKey>   # optional; hand-edited (map-valued); every VALUE MUST be a member of teams
  team_key: TeamKey              # LEGACY scalar; mutually-exclusive-in-practice with teams

  CONSTRAINT teams non-empty when present
  CONSTRAINT default_team ∈ teams
  CONSTRAINT ∀ v ∈ values(team_routing): v ∈ teams
  # routing KEYS are NOT constrained to the taxonomy — a free-form type token that never
  # matches simply never routes (no error). Only VALUES are membership-validated.
```

**Resolved team-set (the shim output).** All consumers read a single resolved shape, never the raw keys:

```
RECORD ResolvedTeams:
  teams: List<TeamKey>           # >= 1 element, always
  default_team: TeamKey          # always present after resolution
  routing: Map<TypeToken, TeamKey>   # possibly empty

  RESOLUTION:
    IF tracking.teams present:
      teams        := tracking.teams
      default_team := tracking.default_team   # required alongside teams
      routing      := tracking.team_routing OR {}
    ELSE IF tracking.team_key present (legacy):
      teams        := [tracking.team_key]
      default_team := tracking.team_key
      routing      := {}
    ELSE:
      teams := []; default_team := null; routing := {}   # zero-config; unchanged from today
```

**Serialisation form (parser constraint, load-bearing).** `teams` and `team_routing` MUST be written in block form, which the shared parser reads today via `parseSeq`/`parseMap`:

```yaml
tracking:
  teams:
    - IDEAS
    - PRODUCT
    - RISKS
  default_team: PRODUCT
  team_routing:
    spike: IDEAS
    bug: PRODUCT
    feature: PRODUCT
    risk: RISKS
```

The inline-flow form from the ticket (`teams: [IDEAS, PRODUCT, RISKS]`) does NOT parse: `scalar()` (shared-infra.js:308-320) parses `[...]`/`{...}` via `JSON.parse`, which requires double-quoted strings, so bare identifiers read back as a plain string, not an array. This is the parser finding the ticket flags. **Decision** on the form is in Design Decision Rationale.

**Config read surface.** `faff config get tracking.teams` and `tracking.team_routing` return structured values; `fmt()` (config.js:840-844) does `String(value)`, so a plain `get` yields `[object Object]` for the map. Callers MUST use `faff config get --json` for the structured keys. `tracking.default_team` is a scalar and prints normally.

**Config write surface.**

| Key | Shape | Write path |
|---|---|---|
| `tracking.default_team` | scalar | Add to `TRACKING_KEYS` (the write-allowlist); writable via `config init --set` / `config set`, the same seam `team_key` uses. No `DEFAULTS` registry default is needed (like `team_key`, which has none); a per-repo team has no universal default. The `label_prefix` precedent (FAFF-1044) shows the scalar-key-add end to end |
| `tracking.teams` | sequence | Add to `SEQUENCE_VALUED_KEYS`; `config set` refuses by name; hand-edit the committed base |
| `tracking.team_routing` | map | Add to `SEQUENCE_VALUED_KEYS`; `config set` refuses by name; hand-edit the committed base |

**Validation surface (`faff config check`).** The check must recognise the three new keys and enforce the cross-field constraints fail-loud:

- `default_team` present without `teams` (and without legacy `team_key`) — error.
- `default_team ∉ teams` — error, naming the offending value and the member set.
- any `team_routing` value `∉ teams` — error, naming the offending key, value, and the member set.
- `teams` present but empty — error.

Note `knownKeyLint` (config.js) inspects only top-level document keys against `RECOGNISED_NAMESPACES`; nested `tracking.*` leaves are not leaf-linted today, so a misspelled `tracking.team` would not warn. Recognising the new keys is done in the `config check` cross-field validation, not by extending `knownKeyLint` to leaf level (that is a separate, larger change; leaf-level lint is out of this issue's scope).

## 4. HOW — Behavior

**Architecture and approach.** One code seam and three prose seams.

```
config.js / shared-infra.js          (CODE)  — schema, parse, validate, self-intake shim
  ->  resolveTeams(config) : ResolvedTeams   — the single shim every consumer reads

faff-wtf / faff-tidy SKILL.md         (PROSE) — fan reads across resolved teams
map / tidy blocker-graph prose        (PROSE) — input widens to the union graph; detection unchanged
faff-jot SKILL.md (referenced by plot) (PROSE) — route a create by routing then default_team
```

**Config resolution and validation.**

```
PROCEDURE resolveTeams(config):
  1. teams := dig(config, "tracking.teams")
  2. IF teams is a non-empty array:
     a. default_team := dig(config, "tracking.default_team")
     b. routing := dig(config, "tracking.team_routing") OR {}
     c. RETURN { teams, default_team, routing }
  3. ELSE IF dig(config, "tracking.team_key") is a non-empty string:
     a. tk := trimmed team_key
     b. RETURN { teams: [tk], default_team: tk, routing: {} }   # legacy shim
  4. ELSE RETURN { teams: [], default_team: null, routing: {} }  # zero-config

PROCEDURE validateTeams(config):  # invoked by `faff config check`
  1. teams := dig(config, "tracking.teams"); dt := dig(config, "tracking.default_team")
  2. routing := dig(config, "tracking.team_routing")
  3. IF teams present:
     a. IF teams empty -> ERROR "tracking.teams is empty"
     b. IF dt absent -> ERROR "tracking.default_team required when tracking.teams is set"
     c. IF dt ∉ teams -> ERROR "tracking.default_team '<dt>' not in tracking.teams [<members>]"
     d. FOR (k, v) in routing: IF v ∉ teams -> ERROR "tracking.team_routing['<k>'] -> '<v>' not in tracking.teams [<members>]"
  4. IF teams absent AND dt present AND team_key absent -> ERROR "tracking.default_team set without tracking.teams"
```

**Self-intake shim (highest-risk site).** `deriveSelfFromConfig` (self-intake.js:55-73) reads `tracking.team_key`; it becomes `resolveTeams`-aware and returns a `teams` set (still deriving a single `repo`). `decideSelfIntake` (shared-infra.js:178-197) changes its team equality rung to membership:

```
# BEFORE (shared-infra.js:190):
IF target.team != null AND self.team != null AND target.team == self.team -> self, "team-match"

# AFTER:
IF target.team != null AND self.teams non-empty AND target.team ∈ self.teams -> self, "team-match"
```

Behaviour summary: for a legacy single-team config, `self.teams` is `[team_key]`, so `target.team ∈ self.teams` is exactly `target.team == self.team`; every golden row stays byte-identical. For a multi-team config, a target in any configured team reads as self. Null handling is unchanged: the unresolved-self and unresolved-target rungs fire first, and membership requires a non-null target team and a non-empty self set. The strict-string, case-sensitive comparison is preserved (case-mismatch still fails toward not-self, the safe direction).

**Anti-pattern:** Replacing the strict `===` with a case-insensitive or trimmed-per-element membership test. Why: it changes the legacy single-team semantics and breaks the byte-identical golden table; keep element comparison strict and identical to today's `===`.

**Read fan-out (prose).** Where a read skill scopes by team, it iterates the resolved team-set and unions the results, honouring "always pull fresh" per team.

```
PROCEDURE fetch_active_across_teams(resolved):
  1. issues := []
  2. FOR team IN resolved.teams:
     a. pull the active backlog for team live (never cached) per the Always-pull-fresh rule
     b. issues := issues ++ results
  3. RETURN issues   # one union graph, blocker links intact across team boundaries
```

- faff-wtf/SKILL.md:47 changes from "Query using ... `tracking.team_key`" to "query across every team in the resolved team-set (`tracking.teams`, legacy `tracking.team_key` as a one-team set) in one pass".
- faff-tidy/SKILL.md:36 changes "every active issue in the team / project" to "every active issue across every configured team", keeping tidy's always-pull-fresh emphasis per team.

**Cross-team blocker traversal (input-only change).** Cycle and stale-blocker detection is prose the `methodology` slot's `backlog-diagnostics` named-output runs in-context (Tarjan / DFS-with-colouring described at faff-map/SKILL.md and faffter-noon-methodology-thematic/SKILL.md); there is no bin/lib graph helper and the methodology lens has zero team references. So cross-team edges need no change to detection: once the Phase-1 fetch unions issues across the team-set into one graph, a blocker link from a PRODUCT issue to an IDEAS spike is already one edge in that graph. The only change is that the fetch feeding the graph now spans the set.

**Anti-pattern:** Adding a per-team subgraph then stitching subgraphs. Why: it recreates the "two disconnected views" the ticket rejects; build one union graph and let the existing traversal cross the boundary.

**Create routing (prose, authored from scratch).** No documented step today resolves which team a `save_issue` targets, so routing is a pure addition, single-sourced in faff-jot and referenced from faff-plot.

```
PROCEDURE route_create_target(ticket_type, resolved):
  1. IF resolved.routing has key matching ticket_type -> RETURN resolved.routing[ticket_type]
  2. ELSE RETURN resolved.default_team

# ticket_type is the type the create lane already determines (create.md:41-45):
#   methodology ticket-shaping type if in-taxonomy, else keyword inference, else `default`.
# Matching is by the raw type token; an unmatched token (including a type with no routing
# entry) falls through to default_team. A routing key that is not a taxonomy member is
# harmless: it just never matches.
```

- faff-jot/SKILL.md gains a create-target step: after type determination and before `save_issue`, resolve the target team via `route_create_target`. jot's existing dup-detection re-query (list_issues filtered by team + title-match, faff-jot:93,97) fans across the resolved team-set for the same reason reads do.
- faff-plot/SKILL.md reuses this by reference (it already reuses jot's create discipline); no duplicated routing prose.

**Failure modes.**

- **The failure:** the legacy shim perturbs the single-team self-intake path (for example, `resolveTeams` trims or lower-cases where `deriveSelfFromConfig` did not). **How you'd know:** test/self-intake.test.mjs golden rows change. **What it means:** abandon the perturbing normalisation; the shim must reproduce the exact `clean()` semantics (trim-then-empty-to-null) already in `deriveSelfFromConfig`.
- **The failure:** a structured key silently reads back as a string because it was written inline-flow with bare identifiers. **How you'd know:** `config get --json tracking.teams` returns a string, not an array; `resolveTeams` step 2's array check fails and falls through to legacy or zero-config. **What it means:** the block-form mandate and the `config check` "teams is empty / not a list" error must catch it loudly rather than degrading silently.
- **The failure:** membership validation passes at write time but a later hand-edit removes a team that `default_team` or a `team_routing` value points at. **How you'd know:** `faff config check` errors on the dangling reference. **What it means:** proceed; `config check` is the guard, and it must be run (it is the DoD's validation anchor).

## 5. Scenarios

```
Given a legacy config with only `tracking.team_key: PRODUCT` and no `tracking.teams`
When resolveTeams runs
Then it returns teams == ["PRODUCT"], default_team == "PRODUCT", routing == {}
And every row of the self-intake golden table is byte-identical to today
```

```
Given `tracking.teams: [IDEAS, PRODUCT, RISKS]` (block form) with `default_team: PRODUCT`
When a read skill fetches the active backlog
Then it pulls each of IDEAS, PRODUCT and RISKS live in one pass
And a PRODUCT issue blocked by an IDEAS issue appears as a single blocker chain in the graph
```

```
Given `team_routing: { spike: IDEAS, bug: PRODUCT }` and default_team PRODUCT
When jot creates a ticket whose determined type is `spike`
Then the new issue is filed into IDEAS
When jot creates a ticket whose determined type is `chore` (no routing entry)
Then the new issue is filed into PRODUCT (default_team)
```

```
Given `default_team: STAGING` where STAGING is not a member of tracking.teams
When `faff config check` runs
Then it exits non-zero naming default_team, its value, and the member set
```

```
Given `team_routing: { feature: IDEAS }` where IDEAS is not a member of tracking.teams
When `faff config check` runs
Then it exits non-zero naming team_routing['feature'], the value IDEAS, and the member set
```

- The resolved team-set always has at least one element for any non-zero-config repo (legacy or team-set), so no consumer must special-case an empty set beyond the existing zero-config path.

## 6. Design Decision Rationale

**How is the team-set expressed, and what happens to `team_key`?**
Options: (a) `teams` set + `default_team` + optional `team_routing`, with `team_key` as a legacy one-element shim; (b) a repeatable `team_key`; (c) keep single `team_key` and push multiplicity to callers. Option (b) has no parser support and no precedent; (c) defeats the ticket. Option (a) matches the ticket's proposed shape and the existing config idioms.
**Chosen:** `teams` + `default_team` + optional `team_routing`, with legacy `team_key` resolving to `[team_key]` via `resolveTeams`. Rationale: it is the ticket's shape, preserves back-compat as a pure shim, and gives every consumer one resolved record.

**Which YAML form is mandated for `teams` and `team_routing`?**
Options: (a) block-sequence and nested-map form; (b) JSON-quoted inline flow (`teams: ["IDEAS","PRODUCT"]`); (c) extend the parser for bare inline flow. The ticket's literal `[IDEAS, PRODUCT, RISKS]` is not valid JSON and reads back as a string (`scalar()` uses `JSON.parse`). Block form parses today via `parseSeq`/`parseMap` (FAFF-262). FAFF-262 scoped full inline-flow YAML out as low-payoff, so (c) is a rejected, larger change.
**Chosen:** mandate block-sequence and nested-map form; document that inline flow needs double quotes if used at all, and that structured `get` requires `--json`. Rationale: block form is already supported, needs no parser change, and reads unambiguously; the ticket's bare-identifier inline example is corrected here rather than carried forward.

**How are `teams` and `team_routing` written?**
Options: (a) teach the writer to serialise sequences/maps; (b) refuse them via the `SEQUENCE_VALUED_KEYS` seam and hand-edit the committed base (the `adversarial.refs` precedent, FAFF-667). Option (a) breaks the scalar-only writer invariant held since FAFF-667.
**Chosen:** add `tracking.teams` and `tracking.team_routing` to `SEQUENCE_VALUED_KEYS` so `config set` refuses them by name with the existing message and they are hand-edited; add scalar `tracking.default_team` to `TRACKING_KEYS` so it is writable. Rationale: preserves the writer invariant, reuses a proven refusal seam, and keeps the one scalar key ergonomic.

**What exactly is validated, and are routing keys constrained to the taxonomy?**
Options: (a) validate values only (default_team and every team_routing value must be members of teams), keys free-form; (b) also constrain routing keys to the type taxonomy. Constraining keys couples config validation to a closed taxonomy and forces the `risk` question to block this issue.
**Chosen:** validate default_team and every team_routing value as members of teams, fail-loud in `faff config check`; leave routing keys free-form type tokens that simply never match if unknown. Rationale: matches the ticket's acceptance wording ("value must be a member"), and decouples the feature from the `risk`-taxonomy decision.

**How does self-intake generalise without weakening the FAFF-539 floor?**
Options: (a) change the equality rung to set-membership over the resolved teams; (b) keep single-team equality and add a separate multi-team path. Option (b) duplicates the floor and risks divergence.
**Chosen:** `decideSelfIntake`'s team rung becomes `target.team ∈ self.teams`, with strict element comparison identical to today's `===`; legacy `self.teams == [team_key]` makes it exactly the old equality. Rationale: one code path, byte-identical legacy semantics, floor preserved because membership over a one-element set is the old test.

**Where do reads fan out?**
**Chosen:** in prose at faff-wtf/SKILL.md:47 and faff-tidy/SKILL.md:36, iterating the resolved team-set and unioning results, always-pull-fresh per team. Rationale: reads are agent prose driven by `faff config get`; there is no CLI list_issues-by-team path to change.

**Does cross-team traversal need new detection logic?**
**Chosen:** no; only the Phase-1 fetch input widens to the union graph. Rationale: cycle/stale-blocker detection is team-agnostic in-context prose over the already-pulled graph, so a cross-team edge is already one edge once both endpoints are in the graph.

**Where is create routing authored?**
**Chosen:** single-source the `route_create_target` prose in faff-jot/SKILL.md and reference it from faff-plot; route by `team_routing[type]` then `default_team`. Rationale: no create-target resolution exists today, and jot is the create-discipline home plot already defers to.

**Does multi-project get the same treatment now?**
Options: (a) generalise `project_id` to a set in this issue; (b) defer as a separate slice. `project_id` is documented-but-unimplemented (no `.js` reads it; `config init` exits 2 on it), so there is no single-project behaviour to preserve and it is orthogonal to teams.
**Chosen:** defer; `tracking.project_id` stays singular and out of scope, with the extension point noted. Rationale: generalising an unimplemented key adds risk without payoff and belongs in its own issue.

**Cell grouping (repo to cells to teams).**
Whether a repo is one flat team-set, several cells each spanning a team-set, or one cell per repo is a product/architecture call about the working-surface model; the facts do not decide it, and a cell dimension would add a config layer above `teams`.
**Chosen:** a flat validated team-set (`teams` list + `default_team` + optional `team_routing`) for v1; no 'cell' dimension above teams, which stays a named extension point added only if a repo needs org-level grouping. Rationale: the flat set already delivers the cross-team blocker graph the ticket asks for, and no repo has yet shown a need for org-level grouping, so the cell dimension is deferred to a clean additive config layer above `teams` rather than built speculatively.

**Add `risk` to the type taxonomy, or route risks another way?**
Adding `risk` to the closed taxonomy (bug/feature/spike/chore/epic) is a product decision with taxonomy-wide effects. Routing does not need it: `team_routing` keys are free-form, so a `risk: RISKS` entry is valid config and simply never fires until `risk` is a determined type.
**Chosen:** route risk work via free-form `team_routing` keys / labels, not a new member of the fixed work-type taxonomy; the type taxonomy stays stable. Rationale: routing keys are already free-form tokens, so a `risk: RISKS` entry is valid config today, and keeping `risk` out of the closed taxonomy avoids taxonomy-wide effects for what is a routing concern.

**Should faff-onboard detect and offer a team-set?**
Whether onboarding should detect and propose a team-set, or stay single-team with multi-team as a manual step, is a product/UX call about the first-run experience.
**Chosen:** onboard keeps writing a single team, byte-identical to today; a repo opts into a team-set by hand-editing `.faffrc`, with no tracker auto-detection in v1 (a named extension point). Rationale: single-team onboarding stays unchanged and low-risk, and a hand-edited team-set is consistent with the config-write seam that already routes `teams`/`team_routing` through hand-edits.

## 7. Open Questions and Assumptions

**Resolved decisions (were open; ratified in the recommended direction; see Design Decision Rationale).**

- **Cell grouping.** Resolved: v1 is a flat validated team-set; no cell dimension above `teams`, which is a named extension point added only if a repo needs org-level grouping. (was: decides architecture)
- **`risk` as a work type.** Resolved: route risk work via free-form `team_routing` keys / labels; the fixed work-type taxonomy stays stable. (was: decides product)
- **Onboarding UX.** Resolved: onboarding keeps writing a single team, byte-identical to today; a team-set is a hand-edited `.faffrc` opt-in with no tracker auto-detection in v1 (a named extension point). (was: decides product)

**Assumptions.**

- **The shared parser reads block sequences and nested maps.** Validation: confirmed against shared-infra.js (`parseSeq`, `parseMap`, FAFF-262); the build agent should re-run the config round-trip tests to confirm block-form `teams`/`team_routing` read back as an array/map.
- **`backlog-diagnostics` runs on the already-pulled active-issue graph and is team-agnostic.** Validation: confirmed the methodology lens has no team references; the build agent should verify that widening the fetch is the only input change (no team filter inside the traversal prose).
- **No CLI code filters `list_issues` by team.** Validation: confirmed no bin/lib call filters by team; the build agent should grep the create/read paths for `team` before assuming a code seam exists.

## 8. DONE — Definition of Done

### From WHY
- [ ] A legacy `tracking.team_key`-only config resolves to a one-element team-set and behaves byte-identically to today (test/self-intake.test.mjs golden table unchanged).
- [ ] The self-intake containment floor (FAFF-539) is preserved: a foreign team does not read as self, and self-hosting is not broken.

### From WHAT (schema and validation)
- [ ] `tracking.default_team` is in `TRACKING_KEYS` and is writable via `config init --set` / `config set` (test/config-set.test.mjs, test/config-defaults.test.mjs, following the `label_prefix` pattern); no `DEFAULTS` registry default is added, matching `team_key`.
- [ ] `tracking.teams` and `tracking.team_routing` are in `SEQUENCE_VALUED_KEYS`; `config set` on either exits non-zero with the "list-valued key, hand-edit the committed base" message (test/config-set.test.mjs, mirroring the `adversarial.refs` case).
- [ ] `faff config check` errors when `teams` is empty, when `default_team` is absent-with-teams or not a member of `teams`, or when any `team_routing` value is not a member of `teams`, each error naming the offending key/value and the member set.
- [ ] `resolveTeams` returns `{ teams, default_team, routing }` per the resolution table for team-set, legacy, and zero-config inputs.

### From HOW (behaviour)
- [ ] `decideSelfIntake`'s team rung is set-membership (`target.team ∈ self.teams`) with strict element comparison; the legacy one-element case equals the old `===` (test/self-intake.test.mjs).
- [ ] `deriveSelfFromConfig` derives `teams` via `resolveTeams` with the same trim-then-empty-to-null cleaning it uses today.
- [ ] faff-wtf/SKILL.md:47 and faff-tidy/SKILL.md:36 fan reads across the resolved team-set, always-pull-fresh per team.
- [ ] Cross-team blocker traversal renders a PRODUCT-to-IDEAS blocker as one chain, with no change to detection prose beyond the widened Phase-1 fetch.
- [ ] faff-jot/SKILL.md resolves the create-target team via `route_create_target` (routing by type, else default_team); faff-plot references it without duplicating the prose; jot's dup-detection re-query fans across the team-set.

### From HOW (edge cases)
- [ ] An inline-flow `teams` value with bare identifiers is rejected loudly by `config check` (empty/not-a-list) rather than degrading to a silent string read.
- [ ] `config get --json tracking.teams` / `tracking.team_routing` return structured values; the docs note plain `get` yields `[object Object]` for the map.
- [ ] A `team_routing` key with no matching determined type never routes and falls through to `default_team` (no error).

### Integration smoke test
```
GIVEN a .faffrc.yaml with block-form tracking.teams [IDEAS, PRODUCT], default_team PRODUCT,
      and team_routing { spike: IDEAS }
1. `faff config check` exits 0
2. resolveTeams returns teams == [IDEAS, PRODUCT], default_team == PRODUCT, routing == { spike: IDEAS }
3. `faff config set tracking.teams X` exits non-zero (list-valued refusal)
4. deriveSelfFromConfig yields self.teams == [IDEAS, PRODUCT]; a target in IDEAS decides self, a target in a
   third team decides not-self
5. route_create_target("spike", resolved) == IDEAS; route_create_target("chore", resolved) == PRODUCT
IF these hold, the config, validation, self-intake shim, and routing plumbing are connected.
```

confidence: high
spec-review: approve
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery**

Lens: agile-delivery `issue-critique` for FAFF-1080, "Support a functional team-set per repo, with cross-team blockers first-class". Appetite: surface-only (read-only, no tracker writes). Four axes below.

### Right-sized? (principle 4) — split candidate

**What's there.** The spec scopes one code seam (config schema, `resolveTeams`, `validateTeams`, the `decideSelfIntake` membership shim) plus three prose seams. Two of those prose seams answer distinct outcomes on either side of the read/write line: reading across the set (fan-out in faff-wtf/faff-tidy, cross-team blocker traversal in map/wtf value-chains and tidy diagnostics, the self-intake membership rung) delivers "faff sees one graph over many teams"; create routing (`team_routing`, `route_create_target` in faff-jot referenced by faff-plot) delivers a separate outcome, "file a new ticket into the team matching its kind".

**Why it's worth flagging.** These two are independent above the shared config foundation. Read fan-out and cross-team traversal need nothing from routing; routing needs nothing from the read path. Both sit on `resolveTeams`, but neither depends on the other, so bundling them ties the headline outcome the ticket names (cross-team blockers first-class) to a second outcome it does not (routing creates by kind). The routing half also carries the loosest end of the design: `team_routing` keys are free-form type tokens, and the deferred `risk` taxonomy question lives entirely on that side. If routing needs a rethink under review, it drags the shipped read-path value with it.

**What to do.** Consider splitting along the read/write seam: ticket A = config foundation (`teams`/`default_team`/`resolveTeams`/`validateTeams`) + read fan-out + cross-team traversal + the self-intake membership shim; ticket B = create routing (`team_routing` + `route_create_target`), blocked by A. Ticket A keeps the ticket's headline outcome whole and remains a coherent 2-to-3-day unit; ticket B ships routing on the settled foundation and can absorb the `risk`-taxonomy decision without holding up cross-team visibility. If the intent is genuinely to ship both together as one increment, keep it whole but say so explicitly in the spec's scope statement, since the current framing ("one code seam and three prose seams") reads as an assembly of separable parts rather than one indivisible unit.

### Workstream fit? (principles 1 + 5)

**No issues.** The issue is outcome-named (a capability the repo gains, not an activity bucket), and it is cohesively bounded to a single dimension: the scope statement pins it to "the multiplicity upgrade of the team dimension only", and the OUT OF SCOPE section severs the adjacent dimensions (multi-project, the `risk` type, the config-writer serialisation, a cell layer, onboarding UX) with a stated reason and extension point for each. The read/write facets flagged under right-sizing are two faces of the one team-set outcome, so cohesion holds even if the unit is large. (Parent-workstream grouping was not supplied, so this axis judges the issue's internal cohesion only, not its placement in a project.)

### Deps surfaced? (principle 6)

**No issues.** Every dependency the spec leans on is shipped precedent (FAFF-1044 scalar-key-add, FAFF-768/1048 config-resolve extension, FAFF-5/531/667 the writer and sequence-value refusal, FAFF-794/965 config-check validation, FAFF-539 the same-team gate, FAFF-262 the block-form parser), so none needs a live blocker link. The three Punts (cell grouping, `risk` as a type, onboarding UX) are human decisions the spec argues are severable rather than load-bearing prerequisites: routing keys stay free-form so `risk` need not exist, the flat team-set is assumed so no cell layer is required, and multi-team stays a manual hand-edit so onboarding is untouched. No implicit dependency is left unlinked. If the split above is taken, ticket B would carry an explicit `blockedBy` edge to ticket A, which is the one new link the current single-ticket shape does not need.

### Risk profile? (principle 7) — no de-risking spike warranted

**What's there.** The spec names its own highest-risk site: `decideSelfIntake` generalising the FAFF-539 containment floor from strict single-team equality to set-membership. Getting it wrong either lets a foreign team read as self (weakening the autonomous-filing floor) or breaks self-hosting.

**Why a spike is not the answer.** This is not novel-integration or external-dependency risk. There is no new integration surface and no external team in the chain. The risk is a semantic-equivalence question on an existing code path, and it is already instrumented: the golden self-intake table (test/self-intake.test.mjs) is the byte-identical regression anchor, and the spec proves the legacy path reduces to the old `===` (membership over a one-element set). The one genuine empirical unknown, that block-form `teams`/`team_routing` reads back as an array/map through `parseSeq`/`parseMap`, is a config round-trip test, not a spike.

**What to do.** Proceed without a separate de-risking ticket; the de-risking is correctly folded into the DoD (golden table unchanged, plus the integration smoke test). Keep the self-intake change first in the build order so the highest-risk edit lands against the golden anchor early rather than at the end, which is the risk-aware sequencing this principle asks for.