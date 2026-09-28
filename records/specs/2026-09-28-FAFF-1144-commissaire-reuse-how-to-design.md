# Spec — Commissaire standalone reuse how-to (`docs/guide/commissaire-reuse.md`)

> Spec: faffter-dark-nlspec · 2026-09-28 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1144.

**Artifact:** a new public guide page, `docs/guide/commissaire-reuse.md`, plus the front-door wiring that makes it discoverable (`docs/guide/intro.md` in two places, `website/sidebars-guide.js`). **Audience of this spec:** the build agent writing the page and a human reviewer checking it. **Audience of the page itself:** an engineer evaluating or embedding Commissaire as a standalone governance layer in a repository that has no SuperDomestique skills, config, or plugins installed.

This is a documentation deliverable. The "types and interfaces" below are the page's section contract and cross-link map, not code; "behaviour" is what each section must say and the exact edits that wire it in.

---

## 1. WHY — Problem and Principles

**The one idea:** Commissaire ships as a standalone `commissaire` CLI whose trust rests on a *split-key transparency log* — a producer holds a symmetric key and HMACs its own claims, a governor holds an Ed25519 key and signs decisions, and both write to one append-only, hash-chained `declared-effects.jsonl`. A reuser can embed this as their own governance chokepoint with one Stop hook, one verifier, and two binaries, and can verify the result from public key material alone. Everything the page teaches follows from that model and from one honest bound on it. Get the reader to that model first; the mechanics are downstream of it.

**Problem statement.** The split-key model, the runnable bare-Claude embed, and the freshly-shipped schema reference all exist, but a prospective reuser has no single narrative page that connects them — the framing lives in a concept page, the runnable example in a `verification/` capture, and the record shapes in a schema directory. This page is the reuse front door that ties them together and states, without softening, the one thing the standalone custody split does *not* prove.

**Design principles** (any of these, violated, is grounds to reject an otherwise-fine draft):

- **Cite, don't re-derive.** The runnable embed, the schema reference, and the own-run verify page already exist and are authoritative. The page links to them and preserves their stated bounds; it never re-explains a record shape or re-derives the capture.
- **Honest bound travels with the claim.** Every reuse capability is stated next to its limit. The custody split is reuser-runnable; it is *not* evidence that faff's own runner is prevented from lying, because faff's own runner uses an in-process governor. That sentence appears wherever the capability is claimed, never only in a footnote.
- **Guide-surface reference hygiene.** `faff lint-refs` bans `FAFF-####` ticket tags and canonical `ADR-####` citations in `docs/guide/**`. Link by concept and by repository path, never by ticket or ADR number.
- **Product-name discipline.** Follow `positioning-and-language.md`: SuperDomestique (product) / Commissaire (governance system) in prose; `faff` / `commissaire` for literal CLI and path identifiers.

**Reference context** — the real files the page depends on:

| System | Kind | Relevance |
|---|---|---|
| `docs/concept/positioning-and-language.md` | concept page | The enforced/attested/demonstrated/planned vocabulary and the split-key framing. Link up to it; do not restate. Route: `/concept/positioning-and-language`. |
| `verification/commissaire-facade/README.md` + `v0.1/{records.md,keypair.md,conformance.md,schema/}` | schema reference (shipped) | The pointer target for record shapes and the keypair custody model. Blocking dependency, now satisfied. |
| `verification/external-verification/commissaire-bare-claude/` | runnable capture | The runnable embed (README, `replay.sh`, `verify-commissaire.mjs`, `commissaire-stop-hook.mjs`). Cite as the artifact; preserve its stated bounds. |
| `plugin/skills/faff/bin/commissaire`, `bin/lib/commissaire.js`, `bin/lib/effects.js` | CLI + decision cores | The authoritative verb/flag spellings and the enforcement. |
| `docs/guide/cli.md` (the `commissaire` row) | CLI reference | Authoritative in-repo prose for the facade surface. Link, don't re-derive. |
| `docs/guide/verify-run-evidence.md` | sibling guide page | Owns verifying faff's **own** runs (on-disk map, own-run `audit verify`). Link to it; do not duplicate. |
| `docs/guide/governance-check.md` | sibling guide page | House front-matter and cross-link style to mirror; the conformance-not-authenticity CI boundary. |

