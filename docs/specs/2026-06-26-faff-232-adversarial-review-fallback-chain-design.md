# Spec — FAFF-232: Adversarial-review fallback chain of backends

> Spec: faffter-dark-nlspec · 2026-06-26 · interactive · confidence: medium. Full spec on Linear FAFF-232.

> **Build note (reconciled to shipped code).** Two config-shape sub-decisions changed during build after the spec's `**Assumes:**` (the YAML parser turns sequences into arrays) was **validated and found false** — `parseYamlSubset` stores both block sequences and inline flow as raw scalars. Per the spec's own documented fallback (§6 option b), the config shape shipped as a **`fallbacks` JSON-string scalar** (a quoted JSON array the skill `JSON.parse`s), **not** a native YAML list — so **no `config dump` extension and no parser change were needed** (read via the existing `config get`). The chain loop + terminal precedence still live deterministically in `review-call.mjs` (`runReviewChain` / `chainTerminalExit`), and the advance-all-with-needs-human-dominant-terminal policy is unchanged. Read §3/§6/§7/§8 below in light of this note: wherever they say "`config dump` KEY extension" or "native YAML `fallbacks:` list", the shipped form is the JSON-string scalar read via `config get` (no CLI/parser change).

This is the build contract for FAFF-232, for the build agent and human reviewers. It turns the single-backend adversarial reviewer into an **ordered chain** that advances to the next backend when one is unavailable, so a single provider's outage or throttle no longer silently disables the L4 second-opinion gate.

## 1. WHY — Problem and Principles

**The load-bearing model:** the adversarial Phase-2 reviewer is *one* helper invocation (`review-call.mjs`) against *one* backend. Make that invocation iterate an **ordered list of backends**, returning the first one that produces findings, and only emitting a terminal outcome when *every* backend has failed. Everything else (the exit→outcome table the skill branches on, the per-backend transport retry) stays as-is.

**Problem statement.** Today the reviewer talks to a single configured backend; when it is throttled or down the helper returns exit 5 (configured-host unreachable / persistent-429) → **pass + skip**, so the gate silently no-ops and "review: pass" can mean *the only reviewer was down*. There is per-backend transport retry (FAFF-227) but no second model to fall back to. This change adds a fallback chain so the gate keeps firing through one provider's outage.

**Design principles.**

- **Deterministic mechanics live in the helper, not prose.** The chain loop and the terminal-outcome precedence are deterministic and must live in `review-call.mjs` (testable, reproducible) — the skill prose only resolves config and passes it in. (Governing tenet: deterministic-tools-over-prose.)
- **No silent weakening.** The exhausted-chain terminal outcome must never be *weaker* (more pass-like) than today's single-backend outcome for the same failures. A config fault anywhere in an all-failed chain must still surface as `needs-human` — the FAFF-213/228 invariant that a misconfiguration must not invisibly disable review.
- **Back-compat is non-negotiable.** A repo with only the scalar `faffter_dark.adversarial` block (no `fallbacks`) must behave **exactly** as today — a one-element chain, identical invocation, all existing tests green unchanged.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (ESM) | The single-backend helper; gains the chain loop + terminal precedence |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | prose | Resolves config, invokes the helper; gains the chain-build branch |
| `plugin/skills/faff/bin/faff` (`config` subcommand) | Node | `config dump`/`get`; `dig()` rejects arrays — the read-the-list constraint |
| `test/adversarial-call.test.mjs` | Node test | Injectable `runReviewFn`/`getFn`/`streamFn`; exit-code assertions |
| `.faffrc.example.yaml`, `.faffrc.yaml` | YAML | Document + carry the adversarial block |

**Scope statement.** This sits entirely inside the `review` slot's adversarial occupant + the config CLI's read path; it does not touch faff-graft's gate, the verdict contract, or the review lens.

## 2. OUT OF SCOPE

