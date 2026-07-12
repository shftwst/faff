---
name: faffter-dark-adversarial-review
description: "Adversarial second-opinion code review for the `review` slot: a standard structural pass plus an adversarial review by a different LLM to catch correlated blind spots. Returns the fixed pass/fail/needs-human verdict. Swappable review occupant; runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: refutation-code
---

# faffter-dark-adversarial-review

Two-phase code review: standard structural review (delegated to `faffter-noon-review`) followed by an adversarial second opinion via a different LLM. Catches correlated blind spots by bringing different training biases from the model that wrote the code.

Plugs into the `review` slot — replaces the default review, not augments it. The hard signal it returns conforms to the gateway Review-verdict contract: `pass` / `fail` / `needs-human` in that envelope. The adversarial phase adds evidence, never a fourth verdict.

Configure in `.faffrc`:

```yaml
slots:
  review: faffter-dark-adversarial-review
```

## When it runs

Invoked by faff-graft Step 9 as the configured `review` skill.

## Two phases

### Phase 1: Standard review (delegated to faffter-noon-review)

Runs the full `faffter-noon-review` five-pass review (AC coverage, obvious bugs, scope check, spec fidelity, human-judgement flagging). If this returns `fail` or `needs-human`, return that signal immediately — no point running the adversarial pass on code that hasn't passed basic review.

### Phase 2: Adversarial review (different LLM)

Only runs if Phase 1 returned `pass`. Sends the diff to a structurally different model for an independent second opinion. This is not a repeat of Phase 1 — it targets what same-model review is likely to miss. The backend call is made by the bundled **`review-call.mjs`** helper (preflight + streaming + `think:false` + token budget) — **not** a hand-rolled API call; see **Backend call** below.

## Input

Faff-graft provides:

- The full diff: `git diff main...HEAD`
- The spec (from the issue comment)
- The Phase 1 review result (for context, not for agreement — Phase 2 must form its own opinion)
- The **`autonomous` signal** — a boolean, `true` on **any** unattended run (L3 overnight *or* L4 lights-out), `false`/absent on an interactive (L2) run. faff-graft forwards it; the slot never resolves it itself. It gates the Phase-2 `critical` escalation (see **Autonomous-run escalation**) and the full-chain-outage annotation (see **Backend call** → the exit-code table). Default it to `false` whenever it is not forwarded — an unresolved signal never escalates and never annotates (fail-safe to interactive semantics).
- The **`lights_out` signal** — a boolean, `true` only on a lights-out (L4) run (L4 = `autonomous ∧ lights_out`); forwarded alongside `autonomous`, orthogonal to it. The Phase-2 escalation and the exit-5 outage annotation key off `autonomous`, not this — so they fire at L3 too. The **one** behaviour that keys off `lights_out` is the **MANDATORY chain-outage fail-closed** (FAFF-398, below): L4 is the only place the second opinion is *mandatory* (`dialCoherence` requires the adversarial occupant there) **and** no human is watching at all, so an exhausted chain fails closed — whereas an L3 overnight run keeps today's pass+skip because a morning human reads the loudly-annotated skip.

## Output

Phase 1 returns a hard signal (`pass` / `fail` / `needs-human`) per `faffter-noon-review`.

Phase 2 returns a **soft signal** — findings only, no verdict. The adversarial reviewer may be a less capable model; its findings are hypotheses, not rulings. The output **must name the model used** (`provider/model`) as its first line — so a finding can be investigated/tuned in retrospect, and so a quality difference between models is attributable (FAFF-183: a 27B and an 80B gave materially different findings on the same diff).

```
## Adversarial findings — `<provider>/<model>`

### [severity]: [title]
[description of the concern and why it might matter]
```

Severities: `critical`, `major`, `minor`, `observation` — but these are the adversarial reviewer's assessment, not a gate decision.

**When there are no findings, emit exactly one section: `### observation: no findings`** (FAFF-194). A clean review that emits nothing findings-shaped is indistinguishable from a malformed one — see **Output-format enforcement** below — so a well-behaved model with nothing to report still produces a recognised section, not empty/prose-only output.

**The header is harness-authored, not model prose (FAFF-194).** `review-call.mjs` normalises the `## Adversarial findings — <provider>/<model>` line itself from the winning backend's own provenance — prepending it when absent, replacing it (never trusting a model-echoed, possibly-wrong tag) when present. Don't rely on the model getting the header right; it never has to.

