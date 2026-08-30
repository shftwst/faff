# FAFF-942 spec-review lens resilience: a legitimate methodology no-op is not mis-classified as a failed lens

> Spec: faffter-dark-nlspec · 2026-08-30 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-942.

## Why

The methodology spec refuter (`plugin/skills/faffter-dark-spec-review/refute-methodology.md`) is designed to raise nothing when it is handed no `## Methodology critique` block. Its no-op emits three lines:

```
## Refutation — methodology

no methodology signal available.

No methodology objection.
```

The transport's clean-refutation recogniser (`normaliseCleanRefutation` / `CLEAN_REFUTATIONS` in `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`) only accepts the exact one- or two-line form (`## Refutation — methodology` + `No methodology objection.`). The extra `no methodology signal available.` line breaks the match, so the valid no-op falls through to `validateFindingsShape`, fails it (no `### <severity>:` section), and is classified garbled / no-findings. The lens is dropped and the fallback chain is walked pointlessly. Reproduced directly against qwen: HTTP 200, `finish_reason: stop`, reasoning capped, content is exactly the three-line no-op. The backend is healthy; the classification is the defect.

## What

1. Make the methodology refuter's no-critique case emit a findings-shaped observation, `### observation: no methodology signal available`, instead of the bare prose line. It passes `validateFindingsShape`, and `aggregate.mjs` already drops `observation` severities (non-gating), so the diagnostic is preserved without gating.
2. Defence in depth: make `normaliseCleanRefutation` tolerant of the methodology no-signal diagnostic line, so a clean refutation still carrying that extra line normalises to a clean pass. Keep it a closed grammar, do not loosen it into accepting arbitrary garbled output.
3. Secondary transient-blip resilience: verified already covered, no change (see the decision below).
4. Rate-limit (HTTP 429) no-retry classification (folded in, same retry-classification code): a 429 must not be retried on the same endpoint, and an all-429 chain must not trigger a dispatch-level re-run. A 429 becomes a backend fault that advances the fallback chain to the next (different, not-throttled) backend immediately, and a purely-rate-limited exhausted chain surfaces a distinct exit class that the judge dispatch-retry does not re-run.

### Decisions

- **Chosen:** the primary fix lands in the refuter (item 1), producing recognised output at source, rather than relying only on the recogniser. The other three lenses already emit the recognised `No <lens> objection.` form; only methodology has a no-signal case, so this is methodology-specific.
- **Chosen:** keep the existing `## Refutation — methodology` + `No methodology objection.` footer in the refuter for the case where a critique *was* supplied but yielded no objection. Both no-op forms then coexist: no-critique emits the observation, critique-present-no-objection emits the bare sentence. This also keeps the `No methodology objection.` bytes in the file, which the FAFF-746 prompt-contract test asserts.
- **Chosen:** implement the recogniser tolerance (item 2) as a per-entry `signal` field on the methodology `CLEAN_REFUTATIONS` entry, matched only as an exact three-line `heading` + `signal` + `sentence` form. Closed grammar: arbitrary trailing prose (for example `No architectural objection.\nAdditional prose.`) still fails, preserving the findings-shape guard the refuter path relies on.
- **Chosen:** no new retry for the secondary transient-blip concern. `streamWithTransportRetry` already retries the genuine transient-transport class (5xx, ECONNRESET, ETIMEDOUT, EPIPE, socket hang up, timed-out) up to `TRANSPORT_RETRY.attempts` (3) within a single backend attempt, before the chain advances; on exhaustion it returns a sentinel and the per-lens chain fails over through the remaining fallback backends. A transient blip on one lens is therefore retried within the backend attempt and then covered by fallback. FAFF-941's `judgeDispatchDisposition` bounded-retry sits one altitude up (judge dispatch), a distinct concern. Adding lens-level retry here would be redundant.
- **Chosen (429 no-retry):** remove `HTTP 429` from `isTransientTransport`'s retryable set, reversing the FAFF-228 decision. A 429 is a rate-limited endpoint: same-endpoint retry does not clear the limit and burns the deadline budget. Instead a 429 surfaces as a new per-backend `rate-limited` status that advances the fallback chain to the next backend. Add a distinct `EXIT.RATE_LIMITED` (12); a purely-rate-limited exhausted chain collapses to it (a chain mixing a genuine unreachable/deadline still collapses to `UNREACHABLE`, keeping the genuine-transient dispatch-retry). `RATE_LIMITED` is deliberately absent from `JUDGE_RETRY_OUTAGE_EXITS`, so an all-429 chain dispositions `park` (no dispatch re-run) while a genuine unreachable/deadline still dispositions `retry`. For a mandatory (lights-out L4) review, `RATE_LIMITED` joins `mandatoryRemap` so an all-429 outage fails closed (parks the PR) exactly as an all-unreachable one does.
- **Assumes:** the only double-retry paths for a 429 are `streamWithTransportRetry` (same-endpoint) and the FAFF-941 `judgeDispatchDisposition` re-dispatch keyed on `UNREACHABLE`/`DEADLINE`. The lens fan-out has no dispatch-level retry (verified), so no refuter-side re-run guard is needed beyond the exit-class distinction.
- **Assumes:** `aggregate.mjs` maps `observation` severity to `null` and drops it (verified: `SEVERITY_MAP.observation === null`), so the observation is non-gating.
- **Assumes:** `SEVERITY_HEADING_RE` recognises `observation` as a severity word (verified), so `### observation: …` satisfies `validateFindingsShape`.

