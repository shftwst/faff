# FAFF-1133 — `verification resolve` conflates the `sentry_acting` abort kill-switch with unattendedness, forcing the holdout on interactive grafts

This is the buildable spec for FAFF-1133 (bug). Audience: the build agent that will land the fix, and the human reviewers who gate it. It is written to be built from this document alone.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff carries two *independent* attendedness questions that happen to share config keys. One is the **abort axis**: "does Sentry's abort act on this run?" — the legitimate home of the legacy `autonomous.sentry_acting` kill-switch. The other is the **verification/holdout axis**: "is this run unattended, so the code-blind holdout must RUN?" The bug is that the second axis reads the first axis's kill-switch as if it answered the second question, at *any* run level. It does not. `sentry_acting` should govern only whether Sentry's abort acts — never whether verification or the holdout treats a run as unattended.

**Problem statement.** `faff verification resolve` reports `{"attended":false,"unattended":true}` on a genuinely attended interactive L1/L2 run whenever `autonomous.sentry_acting: true` (or `autonomous.unattended: true`) is set, because both call sites OR the whole declared-unattended config signal in with no level gate. That forces graft Step 8c's code-blind holdout RUN even on changes with no runnable surface (surfaced building FAFF-1106, a prose-only skill change). This change gates the config-declared-unattended signal on the verification axis to automated runs only, so interactive L1/L2 runs are attended by construction.

**Design principles.**

**One attendedness model, computed the same way everywhere.** The merge floor already answers the identical question correctly at `resolveIntegrity` (`merge-gate.js:536`): `level === "L4" || (level === "L3" && declaredUnattendedFromConfig(cfg))`. The verification axis MUST mirror that shape, not invent a second interpretation. An implementation that fixes the symptom but leaves the two axes computing attendedness differently is rejected.

**The abort axis stays byte-unchanged.** `sentry_acting` is a shipped, documented, tested kill-switch for Sentry's *abort*. This fix touches the verification axis only. Any diff that alters `sentryActingFromConfig`, `declaredUnattendedFromConfig`, `actsOnSentryAbort`, `actsOnSentryPause`, or their abort-axis callers is rejected — those are pinned byte-unchanged by FAFF-717/765/766/798.

**Fix at the source field, not the consumer prose.** `verif.unattended` is a straight pass-through of the `unattended` field `faff verification resolve` emits. Correcting that field at its source corrects graft's holdout trigger for free. No `SKILL.md` prose edit is part of this fix.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` (`resolveInteractiveVerification` ~843-852, `cmdVerification` ~869-910, `verificationSelftest` ~912-966) | JavaScript | The bug locus — both verification call sites and their in-process selftest. |
| `plugin/skills/faff/bin/lib/merge-gate.js` (`resolveIntegrity` :536, selftest :1990-2025) | JavaScript | The working precedent whose L3-gated attendedness this change mirrors. |
| `plugin/skills/faff/bin/lib/sentry.js` (`declaredUnattendedFromConfig` :251-253, `actsOnSentryAbort` :278-280) | JavaScript | The abort-axis resolvers — read unchanged, never edited. |
| `test/verification-resolve.test.mjs` | JavaScript (node:test, child-process CLI) | The CLI truth-table tests; the two L2 acting-invariant cases pin the bug and must be re-pointed. |
| `test/sentry.test.mjs` (:1654-1794) | JavaScript | Abort-axis resolver truth tables — must stay green (proves abort axis untouched). |
| `plugin/skills/faff-graft/SKILL.md` (Step 8c `holdout_run` :428-436) | Prose (pseudocode) | The downstream consumer of `verif.unattended` — read-only confirmation, not edited. |

**Scope statement.** This sits on the verification/holdout attendedness axis inside the faff CLI's config resolver — the seam graft, spec-review, and adversarial code-review all consult via `faff verification resolve`.

## 2. OUT OF SCOPE

- **The abort axis** — whether `sentry_acting`/`autonomous.unattended` arm Sentry's abort/pause. Why excluded: it is the legitimate, correct use of the alias and is pinned byte-unchanged. Extension point: none needed — `sentry.js` `actsOnSentryAbort` stays as-is.