**Refuted findings arrive pre-downgraded (FAFF-194).** Before this output reaches the implementor, `review-call.mjs` runs a deterministic refutation pass over machine-checkable syntax/parse claims (v1 scope): a `critical`/`major`/`minor` finding claiming a context file "won't parse" is downgraded to `severity: observation` with an `[auto-refuted]` title prefix and a `node --check` evidence line, **iff** every file the claim ties to positively passes the check. A refuted finding is never dropped — the downgrade + evidence line is the audit trail of what the reviewer got wrong.

## How findings are handled

The adversarial findings are raised back to the **implementor** (the build agent). The implementor must:

1. **Consider each finding** — read it, understand the concern
2. **Prove or disprove with conviction** — check the code, the spec, the tests. Either demonstrate why the finding is a false positive (cite the specific line, test, or spec clause that addresses it) or acknowledge it as valid.
3. **Log each disposition** — record every finding and its disposition (proven false / valid + fixed / valid + accepted risk with rationale) in the per-issue `.faff/logs` graft log. Per faff-graft Step 9's **collapse-and-log** policy (FAFF-184), these dispositions **fold into the single terminal review comment's summary** — never one tracker comment per finding (the granularity rule). That one comment is located/updated by its marker pair per the comment-identity contract (**gateway → Review-findings comment identity**, FAFF-202).
4. **Fix if necessary** — if any finding is valid and actionable, fix the code
5. **Re-run primary review** — if fixes were made, re-run Phase 1 to confirm nothing regressed

On an **interactive (L2)** run the adversarial review **never directly blocks the pipeline** — it produces signal that the implementor must address with evidence. On an **autonomous (L3/L4)** run there is one exception: a Phase-2 `critical` escalates the returned hard signal to `needs-human` so the merge stops (see **Autonomous-run escalation**) — no human is awake to weigh a soft `critical`, and on an autonomous run the accused must not be the one to clear its own indictment. A dismissed finding with weak rationale ("I don't think that's a problem") is itself a smell — the disposition must be specific and verifiable.

This soft-signal design reflects that the adversarial model may produce lower-quality findings than the primary model. The value is in surfacing blind spots for consideration, not in gating on a potentially less capable reviewer's judgement.

## Review lens

This is NOT a repeat of the primary review. The adversarial reviewer looks for things a same-model review is structurally likely to miss:

**1. Specification gaming** — does the code technically satisfy the spec while missing the spirit? Look for:
- Trivial implementations that pass ACs without delivering value
- Edge cases acknowledged in the spec but handled with no-ops or swallowed errors
- Tests that assert implementation details rather than behaviour

**2. Implicit assumptions** — what does the code assume that neither the spec nor the code explicitly validates?
- Ordering assumptions (events arrive in sequence, config loads before use)
- Size/cardinality assumptions (fits in memory, single item, non-empty)
- Environment assumptions (file exists, network reachable, permissions granted)

**3. Failure mode blindness** — what happens when things go wrong?
- Missing error paths (what if this throws? what if this returns null?)
- Partial failure (3 of 5 items succeed — what state are we in?)
- Resource leaks (opened but not closed on error path)

**4. Security surface** — changes that expand the attack surface:
- New user input without validation/sanitisation
- Changed auth/authz boundaries
- Secrets in code, logs, or error messages
- SQL/command/template injection vectors

**5. Concurrency and ordering** — race conditions the happy-path author didn't consider:
- Shared mutable state without synchronisation
- Time-of-check to time-of-use gaps
- Event ordering assumptions in async flows

**When this lens finds nothing** — this text is the `--system` prompt (below); the reviewer MUST still emit exactly one recognised finding section, `### observation: no findings`, rather than empty or free-form prose (FAFF-194). `review-call.mjs` mechanically enforces findings-shaped output — see **Output-format enforcement** and exit `10` below — so a clean review that doesn't emit this marker is indistinguishable from a malformed one.

## LLM provider integration

The skill supports any LLM backend. Provider and model are configured in `.faffrc`:

```yaml
faffter_dark:
  adversarial:
    provider: ollama                 # ollama | openai | vllm | openrouter | nvidia | deepseek | gemini | anthropic
    model: llama3.1:70b              # provider-specific model identifier
    host: http://localhost:11434     # ollama/vllm: base host. openai-compatible: base URL incl. /v1
    api_key_env: NVIDIA_API_KEY      # env var NAME holding the API key (not the key itself)
    reasoning_off: false             # true → send chat_template_kwargs:{thinking:false} (reasoning models)
    timeout: 120                     # seconds — bounds ONE stream attempt
    deadline: 480                    # FAFF-329: TOTAL wall-clock budget (seconds) across ALL attempts + fallback backends;
                                     #   default 480 (8 min, under the 900s runcheck staleness window) — a human-tunable
                                     #   turn-fit budget so the slow Phase-2 fits one subagent turn (too tight ⇒ more
                                     #   skipped_deadline, too loose ⇒ the stall it prevents returns)
    fallbacks: '[{"provider":"ollama","model":"qwen3-next:80b","host":"http://studio:11434"}]'   # FAFF-232, optional
```

