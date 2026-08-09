# Hard-surface `faff doctor` COPY-install loudly at beep-boop autonomous entry — FAFF-475

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-475.

This is the buildable design spec for FAFF-475. Audience: the build agent implementing the fix, and the human reviewers gating it. The change is prose-only — `faff-beep-boop/SKILL.md` plus one small cross-reference tightening in the gateway — with no new runnable surface, so there is no architecture proposal.

## 1. WHY — Problem and Principles

**The load-bearing model.** The gateway already runs `faff doctor` once at entry (gateway → **Install health (doctor-at-entry)**) and, in autonomous mode, correctly refuses to auto-repair (`faff sync` mutates `~/.claude` outside the PR flow). Today that autonomous branch does exactly one thing on a stale COPY-install: *"Log the stale-install finding to `.faff/logs/…` and surface it for `/faff-wtf`, then continue."* That is a **deferred** surface — visible only if and when a human later runs `/faff-wtf`. It is not visible in *this run's own* report at all.

**Problem statement.** A run-20260712-171150-beepboop-full run had every faff skill installed as a stale COPY. The gateway's doctor-at-entry check fired, logged the finding, and continued — correctly not auto-syncing — but the finding never reached the run's own summary or tracker post. The operator only learned the builds ran stale prose *mid-run*, when a build subagent hit missing FAFF-383 effects-declare instrumentation the installed copy predated. This change makes beep-boop thread that same doctor exit code into **its own run report**, loud and up front, so "your builds are running stale skills" is the first thing a human reads about this run — not a symptom they have to diagnose, and not contingent on a follow-up `/faff-wtf` call.

**Design principles:**

- **Surface, never repair.** The autonomous rule that beep-boop must never run `faff sync` or otherwise mutate `~/.claude` is unchanged and non-negotiable — this spec adds visibility only, using data `faff doctor` already produces.
- **Reuse `faff doctor`'s own output, don't re-derive it.** `faff doctor` already renders a `RESULT: … — install is not clean.` summary line (covering COPY installs, dangling links, worktree-fragile links (FAFF-443), and the FAFF-434 merge-fence check together) and a `Fix: …` remediation line. Beep-boop captures those verbatim rather than re-implementing the classification logic in prose — a second, prose-side "is this COPY?" re-derivation is exactly the kind of drift the gateway's single-source-of-truth rule (docs/reference/skill-authoring.md) exists to prevent.
- **Loud means first, not merely present.** A line appended after 500 lines of shipped/parked buckets does not satisfy "loud" — it must lead the run summary and the tracker post, ahead of the Methodology line and the economics line respectively.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `faff/SKILL.md` → **Install health (doctor-at-entry)** | prose | The existing gateway-level check this spec threads output from; unchanged behaviour, new consumer |
| `faff-beep-boop/SKILL.md` → **Reporting** (`## Reporting`, `### 1.`, `### 2.`) | prose | Where the run summary / tracker post are assembled — the two places the new line is prepended |
| `plugin/skills/faff/bin/lib/gates.js` → `cmdDoctor` | JS | Emits the `RESULT: …` / `Fix: …` lines this spec reuses verbatim; confirms exit 1 covers COPY + dangling + worktree-fragile links + missing merge-fence together |
| `plugin/skills/faff/bin/lib/validate-adapters.js` → `SKILL_LINE_CAP_OVERRIDE` | JS | `faff-beep-boop` is currently capped at 650 lines (already at 649); this spec's addition needs a small cap bump |

**Scope statement.** This is a reporting-surface change inside beep-boop's existing run-report assembly; it does not touch `faff doctor`'s detection logic, the gateway's autonomous no-sync rule, or any other sub-skill's entry sequence.

## 2. OUT OF SCOPE

