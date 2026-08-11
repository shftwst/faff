# FAFF-659 — Settle the `onBrokenLinks` posture and gate on link integrity

> Spec: faffter-dark-nlspec · 2026-07-27 · interactive · confidence: medium. Full spec on Linear FAFF-659.

This is the build spec for FAFF-659. It is written for the agent that will implement it and for the humans reviewing that work. It supersedes the ticket's own framing in one place, called out explicitly below, because the ticket's premise about which links remain broken is out of date.

## 1. WHY — Problem and principles

**The load-bearing idea:** a Docusaurus build already knows every broken internal link on the site. `onBrokenLinks` decides only whether it says so loudly enough to stop the build. And a build that stops is only a gate if something refuses the merge when it does — which, on this repo today, nothing does. So there are two halves here, and doing only the first one leaves the ticket's word "gate" unearned.

**Problem statement.** `website/docusaurus.config.js` sets `onBrokenLinks: 'warn'`, so the site shipped with a navbar and footer whose every link dead-ended and the build passed anyway. Flipping to `'throw'` makes the build refuse, but the `deploy-docs` build job is not among the repo's required status checks, so a failing docs build still would not stop a merge. This change flips the posture to `'throw'`, clears the one link standing in its way, and does the code-side work needed for the docs build to be marked required.

### Correcting the ticket's premise

The ticket says `'throw'` "means handling those two out-of-tree links first", naming `docs/guide/governance-check.md` and `docs/guide/releasing.md`. **That work is already done.** Both were rewritten to absolute `https://github.com/shftwst/faff/blob/main/...` URLs and neither is broken today.

What actually stands in the way is a single link the ticket never mentions: `docs/guide/governance-check.md:14` points at `../evidence/v0.2/conformance.md`. The target file genuinely exists at `docs/evidence/v0.2/conformance.md` and is committed on `main`, but only `docs/guide` and `docs/concept` are routed into the site, so the link resolves to `/faff/evidence/v0.2/conformance.md` — a route that does not exist. It is precisely the "anything unforeseen" case the current config comment anticipated.

Verified by running the build on this branch. The complete output is one warning:

```
- Broken link on source page path = /faff/guide/governance-check:
   -> linking to ../evidence/v0.2/conformance.md (resolved as: /faff/evidence/v0.2/conformance.md)
```

### Design principles

**A gate nothing enforces is a warning with extra steps.** Flipping the config to `'throw'` is necessary and not sufficient. If the implementation stops there, the repo has a docs build that fails loudly and a merge button that does not care. Any work that claims to close this ticket has to reach the ruleset.

**The link fix belongs in the Markdown, not in the config.** This repo has already answered "how do we handle a docs link that points outside the routed tree" before, in this same file, by writing an absolute GitHub URL into the source. A config-level exception mechanism would solve the same problem a second way, invisibly, in a file nobody editing the docs will read.

**A required status check must always report.** GitHub blocks a pull request whose required context never arrives, indefinitely and with no useful message. That constraint rules out `paths:` filters and conditional job execution on the job that becomes required, and it dictates the order in which the pieces land.

### Reference context

| Artifact | Current state | Relevance |
|---|---|---|
| `website/docusaurus.config.js` | `onBrokenLinks: 'warn'`, `onBrokenMarkdownLinks: 'warn'` | The posture being settled |
| `docs/guide/governance-check.md:14` | Relative link to `../evidence/v0.2/conformance.md` | The one remaining broken link |
| `.github/workflows/deploy-docs.yml` | Job id `build`; workflow-level `permissions` and `concurrency: {group: pages, cancel-in-progress: false}` | Produces the check context that must become required |
| Ruleset `18852686` ("Main", active) | Required contexts: `validate`, `governance-check`, `env-rootless`; `strict_required_status_checks_policy: true` | Where the gate is actually enforced |
| `faff branch-protection-check` | Reads the effective-rules API, prints `required_checks` | The existing tool that can verify the ruleset edit landed |
| PR #499 (FAFF-658, open, mergeable) | Repoints navbar/footer/landing links at real doc routes | Must land first; see sequencing |

Docusaurus is pinned at 3.10.2, whose own default for `onBrokenLinks` is `'throw'`. This repo explicitly opted down to `'warn'`; this change opts back up.

**Scope.** This sits at the docs-publishing edge of the repo — the Docusaurus site config, the workflow that builds it, and one added content lint in `validate.yml`. It touches no faff CLI code and no skill prompts.