**Fallback chain (FAFF-232).** The scalar block above is the **primary** backend. An optional `fallbacks` key adds an **ordered list of further backends**, each tried — in order — only when the one before it fails to produce findings (rate-limit, unreachable, persistent transport failure, auth, not-served). The first backend that returns findings wins; the chain reaches a terminal outcome only when **every** backend has failed. This keeps the L4 second-opinion gate firing through a single provider's outage instead of silently `pass+skip`ping.

- **Value is a JSON-string** — a quoted JSON array of backend objects `{provider, model, host, api_key_env?, reasoning_off?, timeout?}`; the skill `JSON.parse`s it. (The config parser has handled native YAML lists since FAFF-262, but the JSON-string form remains the canonical shape for this key — existing configs keep working unchanged.) Omit it for the single-backend behaviour (a one-element chain — unchanged).
- **Each fallback is self-contained** (its own `provider`/`model`/`host` required); omitted optional keys (`api_key_env`, `reasoning_off`, `timeout`) inherit the primary's.
- **No silent weakening** — an all-failed chain is never more pass-like than today's single backend: a config fault (auth / not-served / unsupported / unconfigured-default-host) anywhere in a fully-failed chain surfaces `needs-human`; only a chain of purely configured-host availability failures `pass+skip`s. The chain loop + terminal precedence live deterministically in `review-call.mjs` (`runReviewChain` / `chainTerminalExit`), not in this prose.

**Transport families** — `review-call.mjs` dispatches on `provider`:

| Provider | Transport | Host | Auth | Notes |
|---|---|---|---|---|
| `ollama` | ollama (`/api/tags` + `/api/chat`) | `host` (default `http://localhost:11434`) | none | Local, free, private |
| `openai` `vllm` `openrouter` `nvidia` `deepseek` `gemini` | OpenAI-compatible (`/v1/models` + `/v1/chat/completions`, SSE) | `host` = base URL **including `/v1`** (e.g. `https://integrate.api.nvidia.com/v1`; **gemini**: `https://generativelanguage.googleapis.com/v1beta/openai`) | `Bearer` from `api_key_env` | One code path for every OpenAI-shaped API. `gemini` rides Google's OpenAI-compat base URL — no adaptor of its own |
| `anthropic` | native (`/v1/messages`, named-event SSE) | `host` = `https://api.anthropic.com` | `x-api-key` + `anthropic-version` from `api_key_env` | No preflight (no model-list endpoint — a bad model id surfaces as a 404 → `needs-human`); no `reasoning_off` |

An unknown provider exits `2` (loud), never a silent pass. (A malformed `gemini` key returns HTTP 400 `API_KEY_INVALID`, which the helper classifies as auth → `needs-human`, never a silent `pass+skip`.)