- **Legacy inline holdout-dispatch preflight gap** — on the legacy inline holdout-dispatch branch (not the spawner branch), no `faff evaluator-preflight` `holds` check runs, so a non-code-blind evaluation is not structurally refused. Why excluded: `evaluatorPreflight` (`plugin/skills/faff/bin/lib/evaluator-preflight.js:55-93`, in-container + repo-absent checks) is orthogonal to attendedness; FAFF-1133 removes the *unwanted RUN*, it does not add a preflight refuse to the legacy inline path. Extension point: a complementary follow-up ticket adding the `holds` preflight to the legacy inline dispatch branch. Named here as a follow-up, not carried by this ticket, and not a Punt for this ticket.

- **Retiring the `sentry_acting` alias entirely** — the eventual deprecation-window slice that removes the back-compat alias reader (`sentry.js:236-238`), already flagged as a standing Open Question in that file's comment. Why excluded: retirement is a separate deprecation slice with its own operator-migration window; this ticket only stops the alias leaking onto the wrong axis. Extension point: the future deprecation slice on `sentryActingFromConfig`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Abort axis | "Does Sentry's abort/pause act on this run?" — the kill-switch question `sentry_acting` legitimately answers. |
| Verification axis | "Is this run unattended, so the interactive verification legs zero out and the code-blind holdout must RUN?" — the axis this bug corrupts. |
| Declared-unattended config | `declaredUnattendedFromConfig(cfg)` — `autonomous.unattended` (canonical, FAFF-765) OR the `autonomous.sentry_acting` alias. A positive assertion on either. |
| Interactive run | An L1/L2 run — a human is driving the graft. Attended by construction. |
| Automated run | An L3 run (advisory, may be declared unattended) or an L4-minted run (always unattended). |

**The corrected resolver shape.** Both verification call sites currently inline the same faulty disjunct. This change replaces both with one shared helper so the two surfaces cannot drift — the same single-resolver discipline `sentry.js` applies to the abort axis via `actsOnSentryAbort`.

```
FUNCTION verificationUnattended(ledger, cfg) -> Bool:   # the verification-axis attendedness resolver
  # L4 mint is always unattended and short-circuits BEFORE any config read (lazy OR).
  # Below L4, ONLY an automated L3 run consults declared-unattended config.
  # An interactive L1/L2 run — and a no-ledger call — is attended by construction: config is never read.
  RETURN (ledger AND ledger.level == "L4")
      OR (ledger AND ledger.level == "L3" AND declaredUnattendedFromConfig(cfg))
```

The emitted `faff verification resolve --json` shape is unchanged — same keys, same types. Only the *value* of `unattended` (and therefore `attended`, `legs`, `any`) changes for L1/L2 runs that declare unattended config.

```
RECORD VerificationResolveOutput:   # unchanged shape; corrected values on interactive runs
  attended:   Bool     # == (ledger present) AND NOT unattended
  unattended: Bool     # == verificationUnattended(ledger, cfg)   <- the corrected field
  level:      String?  # ledger.level or null
  legs:       { holdout: Bool, spec_review: Bool, code_review: Bool }
  any:        Bool     # legs.holdout OR legs.spec_review OR legs.code_review
```

**Design decision — where the L3 gate lives.** See the Design Decision Rationale section; **Chosen:** gate the whole `declaredUnattendedFromConfig(cfg)` disjunct on `ledger.level === "L3"` (Fix A), mirroring `merge-gate.js:536`.

**Design decision — one helper vs two inline edits.** See rationale; **Chosen:** extract one `verificationUnattended(ledger, cfg)` helper in `config.js` and call it from both `resolveInteractiveVerification` and `cmdVerification`, rather than editing the disjunct in two places.

## 4. HOW — Behavior

**Approach.** Introduce `verificationUnattended(ledger, cfg)` in `config.js`. `resolveInteractiveVerification` returns all-false when it is true (or when there is no ledger); `cmdVerification` sets `unattended` from it directly. The only behavioural delta is that the config-declared-unattended signal now applies at L3 only, never at L1/L2.

**Behaviour summary.** After the change, an L1/L2 interactive run is attended regardless of `autonomous.unattended`/`sentry_acting`; an L3 run that declares unattended is unattended; an L4 run is always unattended. That is exactly the merge floor's model.

```
PROCEDURE resolveInteractiveVerification(ledger, cfg):
  1. IF verificationUnattended(ledger, cfg): RETURN { holdout:false, spec_review:false, code_review:false }
  2. IF NOT ledger: RETURN all-false        # attended posture needs a minted run to attach to
  3. RETURN per-leg literalTrue(verification.<leg>)   # fail-closed, unchanged
```