## 2. Out of scope

**Publishing `docs/evidence` (or `adr`, `architecture`, `rfc`, `specs`) as site surfaces.** Whether the Agent Delivery Evidence spec belongs on the public site is a product question about what the site is for, not a link-integrity question. Adding a third `plugin-content-docs` instance is a larger change with sidebar and navbar consequences. Extension point: the `plugins` array in `website/docusaurus.config.js`, alongside the existing `guide` and `concept` instances. Tracked as an open question below.

**Broken anchors.** `onBrokenAnchors` exists in 3.10.2 and defaults to `'warn'`; this repo does not set it, and the build currently emits no anchor warnings. Tightening it is adjacent but is not what this ticket asked for, and settling it properly means auditing every in-page anchor. Extension point: the same top-level config block this change edits.

**General external link checking.** `onBrokenLinks` only checks internal routes. A dead `https://` URL passes the build untouched. A narrow guard for the specific URLs this repo writes is in scope (see the link-integrity decision); a general external link checker across all outbound links is not. Extension point: alongside the out-of-tree docs-link step in `validate.yml`.

**Marking `validate-macos` or any other currently-advisory check as required.** Only the docs build is in question here.

## 3. WHAT — Config surface and vocabulary

| Term | Meaning here |
|---|---|
| Posture | The severity value `onBrokenLinks` carries: `ignore` / `log` / `warn` / `throw` |
| Check context | The string GitHub matches a ruleset's required-status-check entry against. For these workflows it is the job id, since none of them set a job-level `name:` |
| Routed tree | A directory wired into the site by a `plugin-content-docs` instance. Today: `docs/guide` and `docs/concept`, and nothing else |
| Out-of-tree link | A link from a routed page to a repo file that is not in a routed tree — written as an absolute GitHub URL by convention |

The changed configuration shape:

```
RECORD DocusaurusLinkPosture:
  onBrokenLinks: Severity                       # 'warn' -> 'throw'
  onBrokenAnchors: Severity                     # unset; stays unset (out of scope)
  markdown.hooks.onBrokenMarkdownLinks: Severity  # NEW home, value 'throw'
  onBrokenMarkdownLinks: Severity               # top-level; DELETED (deprecated)

  CONSTRAINT top-level onBrokenMarkdownLinks absent AND markdown.hooks.onBrokenMarkdownLinks present
```

```
RECORD DeployDocsWorkflow:
  jobs.docs-build: Job          # renamed from `build`
  jobs.docs-build.permissions: {contents: read}   # NEW — job-scoped, drops inherited pages/id-token
  jobs.deploy.permissions: {pages: write, id-token: write, contents: read}  # NEW — job-scoped
  permissions: (workflow-level block removed)
  jobs.deploy.needs: [docs-build]  # follows the rename
  concurrency.group: String     # 'pages' -> per-ref
  concurrency.cancel-in-progress: false  # unchanged
  on: [workflow_dispatch, push(main), pull_request]  # unchanged, no paths filter
```

### Decision — the posture

**Chosen:** `onBrokenLinks: 'throw'`.

Verified end to end on this branch: with `'throw'` set and the evidence link repointed, the build exits 0 clean; with a deliberately broken footer link added, it exits 1 and names the link. The tree is one link away from being able to hold this posture, and the posture is Docusaurus's own default.

### Decision — the one remaining broken link

**Chosen:** repoint `docs/guide/governance-check.md:14` to `https://github.com/shftwst/faff/blob/main/docs/evidence/v0.2/conformance.md`.

This matches, character for character in form, what this file already does for its other out-of-tree reference. The target is committed on `main`, so the URL resolves today.

Two alternatives were tested and rejected; see the rationale section.

### Decision — keeping the repointed link honest

**Chosen:** add an inline "Validate out-of-tree docs links" step to `.github/workflows/validate.yml`, beside the existing self-contained-prose lint, that verifies every `https://github.com/shftwst/faff/blob/main/<path>` URL written in **`docs/guide` and `docs/concept`, outside fenced code blocks**, names a path that exists in the working tree.

This is the compensating check for the coverage hole the repoint creates. Moving a link out of the routed tree and into an absolute URL takes it out of Docusaurus's checker entirely — external URLs are never validated — so without this, `'throw'` provides no coverage at all on the one link that motivated the whole ticket. The check is a path-existence test against the repo, not a network fetch: it needs no token, cannot flake on GitHub availability, and catches the realistic failure (someone moves or renames the file) rather than the unrealistic one (github.com is down).