- **Chain-wide time ceiling.** v1 uses a per-backend timeout (each backend gets its own `--timeout`). A single deadline spanning the whole chain is **excluded** — *Why:* it needs a shared deadline threaded through each backend's transport-retry, materially more complex, and chain length is small and human-controlled. *Extension point:* a `faffter_dark.adversarial.chain_timeout` key consumed by a chain-level deadline wrapper around the loop in `review-call.mjs`.
- **Parallel/fastest-wins backends.** The chain is strictly sequential, first-success-wins. *Why:* parallel calls multiply cost and complicate attribution. *Extension point:* a `strategy: sequential|race` key on the chain.
- **Per-backend independent review lenses.** All backends receive the same `--system` lens + `--context` + `--diff`. *Why:* the lens is the contract, not the backend. *Extension point:* per-backend `system_override` in the backend object.
- **Native gemini/anthropic transports** (FAFF-210) and the **429 exit mapping** (FAFF-228, already shipped) — unchanged here.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Backend | One `{provider, model, host, …}` target the reviewer can call |
| Chain | The ordered list of backends tried in sequence: `[primary, ...fallbacks]` |
| Advance | Move from backend N to N+1 because N did not produce findings |
| Terminal outcome | The single exit code the helper returns after the whole chain is exhausted |

**Config shape (native YAML list beside the scalar primary).**

```
faffter_dark:
  adversarial:                  # the PRIMARY backend = chain element 0 (unchanged keys)
    provider: nvidia
    model:    nvidia/nemotron-3-super-120b-a12b
    host:     https://integrate.api.nvidia.com/v1
    api_key_env: NVIDIA_API_KEY
    reasoning_off: false
    timeout:  1200
    fallbacks:                  # OPTIONAL ordered list; each tried after the primary
      - provider: ollama
        model:   qwen3-next:80b-a3b-instruct-q4_K_M
        host:    http://studio.longhair-escalator.ts.net:11434
      - provider: openai
        model:   gpt-4o
        host:    https://api.openai.com/v1
        api_key_env: OPENAI_API_KEY
```

```
RECORD Backend:
  provider:     String              # required; ollama|openai|vllm|openrouter|nvidia|deepseek
  model:        String              # required
  host:         String              # required
  host_source:  "config"|"default" # derived, not authored; "config" for every listed backend
  api_key_env:  String?            # optional; required only for cloud providers
  reasoning_off: Bool = false      # optional; inherits primary's value if omitted
  timeout:      Int?               # seconds; optional; inherits primary's timeout if omitted

CONSTRAINT every fallback specifies its own provider+model+host
RULE omitted optional keys (api_key_env, reasoning_off, timeout) inherit the PRIMARY scalar's value
```

**Effective chain** = `[primary-from-scalars, fallbacks[0], fallbacks[1], …]`. With no `fallbacks` key, the chain is `[primary]` — one element, today's behaviour. With **no adversarial block at all**, the chain is the single unconfigured-localhost-default element with `host_source: "default"` (today's exit-6 path), unchanged.

**Reading the list (the `dig()` constraint).** `faff config get <dotted>` cannot read arrays (`dig()` rejects array nodes). The chain is read via a **`config dump` subtree extension** instead:

**Chosen:** Extend `faff config dump` to accept an optional dotted `KEY` and `--json`, emitting that subtree (arrays included) by walking the *parsed* config object — not via `dig()`. The skill calls `faff config dump faffter_dark.adversarial --json`, assembles the effective chain, and passes it to the helper as a file. — *Rationale in §6.*

**Helper interface (new flag).**

```
review-call.mjs --backends-json <file>   # complete ordered chain as a JSON array of Backend
                                         # when present, the single-backend flags are ignored
                                         # when absent, the existing single-backend flags act as a 1-element chain
```

All other flags (`--system`, `--diff`, `--context…`) are unchanged and shared across the chain.

## 4. HOW — Behavior

