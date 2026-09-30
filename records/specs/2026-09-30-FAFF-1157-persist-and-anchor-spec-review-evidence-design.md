# FAFF-1157 — Persist and anchor spec-review evidence: refutations + dispositions, carried prep → graft

> Spec: faffter-dark-nlspec · 2026-09-30 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1157.

This spec addresses FAFF-1157 (Half B of FAFF-1155). Its audience is the build agent implementing the change and the human reviewers of the resulting PR. It assumes familiarity with faff's contract engine, the spec-review round loop in `faff-prep`, and the per-PR anchor mint in `events.js`.

## 1. WHY — Problem and Principles

**The essential model.** A spec review raises objections and resolves them, but only a bare `spec-review: approve` line survives onto the spec; the objections themselves and how each was resolved live in transient `round-<n>.json` scratch that is deleted with the prep run-dir. FAFF-1155 made the per-PR anchor the immutable home for build-evidence (ac-checklist.json + review-verdict.json). This change adds the spec-review evidence — the objections that were raised and their dispositions — to that anchored set, so the earliest, highest-value review objections and their resolution are auditable from the immutable anchor rather than lost with scratch.

**Problem statement:** today spec-review objections and their resolutions vanish when the prep run-dir is cleaned, so a merged PR's anchor cannot show what the review objected to or how it was settled. This change persists a durable spec-review-verdict evidence record at prep's terminal review seam, carries it prep → graft, and best-effort-anchors it into the per-PR anchor. The result is tamper-evident review provenance alongside the AC and code-review evidence already anchored.

**Design principles:**

**Additive, never a re-gate.** Every schema and contract change here is a strict superset of today's shape. A legacy `{lens, severity}`-only objection must still validate, and the `{lens, severity}` gating decision (majority, arithmetic floors, convergence, churn) must be byte-identical. This mirrors FAFF-935/943 (the objection triple + `spec_anchor`) and FAFF-1146 (the review-verdict finding enrichment) exactly — the new fields add a soft violation on an out-of-enum value, never a `schemaCheck` fail-loud, and never change a verdict.

**Audit-only, not merge-gating.** The anchored file is evidence. graft does not re-run spec review — it trusts prep's retained verdict — so there is nothing at graft/merge time to fail-close against. No new merge-floor leg, no `readSpecReview` reader. The file rides in the immutable anchor bundle as tamper-evident provenance; it gates nothing.

**Absence is legitimate.** A spec review does not always run the same lens set, a clean first-round approve raises no objections, and a git-only spec or an outage-resumed path may carry no durable evidence. Any mechanism that hard-requires the evidence file risks false refusals. The anchor carry is therefore best-effort.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript | `computeSpecReviewVerdict` (objection shape) + `CONTRACT_DESCRIBES` — the precedent is `computeReviewVerdict`'s FAFF-1146 disposition triple |
| `plugin/skills/faff/contracts/spec-review-verdict.schema.json` | JSON Schema | per-objection object (`additionalProperties:false`, `required:["lens","severity"]`) |
| `plugin/skills/faff-prep/SKILL.md` | Markdown (skill) | round-record write + terminal-verdict retention seam |
| `plugin/skills/faff-graft/SKILL.md` | Markdown (skill) | Step 4b (comment-first-with-spec-fallback carry), Steps 8/9 (floor-file writes), Step 9b (anchor mint) |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript | `mintIssueAnchor` `optionalFloorFiles`; the FAFF-1155 `floor-incomplete` required guard |

**Scope statement:** this sits between prep's spec-review gate (which produces the evidence) and the per-PR anchor mint (which immortalises it), passing through graft's floor-file placement step.

## 2. OUT OF SCOPE