- **Confidence downgrade / per-build audit-trail annotation on a COPY-install** (the ticket's open item 3). **Why excluded:** install health is a run-wide fact about the *toolchain*, not evidence about any individual issue's spec quality or build correctness — conflating the two would silently and incorrectly downgrade unrelated builds' confidence ratings, a materially bigger and separate mechanism (deciding *which* signals feed spec confidence, and how a downstream consumer like `faff-graft`/routing would read a downgraded rating) that deserves its own spec and review, not a rider on a visibility fix. **Extension point:** a future ticket could have the build-queue assembly step (`faff-beep-boop/SKILL.md` → step 4) read this run's doctor exit code and stamp a `stale_install: true` field onto each admitted issue's ledger entry, for a downstream consumer to interpret — deliberately not built here.
- **Interactive-mode behaviour.** The interactive soft-offer (`faff/SKILL.md` → Install health, "Interactive" bullet) is unchanged — a human already sees the offer synchronously and can accept/decline. **Why excluded:** the ticket's evidence and RCA are entirely about the autonomous branch; the interactive branch already surfaces the finding at the point of use. **Extension point:** none intended.
- **Auto-remediation in any mode.** Autonomous must never run `faff sync`; this spec doesn't add a flag or config to change that. **Why excluded:** re-linking deletes real directories in the user's global skills dir — an out-of-PR-flow side effect the Autonomous Mode Contract already forbids. **Extension point:** none — this is a hard floor, not a default.
- **Changing `faff doctor`'s exit-code semantics or its `RESULT`/`Fix` line wording.** This spec is a pure consumer of the existing CLI output. **Why excluded:** `faff doctor` already correctly folds COPY / dangling / worktree-fragile (FAFF-443) / merge-fence-missing into one exit-1 signal (FAFF-190/FAFF-434); re-splitting that here would be an unrelated CLI change. **Extension point:** `plugin/skills/faff/bin/lib/gates.js` → `cmdDoctor`, if a future ticket wants a machine-readable `--json` doctor output.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| **Install-health preflight** | The new beep-boop-local step: capture the gateway-load preamble's `faff doctor` exit code and result text for use in *this run's* own report. Not a new invocation of `faff doctor` — the gateway already ran it once at entry; this is a read of that same result. |
| **Loud warning line** | A single `⚠ INSTALL-HEALTH: …` line, verbatim-derived from `faff doctor`'s own `RESULT: …` line plus a `faff sync` remediation hint, placed ahead of every other line in both the run summary and the tracker status post. |

**Design decisions:**

- **Where does the warning line's text come from?** Options: (a) beep-boop re-derives its own wording from the raw list of COPY/dangling skill names; (b) beep-boop reuses `faff doctor`'s own `RESULT: …` line verbatim. (a) requires re-parsing/re-classifying output the CLI already classified — a second source of truth for the same fact. **Chosen:** (b) — reuse `faff doctor`'s `RESULT: …` line verbatim, prefixed `⚠ INSTALL-HEALTH:` and suffixed with the fixed remediation hint. One classifier (the CLI), one renderer (beep-boop's report).
- **Should the confidence-downgrade / audit-annotation question (ticket item 3) be resolved now?** Options: (a) leave it open as a `**Punt:**`; (b) close it for v1 as surface-only, recording the bigger idea as an explicit out-of-scope follow-up. (a) would block this spec at `medium` confidence and stall a small, high-value visibility fix behind a materially bigger, separate design question. **Chosen:** (b) — v1 is surface-only; item 3 is answered "no, not this ticket" and captured in **OUT OF SCOPE** with a concrete extension point, not deferred as an open question.
- **Does the new line replace or precede the existing Methodology-line / economics-line convention?** Options: (a) append after; (b) prepend ahead of everything, including a configured Methodology line. (a) fails the ticket's explicit "loud... up front" requirement — a reader has to scroll past the whole report to see it. **Chosen:** (b) — the install-health line, when present, is the literal first line of both the run summary file and the tracker post; the existing Methodology-line convention (`## Reporting` → `### 1.`) becomes the line *after* it (or stays first, unchanged, when install-health is clean).

## 4. HOW — Behaviour

**Approach.** One new short section in `faff-beep-boop/SKILL.md` (between `## Configuration` and `## Invocation`) plus two small edits to the existing `## Reporting` subsections that already describe the summary file and the tracker post.