```
PROCEDURE cmdVerification(args):
  ...
  unattended := verificationUnattended(ledger, cfg)   # was: (ledger.level=="L4") OR declaredUnattendedFromConfig(cfg)
  attended   := (ledger present) AND NOT unattended
  legs, output shape: UNCHANGED
```

**Edge cases and precedence.**

- **No ledger** — `verificationUnattended` returns false (both disjuncts require a ledger); `resolveInteractiveVerification` still short-circuits to all-false at its no-ledger branch; `cmdVerification` sets `attended=false` (no run to attach to). The "no attended run" prose branch is unchanged.
- **L4 mint + any config** — first disjunct short-circuits true before any config read. A config fault can never regress the L4 case. Unchanged.
- **L3 + `autonomous.unattended` or `sentry_acting`** — unattended (legs all-false). Unchanged from today.
- **L1/L2 + `autonomous.unattended` or `sentry_acting`** — NOW attended; legs resolve per the `verification.*` posture. This is the fix, and it flips both config keys at L1/L2, not only the alias.
- **Typo / non-boolean config value** — `literalTrue` fail-closed inside `declaredUnattendedFromConfig` is unchanged; an unrecognised value never reads as unattended.

**Anti-pattern:** editing the disjunct inline at both `resolveInteractiveVerification` and `cmdVerification` and leaving them as two copies. Why: they are the same fact; two copies drift, which is how this class of bug persists. Route both through `verificationUnattended`.

**Anti-pattern:** "fixing" the field by reaching into `sentry.js` to change `declaredUnattendedFromConfig` or the alias reader. Why: that silently regresses the abort axis and the merge floor, which depend on the alias unchanged. The gate belongs on the verification axis in `config.js`.

**Anti-pattern:** editing `faff-graft/SKILL.md` Step 8c's `trigger := verif.unattended OR ...`. Why: `verif.unattended` is a pass-through of the corrected field; fixing the source fixes the consumer, and the prose is correct as written.

**Failure modes.**

- **The failure:** the L3 gate is applied to the alias only, leaving `autonomous.unattended` ungated at L1/L2. **How you'd know:** the new "L2 + `autonomous.unattended` → attended" test stays red while the alias test passes. **What it means:** narrow — the gate must wrap the whole `declaredUnattendedFromConfig` disjunct, not one key.
- **The failure:** the fix accidentally perturbs the abort axis (e.g. an editor touches `sentry.js`). **How you'd know:** `test/sentry.test.mjs:1654-1794` abort-axis truth tables go red. **What it means:** abandon that approach — the abort axis is out of scope and pinned byte-unchanged.
- **The failure:** `resolveInteractiveVerification` and `cmdVerification` disagree because only one was re-pointed at the helper. **How you'd know:** `verificationSelftest` and the CLI test emit different `unattended` for the same L2 fixture. **What it means:** narrow — both sites must consume the single helper.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Given an attended interactive L2 ledger and `autonomous.sentry_acting: true` in config
When `faff verification resolve --json` runs
Then `unattended` is `false`, `attended` is `true`, and the graft Step 8c holdout is not force-triggered by `verif.unattended`

Given an attended interactive L2 ledger and `autonomous.unattended: true` in config
When `faff verification resolve --json` runs
Then `unattended` is `false` and `attended` is `true` (interactive runs are attended by construction, for both config keys)

Given an automated L3 ledger and `autonomous.unattended: true` in config
When `faff verification resolve --json` runs
Then `unattended` is `true` and the interactive verification legs are all-false (L3 declared-unattended behaviour is preserved)

- The abort axis is unchanged: `test/sentry.test.mjs:1654-1794` stays green with no edits.

## 6. Design Decision Rationale

**Which fix direction — level-gate the config disjunct (Fix A), or fully decouple the alias from verification (Fix B)?**

- **Fix A — gate `declaredUnattendedFromConfig(cfg)` on `ledger.level === "L3"`, mirroring `merge-gate.js:536`.** Pros: minimal; one attendedness model shared with the merge floor; abort axis untouched; preserves FAFF-765 alias semantics at the level they apply (an L3 run declaring `sentry_acting`/`unattended` still runs verification unattended); fully fixes the reported L2 incident. Cons: keeps the alias meaningful on the verification axis at L3.
- **Fix B — point the verification axis at a canonical-only resolver reading only `autonomous.unattended` (+ L4), dropping the `sentry_acting` OR entirely.** Pros: cleaner alias separation. Cons: diverges from the merge floor's model; changes L3 behaviour (an L3 run with only `sentry_acting` set would stop running verification unattended); larger blast radius than the incident needs.

