# FAFF-529 — Cut faff + SUT `.faffrc` configs over to the `backends:` shape (post-FAFF-523 rollout)

> Spec: faffter-dark-nlspec · 2026-07-16 · autonomous · confidence: high. Full spec on Linear FAFF-529.
> **Refreshed 2026-07-16 (autonomous)** — folded operator resolution (comment "Resolution (operator, 2026-07-16)"): both architecture punts closed, **correcting the spec's premise**. (1) The "external-only (nvidia+gemini) for SUTs" lean rested on a *false* assumption ("a caged SUT likely cannot reach the operator's tailnet host") — the operator has run in-cage calling local ollama over tailnet for months; the current config works. So the L4-eligible SUT chain **includes the ollama-`local` fallback** (nvidia → gemini → ollama-local, matching faff's own chain). (2) The private ollama tailnet host **stays committed** in the base `.faffrc.yaml` (it demonstrably works committed; ADR-0067 named it an overlay *candidate*, not a mandate). Depends on FAFF-523's now-finalised `backends:` schema (with `seat_ref` dropped, per 523's resolution this pass) — **builds after FAFF-523**. Re-rated **medium → high**.

This is the build spec for FAFF-529, addressed to the build agent and human reviewers. It is a **config migration** — it moves the adversarial-review backend definitions off the legacy `faffter_dark.adversarial` key and onto the shared `backends:` namespace that **FAFF-523 defines**, across every *live* config surface: faff's own committed (and any local) `.faffrc`, and the L4-eligible SUT scaffolders. It writes no new runnable code path and invents no schema; its entire interface is **parameterised over FAFF-523's finalised shape**, carried here as a load-bearing `**Assumes:**`.

## Refresh (operator resolution, 2026-07-16)

Both former Punts are now **Chosen**, and one required **correcting a false premise** rather than merely answering it:

- **INCLUDE the ollama-`local` fallback in the L4-eligible SUT chain (Chosen — premise corrected).** The earlier draft leaned toward external-only (nvidia+gemini) for SUTs on the assumption that a claude-box cage likely cannot reach the operator's tailnet ollama host. **That assumption is empirically false:** the operator has been running in-cage, calling local ollama over tailnet, for months, and the current config works perfectly. The rewritten assumption (below) is that the cage **does** reach the tailnet ollama host; each L4-eligible SUT's chain is therefore nvidia → gemini → **ollama-local**, matching faff's own three-element chain.
- **KEEP the private ollama tailnet host committed in the base `.faffrc.yaml` (Chosen).** It demonstrably works committed; ADR-0067 names an internal hostname as an overlay *candidate*, not a mandate. Do not move it to `.faffrc.local.yaml`.
- **Sequencing unchanged:** builds after FAFF-523, consuming 523's now-finalised `backends:` schema (with `seat_ref` dropped — see 523's resolution). If a placeholder field name below differs from 523's final choice, 523's choice wins.

## 1. WHY — Problem and Principles

**The load-bearing model:** faff has *two* ways to say "here is the adversarial reviewer's backend chain" — the legacy `faffter_dark.adversarial` block (primary scalars + a `fallbacks` list) and FAFF-523's new shared `backends:` namespace referenced by a `models.review_adversarial` pointer. FAFF-523 migrated **only** the adversarial slot as a proof-of-concept; every *other* live surface still speaks the legacy dialect (or, worse, speaks nothing). This ticket finishes the cutover so there is **one** shape, then deletes the legacy key. A migration is correct iff the resolver emits the **same bytes** afterward — nothing about *which* provider answers a review call may change.

**Problem statement.** Today faff's `.faffrc.yaml` routes adversarial review through a full legacy `faffter_dark.adversarial` block, while the SUT scaffolders emit a `review: faffter-dark-adversarial-review` slot with **no backend definition at all** — so a freshly-scaffolded SUT's adversarial review has no provider/model/host to resolve and `faff adversarial-backends` exits 3 (unconfigured), silently disarming the L4 gate. This ticket refactors faff's config to the `backends:` shape and gives each L4-eligible SUT scaffolder a self-contained `backends:` definition (nvidia + gemini + ollama-local), so one shape governs every surface and a scaffolded SUT resolves a real chain.

**Design principles.**

