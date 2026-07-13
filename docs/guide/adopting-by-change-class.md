# Adopting by change-class

The obvious question when you meet the levels is *"which level are we at?"* — as if a team picks a rung on the L1→L4 ladder and stands on it. That's the wrong question, and it undersells what faff already does.

A level isn't a property of your **team**. It's a property of a **piece of work**. faff decides autonomy one ticket at a time, so on a single board, on a single night, some tickets build themselves unattended while the ones next to them wait for you — *at the same time*. The right question is **"which change-classes have I cranked up?"**

This page is the adoption pattern that follows from that: not "flip the whole team to L3", but **risk-tiered delegation** — hand off the low-risk, well-tested change-classes first, keep the scary ones by hand, and widen the circle as your confidence earns it.

## The unit of adoption is the ticket, not the team

A **change-class** is just a category of change that shares a risk profile — a mental grouping, not a faff object:

| Lower risk | Higher risk |
|---|---|
| dependency bumps | schema / migration changes |
| docs and comments | auth and permissions |
| test backfill | public API surface |
| config guarded by CI | anything with a blast radius you can't easily revert |

Real teams don't trust all of these equally, and they shouldn't have to. The sane posture is: **let the machine merge the boring, well-covered classes; keep human eyes on the dangerous ones** — and run both postures on the same backlog simultaneously. faff expresses that directly, because eligibility is per-ticket.

## Start opt-in: nothing runs unless you say so

The default posture is **fail-safe opt-in**. Nothing is automatable until a human explicitly cranks it up, so a forgotten ticket means *"left alone"* — never *"picked up."* You opt work in; you never have to remember to opt it out.

The switch is a single label a human sets in the tracker:

- **`faff-automate`** on a ticket — "this one may be picked up by the autonomous pipeline."
- **`faff-automation-hold`** on a ticket — "never automate this, full stop" (a hard exclude that wins even over `faff-automate`).
- An unlabelled ticket falls to the project default `automation_default` in `.faffrc.yaml`, which **ships `opt-in`** (unlabelled ⇒ left alone).

These labels are tracker-owned: a human toggles them in the tracker UI, and faff will only ever *advise* a crank — it never flips them for you. So a ticket carrying `faff-automate` means, by construction, that a person chose to hand it over.

## Crank up by risk, not by level

Adoption is a **motion**, not a setting. You widen the automated surface class-by-class as calibration data accumulates:

1. **Start with nothing eligible.** Opt-in is already this — you begin with the whole board human-run.
2. **Crank up one narrow, low-risk change-class.** Dependency bumps, say — small, well-tested, cheap to revert. Label those tickets `faff-automate` and let the unattended run take them overnight.
3. **Watch how it goes.** The run-ledger and the tracker record every outcome; you read them in the morning like any other L3 run.
4. **Widen when the evidence says so.** Confident after dep bumps? Add docs. Then test backfill. Then config-guarded-by-CI. Each new class is a deliberate, reversible step — you're growing trust one category at a time, not flipping a global switch.
5. **Leave the scary classes hand-driven for as long as you like.** Schema and auth changes can stay L1 indefinitely while deps and docs run L3 every night. That coexistence is the whole point.

The **level describes how a given class is run — not what the team is.** L1 and L3 legitimately live on the same board on the same night; eligibility decides which tickets go which way.

## The three levers that make it work

This is not a promise about a feature faff might build. It's a description of three pieces that already ship and already compose:

- **Per-ticket eligibility (`faff-automate`)** is the *selector* — the lever that makes a level a property of a workload. It's what lets one ticket run unattended while its neighbour waits for you. This, not appetite, is the per-workload control.
- **The `appetite` dial** is the project-wide *risk-rope* — `appetite: low | medium | high | full` in `.faffrc.yaml`, tuning how much the pipeline does without checking back. It's a single global dial (there are no per-issue overrides), so it sets the house risk tolerance across every eligible ticket at once. Start it low while your eligible set is small and boring; raise it as the classes you've cranked up prove safe.
- **The routing-verdict gate** is the *confidence filter*. Even among cranked-up tickets, the pipeline admits only work it can confidently build — anything ambiguous, under-specified, or blocked is parked for a human rather than force-built. Cranking a class up doesn't disable judgement; it just makes the class *eligible* for judgement to say yes.

Between them: eligibility chooses *what's in play*, appetite sets *how much rope* it gets, and the verdict gate holds back *what it can't confidently call*. No new label, path-pattern matcher, or config key is needed to adopt by change-class — the machinery is already the per-ticket kind.

## What faff batches today (and what it doesn't)

When you're deciding what to crank up next, the methodology can propose **crank-up-sets** — but be clear on what those are. Today a crank-up-set batches not-yet-eligible work by **dependency chain**: a root ticket plus its ordered slice-members, offered as one approvable unit so you crank up a coherent chain rather than a lone ticket that immediately blocks on its unbuilt prerequisites.

That batching is **by chain, not by change-class.** faff does *not* group crank-ups by "all the dependency bumps" or "everything touching `auth/`" today. The change-class *unit of adoption* is expressed the plain way: **which tickets a human labels `faff-automate`**, one ticket or one chain at a time.

A change-class *lens* on crank-up-sets — batching by label or by path-pattern so you could crank up "all low-risk config changes" in one gesture — is a plausible future refinement, but it is **not current behaviour** and this pattern doesn't need it. Per-ticket labelling already expresses everything on this page.

## Putting it together

- Autonomy is adopted **per change-class**, not per team — you hand off the classes you trust and keep the rest.
- The unit is the **ticket**: `faff-automate` is the per-workload selector, so L1 and L3 coexist on one board the same night.
- It's a **motion**: start opt-in (nothing eligible), crank up narrow low-risk classes first, widen as calibration data accrues.
- It runs on **shipped mechanism** — per-ticket eligibility, the global `appetite` dial, and the routing-verdict gate — with **no new machinery** required.

For the mechanics of an unattended run itself, see [Unattended runs](unattended.md); for the `appetite` dial and other settings, see [Configuration](configuration.md).