**`reasoning_off`** — set `true` for a reasoning model that streams empty `content` unless its hidden think-block is disabled (e.g. NVIDIA `deepseek-*`). It adds `chat_template_kwargs:{thinking:false}` to the OpenAI-compatible payload (the analogue of ollama's always-on `think:false`). It is **opt-in** because vanilla OpenAI rejects the unknown field — leave it `false` for GPT-4o/o-series.

The key principle is **independence from the primary model**. If Claude wrote the code and ran the primary review, **don't set `provider: anthropic` here** — a same-family reviewer shares the blind spots the second opinion exists to catch. Use a structurally different model family (a local ollama model, a `gemini`, an `openai`/`nvidia`/`deepseek` backend) to maximise the chance of catching correlated blind spots.

**Backend call — the bundled `review-call.mjs` helper (do not hand-roll the API call).** The robust call is a tool, not prose (FAFF-183): `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` does model **preflight** (ollama `/api/tags` or OpenAI-compatible `/v1/models`), think-suppression (ollama `think:false`; OpenAI-compatible `--reasoning-off`), **streaming** (NDJSON or SSE — so a long response doesn't drop the connection), and a **token budget** with one truncation retry. Resolve `provider`/`host`/`model`/`timeout`/`api_key_env`/`reasoning_off` from `faffter_dark.adversarial` via `faff config get`, plus the FAFF-329 total-budget **`deadline`** (`faff config get faffter_dark.adversarial.deadline -d 480`), then invoke:

```bash
node "$REVIEW_CALL" --host "$host" --model "$model" --timeout "$timeout" --deadline "$deadline" \
  --host-source "$host_source" \
  --provider "$provider" --api-key-env "$api_key_env" ${reasoning_off:+--reasoning-off} \
  ${run_dir:+--run-dir "$run_dir"} \
  --system <review-lens-file> \
  --context plugin/skills/faff/SKILL.md --context <each file the diff touches> \
  --diff <git-diff-file>
```

**Pass `--run-dir "$run_dir"` whenever faff-graft forwarded a `$run_dir`** (the same value the review-progress checkpoint writes already use — every autonomous L3/L4 dispatch; interactive runs have none and omit it). This is a value **passthrough**, not a decision: the helper reads `<run-dir>/run-ledger.json` itself and derives mandatory-ness from `level: "L4"` (FAFF-401 — see **MANDATORY chain-outage** below). Append it identically at L3 and L4 — no prose conditional.

**When `faffter_dark.adversarial.fallbacks` is set (FAFF-232)** — build the ordered chain and pass it as one `--backends-json` file instead of the single-backend flags above. Resolve the block as JSON (`faff config get --json faffter_dark.adversarial`), `JSON.parse` the `fallbacks` string, assemble `[primary, ...fallbacks]` (each `{provider, model, host, host_source:"config", api_key_env?, reasoning_off?, timeout?}`, omitted optional keys inheriting the primary's), write it to a temp file, and invoke `node "$REVIEW_CALL" --backends-json <file> ${run_dir:+--run-dir "$run_dir"} --system … --context … --diff …` (carry `--run-dir` on the chain form too). The helper iterates the chain; the **exit-code → outcome table below is unchanged** — the chain only changes *which* exit the helper returns. With no `fallbacks` key, use the single-backend invocation above verbatim (a one-element chain).

- **`--provider`** = the configured provider (omit → defaults to `ollama`). **`--api-key-env`** = the env var **name** (the helper reads the key from `process.env`; the key is never on the command line). **`--reasoning-off`** = pass only when `reasoning_off: true`.
- **`--system`** = the review lens above (the five categories), written to a file.
- **`--context`** = the **gateway** (`plugin/skills/faff/SKILL.md`) **plus every file the diff touches** — so the reviewer can verify existence/structure claims instead of hallucinating "this heading doesn't exist" from a diff-only view. (FAFF-183: a model given only the diff produced confident false criticals; a *more* capable model was *more* wrong for exactly this reason.)
- **`--diff`** = `git diff main...HEAD` written to a file.
- **`--deadline`** (FAFF-329) = the total wall-clock budget in seconds (`faffter_dark.adversarial.deadline`, default `480`), distinct from `--timeout` (one attempt). The helper stops before starting a new backend past the budget and clamps every attempt to what remains, so the composed `~6×timeout×backends` blowup cannot end the subagent's turn mid-Phase-2. Deadline-exceeded → exit `8` (below). Omit only to run unbounded (the pre-FAFF-329 behaviour).
- **`--host-source`** (FAFF-213) = the **provenance** of `$host`: never silently substitute the localhost default. Resolve it off the `faff config get` exit status — `faff config get faffter_dark.adversarial.host` **exits non-zero (3) when the key is unset**:
  - **Key resolves** (exit 0) → `$host_source=config`; pass `$host` as-is.
  - **Key unset** (non-zero exit) → `$host_source=default`; pass the documented `http://localhost:11434` so the probe can run and produce the distinct exit 6. Do **not** treat the resulting outage as `pass+skip` — an absent provider block must not invisibly disable the review (the same principle as the model-not-served exit-4 case). Keying off "non-zero exit ⇒ unconfigured" (not a specific code) keeps this robust if the CLI's unset-key code changes.

**Exit code → Phase-2 outcome (mechanical — the helper decides, not prose).** The helper returns the **same exit code in both modes** (`review-call.mjs` exit semantics are unchanged); the two mode columns are how *this slot* handles that code. Only **exit 5 diverges** — an autonomous full-chain outage is loudly annotated, never a bare pass (see **Full-chain outage annotation** below):

| exit | meaning | interactive (L2) | autonomous (L3/L4) |
|---|---|---|---|
| `0` | findings on stdout | parse `## Adversarial findings`, disposition each (below) | same |
| `2` | usage error, or a genuinely unknown provider (not one of ollama / openai / vllm / openrouter / nvidia / deepseek / gemini / anthropic) | **`needs-human`** — a config fault, not a review result. | same |
| `4` | configured model **not served** by the host (config fault — e.g. a name typo) | **`needs-human`**, naming the mismatch. **Never** silent `pass` — a misconfigured model must not invisibly disable the review. | same |
| `5` / timeout | provider **unreachable**, `--host-source config` — an **explicitly-configured** host down (incl. an explicit `localhost`), **or** a persistent mid-stream **transport failure** after the bounded retry (FAFF-227; incl. a persistent **HTTP 429 rate-limit** — FAFF-228) on a configured host | `pass` + a finding noting the skip — don't block the pipeline on infra; explicit config is the human's call. | `pass` + a **LOUD** skip finding + block field `adversarial_outcome:"chain-outage-skipped"` — never an undifferentiated pass. The morning brief, not a park, surfaces the gap (an outage is no code defect). |
| `6` | provider **unreachable**, `--host-source default` — the localhost fallback because `faffter_dark.adversarial.host` was **unset**, **or** a persistent mid-stream **transport failure** (FAFF-227; incl. a persistent **HTTP 429 rate-limit** — FAFF-228) on the default host | **`needs-human`** — adversarial review configured but no provider set. **Never** silent `pass` — an absent provider block must not invisibly disable the review (FAFF-213, same class as exit 4). | same |
| `7` | **auth failed** (cloud `401`/`403`, or the `api_key_env` var is unset) | **`needs-human`** — don't retry with broken credentials. | same |
| `8` | **deadline exceeded** (FAFF-329) — the total `--deadline` wall-clock budget was hit before any backend produced findings (a *slow-but-healthy* Phase-2, not a config fault) | `pass` + skip the second opinion, **logged loudly** (`phase2: skipped-deadline`) so a mis-tuned budget is visible, never silent. | same — `pass` + skip, logged loudly. **Distinct from the exit-5 outage annotation** (a deadline is a slow-but-healthy backend, not an availability outage) — no `chain-outage-skipped` field. A needs-human-class fault seen on an earlier backend still dominates (the helper returns that code, not `8`). Advisory only — on a **mandatory** chain a deadline exhaustion is remapped to exit `9` (fail-closed), see below. |
| `9` | **mandatory chain-outage** (FAFF-398) — a **MANDATORY** (L4 lights-out) review's chain exhausted with only *no-opinion* classes (all-unreachable `5` *or* deadline `8`), no config fault present. Only produced when the review resolved **mandatory** — ledger-derived from an L4 `--run-dir`/`FAFF_RUN_DIR` (FAFF-401), or forced by an explicit `--lights-out` (see **MANDATORY chain-outage** below) | *not reachable* — mandatory-ness only resolves true on an L4 run | **`unavailable`** (FAFF-405) — park the PR; author `adversarial_outcome:"mandatory-chain-outage"` (retained forensics-only, no longer load-bearing). No second opinion was obtainable and no human is watching, so the mandatory gate **fails closed** (never pass+skip) — an availability failure, not a `needs-human` verdict. |
| `10` | **malformed** (FAFF-194) — the winning backend's output is not findings-shaped: empty/whitespace, or prose with no recognised `### <severity>:` finding section. A model-quality fault, checked **per-backend** inside the fallback chain (a malformed primary still advances to a healthy fallback), so a fully-exhausted chain containing this class terminates at exit `10`, never `5`. | **`needs-human`**, naming the malformed output. **Never** silent `pass` — the mechanically-enforced form of the malformed-output rule below. | same |

A **transient transport fault during streaming** (HTTP 5xx, a dropped socket — `ECONNRESET`/`ETIMEDOUT`/`EPIPE`/"socket hang up", a stream timeout, or an **HTTP 429 rate-limit** — FAFF-228) is **retried** a bounded number of times with exponential backoff before it counts as a failure; only a **persistent** one lands on exit `5`/`6` above (FAFF-227/228). `--timeout` bounds **each individual stream attempt and the inter-retry sleeps** — *not* the total wall-clock: worst-case per-backend wall-clock is **~6× `--timeout`** (3 attempts × 2 `streamOnce`) under stream + truncation + transport-retry composition (FAFF-228 doc correction), and across a fallback chain that composes further. **`--deadline` (FAFF-329) is the cap on that composed total** — the helper never starts a new backend past the budget and re-clamps every attempt to what remains, so the whole chain fits one subagent turn (exit `8` when it binds). **`OTHER` (exit `1`) is reserved for genuine programmer error — no transport/infra condition (now including a rate-limit or a deadline) exits `1`**, so every exit the helper returns is covered by this table.

Malformed/empty content from a reachable+served model → `needs-human` with the raw output (a human decides). **Mechanically enforced (FAFF-194):** `review-call.mjs` validates the winning backend's output shape itself (`validateFindingsShape` — non-empty AND >=1 recognised `### <severity>:` section) and exits `10` on a miss; this is no longer prose-only — a header-skipping or content-free response can no longer silently pass as exit `0`.

### Full-chain outage annotation (autonomous exit 5)

On an **autonomous** run where the exit is `5` (every backend in the chain unreachable — a full-chain availability outage), the pipeline is not blocked, but the skip must never read as a silent pass. Do two things when authoring the output:

- **Emit a loud skip header** in place of the normal findings block:

  ```
  ## Adversarial findings — SKIPPED (all backends unreachable)

  This build shipped without adversarial review — every configured backend was unreachable.
  ```

- **Set the contract block** to `{ "signal": "pass", "findings": [], "adversarial_outcome": "chain-outage-skipped" }`. The signal stays `pass` (an infra outage produces no finding to gate on — parking would conflate availability with quality), but the optional `adversarial_outcome` field marks *why* it passed without review. faff-graft forwards the token; the beep-boop orchestrator records the issue id in its ledger's `review_adversarial_skipped` array and renders it in a distinct run-summary subsection, so the run never presents it as an undifferentiated auto-merge.

On an **interactive** exit 5 the behaviour is unchanged: `pass` + a plain finding noting the skip, **no** `adversarial_outcome` field, no loud header — a watched human may reasonably proceed on a dead chain.

This annotation path and the **Autonomous-run escalation** below are **mutually exclusive**: escalation requires Phase-2 findings (exit 0), the outage annotation requires no findings (exit 5) — a single review can never hit both. (A deadline-skip — exit 8 — is a third, distinct case: a slow-but-healthy backend, `pass` + skip with no outage annotation. The **MANDATORY chain-outage** — exit 9, below — is the L4-only fail-closed counterpart of this exit-5 advisory skip: the same no-findings exhaustion, opposite direction, because on L4 the second opinion is mandatory.)

### MANDATORY chain-outage (L4 lights-out — fail closed, FAFF-398)

On a **lights-out (L4)** run the adversarial second opinion is *mandatory* — `dialCoherence` refuses to start an L4 run whose `slots.review` is not the adversarial occupant — and no human is watching. So a full-chain exhaustion that obtained **no** opinion must **fail closed**, not pass+skip:

- **The helper derives mandatory-ness itself from the run ledger — no prose→flag translation (FAFF-401).** Pass `--run-dir "$run_dir"` on every autonomous invocation (above); `review-call.mjs` reads `<run-dir>/run-ledger.json` and treats `level: "L4"` as mandatory, with `FAFF_RUN_DIR` as the ambient fallback. The slot no longer decides a boolean — it only carries the run-dir **path**, so a dropped/misread `lights_out` signal can no longer silently downgrade the review to advisory. `--lights-out` remains as an explicit deterministic **override** that forces mandatory (tests, or a caller that already resolved L4-ness); the two are OR-composed (`mandatory = ledger || --lights-out`). Unresolved/absent (no run-dir, non-L4 ledger, no flag) ⇒ advisory, byte-for-byte today's behaviour.
- When the review resolves **mandatory** (ledger-derived or flag-forced), the helper remaps a no-opinion exhaustion (all-unreachable `5` or deadline `8`) to **exit `9` (MANDATORY_OUTAGE)**; a config-fault class (2/4/6/7) still **dominates unchanged** (the remap never masks a cause).
- On exit `9`, author `signal: unavailable` (FAFF-405 — a KNOWN fail-closed value distinct from `needs-human`; never `pass`) with one finding naming the outage (a location + an action, per the needs-human finding-shape rule), and set `adversarial_outcome:"mandatory-chain-outage"` (forensics-only — the signal now carries the meaning). faff-graft dispositions `unavailable` EXACTLY as `needs-human`: this is Phase 1's hard signal, so faff-graft's Step 9 parks it pre-PR, unchanged (no PR is opened — same no-PR human handoff as `needs-human` today; FAFF-403 will later give `unavailable` its own retry-later disposition, not this ticket). No graft merge-floor edit is needed either way — `unavailable` was already never `pass`, so a stray block reaching Step 10 would fail the floor regardless.

**Why this keys off `lights_out`, not `autonomous` (intentional asymmetry).** A Phase-2 `critical` *finding* is a real code defect — even an L3 overnight merge must not land it — so **Autonomous-run escalation** keys off `autonomous` and fires at L3 too. A chain *outage* is infra, not a defect: an L3 overnight run has a **morning human** to whom the loudly-annotated exit-5 skip surfaces the gap, so pass+skip is tolerable there; an L4 lights-out run has **no** human at all, so the only safe direction is to park. Advisory exit `5`/`8` (L1–L3, or any run where mandatory-ness stays unresolved — no L4 ledger and no `--lights-out`) keep today's pass+skip and the `chain-outage-skipped` annotation, unchanged.

### Review-progress checkpoint (FAFF-329 — autonomous resume)

When faff-graft forwards `$run_dir` + `<ISSUE>` (autonomous L3/L4 only — interactive skips this), write the review-progress checkpoint at the phase boundaries so a re-dispatched build subagent **resumes** instead of repeating the slow Phase-2 (graft Step 9 → **Resume from a review-progress checkpoint**). All writes go through the deterministic CLI — never a hand-rolled JSON edit:

- **Honour a resume hint.** If graft invoked with "skip Phase-1, run only Phase-2" (its diff-identity guard confirmed the checkpointed `phase1.verdict=pass` still matches the current diff), **do not re-run Phase-1** — resume at Phase-2. Absent a hint, run Phase-1 normally.
- **After a Phase-1 `pass`:** `faff review-progress write "$run_dir" <ISSUE> --phase1-pass --diff-hash <cur_hash>` (a `fail`/`needs-human` is already terminal — return, write nothing, no Phase-2).
- **Before the `review-call.mjs` call:** `faff review-progress write "$run_dir" <ISSUE> --phase2 in_flight` — this is the stall window the checkpoint exists to survive.
- **On the call's resolution, map the exit → the phase2 status:** exit `0` → `--phase2 complete --findings <path>`; exit `8` → `--phase2 skipped_deadline`; a `5`/`6`-class unreachable pass+skip → `--phase2 skipped_unreachable`. **Exit `9` (mandatory chain-outage) is a terminal `unavailable` (FAFF-405), NOT a skip** — it returns terminal without any `--phase2 skipped*` write (a `skipped_unreachable` status would misrepresent a fail-closed park as a tolerated skip). (A needs-human or unavailable exit returns terminal without a `complete` write.)

The checkpoint is a **hint** — graft reconciles it against git/PR/worktree truth on any disagreement (the diff-identity guard discards a stale `pass`), so it can only ever *save* repeated work, never skip the hard review for the wrong diff.

## Output to faff-graft

Returns Phase 1's hard signal (`pass` / `fail` / `needs-human` / `unavailable` — the last only from a MANDATORY chain-outage, FAFF-405) plus the adversarial findings and the implementor's dispositions. The adversarial phase does not alter the signal — it adds evidence that the implementor has addressed. Sequencing (iterate, raise PR, park) belongs to faff-graft.

## Contract artifact (FAFF-108)

After the output above, append **one** fenced code block — tagged `faff-contract:review-verdict`, as the **last** thing in the output — declaring **Phase 1's hard verdict only**, so faff-graft (the consumer) parses it **deterministically** (no LLM re-read) and pipes it to `faff contract review-verdict`. You authored Phase 1's verdict, so you declare it directly; the block mirrors the prose, it is not a second source of truth. (Same pattern the `spec` producer adopted for `faff-contract:spec-readiness`.)

````
```faff-contract:review-verdict
{ "signal": "<Phase 1's verdict: pass|fail|needs-human>",
  "findings": [ { "location_present": <bool>, "action_present": <bool> }, ... one per Phase-1 finding ],
  "adversarial_outcome": "chain-outage-skipped"   // OPTIONAL — omit unless the autonomous full-chain-outage case fired
}
```
````

- **Phase 1's verdict only** — *except on the autonomous path*, where a Phase-2 `critical` escalates `signal` to `needs-human` (see **Autonomous-run escalation**). Otherwise `signal` is Phase 1's hard signal; `findings` carries one entry per **Phase-1** finding, each declaring whether it named a code **location** (`location_present`) and a concrete **action/fix** (`action_present`).
- **Phase-2 adversarial hypotheses are NOT the verdict** — they stay prose under `## Adversarial findings` and are **never** entered into `findings[]` (except the single autonomous-escalation carve-out below). Folding soft hypotheses in would misrepresent the hard verdict the gate routes on. The one narrow carve-out is the autonomous `critical` escalation below: there the escalating `critical` *is* the verdict-driver (the signal is `needs-human` **because of** it), so it is entered honestly — scoped strictly to that escalation, off which this rule is unchanged.
- **`adversarial_outcome` is OPTIONAL and additive** — include it **only** in the autonomous full-chain-outage case, set to `"chain-outage-skipped"` (see **Full-chain outage annotation**); omit it on every other path. The contract validator (`faff contract review-verdict`) reads only `signal`+`findings` and **neither rejects nor forwards** unknown fields — its output is rebuilt from `signal`+`findings` alone, so `adversarial_outcome` **never gates the verdict**. It rides instead on the **raw verdict block** graft persists per-issue (`review-verdict.json`), which the beep-boop orchestrator reads **directly** during its reconciliation to populate the ledger's `review_adversarial_skipped` array — not from the contract script's stdout.
- `pass` may carry zero findings; `fail` / `needs-human` carry ≥1 (the contract script enforces this).
- Do **not** include `provenance_present` — that field is spec-specific; the review-verdict extraction the gate routes on is just `{ signal, findings }` (plus the optional `adversarial_outcome` annotation above).
- **One** block, at the very end, machine-only. **Always emit it** — a present-but-malformed block fails loud downstream (producer breakage), so emit valid JSON matching the shape exactly. (Omitting it falls back to faff-graft reading your prose — the absent-block fallback.)

## Autonomous-run escalation

On **any autonomous run** (L3 overnight or L4 lights-out), a Phase-2 `critical` finding must **stop the merge**, not merely be logged — no human is awake to weigh a soft `critical`, and the implementor the finding indicts must not be the one to clear it. When the forwarded `autonomous` signal is true, escalate the Phase-2 severity into the hard verdict at the moment you author the `faff-contract:review-verdict` block:

- **Escalation threshold — a single named set.** `ESCALATE_SEVERITIES = { critical }` (v1). Only `critical` escalates; `major` / `minor` / `observation` never do, because a lower-capability adversarial model's `major` findings are too noisy to auto-park a run on. To widen the threshold later, add the severity to this one set (e.g. `{ critical, major }`) — nothing else changes.
- **When it fires — all three must hold:** Phase 1 returned `pass` (so Phase 2 ran), the forwarded `autonomous` signal is true, and at least one Phase-2 finding has a severity in `ESCALATE_SEVERITIES`. The trigger is the **raw** Phase-2 severity, **not** the implementor's disposition of it — a build agent must not be able to disprove its own way past the gate (marking its own homework is the failure this escalation exists to remove). A false-positive `critical` therefore parks the run for a human to clear: a recoverable park is the intended trade against an unrecoverable false auto-merge.
- **What it emits.** Set the block's `signal` to `needs-human`, and fold each escalating `critical` into `findings[]` as `{ "location_present": true, "action_present": true }` — one entry per escalating finding. A gate-worthy `critical` names a location and an action by the actionability bar (see **Rules**), so these are truthful for a well-formed finding and act as the escalation's conformance markers; the substantive per-finding detail lives in the prose `## Adversarial findings`, exactly as on every other path. This satisfies the contract's rule that a `needs-human` signal carries at least one finding naming a location and an action.
- **Fail-safe direction.** When the `autonomous` signal is false, absent, or unresolved, do **not** escalate — author the block exactly as the advisory path does. This fails safe *off* on an unresolvable signal, matching the interactive default.

On an **interactive (L2)** run — `autonomous` false — this section is inert: the block is authored byte-for-byte as it is today, with Phase-2 findings advisory. This escalation (findings present, exit 0) is **mutually exclusive** with the **Full-chain outage annotation** (no findings, exit 5) — a single review can never trigger both.

## Rules

- Never agree with the primary review by default. Actively look for what it missed.
- Never invent requirements. Every finding must trace to the spec, the code's own contracts, or a universally expected property (no crashes, no data loss, no security holes).
- Keep findings actionable. "This might be a problem" is not a finding. "This path doesn't handle X, which the spec requires in AC-3" is.
- The local LLM may produce lower-quality output than the primary model. That's fine — the value is independence, not superiority. A mediocre reviewer with different biases catches things an excellent reviewer with the same biases won't.