**Architecture.** A new wrapper `runReviewChain(chain, sharedOpts)` sits *above* the existing single-backend orchestration. For each backend it maps the existing `runReview()` result to the same exit class the single-backend `main()` would have produced, returns immediately on the first success, and on full exhaustion computes one terminal exit via a precedence function. `main()` builds the chain (from `--backends-json`, else a 1-element chain from the legacy flags) and calls `runReviewChain`; the single-backend functions are otherwise untouched.

```
PROCEDURE runReviewChain(chain, sharedOpts):
  1. failureClasses := []          # collected per-backend non-OK exit classes, in order
  2. FOR each backend IN chain:
     a. result := runReview({ ...sharedOpts, ...backend })   # existing per-backend path,
                                                              # incl. FAFF-227 transport retry + FAFF-228 429
     b. exitClass := mapResultToExit(result, backend.host_source)   # 0|2|4|5|6|7 (existing logic)
     c. IF exitClass == OK:
        - write findings to stdout (the winning backend's "## Adversarial findings — provider/model")
        - log the chain trace (skipped backends + their classes) to stderr
        - RETURN OK                # first success wins
     d. ELSE:
        - push exitClass onto failureClasses
        - log "advancing: <provider>/<model> failed (exit <class>)" to stderr
  3. # chain exhausted, no success
  4. log full chain trace to stderr
  5. RETURN chainTerminalExit(failureClasses)
```

**Advance rule — advance on *every* non-OK class.** The chain tries the next backend regardless of *why* the current one failed (rate-limit, unreachable, transport-failed, auth, not-served, unsupported). The whole value of the chain is "get a real second opinion from *someone*"; a per-backend config fault must not sink the chain if a healthy fallback exists. The fault is not lost — it is recorded and feeds the terminal precedence.

**Terminal precedence — needs-human dominates pass+skip.** Only reached when *no* backend produced findings:

```
PROCEDURE chainTerminalExit(failureClasses):
  1. needsHuman := { USAGE(2), NOT_SERVED(4), DEFAULT_HOST_UNREACHABLE(6), AUTH(7) }
  2. IF any class IN failureClasses is in needsHuman:
       RETURN the first such class            # → skill maps to needs-human
  3. ELSE:                                     # all failures were availability on configured hosts
       RETURN UNREACHABLE(5)                   # → skill maps to pass+skip (infra outage, human's call)
```

This is the no-silent-weakening guarantee in code: a chain that is purely unreachable/429 on configured hosts still `pass+skip`s (5) exactly as a single configured backend does today; but if a config fault (auth/not-served/unsupported/default-host) appears anywhere in a fully-failed chain, the terminal is `needs-human` — the fault surfaces rather than being masked by "everything was just down."

**The skill's exit→outcome table is unchanged.** `0→parse`, `5→pass+skip`, `2/4/6/7→needs-human`. The chain only changes *which* exit the helper returns; the skill maps it identically. The skill's only new logic is building the chain JSON when `fallbacks` is present.

```
PROCEDURE skill_resolve_and_invoke:   # faffter-dark-adversarial-review/SKILL.md
  1. block := faff config dump faffter_dark.adversarial --json   # exit 3 ⇒ unset
  2. IF block unset:
       invoke helper with the unconfigured-localhost single-backend flags, --host-source default  # today's exit-6 path
  3. ELSE:
       chain := [ primary(block) ] + (block.fallbacks ?? []) with optional keys inherited from primary
       set host_source="config" on every element
       write chain to a temp file; invoke `node review-call.mjs --backends-json <file> --system … --context … --diff …`
  4. map helper exit → outcome via the UNCHANGED table
```

**Edge cases.**
- Empty `fallbacks: []` → chain is `[primary]`, identical to no `fallbacks` key.
- A fallback missing a required key (provider/model/host) → the helper treats that backend as a config fault (exit class 2/USAGE) for *that element*, advances, and the fault feeds the terminal precedence (so an all-failed chain with a malformed element ⇒ needs-human). It does **not** abort the whole chain.
- `--backends-json` present **and** legacy single-backend flags present → `--backends-json` wins; legacy flags ignored (documented).
- Single successful backend that itself returns truncated/partial findings → unchanged FAFF-183 behaviour (exit 0 with a truncation note); still a success, chain stops.

