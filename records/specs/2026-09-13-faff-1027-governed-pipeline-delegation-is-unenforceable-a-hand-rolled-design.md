# FAFF-1027: the lights-out banner stops overstating what its guardrails mean

> Spec: faffter-dark-nlspec · 2026-09-13 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1027.
> **Narrowed 2026-09-13 by an operator split decision.** The approved round-8 spec covered two
> deliverables: (a) the static-claim honesty fix in the banner and genesis ledger, and (b) `faff
> gate-trace`, a per-unit record of which gates actually fired. (b) is deferred to FAFF-1037 so it is
> built once, on the signed Commissaire records FAFF-1034 introduces, rather than on plain files now
> and rebuilt later. This spec is (a) only. The full round-8 body remains the design of record for
> (b) and is attached to FAFF-1037.
>
> Review history of the parent body: 8 adversarial rounds, `reject-approach` x4 → `revise` → `approve`
> (0 objections, round 8, `openai/unsloth/Qwen3.8-27B-NVFP4` chain[0]). This narrowing is a strict
> subset by removal plus the three consequential edits recorded under "What the split changed".

This spec covers the honesty half of FAFF-1027 ("Governed-pipeline delegation is unenforceable; a hand-rolled orchestrator loop silently skips 'enforced' guardrails"). Audience: the build agent implementing it, and the human reviewing that build.

The ticket's own classification is the frame: in the current architecture, an unattended orchestrator substituting its own `plot -> build -> self-review -> test -> merge` loop for the delegated pipeline is **not preventable by a code patch to beep-boop**, and that unpreventability is the finding. This spec does not promise prevention, and after the split it does not promise detection either. It makes the run stop overstating what its guardrail claims mean.

## 1. WHY: problem and principles

### The model the rest of this spec turns on

faff today holds two different claims in one word. `enforced` in `lights-out.js` means *a step exists in the shipped pipeline that invokes this guardrail's contract*. That is a property of the source code, true before the run starts and equally true of a run that did no work at all. What an operator reads it as, when they see it persisted in a finished run's ledger next to a green summary, is *these eight gates ran on this work*. Nothing in the system produces the second claim, so the second claim is the one that is missing, not the one that is wrong.

```
  what lights-out ships today                what a reader assumes
  ---------------------------                ---------------------
  LIGHTS_OUT_GUARDRAILS literal              "8 gates ran on this run"
    enforced: true x8                                  ^
        |                                              |
   lightsOutEnforced() copies the literal              |
        |                                              |
   mintLightsOut() writes it to run-ledger.json        |
   AT GENESIS, before any build work  -----------------+
        |
   renderLightsOutBanner() prints "ARMED — 8/8 enforced"
```

**What this spec does about it, after the split.** It cannot supply the missing second claim, because that claim is `gate-trace` and `gate-trace` is deferred. What it can do, and does, is stop the first claim from being readable as the second: scope `enforced` explicitly, add the orthogonal `rechecked` axis that says which guardrails a deterministic gate would actually refuse without, and stamp the ledger's claim with its own basis. A reader is then told plainly that these are static properties and that no per-run evidence exists.

### Problem statement

A hand-rolled loop that never invokes a single guardrail caller still mints a ledger and a banner asserting eight of eight enforced, because `mintLightsOut` (`plugin/skills/faff/bin/lib/lights-out.js:1073-1079`) writes `armed`, `enforced`, and `banner` into the run ledger at genesis, from the hardcoded `enforced: true` literals in `LIGHTS_OUT_GUARDRAILS` (`:49-61`) copied verbatim by `lightsOutEnforced` (`:293-302`). This spec scopes that claim so it can no longer be read as a record of what ran.

### Design principles

**A claim must carry its own provenance.** Any field that says something about guardrails must say, in the same place, whether it is a static property of the shipped code or an observation of this run. A bare boolean with no stated basis is the defect being fixed, so reintroducing one anywhere in this build is a failed build.

