# Spec: known-key (schema) lint for `faff config check` — FAFF-794

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high · build-tier: complex.

This is the build spec for FAFF-794, a low-priority bug. Audience: the build agent implementing the fix, and the human reviewer of the PR. It adds a warn-level known-key lint to `faff config check` so a misspelled or flat-dotted config key stops being a silent no-op.

## 1. WHY — Problem and Principles

**Load-bearing model.** Every faff config read resolves through `faff config get`, and an unrecognised key returns nothing, so the consumer falls back to its built-in fail-safe default. That means a *typo* is indistinguishable from *unset*: the operator sets `autonymous.sentry_acting: true`, the reader never finds `autonomous.sentry_acting`, and the run proceeds on the default with no signal that the intent was dropped. `faff config check` is the one advisory surface positioned to catch this, and today it does not.

**Problem statement.** `faff config check` reports clean on an unknown, misspelled, or flat-dotted config key, so the setting silently resolves to its default (live 2026-08-13: an operator armed the unattended sentry via `autonymous.sentry_acting: true`; the kill-switch was a total no-op and nothing surfaced the typo). This change adds a lint that warns on unrecognised top-level keys and on flat-dotted keys that should have been nested maps. It warns rather than errors, so a genuinely-new key added ahead of the allowlist never breaks the check.

**Design principles.**

- **Warn, never error.** Forward-compat is the point: a key the allowlist doesn't yet know about must produce a non-fatal advisory, not a failing exit that blocks downstream advisory consumers. This governs the severity of every finding this lint emits.
- **One known-key source, already kept honest.** The lint must not introduce a second, drift-prone list of legal keys. It reuses the existing maintained allowlist, whose completeness is already gated in CI.
- **Read-only.** `faff config check` never mutates the operator's files. The lint diagnoses; it never auto-nests or auto-corrects.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` — `computeConfigCheck` | Node (no deps) | Pure core of `config check`; the new check lives here |
| `plugin/skills/faff/bin/lib/config.js` — `WRITABLE_NAMESPACES` | Node | Maintained top-level allowlist reused as the known-key set |
| `plugin/skills/faff/bin/lib/config.js` — `configCheckSelftest` | Node | In-memory `--selftest` harness; the test surface for this module |
| `plugin/skills/faff/bin/lib/config.js` — `scanDocForSecrets` | Node | Existing per-file walk that models file-attributed findings |
| `.faffrc.example.yaml` | YAML | Documented schema; CI drift-checks its top-level keys ⊆ the allowlist |

**Scope statement.** A localised addition to the existing `config check` posture linter — no new command, file, dependency, or config key.

## 2. OUT OF SCOPE

- **Nested-leaf / deep-key validation** — validating that `autonomous.sentry_acting` (correctly nested) is itself a recognised *leaf*. Why excluded: the live failure and the ticket's repro are top-level mistakes, and faff has no single centralised nested schema to validate against (`DEFAULTS` is only a partial dotted registry). Extension point: a future issue could add a deep-key lint keyed on a completed `DEFAULTS`/schema registry, in the same `computeConfigCheck` core.
- **A stricter opt-in error mode** — a config knob to promote unknown-key findings to errors. Why excluded: warn is the forward-compat contract and no consumer needs a hard fail for a low-priority hygiene lint. Extension point: a `gates`-style severity knob read in `computeConfigCheck`, if a real need appears.
- **Auto-nesting / auto-fix of flat-dotted keys** — rewriting `a.b: v` into a nested map. Why excluded: `config check` is read-only; silently rewriting an operator's file is riskier than warning. Extension point: a separate `faff config fix` writer command.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Known-key set | The set of recognised top-level config namespaces — reuses `WRITABLE_NAMESPACES` |
| Flat-dotted key | A top-level key whose literal name contains `.` (e.g. `autonymous.sentry_acting`), produced by writing an intended nested path on one line; unreachable by `dig` (split-on-`.`) so it resolves to the default |
| Unknown top-level key | A top-level key (no `.` in its name) that is not in the known-key set |

**Finding shape (unchanged, reused).** Each new finding is the existing `{ severity, surface, message }` record that `computeConfigCheck` already collects; all findings from this lint use `severity: "warn"`.

```
RECORD Finding:
  severity: "warn" | "error"   # this lint always emits "warn"
  surface: string              # "<file>:<key>" — the file the key lives in
  message: string              # human-readable diagnosis + remedy
```

**Known-key set completeness.** `install` is a legitimate top-level namespace (`install.skill_targets`, consumed by `gates.js`) but is absent from `WRITABLE_NAMESPACES` and `.faffrc.example.yaml`. A lint keyed on the allowlist would false-positive on it, so the fix adds `install` to `WRITABLE_NAMESPACES`.

