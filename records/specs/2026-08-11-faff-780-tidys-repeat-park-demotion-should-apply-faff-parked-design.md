# Spec — FAFF-780: tidy's repeat-park demotion must apply `faff-parked`, not just the `faff-repeat-parked` breadcrumb

> Spec: faffter-dark-nlspec · 2026-08-11 · autonomous · confidence: high. Full spec on Linear FAFF-780.

This is a buildable spec for FAFF-780, addressed to the build agent editing the faff-tidy skill prompt and to human reviewers. The change is **prose-only**: it edits `faff-tidy/SKILL.md` so that the repeat-park Todo→Backlog demotion applies the pool-exclusion label (`faff-parked`) alongside the existing breadcrumb (`faff-repeat-parked`) and posts a park comment, keeping the four sites that describe the demotion mutually coherent. No CLI, query, or eligibility logic changes.

**Build-editable target:** `/home/faff/app/plugin/skills/faff-tidy/SKILL.md` (the read-only plugin-cache path `…/cache/faff/faff/0.15.0/skills/faff-tidy/SKILL.md` is a downstream install of the same content — identical line numbers).

## 1. WHY — Problem and Principles

**Load-bearing model.** The buildable/eligible pool is gated by `faff next`: `faff next` returns `needs-human` the instant its `--parked` flag is set, evaluated **before** any spec/status check (`next.js` ~line 44: `if (parked) return ["needs-human", "parked — human decision"]`). That `--parked` flag is fed by exactly one label — `faff-parked` (gateway → _Base transition_, ~line 446: "`--parked` ← the `faff-parked` label"). So **`faff-parked` is the label that removes an issue from the pool.** `faff-repeat-parked` feeds nothing — it is a cosmetic, machine-writable breadcrumb, inert to both `next.js` and `eligible.js`.

**Problem statement.** Tidy's autonomous repeat-park demotion (Todo→Backlog) currently writes **only** `faff-repeat-parked` — an inert breadcrumb — so a demoted issue lands in Backlog still poolable and gets re-drained straight back; the demotion is a status flip, not a real exit. The fix applies `faff-parked` **in addition to** the breadcrumb (plus a park comment), so the issue actually leaves the pool via `faff next --parked`. No behaviour is lost: `faff-repeat-parked` keeps its "why demoted / this is a repeat" role for `/faff-wtf` and the calibration loop.

