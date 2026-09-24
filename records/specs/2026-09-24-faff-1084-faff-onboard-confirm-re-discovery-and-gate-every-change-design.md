# FAFF-1084: faff-onboard re-discovery, confirm-gated per field

> Spec: faffter-dark-nlspec · 2026-09-22 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1084.
>
> Revised 2026-09-22: folded the ratified config-check decision (the one open Punt is now Chosen); confidence lifted from medium to high.

This spec is the buildable artifact for FAFF-1084. It is written for the build agent that will edit `plugin/skills/faff-onboard/SKILL.md` and add a test, and for the human reviewers gating that change. It adds a new subsequent-run branch to onboard so a re-run can refresh a drifted config value through onboard's own confirm machinery, and never silently overwrites a committed, hand-tuned config.

## 1. WHY: Problem and Principles

**The load-bearing model: today a re-run hard-bails, this change routes it through onboard's existing confirm/preview/write machinery instead.** onboard already has all the pieces a safe refresh needs (detection, a preview, a confirm gate, a conflict-guarded writer). It just never reaches them on a second run: Step 1's Exit-0 branch reports "already set up" and stops (`plugin/skills/faff-onboard/SKILL.md` line 58). FAFF-1084 inserts an alternate path into that same Exit-0 case: offer to re-discover, run the existing detection, diff each discovered value against the committed config, confirm each difference per field, and write only the confirmed changes through the existing `faff config init` writer. Nothing about detection or the writer changes; the new machinery is the offer, the diff, and the per-field gate in front of the write.

**Problem statement.** On a subsequent run, onboard's only protections are the Exit-0 hard-bail (which forecloses silent clobber by refusing to do anything) plus `config init`'s conflict refusal (`plugin/skills/faff/bin/lib/config.js` lines 1119 to 1126), so there is no way to refresh a value that has genuinely drifted (a moved git remote, a tracker MCP that appeared since first run) through onboard at all. The operator is left hand-editing the rc or running a bare `config init --set`, neither of which shows current versus discovered before writing. This change adds a re-discover branch that shows the diff and gates every write on the operator confirming it.

**Design principle: never write an unconfirmed byte.** Declining the re-discovery offer, or declining every per-field change, must leave the committed config byte-for-byte identical. The mechanism is to assemble the `config init` call from confirmed-changed keys only, and to skip the call entirely when that set is empty (`config init` is never invoked, so the file is trivially untouched). This mirrors the invariant the decline-parity and onboard-local tests already pin (`test/onboard-local.test.mjs` line 141).

**Design principle: never pass `--force`.** onboard never forces a write (SKILL Rules, line 130 region). A confirmed change is applied by passing that key's new value on `--set` against a base that no longer holds the old value only in the sense that the operator agreed to overwrite it; because onboard passes only confirmed keys, `config init` sees no unresolved conflict and does not need `--force`. If a conflict ever surfaces, that is a logic bug (a key reached the writer without being confirmed), not a case for `--force`.