**Never promise a key you do not write.** A genesis-stamped pointer at evidence that may never appear is the same unfalsifiable-claim shape this ticket exists to remove. This is the principle that forced the `evidence_field` / `evidence_written` removal when `gate-trace` was deferred; see "What the split changed".

**Fail closed on unprovable.** A flag that is missing, or truthy-but-not-`true`, reads `false`.

**Additive only, outside the completeness invariant.** `auditLedger` (`plugin/skills/faff/bin/lib/runcheck.js:32-58`) reads only `admitted` and `outcomes`. Every field this spec adds is a top-level sibling that `auditLedger` never reads, exactly as `review_adversarial_skipped`, `landing_resumable`, `post_merge_verification_failures`, and `outcome_details` already are. `runcheck` behaviour must be byte-identical before and after this build.

*(Two further principles of the parent body — "Observe, never declare" and "The reader is the product; the writer is a convenience" — govern `gate-trace` and travel with it to FAFF-1037.)*

### Reference context

| File | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/lights-out.js` | The guardrail table (`:49-61`), `lightsOutEnforced` (`:293-302`), `renderLightsOutBanner` (`:500-545`), the genesis ledger write in `mintLightsOut` (`:1073-1079`), and `lightsOutSelftest`'s banner assertions (`:1640-1690`). Region `factory`. |
| `plugin/skills/faff/bin/lib/runcheck.js` | `auditLedger`'s completeness invariant, which this build must not perturb. Region `governance`. |
| `plugin/skills/faff/bin/lib/merge-gate.js` | Not modified. Read-only here: `readHoldout` + `holdoutIsFresh` (`:675-696`) is the call site that earns `rechecked.holdout`. |
| `plugin/skills/faff/bin/lib/governance-check.js:156-157` | The fail-closed anchor check that earns `rechecked.observability`. |

### Scope statement

This sits entirely inside the L4 lights-out surface and the run ledger's genesis write. It changes no merge floor, no gate, no admission decision, and adds no new command.

## Already shipped against this surface

The reachable-versus-enforced work is partly done. Do not redo any of it.

| Ticket | State | What it already delivered |
|---|---|---|
| FAFF-305 | Done 2026-06-30, PR #231, commit `55a2942b` | The reachable-versus-enforced **vocabulary and banner rendering**: the `enforced` map, the fail-closed strict `=== true` derivation, the per-guardrail `enforced` / `reachable-only` token, and the `ARMED — N/8 enforced` summary line with its reachable-but-not-enforced clause. This spec extends that rendering; it does not re-specify it. |
| FAFF-309 | Done 2026-07-01 | Wired the holdout caller FAFF-305 found missing, which is why `holdout` carries `enforced: true` today. |
| FAFF-570 | Done 2026-07-23, PR #460 | Swept the attested-versus-enforced overclaim out of the prose guides. No further prose-guide sweep is in scope here. |

## 2. Out of scope

- **`faff gate-trace` and the per-unit firing record.** The whole of it: the `GateTrace` record, `GATE_EVIDENCE`, the classification procedure, the `--write` path, the beep-boop caller, and `claim_reconciliation`. Deferred to **FAFF-1037**, to be built on the signed `schema:3` records FAFF-1034 introduces rather than on plain filesystem artifacts. **Extension point:** `guardrail_claim` is shaped so FAFF-1037 adds `evidence_field` and `evidence_written` back as additive keys, with no change to what this build writes.
- **The Phase 3 deterministic coordinator.** FAFF-1027's item 2 and the structural fix for the delegation-ignore itself. Not this ticket.
- **Any change to a merge-floor condition, or any weakening of any gate.** `decideFloor` and every `merge-gate.js` refusal branch are untouched.
- **Re-specifying FAFF-305's banner vocabulary.** The `enforced` / `reachable-only` token and the `ARMED — N/8 enforced` line keep their current meaning and spelling. This build adds tokens beside them.
- **Making any of the six `rechecked: false` guardrails true.** Each needs a deterministic refusal on an effect path, which is per-guardrail design work, not a banner change. **Extension point:** the `rechecked` table below is where each would flip, and the basis column states what would have to exist first.
- **The `run-done` product-floor fail-open.** `run-done.js:161` sets `let prd_satisfied = null;` and an omitted `--prd-coverage` silently skips the product floor. Same disease, but the fix changes a floor condition.

## 3. WHAT: vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| enforced | A shipped orchestrator step invokes this guardrail's contract. A static property of the source, already defined this way in `lightsOutEnforced`'s comment. Unchanged by this build. |
| rechecked | A deterministic gate independently refuses when this guardrail's evidence artifact is absent or unreadable. Also static, and new in this build. |

Both are properties of the shipped pipeline. Neither is an observation of a run. That distinction is the whole deliverable.


### The two static maps on the guardrail table

`LIGHTS_OUT_GUARDRAILS` gains a second flag per entry. `lightsOutEnforced` is untouched; a sibling pure function mirrors it exactly.

```
RECORD Guardrail:                 # LIGHTS_OUT_GUARDRAILS entry, lights-out.js:49-61
  id: String                      # unchanged
  contract: String                # unchanged
  probe: String | null            # unchanged
  enforced: Boolean               # unchanged; a pipeline step invokes it
  rechecked: Boolean              # NEW; a deterministic gate refuses without its evidence

