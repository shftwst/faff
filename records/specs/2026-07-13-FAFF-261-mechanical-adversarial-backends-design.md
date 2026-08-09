# Spec — FAFF-261: Mechanical adversarial-backends assembly

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high

> Revised on 2026-07-07 — autonomous refresh (beep-boop, run-20260707-130600-beepboop-full). Validated fresh against the current codebase: premise still holds — the work is **not yet built** (`faff adversarial-backends` does not exist), and the agent hand-assembly prose is still present in both slot skills (`faffter-dark-adversarial-review/SKILL.md` ≈121–154, `faffter-dark-spec-review/SKILL.md` ≈53, 66). Corrected stale line anchors (the `--backends-json` mapper is at ≈546–563, not 491–500; the FAFF-262 native-`backends:` selftest is at ≈758–761, not 681–686). Added a `## Methodology critique` block and the retained `spec-review: approve` verdict. No design decision changed.

**Artifact:** build spec for FAFF-261, for the build agent and human reviewers. It replaces the agent-hand-assembled adversarial fallback chain with a deterministic `faff` subcommand that emits the chain from config, so no config value is ever retyped by the model.

## 1. WHY — Problem and Principles

**Load-bearing model.** The adversarial reviewer's *transport* is already a tool (`review-call.mjs`), but the *chain it reviews with* is still assembled by the **agent** — the skill prose tells the model to `JSON.parse` the `fallbacks` string, hand-merge `[primary, ...fallbacks]`, and write a temp file. Move that assembly into a deterministic tool that emits the exact JSON `review-call.mjs` already consumes, and the model only ever *pipes config through*, never retypes it.

**Problem statement.** Today two slot skills (`faffter-dark-adversarial-review` and `faffter-dark-spec-review`) each instruct the agent to resolve `faffter_dark.adversarial`, `JSON.parse` its `fallbacks` scalar, and hand-assemble the backend chain. That hand-assembly reintroduces the transcription hazard the helper exists to remove — during the FAFF-246 graft the model id `nvidia/nemotron-3-super-120b-a12b` was retyped as `nemotron-3-super-120b-a12b` (dropped `nvidia/`) → `model-not-served`, silent until stderr inspection. This change builds the chain mechanically from config so the value can't be mistyped.

**Design principles.**

- **Deterministic tools over prose.** The chain is a pure function of config — it belongs in the CLI, not in agent prose (the governing tenet this ticket exists to honour). Same config in ⇒ same chain out.
- **Zero blast radius on the transport.** `review-call.mjs` already consumes a `--backends-json` array with snake_case keys. The assembler emits **that exact shape** — the transport tool does not change, and its exit-code → outcome contract is untouched.
- **Preserve the FAFF-213 provenance signal.** An *unconfigured* adversarial provider must still surface `needs-human`, never silently pass. The mechanical path must keep that signal, not erase it by always emitting a chain.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | Consumes `--backends-json`; the mapper (≈546–563) already accepts the config-shaped snake_case keys. **Unchanged by this work.** |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | prose | Consumer 1 — the hand-assembly prose (≈121–127, 154) this replaces. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | prose | Consumer 2 — same hand-assembly duplicated (≈53, 66). Must be updated in step. |
| `plugin/skills/faff/bin/faff` | Node CJS | Flat `COMMANDS` dispatch + `cmdConfig`; `loadConfig`/`dig`; FAFF-262 native arrays. Hosts the new subcommand + its `--selftest`. |
| `test/adversarial-call.test.mjs` | Node test | The `--backends-json` consumption contract (≈672–735) the emitter must feed. |

**Scope statement.** This sits inside the `faff` config CLI (a new emitter subcommand) plus the two adversarial slot skills' config-resolution prose — it does not touch `review-call.mjs`, the transport, the verdict contract, or the review lenses.

## 2. OUT OF SCOPE

