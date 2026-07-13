# Unattended runs (L3)

`/faff-beep-boop` runs the whole pipeline without a human in the loop — the *on the loop* level. Good for overnight, meetings, or anything you want off your plate. This page is the deep-dive on how it stays safe to walk away from.

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

## The tracker is the control plane

In an unattended run the tracker is the human-legible record, control plane, and observability surface that makes it safe to step back. Every issue's status, spec, park reason, and delivery outcome is reflected back into the tracker — so when you wake up, the morning view is the tracker plus the run-ledger, not a wall of logs. That's what makes L3 a place you can actually leave the building from.

## Going lights-out (L4) — `faff lights-out`

L3 keeps you *on* the loop: you walk away, but you're the one who reviews the morning's parks. **L4 is *out* of the loop** — correctness is held up by adversarial machinery (a second model trying to break the change, a code-blind holdout marking the work against a spec it never saw) rather than by you reading anything in the morning. `faff lights-out` is the single entry point that turns L3 into L4: it composes the shipped L4 guardrails into **one enforced launch** instead of a hand-assembly of `/faff-beep-boop` flags a forgotten one of which would silently degrade the run.

**Run it inside the cage, not on a bare host.** The blast radius is the **container's** job, not faff's — the runner *detects and refuses* a bare host and never weakens the host or self-grants `--dangerously-skip-permissions`. Launch the unattended run inside a host-isolated container (claude-box is one option; the containerisation ADR in `docs/adr/` settles this boundary). `faff lights-out` calls `faff container-check`, and on the lights-out path a non-contained result is a hard **block** (on L1–L3 the same check only warns).

**What it does, in order:**

1. **Basic preflight (fail-closed).** It refuses to start unless: the host is `contained`; the `review` and `spec_review` slots are reachable (a configured-but-down slot counts as **absent** — the second-opinion gate must never silently skip); a **budget ceiling** is set (`--until HH:MM` / `--max N`, or `budget:` in `.faffrc.yaml`) — a malformed `--until`/`budget.until` (not valid `HH:MM`) is never a vacuous ceiling that silently never breaches: it refuses on its own, naming the raw value, regardless of any other ceiling set (and alongside the plain no-ceiling refusal when it's the only one configured); every one of the **8 shipped guardrail contracts** passes a reachability probe; and the floor assertions hold. The floor is a **checked/static split** (labelled per entry on the banner): `worktree_isolation` is genuinely checked — the resolved worktree root must be strictly **outside** the repo working tree and creatable (a writable nearest-existing ancestor), probed side-effect-free — while `no_execute` and `autonomous_contract` are **static** invariants of the shipped code that no runtime probe can re-verify. Point `FAFF_WORKTREE_ROOT` (or `worktree_root` in `.faffrc.yaml`) at an **absolute** path outside your checkout; a value that resolves inside the repo (including the default when `HOME` is unset) now refuses. Any ambiguity, absence, or error **refuses** — it never fails open.
2. **Mint + banner.** On a clean preflight it mints a strict-defaults **L4 run-ledger** under `.faff/runs/` carrying an `armed` map of each guardrail's `live`/`degraded`/`absent` state, and **persists a banner** derivable one-to-one from that map. The banner is your trust contract: a glance tells a fully-armed L4 run from a degraded one without re-deriving any config.
3. **Hand off.** It prints the minted run dir; launch the drain with that run armed — `FAFF_RUN_DIR=<run-dir> /faff-beep-boop`. From there the guardrails fire at their boundaries: admissibility filters the queue, the budget + terminating predicates end the run, Sentry watches for derailment with kill-switch authority, and the code-blind holdout verdict gates the merge.

Use `faff lights-out --check` to dry-run the preflight (it mints nothing) — handy for confirming the cage and the slots are wired before you actually leave.

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