FUNCTION lightsOutRechecked(guardrails) -> Map<GuardrailId, Boolean>
  # Pure. Mirrors lightsOutEnforced byte for byte in shape and discipline:
  # strict === true, so a missing or truthy-but-not-true flag reads false.
  # Reported by the banner and the ledger, never gated on.
```

Per-guardrail values. **All eight are fixed here**, each `true` naming the call site that earns it. The resulting map is `rechecked: 2 of 8`.

| Guardrail | `enforced` | `rechecked` | Basis |
|---|---|---|---|
| `spec_review` | `true` (unchanged) | `false` | No downstream mechanical re-check exists anywhere. Its only durable trace is a mutable `spec-review: approve` text line on the spec body (`faff-prep/SKILL.md:268`). This is the asymmetry FAFF-1027 names. |
| `holdout` | `true` (unchanged) | `true` | `merge-gate.js:675-696` re-reads `holdout.json`, checks freshness against the build checkpoint and the spawner attestation, and refuses without it. |
| `observability` | `true` (unchanged) | `true` | `governance-check` is a **required** status check on the default branch and fail-closes on `anchor-missing` / `anchor-malformed` / a witness disagreement (`governance-check.js:156-157`); the anchor is derived from `events.jsonl`, this guardrail's evidence. `merge-gate.js` carries the sibling `anchorRefusal`. |
| `admissibility` | `true` (unchanged) | `false` | `faff admissible --lights-out` gates admission at beep-boop step 4 with a graft Step-2 backstop, but neither persists an artifact a later gate re-reads, so nothing refuses on its absence. |
| `terminating` | `true` (unchanged) | `false` | `faff run-done` is consulted at the wave boundary and persists no artifact; `run-done.js:161` shows an omitted input silently skipping the floor rather than refusing. |
| `budget` | `true` (unchanged) | `false` | `faff budget check` reads the ledger and emits a state; no gate refuses when its evidence is absent. |
| `kill_switch` | `true` (unchanged) | `false` | `faff sentry check` is a pure evaluator consumed at checkpoints; no downstream gate refuses on absent sentry evidence. |
| `container` | `true` (unchanged) | `false` | `faff container-check` is assert-only at autonomous entry under a warn/block knob, and faff implements no sandbox of its own; nothing re-reads it at a later gate. |

**So the shipped map is `rechecked: 2 of 8`** — `observability` and `holdout`. That number is the honest headline of this ticket: six of the eight guardrails the banner calls `enforced` have no deterministic gate that refuses when their evidence is missing.

**Chosen:** the eight values are **fixed here, in the spec, with the call site named for each `true`**, and pinned as a complete literal map in `lightsOutSelftest`. An earlier draft left six to the implementer with only "name a call site in a comment" as the rule. That is not good enough on this ticket specifically: the banner publishes `<N>/8 independently rechecked` as an operator-facing number, so leaving `N` to derivation means two conforming builds can render different numbers and no reviewer can check either against the spec. A published count nobody can falsify is the exact defect this ticket exists to remove, reproduced one field over. The derivation is a bounded codebase question over six named guardrails, so it is answered here rather than delegated.

**Chosen:** add a second static axis (`rechecked`) rather than flipping `spec_review`'s `enforced` to `false`. Flipping would contradict the definition the code already states for `enforced` ("true iff an orchestrator step INVOKES it in the loop"), which `spec_review` genuinely satisfies: prep does invoke the `spec_review` slot. The honest statement is that `spec_review` is invoked but never re-checked, and that needs two booleans to say.

**Chosen:** the strict `=== true` derivation is retained as the implementation floor beneath the fixed table above: a flag that is missing, or truthy-but-not-`true`, reads `false`. The table says what the eight values are; this says that a malformed one can only ever fail closed.

**Residual to state plainly, not hide:** `rechecked.holdout` is `true` on the strength of the per-unit L4 holdout only. The run-level holdout phase (beep-boop step 10b) has no equivalent artifact and no re-check. The table entry's comment must say so, so nobody reads `rechecked.holdout: true` as covering both halves.


### What the split changed

Three edits the split forced, recorded so a reviewer of the narrowed spec can diff it against the approved parent without re-reading both.

1. **`guardrail_claim` loses `evidence_field` and `evidence_written`.** In the parent they pointed at `gate_trace` and were flipped true by `gate-trace --write`. With `gate-trace` deferred there is no writer, so a genesis-stamped `evidence_field: "gate_trace"` alongside a permanent `evidence_written: false` would be precisely the unfalsifiable promise this ticket removes — the parent says so in its own words ("a genesis-stamped promise about a key that may never appear, which is the same unfalsifiable-claim shape this ticket exists to remove"). Both keys are dropped. FAFF-1037 adds them back additively when it ships the writer.
2. **The banner's `claim:` block loses its final line.** The parent ended it with "For what actually fired, per unit: `faff gate-trace --run-dir <dir>`". That command will not exist. Pointing at it would be worse than silence. The two remaining lines state what the counts are and are not, and stop there.
3. **`claim_reconciliation` is gone entirely**, being a field of the `GateTrace` record.

**Chosen:** drop the evidence pointer rather than ship it aimed at an unbuilt command. The alternative considered was keeping `evidence_field` as documentation of intent. It was rejected because a reader cannot distinguish "intent recorded" from "evidence promised", and this ticket exists because exactly that ambiguity was costing readers their trust in the banner.

**Chosen: this narrowing resolves FAFF-1033 rather than deferring it.** FAFF-1033 records that the banner would point at a `gate-trace` covering only 2 of the 8 guardrails listed above it. With edit 2 there is no pointer, so the over-claim cannot occur. FAFF-1033 should be closed against this build, and its substance (which guardrails a firing record can observe) re-enters as an input to FAFF-1037's design rather than as a defect in this one.


### The ledger fields

Two additive top-level fields. `armed`, `enforced`, and `banner` keep their current keys, shapes, and values, so no existing reader changes and no migration is needed.

```
# both written at genesis by mintLightsOut, alongside enforced
rechecked: Map<GuardrailId, Boolean>

