# FAFF-703 — Harness + model provenance across faff's durable artifacts

> Spec: faffter-dark-nlspec · 2026-08-10 · autonomous · confidence: high. Full spec on Linear FAFF-703.

**Revised 2026-08-10 (autonomous resolve-attempt).** Re-rated medium → **high**. The sole `high`-gating Punt (harness-declares-model requirement) was reclassified: the interim resolver ships best-effort-with-`unknown` **regardless** of how that question resolves, so it is not load-bearing for *this* ticket's buildable scope — it is a property of the FAFF-483 harness-abstraction interface and is **deferred to FAFF-483** (already `relatedTo`, and OUT OF SCOPE §2). No technical approach changed; all `Chosen:` decisions and the DoD are unchanged. This is a *split* of the open question to the ticket that owns it, not a unilateral architecture ruling. See §3/§6/§7.

This is the buildable spec for FAFF-703 ("faff stamps producer/mode but not harness/model — runs aren't attributable across harnesses"), parent FAFF-694 (harness-agnostic runtime). Audience: the build agent implementing the provenance plumbing, and the human reviewers who must ratify the one load-bearing decision it turns on. It is internal provenance plumbing across faff's own artifacts — not new runnable surface.

## 1. WHY — Problem and Principles

**The load-bearing model.** Faff already records *who* (producer skill) and *how* (mode) a spec was made, and *what it cost* (per-engine spend, FAFF-604) — but it never records *which harness and model* stood behind the work in a place that survives the run. Attribution therefore requires a single load-bearing choice: **where does a `{harness, model}` identity come from, and onto which artifacts is it durably stamped?** Everything else follows from that one answer.