```
PROCEDURE install_health_preflight(run_id):
  1. The gateway-load preamble (faff/SKILL.md → Install health) has already run
     "$faff" doctor once this turn, in autonomous mode, per its existing rule:
     never prompt, never run `faff sync`, log the finding, continue. This step
     does not re-invoke faff doctor — it reads that same exit code + stdout.
  2. IF exit code == 1 (install not clean — COPY / dangling / worktree-fragile
     links / missing merge-fence, folded together by faff doctor itself):
       a. Take the CLI's own "RESULT: ... — install is not clean." line verbatim.
       b. Compose the warning:
            "⚠ INSTALL-HEALTH: <RESULT line verbatim> Remediation: run `faff sync`."
       c. Prepend this line to .faff/runs/<run_id>/summary.md as the file's
          first line, ahead of the Methodology line (see Reporting → step 1).
       d. Prepend the same line to the condensed tracker status post
          (see Reporting → step 2), ahead of the economics line.
  3. IF exit code == 0 (clean) OR exit code == 2 (no skills found / unreadable
     target — not worth a prompt, per the existing gateway rule): no line is
     added; nothing else changes.
  4. This step never runs `faff sync` and never mutates any per-issue ledger
     entry, spec confidence, or audit trail — it is a run-report addition only.
```

**Behaviour summary.** The install-health line is the loud, up-front analog of the run summary's existing conditional-first-line pattern (the Methodology line) — same mechanism (a conditional literal first line), different trigger (doctor exit code vs. configured slot), and the two compose in a fixed order (install-health, then Methodology) rather than fighting over "first line."

**Edge cases:**

- **Both install-health warning AND a configured Methodology line apply.** The install-health line comes first; the Methodology line follows immediately after, unchanged from today's format.
- **`faff doctor` exits 2** (no faff skills found under the target, or the target is unreadable). Per the existing gateway rule this is silent-continue — no warning line, exactly as if doctor had exited 0. This spec does not change that.
- **A run with no configured Methodology skill AND a dirty install.** The install-health line is the file's only prepended line; the body starts with the `# Beep-Boop Run …` heading immediately after it, exactly as the Methodology-absent case works today.

**Failure modes:**

- **The failure:** the new step is implemented as a second, independent re-classification of "is this a COPY install" (re-reading skill symlink state itself) instead of reusing `faff doctor`'s own output. **How you'd know:** the warning line's wording diverges from what `faff doctor` printed at entry, or a case exists where the two disagree. **What it means:** the "one classifier" design principle was violated — fix by reading `faff doctor`'s own `RESULT:` line instead of re-deriving it.
- **The failure:** the warning line is appended at the *end* of the summary/tracker post instead of prepended. **How you'd know:** a run with a dirty install and a long Shipped/Parked list buries the warning below the fold. **What it means:** the "loud means first" principle was violated — reposition it as the literal first line per the HOW procedure.

**Anti-pattern:** re-deriving the COPY/dangling/fence classification from raw `faff doctor` stdout parsing beyond taking the one `RESULT:` line whole. Why: any finer re-parsing recreates a second copy of logic `gates.js`'s `cmdDoctor` already owns.

## Scenarios

```
Given faff doctor exits 1 (install not clean) at this run's entry
When beep-boop writes .faff/runs/<run-id>/summary.md
Then the file's first line is "⚠ INSTALL-HEALTH: <doctor's RESULT line> Remediation: run `faff sync`."
And this line precedes any configured Methodology line and the "# Beep-Boop Run" heading
```

```
Given faff doctor exits 1 at this run's entry
When beep-boop posts the condensed run report to the tracker
Then the post leads with the same "⚠ INSTALL-HEALTH: …" line, ahead of the Economics line
```

```
Given faff doctor exits 0 or exits 2 at this run's entry
When beep-boop writes the run summary and tracker post
Then no install-health line is added and the report is byte-for-byte identical to today's format
```

