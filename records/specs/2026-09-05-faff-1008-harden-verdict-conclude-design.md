# Spec: harden `commissaire verdict conclude` (FAFF-1008)

> Spec: faffter-dark-nlspec · 2026-09-05 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1008.

This is a build-ready nlspec for Linear issue FAFF-1008, "Harden commissaire verdict conclude: ledger-derived contract_revision, override-dir pk_fingerprint cross-check, no-evidence detail + branch test". It targets the coding agent that will implement the change and the human reviewer who gates it. Everything lives in one function, `cmdTerminalVerdict` (the `verdict conclude` handler) in `plugin/skills/faff/bin/lib/commissaire.js`, plus its fixtures in `test/commissaire.test.mjs`. The three hardenings are grouped because they touch the same function and ship together; none is a live correctness break today.

## 1. WHY: problem and principles

**The load-bearing model.** `verdict conclude` is the only operation that mints the terminal `accepted_under_contract` record: the Ed25519-signed governor statement that an issue's evidence is complete and admissible. It works from two independent sources that are meant to describe the same admission: the append-only ledger (the signed evidence trail) and the two override directories (`--producer-dir`, holding the producer admission file; `--governor-dir`, holding the governor's SK and public-key fingerprint). Today the handler trusts the live override files for two facts it could instead read off the evidence itself, and it never re-checks that the two override directories belong to the same admission. Both gaps are latent: each record still carries its own signed `contract_revision`, and the terminal record is still validly signed, so audit verify stays sound. The cost is a record that can mislabel its evidence or pass conclude-time checks only to fail later at audit, which is the opposite of the fail-closed posture the rest of the facade takes.

**Problem statement.** `verdict conclude` stamps the terminal record's `contract_revision` from the live admission file and never cross-checks the admission's public-key fingerprint against the governor's, so a mid-issue re-admission can mislabel the evidence and a deliberately mismatched pair of override dirs can produce a record that only fails at audit; separately, the truly-absent-named-producer refusal path carries no detail and has no test. This change derives `contract_revision` from the ledger, cross-checks the fingerprints at conclude time, and closes the untested branch. The result is a terminal record that labels its evidence from the evidence, refuses fail-closed when the two custodians disagree, and reports every refusal with the same shape.

**Design principles.**

**Fail closed at the point of decision, not at audit.** Every precondition `verdict conclude` can check, it must check before it signs. A record that satisfies conclude's own preconditions but fails audit verify is a defect in conclude, because the facade's contract is that a produced terminal record is admissible. The pk_fingerprint cross-check exists precisely to move a detectable inconsistency from audit time back to conclude time.

**Prefer the signed evidence over the live custodian file.** Where a fact is recorded in the append-only, signed ledger and also in a producer-writable override file, the ledger is the source of truth. This mirrors FAFF-978's existing rule for the governor public key (`verifyAuthLeg` prefers the governor file and treats the producer-dir `pk.json` as the less-trusted custodian). Applied here: the terminal record's `contract_revision` comes from the issue's own ledger entries, not from whatever the live admission file currently says.

**Refuse rather than guess when the evidence is ambiguous.** When the issue's ledger entries do not agree on a single `contract_revision`, there is no honest label to stamp; conclude must refuse (a governed refusal, exit 0), never silently pick one. This matches the existing `ambiguous-producer` refusal, which refuses rather than picking a producer when the evidence names more than one.

