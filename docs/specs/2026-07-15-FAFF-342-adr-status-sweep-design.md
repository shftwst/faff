# ADR status sweep — accept the shipped-but-Proposed set + fix the 0034/0039 inversion

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-342.

One-pass status curation of `docs/adr/`: the mechanical `Proposed → Accepted` flips of the audit's R5/D-class set, resolution of the 0034/0039 acceptance inversion, and an optional non-failing `adr validate` advisory surfacing future Accepted-cites-Proposed incoherence.

## 1. WHY
An ADR's `Status` is a claim about reality: "Accepted" means it governs and its machinery is live. 18 ADRs read `Status: Proposed` while their decisions are load-bearing in production code (audit finding R5, Appendix B); ADR-0039 (Accepted) is founded on ADR-0034 (Proposed) — an acceptance inversion making the log incoherent. Flip the evidence-backed set to Accepted and resolve the inversion.

Principles: evidence-gated flips (each backed by the audit's implementation anchor, re-confirmed live before flipping; annotate why-not, never flip blind); minimal in-place status-token edit (one word per file, never body/date/issue lines); scope closed by Appendix B exactly.

## 2. OUT OF SCOPE
Remaining Proposed ADRs outside the audit set (0043/0044/0046); rewriting bodies/dates; making the advisory a hard failure; structured founds/depends-on metadata.

## 3. WHAT
Sweep set (18, from Appendix B): 0009, 0011, 0012, 0014, 0018, 0019, 0020, 0021, 0022, 0023, 0024, 0025, 0026, 0027, 0028, 0034, 0035, 0037 — each with a live implementation anchor (faff label / intakecheck / faff contain / registry+lint-cli-doc / dod classify / faff admissible / container status / faff prdr admit·yagni·coverage / spec_review slot+lenses / faff sentry / topology dial / resolveAppetite).

Status-line shape (uniform): `- **Status:** Proposed` → `- **Status:** Accepted`.

Advisory interface — `adr validate` gains informational output only; problem list + exit code unchanged. Line shape: `advisory: ADR-NNNN (Accepted) cites ADR-MMMM (Proposed)`.

## 4. HOW
Part A — flips: for each ADR in the set, confirm the Appendix-B anchor is live, then replace ONLY the Status value token (recordSupersede-style regex `/^([\s>*-]*\*{0,2}Status[\s*]*:[\s*]*).*$/mi → $1Accepted`); change nothing else. Flipping 0034 (a set member) resolves the 0034/0039 inversion for free — do NOT edit 0039.

Part B — advisory: after computing `problems`, scan Accepted ADRs whose bodies cite a still-Proposed ADR (`\bADR-(\d{4})\b`), emit an advisory line per (accepted, proposed) pair. Exclude self-references, Superseded citations; de-dup per pair. NEVER pushed into `problems`; exit code unchanged.

Anti-patterns: editing 0039; blanket-flipping every Proposed ADR (0043/0044/0046 are out of scope); pushing advisories into `problems`.

## 5. Scenarios
- 0034 flips to Accepted; no Accepted ADR remains founded on a Proposed 0034.
- All 18 read Accepted; out-of-scope Proposed ADRs unchanged.
- An Accepted ADR citing a Proposed one → advisory line, exit 0.
- `faff adr validate` reports all ADRs valid (exit 0) after the sweep.

## 6/7. Rationale & Assumptions
Evidence-gated per-ADR flip (audit's own "flip or annotate why-not" posture). Resolve inversion by flipping 0034, not editing 0039. Advisory is a non-failing line from `adr validate` (option c), kept out of `problems`. Assumes the prose-citation heuristic is acceptable for an advisory-only signal; each Appendix-B anchor is present at build time.

## 8. DONE
- No ADR reads Proposed while its Appendix-B anchor is live (bar annotated why-not).
- 0034/0039 inversion gone (0034 Accepted, 0039 unchanged).
- All 18 read `- **Status:** Accepted`; body/date/issue byte-unchanged bar the token.
- Out-of-scope Proposed ADRs unchanged.
- `adr validate` prints an advisory line per Accepted-cites-Proposed; advisories never enter `problems` or change the exit code; self-refs + Superseded citations produce none; duplicate pairs emit at most one line.
- `adr --selftest` gains a case asserting advisories don't change the problem count / exit.
- `faff adr validate` reports all ADRs valid (exit 0) after the sweep.

confidence: high
spec-review: approve