**The scope is load-bearing, not incidental.** A repo-wide `docs/**` scan fails on the tree as shipped: `docs/specs/2026-07-24-FAFF-508-publish-faff-docs-theory-docusaurus-site-github-pages-design.md:119` contains `https://github.com/shftwst/faff/blob/main/.github/workflows/<file>` — a placeholder inside a fenced block in an archived design spec, whose path does not exist and never will. Archived specs are a record of what was decided, not live documentation, and they are full of illustrative text. The routed trees are the only place the coverage argument applies, because they are the only docs the site publishes. So the scan covers `docs/guide` and `docs/concept` and skips fenced code blocks.

**Where it lives:** `validate.yml`, not the docs build. The check validates repo Markdown content, not anything about the Docusaurus build, and `validate.yml` already carries exactly this kind of inline content lint ("Validate self-contained prose (no external-artifact refs in docs/guide)"). It also rides a check that is *already* required on `main`, so this half of the link integrity story needs no ruleset change at all.

Scope it to this repo's own `blob/main` URLs. Third-party URLs are out of scope and would need a real fetch.

### Decision — the deprecated `onBrokenMarkdownLinks`

**Chosen:** migrate it in this change rather than defer it.

The top-level option prints a deprecation warning twice on every build today. A build whose whole purpose is now "warnings are not tolerated, this thing throws" should not itself emit a standing warning on every run — that is how people learn to scroll past the output. The migration is a three-line config edit, verified to silence the warning.

### Decision — job-scoped permissions

**Chosen:** move `permissions` from workflow scope to job scope — `docs-build` gets `contents: read`, `deploy` keeps `pages: write` and `id-token: write`.

`deploy-docs.yml` currently grants `pages: write` and `id-token: write` at workflow level, so the build job inherits Pages-deployment and OIDC credentials it has no use for. That job runs `npm ci` and a Docusaurus build over pull-request-supplied content, and this change promotes it to a required merge gate — which makes it a more attractive thing to compromise, not less. The file is already being edited here for the rename and the concurrency group, so scoping the permissions is a few lines in a file already in the diff.

This is a hardening step, not a fix for a live exploit: fork pull requests already receive a read-only token regardless of the `permissions` block, and this is effectively a single-owner repo. It is in scope because the cost is near zero and the change is already open in that file.

### Decision — the gate

**Chosen:** the docs build becomes a required status check on ruleset `18852686`, under the context name `docs-build`.

Four parts, and only two of them are code:

1. **Rename the job.** `deploy-docs.yml`'s job id is `build`, so it reports the check context `build`. That is too generic to sit in a ruleset next to `validate`, `governance-check`, and `env-rootless` — the ruleset matches on the bare string, so any future workflow adding a job called `build` would silently satisfy or conflict with this requirement. Rename the job to `docs-build` and update `deploy`'s `needs:` accordingly.

2. **Scope the concurrency group per ref.** The workflow currently serialises every run — pull requests and `main` deploys alike — into one global `pages` lane with `cancel-in-progress: false`. That is harmless while the check is advisory. As a merge-blocking check it means one slow `main` deploy holds up every open pull request's gate. Change the group to `pages-${{ github.ref }}`. All `main` pushes still share a single lane (so Pages deploys stay serialised, which is what the group was for), while each pull request gets its own.

3. **Add the required context.** This is a repository-settings change on ruleset `18852686`. **The build agent cannot do this and must not try** — it is not a file in the pull request, it gets no code review, and it needs repository admin. It is the repo owner's action (alec@shftwst.dev), taken either in the GitHub UI under the "Main" ruleset's required-status-checks rule, or via the rulesets API.

4. **Verify the ruleset edit with the tool that already exists.** The repo has been here before: FAFF-562 added `governance-check` to this same ruleset, and shipped a repo-admin runbook alongside `faff branch-protection-check`, which reads the effective-rules API and prints the live `required_checks` list. Reuse both. The pull request body carries the runbook steps, and the closing verification is `faff branch-protection-check --json` showing `docs-build` among `required_checks` — not someone's recollection that they clicked the box. Without this step the rename can land, the owner can forget, and nothing in the repo is able to tell you the gate does not exist.