**Minimal change, existing paths untouched.** The idempotent re-conclude, the escape check, and every existing refusal path keep their current behaviour and precedence. New gates are added after the existing ones so the FAFF-828/977/978/980/1000 fixtures stay green. The terminal record stays Ed25519-signed by the governor; the signing call is not touched.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.js` `cmdTerminalVerdict` | JavaScript (Node) | The `verdict conclude` handler; the sole edit site for the three code hardenings. Shipped by FAFF-1000. |
| `plugin/skills/faff/bin/lib/commissaire.js` `refuseVerdict` | JavaScript (Node) | The shared refusal emitter: `refuseVerdict(reason, issue, detail)` prints `{ verdict:"refused", reason, issue, ...detail }` and returns exit 0 for every governed refusal, exit 2 only for `no-governor`. |
| `plugin/skills/faff/bin/lib/commissaire.js` `verifyAuthLeg` | JavaScript (Node) | The audit-time canonical pk_fingerprint cross-check to mirror (pushes reason `pk-fingerprint-tampered` when the producer-dir key does not match the governor's fingerprint). |
| `plugin/skills/faff/bin/lib/commissaire.js` `cmdAdmit` | JavaScript (Node) | Writes the admission file (`producers/<id>.json`) with `pk_fingerprint`, and the governor file with `pk_fingerprint`; establishes the field names the cross-check compares. |
| `test/commissaire.test.mjs` (the `FAFF-1000 verdict conclude` fixtures) | JavaScript (Node test runner) | Where the new fixture is added and where the existing refusal fixtures must stay green. |

**Scope statement.** This is a set of three non-blocking robustness/security/observability follow-ups to the FAFF-1000 `verdict conclude` handler, wholly contained in `cmdTerminalVerdict` and its fixtures; it changes no other verb, no on-disk record schema, and no signing.

## 2. OUT OF SCOPE

- **Negative `outcome_rejected` records.** A refusal still writes nothing to the ledger. The three new/changed refusal paths follow the same rule. Extension point: a future issue would add a signed negative terminal record type to `cmdTerminalVerdict` and `appendCommissaireRecord`.
- **`verifyAuthLeg` / `audit verify` changes.** The audit-time cross-check already exists and is correct; this issue does not alter it. The conclude-time check mirrors it, it does not replace it. Extension point: none needed; the two seams stay independent by design.
- **Re-signing or key rotation on re-admit.** Detecting a mid-issue re-admission is in scope only insofar as the terminal record must label evidence by the ledger's revision. Reconciling or rotating keys across a re-admission is a separate concern owned by `cmdAdmit --force`. Extension point: `cmdAdmit`.
- **Changing the signing of the terminal record.** The governor SK signature is untouched; `contract_revision` is signed metadata, not a key input. Extension point: none.
- **The bare-issue `no-evidence` refusal (empty ledger for the issue).** That path has no producer to name and is left as-is. Only the named-but-absent-producer branch gains a detail. Extension point: none.
- **New CLI flags or output fields on the success path.** The `accepted_under_contract` success JSON is unchanged. Extension point: none.

## 3. WHAT: vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| admission file | `producers/<producer_id>.json` under `--producer-dir`; the live record `cmdAdmit` wrote, carrying `contract_revision`, `pk_fingerprint`, `status`, `key_hex`. Producer-writable custodian. |
| governor file | `governor.json` under `--governor-dir`; carries `sk`, `pk`, `pk_fingerprint`, `master_secret`. The signing custodian. |
| ledger revision | The distinct set of `contract_revision` values across the issue's own ledger entries. Normally a single value; more than one means the evidence spans revisions. |
| governed refusal | A refusal `verdict conclude` returns via `refuseVerdict`, printing `{ verdict:"refused", ... }` and exiting 0. Distinct from the `no-governor` setup error, which exits 2. |

**The two facts read from the admission file today.** `cmdTerminalVerdict` reads the admission once and uses two fields from it when building the terminal record:

```
RECORD Admission (producers/<id>.json, written by cmdAdmit):
  producer_id: String
  contract_revision: String        # today: source of the terminal record's label
  pk_fingerprint: String           # today: never cross-checked at conclude time
  status: "admitted" | "revoked"
  key_hex: String
  admitted_scope: Array<String>
  admitted_at: String
