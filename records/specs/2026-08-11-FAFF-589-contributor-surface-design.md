# FAFF-589 — Contributor surface: CONTRIBUTING.md, SECURITY.md, DCO, licence covenant, trademark note, and deliberate community-surface decisions

> Spec: faffter-dark-nlspec · 2026-08-11 · interactive · confidence: high. Full spec on linear FAFF-589.

*Revised 2026-08-11: (a) spec-review round 1 (infosec) — commit-count reconciliation added to the DCO check, explicit least-privilege `permissions:` block required; spec-review round 2 approve. (b) Open punt resolved by the maintainer — Issues and Discussions stay off; confidence re-rated medium → high.*

This spec turns FAFF-589 into buildable work. The audience is the build agent that will author the files and the workflow, and the human reviewer who must perform the repo-settings steps the build agent is forbidden to touch. Provenance: external adversarial critique of 2026-07-21 (the critique document itself lives only on the unmerged branch `origin/claude/repo-code-review-critique-dcg22x`, commit `7e7c410` — it is not on `main`; nothing in this spec requires reading it). Scope decisions dated 2026-08-11 in the ticket are recorded here as closed, not reopened.

## 1. WHY — problem and principles

**Contributability is a front-door property.** A stranger arriving at the public repo must be able to answer four questions without access to the private tracker: how do I build and test this, how do I submit a change, how do I report a problem (including a security problem), and what legal terms govern my contribution and my adoption. Every item in this ticket is one of those four answers; the change is complete when all four are answerable from the repo root.

The repository is public, makes safety and enforcement claims in its documentation, and squash-merges conventionally-titled PRs through a governed CI pipeline — yet it has no CONTRIBUTING.md, no SECURITY.md, no security contact anywhere, Issues and Discussions switched off, and a wiki switched on that nobody owns. An outside reader can see the code but has no supported path to contribute to it, report against it, or trust its licence trajectory. This change adds the standard contributor surface, wires per-commit provenance (DCO sign-off) into CI, and closes the community-surface settings deliberately rather than by default.

**Corrections to the ticket record** (verified against `main`, 2026-08-11 — record these, do not re-plan them):

- `triage-results.json` is already gone from the root; the FAFF-319 work deleted it (`records/specs/2026-07-23-faff-319-*-design.md` records the deletion). That ticket bullet is done.
- No FABLE-WEEK marker or "revert after the Fable week" comment exists in `.faffrc.yaml`. The nearest residue is the `budget.tokens: 3000000000` comment, whose "subscription covers the week" clause is stale. Handled below as a comment reword, nothing more.
- The ticket points at `docs/adr` for decisions; the real path is `records/adr/` (100 files, validated by `faff adr validate` in CI). CONTRIBUTING must cite the real path.

**Design principles** — constraints that would reject an otherwise-valid implementation:

- **Public prose follows the naming rules.** All new public-facing text (CONTRIBUTING, SECURITY, README additions) uses SuperDomestique for the product, Commissaire for the governance system, and `faff` literally for technical identifiers, per `docs/concept/positioning-and-language.md`. The formerly-known-as transition sentence already lives at the top of README and appears nowhere else — the new files must not repeat it.
- **Repo-settings mutations stay human.** Enabling Issues, disabling the wiki, enabling private vulnerability reporting, and adding a required check to the ruleset are console/`gh api` actions performed by the maintainer, never by the build loop — the same posture `docs/guide/governance-check.md` documents for required-check activation. The build agent ships files and instructions; the human flips switches.
- **The root stays dependency-free.** No `package.json` at root, no new runtime dependency for the DCO check. Hand-rolled beats installed where a ~30-line script suffices.
- **Say it once.** `AGENTS.md` is the in-repo contributor guidance agents auto-load. CONTRIBUTING links to it and to `docs/reference/skill-authoring.md`; it copies neither.

**Reference context:**