**Ordering is not optional.** Part 3 must happen only after parts 1 and 2 are merged to `main`. Add `docs-build` to the ruleset first and every open pull request blocks forever waiting on a context that no workflow reports.

### Decision — pull requests as well as `main`

**Chosen:** the check runs on all pull requests, with no `paths:` filter.

The workflow already triggers on bare `pull_request` and the build job already runs on every one of them, so this needs no workflow change beyond the rename. Adding a `paths:` filter to narrow it to docs-touching pull requests is the obvious-looking optimisation and it is a trap: a required check that is skipped never reports, and the pull request blocks indefinitely. The full cost of not filtering is an `npm ci` plus a Docusaurus build on every pull request, which the repo already pays today.

**Anti-pattern:** adding `paths: ['docs/**', 'website/**']` to `deploy-docs.yml` once `docs-build` is required. Why: GitHub treats a skipped required check as never-reported, not as passed, and blocks the merge with no actionable message.

**Anti-pattern:** setting `onBrokenLinks: 'throw'` while leaving the link in `governance-check.md` as-is and adding a config-level exception instead. Why: it puts the knowledge that this one link is special in a file nobody editing the docs opens, and it diverges from how the same problem was solved already in this same file.

**Anti-pattern:** repointing the link to an absolute URL and stopping there. Why: it silences the build without preserving any coverage on the link — see the link-integrity decision above.

## 4. HOW — Behaviour

The change is small and almost entirely declarative. The care is in the order.

```
PROCEDURE settle_link_posture:
  1. Base the branch on PR #499's head, not on main.
  2. Edit docs/guide/governance-check.md line 14:
     a. Replace the relative target `../evidence/v0.2/conformance.md`
        with the absolute GitHub blob URL for the same file on main.
     b. Leave the link text unchanged.
  3. Edit website/docusaurus.config.js:
     a. Set onBrokenLinks to 'throw'.
     b. Delete the top-level onBrokenMarkdownLinks key.
     c. Under the existing `markdown` object (which already carries
        `format: 'md'`), add `hooks: { onBrokenMarkdownLinks: 'throw' }`.
     d. Rewrite the comment above onBrokenLinks. It currently describes
        the retired FAFF-508 posture and names two links that are no
        longer broken. State the posture forward: the build refuses on a
        broken internal route, and a doc link that points outside the two
        routed trees is written as an absolute GitHub URL and covered by
        the docs-links step.
  4. Edit .github/workflows/deploy-docs.yml:
     a. Rename job `build` to `docs-build`.
     b. Change jobs.deploy.needs from `build` to `docs-build`.
     c. Change concurrency.group from 'pages' to 'pages-${{ github.ref }}'.
     d. Remove the workflow-level `permissions` block; give docs-build
        `permissions: {contents: read}` and deploy
        `permissions: {pages: write, id-token: write, contents: read}`.
     e. Leave cancel-in-progress, triggers, and every step unchanged.
  4b. Edit .github/workflows/validate.yml: add the out-of-tree docs-link
      step beside the existing self-contained-prose lint.
  5. Run `npm --prefix website run build`. It must exit 0 with no
     broken-link output and no deprecation warning.
  6. Run the out-of-tree docs-link check locally. It must exit 0,
     reporting three resolved URLs.
```

```
PROCEDURE docs_links_check:
  # Keeps out-of-tree links honest. Path existence, not network fetch.
  # Runs as an inline step in validate.yml, beside the prose lint.
  1. Scan docs/guide and docs/concept ONLY — not docs/** — for URLs
     matching https://github.com/shftwst/faff/blob/main/<path>.
     Skip any line inside a fenced code block: archived and
     illustrative text carries placeholder paths.
  2. For each, strip the prefix to recover <path>, and any #anchor.
  3. Assert <path> exists in the working tree.
  4. Exit non-zero listing every URL whose path is missing.
  5. Exit 0 when every such URL resolves.

  # On the tree as shipped this finds exactly two URLs, both resolving:
  #   docs/guide/governance-check.md:35 -> .github/workflows/governance.yml
  #   docs/guide/releasing.md:3         -> .github/workflows/release-please.yml
  # plus the one this change adds:
  #   docs/guide/governance-check.md:14 -> docs/evidence/v0.2/conformance.md
```