- **Modifying `review-call.mjs`.** — Why: it already consumes the target array shape; changing it would widen blast radius for no gain. — Extension point: if the emitted shape ever diverges, the mapper at `review-call.mjs:546–563`.
- **Migrating this repo's `.faffrc.yaml` to the native `backends:` array form.** — Why: the legacy `primary + fallbacks` form stays fully supported; migration is a separate optional cleanup. — Extension point: a follow-up ticket flipping `faffter_dark.adversarial` to `backends:` once the emitter ships.
- **A shared/deduped config-resolution helper across the two slot skills.** — Why: both simply call the same subcommand; prose duplication shrinks to one identical line each, not worth a new abstraction. — Extension point: FAFF-262's noted multi-actor config work.
- **Chain-wide timeout / new backend semantics.** — Why: FAFF-232 owns chain behaviour; this only changes *who builds* the chain, not how it runs. — Extension point: `faffter_dark.adversarial.chain_timeout` (FAFF-232's noted extension).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Backend | One `{provider, model, host, …}` target the reviewer can call. |
| Chain | The ordered list of backends `review-call.mjs` tries in sequence (FAFF-232). |
| Legacy form | `faffter_dark.adversarial` = primary scalars + `fallbacks` (a JSON-string). |
| Native form | `faffter_dark.adversarial.backends` = a real YAML block-sequence of maps (FAFF-262). |

**The emitted backend shape (the fixed target — what `review-call.mjs` consumes):**

```
RECORD Backend:
  provider: string            # required
  model: string                # required — the full id incl. any "vendor/" prefix
  host: string                  # required — base host / base URL
  api_key_env: string?      # optional; env var NAME
  reasoning_off: bool?      # optional; default false (mapper applies)
  timeout: number?              # optional seconds; mapper falls back to --timeout
```

Output = a JSON array `[Backend, ...]` on stdout, ordered primary-first. snake_case keys (the mapper accepts them verbatim).

**New CLI surface:**

```
faff adversarial-backends [--json]
  → stdout: JSON array of Backend, primary-first
  → exit 0: chain emitted (≥1 backend)
  → exit 3: adversarial provider unset (block absent, or host unset) — the "no provider configured" signal
  → exit 2: malformed config (e.g. fallbacks is not parseable JSON) — fail loud, never emit a partial chain
```

**Design decisions** (full rationale in §6):

- **Chosen:** the mechanical assembler is a **new `faff` subcommand** that emits the chain — not a config-read added to `review-call.mjs`.
- **Chosen:** emit the **snake_case array shape `review-call.mjs` already consumes** — the transport tool is unchanged.
- **Chosen:** the subcommand **unifies both config forms** — native `backends:` when present, else synthesize `[primary, ...fallbacks]` with primary-key inheritance.
- **Chosen:** **preserve the FAFF-213 unset signal** via exit 3, so the skill's `--host-source default` → `needs-human` path is unchanged.
- **Chosen:** both consumers (review + spec-review) route through the subcommand, including the single-backend case (one mechanical path).
- **Chosen:** subcommand name `adversarial-backends`.

## 4. HOW — Behavior

**Architecture.** Add `cmdAdversarialBackends(args)` to `plugin/skills/faff/bin/faff`, registered in `COMMANDS`, `USAGE`, and `docs/guide/cli.md` (the `lint-cli-doc` gate requires all three). It reads config via the existing `loadConfig`/`dig` path — no new parsing. Each slot skill replaces its resolve+`JSON.parse`+merge+temp-file prose with: run the subcommand, write stdout to a temp file, pass it as `--backends-json`.

**Assembly procedure:**

```
PROCEDURE adversarial_backends():
  1. adv := dig(config, "faffter_dark.adversarial")
  2. IF adv is null → exit 3            # no provider configured (FAFF-213 signal)
  3. IF adv.backends is a non-empty array (native form):
     a. chain := adv.backends           # each element used as-is
  4. ELSE (legacy form):
     a. IF adv.host is null → exit 3     # unset host = the FAFF-213 signal
     b. primary := { provider, model, host, api_key_env?, reasoning_off?, timeout? } from adv scalars
     c. IF adv.fallbacks present:
          parsed := JSON.parse(adv.fallbacks)      # exit 2 on parse failure — fail loud
          fallbacks := parsed.map(fb → primary-key inheritance: fb inherits api_key_env/reasoning_off/timeout from primary when omitted)
        ELSE fallbacks := []
     d. chain := [primary, ...fallbacks]
  5. IF chain is empty → exit 3
  6. print JSON.stringify(chain); exit 0
```

**Behaviour summary.** One command turns whichever config form the user authored into the one canonical primary-first array, applying the same primary-key inheritance the agent used to do by hand — deterministically, once, in a tested tool.

**Edge cases and precedence.**

- **Native `backends:` present but empty** → treat as legacy (fall through to step 4), or exit 3 if nothing else configured. An explicit empty list is not a valid chain.
- **`host` unset (legacy)** → exit 3. This is the load-bearing FAFF-213 preservation: the skill maps exit 3 → `--host-source default` → exit 6 → `needs-human`, exactly as today. The subcommand must **not** emit a localhost-defaulted chain.
- **`fallbacks` is malformed JSON** → exit 2 (fail loud). Never emit `[primary]` silently — that would mask a broken config as a working single-backend chain.
- **Native form:** each element stands alone (no primary to inherit from); the `review-call.mjs` mapper supplies `reasoning_off=false` / `timeout` defaults. Inheritance applies **only** to the legacy synthesis.

**Failure modes.**

- **The failure:** the emitted array's key casing or field names drift from what `review-call.mjs`'s mapper accepts, so the chain silently loses `api_key_env`/`timeout` and calls fail or use wrong auth. **How you'd know:** the `main()` `--backends-json` e2e test (feeding the emitter's output) returns a non-zero transport exit, or a round-trip test asserting emitter-output ⊆ mapper-accepted-keys fails. **What it means:** proceed only when a test pins emitter output to the mapper's accepted shape.
- **The failure:** unifying the single-backend path through the subcommand erases the FAFF-213 unset-host `needs-human` signal (an unconfigured provider silently passes). **How you'd know:** a test with an unset `host` asserts exit 3 from the subcommand and `needs-human` (not `pass`) from the skill path. **What it means:** the exit-3-on-unset branch is mandatory, not optional.

