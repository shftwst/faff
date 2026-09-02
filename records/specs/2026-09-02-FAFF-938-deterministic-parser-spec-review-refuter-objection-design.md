# Deterministic parser for the spec-review refuter objection triple

> Spec: faffter-dark-nlspec · 2026-09-02 · autonomous · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-938.

> Revised on 2026-09-02 — spec-review (architectural lens, `revise`) corrected the clean-refutation input model: the reused `review-call.mjs` transport normalises every clean refutation to the canonical token `### observation: no findings` **before** exit 0 (and rewrites a mechanically-disproved gating section to an `[auto-refuted]` observation), so the parser's input is the transport's post-normalisation stdout, never the raw `refute-*.md` prompt output. Sections 3/4/5/7/8 and the test-fixture pin are updated accordingly. No other design decision changed. (Prior stamp: 2026-09-01.)

This spec addresses **FAFF-938**. Audience: the build agent implementing the change, and the human reviewers gating it. It describes a deterministic producer-boundary parser that converts each spec-review refuter's `### [severity]` objection block into JSON and fails loudly on a missing or malformed triple field, replacing today's unenforced prose-to-JSON convention.

## 1. WHY — Problem and Principles

**The load-bearing model.** In the L4 adversarial spec reviewer (`faffter-dark-spec-review`), each lens (architectural / infosec / methodology / QA) runs as an independent `review-call.mjs` pass that returns **markdown prose** — a `### [severity]: title` block per objection, with `- claim:` / `- evidence:` / `- predicted_consequence:` / `- spec_anchor:` bullets. Something has to turn that prose into the `objections[]` JSON that `aggregate.mjs` rolls up into the verdict. Today **nothing does** — there is no code between a refuter's stdout and the refutations JSON. The occupant's own prose (`SKILL.md`: "parse the refutation") tells an LLM to hand-build the JSON. That hand-parse is the seam this ticket closes with a deterministic parser.

**Problem statement.** FAFF-935 added the `{claim, evidence, predicted_consequence}` enrichment triple (FAFF-943 added `spec_anchor`) so a downstream judge can weigh a refuter's argued case, but each field is emitted as a prose bullet and captured by an unenforced convention — if a lens omits or malforms a field, the value is silently dropped at three points (`aggregate.mjs`'s `carryTriple`, `contract-defs.js`'s field-preservation loop, and `spec-judge-casefile.js`'s `argumentATriple`) with no error. This change makes producer-side emission of the triple **machine-guaranteed**: a deterministic parser extracts the fields and fails loudly when a gating objection is missing one, so a drifted refuter can no longer quietly ship a triple-less objection into the judge.

**Design principles.**

**Fail loud, fail safe — never silently approve.** A parse failure is the whole point of the ticket, not an inconvenience to route around. When the parser cannot extract a required field from a gating objection, the lens must surface as a human-fix outcome (`needs-human`), never as `clear`/`approve` and never by silently dropping the objection — a dropped objection can hide a blocker. This mirrors the existing "a down refuter never silently approves" discipline and `aggregate.mjs`'s existing "refuse to vote on an inconsistent set" fail-safe.

**Producer boundary, not contract boundary.** The `faff-contract:spec-review-verdict` contract deliberately keeps the triple **optional/additive/never-gating** (a legacy `{lens, severity}` objection must still validate). This ticket does **not** tighten the contract. The guarantee is established upstream, at the point the refuter's prose becomes JSON, so the contract's permissiveness is preserved and the judge downstream simply receives complete triples.

**Reuse the proven fail-safe floor; add no new gating path.** The severity→verdict roll-up in `aggregate.mjs` and the transport floor's `config-fault → needs-human` mapping are proven and unit-tested. Surface a parse fault through the existing `config-fault` floor rather than inventing a new verdict branch — a malformed refuter output is a producer/prompt drift a human must fix, not a transient the retry loop can ride out, so `config-fault` semantics (no retry, needs-human) fit exactly.