**Problem statement.** Today attribution is invisible because the history is single-harness: the provenance stamp, prep marker, run-ledger and merge-record all omit harness/model, and the only place engine identity exists (the FAFF-604 spend seam) fires solely for a `faff engine call` dispatch — an interactive harness driving the skills leaves no trace. The moment work is produced under Codex, Fable, or anything else, there is no standing marker to answer "which harness/model produced this spec/build/merge?" — exactly what retrospective learning and QA need. This change gives faff's durable artifacts a uniform harness+model identity so runs are attributable across drivers.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **Identity is resolved once, at one seam — not sniffed independently per artifact.** The whole point is uniformity across drivers. A build that re-derives harness/model separately in the stamp, the marker, and the merge-record has recreated the divergence bug the ticket exists to close. One resolver; every artifact reads it.
- **Honest `unknown` over a misleading value.** `models.<lane>` is the *requested* class, never the *resolved* model. Recording a requested class as if it were the model that ran is worse than recording nothing — it poisons the very "which model cleared review at what rate" analysis this enables. When the resolved model is genuinely unobservable, the field is the literal token `unknown`, never a guess and never a silent omission.
- **The closed gate contract is not a provenance dumping-ground.** `spec-readiness` contract data is a *validated gate input* under a closed schema. Harness/model is provenance, not a gate input — it must not be smuggled into the contract JSON just because the stamp sits nearby.
- **Additive-only on the durable artifacts.** Every target artifact except the fixed stamp line is schema-open or schema-less. The build adds fields; it never repurposes or narrows an existing one, and a legacy artifact with no identity fields stays valid (no migration).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/backends.js` (~270) | JS | Holds `CURRENT_HARNESS = "claude-code"`, the only harness-identity-ish value today (private; credential-matrix only). The resolver promotes/reuses this default. |
| `plugin/skills/faff/bin/lib/engine-codex.js` (~264-277) | JS | FAFF-604 spend record `{ts, engine, provider, model, source}` — the *resolved* model exists here, but only for `faff engine call`. |
| `plugin/skills/faff-prep/SKILL.md` (Provenance stamp, Attach-state marker) | prose | Populates the stamp + writes the prep marker; the consumer of the identity at prep time. |
| `plugin/skills/faff/SKILL.md` (Spec readiness (fixed)) | prose | Owns the **fixed** stamp format — extending it is a gateway-contract edit. |
| `plugin/skills/faff/bin/lib/merge-gate.js` `writeMergeRecord` (~286) | JS | Writes merge-record; the merge-time identity sink. |
| `plugin/skills/faff/bin/lib/contract-defs.js` (`computeSpecReadiness`, register, describe) | JS | The closed spec-readiness contract — cited to justify keeping identity *out* of it. |

**Scope statement.** This ticket is the thin first identity seam under the FAFF-694 harness-agnostic-runtime project — it sits upstream of FAFF-483 (which later formalises it), beside FAFF-604 (spend, not provenance), and feeds FAFF-641 (economics model attribution) and FAFF-613 (harness-version-in-results).

## 2. OUT OF SCOPE

- **The full FAFF-483 harness-abstraction interface.** Excluded: a general driver-abstraction seam (dispatch, capability negotiation, per-harness behaviour) — **and the permanent contract-strength decision of whether a harness is *required* to declare its model** (see §7, deferred here). Why: FAFF-483 is Todo, unbuilt, zero code — depending on it defers all value. Extension point: FAFF-483 formalises the resolver defined here; the resolver's output shape `{harness, model, source}` is designed to be the thing FAFF-483 later *implements behind*, not replaces.
- **Robust env-sniffing of every harness.** Excluded: an exhaustive detector mapping every present/future harness to an identity from environment fingerprints. Why: unbounded and speculative; the repo does no harness env-sniffing today. Extension point: the resolver's `env` resolution branch (§4) is where a future harness adds its signal.
- **Making the FAFF-604 spend seam a provenance source.** Excluded: reworking `engine-spend.jsonl` into durable per-artifact provenance. Why: it is per-run spend telemetry keyed to a `faff engine call`, structurally absent for interactive drivers. Extension point: the resolver *may read* the resolved model from an engine-call context (§4) but the spend file itself is untouched.
- **Economics/model cost attribution.** Excluded: rolling harness/model into spend or `economics --by`. Why: that is FAFF-641. Extension point: FAFF-641 consumes the merge-record/ledger identity fields this ticket adds.
- **Retroactive back-fill of existing artifacts.** Excluded: stamping identity onto already-written specs/markers/ledgers/merge-records. Why: additive-only, legacy-tolerated; no migration. Extension point: none needed — absent fields read as unknown/legacy.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| harness | The driver executing the faff skills this session (`claude-code`, `codex`, `fable`, …). The `who is running the loop` axis, distinct from producer skill and mode. |
| model | The concrete LLM behind the work, as a resolved id (`opus-4.8`, `gpt-5.6-sol`) — **not** a requested lane class. `unknown` when not observable. |
| identity | The pair `{harness, model}` plus a `source` provenance tag, as returned by the resolver. |
| declared model | A model id the driving harness explicitly asserts (via the declaration env var / config key), as opposed to one faff itself resolved from an engine dispatch. |

**Type definitions.**

```
RECORD HarnessIdentity:
  harness: String        # resolved harness token; never empty (falls back to CURRENT_HARNESS default)
  model:   String        # resolved model id, OR the literal "unknown"
  source:  Enum{ config, declared, engine, env, default }
                         # provenance of the resolution, for forensics; see resolution order in §4

  CONSTRAINT harness != ""            # always resolves to something (default is claude-code)
  CONSTRAINT model == "unknown" OR model is a concrete id   # never a requested lane class
```

**CLI surface — the one resolver.** A new pure subcommand on the bundled `faff` CLI (dependency-free, `bin/lib`, table-driven like every other contract/config command):

```
faff harness identify [--json]
  → stdout: HarnessIdentity as JSON (with --json) or a human line "harness/model (source)"
  → exit 0 always (identity always resolves; unknown model is a value, not an error)