**Scope statement.** This page sits in the guide's "Govern delivery" category, one step past `verify-run-evidence.md`: that page verifies *your own* run; this page teaches a *reuser* to embed Commissaire standalone and verify *their* run.

---

## 2. OUT OF SCOPE

- **Verifying faff's own runs / the on-disk evidence map.** — Owned by `docs/guide/verify-run-evidence.md`. **Extension point:** link to it wherever the reader wants own-run verification or the artifact layout.
- **The CI governance-check binding.** — Owned by `docs/guide/governance-check.md` (conformance-not-authenticity). **Extension point:** cross-link from the reuse page's "what verification does not prove" discussion.
- **Byte-level record schemas.** — Owned by `verification/commissaire-facade/v0.1/records.md` and the `schema/` JSON. **Extension point:** the pointer section (§5 of the page) links here; the page never restates a field table.
- **Correcting the concept page's stale "two halves" paragraph.** `positioning-and-language.md` still says the runner does not drive the facade; that correction is tracked separately. **Extension point:** the reuse page sources per-effect adoption status from `conformance.md` §5, not from the stale concept sentence, and links to the concept page only for the split-key *framing*.
- **Reciprocal "Related pages" back-links beyond the mandated front-door wiring.** See Open Questions (non-blocking).

---

## 3. WHAT — Page structure, vocabulary, and cross-link map

### Vocabulary (define on first use in the page)

| Term | One-line definition |
|---|---|
| Split-key transparency log | One append-only, hash-chained ledger where a producer HMACs its own claims and a governor Ed25519-signs decisions; signed, never encrypted. |
| Producer / governor | The two custodians: producer holds symmetric `K_producer`; governor holds `SK_commissaire` (Ed25519) and the HMAC `master_secret`. |
| `region:factory` seam | The extraction boundary that keeps the `commissaire` CLI dependent only on the governance cores, never on SuperDomestique scheduling or `faffter-*` skills. |
| Out-of-process signer | A governor whose signing key lives in a directory (and custody) separate from the producer — the reuser-runnable custody split. |

### Page section contract (the page's own headings, in order)

```
RECORD CommissaireReusePage:
  frontdoor_intro         # who it's for; the one idea; link up to positioning-and-language
  the_split_key_model     # item 1: K_producer HMAC + Ed25519 governor + one hash-chained ledger
  the_region_factory_seam # item 2: how the facade stays free of scheduling/faffter-*; faff regions check
  embedding_the_cli       # item 3: the bare-claude embed + the admit->...->seal loop + honest bounds
  out_of_process_signer   # item 4: --governor-dir/--producer-dir + secret-free audit verify + THE LIMIT
  schema_reference_pointer# item 5: point to verification/commissaire-facade/v0.1/
  related_pages           # cross-links (verify-run-evidence, governance-check, cli, concept)

  CONSTRAINT no token matching /\bFAFF-\d+\b/ or /\bADR[-\s]?\d{3,4}\b/i anywhere in the file
  CONSTRAINT the substring "load-bearing" appears zero times (use central / blocking / deferrable)
  CONSTRAINT product names follow positioning-and-language.md
```

### The eight-step reuse loop (item 3 — the object-verb spellings, confirmed against the CLI)

```
admit     -> commissaire contract admit   --run-dir D --producer ID --contract-revision R
                                           --scope k,k --governor-dir D --producer-dir D
declare   -> commissaire effect declare    --run-dir D --issue I --step S   (stdin: [EffectDescriptor])
authorize -> commissaire effect authorize  --run-dir D --issue I --step S --level L (stdin: AuthorizeRequest)
act       -> the reuser's own effect (the bare-claude example creates one protected file)
observe   -> commissaire effect observe    --run-dir D --issue I --step S   (stdin: [EffectDescriptor])
reconcile -> commissaire effect reconcile  --run-dir D [--issue I]   (prints escapes to stdout; NOT a ledger record)
conclude  -> commissaire verdict conclude  --run-dir D               (refuses on zero evidence; appends accepted_under_contract)
seal      -> commissaire audit seal        --run-dir D               (writes the recovery bundle)
verify    -> commissaire audit verify      --run-dir D --json        (secret-free replay from pk.json alone)
```

