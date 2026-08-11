# Unattended runs at L3

This page is for teams that have completed a supervised run and chosen a narrow
class of eligible work. Read [Adopt by change class](adopting-by-change-class.md)
and [Configuration](configuration.md) first. Continue with
[Why one run continued and another stopped](run-outcomes.md) for a paired real
run, then [Run unattended work on your own machine](self-hosted-rig.md) when the
run needs a persistent host.

`/faff-beep-boop` processes the eligible queue without scheduled human attention.
It parks ambiguity and records the outcome for later review.

## Before your first unattended run

The first time you run `/faff-beep-boop` on a fresh backlog, it can look like nothing happened: the run finishes and every ticket is still sitting there, listed under **On-hold**. That's not a bug and nothing is lost — it's the safety default doing its job. Nothing is automatable until *you* say so, ticket by ticket. This section is what to know before you leave the building.

### What makes work eligible: the crank-up gate

An **automation-eligible** ticket is one the *autonomous* pipeline (`/faff-beep-boop`) may auto-spec, auto-promote, and auto-build. (Your read and planning skills — `/faff-wtf`, `/faff-map`, `/faff-tidy` — are never gated by this; they always see everything.)

Eligibility ships **fail-safe `opt-in`**: nothing is eligible until a human explicitly opts a ticket in. A human steers the backlog with two tracker labels and one config knob:

| Signal | Effect |
|---|---|
| `faff-automate` label | **Crank up** — this ticket may be picked up by the autonomous pipeline. Removing it *cranks down*. |
| `faff-automation-hold` label | **Hard exclude** — never automate this ticket, even if it also carries `faff-automate`. |
| `automation_default` (`.faffrc.yaml`) | Decides an *unlabelled* ticket. Ships `opt-in` (unlabelled ⇒ not eligible); flip to `opt-out` to invert. |

Precedence is **hold > automate > default**. So on a fresh, `opt-in` backlog with no labels yet, *nothing* is eligible — which is why the first run skips everything.

**The labels are tracker-owned — you toggle them, not faff.** You add or remove `faff-automate` and `faff-automation-hold` in your tracker's UI. faff's own label CLI *refuses* to write either one in any direction; the most it will do is advise you which label to toggle. That refusal is deliberate: it makes `faff-automate` present ⟹ **a human set it directly**, true by construction. That by-construction human intent is exactly the provenance L3's trust rests on (see the trust premise below).

A not-eligible ticket is **On-hold, not parked** — the two are different:

- **On-hold** is a *pre-emptive human posture* (you haven't cranked it up). It surfaces in its own section in `/faff-wtf` and `/faff-tidy`, is never auto-picked-up, and never auto-clears — only you cranking it up changes it.
- **Parked** means automation *tried* and hit a blocker; `/faff-tidy` may auto-clear it when the blocker resolves.

Cranking a ticket up does **not** jump it to Todo — it simply rejoins normal eligibility, and prep/tidy consider it on the next pass. (The terse CLI view of the eligibility function is `faff eligible` in [the CLI reference](cli.md).)

### Per-level readiness checklist

Each level adds to the one below it. Before you run at a given level, make sure its row is satisfied:

| Level | Needs |
|---|---|
| **L1** · as the loop | `node`, `git`, and a tracker MCP (or [git-only mode](configuration.md)). That's the planning tooling — no build handoff. |
| **L2** · in the loop | everything above, **+** `gh` and a forge — `/faff-graft` opens PRs — against the same tracker. |
| **L3** · on the loop | everything above, **+** at least one ticket **cranked up** (`faff-automate`), or the run has nothing eligible to do; **+** `tmux`/`screen` if you launch over SSH (see [Running over SSH](#running-over-ssh)). |
| **L4** · out of the loop | everything above, **+** a host-isolated container (`faff container-check`), a spend/time **budget ceiling**, and a reachable **adversarial** `review` + `spec_review` — all assembled and enforced for you by `faff lights-out` (see [Going lights-out](#going-lights-out-l4--faff-lights-out)). |

### The trust premise: a single-owner, human-gated tracker

L3 and L4 lean on one assumption worth stating plainly before you hand a shared tracker to an unattended run: your tracker is **single-owner and human-gated** — write access is controlled by the same human who owns the repo.

Because the spec lives in that tracker, and the tracker is gated by the same human who gates a pull request, faff treats the spec as **trusted — exactly as trustworthy as a PR-reviewed artefact**. That trust is load-bearing: it's what lets a spec's *live-exercise* acceptance criterion (one that names a real command to run) direct **sandboxed, worktree-isolated execution** during a build. Everything else — ticket descriptions, the issue body, third-party comments — stays never-execute: it may describe *what* to build, but its text is never run as a command.

**Revisit trigger.** The moment your tracker stops being human-gated — it becomes **shared, multi-tenant, or externally-writable** — that carve-out lapses. The spec drops back to *untrusted* and the full no-execute floor reapplies to it, exactly as to any description or comment. If you're evaluating faff for a team tracker where anyone can file or edit a ticket, that's the line to weigh. (The authoritative rule is the gateway's "Untrusted input (no-execute floor)" in `plugin/skills/faff/SKILL.md`.)

## How the loop works

```
new idea / project → tickets → "what should I work on?" → prep it → build it
                                       ↑                                |
                                       └────────── reprep ←─────────────┘
```

`/faff-jot` is the front door — everything else acts on tickets that already exist, and jot (or `/faff-plot`, for a whole application) is how they come to exist. From there each step chains to the next behind a yes/no gate: say yes, keep moving; say no, stop. No ceremonies, no standups with 12 people — just you and your code.

## Fire and forget

`/faff-beep-boop` drives that loop end to end with no human gates:

- Default: the whole shebang — tidy, then prep every backlog issue, then build whatever's ready
- `ISSUE-12 ISSUE-15`: just those
- Cap the run with `--until 06:00` (stop at a wall-clock time) or `--max 5` (stop after N builds) — the queue drains in priority order and whatever's unreached is left for the next run

Auto-merges when every acceptance criterion is verified, CI is green, and review passed. Otherwise the PR is left open with a clear reason.

## What keeps it honest

The safety net isn't you staying awake — it's mechanical and always on:

- **Park protocol.** Anything the run can't confidently call is *parked*, never quietly binned. Parked work surfaces in `/faff-wtf` the next morning.
- **Run-ledger.** Every run writes a full audit trail under `.faff/runs/`. The ledger refuses to call a run "done" if it left admitted work dangling (`faff runcheck` audits this).

### Landing a non-graft change (a human merge)

Some legitimate changes never come through `/faff-graft`: a spike's findings, a documentation capture, a one-line fix found while doing something else. Those have no acceptance criteria and no review verdict, so `faff merge-gate` refuses them, and that refusal is correct. The autonomous lane never gets a way around the floor; non-graft landing is a human action.

The refusal now names the remedy beside the blockers, so you are not left inferring it. To land such a change yourself, leave an explainable record so a later `faff audit` accounts for the merge instead of tripping over it:

1. Declare the merge effect: `faff effects declare --run <run> --issue <issue> --step merge`.
2. Merge through the gate with a reason: `faff merge-gate … --human-override --interactive --override-reason "<what merged + why no floor applies>"`.

The declaration plus the reason are the record `faff audit` reconciles. A merge that skips the declaration, or an override with no reason, is flagged as an unexplained human-merge rather than passing silently. A bare `gh pr merge` is never the sanctioned path (it leaves no record for the audit to read).

## The tracker is the control plane

In an unattended run the tracker is the human-legible record, control plane, and observability surface that makes it safe to step back. Every issue's status, spec, park reason, and delivery outcome is reflected back into the tracker — so when you wake up, the morning view is the tracker plus the run-ledger, not a wall of logs. That's what makes L3 a place you can actually leave the building from.

## Headless / CI runs — the disposition exit contract

The park protocol and the tracker control plane above assume an **interactive next session**: you run `/faff-wtf` in the morning and read what parked. A **headless** run — CI job, cron line, a container that exits when the agent does — has no such session, and its run-ledger may live in an ephemeral filesystem that's gone once the container dies. Left there, a run whose issues *all parked* still reports **green by silence**: the durable park signals exist (each parked issue carries a `faff-parked` label + reason comment on the tracker, and the run still writes `summary.md`), but nothing gives the **host** a non-zero exit to gate on.

`faff disposition` is that exit contract. Run it as your wrapper's **final, exit-propagating step**, after the agent exits:

```sh
FAFF_RUN_DIR=$(faff lights-out | sed -n 's/^run dir: //p')   # or your own run-dir capture
FAFF_RUN_DIR="$FAFF_RUN_DIR" claude -p "/faff-beep-boop"       # the unattended drain
faff disposition --run-dir "$FAFF_RUN_DIR"                     # <-- final step; its exit is the run's exit
```

It reads that one run dir's end state and **exits non-zero when anything needs a human** — a parked / errored / `unreached-budget` issue, a PR left open for review, a run-level escalation (`budget-escalated`, `non-convergence`, `product-incomplete`, a Sentry abort), or an incomplete ledger (admitted work that never dispatched). An all-clean run — every issue `shipped` or `routed-out`, no escalation, a complete ledger — exits **0** and applies no label. It is a **pure reader**: no tracker, network, or writes; it adds no second copy of the park signal, only the process-exit verdict over the signals that already ship. Pass `--json` to capture the itemised `DispositionReport` (which issues, which cause) as a CI artifact; the exit code alone is enough for a red/green gate.

**Interactive runs are unchanged.** No interactive skill calls the verb; the default surfacing stays the run-ledger → `/faff-wtf` morning view. The disposition sink is purely the *headless override* — the command your CI/cron wrapper runs last so a needs-attention run turns the build red instead of passing quietly.

## An L3 watcher in CI

The headless contract above is what a scheduled CI watcher runs on. `operations/ci/l3-watcher.yml` is a **reference workflow** that puts it together end to end: a cron trigger wakes a self-hosted runner, an admission gate refuses a rig that isn't caged, `/faff-beep-boop` drains the automation-eligible queue at L3, and `faff disposition` propagates the exit. It is the configuration most solo adopters want — a watcher that chews through newly-cranked-up tickets with the **tracker as the control plane**.

It is a **reference under `operations/ci/`, not a live job** — its `runs-on:` names a self-hosted rig that has to exist first, and the repo's own convention is that a committed job whose label matches nothing is a small lie (see `.github/workflows/job-surface-probe.yml`). To run it for real, copy it into your repo's `.github/workflows/`, once you have:

- a registered self-hosted runner — the "your laptop is the factory" solo-dev rig ([self-hosted-rig.md](self-hosted-rig.md) is the runbook);
- a **subscription-seat secret** — a long-lived token in the environment, held as a repository secret, never a committed rc;
- an **admitted cage** — a run environment that passes `faff container-check --gate` (see below).

**The admission gate is the first step, and it fails the job before any agent starts.** `faff container-check --gate` exits non-zero unless the run is contained *and* no host engine socket is reachable. So a firing on a bare, uncaged host stops there — no ticket is claimed, no ledger is minted — rather than draining a queue unattended behind a warning nobody reads. **Any** cage that passes works: claude-box, a devcontainer, a Kubernetes runner pod, an Actions `container:` with the host socket dealt with. The rig the reference names is an example; the gate is the requirement.

**Segment-per-firing.** L3 has no run-level resume (`lights-out --resume` is L4-only), so each firing is its own short run: it drains what it can, its ledger closes, and the next firing re-queries the tracker. No committed work is lost — graft pushes each feature branch at build-complete, and claim-before-admit stops overlapping firings from double-draining. A build cut short before its branch is pushed just rebuilds next time. The one edge worth knowing: an issue cut short *at the review step* after its branch was pushed is left `In Progress` and is skipped as claimed-by-peer on the next firing until you pick it up in the morning park-review — nothing is lost, but it does not auto-resume.

**Giving an unattended L3 run the Sentry kill-switch.** By default L3's Sentry is **advisory** — it logs a derailment for the morning review but does not *kill* the run live, because L3 assumes a human on the loop. That assumption breaks for a watcher nobody is watching overnight. The Sentry abort kill-switch is keyed on **attendedness**, not the L4 mint: set `autonomous.unattended: true` in the **base `.faffrc.yaml`** to declare the run **unattended**, and its Sentry **aborts** on a trip exactly as L4 does — the kill-switch on the real axis rather than the full L4 mandate. Put it in the **base** file, not the `.faffrc.local.yaml` overlay: the abort-acting loci read governance config (`budget.*`/`sentry.*`) from the base only, so an overlay-only declaration would show in the `faff config resolved` banner yet never actually arm the kill-switch. It is fail-safe off: only a literal `true` arms it, and a typo or unset value leaves the **attended → advisory** default in force (a base-file value is echoed in the `faff config resolved` run banner so you can confirm it took). An **attended** L3 run (the default — you declare nothing) stays advisory, because the human at the keyboard is the kill-switch. The declaration covers both safe stops: **`abort`** (whole-run kill-switch) and **`pause`** (parks the one implicated issue — a `fix-review-thrash`/respec-treadmill build, `scope-drift`, or a member-scoped stall — and keeps draining the rest of the queue, FAFF-766). The finer `surface`/`correct` interventions stay L4-only, so an unattended L3 run gains both live safety stops without the adversarial steering. This is what the **self-directed faff-on-faff watcher** most wants: that watcher *cannot* be L4 (L4 refuses a self-directed run), so before this it could never get a kill-switch however unattended it ran. *(The earlier `autonomous.sentry_acting: true` knob is a still-honoured back-compat **alias** — either key asserts unattended; new configs should prefer `autonomous.unattended`.)*

For an **outward product repo** the L4 sibling (`faff lights-out`, cron-resumed) is the shape to reach for instead — see the next section.

### A cage that passes the gate

The admission gate is easy to state and easy to get wrong, so here is a cage that actually passes, and the trap that catches most first attempts.

**What passing looks like.** A cage that passes is *contained* and reaches *no host engine socket*. Run `faff container-check --gate` inside it and you get:

```
$ faff container-check --gate
pass

$ faff container-check --gate --json
{"verdict":"pass","contained":true,"basis":"dockerenv","host_socket":{"present":false,"path":null},"criteria":{"contained":true,"no_host_socket":true}}
```

That reading is from this repo's own dev container — an interactive cage, not a live CI job — a contained cage (a container, so `/.dockerenv` is present) that never mounts the host docker socket. It stands in for the CI cage by construction: what the gate checks is the same wherever it runs, and a live self-hosted reading is the runner-rig doc's to take. **claude-box** is the same shape and the concrete example an adopter can reach for: it reads contained and its entrypoint refuses to mount the host socket, so it passes by construction. It is an *example*, not a requirement — the gate is the requirement. Any of these pass equally: claude-box or another cage the job runs inside, a Kubernetes/ARC runner pod (contained via the Kubernetes service-host marker), a devcontainer, a sysbox runtime, or an Actions `container:` job **on a runner host that exposes no docker socket**. Swap one for another and nothing about the requirement changes.

**The socket trap — the naive `container:` job.** The obvious move on Actions is to add a job `container:` and assume that is your cage. It is not, on the usual runner. When the runner host has a docker socket, the runner bind-mounts `/var/run/docker.sock` into every Linux job container (this is `actions/runner`'s `ContainerInfo.cs`) — so the job reads *contained-with-a-host-socket*, which is a full escape and the gate refuses it. The tempting fix does not work either: an `rm -f /var/run/docker.sock` step *inside the job* runs after the runner has already established the mount, and inside the container that path is a live bind mount `rm` cannot unmount. What actually clears it is dealing with the socket at the **runner-host level** — no host docker daemon, or a rootless-only one, so there is nothing to bind-mount (the `env-rootless` job in `.github/workflows/validate.yml` is exactly that posture). So: a job `container:` is admissible only once its *host* exposes no socket; that is a property of the runner host, not something you can fix from inside the workflow.

**`faff env` without a host socket.** If a job needs a container engine — `faff env` runs `docker compose up` to stand the app tier up — it gets a **bounded nested engine** (rootless dind, podman-in-podman, or a sysbox-class runtime), which is the contract the cage-engine acceptance doc (`docs/reference/cage-engine-acceptance.md`) already sets for claude-box. That does not trip the gate: the socket probe checks only the canonical host paths and deliberately ignores rootless paths, so a bounded rootless engine is invisible to it. The host socket is a dead end here by design — the lights-out preflight refuses it at L4 regardless of containment. Reach for the nested engine, never the host socket.

**Where the cage stops and the runner host begins.** Passing the gate means *contained + no host socket* — that is what the cage owns. It does **not** by itself bound everything the job can touch: a self-hosted runner maps its whole work directory into the job, and within the job's life the agent holds the runner's registration token and credentials. Narrowing what the runner's own account can reach is a property of how you *register and scope the runner host*, which belongs to the self-hosted-runner rig doc ([self-hosted-rig.md](self-hosted-rig.md)), not to the cage. Keep the two separate in your head: the cage makes the run contained; the runner-host setup bounds the runner's own credential surface.

## Going lights-out (L4) — `faff lights-out`

L3 keeps you *on* the loop: you walk away, but you're the one who reviews the morning's parks. **L4 is *out* of the loop** — correctness is held up by adversarial machinery (a second model trying to break the change, a code-blind holdout marking the work against a spec it never saw) rather than by you reading anything in the morning. `faff lights-out` is the single entry point that turns L3 into L4: it composes the shipped L4 guardrails into **one enforced launch** instead of a hand-assembly of `/faff-beep-boop` flags a forgotten one of which would silently degrade the run.

**Run it inside the cage, not on a bare host.** The blast radius is the **container's** job, not faff's — the runner *detects and refuses* a bare host and never weakens the host or self-grants `--dangerously-skip-permissions`. Launch the unattended run inside a host-isolated container (claude-box is one option). `faff lights-out` calls `faff container-check`, and on the lights-out path a non-contained result is a hard **block** (on L1–L3 the same check only warns).

**The evaluator hard cage (the code-blind holdout's trust anchor).** At L4 the holdout verdict is the fourth merge-floor condition, and its `code_blind: true` is *meant* to be a **physical fact**, not the judged party's word. **Today it is an attestation, not a physical fact:** the live holdout evaluator is dispatched *inline*, sharing the run's working directory, so it *can* read the repo — `code_blind: true` holds only while the evaluator complies, the same attested-not-enforced footing as an ordinary review verdict. The cage that would make blindness physical is **built but not yet wired into the live holdout dispatch**: `evaluator-preflight.js` ships the assert-in primitive but deliberately does not call it from the dispatch yet. A later slice makes codebase-reading physically impossible (the preflight refuses unless the repo directory is unreadable), and a separate acceptance run first exercises the wired cage in anger. Here is how that cage is *designed* to work, once wired: the run declares an **evaluator cage promise** — a `lane-boundary.json` in the run dir stating `lane: evaluator, container: own, accesses.repo: absent`; when that promise is present, `faff-graft`/`faff-beep-boop` dispatch the evaluator through the **`evaluate-call.mjs` spawner** (a fresh OS-level process handed **only** the spec + the env endpoint, never a repo path), which runs `faff evaluator-preflight` in-cage and stamps a `spawner_attested` attestation into the verdict, and `faff merge-gate` refuses any self-attested (non-spawner) verdict at the chokepoint. Two operational decisions fix how the cage is stood up (the isolation-ladder ADR leaves them to the first consumer):

- **Who establishes the boundary — faff *asserts* it, never creates it (v1).** faff only ever *reads back* an outer-layer, launch-time declaration; it never stands the boundary up itself (assert, don't implement). **Today that boundary cannot be truthfully declared:** there is no cage-side read-only integrity mount yet, so the corrective-integrity probe stays `asserted:false` by design — an **honest REFUSE / distrust-by-default**, not a bug, and the corrective channel stays dormant. Nothing an operator does per run "arms" it today: declaring `FAFF_INTEGRITY_BOUNDARY` with no matching mount would be exactly the false attestation the fail-safe forbids (which is why the L4 preflight *degrades* an absent declaration to an advisory rather than demanding one — the `armed` map below records that as a degraded, not absent, guardrail). When the read-only mount does ship, two postures will compose the value: (a) an **automating cage** (claude-box, once its cage-side read-only mount ships) mounts the integrity dirs read-only and re-exports what it mounted automatically; (b) a **hand-operator** composes the value with **`faff integrity-boundary`** (`FAFF_INTEGRITY_BOUNDARY="$(faff integrity-boundary)"`) instead of hand-writing dir names — faff owns the content, so a future dir-set change is a faff-only change. Because faff only ever *reads* pid-1 back, the automating-cage swap needs no faff code change when the cage delivers the pid-1 channel unchanged. **Caveat:** every claude-box *engine-mode* cage currently passes `--init`, whose root-owned `docker-init` pid-1 environ faff cannot read (an honest declaration there trips `env-injection`) — the pid-1 channel decision for engine cages is a separate open call; this emitter is channel-agnostic and unaffected either way.
- **How the evaluation request crosses the cage — a shared, integrity-gated volume.** The evaluation-request artifact (out) and the verdict (in) cross on a shared `.faff/` volume; the inbound verdict's trust is gated by the run-dir integrity mechanism before it is consumed.

**What it does, in order:**

1. **Basic preflight (fail-closed).** It refuses to start unless: the host is `contained`; the `review` and `spec_review` slots are reachable (a configured-but-down slot counts as **absent** — the second-opinion gate must never silently skip); a **budget ceiling** is set (`--until HH:MM` / `--max N`, or `budget:` in `.faffrc.yaml`) — a malformed `--until`/`budget.until` (not valid `HH:MM`) is never a vacuous ceiling that silently never breaches: it refuses on its own, naming the raw value, regardless of any other ceiling set (and alongside the plain no-ceiling refusal when it's the only one configured); every one of the **8 shipped guardrail contracts** passes a reachability probe; and the floor assertions hold. The floor is a **checked/static split** (labelled per entry on the banner): `worktree_isolation` is genuinely checked — the resolved worktree root must be strictly **outside** the repo working tree and creatable (a writable nearest-existing ancestor), probed side-effect-free — while `no_execute` and `autonomous_contract` are **static** invariants of the shipped code that no runtime probe can re-verify. Point `FAFF_WORKTREE_ROOT` (or `worktree_root` in `.faffrc.yaml`) at an **absolute** path outside your checkout; a value that resolves inside the repo (including the default when `HOME` is unset) now refuses. Any ambiguity, absence, or error **refuses** — it never fails open.
2. **Mint + banner.** On a clean preflight it mints a strict-defaults **L4 run-ledger** under `.faff/runs/` carrying an `armed` map of each guardrail's `live`/`degraded`/`absent` state, and **persists a banner** derivable one-to-one from that map. The banner is your trust contract: a glance tells a fully-armed L4 run from a degraded one without re-deriving any config.
3. **Hand off.** It prints the minted run dir; launch the drain with that run armed — `FAFF_RUN_DIR=<run-dir> /faff-beep-boop`. From there the guardrails fire at their boundaries: admissibility filters the queue, the budget + terminating predicates end the run, Sentry watches for derailment with kill-switch authority, and the code-blind holdout verdict gates the merge.

**Satisfying L4 dial-coherence without touching the committed base.** `gates.fallback` now defaults to `fail-closed`, so `dial-coherence:gates-fallback` passes out of the box with no explicit config — a fresh install clears it for free. If `--check` refuses on `dial-coherence:adversarial-spec-review` (the one L4-required dial still operator-set), set it in a gitignored **`.faffrc.local.yaml`** — an operator-local overlay that is deep-merged over the committed `.faffrc.yaml`, with the overlay's scalar values winning — rather than editing the shared committed base:

```yaml
# .faffrc.local.yaml  (gitignored; overlays .faffrc.yaml)
slots:
  spec_review: faffter-dark-spec-review
```

The dial-coherence probe reads the merged (base ⊕ overlay) config, so the overlay value satisfies the gate. Each refusal's message names its own fix (`— fix <key> in .faffrc.local.yaml (set: <value>)`); if a repo has explicitly set `gates.fallback: advisory`, that override still refuses `dial-coherence:gates-fallback` and needs the same overlay treatment (`fallback: fail-closed`).

Use `faff lights-out --check` to dry-run the preflight (it mints nothing) — handy for confirming the cage and the slots are wired before you actually leave.

### An L4 watcher on an outward repo

The L3 watcher above chews faff's own queue on the loop. Its L4 sibling, `operations/ci/l4-watcher.yml`, is the out-of-the-loop version for an **outward product repo**: a cron firing mints (or resumes) an L4 run, drains a segment under a budget cap, and the next firing continues the *same run* until it is done — correctness held up by adversarial review and the code-blind holdout, not by your morning read.

It targets an **outward** repo, never faff itself: L4 refuses a self-directed run (building faff with faff), so the reference points `tracking.repo` / `tracking.container` at your product. Like the L3 reference it lives under `operations/ci/`, not `.github/workflows/` — copy it into the product repo once the rig exists.

Two things are worth understanding before you run it:

- **Segmentation is by escalation, not by a graceful exit.** `faff lights-out --resume <run-id>` re-enters a run only if it stopped in a re-enterable state (escalated, or a timed-out `dead-running`). A *clean* exit marks the run done, and resume declines it — so a segment boundary is a deliberate **budget/window escalation** (a per-segment `--until` / `--max`). If you rely instead on the job's hard time-cap, the cron interval must be longer than the runner's heartbeat-stale window (~15 min), or the next firing sees a still-live run and declines to resume.
- **The mandate is fixed at mint.** The PRD/target decision (what the run is for) is made once, when the run is minted; a resume trusts it. So editing the PRD between firings does not silently re-scope work already in flight — the change is picked up by the next *fresh* run, not mid-run.

The workflow's final step tells a mid-run segment boundary (exit green — more to come) apart from a finished-or-stuck run (handed to `faff disposition`, which turns a genuinely stuck run red). It needs a **persistent single-runner workspace** (the run's ledger lives under `.faff/runs/` between firings), a **sequential** dispatch slot, and the same adversarial `spec_review` overlay the section above describes. The auth matrix is in the workflow's own comments: a solo self-hosted seat, or a team hosted runner with an API key — never a pooled seat.

## Running over SSH

If you run `claude` over a plain SSH session — laptop on the sofa, server in the cupboard — the `claude` process is a *child of that SSH connection*. Close the lid, switch networks, or drop Wi-Fi for a moment and the connection dies, taking the run with it. `/faff-beep-boop` is built for exactly the away-from-keyboard case (overnight, fire-and-forget), so it's exactly where a dropped link bites.

The fix lives at the **`claude`-launch level**, not inside faff — a skill can't detach a process it's already running inside. Launch `claude` inside a terminal multiplexer so the session keeps running on the host after you disconnect, then reattach when you're back.

**tmux (recommended).**

```sh
tmux new -s faff      # start a named session on the host
claude                # launch claude inside it, then drive /faff-beep-boop as normal
```

- Detach (leaves it running): `Ctrl-b` then `d`.
- Reattach later: `tmux attach -t faff`.

**screen (fallback)** if `tmux` isn't available:

```sh
screen -S faff        # start a named session
claude                # launch claude inside it
```

- Detach: `Ctrl-a` then `d`. Reattach: `screen -r faff`.

**mosh + tmux (roaming or flaky links).** `mosh` survives IP changes and sleep/wake but doesn't itself keep a session alive if the server-side process dies; `tmux` survives the disconnect. Use both — `mosh` for the link, `tmux` for the session:

```sh
mosh user@host -- tmux new -A -s faff   # -A attaches to "faff" if it exists, else creates it
```

faff can't do any of this for you: by the time a skill is running it's already attached to your connection, so keeping the run alive is a launch-time choice — there's no faff flag for it.