```

**Additive artifact fields.** Each durable artifact gains a `harness` + `model` pair (and `source` where it fits), written from `faff harness identify` at the artifact's write moment:

```
Prep marker  .faff/prep/<ISSUE>.json      (+ harness, model — additive; reader is schema-less/tolerant)
Run-ledger   run-ledger.json  owner{…}    (+ harness, model on owner — additionalProperties:true)
Merge-record <run-dir>/<issue>/merge-record.json (+ harness, model — additionalProperties:true)
Provenance stamp line (rendered prose)     (+ <harness>/<model> segment — FIXED format, gateway edit)
```

**Design decision — where identity comes from.** FAFF-483 (the ticket's intended uniform source) is Todo/unbuilt with zero code. Two options:

- (a) Treat FAFF-483 as a hard prerequisite; scope this ticket to only wire identity *through* the seam once it exists. Pro: single canonical source, no interim surface to retire. Con: defers **all** value behind an unscoped dependency; leaves the attribution gap open indefinitely.
- (b) Define a minimal interim resolver now (`faff harness identify`), stamp it into the durable artifacts now, and make it the natural point FAFF-483 later formalises — this ticket becomes the thin first seam. Pro: value now, additive-only, gives FAFF-483 a concrete shape to formalise. Con: an interim surface FAFF-483 must later absorb.

**Chosen:** (b) — the interim resolver as the thin first seam. Rationale in §6. The resolver's output shape is deliberately the interface FAFF-483 implements behind, so formalisation is a re-home, not a rewrite.

**Design decision — does identity go into the closed `spec-readiness` contract data?** The contract data is a *validated gate input* under a closed schema (`additionalProperties:false`, required `[confidence, decisions, markers_valid, violations]`); adding a field needs schema + `computeSpecReadiness` + `CONTRACT_DESCRIBES` + selftest fixtures in lockstep. Harness/model is provenance, not a gate input — nothing branches on it to admit a spec.

**Chosen:** identity goes in the **rendered stamp line** (prose) and the **additive artifacts** (marker/ledger/merge-record), **never** the `faff-contract:spec-readiness` JSON. The stamp line and the contract data are different surfaces: the stamp is human-facing prose faff-prep populates; the contract data is the validated JSON the producer emits. Keeping identity out of the contract avoids the four-file lockstep and keeps the gate schema about the gate.

**Design decision — the model-identity source when an external harness drives the skills.** The resolved model is reliably observable only when faff *itself* dispatches the engine (a `models.<lane>` resolved to a concrete id, or the FAFF-604 engine-spend model). When an interactive harness drives the skills, faff cannot see the model unless the harness *declares* it — which is precisely the guarantee FAFF-483 is meant to provide.

**Chosen:** the interim resolver ships the **best-effort-with-`unknown`** form — the standing contract for *this* ticket. Model resolves from a faff-dispatched engine context when present, else an explicit harness declaration, else the literal `unknown`; it is never a requested lane class. Rationale: the interim scope is decided regardless of the eventual contract strength (the resolver ships best-effort either way, stated throughout §1/§6), so the only genuinely-open question is whether a *future* harness-abstraction layer makes declaration mandatory — a property of the FAFF-483 interface, not of this interim seam.

**Assumes:** best-effort-with-`unknown` is correct for the interim, and the require-declaration strengthening is owned by and **deferred to FAFF-483** (already `relatedTo`, and in OUT OF SCOPE §2 as the full harness-abstraction interface). This split keeps the genuine human/architecture call where it belongs (FAFF-483) without blocking the interim build. See §6/§7.

## 4. HOW — Behavior

**Architecture.** One resolver, many sinks. `faff harness identify` is the single point that computes `{harness, model, source}`. Every artifact writer calls it (or is handed its output) at write time; no writer re-derives identity. This is the uniformity principle made mechanical.

**Resolution order (deterministic, fail-quiet — identity always resolves).**

```
PROCEDURE resolve_identity(env, config, engine_ctx?):
  # harness axis
  1. harness := config "provenance.harness"          IF set          → source config
  2. ELSE harness := detect_from_env(env)            IF a known signal → source env
        # e.g. env has CLAUDECODE ⇒ claude-code ; a codex-specific signal ⇒ codex
  3. ELSE harness := CURRENT_HARNESS  ("claude-code") → source default
        # promote CURRENT_HARNESS from a backends.js private const to the resolver's shared default

  # model axis (independent of the harness branch taken)
  4. model := engine_ctx.model      IF resolving inside a faff-dispatched engine call → source engine
        # the FAFF-604-known resolved id; reused, engine-spend.jsonl itself untouched
  5. ELSE model := config "provenance.model" OR env FAFF_HARNESS_MODEL  IF set → source declared
        # the harness/driver's explicit declaration
  6. ELSE model := "unknown"                          → source (model half) unknown-tagged

  # source records the WEAKEST branch that fed the pair (forensics), e.g. default/unknown
  RETURN { harness, model, source }
```

**Anti-pattern:** falling back to `models.<lane>` (the requested class) for the model when it is otherwise unknown. Why: requested ≠ resolved; recording the request as the model silently corrupts model-attribution analysis. Step 6 returns `unknown`, full stop.

**Stamping the artifacts.**

```
PROCEDURE stamp_prep_marker(marker, id):        # faff-prep, at produce time
  marker.harness := id.harness ; marker.model := id.model
  # additive on the schema-less .faff/prep/<ISSUE>.json; absent env ⇒ still write, model may be "unknown"

