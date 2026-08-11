# FAFF-430 — Shrink the `git_host` promise to GitHub-only

> Spec: faffter-dark-nlspec · 2026-08-10 · autonomous · confidence: high. Full spec on Linear FAFF-430.

This spec is the design record for FAFF-430, for the build agent and human reviewers. The ticket framed an either/or — ship a gitlab/gitea merge-gate shell, or shrink the `git_host` promise to gh-only. A human Resolution comment (2026-08-10) settled it: "keep `github` as only supported host, ditch the rest and any reference to them." This spec builds only the shrink direction.

## 1. WHY — Problem and Principles

**The load-bearing model:** `git_host` is an *advertised* config knob with **no behavioural consumption** anywhere in the codebase. The merge floor — the only place a git host matters — is unconditionally `gh`. So `git_host` today is a label on a switch that is not wired to anything; a user who sets `git_host: gitlab` gets branch/commit operations that appear to work and then a merge gate that is silently GitHub-shaped. The fix is to stop advertising the unwired positions and to make the one wired position (`github`) the only value config will accept — turning silent config theater into a loud, honest refusal.

**Problem statement.** `.faffrc` advertises `git_host: github | gitlab | gitea | …`, but the merge floor is gh-only in code (`spawnSync("gh", …)`, `gh api …/check-runs`, `.../status`, `gh api …/rules/branches` for protection, `gh pr merge`). A configured non-github host is silently broken — config theater. This change constrains `git_host` to `github` at config-validation time and removes gitlab/gitea from every advertised git_host surface.

**Design principles.**

