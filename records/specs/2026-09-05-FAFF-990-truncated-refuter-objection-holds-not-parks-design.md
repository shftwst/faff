## Revised spec (medium confidence · needs-decision-first) — attached 2026-09-04

# FAFF-990: a truncated refuter objection should hold and retry, not park as a config fault

> Revised 2026-09-04 — folds spec-review reject-approach objections (stderr-marker fragility + born-verifiability).

> Spec: faffter-dark-nlspec · 2026-09-04 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-990.

This spec is the build artifact for FAFF-990. Its audience is the coding agent that will implement the fix and the human reviewers gating it. It touches the L4 spec-review triple parser (`parse-refutation.mjs`), the shared fan-out transport (`fan-out.mjs`, one additive field), one exported marker in the shared call transport (`review-call.mjs`), and the occupant `SKILL.md` mapping; it leaves `aggregate.mjs` and `faff-prep` untouched by design.

## 1. Why

**The core model.** A spec-review refuter runs as an independent `review-call.mjs` pass whose exit-0 stdout is markdown findings. `parse-refutation.mjs` turns that markdown into the `objections[]` JSON `aggregate.mjs` votes on. Today the parser demands the full `{claim, evidence, predicted_consequence}` triple on every gating objection and fails loud on any missing field. When a backend truncates mid-response (the model spends its output budget and stops before finishing a bullet), the served content is still findings-shaped, so `review-call.mjs` exits 0, but the last objection is missing a field. The parser faults, the occupant records that fault as a `config-fault`, and `aggregate.mjs`'s transport floor rolls it to `needs-human`, which parks the epic. The correction: a truncated served response is a per-response model-quality transient, the exact thing the FAFF-232 fallback chain and the FAFF-900 outage-hold exist to ride out, not a configuration bug a human must fix.

**Problem statement.** A backend that serves a findings-shaped response but truncates a gating objection mid-field currently escalates a transient to a `config-fault` and parks the epic, masking the surviving lenses' real objections behind a park verdict. This change makes the parser use the fields a truncated objection did carry, and routes any residual parse fault that co-occurs with a truncation signal to the recoverable availability family instead of the config-fault floor. The result is a resumable hold that retries, not a park.

**Design principles.**

**A down or degraded refuter never silently approves, and never parks a transient.** The L4 exit-code discipline already forbids coercing an outage to `approve`. This change adds the symmetric rule: it also forbids coercing a per-response transient to `needs-human`. The only outcomes for a truncated objection are (a) use it in degraded form, or (b) route it to the swing-capable outage family that retries and holds.

**A cross-consumer signal must be structured and pinned, never a human sentence a downstream re-reads.** `review-call.mjs` and `fan-out.mjs` are reused verbatim by both the spec-review and code-review consumers. The truncation fact the transport already computes (`res.truncated`) reaches the spec-review classifier as a structured value: an exported machine marker the transport emits on its own stderr, which the shared fan-out layer resolves into a boolean field on each lens result. No downstream substring-matches a human-readable prose note, and no downstream re-derives `res.truncated` from a raw body. The transport learns no new grammar; it exports a fact it already holds.

**Reclassify downstream; change no aggregation or hold logic.** The fix lives in the spec-review-only parser and its occupant mapping, plus one additive field on the shared fan-out layer and one exported marker on the shared call transport. It changes no aggregation logic and no hold logic.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs` | Node (.mjs) | The triple parser this change relaxes, gives a new exit code, and teaches to emit the residual-fault lens record (with `kind`) on stdout |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Markdown prompt | The per-lens outcome mapping, reduced to plumbing: forward one boolean, record the parser's stdout verbatim |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (.mjs) | Detects truncation (`accumulateSse`/`accumulateAnthropic`, `res.truncated`); this change exports a machine marker and emits it on its own stderr line when truncated |
| `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` | Node (.mjs) | Carries each lens's `{lens, exit, stdout, stderr}` back to the occupant; this change adds one derived boolean field `truncated` |
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs` | Node (.mjs) | Transport floor: `infra-configured` down lens to `unavailable`; `config-fault` to `needs-human` (unchanged) |
| `plugin/skills/faff-prep/SKILL.md` | Markdown prompt | `disposition_unavailable`: `unavailable` to in-turn retry to resumable `faff-awaiting-spec-review` hold (unchanged) |
| `test/spec-refute-parse.test.mjs` | Node test | Parser coverage; one case's expectation changes, new cases added |
| `test/fan-out.test.mjs` | Node test | Fan-out coverage; new cases pin the `truncated` field and its spoof-resistance |

