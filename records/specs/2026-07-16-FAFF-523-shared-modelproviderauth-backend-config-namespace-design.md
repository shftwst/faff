# FAFF-523 — Shared model/provider/auth backend config namespace

> Spec: faffter-dark-nlspec · 2026-07-16 · autonomous · confidence: high. Full spec on Linear FAFF-523.
> **Refreshed 2026-07-16 (autonomous)** — folded operator resolution (comment "Resolution (operator, 2026-07-16)"): both architecture punts closed. (1) `seat_ref` **dropped from the schema** — the ambient interactive session is the implied seat; `auth: subscription-seat` binds to it directly (defers FAFF-478's concrete seat-handle spike without holding up the namespace). (2) `engines:` alias **kept indefinitely** — no sunset date. Re-rated **medium → high** (no open punts remain).

This spec defines a standalone, named model/provider/auth **backend namespace** for faff's config (`.faffrc.yaml`), and migrates the adversarial slot's bespoke block onto it as the first consumer and migration proof. The audience is the build agent implementing the config schema + resolver changes, and the human reviewers gating a foundational substrate that later refactors (FAFF-69/70/72) resolve *through* but that ships now, ahead of them.

## Refresh (operator resolution, 2026-07-16)

Both former Punts are now **Chosen** and folded below:

- **`seat_ref` — DROPPED entirely (Chosen).** The `Backend` record has no `seat_ref` field. `auth: subscription-seat` binds to the ambient interactive session (the implied seat); its constraint becomes simply "no `api_key_env`". The concrete seat-handle mechanics remain FAFF-478/481 territory (out of scope) — dropping the field is what *defers* that spike cleanly rather than pre-committing a shape.
- **`engines:` alias sunset — KEPT indefinitely (Chosen).** No removal/deprecation date. `engines:` folds into `backends:` at load (collision = hard error) and `engine:<name>` keeps resolving against the merged namespace forever; only the removal date was ever open and the answer is "never, for now."

## 1. WHY — Problem and Principles

**The load-bearing idea.** faff has two independent config axes — *which brain* (model/provider/auth) and *where it runs* (harness/isolation) — but today only ONE slot can name a foreign brain: the adversarial review's bespoke `faffter_dark.adversarial.{provider, model, host, api_key_env, fallbacks}` block. Every other producer runs as a Claude subagent at a `models.X` tier (`inherit|sonnet|opus|haiku|fable`), and a tier token cannot express a provider, host, or key. This spec extracts the endpoint description into ONE named namespace (`backends:`) that any consumer references *by name*, so the model-access axis stops being a per-slot special case.

**Problem statement.** The only rich model-access config is trapped inside one slot's block, so a second slot that wants a cheaper/local/foreign backend has nowhere uniform to point. This blocks all three drivers for non-default backend occupancy (below) and leaves a standing fail-open hole where a down provider silently skips a gate. This change adds a shared named namespace, migrates the adversarial block onto it byte-equivalently, and fails closed at run start on an unrealizable resolve.

**Three drivers, one substrate (motivation, kept honest).** A slot/lane references a named backend the same way regardless of *why* — the substrate is driver-agnostic — but the motivation names all three so the design is honest about what it enables (`design/portable-runtime.md` Amendment 2026-07-16):

1. **Heterogeneity (value)** — a different model family is the point: adversarial second opinion, code-blind holdout judge, cheap smoke.
2. **Cost (efficiency)** — a cheaper/local model in a high-volume build/eval lane; buying good-enough output for less spend (FAFF-479/480, cost-routing FAFF-452/422/423).
3. **Privacy / data-residency (constraint)** — a local/self-hosted backend so sensitive code/secrets never leave the machine; about **host + egress**, not family.

**Design principle — privacy is a constraint that can be *violated*, so it fails closed.** Drivers 1–2 leave a lane merely *suboptimal* if mis-resolved; driver 3 can be *breached* (a data leak) by resolving a residency-required lane to an egressing backend. Therefore residency is not advisory: a backend carries an `egress` marker and a consumer may `require` locality, and any violation refuses to start — the same fail-closed posture as the model×harness realizability matrix. Reject any implementation that lets a `requires: local` consumer resolve to an `egress: external` backend.

**Design principle — don't fork the endpoint vocabulary.** faff already names model-access endpoints in two places: the top-level `engines:` map (`faff engine call`, ADR-0054) and the adversarial inline `backends[]`/`fallbacks`. Both carry the same core record (`provider, model, host, api_key_env, reasoning_off, timeout`). The new namespace must be the *generalization* of those, not a third dialect — `engines:` folds into it, and existing consumers keep resolving. Reject a design that introduces a parallel field set or a new lane-value prefix.

**Design principle — fail closed, never a silent green.** An unreachable/unrealizable required backend must refuse at run start, never a mid-run 403 or a pass+skip. This closes the standing adversarial-provider-silent-skip hole (`design/portable-runtime.md` §"Model × harness"; run-start complement FAFF-395).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/adversarial-backends.js` | JS | First consumer + resolver (`assembleAdversarialBackends`, `BACKEND_KEYS`); migrates onto the namespace |
| `plugin/skills/faff/bin/lib/config.js` | JS | `DEFAULTS`, `MODEL_LANE_VOCAB`, `resolveEngineForLane`, `validateModelLane`, `faff config check` |
| `plugin/skills/faff/bin/lib/engine.js` | JS | `faff engine call` one-shot transport; second consumer via `engine:<name>` lane |
| `plugin/skills/faff/bin/lib/shared-infra.js` | JS | `parseYamlSubset` (block sequences already supported, FAFF-262), two-file merge |
| `.faffrc.yaml` / `.faffrc.example.yaml` | YAML | Live config (legacy adversarial shape) + annotated schema template; migration target |
| `design/portable-runtime.md` | Markdown | The three-driver + egress + fail-closed matrix source-of-truth |

**Scope statement.** This is the config *data structure* (and the thin resolver that reads it) that the capability/lane refactor later resolves through — it sits under `models.X` / the slot system, beside `isolation` and `harness` on the one resolution rule (`design/portable-runtime.md` §"one resolution rule").

## 2. OUT OF SCOPE

- **Capability/role/invocation resolver refactor** — what's excluded: the `slot → capability` resolution-model rework. Why: FAFF-523 is the data structure that model resolves *through*, not the resolver. Extension point: FAFF-69/70/72 consume `backends:` via the one resolution rule.
- **Subscription-seat auth *mechanics*** — what's excluded: how a seat token is minted/held/refreshed, and any concrete seat-handle shape. Why: FAFF-523's resolution **drops `seat_ref`** and binds `auth: subscription-seat` to the ambient interactive session; the concrete seat mechanics are FAFF-478 (spike) / FAFF-481 (wiring). Extension point: FAFF-478/481 read `auth: subscription-seat` and supply whatever seat mechanics they design — this spec fixes only the `auth` value, not a handle.
- **Model-per-lane routing *policy*** — what's excluded: which lane *should* get which backend, and cost-driven auto-adoption. Why: this defines the reference, not the decision. Extension point: cost-routing FAFF-452/479/480 (`design/lights-out-routing-autonomy.md`) writes lane→backend references.
- **The harness adapters (agent-sdk, local loop) and the `faff run` spine** — what's excluded: building the portable driver loop. Why: not this issue. Extension point: `design/portable-runtime.md` phases 3–4; the run-start realizability check here is authored as a pure function those phases invoke (FAFF-395).
- **Replacing the Agent-token path for mainline Claude lanes** — what's excluded: forcing `models.build: sonnet` onto `backends:`. Why: the Agent-token tier stays the zero-config Claude-subagent mechanism; `backends:` is additive. Extension point: a `models.X` lane MAY optionally name a backend (future), but the token vocabulary is untouched here.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Backend | A named entry describing one model-access endpoint (provider/model/host/auth/egress). The unit of reference. |
| Backend namespace | The top-level `backends:` map (name → Backend). Referenced by name from anywhere. |
| Reference list | A per-consumer ordered list of backend *names*; index 0 is first-served. No named "primary". |
| Chain | The resolved list of Backend records a reference list expands to (fallback order preserved). |
| Egress | Whether a backend's traffic leaves the machine: `local` (loopback/private/tailscale host) or `external`. |
| Realizable | A (harness, provider, auth) triple the model×harness matrix admits, with a non-empty host, satisfying residency. |

**Type definitions.**

```
RECORD Backend:                    # a named entry in top-level `backends:` map
  name: String                     # the map key; the thing consumers reference
  provider: Enum                   # ollama|openai|vllm|openrouter|nvidia|deepseek|gemini|anthropic
  model: String
  host: URL                        # transport endpoint; empty ⇒ unrealizable (fail closed, matches today's exit-3)
  auth: Enum                       # subscription-seat | api-key | none   (explicit-preferred; derivable, see HOW)
  api_key_env: String?             # env var NAME (never the key); required iff auth=api-key
  egress: Enum                     # local | external   (explicit-preferred; derivable from provider/host, see HOW)
  reasoning_off: Bool?             # carried through unchanged from engines/adversarial
  timeout: Int?                    # per-ATTEMPT seconds (a single call), not the total

  CONSTRAINT auth=api-key            ⇒ api_key_env present
  CONSTRAINT auth=subscription-seat  ⇒ api_key_env absent   # the seat is the ambient interactive session — no handle field
  CONSTRAINT auth=none               ⇒ api_key_env absent
```

> **Refresh note (2026-07-16):** the earlier draft carried a `seat_ref: String?` field and a `subscription-seat ⇒ seat_ref present (or ambient sentinel)` constraint. Per the operator resolution the field is **removed**: `auth: subscription-seat` binds to the ambient interactive session with no explicit handle. There is no `seat_ref` in the record and no `seat_ref` in any constraint.

```
RECORD BackendReferenceList:       # how a consumer points at backends (per-consumer, ordered)
  refs: List<String>               # backend NAMES; index 0 = first-served, no "primary" key (subsumes FAFF-261 flip)
  requires: Enum?                   # local (alias: no-egress) — a data-residency assertion; absent ⇒ no residency constraint
  deadline: Int?                    # per-consumer TOTAL wall-clock seconds across all attempts+fallbacks (FAFF-329)
```

**Config surface (YAML).** New top-level `backends:` map + a per-consumer reference list. The adversarial block becomes a reference list; the `engines:` map folds in (see HOW → back-compat). Authored in **block form** — `parseYamlSubset` only JSON-parses inline `[...]`/`{...}`, so flow-style with bare tokens is not valid; block maps and block sequences are the parseable shape (`shared-infra.js`). Illustrative post-migration `.faffrc.yaml`:

```yaml
backends:
  nvidia-glm:
    provider: nvidia
    model: z-ai/glm-5.2
    host: https://integrate.api.nvidia.com/v1
    auth: api-key
    api_key_env: NVIDIA_API_KEY
    egress: external
    timeout: 480
  gemini-gemma:
    provider: gemini
    model: models/gemma-4-31b-it
    host: https://generativelanguage.googleapis.com/v1beta/openai
    auth: api-key
    api_key_env: GEMINI_API_KEY
  studio-ollama:
    provider: ollama
    model: qwen3-next:80b-a3b-instruct-q4_K_M
    host: http://studio.longhair-escalator.ts.net:11434
    # auth/egress derived: none / local

faffter_dark:
  adversarial:
    refs:                        # ordered block sequence; index 0 first-served, no "primary"
      - nvidia-glm
      - gemini-gemma
      - studio-ollama
    deadline: 480

models:
  methodology: engine:studio-ollama   # second consumer: engine lane names a backend
```

**Design decisions (each closes with a canonical marker; full rationale in §6).**

- **Chosen:** the namespace is a top-level `backends:` **map** (name → Backend), the generalization of `engines:`; consumers reference by name via an **ordered list** (no "primary"). Aligns with the existing `engines:`/`engine:<name>` vocabulary, so nothing forks.
- **Chosen:** `auth: subscription-seat | api-key | none` is a first-class per-backend field; the token source is `api_key_env` (api-key), the **ambient interactive session** (subscription-seat), or nothing (none). No `seat_ref` handle field.
- **Chosen:** each backend carries `egress: local | external`; a consumer may declare `requires: local`; any `requires: local` → `egress: external` resolve fails closed at run start.
- **Chosen:** `engines:` entries merge into the `backends:` namespace at load (name collision = hard error); `engine:<name>` resolves against the merged namespace — existing engine configs stay byte-equivalent.
- **Chosen:** `provider: anthropic` is *permitted* at the namespace level (needed to name a subscription/API Claude endpoint); the anthropic-refusal stays a *per-consumer* rule (`faff engine call` has no anthropic transport, so it still refuses one).
- **Chosen:** no separate schema-decision spike precedes the build — this spec settles the data structure; the architecture-proposal trigger does not fire (config data structure on an existing CLI, no new runnable system).
- **Chosen (was Punt — resolved 2026-07-16):** `seat_ref` is **dropped from the schema**. `auth: subscription-seat` binds to the ambient interactive session; there is no seat-handle field. This defers the FAFF-478 concrete-seat spike without a placeholder field, and the `subscription-seat` constraint is simply "no `api_key_env`".
- **Chosen (was Punt — resolved 2026-07-16):** the `engines:` alias is **kept indefinitely** — no removal/deprecation date. It folds into `backends:` at load and `engine:<name>` keeps resolving against the merged namespace with no sunset.

## 4. HOW — Behavior

**Architecture.** Three thin pieces, all read-only over config, no new runnable system:

1. **Load-time merge + normalize** (in `config.js` / `loadConfig`): fold `engines:` into `backends:`; apply `auth`/`egress` derivation to fill unspecified fields; validate the `Backend` constraints. Produces one canonical in-memory `backends` map.
2. **Reference resolution** (`resolveBackendRefs(cfg, refs) → chain`): map a `List<String>` of names to an ordered `List<Backend>`, preserving order, hard-failing on an unknown name. `assembleAdversarialBackends` and `resolveEngineForLane` both call this instead of reading their bespoke shapes.
3. **Realizability check** (`checkRealizable(cfg, consumer, harness) → ok | {refuse, reason}`): a pure function surfaced via CLI, invoked at each consumer's existing resolve entry point (today's run-start-equivalent), and adopted by the unified `faff run` preflight (FAFF-395) when that spine lands.

**auth/egress derivation (applied at normalize; explicit value always wins).**

```
PROCEDURE deriveAuth(b):
  IF b.auth set: return b.auth
  IF b.api_key_env present:      return "api-key"      # today's adversarial/engine behaviour
  IF b.provider == "anthropic":  return "subscription-seat"   # binds to the ambient session; no handle
  return "none"

PROCEDURE deriveEgress(b):
  IF b.egress set: return b.egress
  host = b.host
  IF host loopback (localhost|127.0.0.1|::1) OR RFC1918 (10.|192.168.|172.16-31.) OR tailscale (*.ts.net): return "local"
  return "external"                                     # nvidia/openai/anthropic-api/gemini/any public host
```

**Reference resolution (the fallback chain, no primary).**

```
PROCEDURE resolveBackendRefs(cfg, refs):        # refs: ordered list of names
  chain = []
  FOR name IN refs (in order):                  # index 0 first, no special "primary"
    b = cfg.backends[name]
    IF b is absent: FAIL config ("unknown backend: " + name)   # fail loud, never skip
    chain.append(b)
  return chain                                  # order preserved = fallback precedence
```

Detecting reference-list vs legacy inline records in `faffter_dark.adversarial`: a list of **strings** ⇒ name references (new); a list of **maps**, or the legacy `provider/model/host + fallbacks` scalars ⇒ inline records (accepted unchanged for back-compat). This keeps `faff adversarial-backends` output byte-equivalent across the migration.

**Run-start realizability — fail closed (the security surface).**

```
PROCEDURE checkRealizable(cfg, consumer, harness):
  chain = resolveBackendRefs(cfg, consumer.refs)
  realizableCount = 0
  FOR b IN chain:
    # (a) residency is per-ENTRY and absolute — an external fallback is a latent leak
    IF consumer.requires == "local" AND deriveEgress(b) == "external":
      return { refuse, reason: "residency-violation: " + b.name + " egresses" }   # ANY external ref refuses
    # (b) host presence
    IF b.host empty: continue                    # unrealizable ref; contributes 0
    # (c) model×harness×auth matrix (design/portable-runtime.md §"Model × harness")
    IF (harness, b.provider, deriveAuth(b)) NOT admitted by PORTABLE_MATRIX: continue
    realizableCount += 1
  # (d) chain-level: a served fallback admits; ZERO realizable ⇒ refuse (closes pass+skip hole, FAFF-395)
  IF realizableCount == 0: return { refuse, reason: "chain-unrealizable" }
  return { ok }
```

**Behavior summary.** Residency is checked per-entry (any egressing ref in a `requires: local` chain refuses — privacy cannot be satisfied by "usually local"); the matrix/host realizability is checked per-chain (≥1 served ref admits, matching FAFF-395's "a served fallback admits — not any backend down → refuse").

**Edge cases and error handling.**
- **Unknown backend name in a ref list** → hard config error (fail loud), never a silent drop — mirrors `faff adversarial-backends` exit 2 (malformed) posture.
- **Empty `backends:` and legacy adversarial inline block present** → legacy path still resolves (back-compat); no migration forced.
- **`engines:`/`backends:` name collision at merge** → hard error (ambiguous reference), never last-wins.
- **`auth` constraint breach** (e.g. `auth: api-key` with no `api_key_env`, or `auth: subscription-seat` with an `api_key_env`) → config-check failure before any network call, matching engine.js auth-failed-before-network.
- **Host unset on the *only* realizable-eligible ref** → `chain-unrealizable` refuse (equivalent to today's `adversarial-backends` exit 3 → `needs-human`, never a localhost default).
- **`auth: subscription-seat` on a non-`claude-code` harness** → matrix miss (the ambient seat exists only on the interactive/claude-code harness) → contributes 0 (refuses if it's the whole chain).
- **Legacy optional-inheritance on migration** → today `inheritOptionalFromPrimary` (`adversarial-backends.js`) makes a `fallbacks` entry that omits `api_key_env`/`reasoning_off`/`timeout` inherit them from the primary (so the live ollama fallback inherits `NVIDIA_API_KEY`+`480`). Named `backends:` entries do NOT inherit — each stands alone. For byte-equivalence the migration MUST restate any previously-inherited optional explicitly on the named backend (or consciously drop it with a one-line documented deviation — e.g. dropping the spurious `NVIDIA_API_KEY` inherited onto a keyless local ollama).

**Failure modes — how this design falls over, and how you'd notice.**
- **The failure:** byte-equivalence "passes" because the old and new resolvers share the *same* latent bug (e.g. both mis-order fallbacks). **How you'd know:** the migration diff is empty AND an independent hand-computed expected chain (from the YAML, not from either resolver) disagrees. **What it means:** narrow — the golden must be an independent expectation, not old-resolver output.
- **The failure:** `deriveEgress` false-negatives a public host as `local` (e.g. an unusual private-looking public hostname), silently admitting a residency-required lane to an egressing backend — the exact leak privacy exists to prevent. **How you'd know:** an `egress:` classification test over a table of known hosts returns `local` for a host that actually egresses. **What it means:** narrow — require explicit `egress:` on any backend a `requires: local` consumer references; treat derivation as a convenience default only, and have `config check` warn when a `requires: local` chain relies on *derived* (not explicit) `egress: local`.
- **The failure:** `deriveAuth` masks a genuinely-missing key by defaulting a keyless anthropic entry to `subscription-seat`, so an intended API call silently loses its token. **How you'd know:** a backend meant for `agent-sdk` (API) with no `api_key_env` resolves `auth: subscription-seat` and the matrix refuses it at run start (good) rather than 403-ing mid-run. **What it means:** proceed — refusing at run start is the correct fail-closed outcome; the derivation is safe because the matrix catches the mismatch before any call.

**Anti-pattern:** defaulting an unset/unreachable host to `localhost`. Why: it turns a fail-closed refuse into a silent wrong-target call (`adversarial-backends` already refuses this via exit 3).
**Anti-pattern:** satisfying a `requires: local` consumer by dropping external fallbacks and proceeding. Why: the presence of an external ref in a residency chain is itself the config defect — refuse, don't silently prune.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a `.faffrc.yaml` whose `faffter_dark.adversarial` is migrated to a `refs:` block sequence referencing top-level `backends:`, with any legacy-inherited optionals restated explicitly on the named entries
When `faff adversarial-backends --json` runs
Then the emitted primary-first JSON chain is byte-identical to an independently hand-computed expected chain (not merely the old resolver's output) for the same logical config
```

```
Given a top-level backend `studio-ollama` and `models.methodology: engine:studio-ollama`
When the methodology engine lane resolves
Then it resolves against the shared `backends:` namespace and yields the same `{provider, model, host, ...}` an equivalent `engines: studio-ollama` entry produced before migration
```

```
Given a backend `auth: api-key` with `api_key_env: NVIDIA_API_KEY` and a backend `auth: subscription-seat` with no `api_key_env`
When each is resolved for its token source
Then the api-key backend's token source is the named env var and the subscription-seat backend's is the ambient interactive session (no handle) — each auth value routes to the correct source
```

```
Given a mandatory consumer whose entire reference chain is unrealizable on the current harness (every ref host-unset or matrix-refused)
When realizability is checked at run start
Then the run refuses with `chain-unrealizable` — never a pass+skip silent green
```

```
Given an existing `.faffrc.yaml` using the top-level `engines:` map and `engine:<name>` lane values, with no `backends:` block
When config loads
Then engines fold into the backend namespace and every `engine:<name>` lane resolves unchanged (back-compat, byte-equivalent)
```

## 6. Design Decision Rationale

**Key name + shape: `backends:` map vs extending `models:`/`engines:`.** Options: (a) new top-level `backends:` map generalizing `engines:`; (b) extend `models:` (tier tokens) with endpoint records; (c) keep `engines:` as the only map and bolt auth/egress on. — (b) collides with the closed Agent-token vocabulary (`sonnet|opus|…` are passed verbatim to the Agent tool; they are not endpoint descriptors) and would fork the meaning of a `models.X` value. (c) leaves the adversarial chain (which needs an ordered list + `deadline`) and the engine lane (single entry, no chain, ADR-0054) unreconciled, and `engines:` deliberately *refuses* `anthropic`, which the subscription-vs-API goal requires. **Chosen:** (a) — a top-level `backends:` map is the least-surprising generalization: it already shares `engines:`' exact record, adds the `auth`/`egress` dimensions once, and the per-consumer ordered reference list expresses the fallback chain without a "primary" (the FAFF-261 flip). Consumers keep their own list vs single-name arity.

**Reference lists, ordered, no "primary".** Options: keep a named `primary` + `fallbacks`; or an ordered list where index 0 is first-served. — The named-primary shape is the legacy adversarial form; FAFF-261/262 already shipped the code that consumes a native no-primary array, and the live config is simply not yet migrated onto it. **Chosen:** ordered list of names, first-served wins — makes "priority" a property of *position*, uniform across consumers. Note the shipped FAFF-261/262 work is a native array of *inline records* under `adversarial.backends:`; the by-*name* reference into a top-level `backends:` map (`resolveBackendRefs`) is net-new plumbing, not a completed one.

**`auth` as a first-class field.** Options: infer auth purely from `api_key_env` presence; or an explicit `auth` enum. — Inference cannot distinguish subscription-seat (no env key, ambient session) from `none` (no auth at all), and it is a security dimension where explicit intent matters. **Chosen:** explicit `auth: subscription-seat | api-key | none`, with a conservative derivation only as a convenience default (api_key_env→api-key, anthropic→subscription-seat, else none) so today's keyless-local and env-keyed backends keep working without an `auth:` line. Constraints tie each value to exactly one token source.

**`seat_ref` dropped — the seat is ambient (resolved 2026-07-16).** Options: (a) carry an opaque/structured `seat_ref` handle field now; (b) drop the field and bind `auth: subscription-seat` to the ambient interactive session. — (a) pre-commits a shape the FAFF-478 spike hasn't decided and injects a placeholder field the resolver would have to tolerate-but-ignore. **Chosen:** (b) — no `seat_ref` in the schema; `subscription-seat` means "use the ambient interactive session's seat" (the only place a subscription seat exists), with the constraint reduced to "no `api_key_env`". This *defers* FAFF-478/481 cleanly: those tickets add whatever seat mechanics they design behind the same `auth: subscription-seat` value, changing no field here.

**`egress` per-backend + `requires` per-consumer.** Options: a single global "allow external" switch; or a per-backend `egress` marker + per-consumer `requires`. — Privacy is a *per-lane* property (one lane handles secrets, another doesn't) and a per-*entry* risk (an external fallback leaks), so a global switch is too coarse. **Chosen:** `egress: local | external` on each backend (derivable from provider/host) + a consumer-side `requires: local` (alias `no-egress`); any `requires: local` → `egress: external` resolve refuses at run start. Composes with the secret-ownership lane work (FAFF-32/107, ADR-0073). Field names taken from `design/portable-runtime.md` verbatim.

**`engines:` folds in; `engine:<name>` prefix retained, kept indefinitely (resolved 2026-07-16).** Options: rename the lane prefix to `backend:`; keep `engine:<name>` resolving against the merged namespace with a sunset date; or keep it with no sunset. — A rename breaks shipped configs (FAFF-422/ADR-0054) for cosmetics; a sunset date buys nothing for a single-user substrate and adds a migration deadline to track. **Chosen:** merge `engines:` entries into `backends:` at load (collision = error), keep `engine:<name>` as a valid lane value naming a backend, and **keep the alias indefinitely** — zero breakage, no removal date. A future cosmetic `backend:` alias is out of scope.

**anthropic permitted at namespace, refused per-consumer.** The namespace must be able to name a Claude endpoint (that is the whole subscription-vs-API point), but `faff engine call` has no anthropic transport. **Chosen:** validate `anthropic` at the *consumer*, not the namespace — engine.js keeps refusing it; the adversarial/Agent paths accept it.

**No separate schema spike.** At the time of writing, the array plumbing (FAFF-261/262) and the engine/adversarial resolvers already exist; the open questions are field names, all settled here from the design note. **Chosen:** this spec is the schema decision; no spike gate. The architecture-proposal trigger does not fire (config data structure on an existing CLI).

## 7. Open Questions and Assumptions

**Open Questions.** None — both former punts are resolved (2026-07-16):

- **`seat_ref` shape — RESOLVED (Chosen: dropped).** The field is removed; `auth: subscription-seat` binds to the ambient interactive session. The concrete seat mechanics are deferred to the FAFF-478 spike, which needs no field here.
- **`engines:` alias sunset — RESOLVED (Chosen: kept indefinitely).** No removal date.

**Assumptions.**
- **`**Assumes:** parseYamlSubset handles a top-level named block map whose values include nested block sequences.`** Validation: the existing `engines:` map (named block-map values) and the adversarial `fallbacks`/`backends` block sequences (FAFF-262) already exercise both shapes in `plugin/skills/faff/bin/lib/shared-infra.js`. Inline flow (`[...]`/`{...}`) is JSON-parsed only, so author `backends:` and `refs:` in **block** form; confirm a `backends:` block map with a `refs:` block sequence round-trips before building.
- **`**Assumes:** schema validation for backends: is added to faff config check, reconciled with the existing per-key validators.`** Validation: `computeConfigCheck`/`cmdConfigCheck` (`config.js`) does the secret-scan + git-posture + legacy-name checks, while model-lane/engine-ref validation lives in `validateModelLane`/`validateEngineRef` surfaced at `config get`. Add `backends:` realizability/constraint checks alongside the latter (not a second home) and confirm which entry point run-start invokes.
- **`**Assumes:** the Agent-token model vocabulary stays the mechanism for mainline Claude subagent lanes.`** Validation: `MODEL_LANE_VOCAB` in `config.js` passes tokens verbatim to the Agent tool; confirm `backends:` is additive and no `models.X` default is changed.
- **`**Assumes:** the harness axis of (harness, model, auth) realizability is fixed to the single value the CLI passes today.`** The `harness`-varying half of the `PORTABLE_MATRIX` check is out of scope until the FAFF-395 `faff run` spine supplies a real harness axis; `checkRealizable` is written to accept a `harness` param but v1 passes the current single harness, so the `chain-unrealizable` / subscription-seat-on-non-claude-code matrix rows are asserted against that fixed value. Validation: confirm the single harness value at the `checkRealizable` call-site; the matrix-varying rows land with FAFF-395.

## 8. DONE — Definition of Done

### From WHY
- [ ] A down/unreachable *required* backend chain refuses at run start (no pass+skip, no mid-run 403) — the silent-skip hole is closed.
- [ ] All three drivers are expressible through the one namespace (a slot references a named entry identically regardless of driver).

### From WHAT (types and interfaces)
- [ ] Top-level `backends:` map parses; each `Backend` matches the defined record and the three `auth` constraints are enforced (breach → config error).
- [ ] The `Backend` record has **no `seat_ref` field**; `auth: subscription-seat` requires `api_key_env` absent (binds to the ambient session).
- [ ] A `BackendReferenceList` (`refs` ordered names + optional `requires` + optional `deadline`) parses and resolves in order.
- [ ] `provider: anthropic` is accepted in `backends:` but refused by the `faff engine call` consumer.

### From HOW (behaviour)
- [ ] `resolveBackendRefs` returns the chain in `refs` order; an unknown name hard-fails (fail loud).
- [ ] `deriveAuth` yields api-key when `api_key_env` present, subscription-seat for keyless anthropic, else none (explicit `auth:` overrides).
- [ ] `deriveEgress` classifies loopback/RFC1918/tailscale hosts `local`, public hosts `external` (explicit `egress:` overrides).
- [ ] `auth: api-key` resolves its token source to the named env var; `auth: subscription-seat` resolves to the ambient interactive session (no handle).
- [ ] `faff adversarial-backends --json` over the migrated config (legacy-inherited optionals restated explicitly) is byte-identical to an independently hand-computed expected chain (migration proof).
- [ ] `engine:<name>` resolves against the merged `backends:`+`engines:` namespace; existing engine configs are byte-equivalent; the `engines:` alias is retained with no sunset.
- [ ] A second, non-adversarial consumer (the engine lane) resolves a named backend.

### From HOW (edge cases + fail-closed)
- [ ] `requires: local` + any `egress: external` ref in the chain → refuse at run start with a residency-violation reason naming the backend.
- [ ] **Derived-egress guard (residency soundness):** a `requires: local` chain that references a backend whose `local` classification is *derived* (no explicit `egress:` set) makes `faff config check` emit a warning naming the backend; derivation is a convenience default only, and the residency guarantee is asserted only against *explicit* `egress: local`. Covered by a `config check` test over a `requires: local` chain referencing a derived-local backend (warns) vs an explicit-`egress: local` backend (silent).
- [ ] Whole chain unrealizable (all refs host-unset or matrix-refused) → refuse with `chain-unrealizable`; a served fallback admits. (The `harness` axis of realizability is out of scope until the FAFF-395 `faff run` spine lands — `checkRealizable` consults `PORTABLE_MATRIX` with the single harness value the CLI passes today; the matrix-refused half is exercised deterministically once that axis is pinned. See the Assumes above.)
- [ ] `engines:`/`backends:` name collision at merge → hard error.
- [ ] Host-unset on the only realizable-eligible ref → refuse (equivalent to `adversarial-backends` exit 3), never a localhost default.

### Integration smoke test
```
1. Take this repo's `.faffrc.yaml`; migrate `faffter_dark.adversarial` to a `refs:` block sequence over a new `backends:` block map (same logical endpoints; restate any legacy-inherited optionals explicitly).
2. Run `faff adversarial-backends --json` → assert byte-identical to an independently hand-computed expected chain.
3. Add `models.methodology: engine:<one-backend-name>`; assert `resolveEngineForLane` returns that backend's record.
4. Add `requires: local` to the adversarial consumer with an external ref present; run the realizability check → assert refuse with residency-violation.
If those pass, the namespace, the migration, the second consumer, and the fail-closed gate are wired.
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" } ] }
```

## ADR promotion intent

Autonomous prep (appetite: high) records one architecturally-significant, cross-slice decision for `/faff-graft` to materialise via `faff adr new` on the feature branch (prep writes nothing under `records/adr/`):

- **The `backends:` namespace as the single named model-access substrate** (WHAT §3 + DECISION RATIONALE: `backends:` map generalising `engines:`; `auth: subscription-seat|api-key|none` first-class with `subscription-seat` bound to the ambient session (no `seat_ref`); per-backend `egress: local|external` with a consumer `requires: local` fail-closed residency gate; per-consumer ordered no-primary reference lists; `engines:` alias retained indefinitely). Durable and cross-slice: every future model-access consumer (cost-routing, subscription-seat auth FAFF-478/481, the capability refactor FAFF-69/70/72) resolves *through* this shape. Nygard context = the adversarial-slot-as-odd-one-out + the three drivers; decision = the generalised namespace + auth/egress dimensions with the ambient-seat binding; consequences = the fail-closed residency posture and the deferred (not blocked) FAFF-478 seat spike.