- **Byte-equivalence is the acceptance floor, not a nice-to-have.** The migrated faff chain must resolve *identically* to today's `faff adversarial-backends` output (captured below as a golden fixture). A migration that changes the emitted chain is a defect even if every gate stays green — the gates check shape, the golden fixture checks *identity*.
- **Names may be committed; values never.** Honour ADR-0067's two-file posture: backend `host` and `auth`/`api_key_env` **names** (env-var names, public API hostnames) may stay in the committed base `.faffrc.yaml` — **and, per the operator resolution, so may the private ollama tailnet hostname** (it demonstrably works committed; ADR-0067 names it an overlay *candidate*, not a mandate). No secret **value** is ever written to either file.
- **Clean cutover, no back-compat window.** Single-user, no external adopters. Once a surface is migrated its legacy `faffter_dark.adversarial` block is **deleted** in the same change — no dual-read, no deprecation shim. The only safety net is the gate suite staying green *throughout*.
- **Do not invent FAFF-523's schema.** Every field name, the namespace key, the egress-marker field, the ordered-reference-list form, and the `models.review_adversarial` pointer form are **FAFF-523's** to decide (now finalised — `seat_ref` dropped, `auth`/`egress` first-class, ordered no-primary reference lists). This spec describes *what moves where* parameterised over that shape; if a placeholder key name below differs from 523's final choice, 523's choice wins and this spec's mechanics are unchanged.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `.faffrc.yaml` (faff base) | YAML | Surface 1 — carries the legacy `faffter_dark.adversarial` block + `models:` lanes + `slots.review` |
| `docs/external-verification/scaffold-p{1,2,3}.sh` | bash | Surface 2 — L4-eligible SUT scaffolders; emit `review`/`spec_review` slots but **no** backend config |
| `docs/external-verification/scaffold-p{4,5}.sh` | bash | Out of scope — git-only, gated, `review: faffter-noon-review`; no adversarial backend |
| `plugin/skills/faff/bin/lib/adversarial-backends.js` | JS | The FAFF-261 resolver; already consumes a native `backends:` array under `faffter_dark.adversarial` (proven substrate). FAFF-523 supplies its successor for the shared namespace |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | JS | Downstream consumer of the emitted chain (`--backends-json`); **unchanged** by this ticket |
| `docs/adr/0067-committed-config-posture-two-file-model.md` | ADR | The two-file (base + `.local`) posture this migration honours; names the tailnet host as an overlay *candidate*, not a mandate |

**Scope statement.** This is the rollout half of FAFF-523: 523 lands the shape and migrates one slot; 529 migrates the rest and removes the legacy key. It builds **after** FAFF-523.

## 2. OUT OF SCOPE

