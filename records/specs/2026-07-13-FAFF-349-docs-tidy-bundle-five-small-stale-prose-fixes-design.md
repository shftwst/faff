# FAFF-349 — Docs-tidy bundle: five stale-prose fixes from the coherence audit

> Spec: faffter-dark-nlspec · 2026-07-12 · autonomous · confidence: high. Source: Linear FAFF-349 (spec comment).

This spec defines a single documentation PR that applies five small, independent stale-prose fixes to skill `SKILL.md` files, drawn from the FAFF-323 whole-system coherence audit (observations O4–O8, bundled as audit item **T15**). Every fix is a text edit to prose; there is no runtime code change and no test to add. Because the deliverable is prose, the DONE section is expressed as **text-substring assertions** (old stale string gone, new string present) so each fix is born-verifiable by `grep`.

## 1. WHY — Problem and Principles

Each of these five lines is prose that has drifted out of agreement with the system it describes — a stale tool name, a stale count, a self-contradiction, a misleading bail, and an undocumented design rule. None is load-bearing behaviour; all are coherence hygiene surfaced by the audit (`verification/audits/2026-07-04-faff-323-whole-system-coherence.md` → T15).

**Design principles:**

- **Preserve intent, correct the drift.** Every fix keeps the sentence's original purpose and only corrects the drifted fact. No fix expands scope or changes behaviour beyond what the audit named.
- **Grounded, not guessed.** Each stale string was re-confirmed live against origin/main at build time. If any string is found already fixed, that item is a no-op (mark done and note it).

## 2. OUT OF SCOPE

- **Any CLI or code change** — all five are prose edits. If a fix is found to require code (see Fix 4 note), split it out to its own ticket rather than growing this bundle.
- **The other fourteen audit follow-on tickets (T1–T14)** — each is separately ticketed.
- **Re-auditing or re-deriving the findings** — the audit already did this.

## 3. WHAT — The five fixes

**Fix 1 — graft Step 0 todo wording** (`plugin/skills/faff-graft/SKILL.md`)
- Stale (remove): `use `TodoWrite` to create one todo per numbered step`
- Change: rephrase capability-generically — the forcing-function intent survives; the hard-coded tool name does not (current harnesses expose `TaskCreate`/`TaskUpdate`).
- Required present: `todo-tracking` on that line. `TodoWrite` may remain only as a parenthetical example.

**Fix 2 — rendering catalogue guard** (`plugin/skills/faffidavit-rendering/SKILL.md`)
- Stale (remove): `sixth form`
- Required present: `new form` in the guard sentence.

**Fix 3 — jot interactor within-lane sentence** (`plugin/skills/faff-jot/SKILL.md`)
- Stale (remove): `so mutating a label on an existing ticket is within-lane`
- Change: the pre-advisory-model rationale contradicts the same skill's step 3 (interactor never writes the tracker-owned eligibility labels, FAFF-218). Reword to the advisory model.
- Required present: token `tracker-owned`.

**Fix 4 — onboard decline-stub bail** (`plugin/skills/faff-onboard/SKILL.md`, cross-ref gateway `plugin/skills/faff/SKILL.md`)
- Change: teach onboard's Exit-0 bail to distinguish a **decline-stub** (a config carrying only the one empty `tracking.spec_docs_path` leaf and nothing else) from a real config, and proceed to detection in the stub case. Add a one-line cross-reference at the gateway stub-writing site.
- Required present: token `decline-stub` in onboard's Exit-0 branch prose.
- Validation: if the fix would require new CLI support rather than prose the onboard agent follows with existing `faff config get`, split Fix 4 to its own ticket. (Resolved at build: expressible in prose — no code needed.)

**Fix 5 — gateway descriptor-block vs contract-script class split** (`plugin/skills/faff/SKILL.md`)
- Change: add a sentence near the Core-contracts prose documenting the split — descriptor blocks (`infra-profile` / `intake-record` / `label-op`) intentionally have **no `faff contract` validator** because they are trusted CLI emissions (`infra-profile` validated via `faff profile validate`), distinct from producer-emitted contract blocks that each pipe to a `faff contract <name>` script.
- Required present: a new sentence naming `descriptor` block(s), stating they have no `faff contract` validator by design, and naming the three blocks.

## 4. HOW

For each fix: read cited file, confirm stale string present (else no-op), apply minimal replacement, grep to assert stale absent + required-present token present. Then run `faff validate-adapters` over touched files — must pass.

**Anti-patterns:** rewriting surrounding prose beyond the drifted fact; adding CLI/code to make Fix 4 work.

## 5. SCENARIOS — born-verifiable

- `use `TodoWrite` to create one todo` MUST NOT appear in faff-graft/SKILL.md; `todo-tracking` MUST appear in its Step 0 instruction.
- `sixth form` MUST NOT appear in faffidavit-rendering/SKILL.md; `new form` MUST appear in the catalogue guard.
- `mutating a label on an existing ticket is within-lane` MUST NOT appear in faff-jot/SKILL.md; reworded sentence carries `tracker-owned`.
- `decline-stub` MUST appear in faff-onboard/SKILL.md Exit-0 bail prose.
- A sentence in faff/SKILL.md MUST state the descriptor blocks have no `faff contract` validator by design.
- `faff validate-adapters` MUST pass over all touched SKILL.md files.

## 8. DONE

- [ ] Fix 1–5 grep assertions (stale gone, required-present token present).
- [ ] `faff validate-adapters` passes.
- [ ] PR touches only documentation (`*.md`) — no CLI/code files.

confidence: high
spec-review: approve