**Parse the transport's post-normalisation bytes, not the raw prompt output.** By the time the parser runs, `review-call.mjs` has already transformed the refuter's raw text: it **normalises every clean refutation** (`No <lens> objection.`, headed, or headed+signal) to the single canonical token `### observation: no findings` (`normaliseCleanRefutation` → `CANONICAL_NO_FINDINGS`, review-call.mjs:483/495–513), and it **downgrades a mechanically-disproved gating section** to an `[auto-refuted]` observation, re-titled `[auto-refuted] <title>` with a spliced `> auto-refuted: …` evidence line (`refuteFindings`, review-call.mjs:629–669, applied at :1731), before returning the rewritten string as exit-0 content (:1568). The parser therefore models the **exit-0 wire bytes**, and both its grammar and its test fixtures are pinned to that post-normalisation output — never to the raw `refute-*.md` prompt grammar, which diverges from the wire in exactly these two cases.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs` | Node (mjs) | Consumes the refutations JSON; `carryTriple` is one silent-degrade point. The new parser produces its input. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | prose | Documents the unenforced "parse the refutation" seam the parser replaces. |
| `plugin/skills/faffter-dark-spec-review/refute-{architectural,infosec,methodology,qa}.md` | prose | The pinned bullet grammar the refuter emits (`### [severity]` + `- claim:`/`- evidence:`/`- predicted_consequence:`/`- spec_anchor:`). NB this is the *raw prompt* grammar; the transport normalises it (clean → `### observation: no findings`; disproved gating → `[auto-refuted]` observation) before the parser sees it. |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (mjs) | Transport. `validateFindingsShape`/`normaliseCleanRefutation`/`refuteFindings` gate and rewrite refuter output before exit 0, so the parser only ever runs on shape-validated, post-normalisation content. `splitFindings` is prior art for section-splitting. Reused verbatim as a subprocess — **not forked, not imported**. |
| `plugin/skills/faff/bin/lib/spec-judge-casefile.js` | Node (js) | Downstream consumer; `argumentATriple` coerces a non-string triple field to empty/`not separately stated`. The parser's guarantee is what makes that coercion never fire on a real objection. |
| `test/spec-refute-aggregate.test.mjs`, `test/adversarial-call.test.mjs` | Node test | Existing coverage of the aggregation + transport surface; the new parser gets a sibling test file. |

**Scope statement.** This sits at the producer boundary of the `spec_review` slot's L4 occupant — between each refuter's `review-call.mjs` exit-0 stdout and `aggregate.mjs`'s verdict roll-up.

## 2. OUT OF SCOPE