```

**The terminal record body (shape unchanged; one field's source changes).**

```
RECORD TerminalBody (built in cmdTerminalVerdict, signed by appendCommissaireRecord):
  kind_of_entry: "accepted_under_contract"
  issue: String
  step: "conclude"
  payload:
    producer_id: String
    contract_revision: String      # CHANGE: now the ledger-derived revision, not admission.contract_revision
    evidence_seq_range: [Int, Int]
    escapes_checked: true
```

The record envelope's `contract_revision` argument to `appendCommissaireRecord(runDir, gov.sk, producerId, <revision>, body, ts)` changes the same way: from `admission.contract_revision` to the ledger-derived revision. Both the envelope field and `payload.contract_revision` take the derived value; they must agree.

**Refusal reasons (existing plus two new).**

| reason | detail | exit | status |
|---|---|---|---|
| `no-evidence` (bare issue: zero entries) | none | 0 | unchanged |
| `no-evidence` (named producer absent from ledger) | `{ producer_id }` | 0 | CHANGE: detail added |
| `ambiguous-producer` | `{ producers }` | 0 | unchanged |
| `producer-not-admitted` | `{ producer_id }` | 0 | unchanged |
| `unreconciled-escape` | `{ escapes }` | 0 | unchanged |
| `pk-fingerprint-mismatch` | `{ producer_id, producer_pk_fingerprint, governor_pk_fingerprint }` | 0 | NEW (item 2) |
| `ambiguous-contract-revision` | `{ contract_revisions }` | 0 | NEW (item 1) |
| `no-governor` | none | 2 | unchanged (setup error) |

**Design decision (contract_revision source).** Derive from the ledger; do not read the live admission for the label; do not cross-check the derived value against the live admission. **Chosen:** the terminal record's `contract_revision` (both the envelope field and `payload.contract_revision`) is the single distinct `contract_revision` across the issue's ledger entries; a mismatch between that derived value and the live admission's `contract_revision` is the legitimate re-admit case this fix exists to label correctly, so it is not an error.

**Design decision (divergent ledger revisions).** **Chosen:** when the issue's ledger entries carry more than one distinct `contract_revision`, refuse with `ambiguous-contract-revision` and detail `{ contract_revisions }` (the sorted distinct set); a governed refusal, exit 0, no ledger write. Naming mirrors `ambiguous-producer`.

**Design decision (pk_fingerprint cross-check reason).** **Chosen:** on a mismatch (or a missing fingerprint on either side), refuse with `pk-fingerprint-mismatch`; a governed refusal, exit 0. The name states the observation (the two custodians disagree) rather than asserting intent; the audit-leg equivalent that asserts tamper stays `pk-fingerprint-tampered` in `verifyAuthLeg`, so the two seams read as sibling checks without one borrowing the other's stronger claim.

**Design decision (no-evidence detail on the named branch).** **Chosen:** the named-but-absent-producer branch refuses with `{ producer_id: flags["--producer"] }`, bringing it into line with every other refusal that carries the relevant identifier.

## 4. HOW: behaviour

**Approach.** All three items are local additions to `cmdTerminalVerdict`. The existing gate order is preserved exactly; the two new gates are inserted after the existing preconditions and before the record is built, so no existing refusal changes precedence. The one behavioural change to an existing gate is adding a detail object to the named-producer `no-evidence` return, which does not change its reason, exit code, or ledger effect.

**Confirmed current control flow of `cmdTerminalVerdict` (against FAFF-1000, commit 714c113b).**

```
PROCEDURE verdict_conclude(flags):
  1. runDir = requireRunDir(flags)                      # missing -> exit 3
  2. IF no --issue: stderr, exit 2
  3. entries = readLedgerEntries(runDir) filtered to e.issue == issue
  4. IF entries empty: refuseVerdict("no-evidence", issue)          # exit 0
  5. existing = entries.find(kind == "accepted_under_contract")
     IF existing: print { accepted_under_contract, idempotent:true, seq }, exit 0
  6. producerIds = distinct non-null, non-"-" producer_id over entries
  7. resolve producerId:
       IF --producer given:
         IF NOT producerIds.includes(--producer): refuseVerdict("no-evidence", issue)   # <-- item 3 target
         producerId = --producer
       ELSE IF producerIds.length == 1: producerId = producerIds[0]
       ELSE: refuseVerdict("ambiguous-producer", issue, { producers: producerIds })
  8. admission = readJson(producers/<producerId>.json under --producer-dir)
     IF absent OR status == "revoked": refuseVerdict("producer-not-admitted", issue, { producer_id })
  9. escapeResult = computeEscapes(entries, issue)
     IF any_escape: refuseVerdict("unreconciled-escape", issue, { escapes })
  10. gov = readJson(governor.json under --governor-dir)
      IF absent: refuseVerdict("no-governor", issue)                # exit 2 setup error
  11. body = { accepted_under_contract, issue, step:"conclude",
               payload: { producer_id, contract_revision: admission.contract_revision, evidence_seq_range, escapes_checked:true } }
  12. record = appendCommissaireRecord(runDir, gov.sk, producerId, admission.contract_revision, body, --ts)
  13. print { accepted_under_contract, issue, producer_id, seq }, exit 0