guardrail_claim: {
  kind: "static-pipeline-property",
  stamped_at: Timestamp,              # the mint timestamp, the same nowIso the owner stamp uses
  applies_to: ["enforced", "rechecked"],
}
```

`guardrail_claim` carries metadata only: what kind of claim the maps beside it are, when it was stamped, and which fields it governs. It makes no statement about evidence, because this build produces none.

**Chosen:** additive sibling fields, not a rename of `enforced` and not a nested wrapper that repeats the per-guardrail map. A rename breaks every existing ledger reader for no honesty gain, since the confusion is about the claim's *basis*, not its spelling. A wrapper that re-states the `enforced` map inside `guardrail_claim` creates two copies of one truth. `guardrail_claim` therefore carries metadata only and points at where the maps live.

**Chosen:** no `gate_trace` key is reserved, declared, or written. An empty or null placeholder would be a promise in a different font.


## 4. HOW: behaviour

### The banner and the genesis ledger

**In plain terms:** the banner keeps every token FAFF-305 gave it and gains a second token per line, a second count on the status line, and one line stating what the two counts are and are not.

`renderLightsOutBanner` (`:500-545`) takes `rechecked` as a further trailing defaulted parameter, mirroring how `enforced` was added: an older-arity call leaves it undefined and every line degrades to `rechecked:no`, the documented failure mode, never a throw.

```
faff lights-out — L4 (preview) run banner
  level: L4 (preview)   container: contained   convergence: forced
  guardrails (8):
    <mark> admissibility  reachable:live      enforced       rechecked:no   (faff admissible --lights-out)
    <mark> holdout        reachable:live      enforced       rechecked:yes  (faff holdout verdict)
    <mark> spec_review    reachable:live      enforced       rechecked:no   (faff contract spec-review-verdict)
    ...
  floor: <unchanged>
  status: ARMED — 8/8 enforced; 2/8 independently rechecked
  claim: enforced and rechecked are STATIC properties of the shipped pipeline, stamped at genesis;
         neither is evidence that any guardrail ran in this run.