**Anti-pattern:** teaching `review-call.mjs` to read `faff config`. Why: it couples the transport tool to config resolution and duplicates what the CLI already does — the emitter belongs in `faff`, the caller pipes its output.

## 5. Scenarios

```
Given a .faffrc with faffter_dark.adversarial = nvidia primary (model "nvidia/nemotron-3-super-120b-a12b") + a fallbacks JSON-string with one ollama backend
When `faff adversarial-backends` runs
Then stdout is a 2-element JSON array, primary-first, with the "nvidia/" prefix intact and the ollama fallback inheriting the primary's api_key_env/timeout where omitted, and exit is 0
```

```
Given a .faffrc where faffter_dark.adversarial has no host key (provider unconfigured)
When `faff adversarial-backends` runs
Then it exits 3 and emits no chain, so the calling skill takes its --host-source default → needs-human path (never a silent pass)
```

```
Given the emitter's stdout array is passed to `review-call.mjs --backends-json`
When the mapper reads it
Then every backend's provider/model/host/api_key_env/reasoning_off/timeout is consumed with no dropped or misnamed field (emitter output ⊆ mapper-accepted keys)
```

## 6. Design Decision Rationale

**Where does the mechanical assembler live?** Options: (a) add a config-read to `review-call.mjs`; (b) a new `faff` subcommand emitting the chain. (a) gives the pure transport tool an rc-read path it deliberately lacks and duplicates config logic; (b) reuses the CLI's `loadConfig`/`dig` + the `--selftest`/`lint-cli-doc` test+doc harness. **Chosen:** (b) a `faff` subcommand — deterministic, tested, transport stays config-free.

**What shape does it emit?** The `review-call.mjs` mapper already accepts snake_case `{provider, model, host, api_key_env?, reasoning_off?, timeout?}`. **Chosen:** emit exactly that — no `review-call.mjs` change, minimal blast radius.

**How to handle the two config forms?** FAFF-262 makes a native `backends:` array parseable (proven in a bin/faff selftest); the legacy `primary + fallbacks`-string form must keep working. **Chosen:** prefer native `backends:` when present, else synthesize `[primary, ...JSON.parse(fallbacks)]` with primary-key inheritance — one emitter, both forms, back-compat intact. The now-stale SKILL.md rationale ("the parser stores arrays as scalars") is corrected in the same change.

**Single-backend path — unify or leave?** The ticket frames single-backend as already-clean ("passes through resolved config only"). But routing it through the emitter too (a 1-element chain) gives one mechanical path and removes the remaining per-flag `faff config get` retyping in the single path. **Chosen:** unify — the emitter always produces the chain (≥1), both skills always use `--backends-json`; exit 3 preserves the unset signal so nothing regresses.

**Subcommand name.** Options: `config backends-json` (a config verb) vs `adversarial-backends` (top-level). **Chosen:** `adversarial-backends` — it's an adversarial-review concern, not a generic config read, and reads clearly at the call-site. Temporal anchor: if FAFF-262's multi-actor config lands, a generic `faff backends <slot>` could supersede it.

## 7. Open Questions and Assumptions