**Design decision — grammar.** The page uses the noun-verb object grammar (`commissaire contract admit`, `commissaire effect …`, `commissaire verdict conclude`, `commissaire audit …`), matching `cli.md` and the standalone binary. The flat aliases (`admit`, `declare`, `request-decision`, …) exist but are not taught. **Chosen:** object-verb grammar only, aliases mentioned once at most.

**Design decision — `reconcile` is a query, not a record.** `commissaire effect reconcile` prints `computeEscapes` to stdout and appends nothing; no code path writes a `reconcile` ledger line. The page must present reconcile as a detection query over the ledger. **Chosen:** describe reconcile as an escape-detection query; do not imply it writes a record. (This corrects a common grounding assumption; `records.md` already carries the same correction.)

### Cross-link map (all links by concept/path — lint-refs-clean)

| From (page section) | Links to | Form |
|---|---|---|
| intro / model | `docs/concept/positioning-and-language.md` | `/concept/positioning-and-language` |
| model / records | `verification/commissaire-facade/v0.1/records.md` (+ `keypair.md`, `conformance.md`) | repo path (GitHub URL, like sibling pages) |
| embed | `verification/external-verification/commissaire-bare-claude/README.md` + `replay.sh` | repo path |
| CLI surface | `docs/guide/cli.md` (the `commissaire` section) | `cli.md#commissaire-as-its-own-cli` |
| own-run verify / on-disk map | `docs/guide/verify-run-evidence.md` | `verify-run-evidence.md` |
| CI conformance boundary | `docs/guide/governance-check.md` | `governance-check.md` |

**Assumes:** the concept page's route is `/concept/positioning-and-language` (Docusaurus default from its path; other guide pages use the `/concept/...` absolute form). Validation: confirm the built site resolves `/concept/positioning-and-language`, mirroring how `governance-check.md` links `/concept/execution-and-governance`.

---

## 4. HOW — What each section says

**Front-door intro.** State who the page is for (a reuser embedding Commissaire with no SuperDomestique install) and lead with the one idea (the split-key transparency log). Link up to `positioning-and-language.md` for the trust vocabulary. Mirror the house front-matter of the sibling pages (title as an H1 sentence, "This page is for …" opener — `governance-check.md` and `verify-run-evidence.md` are the templates).

**Item 1 — the split-key model.** Producer holds symmetric `K_producer` (HKDF-derived from a governor-held `master_secret`) and HMACs its claims (`declare` / `observe` / `effect-decision-request`, `author: "producer"`). Governor holds Ed25519 `SK_commissaire` and signs decisions (`admission`, `effect-decision-verdict`, `accepted_under_contract`, `author: "commissaire"`). One append-only, hash-chained `declared-effects.jsonl`; records are signed, never encrypted (a transparency log). A forged verdict from a party without `SK_commissaire` fails closed. Keep this to the model — send record-shape detail to the schema reference.

**Item 2 — the `region:factory` seam.** The `commissaire` CLI is tagged `region:factory` and requires only the governance cores (`bin/lib/commissaire.js`, `bin/lib/effects.js`) plus shared infra; it imports neither SuperDomestique scheduling nor any `faffter-*` skill. `faff regions check` builds a file->region map from each module's region banner and asserts the require-graph direction invariant: a governance file never requires a factory file (factory->governance stays legal). That direction lint is what keeps the extractable governance cores the facade builds on from ever depending back on faff-the-factory.

```
Behaviour summary: why "free of scheduling / faffter-*" is checkable, not asserted.
  1. Each bin/lib module carries exactly one region banner (governance | factory | shared-infra).
  2. `faff regions check` reads the banners + the require() graph.
  3. It fails if any governance module requires a factory module.
  4. faffter-* skills are prompt files invoked as slots — never require()d by the CLI —
     so they are absent from the graph by construction, not by a suppression flag.
```