**Scope statement.** This is the `parse-refutation.mjs` analogue of FAFF-927 (the `review-call.mjs`/`fan-out.mjs` clean-vs-malformed classifier) and its review-bench sibling FAFF-905 (relaxed `shape()`), one layer downstream, acting on a partial triple rather than on no findings.

## 2. Out of scope

- **Making the transport chain advance on truncation.** What is excluded: changing `review-call.mjs`'s per-backend acceptance so a persistently-truncated exit-0 response advances the FAFF-232 fallback chain in-transport. Why excluded: it changes shared control flow the code-review consumer also depends on, with cross-consumer blast radius, and the recoverable outcome this ticket needs is already reachable by reclassifying downstream. Extension point: `runReviewChain`'s per-backend OK branch in `review-call.mjs` (the `if (exit === EXIT.OK)` region), gated on `result.truncated`. Captured as an open question below.

- **Biasing the outage retry toward a non-truncating backend.** What is excluded: making `disposition_unavailable`'s re-dispatch skip the backend that truncated. Why excluded: it reshapes the pin/chain resolution, a separate design. Extension point: `faff spec-review-pin --resolve` and `disposition_unavailable` in `faff-prep/SKILL.md`.

- **Raising or tuning `max_tokens`.** Why excluded: the issue states `max_tokens=12000` was not the root lever; the truncation was a per-response reasoning-budget behaviour on a specific backend. The budget-resolution logic in `faffter-dark-spec-review/SKILL.md` is untouched.