- Autonomous mode still never runs `faff sync` and never prompts on a dirty install. *(Structural — greppable: the gateway's existing "never prompt, never run faff sync" autonomous rule is unmodified by this change; the new beep-boop section explicitly restates it rather than overriding it.)*

## 5. Design Decision Rationale

**Where should the warning text come from?**
- Beep-boop re-derives its own classification from raw skill-symlink state — duplicates `faff doctor`'s own logic, a second source of truth. Rejected.
- **Chosen:** reuse `faff doctor`'s own `RESULT: …` line verbatim, wrapped in a fixed `⚠ INSTALL-HEALTH: … Remediation: run \`faff sync\`.` template. One classifier, one new renderer.

**Should the confidence-downgrade / audit-trail-annotation question be settled in this ticket?**
- Leave it open as a `**Punt:**`, blocking this spec at medium confidence. Rejected — it stalls a small, high-value, mechanically simple visibility fix behind a separate, materially bigger design question (how a stale-install signal should interact with per-issue confidence and audit trails).
- **Chosen:** settle it now as "no — v1 is surface-only", captured as an explicit **OUT OF SCOPE** item with a concrete extension point (an optional per-issue `stale_install` ledger stamp a future ticket could add). This keeps FAFF-475 a clean, small, high-confidence slice while losing nothing — the bigger idea is recorded, not silently dropped.

**Where does the warning line sit relative to the existing Methodology-line convention?**
- Append after the existing report body. Rejected — fails the ticket's explicit "up front... not a deferred log line" requirement.
- **Chosen:** the install-health line is the new literal first line (ahead of the Methodology line when both apply), reusing the exact conditional-first-line mechanism the Methodology line already established, in a fixed compose order.

## 6. Open Questions and Assumptions

**Open Questions:** none. Every decision above is closed; the confidence-downgrade/audit-annotation question is deliberately answered "not in this ticket" rather than left open (see OUT OF SCOPE and Design Decision Rationale).

**Assumptions:**

- **Assumes:** `faff doctor`'s exit-1 `RESULT: … — install is not clean.` line format (in `plugin/skills/faff/bin/lib/gates.js` → `cmdDoctor`) stays stable enough to embed verbatim in the new warning line. *Validation:* already confirmed by reading `cmdDoctor`'s current implementation as part of this spec's exploration; if a future `faff doctor` change alters that line's wording, the embedded warning simply carries the new wording (no parsing/pattern-matching depends on its exact shape, so this is not brittle).
- **Assumes:** `faff-beep-boop/SKILL.md`'s documented `SKILL_LINE_CAP_OVERRIDE` (currently 650, file already at 649 lines) needs a small bump to fit this addition. *Validation:* count the file's line delta after the edit and bump `plugin/skills/faff/bin/lib/validate-adapters.js`'s `SKILL_LINE_CAP_OVERRIDE["faff-beep-boop"]` by the same margin plus a small buffer; `faff validate-adapters` fails loud if the bump is insufficient, so this is self-checking at build time.

## 7. DONE — Definition of Done

### From WHY
- [ ] A dirty-install (`faff doctor` exit 1) autonomous run surfaces the finding as the literal first line of both `.faff/runs/<run-id>/summary.md` and the tracker status post — not only in `.faff/logs/…` and not only visible via a later `/faff-wtf` call.

### From WHAT (design decisions)
- [ ] The warning line's text is `faff doctor`'s own `RESULT: …` line verbatim, wrapped `⚠ INSTALL-HEALTH: … Remediation: run \`faff sync\`.` — no independent re-classification logic is added.
- [ ] `faff-beep-boop/SKILL.md` records the confidence-downgrade / audit-annotation question as explicitly out of scope (not silently dropped, not left as an open punt).

### From HOW (behaviour)
- [ ] A new `## Install-health preflight` section exists in `faff-beep-boop/SKILL.md` (between `## Configuration` and `## Invocation`) describing the procedure above.
- [ ] `## Reporting` → `### 1.` (`summary.md`) states the install-health line precedes the Methodology line when both apply.
- [ ] `## Reporting` → `### 2.` (tracker status update) states the install-health line leads the post, ahead of the economics line.
- [ ] `faff doctor` exit 0 / exit 2 behaviour is explicitly unchanged (no line added).
- [ ] The gateway's existing autonomous "never prompt, never run `faff sync`" rule is restated, not overridden.

### From HOW (non-regression)
- [ ] `plugin/skills/faff/bin/lib/validate-adapters.js`'s `SKILL_LINE_CAP_OVERRIDE["faff-beep-boop"]` is bumped enough to cover the addition; `faff validate-adapters` passes.
- [ ] `node --test` passes for the full suite (no CLI behaviour touched, but the line-cap constant changed).

### Integration smoke test
```
1. grep faff-beep-boop/SKILL.md for "Install-health preflight" -> present.
2. grep the same file's Reporting section for "INSTALL-HEALTH" in both the
   summary.md description and the tracker status update description.
3. faff validate-adapters -> PASS (line cap + duplicated-block + paragraph-cap clean).
```
If these three hold, the surfacing is wired into both output surfaces and the file stays within its documented, bumped line cap.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```
