# FAFF-910: Record a ratified spec-level tradeoff the adversarial spec-review gate honours
> Spec: faffter-dark-nlspec · 2026-08-28 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-910.


This spec is for the build agent wiring human-ratified spec-level tradeoffs into the L4 adversarial spec-review gate, and for the humans who ratify those tradeoffs. It addresses FAFF-910: a spec can accept and explain a tradeoff, but nothing records that acceptance where the adversarial refuters read it on a later round, so a refuter re-raises the same objection every round. This revision reconciles FAFF-910 with FAFF-907 (the ratified-scope deferral in the spec-review design lenses), which is now merged to main.

## 1. WHY: problem and principles

**The core mechanism.** FAFF-907 already ships the honouring machinery: when a `## Ratified scope` block is in a design lens's context, the lens demotes a would-be objection that only restates a settled scope to an `observation`, and `aggregate.mjs` already drops observations before it computes severity or majority. What FAFF-907 does not have is a way for a human to add a settled spec-level tradeoff to that block. FAFF-910 supplies exactly that: a new durable, human-ratified register entry kind, rendered into the same `## Ratified scope` block FAFF-907's lenses already defer to. FAFF-910 adds no second honouring path; it feeds the one that ships.

**Problem statement.** Today the enabled lenses run as independent refuters and neither the refuter prompts nor the deterministic roll-up receive a settled spec-level tradeoff, so a refuter repeats an objection a human already accepted and the repeated objection can still force `reject-approach`. FAFF-907 closed this for PRD non-goals and settled precedents, but a spec-level tradeoff a human accepts mid-review has nowhere to be recorded. This change adds a validated `ratified_tradeoff` entry to the decisions register and renders it into the ratified-scope block, so a later round sees the acceptance instead of re-raising the objection.

**Design principles.**

- **One durable home, one honouring path.** `docs/decisions.md` holds both existing precedent entries and the new ratified-tradeoff entries; `faff ratified-scope --assemble` renders both into the block FAFF-907's lenses read. FAFF-910 adds no `Covers:` refuter clause and no `aggregate.mjs` suppression layer. Two competing "defer" clauses in the same refuter prompts is the FAFF-878 collision (two rules fighting over one seam); the reconciliation keeps a single defer clause, FAFF-907's.
- **Human authority in v1.** A v1 tradeoff is honourable only when `Ratified-by` is exactly `human`. No review loop or CLI gains a register write path. FAFF-922 (the future deterministic admit gate for loop-authored decisions) is named as the extension point for loop provenance.
- **Durable audit is git, not a hash.** The durable record of what was accepted and against which spec version is two committed things: the `docs/decisions.md` entry, and the graft commit that lands that entry alongside `docs/specs/…-design.md` in one branch. There is no content digest in v1 (see the rationale section). A hash proves byte-integrity, never that a spec is still consistent with the decision.
- **Re-read every round; honour with no PRD.** FAFF-907 assembles the block once at loop entry and only under an L4 run with a resolved PRD container. FAFF-910 requires a tradeoff ratified after round one to be visible in round two of the same run, and requires honouring with no PRD at all. The ratified-scope block is therefore re-assembled at the start of every round, and the register tradeoffs assemble independent of any PRD container.
- **Deferral stays soft and non-halting.** FAFF-910 changes nothing about FAFF-907's deferral shape: two outcomes only (a cited observation, or pass-through), never a human halt, and a `critical` is never deferred by any lens.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/decisions.js` | Node.js | Register parser/validator/matcher; gains the `ratified_tradeoff` kind, its validation, and a `listRatifiedTradeoffs` reader |
| `plugin/skills/faff/bin/lib/ratified-scope.js` | Node.js | `assemble()`/`render()`/`validate()` for the `## Ratified scope` block; extended to render validated human ratified tradeoffs into it |
| `plugin/skills/faff/bin/lib/fields.js` | Node.js | Shared `readField`; blank and absent both return `null`, so the `Ratified-by:` discriminator needs a separate lexical-presence check |
| `docs/decisions.md` | Markdown | Durable register holding both precedent and ratified-tradeoff entries |
| `plugin/skills/faff-prep/SKILL.md` | Skill prose | Owns the review loop and scratch dir; FAFF-907's once-at-loop-entry ratified-scope assembly moves to the round-loop seam (start of each iteration, immediately before `faff inflightcheck --open`), runs unconditionally, and stops discarding assemble warnings |
| `plugin/skills/faffter-dark-spec-review/SKILL.md`, `refute-architectural.md`, `refute-infosec.md`, `refute-qa.md` | Skill prose | FAFF-907's "Defer to ratified scope" path this work reuses unchanged |
| `docs/guide/cli.md` | Markdown | `decisions` and `ratified-scope` CLI reference to update for the new kind |

**Scope statement.** This change sits at the spec-to-build admission seam and adds a second decisions-register consumer beside the existing precedent matcher, feeding entries into the ratified-scope block FAFF-907 already renders and defers to.

## 2. Out of scope

