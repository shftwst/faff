---
name: faffter-dark-spec-review
description: "L4 adversarial occupant of the `spec_review` slot — runs each enabled review lens (architectural / infosec / methodology / QA) as an INDEPENDENT refuter prompted to break the spec, then aggregates the refutations onto the fixed `faff-contract:spec-review-verdict` by majority/severity. Swap-in for the single-pass default; runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffter-dark-spec-review

The **L4 (lights-out)** occupant of the **`spec_review`** slot. Where the default single-pass reviewer walks four lenses as one checklist, this runs **each enabled lens as its own independent adversarial pass** — a separate model invocation prompted to *refute* the spec from that lens's angle — then maps the set of refutations onto one founded verdict by a deterministic majority/severity rule. It challenges the *approach itself*, while the work is still just a spec, before any code exists.

It is the spec-stage twin of the code-stage adversarial reviewer: same independent-model transport, one altitude up. At L4 there is no human in the room, so a single pass run by one model — even a four-lens one — inherits that model's correlated blind spots; running the lenses as **independent** passes is what decorrelates them.

> When standalone, Read the sibling `faff/SKILL.md` (the gateway) first — it holds the shared rules and the fixed contracts. This recap is non-normative; the gateway wins.

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
- **Repo architecture context** — the gateway plus the files the spec names — so a refuter can verify existence/structure claims instead of hallucinating them.

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

## Backend call — reuse the shared transport (do not fork it)

Each refuter pass is made by the bundled adversarial-review transport, **`review-call.mjs`** (model preflight, think-suppression, streaming, token budget, the fallback chain, and the exit-code→outcome discipline). It is **reused verbatim** — the helper lives in the sibling `faffter-dark-adversarial-review` skill; do not copy or fork it, and do not hand-roll an API call. The spec-altitude review and the product-altitude PRDR review share exactly this transport plus the "a different model challenges; the loop never self-grades" discipline — nothing above it (artifact, lens count, arbiter, contract) is shared.

Resolve the backend (`provider` / `host` / `model` / `timeout` / `api_key_env` / `reasoning_off`, and the optional `fallbacks` chain) from `faffter_dark.adversarial` via `faff config get` — never read the rc file directly. Resolve the host **provenance** off the `faff config get` exit status: key resolves (exit 0) → `--host-source config`; key unset (non-zero) → `--host-source default` with the documented localhost host, so an absent provider block cannot invisibly disable the gate. Per enabled lens:

```bash
faff=$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")
REVIEW_CALL=<.../skills/faffter-dark-adversarial-review/review-call.mjs>
node "$REVIEW_CALL" --host "$host" --model "$model" --timeout "$timeout" \
  --host-source "$host_source" \
  --provider "$provider" --api-key-env "$api_key_env" ${reasoning_off:+--reasoning-off} \
  --system plugin/skills/faffter-dark-spec-review/refute-<lens>.md \
  --context plugin/skills/faff/SKILL.md --context <each file the spec names> \
  --diff <spec-file>
```

The **spec** is supplied as `--diff` (the thing under scrutiny); repo files as `--context`; the lens refutation prompt as `--system`. When `faffter_dark.adversarial.fallbacks` is set, build the ordered chain (`[primary, ...fallbacks]`) and pass it as one `--backends-json` file instead of the single-backend flags — the helper iterates the chain and the exit codes below are unchanged. Configure the refuter backend to a model **structurally different** from the spec author's; independence is the whole point.

### Per-lens outcome (the helper's exit decides — not prose)

Map each pass's `review-call.mjs` exit to a per-lens outcome:

| exit | meaning | lens outcome |
|---|---|---|
| `0` | findings returned | parse the refutation; **refuted** if it carries any gating objection, else **clear** |
| `5` | configured host unreachable / persistent transport failure | **unavailable**, kind `infra-configured` |
| `6` / `2` / `4` / `7` | default-host down / unsupported provider / model-not-served / auth failed | **unavailable**, kind `config-fault` |

A refuter that is **down never silently approves** — an unavailable lens feeds the transport floor in aggregation below, surfacing `needs-human` rather than a quiet pass.

## Aggregation — the majority/severity gate (deterministic)

Collect the per-lens refutations into one JSON array and pipe it to the bundled **`aggregate.mjs`** — the severity→verdict roll-up is a tool, not prose, so the same refutation set always yields the same verdict (the contract keeps this mapping out by design; it is this occupant's judgement). Each entry:

```json
{ "lens": "infosec", "outcome": "refuted|clear|unavailable",
  "kind": "infra-configured|config-fault", "objections": [{ "severity": "critical|major|minor|observation", "summary": "…" }],
  "model": "provider/model" }
```

```bash
printf '%s' "$REFUTATIONS_JSON" | node plugin/skills/faffter-dark-spec-review/aggregate.mjs --n <count of enabled lenses>
```

Supply exactly one refutation entry per enabled lens. `aggregate.mjs` **refuses to vote on an absent or inconsistent set** — an empty input, unparseable JSON, or a refutation count that disagrees with `--n` exits non-zero with no block. Treat any **non-zero `aggregate.mjs` exit as `needs-human`**, never as `approve` — the same fail-safe discipline as a non-zero `review-call.mjs` exit; an empty set must never silently approve.

The rule it applies to a consistent set, in order:

1. **Transport floor** — any `config-fault` unavailable lens → `needs-human` (a human must fix the config); an `infra-configured` unavailable lens whose missing vote could swing the verdict → `needs-human`.
2. **Severity veto** — any `critical` objection → `reject-approach`.
3. **Majority** — a strict majority of *enabled* lenses refuted (`ceil((n+1)/2)`) → `reject-approach`.
4. **Minority** — at least one non-critical refutation → `revise`.
5. **Clean** — all clear → `approve`.

A lens is "refuted" only when it carries a **gating** objection (`critical`/`major`/`minor`); an `observation` is advisory and never gates. The refuters' `critical|major|minor|observation` vocabulary maps onto the contract's `blocker|major|minor` enum (`critical → blocker`, observations dropped). `needs-human` from the transport floor names the missing lens(es) as objections, so the founded-verdict invariant always holds.

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
- **Reuse, never fork, `review-call.mjs`.** Any need to change the transport is a separate change with its own review.
- **Every objection must be grounded** in the spec text or the supplied context — a refuter inventing requirements is as bad as one rubber-stamping.