- **Tightening the `spec-review-verdict` contract to require the triple.** Why excluded: the contract is the consumer boundary and is intentionally permissive so a legacy/degraded objection still validates; the guarantee belongs at the producer. Extension point: `plugin/skills/faff/contracts/spec-review-verdict.schema.json` + `computeSpecReviewVerdict` in `contract-defs.js`, if a future ticket ever decides the consumer should also enforce it.
- **Changing the refuter output format to fenced JSON.** Why excluded: prose emission is depended on by `review-bench` lenses, the `normaliseCleanRefutation` clean-sentinel path (FAFF-746), and the per-lens transcript; switching to fenced JSON is a far larger blast radius for no extra guarantee once a deterministic prose parser exists. Extension point: `review-call.mjs`'s `--expect contract` mode (FAFF-940) is the ready lever if that direction is ever revisited (see Design Decision Rationale).
- **Sharing the section-split grammar between the transport and the parser via a common library.** Why excluded: the parser is self-contained by choice (below); promoting `review-call.mjs`'s `splitFindings` into a shared `bin/lib/` module is a separable refactor. Extension point: `plugin/skills/faff/bin/lib/` (where `heading-slug.js` already lives as a shared, single-home rule) — do this only if the two grammars ever drift in practice.
- **Removing the vestigial `summary` field.** Why excluded: `summary` appears in `SKILL.md`'s documented Refutation shape and `aggregate.mjs`'s type comment but is absent from `TRIPLE_FIELDS`, the schema, and `carryTriple` — dead convention. Cleaning it is cosmetic and orthogonal. Extension point: the same `SKILL.md` shape block this ticket edits (fold in opportunistically only if it does not enlarge the review).
- **Validating `spec_anchor`'s slug format.** Why excluded: `spec_anchor` is optional (absence is a signal), and its canonical derivation is the refuter's job; format-validating it risks over-strict parks. Extension point: `bin/lib/heading-slug.js` exposes the canonical rule if a future ticket wants to assert the slug shape.
- **Changing `normaliseCleanRefutation` / `refuteFindings` themselves.** Why excluded: the transport's normalisation is the established exit-0 contract the parser consumes; this ticket adapts the parser *to* it, it does not alter it. Extension point: `review-call.mjs` if a future ticket ever revisits the clean/auto-refuted canonical forms.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Triple | The enrichment fields `{claim, evidence, predicted_consequence}` a refuter attaches to each objection (FAFF-935). |
| Gating objection | An objection whose severity is `critical`, `major`, or `minor` — i.e. it counts toward the verdict. `observation` is advisory and non-gating. |
| Parse fault | The parser could not extract a required triple field from a gating objection; surfaced as a fail-loud, human-fix outcome. |
| Clean refutation | A lens that raised nothing. On the **exit-0 wire** this is the transport's canonical single-observation token `### observation: no findings` (`CANONICAL_NO_FINDINGS`) — `normaliseCleanRefutation` has already rewritten the raw `## Refutation — <lens>` / `No <lens> objection.` form (and the methodology headed+signal form) to it before exit 0. |
| Auto-refuted section | A gating section whose syntax claim `refuteFindings` mechanically disproved; the transport re-titles it `[auto-refuted] <title>`, downgrades its severity to `observation`, and splices a `> auto-refuted: …` evidence line into its body — so it reaches the parser as a **non-gating observation**, not a gating objection. |

**The parser interface.** A new occupant-owned module `parse-refutation.mjs`, bundled beside `aggregate.mjs`, zero-dependency (node stdlib only), pure functions plus a thin stdin→stdout CLI — the same shape as `aggregate.mjs`.

```
FUNCTION parseRefutation(content: string, lens: Lens) -> RefutationEntry | ParseFault

RECORD RefutationEntry:            # the shape aggregate.mjs already consumes
  lens: Lens                       # one of architectural|infosec|methodology|QA (the caller supplies it)
  outcome: "refuted" | "clear"     # refuted iff >=1 gating objection parsed, else clear
  objections: [Objection]          # empty when clear
  model?: string                   # "provider/model", read verbatim from the transport header line

RECORD Objection:
  severity: "critical"|"major"|"minor"|"observation"
  claim: string                    # REQUIRED for a gating objection; non-empty after trim
  evidence: string                 # REQUIRED for a gating objection; non-empty after trim
  predicted_consequence: string    # REQUIRED for a gating objection; the literal "not separately stated" is a valid present value
  spec_anchor?: string             # OPTIONAL; carried only when present as a non-empty string; absence is the signal

RECORD ParseFault:                 # the fail-loud result (CLI: non-zero exit + stderr)
  lens: Lens
  severity: string                 # the offending section's severity
  title: string                    # the offending section's short title
  missing_field: "claim"|"evidence"|"predicted_consequence"
```

**CLI contract.** `parse-refutation.mjs --lens <lens>` reads one refuter's raw `review-call.mjs` exit-0 stdout on stdin and writes the `RefutationEntry` JSON on stdout with exit 0, OR writes a `ParseFault` diagnostic on stderr with a **non-zero exit** naming lens+severity+title+missing field. Exit-code discipline mirrors `aggregate.mjs`: `0` = parsed, non-zero = fail-loud (the caller treats it as `needs-human`, never `clear`).

