# FAFF-1219: Refuse unpinned grants when the Commissaire trust file turns on strict mode

> Spec: faffter-dark-nlspec · 2026-10-12 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1219.

Revised on 2026-10-12 after two adversarial spec-review rounds (architectural, infosec, QA): the strict check now runs after `chokepointPermit` so no existing refusal changes its reason, and the Why states what strict mode does not stop.

Revised again on 2026-10-12 to fold in the operator's decision (Resolution comment on FAFF-1219): strict mode leaves ungoverned runs `not-applicable`, and the residual risk that leaves is accepted (section 4, "Ungoverned runs"). FAFF-1212 is now a Linear blocker of this ticket.

Revised a third time on 2026-10-12 after spec-review round 3 (round 4 approved): the transport bullet now states what a runner-controlled local read can do and what does and does not detect it, and section 4 states that strict mode depends on callers supplying a trust read (FAFF-1212's legs refuse without one).

This spec is for the build agent and human reviewers of FAFF-1219. It adds strict mode to Commissaire's grant-verify function, `verifyGrant` in `commissaire-verify.ts`, which FAFF-1178 creates. It changes nothing else in that function and nothing in `audit verify`.

## 1. Why

**The model.** FAFF-1178's `verifyGrant` already classifies every governed grant as `pinned`, `unpinned` or `in-process`, and already reads `require_pinned_governor` from the trust file into `KeyResolution`. Strict mode is one new refusal: when that flag is true, a grant whose classification is not `pinned` is refused with the reason `grant-not-pinned`. When the flag is false or the file is absent, `verifyGrant` returns exactly what it returns without this ticket.

**Problem.** Without strict mode, ADR 0135 decision 6 accepts unpinned and in-process grants as valid and merely uncounted. A runner that forges a whole ledger under its own key produces a self-consistent run that classifies `unpinned` or `in-process`, and `merge-gate` lets it merge. Strict mode is the opt-in switch that turns those classifications into refusals, so that in a repository that has pinned its governor, every grant `verifyGrant` checks must come from a pinned key.

**What strict mode does not do.** It acts only on runs that carry governance material, and only at chokepoints that ask `verifyGrant`. A runner can still discard its run's governance material so the run reads as ungoverned (see section 4, "Ungoverned runs"; the operator accepted this residual risk), or merge without asking `merge-gate` at all (ADR 0135 decision 10). Detection of both is `effects reconcile-merges` (FAFF-1028); prevention is FAFF-1220.

**Design principles.**

**Off means byte-identical.** With `require_pinned_governor` false or the trust file absent, every `verifyGrant` result is identical, field for field, to FAFF-1178's result for the same inputs.

**Strict mode only ever refuses more.** The new branch can turn a `valid-grant` into `absent-or-invalid`. It never turns a refusal into a pass and never changes a refusal's reason.

**The trust file is the only switch.** The flag comes from the base branch's `.commissaire/trust.toml` through the caller's `readTrustFile` result, as ADR 0135 decision 11 requires. No environment variable, flag or local override turns it on or off.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire-verify.ts` | TypeScript (governance) | Created by FAFF-1178. `verifyGrant` and `resolveAdmittedKey`; this ticket adds one branch |
| `plugin/skills/faff/bin/lib/commissaire-trust.ts` | TypeScript (governance) | `readTrustFile` and `validateTrustDocument` (FAFF-1210). `TrustConfig.requirePinnedGovernor` defaults to false; strict mode with an empty `governor_key_fingerprints` list is a `Schema` error, "strict mode requires at least one fingerprint" |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript (factory) | The merge, pr-create and branch-delete legs call `verifyGrant` after FAFF-1212 |
| `test/commissaire-trust.test.mjs` | Test | Already covers the empty-list refusal at the parser level |
| `records/adr/0135-commissaire-governor-runs-out-of-process-opt-in-with-pinned-keys.md` | ADR | Decisions 6 and 11, and the consequence "every governed merge there needs a reachable pinned governor" |

**Scope.** Commissaire-side only: one branch in `verifyGrant` and its tests.

## 2. Out of scope

- **The call sites.** FAFF-1212 makes `merge-gate`, pr-create and branch-delete call `verifyGrant` and refuse on `absent-or-invalid` with the function's reason. This ticket adds tests that exercise those legs with strict mode on, but changes no call-site code. Extension point: `resolveGrantByEffectKind` in `merge-gate.js`.
- **Which trust transport a caller uses.** FAFF-1212 owns it. Its attached spec reads the trust file from the remote base branch on the PR and pr-create paths, and from the local base ref only on the git-only `--local` path. On a local read the runner controls the file's bytes, not just the switch: it can commit a trust file listing its own key with strict mode on, forge a governor-custody ledger under that key, and `verifyGrant` returns `valid-grant` with `classification: "pinned"`. Such a merge carries a grant, so `effects reconcile-merges` (FAFF-1028), which flags merges without their own grant, does not detect it. What contains it: a `local-ref` read is never pinned-governor evidence (FAFF-1178) and a run with no remote never counts (FAFF-1217); a remote-transport `audit verify --base <protected branch>` reports the same grant `unpinned`; FAFF-1220 (a required status check only the governor can post) prevents the merge. A PR into a runner-created base branch carrying its own `trust.toml` is the same case, covered by FAFF-1212's `base_ref` reporting. This is the ADR 0135 decision 10 class; strict mode does not claim to close it. Extension point: the `trust` argument the caller builds.
- **Strict mode in `audit verify`.** `audit verify` already reports `trust.require_pinned_governor` and each record's `key_classification` (FAFF-1178), so a reader can apply strict mode to the evidence. Its pass or fail result does not change here. Extension point: `cmdAuditVerify` in `commissaire.ts`.
- **Turning strict mode on in faff's own repository.** A human-approved trust-file PR after the first pin merges; FAFF-1182 tracks it.
- **The pin-change approval rule.** FAFF-1218.

## 3. What

### Vocabulary

| Term | Meaning |
|---|---|
| Strict mode | `require_pinned_governor = true` in the trust file `verifyGrant` was given, as reported in `KeyResolution.require_pinned_governor` |
| Pinned grant | A grant whose `KeyResolution.classification` is `pinned` (FAFF-1178: governor custody, admitted key's fingerprint listed in `governor_key_fingerprints`) |

### Interface change

No new function, field or argument. One existing enum value becomes live.

```
ENUM GrantReason:                     # from FAFF-1178, unchanged except:
  ...
  "grant-not-pinned"                  # was reserved; now returned when strict mode refuses
```

When strict mode refuses, `GrantVerifyResult` is:

```
RECORD GrantVerifyResult (strict refusal):
  outcome: "absent-or-invalid"
  reason: "grant-not-pinned"
  custody: the resolved custody ("governor" | "in-process")
  classification: the resolved classification ("unpinned" | "in-process")   # never overwritten
  signer_fingerprint: the admitted key's fingerprint
  verdict_seq: seq of the verdict that was selected
  trust_source: as resolved
```

**Chosen:** report the real classification on a strict refusal, not a new value. Callers and Gate 1 counting (FAFF-1182) read `classification` as a fact about the key; strict mode is a policy over that fact, so it belongs in `reason` only.

## 4. How

### The strict branch

`verifyGrant` gains one step at the very end, after FAFF-1178's step 8 (`chokepointPermit`) has accepted the grant and before step 9 returns it.

```
PROCEDURE verifyGrant(input):                       # FAFF-1178 steps 1-8 unchanged
  ...
  8.  res := chokepointPermit(...)
  8a. IF res.permit AND key.require_pinned_governor == true AND key.classification != "pinned"
        -> RETURN { outcome: "absent-or-invalid", reason: "grant-not-pinned",
                    custody: key.custody, classification: key.classification,
                    signer_fingerprint: key.signer_fingerprint,
                    verdict_seq: verdict.seq, trust_source: key.trust_source }
  9.  ...                                            # FAFF-1178 step 9 unchanged
```

**Chosen:** check strict mode only once FAFF-1178 has accepted the grant (step 8a). Every refusal FAFF-1178 would return keeps its reason unchanged, so strict mode only ever converts a `valid-grant` into `grant-not-pinned`, as the design principle states. By then the verdict has passed the run-binding and chain-position checks, so `verdict_seq` on a strict refusal names a verdict the verifier stands behind. The ticket's extension point in FAFF-1178 ("one branch in `verifyGrant` after classification") is satisfied: classification is known from step 2 onward.

**Chosen:** under strict mode, `classification` of `unpinned` and `in-process` are both refused, as the ticket and ADR 0135 decision 6 state ("in-process and unpinned grants are refused").

### When strict mode cannot fire

`KeyResolution.require_pinned_governor` is true only when a trust config was actually read and its flag is true. The paths where it stays false, all inherited from FAFF-1178 and FAFF-1210:

| Trust input | `require_pinned_governor` | `verifyGrant` on a governed run |
|---|---|---|
| `{ not_read: true }` | false | FAFF-1178 behaviour; never reached at FAFF-1212's legs (see below) |
| `{ read: ok }` with `present: false` (no file) | false | FAFF-1178 behaviour |
| `{ read: ok }`, flag false or omitted | false | FAFF-1178 behaviour |
| `{ read: ok }`, flag true, non-empty list | true | strict branch applies |
| `{ read: err }`, including flag true with an empty list | n/a | `trust-file-invalid` (set by `resolveAdmittedKey` step 9 and returned at `verifyGrant` step 6; fail closed) |

**Anti-pattern:** treating a trust-file read error as "strict off". Why: ADR 0135 decision 11 says every reader fails closed, and FAFF-1178 already refuses with `trust-file-invalid`. This ticket must not add a fallback around that refusal.

**Strict mode is enforced by callers that supply a trust read.** `verifyGrant` cannot tell a caller that skipped the read from one with no base ref: both pass `{ not_read: true }` and get `trust_source: "not-read"`. FAFF-1212 closes this for its three legs: a governed leg called without a trust context refuses with `trust-context-missing` and never calls `verifyGrant` with `not_read`. Any future call site that checks a governed effect with a base ref must supply a trust read the same way; `not_read` is legitimate only for a caller with no base ref (for example `audit verify` without `--base`).

**Anti-pattern:** reading the flag from anywhere but the `trust` argument (an environment variable, `.faffrc.yaml`, a local trust file). Why: the runner controls all of those; ADR 0135 decision 11 rejects every local override.

### Ungoverned runs

A run with no governance material returns `not-applicable` from FAFF-1178's step 3, before the trust input is consulted. Every piece of governance material (`declared-effects.jsonl`, `pk.json`, `governor.json`) and faff's FAFF-1140 governance-required sentinel (`<run_dir>/commissaire/governance-required.json`) is a file the runner can delete. So in a strict repository, a runner that deletes its `commissaire/` directory reaches `not-applicable`, and the merge, pr-create and branch-delete legs pass with no grant.

**Chosen:** strict mode does not refuse ungoverned runs; they stay `not-applicable`, with strict mode on or off. This is the operator's decision (Resolution comment on FAFF-1219, 2026-10-12), not a reviewer-settled call. ADR 0135 states the consequence of strict mode as "every governed merge there needs a reachable pinned governor", and decision 10 already accepts that the chokepoint only constrains a runner that goes through it. Refusing ungoverned runs would block every ungoverned merge in a strict repository, including interactive human-driven runs, and would still leave the larger route (a runner merging with its own GitHub credential) open.

**Accepted residual risk.** In a strict repository, a runner that deletes its run's `commissaire/` directory, including the FAFF-1140 sentinel, reaches `not-applicable` and passes the merge, pr-create and branch-delete legs with no grant. Strict mode does not close this route and this ticket must not claim it does. `effects reconcile-merges` (FAFF-1028) detects such a merge after the fact, and FAFF-1220 (a required status check only the governor can post) prevents it.

**Anti-pattern:** adding a strict-mode branch before FAFF-1178's step 3, or reading the trust input on an ungoverned run. Why: it reverses the operator's decision and FAFF-1178's "trust input ignored on an ungoverned run" rule.

### Failure modes

- **The failure:** FAFF-1178 ships with `require_pinned_governor` not populated (for example always false) or with step numbering that differs from its spec. **How you'd know:** the strict-on unit test for an unpinned governor grant returns `valid-grant`. **What it means:** fix the population in `resolveAdmittedKey` step 11 inside this ticket; the field is part of FAFF-1178's specified interface.
- **The failure:** an operator turns strict mode on before the first pin merges. **How you'd know:** `readTrustFile` returns `Schema` "strict mode requires at least one fingerprint", and every governed leg refuses with `trust-file-invalid`. **What it means:** expected; FAFF-1210 refuses that file by design, and FAFF-1182 sequences the human PR after the pin.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a governed run admitted by a governor whose fingerprint F is listed in the base branch's trust file
And the trust file sets require_pinned_governor = true
When verifyGrant checks a valid merge grant from that governor
Then outcome is "valid-grant" and classification is "pinned"
```

```
Given a governor run whose admission fingerprint is not listed
And the trust file sets require_pinned_governor = true with another fingerprint listed
When verifyGrant checks a genuine grant from that governor
Then outcome is "absent-or-invalid", reason "grant-not-pinned", custody "governor", classification "unpinned"
And signer_fingerprint, verdict_seq and trust_source equal the values the same call returns with strict mode off
```

```
Given an in-process run with governor.json and a matching pk.json
And the trust file sets require_pinned_governor = true
When verifyGrant checks its pr-create grant
Then outcome is "absent-or-invalid", reason "grant-not-pinned", custody "in-process", classification "in-process"
```

```
Given a trust file with require_pinned_governor = true and no governor_key_fingerprints
When the caller passes its readTrustFile result to verifyGrant for a governed run
Then outcome is "absent-or-invalid" with reason "trust-file-invalid"
```

```
Given strict mode on and a run whose pk.json was replaced by a runner-minted key with a self-signed grant
When verifyGrant checks the grant
Then the reason is "governor-key-not-admitted", not "grant-not-pinned"
```

## 6. Design decision rationale

**Where does the strict check sit?** Right after the key-failure check, it would replace later refusal reasons such as `decision-not-a-grant` and `chain-position-invalid`, and report a `verdict_seq` the verifier had not yet validated. **Chosen:** after `chokepointPermit` accepts the grant (step 8a), so every existing refusal keeps its reason and only an otherwise-valid grant becomes `grant-not-pinned`.

**Which classifications does strict mode refuse?** **Chosen:** everything except `pinned`, per the ticket and ADR 0135 decision 6.

**What does a refused result report as its classification?** A new `refused` value would lose the fact Gate 1 counting needs. **Chosen:** the real classification; the refusal is carried by `reason`.

**Does strict mode refuse ungoverned runs?** Refusing them would block every ungoverned merge, including human-driven ones, while leaving the runner's own-credential merge open. **Chosen:** no; they stay `not-applicable` (operator decision, section 4).

**Does `audit verify` change its result under strict mode?** **Chosen:** no. It already reports the flag and every record's classification; ADR 0135 decision 6 places the refusal in `merge-gate`, which acts through `verifyGrant`.

**Does the trust source (local or remote) change strict behaviour?** **Chosen:** no. `verifyGrant` acts on the trust input it is given; which transport the call sites use is FAFF-1212's decision (remote on the PR and pr-create paths, local only for git-only `--local`), and a local read is never evidence.

## 7. Open questions and assumptions

**Open questions.** None. The ungoverned-runs question was closed by the operator on 2026-10-12 (section 4).

**Assumptions.**

- **Assumes:** FAFF-1178 has merged with the interface in its spec: `verifyGrant`, `resolveAdmittedKey`, `KeyResolution.require_pinned_governor` populated from `TrustConfig.requirePinnedGovernor` when a config was read and false otherwise, `trust-file-invalid` on a read error, and `grant-not-pinned` listed in `GrantReason`. Validate: `grep -n "grant-not-pinned\|require_pinned_governor" plugin/skills/faff/bin/lib/commissaire-verify.ts` returns both, and `verifyGrant` ends with `chokepointPermit` followed by the result return.
- **Assumes:** FAFF-1212 has merged, so the merge, pr-create and branch-delete legs call `verifyGrant` and refuse on `absent-or-invalid` with its reason. FAFF-1212 blocks FAFF-1219 in Linear, so the build should not start before it lands. Validate: `grep -n "verifyGrant" plugin/skills/faff/bin/lib/merge-gate.js`; if it returns nothing, park the build rather than shipping the function change without the leg-level tests.

## 8. Done

### From why
- [ ] With `require_pinned_governor = true`, `verifyGrant` refuses every governed grant whose classification is not `pinned` with reason `grant-not-pinned`.
- [ ] With the flag false or omitted, the file absent, or the trust input `not_read`, every `verifyGrant` result equals FAFF-1178's result for the same inputs (a table-driven test compares full result objects across the existing FAFF-1178 test matrix with and without the strict-off trust file).

### From what
- [ ] `grant-not-pinned` is returned by `verifyGrant`; no new function, field or argument is added.
- [ ] A strict refusal reports the resolved `custody`, `classification` (`unpinned` or `in-process`), `signer_fingerprint`, `verdict_seq` and `trust_source`.

### From how
- [ ] Strict mode never changes an existing refusal: with strict on, a governed run with no verdict for the step still reports `no-verdict-for-step`, a swapped `pk.json` still reports `governor-key-not-admitted`, an unpinned run whose latest verdict is a deny still reports `decision-not-a-grant`, and an orphaned unpinned grant still reports `chain-position-invalid`.
- [ ] Strict mode with an empty fingerprint list yields `trust-file-invalid` on a governed run.
- [ ] An ungoverned run with strict mode on, including a run whose `commissaire/` directory was deleted, returns `not-applicable`; a test asserts it, so the accepted residual risk is pinned rather than accidental.
- [ ] A pinned grant passes with strict mode on, from both a `local-ref` and a `remote-base` trust read.
- [ ] No code path reads `require_pinned_governor` from anywhere but the `trust` argument.

### From scenarios and acceptance criteria
- [ ] Tests cover strict on, strict off, trust file absent, and strict on with an empty list.
- [ ] With strict mode on, the merge, pr-create and branch-delete legs each refuse an unpinned governor grant and an in-process grant with reason `grant-not-pinned`, and pass a pinned grant (leg-level tests, after FAFF-1212).
- [ ] `npm run build` in `plugin/skills/faff` regenerates the `.js` emit and `build-manifest.json`; `faff regions check` and the full test suite pass.

### Integration smoke test

```
1. Temp repo with .commissaire/trust.toml on main: governor_key_fingerprints = [F], require_pinned_governor = true; commit.
2. Admit an in-process run in that repo and record a merge grant.
3. verifyGrant(run, unit, "merge", {kind: "merge", target: "main"}, readTrustFile(local main))
   EXPECT outcome "absent-or-invalid", reason "grant-not-pinned", classification "in-process".
4. Change the file to require_pinned_governor = false; commit; repeat step 3.
   EXPECT outcome "valid-grant", classification "in-process".
```

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "assumes"}, {"marker": "assumes"}]}
```