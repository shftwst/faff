---
name: faffidavit-spec
description: "Default `spec_adaptor` — the canonical spec decision markers (Chosen/Punt/Assumes), writing-style and confidence-line format, and pre-attach validation of any spec producer's output. Runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffidavit-spec

The default **adaptor** for the `spec_adaptor` slot. It translates a spec producer's native output into faff-core's fixed spec-readiness contract — the concrete markers that encode the closed/open/external classification, the writing-style rules, the confidence line's format — and **validates** conformance on demand. A `faffidavit-*` skill: it both *defines* its dialect and *checks* conformance, so it earns its keep as an invokable skill rather than a passive document.

Every spec producer (`faffter-noon-spec`, `faffter-dark-nlspec`, any delegated `spec` skill) conforms to it; faff-prep delegates its pre-attach validation to it.

```yaml
slots:
  spec_adaptor: faffidavit-spec   # the default — explicit for clarity
```

## Internal contract (fixed — see gateway)

The spec-readiness contract itself is a faff-core invariant and lives in the gateway (_Core contracts and adaptor slots → Spec readiness_), **not** here. Fixed there, and unaffected by swapping this slot:

- every non-trivial decision is classified **closed** / **open** / **external-dependency**,
- a **confidence rating** (`high` / `medium` / `low`) is present and **retained on the attached spec** (durable provenance + re-spec signal, not stripped), and
- faff-prep gates its autonomous decision on confidence (`high` → promote; `medium` → attach with the rating retained, routes out as `needs-decision-first`; `low` → park) while beep-boop routes on the open/external classification (→ `needs-decision-first` / `gap-blocked`).

An autonomous reader needs to parse specs mechanically against that fixed classification — without it, the reader falls back to topic-keyword scanning and re-raises closed decisions as human blockers. This skill does not get to change the classification or the gate. What it owns is the *dialect* — the concrete markers that encode closed/open/external, the writing style that keeps a spec parseable, and the confidence line's format. That is what makes the slot swappable: a third-party spec format plugs in behind a different adaptor that maps its structure onto the same three classes + confidence, and faff-prep still gates the same way.

**How this contract reaches you.** The fixed definition is loaded by the invoking consumer (`/faff-prep` reads the gateway on entry), so when you run as the `spec_adaptor` slot it is already in context. If you are invoked **standalone** ("validate the spec for SHF-123"), **Read the sibling `faff/SKILL.md` → _Core contracts and adaptor slots → Spec readiness_ now** before validating. The bullets above are a non-normative recap; the gateway wins on any conflict.

## Two faces

- **Define** (reference): the canonical markers, marker rules, and writing style below. Producers read this and conform; consumers read it to parse specs mechanically.
- **Validate** (invokable): given a spec, return `pass` / `fail` plus a list of specific violations. Invoked by faff-prep before attach, and usable standalone — "validate the spec for SHF-123" or point it at a markdown file and get a report.

## Canonical markers (this adaptor's dialect)

These markers are how *this* adaptor encodes the fixed closed/open/external classification. A different `spec_adaptor` may use a different surface syntax, as long as it maps onto the same three classes.

Every spec must mark each non-trivial decision with exactly one of these:

| Marker | Meaning | Reader action |
|---|---|---|
| `**Chosen:** X` or `**Decision:** X` | Closed. The spec has picked X. | Implementer does X. Reader must not re-raise. |
| `**Punt:** X or Y — needs human` | Open. Explicitly deferred to a human. | Reader escalates. Build cannot proceed past this without resolution. |
| `**Assumes:** X exists` | External dependency. | Reader validates presence before build; parks if absent. |

## Marker rules

1. **One marker per decision section.** Every tradeoff table, "X vs Y" comparison, or architecture pick must conclude with exactly one marker. Prose rationale above the marker is encouraged; the marker is what the reader parses.

2. **No marker = invalid spec.** A spec with a tradeoff table but no concluding marker is invalid. In autonomous mode, faff-prep parks rather than attaches. In interactive mode, faff-prep adds the missing marker before attaching.

3. **Open items collected.** `Punt:` and `Assumes:` markers must appear in a top-level "Open Questions" or "Assumptions" section so the reader can enumerate them quickly.

4. **Applies to all design choices.** Libraries, patterns, data shapes, naming, scope boundaries. If the spec weighs options and picks one, mark it.

5. **No topic-keyword contract.** The reader matches on markers, not section names. A section called "Logging" with `**Chosen:** pino` at the end is closed. A section called "Anything" with `**Punt:** A or B — needs human` is open.

## Writing style: skimmable, not coded

The marker contract governs structure. This section governs prose. A reader skimming the spec — without holding the source ADR, parent ticket, or blocker list in their head — must be able to follow what each section is about on first pass.

### Concrete prohibitions