**Required vs optional.** For every **gating** section (`critical`/`major`/`minor`), `claim`, `evidence`, and `predicted_consequence` must each be present with a non-empty trimmed value, or the parse fails loud. `spec_anchor` is optional. An **observation** section is parsed leniently — carried through for the transcript but not subject to the required-field check (observations never gate and never reach the judge, so a triple-less observation is not a fault). The canonical clean token `### observation: no findings` is itself a single observation section and so is never required-field-checked.

## 4. HOW — Behavior

**Architecture and approach.** The parser is a self-contained deterministic function. By the time it runs, the transport (`review-call.mjs`) has already returned exit 0, which means the content passed its `validateFindingsShape`/`normaliseCleanRefutation` gate and any `refuteFindings` downgrade — so the input is either findings-shaped (one or more `### [severity]` sections, some possibly `[auto-refuted]` observations) or the canonical clean token `### observation: no findings`. The parser splits sections on `### ` headings, classifies each section's severity from its heading, extracts the triple bullets from each section body, enforces the required-field rule on **gating** sections only, and assembles the `RefutationEntry`. The occupant runs it once per exit-0 lens in place of the old hand-parse, then feeds the resulting array to `aggregate.mjs` exactly as before.

```
PROCEDURE parseRefutation(content, lens):
  1. sections := split content on lines matching /^###\s(?!#)/, capturing each section's body
  2. IF the only section is the canonical clean token `### observation: no findings`
     (equivalently: no gating section is present):
     a. RETURN { lens, outcome: "clear", objections: [], model: headerModel(content) }
     (a clean refutation is this exact single non-gating observation section — the transport
      guarantees this canonical form on exit 0; there is no `No <lens> objection.` on the wire)
  3. objections := []
  4. FOR each section:
     a. severity := match heading against /^\[?(critical|major|minor|observation)\]?\s*[:—-]/i
        (an `[auto-refuted]` section normalises to severity `observation` — it is non-gating;
         a section whose heading names no known severity is itself a fail-loud — a shape the
         shape-gate should already have rejected)
     b. fields := parseBullets(section.body)   # see below
     c. IF severity in {critical, major, minor}:   # gating — enforce the triple
          FOR field in [claim, evidence, predicted_consequence]:
            IF fields[field] is absent OR trim(fields[field]) == "":
              FAIL LOUD -> ParseFault { lens, severity, title, missing_field: field }
     d. obj := { severity, claim, evidence, predicted_consequence } from fields
        IF fields.spec_anchor present and non-empty: obj.spec_anchor := fields.spec_anchor
        (an observation — including an [auto-refuted] one — carries whatever triple fields are present, unchecked)
     e. objections.append(obj)
  5. outcome := "refuted" IF any objection is gating (severity in {critical,major,minor}) ELSE "clear"
  6. RETURN { lens, outcome, objections, model: headerModel(content) }

PROCEDURE parseBullets(body):
  # A bullet is a line "- <key>: <value>". A value runs from after the colon up to (but not
  # including) the next recognised "- <key>:" bullet or the next "###"/"##" heading, then trimmed —
  # so a naturally wrapped multi-line value is captured deterministically without a greedy match.
  # NB the transport's spliced "> auto-refuted:" line is a blockquote, not a "- <key>:" bullet, so
  # it is naturally ignored by the bullet grammar (it neither starts nor terminates a triple value).
  1. fields := {}
  2. FOR each line matching /^-\s*(claim|evidence|predicted_consequence|spec_anchor)\s*:\s*(.*)$/i (case-insensitive key):
     a. key := lowercased matched key
     b. value := matched remainder, plus any following non-bullet, non-heading lines, joined and trimmed
     c. fields[key] := value   # last wins if a key repeats (a malformed double-bullet)
  3. RETURN fields