**Design principle: diff against the committed base, not the merged view.** "Current committed config" is the git-backed `.faffrc.yaml`, not the resolved merge of base plus the machine-local `.faffrc.local.yaml` overlay. `loadConfig` (`plugin/skills/faff/bin/lib/config.js` line 858) returns `[mergedData, basePath, overlayPath]`, so the base path is available to read the committed value directly. Reading the merged view would let an overlay-only personal override masquerade as the committed value and be offered for clobber.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-onboard/SKILL.md` | Skill prose | The flow this change edits: Step 1 (bail), Step 2 (detect), Step 4 (preview/confirm/write), Step 6 (re-run) |
| `plugin/skills/faff/bin/lib/config.js` | JavaScript | `cmdConfigInit` writer, `mergeTrackingBlock` per-key no-op (line 1032) and conflict push (line 1033), `config path` exit codes (lines 2544 to 2547), `TRACKING_KEYS` (lines 911 to 923), `loadConfig` returning `[mergedData, basePath, overlayPath]` (line 858) |
| `plugin/skills/faff/bin/lib/shared-infra.js` | JavaScript | Two-file base/overlay primitives: `CANONICAL_CONFIG` / `CANONICAL_OVERLAY_CONFIG` (lines 459, 465), `findConfig`, `findOverlay`, `deepMergeConfig` |
| `test/onboard-local.test.mjs`, `test/decline-parity.test.mjs` | Node test | Byte-identical-on-decline precedent the new test mirrors |

**Scope statement.** This is a subsequent-run branch inside onboard's Step 1 Exit-0 case for standard mode; it does not touch first-run (Exit 3), the legacy-name error (Exit 2), or local mode's Exit-0 override.

## 2. OUT OF SCOPE

- **First-run behaviour (Exit 3).** Why excluded: the ticket explicitly leaves the no-`.faffrc` path unchanged. Extension point: none needed; Step 2 detection is reused as-is by the new branch.
- **Local-mode re-discovery.** Why excluded: local mode already proceeds past Exit 0 by its own override (SKILL line 62) and writes the overlay exclusively, so its drift story is separate; the ticket WHAT is about the committed base. Extension point: a future issue mirrors this branch for local mode, diffing discovered values against the overlay `.faffrc.local.yaml` only (the symmetric read target) and writing with `config init --local`.
- **A new "diff current vs discovered" CLI command.** Why excluded: onboard's diff is a conversational render of two value sets the skill already holds; no persistent CLI verb is needed. Extension point: if a reusable diff primitive is later wanted, it would live beside `config resolved` in `config.js`.
- **Refreshing keys onboard does not detect (for example `project_id`, `adversarial.*`).** Why excluded: onboard can only produce a "discovered" value for the keys it detects, so it has nothing to diff for hand-added keys; and `project_id` is not in the writer's allowlist (`config init` exits 2 on it). Extension point: a separate ticket that teaches onboard to detect additional keys widens this set automatically.
- **Surfacing `faff config check` posture findings inside the re-run diff.** Why excluded: it is net-new composition orthogonal to the diff/confirm core, and the ratified v1 decision keeps it out (see the Chosen decision in section 6). Extension point: `cmdConfigCheck` in `config.js` already returns structured `{ severity, surface, message }` findings the branch could call and render.

## 3. WHAT: Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Committed config | The git-backed base `.faffrc.yaml`, read directly (not the merged base-plus-overlay view) |
| Discovered value | A value produced by Step 2 detection on the current environment (tracker MCP, git remote, record layout) |
| Detected-key set | The keys onboard can detect and therefore diff: `tracker`, `team_key`, `repo`, `git_host`, `spec_docs_path`, `adr_docs_path`, `spike_docs_path` (SKILL Rules line 143; widened by whatever FAFF-1081 landed) |
| Confirmed-change set | The subset of detected keys whose discovered value differs from (or is absent in) the committed config AND which the operator confirmed this run |

**Field-level diff record (conceptual, held in skill reasoning, not persisted).**

```
RECORD FieldDiff:
  key: DetectedKey            # one of the detected-key set
  current: Scalar | ABSENT    # value in committed base .faffrc.yaml, or ABSENT if the key is unset
  discovered: Scalar          # value Step 2 detection produced this run
  kind: CHANGED | NEW         # CHANGED when current is a differing scalar; NEW when current is ABSENT

  CONSTRAINT kind == NEW  IFF  current == ABSENT
  CONSTRAINT emitted only when discovered != current   # identical keys produce no FieldDiff