**No invented labelling schemes.** Don't introduce ad-hoc codes like `X1`, `F2`, `R3`, `W2a`, `Phase 4` and then cross-reference them throughout the spec. They force the reader to hold the full list in memory to decode any single line. Restate the subject instead ("the audit-error-registry relocation", "the cleanup PR for the entitlements route").

**Ticket numbers are fine.** `#123`, `SHF-247`, `ENG-42` are real, stable identifiers. The rule bans codes the spec invents, not codes that exist in the tracker. Prefer `SHF-247 (audit-error registry relocation)` over `SHF-247` alone or `F5` alone.

**Restate subjects on every cross-reference.** "F5 shim", "PR 4's deletions", "Phase 6", "test classes #1–#9" are opaque. Spell out what each is.

**Inherited codes from source ADRs are the most common offender.** If ADR-0016 uses `F1...F8` to label phases, the spec must translate each into a descriptive subject. The ADR is one document; the spec is another.

**Descriptive lead columns in tables.** A row reading `PR 4 / W2 / in-app syncBilling impl / shim from W1` is unreadable. Lead with a descriptive column or break into named subsections.

**Standalone prose over compressed bullet walls.** Three sentences that each make sense in isolation beat a five-bullet wall whose meaning depends on having read the preceding section.

## Confidence self-rating

Every spec ends with a single confidence line — the producer's self-assessment of whether the spec is buildable without a human, which faff-prep's autonomous gate branches on. The three levels and the gate are fixed in the gateway (spec-readiness internal contract); this adaptor owns the *line's format* — its placement and exact token — so faff-prep can read it regardless of which producer ran:

```
confidence: high | medium | low
```

| Level | Meaning | faff-prep gate |
|---|---|---|
| `high` | Explore surfaced clear answers; every non-trivial decision has a `**Chosen:**` marker with rationale; no `**Punt:**` escalates a genuine product/architecture question; ACs are concrete and testable. | Attach + promote to Todo (build-eligible). |
| `medium` | Mostly clean but 1–2 `**Punt:**` markers on substantive choices, or a decision whose rationale is thin enough a human would want to weigh in. | Attach with the rating **retained**, move to Todo — never auto-admitted to the build queue. Routes out as `needs-decision-first`; whether an autonomous run then proceeds is appetite-modulated (see gateway → **Spec readiness** + **Appetite for destruction**). |
| `low` | Multiple `**Punt:**` markers, or explore couldn't pin down the ticket's intent, or core architecture is genuinely unclear. | Park — explore could not resolve core questions. |

The line is mandatory and orthogonal to marker validation: a spec can have every marker present (passes validation) yet rate `medium`/`low`. Both the marker check and the confidence gate must pass for an autonomous attach.

## Provenance stamp

Every attached spec carries a one-line **provenance stamp** so its lineage is self-describing: when it was produced, which producer ran, in what mode, under which `spec_adaptor`. This adaptor owns the stamp's **format + placement + validation**; **faff-prep populates the values** at attach time (exactly as it does for the trailing `confidence:` line — the adaptor defines the shape, prep fills it in). Producers do not emit it.

**Format** — a single blockquote line **directly under the spec's H1 title** (the first non-blank line after the `# …` heading), nothing between them:

```
> Spec: <producer> · <date> · <mode> · adaptor: <adaptor> · confidence: <level>. Full spec on <tracker> <ISSUE-ID>.
```

- `<producer>` — the resolved `slots.spec` occupant (e.g. `faffter-noon-spec`).
- `<date>` — ISO `YYYY-MM-DD`, the date the spec was produced or last refreshed.
- `<mode>` — exactly one of `interactive` / `autonomous`.
- `<adaptor>` — the resolved `slots.spec_adaptor` occupant (e.g. `faffidavit-spec`).
- `<level>` — the confidence token, echoed from the trailing `confidence:` line.
- `Full spec on <tracker> <ISSUE-ID>` — first-mention grounding for the issue ID. In **git-only mode**, where no tracker resolves, drop this trailing sentence (end the line at `confidence: <level>.`).

**Echoes, does not replace.** The stamp's `confidence: <level>` token is a skimmable echo only. The standalone trailing `confidence:` line (above) stays **authoritative** — it is what validation checks and what faff-prep's autonomous gate branches on. The stamp never substitutes for it; both appear on every spec.

The fields are `date · producer · mode · adaptor`. There is **no version field** — faff has no trustworthy version source to resolve today, so it is deliberately omitted.

## Validation — wired to the contract script (FAFF-77)

Validation is **conformance by construction** (FAFF-21): this adaptor does **not** hand-check markers in prose. It **extracts** the spec into a structured candidate, hands that to the deterministic **contract script**, and returns the script's output. **The contract script `faff contract spec-readiness` is the sole source of contract data** — this adaptor never builds the contract data itself, never computes `markers_valid` / `violations` / classification. That delegation is exactly what `faff validate-adapters` checks (the wiring-check); it is what makes "check the wiring, not the prose" sound.

