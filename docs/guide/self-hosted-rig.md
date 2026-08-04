# Your laptop is the factory — the self-hosted-runner rig

The two reference workflows under `docs/ci/` (`l3-watcher.yml`, `l4-watcher.yml`) both need a self-hosted runner to run on. This is the runbook for standing one up. The model is deliberately small: **one machine, one runner, the seat already logged in.** Your own laptop or desktop is the factory — it is simultaneously the substrate the run executes on and the thing that holds the subscription seat, so no API key is involved on the solo path.

This page owns the runner-*host* half of the safety story. The cage (see [unattended.md → "A cage that passes the gate"](unattended.md#a-cage-that-passes-the-gate)) bounds what the *agent* inside a job can reach; nothing about the cage bounds the runner *process* that hosts the job, and on this rig that process lives on your own machine. The [runner-host posture](#runner-host-posture) section below states what to do about that.

## Auth: a subscription seat, and no API keys

The solo path is a **subscription seat with zero API-key secrets**. Local and self-hosted headless use of a subscription is sanctioned product usage on both vendors — Claude Max via `claude -p`, ChatGPT Plus/Pro via `codex exec` — so the seat you already pay for is the credential. The seat's login lives on the machine: either the `/login` credential file the harness writes, or a long-lived token in the environment (the CI path). faff consumes whichever the machine provides; it never implements login itself, and it never needs an API key on this path.

Two rules make that safe:

- **Secrets come from the environment, never a committed file.** A token belongs in the runner's environment or your OS keychain, never in the repository, a workflow file, or an rc checked into git.
- **Never pool a seat across people.** A subscription seat is *one human's* entitlement — sharing one person's seat with other operators (or reselling its capacity) is neither sanctioned nor safe. That rule is about *people*, not repos: it is fine for your own seat to drive several of your own runners or repos, and you do **not** need a separate seat per repo. The only limit there is the seat's own concurrency and rate, not a one-seat-per-runner rule. (If a *team* needs many concurrent lanes, that is the metered API-key path, not seat-sharing.)

**Hosted CI is a greyer story, and this rig avoids it.** On a *hosted* runner (GitHub-hosted), subscription auth is not the clean path: a Claude OAuth token works but is worth monitoring, Codex account-auth is advanced and brittle, and the supported hosted route is a metered **API key** (the "team" column in `l4-watcher.yml`). So the clean, zero-key story is exactly the self-hosted seat this page describes; reach for the hosted-runner + API-key variant only when a team genuinely needs it.

## Stand up the runner

The steps below get you a runner registered to one repository, running as its own user, that survives between scheduled firings. They are the recipe the self-hosted measurement work established — the runner substrate here is what was actually stood up and run; only the full seat-driven end-to-end is assembled from those proven pieces rather than run as one.

1. **Pick the target repository.** Register the runner against the single repo whose queue it will drain — for the L4 watcher, your outward product repo; to rehearse, a throwaway scratch repo. Never register a runner against a repo whose posture the run is meant to protect.
2. **Create a dedicated non-root user** for the runner (e.g. a `runner` account). Do not run it as your login user or as root — the runner process gets whatever that account can reach (see the posture section).
3. **Download the runner package** the repo's *Settings → Actions → Runners → New self-hosted runner* page names — it gives you the current version and the registration token. Do not hardcode an old version.
4. **Register with self-update disabled.** As the runner user:
   ```sh
   ./config.sh --url https://github.com/<you>/<repo> --token <REG_TOKEN> --unattended --disableupdate
   ```
   `--disableupdate` matters: a forced in-place self-update breaks the pinned binary and leaves the runner in a restart loop. Pin the version, update it deliberately.
5. **Keep the workspace persistent.** Run the runner as a long-lived service on one machine, with its work directory **not** wiped between jobs. This is not optional for the L4 watcher: `faff lights-out --resume` reads the run ledger under `.faff/runs/` between firings, and that state is not tracked in git — a cleaned workspace loses it and the next firing mints a fresh run instead of continuing.
6. **Run the job inside a cage that passes the admission check.** The runner itself is not the boundary. The workflow's first step is `faff container-check --gate`, and the job must execute inside a cage that passes it — contained, with no host engine socket reachable. See [unattended.md → "A cage that passes the gate"](unattended.md#a-cage-that-passes-the-gate) for a worked example (and the socket trap that catches the naive `container:` job); this page does not repeat it.

With that in place, the runner picks up whichever reference workflow you copied into the repo's `.github/workflows/` — `l3-watcher.yml` for an on-the-loop watcher of your own repo, `l4-watcher.yml` for an out-of-the-loop factory on an outward product repo.

## Runner-host posture

Containing the job answers "what can the agent reach?". It says nothing about the runner *process*, which on this rig is a program running on your own machine under an account you control. Here is a stated position on each part of that — what to do, and what the cage already makes moot.

- **The registration token.** Anyone holding it can register or deregister runners on that repository. Keep it repo-scoped, rotate it, and never commit it. The cage does not touch this — it is entirely a host-setup responsibility, so do it.
- **The account the runner runs as.** The runner process has whatever its user can reach on the machine. The cage bounds the *job/agent*, not this process — so narrowing the runner's own account (a dedicated non-root user, a minimal home, no broader access than it needs) is still worth doing, and it is this rig's job, not the cage's. (The cage owns containment; this doc owns the runner's credential surface.)
- **The invoking user's home directory.** An *uncaged* job can read the runner user's home. A passing cage bounds what the *job* sees of it — but the runner process still has it — so give the runner a dedicated, minimal home regardless. Both halves matter: the cage handles the job's view, the dedicated user handles the process's.
- **The work directory.** The runner maps its whole work directory into the job, not one repository's checkout. On a **single-repo** runner that directory holds only its own checkout, so there is no neighbour-checkout to leak — this was measured, and it is why keeping the runner single-tenant is the recommendation. On a **shared, long-lived** runner it holds every repo's checkout, and the neighbour risk is real; the cage does not bound it (which is exactly why "work scoped to this checkout" is not one of the admission criteria) — the host setup does, by staying single-tenant. So keeping one runner to one repo is a **security** choice about this `_work` neighbour risk — separate from the seat question above: one seat can legitimately drive several repos, but a runner that *shares its work directory* across them takes on the neighbour risk. Keep one runner to one repo, or accept that shared risk knowingly.

None of these is left as an open worry: for each, either you narrow it here, or the cage handles it, and the split is stated.

## Pair it with a window budget for overnight runs

An overnight run should stop at a ceiling, not drain until it runs out of something. Pair the rig with a `budget.window` (the 5-hour window governor): a night run that reaches the window ceiling **parks** rather than running unbounded, and the park surfaces — the disposition step the reference workflows end on exits non-zero on a parked-window run, so a stopped-at-ceiling night turns the job amber in the morning rather than passing silently. This composes with the L4 watcher's per-segment build cap: the cap bounds each firing, the window bounds the whole night. The mechanics live in [unattended.md](unattended.md); here it is enough to know to set the window.

## Watching a run live

The rig gives you two ways to know what a run is doing, and they are complementary. The **durable** view is the record you read afterwards — the run-ledger, the events log, and `faff disposition`'s exit code and `--json` report; that is what a morning review reads, and it is what turns a needs-attention night red. The **live** view is watching the run as it happens — the "check it from your phone while you're out" case — and that is a **harness** capability, not a faff one: `claude -p` streams the run turn-by-turn with `--output-format stream-json --verbose`, and faff runs *inside* the harness, so whatever the harness emits is what you stream. (Swap `claude -p` for your own harness — a Codex run streams its own way; faff adds nothing here beyond running inside it.)

Where you watch depends on the trigger:

- **On GitHub Actions**, the Actions UI already tails the drain step's output live — there is nothing extra to wire, and the step log is captured durably too.
- **On the Actions-free path** (a bare Machine on a timer, no Actions UI) you expose the stream yourself: add the streaming flags to the drain and tee the output somewhere you can reach — a file the machine serves, a socket, or a small viewer. That self-exposed stream is ephemeral (it is gone once you close it), so treat it as the live view only — the ledger and the `faff disposition` exit remain the record of what actually happened.

Concretely, the drain step's harness call gains the streaming flags:

```sh
claude -p "/faff-beep-boop" --output-format stream-json --verbose | your-viewer-or-tee
```

Reach for it when you want eyes on a run in flight; reach for `faff disposition` and the ledger when you want to know, durably, how it ended.

## The disposable-microVM alternative

Your laptop is the primary rig, but a disposable Linux microVM works too, and the self-hosted measurement work stood one up end to end — a small cloud Machine from an `ubuntu:24.04` base plus the Actions runner and a container engine. The operational gotchas it hit, so you do not have to:

- Launch the runner as a **standalone Machine**, not through a deploy pipeline whose release-health wait will recreate a slow-booting runner in a restart loop.
- Register with `--disableupdate` and bake a current runner version (same reason as above).
- Run the runner as a **non-root user with its own home** (drop the login-user's environment when you `sudo` to it, or the checkout hits permission errors on the wrong home).
- If you use a `container:` shape on a microVM, the container engine needs the **vfs storage driver** — a microVM has no kernel overlay for the nested mount. (On a laptop with a normal kernel, the default driver is fine.)
- Register against a **scratch repo**, never a repo whose posture you are protecting.

One caveat the measurements made concrete: **a disposable microVM is not admissible just for being disposable.** The admission check sees no container markers on a bare microVM — cgroups at the root, no container marker file — so it reads identical to a bare shell. A microVM needs a cage that passes the check exactly as a laptop does; disposability is not a substitute for containment. The cage-that-passes-the-check, not the substrate, is what admission turns on.