**Design decision — known-key source.**

- Options: (a) reuse `WRITABLE_NAMESPACES`; (b) derive the set live from `.faffrc.example.yaml`; (c) build a new dedicated allowlist.
- (a) is already maintained (used by `config set`) and already CI-drift-checked against the documented example (`configSetSelftest`: example top-level keys ⊆ `WRITABLE_NAMESPACES`), so it is simultaneously a maintained allowlist *and* schema-anchored. (b) is narrower (the example omits real keys like `backends`, `autonomous`) and would false-positive. (c) reintroduces the drift the principle forbids.
- **Chosen:** reuse `WRITABLE_NAMESPACES` as the known-top-level-key set — one source, already kept honest by the existing drift check. Add `install` to it so the allowlist is complete for both `config set` and this lint.

**Design decision — severity.**

- **Chosen:** warn for every finding this lint emits (ticket-mandated forward-compat; matches the other advisory `config check` findings). A stricter error mode is out of scope.

**Design decision — flat-dotted handling.**

- **Chosen:** warn on a flat-dotted top-level key; never auto-nest. When the pre-dot prefix is a known namespace, the message states the operator likely meant a nested map under that namespace; when the prefix is unknown, the message states it is both a probable typo and a flat form.

**Design decision — validation depth.**

- **Chosen:** top-level keys only for v1. Nested-leaf validation is out of scope (no centralised nested schema; the live failure was top-level).

## 4. HOW — Behavior