- **A new merge-gate leg for spec-review evidence** — Why excluded: graft does not re-run spec review and trusts prep's retained verdict, so there is nothing to fail-close against; this ticket is audit/evidence only. Extension point: `governance-check.js` `evaluateMergeFloorLeg` (~137) + `merge-gate.js` readers (`readAcComplete`/`readReviewVerdict`, ~584/600) — a future ticket that decided spec-review evidence should gate merge would add a `readSpecReview` reader and a `reasons.push` there.
- **Re-running spec review at graft** — Why excluded: prep owns spec review; graft consumes the retained verdict. Extension point: a graft-side spec_review dispatch would live beside Step 4's spec commit, but is explicitly not built here.
- **A divergent retry ceiling per disposition, or any new prep routing on the new fields** — Why excluded: the fields are provenance the objection carries; they never re-route prep. Extension point: the prep routing table (`reject-approach` by lens) is untouched.
- **Back-filling evidence for specs reviewed before this change** — Why excluded: the fields are optional and absent-tolerant; historical anchors simply carry no spec-review-verdict.json. Extension point: none needed — absence is a first-class state everywhere.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Objection | One spec-review finding: `{lens, severity}` plus optional argued content. |
| Disposition | How a raised objection was ultimately resolved — one of `fixed` / `refuted` / `accepted-risk` / `open`. |
| Evidence verdict | The single spec-review-verdict record prep persists as the review's durable evidence (see §4). |
| Terminal review seam | The point in `faff-prep` where a cleared review retains its outcome on the spec (`spec-review: approve`, or `accept (judge, …)`). |