| Surface | Relevance |
|---|---|
| `README.md` | Front door; carries the transition sentence (line 9) and the one-line `## Licence` section this change extends |
| `AGENTS.md` | Auto-loaded contributor guidance; gains the commit sign-off rule |
| `.github/workflows/semantic-pr.yml` | Precedent for a small standalone PR-gate workflow; enforces Conventional Commit PR titles |
| `.github/workflows/validate.yml` | Node 20; selftests + `faff validate-adapters` / `lint-refs` / `lint-cli-doc` + `node --test` — the commands CONTRIBUTING must state |
| `.github/workflows/release-please.yml` | Bot-authored PRs the DCO check must not break |
| `docs/guide/governance-check.md` | The documented manual ruleset-PATCH recipe for activating a required check (rulesets API, not the legacy branch-protection endpoint) |
| `docs/concept/positioning-and-language.md` | Naming rules binding on all new public prose |
| `records/adr/0096-adopt-superdomestique-and-commissaire-through-staged-naming.md` | Accepted 2026-08-08; source for the trademark first-use dates |
| `LICENSE`, `NOTICE` | Apache-2.0 full text; NOTICE is currently pure attribution (264 bytes) and stays that way |
| `scripts/link-skills.sh` | The dev-install path CONTRIBUTING documents (currently documented only in the script header) |
| `.faffrc.yaml` | Carries the stale "covers the week" budget comment |

**Scope statement:** this is the contributor-and-legal front door for the public repo — sibling to the docs site (FAFF-508, done) and front page (FAFF-739, done), feeding the documentation programme (FAFF-736).

## 2. OUT OF SCOPE

- **Trademark registration** — the ticket excludes it explicitly; the note records first use only. Extension point: a future ticket (none exists yet — flagged as an un-ticketed follow-on if the maintainer wants it).
- **Issue templates, PR templates, CODEOWNERS** — useful once Issues are on and traffic exists; premature now. Extension point: `.github/`, under the documentation programme FAFF-736.
- **Surfacing CONTRIBUTING/SECURITY on the Docusaurus site** — GitHub renders root files natively; site placement is a FAFF-736 concern. Extension point: `website/`.
- **Claims→evidence register wiring** — SECURITY.md names in-scope attack surfaces but does not restate or extend the public trust claims; that is FAFF-740. Extension point: `verification/audits/2026-08-07-FAFF-732-public-trust-claims.md`.
- **Retroactive sign-off of existing history** — impossible without rewriting `main`; the DCO covers commits from the day the check lands, and CONTRIBUTING says so.
- **Automating repo-settings changes** — deliberately excluded per the design principle above. Extension point: none intended; `docs/guide/governance-check.md` documents the manual recipes.
- **Bug bounty, response SLAs** — SECURITY.md promises best-effort acknowledgement only; a solo-maintainer project should not commit to what it cannot staff.
- **Root cleanup of `triage-results.json`** — already done (see corrections); listed so nobody re-plans it.

## 3. WHAT — vocabulary, deliverables, and decisions

**Vocabulary:**

| Term | Definition |
|---|---|
| DCO | Developer Certificate of Origin v1.1 (developercertificate.org) — a per-commit attestation that the author has the right to submit the change under the project licence |
| Sign-off trailer | The `Signed-off-by: Name <email>` commit-message trailer `git commit -s` appends; the mechanical form of the DCO attestation |
| Licence covenant | A short public statement that the project is and will remain Apache-2.0, with no relicense to source-available terms |
| First-use note | A dated public record of when the names SuperDomestique and Commissaire first appeared, preserving common-law priority evidence; not a registration |
| Private vulnerability reporting | GitHub's built-in confidential report channel (Security tab → "Report a vulnerability"), enabled per-repo in settings |
| Required check | A status check a GitHub ruleset makes merge-blocking; this repo's ruleset "Main" currently requires `validate`, `governance-check`, `env-rootless` |

**Deliverables inventory:** new `CONTRIBUTING.md` (root), new `SECURITY.md` (root), new `.github/workflows/dco.yml`, README edits (extend `## Licence`, add a trademarks section), an `AGENTS.md` sign-off rule, a one-line comment reword in `.faffrc.yaml`, and a written handoff list of the human console steps (delivered in the PR body).

### CONTRIBUTING.md content contract

Target ~30 lines, ceiling 50. Must contain, in reading order:

- One-line orientation: contributions to SuperDomestique happen in this repo, which keeps the technical name `faff` for its CLI, paths, and plugin — pointing at README for the product framing, without repeating the transition sentence.
- Dev setup: clone; Node 20+ (what CI uses); the root is intentionally dependency-free — there is nothing to install (`website/` has its own `package.json` for the docs site only); `scripts/link-skills.sh` links skills and the `faff` CLI into place (`--global` for machine-wide, `--status` / `--unlink` exist).
- Tests and lints, mirroring `validate.yml`: `node --test test/`; `node plugin/skills/faff/bin/faff validate-adapters`, `... lint-refs`, `... lint-cli-doc`.
- PR expectations: Conventional Commit PR title (the repo squash-merges with the title as the `main` commit subject, and release-please parses it — a non-conforming title never releases); every commit signed off (`git commit -s`) per the DCO, linked to developercertificate.org, required for commits made after the check landed; CI must pass; never hand-bump versions — release-please owns them.
- Where decisions live: `records/adr/` and `records/specs/`. `FAFF-XX` references in history point to a private tracker an outside reader cannot open; the public reasoning is in those records. Tracker references are banned in skill prose and `docs/guide/` (`faff lint-refs` enforces this).
- Authoring standards: `AGENTS.md` (auto-loaded) and, for skill edits, `docs/reference/skill-authoring.md`.
- Where reports go: the project has no public issue tracker (Issues stay off); the contribution and report path is a pull request, and security issues go through SECURITY.md's private vulnerability reporting — do not point readers at a "file an issue" flow that does not exist.
- Licence terms: inbound = outbound Apache-2.0, DCO attested per commit; link to the covenant in README's Licence section.

### SECURITY.md content contract

- Supported version: the latest release only (release-please, single component).
- How to report: GitHub private vulnerability reporting; never a public issue for a vulnerability.
- What is in scope, in plain language: anything that lets an autonomous run produce an effect the governance layer (Commissaire) should have blocked — merge-gate bypass, prompt-injection paths to merge, weaknesses in the tamper-evidence chains (`events.jsonl`, `declared-effects.jsonl`) — plus ordinary code-execution or credential-exposure defects in the CLI and skills. No new trust claims; no restating of the claims register.
- What to expect: best-effort acknowledgement from a solo maintainer (target within 7 days), coordinated disclosure requested. No bounty.

### README edits content contract

- `## Licence` (line ~100, British spelling — keep it) grows from one line to the covenant: SuperDomestique is Apache-2.0 and will remain Apache-2.0; no relicense to source-available or more restrictive terms; contributions accepted inbound = outbound.
- A new short trademarks section adjacent to Licence: the names SuperDomestique and Commissaire identify this project; first public use dates (pinned per the procedure in HOW below); the naming decision is recorded in `records/adr/0096-adopt-superdomestique-and-commissaire-through-staged-naming.md`; no registration is claimed.

### AGENTS.md addition content contract

A short rule: every commit in this repo carries `Signed-off-by` with the operator's git identity (`git commit -s`); agent commit paths append the trailer exactly as they already append `Co-authored-by`. Lean, one small section.

### Design decisions

**Where does human contributor guidance live relative to AGENTS.md?**
**Chosen:** a root `CONTRIBUTING.md` for humans that links to `AGENTS.md` and `docs/reference/skill-authoring.md` rather than copying them — GitHub surfaces root CONTRIBUTING natively, and the say-it-once principle forbids a second copy of the authoring standards.

**Legal mechanism for inbound contributions — DCO or CLA?**
**Chosen:** DCO, per the ticket's dated decision (2026-08-11). Recorded here as closed: sign-off is provenance hygiene under inbound = outbound Apache-2.0, not a rights assignment. The spec does not reopen this.