```

**Writer interface (unchanged, reused).** The write is one `faff config init` call assembling `--set tracking.<key>=<value>` for each confirmed key, with no `--force` and no `--dry-run` on the real write (`--dry-run` is used for the preview only), exactly as Step 4 does today. Absent keys are inserted and differing keys are overwritten by `mergeTrackingBlock`; a key whose discovered value equals the committed value is a per-key no-op (`config.js` line 1032) even if it slipped into the `--set` list.

**Design decision: per-field confirm, not a single batched apply.** Options: (a) per-field confirm, current versus discovered shown per key; (b) one batched "apply these N changes?" diff. Per-field lets the operator accept a moved git remote while rejecting a spuriously re-detected team, at the cost of more prompts; batched is fewer prompts but all-or-nothing. **Chosen:** per-field confirm (the ticket WHAT specifies it), with a one-glance summary list of all differences shown first so the operator sees the shape before answering each.

**Design decision: only onboard's detected keys count as "changed".** Options: diff only the detected-key set, or diff every key in the committed config including hand-added ones. Onboard cannot produce a discovered value for a key it does not detect, so a broader scope would compare against nothing. **Chosen:** the detected-key set only, matching the existing "Detected keys only" rule (SKILL line 143); hand-added keys are never touched by this branch.

## 4. HOW: Behaviour

**Architecture and approach.** Step 1's Exit-0 branch gains a fork. Once a real config is distinguished from a decline-stub (the existing decline-stub carve-out is unchanged and still falls through to detection), instead of the unconditional "report and stop", onboard offers to re-discover. On decline it prints the resolved path and stops exactly as today (zero writes). On accept it runs the existing Step 2 detection, reads the committed base, builds the field diffs, confirms each per field, and hands the confirmed set to the existing Step 4 write path (preview then one confirm then one `config init`).

**Behaviour summary: the Exit-0 re-discover fork.**

```
PROCEDURE onboard_exit0(config):
  1. IF config is a decline-stub:  proceed to Step 2 detection   # unchanged carve-out
  2. Print resolved base path; report faff is already set up.
  3. Offer: "Re-discover and check for changes? (y/N)"
     a. Decline (default): stop. No detection, no read, no write.   # byte-identical
  4. On accept:
     a. Run Step 2 detection -> discovered value set.
     b. Read committed base .faffrc.yaml only (never the merged view).
     c. FOR each detected key: build a FieldDiff when discovered != current
        (CHANGED if current present, NEW if current ABSENT).
     d. IF no FieldDiffs: report "no changes discovered"; stop.       # byte-identical
     e. Show a one-glance summary of all FieldDiffs (key: current -> discovered).
     f. FOR each FieldDiff, confirm per field:
        - CHANGED: "team_key: current 'SHF', discovered 'SHFT', update? (y/N)"
        - NEW:     "git_host: not set, discovered 'github', add it? (y/N)"
        Declined fields are dropped from the confirmed-change set.
     g. IF confirmed-change set is empty: stop. No config init call.   # byte-identical
     h. Assemble ONE `config init` call with --set for confirmed keys only,
        no --force. Dry-run preview -> one confirm -> real write (Step 4 reused).
```

**Design decision: a newly-discovered key absent from the committed config is confirm-gated too.** A key onboard now detects but the base does not hold (a tracker MCP that appeared since first run) is a `NEW` FieldDiff. It is additive, not a clobber, but it still passes through a confirm ("not set, discovered X, add it?") so the branch stays discovery-not-interrogation and writes nothing unconfirmed. **Chosen:** confirm-gate `NEW` keys with an "add it?" prompt; on decline the key is omitted from `--set`, so `mergeTrackingBlock` never inserts it.

**Design decision: read the committed base directly.** **Chosen:** the diff's `current` comes from the base `.faffrc.yaml` value for each key, read via the base path from `loadConfig`'s return, not the merged data, so an overlay-only personal override cannot be surfaced as a committed value to overwrite.

**Design decision: the diff comparison is normalised to the writer's scalar compare.** The `discovered != current` test uses the same normalised scalar comparison `mergeTrackingBlock` already applies (`config.js` lines 1027 to 1032, which deliberately avoids the `"123"` to `123` coercion trap), so a discovered value that is textually different but semantically equal to the committed base (quoting, numeric coercion, surrounding whitespace) produces no FieldDiff, no spurious confirm prompt, and no churned write. This closes the phantom-diff risk: the write half is already backstopped by the writer's per-key no-op (line 1032), and matching the diff's compare to that same normalisation keeps the prompt half honest too. **Chosen:** compare on the writer's normalised scalar, never a raw string inequality.

**Edge cases and error handling.**
- **Decline the offer:** stop before detection; base untouched.
- **Accept but nothing drifted:** all detected values equal the committed values, no FieldDiffs, report and stop; base untouched.
- **Decline every field:** confirmed set empty, `config init` skipped; base untouched.
- **A detected key is unset in the base:** `NEW` FieldDiff, "add it?" prompt; never a silent insert.
- **A base key is set but onboard now detects nothing for it (for example no `origin` remote this run):** no discovered value, so no FieldDiff and no prompt; the existing committed value is preserved untouched.
- **Legacy-named config (Exit 2) or no config (Exit 3):** unchanged; the fork lives only in Exit 0 standard mode.

**Anti-pattern:** passing a declined key on `--set` with its old committed value. Why: it either trips a needless conflict path or forces onboard toward `--force`; assemble `--set` from confirmed-changed keys only, omitting declined and unchanged keys entirely.

**Anti-pattern:** diffing against the merged config. Why: an overlay-only value would appear as "current" and be offered for clobber against a base that never held it; read base-only.

**Anti-pattern:** reaching for `--force` when `config init` reports a conflict. Why: onboard passes only confirmed keys, so a conflict means a key skipped its gate (a bug to fix), not a value to force over.

**Failure modes.**
- **The failure:** onboard diffs the merged view rather than the base, so an overlay-only override looks like committed drift. **How you'd know:** the test that seeds a base plus a differing `.faffrc.local.yaml` value sees the overlay value offered in the diff, or the base rewritten. **What it means:** the base-only read is wrong; fix before proceeding.
- **The failure:** the confirmed-change assembly leaks declined or unchanged keys into `--set`, so a "decline all" run still rewrites the file. **How you'd know:** the byte-identical-on-decline assertion fails (base differs after a full decline). **What it means:** the `--set` list is not filtered to confirmed changes; narrow it.
- **The failure:** the branch passes `--force`, silently overwriting a hand-tuned value the operator did not confirm, the exact clobber the ticket exists to prevent. **How you'd know:** the command string carries `--force`. **What it means:** abandon that approach; onboard must never force.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo with a real committed .faffrc.yaml and the operator declines the re-discover offer
When onboard runs its Exit-0 branch
Then no detection, read, or write occurs and .faffrc.yaml is byte-for-byte unchanged
```

