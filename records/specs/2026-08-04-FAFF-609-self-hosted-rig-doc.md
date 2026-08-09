# Spec — FAFF-609: "your laptop is the factory" — the self-hosted-runner rig doc

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-609.

## 1. WHY — problem and principle

The two reference workflows are on `main` (`operations/ci/l3-watcher.yml`, `operations/ci/l4-watcher.yml`) but neither can run: both name a self-hosted runner that does not exist, under a subscription seat that nobody has wired. This ticket is the rig doc that closes that gap — the runbook a solo developer follows to stand up a self-hosted runner on their own machine that is simultaneously (a) the **subscription-legitimate substrate** (local/self-hosted headless under Claude Max `claude -p` and ChatGPT `codex exec` is sanctioned product usage on both vendors) and (b) the **CI auth solution** (the seat's login lives on the machine, so no API key is needed). It turns both references from documentation into a live factory.

It also owns the **runner-host security posture** — the half containment does not cover. Containing the job bounds what the *agent* can reach; it says nothing about the runner process hosting it, which on this rig lives on the developer's own machine. This doc states a position on the runner's registration token, its service account, the invoking user's home, and the work directory — written against what the FAFF-654 measurements show a job can actually read, not ahead of them.

## 2. WHAT — design (the load-bearing decisions)

**Chosen: the primary rig is the developer's own machine; a disposable microVM is a documented alternative.** "Your laptop is the factory" is the solo-dev model: one machine, one self-hosted runner, the seat already logged in. The doc leads with that. It also documents the disposable-microVM alternative that the self-hosted measurement work already stood up and ran (a fly.io Machine from `ubuntu:24.04` + the Actions runner + a container engine), carrying its hard-won operational gotchas rather than making the reader rediscover them. The caveat stated is the measured one — **a disposable microVM is not admissible on the strength of being disposable**: the admission check sees no container markers on a bare microVM (cgroups at `/`, no `/.dockerenv` — the measurement showed it reads identical to a bare shell), so a microVM needs a passing cage exactly as a laptop does. The doc is substrate-honest: the laptop is the default, the microVM an equally-valid alternative, and the cage-that-passes-the-check — not the substrate — decides admission.

**Chosen: auth is a subscription seat with zero API keys on the solo path; hosted-CI subscription auth stays flagged gray.** The seat's login lives on the machine (the `/login` credential file, or a long-lived token in the environment — the CI path), consumed by the harness; faff never implements login. The doc states plainly: **solo self-hosted + subscription seat = zero API-key secrets** (the acceptance bar) — grounded in the subscription-seat ADR, which sanctions headless seat use per provider, and the never-commit-secrets rule (secrets from the environment, never a committed rc). Separately, as the rig doc's own operational posture (not an ADR carve-out), it flags **hosted-CI** subscription auth as gray: a Claude OAuth token is supported-but-monitor, Codex account-auth is advanced/brittle, and API keys remain the hosted-runner path — so the clean, sanctioned zero-key story is the *self-hosted* seat, and a hosted runner is the metered-API-key "team" variant. The seat-handle config field that names the token source is a separate wiring ticket; the doc references the env-var path that works today.

**Chosen: never pool seats — one seat per runner, per operator.** A subscription seat is a single human's entitlement; the doc states the rule explicitly and its reason (pooling a seat across runners/operators is neither sanctioned nor safe), so an adopter scaling past one runner reaches for more seats or the API-key path, never a shared credential.

**Chosen: the runner install is scoped to one repo, non-root, self-update disabled, on a persistent workspace.** The runbook: register the runner against a single target repo (or a scratch repo to rehearse) with a repo-scoped registration token; run it as a **dedicated non-root user**; disable the runner's in-place self-update (a forced update breaks the pinned binary); and keep its workspace **persistent and non-cleaned on one runner** — the latter is not optional for L4, because `lights-out --resume` reads the run ledger under `.faff/runs/` between firings and that state is not git-tracked. These are the operational facts the self-hosted measurement work established the hard way; the doc records them as a recipe, not a warning.

**Chosen: the runner-host posture states a position on all four items — what to do, and what containment makes moot.** Written against the FAFF-654 readings (the self-hosted runner ran as non-root uid 1001, home at `/home/runner`, a single-repo `_work` holding only its own checkout):

- **Registration token** — repo-scoped, rotated, never committed; anyone holding it can register or deregister runners on that repo. Containment does *not* touch this — it is a host-setup responsibility. Do it.
- **Service account** — run the runner as a dedicated non-root user with a minimal home and no broader machine access than it needs. Containment bounds the *job/agent*, not the *runner process*, so narrowing the runner's own account is still worth doing and is **this doc's** concern (settling the overlap the worked-cage ticket flagged: the cage owns containment, the rig doc owns the runner's credential surface).
- **Invoking user's home** — an *uncaged* job can read the runner user's home; a passing cage bounds what the *job* sees of it, but the runner process still has it, so use a dedicated minimal runner home regardless. State both halves: the cage handles the job's view; the dedicated user handles the process's.
- **The work directory** — the runner maps its whole `_work` into the job. On a **single-repo** runner that holds only its own checkout (no neighbour-checkout risk — measured). On a **shared, long-lived** runner it does not, and the neighbour risk is real; the doc says keep it single-tenant, or accept the shared risk knowingly. Containment does not bound `_work` reach (that is why "work scoped to this checkout" is not an admission criterion) — the host setup does, by staying single-tenant.

No item is left as an open worry with no stated position — that is the posture-acceptance bar.

**Chosen: pair the rig with the window-budget governor so night runs park at a ceiling, not run unbounded.** The doc pairs the rig with a `budget.window` (the 5-hour window governor) so an overnight L4 run parks at the window ceiling (`parked-window`) rather than draining without limit, and notes how that composes with the L4 watcher's per-segment `--max` cap and the disposition exit contract (a `parked-window` run exits non-zero and surfaces). It references the unattended guide's budget section rather than restating the mechanics.

**Chosen: the deliverable is one new guide under `docs/guide/`, driving both reference workflows.** A new `docs/guide/self-hosted-rig.md` (linked from the unattended guide), written so that following it from a clean machine yields a runner that executes the L4 reference workflow (`operations/ci/l4-watcher.yml`) — and the L3 one — under a subscription seat with zero API-key secrets. The runner runs the job inside a cage that passes the admission check; the doc references the worked-cage section rather than re-deriving containment. Guide prose stays ref-free (no ticket/ADR numbers — ADRs and siblings are named by description, workflows by path), per the enforced `docs/guide/` lint.

**Assumes:** both reference workflows and the worked-cage section are on `main` (they are); the passing cage is the worked-cage doc's to supply; the seat-handle config field is a separate wiring ticket. On what is proven vs generalised: the **runner-substrate** steps — install, dedicated non-root user (uid 1001), `HOME=/home/runner`, self-update disabled, single-repo `_work` — were actually run on the disposable-microVM rig the self-hosted measurement work stood up, so those steps are proven; the **end-to-end** claim (that rig executing the L4 watcher under a subscription seat with zero API keys) is assembled from proven-in-kind pieces, **not** run as a whole on the rig. The doc says which is which, and stands up no live runner in CI as part of this ticket — it is the runbook an operator follows, and the acceptance is a prose walkthrough of proven-in-kind steps, not a live end-to-end demonstration.

## 3. HOW — acceptance

- A new `docs/guide/self-hosted-rig.md` — "your laptop is the factory" — linked from the unattended guide.
- **Following it from a clean machine yields a runner that executes the L4 reference workflow under a subscription seat with zero API-key secrets** (the headline acceptance). The L3 reference runs on the same rig.
- **Auth:** subscription seat, seat login on the machine, secrets from the environment never committed; solo = zero API keys; hosted-CI subscription auth documented as gray (OAuth-token supported-but-monitor; Codex account-auth advanced/brittle; API keys the hosted path); **never pool seats** stated.
- **Runner install:** repo-scoped registration, dedicated non-root user, self-update disabled, persistent non-cleaned single-runner workspace (required for L4 `--resume`).
- **Runner-host posture:** a stated position on each of the four items (registration token, service account, invoking user's home, `_work`) — what to do *and* what containment makes moot. No item left as an open worry. The service-account-narrowing overlap with the worked-cage ticket is settled here (the rig doc owns the runner's credential surface; the cage owns containment).
- **Window-budget pairing:** a `budget.window` so night runs park at ceiling, composing with the L4 watcher's `--max` and the disposition exit contract.
- The doc is substrate-honest (laptop primary, microVM a documented alternative with the containment caveat); no product mandated as the only path.
- `docs/guide/` prose ref-free (`faff lint-refs` passes); `node --test` green (no code change).

### Scenarios

```
Given a clean developer machine and a subscription seat already logged in
When the operator follows self-hosted-rig.md from scratch
Then they end with a self-hosted runner, scoped to one repo, running as a non-root user, that executes operations/ci/l4-watcher.yml under the seat with zero API-key secrets configured.
```

```
Given a reader worried about what a job can reach on their own machine
When they read the runner-host posture section
Then each of the four items (registration token, service account, home, _work) has a stated position — what to do and what the cage already handles — with none left as an open worry.
```

```
Given an overnight L4 run on the rig
When it reaches the 5-hour window ceiling
Then it parks (parked-window) rather than running unbounded, and the disposition exit surfaces it — because the doc paired the rig with budget.window.
```

## 4. DONE — definition of done

- [ ] `docs/guide/self-hosted-rig.md` created, linked from the unattended guide.
- [ ] Headline acceptance walked as prose (proven-in-kind steps, not a live end-to-end run): a clean machine → a runner that executes the L4 reference workflow under a subscription seat with zero API-key secrets (L3 on the same rig); the runner-substrate steps are flagged as the ones actually proven on the microVM rig.
- [ ] Auth: subscription seat (login on the machine, env secrets never committed); solo zero-API-keys; hosted-CI subscription auth documented gray; never-pool-seats stated.
- [ ] Runner install: repo-scoped registration, dedicated non-root user, self-update disabled, persistent non-cleaned single-runner workspace (L4 `--resume` requirement).
- [ ] Runner-host posture: a stated position on all four items (token / service account / home / `_work`), each with what-to-do + what-containment-handles; service-account-narrowing overlap settled here; no item left as an open worry.
- [ ] Window-budget pairing (`budget.window` → night runs park at ceiling), composing with `--max` + disposition.
- [ ] Substrate-honest (laptop primary; microVM a documented alternative, with the measured caveat that a disposable microVM is not admissible on disposability — it shows no container markers and needs a passing cage exactly as a laptop does); no product mandated.
- [ ] `docs/guide/` prose ref-free (`faff lint-refs` passes); `node --test` green.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