**How is the DCO check implemented?**
**Chosen:** a hand-rolled standalone workflow `.github/workflows/dco.yml` on the plain `pull_request` trigger, API-only (lists the PR's commits via the GitHub API; no checkout, so no untrusted code executes), with an explicit least-privilege `permissions: pull-requests: read` block (the sibling workflows `validate.yml` and `semantic-pr.yml` both pin theirs — no workflow relies on default token permissions), failing with the offending SHAs and the `git commit --amend -s` / rebase remediation text. Mirrors the `semantic-pr.yml` shape; honours the dependency-free-root principle; ~30 lines.

**Which commits does the check exempt?**
**Chosen:** merge commits (more than one parent — GitHub's "Update branch" authors these and a contributor cannot sign them) and commits whose GitHub author is a bot account (`github-actions[bot]` and any `[bot]`-suffixed login) — release-please's PRs must pass without sign-off. Everything else, including reverts, needs the trailer. Exemption is per-commit inside the single `dco` job: the job itself always completes and reports success or failure — a job-level skip would never satisfy a required check, so an exempt PR must pass, not skip.

**Whose identity signs machine-authored commits?**
**Chosen:** the human operator's git identity. The DCO is a person's attestation; the operator directs the run and owns the contribution. Enforcement is the AGENTS.md rule (the same prose mechanism that reliably produces `Co-authored-by` today) with the CI check as the backstop. The `faff-runner <faff-runner@local>` pseudo-identity must never appear in a sign-off.

**Where does the sign-off record live, given squash-merge?**
**Chosen:** on the PR's commits, enforced at PR level. The squash commit that lands on `main` carries the PR title and may not carry the trailer; that is acceptable because GitHub retains the PR and its signed commits as the durable provenance record. No change to the squash-message settings.

**Is the DCO text vendored or linked?**
**Chosen:** linked (developercertificate.org) with a one-line summary in CONTRIBUTING. The text is canonical, stable, and short; vendoring adds a root file for no verification benefit.

**Where does the licence covenant live?**
**Chosen:** README's existing `## Licence` section, with CONTRIBUTING linking to it. NOTICE stays pure attribution — Apache NOTICE semantics are attribution notices that propagate into redistributions, the wrong vehicle for a promise; README is the highest-traffic surface for the audience the covenant serves (prospective adopters weighing relicense risk).

**Where does the trademark first-use note live?**
**Chosen:** a short README section adjacent to Licence. Four sentences do not justify a new root file, and the front door is where a legal-notice reader looks first. If it later grows (registration, usage policy), promote it to a `TRADEMARKS.md` — that is the extension point.

**What is the security reporting channel?**
**Chosen:** GitHub private vulnerability reporting, enabled by the maintainer (human step). It needs no published email, keeps reports confidential by default, and is the channel GitHub's own Security tab advertises. SECURITY.md points at it.

**Issues and Discussions — on or off?**
**Chosen:** keep both off (maintainer decision, 2026-08-11). Enabling Issues is a standing triage commitment the solo maintainer is not taking on yet; an empty Discussions forum reads worse than none. Consequences the build must honour: CONTRIBUTING states plainly that the project has no public issue tracker and the contribution path is a pull request; SECURITY.md's private vulnerability reporting is the **only** inbound report channel, and neither file invents a "file an issue" destination that does not exist. Both surfaces are already off, so this decision needs no console step — it removes the "apply the Issues/Discussions decision" item from the human-step handoff, leaving three steps. Reversible later without touching this change (a maintainer can switch Issues on in settings whenever the triage capacity exists).

**The wiki — currently on, unowned?**
**Chosen:** disable it, after confirming it has no content (if pages exist, migrate them to the docs site first — treat that as a build-time check, expected empty). An unowned editable surface contradicts the repo's everything-is-reviewed posture, and the Docusaurus site is the documentation home. Human step, same settings pass as the Issues decision.

**The `budget.tokens` comment residue in `.faffrc.yaml`?**
**Chosen:** keep the `3000000000` value, reword the comment to drop the stale "subscription covers the week" clause and state it plainly as a permanent runaway backstop that never binds normal runs. No behaviour change; a different ceiling is the maintainer's separate call. Declared rider: this touches operator config no contributor reads — it rides only because the change is one line and the ticket named it; nothing else in this spec depends on it.

## 4. HOW — behaviour

### The DCO check

One sentence: the check lists every commit on the PR and fails if any non-exempt commit lacks a well-formed sign-off trailer, naming each offender and how to fix it.

```
PROCEDURE dco_check(pull_request):
  1. commits = paginated list of the PR's commits via the GitHub API
     (plain pull_request trigger, default read token, no checkout)
  2. failures = []
  3. FOR each commit:
     a. IF commit has > 1 parent (merge commit): skip
     b. IF the commit's GitHub author account is a bot
        (login ends "[bot]"): skip
     c. IF no message line matches the trailer form
        "Signed-off-by: <name> <email>" with non-empty name and email:
        append commit SHA to failures
  4. IF the count of commits examined != the PR's own commit count
     (the PR-commits API truncates at 250 regardless of pagination):
     exit failure, reporting the shortfall — never pass on an
     unexamined tail
  5. IF failures is empty: exit success
  6. ELSE: print each failing SHA + first message line, print remediation
     (amend with `git commit --amend -s` / `git rebase --signoff`, then
     force-push the branch), exit failure
```

The job name is `dco` — stable, because the ruleset requires checks by name. Trailer matching is the conventional case-sensitive `Signed-off-by:` form. A PR with zero non-exempt commits passes vacuously — the job reports success, never a skip.

**Anti-pattern:** running the check on `pull_request_target` or adding a checkout step. Why: the check needs only API metadata; granting the target-context token or executing fork code would widen the attack surface for no benefit.

**Anti-pattern:** activating the required check from inside the PR or via the legacy `branches/<branch>/protection` endpoint. Why: repo-settings mutations are human console steps here, and the legacy endpoint on a ruleset-protected repo silently mutates an unused surface (documented in `docs/guide/governance-check.md`) — the check would look live and bind nothing.

### Pinning the trademark first-use dates

The note's dates come from repository evidence, not memory: the first commit on `main` introducing "SuperDomestique" into README (via `git log -S`), the acceptance date of the naming ADR (2026-08-08, `records/adr/0096-...`), and the first docs-site deployment carrying the SuperDomestique title (deploy-docs workflow history). The builder pins all three and writes the earliest public appearance into the note.

### Human-step handoff

The PR body ends with a checklist of the three console steps the maintainer performs after merge, in order: enable private vulnerability reporting; disable the wiki (after the empty-check); PATCH ruleset "Main" to add `dco` to the required checks — **only after the `dco` workflow has reported green on at least one real PR under that exact job name** (a premature PATCH blocks every merge, including the fix for the mistake). The recipe is the `gh api` rulesets procedure in `docs/guide/governance-check.md`; read the ruleset back afterwards to confirm `dco` is listed. (Issues and Discussions stay off per the decision above — no console action.) These three steps are tracked in FAFF-776 (human-owned, blocked by this one); the build agent performs none of them.

### Edge cases

- A contributor without the sign-off habit gets a red check whose output is self-service — the remediation text is the fix, no maintainer round-trip.
- Commits pushed to a PR after the check lands are covered by the `synchronize` event; history from before the check landed is out of scope by construction (the check only ever sees PR commits).
- More than 250 commits on a PR: the PR-commits API truncates at 250 regardless of pagination, so pagination alone cannot close this edge — the check reconciles the examined count against the PR's own commit count and fails closed on any shortfall.

### Failure modes

- **"Update branch" merge commits fail the check.** If the merge-commit exemption is wrong or missing, every contributor who clicks "Update branch" goes red on a commit they did not author. Signal: a red `dco` run whose named SHA is a merge commit. Meaning: fix the exemption; do not tell contributors to stop updating branches.
- **The check exists but was never made required.** The workflow runs green on PRs while the ruleset ignores it — silently advisory. Signal: the post-merge ruleset read-back does not list `dco`. Meaning: the human step was skipped or hit the legacy-endpoint trap; re-run the documented recipe.
- **SECURITY.md points at a button that is not there.** If private vulnerability reporting is not actually enabled, the documented channel dead-ends. Signal: the Security tab viewed logged-out shows no "Report a vulnerability" action. Meaning: the human step was skipped; SECURITY.md must not merge ahead of a commitment to flip it.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a PR containing one commit without a Signed-off-by trailer
When the dco check runs
Then the check fails, its output names that commit's SHA, and the remediation text tells the author how to amend and re-push
```

```
Given a PR whose every non-merge commit carries a well-formed Signed-off-by trailer
When the dco check runs
Then the check passes
```

```
Given a PR branch that was updated via GitHub's "Update branch", adding an unsigned merge commit
When the dco check runs
Then the merge commit is skipped and the check's verdict rests only on the non-merge commits
```

```
Given a fresh clone on a machine with Node 20 or newer and no install step performed
When the contributor runs the test command CONTRIBUTING states
Then the full suite runs and passes
```

Non-functional assertions:

- CONTRIBUTING.md is at most 50 lines.
- The repo root gains no `package.json` and the DCO check adds no runtime dependency.
- All new public prose follows the naming rules in `docs/concept/positioning-and-language.md`, and the formerly-known-as transition sentence appears in README only — zero new occurrences.
- NOTICE is byte-identical before and after this change.
- `faff lint-refs`, `faff lint-cli-doc`, and `faff validate-adapters` still pass (the new root files are outside their scope; the AGENTS.md edit must not break anything that reads it).

## 6. Design decision rationale

- **DCO vs CLA** — decided in the ticket (2026-08-11), recorded not reopened. A CLA is a rights assignment needing signature infrastructure; the DCO is a per-commit attestation matching the provenance-hygiene framing. Time-anchored: sign-off coverage begins the day the check lands.
- **Check vehicle: hand-rolled workflow vs marketplace action vs the probot DCO App.** The App needs an installation grant; a marketplace action adds a third-party trust surface to an enforcement gate. The repo already hand-rolls its governance composite, and the check is ~30 lines of API calls. Hand-rolled standalone workflow, shaped like `semantic-pr.yml`.
- **Covenant placement: README vs NOTICE vs CONTRIBUTING.** NOTICE is a redistribution-propagating attribution file — a promise there is both mis-filed and sticky in downstream bundles. CONTRIBUTING reaches contributors; the covenant's audience is adopters. README Licence section wins; CONTRIBUTING links.
- **Trademark note: README section vs TRADEMARKS.md vs NOTICE.** Content is four sentences; a root file is disproportionate today and NOTICE stays pure. README section, with TRADEMARKS.md as the growth path.
- **Security channel: private vulnerability reporting vs published email.** No security email exists and publishing a personal one creates an unowned inbox; the GitHub channel is confidential, discoverable from the Security tab, and free. At the time of writing the repo has not enabled it — hence the human step and the assumption below.
- **Issues/Discussions: both off** (maintainer decision, 2026-08-11) — the one call that was genuinely the maintainer's, since enabling Issues is a standing triage commitment the codebase cannot answer. Both already off, so it is a no-op at the settings layer and a content constraint in the docs (no "file an issue" path; PR + private vulnerability reporting are the channels). Reversible later.
- **Wiki: off.** Zero known content, unowned, duplicates the docs site's job, and contradicts the everything-reviewed posture. Closed rather than punted because every fact bearing on it is in evidence; the empty-check before disabling covers the one unknown.
- **Budget comment: reword only.** The stale clause is the week reference, not the number. Changing the ceiling would be a behaviour change smuggled into a docs ticket.

## 7. Open questions and assumptions

**Open questions:** none. The one open punt (Issues/Discussions posture) was resolved by the maintainer on 2026-08-11 — both stay off; see the Chosen decision in section 3.

**Assumptions:**

- **Assumes:** the repo-settings snapshot (public; Issues off; Discussions off; wiki on) is still current. Validate before building: read the repo via `gh api repos/shftwst/faff` and diff against this spec's premise.
- **Assumes:** GitHub private vulnerability reporting can be enabled on this repo (standard for public repos). Validate: check the Security settings surface (or `gh api` the private-vulnerability-reporting endpoint) before SECURITY.md merges.
- **Assumes:** ruleset "Main" (id 18852686) is still the active ruleset requiring `validate`, `governance-check`, `env-rootless`. Validate: read the ruleset back via `gh api` before writing the activation instructions into the PR body.

## 8. DONE — definition of done

### From WHY
- [ ] A stranger can answer all four front-door questions (build/test, submit, report, legal terms) from files reachable at the repo root, with no tracker access.
- [ ] The three ticket corrections are reflected: no work re-planned for `triage-results.json`, no hunt for a FABLE-WEEK marker, CONTRIBUTING cites `records/adr/`.

### From WHAT (content contracts)
- [ ] CONTRIBUTING.md exists at root, ≤50 lines, and contains every item in its content contract (setup incl. `scripts/link-skills.sh`, exact test/lint commands matching `validate.yml`, PR title + sign-off + no-hand-bump expectations, `records/adr/` + `records/specs/` + FAFF-XX explanation, links to AGENTS.md and skill-authoring, licence terms).
- [ ] SECURITY.md exists at root and contains every item in its contract (latest-release support, private reporting channel as the only inbound channel, plain-language scope, best-effort expectations, no bounty).
- [ ] Neither CONTRIBUTING nor SECURITY points readers at a public issue tracker; CONTRIBUTING states the report/contribution path is a PR (Issues stay off).
- [ ] README's Licence section carries the covenant; a trademarks section exists with dates pinned from git/ADR/deploy evidence; NOTICE is unchanged.
- [ ] AGENTS.md contains the sign-off rule (operator identity, `git commit -s`, agents append the trailer).
- [ ] The `.faffrc.yaml` budget comment no longer references "the week"; the `3000000000` value is unchanged.

### From HOW (check behaviour)
- [ ] `.github/workflows/dco.yml` exists, job named `dco`, plain `pull_request` trigger, explicit `permissions: pull-requests: read`, no checkout step, and implements the procedure including the commit-count reconciliation (fail closed on an unexamined tail).
- [ ] An unsigned non-exempt commit fails the check with its SHA and remediation text; all-signed passes; merge commits and bot-authored commits are skipped per-commit while the job still reports success (the three visible scenarios plus the holdout).
- [ ] All new public prose passes the naming assertions (product names correct, no new transition sentence) and the existing lints still pass.

### From HOW (human steps — maintainer performs, PR body instructs)
- [ ] The PR body ends with the three-step console checklist (enable private vulnerability reporting; disable the wiki after the empty-check; PATCH ruleset "Main" to require `dco` only after a real-PR green run, then read it back), and points at FAFF-776 which tracks them. Issues/Discussions stay off — no step.
- [ ] (human step) Ruleset read-back after activation lists `dco` among required checks.
- [ ] (human step) The Security tab, viewed logged out, shows the report action SECURITY.md points at.

### Integration smoke test

```
PROCEDURE smoke_contributor_journey:
  1. Fresh clone; Node >= 20; perform no install step
  2. Run the test command CONTRIBUTING states  ->  suite green
  3. Branch; edit a doc; commit with `git commit -s`;
     open a PR titled "docs: exercise contributor surface"
  4. Observe semantic-pr green, dco green, validate green
  5. Amend the commit to drop the sign-off; force-push
     ->  dco red, output names the SHA and shows the remediation
```

confidence: high
spec-review: approve

## Methodology critique

*Lens: faffter-dark-methodology-agile-delivery (issue-critique), 2026-08-11.*

**Right-sizing** — No issues. The shape (two new root files, one ~30-line workflow, two README sections, one AGENTS.md rule, one comment reword) fits a 1–3 day unit. The tempting split — docs versus DCO enforcement — fails the independence test: CONTRIBUTING states the sign-off rule the workflow enforces, so shipping either alone leaves a rule with no check or a red check with no documented remediation. One PR is the right unit.

**Workstream fit** — The ticket is outcome-framed and the bundle converges on one outcome: an outsider can actually contribute. One member doesn't belong: the `.faffrc.yaml` comment reword touches operator config no contributor reads. Resolution applied: the spec now declares it an opportunistic rider rather than including it silently.

**Surfaced dependencies** — No blocker links either direction, and that is correct for the named relations. But the done-state depends on four human console steps that live only in a PR body — a PR body is not tracker state, so the settings half of the outcome (vulnerability channel live, check actually required) is untracked after merge. Recommendation: file a small follow-up ticket holding the four console steps, blocked by this one — it also gives the Issues/Discussions punt a home where the product decision gets made. Alternatively keep FAFF-589 open past merge with the checklist as its remaining done-criteria. Surfaced for the human at the prep gate.

**Risk profile** — One novel integration (the hand-rolled API-only DCO workflow); the in-ticket scenario set plus the smoke test is proportionate de-risking, no spike needed. Two sequencing edges the spec now encodes explicitly: the required-check PATCH comes only after the workflow has reported green on a real PR under the exact job name `dco`; and exemptions are per-commit inside a job that always reports success or failure — a skipped job never satisfies a required check.