```

**Target control flow after this change.** Item 3 modifies step 7's named branch. Items 2 and 1 insert new gates between step 10 and step 11. Steps 11 and 12 change their `contract_revision` source.

```
PROCEDURE verdict_conclude(flags):    # steps 1-6 unchanged
  7. resolve producerId:
       IF --producer given:
         IF NOT producerIds.includes(--producer):
             refuseVerdict("no-evidence", issue, { producer_id: flags["--producer"] })     # item 3: detail added
         producerId = --producer
       ...unchanged...
  8-10. unchanged (producer-not-admitted, unreconciled-escape, no-governor)

  # --- item 2: pk_fingerprint cross-check (fail closed at conclude time) ---
  10a. IF admission.pk_fingerprint == null
         OR gov.pk_fingerprint == null
         OR admission.pk_fingerprint != gov.pk_fingerprint:
         refuseVerdict("pk-fingerprint-mismatch", issue,
           { producer_id: producerId,
             producer_pk_fingerprint: admission.pk_fingerprint ?? null,
             governor_pk_fingerprint: gov.pk_fingerprint ?? null })      # exit 0

  # --- item 1: derive contract_revision from the ledger ---
  10b. revs = distinct(entries.map(e => e.contract_revision).filter(x => x != null))
  10c. IF revs.length > 1:
         refuseVerdict("ambiguous-contract-revision", issue,
           { contract_revisions: sorted(revs) })                        # exit 0
  10d. concludedRevision = revs.length == 1 ? revs[0] : admission.contract_revision
       # revs is empty only if no issue entry carries a revision (not a governed run); fall back to the
       # admission's so a non-governed edge cannot crash conclude. In the governed path revs.length == 1.

  11. body.payload.contract_revision = concludedRevision                 # was admission.contract_revision
  12. record = appendCommissaireRecord(runDir, gov.sk, producerId, concludedRevision, body, --ts)
  13. unchanged
