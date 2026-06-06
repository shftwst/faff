---
name: faff
description: "Gateway — routes to the right faff sub-skill. Use /faff-jot to start something new (kick off a project or capture a feature/bug/idea into tickets), /faff-plot to decompose an application-scale idea top-down into a roadmap (initiatives → projects → first-slice epics), /faff-wtf to figure out what to focus on, /faff-map for the strategic roadmap view above /faff-wtf, /faff-tidy to groom the backlog (finds problems and promotes ready issues), /faff-prep to turn a ticket into a spec, /faff-graft to start building, /faff-beep-boop to run the whole suite unattended."
---

# Faff

## What faff is

*Faff* (n.): the tedious palaver around the actual engineering. Writing the tickets, the specs, the test plans, the review write-ups, working out what's even worth doing. The stuff you know you *should* do properly and never get around to. faff does it for you, and then keeps going: stage by stage it takes the faff out of the delivery loop until, if you fancy, the whole thing runs without you. You keep the fun part (thinking about the problem and the architecture) and hand off the part where you'd actually, you know, *write the code*. Because, well, who codes any more anyway?!

Under the hood it's a **harness**: a set of Claude Code skills wrapping the delivery loop (issue → spec → build → review → ship) in fixed contracts and gates. It won't make the model a better engineer. It makes it **safe to stop watching**, one step at a time.

The **levels** aren't a faff feature. They're *how far you've wandered off from the loop*. One question sorts them: **who's running it, and what's keeping it from spontaneous robot combustion while your back's turned?**

| Level | You're | Loop run by | What keeps it honest | Entry point |
|---|---|---|---|---|
| **L1 · as** the loop | the engineer | **you** | well… you | `/faff-wtf`, `/faff-map`, `/faff-tidy`, `/faff-jot`, `/faff-plot`, `/faff-prep` |
| **L2 · in** the loop | a step inside it | the agent | your nod at every gate | `/faff-graft` |
| **L3 · on** the loop | watching from the sofa | the agent | park protocol + run-ledger | `/faff-beep-boop` |
| **L4 · out** of the loop | off down the pub | the agent | adversarial review + isolated holdout | lights-out (frontier) |

- **L1 · as the loop.** *You* write the code, your usual IDE agents along for the ride. faff plays planning exoskeleton here: it tells you what's worth building, hands you a spec worth building from, then gets out of the way.
- **L2 · in the loop.** `/faff-graft` drives the build for one issue but stops at every gate (spec, build, review, PR) for your say-so. Nothing ships behind your back.
- **L3 · on the loop.** `/faff-beep-boop` chews through the ready queue unattended and **parks** anything it can't call. The safety net isn't you staying awake, it's mechanical: the park protocol never quietly bins a loose end, and the run-ledger refuses to call a run "done" if it left admitted work dangling.
- **L4 · out of the loop.** Lights-out. You've left the building entirely, and correctness is held up by *adversarial* machinery: a second model trying to break the change, isolated holdout worktrees marking the work against a spec it never got to peek at. The frontier. Not built yet, mind.

Two knobs cut across all four levels. They're not levels themselves:

- **Slots** decide *what* runs at each stage (a beefier spec, a harsher reviewer, a parallel build). Swap them to customise *any* level, or bring your own — they tune what a level does, not which level you're at (that's which command you reach for).
- **Appetite** (for Destruction) sets *how much rope* the pipeline gets before checking back. More isn't always better: it buys speed against the odd "oops, wrong call, revert that."

## Governing principles

Four tenets steer every design call in faff. Each is a tension — *X, not Y* — and the named mechanism is where it already lives, not an aspiration. When a spec or build needs a tie-breaker, reach for these.

- **Deterministic tools over prose.** Mechanical and contractual work belongs in testable, reproducible tools; the LLM is reserved for discovery, judgement, and insight — not for executing a contract run-to-run. Rule of thumb: same input must always give the same output ⇒ a tool; needs taste or understanding ⇒ the LLM. *Embodied by:* the `faff` CLI (`config` / `runcheck` / `validate-adapters`, see **Configuration**).
- **Configurable, not opinionated.** Every behaviour is a swappable slot over a fixed contract — faff ships sensible defaults you can override, not opinions you must accept. *Embodied by:* the slots / adaptor model, `.faffrc`, and the appetite dial (see **Configuration** and **Core contracts and adaptor slots**).
- **Adoptable, not all-encompassing.** faff integrates rather than owns — it works with your tracker (any MCP), your agents, and git-only mode, and you adopt as much of the L1→L4 ladder as you want. *Embodied by:* the levels table above, git-only mode, tracker autodetect, and slot delegation to third-party skills.
- **Understandable, not unapproachable.** Output and behaviour are skimmable and low-cognitive-load, so the human can always follow what faff did and why — and trust it. *Embodied by:* the `rendering_adaptor` / synthesis gloss (see **Core contracts and adaptor slots**) and the human-readable `.faff/` logs.

## Routing

This is the gateway. Invoke the right sub-skill:

| Command | Triggers |
|---------|----------|
| `/faff-jot` | "New project", "kick off", "start something", "I've got an idea", "new feature", "add a feature", "file a bug", "capture this", "scope a new thing", "spitball"; or `/faff-jot ISSUE-XX` to shape/gate an **existing** ticket — freeze/thaw its automation hold (see `/faff-jot` → Existing-ticket interactor) |
| `/faff-plot` | "Plan this out", "decompose this app", "break this big thing into a roadmap", "map out the whole project", "plot the build", "turn this idea into initiatives and projects" |
| `/faff-wtf` | "Where to focus", "What should I work on?", "what's happening", "catch me up", "where are we", "where we at", "the 411", "lowdown" |
| `/faff-map` | "Roadmap", "where are we going", "explain the backlog", "do these join up", "workstream view", "strategy view", "what are the chains", "big picture", "walk me through the plan" |
| `/faff-tidy` | "Tidy the backlog", "clean up", "groom", "mess" |
| `/faff-prep ISSUE-XX` | "Prep this", "spec this out", "what does this ticket need?", "scope", "acceptance criteria" |
| `/faff-graft ISSUE-XX` | "Work on", "Start this", "take on", "pick up", "let's build", "fire up" |
| `/faff-beep-boop` | "Run overnight", "fire and forget", "chew through the backlog", "unattended" |

## Configuration (shared across all sub-skills)

All faff sub-skills read their configuration from a **`.faffrc.yaml`** file at the repo root, **resolved via the `faff config` CLI — never by hand-reading the file** (see **Resolver** below and the **CLI-only config access** rule). `.faffrc.yaml` is the **single accepted filename**: a legacy **`.faffrc`** or **`.faffrc.yml`** present at the root triggers a **loud error** naming the fix (rename it to `.faffrc.yaml`), **never a silent default** — silently dropping a present config (by eyeballing the wrong filename) is the exact failure FAFF-50 closed. Any key the file doesn't set falls back to faff's built-in default; a missing `.faffrc.yaml` altogether means all defaults apply. (Template files are exempt: any name containing `.example` is never counted or loaded.)

`CLAUDE.md` is **no longer a faff config source.** It remains the consuming project's own documentation — sub-skills may still read it for soft *context* (current-workstream priority, naming/grouping conventions) but never for configuration values.

**Resolver.** The bundled `faff` CLI — a single dependency-free Node script run directly via its shebang — performs config file resolution and parsing mechanically under its `config` subcommand, so sub-skills don't hand-parse YAML:

- `faff config path` — print the resolved config file (exit 3 if none; `.example` files are never loaded).
- `faff config get <dotted.key> [-d DEFAULT]` — print a scalar value (e.g. `faff config get tracking.team_key`); prints DEFAULT / empty and exits 3 when absent.
- `faff config spec-docs-path [--create]` — print the spec-docs directory with the default rule already applied; `--create` makes it.
- `faff config resolved` — echo the resolved **non-default** config (config-file path, `appetite`, and every slot the file sets), for a run banner so a dropped/overridden slot is **visible**, not silent.