```

**How the occupant consumes it (`SKILL.md` change).** Replace the prose "parse the refutation" instruction (the per-lens outcome table's exit-0 row, and the "parsed from the lens's `### [severity]` block" note) with: for each exit-0 lens, run `parse-refutation.mjs --lens <lens>` on that lens's stdout.
- Parser exit 0 → use its `RefutationEntry` verbatim as that lens's entry in the refutations array.
- Parser non-zero exit → that lens is a **parse fault**: record it as `{ lens, outcome: "unavailable", kind: "config-fault" }` (no objections) so `aggregate.mjs`'s existing transport floor rolls the pass up to `needs-human` naming the lens, and write the parser's stderr diagnostic into the per-lens transcript (`round-<n>-<lens>.md`) so the audit trail distinguishes a parse fault from a real config fault.

**Behaviour summary — verdict roll-up.** With every gating objection now carrying a complete triple by construction, `aggregate.mjs` is unchanged: `carryTriple` still carries the fields verbatim (they are present strings), the severity/majority gate is untouched, and the emitted verdict for any given refutation set is byte-identical to today's. The only new behaviour is the fail-loud on a malformed producer.

**Edge cases and error handling.**
- **`predicted_consequence: not separately stated`** — the taste-level sentinel is a present, non-empty value → no fault. Carried verbatim (it already flows through today).
- **Clean refutation** — arrives as the canonical single-observation token `### observation: no findings` → the parser detects the no-gating-section case → `outcome: "clear"`, empty objections, no required-field check. (There is no `No <lens> objection.` on the exit-0 wire; the transport already normalised it.)
- **Auto-refuted gating section** — the transport downgraded it to an `[auto-refuted]` observation with a `> auto-refuted:` blockquote; the parser classifies it as `observation`, carries it for the transcript unchecked, and `aggregate.mjs` drops it in the roll-up. Not a fault.
- **Observation-only lens** → parsed, carried for the transcript, dropped by `aggregate.mjs` in the roll-up as today; a triple-less observation is **not** a fault.
- **`spec_anchor` absent** → objection valid; **present but empty string** → treated as absent (not carried); **present non-empty** → carried.
- **A gating section whose heading names no known severity** → fail loud (should be unreachable: the transport shape-gate rejects it pre-exit-0, but the parser does not assume that silently).
- **Parser CLI cannot read stdin / unparseable invocation** → non-zero exit (fail-loud), treated as a parse fault by the caller — never a silent pass.

**Failure modes.**
- **The failure:** the parser's bullet grammar drifts from what the transport's exit-0 stdout actually emits — e.g. a lens writes `Claim —`, or a value splits across an unexpected shape, or a future change to `normaliseCleanRefutation`/`refuteFindings` alters the canonical clean/auto-refuted forms — so a *well-formed-in-spirit* objection fails to parse and the lens false-parks as `needs-human`. **How you'd know:** a rise in `spec-review` `needs-human` parks whose transcript shows a complete-looking objection the parser rejected. **What it means:** proceed, but **pin the parser's test fixtures to the transport's actual exit-0 stdout** — feed `parse-refutation`'s tests through `review-call.mjs`'s post-normalisation output (clean → `### observation: no findings`; a disproved gating section → `[auto-refuted]` observation), not the raw `refute-*.md` prompt grammar — so a normalisation change is caught by a failing parser test rather than a silent false-park. Keep the grammar tolerant of a wrapped multi-line value. If drift proves common, narrow toward the fenced-JSON option (OUT OF SCOPE extension point).
- **The failure:** failing the **whole lens** on one malformed objection is too blunt — a lens that raised three good objections and one malformed one parks the spec instead of grading the three. **How you'd know:** transcripts showing a parked pass where most objections were well-formed. **What it means:** this is the deliberate fail-safe (a silently-dropped objection can hide a blocker, and the ticket asks for loud failure), but it is the first thing to revisit if false-parks appear — a future refinement could fail only the malformed objection while still refusing to drop it silently.