**Open Questions:** none blocking.

**Assumptions.**

- **Assumes:** `review-call.mjs`'s `--backends-json` mapper accepts snake_case config-shaped keys (`api_key_env`, `reasoning_off`, `timeout`). *Validation:* confirmed in explore at `review-call.mjs:546–563` (the backend-object mapper); the build agent re-reads that mapper before pinning the emitter's output keys.
- **Assumes:** FAFF-262 native block-sequence parsing is shipped in `bin/faff`. *Validation:* the `faffter_dark.adversarial.backends` selftest at `bin/faff:≈758–761` passes (`faff config init --selftest`).

## 8. DONE — Definition of Done

### From WHY
- [ ] The fallbacks path no longer instructs the agent to `JSON.parse`/hand-merge config — both slot SKILL.md files call the subcommand instead.
- [ ] The `nvidia/`-prefix-drop class of error (FAFF-246) is impossible via the sanctioned path: config → emitter → `--backends-json`, no model-typed prose.

### From WHAT (interfaces)
- [ ] `faff adversarial-backends` emits a primary-first JSON array of `{provider, model, host, api_key_env?, reasoning_off?, timeout?}`.
- [ ] Exit 0 on a ≥1-backend chain; exit 3 when the adversarial block or host is unset; exit 2 on malformed `fallbacks` JSON.
- [ ] Registered in `COMMANDS` + `USAGE` + `docs/guide/cli.md` (the `lint-cli-doc` gate passes).

### From HOW (behaviour)
- [ ] Native `backends:` array form is emitted as-is (each element standalone).
- [ ] Legacy `primary + fallbacks` form is synthesized to `[primary, ...fallbacks]` with primary-key inheritance for omitted optional keys.
- [ ] Unset `host` → exit 3, and the calling skill's `needs-human` (never silent `pass`) path is preserved.
- [ ] `review-call.mjs` is unchanged.

### From HOW (both consumers)
- [ ] `faffter-dark-adversarial-review/SKILL.md` resolves the chain via the subcommand (single- and multi-backend unified); the stale line-120 "parser stores arrays as scalars" rationale is corrected.
- [ ] `faffter-dark-spec-review/SKILL.md` resolves the chain via the same subcommand (the duplicated hand-assembly removed).

### From tests
- [ ] `cmdAdversarialBackends --selftest` covers: legacy primary-only, legacy primary+fallbacks (with inheritance + `nvidia/`-prefix preservation), native `backends:` array, unset-host → exit 3, malformed `fallbacks` → exit 2.
- [ ] A test asserts emitter output ⊆ the `--backends-json` mapper's accepted keys (the round-trip contract).
- [ ] Existing `test/adversarial-call.test.mjs` `--backends-json` tests stay green (consumption contract unchanged).

**Integration smoke test:**

```
1. Write a .faffrc with faffter_dark.adversarial = nvidia primary + one ollama fallback
2. RUN `faff adversarial-backends` → capture stdout to backends.json
3. RUN `node review-call.mjs --backends-json backends.json --system S --diff D` (getFn/streamFn stubbed)
4. ASSERT the chain has 2 backends, primary "nvidia/…" prefix intact, exit maps per the FAFF-232 table
```

## Methodology critique

*Lens: `faffter-dark-methodology-agile-delivery` (agile-delivery) · axis findings for the issue.*

- **Right-sized?** Yes — a single 1–3 day unit: one new `faff adversarial-backends` subcommand + its `--selftest`, two one-line prose swaps in the slot skills, and one round-trip test. The parts always ship together (the emitter is useless until its consumers call it), so this is a cohesive single slice, not two independent concerns to split.
- **Workstream fit?** Yes — labelled `faff-chain-gap-fill`; it closes a determinism gap in the faffter-dark adversarial-review substrate (agent hand-assembly of a config-derived chain), squarely in that workstream. Outcome-named and cohesive.
- **Deps surfaced?** Yes — it builds on FAFF-262 (native `backends:` parsing, shipped) and preserves the FAFF-213 unset signal + the FAFF-232 chain (both related edges are drawn on the ticket). No implicit dep left unlinked.
- **Risk profile?** Low — no novel integration and no external dependency; the transport (`review-call.mjs`) is untouched and pinned by existing `--backends-json` tests. The one real risk (emitter shape drifting from the mapper's accepted keys) is covered by the round-trip DONE criterion. No de-risking spike warranted.

confidence: high
spec-review: approve