**Failure modes.**
- **The failure:** a misconfigured primary (bad creds / wrong model name) is *masked* by a healthy fallback — the gate fires, but the human never fixes the primary. **How you'd know:** the stderr chain-trace records `advancing: <primary> failed (exit 7/4)` on every run even though review passes. **What it means:** proceed (the gate genuinely fired), but the trace is the signal for the human to repair the primary; it is logged into the graft log, never swallowed.
- **The failure:** total wall-clock blows up — a 3-backend chain at a large `timeout` with per-backend retry can reach ≈ `chainLength × 6 × timeout` worst case. **How you'd know:** review phase wall-time grows with chain length on outages. **What it means:** narrow — document the multiplier so the human sizes `timeout`/chain length; the chain-wide ceiling (OUT OF SCOPE) is the fix if it bites.

**Anti-pattern:** putting the chain loop in the SKILL.md prose. Why: it's deterministic control flow that must be unit-tested and reproducible — it belongs in `review-call.mjs` per the governing tenet.

**Anti-pattern:** terminating the chain on the first auth/not-served fault. Why: it defeats the feature (a working fallback would never be reached); the fault is preserved in the terminal precedence instead.

## 5. SCENARIOS

```
Given a chain [A(configured), B(configured)] where A returns persistent HTTP 429
When the reviewer runs
Then B is invoked, and if B returns findings the helper exits 0 with B's "## Adversarial findings — provider/model"
```

```
Given a chain [A, B] where A is unreachable (exit 5) and B is unreachable (exit 5)
When the reviewer runs and the chain is exhausted with no success
Then the helper exits 5 (pass+skip) — identical to a single configured backend being down
```

```
Given a chain [A, B] where A returns auth-fail (exit 7) and B is unreachable (exit 5)
When the chain is exhausted with no success
Then the helper exits 7 (a needs-human class) — the config fault is not masked by "B was just down"
```

```
Given only the scalar adversarial block (no `fallbacks` key)
When the reviewer runs
Then the invocation and outcome are byte-for-byte today's single-backend behaviour
```

```
Given no adversarial block configured at all
When the reviewer runs against the localhost default and it is unreachable
Then the helper exits 6 (needs-human) via host_source=default — unchanged
```

## 6. DESIGN DECISION RATIONALE

**Where does the chain loop live?**
- Helper (`review-call.mjs`) vs skill prose.
- **Chosen:** the helper — deterministic control flow + terminal precedence must be unit-testable and reproducible (deterministic-tools-over-prose). The skill stays thin (resolve config, pass JSON).

**How is the chain expressed and read, given `dig()` rejects arrays?**
- (a) native `fallbacks:` YAML list + extend `config dump KEY --json` to emit the subtree (arrays included, walking the parsed object); (b) store fallbacks as a JSON-string scalar `fallbacks_json:` that `config get` can already read; (c) extend `dig()` for indexed access.
- **Chosen:** (a) — native YAML list is the better config UX ("configurable, not opinionated" + understandable), and a subtree-selecting `config dump KEY --json` is a small, generally-useful, testable affordance that preserves CLI-only config access. (b) is the cheaper fallback if the dump extension proves larger than expected (rejected for uglier config); (c) rejected — touching `dig()` risks every scalar reader for one consumer's need.

**Advance vs terminate per failure class.**
- Advance only on availability (429/unreachable/transport) vs advance on all classes.
- **Chosen:** advance on **all** non-OK classes, and preserve safety at the terminal step via a precedence where any config-fault class (2/4/6/7) dominates pass+skip (5). This delivers availability (a working fallback is always reached) without re-introducing the silent-config-fault hole FAFF-213/228 closed (an all-failed chain with a fault ⇒ needs-human).

