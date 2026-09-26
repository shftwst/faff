# FAFF-1078: Non-blocking Punt tag, teaching routing to tell a blocking open Punt from a deferred one

> Spec: faffter-dark-nlspec · 2026-09-26 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1078.
> Revised 2026-09-26 (re-prep) — narrowed to root cause (a) only; the repeat-park-collapse half (root cause (b)) dropped to OUT OF SCOPE per operator decision, delegated to the existing repeat-parked detector. Vocabulary renamed load-bearing → blocking/non-blocking throughout.
> Revised 2026-09-26 (spec-review round 1, revise → in-place fixes): (1) OUT OF SCOPE crossref extractor rewritten to match the real producer formats (skip the reserved `Why excluded`/`Extension point` sub-label bullets; handle the flat trailing-period form) — closes the under-gate + the inert-on-own-format defect; (2) added the no-fail-open invariant; (3) repointed Assumption #3 to `computeSpecReviewVerdict`.
> Revised 2026-09-26 (spec-review round 2, revise → in-place fix): simplified the no-fail-open invariant to rest on the existing sticky-design-lens floor alone (≥1 design lens always vets before routing); removed the ungrounded `design_lens_vetted` routing fail-safe (the signal had no home in routing's inputs). No new signal, no routing-side re-classification.

This is the buildable nlspec for FAFF-1078. Its audience is the build agent that will implement the change and the human reviewers who gate it. It specifies **root cause (a) only** of FAFF-1078: the routing verdict cannot distinguish a *blocking* open `**Punt:**` from an explicitly-deferred, *non-blocking*, out-of-scope one, so any open Punt drags a spec to `confidence: medium` and routes it `needs-decision-first`. Root cause (b), the nightly repeat-park re-nag, is out of scope here and stated as deferred below.

## 1. WHY: Problem and Principles

**The mechanism this turns on.** Today a Punt is a single, undifferentiated signal: its mere presence is read as "a human must decide before this can build". That is true of a *blocking* Punt (an unresolved decision the increment depends on) but false of a *non-blocking* one (a decision the spec has explicitly pushed out of scope and does not depend on). This change adds a deterministic, out-of-band-vetted way to mark the second kind and a pure parser that reports it, so routing stops treating a settled non-goal as an open decision. Nothing in the readiness contract changes: the tag is a display and routing signal read from the parsed Punt markers, exactly as FAFF-356's `(decides: <owner>)` suffix is.

**Problem statement.** `/faff-beep-boop` (L3 autonomous) re-parks specs that are fully settled except for one open Punt the spec itself marks out of scope and non-blocking on the increment. The routing verdict has no way to tell that Punt from a blocking one, so it forces `confidence: medium` and assigns `needs-decision-first`, then the failed autonomous resolve-attempt parks the spec. This change gives the Punt a bare `(non-blocking)` tag, a deterministic scanner that reports which Punts are genuinely non-blocking, and narrows the routing rule to fire only on a *blocking* open Punt.

**Design principles.**

- **The tag is display metadata, never a readiness field.** A tagged and an untagged Punt both emit `{ "marker": "punt" }` into the `faff-contract:spec-readiness` block. This is the FAFF-356 precedent verbatim: `(decides:)` added no contract field, and neither does this. The scanner is a separate, downstream read of the parsed markers.
- **Eligibility is two deterministic facts, never an author's say-so.** A Punt is eligible to be treated non-blocking only when both hold: it carries the `(non-blocking)` tag *and* it is cross-referenced under the spec's OUT OF SCOPE section. The bare tag alone never suffices. This stops a producer waving a Punt through by tagging it.
- **The build agent never certifies its own tag.** Whether a tagged Punt is *genuinely* non-blocking is a judgement, and that judgement belongs to the spec-review adversarial lenses (a structurally-separate model in an isolated context, running before routing), not to the producer that wrote the tag nor to an LLM re-read inside routing. Routing consumes only the deterministic scanner output.
- **A tagged Punt is never consumed unvetted (the no-fail-open invariant).** `faff punt-scan`, the producer self-rating exclusion, and the routing narrowing all run *unconditionally*, but *which* spec-review lenses fire is a cost-gated upstream decision — so the tag-honesty backstop must not be droppable underneath the eligibility mechanism it guards. The invariant "a spec bearing any `(non-blocking)` tag has had ≥1 design lens (`architectural`/`infosec`/`QA`) vet it before routing treats that tag as non-blocking" **holds by construction from the existing lens-selection floor**: `infosec`+`QA` are sticky at L1–L3 (`faff-prep/SKILL.md`, the lens-selection cost-gate) and L4 is pinned to the full design set, so at every autonomy level ≥1 design lens always fires on every spec — a tagged one included — before routing runs (routing is a later, separate `/faff-tidy` pass). This is stated as an **explicit, documented invariant** so a future change to lens-selection that could drop all design lenses is recognised as breaking it; it requires **no new code, no tag-detection inside lens-selection, and no new routing signal** — routing reads `blocking_open_count` directly. (An earlier draft added a routing-side re-classification keyed on a `design_lens_vetted` signal; that signal has no home — routing's inputs are spec confidence + markers + backlog-diagnostics + park history, with no wire from the spec-review outcome — so it is dropped in favour of resting on this construction invariant.)
- **Do not punch through the appetite floor.** Narrowing the Punt leg of `needs-decision-first` must not loosen its other leg. A spec at `confidence: medium` for a reason unrelated to Punt severity (for example a security claim that floors the human-glance appetite) must keep routing `needs-decision-first`. The fix removes a spurious reason, not a legitimate one.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/contract-defs.js` (`computeSpecReadiness`, the `spec-readiness` fixtures ~line 2524) | Node (CommonJS) | The readiness contract this change leaves untouched; the FAFF-356 comment there states the `(decides:)`-suffix rule this tag parallels. |
| `plugin/skills/faff/bin/lib/park-history.js` | Node (CommonJS) | The existing repeat-park detector. Confirmed UNCHANGED by this spec. |
| `plugin/skills/faff/bin/lib/heading-slug.js` (`headingText`, `headingSlug`) | Node (CommonJS) | The house slug rule the scanner reuses for its topic and OUT OF SCOPE crossref keys, rather than inventing a second normaliser. |
| `plugin/skills/faff/bin/lib/park-verdict.js` | Node (CommonJS) | A representative small, pure, `--selftest`-carrying subcommand module the new `punt-scan` module mirrors in shape. |
| `plugin/skills/faff/bin/faff` (the `COMMANDS` registry) | Node (CommonJS) | Where the new `punt-scan` subcommand is wired. |
| `plugin/skills/faffidavit-routing/SKILL.md` (the `needs-decision-first` row) | Markdown prose | The routing assignment row this change narrows. |
| `plugin/skills/faffter-noon-spec/SKILL.md`, `plugin/skills/faffter-dark-nlspec/SKILL.md` | Markdown prose | The two producer confidence self-rating rules this change amends. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` (the four refuter lenses) | Markdown prose | The out-of-band judge of tag honesty; its design refuters gain a line to challenge an unwarranted tag. |
| `docs/guide/cli.md` (the CLI surface table) | Markdown prose | The lint-enforced surface doc every subcommand must appear in (`faff lint-cli-doc`). |

**Scope statement.** This sits at the prep/routing seam: a producer emits the tag, spec-review vets it, the deterministic `faff punt-scan` reports it, and the `routing_adaptor` reads that report when assigning `needs-decision-first`.

## 2. OUT OF SCOPE

- **Standing-park / repeat-park collapse.** What's excluded: any per-reason park-collapse mechanism (a `reason_fingerprint`, a per-reason standing surface, or any addition to `park-history.js` for fingerprinting). Why excluded: root cause (b) is dropped. The existing `repeat-parked` detector already collapses the nightly re-park noise (`faff park-history`: 3 or more same-root-cause-class parks in a rolling 21 days demotes Todo to Backlog and emits the `repeat-parked` verdict with no resolve-attempt and one standing surface in `/faff-wtf`), and Fix A here removes the spurious Punt reason so fewer specs park at all. Extension point: if a per-reason (rather than per-class) collapse is ever wanted, it is a separate future ticket. It carries an unresolved identity-key design question, which is exactly why it is deferred: a mechanical topic key is order-independent but not wording-independent, so per-reason collapse needs either a coarser per-class identity (already shipped) or an authored stable key. That open question is not answered here.
- **`park-history.js` changes of any kind.** What's excluded: the repeat-park detector's window, threshold, root-cause enum, writer, or reader. Why excluded: this change routes fewer specs into `needs-decision-first` but adds nothing the detector reads or writes. Extension point: none needed; the module stays byte-for-byte as it is.
- **The `confidence: medium` leg of the `needs-decision-first` routing rule.** What's excluded: any loosening of the second assignment leg. Why excluded: a `confidence: medium` rating earned for a non-Punt reason (a security claim flooring the appetite, thin rationale) is a legitimate human-call signal that must keep routing `needs-decision-first`. This is the deliberate non-fix. Extension point: none; it is preserved by construction.
- **Detection of *which* lenses fire, and the spec-review verdict shape.** What's excluded: the change-surface logic that selects the enabled lens set, and the `faff-contract:spec-review-verdict` schema. Why excluded: the tag-honesty judgement rides the existing verdict as an ordinary objection; no new contract field is introduced. Extension point: `plugin/skills/faffter-dark-spec-review` if a dedicated tag-rejection signal is ever wanted.

## 3. WHAT: Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| blocking Punt | An open `**Punt:**` the increment depends on: an unresolved decision that must be made before the work can proceed. Routing must gate on it. |
| non-blocking Punt | An open `**Punt:**` the spec has explicitly deferred and does not depend on for this increment. Routing must not gate on it. |
| `(non-blocking)` tag | The bare, argument-free suffix on a `**Punt:**` line that asserts the Punt is non-blocking. Syntactically parallel to and independent of `(decides: <owner>)`, and order-independent with it. |
| out-of-scope crossref | The deterministic fact that a Punt's topic names an item listed under the spec's OUT OF SCOPE section. One of the two facts required for eligibility. |
| eligible (Punt) | A Punt for which both `non_blocking == true` and `out_of_scope_crossref == true`. Only an eligible Punt may be treated as non-blocking by routing and by the producer self-rating. |

Note on naming: the concept pair is deliberately "blocking" / "non-blocking". The tag literal is `(non-blocking)`, the parsed field is `non_blocking`. This pair is kept distinct from the dependency-necessity term the resolve-attempt tables already use for a different concept, so the two never collide.

**The tag literal.** A bare, argument-free `(non-blocking)` suffix on a `**Punt:**` line. It is syntactically parallel to and independent of the existing `(decides: <owner>)` suffix, and order-independent with it. All of these parse identically:

```
**Punt:** X or Y — needs human (decides: architecture) (non-blocking)
**Punt:** X or Y — needs human (non-blocking) (decides: architecture)
**Punt:** X or Y — needs human (non-blocking)
```

**Parsed types.**

```
RECORD PuntMarker:
  topic: String                 # the Punt's substantive text, both recognised suffix
                                #   parens removed and surrounding whitespace/dashes trimmed
  decides: String | null        # the (decides: <owner>) owner token, or null when absent
  non_blocking: Boolean         # true iff a bare (non-blocking) suffix is present on the line
  out_of_scope_crossref: Boolean # true iff `topic` names an OUT OF SCOPE item (see HOW)
  eligible: Boolean             # DERIVED: non_blocking AND out_of_scope_crossref

RECORD PuntScanResult:
  punts: PuntMarker[]           # one per **Punt:** line, in document order
  eligible_count: Integer       # count of punts where eligible == true
  blocking_open_count: Integer  # count of punts where eligible == false (the routing-relevant count)

  CONSTRAINT eligible_count + blocking_open_count == length(punts)
```

**CLI surface.**

```
faff punt-scan <spec-file>          # prints PuntScanResult as JSON to stdout; exit 0
faff punt-scan --selftest           # runs the baked fixture table; exit 0 pass / 1 fail
```

- Pure and deterministic: same input bytes, same output. No LLM ever reads or copies marker bytes.
- Exit 2 on a missing/unreadable spec file (fail-loud, mirroring `faff tier`).
- Read-only. No tracker access, no mutation, no ambient clock.
- Zero-dependency Node CommonJS module under `plugin/skills/faff/bin/lib/`, wired into the `COMMANDS` registry in `plugin/skills/faff/bin/faff`, exactly like the other deterministic tools.
- Registering a subcommand is more than the `COMMANDS` entry: it must also appear in `plugin/skills/faff/bin/lib/regions.js`'s `REGION_MAP` (a `region:factory` classification; `faff regions check` asserts a COMMANDS bijection) and `REGION_SELFTEST_ARGV` (`["punt-scan", "--selftest"]`; a `REGION_MAP` command missing here fails `faff regions selftest`), and in `docs/guide/cli.md` (so `faff lint-cli-doc` and the `faff lint-cli-coverage` `--selftest`-coverage gate pass).

**Readiness contract (unchanged).** `faff punt-scan` and the `(non-blocking)` tag add NO field to the `faff-contract:spec-readiness` extraction JSON or to `plugin/skills/faff/contracts/spec-readiness.schema.json`. A tagged and an untagged Punt both still emit `{ "marker": "punt" }`.

**Design decision.** See DESIGN DECISION RATIONALE for the bare-vs-argument tag choice, the two-fact eligibility rule, the crossref matching rule, and the ownership of the tag-honesty judgement. Each is closed with a `**Chosen:**` marker there.

## 4. HOW: Behaviour

**Architecture and approach.** Four seams change, in dependency order:

```
producer (writes tag)  →  spec-review lens (vets tag honesty, out-of-band)  →  faff punt-scan (parses)  →  routing_adaptor (reads scan, assigns verdict)
                                                                                     ↑
                                                                producer self-rating also reads scan
```

1. **`faff punt-scan`** parses the spec file into a `PuntScanResult`. Pure, deterministic, no judgement.
2. **The producer confidence self-rating** (both producers) excludes eligible Punts from the Punt count the `medium` heuristic weighs.
3. **The spec-review design lenses** challenge whether each `(non-blocking)`-tagged, out-of-scope Punt is genuinely deferrable. An unwarranted tag is an ordinary gating objection on the existing spec-review verdict, caught before promote-to-build.
4. **The `routing_adaptor`** runs `faff punt-scan` and reads its structured output; the `needs-decision-first` Punt leg fires only on a Punt where `eligible == false` (a blocking open Punt).

**`faff punt-scan` parsing (the fixed regex table).**

```
PROCEDURE punt_scan(spec_text):
  1. oos_names := extract_out_of_scope_item_keys(spec_text)   # see below
  2. punts := []
  3. FOR each line matching /^\s*\*\*Punt:\*\*\s*(.+)$/:
     a. rest := capture group 1
     b. non_blocking := rest matches /\(non-blocking\)/          # bare, argument-free
     c. decides := first capture of /\(decides:\s*([^)]+)\)/ , trimmed, or null
     d. topic := rest with every recognised suffix paren removed
                   ( /\(non-blocking\)/ and /\(decides:[^)]*\)/ ),
                 then leading/trailing whitespace and '—'/'-' runs trimmed
     e. crossref := any k in oos_names where slug_token_run_contains(headingSlug(topic), k)
     f. eligible := non_blocking AND crossref
     g. append PuntMarker{ topic, decides, non_blocking, out_of_scope_crossref: crossref, eligible }
  4. RETURN PuntScanResult{ punts,
                            eligible_count: count(eligible),
                            blocking_open_count: count(NOT eligible) }
```

Suffix recognition is order-independent: steps (b), (c), (d) each scan the whole `rest`, so `(decides:) (non-blocking)` and `(non-blocking) (decides:)` yield identical `PuntMarker`s. Only these two paren forms are stripped from `topic`; any other parenthetical in the Punt prose is left in the topic text.

**OUT OF SCOPE crossref (the deterministic key match).**

```
PROCEDURE extract_out_of_scope_item_keys(spec_text):
  1. Locate the first heading whose text slugs to contain "out-of-scope"
     (case-insensitive; any heading level, matching both `## OUT OF SCOPE`
     and `### 2. OUT OF SCOPE`).
  2. Collect that section's body up to the next heading of the same-or-higher level.
  3. FOR each top-level list item that opens with a bold span `- **<lead>**`:
       a. name := <lead>, trimmed of a trailing `.` / `:` / ` —` / `-` and whitespace.
          (This handles BOTH real producer formats: the flat form
          `- **Name.** What's excluded: …` — the whole item on one bullet, name in the
          bold, prose after it — and the canonical nlspec three-bullet form where the
          item NAME is its own bullet `- **Name** — …`.)
       b. SKIP the item entirely (emit nothing) when headingSlug(name) equals a reserved
          SUB-LABEL slug — `why-excluded`, `extension-point`, `what-s-excluded`
          (`what's-excluded`), `whats-excluded`. These are the canonical three-bullet
          form's body bullets (`- **Why excluded** — …`, `- **Extension point** — …`),
          NOT item names; emitting them produced the spurious `why-excluded` /
          `extension-point` keys that under-gated a Punt whose topic contained them.
       c. ELSE emit headingSlug(name).
  4. RETURN the set of emitted keys (empty set when the section is absent, or when every
     bullet was a reserved sub-label). A single-bullet flat-form item emits exactly its
     one name key; a three-bullet canonical item emits exactly its name key and skips the
     two sub-label bullets — so the crossref fires correctly on both, and never on a
     sub-label.

PROCEDURE slug_token_run_contains(topic_slug, oos_key):
  # both are hyphen-joined slugs from headingSlug; true iff oos_key appears as a
  # contiguous hyphen-delimited token run within topic_slug (equality is the
  # degenerate case). One-directional: the OUT OF SCOPE item name must be found
  # within the Punt topic, not the reverse.
  RETURN ("-" + topic_slug + "-") contains ("-" + oos_key + "-")
```

**Behaviour summary, producer self-rating.** Before this change, any open Punt pushes the `medium` heuristic. After it, a Punt that `faff punt-scan` reports `eligible` is excluded from the Punt count that heuristic weighs, so a spec whose only open items are eligible non-blocking Punts can self-rate `high`. Both producer rules already contain a clause defining `medium` as "non-blocking `**Punt:**` items exist" (`faffter-noon-spec/SKILL.md` ~line 113; `faffter-dark-nlspec/SKILL.md` ~line 223) using "non-blocking" in the OPPOSITE, loose sense. The amendment must rewrite that clause, not merely bolt an exclusion onto it: the `medium` heuristic keys on **blocking** open Punts, and "non-blocking" is repurposed to the precise eligible-Punt meaning.

```
PROCEDURE confidence_self_rating(spec, scan := faff punt-scan spec):
  weighed_punts := [ p in scan.punts WHERE NOT p.eligible ]   # eligible Punts excluded
  # existing heuristic runs unchanged on weighed_punts:
  #   >=1 weighed open Punt (thin rationale / open decision) → cap at medium
  #   the self-review downgrade rule (>=1 blocker or >=3 major) still binds independently
  # NOTE: excluding eligible Punts is a mechanical read, not a self-certification of the
  #       tag. Tag honesty is the spec-review lens's call (below); if the lens rejects the
  #       tag, spec-review gates before promote and the spec is re-rated/re-routed.
```

**Behaviour summary, spec-review out-of-band check.** The design lenses (`architectural`, `infosec`, `QA`) each, when a Punt carries `(non-blocking)` and is cross-referenced under OUT OF SCOPE, must affirmatively test whether the Punt is genuinely deferrable for this increment. A Punt the increment actually depends on, tagged non-blocking, is a gating objection (the tag is unwarranted). This rides the existing `faff-contract:spec-review-verdict` as a normal finding; no new contract field. Because spec-review runs at prep's produce-then-review seam before promote-to-build, an unwarranted tag is caught before routing ever reads it.

**Behaviour summary, routing (two rows narrow in lockstep).** The `routing_adaptor` runs `faff punt-scan` on the attached spec and reads `blocking_open_count`. Two rows of the routing table gate on Punts and must move together, or an eligible-Punt spec would fall through both and get no build-ready verdict:

- `needs-decision-first`: its Punt leg fires only when a blocking open Punt exists (`blocking_open_count > 0`), never on an eligible non-blocking Punt alone. Its live marker list (`Punt:` / `needs human` / `TBD` / "or X if Y") is preserved verbatim; "blocking" qualifies the Punt term only. Its `confidence: medium` leg is untouched.
- `fire-and-forget`: its precondition "no Punt/Assumes markers" is narrowed in lockstep to "no **blocking** open Punt" (the Assumes term is preserved), so an eligible-Punt, high-confidence, independent spec becomes admissible to the build queue.

The adaptor performs NO LLM re-read of the tag prose in either row; it branches on the scanner's structured output.

```
PROCEDURE assign_verdict(spec, scan := faff punt-scan spec):
  # No routing-side re-classification is needed: the design lens that vets a tag's honesty
  # ALWAYS fires before routing (infosec+QA are sticky at L1-L3, the full set is pinned at L4 —
  # see the no-fail-open invariant in WHY), so a tagged Punt reaching routing has always been
  # vetted. Routing therefore reads scan.blocking_open_count directly, adding no new signal.
  # needs-decision-first (Punt leg narrowed to blocking; marker list + medium leg preserved)
  1. blocking_punt_leg := scan.blocking_open_count > 0
       OR an un-spec-closed `needs human` / `TBD` / "or X if Y" marker exists
  2. confidence_leg := spec.confidence == "medium"               # UNCHANGED (deliberate non-fix)
  3. IF blocking_punt_leg OR confidence_leg: return needs-decision-first
  # fire-and-forget precondition narrowed in lockstep
  4. no_blocking_punt := scan.blocking_open_count == 0
  5. IF spec.confidence == "high" AND no_blocking_punt AND no-Assumes
       AND no-in-queue-blocker AND independent AND no-repeat-park: return fire-and-forget
```

**Edge cases.**

- No OUT OF SCOPE section, or an empty one: `oos_names` is the empty set, so every Punt has `out_of_scope_crossref == false` and is therefore blocking. Fail-safe: an untagged or un-crossreferenced Punt is treated as blocking (routes `needs-decision-first`), never silently waved through.
- A `(non-blocking)` tag with no crossref match: `non_blocking == true` but `eligible == false`. Not waved through: the bare tag alone never suffices.
- A degenerate all-punctuation Punt topic slugs to `""`: `slug_token_run_contains("", k)` is false for any non-empty `k`, so the Punt is blocking. Honest failure, never a false match.
- Multiple Punts, mixed: each is classified independently; `blocking_open_count` counts only the non-eligible ones.
- Malformed or duplicated suffix (`(non-blocking) (non-blocking)`): the boolean is still `true`; idempotent.
- A canonical three-bullet OUT OF SCOPE item (`- **Name** — …`, `- **Why excluded** — …`, `- **Extension point** — …`): only `headingSlug(Name)` is emitted; the two reserved sub-label bullets are skipped, so a Punt topic containing `why-excluded` or `extension-point` never false-matches (the under-gate is closed). A flat-form item (`- **Name.** What's excluded: …`) emits exactly `headingSlug(Name)`.
- A `(non-blocking)`-tagged spec always reaches routing having been vetted by ≥1 design lens (the sticky `infosec`+`QA` floor at L1–L3, the full set at L4), so routing consumes `blocking_open_count` directly with no re-classification. The no-fail-open invariant is a property of lens-selection, not a routing-time check.

**Failure modes.**

- **The failure:** the crossref match is wording-dependent. If a producer phrases the Punt topic so it does not contain the OUT OF SCOPE item's name-slug as a token run, a genuinely deferred Punt scans as blocking (a false negative) and routing over-gates. How you'd know: a spec the author intended to sail through still routes `needs-decision-first` on the Punt leg; `faff punt-scan` shows `eligible == false` for a Punt the author expected eligible. What it means: proceed. A false negative is the safe direction (over-gating, never under-gating), and the producer fixes it by phrasing the topic to name the OUT OF SCOPE item. This same wording-dependence is why the per-reason park-collapse (OUT OF SCOPE) is deferred; here it is acceptable because the failure is fail-safe and author-correctable.
- **The failure:** a producer games the tag, marking a genuinely blocking Punt `(non-blocking)` and listing a matching OUT OF SCOPE item, to self-rate `high` and skip the gate. How you'd know: the spec-review design lens flags the tag as unwarranted (the increment depends on the punted decision), gating the spec-review verdict before promote. What it means: proceed. The out-of-band lens is the designed backstop; the producer cannot self-certify past it.

**Anti-patterns.**

- **Anti-pattern:** adding a `non_blocking` / `decides` field to the `spec-readiness` extraction JSON or schema. Why: the tag is display/routing metadata read from the parsed markers, exactly like `(decides:)`; the readiness contract stays a single source of truth for `{ marker }` and confidence.
- **Anti-pattern:** having the `routing_adaptor` (or any consumer) LLM-re-read the Punt prose to judge non-blocking-ness. Why: it re-introduces the correlated blind spot the out-of-band lens exists to decorrelate, and it makes routing non-deterministic. Routing reads `faff punt-scan` output only.
- **Anti-pattern:** loosening the `confidence: medium` leg of `needs-decision-first` "while we're in there". Why: that leg carries legitimate non-Punt human-call signals (the security-claim appetite floor); loosening it punches through the appetite hard floor. Narrow the Punt leg only.
- **Anti-pattern:** touching `park-history.js`. Why: repeat-park noise is delegated to the existing detector; this change adds nothing it reads or writes.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec whose only open Punt carries `(non-blocking)` and names an OUT OF SCOPE item
When faff punt-scan runs on it
Then that Punt reports eligible == true and blocking_open_count == 0
```

```
Given a Punt line "**Punt:** cron vs queue — needs human (decides: architecture) (non-blocking)"
  and the same line with the two suffixes in the opposite order
When faff punt-scan parses each
Then both yield an identical PuntMarker (topic, decides == "architecture", non_blocking == true)
```

```
Given an attached spec whose sole open Punt is eligible (non-blocking, out-of-scope) and confidence: high
When the routing_adaptor assigns a verdict
Then the needs-decision-first Punt leg does not fire and the spec is not parked on that leg
```

```
Given an attached spec that carries confidence: medium for a security-claim appetite reason,
  and whose only open Punt is eligible
When the routing_adaptor assigns a verdict
Then it still assigns needs-decision-first via the unchanged confidence-medium leg
```

- The `faff punt-scan --selftest` fixture table MUST cover: bare tag, order-independent suffixes, tag-without-crossref, crossref-without-tag, no OUT OF SCOPE section, degenerate empty topic, and multiple mixed Punts.
- `faff punt-scan` MUST be deterministic: the same spec bytes always produce the same `PuntScanResult`.

## 6. Design Decision Rationale

**Should the `(non-blocking)` tag carry an argument (like `(decides: <owner>)`), or be bare?**
- Argument-carrying (for example `(non-blocking: <why>)`): self-documenting, but invites the author to assert non-blocking-ness in free text, which routing cannot verify deterministically.
- Bare, argument-free: mirrors nothing the author can assert their way past; eligibility comes from the OUT OF SCOPE crossref (a structural fact), not from the tag's payload.
- **Chosen:** bare, argument-free `(non-blocking)`, syntactically parallel to and independent of `(decides:)`, order-independent with it. Rationale: `(decides:)` needs an owner token because the owner is not derivable from the spec; non-blocking-ness IS derivable (the crossref), so the tag needs no payload and eligibility cannot be author-asserted.

**What makes a Punt eligible to be treated non-blocking?**
- Tag alone: a producer could wave any Punt through by tagging it.
- Crossref alone: an OUT OF SCOPE item does not by itself say a Punt is deferred.
- **Chosen:** both facts, `non_blocking == true` AND `out_of_scope_crossref == true`. Rationale: the tag states intent, the crossref proves the spec actually scoped the item out; requiring both closes the wave-through loophole deterministically.

**How is out_of_scope_crossref matched deterministically?**
- Fuzzy / semantic match: not deterministic; no place in a pure CLI.
- Exact slug equality of topic and OUT OF SCOPE name: too strict; a Punt topic is usually a longer phrase than the item name.
- **Chosen:** slug both via the house `headingSlug` rule, and match when the OUT OF SCOPE name-slug appears as a contiguous hyphen-delimited token run within the Punt topic-slug (one-directional). Rationale: reuses the existing slug rule (no second normaliser), is fully deterministic, and is author-correctable when it misses. At the time of writing there is no fuzzy-match utility in the CLI and none is wanted on a pure path. The wording-dependence is a known, fail-safe limitation (see Failure modes) and is the same identity-key question that defers the per-reason park-collapse.

**Does the tag add a field to the spec-readiness contract?**
- Add a `non_blocking` field: would make the readiness contract carry routing metadata and create a second source of truth.
- **Chosen:** no new field. A tagged and untagged Punt both emit `{ "marker": "punt" }`. Rationale: the FAFF-356 `(decides:)` precedent verbatim; the contract fixture comment at `contract-defs.js` already states this rule for `(decides:)` and this change extends the same comment to `(non-blocking)`.

**Who judges whether a tagged Punt is genuinely non-blocking?**
- The producer (self-certify): the build agent certifying its own tag; correlated blind spot.
- The `routing_adaptor` (LLM re-read): non-deterministic routing; same correlated blind spot.
- **Chosen:** the spec-review adversarial design lenses (`architectural`, `infosec`, `QA`), a structurally-separate model in an isolated context, running before routing. Rationale: it is the one out-of-band check already positioned before promote-to-build; the producer's self-rating exclusion is a mechanical read that this lens gates, so nothing self-certifies. Routing then reads only the deterministic scanner.

**How is the tag-honesty backstop kept from being dropped underneath the eligibility mechanism (the no-fail-open fix)?**
- A routing-side fail-safe (re-classify an eligible Punt as blocking unless a `design_lens_vetted` signal is set): robust in principle, but the signal has no home — routing's inputs are spec confidence + markers + backlog-diagnostics + park history, computed in a separate `/faff-tidy` pass with no wire from the spec-review outcome, and a *clear* design lens emits no objection, so nothing records "a lens ran and cleared". Building it would mean adding a new cross-pass provenance signal, and getting its absent-value default wrong reopens the fail-open (absent-as-true) or ships the feature inert (absent-as-false).
- Rest on the existing lens-selection floor: `infosec`+`QA` are already sticky at L1–L3 and L4 is pinned to the full design set, so ≥1 design lens *always* vets every spec before routing. The invariant already holds by construction.
- **Chosen:** rest on the existing sticky-lens floor and state it as an explicit, documented invariant — no routing-side signal, no new code, no tag-detection added inside lens-selection. Rationale: the backstop the security-critical "the build agent never certifies its own tag" principle needs is *already unconditional* (a design lens always fires), so the honest fix is to document that as an explicit invariant a future lens-selection change must preserve, not to bolt on an ungrounded routing signal to re-derive a guarantee that already holds.

**Which routing rows narrow?**
- Narrow only `needs-decision-first` (the leg the ticket named): incomplete. An eligible-Punt, high-confidence spec would then fail the `fire-and-forget` precondition (which today reads "no Punt markers") AND no longer trip `needs-decision-first`, falling through with no build-ready verdict.
- **Chosen:** narrow the Punt term of BOTH the `needs-decision-first` Punt leg and the `fire-and-forget` "no Punt markers" precondition in lockstep, to "blocking open Punt". Rationale: the ticket's intent (let an eligible non-blocking Punt build unattended) is only realised if the build-ready row admits it; narrowing one row without the other is incoherent. This is a necessary consequence of root cause (a), not new scope, and touches neither the `confidence: medium` leg nor root cause (b).

**Should the `confidence: medium` leg of `needs-decision-first` also narrow?**
- Narrow it too: would let a security-claim-floored spec build unattended, punching through the appetite hard floor.
- **Chosen:** leave it unchanged. Rationale: the deliberate non-fix; a `medium` earned for a non-Punt reason is a legitimate human-call signal that must keep routing `needs-decision-first`.

**Where does the scanner live and how is it shaped?**
- Inline in the routing skill prose: not deterministic, not testable.
- **Chosen:** a pure, zero-dependency Node subcommand `faff punt-scan` under `bin/lib/`, wired into `COMMANDS`, carrying a `--selftest` fixture table, mirroring `park-verdict` / `tier`. Rationale: the house deterministic-tool convention; same input always yields the same output.

## 7. Open Questions and Assumptions

**Open Questions.** None. Every decision above is closed with a `**Chosen:**` marker. The wording-dependence of the crossref match is a named, fail-safe limitation (Failure modes), not an open decision; the per-reason park-collapse identity-key question is deferred to a future ticket (OUT OF SCOPE), not open here.

**Assumptions.**

- **Assumes:** the `spec_review` slot (`faffter-dark-spec-review` at L4, or the single-pass default below it) runs at prep's produce-then-review seam, before promote-to-build, on the spec that routing later reads. Validate: confirmed in `plugin/skills/faffter-dark-spec-review/SKILL.md` (_When it runs_: "after the spec is produced and confidence-rated, before promote-to-build") before wiring the lens change.
- **Assumes:** `headingSlug` / `headingText` in `plugin/skills/faff/bin/lib/heading-slug.js` are exported and stable for reuse by the scanner. Validate: `grep 'module.exports' plugin/skills/faff/bin/lib/heading-slug.js` shows both exported before importing them.
- **Assumes:** the `faff-contract:spec-review-verdict` objection shape accommodates the tag-honesty objection without a schema change. Validate: confirm in `contract-defs.js` (`computeSpecReviewVerdict` — NOT `computeReviewVerdict`, which is the separate FAFF-78 code-review contract with `findings[]`/`location_present`/`action_present`) that objections are the closed `{ lens ∈ {architectural,infosec,methodology,QA}, severity ∈ {blocker,major,minor} }` shape plus optional FAFF-935/943 enrichment. An unwarranted-tag objection fits that enum directly as an ordinary design-lens `major`, so no new field is needed.

## 8. DONE: Definition of Done

### From WHY
- [ ] For a fully-settled spec whose only open Punt is eligible (non-blocking, out-of-scope), `faff punt-scan` reports `blocking_open_count == 0` (asserted mechanically via a `punt-scan --selftest` fixture; the `routing_adaptor` is prose, not a deterministic fixture harness).
- [ ] The `faffidavit-routing` prose narrows in lockstep so such a spec is admissible: the `needs-decision-first` Punt leg does not fire on it, and the `fire-and-forget` precondition reads "no blocking open Punt", so it can reach a build-ready verdict rather than falling through both rows.
- [ ] A spec at `confidence: medium` for a non-Punt reason still routes `needs-decision-first` (the medium leg is unchanged).

### From WHAT (types and interfaces)
- [ ] `**Punt:**` lines accept a bare `(non-blocking)` suffix, order-independent with `(decides: <owner>)`.
- [ ] `faff punt-scan <spec-file>` emits `PuntScanResult` JSON: `punts[]` with `{ topic, decides, non_blocking, out_of_scope_crossref, eligible }`, plus `eligible_count` and `blocking_open_count`, and `eligible_count + blocking_open_count == punts.length`.
- [ ] `faff punt-scan --selftest` runs a baked fixture table; exit 0 pass / 1 fail.
- [ ] `faff punt-scan` exits 2 on a missing/unreadable spec file; is read-only; takes no ambient clock.
- [ ] The `spec-readiness` extraction JSON and `spec-readiness.schema.json` are unchanged; a tagged and untagged Punt both emit `{ "marker": "punt" }` (assert via the existing `spec-readiness` contract fixtures still passing unchanged).
- [ ] `punt-scan` is registered in the `COMMANDS` registry in `plugin/skills/faff/bin/faff`, in `regions.js`'s `REGION_MAP` (`region:factory`) and `REGION_SELFTEST_ARGV` (`["punt-scan", "--selftest"]`), and documented in `docs/guide/cli.md`, so `faff lint-cli-doc`, `faff regions check`, `faff regions selftest`, and `faff lint-cli-coverage` all pass.

### From HOW (behaviour)
- [ ] `eligible == (non_blocking AND out_of_scope_crossref)`; the bare tag without a crossref is `eligible == false`.
- [ ] Suffix parsing is order-independent: `(decides:) (non-blocking)` and `(non-blocking) (decides:)` yield identical `PuntMarker`s.
- [ ] `topic` has both recognised suffix parens removed and surrounding whitespace/dash runs trimmed; unrecognised parentheticals are retained.
- [ ] `out_of_scope_crossref` is computed by slugging (via `headingSlug`) and matching the OUT OF SCOPE item name-slug as a contiguous token run within the Punt topic-slug.
- [ ] `extract_out_of_scope_item_keys` emits only item-NAME keys and SKIPS the reserved sub-label bullets (`why-excluded`, `extension-point`, `what-s-excluded`/`whats-excluded`), so the canonical three-bullet nlspec format emits exactly the name key (never `why-excluded`/`extension-point`) and the flat trailing-period form emits its one name key. Selftest fixtures cover both formats and assert no sub-label key is emitted.
- [ ] The no-fail-open invariant is documented as resting on the existing lens-selection floor (≥1 design lens — sticky `infosec`+`QA` at L1–L3, full set at L4 — always fires before routing), with a note that a future lens-selection change dropping all design lenses would break it. No `design_lens_vetted` signal and no routing-side re-classification are introduced; `assign_verdict` reads `blocking_open_count` directly. (Prose-review check: the invariant is stated in WHY and the Design Decision Rationale, and `park-history.js` and the routing inputs are unchanged.)
- [ ] Both producer self-rating rules (`faffter-noon-spec/SKILL.md` ~line 113, `faffter-dark-nlspec/SKILL.md` ~line 223) are rewritten so the `medium` heuristic keys on **blocking** open Punts: the existing "non-blocking `**Punt:**` items → medium" clause is corrected (the term now denotes an eligible, deferred Punt, the opposite of a medium trigger) and eligible Punts are excluded from the weighed count. A spec whose only open items are eligible non-blocking Punts can self-rate `high`.
- [ ] `faffidavit-routing/SKILL.md`'s `needs-decision-first` row applies **blocking** to the Punt term only, preserving its live marker list verbatim (`Punt:` / `needs human` / `TBD` / "or X if Y"); the row states the adaptor runs `faff punt-scan` and reads its output, never the tag prose.
- [ ] The `fire-and-forget` row's "no Punt/Assumes markers" precondition is narrowed in lockstep to "no **blocking** open Punt" (the Assumes term preserved), so an eligible-Punt, high-confidence, independent spec is admissible.
- [ ] The `confidence: medium` leg of that same row is left verbatim.
- [ ] The spec-review design lenses (`architectural`, `infosec`, `QA`) instruct the refuter to challenge an unwarranted `(non-blocking)` tag as a gating objection; an unwarranted tag gates the spec-review verdict before promote.

### From HOW (edge cases)
- [ ] Absent/empty OUT OF SCOPE section: every Punt is `out_of_scope_crossref == false` and blocking.
- [ ] Degenerate empty-slug topic never false-matches a crossref key.
- [ ] Mixed Punts: `blocking_open_count` counts only non-eligible ones.

### From invariants
- [ ] `plugin/skills/faff/bin/lib/park-history.js` is unchanged by this work (assert via diff: the file is not in the change set).

**Eval coverage.** This change touches the spec-review judgement seam only by adding one refuter instruction; it introduces no new grader `KIND`. The tag-honesty objection rides the existing `refutation-spec` seam and its existing eval cases; no new grader registration is required. If review deems the added refuter line a material seam change, register one eval case exercising an unwarranted-tag rejection against the existing seam-registry row (autonomous-doable; baseline acceptance is a separate human step).

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Write a spec fixture with an OUT OF SCOPE item "Repeat-park collapse" and a Punt
     "**Punt:** repeat-park collapse — needs human (non-blocking)".
  2. Run `faff punt-scan fixture.md`.
  3. ASSERT punts[0].eligible == true, eligible_count == 1, blocking_open_count == 0.
  4. Add a second Punt with no OUT OF SCOPE match and re-run.
  5. ASSERT blocking_open_count == 1 (the plumbing from parse to count is connected).
```

**Rating note.** This spec carries no open Punts, every decision is closed, and DONE mirrors the body, which on its own supports `high`. The clean-context self-review surfaced three `major` findings (all resolved in this draft: the `regions.js` registration surface, the `fire-and-forget` lockstep, and an untestable routing-fixture AC). The inherited self-review downgrade rule (≥3 `major` findings forecloses a `high` self-rating regardless of resolution) caps this at `medium`. The `medium` here is a self-review-provenance signal, not an open decision; fittingly, it routes `needs-decision-first` via the very `confidence: medium` leg this spec deliberately leaves unchanged.

confidence: medium
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```