## How

- `plugin/skills/faffter-dark-spec-review/refute-methodology.md`: reword the no-critique instruction and the output-format footer so the no-critique case emits the single findings-shaped observation `### observation: no methodology signal available` under the `## Refutation — methodology` heading. Keep the separate `No methodology objection.` footer for the critique-supplied-but-nothing-found case. Stay within the skill-authoring lint caps.
- `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`: add `signal: "no methodology signal available."` to the methodology `CLEAN_REFUTATIONS` entry, and add a three-line match arm to `normaliseCleanRefutation` that accepts `heading` + `signal` + `sentence` (form `headed+signal`) for an entry that carries a `signal`.
- `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` (429 no-retry): add `EXIT.RATE_LIMITED = 12`; drop the `HTTP 429` arm from `isTransientTransport` and add a pure `isRateLimited` predicate; classify a 429 (preflight and stream) as status `rate-limited`; map `rate-limited` to `EXIT.RATE_LIMITED` in `mapResultExit`; make `chainTerminalExit` collapse a purely-rate-limited exhausted chain to `RATE_LIMITED` (mixed with a genuine availability fault stays `UNREACHABLE`); add `RATE_LIMITED` to `mandatoryRemap`; leave `JUDGE_RETRY_OUTAGE_EXITS` as `{UNREACHABLE, DEADLINE}` and refresh the FAFF-228 rationale + the judge-disposition comment.
- `plugin/skills/faffter-dark-spec-review/SKILL.md`: map per-lens exit `12` alongside `5` (unavailable, kind `infra-configured`).
- `test/adversarial-call.test.mjs`: add cases (below).

## Done

Acceptance criteria:

1. The methodology no-critique three-line output (`## Refutation — methodology` / `no methodology signal available.` / `No methodology objection.`) normalises via `normaliseCleanRefutation` to `CANONICAL_NO_FINDINGS`, `normalised: true`, `lens: "methodology"` — a clean pass, not a fault.
2. `refute-methodology.md`'s no-critique case instructs emitting `### observation: no methodology signal available`; that string passes `validateFindingsShape` and is dropped by `aggregate.mjs` as an `observation` (non-gating).
3. Each other lens's clean `No <lens> objection.` bare and headed forms still normalise unchanged (no regression to the FAFF-746 grammar).
4. A genuinely garbled clean-like response still fails normalisation — the closed grammar is not loosened. Methodology-specific negative cases pin the new three-line grammar's closedness: a trailing fourth line, a near-miss signal line (wrong casing / missing period), and a two-line signal-only form (no sentence) each stay `{normalised:false}`; the exact `signal` bytes are pinned so the closed match cannot drift.
5. HTTP 429 no-retry: a persistent 429 on a backend does not same-endpoint-retry (exactly one stream attempt), and a 429 on backend 1 advances to backend 2. An all-429 exhausted chain surfaces `EXIT.RATE_LIMITED`; `judgeDispatchDisposition(RATE_LIMITED)` is `park`, while `UNREACHABLE` / `DEADLINE` stay `retry`. A 5xx / dropped-socket / timeout fault still retries as before.
6. `faff validate-adapters` lints clean on the edited refuter.
7. The full test suite and repo gates (validate, governance-check, env-rootless, dco) pass.

confidence: high
build-tier: mechanical

## Methodology critique

- Right-sized? Yes. One coherent increment: a two-file resilience fix (refuter output shape plus a closed-grammar recogniser tolerance) with its tests. Not splittable into independently-shippable units without stranding the recogniser change without its trigger.
- Workstream fit? Yes. Continues the FAFF-940/941 spec-review reliability line (contract-output mode, judge dispatch retry); this closes the last mis-classification path that drops a healthy lens.
- Deps surfaced? Yes. Depends only on FAFF-940/941 already on main (base states this). No implicit dependency.
- Risk profile? Low. The recogniser change is additive under a closed grammar with a regression test pinning the rejected set; the refuter change keeps the existing no-objection footer. No novel integration or external dependency.
- No issues.