```

Three constraints on that rendering:

- The existing `base` string `ARMED — 8/8 enforced` is built unchanged and the rechecked count is appended to it, so `lightsOutSelftest`'s `includes("ARMED — 8/8 enforced")` assertion (`:1640-1690`) still holds. The reachable-but-not-enforced clause follows as it does today, so the assertion that a fully-enforced banner does not contain `reachable-but-not-enforced` also still holds. The test whose *name* says "with no trailing clause" is now misnamed; rename it, do not weaken it.
- The per-guardrail line keeps its four-space indent and its `<mark> ` prefix, so `lightsOutSelftest`'s `/^ {4}[●◐○] /` line filter and its `reachable:` and `/\b(enforced|reachable-only)\b/` token assertions all still pass.
- The `claim:` lines are new and unconditional on the proceed path. On the REFUSED path the status line is unchanged, per FAFF-305's existing assertion; add the `claim:` lines there too, since a refused run's banner makes the same static claim.

`mintLightsOut` (`:1073-1079`) writes `rechecked` and `guardrail_claim` alongside the existing three keys, from the same preflight result and the same `nowIso` the owner stamp uses. `assembleLightsOutPreflight` returns `rechecked` alongside `enforced`.

### Edge cases

| Condition | Behaviour |
|---|---|
| A guardrail entry whose `rechecked` flag is missing | Reads `false` (strict `=== true`). Never a throw, never `true`. |
| A guardrail entry whose `rechecked` is `1` or `"true"` | Reads `false`. Truthy is not `true`. |
| `renderLightsOutBanner` called at the old arity (no `rechecked` argument) | Every per-guardrail line degrades to `rechecked:no` and the status line's rechecked count reads `0/8`. Documented, never a throw. |
| A legacy ledger with no `rechecked` or `guardrail_claim` | Read as absent by every consumer. Nothing in this build requires either to exist on an old ledger; there is no migration. |
| The REFUSED banner path | Status line unchanged per FAFF-305's existing assertion; the `claim:` block renders there too, because a refused run's banner makes the same static claim. |

### Failure modes

**The banner still cannot tell you what ran.** After this build the banner is honest about being static, and that is all. An operator who wants to know whether the eight gates fired on a given unit still has no surface to ask. *How you would know:* the `claim:` block says so in as many words. *What it means:* proceed. That surface is FAFF-1037, deliberately deferred; the honest statement is strictly better than the previous confident one, and shipping the honest statement does not depend on the surface existing.

**`rechecked: 2 of 8` reads as alarming.** It is meant to. *How you would know:* the first operator to see the new banner asks why six guardrails have no independent recheck. *What it means:* that is the true state of the shipped pipeline, and surfacing it is the deliverable. Do not soften the count, and do not add a reassuring gloss to the `claim:` block.

**A future ticket flips a `rechecked` value without a call site.** The eight values are fixed in this spec and pinned as a literal map in `lightsOutSelftest`, so a flip without the corresponding refusal is a red test rather than a quiet banner change. *How you would know:* the selftest fails. *What it means:* either the call site landed and the map should move, or the flip is wrong.

### How this is tested

The lights-out changes go in `lightsOutSelftest`, which is already the home of every banner assertion. No new `node:test` file is needed: this build adds no command, no filesystem behaviour, and no new module. `faff regions check` must still pass.

## 5. Scenarios

```
Given a guardrail table whose eight entries each carry a rechecked flag
When lightsOutRechecked is called on it
Then it returns an eight-key map, and an entry whose flag is 1, "true", or absent reads false
```

```
Given the shipped guardrail table
When the lights-out banner is rendered on the proceed path
Then the status line reads ARMED — 8/8 enforced; 2/8 independently rechecked,
     and every per-guardrail line carries a rechecked:yes or rechecked:no token