```
PROCEDURE demonstrate_the_gate:
  # The ticket asks for this to be shown, not asserted.
  1. On the same pull request, push a commit that points the footer's
     Guide link at a route that does not exist.
  2. Confirm the docs-build check reports failure on the pull request,
     and that its log names the broken link.
  3. Revert that commit on the same pull request; confirm docs-build
     returns to success.
  4. Link both check runs in the pull request body.
```

### Sequencing against FAFF-658

FAFF-658's fix is unmerged, in PR #499, and this branch carries it. On `main` as it stands, the navbar and footer still point at `/guide` and `/concept`, which have no routes — confirmed by diffing this branch against `origin/main`. Setting `'throw'` on top of `main` would therefore fail the docs build immediately, for a reason FAFF-658 owns and has already fixed.

So: branch this work off PR #499's head, and merge it after #499. If #499 is rejected or substantially reworked, this spec's verification results no longer hold and the build must be re-run before proceeding.

### Failure modes

**The ruleset change never happens.** The code lands, the build throws, everyone believes there is a gate, and merges continue past a red docs build exactly as before. *How you'd know:* `faff branch-protection-check --json` does not list `docs-build` among `required_checks`. *What it means:* the ticket is not done. The code half is genuinely useful on its own — a red check is visible even when advisory — but the word "gate" should not be used until the tool says so.

**The ruleset change happens too early.** `docs-build` is added to the ruleset before the job rename reaches `main`. Every open pull request then waits on a context nothing reports. *How you'd know:* pull requests show `docs-build — Expected` and never resolve. *What it means:* back out the ruleset entry, land the rename, re-add.

**The evidence link goes stale in a way the check misses.** It tests path existence in the working tree, so a file deleted or renamed in the same commit is caught. It does not catch a path that exists locally but was never pushed, a URL pointing at a branch other than `main`, or a stale link inside `docs/specs` or a fenced block — all deliberately out of scope. *How you'd know:* a reader gets a GitHub 404. *What it means:* the residual gap is narrower than the one the step closes, and is named here rather than claimed away.

**Per-ref concurrency changes Pages deploy behaviour unexpectedly.** *How you'd know:* a `main` push deploys while another `main` deploy is in flight, or a deploy fails on a Pages concurrency error. *What it means:* all `main` pushes and `workflow_dispatch` runs on `main` share `pages-refs/heads/main`, so serialisation is preserved; if it is not, revert to the global `pages` group and accept the queueing cost on required pull-request checks.

**Job-scoped permissions break the deploy.** *How you'd know:* `deploy` fails on a Pages or OIDC permission error after the change. *What it means:* the `deploy` job's own block is missing something the workflow-level block was providing; restore the workflow-level block and scope only `docs-build` down.

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the docs tree with every internal link resolving to a real route
When `npm --prefix website run build` runs
Then it exits 0, prints no broken-link report, and prints no
     onBrokenMarkdownLinks deprecation warning
```

```
Given a link in the navbar or footer pointing at a route with no page
When the docs build runs
Then it exits non-zero and its output names both the broken target and
     at least one source page it appears on
```

```
Given the docs-build job rename merged to main and docs-build added to
      ruleset 18852686
When a pull request's docs build fails
Then the pull request reports docs-build as failing and the merge is
     blocked rather than merely annotated
