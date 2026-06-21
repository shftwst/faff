# FAFF-195 — nlspec producer: "Failure modes" section + WHY opens with the load-bearing model

*Spec for the build agent and human reviewers. Companion to FAFF-193 (rendering form half); this owns the substance half.*

## 1. WHY — Problem and Principles

**Load-bearing model.** The `faffter-dark-nlspec` producer owns the *substance* of spec clarity — the "why it's hard" content that a rendering normalise pass can reorder but never invent. Two kinds of substance were homeless in the format: the *load-bearing model* the WHY should open with, and the *approach-level failure modes* (how the chosen design could be wrong, and the observable that reveals it). This change gives both a deliberate home in the producer's arc.

**Problem.** A spike-shaped spec produced through nlspec reads drier than the chat explanation of the same spike, because the format scatters mechanism into §7 Assumptions and has no home for approach failure modes — only §4 "Edge cases" (inputs the code must handle), which is a different thing.

## 2. OUT OF SCOPE

- **Rendering's form half** — leading with the model / surfacing the concrete at *normalise* time is FAFF-193. This issue is the producer (substance) half only.
- **Lite-default spec (`faffter-noon-spec`)** — this edit targets the full nlspec producer only.
- **§8 DONE template rows for the new content** — the ticket specifies exactly two edits; not expanded here.

## 3. WHAT

Two additions to `plugin/skills/faffter-dark-nlspec/SKILL.md`:

- **Edit A** — an "Open with the load-bearing model" principle under `### 1. WHY`.
- **Edit B** — a "Failure modes — how the approach falls over, and how you'd notice" subsection under `### 4. HOW`, after "Edge cases and error handling".

**Chosen:** insert Edit A as the first bold-lead principle of §1 WHY (it governs how the WHY *opens*, so it precedes the Problem statement); insert Edit B between the "Edge cases and error handling" bullets and "Anti-patterns".

## 4. HOW

Verbatim prose insertions per the ticket drafts, adapted to the file's house style (bold-lead the term, inline bullets). No code, no tests beyond the existing `faff validate-adapters` lint.

**Edge cases:** none — pure prose append to an existing skill prompt.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure** — the new prose breaches a `validate-adapters` lint (line cap, paragraph length, stray markers, duplicated block). **How you'd know** — `faff validate-adapters` exits non-zero naming the rule. **What it means** — narrow the wording to pass; never weaken the lint.
- **The failure** — the "Failure modes" subsection reads as a synonym for "Edge cases", so producers emit one section twice. **How you'd know** — a produced CRUD spec carries a populated Failure modes section it shouldn't (AC3 fails). **What it means** — the prose must keep the distinction (approach-vs-code) and the complexity-bar guard explicit; both are retained verbatim.

## 5. SCENARIOS

Given the updated nlspec producer, When it produces a spike / unvalidated-assumption spec, Then the spec carries a populated Failure modes section (failure / how-you'd-know / what-it-means triple) and the WHY opens with the load-bearing model.

Given the updated producer, When it produces a mechanical CRUD spec, Then the spec carries no Failure modes section (complexity-bar bloat guard holds).

## 8. DONE

- [ ] `faffter-dark-nlspec/SKILL.md` carries both edits (A under §1 WHY, B under §4 HOW).
- [ ] `faff validate-adapters` passes on the edited skill.
- [ ] The two AC behaviours (spike → populated section + model-first WHY; CRUD → no section) are achievable from the prose as written.

confidence: high
