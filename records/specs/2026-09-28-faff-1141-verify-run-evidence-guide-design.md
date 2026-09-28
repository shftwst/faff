# Spec: Operator guide — verify and interpret your run's Commissaire evidence (+ on-disk evidence map)

> Spec: faffter-dark-nlspec · 2026-09-28 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1141.

This is the buildable specification for FAFF-1141. It is written for the build agent that will author the documentation, and for the human reviewers who gate it. The deliverable is **documentation content**, not code: one new operator-facing guide page, one Glossary term, and one routing-table wiring change. No product code is touched.

---

## 1. WHY — Problem and Principles

**The central model.** A governed SuperDomestique run leaves behind a **transparency log**: an append-only, hash-chained set of records under the run directory. Some records are HMAC-authenticated by a *producer* that holds only a symmetric key; the protected-effect *decisions* are Ed25519-signed by *Commissaire*, which holds the private signing key. `faff commissaire audit verify` replays that log from public material and reports whether every signed record authenticates. The signatures make tampering **evident to a verifier**; because the runner mints and holds the signing key in the same run directory as the log it protects, they are **not** proof the runner told the truth. Everything in this page hangs off that one distinction — evidence you can *verify*, versus authority you must still *trust*.

**Problem statement.** The mechanics to verify and read a run's evidence already ship, but they are scattered across a dense CLI reference row, a CI-admin wiring guide, the flight-recorder schema spec, and a verification case study framed as "reproduce our published capture". An operator asking "how do I check and interpret my own run's signed evidence, and where does it live on disk?" is routed nowhere. This change adds the one task-oriented page that answers that question and wires it into the guide front door.

**Design principles.**

**Reuse the candid trust prose; never re-derive it.** The trust-model caveat is already stated carefully on the canonical concept page and the CI-admin guide. The new page restates it in operator terms in one short section and **links** to the source. Re-deriving the guarantee invites drift and a subtly weaker claim.

**No external-artifact citations in the guide body.** `faff lint-refs` scans `docs/guide/**` and fails the build on ticket tags (`FAFF-####`), ADR citations (`ADR ####`), or numbered ADR-file pointers. The new page must reference concept pages, sibling guide pages, and the evidence spec by link only — never by ticket or ADR number.

**Ground every path and field against a real run.** The on-disk map, the JSON field list, and the exit codes must match what a current governed run and `faff commissaire audit verify` actually produce — not an idealised layout. (This spec already corrected several grounding claims against a live run; see the Reference table and Design Decision Rationale.)

**Honesty over reassurance.** A `fail` verdict, an `unverifiable_without_secret` bucket, and a detected escape are all legitimate, informative outcomes. The page explains what each *means* and what the operator does next, rather than implying evidence is a guarantee of correctness.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `docs/concept/execution-and-governance.md` | Concept page | Canonical Commissaire trust model; "The runner's own merges" + trust-caveat prose to reuse and link, not restate in full |
| `docs/guide/governance-check.md` | Guide page | CI-wiring sibling; source of the "conformance, not authenticity" boundary |
| `docs/guide/cli.md` | Guide page | Dense `commissaire` object-verb row + `audit verify` exit contract; the page links here for full flags |
| `docs/guide/intro.md` | Guide page | The guide routing table this page must be reachable from |
| `docs/reference/GLOSSARY.md` | Reference | Gets the new **escape** term; the guide links to it |
| `verification/evidence/` (`README.md`, `v0.2/anchor-integrity.md`) | Schema spec | Reference-grade flight-recorder schema + chain-head status vocabulary the page links to for depth |
| `verification/external-verification/commissaire-bare-claude/` | Case study | Worked secret-free replay (`replay.sh`); linked as the external-verifier example |
| `plugin/skills/faff/bin/commissaire` | CLI | Self-documenting `commissaire --help`; the object-verb grammar and `audit verify` exit contract |

**Scope statement.** This page sits in `docs/guide/` as the "after a run" reading destination, downstream of the build/unattended pages and adjacent to the CI-admin governance-check page.

---

## 2. OUT OF SCOPE