```

**Behaviour summary of the re-admit case.** A producer admitted under `r1`, whose issue evidence was all signed under `r1`, is re-admitted under `r2` mid-issue (the live admission file now says `r2`). If no further evidence is written, the issue's ledger entries are all `r1`; conclude derives `r1` and labels the terminal record `r1` (correct), ignoring the live `r2`. If new evidence is then written under `r2`, the issue's entries carry both `r1` and `r2`; conclude refuses with `ambiguous-contract-revision` rather than pick one, because there is no single honest label.

**Edge cases and precedence.**

- The pk_fingerprint gate runs only after `no-governor` has confirmed `gov` is present, so `gov` is non-null when its fingerprint is read.
- A missing `pk_fingerprint` on either side is treated as a mismatch (fail closed), not skipped. `cmdAdmit` always writes both, so in practice this catches a hand-tampered or truncated file.
- The `ambiguous-contract-revision` gate reads all of the issue's entries, not only the resolved producer's, per the issue's "require all entries for the issue to share one revision".
- Precedence is: existing refusals first (no-evidence, ambiguous-producer, producer-not-admitted, unreconciled-escape, no-governor), then pk-fingerprint-mismatch, then ambiguous-contract-revision. This keeps every existing fixture's observed refusal unchanged.
- Every new refusal writes nothing to the ledger (via `refuseVerdict`, which never appends).

**Anti-pattern:** cross-checking the ledger-derived revision against `admission.contract_revision` and refusing on a mismatch. Why: the mismatch is exactly the legitimate re-admit case this change exists to label correctly; refusing there would break the normal re-admit flow the ticket calls out.

**Anti-pattern:** reusing the audit-leg reason `pk-fingerprint-tampered` for the conclude-time refusal. Why: conclude observes a mismatch between two custodians it was handed; it does not establish tamper. Keep the stronger word to the audit leg that earns it.

**Anti-pattern:** moving the new gates ahead of the existing preconditions to "check cheap things first". Why: it reorders observable refusals and risks flipping an existing fixture's reason (for example, a run that today refuses `unreconciled-escape` must not start refusing `pk-fingerprint-mismatch`).

**Failure modes.**

- **The failure:** the divergence check derives an empty revision set (no issue entry carries `contract_revision`) and the `revs.length > 1` guard passes vacuously, so a non-governed or malformed run reaches the record build. How you'd know: `revs.length == 0` at step 10b. What it means: narrow, do not abandon. The fallback at 10d uses the admission's revision, matching today's behaviour, so a non-governed edge is no worse than before; the governed path always has exactly one revision. This is why the guard is `> 1`, not `!= 1`.
- **The failure:** the pk_fingerprint cross-check gives false confidence because both files were tampered to agree. How you'd know: `audit verify` still fails, because it re-derives the fingerprint from the actual public key rather than trusting the stored `pk_fingerprint`. What it means: proceed. The conclude-time check is a fail-closed convenience that catches the common mismatched-dirs case early; the audit leg remains the authority, exactly as the two-seam design intends.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Two of the three items clear the complexity bar (a new refusal with a non-obvious observable). Item 3's added detail is asserted in DONE and its new fixture rather than as a scenario, to avoid restating the checklist.

```
Given an issue whose ledger entries all carry contract_revision r1,
  and whose producer's live admission file has since been re-admitted to r2
When verdict conclude runs for that issue
Then the appended accepted_under_contract record's payload.contract_revision is r1
  and the record envelope's contract_revision is r1
  and the record is Ed25519-signed by the governor and audit verify classifies it verified
```

```
Given a producer admission whose pk_fingerprint differs from the governor file's pk_fingerprint
When verdict conclude runs for that issue
Then it refuses with reason "pk-fingerprint-mismatch"
  and exit code is 0
  and no accepted_under_contract record is written