**Chosen:** Fix A — consistency with the working `merge-gate.js` attendedness model is the deciding factor (compute attendedness the same way everywhere). Fix A alone fully fixes the reported incident, and the alias-at-L3 question is closed by that same consistency argument: the merge floor already treats the alias as meaningful at L3, so the verification axis matches it rather than diverging. Full alias retirement (Fix B's deeper aim) is the separate deprecation slice named in Out of Scope, not this ticket.

**One shared helper, or edit the disjunct at both call sites?**

- **One helper (`verificationUnattended`)** — single source of truth; the two surfaces cannot drift; matches how `sentry.js` funnels the abort axis through `actsOnSentryAbort`.
- **Two inline edits** — smaller diff by one function, but reintroduces the copy that let the two sites express the same fact independently.

**Chosen:** extract one `verificationUnattended(ledger, cfg)` helper and consume it at both `resolveInteractiveVerification` and `cmdVerification`.

## 7. Open Questions and Assumptions

**Open Questions:** none. Both decisions are closed above; the reported incident is fully resolved by Fix A.

**Assumptions:** none requiring validation. `declaredUnattendedFromConfig` is already imported and called in `config.js` today (at the current `resolveInteractiveVerification` disjunct), so no new import or config key is introduced.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff verification resolve --json` on an attended L2 ledger with `autonomous.sentry_acting: true` reports `{"attended":true,"unattended":false}` (the reported incident).
- [ ] The abort axis is unchanged: `test/sentry.test.mjs` abort-axis truth tables (:1654-1794) pass with no edits to `sentry.js`.

### From WHAT (types and interfaces)
- [ ] A `verificationUnattended(ledger, cfg)` helper exists in `config.js` and returns `(ledger && ledger.level === "L4") || (ledger && ledger.level === "L3" && declaredUnattendedFromConfig(cfg))` — the null-ledger guard from the HOW pseudocode (both disjuncts require a ledger).
- [ ] The `verification resolve --json` output keys and types are unchanged (`attended`, `unattended`, `level`, `legs`, `any`).

### From HOW (behaviour)
- [ ] `resolveInteractiveVerification` returns all-false via `verificationUnattended` (and still via its no-ledger branch), and per-leg `literalTrue` otherwise.
- [ ] `cmdVerification` sets `unattended` from `verificationUnattended(ledger, cfg)` and both sites consume the one helper.
- [ ] An L3 ledger with `autonomous.unattended: true` still reports `unattended:true` with all legs off.
- [ ] An L3 ledger with only `autonomous.sentry_acting: true` still reports `unattended:true` with all legs off.

### From HOW (edge cases)
- [ ] A no-ledger call reports `attended:false` and legs all-off (unchanged).
- [ ] An L4 ledger reports `unattended:true` regardless of config (unchanged), short-circuiting before any config read.
- [ ] An L2 ledger with `autonomous.unattended: true` reports `attended:true` (config key gated at L3, not only the alias).

### From tests
- [ ] `test/verification-resolve.test.mjs`: every L2 case that currently asserts `unattended:true` is re-pointed. The three are "declared-unattended config short-circuits" (`autonomous.unattended`, ~line 74) and "retained FAFF-717 alias (sentry_acting) also short-circuits" (~line 83) — re-pointed to assert the corrected L2-attended behaviour — and "a per-invocation flag can NOT confer verification on an unattended run" (~line 114, L2 + `autonomous.unattended`) — its unattended premise moved to an L3 ledger so the flag-can't-confer invariant still holds. New L3 cases assert both config keys still mark an L3 run unattended.
- [ ] `verificationSelftest` in `config.js` (:912-966): its two L2 declared-unattended/alias checks are moved to L3 fixtures (still proving short-circuit) and complemented by L2 checks proving attended; the selftest passes.

**Eval coverage.** No LLM-judgement seam is introduced or changed; no grader registration is required.

**Integration smoke test.**
```
1. Mint an L2 run-ledger.json under a temp run dir; write a .faffrc with `autonomous:\n  sentry_acting: true` and `verification.holdout: true`.
2. Run `faff verification resolve --json` with FAFF_RUN_DIR pointed at that dir.
3. Assert the JSON is {"attended":true,"unattended":false, legs.holdout:true, ...} — the plumbing (helper -> both call sites -> emitted field) is connected.
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" } ] }
```