- **The review-bench `shape()` sibling.** Why excluded: FAFF-905 already relaxed clean-pass detection there (merged in #774). This ticket is the live spec-review path. Extension point: the review-bench harness under `plugin/skills/faffter-dark-adversarial-review`.

- **Changing the `spec-review-verdict` contract or `aggregate.mjs`'s gate.** Why excluded: the contract already validates a bare `{lens, severity}` objection, and the transport floor already routes `infra-configured` to `unavailable`. The fix feeds the existing floor the correct `kind`. Extension point: none needed.

- **Surfacing truncation into the stdout findings header.** What is excluded: stamping a `truncated` token into the `## Adversarial findings` header line `review-call.mjs` prepends. Why excluded: the header is covered by the transport's golden tests and is parsed by the code-review consumer, so a header change has cross-consumer blast radius the stderr-marker route avoids. Extension point: `ensureHeader`/`attributionHeader` in `review-call.mjs`.

## 3. What

**Vocabulary.**

| Term | Definition |
|---|---|
| Gating objection | A `### critical\|major\|minor` section; it makes the lens count as refuted |
| Observation | A `### observation` section; advisory, never gates |
| Identifying field | The one triple field that states what the objection is: `claim` |
| Enrichment field | `evidence`, `predicted_consequence`, `spec_anchor`; supporting detail a downstream judge reads |
| Degraded objection | A gating objection carrying `claim` (non-empty) but missing one or both enrichment triple fields; usable, not a fault |
| Truncation signal | `finish_reason === "length"` (OpenAI) or `stop_reason === "max_tokens"` (Anthropic), already detected in `review-call.mjs` as `res.truncated` |
| Truncation marker | A stable, exported machine string (`TRUNCATION_SIGNAL`) `review-call.mjs` writes on its own stderr line when `res.truncated`; consumed structurally, never as prose |
| Residual parse fault | A parse fault that survives the relaxed rules: a gating objection with no usable `claim` |

**Types.**

```
RECORD Objection:                      # unchanged shape; fewer fields now required
  severity: critical|major|minor|observation
  claim: string                        # REQUIRED on a gating objection (the identifying field)
  evidence?: string                    # carried when present+non-empty, else absent (enrichment)
  predicted_consequence?: string       # carried when present+non-empty, else absent (enrichment)
  spec_anchor?: string                 # carried when present+non-empty, else absent (unchanged)

RECORD LensResult:                     # fan-out.mjs output; one NEW derived field
  lens: string
  exit: int                            # the child review-call.mjs exit code (unchanged)
  stdout: string                       # the child's stdout (unchanged)
  stderr: string                       # the child's stderr (unchanged)
  truncated: boolean                   # NEW: true iff a line of stderr === TRUNCATION_SIGNAL

RECORD LensEntry:                      # what the occupant records per lens; sourced verbatim
  lens: string                         #   from parse-refutation.mjs stdout on exit 0/1/3
  outcome: "refuted"|"clear"|"unavailable"
  kind?: "config-fault"|"infra-configured"   # present only on an unavailable entry
  objections: List<Objection>
  model?: string

RECORD ParseFault:                     # reason widened; missing_field may name "claim"
  lens: string
  severity: string
  title: string
  missing_field: "claim"|null
  reason?: string
```

**`parse-refutation.mjs` exit codes and stdout.**

| Exit | Meaning | stdout | Occupant records the lens as |
|---|---|---|---|
| `0` | Parsed. Objections may be degraded | `RefutationEntry` JSON | the entry verbatim (`refuted`/`clear`) |
| `1` | Residual parse fault, no `--truncated` | `{lens, outcome:"unavailable", kind:"config-fault", objections:[]}` | that record verbatim |
| `3` (new) | Residual parse fault with `--truncated` | `{lens, outcome:"unavailable", kind:"infra-configured", objections:[]}` | that record verbatim |
| `2` | Usage (missing `--lens`, unreadable stdin) | (empty) | `unavailable`, `config-fault` (a real fault, unchanged) |

The parser now writes a machine record to stdout on a residual fault (exits 1 and 3), not an empty stdout, so the occupant records the parser's stdout verbatim on every exit 0/1/3 and performs no exit-to-`kind` judgement of its own. The human fault diagnostic still goes to stderr for the audit trail.

**Design decision: the identifying field is `claim` alone.** A gating objection is usable if and only if it carries a non-empty `claim`. `evidence` and `predicted_consequence` become enrichment: carried when present and non-empty, omitted otherwise, never a fault. Rationale: `aggregate.mjs` gates on `severity` alone and already carries partial triples (dropping absent or non-string fields); the refuter prompt already tells the model to write `not separately stated` when it cannot name a `predicted_consequence`, so a missing consequence was never a defect. **Chosen:** require `claim` only on a gating objection.

**Design decision: an absent enrichment field is omitted, not sentinel-filled.** When `evidence` or `predicted_consequence` is absent on a degraded objection, the parser omits the key rather than synthesising `"not separately stated"`. Rationale: `aggregate.mjs`'s `carryTriple` already copies only present strings, and a synthetic sentinel would falsely signal to the downstream judge that the model deliberately declared a taste-level objection. **Chosen:** omit absent enrichment fields.

**Design decision: a degraded (claim-only) objection still gates.** A gating section reduced to `claim` still counts as a refutation; it is not downgraded to `observation`. Rationale: the L4 discipline never silently weakens a refuter's opinion; a lens that named a real claim should gate, and the downstream judge weighs thin objections. **Chosen:** a degraded gating objection keeps its gating severity.

**Design decision: the truncation fact crosses as a structured signal, not a substring match on prose.** `review-call.mjs` exports a stable marker constant, `TRUNCATION_SIGNAL`, and writes it on its own stderr line when `res.truncated` (alongside, but separate from, the existing human note). `fan-out.mjs` imports that constant and sets `LensResult.truncated = true` when any stderr line, trimmed, equals it exactly. The occupant reads that boolean and passes `--truncated` to the parser. Rationale: the human note is no longer a contract, so rewording it for human reasons cannot break the classifier; the match is a line-anchored equality against a dedicated machine string, which no refuter-controlled stderr fragment can forge (every refuter-influenced stderr line is embedded after a transport-authored prefix such as `refuted: "…`, never a standalone token line); and truncation detection lives in one tested transport place, not in an LLM prompt. **Chosen:** exported `TRUNCATION_SIGNAL` plus a `LensResult.truncated` boolean plus occupant `--truncated`.

**Design decision: the parser names the `kind`; the occupant records verbatim.** On a residual fault the parser writes the full `{outcome:"unavailable", kind, objections:[]}` record to stdout, choosing `kind` from `--truncated` (present, exit 3, `infra-configured`; absent, exit 1, `config-fault`). The occupant records the parser's stdout verbatim for exits 0, 1 and 3. Rationale: the config-fault-versus-availability decision is deterministic, so it belongs in tested code, not in an LLM prompt the QA lens cannot pin; a fixture test asserts each exit's stdout `kind`, so the mapping is born-verifiable. **Chosen:** parser emits `kind` on stdout; occupant records verbatim.

**Design decision: reclassify to `infra-configured`, reusing the existing floor and outage machinery.** A truncation-signalled residual fault is recorded as `{outcome:"unavailable", kind:"infra-configured"}`. `aggregate.mjs`'s transport floor already maps a swing-capable `infra-configured` down lens to the `unavailable` verdict, and `faff-prep`'s `disposition_unavailable` already turns `unavailable` into a bounded in-turn retry and then a resumable `faff-awaiting-spec-review` hold. No change to either. Rationale: the ticket asks to route to the availability/fallback family and hold rather than park; `infra-configured` is the one swing-capable class that gets exactly that treatment. **Chosen:** record `infra-configured`, no `aggregate.mjs` or `faff-prep` change.

## 4. How

**Architecture and approach.** Four edits plus tests, one per layer:

1. `review-call.mjs`: export `TRUNCATION_SIGNAL`; when `res.truncated`, write it on its own stderr line next to the existing human note. No control-flow change, no exit-code change, no stdout change.
2. `fan-out.mjs`: import `TRUNCATION_SIGNAL`; add a derived boolean `truncated` to each `LensResult` (true iff a trimmed stderr line equals the marker). Additive field only; the four existing fields are untouched.
3. `parse-refutation.mjs`: relax gating-objection validation to require `claim` only; add the `--truncated`-gated exit 3 for a residual fault; on a residual fault, write the `{outcome:"unavailable", kind, objections:[]}` record to stdout.
4. `faffter-dark-spec-review/SKILL.md`: pass `--truncated` iff `LensResult.truncated`; record the parser's stdout verbatim on exits 0/1/3.

`aggregate.mjs` and `faff-prep/SKILL.md` are unchanged; the reclassified `kind` flows through their existing paths.

**Parser relaxation (the gating-section loop in `parseRefutation`).**

Behaviour summary: for each gating section, accept it if it carries a non-empty `claim`; carry whatever enrichment fields are present; fault only when `claim` is absent.

```
PROCEDURE parse_gating_section(section, lens):
  fields := parseBullets(section.body)          # unchanged bullet grammar
  claim := fields["claim"]
  1. IF claim is not a non-empty string:
       RETURN fault { lens, severity: section.severity, title: section.title,
                      missing_field: "claim" }
  2. obj := { severity: section.severity, claim: trim(claim) }
  3. FOR field IN ["evidence", "predicted_consequence"]:
       IF fields[field] is a non-empty string: obj[field] := trim(fields[field])
       # else: omit — do NOT synthesise a sentinel
  4. IF fields["spec_anchor"] is a non-empty string: obj.spec_anchor := trim(...)   # unchanged
  5. RETURN obj                                  # gating; counts as a refutation
```

The clean-refutation short-circuit (`CANONICAL_NO_FINDINGS`), the `sections.length === 0` and `severity == null` defensive faults, and the observation path all stay exactly as they are. Only the gating-field requirement changes: from all three of `claim`/`evidence`/`predicted_consequence` to `claim` alone. `parseRefutation` itself stays pure and grammar-only.

**CLI exit-code mapping and stdout record (truncation-aware).**

```
PROCEDURE main(argv):
  lens := required --lens (else exit 2)
  truncated := argv contains "--truncated"          # NEW flag
  content := read stdin (else exit 2)
  result := parseRefutation(content, lens)
  IF result.ok:
     write result.entry JSON to stdout; exit 0
  ELSE:                                              # residual fault
     kind := truncated ? "infra-configured" : "config-fault"
     write { lens, outcome: "unavailable", kind, objections: [] } to STDOUT   # NEW: record, not empty
     write human fault diagnostic to STDERR (lens, severity, title, missing_field, truncated)
     exit (truncated ? 3 : 1)                        # 3 -> availability family; 1 -> config-fault
```

Truncation (a transport property, not a grammar property) is applied at the CLI seam, exactly where `--lens` already is. The `kind` on stdout and the exit code are the same deterministic decision surfaced two ways, both code-emitted.

**Fan-out truncation field (`fan-out.mjs`).**

Behaviour summary: after a child exits, derive one boolean from its stderr and attach it; change nothing else.

```
PROCEDURE runOne_result(lens, exitCode, stdout, stderr):
  truncated := any line L of stderr has trim(L) === TRUNCATION_SIGNAL   # line-anchored EQUALITY
  RETURN { lens, exit: exitCode, stdout, stderr, truncated }
```

The match is a full-line equality against the imported constant, never a substring scan of the whole stderr blob. Every stderr line a refuter can influence is emitted after a transport-authored prefix (for example `refuted: "<title>" — …`), and a finding title is single-line, so refuter content can never appear as a standalone marker line. `fan-out.mjs` stays a transport concern: it surfaces a transport fact (`res.truncated`), it does not map any per-lens outcome (its existing anti-pattern note still holds).

**Transport marker export (`review-call.mjs`).**

Behaviour summary: name the marker once, emit it on truncation, change no control flow.

```
export const TRUNCATION_SIGNAL = "[faff:truncated]"    # dedicated machine line; stable, consumed

# in main(), the existing res.exit === EXIT.OK arm:
IF res.truncated:
   write "[note] response truncated at token budget even after retry; findings may be partial" to stderr   # human, unchanged wording, no longer a contract
   write TRUNCATION_SIGNAL + "\n" to stderr                                                                 # NEW machine line, the contract
```

The human note stays for humans and may be reworded freely; the exported constant is the only thing any consumer matches. No exit code, stdout, or chain behaviour changes, so the code-review consumer and the transport's logic golden tests are unaffected; the marker line is additive stderr.

**Occupant per-lens mapping (`faffter-dark-spec-review/SKILL.md`, the exit-0 arm).**

Behaviour summary: forward the fan-out boolean, then record the parser's stdout verbatim.

```
PROCEDURE record_exit0_lens(lensResult):            # lensResult = {lens, exit:0, stdout, stderr, truncated}
  run: printf '%s' "$stdout" | parse-refutation.mjs --lens <lens> [--truncated if lensResult.truncated]
  CASE parser exit:
    0 / 1 / 3 -> record the parser's STDOUT verbatim as this lens's entry
    2 / other -> { lens, outcome: "unavailable", kind: "config-fault", objections: [] }   # a real fault
  write the parser's stderr diagnostic into $pin_dir/round-<n>-<lens>.md (audit trail),
    noting truncated=<lensResult.truncated> so a hold is distinguishable from a genuine config fault
```

The occupant no longer reads any stderr string itself and performs no exit-to-`kind` judgement; both were the untestable prose the prior review rejected. The `review-call.mjs` exit-code table rows (exit `5`/`12`, `6`/`2`/`4`/`7`) are untouched; only the exit-0 sub-branch that runs `parse-refutation.mjs` changes.

**Edge cases and error handling.**

- A truncated response whose gating objection is nonetheless complete (the cut fell after `predicted_consequence`, or the objection needed no consequence): parses exit 0, `refuted`; `--truncated` is irrelevant. No hold, no wasted retry.
- A truncated response cut mid-`claim` (claim empty or absent): residual fault, `--truncated` set, exit 3, stdout `infra-configured`, held and retried.
- A non-truncated response with a gating section that has a severity heading but no `claim` bullet (genuinely malformed): residual fault, no `--truncated`, exit 1, stdout `config-fault`, `needs-human` (unchanged behaviour).
- A genuinely structureless response with no recognised `### <severity>` section never reaches `parse-refutation.mjs`: `review-call.mjs` classifies it `MALFORMED`/`EXIT.NO_FINDINGS_CONTENT` and advances or exhausts its chain as today (unchanged).
- Multiple down lenses where one is a real `config-fault` and another is a truncation `infra-configured`: `aggregate.mjs`'s floor checks `config-fault` first, so a genuine config fault still parks (correct); a pass with only truncation-`infra-configured` down lenses holds.
- A refuter names a finding `### major: response truncated at token budget` so that string lands in a `refuted: "…"` stderr line: `LensResult.truncated` stays false, because the marker is matched as a whole trimmed line equal to `TRUNCATION_SIGNAL`, never as a substring of the `refuted:` line.

**Failure modes.**

- **The failure:** the `claim`-only rule is too permissive and a lens refutes on a meaningless partial claim, over-blocking specs. **How you'd know:** an uptick in `revise`/`reject-approach` verdicts whose carried objection `claim` is a truncated fragment, visible in `round-<n>-<lens>.md` transcripts. **What it means:** narrow. A degraded objection still routes to autonomous re-slice/revise (L4) or a fixable `revise`, never a silent approve or a park, so the direction of the error is safe; if it bites, add a minimum-length or sentence-shape guard on `claim`. Not adopted pre-emptively (precision-over-recall would reintroduce the void-the-lens behaviour this ticket removes).
- **The failure:** the marker constant is renamed on one side only, so `fan-out.mjs` stops setting `truncated` and truncation faults silently revert to `config-fault`/park. **How you'd know:** the fan-out drift test fails in CI, because it imports the exact constant from `review-call.mjs` and asserts fan-out sets `truncated` on a marker line built from it; a rename on either side breaks the shared import or the assertion before any spec run. **What it means:** the marker is a real contract with a single source (the exported constant) and a concrete oracle (the test below), so drift fails CI, not production.

**Anti-pattern:** synthesising `predicted_consequence: "not separately stated"` for an absent field. Why: it fakes a deliberate taste-level signal the model never gave, misleading the downstream judge; omit the key instead.

**Anti-pattern:** matching truncation with a substring scan over the whole `LensResult.stderr` blob, or re-reading `finish_reason` from a raw body. Why: a substring scan is spoofable by refuter-controlled stderr fragments and couples to human prose; match a whole trimmed stderr line against the exported `TRUNCATION_SIGNAL` instead, and let `fan-out.mjs` do it once.

**Anti-pattern:** having the occupant prompt decide `config-fault` versus `infra-configured` from the parser exit code. Why: that decision is deterministic and belongs in tested code; the parser emits the `kind` on stdout and the occupant records it verbatim.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a served, findings-shaped infosec refutation whose only gating (major) objection
      carries a claim and a partial evidence bullet but no predicted_consequence,
      and review-call.mjs exited 0 having emitted the TRUNCATION_SIGNAL stderr line
When fan-out sets LensResult.truncated true and the occupant runs
      parse-refutation.mjs --lens infosec --truncated on that stdout
Then the parser exits 0 with a refuted entry whose objection carries {severity: major, claim, evidence}
      and no predicted_consequence key,
      and the lens is recorded as refuted (not unavailable, not config-fault)
```

```
Given a served, findings-shaped QA refutation truncated mid-claim so the gating section
      has a severity heading but no non-empty claim, with the TRUNCATION_SIGNAL line on stderr
When fan-out sets LensResult.truncated true and the occupant runs
      parse-refutation.mjs --lens QA --truncated
Then the parser exits 3 and writes {lens: QA, outcome: "unavailable", kind: "infra-configured", objections: []} to stdout,
      and the occupant records that stdout verbatim,
      and aggregate.mjs returns the unavailable verdict (not needs-human) when that missing vote could swing,
      and faff-prep enters disposition_unavailable (in-turn retry, then a resumable faff-awaiting-spec-review hold)
```

```
Given a non-truncated served response whose gating section has a severity heading and bullets
      but no claim bullet, so review-call.mjs emitted no TRUNCATION_SIGNAL line and fan-out set truncated false
When the occupant runs parse-refutation.mjs --lens architectural   (no --truncated)
Then the parser exits 1 and writes {lens: architectural, outcome: "unavailable", kind: "config-fault", objections: []} to stdout,
      and the lens is recorded from that stdout verbatim,
      and aggregate.mjs returns needs-human (a genuinely malformed objection still parks, as today)
```

```
Given a refuter that names a finding "### major: response truncated at token budget", so its title
      appears inside a review-call.mjs `refuted: "…"` stderr line, but no standalone TRUNCATION_SIGNAL line
When fan-out derives LensResult.truncated from that stderr
Then LensResult.truncated is false (the marker is a whole-line equality, not a substring),
      so a compromised or adversarial refuter cannot force the recoverable hold path
```

## 6. Design decision rationale

**Which triple fields must a gating objection carry?** Options: (a) all three, as today, voiding the lens on any gap; (b) `claim` plus `evidence`; (c) `claim` alone. (a) is what parks a transient. (b) still faults on the FAFF-990 symptom if the cut fell before `evidence`. (c) uses whatever the objection carried and never voids a lens over enrichment. **Chosen:** (c), require `claim` only. `aggregate.mjs` gates on `severity` and already tolerates partial triples; the refuter prompt already treats `predicted_consequence` as optionally `not separately stated`.

**Absent enrichment field: omit or sentinel-fill?** Options: omit the key; or write `"not separately stated"`. **Chosen:** omit. `carryTriple` copies only present strings, and a synthetic sentinel would misrepresent a truncated gap as a deliberate taste-level declaration.

**Does a claim-only objection gate, or drop to observation?** Options: keep its gating severity; or downgrade to advisory. **Chosen:** keep gating. L4 never silently weakens a refuter; the safe direction of error is to gate (route to revise/re-slice), never to approve.

**How does the truncation fact reach the classification?** Options: (a) the occupant substring-matches `review-call.mjs`'s human stderr sentence and passes `--truncated`; (b) the transport stamps `truncated` into the stdout `## Adversarial findings` header, which `parse-refutation.mjs` already parses; (c) `review-call.mjs` exports a dedicated machine marker `TRUNCATION_SIGNAL`, emits it on its own stderr line, and `fan-out.mjs` resolves it into a `LensResult.truncated` boolean the occupant forwards. **Chosen:** (c). The prior review rejected (a): the human sentence is shared across the spec-review and code-review consumers, so rewording it for human reasons silently breaks a spec-review-only decision, and a substring scan over the stderr blob is forgeable by refuter-controlled `refuted:` lines. (b) is single-source but changes the header the transport's golden tests pin and the code-review consumer parses, so it carries cross-consumer blast radius. (c) consumes the structured fact the transport already computes (`res.truncated`), makes the only match a line-anchored equality against an exported constant (unforgeable, and pinned by a shared import), and keeps the shared header and control flow untouched; the added stderr line and the added `LensResult` field are both additive.

**A new exit code (3) or reuse an existing one?** Options: reuse exit 1 and have the occupant pick the `kind` from a stderr judgement; or mint exit 3 for the truncation-routed fault. **Chosen:** exit 3, and the parser also writes the `kind` on stdout. The exit code and the stdout `kind` are one deterministic decision surfaced twice, both code-emitted and both testable; the occupant records stdout verbatim rather than judging the exit in prose.

**Who names `config-fault` versus `infra-configured`, and where is it tested?** Options: the occupant maps the parser exit to a `kind` in prose; or the parser writes the `kind` on stdout and the occupant records it verbatim. **Chosen:** the parser writes it. The prior review's QA lens rejected the prose mapping because no test can pin an LLM prompt's exit-to-`kind` decision; moving the decision into the parser makes it a fixture-tested code path.

**Where does the recoverable behaviour come from?** Options: build a new hold/retry path; or reclassify to `infra-configured` and reuse the shipped floor and `disposition_unavailable`. **Chosen:** reclassify and reuse. `aggregate.mjs` already routes swing-capable `infra-configured` to `unavailable`, and `faff-prep` already turns that into bounded retry then a resumable `faff-awaiting-spec-review` hold. No new machinery.

**Should the transport fail over its own chain on persistent truncation?** At the time of writing, `review-call.mjs` accepts a truncated exit-0 response as the chain winner (a truncated findings-shaped body is `EXIT.OK`) and does not advance. Making it advance on `res.truncated` after its 2x retry would be the truest reading of "fail over to the next ref", but it changes shared-transport semantics the code-review consumer also depends on. **Punt:** (a) reclassify downstream and reuse the outage machinery (this spec) or (b) also advance the transport chain on persistent truncation — needs human (decides: architecture).

## 7. Open questions and assumptions

**Open questions.**

- **Transport-level chain advance on persistent truncation.** Should `review-call.mjs`'s per-backend OK branch advance the FAFF-232 chain when `res.truncated` survives its 2x retry, so the fail-over happens in-transport rather than only via the `faff-prep` outage retry? This spec chooses downstream reclassification (no shared-transport control-flow change). The alternative is truer to "fail over to the next ref" but has cross-consumer blast radius. Context for the caller: the downstream route already delivers a resumable hold and satisfies every acceptance criterion; the transport route is an optimisation, not a correctness gap. **Punt:** (a) downstream reclassify or (b) transport chain-advance — needs human (decides: architecture).

**Assumptions.**

- **Assumes:** the `unavailable`/`infra-configured` outage machinery exists and is wired. `aggregate.mjs`'s transport floor maps a swing-capable `infra-configured` down lens to the `unavailable` verdict, and `faff-prep/SKILL.md`'s `disposition_unavailable` turns `unavailable` into a bounded in-turn retry then a resumable `faff-awaiting-spec-review` hold (store `.faff/resume/<issue>/spec-review-hold.json`), escalating to `needs-human` only after the hold limit. Validation: confirmed present in `aggregate.mjs` (the `unavailable.length > 0 && !forcedReject` branch and its selftest) and in `faff-prep/SKILL.md` (the `Spec-review-outage disposition` section and the `spec-review-held` return); the build agent should re-read both before relying on the reclassification and change neither.

- **Assumes:** `main(argv, { runReviewFn, checkFn })` in `review-call.mjs` stays exported and injectable. The present/absent marker tests drive it with an injected `runReviewFn` that returns `{status:"ok", content:<findings-shaped>, truncated:true|false}` and capture stderr; this is how the emission is tested without a live model. Validation: confirmed exported and injectable at `review-call.mjs`'s `export async function main(argv, { runReviewFn = runReview, checkFn = realCheck })`; the build agent should re-confirm before writing the test.

## 8. Done

### From why
- [ ] A findings-shaped served response whose gating objection is missing a non-identifying triple field (`predicted_consequence`, or a `predicted_consequence` plus `evidence`) is no longer recorded as `config-fault`; the objection is used in degraded form.

### From what (types and exit codes)
- [ ] `parseRefutation` accepts a gating objection carrying a non-empty `claim` and omits absent `evidence`/`predicted_consequence` keys (no synthetic sentinel).
- [ ] `parseRefutation` still faults when a gating section has no non-empty `claim`, with `missing_field: "claim"`.
- [ ] `parse-refutation.mjs` exits 0 on a parsed (possibly degraded) entry, 1 on a residual fault without `--truncated`, 3 on a residual fault with `--truncated`, 2 on usage errors.
- [ ] On a residual fault the parser writes `{lens, outcome:"unavailable", kind, objections:[]}` to stdout, with `kind` = `config-fault` (exit 1) or `infra-configured` (exit 3); the human diagnostic stays on stderr.
- [ ] A degraded (claim-only) gating objection retains its gating severity and makes the lens `refuted`.

### From what (fan-out and marker)
- [ ] `review-call.mjs` exports `TRUNCATION_SIGNAL` and writes it on its own stderr line when `res.truncated`; the existing human note is unchanged and no transport control-flow, exit code, or stdout changed.
- [ ] `fan-out.mjs` imports `TRUNCATION_SIGNAL` and adds `truncated` to each `LensResult`, true iff a trimmed stderr line equals the marker; the four existing `LensResult` fields are unchanged.
- [ ] `LensResult.truncated` is false when the marker string appears only inside a `refuted: "…"` stderr line (whole-line equality, not substring).

### From how (behaviour)
- [ ] The occupant passes `--truncated` to `parse-refutation.mjs` exactly when `LensResult.truncated` is true, and records the parser's stdout verbatim on exits 0/1/3.
- [ ] `aggregate.mjs` and `faff-prep/SKILL.md` are unchanged; a truncation-`infra-configured` pass yields the `unavailable` verdict and a resumable `faff-awaiting-spec-review` hold, not `needs-human`.

### From how (edge cases)
- [ ] A truncated-but-complete gating objection parses exit 0 `refuted` with no hold.
- [ ] A genuinely malformed (no `claim`, no truncation) gating objection still yields `config-fault`/`needs-human`.
- [ ] A pass mixing a real `config-fault` lens with a truncation-`infra-configured` lens still parks (config-fault floor wins).

### Coverage note
- [ ] Tests exercise the live spec-review path (`parse-refutation.mjs` exit codes and stdout `kind`, plus the marker's structured detection), not only the review-bench `shape()` sibling. This change adds no new LLM-judgement grader (every decision is deterministic code), so no eval-case registration is required.
- [ ] `test/spec-refute-parse.test.mjs` is updated: the case asserting that a missing `predicted_consequence` "fails loud" now asserts a degraded exit-0 parse; new cases cover the claim-only gate, omit-not-sentinel, the `--truncated` exit-3 split, and the residual-fault stdout `kind` on exits 1 and 3.
- [ ] `test/fan-out.test.mjs` is updated with the marker-pin and spoof cases: importing `TRUNCATION_SIGNAL` from `review-call.mjs`, it asserts (a) a stderr containing a standalone marker line sets `truncated` true, (b) a stderr with no marker line sets it false, and (c) a stderr whose only occurrence of the marker string is inside a `refuted: "…"` line sets it false. The shared import is the single source, so a rename on either side fails CI.
- [ ] A `review-call.mjs` test drives the exported `main()` with an injected `runReviewFn` returning `truncated:true` and asserts a standalone `TRUNCATION_SIGNAL` stderr line is emitted, and with `truncated:false` asserts no such line is emitted (the present and absent halves).

### Integration smoke test
```
1. Build a fixture = HEADER + a "### major" section with claim + partial evidence, no predicted_consequence.
2. printf fixture | node parse-refutation.mjs --lens infosec --truncated
   -> expect exit 0, JSON objection {severity: major, claim, evidence}, no predicted_consequence key.
3. Build a fixture whose "### major" section has a heading but no claim bullet.
4. printf fixture | node parse-refutation.mjs --lens infosec --truncated
   -> expect exit 3, stdout {lens: infosec, outcome: "unavailable", kind: "infra-configured", objections: []}.
5. Same fixture, no --truncated
   -> expect exit 1, stdout {lens: infosec, outcome: "unavailable", kind: "config-fault", objections: []}.
6. Run fan-out over one request whose child prints a standalone TRUNCATION_SIGNAL line on stderr
   -> expect that LensResult.truncated === true; a child with no such line -> false.
7. Feed [{lens:QA,outcome:unavailable,kind:infra-configured,objections:[]}, three clear] to aggregate.mjs --n 4
   -> expect verdict "unavailable" (not "needs-human").
If steps 2-7 hold, the parser, its exit/stdout split, the fan-out marker field, and the transport floor are connected.
```

confidence: medium
build-tier: standard
spec-review: pending

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "punt" }, { "marker": "assumes" }
  ] }
```