**Anti-pattern:** silently dropping a malformed field and continuing. Why: that is exactly today's behaviour this ticket removes; the guarantee only exists if a missing field is loud.
**Anti-pattern:** importing or forking `review-call.mjs` to reuse `splitFindings`. Why: the transport is reuse-verbatim-as-subprocess only; the parser owns its own self-contained section grammar (kept honest by a fixture test against the transport's exit-0 stdout), avoiding an unprecedented cross-skill runtime import.
**Anti-pattern:** pinning the parser's grammar or test fixtures to the raw `refute-*.md` prompt output. Why: the transport normalises clean and auto-refuted sections before exit 0, so the raw prompt grammar is not the bytes the parser parses.
**Anti-pattern:** routing a parse fault to `approve` or to a silent `clear`. Why: a malformed producer is never evidence the spec is sound; the fail-safe direction is `needs-human`.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an exit-0 refuter output whose `### major:` objection omits the `- predicted_consequence:` bullet
When parse-refutation.mjs runs for that lens
Then it exits non-zero, names lens+severity+missing field `predicted_consequence` on stderr,
  and the occupant records the lens as unavailable/config-fault so the pass rolls up to needs-human (never clear/approve)
```

```
Given an exit-0 refuter output with one `### major:` objection carrying complete claim/evidence/predicted_consequence bullets
When parse-refutation.mjs runs for that lens
Then it exits 0 and emits { lens, outcome: "refuted", objections: [{ severity, claim, evidence, predicted_consequence }] },
  and piping that entry through aggregate.mjs yields the same verdict as the pre-parser hand-built entry did
```

```
Given a gating objection whose predicted_consequence is the literal "not separately stated"
When parse-refutation.mjs runs
Then it exits 0 and carries predicted_consequence verbatim — the sentinel is a present value, not a missing field
```

- The parser introduces **no** change to `aggregate.mjs`'s verdict for any refutation set that already carried complete triples (regression assertion against the existing aggregate tests).

## 6. Design Decision Rationale

**How is the triple's emission guaranteed — deterministic prose parser, or a required fenced-JSON refuter output?**
- *Deterministic prose parser* — keep the refuters emitting prose; add code that extracts the triple and fails loud. Pros: minimal blast radius; keeps `review-bench`, the clean-sentinel path, and the per-lens transcript unchanged; aligns with the "deterministic-tools-over-prose" tenet already in `aggregate.mjs`. Cons: prose is fuzzier to parse than JSON; the grammar must be pinned to the transport's exit-0 output.
- *Required fenced-JSON refuter output* — refuters emit a fenced JSON block, run under `--expect contract` (FAFF-940), validated fail-loud. Pros: structurally unambiguous. Cons: rewrites all four prompts, breaks the `review-bench` lenses and the FAFF-746 clean-refutation/`No <lens> objection.` path, and LLMs emit strict JSON less reliably under adversarial free-reasoning than they emit prose.

**Chosen:** the deterministic prose parser — it delivers the same producer-boundary guarantee at a fraction of the blast radius, and the ticket's own primary phrasing leads with it. The fenced-JSON option is retained as a documented extension point (OUT OF SCOPE) if grammar drift ever proves common.

**Where does the parser live, and how does it reuse the section-split grammar?**
- *Import `splitFindings` from `review-call.mjs`* — one grammar home, but an unprecedented cross-skill runtime import (the occupant only ever calls the transport as a subprocess), fragile under the symlink install (FAFF-813 realpath).
- *Promote the grammar to a shared `bin/lib/` module* — cleanest single home, but touches the transport file and enlarges the diff beyond this chain-gap-fill.
- *Self-contained parser beside `aggregate.mjs`* — its own small section+bullet grammar, kept honest by a fixture test that feeds the exact bytes the transport emits on exit 0.

**Chosen:** a self-contained `parse-refutation.mjs` beside `aggregate.mjs` — no transport touch, no cross-skill import, lowest blast radius; the shared-library refactor is the named extension point if the two grammars ever drift.

**What is the parser's input — the raw `refute-*.md` prompt output, or the transport's exit-0 stdout?**
- *Raw prompt output* — matches the four prompts' documented Output-format sections, but is **not** what crosses the boundary: `review-call.mjs` normalises clean refutations to `### observation: no findings` and downgrades disproved gating sections to `[auto-refuted]` observations before exit 0.
- *Transport exit-0 stdout* — the actual bytes the occupant pipes into the parser.

**Chosen:** the transport's exit-0 stdout. Both the grammar (clean = the canonical `### observation: no findings` token; `[auto-refuted]` = a non-gating observation) and the test fixtures are pinned to it. This is the correction the spec-review architectural lens raised: pinning to the raw prompt grammar would leave the clean branch as dead code and mis-model the boundary the ticket exists to guarantee.

**How does a parse fault surface in the verdict?**
- *A new `parse-fault` outcome/branch in `aggregate.mjs`* vs *reuse the existing `config-fault → needs-human` transport floor*.

**Chosen:** reuse the `config-fault` floor. A malformed refuter output is a producer/prompt drift a human must fix (not a transient the retry/hold loop rides out), so `config-fault` semantics — `needs-human`, no retry — are exactly right; the parse-vs-config audit distinction is preserved in the per-lens transcript. Rejected the new branch: it adds a gating code path whose routing is identical to `config-fault` for no behavioural gain.

**Should a malformed objection fail the whole lens or just that objection?**
**Chosen:** fail the whole lens (loud, at the first missing field). Rationale: silently dropping the malformed objection is the exact regression being removed, and a dropped objection can hide a blocker; failing the lens to `needs-human` is the fail-safe direction the gate already uses. Documented in Failure modes as the first thing to revisit if false-parks appear.

## 7. Open Questions and Assumptions

**Open Questions:** none — every decision above is closed.

**Assumptions.**
- **Assumes:** `review-call.mjs` returns exit 0 only for content that has passed `validateFindingsShape`/`normaliseCleanRefutation` (and any `refuteFindings` downgrade), so the parser never sees garbled/empty content and always sees the post-normalisation forms (clean = `### observation: no findings`; disproved gating = `[auto-refuted]` observation). *Validation:* read `review-call.mjs`'s exit-0 return path (`normalisation.content` at :1568) and confirm the shape-gate + normalisation precede it; confirm `test/adversarial-call.test.mjs` covers the garbled→non-zero and the clean→canonical-token mappings.
- **Assumes:** all four `refute-<lens>.md` prompts emit the identical `### [severity]` + `- claim:`/`- evidence:`/`- predicted_consequence:`/`- spec_anchor:` raw bullet grammar (confirmed at authoring time), which the transport then normalises. *Validation:* diff the four prompts' "Output format" sections; build the parser test fixtures from `review-call.mjs`'s exit-0 stdout (the post-normalisation bytes), not the raw prompt text, so the two can never drift silently.
- **Assumes:** the transport prepends a `## Adversarial findings — <provider>/<model> …` header on exit-0 stdout, from which `model` is read. *Validation:* confirm the header guarantee in `faffter-dark-adversarial-review/SKILL.md` ("The header is harness-authored").

## 8. DONE — Definition of Done

### From WHY
- [ ] A gating objection missing any of `claim`/`evidence`/`predicted_consequence` no longer ships silently: the parser fails loud and the lens surfaces `needs-human`.
- [ ] The `spec-review-verdict` contract, schema, and `computeSpecReviewVerdict` are unchanged (the guarantee is producer-side only).

### From WHAT (types and interfaces)
- [ ] `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs` exists, zero-dependency, exporting a pure `parseRefutation(content, lens)` plus a thin `--lens` CLI reading stdin.
- [ ] On success the CLI emits a `RefutationEntry` (`{ lens, outcome, objections[], model? }`) on stdout with exit 0.
- [ ] On a gating objection with a missing/empty required field the CLI exits non-zero and names lens+severity+title+missing field on stderr.
- [ ] `spec_anchor` is optional and carried only when present as a non-empty string; an empty-string anchor is treated as absent.

### From HOW (behaviour)
- [ ] `outcome` is `refuted` iff ≥1 gating objection is parsed, else `clear`.
- [ ] `predicted_consequence: "not separately stated"` is accepted as present (no fault) and carried verbatim.
- [ ] A clean refutation — the transport's canonical `### observation: no findings` token on the exit-0 wire — parses to `{ outcome: "clear", objections: [] }` with no required-field check.
- [ ] An `[auto-refuted]` downgraded section is classified as a non-gating observation, carried without the required-field check, and dropped by `aggregate.mjs` in the roll-up.
- [ ] An observation-only section is carried without the required-field check and dropped by `aggregate.mjs` in the roll-up.
- [ ] A multi-line (wrapped) bullet value is captured up to the next bullet/heading and trimmed; the spliced `> auto-refuted:` blockquote line neither starts nor terminates a triple value.

### From HOW (occupant wiring)
- [ ] `faffter-dark-spec-review/SKILL.md` replaces the prose "parse the refutation" instruction with running `parse-refutation.mjs` per exit-0 lens.
- [ ] A parser non-zero exit is recorded as that lens's `{ outcome: "unavailable", kind: "config-fault" }`, rolling the pass up to `needs-human` via the existing transport floor, with the parser stderr written to the per-lens transcript.

### From HOW (regression)
- [ ] For any refutation set that already carried complete triples, `aggregate.mjs`'s emitted verdict is byte-identical to before this change (asserted against the existing aggregate tests).

### Eval coverage
- [ ] No LLM-judgement seam is introduced — the parser is deterministic — so no grader/eval-case registration is required. (The refuter prompts remain the judged seam; unchanged here.)

### Integration smoke test
```
PROCEDURE smoke():
  1. Feed parse-refutation.mjs --lens architectural a fixture built from review-call.mjs's exit-0 stdout
     with one complete `### major:` objection on stdin
  2. Assert exit 0 and stdout JSON has objections[0].{claim,evidence,predicted_consequence} populated
  3. Feed the same fixture with predicted_consequence removed
  4. Assert non-zero exit and stderr names `predicted_consequence`
  5. Feed the transport's canonical clean token `### observation: no findings`; assert exit 0, outcome clear, objections []
  6. Pipe the exit-0 refuted entry (as a one-element array with --n 1) through aggregate.mjs and assert a founded verdict block emits
```

confidence: high
spec-review: approve (faffter-dark-spec-review, L3 single-pass, lenses architectural/infosec/QA; round 2 after one revise; 2026-09-02)

## Methodology critique

_Agile-delivery lens (`issue-critique`). Advisory — does not gate promotion._

- **Right-sized?** No issues. One cohesive 1–3 day unit: a single new zero-dep module (`parse-refutation.mjs`) plus its occupant wiring and tests. Not two separable concerns (the parser and its wiring always ship together), so no split; not a merge candidate either. The `build-tier: complex` classification reflects the care the fail-loud/fail-safe seam needs, not a size problem.
- **Workstream fit?** No issues. Sits squarely in the spec-review hardening chain (FAFF-935 triple carry-through → FAFF-943 spec_anchor → FAFF-930 judge), turning that chain's additive enrichment into a machine-guaranteed producer boundary. Outcome-named and cohesive.
- **Deps surfaced?** No issues. Related to FAFF-935 and FAFF-943, both **Done** — the triple and anchor the parser enforces already exist, so the dependency is satisfied and correctly not a blocker link. No implicit unsurfaced dependency.
- **Risk profile?** Low. Deterministic parser, no external dependency, reuses the proven `aggregate.mjs` roll-up and the `config-fault → needs-human` transport floor (no new gating path). The one real risk — the parser's bullet grammar drifting from the transport's exit-0 stdout — is de-risked in-spec by pinning the parser's test fixture to `review-call.mjs`'s post-normalisation output. No de-risking spike warranted.
