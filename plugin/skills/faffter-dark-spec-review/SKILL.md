---
name: faffter-dark-spec-review
description: "L4 adversarial occupant of the `spec_review` slot — runs each enabled review lens (architectural / infosec / methodology / QA) as an INDEPENDENT refuter prompted to break the spec, then aggregates the refutations onto the fixed `faff-contract:spec-review-verdict` by majority/severity. Swap-in for the single-pass default; runs as a configured slot, not the user `/` menu."
judgement_seam: refutation-spec
user-invocable: false
---

# faffter-dark-spec-review

The **L4 (lights-out)** occupant of the **`spec_review`** slot. Where the default single-pass reviewer walks four lenses as one checklist, this runs **each enabled lens as its own independent adversarial pass** — a separate model invocation prompted to *refute* the spec from that lens's angle — then maps the set of refutations onto one founded verdict by a deterministic majority/severity rule. It challenges the *approach itself*, while the work is still just a spec, before any code exists.

It is the spec-stage twin of the code-stage adversarial reviewer: same independent-model transport, one altitude up. At L4 there is no human in the room, so a single pass run by one model — even a four-lens one — inherits that model's correlated blind spots; running the lenses as **independent** passes is what decorrelates them.

> When standalone, Read the sibling `faff/references/kernel.md` (the shared kernel) first, then `faff/references/methodology.md` (the methodology lane it consumes) — together they hold the shared rules and the fixed contracts. This recap is non-normative; the gateway kernel wins.

## When it runs

Invoked at the same spec→build-admission seam the default `spec_review` occupant wires: after the spec is produced and confidence-rated, before promote-to-build. The consumer (faff-prep) locates this producer's `faff-contract:spec-review-verdict` block, `JSON.parse`s it, pipes it to `faff contract spec-review-verdict`, and routes on the verdict. Select it in the L4 recipe:

```yaml
slots:
  spec_review: faffter-dark-spec-review
```

## Inputs

The consumer passes:

- The **spec body** (the freshly-produced, confidence-rated spec) — the artifact under scrutiny.
- The **enabled-lens set** — the subset of `architectural | infosec | methodology | QA` that fires for this issue. Defaults to all four when not supplied; *which* lenses fire by change-surface is resolved upstream and is not this occupant's decision.
- The attached **`## Methodology critique`** block, when prep wrote one (the methodology slot's already-computed value/scope signal), for the methodology lens to consume.
- **Repo architecture context** — the files the spec names — so a refuter can verify existence/structure claims instead of hallucinating them.

## The lenses as independent refuters

Each enabled lens is a single isolated pass with its own "break this spec" system prompt (the bundled `refute-<lens>.md` files):

| Lens | Refutes on | System prompt |
|---|---|---|
| `architectural` | soundness, fit with live decisions, simpler design, coupling/blast-radius, extensibility | `refute-architectural.md` |
| `infosec` | authz/authn, secrets, input surface, blast radius, fail-open bypass (generic checklist, no learned prior) | `refute-infosec.md` |
| `methodology` | right-sizing, increment/sequencing, worth-doing, surfaced deps — **consumes** the `## Methodology critique`, never recomputes value/scope | `refute-methodology.md` |
| `QA` | born-verifiability, scenario coverage, acceptance gaps, the oracle problem | `refute-qa.md` |

**Methodology lens — consume, never recompute.** Append the attached critique to the methodology refuter's prompt and let it translate that upstream judgement into objections. If no critique is present, the lens emits no objection and notes the gap — it never falls back to re-deriving value or scope.

**Independence is the mechanism.** Run one pass *per* enabled lens — never a single pass enumerating all lenses to save tokens. Collapsing them re-correlates the blind spots through one context and reduces this to the single-pass default.

**Defer to ratified scope — a settled non-goal is not a defect.** When a `## Ratified scope` block is supplied in context (the PRD's `## Non-goals` plus the settled `docs/decisions.md` precedents, assembled by `faff ratified-scope`), each **design** lens (architectural, infosec, QA) weighs every would-be objection against it first: an objection that only restates a listed non-goal, or the scope of a settled precedent, is already settled — record it as an `observation` that cites the settling ratified-scope line, not a gating objection. Everything the block does not settle passes through unchanged. **A `critical` is never deferred by any lens, infosec included** — a real exploit or fail-open path always passes through to the tally even when the block mentions the area, which is what makes symmetric deferral safe. The block may also carry a `### Ratified goals` subsection (the PRD's `## Goals & success metrics`); a design lens defers a goal-as-goal objection (contesting the product decision itself) as a cited observation, still critiques the goal's *implementation* at full severity, and never defers a `critical`. The methodology lens receives the block (to keep the shared-cache prefix byte-identical) but does not act on it. Deferral has exactly two outcomes — defer (a cited observation) or pass-through — and never a human halt; a miscalibrated deferral is corrected later by the felt-pain feedback loop, not by a pre-merge gate.

## Backend call — reuse the shared transport (do not fork it)

Each refuter pass is made by the bundled adversarial-review transport, **`review-call.mjs`** (model preflight, think-suppression, streaming, token budget, the fallback chain, and the exit-code→outcome discipline). It is **reused verbatim** — never fork it, and never hand-roll an API call in its place. Backend configuration (provider/model/host/auth) and the transport call itself have one home: the sibling `faffter-dark-adversarial-review` skill's **LLM provider integration** section — this skill only *reuses* that call, it never restates the recipe. The spec-altitude review and the product-altitude PRDR review share exactly this transport plus the "a different model challenges; the loop never self-grades" discipline — nothing above it (artifact, lens count, arbiter, contract) is shared.

**Dispatch the lenses CONCURRENTLY, via `fan-out.mjs` — never a per-lens loop.** Under Claude Code, issuing N Bash calls in one message happens to run them concurrently — a harness feature, not something faff asked for by name. A non-Claude harness has no such free batching, so a per-lens bash loop would run the N `review-call.mjs` subprocesses one after another, each a full adversarial-review call — a four-lens pass can stall over an hour. `fan-out.mjs` (bundled beside `review-call.mjs` in the sibling `faffter-dark-adversarial-review` skill) spawns every enabled lens's `review-call.mjs` invocation itself and awaits them together, so any harness capable of running one shell command gets the same speed-up. It is reused verbatim, the same discipline as `review-call.mjs` itself.

**Resolve the chain mechanically through the reviewer-pin — never `JSON.parse` `adversarial.fallbacks` or hand-merge the primary/fallback objects yourself.** Run the bundled `faff spec-review-pin --resolve` subcommand **once**. It wraps the mechanical `faff adversarial-backends` per-consumer assembly with the reviewer-pin: the backend that served round 1 is preferred across the rounds of one spec's loop (prefer-with-fallback — pinned backend first, the rest of the chain behind it, so a rate-limited pin round falls back instead of hard-parking), while round 1 / an unpinned dir is **byte-identical** to the bare per-consumer chain. It prints the same bare primary-first JSON array (drop-in for the `--backends-json` mapper), branch on its exit code, then build one `LensRequest` per enabled lens and fan them all out in a single `fan-out.mjs` call. On the exit-0 branch, **round 1 only** (before the pin exists), the resolved chain is first piped through `faff spec-review-reputation --eligible` so a candidate-degenerate reviewer is struck for cause at selection time; the filter never empties the chain, so the gate always survives:

```bash
faff=$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")
FANOUT=<.../skills/faffter-dark-adversarial-review/fan-out.mjs>
backends_json=$(mktemp)
# $pin_dir is the per-spec spec-review scratch dir prep passes (`faff spec-review-dir`).
# `spec-review-pin --resolve` prefers the round-1 pinned backend and falls back to the rest of the
# chain if the pin is unavailable; round 1 / unpinned is byte-identical to the bare per-consumer
# chain. It wraps the per-consumer selection, so an unset adversarial.spec_review.* still falls
# through byte-identically (zero change for existing configs).
"$faff" spec-review-pin --resolve --dir "$pin_dir" --consumer spec_review > "$backends_json"; backends_exit=$?
timeout=$("$faff" config get adversarial.spec_review.timeout)
[ -z "$timeout" ] && timeout=$("$faff" config get adversarial.timeout -d 120)
# Output-token cap (max_tokens): per-consumer override, else global, else the 2000 default — the same
# two-read fallback as timeout. The -gt 0 guard resets a present-but-non-positive-integer value
# (empty/non-numeric/float/0/negative) back to 2000, so no NaN/null/max_tokens:0 reaches the wire.
max_tokens=$("$faff" config get adversarial.spec_review.max_tokens)
[ -z "$max_tokens" ] && max_tokens=$("$faff" config get adversarial.max_tokens -d 2000)
[ "$max_tokens" -gt 0 ] 2>/dev/null || max_tokens=2000

case "$backends_exit" in
  0)
    # Selection-time reputation strike — ROUND 1 ONLY (unpinned, no pin sidecar yet).
    # Pipe the resolved chain through `faff spec-review-reputation --eligible` so a candidate-
    # degenerate backend (blocks nearly every spec it reviews while a meaningful fraction of those
    # blocks later ship/are accepted) is struck BEFORE it is served or pinned. Filter IN PLACE so
    # the LensRequest[] --backends-json, the chain[<i>] header indices, and the --capture below all
    # read the already-struck chain. It NEVER empties the chain (an all-flagged input passes through
    # unchanged with the gate intact), so this cannot turn an exit-0 resolve into an empty fan-out.
    # Round-1-only (per the committed "read at selection time, not per round" decision): on rounds
    # >= 2 the pin already names the clean round-1 winner, so no per-round cross-run scan runs.
    if [ ! -e "$pin_dir/pinned-reviewer.json" ]; then
      "$faff" spec-review-reputation --eligible --backends-json "$backends_json" --consumer spec_review > "$backends_json.elig" \
        && mv "$backends_json.elig" "$backends_json"
    fi
    # Build the full LensRequest[] in ONE pass over $enabled_lenses (never a per-lens loop that
    # calls fan-out.mjs once per lens — the array is what fans out, not the assembly loop) — every
    # argv field byte-identical to the old per-lens call except --system, which is the lens's own
    # refute-<lens>.md. Written to one temp JSON file, e.g.:
    #   [{"lens":"architectural","argv":["--backends-json","...","--system","refute-architectural.md",...]}, ...]
    requests_json=$(mktemp)
    node -e 'const lenses = process.argv.slice(1); const reqs = lenses.map((lens) => ({ lens, argv: [/* --backends-json, --timeout, --max-tokens, --system refute-<lens>.md, --context..., --diff */] })); process.stdout.write(JSON.stringify(reqs));' "${enabled_lenses[@]}" > "$requests_json"
    node "$FANOUT" --requests "$requests_json"   # ONE call — spawns every lens concurrently, waits for all
    ;;
  3) : ;; # unconfigured — the resolver found no chain; every lens's outcome is unavailable/config-fault, below
  2) : ;; # malformed chain config — every lens's outcome is unavailable/config-fault
esac
```

**Pin capture (after aggregation, round 1 only in effect).** Once the round's lens results are in hand, capture the round-1 serving backend as the pin so rounds ≥ 2 hold this reviewer. From each **exit-0** lens's stdout header (`## Adversarial findings — <provider>/<model> (chain[<i>], host: <src>)`) parse the `chain[<i>]` index; take `winner_index = min(i)` across the served lenses (the lowest chain index that served any lens — the strongest reachable reviewer). Then `"$faff" spec-review-pin --capture --dir "$pin_dir" --backends-json "$backends_json" --winner-index <winner_index>` — idempotent, so it writes the pin only on round 1 and is a no-op on rounds ≥ 2. If **no** lens served (empty exit-0 set) skip capture (nothing to pin; the round is `needs-human` via the transport floor anyway, and no stale pin is left behind). prep reads the served header vs the pin to detect a swap round and reset the convergence window (`faff-prep/SKILL.md` — the loop-level half); the occupant only captures.

Each `LensRequest.argv` carries exactly what the old per-lens `review-call.mjs` invocation received, plus the resolved output-token cap (assembled once, identical across every lens in the pass — like `$timeout`, not per lens): `--backends-json "$backends_json" --timeout "$timeout" --max-tokens "$max_tokens" --system plugin/skills/faffter-dark-spec-review/refute-<lens>.md --context <each file the spec names> --diff <spec-file>`.

- The **spec** is supplied as `--diff` (the thing under scrutiny); the files the spec names as `--context`; the lens refutation prompt as `--system`.
- **Ratified-scope block (when prep assembled one).** If `$pin_dir/ratified-scope.md` exists (prep wrote it at loop entry from `faff ratified-scope --assemble`), append it as one extra `--context` file to **all four** lenses' `argv`, byte-identical across them — so it rides the shared-prefix cache and the design lenses can defer to it (the methodology lens receives it but does not act on it). Absent the file, the `--context` list is exactly the files the spec names, and no lens defers (behaviour is exactly as today).
- **Wire shape.** `review-call.mjs` puts the shared context+spec block in the cacheable **prefix** position (the builders' `system` slot) and the per-lens `--system` brief in the trailing `user` turn. The CLI flags are unchanged; only the wire ordering places the ~15K-token context+spec block, byte-identical across the four lenses, at the front, so a prefix-caching backend reuses its prefill (lens 1 populates the cache, lenses 2 to 4 hit it).
- `$backends_json` holds the primary-first JSON array (`{provider, model, host, api_key_env?, reasoning_off?, timeout?}`) `review-call.mjs`'s `--backends-json` mapper consumes verbatim, whether the config is a single backend or a fallback chain — assembled **once**, not per lens, since it is identical across every lens in a given spec-review pass.
- `fan-out.mjs` returns a JSON array of `LensResult` (`{lens, exit, stdout, stderr}`) in the same order as the input requests; apply the existing per-lens outcome table (unchanged, below) to each entry exactly as it was applied to one `review-call.mjs` invocation's exit code.
- A `faff spec-review-pin --resolve` exit `3` (unconfigured/unset host — passed through from the wrapped `faff adversarial-backends`) or `2` (malformed chain config, or a corrupt pin file) means there is no chain to call the helper with; treat either as every lens's **`unavailable`**, kind `config-fault` (the same per-lens outcome the table below assigns a `review-call.mjs` config-fault exit) — never a silent `clear`.
- Configure the refuter backend to a model **structurally different** from the spec author's; independence is the whole point.

A `fan-out.mjs` fault (non-zero exit — an empty/malformed `--requests`, or a `spawn()`-level fault such as `node` missing from `$PATH`) means **no** lens result was obtained for **any** lens this call: treat every enabled lens as **`unavailable`**, kind `config-fault` (mirrors the `faff adversarial-backends` exit-3/2 handling above) — never a silent `clear`.

### Per-lens outcome (the helper's exit decides — not prose)

Map each `LensResult.exit` (the underlying `review-call.mjs` exit code the fan-out carries through unchanged, per lens) to a per-lens outcome:

| exit | meaning | lens outcome |
|---|---|---|
| `0` | findings returned | run the bundled **`parse-refutation.mjs`** (below) on the exit-0 stdout; **refuted** if it carries any gating objection, else **clear** |
| `5` / `12` | configured host unreachable / persistent transport failure / rate-limited (all backends 429) | **unavailable**, kind `infra-configured` |
| `6` / `2` / `4` / `7` | default-host down / unsupported provider / model-not-served / auth failed | **unavailable**, kind `config-fault` |

A refuter that is **down never silently approves** — an unavailable lens feeds the transport floor in aggregation below, surfacing `needs-human` rather than a quiet pass.

**Parsing an exit-0 lens (FAFF-938 — deterministic, not prose).** A refuter's exit-0 stdout is markdown prose; turning it into the `objections[]` JSON below is a **machine-guaranteed** producer-boundary step, not an unenforced convention. For each exit-0 lens, run:

```bash
printf '%s' "$LENS_STDOUT" | node plugin/skills/faffter-dark-spec-review/parse-refutation.mjs --lens <lens>
```

- **Exit 0** — use the printed `RefutationEntry` JSON verbatim as that lens's entry in the refutations array below.
- **Non-zero exit** — a **parse fault**: the lens omitted or malformed a required triple field on a gating objection (or emitted content the parser cannot make sense of at all). Record that lens's entry as `{ "lens": "<lens>", "outcome": "unavailable", "kind": "config-fault", "objections": [] }` — the same transport floor an exit `6`/`2`/`4`/`7` config-fault lens hits, so the pass rolls up to `needs-human` naming the lens (never a silent `clear`/`approve`, and never a partial pass on the objections the lens *did* get right). Write the parser's stderr diagnostic (names lens + severity + title + the missing field) into that lens's `$pin_dir/round-<n>-<lens>.md` transcript alongside its raw stdout, so the audit trail distinguishes a parse fault from a genuine `review-call.mjs` config fault.

The parser is self-contained (`plugin/skills/faffter-dark-spec-review/parse-refutation.mjs`, zero-dependency, reused verbatim — never hand-rolled inline) and models the **exit-0 wire bytes** — the transport's post-`normaliseCleanRefutation`/`refuteFindings` output — never the raw `refute-<lens>.md` prompt grammar. It does not change the contract: `spec-review-verdict` stays permissive (a legacy `{lens, severity}` objection still validates), and `aggregate.mjs`'s majority/severity gate is untouched.

### Per-lens transcript (audit trail)

`aggregate.mjs` drops observations before building the objections array (`observation → null`), so a **deferred** objection — recorded by a design lens as an observation citing the ratified-scope line — leaves no trace in the round record. Write each served lens's raw `review-call.mjs` stdout (the `## Adversarial findings` header line included) to `$pin_dir/round-<n>-<lens>.md`, so a deferral stays auditable. Derive the round from disk — `n=$("$faff" spec-review-window --next-round --dir "$pin_dir")` — the same number prep names the round record with (prep writes `round-<n>.json` after this pass returns), so the transcript and the record share a round; the `round-<n>-<lens>.md` name never matches the `^round-(\d+)\.json$` round-record scan, so it cannot perturb the counter. This is a **separate file** — keep `round-<n>.json`'s top-level `{verdict, objections}` shape and the gating reads unchanged (`faff spec-review-churn` / `faff spec-review-convergence` read only `lens` / `severity` / objection count). Each objection *entry* may additionally carry the optional enrichment fields (the triple `{claim, evidence, predicted_consequence}` plus `spec_anchor`) — additive per-objection fields the gating reads ignore, never a widening of the record's top-level shape. `<lens>` is one of `{architectural, infosec, methodology, QA}`.

## Aggregation — the majority/severity gate (deterministic)

Collect the per-lens refutations into one JSON array and pipe it to the bundled **`aggregate.mjs`** — the severity→verdict roll-up is a tool, not prose, so the same refutation set always yields the same verdict (the contract keeps this mapping out by design; it is this occupant's judgement). Each entry:

```json
{ "lens": "infosec", "outcome": "refuted|clear|unavailable",
  "kind": "infra-configured|config-fault",
  "objections": [{ "severity": "critical|major|minor|observation", "claim": "…", "evidence": "…", "predicted_consequence": "…", "spec_anchor": "…", "summary": "…" }],
  "model": "provider/model" }
```

Each objection carries the **enrichment fields** — the triple `{claim, evidence, predicted_consequence}` plus the optional `spec_anchor` — extracted from the lens's `### [severity]` block by `parse-refutation.mjs` above, never by an ad-hoc prose parse. On a **gating** objection (`critical`/`major`/`minor`) the triple is machine-guaranteed present (a missing/empty field is a parse fault, handled above); an `observation` carries whatever fields the parser found, unchecked. `aggregate.mjs` carries these verbatim onto the output objection, so they survive into the round record and thence `faff spec-judge-evidence`. A taste-level objection that cannot name a concrete consequence sets `predicted_consequence: "not separately stated"` (a present value, not a fault). A lens that cannot name the single attacked section omits `spec_anchor` (absence is the signal; canonical derivation: faff `bin/lib/heading-slug.js`). Each lens's prompt states the anchor rule as this exact bullet:

- spec_anchor: the heading slug of the spec section this objection attacks. Derive it from the heading's raw markdown line (drop the leading hash marks and surrounding whitespace, strip nothing else): lowercase; replace every run of characters outside a-z0-9 with a single hyphen; trim leading and trailing hyphens. Omit the field entirely if you cannot name one section. Worked examples: `### Aggregation — carry the anchor` → `aggregation-carry-the-anchor`; `### Phase 2 — (revised)` → `phase-2-revised`; ``### The `spec_anchor` field`` → `the-spec-anchor-field`.

The enrichment fields are **additive** — they never change the majority/severity gate.

**`model` may be sourced from the transport-prepended header, not reconstructed from config.** On an exit-0 pass, `review-call.mjs`'s stdout already starts with `## Adversarial findings — <provider>/<model> (chain[<i>], host: <source>)` — a harness-authored, unconditional guarantee (see the sibling `faffter-dark-adversarial-review/SKILL.md` → "The header is harness-authored"), not something this occupant must assemble from `adversarial` config itself. Read `provider`/`model` off that first line when populating this field; it is exact for whichever backend in the fallback chain actually served the refutation, which a config-only reconstruction cannot guarantee once a fallback has won.

```bash
printf '%s' "$REFUTATIONS_JSON" | node plugin/skills/faffter-dark-spec-review/aggregate.mjs --n <count of enabled lenses>
```

Supply exactly one refutation entry per enabled lens. `aggregate.mjs` **refuses to vote on an absent or inconsistent set** — an empty input, unparseable JSON, or a refutation count that disagrees with `--n` exits non-zero with no block. Treat any **non-zero `aggregate.mjs` exit as `needs-human`**, never as `approve` — the same fail-safe discipline as a non-zero `review-call.mjs` exit; an empty set must never silently approve.

The rule it applies to a consistent set, in order:

1. **Transport floor** — any `config-fault` unavailable lens → `needs-human` (a human must fix the config — not a transient the retry/hold loop can ride out); an `infra-configured` unavailable lens whose missing vote could swing the verdict → **`unavailable`** (a mandatory spec-review *outage*, not a verdict about the spec — the orchestrator's in-turn retry / resumable outage-hold loop consumes this, distinct from the human-judgement-call `needs-human`).
2. **Severity veto** — any `critical` objection → `reject-approach`.
3. **Majority** — a strict majority of *enabled* lenses refuted (`ceil((n+1)/2)`) → `reject-approach`.
4. **Minority** — at least one non-critical refutation → `revise`.
5. **Clean** — all clear → `approve`.

A lens is "refuted" only when it carries a **gating** objection (`critical`/`major`/`minor`); an `observation` is advisory and never gates. The refuters' `critical|major|minor|observation` vocabulary maps onto the contract's `blocker|major|minor` enum (`critical → blocker`, observations dropped). Both `needs-human` and `unavailable` from the transport floor name the missing lens(es) as objections (severity `blocker` for a `config-fault`, `major` — the founded default for a lens with no actual finding to grade — for a swing-capable `infra-configured` outage), so the founded-verdict invariant always holds.

## Output (the contract artifact)

`aggregate.mjs` emits the producer's single output — exactly one fenced block the consumer parses and pipes to `faff contract spec-review-verdict` (the sole source of contract data):

```faff-contract:spec-review-verdict
{ "verdict": "reject-approach", "objections": [ { "lens": "architectural", "severity": "blocker" } ] }
```

The founded-verdict invariant holds by construction: `approve` carries `objections: []`; every other verdict carries at least one. Where a `reject-approach` routes (back to prep vs plot) is the consumer's concern, read off the objecting lens — this producer just emits the founded verdict. A swapped-in reviewer conforms by emitting the same block.

## Rendering

Any human-facing summary this skill emits (e.g. the run log line naming the verdict and the objecting lenses) passes through the configured `rendering_adaptor` normalise pass before it is printed — enumerable sets render as lists, never `·`/comma run-on paragraphs (gateway → Rendering, Universal-routing rule). The machine-only contract block and the `.faff/` logs are exempt.

## Rules

- **Never collapse the lenses into one pass.** Independence (decorrelation) is the only thing this buys over the single-pass default.
- **Never treat a provider outage as `approve`.** A down or misconfigured refuter surfaces `needs-human` — silently skipping the gate is the exact regression the exit-code discipline exists to prevent.
- **Reuse, never fork, `review-call.mjs` or `fan-out.mjs`.** Any need to change the transport or the dispatch mechanism is a separate change with its own review.
- **Dispatch lenses concurrently via `fan-out.mjs`, never a per-lens bash loop.** A serial loop is exactly the harness-shaped stall the fan-out exists to remove.
- **Every objection must be grounded** in the spec text or the supplied context — a refuter inventing requirements is as bad as one rubber-stamping.