```

- The conclude-time pk_fingerprint refusal MUST fire before the record is signed, not at a later audit verify.
- Every new refusal MUST leave the ledger byte-identical to its pre-call state.

## 6. Design decision rationale

**Where does the terminal record's `contract_revision` come from?**
Options: (a) the live admission file, as today; (b) the issue's ledger entries. Option (a) mislabels evidence when the producer is re-admitted under a new revision mid-issue, because the live file no longer matches what the evidence was signed under. Option (b) reads the label from the signed evidence itself. **Chosen:** (b), the single distinct `contract_revision` across the issue's ledger entries, applied to both the envelope field and `payload.contract_revision`. Rationale: the ledger is the signed source of truth; this mirrors FAFF-978's rule that the signed/governor source outranks the producer-writable custodian.

**Should the derived revision be cross-checked against the live admission?**
Options: (a) refuse on any derived-vs-admission mismatch; (b) ignore the admission's revision entirely for labelling. Option (a) would refuse the exact re-admit case this fix is meant to label. **Chosen:** (b). A mismatch between the ledger-derived revision and the live admission is expected in the re-admit scenario and is not an error; only disagreement among the ledger's own entries is.

**What happens when the ledger's own entries disagree on the revision?**
Options: (a) pick one (for example the admission's, or the max); (b) refuse. Silently picking violates the "refuse rather than guess" principle and would stamp a record whose label does not describe all its evidence. **Chosen:** (b), a new `ambiguous-contract-revision` governed refusal, exit 0, detail `{ contract_revisions }`. Rationale: it is the honest fail-safe and it mirrors `ambiguous-producer`.

**Where does the pk_fingerprint cross-check live and what does it refuse with?**
Options for placement: at conclude time, at audit time only (status quo), or both. Audit-only means a record that passes conclude's preconditions can still fail audit, which contradicts the fail-closed posture. **Chosen:** add the check at conclude time (after `no-governor`, before build) while leaving the audit-leg check in place. Options for the reason string: reuse `pk-fingerprint-tampered`, or a distinct `pk-fingerprint-mismatch`. **Chosen:** `pk-fingerprint-mismatch`, because conclude observes disagreement between two custodians it was handed and does not establish tamper; the audit leg keeps the stronger word. Detail carries `producer_id` and both fingerprints for auditability (fingerprints of public keys are not secret).

**Which fingerprint pair is compared?**
The admission file (`producers/<id>.json`) carries `pk_fingerprint` written by `cmdAdmit`, and the governor file carries `pk_fingerprint`. **Chosen:** compare `admission.pk_fingerprint` against `gov.pk_fingerprint` directly; a null on either side is treated as a mismatch (fail closed). Rationale: the goal is that the producer admission and the governor that will sign the terminal record belong to the same admission; comparing the two stored fingerprints answers exactly that without re-deriving from key material, which the audit leg already does.

**What detail does the named-but-absent-producer `no-evidence` carry?**
Options: leave it bare, or add `{ producer_id }`. Every other refusal carries the relevant identifier. **Chosen:** `{ producer_id: flags["--producer"] }`. The bare-issue `no-evidence` (empty ledger) stays detail-free because there is no producer to name.

**Gate ordering.**
**Chosen:** insert the two new gates after all existing preconditions and before the record build, preserving the exact observable refusal of every existing run. Rationale: the constraint is that FAFF-828/977/978/980/1000 fixtures stay green; adding gates only after the existing ones guarantees no existing run flips its reason.

At the time of writing, this builds directly on FAFF-1000's `cmdTerminalVerdict` (commit 714c113b, PR #862); the function does not exist on branches that predate that merge.

## 7. Open questions and assumptions

**Open questions.** None. Every decision is closed with a `**Chosen:**` marker above.

**Assumptions.**

- **Assumes:** FAFF-1000's `cmdTerminalVerdict` (commit 714c113b, PR #862) is present on the base branch this work builds from. Validation: before editing, confirm `plugin/skills/faff/bin/lib/commissaire.js` contains `function cmdTerminalVerdict` with the `refuseVerdict` helper and the `readLedgerEntries(runDir).filter((e) => e.issue === issue)` line; if it is only the boundary-stub form (delegating to `events anchor`), FAFF-1000 has not landed and this spec has no target function.
- **Assumes:** `cmdAdmit` writes `pk_fingerprint` into both the admission file and the governor file, and every schema:3 ledger entry carries `contract_revision`. Validation: read `cmdAdmit` (`writeJson(producerFileOf(...))` includes `pk_fingerprint`; `writeJson(governorFileOf(...))` includes `pk_fingerprint`) and `buildEnvelope` (sets `contract_revision` on every record). Both hold at commit 714c113b.
- **Assumes:** `contract_revision` on a commissaire record is signed metadata, not a key input to signature verification. Validation: `appendCommissaireRecord` signs via `signDecision(rec, sk)` over the whole envelope and `verifyDecision` checks that Ed25519 signature; no key is derived from `contract_revision` for commissaire records. Confirmed at commit 714c113b. This is why relabelling `contract_revision` keeps the record validly signed.

## 8. DONE: definition of done

### From WHY
- [ ] A re-admit mid-issue no longer mislabels the terminal record: with all ledger entries under `r1` and a live admission re-admitted to `r2`, the appended `accepted_under_contract` record carries `contract_revision: "r1"` in both the envelope and `payload`.
- [ ] A conclude-time custodian mismatch is caught at conclude, not deferred to audit verify.

### From WHAT (types and refusal table)
- [ ] `payload.contract_revision` and the `appendCommissaireRecord` envelope argument both take the ledger-derived revision; they are equal.
- [ ] The named-but-absent-producer `no-evidence` refusal prints `{ verdict:"refused", reason:"no-evidence", issue, producer_id:<name> }`.
- [ ] `pk-fingerprint-mismatch` refusal prints `{ verdict:"refused", reason:"pk-fingerprint-mismatch", issue, producer_id, producer_pk_fingerprint, governor_pk_fingerprint }`, exit 0.
- [ ] `ambiguous-contract-revision` refusal prints `{ verdict:"refused", reason:"ambiguous-contract-revision", issue, contract_revisions:[...] }`, exit 0.

### From HOW (behaviour)
- [ ] Ledger-derived revision: exactly one distinct `contract_revision` over the issue's entries is used; the live admission's revision is not used to label when the ledger has a single revision.
- [ ] More than one distinct `contract_revision` over the issue's entries refuses with `ambiguous-contract-revision`; nothing is appended.
- [ ] `admission.pk_fingerprint !== gov.pk_fingerprint` (or either null) refuses with `pk-fingerprint-mismatch` before the record is built; nothing is appended.
- [ ] The pk_fingerprint gate runs after the `no-governor` check (gov is non-null when its fingerprint is read).

### From HOW (edge cases and precedence)
- [ ] Empty ledger-revision set (no issue entry carries a revision) does not crash and does not refuse `ambiguous-contract-revision` (the guard is `> 1`); the admission revision is the fallback.
- [ ] Existing refusal precedence is unchanged: a run that refused `unreconciled-escape`, `ambiguous-producer`, `producer-not-admitted`, or `no-governor` before this change refuses with the same reason after it.
- [ ] Every new and changed refusal leaves the ledger byte-identical (no `accepted_under_contract` record written).

### From tests
- [ ] A new fixture names a producer with zero ledger entries for the issue (admit P1, declare P1 on the issue, conclude `--producer GHOST`) and asserts `{ verdict:"refused", reason:"no-evidence", producer_id:"GHOST" }`, exit 0, and no `accepted_under_contract` record.
- [ ] A fixture covers the ledger-derived revision on re-admit (asserts the terminal record's `contract_revision` is the ledger value, and audit verify classifies it verified).
- [ ] A fixture covers `ambiguous-contract-revision` (two distinct revisions among the issue's entries).
- [ ] A fixture covers `pk-fingerprint-mismatch` (admission and governor fingerprints deliberately differ).
- [ ] The FAFF-828, FAFF-977, FAFF-978, FAFF-980, and FAFF-1000 fixtures remain green.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. admit P1 under contract-revision r1 (--producer-dir PD, --governor-dir GD)
  2. declare + request-decision(grant) + observe P1 on ISSUE under r1
  3. verdict conclude --run-dir RUN --issue ISSUE
     EXPECT { verdict:"accepted_under_contract", producer_id:"P1" }, exit 0
     EXPECT the appended record.payload.contract_revision == "r1"
     EXPECT audit verify --run-dir RUN classifies the record "verified"
```

confidence: high
build-tier: complex
