# Spec — FAFF-843: Implement `foldCorrectiveAuthority` — digest-custody basis grants corrective Channel A

> Spec: faffter-dark-nlspec · 2026-08-17 · autonomous · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-843.

This is the build spec for FAFF-843, the follow-on implementation ticket for the FAFF-833 spike (Done; ADR-0114 merged on PR #692). Audience: the build agent implementing the fold and its wiring, and the human reviewers who will accept it. FAFF-833's spec is the fixed build contract and ADR-0114 is its ratified decision; this spec builds to them verbatim — the five-branch fold table is fixed — and does not re-litigate the decision. This revision corrects the manifest-provenance/timing plumbing (the load-bearing custody question), adds the missing born-verifiable scenarios, and fixes one import bug, all grounded against the shipped code cited in the reference table.

## 1. WHY — Problem and principles

**The load-bearing idea.** The corrective consumer has two integrity bases that differ in kind. The *mount* basis (`FAFF_INTEGRITY_BOUNDARY`, ADR-0061) is preventive: the build lane structurally cannot write the forge surface, so an artifact on disk is authentic by construction. The *digest-custody* basis (`integrity-digest`, FAFF-518, ADR-0073 decision 5) is detective: the build lane can write anything, but the trusted dispatcher snapshots the evidence set before dispatch, holds the manifest in its own conversation context, and re-verifies on return, refusing to consume on mismatch. FAFF-843 admits the detective basis into the corrective authority decision at a *new, separate composition point* — a pure fold on the consumer side that combines the two independent basis results into one decision — so Channel A becomes reachable in-session without the deferred mount.

**What the custody verify actually attests (the correction that governs the plumbing).** A corrective artifact's authenticity comes from *trusted orchestrator/Sentry authoring* at the between-units boundary, never from a verify run at consumption time. The custody verify's one job is to attest that the *untrusted build lane* did not forge the `corrective/` surface during its dispatch — which the obligation-5 on-return verify already establishes, cleanly, before the corrective input is consumed. The fold therefore consumes the run-grain custody baseline that spanned the last untrusted dispatch and was re-baselined across the trusted `corrective author` write — not a fresh snapshot taken at the dispatch boundary.

**Problem statement.** Today `cmdCorrectiveCheck` calls `integrityGate(probe, "corrective")` alone (corrective.js:461), which returns `trusted` only on `basis === "asserted"` (corrective-integrity.js:135). Under ADR-0073 no launcher can truthfully declare `FAFF_INTEGRITY_BOUNDARY` in-session, so that gate always degrades to `channel-D`, leaving Channel A built but unreachable. FAFF-843 wires the already-shipped custody verify into the corrective decision through `foldCorrectiveAuthority`, granting `custody-trusted` when the held baseline verifies clean.

**Design principles.**

- **Two bases, never conflated.** `integrity-digest.js` must never reference `integrityGate` or `FAFF_INTEGRITY_BOUNDARY`, and `integrityGate` must never take a custody input. The fold lives on the consumer side (`corrective.js`), which already imports both primitives. `integrity-digest.js`'s boundary selftest (integrity-digest.js:439-444) enforces the non-reference at the code level and must keep passing.
- **Detective is weaker than preventive, and the record must say so.** A grant on the detective basis is recorded under a distinct, weaker label (`custody-trusted` / `digest-verified`).
- **A verify that cannot be computed must never read as clean.** `diffAgainstManifest` throws by design when the hasher is unresolvable or a member is unreadable (integrity-digest.js:57-64, 70-74). That throw maps to a `refuse` decision, never caught-and-defaulted to empty diffs — the un-computable path is reachable under the accepted tool-poisoning residual.
- **A trusted-authored input is never spuriously flagged as tamper.** The manifest the fold verifies against must (a) span an untrusted dispatch (else the verify is hollow — a snapshot-then-immediately-verify rubber-stamp) and (b) already contain the trusted-authored corrective artifact in its baseline (else the new artifact reads as `(added)` → false tamper). Obligation-5's Class-A re-baseline for `corrective author` is what satisfies both at once.
- **Fail-safe when custody is absent.** No held baseline degrades to `channel-D` (byte-identical to today), never to trust. A detected tamper degrades to `refuse`, never `channel-D`.
- **Width is set by provenance, not by the integrity basis.** ADR-0039's subtractive-only limit is a function of the machine-authored input's lack of human-gated provenance. The custody grant authorizes exactly the same op-set as mount `trusted`; the narrowing is entirely in the label plus the verify-at-consumption precondition.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/corrective.js` | JavaScript | `cmdCorrectiveCheck` (line 428); `corrective author` reports the written file's `sha256` (line 414, 420); authoring/consumption run at the orchestrator lane, between-units (comment at 283-285). `foldCorrectiveAuthority` is added here |
| `plugin/skills/faff/bin/lib/corrective-integrity.js` | JavaScript | `integrityGate(probe, "corrective")` (line 133), `correctiveIntegrityProbe` (line 102), `correctiveIntegrityDirs` (line 168) — the mount-basis primitives |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | JavaScript | `diffAgainstManifest` (line 152; **exported** at line 452; returns diff array; a new `corrective/` sub-file reads as `(added)` per line 168; throws on unresolvable hasher / unreadable member); `readManifestArg` is **internal, NOT exported** (line 176). Boundary selftest (lines 439-444) |
| `plugin/skills/faff/bin/lib/sentry.js` | JavaScript | `sentryReadCorrectiveAuthority` (line 780) — mount-only binary reader; `evaluateDerailment`'s authority-gated `correct` upgrade (line 666) |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript | `eventViolations` — only `agent-dispatch` has a top-level `data.*` allow-set (lines 193-210); `corrective-consumed` `data` is unconstrained, so a new `basis` field is additive with no schema bump |
| `plugin/skills/faff/bin/faff` | JavaScript | entrypoint re-export block (lines 296-300) — tests import cores from here; `foldCorrectiveAuthority` must be added |
| `plugin/skills/faff/SKILL.md` | Markdown | obligation 5 (line 1164): the run-grain custody chain, the on-return verify, and the **Class-A re-baseline sequence** that names `corrective author` as a `corrective/`-file write reporting its `sha256` |
| `plugin/skills/faff-beep-boop/SKILL.md` | Markdown | line 118: `correct` handling — `sentry abort` + `corrective author` at the between-units checkpoint, re-dispatch consumes via `corrective check` |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` | Markdown | the sequential executor's per-unit bracket and the re-dispatch `constraints` corrective-check — the `--manifest` threading site |
| `test/corrective.test.mjs` | JavaScript (node:test) | existing corrective test harness (`runCli`, direct core imports) — the home for the five-branch unit coverage |
| `records/adr/0114-…detective-authority.md` | Markdown | the ratified decision; already authored & cross-referenced. FAFF-843 references it, authors no new ADR |

**Scope statement.** This is the consumer-side wiring that turns ADR-0114's decision into shipped code: the fold, the `--manifest` input, the event `basis` field, and the sequential-executor threading — sequential-only at v1.

## 2. OUT OF SCOPE

- **Authoring a new ADR.** *Why excluded:* ADR-0114 was authored and merged docs-only on PR #692, with reciprocal `Amended:` back-links already present in ADR-0039, ADR-0061, and ADR-0073 (verified in-repo). *Extension point:* none — FAFF-843 references ADR-0114. This AC is already satisfied.
- **Modifying `integrityGate` or `integrity-digest.js` to reference each other.** *Why excluded:* the two documented anti-patterns; either breaks ADR-0061's non-conflation and the boundary selftest. *Extension point:* the fold on the consumer side.
- **Modifying `integrity-digest.js` at all.** *Why excluded:* the DoD requires its boundary selftest to keep passing unchanged; `corrective.js` imports only the already-exported `diffAgainstManifest` and parses the `--manifest` arg with a local helper. *Extension point:* none needed.
- **The sentry poller's automated `correct`-upgrade under custody.** `evaluateDerailment` upgrades `fix-review-thrash` to `correct` only when `authority === "available"` (sentry.js:666), read from the mount-only `sentryReadCorrectiveAuthority` (sentry.js:991). The detached poller structurally cannot hold the orchestrator's in-context baseline. *Why excluded:* out of FAFF-843's deliverables; the same single-writer reason parallel custody is deferred. *Extension point:* a named follow-on that gives the poller a custody signal it can read; until then corrective inputs reach the custody-consumption path via the orchestrator's own between-units `correct` handling (beep-boop:118), direct `faff corrective author`, or the FAFF-328 trial.
- **Parallel-executor custody.** *Why excluded:* the concurrency slot's in-flight orchestrator writes between snapshot and verify would false-positive as tampering. *Extension point:* a future ticket mirroring ADR-0039's per-run-at-v1 / fleet-deferred split; the fold contract already accepts it unchanged once a per-writer bracket exists.
- **Re-testing FAFF-518's tamper detection.** *Why excluded:* owned by `integrity-digest`'s own selftest. *Extension point:* `test/integrity-digest.test.mjs`.
- **The mount-asserted path (FAFF-517 / FAFF-834).** *Why excluded:* ADR-0073 defers process-isolated lanes. *Extension point:* the fold's branch 1 already accepts a genuine mount gate.

## 3. WHAT — Vocabulary, types, and the fold contract

**Vocabulary.**

| Term | Definition |
|---|---|
| Mount basis | Preventive: `correctiveIntegrityProbe` asserts `true` from a pid-1 `FAFF_INTEGRITY_BOUNDARY` declaration covering the forge surface |
| Digest-custody basis | Detective: a manifest snapshotted before dispatch, held in the dispatcher's context, verified clean on return via `diffAgainstManifest` |
| Custody baseline | The run-grain manifest the orchestrator holds in context across untrusted dispatches (obligation 5: `correctiveIntegrityDirs(runDir)` + `--events`), kept current across trusted writes by the Class-A re-baseline sequence |
| `custody-trusted` | The new, weaker authority disposition granted on a clean verify of the held baseline, distinct from mount `trusted` |
| Re-baseline (Class A) | Obligation-5's sanctioned sequence for folding a trusted CLI-mediated write (including `corrective author`, which reports its written file's `sha256`) into the held baseline without breaking custody lineage |
| Forge surface (corrective) | `correctiveIntegrityDirs(runDir)` — the 2-entry run set (`corrective/`, `run-ledger.json`); a subset of the obligation-5 run-grain member set |