**Resolving the `faff` executable (canonical — sub-skills reference this).** Invoke it as bare **`faff`** — the link/install step symlinks it to `~/.local/bin/faff`, so it's on `PATH` for most setups. When `faff` isn't on `PATH` (e.g. a marketplace plugin that didn't symlink it), resolve the bundled binary — **don't hardcode `~/.claude/skills/faff/bin/faff`**, which is only the dev-linked location (a plugin lives under `${CLAUDE_PLUGIN_ROOT}` instead):

```bash
faff=$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")
[ -x "$faff" ] || faff=$(find ~/.claude -path '*/skills/faff/bin/faff' -type f 2>/dev/null | head -1)
```

then call `"$faff" config …`. The same CLI hosts `faff runcheck` (the beep-boop ledger audit) and `faff validate-adapters` (the slot-skill conformance lint) — one Node entrypoint for all bundled helpers; requires only `node`, no dependencies.

It parses the documented YAML subset with a built-in parser — no dependencies.

**CLI-only config access (load-bearing).** Every config read — slots, `appetite`, `tracking.*`, the spec-docs path — goes through `faff config`. **No sub-skill, and no agent acting for one, reads the rc file by hand** — no shell-reading it, no `Read` tool on it, no eyeballing the raw bytes. Reading by hand is what silently dropped configured slots **twice**: an agent shell-read a bare-named rc file, found nothing (the real one is `.faffrc.yaml`), and fell through to defaults. The resolver handles every accepted name and errors loudly on a legacy one, so the CLI is the only correct path. Enforced mechanically: `faff validate-adapters` **fails** any skill `SKILL.md` that shell-reads the rc file directly (it runs in the FAFF-48 CI gate). Softer values the agent only reasons with (e.g. `appetite`) are read the same way — `faff config get appetite` — not eyeballed.

Full schema (every key optional unless noted; shown with example values):

```yaml
# .faffrc.yaml — faff configuration, repo root
tracking:
  tracker: linear            # linear | github | jira | … (autodetected from available MCP if omitted)
  team_key: SHF              # tracker team/board key
  project_id: "abc-123"      # tracker project/team id
  repo: shftwst/faff         # org/repo slug
  git_host: github           # github | gitlab | gitea | … (autodetected if omitted)
  spec_docs_path: docs/specs/                                   # where faff-graft commits specs (see Spec docs location)

slots:             # optional delegation slots; each has a faff default when unset
  intake: superpowers:brainstorming                  # used by faff-jot for new-work discovery
  spec: gstack:autoplan                              # spec producer used by faff-prep (default faffter-noon-spec)
  concurrency: faffter-dark-concurrency-parallel     # build-pass executor for faff-beep-boop (default faffter-noon-concurrency-sequential)
  review: gstack:review                              # pre-PR review inside faff-graft
  ship: gstack:land-and-deploy                       # delivery producer inside faff-graft (default faffter-noon-ship)
  ship_adaptor: faffidavit-ship                      # adaptor: maps the ship producer's native result onto shipped/not-ready/failed

# mode: delivery-lead is DEPRECATED — use slots.methodology instead

concurrency_max: 4           # max concurrent builds for faffter-dark-concurrency-parallel (ignored by the sequential default)
worktree_root: ~/.faff/worktrees/myrepo   # where /faff-graft creates worktrees; default ~/.faff/worktrees/<repo> (see Worktree policy)
```

**Stable config only — never mutable state.** `.faffrc` holds stable identifiers and preferences (project ids, team keys, repo slugs, slot choices). It must never carry milestone lists, target dates, progress percentages, issue snapshots, or "current cycle" notes — anything that can change in the tracker is fetched live on every invocation. If a sub-skill needs mutable data, it refetches from the tracker via the configured MCP.

Faff auto-detects which issue tracker and git host MCP servers are available and adapts accordingly — `tracking.tracker` / `tracking.git_host` only pin the choice when autodetection is ambiguous. It works with Linear, GitHub Issues, Jira, or any tracker exposed via MCP. If no tracker MCP is available, it falls back to git-only mode (commits, branches, PRs).

### Spec docs location

When `/faff-graft` starts a build it commits the spec into the repo so it ships in the same PR as the code (see **Spec discovery** below and the faff-prep / faff-graft artifact lifecycle). The in-repo directory is configurable via the `tracking.spec_docs_path` key in `.faffrc`:

```yaml
tracking:
  spec_docs_path: docs/specs/
```

- **Default when unset:** a `specs/` directory inside the repo's docs folder, resolved at use time:
  1. If `docs/` exists at the repo root → `docs/specs/`.
  2. Else if `doc/` exists at the repo root → `doc/specs/`.
  3. Else → create `docs/` and use `docs/specs/`.
  
  If both `docs/` and `doc/` exist, prefer `docs/`. Create the `specs/` subdirectory if it's missing.
- The value is a directory **relative to the repo root**. A trailing slash is optional.
- The filename within it is unchanged: `YYYY-MM-DD-<issue-id>-<slug>-design.md`.
- This only relocates the spec **within the same repo** — the spec still lands on the feature branch and ships with the PR. It is not a pointer to a separate repository.

Every faff sub-skill that reads or writes the committed spec resolves the directory from this key, falling back to the default-resolution rule above when it's absent. The `faff config spec-docs-path [--create]` resolver applies this exact rule — sub-skills call it rather than re-deriving the path. References below to a default of `docs/specs/` are shorthand for that rule (i.e. `doc/specs/` when only `doc/` exists). Spec discovery globs `<spec-docs-path>/*-<issue-id>-*.md`.

### Slots (optional delegation)

Faff delegates specialised work to configured skills. Slots live under the `slots:` key in `.faffrc`. All slots are optional — each has a sensible faff default when unset.

```yaml
slots:
  intake: superpowers:brainstorming                  # used by faff-jot for new-work discovery, optional
  spec: gstack:autoplan                              # spec producer used by faff-prep, optional (default faffter-noon-spec)
  concurrency: faffter-dark-concurrency-parallel     # build-pass executor for faff-beep-boop, optional (default faffter-noon-concurrency-sequential)
  review: gstack:review                              # pre-PR review inside faff-graft, optional
  methodology: faffter-dark-methodology-agile-delivery             # diagnostic lens over backlog state, optional
  spec_adaptor: faffidavit-spec              # adaptor: markers + style + confidence line; maps a producer's spec onto the fixed closed/open/external + confidence contract
  review_adaptor: faffidavit-review          # adaptor: output envelope; maps a reviewer's output onto the fixed pass/fail/needs-human contract
  routing_adaptor: faffidavit-routing        # adaptor: verdict assignment + display; the six-verdict vocabulary + admission rule are fixed in the gateway
  rendering_adaptor: faffidavit-rendering        # pure adaptor (no internal contract): rendering + synthesis + output normaliser
  ship: gstack:land-and-deploy                       # delivery producer inside faff-graft, optional (default faffter-noon-ship)
  ship_adaptor: faffidavit-ship              # adaptor: result envelope; maps a ship producer's native delivery result onto the fixed shipped/not-ready/failed contract
```

Each slot has a built-in default when unset. The default skill owns its own behaviour contract — see that skill's `SKILL.md`. A missing slot is **never** a park reason.

| Slot | Default when unset | Purpose |
|---|---|---|
| `intake` | `faffter-noon-intake` | Runs new-work discovery for `/faff-jot` and emits a discovery brief. A producer doing-skill. |
| `spec` | `faffter-noon-spec` | Produces the spec (lite nlspec arc). A producer doing-skill. |
| `concurrency` | `faffter-noon-concurrency-sequential` | Build-pass executor for faff-beep-boop — consumes the conflict-analysis partition and drives `/faff-graft` per issue. The default runs the queue **sequentially**; swap to `faffter-dark-concurrency-parallel` for capped, worktree-isolated concurrency with rebase-before-merge. A mechanism slot (no paired adaptor). |
| `review` | `faffter-noon-review` | Pre-PR review inside faff-graft. Emits the `review_adaptor` verdict. |
| `methodology` | `faffter-noon-methodology-structural` | A diagnostic lens over backlog/build state. Sub-skills request named outputs from it. |
| `spec_adaptor` | `faffidavit-spec` | Adaptor over the fixed spec-readiness contract: the markers + writing style + confidence line that map a producer's spec onto closed/open/external + confidence; validates specs on demand. |
| `review_adaptor` | `faffidavit-review` | Adaptor over the fixed review-verdict contract (`pass` / `fail` / `needs-human`, semantics, revert test — all in the gateway): the output envelope reviewers emit and faff-graft branches on; validates/normalises review output on demand. |
| `routing_adaptor` | `faffidavit-routing` | Adaptor over the fixed automation-routing contract (six verdicts + admission rule + root-cause taxonomy — all in the gateway): verdict assignment + computation locus + display format; assigns and validates verdicts. |
| `rendering_adaptor` | `faffidavit-rendering` | Pure adaptor (no internal contract — rendering is human-facing only): visual vs prose, canonical visual forms, table-vs-list rule, density caps, issue-gloss humanisation; normalises output on demand. |
| `ship` | `faffter-noon-ship` | Delivery **producer** inside faff-graft Step 10 — runs deploy-readiness, merges/deploys, cleans up what it created, emitting a native delivery result. The default discharges it with a no-op readiness check + vanilla `gh pr merge`; swap to a deploy-capable producer (e.g. `gstack:land-and-deploy`) for real release mechanics. Its native result is mapped by `ship_adaptor`. |
| `ship_adaptor` | `faffidavit-ship` | Adaptor over the fixed delivery-outcome contract (`shipped` / `not-ready` / `failed`, two-tier gate, coercion rule — all in the gateway): the result envelope and the mapping of the `ship` producer's native delivery result onto the three outcomes faff-graft routes on; validates/normalises on demand. |

`review` and `ship` are **not** user-invokable slash commands. They are internal phases of faff-graft, with optional delegation via these slots.

## Agent Lanes

Faff operates across three segregated executor lanes. These are not personas — they are structurally isolated contexts with controlled visibility, ensuring separation of concerns and preventing the build agent from marking its own homework.

### Orchestrator (outermost lane)

**Visibility:** Issue tracker, project documentation, human dialogue, codebase (read-oriented).
**Not concerned with:** Implementation detail, code-level decisions.

Two functions:
1. **External interface** — controls inputs and outputs between the project and the outside world: issue tracking, direct dialogue with the human, project-level reporting, stakeholder communication.
2. **Pipeline sequencing** — owns the high-level delivery pipeline. Decides what runs when, sequences prep → build → review → ship, manages parks and escalations.

Faff-* skills (wtf, map, tidy, beep-boop) operate primarily in this lane. They read the codebase for context but their job is orchestration, not implementation.

### Implementor (innermost lane)

**Visibility:** Codebase (full read/write), spec, architectural context, test suite.
**Not concerned with:** Tracker state, project-level sequencing, stakeholder communication.

The most active lane. Where development happens:
- Architectural planning and technical decision-making
- Spec interpretation and implementation
- Code, tests, and documentation changes
- Fix→review iteration loops

Faff-graft's build phase operates in this lane. The implementor sees the spec and builds to it — it doesn't manage the backlog or decide what to work on next.

### Evaluator (external lane)

**Visibility:** Documentation, specification, stood-up environment (runtime access). **No codebase access.**
**Not concerned with:** How the code works. Only whether the delivered artefact satisfies the spec from a business-value perspective.

Quality control from the outside:
- Can the feature be exercised in the running environment?
- Does the behaviour match what the spec promised?
- Are acceptance criteria met from a user's perspective (not a code perspective)?
- Does the delivered value match the problem statement in WHY?

This lane is intentionally blind to implementation — it evaluates outcomes, not code. A passing evaluator signal means the feature works as specified regardless of how it's built.

### Lane isolation

The lanes have **controlled visibility by design**, not by accident:

| Lane | Codebase | Tracker | Spec | Environment | Human dialogue |
|---|---|---|---|---|---|
| Orchestrator | Read (context) | Full | Read | No | Yes |
| Implementor | Full read/write | No | Read | Local dev | No (via orchestrator) |
| Evaluator | **No** | No | Read | Runtime access | No (via orchestrator) |

This isolation prevents:
- The implementor gaming its own review (it can't see evaluator feedback until the orchestrator routes it)
- The evaluator being biased by implementation approach (it can't see the code)
- The orchestrator making implementation decisions (it sequences, doesn't build)

Not all lanes are active in every flow. The evaluator lane is a future capability — documenting it here sets the architectural intent.

**Discovered work crosses lanes by record-and-file, never by the implementor writing the tracker.** When the implementor (faff-graft) finds concrete, separable out-of-scope work while building or reviewing, it **records** it (returns `discovered_scope` + writes a per-issue file) — it does **not** create the ticket. The orchestrator (faff-beep-boop autonomously, or the human via faff-graft's interactive gate) **files** it as a Backlog ticket. This is bottom-up source (b) — execution-discovered work — the tributary that lets the backlog self-extend from *doing*, not only from declaration. Its filing is appetite-gated (see **Appetite for destruction** → Execution-discovered auto-create).

## Shared Rules

These rules apply to every faff sub-skill. Sub-skills point at this section rather than re-stating.

### Ignore cancelled and archived

Every faff sub-skill excludes the following from every query, recommendation, count, and output:

- Cancelled issues (and any issue in the tracker's cancellation state category — see **What counts as cancelled** below)
- Archived issues
- Issues whose parent project is cancelled or archived
- Cancelled or archived projects themselves

**What counts as cancelled.** The literal "Cancelled" state name isn't the only one — trackers group multiple sibling states under a cancellation category, and all of them are treated as cancelled for faff's purposes. Detection is **category-driven first, name-based fallback**:

- **Linear** — any workflow state in the `cancelled` state category. By default this includes `Cancelled`, `Duplicate`, and any team-defined custom states placed in that category. Read the state-category field returned by the Linear MCP (state objects expose a `type` or `stateCategory` of `cancelled`); fall back to a name-based match against `Cancelled`, `Duplicate`, `Won't Fix` if category metadata is unavailable.
- **GitHub Issues** — closed issues with `state_reason = not_planned` (this covers closed-as-not-planned, including closed-as-duplicate).
- **Jira** — issues resolved with a cancellation-category resolution (`Won't Do`, `Duplicate`, `Cannot Reproduce`, or team-defined equivalents in the same category).
- **Other trackers** — fall back to a name-based match against `Cancelled`, `Duplicate`, `Won't Fix`, `Won't Do`, `Cannot Reproduce`. If the tracker exposes state categories, prefer the category-driven check.

This widened definition fixes a real failure: a tidy run that suggests cancelling tickets already in Linear's Duplicate state is recommending a no-op at best, and a status-signage downgrade at worst (Duplicate → Cancelled preserves the `duplicate-of` relation but loses the self-documenting status text).

No exceptions. Cancelled/archived items (across every state above) are invisible to faff — they are never surfaced in catch-ups, never flagged in tidy, never picked up by graft, never counted in beep-boop queues.

### Automation hold

A human may **hold** a ticket out of the *autonomous* pipeline — keep it from being auto-specced, auto-promoted, or auto-built — while leaving it fully visible. This is for work captured but not yet validated ("on paper, way off building"), or work a human wants to keep as their own territory. The hold is **the human's steering input on the backlog**, set on the ticket in the tracker.

**The marker.** A tracker **label**, default `faff-automation-hold`. It is *orthogonal to status* — a held issue keeps whatever status it has (typically `Backlog`); the label, not the status, carries the hold. (faff already uses labels as control signals: `faff-jot-intake` for prep pickup, `faff-parked` for parks.) An issue is **held** iff it carries this label.

> **Control-label convention.** Every faff-owned control label is `faff-…`-prefixed (`faff-automation-hold`, `faff-parked`, `faff-jot-intake`, `faff-chain-gap-fill`) — namespacing faff's control signals away from the consuming project's own labels. Any future faff control label follows the same prefix.

**Two-tier, not invisible — the key difference from cancelled/archived.** Cancelled/archived items are invisible everywhere. Held items are the opposite on the read side: they remain **fully visible** to read/report skills (`/faff-wtf`, `/faff-map`, counts, diagnostics) — they are only **skipped by autonomous action**.

**Enforcement is by chokepoint, not by enumerating call-sites.** All autonomous spec/promote/build flows through three skills; each checks the hold, so coverage is complete by construction:

- **prep and tidy** are the only skills that autonomously spec or promote (`/faff-beep-boop` "does no tracker state moves of its own" — see its Wave re-entry). Neither auto-specs, auto-refreshes, nor promotes a held issue. Because the only path into the build queue is via `Todo`, and the only path into `Todo` is prep/tidy, **a held issue can never reach the build queue.**
- **graft** is the only skill that autonomously builds. Autonomous graft refuses to build a held issue — the build backstop.
- **Any queue-side filtering in `/faff-beep-boop`** (skipping held items at queue assembly / wave re-entry) is a non-load-bearing **efficiency early-exit** — it avoids wasting a prep/verdict invocation, but is not the guarantee. Held items skipped here never enter the run-ledger `admitted` array, so `runcheck` is unaffected.

**Interactive action is never blocked.** A human may deliberately `/faff-prep` or `/faff-graft` a held issue; those skills proceed, emitting a "this ticket is held" warning, and **never auto-remove the hold**.

**Release is human-gated, multi-path.** Removing the `faff-automation-hold` label in the tracker always works (the irreducible control-surface baseline). faff may also offer to lift it, but **only on explicit human confirm** (e.g. interactive `/faff-tidy`'s lift-hold, or `/faff-prep`'s held-ticket lift gate after a spec is attached). **No autonomous path ever removes the label** — otherwise the hold is no guard. Removing it does not auto-promote; the issue simply rejoins normal eligibility on the next pass.

**Held ≠ parked.** `faff-parked` means automation *tried* and hit a blocker (and tidy may auto-clear it when the blocker resolves); `faff-automation-hold` is a *pre-emptive human* block with **no auto-clear**. They are independent (an issue may carry either, both, or neither) and are surfaced in separate buckets.

**Surfacing (so held work doesn't rot).** `/faff-wtf` and `/faff-tidy` each render a distinct **On hold** section listing held issues (separate from *Parked work*). Interactive `/faff-tidy` offers to lift the hold; autonomous passes only list, never lift.

**Git-only mode (no tracker).** With no tracker there is no label to carry the hold, so the hold check is a **no-op** and the feature is effectively unavailable — consistent with git-only's already-minimal autonomous surface (specs live in `.faff/specs/`; there are no `Backlog`→`Todo` tracker moves to gate).

### Work-ordering rule (priority → chainable unlock value)

The single canonical ordering for every place a faff sub-skill ranks, suggests, or promotes work: faff-tidy's Ready and Stuck-in-prep buckets, faff-wtf's Coming Up / Today's Focus / Ready / build-queue independents, faff-map's critical path, faff-beep-boop's independents ordering. Sub-skills reference this rule rather than restating it. Apply lexicographically:

1. **Priority** is king. It can live on the issue itself or on any **ancestor** (parent, grandparent, or higher container, whatever the tracker calls it); respect both, inheriting from the nearest ancestor that has a value. When the consuming project's `CLAUDE.md` flags a current workstream, weight issues in that workstream up.
2. **Chainable unlock value** breaks ties: the count of direct + transitive dependents (issues whose blockers list this one, recursively). An issue that unblocks a chain of five beats an isolated issue at the same priority. This matters most for automation, where shipping the unlocking issue first gives the next `/faff-beep-boop` pass more ready candidates.

When a `methodology` slot is configured, its `pick-ordering` output reframes this within each priority band (e.g. value × risk × dep-aware); the structural inputs stay in the computation but no longer alone determine the order.

### Always pull fresh (never act on stale tracker state)

Every read-and-synthesise pass re-fetches live tracker state on every invocation: issues, blocker links (both directions), status fields, the comments a pass classifies on, milestones, parent/ancestor relationships. Never reuse a fetch from earlier in the same conversation, never trust a snapshot written into `.faffrc` or any static file, never read a prior `.faff/logs/` file as a substitute for live data. The one exception is the per-run `automation-verdicts.md` cache, read *within* a single pass and recomputed across passes (see **`.faff/` logging directory**).

A pass that mixes fresh-now data with 30-minute-old data is **silently wrong**: the reader trusts the output as one coherent moment, so a status that changed, a PR that merged, or a blocker that resolved between partial fetches produces confidently incorrect output that a human or the queue then acts on. The failure escalates with how much the skill *acts*. A stale briefing misleads; a stale grooming pass (faff-tidy) or build-queue assembly (faff-beep-boop) mutates the tracker or ships code on bad data. Better slow-and-correct than fast-and-lying.

If the fetch budget is genuinely too high, scope the run smaller along a **structural** axis (single project, single workstream) and announce that scope. Never use partial freshness across a wider scope, and never inherit a narrower scope from another skill's already-filtered surface (e.g. scoping tidy to "what wtf just surfaced").

### Spec discovery (where to look for an existing spec)

**This section is the single canonical definition of spec discovery for the whole suite.** Sub-skills (faff-tidy, faff-prep, faff-graft, faff-wtf, faff-map, the methodology's `promotion-readiness`) reference it rather than restating the rule; where one mentions "a real spec per the shared Spec discovery rule", it means exactly the checks below (locations 1–3 with a tracker; location 4 the git-only fallback). Any divergence in a sub-skill is a bug, not a local override.

Any faff sub-skill that asks "does this issue have a spec?" must check **all** of the following, in order, and treat a hit in any of them as the spec:

1. **Issue tracker comments** — **the default and most common location**. faff-prep writes the spec as a comment on the issue during Phase 1 (pre-build). **Most specs live here**, not in the description.
2. **Issue tracker main description / body** — counts **only** when the body holds an actual formalised spec (the structured artefact faff-prep produces: context, approach, acceptance criteria), e.g. someone authored or pasted a real spec into the ticket body instead of a comment. A plain description — requirements, context, or notes, **however clear or well-defined** — is **not** a spec and does **not** count here.
3. **Committed docs** in the repo — under the configured **spec-docs path** (default `docs/specs/`; see **Spec docs location**), e.g. `<spec-docs-path>/YYYY-MM-DD-<issue-id>-*.md`. This is where faff-graft commits the spec on build, and where it lives post-merge. If a feature branch already has a spec committed under this path (matching the issue id), treat that as the spec even if no tracker comment exists.
4. **Git-only spec store** — `.faff/specs/<issue-id>.md`. The **tracker-less fallback**: when no tracker MCP is available, faff-prep writes the spec here (there's no issue to comment on) and faff-graft reads it from here, then commits it to the feature branch under the spec-docs path as usual. Gitignored, so it stays out of the repo until graft commits it — the spec still ships with the PR. Check this location only in git-only mode (a tracker MCP being absent); when a tracker is configured, locations 1–3 are authoritative.

**Comments are not optional.** Because faff-prep writes specs to comments by default, any spec-discovery pass that only inspects descriptions is **invalid output** — it will systematically miss the most common case and produce false "no spec" findings. Before classifying any issue as "no spec / almost ready / needs prep", you **must** fetch its comments via whichever tracker MCP is configured (use the tracker's list-comments tool — autodetect from the available MCP, don't hardcode). Sampling descriptions and noting "comments not checked" is **not** acceptable — re-fetch and complete the check before reporting.

Never assume "no spec attached" without checking all three. Finding a spec in any location is a positive. When multiple sources exist, prefer the most recently modified one and note the discrepancy in the log.

**A description is never a spec — no exceptions.** However clear, detailed, or well-defined a ticket's description is, it does not satisfy the spec gate and must be formalised into a spec via `/faff-prep` before any build. No faff sub-skill may offer to build straight from a description, skip prep because "the description is already clear," or treat well-defined requirements as a substitute for the spec. Well-defined is a reason prep will be *fast*, not a reason to skip it. The spec is the durable, reviewable artefact the build is gated on; the description is not.

### `.faff/` logging directory

Every faff skill invocation writes a structured markdown log to the repo-local `.faff/` directory. Layout:

```
.faff/
  logs/
    YYYY-MM-DD/
      HHMMSS-<skill>[-<context>].md         # one file per skill invocation
      HHMMSS-tidy-verdicts.md               # standalone-tidy automation verdict cache
  runs/
    YYYY-MM-DD-beep-boop-HH-MM-SS/          # grouped per beep-boop run
      summary.md
      run-ledger.json                       # admitted issues + terminal outcomes (audited by runcheck)
      slot-validation.md                    # cached per-occupant conformance verdicts (non-default occupants)
      automation-verdicts.md                # verdict cache for this run
      conflict-analysis.md
      ISSUE-XX/
        prep.md
        graft.md
        resolve-attempt.md                  # if autonomous resolve-attempt ran
        ac-verification.md
        park.md                             # if parked
      ...
  calibration/                              # append-only; never authoritative
    over-cautious-parks/
      <ISSUE-ID>.md
    wrong-inferences/
      <ISSUE-ID>.md
    post-merge-reverts/
      <ISSUE-ID>.md
    appetite-decisions/                     # high/full proceeded on medium confidence
      <ISSUE-ID>.md
    held-decisions/                         # low/medium held a medium-confidence spec for human
      <ISSUE-ID>.md
```

The `calibration/` directory is **append-only** and **never authoritative for current decisions** — it captures evidence about autonomous decisions (over-cautious parks, wrong inferences, post-merge reverts, appetite-influenced proceeds, and medium-confidence holds) so resolve-attempt rules and verdict gates can evolve with data. See **Autonomous Mode Contract → Calibration log** for capture rules and the synthesis-and-surface flow.

The `automation-verdicts.md` per-run cache (and the standalone `HHMMSS-tidy-verdicts.md` equivalent) lets other sub-skills read the verdict computed by `/faff-tidy` without recomputing within a single pass. Across passes, always recompute — same "always pull fresh" rule that governs spec discovery.

Each log entry captures:

- Invocation context (args, mode — interactive or autonomous, working directory)
- MCP calls made (tool name, relevant inputs, key outputs)
- Decisions with reasoning (what was expected, what was observed, what decision was taken, why)
- Commit SHAs, PR URLs, branch names
- Errors, parks, and their causes

Logs are plain markdown — agent-readable and human-readable. A log must contain enough context that a follow-up agent, given only the log file, can pick up intelligently without needing the original conversation.

**Gitignore:** `.faff/` is added to `.gitignore` on first write if not already present. Users may un-ignore to commit logs if they want.

### Worktree policy

**This section is the single canonical definition of how faff uses git worktrees.** `/faff-graft` owns the mechanism (the `WorktreeCreate` hook + `setup-worktree.sh`); `/faff-beep-boop` and the `concurrency` slot rely on the isolation guarantee. All three reference this section rather than restating it — any divergence is a bug.

- **Location: `~/.faff/worktrees/<repo>/<branch>` by default; override with the `.faffrc` `worktree_root` key (or the `FAFF_WORKTREE_ROOT` env var).** Worktrees live **entirely outside the repo directory** — so they never appear in `git status`, never get committed, and need no `.gitignore` — and a separate tree from the build is exactly what gives **holdout / evaluator work isolation** from the implementation (the L4 verification story). The home-dir default is writable both on a normal host and inside repo-only bind-mounts/containers (where the repo's *parent* often isn't writable, so a true sibling can't be created); it's namespaced by `<repo>` so multiple projects don't collide. A configured `worktree_root` is used as-is (it's per-repo, since `.faffrc` is). One worktree per work unit (issue/branch). (`git worktree add` has **no** default checkout location — the path is always chosen by the caller; `.git/worktrees/` is git's own per-worktree *metadata* dir, not a checkout location, and a checkout placed there collides with it.)
  - *Caveat in ephemeral containers:* when the worktree root is container-local (not host-mounted) but the repo is, a destroyed container leaves the checkout gone while git's metadata (in the mounted `.git/worktrees/`) dangles — a `git worktree prune` clears it. This is housekeeping, never a queue-halt (see below).
- **Branch.** Each worktree is a **new branch off `HEAD`**, named for the work unit (the issue id / slot name, `/`→`-`). Re-entering the same issue **reuses** its existing worktree (match on the issue id in the worktree path) — the spec commit and branch creation happen once; subsequent `/faff-graft` runs resume in place.
- **Provisioning** (performed by `setup-worktree.sh` when the hook fires): create the worktree + branch, copy gitignored local config into it (`.env*`, `.claude/settings.local.json`), then run the project's package-manager install / `setup` target. Skip the install with `SKIP_NPM_PACKAGES_INSTALL=1` — e.g. a Linux container with a macOS bind-mounted worktree, where installing would write platform-wrong binaries.
- **Per-issue isolation is the contract.** Every build — sequential or parallel — runs in its **own** worktree; two builds never share one. This is what makes the `faffter-dark-concurrency-parallel` executor safe to run independents concurrently. A build agent (Implementor lane) sees only its worktree.
- **Dirty worktree → park.** An unexpectedly dirty worktree is an autonomous park reason (see the Autonomous Mode Contract); a parked unit commits its WIP to its branch first (see the Park protocol).
- **Cleanup is post-merge housekeeping.** Removing a merged worktree (and its branch) is housekeeping that **never halts the queue** — if it fails (shell still inside it, permission error), skip + log + continue, and surface it under the run's _Human follow-ups_ (see the Autonomous Mode Contract → post-merge housekeeping).

### Autonomous Mode Contract

Faff sub-skills can be invoked in **autonomous mode** (primarily by `/faff-beep-boop`). The mode is signalled in-conversation at the top of the invocation: _"running in autonomous mode, skip all prompts, park on ambiguity, log everything"_.

Universal rules in autonomous mode:

- **Never prompt.** Every interactive gate has a pre-defined autonomous default. If there is no safe default for a decision, park the work unit and move on.
- **Log every decision, input, and output** to `.faff/logs/…` per the layout above. The log must be sufficient to resume in a fresh conversation.
- **Park on unexpected state.** Missing MCP tool, failed query, dirty worktree, genuine ambiguity — all trigger _park + log + continue_. Never abort the whole run on a single issue.
- **"Ambiguity" means the spec is ambiguous — not that the session state is.** Things about your own runtime are never valid park reasons:
  - Context compaction (current or anticipated) — the harness handles compaction; the `.faff/` logs + tracker + PR state make every work unit resumable across compactions. A compacted session is not an ambiguous one.
  - Session length, turn count, "this will take many steps", "I've already done a lot this session" — none of these are ambiguities. Do the work.
  - Worries about whether you'll remember earlier steps — you don't need to. The log captures what was decided; the tracker captures status; git captures diffs. Future-you (or a resumed session) reads state, it doesn't remember it.
  - Beep-boop processes issues via the `concurrency` slot (sequentially by default, or concurrently when the parallel executor is configured). Each `/faff-graft` invocation is an independent unit — if compaction happens mid-build, resume from `.faff/runs/<run-id>/ISSUE-XX/graft.md` + the branch/PR state. This is a feature, not a risk.
  - **Forbidden park reasons (explicit list):** "session may compact", "context is getting long", "too many turns", "too many issues left in the queue", "risk of another compaction", "mid-build compaction would be ambiguous", "single-session capacity constraints", "single-conversation context budget", "honest orchestration is to do fewer", "depends on a Todo issue that's also in this run", "large scope + external dep addition", "would introduce a new package as first LLM/SDK/XXX site", "chained issue — waiting for earlier to ship", "no `spec` skill configured", "no `concurrency` skill configured", "no `review` skill configured", "no `ship` skill configured", "a slot left unset". If one of these is the reason, **just proceed** — use the documented inline default (see `Slots` defaults table above) or serialise via conflict analysis — it's not a real park. Autonomous mode uses the **same** sensible defaults as interactive when a slot is unset; missing slots are not capacity constraints.
- **"Deferred" / "queued for next run" / "not dispatched this conversation" is the same thing as "parked", just relabelled.** Renaming the category doesn't change the failure mode: ready work that should have been dispatched didn't get dispatched. Any of these phrasings — "deferred to next pass", "saved for the next /faff-beep-boop", "queue is unblocked, ready for next run", "single-conversation context budget", "didn't dispatch this conversation" — is a forbidden bail under a different name. If you find yourself writing one of those phrases in a run summary, the run is **not complete**: go back and dispatch the queue. The only valid run-end states are (i) the queue drained, (ii) every remaining issue is genuinely parked under one of the three valid categories, or (iii) the harness terminated the session externally (which leaves a `.faff/runs/<run-id>/` resumable from the next invocation — not a "deferred" state authored by you). In `/faff-beep-boop` this is **enforced mechanically**: the per-run ledger plus the `runcheck` script (and a Stop hook) fail any run that leaves a build-queue-admitted issue without a terminal outcome — see `/faff-beep-boop` → _Run ledger_.
- **If conflict analysis produced a build queue, dispatching it is the next mandatory step.** Identifying waves and partitioning into independents/collision groups is not the finish line — it's the precondition to building. A run that ends after conflict analysis with the queue undispatched is an incomplete run, not a deferred one. Compaction during build is a resume (the `.faff/runs/<run-id>/` directory + PR/branch state make it resumable from a fresh session); pre-emptively stopping because compaction *might* happen is the same anti-pattern as pre-parking on "session may compact" — explicitly forbidden above.
- **Log entries always include:** what was expected, what was observed, what decision was taken, and why.
- **Spec-closed decisions stay closed. Never re-litigate them.** When reading a spec in autonomous mode, parse for **decision markers**, not topic keywords:
  - Sections ending with `Chosen: X`, `**Chosen:** X`, `Decision: X`, or equivalent conclusion markers are **closed**. Do the thing the spec chose. A "pino vs winston" rationale table that ends in `Chosen: pino` is not an open question — it is a locked decision.
  - A spec self-rated `confidence: high` closes every spec-internal decision. Trust the contents. Park only on external unknowns.
  - **Spec punts are explicit.** Markers include `Punt:`, `needs human`, `TBD`, `unresolved`, `(or X if Y is too much)`, "revisit", or any sentence presenting two options without picking one. Only these escalate.
- **The review skill is the autonomous human-review gate.** Every autonomous build lands as a **regular (ready-for-review) PR** and runs the configured `review` skill (or faff-graft's built-in review if none is configured) as a senior-engineer stand-in. The review's job is to decide whether this PR can merge on green, or whether a human actually has to look first. On pass → auto-merge when CI is green and ACs are verified. On `needs-human` → flip the PR to draft and park for human attention. On `fail` (fixable issues — failing tests, obvious bugs, missing test coverage) → iterate autonomously, re-run review, keep going until pass or `needs-human`. **Work that lands via PR is reversible by definition** — `git revert` exists. Pre-parking is wasteful when the review + merge-confidence gate already catches mistakes. Chained issues depend on earlier PRs merging; over-parking at the pre-PR stage breaks the pipeline.
- **Valid autonomous parks (escalate to human pre-PR):** only four categories — (a) the spec contains an explicit punt marker, (b) the spec assumes external state that doesn't exist in the repo (missing dep, undefined seam, blocker issue not shipped **and not in the current run's queue**), (c) the work cannot be fully reversed by `git revert` on the merge commit — i.e. it would execute a **side effect outside the PR flow** before the human reviews it, (d) the spec's premise is substantially superseded by separate already-merged work, with required Done-ticket-ID evidence cited in the park comment.
- **In-queue dependencies are serialisation, not parks.** If issue A depends on issue B, and B is in the current beep-boop run's build or prep queue, that is a **collision group** — build B first, then A in the same run. Do NOT park A for "depends on B" when B is Todo/Backlog-in-queue. The conflict analysis step (see `skills/faff-beep-boop/SKILL.md`) exists precisely to serialise these. Parking chained work is the failure mode that breaks the pipeline: if a queue of 5 chained issues all park because "the next one isn't Done yet", nothing ships.
- **External dependency additions (new SDK, new package) are not a park category.** If the spec has a `Chosen:` / `Decision:` marker naming the package, the decision is closed — proceed. Adding a package to `package.json` lands via PR and is caught by the review + merge-confidence gate. "Introduces new external dep" is a topic-keyword match, not a park reason.
- **Scope size is not a park category.** "Large scope", "many files touched", "significant surface area", "too many issues left to do", "only time for one" — none of these are in the three valid categories. The review step judges scope creep *relative to the spec*; if the diff matches what the spec asked for, scope is fine regardless of size. If there are too many issues to do in one run, that is solved by parallelism or by the run ending naturally when the queue drains — not by pre-parking to save effort.
- **What "side effect outside the PR flow" actually means:** producing state changes that persist regardless of whether the PR lands. Examples: dropping or migrating production database tables, deleting or renaming S3 buckets / cloud resources, rotating or revoking secrets, sending emails or webhooks to real recipients, publishing packages to a registry, force-pushing to a protected branch, running one-off scripts against prod. These genuinely need pre-approval because the PR gate can't catch them after the fact.
- **What is NOT a valid park, even if the CLAUDE.md topic list mentions it:** edits to files that only take effect after merge. This includes `netlify.toml`, `.github/workflows/*.yml`, `Dockerfile`, `package.json` dep bumps, migration SQL files (as long as they are not *executed* pre-merge), IaC definitions, CI config, build config. These all land via PR; the PR review is the gate. A CLAUDE.md rule like "modifying CI/CD requires confirmation" means *the PR review is the confirmation* — not a pre-park.
- **Rule of thumb:** ask "if I merge this PR and it turns out wrong, can I fix it with `git revert` and a redeploy?" If yes → proceed, let the PR gate catch it. If no (because damage happened before or independent of the merge) → park.
- **Invalid autonomous parks (just proceed):** anything outside the three valid categories above. Stylistic second-guessing, "did the author really mean X?", topic-keyword matches on sections that the spec has already closed, conflating "this touches sensitive files" with "this needs pre-approval". If the spec has an answer and the PR gate will catch mistakes, that is the answer.
- **Post-merge housekeeping failures never halt the queue.** Deleting a merged local branch, removing a worktree, returning to the main working directory, tracker-side status bumps, label cleanup — these are **post-ship housekeeping**, not load-bearing steps. The work that mattered (spec → build → review → CI → merge) is already done and persisted. If any of these housekeeping steps fails (permission error because the shell is still inside the worktree, branch currently checked out, tracker transition rejected, label already removed, etc.) — **skip the failing step, log it, move on to the next issue in the queue**. Never prompt. Never park the merged issue. Never ask the human to resolve it mid-run. Accumulate the skipped items in a per-run "human follow-ups" list that is surfaced in the final run summary (see `skills/faff-beep-boop/SKILL.md` Reporting). The golden rule: anything that happens *after* the PR is merged and cannot be undone by a human in a minute from the run summary is not worth halting the pipeline for.

Per-skill autonomous specifics live in each sub-skill's `Autonomous Mode` section. Summary:

| Skill | Autonomous behaviour (high-level) |
|---|---|
| faff-tidy | Auto-archive merged/cancelled + auto-reparent obvious orphans only. Everything else logged for morning review. |
| faff-wtf | Return the ready-queue as a plain list. No focus recommendation. |
| faff-map | Return the structured roadmap synthesis (initiatives, workstreams, chain join-up, fireable/blocked gates, structural risks). Read-only — never writes to the tracker. |
| faff-prep | Stale-refresh when original design still holds; auto-spec from scratch (always delegated to the `spec` slot) when the producer's self-rating clears the appetite-aware confidence gate (see **Appetite for destruction**). `high` → attach + promote (build-eligible). `medium` → attach with the rating retained (Todo, routes out as `needs-decision-first`); whether an autonomous build then proceeds is appetite-modulated per the matrix above — `low`/`medium` surface for human, `high` (default) resolve-attempt → proceed if defensible, `full` proceed. `low` confidence parks. A missing `spec` override is **not** a park reason — the default `faffter-noon-spec` producer always exists and self-rates against the same gate. |
| faff-graft | Skip prompts. Mid-build ambiguity → invoke `/faff-prep` respec. Still ambiguous → park. Post-build → AC verification → review (pass/fail/needs-human). `pass` → auto-merge on green CI (unblocks chained issues). `fail` → iterate. `needs-human` → flip PR to draft, park. |

### Appetite for destruction

A suite-wide dial (`appetite: low | medium | high | full` in `.faffrc`, default `high`) that tunes how much agency the entire faff pipeline has — build decisions, methodology actions, backlog management, and every pluggable skill that accepts it. The name signals the underlying tradeoff: more autonomous decisions ship faster but accept a small rate of "wrong call, revert it."

The reason this dial exists: the autonomous pipeline's value collapses when it brings every minor call back to the human. A pipeline that parks on every `confidence: medium`, every Punt, every gap-blocked verdict, every methodology finding, demands the same input from the human as building the thing manually would — except now they have to also context-switch into "interpret faff's parks" mode each time. The human's control over project direction lives in the **spec** (front-loaded, considered architecture); past the spec gate, appetite governs how much the pipeline executes without checking back.

Every faff sub-skill and every pluggable skill reads the current appetite level. The four levels:

| Level | Intent |
|---|---|
| `low` | Conservative — park on anything non-obvious; minimal autonomous agency. |
| `medium` | Cautious — proceed only when the call is clear; otherwise park. |
| `high` (default) | Confident — proceed on defensible calls with an audit trail; park architectural/irreversible only. |
| `full` | Maximum agency — resolve everything resolvable, document, proceed; only the hard floor below ever stops it. |

Each skill that accepts appetite **documents its own per-level response** in its `SKILL.md`. The gateway owns the level vocabulary and the hard floor; it does not restate per-skill behaviour. The one table the gateway keeps is the appetite-modulation of two shared contracts — resolve-attempt (gateway-owned) and automation-routing (the `routing_adaptor` slot):

#### Build pipeline (modulation of the resolve-attempt + automation-routing contracts)

| | low | medium | high (default) | full |
|---|---|---|---|---|
| `confidence: medium` spec | Attach (rating retained), surface — not built | Attach (rating retained), surface — not built | Resolve-attempt → proceed if defensible | Proceed — resolve inline, document, don't park |
| `confidence: low` spec | Park | Park | Park | Resolve-attempt → proceed if any defensible path exists; park only if genuinely unknowable |
| Punt markers | Park (no resolve-attempt) | Resolve-attempt with conservative thresholds | Resolve-attempt with widened thresholds | Resolve all Punts — pick the most defensible answer, document, proceed. No Punt parks. |
| `gap-blocked` verdict | Park | Resolve-attempt per verdict rules | Proceed if gap can be worked around | Proceed — file the gap ticket and continue regardless |
| `circular-blocked` verdict | Park | Resolve-attempt (unambiguous break-edge only) | Accept most plausible break-edge | Break the cycle at any plausible edge, document, proceed |
| Chain-gap auto-create | Never (surface only) | Only when methodology configured | Even without methodology, if remainder is identifiable | Always — every identifiable gap gets a ticket |
| Execution-discovered auto-create | Never (surface only) | Only when methodology configured | Even without methodology, if the item is concrete | Always — every concrete discovered item gets a ticket |

The Execution-discovered row gates **bottom-up source (b)** — concrete out-of-scope work faff-graft recorded while building (see **Agent Lanes**). It mirrors the chain-gap row: the orchestrator (faff-beep-boop) files `concrete` items per this dial; `vague` items only ever surface, at every level. Dedup against existing `faff-chain-gap-fill` tickets before filing.

The methodology slot's per-level response lives in the configured methodology skill. The review slot's per-level response lives in the configured review skill — note that review quality never loosens at any level (see the hard floor below).

#### What appetite NEVER changes (hard floor — applies at ALL levels including `full`)

- **Destructive / irreversible operations still park.** Anything that can't be undone with `git revert` and a redeploy still escalates — production data, secrets, external messaging, irreversible cloud-resource changes.
- **User-explicit "ask first" rules** in the `slots` config, in CLAUDE.md, or in spec comments override appetite. The dial doesn't punch through explicit instructions.
- **Cancellation / deletion** of issues or workstreams. No appetite level autonomously cancels or deletes. `full` adds scope (splits, merges, new tickets) but never removes it.
- **Review runs and gates.** `full` does not skip or weaken the review. If it fails, the pipeline iterates or parks — never overrides.
- **Spec quality.** Front-loaded prep still aims for `confidence: high`. `full` resolves more aggressively past the spec gate but doesn't lower the bar for what constitutes a good spec.

**Audit trail.** Every appetite-influenced decision writes a tracker comment in the same shape as the standard resolve-attempt, tagged `(appetite: high)`:

> _Faff autonomous resolve-attempt (appetite: high):_ The spec rated this `confidence: medium` on the storage-layer choice between Redis and Postgres. The codebase uses Postgres for every other persistence site (`src/db/*`) and Redis only for caching in `src/cache.ts`. Proceeding with Postgres. **If this is wrong, comment on this PR before merge and faff will re-park.**

**Calibration.** High-appetite decisions accumulate in `.faff/calibration/appetite-decisions/<issue-id>.md` (same shape as the existing calibration logs). If `appetite: high` produces an elevated rate of wrong-inferences or post-merge-reverts, the next `/faff-tidy` calibration-signal pass surfaces the pattern and recommends dialling back to `medium` for the affected work areas. This is how the human keeps directional control without micro-managing every call — they see what got decided across a run, not approve each one inline.

**Switching appetite.** Set `appetite:` in `.faffrc` (a top-level key); takes effect on the next faff invocation. No per-issue overrides — global per project. To force escalation on a single decision regardless of appetite, use the existing Punt mechanism in the spec; explicit Punts are non-negotiable.

### Resolve-attempt before park

Before parking on `needs-decision-first`, `gap-blocked`, or `circular-blocked` verdicts (see **Automation-routing contract**), autonomous mode runs a **resolve-attempt**: a bounded inference step that tries to derive the answer from local context (codebase, spec surroundings, prior commits, related tracker comments).

`repeat-parked` does **not** get a resolve-attempt — the pattern itself signals that a human needs to act.

**Why this exists.** Interactive Claude routinely completes work that autonomous Claude parks, because the autonomous gate is over-literal: it checks for a marker (`Punt:`, `TBD`, `needs human`) and parks on the marker's existence. Interactive Claude reads the same marker, evaluates whether the answer is actually obvious from the codebase, and proceeds. The resolve-attempt gives autonomous mode the same evaluative step, with a safety log.

**Per-verdict resolve rules:**

| Verdict | Resolve-attempt | Proceed if | Park if |
|---|---|---|---|
| `needs-decision-first` (Punt marker) | Re-read the Punt section. Check whether the codebase already exhibits a clear convention for the alternatives offered. Check whether `Chosen:` markers elsewhere in the spec imply the answer. Check whether related shipped issues constrained the choice. | A single clear answer falls out with high confidence | Multiple defensible answers, or the choice is architectural (user-facing API, schema, security) |
| `gap-blocked` (external dep doesn't exist) | Re-read the dependency claim. Determine whether the named dep is **load-bearing** (the work can't proceed without it) or **precautionary** (the spec mentioned it but the work can complete without). | Dep is precautionary — work can proceed; the dep can be filed as a future issue | Dep is load-bearing — actually needed for the work to compile / pass tests |
| `circular-blocked` (in dep cycle) | Re-read each edge of the cycle. Determine whether breaking one specific edge is mechanically obvious — e.g. "A blocks B" was added defensively but A's spec doesn't actually depend on B's output. | A break-edge is unambiguous (spec doesn't load-bear on it) — proceed by serialising remaining edges as a collision group | Every edge looks load-bearing — the cycle is real and a human has to redesign |

**Boundedness.** The attempt reads at most **3 files outside the spec's named scope** at `medium` appetite. At `high` appetite (default) the budget grows to **5 files**. Beyond the budget, treat as park. Keeps cost contained and avoids rabbit-hole investigations.

**Appetite-aware thresholds.** At `appetite: high` (see **Appetite for destruction**), each row's "Proceed if" column widens — a single *defensible* answer is enough where `medium` appetite requires a single *clear* answer. The "Park if" thresholds narrow correspondingly: architectural calls still escalate, but stylistic or convention-following calls proceed with the audit-trail comment. At `appetite: low`, resolve-attempt does not run at all — every flagged verdict parks.

**Audit trail.** A proceeding resolve-attempt **always writes a tracker comment** in this format:

> _Faff autonomous resolve-attempt:_ The spec flagged this as `Punt: cron vs queue-driven send` but the codebase uses cron in every other scheduled-job site (`src/jobs/*`). Proceeding with cron. **If this is wrong, comment on this PR before merge and faff will re-park.**

This makes the inference reviewable. The human sees what was decided and why; the PR can be flipped back to draft if the call was wrong; the merge-confidence gate is the backstop.

**What resolve-attempt does NOT do.** It does not bypass existing autonomous safety boundaries. Side-effects-outside-PR-flow (per the rules above) still park unconditionally. Destructive operations still park unconditionally. The resolve-attempt only applies to the three verdicts above, where over-literal marker matching is the dominant park-cause.

### Calibration log

Captures evidence about over-cautious parks, wrong inferences, and post-merge reverts so the resolve-attempt rules and verdict gates can evolve with data.

**Capture points (append-only):**

| Event | Path | Captured |
|---|---|---|
| Autonomous-park then interactive-complete-no-questions | `.faff/calibration/over-cautious-parks/<issue-id>.md` | Park reason, root-cause class, what the interactive resolution actually was (read from the commit / PR) |
| Autonomous-resolve-attempt then human-overrode | `.faff/calibration/wrong-inferences/<issue-id>.md` | Original marker, inferred answer, human's correction |
| Autonomous-shipped then post-merge-reverted within 7 days | `.faff/calibration/post-merge-reverts/<issue-id>.md` | Shipped commit SHA, revert commit SHA, the diff between them, any comments on the revert |
| Appetite-influenced decision (at `appetite: high`, autonomous proceeded on `confidence: medium` or widened-threshold resolve-attempt) | `.faff/calibration/appetite-decisions/<issue-id>.md` | The verdict, the spec marker, the inferred answer, the audit-trail comment posted, and the merge outcome (pass / human-overrode / post-merge-reverted) once known. Pairs with the wrong-inferences and post-merge-reverts captures above for the cross-cut "is `high` over-shooting?" tidy signal. |
| Medium-confidence held for human (at `appetite: low`/`medium`, a `confidence: medium` spec was attached + surfaced, not built) | `.faff/calibration/held-decisions/<issue-id>.md` | The verdict, the spec marker + thin area, the appetite at the time, and the human's eventual resolution (resolved-as-flagged / changed-direction / waved-through-no-change) once known. The symmetric counterpart to `appetite-decisions` — pairs with it for the cross-cut "is `low`/`medium` *under*-shooting — holding things the human just rubber-stamps?" tidy signal. |

**Synthesis and surfacing.** Every `/faff-tidy` run (or the equivalent step within `/faff-wtf` when no tidy ran this pass) reads the calibration log and surfaces patterns when they cross a threshold:

> _Calibration signal:_ Your autonomous mode parked 4 issues in the last 14 days flagged `needs-decision-first` on `Punt: pino vs winston`. All 4 completed interactively without questions. The codebase has used pino since SHF-92 shipped (3 months ago). Consider: (a) extending the resolve-attempt rules to recognise this pattern, (b) running `/faff-prep --refresh` on the affected issues to update their specs with `Chosen: pino`, or (c) ignore — no change.

Surfaced signals are **advisory** — they suggest a fix but never auto-apply rule changes.

**Critical invariant.** The calibration log is **append-only and never authoritative**. A skill never reads calibration to make a current decision; only humans (or the skills' future iterations) read it to evolve the rules.

**Threshold (fixed):** signals surface when ≥4 events of the same root-cause class accumulate in the last 14 days; the Todo→Backlog repeat-park demotion fires at 3+ parks in 21 days. These are built-in defaults, not `.faffrc` knobs — a user has no basis to hand-tune them, and the surfaced signal is advisory anyway: a human closes the loop. **Closing that loop automatically** — auto-tuning appetite / specs / resolve-rules from this accumulated evidence, and widening the evidence to include evaluator-lane (business-value / QA) outcomes rather than just parks and reverts — is an **L4 capability**, gated on the evaluator lane existing. Not built; today the loop stays advisory.

### Park protocol (shared)

Every faff skill that can park work follows the same protocol:

1. Commit WIP with a clear message (if a branch/worktree exists for this unit of work).
2. Open or update the PR as **draft**.
3. Post a comment on the tracker issue: cause, what was attempted, what is needed from a human. Tag the issue as `faff-parked` (or the tracker's equivalent label) so `/faff-wtf` can surface it — ensuring the label exists first (**Control-label provisioning**).
4. Write to `.faff/logs/…` with the full context.
5. Return control to the caller (beep-boop or interactive invoker).

### Unpark protocol (shared)

Parking is reversible by design — the **single owner of unpark mechanics is this section**; the scattered references elsewhere (faff-tidy's stale-label removal, faff-wtf's parked-issue surfacing, faff-map's unpark-condition view, the methodology's `promotion-readiness`) all resolve to it. A parked issue carries the `faff-parked` label (or tracker equivalent) and a park comment stating what a human must resolve. It re-enters the pipeline one of two ways:

1. **Reason resolved → re-enter.** The unpark trigger is **always re-invoking the relevant skill on the issue**, never a separate "unpark" command. Which skill depends on the park cause:
   - Spec-level park (open `**Punt:**`, ambiguous decision, `low`/retained-`medium` confidence) → re-run `/faff-prep` (or `/faff-prep --refresh`) once the human has answered in a comment. Prep re-rates; on `high` it promotes and clears the label.
   - Build-level park (mid-build ambiguity flipped the PR to draft) → re-run `/faff-graft`; it resumes from `.faff/runs/<run-id>/ISSUE-XX/` + the draft PR.
   - Structural park (`gap-blocked`, `circular-blocked`) → resolve the gap/cycle (file the missing ticket, break the edge), then the issue routes normally on the next tidy pass.
2. **Reason no longer applies → auto-clear.** `/faff-tidy` removes a stale `faff-parked` label without human action when the state moved on (issue now In Progress/In Review/Done/Cancelled) or the park reason is now invalid (cited blocker shipped, cited punt closed by a later `Chosen:`/`Decision:` marker, or the reason matches a now-forbidden autonomous-park pattern). See faff-tidy → _Stale park label_ for the exact rules.

**The label is the contract.** Removing the `faff-parked` label (by either path) is what returns the issue to normal routing — `/faff-wtf` stops surfacing it as a blocker, and the build queue reconsiders it on the next pass. Whoever clears a park (a skill on re-entry, or tidy's auto-removal) **must** remove the label and log the unpark with its cause. A resolved park that keeps its label is a bug: it lies to every downstream surfacer.

### Control-label provisioning (ensure-before-tag)

faff owns a fixed set of **control labels** — the tracker signals the pipeline tags issues with. The canonical set is the **`faff labels` CLI manifest** (resolve the `faff` executable per **Resolver**): `faff labels` emits each control label's `name`, `color`, and `description` as JSON (`faff labels --names` for bare names). This manifest is the **single source of truth** — every path that tags, and any bootstrap that bulk-provisions, reads the set from here rather than hardcoding it. Today the set is `faff-automation-hold`, `faff-parked`, `faff-jot-intake`, `faff-chain-gap-fill` (all `faff-`-prefixed per the control-label convention).

**Ensure-before-tag — the shared rule.** Before any path applies a faff control label to an issue, it must **ensure the label exists**: list the tracker's labels (configured MCP); if the manifest label is absent, create it from its manifest entry (name + color + description); then tag. This is **idempotent** — "label already exists" is a clean no-op, never an error or a duplicate. The check is necessarily **agent-via-MCP**: the `faff` CLI emits the manifest but has no tracker access, so it cannot create the label — the manifest is the mechanical half, the create is the agent half. Every tagging site (`/faff-jot` intake + freeze, `/faff-plot`, `/faff-tidy` parks + chain-gaps + repeat-park, `/faff-beep-boop` parks + discovered-scope, `/faff-graft` parks + discovered-scope, `/faff-prep` parks) applies this one rule rather than carrying its own copy. **Git-only mode:** no-op — there are no tracker labels to ensure.

This closes the unattended-run failure mode where tagging against a not-yet-created label fails or mis-tags, so an auto-filled ticket is missed by the next prep pass.

## Chaining pattern

When a faff skill's flow leads naturally into another faff skill, it offers the next step via a yes/no gate (or a short-choice prompt where there is a real branch like Build/Review/Reprep). On confirm, it invokes the next skill via the `Skill` tool in the same conversation. On deny, it stops cleanly.

No faff skill uses passive "run `/faff-*` next" or "you should run" language. Every chain point is an explicit gate.

## Core contracts and adaptor slots

faff-core fixes a small set of **internal contracts** — the verdict states, vocabularies, and classifications the pipeline directly branches on, counts, gates on, or admits to a queue. These are invariant: they live here, in the gateway, and never move into a swappable skill. Each is paired with a pluggable **adaptor slot** whose job is to translate a producer's native output *into* the fixed internal contract and validate conformance. The default adaptor's native dialect is the house format; swapping an adaptor swaps the translator, never the contract.

**Dividing principle:** anything the faff-* pipeline branches on, counts, gates on, or admits → internal (fixed, here). Anything about format, parsing, presentation, or producer-specific translation → adaptor (slot, swappable).

### Contract loading & conformance (how a skill actually gets these definitions)

Skills load independently. When you enter via a slash command (`/faff-graft`), as a delegated slot, or invoke an adaptor standalone, **this gateway file is not automatically in context** — a bare `see gateway → §X` reference is inert until something loads it. So the contracts below are made available and enforced by three mechanisms, not by hope:

1. **Consumers load on entry.** Every fixed faff-* consumer (graft, tidy, beep-boop, wtf, prep, map, jot) reads this gateway file on entry when it isn't already in context. The definitions then sit in the conversation, so any slot the consumer subsequently delegates to inherits them ambiently — the contract is present without the slot skill having to fetch it.
2. **Standalone reads on demand.** An adaptor invoked directly (e.g. "validate the spec for SHF-123") has no consumer above it, so it reads this file itself before applying a contract. Adaptors therefore **refer back** to the gateway rather than carrying an authoritative copy. The refer-back names it as **"the sibling `faff/SKILL.md`"** — and means it literally: every faff skill lives in its own directory under one shared `skills/` parent (`skills/faff/`, `skills/faffidavit-ship/`, …), so the gateway is always `../faff/SKILL.md` relative to the running skill. Resolve it from *this skill's own install location*, **not** a hardcoded `~/.claude/skills/` prefix — that prefix is only the dev-linked path; a marketplace plugin lives elsewhere (`${CLAUDE_PLUGIN_ROOT}/skills/…`), and the sibling relationship is what holds in both. (The Read tool wants an absolute path and resolves relative to the *project* CWD, so don't pass a bare `../faff/SKILL.md`; resolve the sibling against the running skill's directory.)
3. **New adaptors are authored to conform.** `faffter-dark-authoring-adaptors` is the author/validate skill that ensures any *new* slot occupant carries the correct refer-back prose and maps onto the fixed contract — so the binding survives a swap.

**Conformance clause (binding on every slot occupant).** Any skill occupying an adaptor slot — the shipped default *or* a third-party replacement — **must** map its output onto the fixed contract defined in this section. The contract is the gateway's, never the adaptor's: an adaptor owns its dialect (markers, envelope, assignment rules, format) and nothing else. A slot occupant that redefines, narrows, or extends the fixed vocabulary/classes/verdicts is non-conformant by definition. Where an adaptor's `SKILL.md` recaps a fixed contract for readability, that recap is **non-normative** — if it ever diverges from this section, this section wins.

#### Slot conformance validation (always on)

A sub-skill that delegates to a **non-default** slot occupant validates it *before first use* in the run. This is **always on** — not a config knob. A misconfigured or non-conformant occupant can emit output the pipeline misbranches on, so there is no case where you'd want it off; the only cost is one validation per distinct non-default occupant per run (cached), which is negligible.

- **Scope: non-default occupants only.** A slot left unset (using its shipped default), or set to the slot's documented default name, is **not** validated — the shipped defaults are conformant by construction (and `faff validate-adapters` lints them in CI). Validation fires only when the configured occupant differs from the slot's default (a third-party or user-authored skill). This covers every slot type the authoring tool knows — adaptors (including `ship_adaptor`), producers (including the `ship` producer), `methodology`, and the `concurrency` mechanism.
- **How.** Invoke `faffter-dark-authoring-adaptors` → Validate face on the occupant (by name/path), passing the slot it occupies. It returns `pass` / `fail` + violations against the conformance checklist.
- **Cache once per run.** Validate each distinct occupant **once** per session/run and cache the verdict — autonomous runs write it to `.faff/runs/<run-id>/slot-validation.md` (interactive: hold it in-session). Don't re-validate on every delegation.
- **On `fail`:**
  - *Autonomous* — **park** the work unit (cause: `slot non-conformant — <slot>:<occupant>`), citing the violations in the park comment + log. This is a legitimate park, **not** a forbidden capacity excuse: a non-conformant occupant can emit output the pipeline misbranches on. The whole run does not abort — only units that would route through that slot park.
  - *Interactive* — surface the violations and stop before using the occupant; the user fixes the occupant (or reverts the slot to its default) and re-runs.
- **On `pass`** — proceed normally; the cached pass means no further checks this run.
- **Pre-flight (optional, recommended before unattended runs).** The runtime gate above surfaces a non-conformant occupant only at first use — in an autonomous run that means a park you discover afterwards. To catch structural drift *before* handing a run over, run `faff validate-adapters --configured` (resolve the `faff` executable per **Resolver**): it reads `.faffrc`, structurally lints every configured **non-shipped** occupant against the checklist, and exits non-zero on drift. It is the on-demand twin of this gate — the structural half only; it still defers the semantic checks to the Validate face above (and reports as much). A clean pre-flight means a swapped slot won't park the overnight run on a structural fault.

Per **Contract loading & conformance** above, every consumer already loads this gateway on entry, so this rule is ambient — a sub-skill delegating to a non-default slot occupant applies it without each sub-skill restating it. (A default occupant is never validated at runtime, so the common zero-config path adds no latency at all.)

### Review verdict (fixed) → `review_adaptor`

**Internal contract (fixed):** a review returns exactly one of three states — `pass` / `fail` / `needs-human`. Their semantics, the **revert test** that separates `fail` (revert-reversible defect) from `needs-human` (effect persists after revert), and the rule that a malformed/unparseable verdict coerces to `needs-human` (never silently to `pass`) are all fixed here. faff-graft's post-build gate branches proceed / iterate / park on these three states directly.

**Adaptor slot:** `review_adaptor` (default `faffidavit-review`) — the output envelope (`signal:` line + `## Findings`) and the parsing/normalising of any reviewer's native output into the three states. Swap it to adapt a third-party reviewer; faff-graft still branches on the same three states.

### Delivery outcome (fixed) → `ship_adaptor`

**Internal contract (fixed):** delivery returns exactly one of three outcomes — `shipped` / `not-ready:<reason>` / `failed:<reason>`. Their semantics, the **two-tier gate** that precedes them, and the coercion rule (a malformed/unparseable result coerces to `failed`, never silently to `shipped`) are all fixed here. faff-graft's Step 10 routes proceed / park-retry-later / fail on these three states directly.

- `shipped` — integrity floor and the producer's deploy-readiness both passed, the PR merged/deployed, deploy-side cleanup done. Chained issues unblock; graft reclaims the worktree.
- `not-ready:<reason>` — deploy-readiness deferred the merge **without merging**. Not an error: the PR stays open and mergeable; graft parks it retry-later. Only a deploy-capable producer returns this; the default never does.
- `failed:<reason>` — merge conflict or deploy error. graft surfaces it as a post-build failure.

**The gate is two-tier, and only the lower tier is delegable.** The **integrity floor** — AC-verified + CI-green + review `pass` — is asserted by `/faff-graft` *before* delivery is invoked, and is **non-delegable**: neither the `ship` producer nor `ship_adaptor` may bypass, re-open, or weaken it (the same floor the `concurrency` contract forbids weakening). **Deploy-readiness** — deploy window, environment health, migration ordering, flag state — is the `ship` producer's **own** tier: it may *add* a "no" (→ `not-ready`), never *subtract* the floor's "no". The default's readiness check is a no-op pass.

**Coercion (fixed):** if `ship_adaptor` cannot map the producer's native result onto one of the three outcomes — empty, garbled, an unrecognised token, or a `shipped` claim it can't corroborate — it normalises to `failed:<reason>`, **never** silently to `shipped`. This is the delivery-side mirror of the review verdict's "malformed → `needs-human`, never `pass`": when in doubt, fail safe toward *not having delivered*, never toward a phantom merge. It is what keeps a swapped-in producer safe even though a foreign deploy tool does not natively speak this vocabulary.

**Adaptor slot:** `ship_adaptor` (default `faffidavit-ship`) — the result envelope and the parsing/normalising of the `ship` producer's native delivery result (a `gh`/CI/deploy tool's exit status and logs) into the three outcomes. Swap the `ship` *producer* to change *how* delivery happens (a real deploy occupant like `gstack:land-and-deploy`); swap `ship_adaptor` only when the producer's native result can't be mapped by the default. faff-graft still routes on the same three outcomes. The `ship` producer cleans up only what *it* created (release artefacts, temp deploy state) — **never** the worktree; teardown pairs with graft's setup (see **Worktree policy**). `/faff-graft` owns the routing and the worktree lifecycle; delivery decides and acts on its own tier only.

### Automation-routing verdict (fixed) → `routing_adaptor`

**Internal contract (fixed):** the closed **six-verdict vocabulary** (`fire-and-forget`, `likely-fire`, `needs-decision-first`, `gap-blocked`, `circular-blocked`, `repeat-parked`); the **build-queue admission rule** (only `fire-and-forget` + `likely-fire` ever enter the queue; all others route out with a one-line reason surfaced in wtf, never silently dropped); and the **root-cause class enum** (`punt-not-closed`, `gap`, `cycle`, `spec-ambiguous-external`, `other`) shared by repeat-park detection and the calibration log. The verdict survives a `methodology` swap precisely because it is fixed here, not inside the methodology.

**Adaptor slot:** `routing_adaptor` (default `faffidavit-routing`) — assigning a verdict from `backlog-diagnostics` findings + spec confidence + markers + park history, the computation locus (`/faff-tidy` writes per pass into `.faff/runs/<run-id>/automation-verdicts.md`; consumers read within a pass, recompute across passes), and the display format. References elsewhere to "gateway → Automation-routing contract" and "gateway → Root-cause class enum" resolve to this fixed contract; the `routing_adaptor` slot supplies assignment + display.

### Spec readiness (fixed) → `spec_adaptor`

**Internal contract (fixed):** every non-trivial decision is classified as **closed** / **open** / **external-dependency**, and a **confidence rating** (`high` / `medium` / `low`) is present and **retained on the attached spec** — it is durable provenance and a re-spec signal, not a transient gate token that gets stripped. faff-prep's autonomous gate: `high` → promote (build-eligible); `medium` → attach with the rating retained, move to Todo, surface for human triage — **never** auto-admitted to the build queue; `low` → park. A retained `medium` rating maps to the `needs-decision-first` routing verdict (the rating itself is the human-call signal — see the routing contract above), so an autonomous run gives it a resolve-attempt and otherwise surfaces it in `/faff-wtf` rather than building it unattended. faff-tidy's spec-health pass reads the retained rating and reconciles it against post-spec comments and codebase drift.

**Adaptor slot:** `spec_adaptor` (default `faffidavit-spec`) — the concrete markers (`**Chosen:**` / `**Punt:**` / `**Assumes:**`), the skimmable writing-style rules, the confidence line's format, and the mapping from a producer's native structure into closed/open/external. Swap it to adapt a third-party spec format; faff-prep still gates on the same classification + confidence.

### Rendering — no internal contract → `rendering_adaptor`

Rendering is purely human-facing: no pipeline code branches on, counts, or gates on it, so there is **no internal contract** to fix. The `rendering_adaptor` slot (default `faffidavit-rendering`) is therefore a pure adaptor — the visual-vs-prose split, the closed catalogue of canonical visual forms, the markdown-table-vs-definition-list rule, density caps, and the **synthesis** issue-gloss (tracker ID + one-sentence plain-English gloss + unlock-chain consequence, the humanisation rule, the banned project-management shorthand). Any sub-skill that emits user-facing output renders through the configured `rendering_adaptor`; the catalogue is closed there, not extended inline. References elsewhere to "gateway → Synthesis contract" resolve to this slot.

**Universal-routing rule (load-bearing).** "User-facing output" means **all** human-facing output a sub-skill produces — **terminal output, tracker descriptions, and tracker comments alike** — and every one routes through the configured `rendering_adaptor`'s normalise pass before it is printed or written. The **only** carve-outs are skill source files (`skills/*/SKILL.md`) and internal `.faff/` logs, which are not human-facing in this sense. faff has no central emit function, so this is a **per-skill final pass** against the one shared adaptor, not a single runtime chokepoint — each skill applies it at every emit/write site. This is what keeps tracker descriptions and comments as skimmable as terminal output (per the adaptor's prose-skimmability rule); a skill that writes a raw, un-normalised description or comment is non-conformant.

### Producer slots vs adaptor slots (what to swap, when)

Two of the four contracts above pair a **producer** doing-slot with an **adaptor** slot — and they swap independently:

- **Producer slots** (`intake`, `spec`, `review`, `ship`) *do the work* and emit native output. Swap one to change *how the work is done* (a different spec-explorer, a different reviewer, a different deploy mechanism). A swapped producer does **not** need to match the fixed contract's surface syntax — its paired adaptor (`spec_adaptor` / `review_adaptor` / `ship_adaptor`) is what maps its native output onto the fixed classes/states the pipeline branches on. (`intake` is the exception: it emits a documented brief directly, with no paired adaptor.)
- **Adaptor slots** (`spec_adaptor`, `review_adaptor`, `ship_adaptor`, `routing_adaptor`, `rendering_adaptor`) *translate and validate*. Swap one only when your producer's output can't be mapped by the default adaptor — e.g. a spec format whose decision markers differ from `**Chosen:**`/`**Punt:**`/`**Assumes:**`. The fixed internal contract (the classes, verdicts, gates) never moves; you're swapping the translator, not the contract.

**Rule of thumb for a slot swap:** change the **producer** to change behaviour; change the **adaptor** only if the new producer speaks a dialect the default adaptor can't parse. Most producer swaps need no adaptor change. `intake` and `concurrency` are the slots with no paired adaptor — `intake` emits a documented brief directly (see `faffter-noon-intake`) and `concurrency` performs a mechanism (executes the build pass over the conflict-analysis partition, driving faff's own graft, which already speaks faff's vocabulary), so neither needs a translation layer. `ship` *is* paired (with `ship_adaptor`): its producer reads a foreign deploy tool's native output that must be translated onto the fixed delivery outcomes (see **Delivery outcome (fixed) → `ship_adaptor`**) — same shape as `review` + `review_adaptor`. The `methodology` slot is neither — it's a named-output lens governed by its own contract (see **The `methodology` slot**).

### Legacy contract aliases

Sub-skills written before this restructure cross-reference the contracts by their old names. Those names are **not** headings anywhere; they resolve to the sections above:

| Legacy reference | Resolves to |
|---|---|
| `gateway → Automation-routing contract` | **Automation-routing verdict (fixed) → `routing_adaptor`** |
| `gateway → Root-cause class enum` | the root-cause class enum inside **Automation-routing verdict (fixed)** |
| `gateway → Synthesis contract` | the synthesis issue-gloss inside **Rendering → `rendering_adaptor`** |
| `gateway → The ship slot contract` / `gateway → Mechanism slots → ship` | **Delivery outcome (fixed) → `ship_adaptor`** |

When renaming any contract section, update this table — it is the single place the legacy names are reconciled.

## The `methodology` slot

The `methodology` slot is a **diagnostic lens** over backlog and build state. Unlike the four adaptor slots above, it has no single fixed verdict — instead it answers a set of **named outputs**, each requested by name by a faff-* sub-skill. This section is the canonical contract for that named-output set: a swapped methodology must answer the **required** outputs to keep the suite working; the optional ones degrade gracefully when unanswered. The default is `faffter-noon-methodology-structural`; `faffter-dark-methodology-agile-delivery` is the opinionated alternative. Both answer the same set — that set is defined *here*, not inferred from either default.

**Named-output contract:**

| Output | Requested by | Required? | In → out |
|---|---|---|---|
| `backlog-diagnostics` | faff-tidy, faff-wtf, faff-map | **Always fires** | active-issue graph → structural findings. The structural baseline every pass depends on; two of its findings feed the routing verdict (see below). **Mandatory floor: dependency-graph detection of cycles and ghost-project pointers** — these are not optional flavour, they produce the `circular-blocked` / `gap-blocked` routing verdicts. `repeat-parks`, `splittable specs`, and `chain gaps` are the expected-but-degradable remainder. |
| `pick-ordering` | faff-wtf, faff-beep-boop | **Required** | a set of issues → the same set ordered by the methodology's sequencing rule. |
| `promotion-readiness` | faff-tidy, faff-prep | **Required** | an issue + its spec/blocker state → promote / demote / hold decision with reasons. |
| `build-queue` | faff-beep-boop | **Required** | routed-in issues + conflict analysis → admission-filtered, ordered, wave-partitioned queue. |
| `ticket-shaping` | faff-jot, faff-plot | Optional | a discovery brief → proposed ticket set (titles, descriptions, links, container). Unanswered → faff-jot falls back to one ticket per brief item. **Optional `shape-level` input** (`initiative` / `project` / `epic`): when **absent**, the single-level brief→tickets behaviour faff-jot uses (unchanged); when **present**, shape only that altitude's children of a node-scoped sub-brief — `/faff-plot` supplies it as it recurses a roadmap top-down. The methodology shapes one level per call; **`/faff-plot` owns the recursion, stop rule, and writes** — `ticket-shaping` never recurses or writes itself. |
| `standup-digest` | faff-wtf | Optional | recent + ready + heads-up state → a brief. Unanswered → faff-wtf renders the ready-queue plainly. |
| `horizon-assignment` | faff-map | Optional | active issues → Now/Next/Later horizons + chain diagram. Unanswered → faff-map degrades to a flat structural roadmap. |
| `issue-critique` | faff-prep | Optional | one issue + its spec → a per-issue critique through the methodology's lens (right-sizing, workstream fit, surfaced deps, risk — whatever the lens cares about). Unanswered → faff-prep omits the `## Methodology critique` block. The lens decides the critique's shape; faff-prep does not impose one. |

**Standard envelope (every output).** Inputs a caller always supplies: the relevant issues, their state, sequencing, workstream grouping, and the dependency graph. Every output returns its named answer plus structured findings the caller can render, and a `Methodology: <name>` banner line for display. A methodology **does not know or describe its callers** — it answers the request from the state it's given; it never writes to the tracker (that's the orchestrator lane).

**Display convention (shared).** When a `methodology` slot is configured, a sub-skill's output leads with a `Methodology: [skill-name]` banner line and renders its own methodology-specific section (named by that skill: faff-tidy's bucket 7, faff-wtf's `### Methodology findings`, faff-prep's `## Methodology critique`, faff-map's Phase 1 / Phase 7 additions, faff-beep-boop's summary banner). Both the banner and the section are omitted silently when no methodology is configured. Sub-skills state only *which* section they add, not this convention.

**Appetite.** Every output respects the suite-wide `appetite` dial (see **Appetite for destruction**) — the per-level behaviour lives in the configured methodology skill, not here.

Two findings from `backlog-diagnostics` feed the **Automation-routing verdict** (the fixed internal contract above): an issue in a detected cycle gets `circular-blocked`; an issue with a ghost-project pointer gets `gap-blocked`. The `routing_adaptor` slot performs the assignment. See the default methodology's `SKILL.md` for each output's detection categories, mechanical fixes, and rendered form.

**What a replacement methodology owes (the swap floor).** Because cycle and ghost-project detection feed the fixed routing verdict, a swapped-in methodology **must** answer `backlog-diagnostics` with at least that graph detection — a methodology that drops it silently breaks `circular-blocked` / `gap-blocked` routing for the whole suite. A methodology that doesn't want to reimplement graph analysis **composes the structural default**: it calls `faffter-noon-methodology-structural`'s `backlog-diagnostics` for the graph floor and adds its own findings on top (this is exactly what `faffter-dark-methodology-agile-delivery` does — it is *additive over* the structural baseline, not a from-scratch replacement of it). The other required outputs (`pick-ordering`, `promotion-readiness`, `build-queue`) may be answered wholesale or by re-ranking the structural baseline.

## Mechanism slot (`concurrency`)

The `concurrency` slot is a pure **mechanism** — it *performs an action* in the pipeline rather than producing a translatable artefact (`intake` produces a brief; the adaptors translate; methodology answers named outputs). A mechanism slot has **no paired adaptor** and **no named-output set**; its contract is the set of obligations its action must honour plus the fixed gateway invariants it may never weaken. (`ship` was formerly a mechanism here; it is now a producer paired with `ship_adaptor` — see **Delivery outcome (fixed) → `ship_adaptor`** — because its occupant reads a *foreign* deploy tool's output and must translate it onto the fixed outcomes, the condition the adaptor pattern exists for. `concurrency` stays a mechanism: it drives faff's *own* graft, which already returns faff's vocabulary, so it has no foreign output to translate.) This section is the **canonical, gateway-owned contract** for `concurrency`, so it survives a swap — an occupant carries only its dialect/implementation and **refers back here** (per **Contract loading & conformance**), never an authoritative copy. The default occupant's `SKILL.md` documents *how the default* discharges the contract; it is not the source of the contract.

### The `concurrency` slot contract (fixed)

Executes `/faff-beep-boop`'s build pass. Default `faffter-noon-concurrency-sequential`; override `faffter-dark-concurrency-parallel`.

**Input.** The conflict-analysis partition for the current wave — `{ "independents": [...], "groups": [[...]] }` — plus the per-issue build action (invoke `/faff-graft ISSUE-XX` autonomously) and the run ledger at `.faff/runs/<run-id>/run-ledger.json`.

**Obligations every `concurrency` occupant must honour:**

1. **Build every issue in the partition.** Independents and group members alike each reach a `/faff-graft` invocation. Nothing is skipped or deferred — that is the deferred-queue anti-pattern (see **Autonomous Mode Contract**), caught by `runcheck`.
2. **Serialise within a collision group, and require a *dependency* blocker to have merged.** Members build in listed order, each only after the prior reaches a terminal state. "Terminal" ≠ "merged": `pr-open` / `parked` / `errored` are terminal but unmerged. A member that *depends on* an earlier member (declared blocker) builds **only if that blocker merged (`shipped`)**; if the blocker landed unmerged, **park the dependent** (cause `in-run blocker did not merge — <blocker-id> landed <state>`) rather than build it against a `main` missing the dependency. Same-surface-only members (shared files, no dependency) just serialise.
3. **Record every terminal outcome to the run ledger** the moment an issue lands, as one of the fixed buckets `shipped` / `pr-open` / `parked` / `errored` (see **`.faff/` logging directory** → Run ledger). Map `/faff-graft`'s caller-facing returns to buckets: **`pr-open-for-human` → `pr-open`**, others as themselves. Write the bucket, never the raw token, or `runcheck` flags it invalid.
4. **Never weaken the merge gate.** AC-verified + CI-green + review `pass` is fixed here and in `/faff-graft`; a `concurrency` occupant controls *ordering and isolation* (and, for the parallel executor, rebase-before-merge re-validation), never *whether* the gate runs.

**Output.** Every partition issue reaches a terminal state, all recorded in the ledger; control returns to beep-boop's wave drain. **Worktree isolation** (one worktree per build, never shared) is mandatory for any occupant that runs builds concurrently — see **Worktree policy**.

## Routing

If the user invokes `/faff` with no further context, run `/faff-wtf` (figuring out where to focus is the default).

If the user says something that maps to a specific sub-skill, invoke that sub-skill directly. New-work intent — "new project", "kick off", "I've got an idea", "add a feature", "file a bug" — maps to `/faff-jot`. Both `/faff-jot` and `/faff-plot` *create* tickets (the rest act on tickets that already exist — except that `/faff-jot ISSUE-XX` is also an **existing-ticket interactor**, shaping/gating a ticket that already exists by freeze/thaw of its automation hold per FAFF-24, a *mode* of `/faff-jot` selected by the issue-id argument, not a separate command; `/faff-plot` remains create-only); they split by **scale**: `/faff-jot` captures and shapes a feature/bug/idea one level deep, while `/faff-plot` recurses an **application-scale** brief top-down into a full roadmap (initiatives → projects → first-slice epics). jot forks to plot at its confirm step when the work is application-scale; "plan this out / decompose this app / map out the whole project" routes straight to `/faff-plot`.