- **Refuse, never silently degrade.** A present, non-`github` `git_host` must fail loud at config-validation time — the acceptance criterion's "never silently broken". A warn a user can miss is not enough when the consequence is a silently GitHub-shaped merge on a non-GitHub forge.
- **Reuse the existing lane-validator precedent.** `config get` already fail-louds (exit 2) on off-vocabulary `models.*` / `effort.*` values via `validateModelValue` / `validateEffortValue`, and `config set` / `config init` already "refuse at write a value that would fail loud at read". A `git_host` validator drops into that exact shape — one validator, three enforcement points for free.
- **Remove the promise, not unrelated mentions.** "Any reference to them" means the `git_host` *promise* surface. A `.gitlab-ci.yml` string in the infra-profile miner is CI-artifact detection of a *scanned* repo, not a git_host promise, and must survive.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` | JS (Node) | Config read/write/check surface — hosts the new `git_host` validator, the writer refusal (inherited), and the `config check` finding |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JS (Node) | The gh-only merge floor — evidence the promise is unwired; **not modified** |
| `.faffrc.example.yaml` | YAML | Advertised schema — the `git_host` comment shrinks |
| `plugin/skills/faff/SKILL.md` | Markdown | Gateway schema comment + autodetect prose — shrink to github-only |
| `plugin/skills/faff-onboard/SKILL.md` | Markdown | Host→token mapping — drop gitlab/gitea rows |
| `plugin/skills/faff/bin/lib/profile.js` + `test/profile-miner.test.mjs` | JS | `.gitlab-ci.yml` CI detection — **preserved carve-out** |

**Scope statement.** This sits in the config-validation surface (`faff config`) and the advertised-config documentation; it does not touch the merge floor, which is already GitHub-only.

## 2. OUT OF SCOPE

- **A gitlab/gitea merge-gate shell.** — Why excluded: the human decision explicitly chose the shrink direction over building a second shell. Extension point: were multi-host support ever revived, a second impure shell would sit behind the pure `decideFloor` core in `contract-defs.js`, selected by `git_host` in `merge-gate.js`; the `git_host` allowlist added here would widen to admit the new token.
- **`.gitlab-ci.yml` detection in the infra-profile miner** (`profile.js:137`, `test/profile-miner.test.mjs:127`). — Why excluded: this detects the *scanned target repo's* CI system for the infra profile; it is unrelated to faff's own `git_host` merge floor and removing it would break legitimate profile mining of GitLab-CI repos. Extension point: none needed — it stays.
- **Historical `records/specs/*` references to gitlab/gitea.** — Why excluded: AGENTS.md binds historical records to the names used when written. Extension point: none — leave untouched.
- **Autodetection mechanics for git host.** — Why excluded: with `github` the only supported host there is nothing to detect between; the prose simply stops promising multi-host detection. Extension point: `faff-onboard`'s host→token mapping, already narrowed here.
- **Case/alias normalisation of the token** (`GitHub`, `gh`, `github.com`). — Why excluded: the token vocabulary is exact-lowercase throughout faff (model/effort tokens are exact-match); onboard writes `github` verbatim. Extension point: the single validator function, if aliasing is ever wanted.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| `git_host` | The `tracking.git_host` config key naming the forge faff's merge floor targets |
| Supported-host allowlist | The closed set of accepted `git_host` values — after this change, exactly `{ "github" }` |
| Unset host | `tracking.git_host` absent from config — valid; resolved at use time (today's behaviour, unchanged) |

**The allowlist.**

```
CONSTANT GIT_HOST_ALLOWLIST = { "github" }   # exact-match, lowercase
```

**Validator interface** (mirrors `validateModelValue` / `validateEffortValue` in `config.js`):

```
FUNCTION validateGitHostValue(value) -> errorString | null
  # value: the resolved scalar for tracking.git_host (never called when the key is unset)
  # returns null when value is in GIT_HOST_ALLOWLIST
  # returns a fail-loud message naming the value + the legal set otherwise
```

**Three enforcement points, one validator:**

| Point | Trigger | Behaviour |
|---|---|---|
| `faff config get tracking.git_host` | key present, value ∉ allowlist | exit 2, stderr names value + legal set (`github`) |
| `faff config set tracking.git_host <v>` / `config init --set tracking.git_host=<v>` | `<v>` ∉ allowlist | refused at write (inherited: the writer runs the same read-time validators; file byte-unchanged) |
| `faff config check` | merged `tracking.git_host` present, value ∉ allowlist | `error` finding (exit 1), message names the value + remedy (`set git_host: github or leave it unset`) |

**Design decision — enforcement strength.** Options: (a) `config check` warn only; (b) read-time `config get` exit 2 + writer refusal + `config check` error. **Chosen:** (b) — the acceptance criterion is "refused/documented as unsupported at config-validation time — never silently broken"; read-time exit 2 is the strongest honest floor, the writer refusal comes free from the existing "fail-loud-at-read ⇒ refused-at-write" belt, and the `config check` error catches a hand-edited base. A warn-only surface would leave a hand-edited non-github value silently limping.

## 4. HOW — Behavior

**Architecture and approach.** Add one pure validator, `validateGitHostValue`, alongside the existing `validateModelValue` / `validateEffortValue` in `config.js`, and wire it at the same seam those use so all three enforcement points inherit it. The merge floor is not touched.

**Behaviour summary.** The read path already routes certain keys through per-key validators before returning; extend that routing so `tracking.git_host` (when present) is validated, exiting 2 on a non-github value exactly as an off-vocabulary model token does.

```
PROCEDURE config_get(key, mergedDoc):
  1. Resolve the scalar for `key` from mergedDoc.
  2. IF key is absent → exit 3 (unchanged; unset git_host stays valid).
  3. IF key == "tracking.git_host":
     a. err := validateGitHostValue(value)
     b. IF err != null → write err to stderr, exit 2 (fail-loud, no silent inherit).
  4. Print value, exit 0.
```

```
FUNCTION validateGitHostValue(value):
  1. IF value ∈ { "github" } → return null.
  2. return `config get tracking.git_host: invalid host "<value>" —
            faff's merge floor is GitHub-only; legal set: github (or leave it unset)`.
```

**Writer refusal (inherited, no new code beyond registering the validator).** `config set` / `config init` already reuse the read-time per-key validators so "a value that would fail loud at read is refused at write" (`config.js` ~line 953). Registering `validateGitHostValue` at that shared seam makes `faff config set tracking.git_host gitlab` and `faff config init --set tracking.git_host=gitlab` refuse (exit 2), file byte-unchanged. **Anti-pattern:** adding a second, writer-only host check. Why: it would duplicate the vocabulary and risk drift between read and write — the whole point of the shared-validator seam is one source of truth.

**`config check` finding.** In `computeConfigCheck` (`config.js:1400`), after the merged document is available (the same place the `automation_default: opt-out` finding is emitted), add: if `tracking.git_host` is present and not `github`, push an `error` finding:

```
{ severity: "error",
  surface: "tracking.git_host",
  message: `git_host: "<value>" is not supported — faff's merge floor is GitHub-only. Set git_host: github or leave it unset.` }
```

**Documentation shrink (prose edits, no behaviour):**

```
PROCEDURE shrink_advertised_surface:
  1. .faffrc.example.yaml:33 — replace
       `git_host: github # github | gitlab | gitea | … (autodetected if omitted)`
     with a github-only comment, e.g.
       `git_host: github # github — the only supported host (may be left unset)`
  2. plugin/skills/faff/SKILL.md:142 — same shrink on the schema comment.
  3. plugin/skills/faff/SKILL.md:186 — reword the autodetect prose so it no longer
     promises multi-"git host" support; keep the tracker-autodetect sentence intact,
     drop/soften the "git host MCP servers" multi-host framing to GitHub-only.
  4. plugin/skills/faff-onboard/SKILL.md:59 — remove the `gitlab.com→gitlab` and
     `gitea→gitea` mappings; keep `github.com→github`; an unrecognised/self-hosted
     host is confirmed-as-github (the GitHub-Enterprise case) or skipped — never
     mapped to an unsupported token.
```

**Anti-pattern:** editing `profile.js` / `profile-miner.test.mjs` to strip `.gitlab-ci.yml`. Why: that string is the infra-profile miner recognising a *scanned* repo's CI system — nothing to do with faff's own `git_host`. Removing it regresses profile mining of GitLab-CI repos.

**Edge cases and error handling.**

- **Unset `git_host`** → validator never runs; `config get` exits 3 as today; `config check` emits nothing. Unset stays fully valid.
- **`github`** → validator returns null everywhere; unchanged behaviour.
- **`GitHub` / `GITHUB` / `gh` / `github.com`** → not in the exact-lowercase allowlist → refused (exit 2). Consistent with model/effort exact-match tokens; the remedy string names `github`.
- **Retryable vs terminal:** all refusals are terminal config errors — the remedy is to fix the value or unset it, never retry.

**Failure modes.**

- **The failure:** a consumer somewhere *does* branch on `git_host` and the exact-match allowlist breaks an existing valid config. **How you'd know:** `grep -rn git_host bin/` — at spec time this returns only the `TRACKING_KEYS` writer entry (no behavioural read). **What it means:** proceed; there is no behavioural consumer to break.
- **The failure:** the writer refusal does not actually inherit the new validator (the shared seam doesn't cover `tracking.git_host`). **How you'd know:** the DONE writer-refusal test (`config set tracking.git_host gitlab` still writes). **What it means:** narrow — register the validator at the writer seam explicitly rather than assuming inheritance.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a .faffrc with tracking.git_host: gitlab
When `faff config get tracking.git_host` runs
Then it exits 2 and stderr names the value and the legal set (github)
```

```
Given a repo with no tracking.git_host set
When `faff config get tracking.git_host` runs
Then it exits 3 (absent) exactly as before — unset stays valid
```

```
Given a hand-edited base with tracking.git_host: gitlab
When `faff config check` runs
Then it reports an error finding on surface tracking.git_host and exits 1
```

- The infra-profile miner still detects `.gitlab-ci.yml` (the `profile-miner.test.mjs` gitlab-ci case still passes).

## 6. Design Decision Rationale

**How strong should the refusal be?**
- (a) `config check` warn only — pro: minimal; con: a hand-edited non-github value still limps silently, violating "never silently broken".
- (b) read-time `config get` exit 2 + inherited writer refusal + `config check` error — pro: strongest honest floor, matches the model/effort lane precedent, writer refusal free; con: slightly more surface.
- **Chosen:** (b) — the acceptance criterion demands loud refusal at config-validation time, and the codebase already has the exact three-point validator pattern.

**Does "any reference to them" include the infra-profile `.gitlab-ci.yml` string?**
- (a) strip every gitlab/gitea string repo-wide; (b) remove only the `git_host` promise surface, preserve unrelated CI-artifact detection and historical records.
- **Chosen:** (b) — the human decision targets the `git_host` promise; `.gitlab-ci.yml` detection is SUT CI recognition, and AGENTS.md protects historical records. Stripping (a) would regress the profile miner.

**Token matching — exact-lowercase vs alias-tolerant?**
- **Chosen:** exact-lowercase `github` — consistent with faff's model/effort token vocabularies; onboard writes `github` verbatim, so no real config produces an alias.

## 7. Open Questions and Assumptions

**Open Questions.** None — the direction is human-decided and the enforcement pattern has direct codebase precedent.

**Assumptions.**

- **Assumes:** `git_host` has no behavioural consumer beyond the `TRACKING_KEYS` writer entry. Validate: `grep -rn "git_host\|gitHost" plugin/skills/faff/bin/` before building — expect only the `config.js` `TRACKING_KEYS` line.
- **Assumes:** `config set` / `config init` route writes through the same per-key read-time validators (the "fail-loud-at-read ⇒ refused-at-write" belt at ~`config.js:953`). Validate: read that block and confirm the validator dispatch covers `tracking.*` keys; if it does not reach `tracking.git_host`, register the validator explicitly at the writer seam (per the failure-mode note).
- **Assumes:** the `automation_default: opt-out` finding site in `computeConfigCheck` has the merged document in scope for the new finding. Validate: confirm `mergedDoc` is available at that point in `config.js:~1458`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A present, non-`github` `git_host` fails loud at config-validation time (no silent degrade).

### From WHAT (allowlist + validator)
- [ ] `validateGitHostValue` exists alongside `validateModelValue` / `validateEffortValue`, returning null for `github` and a value+legal-set message otherwise.
- [ ] The allowlist is exactly `{ "github" }`, exact-lowercase.

### From HOW (read-time)
- [ ] `faff config get tracking.git_host` with `gitlab`/`gitea`/any non-github value exits 2 with a stderr message naming the value and `github`.
- [ ] `faff config get tracking.git_host` with `github` exits 0 and prints `github`.
- [ ] `faff config get tracking.git_host` unset exits 3 (unchanged).

### From HOW (writer refusal)
- [ ] `faff config set tracking.git_host gitlab` is refused (exit 2), file byte-unchanged.
- [ ] `faff config init --set tracking.git_host=gitea` is refused (exit 2), file byte-unchanged.

### From HOW (config check)
- [ ] `faff config check` on a base with a non-github `git_host` emits an `error` finding on surface `tracking.git_host` and exits 1.

### From HOW (documentation shrink)
- [ ] `.faffrc.example.yaml` no longer lists `gitlab` / `gitea` in the `git_host` comment.
- [ ] `plugin/skills/faff/SKILL.md` schema comment and autodetect prose no longer promise gitlab/gitea/multi-host `git_host`.
- [ ] `plugin/skills/faff-onboard/SKILL.md` host mapping drops gitlab/gitea; unrecognised host confirms-as-github or skips.

### From OUT OF SCOPE (preserved carve-outs)
- [ ] `profile.js` `.gitlab-ci.yml` detection and `test/profile-miner.test.mjs` gitlab-ci case are unchanged and passing.
- [ ] `records/specs/*` historical gitlab/gitea references are untouched.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Write a temp .faffrc with `tracking:\n  git_host: gitlab`.
  2. `faff config get tracking.git_host`  → assert exit 2, stderr mentions "github".
  3. `faff config check`                  → assert exit 1, an error finding on tracking.git_host.
  4. Rewrite with `git_host: github`      → `faff config get` prints github, exit 0; `config check` clean for this key.
  5. `faff config set tracking.git_host gitea` → assert exit 2, file unchanged.
```

confidence: high

_Prepped autonomously (run-20260810-181111-beepboop-list). Direction settled by the 2026-08-10 Resolution comment (github-only)._