```

- The `deploy-docs` workflow MUST continue to trigger on `pull_request` with no `paths:` filter, so the required context reports on every pull request.
- The `docs-build` job MUST NOT hold `pages: write` or `id-token: write`.

## 6. Design decision rationale

**How should the last out-of-tree link be handled?**

- *Repoint to an absolute GitHub URL.* Matches what this repo already did in this same file. One line. Visible to anyone editing the doc. Costs: the link leaves Docusaurus's checker entirely.
- *Route `docs/evidence` into the site as a third docs instance.* Makes the link work in-site and genuinely improves the site — but it is a much larger change (new plugin instance, sidebar, navbar placement) and it answers a product question nobody has asked yet.
- *Except it via `markdown.hooks.onBrokenMarkdownLinks` as a function.* Tested directly. The hook does fire for this link, but returning `undefined` does **not** except it — the link still reaches the broken-links checker and still fails the build. Excepting it means having the hook return a replacement URL, which is the same rewrite as option one, performed invisibly in config instead of visibly in the source. There is no flat ignore-list option in 3.10.2.

**Chosen:** repoint to the absolute GitHub URL, *plus* the docs-links step. The repoint alone follows precedent and is the smallest change that unblocks `'throw'`, but on its own it trades a checked link for an unchecked one — which would leave the ticket's own motivating link as the single least-covered link on the site. The step restores coverage without answering the product question. The hook-as-function route was rejected on evidence, not taste: it is strictly worse than the source edit and does nothing the source edit does not.

**Should the deprecated `onBrokenMarkdownLinks` migration ride along or be deferred?**

- *Defer.* Keeps this change to one concern.
- *Ride along.* Three lines, and it removes a warning that fires twice per build.

**Chosen:** ride along. Docusaurus 3.10.2 warns on every build and states the option will be removed in v4. Shipping a change whose point is "stop tolerating warnings" while leaving a permanent warning in the same file is the wrong shape.

**Should the docs build become a required status check?**

- *No, leave it advisory.* Zero settings risk; every pull request stays fast to merge. But the ticket's title says "gate", and a red advisory check is exactly what let the broken navigation ship.
- *Yes, mark `docs-build` required.* Actually stops the merge. Costs: every pull request now waits on an `npm ci` and a Docusaurus build to go green, including pull requests that touch nothing near the docs, and a docs breakage blocks unrelated work.

**Chosen:** yes. The cost is real and worth naming, but the entire pain in this ticket is a check that ran, knew, said so, and blocked nothing. The repo already runs this build on every pull request, so the change is what happens to the result, not new work per pull request.

**Should the required check be narrowed to docs-touching pull requests?**

**Chosen:** no. GitHub's required-check semantics make a skipped check indistinguishable from a pending one, so a `paths:` filter converts every non-docs pull request into a permanently blocked one. This is a hard constraint, not a preference.

**Should permissions be scoped per job?**

- *Leave as is.* One less thing in the diff; fork pull requests already get a read-only token.
- *Scope them.* The build job stops holding deployment and OIDC credentials it never uses, and this change is what turns that job into a required gate.

**Chosen:** scope them. The file is already open in this diff for two other reasons, the change is a few lines, and "the job we just made load-bearing holds credentials it does not need" is a poor thing to leave written down deliberately.

**Should `cancel-in-progress` also become conditional on the event type?**

Cancelling superseded pull-request runs would trim some queueing. GitHub does accept expressions there, but that is not verified in this repo and the per-ref group already solves the blocking problem this change introduces. **Chosen:** leave `cancel-in-progress: false` unchanged — change one thing about the concurrency, for one reason.

## 7. Open questions and assumptions

### Open questions

**Punt:** Should `docs/evidence` — and by extension `docs/adr`, `docs/architecture`, `docs/rfc`, `docs/specs` — be published as site surfaces, or do they stay repo-only artifacts that the site links out to? *(decides: product)*

Today only `docs/guide` and `docs/concept` are routed, and every reference from a routed page into an unrouted subtree has to be written as an absolute GitHub URL. That is a workable convention and this spec follows it, but it means the Agent Delivery Evidence spec — which `governance-check.md` treats as load-bearing reading — is reachable only by leaving the site. The answer changes what the site is for, so it is not a call this spec should make. Nothing in this change forecloses it: routing `docs/evidence` later is additive, and the absolute URL can be converted back to a relative one at that point.

### Assumptions

**Assumes:** PR #499 (FAFF-658) merges substantially as it stands. *Validation:* before starting, run `gh pr view 499 --json state,mergeable` and confirm it is still open and mergeable, or merged. Then run `npm --prefix website run build` on this branch and confirm the broken-link output is the single `../evidence/v0.2/conformance.md` entry and nothing else. If other broken links appear, #499 has changed and this spec's scope no longer matches reality.

**Assumes:** ruleset `18852686` is still the active branch ruleset on the default branch and still carries a `required_status_checks` rule. *Validation:* `faff branch-protection-check --json`, and `gh api repos/shftwst/faff/rulesets/18852686` to confirm `enforcement: active`. If a second ruleset has appeared, the required context must be added to whichever one governs `main`.

**Assumes:** `faff branch-protection-check` reports the ruleset's required checks accurately on this repo. *Validation:* run it before the change and confirm it prints the three known contexts (`validate`, `governance-check`, `env-rootless`). If it does not, the verification step in the gate decision needs a different tool and the pull request body must say so.

**Assumes:** repository admin access exists to modify the ruleset. *Validation:* the build agent should not test this. It is the repo owner's action and the agent's job ends at a pull request plus a clearly stated handoff.

## 8. DONE

### From WHY
- [ ] `npm --prefix website run build` exits 0 on the branch with no broken-link report in its output.
- [ ] The same command prints no `onBrokenMarkdownLinks ... is deprecated` warning.

### From WHAT (config surface)
- [ ] `website/docusaurus.config.js` sets `onBrokenLinks: 'throw'`.
- [ ] The top-level `onBrokenMarkdownLinks` key is absent from `website/docusaurus.config.js`.
- [ ] `markdown.hooks.onBrokenMarkdownLinks` is set to `'throw'`, and `markdown.format` remains `'md'`.
- [ ] `onBrokenAnchors` remains unset (this change does not touch it).
- [ ] The comment above `onBrokenLinks` no longer claims two links in `governance-check.md` and `releasing.md` are tolerated exceptions, and states the current rule forward.

### From WHAT (the link)
- [ ] `docs/guide/governance-check.md` line 14 links to `https://github.com/shftwst/faff/blob/main/docs/evidence/v0.2/conformance.md`; the link text is unchanged.
- [ ] `grep -rnE '\]\(\.\./' docs/guide/*.md docs/concept/*.md` returns no matches.