**The split — artifact-preferred (FAFF-76 Decision 2; the artifact branch lit up by FAFF-81):**

The adaptor obtains the **extraction JSON** by one of two paths, **in precedence order** — the producer's emitted artifact first, prose extraction only as a fallback:

- **(1) Producer-emitted artifact — preferred, fully deterministic, no LLM.** If the spec carries a single fenced block tagged `faff-contract:spec-readiness` (emitted at the end of the spec by the producer that wrote the markers — see the artifact convention in `docs/adr/0001-contract-as-code-foundations.md`), the adaptor **locates it by that info-string and `JSON.parse`s its body**. The block carries the producer-authored `{ "confidence", "decisions" }` (the producer knows the confidence token and the markers it just wrote — no inference); the adaptor adds **`provenance_present`** itself via its existing **structural stamp-detection** (a regex for the `> Spec:` stamp under the H1 — deterministic, not the LLM seam, and necessarily the adaptor's because the stamp is populated by faff-prep *after* the producer returns). The three together are the extraction JSON.
  - **Present + valid** (parses + carries `confidence` + `decisions`) → use it.
  - **Present + malformed** (not JSON, or missing those fields / wrong shape) → **fail-loud** (`signal: fail`, finding "contract artifact present but malformed"). **Do not** silently fall back to prose — a corrupt artifact is producer breakage, surfaced not masked. The fallback trigger is *absence*, never *corruption*.
- **(2) Prose extraction — fallback, the LLM seam, only when no artifact is present.** Read the prose spec into the same **extraction JSON** —
  ```
  { "confidence": "<verbatim token from the trailing `confidence:` line>",
    "provenance_present": <is a well-formed provenance stamp present under the H1?>,
    "decisions": [ { "marker": "chosen" | "punt" | "assumes" | "none" }, ... ] }
  ```
  Reading which canonical marker each decision section carries, the confidence token, and whether the provenance stamp is present is the adaptor's job — the one place judgement remains, and only on the fallback path. Detecting the **provenance stamp** is **structural only — never runtime-true** (the anti-pattern below).

Either path yields the **same** extraction JSON, piped to the contract script unchanged. The artifact is the script's **input**, never a second source of contract data — the script stays the sole source.

- **The contract script (all conformance computation — deterministic):** maps each marker to its class (`chosen → closed`, `punt → open`, `assumes → external`, `none → a violation`), computes `markers_valid` and `violations`, validates `confidence` against the closed enum, and emits the canonical contract data — or **fails loud** when `confidence` is absent/unreadable (no safe coerce target, FAFF-76 Decision 3) or the extraction is malformed.

**Invocation + signal mapping:**

```
echo '<extraction JSON>' | faff contract spec-readiness
```

| Script exit | `signal` | Meaning |
|---|---|---|
| 0 | `pass` | conformant: `markers_valid:true`, `violations:[]` (the script's stdout) |
| 1 | `fail` | non-conformant verdict: the script's `violations` name the missing marker / provenance |
| 2 | `fail` (fail-loud) | extraction malformed, or `confidence` un-coercible — no contract data emitted |

The contract data the caller branches on is **the script's stdout, verbatim**. The `signal` / findings are a thin reading of the script's exit code + `violations`.

**Structural-only — never runtime-true (anti-pattern).** The provenance-stamp half of the extraction verifies **presence + well-formedness only**, never that the values are *correct* at runtime. It cannot and must not assert that `<producer>` equals the live `slots.spec`, that `<date>` is genuinely today, that `<mode>` matches the actual invocation, or that `<adaptor>` is the running slot — those are faff-prep's to populate truthfully. A stamp that is shaped right sets `provenance_present: true`.

**How callers act on the signal:**
- **Autonomous mode:** `fail` (exit 1 or 2) → park.
- **Interactive mode:** `fail` → fix the missing marker (or the un-readable confidence) before attach.

## Rules

- The closed/open/external classification and the confidence gate are fixed in the gateway, not here — non-negotiable for autonomous operation. A spec whose decisions can't be classified cannot be autonomously built; the reader can't tell what's closed vs open.
- This adaptor's dialect is deliberately minimal. It doesn't prescribe section names, document length, or level of detail. Only: mark your decisions (in this dialect's markers), write readably, emit the confidence line, validate before attach.
- Alternative spec producers conform via their own `spec_adaptor`. They may add structure on top but their output must map onto the same three classes + confidence; this default adaptor's markers are how the *default* producers do it.
- Validation reports findings; it does not mutate the spec or decide what happens next. Sequencing (park, fix, attach) belongs to the caller.
