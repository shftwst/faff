# Spec — FAFF-299: `faff doctor` must flag a dangling skill symlink as unhealthy

> Spec: faffter-dark-nlspec · 2026-06-29 · autonomous · confidence: high.

This is the build spec for FAFF-299. Audience: the build agent implementing the fix, and human reviewers gating it. It specifies a one-function change to `faff doctor`'s per-skill install-health classifier plus a born-verifiable test.

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff doctor` classifies each skill entry under the install target by asking *"is this entry a symlink?"* — but a symlink can point at a target that no longer exists (a **dangling** link). `lstatSync(...).isSymbolicLink()` answers "is-a-symlink" without following the link, so a dangling link reads as a healthy symlink. The fix is to additionally ask *"does the link's target resolve?"* and treat a symlink whose target is gone as its own unhealthy state.

**Problem statement.** Today doctor prints `✓ <name>  symlink (live → repo)` and reports the install clean for a dangling skill symlink — e.g. the link `~/.claude/skills/faffter-noon-methodology-structural` orphaned when FAFF-296 renamed its source away. This "dangling-as-healthy" is a false green that hides exactly the stale-install rot doctor exists to catch. The change makes the per-skill check verify target resolution and report a dangling link as a distinct unhealthy state that makes the overall result non-clean (exit 1).

**Design principle — filesystem-truth, no link-following for classification beyond existence.** Classification must keep reading the filesystem directly (the property that lets doctor report correctly even when run from a stale installed binary). Use `lstat` for is-a-symlink and a non-throwing existence probe for target-resolves; do not `realpath`/read the target's contents.

## 2. OUT OF SCOPE

- **Extending `link-skills.sh --replace` to prune source-gone orphans.** Held as a separate follow-up; `link-skills.sh --prune` already removes dead symlinks pointing into the repo's skills dir.
- **Auto-repairing the dangling link from doctor.** Doctor is a read-only health reporter.
- **The `bin/faff` CLI-symlink line.** Unaffected and unchanged.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| live symlink | a symlink whose target exists (resolves). Healthy. |
| dangling symlink | a symlink whose target does **not** exist. The new unhealthy state. |
| copy | a real directory (not a symlink) — the pre-existing stale-install unhealthy state. |

Classifier states (per skill entry):

```
LIVE      # symlink, target resolves   → "✓ <name>  symlink (live → repo)"      ; clean
DANGLING  # symlink, target missing    → "✗ <name>  symlink-dangling (target gone — stale orphan)" ; NOT clean
COPY      # not a symlink (real dir)   → "✗ <name>  COPY — not dev-linked; shipped changes won't go live" ; NOT clean
```

Overall result + exit code (unchanged contract, widened trigger):
- Exit `0` only when **every** entry is `LIVE`.
- Exit `1` when **any** entry is `COPY` **or** `DANGLING`.
- Exit `2` unchanged: unreadable target / no faff skills found.

**Chosen probe:** `fs.existsSync(full)` — follows the link, returns `false` for a dangling link; the direct non-throwing translation of `[ -L x ] && [ ! -e x ]`. `lstat.isSymbolicLink() && !fs.existsSync(full)` ⇒ `DANGLING`.

## 4. HOW — Behavior

Split the binary symlink/else branch into three: symlink + resolves ⇒ LIVE; symlink + missing ⇒ DANGLING (own counter); not a symlink ⇒ COPY. Result block tracks `dangling` alongside `copies`; non-clean when either > 0; Fix hint gains `--prune`.

Anti-patterns: classifying with `realpath`/reading target contents; folding dangling into the COPY bucket.

## 5. SCENARIOS — born-verifiable main objectives

- Dangling symlink ⇒ exit 1, label contains "dangling" not "live → repo", RESULT not all-clean.
- All-live ⇒ exit 0 (no regression).
- Mixed live + dangling + copy ⇒ exit 1, dangling distinguished from copy.

## 8. DONE — Definition of Done

- A dangling skill symlink is reported unhealthy, not `✓ symlink (live → repo)`; overall result exit 1.
- A live symlink still reports `✓ … symlink (live → repo)`; a copy still `✗ … COPY …` exit 1.
- Dangling reports a distinct label containing "dangling", counted separately.
- Exit 2 behaviour unchanged.
- Classification uses `lstat.isSymbolicLink()` + `fs.existsSync` (no realpath/read).
- RESULT line reports dangling counts; Fix hint includes `--prune`.
- `test/doctor.test.mjs` gains a dangling-symlink case asserting exit 1 + "dangling" label; existing cases still pass.

confidence: high