PROCEDURE stamp_run_ledger(ledger, id):         # at run open, alongside owner block
  ledger.owner.harness := id.harness ; ledger.owner.model := id.model
  # owner is additionalProperties:true; a ledger with no identity stays liveness-valid

PROCEDURE writeMergeRecord(..., id):            # merge-gate.js, at merge time
  record.harness := id.harness ; record.model := id.model
  # merge-record schema is additionalProperties:true; additive

PROCEDURE populate_stamp_line(producer, date, mode, confidence, id, tracker, issue):
  # gateway FIXED format extended by ONE positional segment, after mode, before confidence:
  "> Spec: <producer> · <date> · <mode> · <id.harness>/<id.model> · confidence: <confidence>. Full spec on <tracker> <issue>."
  # id.model may be "unknown" → renders "<harness>/unknown"; never omit the segment (keeps it positional + detectable)
```

**The fixed-stamp-format change (three-file lockstep, NOT the contract lockstep).** The stamp format is *fixed in the gateway*, so extending it touches, in lockstep:

1. `plugin/skills/faff/SKILL.md` → *Spec readiness (fixed)* — the canonical format string gains the `· <harness>/<model>` segment.
2. `plugin/skills/faff-prep/SKILL.md` → *Provenance stamp (populate at attach)* — populates the segment from `faff harness identify`, on **all** attach paths (fresh, refresh, both autonomous paths), and re-stamps on refresh like `date`.
3. faff-prep's `provenance_present` detection — the regex that keys on the `> Spec:` prefix to set `provenance_present` **must still match** the extended line. Constraint: anchor on the `> Spec:` prefix, do not require an exact trailing shape, so inserting a segment before `confidence:` does not break detection (see Failure modes).

This is a **different, smaller lockstep** than adding a contract field — it does **not** touch `spec-readiness.schema.json`, `computeSpecReadiness`, `CONTRACT_DESCRIBES`, or the contract selftest, because identity never enters the contract data (§3 Chosen).

**Edge cases.**

- **No env, no config, no engine context** (a bare interactive claude-code prep): harness → `claude-code` (default), model → `unknown`. Both fields still written. This is the honest floor, not a failure.
- **Git-only mode:** the stamp already drops the trailing "Full spec on …" sentence; the `<harness>/<model>` segment stays (it is before `confidence:`, unaffected by the git-only tail rule).
- **Resolver unavailable / errors:** identity resolution is fail-quiet by construction (every branch has a fallback), so `faff harness identify` cannot hard-fail; a writer that somehow gets no identity writes neither field rather than an empty string (mirrors the prep-marker `owner` omit-when-unset rule) — the artifact stays legacy-valid.
- **`model` from an engine context vs a later stamp:** if a spec is produced via a faff-dispatched engine call, model resolves via step 4 at that moment; a merge stamped later in an interactive orchestrator session may legitimately resolve `unknown` — the two artifacts can honestly disagree, and `source` records why.

**Failure modes.**

- **The failure:** extending the fixed stamp line breaks faff-prep's `provenance_present` regex, so every freshly-stamped spec reads as provenance-missing → `computeSpecReadiness` pushes a `provenance stamp missing` violation → `markers_valid:false` → autonomous prep **parks every spec**. **How you'd know:** the spec-readiness selftest/fixtures stay green (identity isn't in the contract) but a live prep run flips to `fail`/park with `provenance stamp missing` on a spec that visibly *has* a stamp. **What it means:** narrow — the regex must anchor on `> Spec:` and tolerate the new segment; add a fixture stamp line carrying `<harness>/<model>` to the detection test before shipping. Not a reason to abandon; a reason to pin the regex compat as a DONE item.
- **The failure:** `model` silently records a requested lane class (via a well-meaning fallback), so "which model cleared review" analysis is quietly wrong rather than honestly empty. **How you'd know:** merge-records show a `model` for interactive runs where faff provably could not observe one; the values suspiciously mirror `models.*` config. **What it means:** proceed only with step 6 returning `unknown`; a non-`unknown` model with `source: default` is the tell that this failure has occurred.
- **The failure:** identity is re-derived per artifact and the harness/model on the stamp, marker, and merge-record for one issue disagree without a source explaining it. **How you'd know:** a single issue's three artifacts carry three harness values in one session. **What it means:** narrow — route every writer through the one resolver; disagreement is legitimate only across *time* (engine-context vs later stamp), tagged by `source`.

## 5. Scenarios — born-verifiable main objectives

```
Given a bare interactive claude-code prep with no provenance config and no declaration env var
When faff harness identify runs and faff-prep stamps the spec
Then the resolver returns { harness: "claude-code", model: "unknown", source: default }
 And the rendered stamp line reads "... · claude-code/unknown · confidence: ..."
 And faff-prep's provenance_present detection still matches the extended line (spec is not parked for missing provenance)