**The composition fold — the core deliverable.** A new pure function in `corrective.js`, importing `integrityGate` (already imported, corrective.js:37) and `diffAgainstManifest` (new import from `./integrity-digest`). It does not extend `integrityGate` and does not touch `integrity-digest.js`.

```
RECORD CorrectiveAuthority:
  trusted: Bool
  disposition: ENUM { trusted, custody-trusted, refuse, channel-D }
  basis: ENUM { asserted, digest-verified, tampered, unverifiable, none }

# digestVerify is a discriminated union the CALLER constructs:
#   { held: false }                         no baseline held
#   { held: true, diffs: [] }               verify clean
#   { held: true, diffs: [<paths>, ...] }   verify reports tampered paths
#   { held: true, error: <reason> }         verify could not be computed (a throw)

PROCEDURE foldCorrectiveAuthority(mountGate, digestVerify):
  # mountGate = integrityGate(correctiveIntegrityProbe(env, fsq, dirs), "corrective")
  1. IF mountGate.trusted === true:
       RETURN { trusted: true,  disposition: "trusted",         basis: "asserted" }      # strongest wins
  2. IF digestVerify.held === true AND digestVerify.error != null:
       RETURN { trusted: false, disposition: "refuse",          basis: "unverifiable" }  # never trust an uncomputable verify
  3. IF digestVerify.held === true AND digestVerify.diffs.length === 0:
       RETURN { trusted: true,  disposition: "custody-trusted", basis: "digest-verified" }
  4. IF digestVerify.held === true AND digestVerify.diffs.length > 0:
       RETURN { trusted: false, disposition: "refuse",          basis: "tampered" }       # proven forge: never surfaced
  5. RETURN   { trusted: false, disposition: "channel-D",        basis: "none" }           # fail-safe
```