**Anti-pattern:** claiming `regions check` "verifies the facade imports no skills." Why: the lint asserts require-graph *direction* over the module set; the freedom from `faffter-*` skills follows because those skills are not require-edges at all. State the mechanism precisely.

**Item 3 — embedding the CLI.** Promote the `commissaire-bare-claude/` capture to first-class: one Stop hook (`commissaire-stop-hook.mjs`), one verifier (`verify-commissaire.mjs`), two binaries (`commissaire` + `faff`) from one pinned checkout, zero config. Walk the admit -> declare -> authorize -> act -> observe -> reconcile -> conclude -> seal loop (table above), then state the capture's own honest bounds verbatim in spirit:

- The bounded-denial claim: the protected target is absent at `prepare` end and at grant time, present only after the grant; it does not prove no transient create-then-delete inside a turn.
- The provenance label (`claude-code-observed`) is a *forgeable derived label*, not a cryptographic identity.
- The residual human oracle: the machine cannot tell two real turns from two hand-crafted Stop-shaped stdins; an operator attests out of band.
- No isolation claim, no "prevents every side effect" claim, and no merge enforcement claim in this capture.

Point at `replay.sh` as the runnable proof (secret-free replay from public material). **Chosen:** cite the capture and its README bounds; do not re-derive or re-run the capture in the page.

**Item 4 — the out-of-process-signer how-to.** `commissaire contract admit --governor-dir <d> --producer-dir <d>` mints the governor keypair + master into the governor dir, delivers `K_producer` and publishes `PK_commissaire` into a *separate* producer dir, and **refuses when the two dirs coincide** — so the signing key and any producer key never share a custodian. A holder of `pk.json` alone then runs `commissaire audit verify --run-dir <dir> --json` (secret-free replay): Ed25519 decisions verify from the public key; producer HMAC claims without the secret classify as `unverifiable_without_secret` (an honest non-blocking limit, never a pass-inflating fold). Exit `0` pass / `1` verify-fail / `2` setup.

**The limit — stated plainly, in this section:**

> This custody split is *reuser*-runnable. It is **not** proof that faff's own runner prevents a lying runner. faff's own runner uses an **in-process** governor: it drives the schema:3 facade for both the **merge** and the **pr-create** effects (demonstrated for merge and pr-create; other effects planned) — not merge-only, and not an out-of-process governor. Because the runner mints and holds the signing key alongside the log it protects, a `pass` is tamper-evidence for a verifier, not proof the runner told the truth.