```

```
Given a spec produced via a faff-dispatched engine call whose engine resolves model "gpt-5.6-sol"
When the identity resolver runs inside that engine context
Then it returns { harness: <the engine's harness>, model: "gpt-5.6-sol", source: engine }
 And the prep marker .faff/prep/<ISSUE>.json carries harness + model = "gpt-5.6-sol"
```

```
Given a merge-gate run for an issue under a harness that declares its model via the declaration env var
When writeMergeRecord writes <run-dir>/<issue>/merge-record.json
Then the record carries harness and model additively (schema still validates, additionalProperties:true)
 And a legacy merge-record with neither field still validates and reads as unknown/legacy
```

- The `faff-contract:spec-readiness` selftest fixtures and emitted contract data are **byte-identical** before and after this change (identity never enters the contract).

## 6. Design Decision Rationale

**Where does the harness+model identity come from, given FAFF-483 is Todo/unbuilt?**
- Options: (a) hard-depend on FAFF-483; (b) minimal interim resolver now.
- **Chosen:** (b), `faff harness identify` as the thin first seam. FAFF-483 is unscoped and has zero code — (a) delivers nothing until an unbounded dependency lands. (b) is additive-only, resolvable today (harness from config/env/the existing `CURRENT_HARNESS` default; model from engine-context/declaration/`unknown`), and its `{harness, model, source}` shape is intentionally the interface FAFF-483 later implements behind — formalisation becomes a re-home, not a rewrite.

**Does identity belong in the closed `spec-readiness` contract data or only the rendered stamp?**
- Options: extend the closed contract (schema + compute + describe + selftest lockstep); or stamp line + additive artifacts only.
- **Chosen:** stamp line + additive artifacts only. Identity is provenance, not a gate input — nothing admits or refuses a spec on harness/model. Adding it to the closed schema would force a four-file lockstep and conflate provenance with the validated gate. The stamp line (prose, faff-prep-populated) and the additive schema-open artifacts carry it without touching the contract.

**Which durable artifacts get stamped, and in what order of certainty?**
- Options: stamp everything at once; or scope to the artifacts the ticket names as in-scope.
- **Chosen:** the four named durable artifacts — spec stamp + prep marker (the ticket's core, done now), plus run-ledger owner block and merge-record (the ticket's "and ideally" — both `additionalProperties:true`, so additive and low-risk). All read from the one resolver. The engine-spend seam is explicitly *not* a target (it is spend, per-`faff engine call`, not durable per-artifact provenance) — it is only *read* as a model source when a resolution happens inside an engine context.

**Is the harness required to declare its model, or is best-effort-with-`unknown` the standing contract?**
- Options: require declaration (mandatory non-`unknown` model, a hard contract on every driver); or best-effort with honest `unknown`.
- **Chosen (for the interim):** best-effort with honest `unknown`. **Assumes** the permanent contract-strength decision (require-declaration) is FAFF-483's to make, not this ticket's. Resolve-attempt reasoning (2026-08-10): the interim resolver ships the best-effort form **regardless** of how the permanent question resolves, so the question does not gate *this* slice — it gates the FAFF-483 harness-abstraction interface (OUT OF SCOPE §2). Requiring declaration is a real contract on that later layer; deferring it there keeps the genuine human/architecture call intact while unblocking the interim build. This is a *split* to the ticket that owns the question, not a unilateral architecture ruling.

## 7. Deferred Decisions and Assumptions

**Deferred to FAFF-483 (not open on this ticket).**
- **Harness-declares-model requirement (decides: architecture).** Should a non-`unknown` model be mandatory (harness must declare it), or is best-effort-with-`unknown` the standing contract? This is a property of the FAFF-483 harness-abstraction interface, **not** of this interim seam: faff reliably knows the resolved model only when it dispatches the engine itself; an external interactive driver leaves no trace, so today the honest value is `unknown`. The interim resolver ships the best-effort form regardless — so this question is **owned by FAFF-483** and does not gate this ticket. Resolve-attempt (2026-08-10) reclassified it from a `high`-gating Punt to a deferred architecture decision on FAFF-483; recorded here so FAFF-483 absorbs it when it formalises the interface. The DoD's "real non-`unknown` model on a live run" objective (§8) is the empirical check that model attribution — not just harness attribution — actually materialises; a genuine `unknown` there is documented, not a failure, and feeds this deferred decision.

**Assumptions.** None load-bearing to the *build* — the resolver always resolves (the `CURRENT_HARNESS` default guarantees a harness; `unknown` guarantees a model), so there is no external presence the build must validate before starting. The env-signal detection (step 2) is best-effort by design and degrades to the default, not to a failure. The one standing assumption is scope-level, recorded in §3: best-effort-with-`unknown` is the correct interim contract, with the strengthening decision deferred to FAFF-483.

## 8. DONE — Definition of Done

### From WHY
- [ ] A single `faff harness identify` resolver exists; no artifact writer re-derives harness/model independently (all read the resolver's output).
- [ ] The resolver never returns a requested lane class as `model`; when unobservable it returns the literal `unknown`.

### From WHAT (types and interfaces)
- [ ] `faff harness identify [--json]` returns `{harness, model, source}`, exits 0 always, and `source` is one of `{config, declared, engine, env, default}`.
- [ ] `harness` is never empty (defaults to `claude-code` via the promoted `CURRENT_HARNESS`); `model` is either `unknown` or a concrete id.
- [ ] `CURRENT_HARNESS` is promoted from a backends.js-private const to the resolver's shared default (backends.js still reads the same value — no behaviour change to `portableMatrixAdmits`/`checkRealizable`).

### From HOW (behaviour — stamping)
- [ ] Prep marker `.faff/prep/<ISSUE>.json` carries additive `harness` + `model`; a marker without them still reads as legacy/unowned (no migration).
- [ ] Run-ledger `owner` block carries additive `harness` + `model`; a ledger without them stays liveness-valid (`run-ledger.schema.json` still validates — `additionalProperties:true`).
- [ ] `writeMergeRecord` writes additive `harness` + `model`; `merge-record.schema.json` still validates a record with and without them.
- [ ] The rendered provenance stamp line carries a `· <harness>/<model>` segment after `mode`, before `confidence:`, on **all** attach paths (fresh, refresh, both autonomous), re-stamped on refresh like `date`; `model` renders `unknown` when unresolved (segment never omitted).

### From HOW (fixed-format + regex lockstep)
- [ ] The gateway *Spec readiness (fixed)* format string and the faff-prep *Provenance stamp (populate)* step are updated in lockstep with the stamp segment.
- [ ] faff-prep's `provenance_present` detection matches the extended stamp line (anchors on `> Spec:`, tolerant of the inserted segment); a detection fixture carrying `<harness>/<model>` is added and passes.
- [ ] The `faff-contract:spec-readiness` schema, `computeSpecReadiness`, `CONTRACT_DESCRIBES`, and its selftest fixtures are **untouched**, and the contract selftest is byte-identical green (identity is not in the contract data).

### From HOW (resolution semantics)
- [ ] Model resolves from a faff-dispatched engine context when present (`source: engine`), else a declaration (`source: declared`), else `unknown` — verified by a test that a `models.<lane>` value never leaks into `model`.
- [ ] (Methodology-recommended) On a real live-harness run (Claude Code), `model` resolves to a real non-`unknown` value for at least one artifact, proving *model* attribution — not just harness attribution — actually materialises. If the live harness genuinely cannot self-declare, this is downgraded to a documented `unknown` with the reason recorded (feeds the §7 FAFF-483-deferred decision).

**Integration smoke test.**
```
1. Run `faff harness identify --json` in a bare repo checkout (no provenance config, no declaration env)
   → { "harness": "claude-code", "model": "unknown", "source": <default/unknown-tagged> }
2. Run a faff-prep produce path for an issue
   → .faff/prep/<ISSUE>.json contains harness="claude-code", model="unknown"
   → the attached spec's "> Spec:" line contains "· claude-code/unknown ·" and provenance_present is true (spec not parked)
3. Validate the artifact schemas (run-ledger + merge-record) with identity fields present → both still valid.
If these connect, the seam is wired.
```

## Already shipped against this surface

Related Done work on the provenance/attribution surface — **none supersedes this ticket's premise** (no existing ticket stamps harness/model onto the durable artifacts); listed so the implementer builds on them rather than re-inventing:

- **FAFF-44** (Done) — the original spec provenance stamp: date + producing spec skill (+ mode). This is the line FAFF-703 extends; build on it, don't recreate it.
- **FAFF-220** (Done) — provenance schema 1→2 added the `interactive|autonomous` mode field to that stamp. Same line; the harness/model segment sits alongside mode.
- **FAFF-361** (Done) — `review-call.mjs` prepends a model-attribution header itself (mechanical, not lens-prose). This is model attribution but only in the *review-lane out-of-session helper* header, not the durable spec-stamp/marker/ledger/merge-record — a different surface; reuse the pattern (mechanical, not prose) but not the location.
- **FAFF-604** (Done) — the telemetry/spend seam records `{engine, provider, model, source}` per `faff engine call`. FAFF-703 *reads* this as a model source inside an engine context (§4 step 4) but does not turn it into provenance.
- **FAFF-408 / FAFF-315 / FAFF-416** (Done) — events token-tagging and per-lane `models:`/`effort:` selection. These are the *requested* class and spend telemetry, never the resolved-model-on-a-durable-artifact this ticket adds.

Dependency note (verified during prep): FAFF-482 (the spike FAFF-483 was blocked by) is now **Done**, but **FAFF-483 itself remains Todo with zero code** — so the ticket's intended uniform source is still absent, and the Chosen (b) interim-resolver decision stands unchanged. This is why the §7 model-declaration question is deferred *to* FAFF-483 rather than resolved here.

## Methodology critique

*(agile-delivery lens — written at prep, does not block promotion; surfaces for the human)*

**Right-sized?** — Borderline, single unit, keep together. The spec bundles a new resolver command (`faff harness identify`) and threading its output into four durable artifacts across three subsystems (prep / run / merge), pushing toward the upper end of a 1–3 day unit. But they are *not* separable concerns: the resolver ships zero attributability alone, and each stamp needs the resolver — they always ship together, so splitting would fragment the one outcome across tickets that individually deliver none of it. Keeping it one ticket is correct. Watch the upper bound: if it grows past ~3 days, the clean split is resolver + stamp-the-single-source-of-truth artifact first, then backfill the other three as a fast follow.

**Workstream fit?** — No issues. Parent project "Harness-agnostic runtime" is outcome-named, and cross-harness run provenance sits cohesively inside it — you can't call the runtime harness-agnostic if its durable artifacts can't say which harness/model produced a run.

**Deps surfaced?** — No blocker missing, and the interim-resolver decision is why. The ticket's open question proposes identity from FAFF-483 (Todo, zero code) — a classic implicit hard-dependency. FAFF-483 is linked only `relatedTo`, not `blockedBy`. Normally a missing blocker link on a real prerequisite is unfinished thinking, but here the Chosen (b) decision *deliberately dissolves* the dependency by building the thin interim resolver now, so FAFF-703 no longer needs FAFF-483 to ship. That converts a would-be `blockedBy` into an honest `relatedTo`. One guardrail: FAFF-703 sets the *interim identity contract* FAFF-483 must later absorb — recorded (the §7 model-declaration decision is now explicitly deferred *to* FAFF-483), and leaning on the "additive, schema-open, never the closed `spec-readiness` JSON" decision to keep that later migration cheap.

**Risk profile?** — Largely handled; one value-risk to name. The interim resolver *is* the early de-risking increment (a thin first seam validating the stamp shape across harnesses before FAFF-483 commits to a formal interface) — no separate spike needed. The residual is a value risk, not integration: model resolution is best-effort-with-`unknown`, deferred to FAFF-483. If runs mostly resolve `unknown`, the ticket ships harness attribution but not *model* attribution — half the stated outcome. The DoD now asserts a real non-`unknown` model for the live harness on a real run to prove the outcome, not just the plumbing.

---

spec-review: approve (single-pass L3 — architectural / infosec / QA; no gating objection; approach unchanged by the 2026-08-10 resolve-attempt — Punt→Assumes reclassification only, so the retained verdict survives live-thread reconciliation)
confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