The precedence order is load-bearing: branch 2 (the error branch) sits above branches 3 and 4 so an indeterminate verify can never fall through to a grant. Branch 1 wins over any digest state.

**Anti-pattern:** `try { diffs = diffAgainstManifest(...) } catch { diffs = [] }` — defaulting a throw to empty diffs. Why: it flips a sabotaged verify (branch 2) into `custody-trusted` (branch 3). The caller must construct `{ held: true, error }` on a throw.

**Interfaces the fold plugs into.**

- **`--manifest <json|file|->` on `cmdCorrectiveCheck`.** Add `"--manifest": { arity: 1 }` to `CORRECTIVE_SPEC.flags` (corrective.js:310-316). When supplied, `cmdCorrectiveCheck` parses it via a **local** `parseManifestArg` helper (see HOW — `readManifestArg` is not exported), computes `digestVerify`, and routes through `foldCorrectiveAuthority`. When absent, `digestVerify = { held: false }` and behaviour is byte-identical to today.
- **`basis` on the `corrective-consumed` event.** The trusted-branch append (corrective.js:496-499) gains `basis` (`asserted` | `digest-verified`) and sets `disposition` from the fold result (`trusted` | `custody-trusted`) instead of the hardcoded `"trusted"`. `data` is unconstrained by `eventViolations`, so this is additive — no schema bump, no `governance-profile.js` change.
- **Entrypoint export.** Add `foldCorrectiveAuthority` to `corrective.js`'s `module.exports` (line 634) and to the `faff` entrypoint re-export (faff:296-300), so `test/corrective.test.mjs`'s `const { … } = faff` can reach it.

