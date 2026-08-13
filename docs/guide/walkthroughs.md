# Your first runs

This page is for new adopters taking a supervised path through the product.
Read the [guide overview](intro.md) first and keep [Configuration](configuration.md)
nearby. The examples cover starting from nothing and building one existing
ticket. Continue with [Adopt by change class](adopting-by-change-class.md) before
making work eligible for an unattended run.

The output is illustrative; your run will use its own issue identifiers.

## Starting from nothing: idea → tickets

No backlog yet — an empty repo or a fresh idea. `/faff-jot` is the front door; it turns a loose starting point into well-formed tickets the rest of the loop can pick up.

**1. Point faff at your tracker** — the three-line `.faffrc.yaml` from [Configuration](configuration.md).

**2. `/faff-jot` — describe what you want.** It runs a short discovery conversation, then shapes tickets (it asks before creating anything):

```
You: a CLI that lints our YAML configs and prints fixable diffs

jot: A few questions… (which formats? fix-in-place or report-only? CI mode?)
     → Shaped 3 tickets under a new "yaml-lint" workstream:
       SHF-1  parse + validate a config file        (first slice)
       SHF-2  render a fixable diff                  (blocked-by SHF-1)
       SHF-3  --fix to apply diffs in place          (blocked-by SHF-2)
     Create these 3 tickets? (yes / edit / no)
```

`y` → they're created in your tracker (tagged `faff-jot-intake`, which records that they came in the front door). Then jot chains straight into interactive prep: *"Prep the first one for build now? (y/n)"* — say yes and you're into the build loop below. (Unattended pickup by `/faff-beep-boop` is a separate opt-in — you crank a ticket up first; see [Before your first unattended run](unattended.md#before-your-first-unattended-run).)

**Bigger than a feature?** If you describe a whole application, jot spots the scale and offers the top-down route instead:

```
jot: This looks application-scale — decompose into a full roadmap
     (initiatives → projects → first-slice epics) via /faff-plot first? (y/n)

y → /faff-plot  recurses it level by level, confirming each:
     Initiative: Billing  →  Projects: Invoicing, Dunning, Reporting
       Invoicing  →  first-slice epics: SHF-10 issue model, SHF-11 PDF render …
     (stops at first-slice epics — the leaves grow later from specs)
     Audit the roadmap via /faff-map? · Prep the first slice via /faff-prep? (y/n)
```

To steer how ambitious an initiative or project should be, add `target: thin-mvp` or `target: finished` on its own line in the container's tracker description. The key is case-insensitive, the first occurrence wins, and any other value is treated as unset. A project with no explicit target inherits its initiative's target; without either, the methodology default is `finished`.

Either way you end up with tickets in Todo and a chain into prep. From here it's the same loop as below.

## A first run, start to finish

What the loop looks like once you have tickets — whether jot just made them or you already had a backlog.

**1. Point faff at your tracker** — the three-line `.faffrc.yaml` from [Configuration](configuration.md).

**2. `/faff-wtf` — "what should I work on?"**

```
Recently completed
  SHF-31  rate-limit middleware shipped → unblocked SHF-40

Today's focus
  1. SHF-40  cache the token lookup   — now unblocked by SHF-31, gates SHF-41 → SHF-42
  2. SHF-12  fix the timezone bug     — quick, isolated

Parked work: none
```

**3. `/faff-prep SHF-40` — turn it into a spec.** Prep explores the codebase, delegates the spec to the producer, and attaches it to the ticket:

```
Explored src/auth/ and src/cache.ts.
Spec attached to SHF-40 (confidence: high — every decision marked, ACs testable).
Moved SHF-40 to Todo.
Start building now via /faff-graft? (y/n)
```

**4. `y` → `/faff-graft SHF-40` — build it.** Graft sets up a worktree, commits the spec, and gets out of your way; you pair with it from there:

```
Worktree ready at ~/.faff/worktrees/faff/SHF-40. Spec committed as the first commit.
Building to the spec — 3 ACs, tests alongside.
```

When it's done it verifies the ACs, runs review, waits for CI, and (interactively) asks before merging.

**5. `/faff-beep-boop` — or let it run the lot unattended.** Same loop, no babysitting: it grooms, specs, and builds the ready queue, parking anything ambiguous for `/faff-wtf` to show you in the morning. See [Unattended runs](unattended.md).

Each step offers to chain into the next — `wtf → prep → graft` — so on a good day you just keep saying yes.