**Approach.** Add one new check (call it Check 9) to `computeConfigCheck`, after the existing checks. It walks the *top-level keys* of the base document and the overlay document independently (mirroring `scanDocForSecrets`' per-file attribution, so the finding surface names the file the key lives in). The merged doc is not used here — an unknown key in either file is a distinct silent no-op and each should be surfaced against its own file.

**Behavior summary.** For each top-level key in a scanned document, classify it as flat-dotted, unknown, or known, and emit at most one warn finding per key.

**Key names only.** The lint inspects top-level key *names*; it never inspects their *values*. A top-level key's value type (map, scalar, sequence, null) is irrelevant here — value-shape validation (e.g. `slots` written as a string instead of a map) is out of scope (§2, nested-leaf/value validation). So the walk is `keys(doc)`, never a recursion into values, and a known key with a mis-typed value is simply not this lint's concern.

```
PROCEDURE known_key_lint(doc, fileLabel, knownSet):
  IF doc is not a plain map: RETURN []          # whole file empty/non-map -> nothing to walk
  findings = []
  FOR each topKey in keys(doc):                 # key NAMES only; values are never inspected
    IF topKey contains ".":                      # flat-dotted mistake (one or more dots)
       prefix = topKey up to the FIRST "."       # the namespace segment
       IF prefix in knownSet:
          warn: `<fileLabel>:<topKey>` — flat dotted key; you likely meant a
                nested map (the segments under `<prefix>:`). As written it is a
                single unreachable literal key and resolves to the default.
       ELSE:
          warn: `<fileLabel>:<topKey>` — flat dotted key with unrecognised
                namespace `<prefix>` (probable typo and flat form); nest it
                under a known namespace. Resolves to the default as written.
    ELSE IF topKey not in knownSet:              # plain unknown/misspelled key
       warn: `<fileLabel>:<topKey>` — unrecognised top-level key (probable typo);
             silently ignored, resolves to the default. Known namespaces: <sorted knownSet>.
    # ELSE: known + properly nested -> no finding
  RETURN findings
```

The message deliberately names the full flat key (`<topKey>`) and says "a nested map", not "a nested map under `<prefix>:` with value X" — so it reads correctly for a single-dot key (`autonomous.sentry_acting`) and a multi-dot key (`autonomous.guardrails.require_container`) alike. The prefix is used only for the known/unknown-namespace branch, never to reconstruct the intended nesting depth.

- Call it once per present document: `known_key_lint(baseDoc, rel(basePath) || ".faffrc.yaml", knownSet)` and `known_key_lint(overlayDoc, rel(overlayPath) || ".faffrc.local.yaml", knownSet)`, pushing results into `findings`. Guard each on the doc being present, exactly as the secret scan does.
- `knownSet` is `WRITABLE_NAMESPACES` (the module-level Set, now including `install`).

**Edge cases.**

- **A key that is both misspelled and flat-dotted** (the live repro `autonymous.sentry_acting`) — the `.`-in-name branch fires first, so it produces exactly one finding (the unknown-prefix flat-dotted message), never two.
- **Scalar top-level keys** (`appetite`, `logging`) — they are in the known set, so no finding; a misspelled scalar (`appetitte`) has no `.` and is not in the set → unknown-key warn.
- **Multi-dot flat key** (`autonomous.guardrails.require_container: true`) — treated identically to a single-dot key: one literal top-level key whose name contains `.`, so the dot-branch fires once, the prefix is the pre-first-dot segment (`autonomous`), and the message names the full flat key and advises a nested map. Exactly one finding, no attempt to reconstruct the two-level nest.
- **A top-level key whose value is a scalar/sequence, not a map** (e.g. `slots: some-string`) — irrelevant to this lint: only the key *name* (`slots`, a known namespace) is tested, so no finding. Value-type validation is out of scope.
- **No base and/or no overlay** — each call is guarded on doc presence; absent files contribute nothing (all-defaults stays clean).
- **Malformed base** — `baseDoc` is null on a parse error (already handled by Check 1b), so the lint simply skips it; no double-reporting.
- **Ordering** — findings append after the existing checks; exit stays `findings.length ? 1 : 0`, so a config with only known-key warnings now exits 1 instead of 0. This is **not** a new exit-code regime: `config check`'s documented contract is already "exit 0 clean / 1 ≥1 finding / 2 unreadable", and every existing warn-level finding (an un-ignored `.faffrc.local.yaml`, a possible-secret, the opt-out-inert warn) already yields exit 1 today. "Advisory" is a property of the *consumer* — the gateway install-health preamble surfaces `config check` findings and never stops the run on them (gateway: "a config finding is never a run-stopper") — not a claim that the command exits 0 on warnings. The new warn finding behaves identically to every existing warn finding, so no downstream consumer contract changes.

**Anti-pattern:** treating "exit 1 on a warn finding" as new or as a break of the advisory contract. Why: the exit-1-on-any-finding contract predates this change and the gateway consumer already treats findings advisorily regardless of exit code; a consumer that hard-fails on `config check` exit 1 was already doing so on today's warn findings.

**Failure modes.**

- **The failure:** the allowlist is incomplete, so the lint warns on a genuinely-legal key. **How you'd know:** an operator reports a warn on a key that is documented and consumed (exactly the `install` gap found during prep). **What it means:** proceed — warn-not-error makes this non-breaking, the CI drift check keeps `WRITABLE_NAMESPACES ⊇ example`, and the remedy is a one-line allowlist addition (as done here for `install`).
- **The failure:** a false negative — a misspelled key that happens to collide with a known namespace name (e.g. a stray top-level `budget: 5` where a map was meant). **How you'd know:** the mis-shaped value silently resolves to default despite a "known" name. **What it means:** accept for v1 — value-shape validation per key is nested-schema territory, explicitly out of scope.

**Anti-pattern:** deriving the known set from `.faffrc.example.yaml` at runtime. Why: the example omits real keys, so the lint would warn on legitimate config; the maintained allowlist already subsumes the example via the drift check.

**Anti-pattern:** auto-nesting a flat-dotted key. Why: `config check` is read-only; silently rewriting the operator's file exceeds its contract and can corrupt intent.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a base .faffrc.yaml containing the flat-dotted, misspelled line `autonymous.sentry_acting: true`
When `faff config check` runs
Then a warn finding names `autonymous.sentry_acting` as a flat-dotted / unrecognised key and the command exits 1
```

```
Given a base .faffrc.yaml containing the flat-dotted but correctly-spelled line `autonymous.sentry_acting: true`
When `faff config check` runs
Then a warn finding states the key should be a nested map under `autonomous:`
```

```
Given a fully valid config (only known namespaces, all properly nested) — e.g. this repo's own .faffrc.yaml
When `faff config check` runs
Then the known-key lint contributes no findings
```

```
Given a base .faffrc.yaml containing a multi-dot flat key `autonymous.guardrails.require_container: true`
When `faff config check` runs
Then exactly one warn finding names the full key `autonomous.guardrails.require_container` and advises a nested map
```

- The known-key lint never emits a finding with `severity: "error"`.
- An unknown key present only in `.faffrc.local.yaml` produces a finding whose surface names the overlay file, not the base.
- A known top-level key whose value is a scalar/sequence rather than a map (e.g. `slots: x`) produces no known-key finding (key-name-only; value-shape is out of scope).

## 6. DESIGN DECISION RATIONALE

**Which known-key source?** Options: reuse `WRITABLE_NAMESPACES`, derive from the example schema, or a new list. `WRITABLE_NAMESPACES` is maintained (drives `config set`'s typo guard) and CI-drift-checked against `.faffrc.example.yaml`, so it is both allowlist and schema-anchored with no new drift surface. **Chosen:** reuse `WRITABLE_NAMESPACES`, completed with `install`.

**Warn or error?** Error would break `config check` for any legitimately-new key added before the allowlist catches up — the exact forward-compat hazard. **Chosen:** warn only.

**Warn or auto-nest flat-dotted keys?** Auto-nest writes to the operator's file, violating the read-only contract. **Chosen:** warn, with a nested-map hint when the prefix is a known namespace.

**Top-level or nested validation?** Nested validation needs a centralised schema faff lacks and the live bug was top-level. **Chosen:** top-level only for v1; nested is a named extension point.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the ticket's two open questions are resolved above (warn-only; known set = `WRITABLE_NAMESPACES`).

**Assumptions.**

- **Assumes:** `WRITABLE_NAMESPACES` remains the canonical top-level allowlist and stays CI-drift-checked against `.faffrc.example.yaml`. Validation: confirm `configSetSelftest`'s `namespace-drift` assertion is still present before building.
- **Assumes:** `install.skill_targets` is a live, legitimate config key. Validation: `grep -n "install.skill_targets" plugin/skills/faff/bin/lib/gates.js` returns the `dig(data, "install.skill_targets")` read.

## 8. DONE — Definition of Done

### From WHY
- [ ] Running `faff config check` on a config whose only fault is a misspelled/flat-dotted key now reports a warn finding for that key (previously clean).

### From WHAT (types and known-key set)
- [ ] All findings emitted by the new lint have `severity: "warn"` (never `"error"`).
- [ ] `install` is a member of `WRITABLE_NAMESPACES`, and `configSetSelftest`'s `namespace-drift` assertion still passes.

### From HOW (behaviour)
- [ ] `computeConfigCheck` walks the top-level keys of `baseDoc` and `overlayDoc` independently; a finding's `surface` names the file the offending key lives in.
- [ ] A top-level key whose name contains `.` yields exactly one warn finding: a nested-map hint when the pre-dot prefix is a known namespace, and a probable-typo-and-flat message when it is not.
- [ ] A top-level key with no `.` that is not in `WRITABLE_NAMESPACES` yields a warn finding naming it and listing the known namespaces.
- [ ] A known, properly-nested top-level key yields no finding; this repo's own `.faffrc.yaml` produces zero known-key findings.
- [ ] A known top-level key with a scalar/sequence value (e.g. `slots: x`) yields no known-key finding (key-name-only).
- [ ] A multi-dot flat key yields exactly one finding naming the full key and advising a nested map.
- [ ] `config check` exit stays `findings.length ? 1 : 0` (a known-key warning alone now yields exit 1) — the pre-existing documented contract (exit 0 clean / 1 ≥1 finding / 2 unreadable), unchanged; the new warn finding behaves identically to existing warn findings and alters no consumer contract.

### From HOW (edge cases)
- [ ] The live repro `autonymous.sentry_acting: true` produces exactly one finding, not two.
- [ ] Absent base and/or overlay contribute no findings (all-defaults stays clean); a null `baseDoc` from a malformed base is skipped without error.

### Tests (born-verifiable)
- [ ] `configCheckSelftest` gains rows covering: flat-dotted unknown-prefix key, flat-dotted known-prefix key, plain unknown key, overlay-file attribution, and a clean config producing no known-key findings — and `faff config check --selftest` exits 0.

**Integration smoke test.**

```
1. Write a temp .faffrc.yaml containing `autonymous.sentry_acting: true`
2. Run `faff config check` against that root
3. Assert stdout contains a `warn` line naming `autonymous.sentry_acting` and the process exits 1
```

## Methodology critique

Lens: faffter-dark-methodology-agile-delivery.

- **Right-sized (principle 4).** No issues. One concern — a warn-level known-key lint added to a single pure function plus its selftest rows. A coherent 1-3 day unit with no independent second concern to split out.
- **Workstream fit (principles 1 + 5).** No issues. A standalone config-hygiene bug; it belongs project-less in Backlog until sequenced, which is the correct default for captured bug work.
- **Deps surfaced (principle 6).** No issues. The ticket is `blockedBy` nothing, and the two things the spec leans on — `WRITABLE_NAMESPACES` and its CI drift check — already shipped, so there is no implicit prerequisite to link. The `relatedTo` links (FAFF-50, FAFF-387) are context, not blockers.
- **Risk profile (principle 7).** No issues. Low risk: no novel integration, no external dependency, and the warn-only contract makes a mis-sized allowlist non-breaking, so no de-risking spike is warranted.

confidence: high

---

_Spec attached by autonomous prep (run run-20260816-085541-beepboop-list-42bdab). See the follow-up park comment: the spec-review gate did not converge (a churn park), so this ticket is parked for human review rather than auto-promoted — the spec itself is complete and high-confidence._