## 4. HOW — Behaviour

**The fold's home and imports.** `foldCorrectiveAuthority` is a pure function beside `foldCorrectiveConstraints` in `corrective.js`. Add `const { diffAgainstManifest } = require("./integrity-digest");` (factory→factory, legal per ADR-0042, exactly like the existing `corrective-integrity` require). **Do not import `readManifestArg`** — it is not in `integrity-digest.js`'s exports (verified: only `diffAgainstManifest` is exported from that pair). Instead define a small local helper in `corrective.js`, which already requires `fs`:

```
PROCEDURE parseManifestArg(val):
  IF val === "-":               RETURN fs.readFileSync(0, "utf8")   # stdin — the context-held value
  IF fs.existsSync(val):        RETURN fs.readFileSync(val, "utf8") # file (discouraged; see anti-pattern)
  RETURN val                                                        # inline JSON string
```

This keeps `integrity-digest.js` unmodified (honouring the DoD) and matches the `<json|file|->` shape the fixed contract names.

**Anti-pattern:** passing `--manifest <path>` pointing at an on-disk file the build lane can write. Why: a same-uid lane could rewrite that file to match its forgery, hollowing the basis. Callers must pass the context-held baseline via `--manifest -` (stdin) or inline JSON.

**`cmdCorrectiveCheck` changes.** Replace the single `gate.trusted` branch (corrective.js:458-467) with the fold:

```
PROCEDURE cmdCorrectiveCheck (changed region only):
  1. probe = correctiveIntegrityProbe(process.env, realFsq(), dirs)   # unchanged
     gate  = integrityGate(probe, "corrective")                        # unchanged
  2. manRaw = get("--manifest")
     IF manRaw is null OR "":
        digestVerify = { held: false }
     ELSE:
        a. try { manifest = JSON.parse(parseManifestArg(manRaw)) }
           catch -> stderr "…--manifest is not valid JSON…"; RETURN 2   # usage error, mirrors integrity-digest verify
        b. IF !manifest OR typeof manifest.members !== "object":
              stderr "…manifest has no members…"; RETURN 2
        c. try { diffs = diffAgainstManifest(runDir, manifest); digestVerify = { held: true, diffs } }
           catch (e) { digestVerify = { held: true, error: e.message } }   # THROW -> refuse/unverifiable, never clean
  3. authority = foldCorrectiveAuthority(gate, digestVerify)
  4. IF authority.trusted !== true:
        out = { run_dir, issue, disposition: authority.disposition, basis: authority.basis,
                consumed: false, inputs: mine.map(record).filter, rejected }
        print; RETURN 0                                                 # channel-D and refuse both report-and-degrade
  5. # trusted (mount or custody): fold constraints exactly as today
     parkInputs = valid.filter(park-with-cause)
     { mandate, constraints, applied } = foldCorrectiveConstraints(valid)
     append corrective-consumed with { disposition: authority.disposition, basis: authority.basis,
                                       mandate, constraints, applied, rejected, parks }   # subject to idempotency
     out = { …, disposition: authority.disposition, basis: authority.basis, consumed: true, … }
     print; RETURN 0
```