```
Given a committed config whose team_key and git_host both differ from the discovered values
When the operator confirms the git_host change but declines the team_key change
Then config init is called with --set for git_host only, without --force,
     and the committed team_key value is preserved unchanged
```

```
Given a committed config with no git_host key and a discovered git_host of github
When the operator confirms the "add it?" prompt for git_host
Then config init inserts tracking.git_host=github and no other key changes
```

- The Exit-0 branch never passes `--force` to `config init` on any confirmed-write path.
- First-run behaviour (Exit 3, no `.faffrc`) is unchanged: detection runs and writes as before, with no re-discover offer.

## 6. Design Decision Rationale

**Per-field confirm versus one batched apply?** Options: per-field (fine-grained, more prompts) versus batched all-or-nothing (fewer prompts, coarse). **Chosen:** per-field, per the ticket WHAT, with a summary list shown first for a one-glance view before the individual prompts.

**Which keys count as "changed"?** Options: onboard's detected-key set only, versus every key in the committed config. Onboard has no discovered value for undetected keys. **Chosen:** the detected-key set only, consistent with "Detected keys only" (SKILL line 143). Hand-added keys are never diffed or written by this branch.

**Confirm-gate newly-discovered keys, or auto-add them?** Options: gate `NEW` keys behind an "add it?" prompt, versus insert additive keys silently. **Chosen:** gate them; the branch writes nothing unconfirmed, additive or not.

**Diff against the base or the merged view?** Options: base `.faffrc.yaml` only, versus the resolved base-plus-overlay merge. **Chosen:** base only, so overlay-only personal overrides cannot be offered for clobber. At the time of writing, `loadConfig` returns the base path alongside the merged data, so the base value is directly readable.

**Normalise the diff comparison?** Options: a raw string inequality on the discovered-versus-committed values, versus the writer's own normalised scalar comparison. A raw compare would flag a value that is textually different but semantically equal (quoting, numeric coercion, whitespace) as drift, producing a spurious confirm prompt. **Chosen:** compare on the same normalised scalar `mergeTrackingBlock` applies (`config.js` lines 1027 to 1032), so no phantom diff reaches the operator and the write half stays backstopped by the writer's per-key no-op.

**Surface `faff config check` posture findings during the re-run diff?** Options: compose `cmdConfigCheck` into the diff (surface, for example, a re-discovered non-GitHub `git_host` or a secret-shaped value inline), versus keep the MVP to the value diff and leave `config check` as the separate step the report already recommends. This is net-new composition, orthogonal to the diff/confirm core today. **Chosen:** v1 diffs only the re-discovered config values against the committed base `.faffrc.yaml` and gates each change; `faff config check` posture findings (base committed? overlay ignored? secret-shaped values?) stay in that command and are not folded into the onboard re-run diff. Rationale: the value diff and the posture check are separable concerns, so shipping the diff/confirm core without pulling posture composition in keeps the slice at its thinnest coherent cut; composing them in is a named later extension point (ratified: product).

**Sequencing against FAFF-1081.** FAFF-1081 (Done) edits the same Step 1 / Step 6 / Rules sections and widens the detected-key set. **Assumes:** FAFF-1081 has landed on `main`; this branch rebases onto it and treats whatever detected-key set it left in SKILL Step 2 / Rules as the set to diff. Validation: before writing prose, read the current SKILL.md Step 2 and Rules to confirm the live detected-key list, and rebase onto the tip so the edit does not collide.