**Type definitions — the enriched objection (additive superset of today's shape):**

```
RECORD SpecReviewObjection:
  lens: string                       # required; enum enforced via violations (unchanged)
  severity: string                   # required; enum enforced via violations (unchanged)
  claim?: string                     # FAFF-935 optional, preserve-when-present (unchanged)
  evidence?: string                  # FAFF-935 optional (unchanged)
  predicted_consequence?: string     # FAFF-935 optional (unchanged)
  spec_anchor?: string               # FAFF-943 optional (unchanged)
  # --- NEW (FAFF-1157), all optional, all mirror FAFF-1146's review-verdict finding triple ---
  disposition?: string               # enum-checked via violations; out-of-enum -> soft violation (exit 1), preserved verbatim
  refutation?: string                # free string, preserve-when-present, no enum, no violation
  disposition_rationale?: string     # free string, preserve-when-present, no enum, no violation
```

**Disposition enum.** The four tokens are exactly `["fixed", "refuted", "accepted-risk", "open"]`.

**Design decision — enum source: reuse `REVIEW_DISPOSITIONS` by reference vs a fresh `SPEC_REVIEW_DISPOSITIONS` literal.**

| Option | Pro | Con |
|---|---|---|
| Reuse the existing `REVIEW_DISPOSITIONS` const by reference | one home for the vocabulary; the `CONTRACT_DESCRIBES` by-reference binding keeps described == validated for free; DRY | couples two contracts' disposition vocabulary |
| New `SPEC_REVIEW_DISPOSITIONS` literal with identical values | contracts stay decoupled | duplicates a literal the codebase already owns; two homes to keep in sync |

**Chosen:** reuse the existing `REVIEW_DISPOSITIONS` constant by reference in both `computeSpecReviewVerdict` and the `CONTRACT_DESCRIBES` entry — rationale: the vocabulary is genuinely identical ("how a raised objection/finding was resolved"), not a coincidence, so a single home is honest; the by-reference binding is the same drift-proofing the describe block already relies on (FAFF-582). The two-home literal earns nothing here.

**Contract behaviour (`computeSpecReviewVerdict`, ~497-504 copy loop):** in the per-objection map, after the existing `["claim","evidence","predicted_consequence","spec_anchor"]` string-preserve loop:
- `disposition` — enum-checked against `REVIEW_DISPOSITIONS`: a valid string passes through; an out-of-enum value is preserved (or `""` if non-string) AND pushes a violation naming the objection index; absent → omitted. This is byte-identical to `computeReviewVerdict`'s `disposition` handling.
- `refutation`, `disposition_rationale` — copied only when present as a string; no enum, no violation.

**Schema (`spec-review-verdict.schema.json`, per-objection `properties`):** add three optional string properties `disposition`, `refutation`, `disposition_rationale`. `additionalProperties:false` and `required:["lens","severity"]` are unchanged — so an unknown property still fails `schemaCheck` (exit 2), and the three new fields are optional. Mirror `review-verdict.schema.json` verbatim, including the description sentence noting the additive precedent.

**Describe (`CONTRACT_DESCRIBES["spec-review-verdict"].values`):** add one `objections[].disposition` entry with `enum: REVIEW_DISPOSITIONS`, `lintable: false`, and the four-value semantics (mirror the review-verdict wording: `fixed` / `refuted` / `accepted-risk` / `open`). Add a `producer_notes` line noting `refutation` and `disposition_rationale` are optional free strings (no enum, no violation), `disposition_rationale` carrying the reasoning behind the disposition. The `coercions` array gains a sentence: an out-of-enum objection disposition → `conformant:false` (exit 1, not fail-loud).

## 4. HOW — Behavior

### 4.1 prep persists the durable evidence verdict

**Behaviour summary:** at the terminal review seam — the same point that writes the retained `spec-review: approve` (refuter path) or `accept (judge, …)` (judge path) onto the spec — prep selects the review's evidence record, stamps each objection's disposition, re-validates it, and hands it to the carry mechanism (§4.2).

**Design decision — which record is the "evidence verdict".** A conformant `approve` must carry zero objections (the contract forbids `approve` + objections), so the gate-clearing approve is not itself the evidence. The evidence is the substantive round that raised the objections that were then resolved.

**Chosen:** the evidence verdict is the highest-`n` conformant `round-<n>.json` **within the current convergence window** whose `objections` array is non-empty; if no objection-bearing round exists in the window (a clean first-round approve), the evidence verdict is the terminal approve verbatim (`{verdict:"approve", objections:[]}`). Rationale: the round store already holds every objection verbatim (`{verdict, objections}`), the selection is a deterministic disk read (no new aggregation, no re-derivation), and it captures exactly "the earliest/highest-value objections + how resolved" the ticket asks for. The record's `verdict` field is the round's own value (`revise`/`reject-approach`, or `approve` when clean) — this is evidence, not a re-statement of gate admission; admission stays recorded by the retained `spec-review:` line on the spec, unchanged.

**Disposition stamping (mechanical, from the review's own machinery — no new LLM inference):**

```
PROCEDURE stamp_dispositions(evidence_record, window_rounds, judge_rulings?):
  # window_rounds: the conformant round-<n>.json records in [window_start .. n]
  # judge_rulings: present only when the gate cleared via the spec-review judge
  1. FOR each objection O in evidence_record.objections:
     a. IF judge_rulings present AND a ruling covers O's proposition:
          UPHOLD_REVIEW | SYNTHESIZE -> O.disposition = "fixed"
          AFFIRM_SPEC               -> O.disposition = "refuted"
          PRD_BOUNDARY              -> O.disposition = "open"   # defensive-only mapping; unreachable here (see note)
          copy the ruling's correction summary / rationale into O.disposition_rationale
     b. ELSE (refuter revise-loop path):
          # the refuter loop clears ONLY via a conformant approve (empty objections), so every
          # objection in the evidence record was resolved by the applied fixes:
          O.disposition = "fixed"
          # no free-text artifact exists in the refuter path, so refutation/disposition_rationale stay OMITTED
  2. re-validate the stamped record through `faff contract spec-review-verdict`
  3. IF conformant (exit 0) -> use the stamped record
     ELSE                   -> discard the stamps, use the bare {verdict, objections} record  # never block
```

**Chosen (free-text fields):** `refutation` / `disposition_rationale` are populated only on the judge path (which produces a correction summary / AFFIRM_SPEC rationale); the refuter revise-loop has no such artifact, so both stay omitted there. Rationale: keep it mechanical — never synthesise rationale prose that the review did not produce.

**Note — the `PRD_BOUNDARY → open` mapping is defensive-only and unreachable on this path.** Stamping runs at the seam that *cleared* the gate (the seam that wrote `spec-review: approve` / `accept (judge, …)`), i.e. `admit: true`. A `PRD_BOUNDARY` ruling forces `admit: false` (it lands in `prd_boundary[]`) → park, so it never reaches a cleared seam. The `open` branch is kept only so the mapping is total over the judge vocabulary and always yields a valid enum value; it produces no `open` disposition in practice. The build agent keeps the branch (total mapping, no dead-value risk) but must not describe `open` as an outcome this feature emits.

**Anti-pattern:** re-running the review, or re-deriving objections, to build the evidence. Why: the round store already holds them verbatim; the evidence must be a read of what happened, never a fresh judgement.

### 4.2 prep → graft carry

prep and graft are separate run-dirs; the `$scratch` filesystem does not survive. The evidence must ride a durable, boundary-crossing channel.

**Design decision — carry mechanism.**

| Option | Pro | Con |
|---|---|---|
| Tracker comment, comment-first, committed-spec fallback (mirror Step 4b `## ADR promotion intent`) | reuses graft's proven comment-first read; keeps the human spec clean in tracker mode; durable in both tracker + git-only | two write paths (comment + spec-body fallback) |
| Always ride the fenced block in the committed spec | one path; universal | a machine JSON block sits in the human-facing spec in every mode |
| A new dedicated attachment/artifact | isolates the evidence | net-new plumbing with no precedent; more surface |

**Chosen:** the tracker-comment pattern, comment-first with a committed-spec fallback, exactly mirroring graft Step 4b. prep writes a `## Spec-review evidence` tracker comment carrying the fenced `faff-contract:spec-review-verdict` block (the stamped evidence verdict as JSON); for a git-only tracker with no comment channel, prep embeds the same fenced block in the spec text under a machine-marked heading (the spec text lives in `.faff/specs/<issue-id>.md` in git-only mode, which graft commits at Step 4). graft reads the tracker comment when present (tracker comment always wins, so tracker specs stay clean), else extracts the block from the committed spec via a sibling of `faff adr extract-intent` (`faff spec-review extract-evidence --file <spec>`). Rationale: the carry seam graft already implements (comment-first-with-spec-fallback) is proven and absence-tolerant, and it reuses the exact channel the **spec itself** crosses on — the machine-local transient `round-<n>.json` scratch is read on prep's machine to build the record, and only the resulting tracker comment crosses the prep → graft boundary.

**Cross-machine reach (the boundary this must survive).** prep and graft can run on different machines, so the carry must cross that boundary, not just the run-dir boundary. It does so **in tracker mode**: the `## Spec-review evidence` comment lives on the cloud tracker, so prep-on-A → graft-on-B is carried exactly as the spec itself is (prep attaches the spec as a tracker comment; graft reads it back — same guarantee, same channel). The transient scratch is never carried; it is consumed on prep's machine before the comment is posted. **In git-only mode the fallback is durable cross-run but same-machine only** — the fenced block rides `.faff/specs/<issue-id>.md`, which is gitignored and machine-local until graft commits it, so a git-only prep-on-A → graft-on-B does not carry the evidence. This is **not a regression this ticket introduces**: the *spec itself* does not cross machines in git-only either (same gitignored local store), so a git-only prep/graft pairing is already co-located today. See the git-only assumption in §7.

### 4.3 graft materialises the floor file

**Behaviour summary:** a new graft step, placed after Step 9 writes `review-verdict.json` and before Step 9b mints the anchor, reads the carried evidence and writes `<run-dir>/<ISSUE>/spec-review-verdict.json`.

```
PROCEDURE graft_materialise_spec_review_evidence(issue, spec_file, run_dir):
  1. locate evidence: the issue's `## Spec-review evidence` tracker comment (comment-first),
     else `faff spec-review extract-evidence --file <spec_file>` from the committed spec.
  2. IF no evidence located (no comment AND no block, or unreadable) -> log ABSENT; skip; RETURN  # never crash graft
  3. parse the single fenced `faff-contract:spec-review-verdict` block; pipe to `faff contract spec-review-verdict`.
  4. IF conformant (exit 0) -> write <run_dir>/<issue>/spec-review-verdict.json (the validated contract data)
     ELSE                   -> log NON-CONFORMANT; skip; RETURN  # best-effort, never block the build
```

This is the same absent/unreadable handling Step 4b applies to `faff adr extract-intent` (exit 1/2 → log + treat as absent, never crash). The placement precedent is Steps 8/9 (`ac-checklist.json` / `review-verdict.json`), which write into `<run-dir>/<ISSUE>/` before Step 9b's byte-copy mint.

### 4.4 anchor carries the file (best-effort)

**Design decision — best-effort vs required at the anchor.**

**Chosen:** append `"spec-review-verdict.json"` to `mintIssueAnchor`'s `optionalFloorFiles` array (~1489), a best-effort per-file copy. Do **not** add it to the FAFF-1155 `floor-incomplete` required guard in the `anchor` command handler (~1247), which stays `ac-checklist.json` + `review-verdict.json` only.

Rationale (why not required, even conditionally): a spec review does not always run the same lens set; graft does not re-run spec review; and the evidence is legitimately absent for a clean first-round approve, a git-only spec without the block, or an outage-resumed path. There is no robust, forgery-free at-anchor-time signal in the graft run-dir that distinguishes "a review ran and evidence should exist" from "the review legitimately produced no durable evidence" — so a conditionally-required floor would produce exactly the false refusals the constraint warns against. The ticket scope ("add it to the anchored set") is audit/evidence, which best-effort append serves precisely: when the file is present it is anchored and immutable; when absent, the anchor is unaffected (the copy loop is `fs.existsSync`-guarded per file, byte-for-byte unchanged from today).

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the disposition-stamping rule mis-labels an objection (e.g. a same-lens swap in the refuter path reads as `fixed` when the lens's objection actually changed). **How you'd know:** the stamped record is still contract-conformant, so it round-trips; a human reading the anchored evidence sees a `fixed` that the diff does not support. **What it means:** narrow — the fields are audit provenance, not gates; a mis-label is a readability defect, never a correctness or merge failure. The refuter path deliberately omits free-text rationale precisely so no fabricated justification is attached to a coarse label.
- **The failure:** a conformant terminal-approve run carries no objection-bearing round, so the anchored file is `{approve, []}` — thin evidence. **How you'd know:** the anchor's spec-review-verdict.json has an empty objections array. **What it means:** proceed — a clean review genuinely had nothing to disposition; the empty record honestly says "review ran, no objections."

## 5. Scenarios

```
Given a spec-review round loop that raised an architectural objection in round 1 and approved clean in round 2
When prep reaches the terminal review seam
Then the persisted evidence verdict carries round 1's objection stamped disposition="fixed",
     and re-validates conformant through `faff contract spec-review-verdict`
```

```
Given a graft build whose issue carries a `## Spec-review evidence` tracker comment with a conformant block
When graft runs the new materialise step before Step 9b
Then <run-dir>/<ISSUE>/spec-review-verdict.json exists with the validated contract data,
     and Step 9b's anchor mint byte-copies it into the anchor bundle
```

```
Given a graft build whose issue carries NO spec-review evidence (comment absent, no spec block)
When graft runs the new materialise step and Step 9b mints the anchor
Then no spec-review-verdict.json is written, graft does not crash, and the anchor is minted unchanged
     (the FAFF-1155 required floor still asserts only ac-checklist.json + review-verdict.json)
```

- The `spec-review-verdict` contract accepts an objection carrying `disposition`/`refutation`/`disposition_rationale`, and rejects an objection carrying an unknown property (exit 2 via `additionalProperties:false`).
- Convergence holdout: `spec-review-convergence.js` and `spec-review-churn.js`, fed round records enriched with the three new fields, produce byte-identical `converging`/`churn` results to the same records without them.

## 6. Design Decision Rationale

**Which precedent do the new fields follow?** Options: invent a bespoke shape; mirror FAFF-935's triple (no enum); mirror FAFF-1146's review-verdict finding triple (enum + two free strings). **Chosen:** mirror FAFF-1146 exactly — enum-checked `disposition` (soft violation, not fail-loud) + free-string `refutation` + `disposition_rationale`. Rationale: FAFF-1146 already solved the identical problem for code-review findings; matching it keeps one mental model and one review precedent.

**Reuse `REVIEW_DISPOSITIONS` or define a spec-review copy?** **Chosen:** reuse by reference (see §3). Rejected the copy: it duplicates a literal the codebase owns and creates a second drift surface, for a vocabulary that is genuinely the same.

**Which record is the evidence?** **Chosen:** the highest-`n` objection-bearing round in the window, else the terminal approve verbatim (see §4.1). Rejected: persisting the bare gate-clearing approve (loses all objections — defeats the ticket); building a new cross-round aggregate shape (out of scope, more surface, re-derivation risk).

**Carry mechanism?** **Chosen:** tracker-comment-first with committed-spec fallback (see §4.2). Rejected always-in-spec: it puts a machine block in every human spec and does not reuse graft's proven comment-first read; rejected a new attachment channel: net-new plumbing with no precedent.

**Anchor best-effort or required?** **Chosen:** best-effort append to `optionalFloorFiles` (see §4.4). Rejected required/conditionally-required: no robust at-anchor-time signal separates legitimate absence from a missing-evidence defect, so it would false-refuse the variable-lens, git-only, and outage-resumed cases.

**Merge-gate leg?** **Chosen:** none — audit-only (§2). Rejected adding a leg: graft does not re-run spec review, so there is nothing to fail-close against.

Temporal anchor: at the time of writing, FAFF-1155 (the required floor guard on ac-checklist.json + review-verdict.json) and FAFF-1156 are merged to origin/main; the build worktree is cut from that base.

## 7. Open Questions and Assumptions

**Open Questions:** none blocking.

**Assumptions:**

- **Assumes:** the FAFF-1155 `floor-incomplete` required guard and the `optionalFloorFiles` array both exist in `events.js` on the build base. Validation: `git show origin/main:plugin/skills/faff/bin/lib/events.js | grep -n 'floor-incomplete\|optionalFloorFiles'` before starting — confirmed present at ~1247 (guard) and ~1489 (array).
- **Assumes:** the spec-review round store writes `{verdict, objections}` verbatim to `$scratch/round-<n>.json` and the terminal seam retains `spec-review: approve` / `accept (judge, …)` on the spec. Validation: re-read `faff-prep/SKILL.md` "Loop cap" (round write) and "Retain the verdict on the spec" (terminal seam) before wiring §4.1 — confirmed on origin/main.
- **Assumes:** a git-only prep and graft for the same issue run on the same machine (the gitignored `.faff/specs/<issue-id>.md` spec store is machine-local). Validation: this is the existing git-only constraint — the spec itself does not cross machines in git-only mode — so the git-only evidence fallback inherits it and adds no new cross-machine guarantee. Cross-machine prep → graft is a tracker-mode pairing, where the tracker comment carries both the spec and its evidence.

## 8. DONE — Definition of Done

### From WHAT (contract + schema)
- [ ] `computeSpecReviewVerdict` preserves optional `disposition` (enum-checked against `REVIEW_DISPOSITIONS`, out-of-enum → violation naming the objection index, preserved verbatim), `refutation`, and `disposition_rationale` (free strings, preserve-when-present, no violation).
- [ ] The enum is `REVIEW_DISPOSITIONS` reused by reference in both the compute fn and the describe entry (no new literal).
- [ ] `spec-review-verdict.schema.json` per-objection object gains optional string `disposition`/`refutation`/`disposition_rationale`; `additionalProperties:false` + `required:["lens","severity"]` unchanged.
- [ ] A legacy `{lens, severity}`-only objection validates (exit 0); a disposition-bearing objection round-trips (exit 0); an out-of-enum disposition is `conformant:false` (exit 1); an unknown property fails `schemaCheck` (exit 2).
- [ ] `CONTRACT_DESCRIBES["spec-review-verdict"]` gains an `objections[].disposition` value (enum `REVIEW_DISPOSITIONS`, `lintable:false`, four-value semantics) and a `producer_notes`/`coercions` note for the free strings + the exit-1 out-of-enum disposition; `contract-describe.test.mjs` passes (semantics keys match the enum).
- [ ] contract-defs selftest fixtures cover: enriched-conformant, disposition-rationale-present, out-of-enum-disposition (exit 1), non-string-free-string-dropped.

### From HOW (prep)
- [ ] prep selects the evidence verdict (highest-`n` objection-bearing round in the window, else terminal approve verbatim), stamps dispositions mechanically per §4.1, re-validates through `faff contract spec-review-verdict`, and on non-conformance falls back to the bare `{verdict, objections}` record — never blocking.

### From HOW (carry)
- [ ] prep writes the evidence as a `## Spec-review evidence` tracker comment (comment-first), with a committed-spec fenced-block fallback for git-only; graft reads comment-first, spec-fallback, matching Step 4b.

### From HOW (graft)
- [ ] graft materialises `<run-dir>/<ISSUE>/spec-review-verdict.json` from the carried, conformant evidence, before Step 9b; a missing/unreadable/non-conformant source logs and skips without crashing.

### From HOW (anchor)
- [ ] `spec-review-verdict.json` is appended to `mintIssueAnchor`'s `optionalFloorFiles`; the FAFF-1155 required floor guard is unchanged; `events.test.mjs` selftest covers the floor-copy case (present → copied; absent → anchor minted unchanged).

### From WHY (principles)
- [ ] `spec-review-convergence.js` and `spec-review-churn.js` produce identical results with and without the new fields (new test); the pinned `spec-review-additive-invariant.test.mjs` (fixed-sha diff) still passes untouched.
- [ ] No new merge-floor leg or `readSpecReview` reader is added (`evaluateMergeFloorLeg` unchanged).

**Integration smoke test:**

```
1. Craft a two-round scratch: round-1.json {verdict:"revise", objections:[{lens:"architectural",severity:"major"}]},
   round-2.json {verdict:"approve", objections:[]}.
2. Run the prep evidence selection+stamping -> expect {verdict:"revise",
   objections:[{lens:"architectural",severity:"major",disposition:"fixed"}]}, conformant.
3. Carry it (tracker comment), run graft's materialise step -> expect <run-dir>/<ISSUE>/spec-review-verdict.json present.
4. Mint the per-PR anchor -> expect spec-review-verdict.json byte-copied into the anchor dir,
   floorNote lists it, and the mint exit code is 0.
```

confidence: high
build-tier: complex
spec-review: approve
