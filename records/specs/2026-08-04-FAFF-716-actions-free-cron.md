# Spec — FAFF-716: Actions-free reference — cron-triggered faff on a fly Machine

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-716.

## 1. WHY — problem and principle

The two shipped references (`operations/ci/l3-watcher.yml`, `l4-watcher.yml`) are GitHub-Actions-shaped. But GitHub Actions is only one *trigger* — the L3/L4 design's own framing is "the trigger owns wake-up; faff owns everything after." Two reasons to also document the **Actions-free** path (a cron / systemd timer on the machine that runs the same sequence with no Actions in the loop):

1. **Cost.** As of **2026-03-01** GitHub applies a **$0.002/min cloud-platform charge to self-hosted-runner usage** on private repos, and self-hosted runners now draw down the free-minutes quota the same way hosted ones do (public repos and GitHub Enterprise Server are exempt). So keeping Actions in the loop now has a real per-minute cost *even on your own hardware*; taking it out avoids the platform charge entirely. (Verified 2026-08-04 against GitHub's Actions runner-pricing docs + the 2025-12-16 pricing changelog.)
2. **Simplicity / the always-on rig.** A fly Machine (or any always-on box) that wakes itself via cron needs no runner registration, no Actions dependency, and is the natural home for a self-triggering factory.

## 2. WHAT — design (the load-bearing decisions)

**Chosen: the deliverable is a committed wrapper `operations/ci/faff-cron.sh` plus a rig-doc section — the Actions-free parallel of the workflow references.** Same "a reference an operator copies" convention as `l3-watcher.yml`. The operator drops the wrapper into a crontab / systemd timer; the rig-doc section (`docs/guide/self-hosted-rig.md`) explains it, the cost rationale, and the keep-vs-lose notes. It is a reference, not a live thing.

**Chosen: the wrapper encodes the same sequence the workflows do, and is L3-complete with the L4 delta documented.** The wrapper runs, in order: `faff container-check --gate` (fail-closed, before any agent/claim/mint) → the L3 drain (mint a run dir, export `FAFF_RUN_DIR`, `claude -p "/faff-beep-boop"` — L3 sets only `FAFF_RUN_DIR`, not `FAFF_APPETITE`, matching `l3-watcher.yml`; `FAFF_APPETITE=full` is L4's) → `faff disposition --run-dir` (exit-propagating). This mirrors `l3-watcher.yml` step-for-step, as plain shell. The **L4 resume-segmentation** variant is documented (not re-scripted twice): the resolve-newest-run-and-try-`lights-out --resume`-else-mint logic and the `lights-out --resume … --check` exit reconciliation already live in `l4-watcher.yml`; the section points there and states the delta (persistent single-runner workspace, `slots.concurrency` sequential, the escalation-not-clean-exit boundary) rather than duplicating the whole L4 dance in a second script.

**Chosen: `flock` is the Actions-free concurrency guard — the `concurrency:`-block equivalent.** faff has no cross-run drain lock, so the wrapper wraps itself in `flock` on a lockfile (`flock -n <lock> <wrapper>` or an in-script `flock`), so two timer firings never overlap and touch the same ledger — exactly what the workflows' `concurrency: cancel-in-progress:false` gave. Claim-before-admit remains the correctness backstop (a non-overlapping guarantee, not a substitute for it). The section states both, as the workflows do — and notes the one behavioural difference: `flock -n` (non-blocking) **skips** an overlapping firing until the next tick, whereas the workflows' `concurrency:` **queues** it to run after the first finishes; the doc says which so an operator isn't surprised a firing was dropped (harmless — the next tick re-queries the tracker).

**Chosen: keep-vs-lose is stated, and points at the shipped pieces.** Without Actions you **lose** the Actions UI live logs — stream instead via `claude -p --output-format stream-json` (the "Watching a run live" section shipped for FAFF-719). You **keep** `governance-check`: it still runs on GitHub's side when the PR opens (it is a PR check, not part of the trigger). The section names both so an adopter isn't surprised.

**Chosen: the cost rationale is stated accurately, sourced, and dated — never asserted from memory.** The section states the 2026-03-01 self-hosted platform charge, the public-repo / GHES exemptions, and that self-hosted now draws the free quota, with a date-stamp ("verified 2026-08-04") and a pointer to GitHub's runner-pricing doc — so a future reader knows to re-check current pricing rather than trust a possibly-stale number. (Guide prose is ref-free of `FAFF-NNN`/`ADR-NNN`, but a live external URL to GitHub's own pricing doc is allowed and appropriate.)

**Chosen: the wrapper is a real, copyable, `set -euo pipefail` bash script with a header that says it's a reference.** It uses the same auth/env pattern as `l3-watcher.yml` (a seat token from the environment, never committed), guards the disposition step against an unset run dir, and carries no dead self-hosted-only assumptions (it runs wherever `faff` + the harness + a passing cage are present). It is syntax-valid (`bash -n`) and, if `shellcheck` is available at build time, shellcheck-clean.

**Assumes:** the reference workflows and the rig doc (with the "Watching a run live" section) are on `main` (they are); the L4 resolve-resume-or-mint logic this references is `l4-watcher.yml`'s. This ticket adds a reference wrapper + doc; it stands up no live cron.

## 3. HOW — acceptance

- `operations/ci/faff-cron.sh` — a copyable `set -euo pipefail` wrapper: `faff container-check --gate` → L3 drain (`claude -p "/faff-beep-boop"` with a minted run dir) → `faff disposition --run-dir` (exit-propagating, unset-run-dir-guarded). Header states it is a reference; auth token from env, never committed.
- The wrapper is wrapped in `flock` (or documents the `flock -n` invocation) as the `concurrency:`-block equivalent; claim-before-admit named as the correctness backstop.
- A rig-doc section (`docs/guide/self-hosted-rig.md`) — "Without GitHub Actions: a cron on the machine" (or similar) — explaining the wrapper, the **cost rationale** (2026-03-01 self-hosted platform charge; public/GHES exempt; date-stamped + GitHub-pricing-doc URL), the **L4 delta** (points at `l4-watcher.yml` for resume-segmentation; names the persistent-workspace + sequential-slot requirements), and the **keep-vs-lose** notes (lose Actions UI → stream via stream-json; keep governance-check on PR-open).
- No live `.github/workflows/` job added; no product mandated beyond the example harness.
- `docs/guide/` prose ref-free (`faff lint-refs` passes); the wrapper passes `bash -n` (and `shellcheck` if available); `node --test` green.

### Scenarios

```
Given a solo operator on a private repo who wants to avoid the self-hosted Actions platform charge
When they read the section and copy operations/ci/faff-cron.sh into a systemd timer / crontab
Then they run a full L3 drain (gate → beep-boop → disposition) with no GitHub Actions workflow, and flock stops two firings overlapping.
```

```
Given an operator on the Actions-free path who wants the L4 resume-segmentation shape
When they read the L4-delta note
Then they are pointed at l4-watcher.yml's resolve-resume-or-mint + --check reconciliation logic (translatable to the same shell), with the persistent-workspace + sequential-slot requirements named.
```

## 4. DONE — definition of done

- [ ] `operations/ci/faff-cron.sh`: `set -euo pipefail` wrapper — gate first, L3 drain, disposition last (unset-run-dir-guarded); reference header; auth from env never committed.
- [ ] `flock` concurrency guard shown/explained as the `concurrency:`-block equivalent; claim-before-admit named as the correctness backstop.
- [ ] Rig-doc section: cost rationale (2026-03-01 charge; public/GHES exempt; date-stamped + GitHub-pricing-doc URL, not from memory); L4 delta (points at `l4-watcher.yml`; persistent-workspace + sequential-slot); keep-vs-lose (stream-json for live; governance-check on PR-open).
- [ ] No live `.github/workflows/` job; no product mandated beyond the example harness.
- [ ] `docs/guide/` ref-free (`faff lint-refs` passes); wrapper passes `bash -n` (+ shellcheck if available); `node --test` green.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