## 7. Open Questions and Assumptions

**Resolved decisions (formerly open).**
- **`faff config check` composition in the re-run diff.** `**Chosen:** v1 diffs only the re-discovered config values against the committed base `.faffrc.yaml` and gates each change; `faff config check` posture findings stay in that command and are not folded into the onboard re-run diff (ratified: product).` Rationale: the value diff and the posture check are separable concerns, so the MVP ships the diff/confirm core plus the existing "run `faff config check`" recommendation; composing the findings in is a named later extension point. Context: `cmdConfigCheck` already returns structured findings; wiring them into the diff is additive but expands the branch's surface.

**Assumptions.**
- **`**Assumes:** FAFF-1081 has landed on `main` and defines the current detected-key set.** Validation: run `git log --oneline` for the FAFF-1081 merge and read SKILL.md Step 2 / Rules for the live detected-key list before editing; rebase onto the tip to avoid a Step 1 / Step 6 collision.
- **`**Assumes:** `loadConfig` exposes the base `.faffrc.yaml` path distinctly from the merged view** (in `config.js` line 858, over `shared-infra.js`'s `findConfig`/`findOverlay`/`deepMergeConfig`). Validation: confirm `loadConfig`'s return still yields `[mergedData, basePath, overlayPath]` so the base value is readable without the overlay.

## 8. DONE: Definition of Done

### From WHY
- [ ] A subsequent run on a real committed config no longer stops unconditionally; it offers re-discovery (SKILL Step 1 Exit-0 fork).
- [ ] Declining the offer, or confirming zero changes, leaves `.faffrc.yaml` byte-for-byte unchanged.
- [ ] No write path passes `--force` to `config init`.
- [ ] The diff reads the committed base `.faffrc.yaml`, not the merged base-plus-overlay view.

### From WHAT (scope and shape)
- [ ] Only the detected-key set (`tracker`, `team_key`, `repo`, `git_host`, `spec_docs_path`, `adr_docs_path`, `spike_docs_path`, plus any FAFF-1081 additions) is diffed and offered.
- [ ] A one-glance summary of all differences is shown before the per-field prompts.
- [ ] Hand-added and undetected keys (for example `project_id`) are never diffed or written by this branch.

### From HOW (behaviour)
- [ ] On accept, Step 2 detection runs and each detected key whose discovered value differs from (or is absent in) the base produces a per-field confirm prompt.
- [ ] A confirmed `CHANGED` key is written via `--set`; a declined `CHANGED` key preserves the committed value.
- [ ] A confirmed `NEW` key (absent in base) is inserted via `--set`; a declined `NEW` key is omitted, so `mergeTrackingBlock` never inserts it.
- [ ] The write is one `config init` call assembling `--set` for confirmed keys only, preceded by a `--dry-run` preview and one confirm gate (Step 4 reused).

### From HOW (edge cases)
- [ ] Accept-but-no-drift reports "no changes" and writes nothing.
- [ ] A base key with no discovered value this run produces no prompt and is preserved.
- [ ] Exit 2 (legacy name) and Exit 3 (no config) branches are unchanged.

### Test surface
- [ ] A new `test/onboard-rediscover.test.mjs` spawns the real CLI against a throwaway `git init` repo and drives the mechanical sequence the new SKILL prose describes (`config path` then a `config init` assembled from confirmed keys only), mirroring `test/onboard-local.test.mjs` and `test/decline-parity.test.mjs`.
- [ ] The suite asserts byte-identical-on-decline: after a full decline (offer declined, and separately every field declined), the seeded base `.faffrc.yaml` is byte-for-byte unmodified (the `readFileSync(...) === baseText` assertion pattern at `onboard-local.test.mjs` line 141).
- [ ] The suite asserts confirmed-only writes: given a base with two differing detected values, a `config init` call carrying `--set` for only the confirmed key (no `--force`) updates that key and leaves the declined key's committed value intact.
- [ ] The suite asserts a `NEW`-key insert on confirm and no insert on decline.
- [ ] The suite asserts the no-op path: re-discovering a config whose detected values all equal the committed base (including a value that is textually different but semantically equal, for example a quoted-versus-bare scalar) yields zero confirm prompts and zero writes, so the base stays byte-for-byte unchanged.
- [ ] The suite is registered wherever the existing onboard tests are discovered by the runner.

**Integration smoke test.**

```
PROCEDURE smoke_rediscover:
  1. git init a throwaway repo; write a base .faffrc.yaml with tracking.git_host absent
     and tracking.team_key=OLD; git add + commit it.
  2. Simulate the confirmed-change branch: run `faff config init --set tracking.git_host=github
     --set tracking.team_key=NEW` (no --force), the confirmed set.
  3. Assert exit 0, the base now holds git_host=github and team_key=NEW, and unrelated bytes survive.
  4. Re-run the same command: assert it is a no-op (all values already set), proving idempotence.
```

## Methodology critique

**Right-sizing (principle 4): No issues.**
The three net-new pieces (the re-discover offer, the per-field diff, the confirmation gate) are sequentially dependent, not structurally independent: a diff with no gate does nothing, a gate with no diff has nothing to guard, so they ship as one 1-3 day unit and there is nothing to split. Merging is not in play. The one product decision (whether to fold `faff config check` posture findings into the re-run diff) is now ratified as out of v1 scope, which keeps this slice at its thinnest coherent cut rather than pulling posture composition in speculatively. Correctly sized.

**Workstream fit (principles 1 + 5).**
*What's there:* the issue sits on the Faff team board with no outcome project surfaced, alongside FAFF-1081 (detected-key set, Done), FAFF-1084 (this re-discover gate), and FAFF-1085 (Related). All three converge on one outcome: making onboarding safe and idempotent to re-run over an existing config.
*Why it matters:* loose, project-less tickets on a team board do not sequence against a shared "done", so a coherent onboarding-safety stream reads as three unrelated tasks and its completion is undefined.
*What to do:* consider grouping FAFF-1081 / FAFF-1084 / FAFF-1085 under one outcome-led container (an onboarding-safety / idempotent-onboard outcome), so the stream sequences and reports as a unit rather than floating.

**Surfaced deps (principle 6).**
*What's there:* FAFF-1084 "Assumes FAFF-1081" is a real edit-overlap dependency (the spec says 1081 rewrites the same SKILL Step 1 / Step 6 / Rules sections and defines the detected-key set this change rebases onto). 1081 is Done, so no active blocker link is needed, but the shared-region overlap is live for rebase / merge-conflict purposes. Separately, FAFF-1085 is linked only as "Related".
*Why it matters:* "Related" carries no direction, so if 1085 shares those same SKILL sections or must land in a set order with 1084, automation cannot sequence the pair honestly and one could be pulled "ready" ahead of its actual prerequisite. The config-check composition was a latent scope dep, but it is now resolved out of v1, so a "yes, compose" answer no longer widens this slice's scope.
*What to do:* confirm whether the FAFF-1085 relationship is load-bearing; if it shares SKILL regions or must land in a set order, promote "Related" to a directional `blocks` / `blockedBy` edge. Note the FAFF-1081 edit-overlap on the ticket so the rebase is expected.

**Risk profile (principle 7).**
*What's there:* confidence is high and the safety-critical property is "never write an unconfirmed change (never --force), byte-identical on decline, confirmed-only on accept". The test file asserts byte-identical-on-decline and confirmed-only writes, which de-risks the two headline behaviours. The two less-obviously-covered risks the earlier review flagged are now folded into the spec: (1) the phantom-diff / semantic-equality case has a Chosen decision (the diff compares on the writer's normalised scalar) plus a no-op-path Test-surface bullet, and (2) the Test surface drives the real `faff config init` writer, not a mock, so the "never write unconfirmed" property is mechanically exercised.
*What to do:* no further action needed at prep; both risks are now design-Chosen and test-covered. Carry the no-op / zero-prompt assertion into `test/onboard-rediscover.test.mjs` at build.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "topic": "per-field vs batched confirm", "marker": "chosen" },
    { "topic": "detected-key set is the change scope", "marker": "chosen" },
    { "topic": "confirm-gate newly-discovered keys", "marker": "chosen" },
    { "topic": "diff against committed base, not merged view", "marker": "chosen" },
    { "topic": "normalise the diff comparison to the writer scalar compare", "marker": "chosen" },
    { "topic": "config check composition in re-run diff", "marker": "chosen" },
    { "topic": "FAFF-1081 landed and defines detected-key set", "marker": "assumes" }
  ] }
```