**Corrected mechanism (the ticket's "why it works" is imprecise — stated precisely here).**
- There is **no runner GraphQL `labels.every.name.nin`** entrypoint in this codebase (the ticket asserts one; only a Fly app-name string appears in `scripts/throughput-snapshot.sh`). Do **not** cite a runner query as the exclusion mechanism.
- The real exclusion is **`faff next --parked`**, fed by `faff-parked`. Applying `faff-parked` is what removes the ticket from the buildable/eligible pool.
- `faff eligible` / `automationEligible()` reads **only** `faff-automate` / `faff-automation-hold` — it does **not** read `faff-parked`. The ticket's phrase "excluded from `faff eligible`" is loose: exclusion runs through `faff next --parked`, not `faff eligible`. Both the `faff-parked` (pool) and `faff-automate` (eligibility) gates independently keep a demoted, not-cranked-up issue out — but the demotion's job is the pool gate.
- `faff-repeat-parked` being inert to both `next.js` and `eligible.js` is exactly why the breadcrumb-only demotion never removed the issue from the pool.

**Design principle — the demotion is a genuine park, disposed via the shared Park protocol.** A repeat-park is not a soft breadcrumb; the gateway already treats the pattern as the strongest human signal — repeat-parked gets **no** resolve-attempt (gateway → _Resolve-attempt before park_, ~line 768: "the pattern itself signals that a human needs to act"). So the demotion must apply the park label and post a park comment, reusing the shared **Park protocol** rather than inventing a bespoke disposition.

**Design principle — the park comment reason must not be auto-strippable by the next tidy pass.** Tidy's own stale-`faff-parked` auto-remove rules (same file, ~lines 277–283) strip `faff-parked` when a park reason matches a now-forbidden autonomous pattern (session compaction, context length, post-merge-only file edits, etc.), or a cited blocker shipped, or a cited punt closed. The demotion's park comment must therefore state a **demotion-specific** reason (the repeat-park pattern: root-cause class + count over the rolling window) and must **not** verbatim restate any forbidden-pattern raw reason — otherwise the next pass could auto-strip the label the demotion just applied, before a human acts.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faff-tidy/SKILL.md` | Skill prose (Markdown) | The only file edited — the four demotion sites live here |
| `plugin/skills/faff/SKILL.md` (gateway) | Skill prose | Owns Park protocol (~826), Control-label provisioning (~848), the `--parked` mapping (~446), the threshold (~814); referenced, not edited |
| `plugin/skills/faff/bin/lib/next.js` | JS | `--parked ⇒ needs-human` (the real pool exclusion); read-only, not edited |
| `plugin/skills/faff/bin/lib/eligible.js` | JS | `automationEligible()` reads only automate/hold, not `faff-parked`; read-only, not edited |

**Scope statement.** This is one prose change in one skill file (faff-tidy), correcting a disposition gap in the autonomous mechanical-fix set — it touches no runtime code and no queries.

## 2. OUT OF SCOPE

- **Any change to `faff eligible` / `eligible.js` / `automationEligible()`.** — exclusion for this fix runs through `faff next --parked`; eligibility is a separate, correct gate.
- **Any change to `faff next` / `next.js` or the `--parked` mapping.** — the pool-exclusion mechanism already works the moment `faff-parked` is present; no wiring is missing.
- **The beep-boop eligibility criteria / any runner query.** — no query keys on `faff-repeat-parked`, and none needs to change.
- **FAFF-779 (`needs-decision-first` parking fix).** — open sibling, ships independently; different park cause.
- **Renaming the `faff-repeat-parked` label or the `repeat_parks_demoted` counter.** — the breadcrumb keeps its role and the counter still counts demotions; both semantics unchanged.
- **The methodology `backlog-diagnostics` repeat-park detection / `faff park-history` seam.** — tidy consumes the qualifying set and does not re-count; detection is untouched.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Pool / buildable-eligible pool | The set of issues `faff next` will route to `graft`/`prep`. `faff next --parked` ejects an issue from it. |
| `faff-parked` | The pool-exclusion control label; maps to `faff next --parked`. Machine-writable. Its presence is the park contract. |
| `faff-repeat-parked` | A cosmetic, machine-writable breadcrumb marking a Todo→Backlog repeat-park demotion. Inert to `next.js` and `eligible.js`. |
| Repeat-park demotion | The autonomous mechanical fix that demotes a Todo issue to Backlog when it is in the `backlog-diagnostics` repeat-park set. |
| Root-cause class | The park-classification taxonomy value (gateway → _Automation-routing verdict (fixed)_) the repeat-park set is grouped by. |
| Demotion-specific reason | A park-comment reason stating the repeat-park pattern (root-cause class + count over the rolling 21-day window) — distinct from any raw per-park reason. |

**Threshold facts (for the reason string).** The demotion fires at **3+ parks in the same root-cause class within a rolling 21-day window** (gateway → _Threshold (fixed)_, ~line 814). The qualifying set comes from the methodology's `backlog-diagnostics`, backed by the deterministic `faff park-history` seam (FAFF-162); tidy consumes that output and does **not** re-count or call the seam itself.

**Control-label provisioning (the mechanical op).** Applying a control label is `faff label add <issue> <label>` **plus its descriptor's write** (gateway → _Control-label provisioning_). Mirror the existing `faff-repeat-parked` phrasing for the new label: "apply `faff-parked` via `faff label add <issue> faff-parked` and its descriptor's write (gateway → **Control-label provisioning**)". Do not restate what a descriptor write is (FAFF-188 already routed tagging sites through `faff label`).

**Park comment (reuse the shared protocol).** Post the park comment per the shared **Park protocol** (gateway → _Park protocol_, step 3: tracker comment stating cause / what was attempted / what a human must do). Do **not** restate the protocol. A Backlog demotion has **no branch/PR**, so only steps 3–4 (tracker comment + `.faff/logs/…` write) apply; steps 1–2 (commit WIP / draft PR) are **N/A**. State this N/A explicitly so the build agent doesn't add a branch step.

**The four sites to keep coherent** (all in `plugin/skills/faff-tidy/SKILL.md`; line numbers approximate):

| # | Line ~ | Role | Change |
|---|---|---|---|
| 1 | 297 | **Primary normative fix** — Autonomous auto-action bullet "Demote `repeat-parked` Todos to Backlog." | Add `faff-parked` write + park comment (the substantive edit) |
| 2 | 141 | Interactive mechanical-fix table row | Update to also apply `faff-parked` + park comment, for parity |
| 3 | 253 | Confirm/report line ("L repeat-parks demoted") | Confirm wording stays coherent (expected: no change) |
| 4 | 320 | Return-value counter `repeat_parks_demoted: N` | Semantics unchanged; no rename |

**Design decisions.** See §6 for full rationale. The core pick:
- **Chosen:** apply `faff-parked` **in addition to** `faff-repeat-parked` on the demotion (breadcrumb retained, pool-exclusion label added), plus a demotion-specific park comment — the semantically correct disposition and the only thing that actually ejects the issue from the pool.

## 4. HOW — Behavior

**Approach.** Edit the two behavioural sites (297, 141) so the demotion applies **both** labels and posts a park comment; verify the two downstream reporting sites (253, 320) stay coherent. All human-facing output (including the park comment) already passes through the `rendering_adaptor` normalise pass (faff-tidy → _Output and chaining_) — no change needed there.

**Site 1 — line ~297, the autonomous auto-action bullet (primary).** The edited bullet must convey, in skimmable prose (WHAT/HOW, not code):

- WHEN an active issue is in the `backlog-diagnostics` repeat-park set:
  1. Demote Todo → Backlog (unchanged).
  2. Apply `faff-repeat-parked` — the breadcrumb (why demoted / this is a repeat), via `faff label add <issue> faff-repeat-parked` + descriptor write (unchanged).
  3. Apply `faff-parked` — the pool-exclusion label, via `faff label add <issue> faff-parked` + descriptor write (gateway → Control-label provisioning). **(NEW — this is what removes the issue from the `faff next --parked` pool.)**
  4. Post a park comment per the shared Park protocol (step 3): a **demotion-specific** reason = the repeat-park pattern, i.e. root-cause class + count over the rolling 21-day window (e.g. "repeat-parked N times in 21 days in root-cause class <class>"). Branch/PR steps (protocol steps 1–2) are N/A — a Backlog demotion has no worktree. **(NEW)**
  5. Log the demotion (unchanged).

The bullet must also carry the corrected rationale in one line: applying `faff-parked` is what actually exits the pool (`faff next --parked ⇒ needs-human`); `faff-repeat-parked` is inert and stays purely the breadcrumb. Keep the existing sentence that the qualifying set comes from `backlog-diagnostics` / `faff park-history` and tidy does not re-count.

**Site 2 — line ~141, the interactive mechanical-fix table row.** Update the "Mechanical fix" cell for parity: "Demote to Backlog; apply `faff-repeat-parked` **and** `faff-parked` (both via `faff label add …` + descriptor write, gateway → Control-label provisioning); post a park comment (repeat pattern: root-cause class + count) per the Park protocol; log the demotion." Interactive and autonomous demotions must dispose identically.

**Site 3 — line ~253, the report line.** The summary says "L repeat-parks demoted". The count still counts demotions and both labels are now applied on each, so "demoted" remains accurate. **Expected outcome: no change.** If the build agent judges a word tweak is needed for coherence, it is wording-only — never a semantic/count change.

**Site 4 — line ~320, the return counter.** `repeat_parks_demoted: N` still counts demotions (now each carrying both labels + a comment). **No rename, no semantic change.**

**Auto-clear guard (steady state — must hold).** After this change, the demotion's `faff-parked` must **stick** until a human breaks the cycle and re-invokes the relevant skill (repeat-parked gets no resolve-attempt, so tidy never auto-resolves it). The next tidy pass's stale-`faff-parked` auto-remove (~277–283) must **not** strip it:
- The demotion-specific reason (repeat-park pattern: root-cause class + count) is **subjective / human-judgement**, so it falls under auto-clear **case 3** ("do not remove when the park reason is subjective, vague, or missing") and is left in place.
- Because the reason is demotion-specific and does **not** verbatim restate any forbidden-pattern raw reason, auto-clear **case 2** (forbidden-pattern match / cited-blocker-shipped / cited-punt-closed) does not fire.
- **Anti-pattern:** writing the park comment by copying a raw per-park reason (e.g. "context length exceeded") into the demotion comment — that reason matches a now-forbidden autonomous-park pattern, so the very next tidy pass auto-strips the `faff-parked` this demotion applied — re-poolable again, defeating the fix.

**Unpark (standard protocol, no new mechanism).** The issue re-enters via the shared **Unpark protocol**: a human breaks the repeat cycle and re-invokes the relevant skill (which clears `faff-parked`), or tidy's standard auto-clear removes it if and only if the reason later genuinely no longer applies. No FAFF-780-specific unpark path is introduced.

**Failure modes.**
- **The failure:** the park comment reason is non-specific and collides with a forbidden-pattern. **How you'd know:** a demoted issue loses its `faff-parked` on the next tidy pass and reappears in the pool. **Meaning:** narrow the reason to the demotion-specific pattern; do not weaken the auto-clear rules.
- **The failure:** only the breadcrumb is applied (the regression this fixes). **How you'd know:** a demoted issue still routes out of `faff next` as buildable. **Meaning:** the `faff-parked` write is missing at site 1 or 2.

## 5. Scenarios

- **Given** an active Todo issue in the `backlog-diagnostics` repeat-park set (3+ parks, same root-cause class, within 21 days), **when** autonomous tidy runs its repeat-park demotion, **then** the issue is Backlog and carries BOTH `faff-parked` AND `faff-repeat-parked`, and a park comment states the repeat-park reason (root-cause class + count).
- **Given** an issue just demoted (carrying `faff-parked`), **when** `faff next` is evaluated (`--parked` set from `faff-parked`), **then** it returns `needs-human` ("parked — human decision") and the issue is absent from the buildable/eligible pool — not re-drained.
- **Given** an issue repeat-park-demoted with a demotion-specific park comment (root-cause class + count, not a forbidden-pattern raw reason), **when** the next tidy pass runs its stale-`faff-parked` auto-remove sweep, **then** `faff-parked` is NOT stripped (subjective/judgement reason → case 3), and the issue stays out of the pool until a human breaks the cycle.
- The interactive repeat-park mechanical fix (site 2) disposes identically to the autonomous path: both labels applied + park comment posted.
- No edit is made to `eligible.js`, `next.js`, `faff eligible`, the beep-boop eligibility criteria, or any query — the diff touches only `plugin/skills/faff-tidy/SKILL.md`.

## 6. Design Decision Rationale

**Apply `faff-parked` in addition to, or replace, the breadcrumb?**
- **Chosen:** apply `faff-parked` **in addition to** `faff-repeat-parked`. A repeat-park is genuinely a park; the gateway already treats the pattern as the strongest human signal (no resolve-attempt). The breadcrumb stays the "why demoted" marker; replacing it would lose the `/faff-wtf` + calibration signal.

**What reason should the park comment carry?**
- **Chosen:** a demotion-specific reason stating root-cause class + count over the rolling window, never a verbatim forbidden-pattern raw reason (which auto-clear case 2 could strip on the next pass).

**How is the park comment posted — bespoke, or shared Park protocol?**
- **Chosen:** point back to the shared Park protocol; only steps 3–4 apply here (branch-less Backlog demotion). Restating inline would duplicate and drift, violating the skill-authoring dedup standard.

**Does anything in `faff eligible` / `next.js` / any query change?**
- **Chosen:** no code/query change. The pool exclusion is already wired (`faff-parked ⇒ faff next --parked ⇒ needs-human`); the only edits are prose in `faff-tidy/SKILL.md`.

**Interactive table row (site 2) — mirror, or leave breadcrumb-only?**
- **Chosen:** update site 2 for parity — otherwise an interactively-demoted issue stays poolable (the same bug, in the interactive path).

**Report line (253) / return counter (320) — reword/rename, or leave?**
- **Chosen:** leave the counter name and semantics unchanged; the report line stays coherent (wording-only tweak allowed if truly needed, never a semantic change). Renaming risks breaking `/faff-wtf` / `/faff-beep-boop` consumers of `repeat_parks_demoted`.

## 7. Open Questions and Assumptions

**Open Questions.** None — the ticket is fully decided; no human call is pending.

**Assumptions.**
- **Assumes:** the existing stale-`faff-parked` auto-remove rules in the same file (~lines 277–283) leave a subjective/judgement-bound park reason in place — auto-clear **case 3** ("do not remove when the park reason is subjective, vague, or missing"), and case 2 fires only on forbidden-pattern / cited-blocker-shipped / cited-punt-closed. *Validation:* before editing, read `plugin/skills/faff-tidy/SKILL.md` lines ~277–283 and confirm case 3 still leaves subjective reasons untouched and case 2 is the only removal trigger; if the auto-clear rules have changed such that a pattern/count reason could match case 2, tighten the reason wording so the demotion `faff-parked` survives the next pass.

## 8. DONE — Definition of Done

**From WHY**
- [ ] The edited site 1 prose states that applying `faff-parked` is what removes the issue from the pool via `faff next --parked ⇒ needs-human`, and that `faff-repeat-parked` is the inert breadcrumb — no mention of a runner GraphQL query or of `faff eligible` as the exclusion mechanism.

**From WHAT / HOW (behaviour — site 1, ~297)**
- [ ] The autonomous "Demote `repeat-parked` Todos to Backlog" bullet applies **both** `faff-repeat-parked` and `faff-parked`, each via `faff label add <issue> <label>` + descriptor write (gateway → Control-label provisioning).
- [ ] The bullet posts a park comment via the shared Park protocol, with a **demotion-specific** reason = repeat-park pattern (root-cause class + count over the rolling 21-day window), and notes Park-protocol steps 1–2 (WIP/PR) are N/A for a branch-less Backlog demotion.
- [ ] The bullet still states the qualifying set comes from `backlog-diagnostics` / `faff park-history` and tidy does not re-count.

**From HOW (parity — site 2, ~141)**
- [ ] The interactive mechanical-fix table row applies both `faff-repeat-parked` and `faff-parked` and posts the park comment — identical disposition to the autonomous path.

**From HOW (auto-clear guard)**
- [ ] The park-comment reason specified is subjective/demotion-specific and does not verbatim restate any forbidden autonomous-park pattern, so the next tidy pass's stale-`faff-parked` sweep (case 3) leaves it in place (verified against ~277–283).

**From HOW (downstream coherence — sites 3 & 4)**
- [ ] The report line (~253) "L repeat-parks demoted" remains coherent (no semantic change).
- [ ] The return counter `repeat_parks_demoted: N` (~320) is unchanged in name and semantics.

**Scope**
- [ ] The diff touches **only** `plugin/skills/faff-tidy/SKILL.md` — no change to `eligible.js`, `next.js`, `faff eligible`, the beep-boop eligibility criteria, or any query.

**Integration smoke test.**
1. Read `plugin/skills/faff-tidy/SKILL.md` at sites 1 (~297) and 2 (~141).
2. Assert both sites name `faff-parked` AND `faff-repeat-parked`, each with `faff label add …` + descriptor-write phrasing, and a park-comment step citing the Park protocol with a root-cause-class + count reason.
3. Assert sites 3 (~253) and 4 (~320) are semantically unchanged.
4. `git diff --name-only` ⇒ exactly `plugin/skills/faff-tidy/SKILL.md`.

## Already shipped against this surface

Related-but-not-superseding Done work (premise still holds — none delivers this change):
- **FAFF-162** — wired the `faff park-history` seam into tidy §5 (the repeat-park set source).
- **FAFF-188** — routed tagging sites through `faff label` (the write mechanism this fix reuses).
- **FAFF-336** — reconciled the control-label manifest with lens/tidy tagging prose (incl. `faff-repeat-parked`).
- **FAFF-61** — inverted eligibility to opt-in `faff-automate` (the exclusion model).
- **FAFF-779** (open, related) — sibling `needs-decision-first` parking fix; ships independently. FAFF-780 is latent until FAFF-779 makes `needs-decision-first` actually park.

confidence: high