**Timeout budget.**
- Per-backend `--timeout` each vs a chain-wide ceiling.
- **Chosen:** per-backend (each backend keeps today's per-attempt semantics); chain-wide ceiling is OUT OF SCOPE with a named extension point. Rationale: simplest, preserves existing semantics, chain length is small/human-controlled; the worst-case multiplier is documented.

**All-exhausted terminal exit when classes are mixed.**
- **Chosen:** `chainTerminalExit` returns the first needs-human class if any, else 5. Since the skill maps all of {2,4,6,7} to needs-human, the exact code among them is informational; 5 only when *every* failure was configured-host availability.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. (The config-shape decision adds CLI surface — see §6; flagged in the confidence note for human confirmation rather than left as a Punt.)

**Assumptions.**
- **Assumes:** the faff YAML parser already parses block/inline arrays into JS arrays (confirmed by explore — storable today; only `config get`/`dig()` can't *read* them), so `config dump`'s subtree walk can serialize the `fallbacks` array without parser changes. *Validation:* add a `config dump faffter_dark.adversarial --json` selftest case asserting the array round-trips.

## 8. DONE — Definition of Done

### From WHY
- [ ] A chain whose primary is throttled/down still produces a real second opinion when any fallback is healthy (gate fires instead of pass+skip).
- [ ] No-silent-weakening: an all-failed chain is never more pass-like than a single backend failing the same way.

### From WHAT (config + interface)
- [ ] `fallbacks:` documented in `.faffrc.example.yaml` as an ordered list of backend objects; live config unaffected when absent.
- [ ] Omitted optional fallback keys (api_key_env, reasoning_off, timeout) inherit the primary's value; provider/model/host required per fallback.
- [ ] `faff config dump [KEY] [--json]` emits a selected subtree with arrays included; `--selftest`/test covers the array round-trip.
- [ ] `review-call.mjs --backends-json <file>` accepts the ordered chain; absent ⇒ legacy single-backend flags act as a 1-element chain.

### From HOW (behaviour)
- [ ] `runReviewChain` returns OK on the first backend that produces findings, emitting that backend's `## Adversarial findings — provider/model`.
- [ ] On a non-OK backend the chain advances to the next regardless of failure class, recording the class.
- [ ] `chainTerminalExit` returns the first needs-human class (2/4/6/7) if any failure was a config fault, else 5.
- [ ] The skill's exit→outcome table is unchanged; the skill builds the chain JSON only when `fallbacks` is present.
- [ ] Scalar-only config and no-config-at-all paths are byte-for-byte unchanged (all existing `adversarial-call.test.mjs` cases pass without edit).

### From HOW (edge cases)
- [ ] Empty `fallbacks: []` ≡ no `fallbacks` key.
- [ ] A fallback missing a required key is a per-element config fault that advances (and feeds terminal precedence), not a whole-chain abort.
- [ ] `--backends-json` overrides legacy single-backend flags when both are present.

### Tests
- [ ] advance-on-429 (primary persistent-429 → fallback success → exit 0).
- [ ] advance-on-unreachable (primary exit-5 → fallback success → exit 0).
- [ ] all-exhausted availability-only → exit 5 (pass+skip).
- [ ] all-exhausted with a config fault in the chain → a needs-human class (e.g. 7).
- [ ] back-compat: scalar-only invocation unchanged; no-config localhost-default → exit 6.

**Integration smoke test:**
```
chain := [ {provider:nvidia,...,host_source:config}, {provider:ollama,...,host_source:config} ]
nvidia → injected persistent 429 ; ollama → injected findings
runReviewChain(chain, sharedOpts) ⇒ stdout has "## Adversarial findings — ollama/<model>", exit 0
stderr chain-trace shows "advancing: nvidia/... failed (exit 5)"
```
