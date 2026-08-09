# Spec — FAFF-114: Audit prompt cruft + cross-skill duplication

> Spec: faffter-dark-nlspec · 2026-06-16 · autonomous · confidence: high. Full spec on Linear FAFF-114.

A **read-only audit spike**. It produces one **inventory artifact** — a worklist of what to cut, what to bullet, and what to centralise across the faff-family `SKILL.md` files — that downstream cleanup tickets (FAFF-115/116/117) consume. It performs **zero edits** to any `SKILL.md`.

## 1. WHY
The faff-family skill prompts have accreted three kinds of weight the project "Skill prompts are lean, deduplicated and skimmable" exists to remove: dead `FAFF-NN` references (provenance residue the reader never acts on), paragraph-instead-of-list prose, and prose duplicated across skills. Nobody can confidently cut any of it without an objective, file-by-file inventory. FAFF-114 builds that worklist; it is the front of the chain (FAFF-115/116/117 blocked on it). The audit must itself be skimmable (the project's value, applied reflexively).

## 2. OUT OF SCOPE
- **Editing any `SKILL.md`** → FAFF-116 + per-area cleanup. FAFF-114 produces findings only.
- **The gateway restructure + single-source mechanism** → FAFF-115. FAFF-114 inventories + names candidate homes; it does not move prose.
- **The skill-authoring charter + lint** → FAFF-120.
- **Non-faff skills** (`trashbat-*`, `client-*`) — scope is the faff-family files only (`faff`, `faff-*`, `faffidavit-*`, `faffter-*`).

## 3. WHAT — the inventory record shapes
One artifact with a census header + three findings tables. Every field is mechanical `[M]` (scripted, reproducible) or judgement `[J]`.
- **Census header [M]**: audit_date, file_count, faffnn_total, faffnn_gateway, per_file_lines — regenerated at run, never copied from the ticket.
- **Issue-reference record** (one row per FAFF-NN occurrence): file `[M]`, line `[M]`, ref `[M]`, quote `[M]`, verdict `[J]` (keep/drop), reason `[J]`.
- **Paragraph-instead-of-list record**: file `[M]`, line_range `[M]`, enumerated_subject `[J]`, recommended_form `[J]`.
- **Duplication-cluster record**: cluster_name `[J]`, files `[M]`, approx_lines `[M]`, canonical_home `[J]`, recommended_action `[J]`, downstream_owner `[J]`.

## 4. HOW — the audit procedure
Five steps; the census (1–2, candidate-finding in 4–5) is scripted + reproducible, the verdicts are judgement.
1. **Scope the file set [M]**: enumerate `plugin/skills/{faff,faff-*,faffidavit-*,faffter-*}/SKILL.md`; capture per-file lines. Measure live.
2. **Live census of FAFF-NN refs [M]**: extract every occurrence with file:line:clause; produce faffnn_total + faffnn_gateway.
3. **Classify each ref keep/drop [J]** via the Decision-2 threshold.
4. **Inventory paragraph-instead-of-list blocks [M-scan + J]**.
5. **Detect cross-file duplication clusters [M-candidates + J-naming]** via `grep -l` per shared rule.
6. **Emit the artifact** at `verification/audits/FAFF-114-skill-prompt-audit.md`, design-doc house style, skimmable. No `SKILL.md` edited.

## 5. SCENARIOS
- **Given** the ticket cites stale counts, **when** the census scripts run, **then** the header reports the *measured* counts and no number is copied from the ticket.
- **Given** the live FAFF-NN census, **when** step 3 completes, **then** every occurrence row carries keep/drop + a reason — zero unclassified rows.
- **Given** the duplication clusters, **when** the artifact is emitted, **then** each cluster names a canonical_home + a recommended_action.
- **Given** the audit run, **when** it completes, **then** `git status` shows no modified `SKILL.md` — the only new file is the inventory artifact.
- **Assertion**: the artifact is itself skimmable (lists/tables, no coded label scheme).

## 6. DESIGN DECISION RATIONALE
- **Decision 1 — output location.** **Chosen:** a committed doc at `verification/audits/FAFF-114-skill-prompt-audit.md` (build agents run in worktrees off the committed repo; gitignored `design/` is invisible to them; tracker comments are unwieldy for a ~100-row inventory).
- **Decision 2 — keep/drop threshold.** **Chosen:** DROP if (a) pure historical provenance, (b) a decision-record/timestamp, or (c) parenthetical background the reader never acts on. KEEP if (i) part of an active rule's name/title, (ii) a contract id the reader must resolve, (iii) a control-label/mechanism name, or (iv) a live cross-skill pointer. Tie-break: when ambiguous, **KEEP** (fail-safe — the audit flags candidates, the human-gated cleanup ticket cuts).
- **Decision 3 — timebox.** **Chosen:** 0.5-day; on overrun, ship the census + high-confidence verdicts, default the rest to `keep`.
- **Decision 4 — record shape.** **Chosen:** the three record shapes + census header, each field `[M]`/`[J]`.
- **Decision 5 — determinism split.** **Chosen:** census scripted + reproducible; verdicts judgement, each recorded with its reason.

## 7. ASSUMPTIONS
- **Assumes:** the faff-family skills live at `plugin/skills/{faff,faff-*,faffidavit-*,faffter-*}/SKILL.md`. *Validate:* re-run the step-1 enumeration.
- **Assumes:** the committed `docs/` tree exists + `verification/audits/` is acceptable. *Validate:* `records/specs/`, `records/adr/` exist.
- **Assumes:** the named gateway canonical-home sections exist in `faff/SKILL.md`. *Validate:* grep the live headings.

## 8. DONE
- [ ] Census header present + live (file_count, faffnn_total, faffnn_gateway, per-file lines — measured, not copied).
- [ ] Issue-reference table complete — one row per FAFF-NN occurrence with file/line/quote + verdict/reason; zero unclassified.
- [ ] Paragraph-instead-of-list table present.
- [ ] Duplication-cluster table present — every cluster has files, approx lines, canonical_home, recommended_action, downstream_owner.
- [ ] Determinism split honoured — every field tagged `[M]`/`[J]`.
- [ ] Artifact emitted at `verification/audits/FAFF-114-skill-prompt-audit.md`, skimmable, no coded label scheme.
- [ ] Nothing edited — `git status` shows no modified `SKILL.md`; only the inventory artifact is new.

confidence: high