```

```
Given the shipped guardrail table
When the lights-out banner is rendered on the proceed path
Then the claim: block states that enforced and rechecked are static properties stamped at genesis
     and that neither is evidence any guardrail ran, and it names no command
```

```
Given a run that the lights-out preflight REFUSES
When its banner is rendered
Then the status line is unchanged from today and the claim: block renders there too
```

```
Given renderLightsOutBanner invoked at its old arity, with no rechecked argument
When the banner is rendered
Then every per-guardrail line reads rechecked:no, the count reads 0/8, and nothing throws
```

```
Given a fresh L4 mint
When mintLightsOut writes the run ledger
Then the ledger carries rechecked and guardrail_claim alongside the unchanged armed, enforced
     and banner keys, guardrail_claim carries exactly kind, stamped_at and applies_to,
     and no gate_trace key is present in any form
```

- `faff runcheck` output MUST be byte-identical on a ledger carrying `rechecked` and `guardrail_claim` and on the same ledger with both removed.
- The rendered banner MUST contain no per-guardrail line asserting `rechecked:yes` for `spec_review`.
- The genesis ledger MUST NOT contain `evidence_field`, `evidence_written`, or `gate_trace` in any form.
- `auditLedger` MUST NOT read either new field, provable by passing a ledger carrying both with a deliberately undispatched `admitted` entry and getting the same `clean: false` result as without them.

## 6. Design decision rationale

| Decision | Outcome | Why the alternative lost |
|---|---|---|
| Flip `spec_review`'s `enforced`, or add a second axis | Add `rechecked` | Flipping contradicts the definition `lightsOutEnforced`'s own comment states, which `spec_review` satisfies. |
| The eight `rechecked` values | Fixed in the spec, call site named for each `true`; the map is **2 of 8** | Leaving six to derivation makes the banner's published count uncheckable against the spec, which is this ticket's own defect one field over. |
| Rename `enforced`, wrap it, or add siblings | Additive siblings | A rename breaks readers for no honesty gain; a wrapper duplicates the map. |
| `guardrail_claim`'s evidence keys, with `gate-trace` deferred | Dropped, not stubbed | A genesis-stamped pointer at a key nothing writes is the unfalsifiable-claim shape this ticket removes. |
| The banner's evidence pointer | Removed with the command | Pointing at an unbuilt command is worse than silence, and it is what FAFF-1033 objected to. |
| Reserving a null `gate_trace` key for later | No | A placeholder is a promise in a different font. |
| Config knob | None | Needs `DEFAULTS` plus a `.faffrc.example.yaml` row, and an off-switch on an honesty surface is the wrong shape. |
| Test idiom | `lightsOutSelftest` only | This build adds no command and no filesystem behaviour, so it needs no `node:test` file. |

## 7. Open questions and assumptions

### Open questions

**None.** The split itself was the open decision and it is settled: (a) here, (b) in FAFF-1037.

### Assumptions

**Assumes:** the two `rechecked: true` values remain earned at build time. `observability` rests on `governance-check` being a **required** status check that fail-closes on `anchor-missing` / `anchor-malformed` (`governance-check.js:156-157`); `holdout` rests on `merge-gate.js:675-696` re-reading `holdout.json` and refusing without it. *Validate before starting:* re-read both call sites. If either has moved, the map is wrong and the count changes; fix the map, and do not ship a count the source does not support.

## 8. DONE

### From WHY

- [ ] A run ledger minted by `mintLightsOut` carries a `guardrail_claim` object with `kind: "static-pipeline-property"`, a `stamped_at` equal to the mint timestamp, and `applies_to: ["enforced", "rechecked"]` — and **no other keys**.
- [ ] No `gate_trace`, `evidence_field`, or `evidence_written` key is written anywhere by this build.
- [ ] `faff runcheck` on a ledger carrying `rechecked` and `guardrail_claim` produces output byte-identical to the same ledger with both keys removed.
- [ ] `auditLedger` in `runcheck.js` is unmodified by this build.

### From WHAT (types and interfaces)

- [ ] `LIGHTS_OUT_GUARDRAILS` carries a `rechecked` flag on every one of its eight entries, each with a comment naming either the call site that re-reads its evidence and refuses, or the absence of one.
- [ ] `lightsOutRechecked` exists, is pure, takes a guardrail table, and derives strictly on `=== true`: an exact `true` reads true; `1`, `"true"`, and a missing flag all read false.
- [ ] `rechecked.spec_review` is `false` and `rechecked.holdout` is `true`, with the holdout entry's comment stating that the run-level holdout phase has no equivalent re-check.
- [ ] `lightsOutEnforced` and the `enforced` map's values are unchanged by this build.
- [ ] The genesis ledger's `armed`, `enforced`, and `banner` keys are unchanged in key, shape, and value.
- [ ] `assembleLightsOutPreflight` returns `rechecked` alongside `enforced`.

### From HOW (the banner)

- [ ] Every per-guardrail banner line carries a `rechecked:yes` or `rechecked:no` token in addition to its existing reachability and enforcement tokens.
- [ ] The proceed-path status line reads `ARMED — 8/8 enforced; 2/8 independently rechecked`.
- [ ] The banner carries a `claim:` block stating that `enforced` and `rechecked` are static properties stamped at genesis and that neither is evidence any guardrail ran. It names **no** command. The block renders on both the proceed and the REFUSED paths.
- [ ] `renderLightsOutBanner` accepts `rechecked` as a trailing defaulted parameter; an older-arity call degrades every line to `rechecked:no` and never throws.

### Tests

- [ ] `lightsOutSelftest` asserts the genesis `guardrail_claim` object exactly — `kind`, `stamped_at`, `applies_to`, and the **absence** of `evidence_field` / `evidence_written`.
- [ ] `lightsOutSelftest` pins the **complete eight-key `rechecked` map as a literal**, so every value is an assertion rather than a comment.
- [ ] `lightsOutSelftest` gains assertions covering: the `rechecked` map's presence and eight-key coverage; the strict `=== true` derivation over a fixture table containing `true`, `1`, `"true"`, and a missing flag; `rechecked.spec_review === false`; every per-guardrail line carrying a rechecked token; the status line reading `2/8 independently rechecked`; the `claim:` block on both the proceed and REFUSED paths; and that the rendered banner contains no `gate-trace` string.
- [ ] The existing `lightsOutSelftest` case named "proceed-path status line reads 8/8 enforced with no trailing clause" is renamed to match its new output; its two assertions are unchanged.
- [ ] `node plugin/skills/faff/bin/faff lights-out --selftest` reports `RESULT: PASS`.
- [ ] `node plugin/skills/faff/bin/faff regions check` passes.

confidence: medium
build-tier: complex
spec-review: inherited from the round-8 `approve` on the parent body (0 objections); this narrowing is a strict subset by removal plus the three edits recorded under "What the split changed"

```faff-contract:spec-readiness
{"confidence": "medium", "decisions": [{"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "assumes"}]}
```