**Anti-pattern:** writing "merge only." Why: the runner drives the facade for merge *and* pr-create (confirmed in `faff-graft`'s Governed merge and Governed pr-create producer halves). **Anti-pattern:** writing "out-of-process governor for faff's own runs." Why: faff's own governor is in-process; the out-of-process split is the *reuser's* option.

**Item 5 — schema-reference pointer.** A short section pointing to `verification/commissaire-facade/v0.1/` (README + `records.md` / `keypair.md` / `conformance.md` / `schema/`) as the citable record shapes and keypair custody model — the shipped counterpart to this narrative. One paragraph, not a restatement.

**Failure modes of this documentation approach:**

- **The failure:** the page drifts from the CLI as the surface evolves (a taught flag or verb spelling goes stale). **How you'd know:** a reader's copied command errors, or a link 404s. **What it means:** the page cites `cli.md` and the capture as the moving sources of truth and keeps its own command lines minimal, so drift surfaces there first, not in a re-derived wall of flags. Narrow, don't expand, the taught surface.
- **The failure:** the honest limit gets separated from a capability claim during editing, leaving an over-strong reuse promise. **How you'd know:** a review reads the out-of-process section and finds a capability without its adjacent limit. **What it means:** the principle "honest bound travels with the claim" is a review gate, not a nicety.

---

## 5. SCENARIOS — born-verifiable objectives

Documentation deliverable: the objectives are verifiable against the built page and the repo tooling. No holdouts — this page has no runtime feature for a code-blind evaluator to exercise, so zero holdouts is the honest choice.

```
Given the new page docs/guide/commissaire-reuse.md
When faff lint-refs runs over docs/guide/**
Then it reports zero violations for the new file (no FAFF-#### tag, no ADR-#### citation)
```

```
Given the rendered page text
When searched case-insensitively for the substring "load-bearing"
Then there are zero matches
```

```
Given the page body
When its cross-links are resolved
Then each of these targets resolves: /concept/positioning-and-language,
     verification/commissaire-facade/v0.1/ (the schema reference),
     verification/external-verification/commissaire-bare-claude/ (README + replay.sh),
     docs/guide/cli.md (commissaire section), docs/guide/verify-run-evidence.md,
     docs/guide/governance-check.md
```

```
Given the out-of-process-signer section
When read for the limit statement
Then it names --governor-dir/--producer-dir and secret-free audit verify,
     AND states: in-process governor for faff's own runs, driving the facade for
     merge AND pr-create (not merge-only), not an out-of-process governor,
     and not proof faff prevents a lying runner
```

```
Given docs/guide/intro.md after the change
When its "Choose a path" section and its "All guide pages" table are inspected
Then both reference commissaire-reuse.md
```

```
Given website/sidebars-guide.js after the change
When the "Govern delivery" category's items are inspected
Then 'commissaire-reuse' is present (alongside governance-check and verify-run-evidence)
```

- The page cites the `commissaire-bare-claude` capture as the runnable artifact and preserves its stated bounds (bounded-denial, forgeable provenance label, residual human oracle, no-isolation/no-prevent-every-effect/no-merge-enforcement) rather than re-deriving them.
- The page does not duplicate `verify-run-evidence.md`'s on-disk map or own-run verify content; it links to that page where the reader needs them.

---

## 6. DESIGN DECISION RATIONALE

**Where does the page live and how is it wired in?**
Options: (a) new "Govern delivery" sidebar page after `verify-run-evidence`; (b) a section appended to `verify-run-evidence.md`; (c) a concept page.
(b) violates the content boundary (that page owns own-run verification) and the DoD's separate-file requirement; (c) is framing, which `positioning-and-language.md` already owns.
**Chosen:** a standalone guide page at `docs/guide/commissaire-reuse.md`, wired into the "Govern delivery" category in `sidebars-guide.js` after `verify-run-evidence`, and into `intro.md` in both the "Choose a path" prose and the "All guide pages" table — rationale: it is a distinct reuser-facing how-to, and the sibling own-run page is its natural predecessor.

**How to handle framing vs the stale concept sentence?**
`positioning-and-language.md`'s "two halves" paragraph still asserts the runner does not drive the facade — stale per the shipped merge/pr-create adoption.
**Chosen:** link to the concept page for the split-key *framing and vocabulary* only; source per-effect adoption status from `conformance.md` §5 and state it directly as "demonstrated for merge and pr-create; other effects planned." Correcting the concept sentence is out of scope (tracked separately).

**Merge-only vs merge-and-pr-create for faff's own runner?**
Grounded in `faff-graft`'s Governed merge producer half and Governed pr-create producer half, and `conformance.md` §5.
**Chosen:** always "demonstrated for merge and pr-create; other effects planned" — never "merge only," never "uniform adoption."

**How precisely to describe `faff regions check`?**
A loose "verifies no skills imported" claim is inaccurate.
**Chosen:** describe the require-graph *direction* lint (governance never requires factory) and note `faffter-*` skills are absent from the graph because they are prompt-slot files, not require-edges.

**How to satisfy lint-refs on a page that conceptually depends on tickets and ADRs?**
The guide surface bans `FAFF-####` and `ADR-####`.
**Chosen:** link by concept and by repository path exclusively; the schema reference and capture are cited by path, which is not a ticket/ADR token. (The `verification/**` files may cite ADRs freely — they are outside the enforced surface.)

**Holdouts?**
A docs page has no runtime feature for a code-blind evaluator.
**Chosen:** zero holdouts — all scenarios verify against the built page and repo tooling. Honest and valid per the marking rules.

**Assumes:** the Docusaurus route for the concept page is `/concept/positioning-and-language`. Validation in Assumptions below.

---

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions**

- **Punt (non-blocking) (decides: product):** should reciprocal "Related pages" back-links be added *from* `verify-run-evidence.md` and `governance-check.md` to the new page, beyond the mandated intro + sidebar wiring? Default: add a single back-link from `verify-run-evidence.md`'s "Related pages" list, since that page is the natural sibling; leave `governance-check.md` untouched. This does not block the increment — the mandated front-door wiring stands alone — and is cross-referenced under OUT OF SCOPE, so it is eligible-non-blocking by construction.

**Assumptions**

- **Assumes:** the concept page resolves at `/concept/positioning-and-language`. **Validate:** build the site (or inspect the concept docs' `routeBasePath`) and confirm the link resolves, exactly as `governance-check.md` links `/concept/execution-and-governance`.
- **Assumes:** `verification/**` paths are linked as GitHub repo URLs from a guide page (the sibling pages link `verification/...` via `https://github.com/shftwst/faff/blob/main/...`). **Validate:** mirror the sibling pages' link form.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] `docs/guide/commissaire-reuse.md` exists and opens with the split-key transparency-log model and who the page is for.
- [ ] The page links up to `docs/concept/positioning-and-language.md` for framing.

### From WHAT (structure and cross-links)
- [ ] All five required topics are present as sections: split-key model, `region:factory` seam, embedding the CLI (the eight-step loop + bounds), out-of-process signer, schema-reference pointer.
- [ ] Cross-links resolve to: `/concept/positioning-and-language`, `verification/commissaire-facade/v0.1/`, `verification/external-verification/commissaire-bare-claude/` (README + `replay.sh`), `docs/guide/cli.md` (commissaire section), `docs/guide/verify-run-evidence.md`, `docs/guide/governance-check.md`.
- [ ] Object-verb grammar is used for every `commissaire` command; `reconcile` is presented as a stdout query, not a ledger record.

### From HOW (content)
- [ ] The `region:factory` section describes the require-graph direction lint enforced by `faff regions check` (governance never requires factory) and states `faffter-*` skills are absent from the graph by construction.
- [ ] The embed section cites the `commissaire-bare-claude` capture (one Stop hook, one verifier, two binaries, zero config) and preserves its stated bounds; it does not re-derive the capture.
- [ ] The out-of-process-signer section documents `--governor-dir`/`--producer-dir`, the refuse-when-dirs-coincide rule, and secret-free `commissaire audit verify` (exit 0/1/2; `unverifiable_without_secret` is not a failure).
- [ ] The limit is stated: in-process governor for faff's own runs, facade driven for **merge and pr-create** (not merge-only), not an out-of-process governor, not proof faff prevents a lying runner.
- [ ] The page does not duplicate `verify-run-evidence.md`'s on-disk map or own-run verify content.

### From HOW (constraints)
- [ ] `faff lint-refs` reports zero violations for the new page (no `FAFF-####`, no `ADR-####`).
- [ ] The substring "load-bearing" appears nowhere in the page.
- [ ] Product names follow `positioning-and-language.md` (SuperDomestique / Commissaire in prose; `faff` / `commissaire` for identifiers).
- [ ] The page is lean and skimmable — tables/bullets over prose walls.

### From wiring
- [ ] `docs/guide/intro.md` references the page in both the "Choose a path" section and the "All guide pages" table.
- [ ] `website/sidebars-guide.js` lists `'commissaire-reuse'` in the "Govern delivery" category.

**Integration smoke test:**
```
1. Build the Docusaurus site (or run the docs link check).
2. Assert the new page renders and every cross-link resolves (no 404).
3. Run `faff lint-refs` — new page clean.
4. grep -i "load-bearing" docs/guide/commissaire-reuse.md  -> no matches.
5. Confirm the sidebar shows the page under "Govern delivery" and intro.md links it in both places.
```

---

confidence: high
build-tier: complex