- **Rewriting the concept trust model.** — The mechanism, split-key design, and the independence caveat live on `docs/concept/execution-and-governance.md`. **Why excluded:** the guide page is task-oriented and links to the concept for depth; duplicating it forks the canonical statement. **Extension point:** deepen the caveat on the concept page itself.
- **CI wiring / `governance-check` setup.** — Making the check binding in branch protection is the existing `docs/guide/governance-check.md`. **Why excluded:** that is an admin task, not "verify my own run". **Extension point:** cross-link, don't merge.
- **A new `docs/reference/` evidence-schema page.** — The byte-level artifact schemas already live under `verification/evidence/`. **Why excluded:** re-authoring them violates one-source-per-schema. **Extension point:** the guide links to `verification/evidence/` for schema depth; new artifact schemas go there.
- **The full `commissaire` grammar reference.** — Every verb, flag, and alias is the `commissaire` row in `docs/guide/cli.md` and `commissaire --help`. **Why excluded:** the guide covers the *verify/interpret* verbs the operator needs, and links out for the rest. **Extension point:** the CLI reference row.
- **`faff bundle-recover` / resume flows.** — Recovering a lost run from a bundle is a distinct operator journey. **Why excluded:** this page explains what the bundle *is* and how it relates to the anchor, not how to resume from it. **Extension point:** a future "recover a lost run" guide page, linked from the bundle section.
- **Changing any verifier output, exit code, or artifact layout.** — Docs-only ticket. **Why excluded:** the mechanics ship; this describes them. **Extension point:** none — code changes are separate tickets.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary (defined before first use on the page).**

| Term | Definition |
|---|---|
| transparency log | The append-only, hash-chained `declared-effects.jsonl` — records are signed, never encrypted, so anyone with the public key can read and re-verify them |
| producer claim | A record HMAC-authenticated with the run's symmetric producer key (`author: "producer"`) — a `declare`, `observe`, or authorization request |
| Commissaire decision | An Ed25519-signed record (`author: "commissaire"`) — the admission, each `effect-decision-verdict`, and the terminal `accepted_under_contract` |
| escape | An observed protected side effect with no matching declared effect for its `(issue, step)` — the "escaped-side-effect" signal `faff effects check` computes (see the new Glossary entry) |
| anchor | The per-PR byte-copy of a run's evidence under `.faff/anchors/<run-id>/<issue>/`, shipped in the PR and re-hashed by CI |
| recovery bundle | The sealed, minimal evidence set written at a run's close through the configured `bundle_store` |