### From WHAT (link integrity)
- [ ] `.github/workflows/validate.yml` runs a step that fails when a `https://github.com/shftwst/faff/blob/main/<path>` URL in `docs/guide` or `docs/concept`, outside a fenced code block, names a path absent from the working tree.
- [ ] The step scans only `docs/guide` and `docs/concept` — running it over `docs/**` must fail on the archived FAFF-508 spec's placeholder URL, and that is the expected reason for the narrower scope, not an oversight.
- [ ] The step passes on the tree as shipped, finding three URLs and resolving all three.
- [ ] Deliberately breaking one such URL's path makes the step exit non-zero and name that URL.
- [ ] No step is added to the `docs-build` job for this — the check lives in `validate.yml`.

### From WHAT (workflow)
- [ ] `.github/workflows/deploy-docs.yml` defines a job with id `docs-build` and no job with id `build`.
- [ ] `jobs.deploy.needs` is `docs-build`.
- [ ] `concurrency.group` is `pages-${{ github.ref }}`; `cancel-in-progress` is still `false`.
- [ ] There is no workflow-level `permissions` block; `docs-build` declares `contents: read` and holds neither `pages: write` nor `id-token: write`; `deploy` declares `pages: write` and `id-token: write`.
- [ ] The `deploy` job still succeeds on a `main` push after the permissions change.
- [ ] The workflow's `on:` block is unchanged — `workflow_dispatch`, `push` to `main`, bare `pull_request`, with no `paths:` filter anywhere.
- [ ] Every step inside the renamed job is byte-identical to before the rename.

### From HOW (behaviour)
- [ ] A commit pointing the footer's Guide link at a nonexistent route makes the `docs-build` check fail on the pull request, and the failure log names the broken target. Both the failing and the subsequent passing check run are linked in the pull request body.
- [ ] The demonstration commit is reverted on the same pull request before merge.

### From HOW (sequencing)
- [ ] The branch is based on PR #499's head, and the pull request body records that it must not merge before #499.

### From the gate decision
- [ ] The pull request body names the ruleset change as a repo-owner action, gives the ruleset id `18852686` and the context name `docs-build`, carries the FAFF-562 runbook steps, and states plainly that it must be applied only after this pull request merges to `main`.
- [ ] After merge and after the owner applies it, `faff branch-protection-check --json` lists `docs-build` among `required_checks`.

### Integration smoke test

```
PROCEDURE smoke:
  1. Check out the branch. Run `npm --prefix website ci`.
  2. Run `npm --prefix website run build`.
     EXPECT exit 0, no "broken links" text, no "deprecated" text.
  3. Point the footer Guide link at '/guide/does-not-exist'. Rebuild.
     EXPECT exit 1, output naming /faff/guide/does-not-exist.
  4. Revert step 3. Rebuild. EXPECT exit 0.
  5. Break the path in the governance-check absolute URL. Run the
     validate workflow's out-of-tree docs-link step.
     EXPECT exit 1 naming that URL. Revert; EXPECT exit 0.
  6. Confirm the workflow reports the context `docs-build` on the pull
     request, not `build`.
```

If those six steps hold, the posture is settled and the code half of the gate is connected. Step 6 is the one that the ruleset entry depends on.

confidence: medium
spec-review: approve