- **Defining the `backends:` schema** — *Why excluded:* that is FAFF-523's deliverable (now finalised); this ticket consumes it. *Extension point:* FAFF-523's spec + the `backends:` namespace it lands in `config.js` DEFAULTS and the resolver successor.
- **Changing `review-call.mjs` / the resolver's chain-assembly logic** — *Why excluded:* the consumer already reads a `backends:` array (FAFF-261/262); migration is config-data-only. *Extension point:* `plugin/skills/faff/bin/lib/adversarial-backends.js` if 523's successor lives elsewhere.
- **P4/P5 SUT scaffolders** — *Why excluded:* git-only, gated, `review: faffter-noon-review` — no adversarial backend to define. *Extension point:* `scaffold-p4-stripe-testmode.sh` / `scaffold-p5-brownfield.sh` only if a future issue promotes them to L4.
- **Supplying the SUT's key VALUES** — *Why excluded:* FAFF-524's `.env.claude-box` copy supplies `NVIDIA_API_KEY` / `GEMINI_API_KEY`; this ticket only references those names via `auth`. The ollama-local entry needs no key (keyless). *Extension point:* FAFF-524.
- **Defining egress-marker semantics/enforcement** — *Why excluded:* FAFF-523's finalised schema owns the `egress` field and its `external`/`local` vocabulary (folded from the former FAFF-525 scope into 523); this ticket only *sets* the marker per backend (`external` for nvidia/gemini, `local` for ollama). *Extension point:* FAFF-523.
- **The `models:` per-lane model tokens** (`build_by_confidence`, `prep_explore`, `eval`) — *Why excluded:* those select the Claude Agent-token per lane and are orthogonal to backend routing; they stay as-is. Only the *new* `models.review_adversarial` pointer is added. *Extension point:* `config.js` DEFAULTS `models.*`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Legacy block | `faffter_dark.adversarial:` — primary scalars (`provider`/`model`/`host`/`api_key_env`/`timeout`) plus a `fallbacks:` list. The shape being removed. |
| `backends:` namespace | FAFF-523's shared, named backend-definition namespace (exact key name = 523's). Each entry is a self-contained backend. |
| Ordered reference | `models.review_adversarial` (523's pointer): an ordered list of `backends:` entry names naming the primary-first adversarial chain. |
| Backend entry | One named backend: `provider`/`model`/`host` + `auth` (env-var name, or none for ollama) + `egress` marker + optional `timeout`/`reasoning_off`. |
| Golden fixture | The exact JSON `faff adversarial-backends` emits **today** for faff's config — the byte-equivalence target (Appendix A). |
| L4-eligible SUT | A scaffolder whose `.faffrc` sets `review: faffter-dark-adversarial-review` (P1/P2/P3). Needs a resolvable adversarial backend (nvidia + gemini + ollama-local). |

**Backend entry — shape (parameterised over FAFF-523).** Field *names* below are placeholders pending 523's finalised schema; the **content** each must carry is fixed:

```
RECORD BackendEntry:            # one named entry under the `backends:` namespace
  provider: string              # e.g. "nvidia" | "gemini" | "ollama"
  model:    string              # served-check exact-match id (prefix-sensitive: "z-ai/glm-5.2", "models/gemma-4-31b-it")
  host:     string              # public API base URL, OR the private tailnet host for ollama (KEPT COMMITTED per operator resolution)
  auth:     string              # env-var NAME (523's auth field ≈ legacy api_key_env); OR subscription-seat/none — resolved from process.env at call time
  egress:   enum{external,local} # external for nvidia/gemini, local for ollama
  timeout:  int?                # optional; carried EXPLICITLY where the legacy chain inherited it (see §4 byte-equivalence)
  reasoning_off: bool?          # optional; carried only where the legacy chain set it
```

**Ordered chain reference (523's pointer form).**

```
models.review_adversarial: [ <backend-entry-name>, <backend-entry-name>, ... ]   # primary-first order
```

**Faff base `.faffrc.yaml` — target state (three named entries + pointer).** The three current chain elements (nvidia primary, gemini fallback, ollama fallback) become three named `backends:` entries; `models.review_adversarial` lists them primary-first; the whole `faffter_dark.adversarial:` block is deleted. **The ollama entry's private tailnet `host` stays committed in the base file** (operator resolution). `slots.review: faffter-dark-adversarial-review` is **unchanged**. The existing `models:` lanes are folded in beside the new `review_adversarial` pointer, untouched.

**SUT scaffolder `.faffrc.yaml` — target state.** Each of P1/P2/P3 emits a `backends:` block defining its adversarial entries **including the ollama-`local` fallback** (nvidia → gemini → ollama-local) + a `models.review_adversarial` pointer, so a scaffolded SUT resolves the full chain instead of exiting 3. `auth` references the `.env.claude-box` key names for nvidia/gemini (FAFF-524); the ollama entry is keyless with `egress: local` and the committed tailnet host (the cage reaches it — see the rewritten assumption). A SUT cannot inherit faff's block — it is its own repo with its own `.faffrc`.

**Design decisions** (collected in §5; markers inline):

- **Chosen:** sequence FAFF-529 **strictly after** FAFF-523 lands — this migration's every interface is defined by 523's shape.
- **Chosen:** clean cutover — delete the legacy block per surface in the same change; no dual-read window.
- **Chosen (was Punt — resolved 2026-07-16):** the private ollama tailnet host **stays committed** in the base `.faffrc.yaml` (works committed; ADR-0067 names it an overlay *candidate*, not a mandate). Not moved to `.faffrc.local.yaml`.
- **Chosen (was Punt — resolved 2026-07-16, premise corrected):** the L4-eligible SUT chain **includes the ollama-`local` fallback**. The former "cage can't reach tailnet" assumption is empirically false — the operator has run in-cage calling tailnet ollama for months. The SUT chain is nvidia → gemini → ollama-local, matching faff's own chain.

## 4. HOW — Behavior

**Approach.** Two independent surface migrations sharing one invariant (the gate suite stays green throughout). Each is a mechanical config rewrite validated against a captured baseline.

**Surface 1 — faff base `.faffrc.yaml`.**

```
PROCEDURE migrate_faff_base():
  1. CAPTURE golden fixture:  `faff adversarial-backends > golden.json`  (Appendix A is that output today)
  2. AUTHOR three `backends:` entries from the legacy block, one per current chain element:
       nvidia-primary  ← faffter_dark.adversarial scalars     (egress: external)
       gemini-fallback ← fallbacks[0]                          (egress: external)
       ollama-fallback ← fallbacks[1]                          (egress: local; private tailnet host stays COMMITTED)
  3. FLATTEN legacy inheritance EXPLICITLY (critical — see below):
       each entry carries its OWN auth + timeout; nothing is inherited from a "primary"
  4. ADD  models.review_adversarial: [nvidia-primary, gemini-fallback, ollama-fallback]  (primary-first)
  5. DELETE the entire `faffter_dark.adversarial:` block
  6. Per ADR-0067 + operator resolution: keep host/auth NAMES committed AND keep the ollama tailnet host COMMITTED in the base file (no overlay move)
  7. VERIFY: `faff adversarial-backends` (523 successor) output == golden.json  (byte-for-byte)
  8. VERIFY gate suite green (see Scenarios)
```

**Anti-pattern:** carrying the legacy inheritance implicitly. Why: today's resolver *inherits* omitted `api_key_env`/`timeout` from the primary onto each fallback (`inheritOptionalFromPrimary`), so the emitted ollama element carries `api_key_env: NVIDIA_API_KEY` and `timeout: 480` **even though ollama needs no key**. FAFF-523's named entries stand alone (no primary to inherit from), so to stay byte-equivalent the migrated `ollama-fallback` entry MUST set `auth: NVIDIA_API_KEY` and `timeout: 480` **explicitly**. Dropping them because "ollama is keyless" changes the emitted bytes and fails acceptance. (Note: this is a byte-equivalence quirk of faff's *own* existing chain; a *fresh* SUT ollama entry may legitimately be keyless — the SUT chain has no golden-fixture obligation.)

**Surface 2 — L4-eligible SUT scaffolders (P1/P2/P3).**

```
PROCEDURE migrate_sut_scaffolder(script):   # for scaffold-p1, -p2, -p3
  1. In the heredoc that writes the SUT's .faffrc.yaml, ADD a `backends:` block defining the
     SUT's adversarial entries (provider/model/host + auth + egress), primary-first — INCLUDING an ollama-local entry.
  2. ADD  models.review_adversarial: [ nvidia-…, gemini-…, ollama-local ]   # ollama-local included (premise corrected)
  3. `auth` references the .env.claude-box key NAMES (NVIDIA_API_KEY / GEMINI_API_KEY — FAFF-524); the ollama entry is keyless.
  4. `egress`: external for nvidia/gemini, local for ollama; the ollama entry's host is the cage-reachable tailnet host.
  5. Leave slots.review / slots.spec_review / gates / budget UNCHANGED
  6. VERIFY: a freshly-scaffolded SUT's `faff adversarial-backends` resolves a chain (exit 0) whose
     third element is the ollama-local backend, where today it exits 3 (unconfigured)
```

**Edge cases.**

- **The successor resolver's location.** If FAFF-523 replaces `faff adversarial-backends` with a differently-named command, this spec's `faff adversarial-backends` invocations mean "523's successor resolver" — the *contract* (emit primary-first JSON array; exit 3 unconfigured; exit 2 malformed) is what matters, not the command name.
- **ollama host reachability in a SUT cage (rewritten — premise corrected).** The cage **does** reach the operator's tailnet ollama host — this has worked in-cage for months. So the ollama-local entry is a **live third fallback**, not dead weight. Its host is the committed tailnet host (same as faff's own base config).
- **Empty/partial migration.** A half-migrated base (legacy block deleted but `backends:` not yet complete) would make `faff adversarial-backends` exit 3 — caught immediately by the byte-equivalence check (step 7); never commit a surface between steps 5 and 7.

**Failure modes.**

- **The failure:** byte-equivalence passes on faff but the *inheritance flattening* is missed, so the ollama element silently drops `auth`/`timeout`. **How you'd know:** the golden-fixture diff (Appendix A vs migrated output) shows a 3rd-element field delta. **What it means:** narrow — fix the entry, re-run; do not proceed.
- **The failure:** the SUT `backends:` block references key names `.env.claude-box` does not actually export (FAFF-524 drift), so review resolves a chain but every nvidia/gemini call 401s. **How you'd know:** `faff adversarial-backends` exit 0 in the SUT, but a live review call returns auth-failure; the auth names in the emitted chain don't match `.env.claude-box`'s exports. **What it means:** narrow — align the `auth` names with FAFF-524's actual copy set. (The ollama entry is keyless, so it is unaffected.)
- **The failure:** FAFF-523's final field names differ enough from the placeholders here that a migrated entry is *shaped* right but *named* wrong, and `config check`/`validate-adapters` pass anyway (they check posture/lint, not backend semantics). **How you'd know:** `faff adversarial-backends` exits 3 despite a present `backends:` block (the successor resolver can't find its expected keys). **What it means:** narrow — re-key to 523's finalised schema; this is exactly why the schema is a load-bearing Assumes.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given faff's committed .faffrc.yaml migrated to the `backends:` shape (legacy block deleted, ollama tailnet host kept committed)
When  `faff adversarial-backends` (or its FAFF-523 successor) resolves the chain
Then  its stdout is byte-for-byte identical to the golden fixture captured before migration (Appendix A)
```

```
Given the migrated faff base config
When  the ollama fallback entry is inspected
Then  it carries `auth: NVIDIA_API_KEY` and `timeout: 480` EXPLICITLY (the flattened legacy inheritance), not omitted, and its committed tailnet host is unchanged
```

```
Given the migrated faff base + all migrated L4 SUT scaffolders
When  the gate suite runs (`faff config check`, `faff validate-adapters`, `faff lights-out --check`, `faff adversarial-backends`)
Then  every gate is green on every refactored config
```

- Every `backends:` entry (faff + SUT) MUST set both an `auth` field (env-var name, or none for ollama) and an `egress` marker (`external` nvidia/gemini, `local` ollama).
- No live `.faffrc` surface (faff base + local + P1/P2/P3 scaffolders) references `faffter_dark.adversarial` after migration.

## 5. DESIGN DECISION RATIONALE

**Sequence before or after FAFF-523?** After. FAFF-523 defines the namespace key, entry fields, egress field, and ordered-reference form (now finalised, `seat_ref` dropped); building 529 first would mean inventing a competing schema. **Chosen:** strictly after 523 lands — this is the ticket's BlockedBy.

**Clean cutover vs dual-read deprecation window?** Options: (a) keep the legacy block readable alongside `backends:` for a window; (b) delete it in the same change. Single-user, no external adopters, no back-compat obligation — a window is pure carrying cost and a second source of truth. **Chosen:** (b) clean cutover, legacy block deleted per surface, gate suite green throughout as the only net.

**Prove correctness how?** Options: (a) trust the gates; (b) golden-fixture byte-equivalence. Gates check posture/lint/shape, not chain *identity* — they would pass a migration that silently swapped a model. **Chosen:** (b) capture `faff adversarial-backends` output pre-migration, diff post-migration; identity is the acceptance floor.

**Private ollama host — committed or overlay? (was Punt — resolved 2026-07-16)** ADR-0067 names an internal hostname as an overlay *candidate*, not a mandate; the operator has run it committed for months and it works. **Chosen:** **keep it committed** in the base `.faffrc.yaml`. It is a hostname (not a secret value), and the demonstrated working config is the dispositive evidence. No overlay move.

**SUT ollama-local fallback — include it? (was Punt — resolved 2026-07-16, premise corrected)** The earlier draft leaned external-only on the assumption that a caged SUT can't reach the operator's tailnet host and `.env.claude-box` ships no ollama key. **The first half of that assumption is empirically false** — the operator has run in-cage, calling tailnet ollama, for months. **Chosen:** **include the ollama-local fallback** in the SUT chain (nvidia → gemini → ollama-local), matching faff's own chain; the ollama entry is keyless (no `.env.claude-box` key needed) with `egress: local` and the committed tailnet host. The cage reaches it, so it is a live fallback.

Temporal anchor: at time of this refresh FAFF-523's `backends:` schema is **finalised** (its prep resolved this same pass — `seat_ref` dropped, `auth`/`egress` first-class, ordered no-primary reference lists); the placeholders in §3 yield to 523's final field names where they differ.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — both former Punts are resolved (2026-07-16): the private ollama host stays committed, and the SUT chain includes the ollama-local fallback (the false "cage can't reach tailnet" premise is corrected).

**Assumptions.**

- **Assumes:** FAFF-523's finalised `backends:` schema exists — the namespace key name, per-entry field set (incl. the `auth` field ≈ legacy `api_key_env`, with **no `seat_ref`** per 523's resolution), the egress-marker field, and the `models.review_adversarial` ordered-reference-list form. *Validate:* read FAFF-523's landed spec + `config.js` DEFAULTS `backends.*` / `models.review_adversarial` before authoring any entry; if any placeholder in §3 differs, adopt 523's names verbatim. **Load-bearing — this migration cannot start until 523 lands.**
- **Assumes (rewritten 2026-07-16 — premise corrected):** a claude-box cage **can** reach the operator's tailnet ollama host — this has worked in-cage for months, so the ollama-local entry in a SUT chain is a live fallback, not inert. *Validate:* from a caged SUT, `curl <ollama-tailnet-host>` (or a `faff adversarial-backends` live-call smoke) reaches the host; the operator's standing in-cage experience is the primary evidence.
- **Assumes:** FAFF-524's `.env.claude-box` copy exports `NVIDIA_API_KEY` and `GEMINI_API_KEY` into a scaffolded SUT's environment. *Validate:* grep FAFF-524's `.env.claude-box` template for the exact key names before wiring each SUT nvidia/gemini entry's `auth`; the `auth` names must match those exports byte-for-byte. (The ollama entry is keyless.)

## 7. DONE — Definition of Done

### From WHY
- [ ] No live `.faffrc` surface (faff base + `.faffrc.local.yaml` + P1/P2/P3 scaffolders) references the legacy `faffter_dark.adversarial` block.
- [ ] Every model/provider/auth reference on every migrated surface resolves through a named `backends:` entry (none scattered/legacy).

### From WHAT (types/interfaces)
- [ ] Faff base `.faffrc.yaml` defines the three chain elements as named `backends:` entries + a primary-first `models.review_adversarial` pointer; the ollama entry's tailnet host stays committed; `slots.review` unchanged; existing `models:` lanes untouched.
- [ ] Each backend entry carries both an `auth` field (env-var name, or none for ollama) and an `egress` marker.
- [ ] Each of P1/P2/P3 scaffolders emits a `backends:` block + `models.review_adversarial` pointer into the SUT `.faffrc.yaml`, **including an ollama-local fallback entry**; P4/P5 unchanged.

### From HOW (behaviour)
- [ ] `faff adversarial-backends` (523 successor) on the migrated faff config emits output byte-for-byte identical to the pre-migration golden fixture (Appendix A).
- [ ] The migrated faff ollama entry carries `auth: NVIDIA_API_KEY` + `timeout: 480` explicitly (legacy inheritance flattened) and its committed tailnet host.
- [ ] A freshly-scaffolded P1/P2/P3 SUT resolves an adversarial chain (`faff adversarial-backends` exit 0) whose third element is the ollama-local backend, where the pre-migration scaffolder exits 3.
- [ ] SUT nvidia/gemini entry `auth` names match `.env.claude-box`'s exported key names (FAFF-524); the ollama entry is keyless.

### From HOW (edge cases)
- [ ] No surface is committed in a half-migrated state (legacy deleted but `backends:` incomplete → exit 3).

### From gates
- [ ] `faff config check` green on faff base + every migrated SUT scaffolder output.
- [ ] `faff validate-adapters` green.
- [ ] `faff lights-out --check` green (dial-coherence for L4 SUTs unaffected).
- [ ] `faff adversarial-backends` resolves a chain for faff (== golden) and for a freshly-scaffolded SUT (three elements incl. ollama-local).

**Integration smoke test.**

```
1. capture:  faff adversarial-backends > /tmp/golden.json     # pre-migration, in faff repo
2. migrate faff base .faffrc.yaml to `backends:` + delete legacy block (ollama host stays committed)
3. assert:   diff <(faff adversarial-backends) /tmp/golden.json   → EMPTY (byte-equivalent)
4. migrate scaffold-p1 (chain incl. ollama-local); run it into a temp SUT_ROOT
5. assert:   (cd $SUT_ROOT && faff adversarial-backends); exit code == 0 AND chain[2].provider == "ollama"   # was 3
6. assert:   faff config check && faff validate-adapters && faff lights-out --check   → all green
```

## Appendix A — Golden fixture (faff `adversarial-backends` output, pre-migration)

The exact bytes the migrated faff chain must reproduce (captured from the live resolver in this repo):

```json
[{"provider":"nvidia","model":"z-ai/glm-5.2","host":"https://integrate.api.nvidia.com/v1","api_key_env":"NVIDIA_API_KEY","timeout":480},{"provider":"gemini","model":"models/gemma-4-31b-it","host":"https://generativelanguage.googleapis.com/v1beta/openai","api_key_env":"GEMINI_API_KEY","timeout":480},{"provider":"ollama","model":"qwen3-next:80b-a3b-instruct-q4_K_M","host":"http://studio.longhair-escalator.ts.net:11434","api_key_env":"NVIDIA_API_KEY","timeout":480}]
```

Note the third (ollama) element carries `api_key_env: NVIDIA_API_KEY` and `timeout: 480` **by legacy inheritance** — the migrated named entry must set both explicitly (§4 anti-pattern), and its committed tailnet host is unchanged. If FAFF-523's successor emits `auth` in place of `api_key_env`, byte-equivalence is asserted against 523's re-captured baseline, not this literal, but the *field content* (names, models, hosts, timeouts, order) is invariant.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

---

## Build-time resolve-attempt note (added at graft time, 2026-07-17)

FAFF-523 landed with a **different reference-list field name** than this spec's placeholder assumed. The spec's §3/§4 placeholder used `models.review_adversarial: [name, ...]` as the pointer form; FAFF-523's actual landed schema (confirmed in `plugin/skills/faff/bin/lib/backends.js`, `plugin/skills/faff/bin/lib/adversarial-backends.js`, and FAFF-523's own spec `docs/specs/2026-07-16-FAFF-523-shared-modelproviderauth-backend-config-namespace-design.md`) uses **`faffter_dark.adversarial: { refs: [name, ...], deadline?: N }`** — an ordered reference list living directly under the (slimmed) `faffter_dark.adversarial` key, not a `models.*` pointer. `models.review_adversarial` was only ever a speculative mention in an earlier, unrelated design doc (`2026-07-03-FAFF-315-per-lane-model-selection-design.md`) and was never implemented.

Per this spec's own explicit instruction ("if a placeholder key name below differs from 523's final choice, 523's choice wins and this spec's mechanics are unchanged" — §1, §3, §6 Assumes), this build adopts FAFF-523's real, landed field names verbatim:

- Named `backends:` entries live in the top-level `backends:` map (as specified).
- The ordered reference list is `faffter_dark.adversarial.refs: [...]`, **not** `models.review_adversarial`.
- The DoD line "the entire `faffter_dark.adversarial:` block is deleted" is satisfied in spirit, not letter: the **scalar primary+fallbacks legacy form** is deleted (no more inline `provider`/`model`/`host`/`api_key_env`/`fallbacks` scalars) — this is precisely the "legacy dialect" the spec's WHY section defines as the migration target. A slim `faffter_dark.adversarial: { refs: [...] }` stub remains **by FAFF-523's own design** — it is the per-consumer reference-list, structurally required by the landed resolver (`assembleAdversarialBackends` reads `refs` from exactly this location). This is not an oversight; it is the shape FAFF-523's own spec's worked example shows verbatim.

This resolve-attempt is bounded to files already named in this spec's own Reference-context table (`adversarial-backends.js`) plus its direct dependency (`backends.js`) and FAFF-523's own landed spec — well within the 3-file resolve-attempt bound, and the answer is a single unambiguous fact (what did FAFF-523 actually ship) rather than a design judgement call.