**The verify contract — the JSON `faff commissaire audit verify --run-dir <dir> --json` returns.** Grounded against a live run; the build agent MUST reproduce these exact field names (not the grounding's abbreviated set):

```
RECORD AuditVerifyResult:
  version: int                         # contract version (currently 1)
  result: "pass" | "fail"              # overall verdict
  governance_context: bool             # true when a schema:3 governance context was found
  producer_claims: RECORD              # HMAC-authenticated records
    verified: int
    unverifiable_without_secret: int   # HMAC claims with no secret available to re-check
    failed: int
  commissaire_decisions: RECORD        # Ed25519-signed records
    verified: int
    failed: int
  pk_fingerprint: string               # the Commissaire public key fingerprint replayed against
  ledger_failures: array               # chain/structure failures ([] on a clean pass)
  records: array of RECORD             # per-record classification
    seq: int
    author: "commissaire" | "producer"
    kind_of_entry: string              # admission | declare | effect-decision-request |
                                       # effect-decision-verdict | observe | accepted_under_contract
    classification: "verified" | "unverifiable_without_secret" | "failed"
    reason: string | null
```

**Exit contract (distinct from the sibling `commissaire` verbs' `3`):** `0` = pass, `1` = verification failure, `2` = invalid invocation or setup (missing `--run-dir`, or no schema:3 governance context).

**The on-disk evidence map (page content).** The page presents this as a table. Grounded against a live governed run and its anchor:

```
Live run directory  .faff/runs/<run-id>/
  run-ledger.json                        admitted issues + terminal outcomes
  events.jsonl                           the run timeline (flight recorder)
  declared-effects.jsonl                 the effect ledger — MIXED: schema:2 governance-region
                                         records (unsigned) + schema:3 facade records (signed)
  commissaire/governor/governor.json     Ed25519 keypair + master_secret (sk, pk, pk_fingerprint)
  commissaire/producer/pk.json           producer PUBLIC key (pk, pk_fingerprint)
  commissaire/producer/producers/<run-id>.json
                                         producer record incl. key_hex (symmetric), admitted_scope,
                                         contract_revision  — this is why YOUR own run verifies
                                         producer claims: the secret is present locally
  <ISSUE>/                               merge-floor artifacts: ac-checklist.json,
                                         review-verdict.json, holdout-offer.json,
                                         build-progress.json, merge-record.json

Per-PR anchor      .faff/anchors/<run-id>/<issue>/     (committed, shipped in the PR)
  declared-effects.jsonl, events.jsonl, run-ledger.json   byte-copies
  chain-head.json                        events-log tamper-evident tip (witness)
  effects-chain-head.json                effect-ledger tamper-evident tip (witness)
  commissaire/producer/pk.json           PUBLIC key only — NO governor secret, NO producers/key_hex
  <floor artifacts>                      ac-checklist.json, review-verdict.json, etc.

Recovery bundle    published by `faff commissaire audit seal` / `faff bundle publish`
                   through the resolved bundle_store (local by default)
```

**Design decision — page shape.** Options: (a) one guide page with the on-disk map inline; (b) a guide page plus a separate `docs/reference/` evidence-map page; (c) fold into the existing concept or governance-check page. **Chosen:** (a) one new `docs/guide/verify-run-evidence.md` with the map inline, plus a Glossary **escape** entry — see Design Decision Rationale for the rejected alternatives.

---

## 4. HOW — Behaviour (page structure and content)

**Architecture.** One Markdown page under `docs/guide/`, following the house guide-page shape (front-matter/H1, a one-line "who this is for" + prerequisite link, task sections, cross-links). It is reachable from `docs/guide/intro.md`'s two routing surfaces. The page's sections map 1:1 to the enumerated topics.

**Section plan (the page's own headings, in order):**

```
PROCEDURE author_page(docs/guide/verify-run-evidence.md):
  1. Intro: who this is for (an operator who has completed a run), and a link to
     the Commissaire concept page as the prerequisite for the trust model.
  2. "Where your run's evidence lives" — the on-disk map table (live run dir,
     per-PR anchor, recovery bundle), each path annotated with what it holds.
  3. "Verify it" — run `faff commissaire audit verify --run-dir <dir> --json`;
     read pass/fail, the exit codes, and each JSON field; explain the
     unverifiable_without_secret bucket (own-run vs published-anchor difference).
  4. "When effects don't reconcile" — what a reconcile result is, and DEFINE an
     escape (link to the Glossary term).
  5. "Seal, export, anchor, and the bundle" — when/why an operator runs
     audit seal / audit export / audit anchor, and how the bundle relates to
     the per-PR anchor.
  6. "What verification does and does not prove" — the trust model in operator
     terms, reusing and LINKING the concept-page + governance-check prose.
  7. Cross-links: CLI reference row, governance-check guide, evidence spec,
     the worked external-verification example.
```

**Behaviour summary — the verify walkthrough.** The page shows the operator pointing `audit verify` at a directory and reading the result. It MUST make the own-run-vs-anchor distinction concrete:

```
PROCEDURE interpret_verify(target_dir):
  1. Point --run-dir at the target:
     - your own live/closed run:  .faff/runs/<run-id>
     - a per-PR anchor:           .faff/anchors/<run-id>/<issue>   (NOTE: the <issue> subdir)
  2. Read exit code first: 0 pass / 1 verification failure / 2 setup error.
  3. Read `result` and the two count blocks:
     a. commissaire_decisions.verified > 0, failed == 0  -> signed decisions authenticate.
     b. producer_claims: on YOUR run dir the symmetric key is present locally, so
        claims land in `verified`; on a PUBLISHED anchor only pk.json ships, so
        HMAC claims land in `unverifiable_without_secret` (NOT a failure — the
        Ed25519 decisions still verify).
  4. Any `failed` count > 0, or a non-empty `ledger_failures`, is a real tamper/
     structure signal -> stop and investigate; do not treat as noise.
```

**Anti-pattern:** citing the object-verb grammar's decision record by its ADR number, or any `FAFF-####` tag, in the page body. Why: `faff lint-refs` fails the `docs/guide/**` build on external-artifact refs — link to the concept/CLI pages instead.

**Anti-pattern:** restating the byte-level artifact schemas from `verification/evidence/` in the guide. Why: one-source-per-schema — link to the spec, summarise only what the operator needs to *locate and read* evidence.

**Anti-pattern:** presenting a `pass` as proof the run behaved correctly. Why: the runner holds the signing key co-located with the log, so a `pass` is tamper-evidence for a verifier, not proof of honesty — the whole point of section 6.

**Edge cases the page must name:**

- **`--run-dir` on an anchor points at the `<issue>` subdir**, not the anchor root — the root exits `2` (setup) because the schema:3 material lives one level down.
- **The live run dir has no chain-head file.** The `chain-head.json` / `effects-chain-head.json` witnesses are written into the *anchor*, not the live run dir. The page's map reflects this (a common misread the grounding itself carried).
- **The effect ledger is mixed-schema.** `declared-effects.jsonl` interleaves unsigned schema:2 governance-region records with signed schema:3 facade records; `audit verify` replays only the schema:3 subset. The page states this so an operator does not read the schema:2 lines as "unsigned = broken".
- **Chain-head status vocabulary** (for the integrity witness): the page links the reader to `verification/evidence/v0.2/anchor-integrity.md` rather than restating `verified | legacy-unverifiable | mixed | broken | witness-mismatch | witness-absent | malformed`.

**Failure modes — how this doc could be wrong, and how you'd notice.**

- **The failure:** the guide asserts faff's own runs are facade-signed for the merge effect, but a reviewer holds the positioning/Glossary wording that "faff's runner does not drive the facade". **How you'd know:** spec-review or a doc reviewer flags the contradiction; `faff commissaire audit verify` on a fresh run shows `commissaire_decisions.verified == 0`. **What it means:** the "runner's own merges" prose on the concept page is the authority to cite (it matches the live run — signed `effect-decision-verdict` records are present); if that section were removed, narrow the page to describe only what a current run emits and drop the merge-signing claim. See the Assumption below.
- **The failure:** a path or field in the on-disk map drifts from the live layout. **How you'd know:** the acceptance smoke (below) runs `audit verify` and lists a real run dir; a mismatch is visible immediately. **What it means:** correct the map against the live run before merge — the map is only useful if byte-accurate.

---

## 5. Scenarios — born-verifiable objectives

Non-holdout (this repo has no provisionable holdout environment for its own docs). Each scenario is checkable by a reviewer or a scripted doc-lint against the built tree.

```
Given a reader on the guide front door (docs/guide/intro.md)
When they scan the "Choose a path" section and the "All guide pages" table
Then a path/row for verifying and interpreting a completed run's evidence links
     to docs/guide/verify-run-evidence.md
```

```
Given the new page docs/guide/verify-run-evidence.md
When a reviewer reads it top to bottom
Then it contains, in order, an on-disk evidence map (live run dir + per-PR anchor
     + recovery bundle), an `audit verify` walkthrough (pass/fail, exit codes 0/1/2,
     the JSON fields, and the unverifiable_without_secret bucket), a reconcile/escape
     explanation, a seal/export/anchor + bundle-vs-anchor section, and a trust-model
     section that reuses and links the concept + governance-check prose
```

```
Given the new page is built under docs/guide/
When `faff lint-refs` runs over docs/guide/**
Then it reports no external-artifact refs on the new page (no FAFF-#### tag,
     no "ADR ####" citation, no numbered ADR-file pointer) and exits 0
```

```
Given docs/reference/GLOSSARY.md
When a reader looks up "escape"
Then a row defines it as an observed protected effect with no matching declared
     effect for its (issue, step), names `faff effects check` / `faff effects
     reconcile-merges`, and the guide page links to that row
```

- The on-disk map's paths and the `audit verify` field names MUST match a live governed run — verified by running `faff commissaire audit verify --run-dir <a-real-.faff/runs/run-*> --json` and diffing the documented fields against its output.
- The trust-model section MUST state that a `pass` is tamper-evidence for a verifier, not proof the runner was honest, because the runner holds the signing key co-located with the log.

---

## 6. Design Decision Rationale

**Page shape: one guide page, or a guide page plus a separate reference evidence-map page?**
- (a) One guide page, map inline — one operator journey, one landing place; the map is orientation ("where do I look"), not a schema.
- (b) Guide page + `docs/reference/` map page — cleaner separation, but fragments a single task and risks the map drifting from the walkthrough that reads it.
- (c) Fold into the concept or governance-check page — overloads pages with a different job.
- **Chosen:** (a) one `docs/guide/verify-run-evidence.md` with the map inline, plus the Glossary **escape** term. The reference-grade *schema* already lives in `verification/evidence/` and is linked; the guide holds only the locator map. This keeps the operator's "verify my run" journey on one page and honours one-source-per-schema.

**Where does "escape" belong — guide prose or the Glossary?**
- Guide-only: the reader never gets a stable lookup, and the term recurs (Sentry, reconcile, effects check).
- **Chosen:** a Glossary row (reference), linked from the guide. The acceptance criteria require the term in the Glossary, and the Glossary is the repo's single home for coined vocabulary.

**Which trust prose is authoritative for the "what verify proves" section?**
- Re-derive it fresh: invites a subtly weaker or stronger claim than the canonical one.
- **Chosen:** reuse and link the concept page's "The runner's own merges" caveat and the governance-check "conformance, not authenticity" boundary. The guide states the operator-facing version in one short paragraph and links the source. At the time of writing, the concept page's "runner's own merges" section documents the runner as a governed producer for the merge effect, which matches the live run's signed `effect-decision-verdict` records; the page is grounded there.

**Do we document the mixed-schema ledger and the missing run-dir chain-head?**
- Hide it (follow the grounding's simplified "signed schema:3 log" claim): the operator would misread schema:2 lines as broken and hunt for a chain-head file the live run dir never has.
- **Chosen:** document both explicitly. The ledger is mixed (schema:2 unsigned + schema:3 signed; `audit verify` replays the schema:3 subset), and the chain-head witnesses live in the anchor, not the live run dir. Grounded against real run directories.

---

## 7. Open Questions and Assumptions

**Open Questions.** None blocking.

**Assumptions.**

- **Assumes:** the concept page `docs/concept/execution-and-governance.md` still carries its "The runner's own merges" section describing the runner as a governed producer for the merge effect, and its trust-caveat paragraph. **Validate before starting:** open the file and confirm both are present; a live `faff commissaire audit verify --run-dir <a real .faff/runs/run-*> --json` should show `commissaire_decisions.verified > 0`. If the section has been removed or the run shows zero signed decisions, narrow the page to describe only what a current run emits and reconcile the wording with `docs/concept/positioning-and-language.md` before asserting merge-signing.
- **Assumes:** `faff lint-refs` continues to scan `docs/guide/**` and ban ticket/ADR refs. **Validate:** run `faff lint-refs` after drafting; it must exit 0 on the new page.
- **Assumes:** the guide's front-matter/link conventions (as used by sibling pages like `governance-check.md` and `intro.md`) are the house shape to follow. **Validate:** mirror an existing `docs/guide/` page's front-matter and cross-link style.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] A new operator-facing page exists at `docs/guide/verify-run-evidence.md`, task-oriented around "verify and interpret my completed run's evidence".
- [ ] The trust-model section reuses and links the concept-page + governance-check prose rather than re-deriving it.

### From WHAT / HOW (content — the enumerated topics)
- [ ] The page contains an on-disk evidence map covering the live run dir (`run-ledger.json`, `events.jsonl`, `declared-effects.jsonl`, `commissaire/governor/governor.json`, `commissaire/producer/pk.json`, `commissaire/producer/producers/<run-id>.json`, `<ISSUE>/` floor artifacts), the per-PR anchor (`.faff/anchors/<run-id>/<issue>/` incl. `chain-head.json` + `effects-chain-head.json` + byte-copies + public `pk.json`), and the recovery bundle.
- [ ] The page walks through `faff commissaire audit verify --run-dir <dir> --json`: it names the exit codes `0` pass / `1` verify-fail / `2` setup, and documents the JSON fields `version`, `result`, `governance_context`, `producer_claims` (`verified` / `unverifiable_without_secret` / `failed`), `commissaire_decisions` (`verified` / `failed`), `pk_fingerprint`, `ledger_failures`, and per-record `records`.
- [ ] The page explains `unverifiable_without_secret` as the own-run (secret present locally) vs published-anchor (public key only) difference — not a failure. (When illustrating this with a published-anchor example, ground it against an anchor whose schema:3 subset actually contains producer claims — otherwise the shown output reads `unverifiable_without_secret: 0` and undercuts the very point being made.)
- [ ] The page explains a reconcile result and defines an escape (linking the Glossary term).
- [ ] The page explains when/why an operator runs `audit seal` / `audit export` / `audit anchor`, and how the recovery bundle relates to the per-PR anchor.
- [ ] The page states the mixed-schema ledger (schema:2 unsigned + schema:3 signed; verify replays the schema:3 subset) and that the chain-head witnesses live in the anchor, not the live run dir.
- [ ] The page notes that `--run-dir` on an anchor points at the `<issue>` subdir.

### From WHAT (Glossary)
- [ ] `docs/reference/GLOSSARY.md` has an **escape** row defining an observed protected effect with no matching declared effect for its `(issue, step)`, naming `faff effects check` / `faff effects reconcile-merges`.
- [ ] The existing GLOSSARY **Commissaire** row's stale clause ("faff's own runner does not yet drive the facade (FAFF-1034)") is corrected to the current per-effect posture (FAFF-1034 shipped: the runner is a governed producer for the merge effect; other effects planned), so the glossary and the new guide page agree. This is a one-line fix folded in because this ticket already edits GLOSSARY.md; keep it `lint-refs`-clean (no `FAFF-####`/ADR tag in the row text — phrase it without the ticket number if the row is in a lint-scanned path, else match the row's existing citation style).

### From HOW (routing)
- [ ] `docs/guide/intro.md` links the new page from both the "Choose a path" section and the "All guide pages" table, so it is reachable from the guide front door.

### From HOW (constraints)
- [ ] `faff lint-refs` exits 0 over `docs/guide/**` (no ticket tags, ADR citations, or numbered ADR-file pointers on the new page).
- [ ] Product-name usage follows `docs/concept/positioning-and-language.md`: SuperDomestique / Commissaire for the product/governance system, `faff` for literal technical identifiers.
- [ ] The page respects the skill/authoring house standard: lean, skimmable, tables/bullets over prose walls; the term "load-bearing" appears nowhere (use central/blocking/deferrable).

**Integration smoke test (the "plumbing connected" path):**

```
PROCEDURE done_smoke():
  1. Build/serve the docs and open docs/guide/intro.md; click the new page's link
     from the "All guide pages" table -> lands on docs/guide/verify-run-evidence.md.
  2. On that page, follow the on-disk map to a real .faff/runs/run-* dir and run:
     faff commissaire audit verify --run-dir <that dir> --json
     -> the documented field names all appear in the output; exit code matches the
        page's 0/1/2 description.
  3. Follow the page's "escape" link -> lands on the GLOSSARY escape row.
  4. Run `faff lint-refs` -> exit 0.
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No issues. Three deliverables (the guide page, the Glossary `escape` row, two routing-table link insertions) but the Glossary row and routing edit have no standalone value: they exist only to make the guide page's own DoD true. That is the "small units that always ship together merge" case, not a split candidate. Splitting the page's own content was already rejected in the spec's rationale (it would fragment one operator journey and risk the map drifting from the walkthrough that reads it). One cohesive unit.

**Workstream fit?** No issues. Project-less in Backlog with one clear outcome (an operator can verify and interpret their own run's evidence). Forcing it under a shared "Commissaire docs" project with FAFF-1142 would be premature (two tickets is too thin a cluster, and the two serve different readers: operator self-check vs. external reuser).

**Deps surfaced?** No ordering issue — FAFF-1141 and FAFF-1142 are cleanly separable. FAFF-1141's `AuditVerifyResult` contract is grounded against a live run, not against any schema reference; its only schema-depth link is `verification/evidence/` (already-existing flight-recorder material), and it explicitly places the byte-level facade schemas (FAFF-1142's addition) out of scope. File sets do not collide (1141: `docs/guide/verify-run-evidence.md`, `docs/reference/GLOSSARY.md`, `docs/guide/intro.md`; 1142: `verification/` + a reuse doc). `relatedTo` with no `blockedBy` is correct. **One coherence risk, now folded in:** the GLOSSARY **Commissaire** row's "does not yet drive the facade (FAFF-1034)" clause is stale (FAFF-1034 shipped; a live run shows signed `effect-decision-verdict` records) and would contradict this ticket's new page; the fix is folded into this ticket's DoD (see From WHAT / Glossary) since it already edits that file.

**Risk profile?** No issues. The one Assumption (the concept page still documents the runner as a governed producer for merge) was validated directly: `docs/concept/execution-and-governance.md` carries the "runner's own merges" section (last touched by the FAFF-1034 landing), and a live run shows populated `commissaire_decisions` (signed verdicts + `accepted_under_contract`), not merely theoretical. Docs-only scope keeps runtime blast radius at zero, and the spec's Failure-modes section names the correct narrow-the-page fallback had it not held.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