- **A parallel honouring path in the reviewer.** Excluded: a `Covers:` refuter clause, an `aggregate.mjs --ratified` flag, or any deterministic suppression layer added by FAFF-910. Why: FAFF-907 already honours the block by demoting covered objections to observations, which `aggregate.mjs` already drops; a second defer mechanism is the FAFF-878 collision. Extension point: none; honouring stays FAFF-907's.
- **A spec-revision digest / content hash.** Excluded: a `Spec-revision: sha256:…` field, any `faff integrity-digest hash` wiring, and any graft-time verify-and-refuse step. Why: the spec is a moving target across review rounds, so no single entry's whole-spec hash can equal the finally-committed spec, and a byte hash never proves consistency. The decision-to-spec-version binding is git's (the graft commit). Extension point: none.
- **Loop-authored ratification.** Excluded: accepting or honouring `Ratified-by: loop`. Why: v1 has no deterministic admit gate for loop provenance. Extension point: FAFF-922's admit gate admits loop-authored decisions before validation may accept them.
- **Automatic scope/topology expiry.** Excluded: comparing a stored `Scope` against the current spec or deployment topology. Why: this is the **human-ratified v2 deferral, settled** in this ticket's design, v1 records scope and defers enforcement, deliberately, not by omission. v1's mitigation is the mandatory per-entry assemble-time warning plus human PR review of every entry's `Scope`; the accepted residual is that a stale-scope honourable tradeoff is still honoured until v2, a known human-visible limit. Extension point: a v2 scope matcher filters the assembled tradeoffs, stopping expired entries from rendering.
- **Durable per-round suppression audit.** Excluded: a committed, per-round record of which objection was demoted. Why: the demotion event is an ephemeral `.faff/` breadcrumb (FAFF-907's `$pin_dir/round-<n>-<lens>.md` per-lens transcript plus the prep log), not a durable artifact. Extension point: none; the durable audit is the register entry and the graft commit.
- **Changing FAFF-907's PRD-non-goals assembly.** Excluded: altering how PRD non-goals or settled precedents already render into the block. Why: FAFF-910 composes with FAFF-907's shipped code; it adds a tradeoffs subsection and moves the assembly cadence, it does not rewrite the non-goals half. Extension point: none.
- **Tracker-topology mutation.** Excluded: removing or changing the tracker snapshot's FAFF-907 blocking edge. Why: the edge is already satisfied (FAFF-907 is Done); this spec records the product decision but does not mutate tracker state. Extension point: ordinary tracker reconciliation outside this build.
- **Migration of precedent entries.** Excluded: backfilling `Ratified-by` or the new fields onto existing precedent entries. Why: precedents keep their current schema and consumer. Extension point: none; both kinds coexist.

## 3. WHAT: vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Ratified tradeoff | A human-authored `docs/decisions.md` entry recording a settled spec-level choice, its rationale, its scope, and its source issue, discriminated by a `Ratified-by:` field line |
| Precedent entry | The existing `Chosen`/`Rationale`/`Scope`/`Matches`/`Date` entry kind consumed by `matchDecision` |
| Citation ID | The kebab slug derived from an entry's `##` topic heading by `kebabSlug`; unique across both entry kinds |
| Ratified-scope block | The `## Ratified scope` markdown block `faff ratified-scope --assemble` emits and FAFF-907's design lenses defer to |
| Honourable tradeoff | A `ratified_tradeoff` entry that passes validation and carries `Ratified-by: human`; only these render into the block |

### Register entry shapes

The raw presence of a `Ratified-by:` field line discriminates a tradeoff entry, even when its value is blank.

**Where the discriminator lives, and why it cannot drift.** The kind tag is computed in `listEntries` (decisions.js), on the **same field-line grammar `readField` already parses**, not a second grammar. `readField` matches `^[\s>*-]*<name>[ \t*]*:[ \t*]*([^\s*].*)$` (flags `mi`, `fields.js`): a leading list/bold marker class, the field name, a mandatory colon, then a value capture. The discriminator reuses that identical field-line head, `^[\s>*-]*Ratified-by[ \t*]*:`, and differs from `readField` in exactly one respect: it tests **presence of the field line**, not presence of a non-blank value, so it drops only the trailing `([^\s*].*)` value requirement. Because the discriminator is the same leading-marker-plus-mandatory-colon matcher `readField` uses, it recognises every bold/colon arrangement `readField` tolerates (`- **Ratified-by:** v`, `- Ratified-by: v`) and cannot fork into a divergent second grammar. There is no separate bold `- **Ratified-by:**`-only variant. This presence-vs-value split is why a blank `Ratified-by:` is a malformed tradeoff and never a fall-through to precedent: `readField`'s intentional contract maps both absent and blank values to `null` (its FAFF-850 fix, `fields.js`), so a value read alone could not tell "no such line" from "line present, value blank", the presence check on the shared grammar supplies that distinction.

```
ENUM DecisionEntryKind:
  precedent
  ratified_tradeoff

RECORD RatifiedTradeoffEntry:
  kind: ratified_tradeoff       # derived from lexical presence of a Ratified-by: field line
  topic: string                 # text of the ## heading
  id: CitationId                # kebabSlug(topic), unique across all entries
  chosen: string                # accepted tradeoff; required, non-empty
  rationale: string             # human rationale; required, non-empty
  scope: string                 # scope/topology at ratification; required, non-empty
  source_issue: string          # required; MATCHES /^[A-Z]+-\d+$/
  ratified_by: "human"          # required; only accepted v1 value
  date: string                  # required, non-empty
  matches: List<string>         # optional; never used by matchDecision for this kind

  CONSTRAINT source_issue MATCHES /^[A-Z]+-\d+$/
  CONSTRAINT ratified_by == "human"   # "loop" is refused, naming FAFF-922; blank is malformed

RECORD PrecedentEntry:
  kind: precedent               # no Ratified-by: field line
  topic: string
  id: CitationId
  chosen: string                # existing required fields unchanged
  rationale: string
  scope: string
  matches: non-empty List<string>
  date: string
  adr: optional string
```

There is deliberately no `spec_revision` / digest field on either kind.

`matchDecision(entries, punt)` considers only `kind == precedent`, even if a tradeoff entry happens to declare an optional `Matches`. Its normalized full-equality matching, ambiguity handling, and return shape are unchanged.

### Validation and the ratified-tradeoff reader

`validateEntries` branches by the lexically detected kind:

- A ratified tradeoff requires `Chosen`, `Rationale`, `Scope`, `Source-issue`, `Ratified-by`, and `Date`; validates `Source-issue` against `^[A-Z]+-\d+$`; accepts only `Ratified-by: human`; and permits an absent `Matches`.
- A blank `Ratified-by:` is a malformed tradeoff and never falls through to precedent validation.
- `Ratified-by: loop` fails with a message naming FAFF-922 as the future admit gate.
- A precedent keeps today's requirements, including a non-empty `Matches`.
- Citation-ID uniqueness stays global across both kinds.

`decisions.js` exports a reader `listRatifiedTradeoffs(root)` that `ratified-scope.js` consumes. It returns only fully valid `ratified_tradeoff` entries whose `ratified_by` is `human`; malformed or `loop` entries are never honourable. An absent register is a clean empty list.

```
RECORD HonourableTradeoff:
  id: CitationId
  topic: string
  chosen: string
  scope: string
  source_issue: string
  ratified_by: "human"

FUNCTION listRatifiedTradeoffs(root) -> List<HonourableTradeoff>:
  entries := listEntries(root)          # now tagged with kind
  return entries
    FILTER entry.kind == ratified_tradeoff
    FILTER validateTradeoff(entry) has no problems
    FILTER entry.ratified_by == "human"
    MAP to HonourableTradeoff
```

`listEntries` gains a `kind` field on every returned entry (derived from the lexical `Ratified-by:` check) so both `matchDecision` and the reader can filter by kind. The `decisions` CLI stays read-only: `validate` and `list` become kind-aware (validate applies the right rules per kind); no new write verb is added. Update the declared surface, usage text, tests, and `docs/guide/cli.md` for the new kind.

**`decisions list` output shape (pinned, additive).** Today `faff decisions list --json` emits one object per entry with fields `{ id, topic, chosen, date }`, and the text form prints `<id>  <chosen>  <date>` per line. The change is **additive**:

- `--json`: each object gains a **`kind`** field (`"precedent"` or `"ratified_tradeoff"`); the existing `id`/`topic`/`chosen`/`date` fields are unchanged in name, order-of-population, and value for precedent entries.
- text form: **unchanged**, it keeps the `<id>  <chosen>  <date>` line shape and does not print `kind` (a ratified tradeoff lists under the same three columns).

Existing precedent-entry output is therefore byte-identical in the text form and gains only the additive `kind` key in `--json`. This pins the `list` surface the same way `matchDecision`'s return shape is pinned unchanged: `matchDecision` still returns `{ id, chosen, rationale, scope }` (or `{ match: null }`), never a `kind` field, because it considers precedents only.

### Rendering a tradeoff into the ratified-scope block

`ratified-scope.js`'s `assemble()` already reads `listEntries(root)` and renders every entry with a non-empty `Scope` under `### Settled precedents (docs/decisions.md)`. That loop must now branch by kind: precedent entries keep rendering under settled precedents; honourable tradeoffs (via `listRatifiedTradeoffs`) render under a new `### Ratified tradeoffs (docs/decisions.md)` subsection so a design lens has a concrete settling line to cite.

```
### Ratified tradeoffs (docs/decisions.md)

- **<topic>** (`<id>`)
  - Chosen: <chosen>
  - Scope: <scope>
  - Source-issue: <source_issue>  ·  Ratified-by: human
```

- `assemble()`'s exit-3 condition (nothing ratified) widens: exit 0 when there is a PRD non-goals section OR ≥1 scoped precedent OR ≥1 honourable tradeoff; exit 3 only when all three are empty.
- `validate()` (the shape check) must recognise `### Ratified tradeoffs (docs/decisions.md)` as a valid subsection, so a block whose only content is ratified tradeoffs passes the well-formedness check.
- The settling line the lens cites is the `- **<topic>** (`<id>`)` line, the same shape precedents already use.

The `faff-contract:spec-review-verdict` block, the per-lens refutation shape, and `aggregate.mjs` are all unchanged by FAFF-910.

## 4. HOW: behaviour

### Architecture

```
docs/decisions.md ──listRatifiedTradeoffs──▶ ratified-scope.js assemble()
       │                                             │
       │                                    ## Ratified scope block
       │                                             │
       │            faff-prep, at each ROUND START ──┤ writes $scratch/ratified-scope.md
       │                                             │
       │                     faffter-dark-spec-review occupant ──▶ all four lenses' --context
       │                                             │
       │                          design lenses demote covered objections → observations
       │                                             │
       │                              aggregate.mjs drops observations (unchanged)
       │
       ├── same-run: human edits the register between interactive rounds → visible next round
       └── cross-run: graft commits the entry alongside docs/specs/…-design.md (the durable binding)
```

### Per-round assembly (closing FAFF-907's once-at-entry gap)

**The exact seam in the round loop.** Post-907 faff-prep (`plugin/skills/faff-prep/SKILL.md`, commit `4b74fcd5`) has two distinct assembly points. At **loop entry, once, before the first round**, it resolves `$scratch` and `window_start` and, gated on a resolved `prd_root_container`, assembles the `## Ratified scope` block a single time (its ratified-scope assembly step), discarding the assemble command's stderr. Then it enters the **round loop**; each iteration opens a per-dispatch in-flight marker (`faff inflightcheck --open --key <ISSUE-XX> --describe spec-review`), dispatches the `spec_review` occupant with `run_in_background:false`, consumes the verdict, derives `n` via `faff spec-review-window --next-round --dir $scratch`, writes `round-<n>.json`, and runs the churn/convergence checks.

FAFF-910 **moves the register-tradeoffs assembly from the loop-entry point into the round loop**, to one named seam: **at the start of each round-loop iteration, immediately before `faff inflightcheck --open --key <ISSUE-XX> --describe spec-review`, prep runs `assembleRatifiedScope` and refreshes `$scratch/ratified-scope.md`.** 907's once-at-loop-entry assembly is **superseded** by this per-round call, not run in addition to it. No behaviour is lost by the move: the PRD-non-goals half re-renders byte-identically each round (its inputs, the resolved PRD container and its non-goals section, are stable within a run), and only the register-tradeoffs half changes across rounds, which is exactly the half a mid-loop ratification must reach.

**The call runs unconditionally; only the `--container` argument stays conditional.** 907 wraps its whole loop-entry assembly in a `prd_root_container` guard, with no resolved container it skips the assembly entirely and writes no block. FAFF-910 **removes that guard from its call site**: `assembleRatifiedScope` runs every round whether or not a container resolves. The `--container <container>` flag is still passed only when the L4 run ledger resolves `prd_root_container`, but its absence does **not** skip the call, because `assemble()` reads `docs/decisions.md` directly for the tradeoffs-plus-precedents half (grounded: `ratified-scope.js` `assemble(root, container)` calls `listEntries(root)` regardless of `container`, and the PRD read is the only container-gated branch). This is the ungated no-PRD call site: an interactive prep with no run ledger and no container still assembles and honours the register tradeoffs.

```
PROCEDURE assembleRatifiedScope(scratch, container?):   # the round-loop seam, before `faff inflightcheck --open`
  1. run `faff ratified-scope --assemble [--container <container>]`, capturing stdout AND stderr
     - the CALL is unconditional (no prd_root_container guard around it);
       --container is appended ONLY when the L4 run ledger resolves prd_root_container.
       With no container the command still assembles the register tradeoffs + precedents,
       because assemble() reads docs/decisions.md directly and only the PRD-non-goals half is gated.
  2. IF exit == 0:
       write stdout to $scratch/ratified-scope.md
       append each captured stderr warning line to the prep round audit log
  3. IF exit == 3 (nothing ratified):
       remove $scratch/ratified-scope.md; no deferral this round (a legitimate empty set)
  4. IF exit == 2 (source unreadable, a FAILED read, not an empty one):
       return needs-human; do NOT dispatch the round with a fabricated empty block
```

- **Per round, not once.** Re-assembling at the start of every round makes a tradeoff added after round one visible in round two of the same interactive run. Caching the block across rounds is a defect. The PRD non-goals half re-renders identically each round (it is stable within a run); the register tradeoffs half picks up a mid-loop ratification.
- **No PRD container required.** `assemble()` reads `docs/decisions.md` directly, so it renders tradeoffs even when no PRD container resolves (interactive prep with no run ledger). The container only gates the PRD-non-goals half.
- **A failed read is needs-human, never an empty set.** FAFF-907 treated an unreadable source (exit 2) as "no file, no deferral" silently. FAFF-910 tightens this: exit 2 at round start routes to `needs-human` rather than dispatching with a fabricated empty block.

Everything downstream of `$scratch/ratified-scope.md` is FAFF-907's shipped path, unchanged: the occupant appends the file to all four lenses' `--context` byte-identically, the design lenses defer, and `aggregate.mjs` drops the resulting observations.

**What is born-verifiable here, and what is needs-human prep-prose.** The two halves of this change land on different verification boundaries, and the DONE section classifies them as such rather than overclaiming one oracle for both:

- **Born-verifiable at the CLI boundary.** The exit-code contract of `faff ratified-scope --assemble`, exit 0 with a `### Ratified tradeoffs (docs/decisions.md)` subsection when a honourable tradeoff exists, exit 2 on an unreadable source, exit 3 when nothing is honourable, plus the one-stderr-warning-per-honourable-entry behaviour, are deterministic CLI outputs. They are tested by CLI integration tests and the smoke test, independent of any live lens round.
- **Needs-human prep-prose.** The per-round cadence (the assembly moved to the round-loop seam) and the exit-2→`needs-human` and stderr→round-log **routing** are prose orchestration in `faff-prep/SKILL.md`. They have no deterministic oracle, like prep's other loop-orchestration prose (the in-flight marker discipline, the window/churn wiring), they are verified by human review of the SKILL.md diff. The DONE items for them are marked as needs-human-verified prep-prose ACs, not born-verifiable.

### Trust boundary: the register is within the existing repo-write surface

A v1 tradeoff is honourable on a self-attested `Ratified-by: human` line with no per-entry cryptographic provenance. This is a design decision, not an unclosed hole, and the reasoning is a trust-boundary one:

- **No new attack surface beyond code-write.** `docs/decisions.md` is a git-tracked repo file under the **same access control as the spec under review, the eval fixtures, the reviewer prompts, and the CLI code itself**. A process that can write `docs/decisions.md` between rounds can already write the spec being reviewed, the tests that gate it, and the refuter prompts that review it. The register is therefore inside the existing repo-write trust boundary and grants no capability that code-write does not already grant.
- **The `critical` floor caps the blast radius.** No entry defers a `critical`: a genuine exploit, data-loss, or fail-open objection is raised by any lens regardless of what the register says. The worst a demote-to-observation can suppress is a non-critical objection a human has, by the same act, chosen to accept.
- **Provenance is the repo's own access control plus review, by design.** Cross-run, an entry is ratified by **human PR review** at graft: it lands in a reviewed commit before any later run reads it. Same-run interactive, the human authoring the working-tree edit **is** the operator running prep, the round-two read is of an uncommitted working-tree edit the operator themselves made and validated via `faff decisions validate`, not a third-party injection. A per-entry content digest is deliberately not used, and the dropped-digest rationale already explains why a byte hash could not prove consistency even if present. v1 authority is human; provenance is access control plus PR review.

### Same-run human ratification

During interactive prep, a human can accept a round-one objection as a tradeoff and have it honoured in round two of the same run, with no digest and no round-time byte check. Honouring is by the entry's presence in the re-assembled block (citation-ID membership), read fresh each round.

```
PROCEDURE ratifyBetweenInteractiveRounds(currentSpec, roundOneObjection):
  1. Surface the objection and the proposed tradeoff; pause for the human decision
  2. Human authors Chosen, Rationale, Scope, Source-issue, Ratified-by: human, Date;
     folds the accepted choice into currentSpec
  3. Prep does NOT write the register; wait for the human to add the entry to docs/decisions.md
  4. Run `faff decisions validate`; require it passes for the new tradeoff
  5. Start round two: assembleRatifiedScope re-reads the register, the entry renders into the block,
     and the round-two lenses defer to it
  6. Otherwise remain paused; do not claim same-run honouring
```

This manual pause is interactive-only. Autonomous v1 cannot create a ratification (no human is present) but still re-reads and honours entries already in the register on every round.

For later runs, the entry is authored into `docs/decisions.md` and lands through the existing capture-intent / graft path: prep records a `## Decisions-register intent` capture comment, graft materialises the entry on the feature branch, and PR review ratifies it. In git-only mode, prep surfaces the complete entry for the human to add directly.

### Scope warning and v2 expiry

Every honourable v1 entry stores `Scope`, and `listRatifiedTradeoffs` performs no scope/topology comparison. Automatic scope/topology expiry is the **human-ratified v2 deferral** (settled in this ticket's design; see the out-of-scope entry and the rationale). v1 does not enforce it and this spec does not add enforcement.

**The warning is a deterministic CLI output, not a model-round artifact.** `faff ratified-scope --assemble` emits **one warning per honourable entry to stderr, at assemble time, regardless of any downstream demotion**, the warning is a function of the register contents alone, decoupled from whether any lens later demotes an objection. It names the entry and its recorded scope:

```
Honouring <id> under recorded Scope "<scope>" without scope/topology expiry enforcement (v1);
v2 owns automatic expiry.
```

Because the emission is at the CLI boundary and independent of any live lens round, it is born-verifiable: assert that `assemble` stderr carries exactly one warning line per honourable entry. Prep's only job is to fold that already-emitted stderr into the round audit log (it no longer discards assemble stderr), a needs-human prep-prose AC, not the source of the warning. A missing warning for a honourable entry is a CLI defect caught at the assemble boundary, not a round-dependent one; it holds even when no objection is ultimately demoted.

**v1 mitigation, and the residual it accepts.** v1's mitigation for a scope that may have gone stale is two-fold: the mandatory per-entry warning above, and **human PR review of every entry's `Scope`** (an entry lands only through a reviewed commit). The residual is stated plainly and accepted: until v2 ships automatic expiry, a stale-scope honourable tradeoff is still honoured, and that is a **known, accepted, human-visible limit**, not an oversight. v2 replaces the fixed no-enforcement behaviour with a deterministic scope-match predicate that stops rendering expired entries.

### Human-only v1 and FAFF-922

`Ratified-by: loop` is a validation error and never renders into the block. The error names FAFF-922 as the future admit gate. When FAFF-922 ships, a later issue may extend validation and the reader so a loop entry is honourable only after the judge admits it; this ticket does not pre-implement or simulate that gate.

### Auditability

The durable audit trail is two committed things, not a digest and not the ephemeral suppression log:

- the `docs/decisions.md` ratified-tradeoff entry, recording what was accepted (`topic`, `Chosen`, `Rationale`), by whom (`Ratified-by: human`), where (`Source-issue`), under what boundary (`Scope`), and when (`Date`); and
- the graft commit that lands that entry alongside `docs/specs/…-design.md` in one branch/PR, an authored, dated, tamper-evident record that binds "this decision" to "this spec version". `git log` / `git blame` answers "which spec version co-existed with which decision entry" natively.

The per-round demotion event stays an ephemeral `.faff/` breadcrumb (FAFF-907's `$pin_dir/round-<n>-<lens>.md` transcript and the prep log), never a durable record. Consistency guards against a spec silently walking back a still-asserted decision are PR review at graft and v2 scope-expiry, never a content hash. AC3's "against which spec revision was this accepted" is answered by the git commit binding, stated plainly.

### Failure modes

- **The ratified block is cached across rounds.** How you'd know: a valid entry added after round one is missing from round two's lens context. What it means: the assembly is still FAFF-907's once-at-entry step; move it to the start of every round.
- **An unreadable register silently disables deferral.** How you'd know: a corrupt `docs/decisions.md` produces an empty block and the round proceeds instead of pausing. What it means: exit 2 must route to `needs-human`, not the FAFF-907 silent "no file" path.
- **A blank discriminator falls through as a precedent.** How you'd know: an entry with `Ratified-by:` and no value reports a missing-`Matches` precedent error or validates as a precedent. What it means: kind detection used `readField` truthiness instead of lexical presence.
- **A tradeoff renders as a settled precedent.** How you'd know: a `ratified_tradeoff` entry appears under `### Settled precedents` (or is returned by `matchDecision`). What it means: `assemble()`/`matchDecision` did not branch by kind.
- **A honoured tradeoff produces no scope warning.** How you'd know: a non-empty tradeoff set reaches the lenses with no per-entry warning in the round log. What it means: prep is still discarding assemble stderr, violating the explicit v1 audit condition.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an interactive review whose round-one objection is a spec-level tradeoff
And the human folds the accepted choice into the current spec
And adds a valid human-ratified entry (Ratified-by: human, a valid Source-issue) to docs/decisions.md
When prep validates the register and starts round two
Then prep re-assembles the ratified-scope block in the same run
And the entry renders under "### Ratified tradeoffs (docs/decisions.md)" in every enabled lens's context
```

```
Given a design-lens objection whose entire content reopens a honoured ratified tradeoff within its recorded Scope
When that lens runs with the ratified-scope block in context
Then the lens records the objection at observation severity, not a gating severity (the deterministically-checked outcome), and, as an LLM judgement rather than a machine-checked field, cites the settling line
And aggregate.mjs deterministically drops any observation-severity objection before computing severity or majority
And the objection cannot force reject-approach
(Note: only the severity demotion is deterministically tested by aggregate.mjs; the settling-line citation is the refuter's LLM judgement, asserted for audit, not machine-verified.)
```

```
Given a critical objection whose content overlaps a honoured ratified tradeoff
When the design lens runs with the ratified-scope block in context
Then the critical is raised regardless of the block (a critical is never deferred)
And the verdict reflects the critical
```

```
Given docs/decisions.md holds one honourable tradeoff and no PRD container resolves
When prep assembles the ratified-scope block at round start
Then assemble exits 0 and the block contains the ratified tradeoffs subsection
And the tradeoff is honoured with no PRD present
```

```
Given docs/decisions.md holds only a non-honourable tradeoff (a Ratified-by: loop entry or a
  malformed one), and there is no scoped precedent and no PRD non-goals section
When prep assembles the ratified-scope block at round start
Then assemble exits 3 (nothing honourable) and writes no ratified-tradeoffs subsection
And the loop/malformed entry is not rendered into the block and cannot count toward exit 0
And prep removes $scratch/ratified-scope.md and dispatches the round with no deferral
```

- The validator rejects `Source-issue` values outside `^[A-Z]+-\d+$`.
- The validator rejects a blank `Ratified-by:` as a malformed tradeoff rather than treating it as a precedent.
- The validator rejects `Ratified-by: loop` with a message naming FAFF-922.
- A valid tradeoff carrying an optional `Matches` is absent from `matchDecision` results.
- A precedent entry with no `Ratified-by:` line still validates and remains eligible for exact topic matching.
- `faff ratified-scope --assemble` over a register with two honourable tradeoffs writes exactly two no-expiry-enforcement warning lines to stderr, one per honourable entry, at assemble time and independent of any live lens round or any downstream demotion.
- A register with three honourable tradeoffs where none is demoted still emits three assemble-time stderr warnings; prep folds all three into the round log.
- `faff ratified-scope --validate` on a block whose only subsection is `### Ratified tradeoffs (docs/decisions.md)` passes the shape check (exit 0). This is the oracle for the validator accepting a tradeoffs-only block, distinct from the register-level `faff decisions validate`; before this change `validate()` recognised only a Non-goals or Settled-precedents subsection and would reject a tradeoffs-only block.
- `faff decisions list --json` over a register holding one precedent and one ratified tradeoff emits a `kind` field on each object (`precedent` for the precedent, `ratified_tradeoff` for the tradeoff); the precedent object's `id`/`topic`/`chosen`/`date` values, and its plain-text `<id>  <chosen>  <date>` line, are byte-identical to the pre-change output (the additive-`kind` assertion).

## 6. Design decision rationale

**Where does a ratified tradeoff live?** Options: a structured spec field, a fresh ADR, or the decisions register. **Chosen:** the decisions register. It is the existing durable, human-authored consult surface, and a second consumer beside the precedent matcher avoids a new store.

**How is a tradeoff distinguished from a precedent?** Options: a new heading kind, a separate file, a truthy parsed value, or raw presence of `Ratified-by`. **Chosen:** lexical presence of the `Ratified-by:` field line. It preserves existing headings and makes a blank discriminator fail as a malformed tradeoff instead of silently changing kinds. `readField` maps blank and absent both to `null` (its FAFF-850 contract), so the discriminator must be a separate lexical check.

**May a tradeoff declare `Matches`, and can it satisfy precedent matching?** Options: require it and share the matcher, forbid it, or allow it as metadata while restricting the matcher by kind. **Chosen:** `Matches` is optional metadata for a tradeoff, and `matchDecision` considers precedents only. The two register consumers stay distinct.

**How is a ratified tradeoff honoured by the gate?** Options: add FAFF-910's own `Covers:` refuter clause plus an `aggregate.mjs --ratified` suppression flag, or reuse FAFF-907's shipped demote-to-observation deferral by rendering the tradeoff into the `## Ratified scope` block. **Chosen:** reuse FAFF-907's path. FAFF-907 already demotes a covered objection to an observation and `aggregate.mjs` already drops observations, so a rendered tradeoff is honoured with no new reviewer surface. A second defer clause in the same refuter prompts is the FAFF-878 collision, and a parallel suppression layer would duplicate what already ships. FAFF-910's contribution is the register kind plus the assemble-time rendering, nothing in the reviewer.

**What binds a decision to the spec version it shipped with?** Options: a whole-spec content digest stored on the entry, a tracker comment ID, a Git object ID, or the graft commit itself. **Chosen:** the graft commit. A per-decision whole-spec hash is incoherent because the spec is a moving target across review rounds: each mid-review ratification would snapshot a different intermediate spec, so no single entry's digest can equal the finally-committed spec, and a byte hash proves integrity, never consistency with the decision. Graft commits the entry and `docs/specs/…-design.md` together in one branch, an authored, dated, tamper-evident binding `git log`/`git blame` reads natively. No hash is reintroduced to reproduce what the commit graph already gives.

**When is the ratified set assembled, and how does a new v1 entry reach round two?** Options: once per run (FAFF-907's cadence), or re-assembled at the start of every round. **Chosen:** re-assemble at the start of every round, independent of any PRD container. FAFF-910's own acceptance criterion requires a mid-loop human ratification to be visible next round, and its tradeoffs must be honoured with no PRD. The PRD non-goals half is stable within a run and re-renders identically; the register tradeoffs half is what changes.

**What happens when the ratified read fails at round start?** Options: FAFF-907's silent "no file, no deferral", or route to needs-human. **Chosen:** an unreadable register (exit 2) routes to `needs-human`; a legitimately empty result (exit 3) proceeds with no deferral. A failed read must never be indistinguishable from an empty set, or a corrupt register would quietly re-enable every objection a human had settled.

**Who may ratify in v1?** Options: human and loop immediately, or human only until a deterministic admit gate exists. **Chosen:** human only. Validation refuses `loop` provenance and names FAFF-922 as the future admit gate.

**When is scope expiry enforced?** Options: automatic filtering in v1, silent deferral, or recorded scope with an explicit per-round warning and v2 enforcement. **Chosen:** store `Scope` in v1, emit one warning per honoured entry per round, and defer automatic scope/topology expiry to v2. This is the recorded human resolution and keeps the deferral auditable.

**Does FAFF-910 depend on FAFF-907?** Options: retain an implementation dependency, or treat them as independent register consumers. **Chosen:** they are independent consumers (neither blocks the other's scheduling) but FAFF-910's implementation composes with FAFF-907's shipped code, reusing its block and its deferral. This is a composition, not a build dependency and not a parallel mechanism. The tracker blocking edge is already satisfied (FAFF-907 is Done); this spec does not mutate tracker topology.

## 7. Open questions and assumptions

**Open questions:** none.

**Assumptions:** none. FAFF-907's shipped seams were read from commit `4b74fcd5` on main (the tree this work builds atop), and `decisions.js`, `ratified-scope.js`, `fields.js`, `aggregate.mjs`, and `docs/decisions.md` were read in the working tree. The build agent should confirm main contains commit `4b74fcd5` before starting (it is on `origin/main`, not the pre-907 working-tree branch this spec was drafted on).

## 8. DONE: definition of done

### From WHY

- [ ] A valid human-ratified tradeoff added after round one is rendered into the ratified-scope block and injected before round two of the same interactive run. (Split by verification class: the CLI half, that a honourable entry renders into the assembled block, is born-verifiable via `faff ratified-scope --assemble`; the "before round two of the same run" cadence is needs-human prep-prose, verified by human review of the `faff-prep/SKILL.md` diff, the same class as the round-loop ACs below.)
- [ ] Autonomous v1 adds no register write path and honours only entries already present in `docs/decisions.md`.
- [ ] A design-lens objection that only reopens a honoured tradeoff within its scope becomes an observation and cannot force `reject-approach`; a `critical` overlapping the same area is still raised.
- [ ] FAFF-910 adds no `Covers:` clause and no `aggregate.mjs` change; honouring rides FAFF-907's demote-to-observation path.

### From WHAT: register and CLI

- [ ] `listEntries` tags every entry with `kind`, derived from lexical presence of a `Ratified-by:` field line (including a blank value).
- [ ] The kind discriminator reuses the **shared field-line matcher** `readField` uses (`fields.js`), testing presence of the `Ratified-by:` line on the identical `^[\s>*-]*<name>[ \t*]*:` head and differing only in presence-vs-value; no separate or bold-only `Ratified-by:` grammar is introduced.
- [ ] Ratified-tradeoff validation requires `Chosen`, `Rationale`, `Scope`, `Source-issue`, `Ratified-by`, and `Date`; `Matches` is optional; there is no `Spec-revision` field.
- [ ] `Source-issue` enforces `^[A-Z]+-\d+$`; `Ratified-by` accepts only `human` and names FAFF-922 when refusing `loop`; a blank `Ratified-by:` is a malformed tradeoff, not a precedent.
- [ ] Precedent validation is unchanged, and the real `docs/decisions.md` still validates clean.
- [ ] Citation IDs stay unique across both kinds.
- [ ] `matchDecision` ignores every ratified-tradeoff entry, including one carrying `Matches`; its return shape is unchanged (`{ id, chosen, rationale, scope }` / `{ match: null }`, no `kind` field).
- [ ] `faff decisions list --json` gains an additive `kind` field per object (`precedent` / `ratified_tradeoff`); the existing `id`/`topic`/`chosen`/`date` fields and the plain-text `<id>  <chosen>  <date>` line shape are unchanged for precedent entries.
- [ ] `listRatifiedTradeoffs` returns only fully valid `Ratified-by: human` entries; an absent register is a clean empty list.
- [ ] `decisions.js`, its `validate`/`list` verbs, usage text, selftest, and `docs/guide/cli.md` describe the new kind.

### From WHAT: rendering

- [ ] `assemble()` branches by kind: precedents render under `### Settled precedents (docs/decisions.md)`, honourable tradeoffs under `### Ratified tradeoffs (docs/decisions.md)` with a citable settling line.
- [ ] `assemble()`'s exit-3 condition accounts for tradeoffs: exit 0 when a PRD non-goals section, a scoped precedent, or a honourable tradeoff exists; exit 3 only when all are absent.
- [ ] A register whose only tradeoff is non-honourable (`Ratified-by: loop` or malformed), with no scoped precedent and no PRD non-goals, makes `assemble` exit 3 and renders no tradeoffs subsection; a loop/malformed entry can never count toward exit 0.
- [ ] `validate()` recognises `### Ratified tradeoffs (docs/decisions.md)` as a valid subsection, so a tradeoffs-only block passes the shape check.
- [ ] `aggregate.mjs`, the per-lens refutation shape, and the fixed `faff-contract:spec-review-verdict` are unchanged.

### From HOW: CLI exit-code boundary (born-verifiable, CLI integration tests)

- [ ] `faff ratified-scope --assemble` exits 0 and emits a `### Ratified tradeoffs (docs/decisions.md)` subsection when the register holds ≥1 honourable tradeoff.
- [ ] `faff ratified-scope --assemble` exits 2 when the source is unreadable (a read throw), distinct from an empty result.
- [ ] `faff ratified-scope --assemble` exits 3 when nothing is honourable (no PRD non-goals, no scoped precedent, no honourable tradeoff), including the boundary where the only tradeoff present is loop/malformed.

### From HOW: round loop (needs-human-verified prep-prose ACs)

These are prose orchestration in `faff-prep/SKILL.md` with no deterministic oracle, verified by human review of the SKILL.md diff, exactly as prep's other loop-orchestration prose is:

- [ ] Faff-prep assembles the ratified-scope block at the **named round-loop seam**, the start of every round-loop iteration, immediately before `faff inflightcheck --open --key <ISSUE> --describe spec-review`, never once per run; 907's loop-entry assembly is superseded, not duplicated.
- [ ] The assemble call runs **unconditionally** (no `prd_root_container` guard around the call); only the `--container` argument is conditional, and its absence does not skip the call.
- [ ] An unreadable register (assemble exit 2) at round start routes to `needs-human`; a legitimately empty result (exit 3) proceeds with no deferral.
- [ ] Prep captures assemble stderr into the round audit log instead of discarding it.

### From HOW: same-run and cross-run ratification

- [ ] Interactive same-run ratification pauses until the human has edited `docs/decisions.md` and `decisions validate` passes for the new tradeoff, then round two re-reads and honours it.
- [ ] The cross-run path carries the entry through the existing capture-intent / graft materialisation; git-only mode surfaces the complete entry for direct human addition.

### From HOW: audit and expiry

- [ ] The durable audit is the `docs/decisions.md` entry plus the graft commit landing it alongside `docs/specs/…-design.md`; no content hash is stored or checked.
- [ ] (born-verifiable, CLI) `faff ratified-scope --assemble` emits exactly one no-expiry-enforcement warning line to stderr per honourable entry, at assemble time and independent of any live lens round or any downstream demotion.
- [ ] (needs-human prep-prose) Prep folds each already-emitted assemble stderr warning into the round audit log, even when no objection is demoted.
- [ ] The trust boundary is stated: the register is within the existing repo-write surface (same access control as spec/tests/reviewer prompts/CLI), the `critical` floor is never deferred, and provenance is human PR review at graft plus the operator's own validated working-tree edit same-run, a stated design decision, not an unclosed hole.

### Eval coverage

- [ ] Add at least one `refutation-spec` case for a design-lens objection that only reopens a rendered ratified tradeoff (expected: demoted to observation) and one near-miss where a critical overlapping the same area is still raised; retain the existing `refutation-spec` seam-registry row for `faffter-dark-spec-review`. Baseline acceptance stays a separate human-supervised step.

### Integration smoke test

Steps 1 to 5 and 8 are **deterministic CLI checks** (exit codes, stdout/stderr over `faff decisions` and `faff ratified-scope`), runnable with no model. Steps 6 and 7 are **live-model rounds** that exercise the end-to-end demotion behaviour through a real backend; they are not deterministic CLI checks and are consistent with the spec's "born-verifiable at the CLI boundary" claim, which covers only the assemble-time exit-code/stderr contract, never a live lens round.

```
1. In a temporary repo, add a ratified-tradeoff entry to docs/decisions.md with Ratified-by: human,
   a valid Source-issue, a recorded Scope, and no Spec-revision field.
2. `faff decisions validate --root <temp>` exits 0; `faff decisions match --punt "<the topic>"`
   does not return it.
2a. `faff decisions list --json --root <temp>` emits a `kind` field on the entry (`ratified_tradeoff`);
   add a precedent entry too and confirm its object carries `kind: precedent` with `id`/`topic`/`chosen`/`date`
   and its plain-text line byte-identical to the pre-change output.
2b. Assemble the block and run `faff ratified-scope --validate --in <the assembled block>`: a block whose
   only subsection is `### Ratified tradeoffs (docs/decisions.md)` passes the shape check (exit 0).
3. `faff ratified-scope --assemble --root <temp>` exits 0 and its block contains
   "### Ratified tradeoffs (docs/decisions.md)" and the entry's settling line; stderr carries exactly
   one no-expiry-enforcement warning line for the honourable entry, emitted at assemble time with no
   lens round involved.
4. Add a second honourable tradeoff; re-run `--assemble`; stderr now carries exactly two warning
   lines (one per honourable entry), still independent of any demotion.
5. Replace the register contents with a single `Ratified-by: loop` (or malformed) tradeoff, no scoped
   precedent, no PRD non-goals; `faff ratified-scope --assemble --root <temp>` exits 3 and prints no
   "### Ratified tradeoffs" subsection, the loop/malformed entry cannot count toward exit 0.
6. (live-model round, not a deterministic CLI check) Run a round with four enabled lenses where one
   design lens's only objection wholly reopens the tradeoff within scope; the lens demotes it to an
   observation and the verdict is approve.
7. (live-model round, not a deterministic CLI check) Repeat with a critical objection overlapping the
   same area; the critical is raised and the verdict is reject-approach.
8. Corrupt docs/decisions.md so assemble exits 2 at round start; prep routes to needs-human rather
   than dispatching an empty block.
```

confidence: medium
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```