Distinguish `channel-D` (honest absence — surface for human relay) from `refuse` (proven/uncomputable failure — never surfaced) in the output. Exit stays `0` in all report cases (the region's report-and-degrade posture, corrective.js:462-467); exit `2` only for a malformed `--manifest` (caller error, mirrors integrity-digest.js:339-342).

**Idempotency and the basis field.** `foldFingerprint` (corrective.js:262) currently fingerprints `mandate` + `applied` + `rejected` + resolved `constraints`. Add `basis` to the fingerprint so a basis transition (e.g. `digest-verified` → `asserted`) records a fresh `corrective-consumed` rather than being falsely idempotent-skipped. For the prior-event comparison (corrective.js:483-486), default a missing `priorData.basis` to `"asserted"` — pre-FAFF-843 events were only appended on the mount-trusted path, so this migration never produces a spurious re-append on the first check after upgrade. The no-manifest path stays byte-identical.

**Where the manifest comes from in the sequential executor (the corrected plumbing).** This is the load-bearing fix. Grounding the flow against the shipped code:

```
Timeline for a unit X that derails and gets a Sentry `correct`:
  A. Build B_k of X dispatched. Custody baseline M held in context, snapshotted BEFORE B_k (obligation 5).
  B. B_k returns. Obligation-5 on-return verify:  faff integrity-digest verify --run-dir R --events --manifest - --json
       exit 1 (tamper) or exit 2 (unavailable) -> park the unit NOW, before any consumption (obligation 5).
       exit 0 (clean) -> the untrusted lane B_k did NOT forge corrective/ ; proceed.
  C. Between-units checkpoint (trusted orchestrator lane, no untrusted dispatch in flight; beep-boop:118):
       Sentry `correct` for X -> `faff sentry abort --issue X …` + `faff corrective author …`.
       `corrective author` is a Class-A write: run obligation-5's re-baseline sequence
       (verify old M -> perform the write -> post-write check names EXACTLY corrective/NNNN-X.json "(added)",
        matching the sha256 corrective author reports -> snapshot candidate -> Class-A intended-content check
        -> candidate M' REPLACES M). M' now contains the trusted-authored artifact; its lineage still spans B_k.
  D. Re-dispatch X: consume the corrective input against the re-baselined baseline:
       faff corrective check --run-dir R --issue X --manifest -   (pipe the context-held M', never a disk path)
       -> diffAgainstManifest(disk, M') is clean (M' contains the artifact; nothing untrusted ran since C)
       -> foldCorrectiveAuthority -> custody-trusted -> stamp constraints onto X's BuildDispatch, then dispatch B_{k+1}.
```

This is why a naive reuse of the *pre-authoring* manifest fails: `corrective author` writes a new file under the `corrective/` directory member, which `diffAgainstManifest` reports as `(added)` (integrity-digest.js:168) → `diffs.length > 0` → branch 4 `refuse`/`tampered` on a *legitimate* trusted input, killing the deliverable. And a fresh snapshot taken at consumption is a snapshot-then-immediately-verify with no untrusted dispatch in between — a hollow rubber-stamp. The re-baseline resolves both: M' contains the trusted artifact (no false `(added)`), and M''s lineage spans the last untrusted dispatch B_k (not hollow). The consumption verify (step D) is a cheap trusted-window re-confirmation that nothing changed between the re-baseline and the fold.

The executor therefore keeps the run-grain chain **open** through the `correct` handling (it does not discard the baseline between the on-return verify and the corrective consumption), consistent with obligation 5's "one continuous run-grain chain per orchestrator." In the sequential path, an untrusted forgery of the corrective surface is caught by the obligation-5 on-return verify (step B → park) *before* consumption, so the fold's `tampered`/`unverifiable` branches are reached in this executor only as belt-and-braces at the consumption instant; they are the primary path for a direct/independent `corrective check --manifest` invocation, and are unit-tested regardless.

**`faffter-noon-concurrency-sequential/SKILL.md` change.** The re-dispatch `constraints` step is threaded to consume against the re-baselined baseline: `faff corrective check --run-dir <run_dir> --issue <issue> --manifest -` (stdin, the context-held M'), branching on the returned `disposition`/`mandate` exactly as today (`trusted`|`custody-trusted` + `narrowed` → stamp constraints; `empty`|`indeterminate` → park; `channel-D`|`refuse` → no constraints, and `refuse` additionally surfaces the custody gap). The prose states the re-baseline dependency (corrective author folded into the held baseline before consumption) and refers back to obligation 5 for the chain and Class-A rules rather than restating them.

**Failure modes.**

- **A trusted-authored input is spuriously refused.** *How you'd know:* a re-dispatch after a legitimate `correct` returns `disposition:"refuse"`/`basis:"tampered"` naming `corrective/NNNN-*.json (added)`. *What it means:* the executor fed a pre-authoring manifest instead of the re-baselined M'; the deliverable is dead on the happy path. Fix the plumbing per step C/D.
- **A hollow verify rubber-stamps custody-trusted.** *How you'd know:* the manifest fed to `corrective check` was snapshotted at the dispatch boundary with no untrusted dispatch since. *What it means:* the basis provides no assurance; the manifest must be the re-baselined baseline whose lineage spans the last untrusted dispatch.
- **An indeterminate verify reads as clean.** *How you'd know:* a `corrective-consumed` event carries `basis:"digest-verified"` on a run where the hasher could not be resolved (the verify threw). *What it means:* the caller caught the throw and defaulted `diffs` to `[]`; branch 2 exists to stop this.
- **The fold launders detective as preventive.** *How you'd know:* a `corrective-consumed` event carries `basis:"asserted"` with no pid-1 declaration, or the boundary selftest fails. *What it means:* branch 1 is the only source of `basis:"asserted"`, and `integrity-digest.js` must stay untouched.

**Anti-pattern:** extending `integrityGate` to take a custody input. Why: it pulls the digest basis into the mount-basis module and invites both bases through one code path — the conflation ADR-0061/ADR-0073 forbid.

**Anti-pattern:** importing `integrityGate` or referencing `FAFF_INTEGRITY_BOUNDARY` from `integrity-digest.js`. Why: it breaks that module's boundary selftest and re-couples the detective mechanism to the mount channel.

## 5. Scenarios

Born-verifiable objectives for the five-branch fold plus its wiring. **Zero holdouts:** the acceptance criteria require builder-authored unit coverage for *every* branch, so withholding any branch would conflict with the AC; every scenario is builder-visible.

```
Given a mountGate with trusted:false and a held baseline whose verify is clean (diffs === [])
When foldCorrectiveAuthority(mountGate, { held: true, diffs: [] }) is called
Then it returns { trusted: true, disposition: "custody-trusted", basis: "digest-verified" }
```

```
Given a mountGate with trusted:false and a held baseline whose verify reports one or more paths
When foldCorrectiveAuthority(mountGate, { held: true, diffs: ["corrective/0001-X.json"] }) is called
Then it returns { trusted: false, disposition: "refuse", basis: "tampered" }
```

```
Given a mountGate with trusted:false and a held baseline whose verify could not be computed
When foldCorrectiveAuthority(mountGate, { held: true, error: "no SHA-256 tool found" }) is called
Then it returns { trusted: false, disposition: "refuse", basis: "unverifiable" }
     and cmdCorrectiveCheck builds that error union by CATCHING the diffAgainstManifest throw, never defaulting to empty diffs
```

```
Given a mountGate with trusted:false and no held baseline
When foldCorrectiveAuthority(mountGate, { held: false }) is called
Then it returns { trusted: false, disposition: "channel-D", basis: "none" }
     which is byte-identical to today's unasserted corrective behaviour
```

```
Given a mountGate with trusted:true and any digest state, including { held: true, diffs: ["…tampered…"] }
When foldCorrectiveAuthority is called
Then it returns { trusted: true, disposition: "trusted", basis: "asserted" }
     (the strongest basis wins; the digest state neither alters nor dilutes it)
```

```
Given a run dir where a corrective input was authored by the trusted orchestrator lane AFTER a build return,
      and the custody baseline was re-baselined to include that new corrective/ file (Class-A sequence)
When faff corrective check --run-dir R --issue X --manifest - is run against that re-baselined baseline
Then diffAgainstManifest reports no diffs, the fold returns custody-trusted/digest-verified,
     consumed:true, and corrective-consumed records basis:"digest-verified"
     (the trusted-authored artifact is NOT flagged as tamper)
```

```
Given the SAME run dir but the manifest fed to corrective check was snapshotted BEFORE the corrective author write
When faff corrective check --run-dir R --issue X --manifest - is run against that pre-authoring manifest
Then diffAgainstManifest reports "corrective/…-X.json (added)", the fold returns refuse/tampered, consumed:false
     (this is the mis-plumbing the executor MUST avoid: it fails safe, but kills the happy path — the anti-scenario)
```

```
Given corrective check is invoked with --manifest pointing at malformed input (invalid JSON, or no "members")
When the command runs
Then it exits 2 with a usage error, distinct from the held:false (channel-D) path
```

```
Given a prior corrective-consumed event recorded basis:"digest-verified" for issue X with an unchanged constraint set
When corrective check later folds the same constraints but under a different basis (e.g. mount now asserted, basis:"asserted")
Then foldFingerprint (now including basis) differs from the prior, so a fresh corrective-consumed is appended,
     not idempotent-skipped
```

```
Given corrective check is invoked with NO --manifest
When the command runs
Then the code path is byte-identical to today (digestVerify held:false; integrityGate alone governs; no basis change on the channel-D output)
```

## 6. Design decision rationale

**Which token names does the fold use?**
Options: (a) reuse the exact FAFF-833 / ADR-0114 contract names; (b) rename. The contract is ratified; renaming drifts from the ADR and the FAFF-328 record shape.
**Chosen:** the contract names verbatim — disposition `{trusted, custody-trusted, refuse, channel-D}`, basis `{asserted, digest-verified, tampered, unverifiable, none}`.

**What `digestVerify` does the fold consume in the sequential executor, and against which manifest?**
Options: (a) re-run `diffAgainstManifest` at the dispatch boundary against the *pre-dispatch* obligation-5 manifest; (b) take a fresh snapshot at consumption and verify it; (c) verify the run-grain custody baseline that spanned the last untrusted dispatch, re-baselined across the trusted `corrective author` write, and consume at the dispatch boundary. Option (a) false-flags the just-authored corrective file as `(added)` → `refuse`/`tampered` on the happy path — the deliverable dies (verified against integrity-digest.js:168 and the beep-boop:118 authoring timeline). Option (b) is a snapshot-then-immediately-verify with no untrusted dispatch spanned — a hollow rubber-stamp, the laundering the basis exists to prevent. Option (c) is grounded in obligation-5's Class-A re-baseline, which explicitly names `corrective author` (reporting the written file's `sha256`, corrective.js:414): the re-baselined M' contains the trusted artifact (no false `(added)`) and its lineage spans the last untrusted dispatch (not hollow).
**Chosen:** (c) — the fold verifies the re-baselined run-grain custody baseline (`--manifest -`, context-held), consumed at the dispatch boundary; the executor keeps the chain open through the `correct` handling and re-baselines the `corrective author` write per obligation 5. No pre-authoring raw manifest, no fresh-snapshot hollow verify, no second overlapping bracket.

**Where does the authority decision physically live?**
Options: (a) extend `integrityGate`; (b) a separate consumer-side fold. Option (a) is a documented anti-pattern (conflation).
**Chosen:** a separate pure fold (`foldCorrectiveAuthority`) in `corrective.js` importing both primitives; neither the mount module nor the digest module is modified to reference the other.

**How is the `--manifest` arg parsed, given `readManifestArg` is not exported?**
Options: (a) import `readManifestArg` from `integrity-digest.js`; (b) export it from `integrity-digest.js`; (c) a local helper in `corrective.js`. Verified: `integrity-digest.js` exports only `diffAgainstManifest` from the pair (line 452); `readManifestArg` is internal (line 176), so (a) resolves to `undefined` → runtime throw. Option (b) modifies `integrity-digest.js`, contradicting the DoD's "unmodified" requirement.
**Chosen:** (c) — a local `parseManifestArg` in `corrective.js` mirroring the `<json|file|->` shape, importing only the exported `diffAgainstManifest`.

**How is an uncomputable verify handled?**
**Chosen:** the caller catches the `diffAgainstManifest` throw and constructs `{held:true,error}`; branch 2's precedence guarantees it never falls through to a grant.

**How is the `corrective-consumed` event and its idempotency handled?**
**Chosen:** additive `data.basis` (no schema bump), fold-driven `disposition`, and `basis` in `foldFingerprint` with an `"asserted"` legacy default, so a basis transition re-records while the no-manifest path stays byte-identical.

**Does the fold's exit code change?**
**Chosen:** exit `0` for all report cases (`channel-D`, `refuse`, `trusted`, `custody-trusted`), exit `2` only for a malformed `--manifest`; the executor parks on `refuse`/`empty`/`indeterminate`.

**Is a new ADR authored?**
ADR-0114 is authored, merged (PR #692), and cross-referenced both ways (verified).
**Chosen:** author no new ADR; reference ADR-0114. The ADR acceptance criterion is already satisfied.

**Is the sentry authority reader changed?**
The detached poller cannot hold the orchestrator's in-context baseline, so a custody-aware reader cannot be done truthfully at v1, and it is outside FAFF-843's deliverables.
**Chosen:** leave `sentryReadCorrectiveAuthority` unchanged (binary, mount-only, honest in-session `channel-D-only`); the `custody-trusted` grant is enforced at consumption (`corrective check --manifest`), and a custody-aware poller signal is a named follow-on.

## 7. Open questions and assumptions

**Open questions.** None. Both FAFF-833 architecture punts are resolved above against the shipped surface: token names → the contract verbatim; plumbing → verify the re-baselined run-grain custody baseline at consumption (grounded in obligation-5's Class-A re-baseline and the beep-boop `correct` timeline). The one irreducible v1 limit — a custody signal the detached sentry poller can read — is scoped out as a named follow-on, not left open.

**Assumptions.**

- **Assumes:** FAFF-326 is shipped — `faff corrective author|check`, the `corrective-authored`/`corrective-consumed` events, the authority-gated `correct` rung, and `BuildDispatch.constraints`. *Validate:* `corrective.js` exports `cmdCorrectiveCheck`; `faff corrective check --selftest` exits 0. Confirmed present in-repo.
- **Assumes:** FAFF-518 is shipped — `buildManifest`, `diffAgainstManifest` (exported; returns a diff array, `(added)` for a new dir sub-file, throws on unresolvable hasher / unreadable member), and the absolute root-owned hasher. *Validate:* `faff integrity-digest --selftest` passes; `integrity-digest.js` exports `diffAgainstManifest`. Confirmed present in-repo.
- **Assumes:** the run-grain custody chain stays open across the between-units `correct` handling so the `corrective author` write is re-baselined into the held baseline (obligation 5 names `corrective author` as a Class-A write). *Validate:* faff/SKILL.md obligation 5's Class-A list includes `corrective author`; the sequential executor holds the baseline in context, not on disk. Confirmed against faff/SKILL.md:1164.

## 8. DONE — Definition of Done

### From WHAT (the fold)
- [ ] `foldCorrectiveAuthority(mountGate, digestVerify)` exists in `corrective.js`, importing `integrityGate` (already present) and `diffAgainstManifest` (new require from `./integrity-digest`, exported); it is exported from `corrective.js` and re-exported from the `faff` entrypoint.
- [ ] It matches the five-branch table exactly and precedence-ordered: branch 1 mount-trusted → `{trusted, asserted}`; branch 2 held+error → `{refuse, unverifiable}`; branch 3 held+clean → `{custody-trusted, digest-verified}`; branch 4 held+tampered → `{refuse, tampered}`; branch 5 not-held → `{channel-D, none}`.
- [ ] Unit coverage exists for every one of the five branches, including the `unverifiable` branch driven by a `diffAgainstManifest` throw, asserting the caller maps the throw to `{held:true,error}` and never catch-and-defaults to empty diffs.

### From WHAT (the `--manifest` input)
- [ ] `cmdCorrectiveCheck` accepts `--manifest <json|file|->` (added to `CORRECTIVE_SPEC.flags`) parsed by a **local** `parseManifestArg` (not the unexported `readManifestArg`); with a manifest it computes `digestVerify` via `diffAgainstManifest` and routes through the fold; with no manifest `digestVerify` is `{held:false}` and the path is byte-identical to today.
- [ ] A malformed `--manifest` value (invalid JSON, or no `members`) exits `2` (usage error), distinct from `held:false`, with unit coverage.

### From WHAT (the event basis)
- [ ] The `corrective-consumed` event carries `basis` (`asserted` | `digest-verified`) and sets `disposition` from the fold result; `foldFingerprint` includes `basis` with a legacy `"asserted"` default so a basis transition re-records while the no-manifest path stays byte-identical, with unit coverage for the basis-transition re-record.
- [ ] The `check` output JSON reports `disposition` and `basis`, distinguishing `channel-D` from `refuse`.

### From HOW (the sequential-executor plumbing)
- [ ] `faffter-noon-concurrency-sequential/SKILL.md`'s re-dispatch `constraints` step consumes via `faff corrective check … --manifest -` against the **re-baselined run-grain custody baseline** (the trusted `corrective author` write folded in per obligation-5's Class-A sequence), never a pre-authoring raw manifest and never a fresh consumption-time snapshot; the unit is not dispatched under a mandate on a `refuse` disposition. The prose refers back to obligation 5 for the chain/re-baseline rules.
- [ ] The plumbing is verified to not spuriously `refuse` a legitimately trusted-authored corrective input (the happy-path re-baseline scenario passes; the pre-authoring-manifest anti-scenario is documented as the failure to avoid).

### From the anti-patterns / boundary
- [ ] `integrity-digest.js` is unmodified; its boundary selftest still passes (`faff integrity-digest --selftest` exits 0).
- [ ] `integrityGate` is unmodified; no `FAFF_INTEGRITY_BOUNDARY` channel is fed by the digest basis.

### From the ADR
- [ ] No new ADR authored; ADR-0114 (present, cross-referenced both ways) is referenced.

### From scope
- [ ] The grant is sequential-executor only at v1; parallel-executor custody and a custody-aware sentry poller signal are left as named follow-ons.
- [ ] `faff corrective --selftest` and the full `test/corrective.test.mjs` suite pass.

**Integration smoke test (connected-plumbing check):**

```
PROCEDURE smoke:
  build B_k of X dispatched with custody baseline M held (snapshotted before B_k) ->
  B_k returns; obligation-5 on-return verify against M -> exit 0 (clean) ->
  between-units: Sentry `correct` -> `sentry abort` + `corrective author` (writes corrective/NNNN-X.json) ->
     re-baseline M -> M' (Class-A: post-write names exactly the added file, sha256 matches corrective author's report) ->
  re-dispatch: faff corrective check --run-dir R --issue X --manifest -  (pipe context-held M') ->
  diffAgainstManifest(disk, M') clean -> foldCorrectiveAuthority -> { custody-trusted, digest-verified } ->
  constraints folded (mandate "narrowed"); corrective-consumed records basis="digest-verified" ->
  constraints stamped onto X's re-dispatch BuildDispatch
```

---

confidence: medium
build-tier: complex
spec-review: approve
