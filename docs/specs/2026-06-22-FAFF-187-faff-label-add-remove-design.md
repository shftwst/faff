# faff label add/remove — control-label mutation op

> Spec: faffter-dark-nlspec · 2026-06-22 · autonomous · confidence: high · Full spec on the issue tracker.

This is the design spec for **FAFF-187**. Audience: the build agent that implements the new `faff label` subcommand, and the human reviewers who gate it. It specifies a pure CLI op that emits an agent-consumable descriptor for adding or removing a faff control label on an issue — the label-mutation analogue of `faff next` / `faff eligible`.

## 1. WHY — Problem and Principles

**Problem statement.** Every faff tagging site (jot, plot, tidy, beep-boop, graft, prep) carries its own prose ensure-before-tag + tracker-MCP write, and re-derives *which* control label to apply and the ensure-first intent run-to-run. That decision is mechanical and repeated, so by the deterministic-tools-over-prose tenet it belongs in a tool — `faff labels` already emits the manifest (the source of truth), but the add/remove **decision** isn't mechanical yet. This adds a `faff label add|remove` op that emits the decision deterministically; the agent performs the single MCP write.

**Design principles.**

**No-tracker-access invariant.** The CLI performs **zero** tracker I/O — same invariant as `faff next` and `faff eligible`. It is a pure function from `(action, issue-id, label, [present-labels])` to an op descriptor. The single MCP write stays agent-side. An implementation that reaches for a tracker (or even reads `.faffrc` tracker config to do so) violates the core decision the intake confirmed.

**Control-labels-only scope.** The op validates `<label>` against the live `faff labels` manifest (the `CONTROL_LABELS` set) and **rejects** anything not in it. This is faff's control surface, not a general tracker-label editor — arbitrary project labels are explicitly out.

**House conventions, not new ones.** This is the fourth pure-function CLI op in the family. It must mirror the existing three (`labels`, `eligible`, `next`) in shape: stdout output the agent consumes, a `--selftest` table wired into CI, no dependencies, dispatch via the single `main()` table. It introduces no new output idiom where an existing one fits.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` (`cmdLabels`, `CONTROL_LABELS`) | Node/CommonJS | The manifest this op validates against — single source of truth |
| `plugin/skills/faff/bin/faff` (`cmdEligible` / `automationEligible` / `eligibleSelftest`) | Node/CommonJS | Pure-fn + selftest-table precedent to mirror exactly |
| `plugin/skills/faff/bin/faff` (`cmdNext` / `nextStep`) | Node/CommonJS | Pure-fn precedent emitting structured JSON (`{next,reason}`) the agent consumes |
| `plugin/skills/faff/SKILL.md` → *Control-label provisioning (ensure-before-tag)* | Markdown | The prose rule this op mechanises; the descriptor's `ensure_first` mirrors it |
| `.github/workflows/validate.yml` | YAML | Where the new `--selftest` line is wired |

**Scope statement.** A new leaf subcommand in the bundled `faff` CLI, sitting alongside `labels`/`eligible`/`next` as the mechanical half of control-label mutation; its consumer (the tagging sites) is the separate FAFF-188.

## 2. OUT OF SCOPE

- **Routing the tagging sites through the new op** — Why excluded: that's the consumer-side refactor (retire per-skill prose ensure+write), tracked as **FAFF-188** which this issue blocks. Extension point: each tagging site's prose in jot/plot/tidy/beep-boop/graft/prep `SKILL.md`, calling `faff label …` then performing the emitted op.
- **Performing the tracker MCP write** — Why excluded: the no-tracker-access invariant keeps the write agent-side. Extension point: the agent, reading the descriptor and calling the configured tracker MCP (label-ensure + add/remove).
- **Arbitrary (non-control) tracker labels** — Why excluded: control-labels-only scope confirmed at intake. Extension point: none planned; a future "manage project labels" feature would be a separate command, not this one.
- **Creating the label in the tracker** — Why excluded: the CLI has no MCP; ensure/create is the agent half (per the existing *Control-label provisioning* rule). The descriptor only *signals* ensure-first intent. Extension point: the agent's ensure-before-tag step, unchanged from today.
- **Resolving the issue's current labels from the tracker** — Why excluded: pure-fn invariant. When the caller wants idempotency pre-computed, it passes the present-label set in (optional input); the CLI never fetches it. Extension point: the agent passes `--present-label` flags it already holds from its fresh fetch.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Control label | A label in the `faff labels` manifest (`CONTROL_LABELS`) — faff's own pipeline signals, all `faff-`-prefixed |
| Op descriptor | The deterministic JSON the command emits, describing the mutation the agent must perform via MCP |
| Ensure-first | The idempotent "create the label from its manifest entry if absent, then tag" intent (gateway → *Control-label provisioning*) |
| No-op (idempotent) | An add of an already-present label, or a remove of an already-absent label — the agent honours it by doing nothing |

**Command surface.**

```
faff label add    <issue-id> <label> [--present-label L ...]
faff label remove <issue-id> <label> [--present-label L ...]
faff label --selftest
```

- `<issue-id>` — opaque string echoed into the descriptor; the CLI does not validate its tracker-existence (no MCP).
- `<label>` — must be in the `faff labels` manifest; rejected otherwise.
- `--present-label L` (repeatable, optional) — the issue's currently-known labels, so the CLI can pre-compute the idempotent no-op. Absent ⇒ the descriptor reports `idempotent_noop: null` (unknown — the agent decides at write time).

**Op descriptor (output).** Emitted as a single fenced `faff-contract:label-op` JSON block on stdout, mirroring the `faff-contract:<name>` family:

```
RECORD LabelOp:
  issue: String              # the <issue-id> as given, echoed
  label: String              # the validated control label
  action: "add" | "remove"   # the requested mutation
  ensure_first: Boolean      # true for add (ensure-before-tag); false for remove
  idempotent_noop: Boolean | null
                             # add-of-present or remove-of-absent ⇒ true; the opposite ⇒ false;
                             # null when --present-label was not supplied (unknown)
  manifest_entry: RECORD | null
                             # the label's full manifest entry (name/color/description) for add (so the
                             # agent can create it if absent); null for remove (nothing to ensure/create)

  CONSTRAINT label ∈ faff labels manifest        # else: reject, no descriptor
  CONSTRAINT action == "remove" ⇒ ensure_first == false
  CONSTRAINT action == "add"    ⇒ ensure_first == true
```

**Design decisions.**

- **Descriptor shape: `faff-contract:`-style fenced JSON block, vs a flag/line set.** A fenced `faff-contract:label-op` JSON block matches the house pattern for CLI output an agent consumes and acts on across an MCP boundary (the `spec-readiness` / `review-verdict` / `delivery-outcome` family), and `next`'s structured-JSON precedent. A flag/line set would invent a new idiom the agent must hand-parse. **Chosen:** fenced `faff-contract:label-op` JSON block — house convention, deterministically parseable, self-tagging.
- **Fold into `labels`, vs stand alone as `faff label`.** `labels` is a read-only manifest emitter with no per-issue arguments; mutation takes `issue + label + action` — a different verb shape. **Chosen:** stand alone as `faff label` (singular) sibling to `labels` — mirrors `next`/`eligible` as discrete pure ops, keeps `labels` a pure manifest read.
- **Idempotency input: optional `--present-label`, vs no idempotency in the tool.** The acceptance criterion requires surfacing idempotent intent, but the pure-fn invariant forbids the CLI fetching current labels. **Chosen:** optional `--present-label` flags the agent passes from its own fresh fetch; absent ⇒ `idempotent_noop: null` (agent decides at write time). The tool never fetches.

## 4. HOW — Behavior

**Architecture and approach.** A new `cmdLabel(args)` dispatched from `main()` (`if (sub === "label") return cmdLabel(rest);`). It parses the action, issue-id, label, and any `--present-label` flags; validates the label against `CONTROL_LABELS` (reusing the existing constant — single source of truth, no second copy); computes `ensure_first` and `idempotent_noop`; emits the `faff-contract:label-op` block; exits 0. Invalid input exits non-zero with a stderr message and **no** descriptor. A pure helper `labelOp({action, issue, label, present})` holds the logic so the selftest can table-test it without spawning a process — mirroring `automationEligible` / `nextStep`.

**Behavior summary.** Given an action, an issue id, a control label, and (optionally) the issue's known labels, the command emits a deterministic descriptor telling the agent exactly what single tracker mutation to perform — including whether to ensure-create the label first and whether the mutation is a no-op.

```
PROCEDURE cmdLabel(args):
  1. IF args contains "--selftest": run labelSelftest table; return its exit code.
  2. action := args[0]   # "add" | "remove"
     IF action ∉ {"add","remove"}: stderr "faff label: action must be add|remove"; return 2.
  3. issue := args[1]; label := args[2]
     IF issue missing OR label missing: stderr usage; return 2.
  4. present := collect every value following a "--present-label" flag.
  5. result := labelOp({ action, issue, label, present })
     IF result is a rejection (label ∉ manifest):
       stderr "faff label: '<label>' is not a faff control label (see `faff labels --names`)"; return 1.
  6. print the fenced faff-contract:label-op block with result; return 0.

PROCEDURE labelOp({action, issue, label, present}):
  1. entry := CONTROL_LABELS.find(l => l.name == label)
  2. IF entry is undefined: return { rejected: true, label }.
  3. ensure_first := (action == "add")
  4. idempotent_noop :=
       present supplied ? (action == "add"  ? present.includes(label)
                                            : !present.includes(label))
                        : null
  5. return {
       issue, label, action, ensure_first,
       idempotent_noop,
       manifest_entry: action == "add" ? entry : null
     }
```

**Edge cases and error handling.**

- **Label not in manifest** → reject: exit 1, stderr names the offending label and points at `faff labels --names`, no descriptor on stdout. Terminal (not retryable) — the caller passed a bad label.
- **Missing action / issue / label** → usage error: exit 2, stderr usage line. Terminal.
- **`add` of a present label / `remove` of an absent label** (with `--present-label` supplied) → valid descriptor with `idempotent_noop: true`; exit 0. The agent honours it as a clean no-op (no MCP write). Not an error.
- **`--present-label` absent** → `idempotent_noop: null`; the agent resolves idempotency at write time from its own fresh label fetch.
- **`remove` action** → `manifest_entry: null` (nothing to ensure-create on a remove) and `ensure_first: false`.

**Anti-pattern:** the CLI reading `.faffrc` tracker config or calling any MCP to resolve the issue's current labels. Why: it breaks the no-tracker-access invariant that defines this op (and `next`/`eligible`); idempotency input arrives via `--present-label` only.

**Anti-pattern:** duplicating the control-label set into the new command. Why: `CONTROL_LABELS` is the single source of truth; the new op references the same constant so the manifest can never drift between `labels` and `label`.

## 5. SCENARIOS — born-verifiable main objectives

```
Given the faff control-label manifest contains "faff-parked"
When `faff label add FAFF-99 faff-parked` is run
Then stdout is a faff-contract:label-op block with action "add", ensure_first true,
     manifest_entry set to the faff-parked manifest entry, idempotent_noop null, exit 0
```

```
Given "not-a-faff-label" is absent from the manifest
When `faff label add FAFF-99 not-a-faff-label` is run
Then no descriptor is emitted, stderr names the rejected label, and exit is non-zero
```

```
Given an issue already carries "faff-automate"
When `faff label add FAFF-99 faff-automate --present-label faff-automate` is run
Then the descriptor reports idempotent_noop true and exit 0 (the agent performs no write)
```

```
Given `faff label remove FAFF-99 faff-automate` is run
Then the descriptor has action "remove", ensure_first false, manifest_entry null, exit 0
```

**Non-functional assertions.**
- The command performs no tracker/MCP I/O and reads no `.faffrc` tracker config (pure function).
- `faff label --selftest` covers add / remove / reject / idempotent-no-op cases and exits non-zero on any failure.

## 6. DESIGN DECISION RATIONALE

**How should the agent consume the op?**
- Options: (a) fenced `faff-contract:label-op` JSON block; (b) loose flag/line set on stdout.
- (a) matches the existing contract-block family and `next`'s structured JSON, is self-tagging and deterministically parseable; (b) invents a new idiom the agent hand-parses.
- **Chosen:** (a) fenced `faff-contract:label-op` JSON block — house convention, zero new parsing idiom.

**Fold into `labels`, or stand alone?**
- Options: (a) `faff labels add/remove …`; (b) new `faff label …` (singular).
- `labels` is a read-only, argument-free manifest emitter; mutation has a distinct verb shape and per-issue arguments. Folding muddies a pure read command.
- **Chosen:** (b) stand-alone `faff label` — discrete pure op like `next`/`eligible`; `labels` stays a pure manifest read.

**How is idempotency surfaced without tracker access?**
- Options: (a) optional `--present-label` flags, `idempotent_noop` computed when supplied else `null`; (b) the tool fetches current labels (rejected — breaks the invariant); (c) no idempotency in the tool.
- (a) satisfies the "surface idempotent intent" AC while preserving purity; (c) fails the AC.
- **Chosen:** (a) — the agent passes labels it already holds; absent ⇒ `null`, agent decides at write time.

At the time of writing, the CLI is a single dependency-free Node file; the new command adds no dependency and follows the same CommonJS, single-`main()`-dispatch shape.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. Both intake-noted open questions (descriptor shape; fold vs stand-alone) are resolved above from existing CLI conventions — neither is a genuine product/architecture punt.

**Assumptions.**

- **Assumes:** the `CONTROL_LABELS` constant in `plugin/skills/faff/bin/faff` remains the single manifest source. Validation: confirm `cmdLabels` and the new `cmdLabel` reference the same `CONTROL_LABELS` array (no copy) before implementing.
- **Assumes:** the `faff-contract:<name>` fenced-block convention is the accepted shape for agent-consumed CLI output crossing an MCP boundary. Validation: confirm against the existing `faff-contract:spec-readiness` / `review-verdict` blocks the consumers parse.

## 8. DONE — Definition of Done

### From WHY
- [ ] Control-label add/remove is emitted as a deterministic op the agent executes, removing the need for per-skill prose to re-derive which label + ensure-first intent.
- [ ] The CLI performs no tracker I/O and reads no `.faffrc` tracker config (no-tracker-access invariant preserved).

### From WHAT (interfaces)
- [ ] `faff label add <issue> <label>` emits a `faff-contract:label-op` block with `action:"add"`, `ensure_first:true`, `manifest_entry` set, exit 0.
- [ ] `faff label remove <issue> <label>` emits a block with `action:"remove"`, `ensure_first:false`, `manifest_entry:null`, exit 0.
- [ ] A `<label>` absent from the `faff labels` manifest is rejected — non-zero exit, stderr names the label, no descriptor on stdout.
- [ ] `--present-label` (repeatable) is parsed; when supplied, `idempotent_noop` is `true` for add-of-present / remove-of-absent and `false` otherwise; when absent, `idempotent_noop` is `null`.
- [ ] The descriptor's `manifest_entry` on an add is the label's full manifest entry (name/color/description) drawn from `CONTROL_LABELS`.

### From HOW (behaviour)
- [ ] The new command is dispatched from the single `main()` table (`sub === "label"`).
- [ ] Logic lives in a pure `labelOp(...)` helper the selftest table-tests without spawning a process (mirrors `automationEligible`/`nextStep`).
- [ ] The command references the existing `CONTROL_LABELS` constant — no duplicated label set.

### From HOW (edge cases)
- [ ] Missing action/issue/label produces a usage error (exit 2), no descriptor.
- [ ] Idempotent add-of-present / remove-of-absent emits a valid descriptor with `idempotent_noop:true` (not an error).

### From SCENARIOS / CI
- [ ] `faff label --selftest` covers add / remove / reject / idempotent-no-op and exits non-zero on any failure.
- [ ] A `faff label --selftest` step is added to `.github/workflows/validate.yml` alongside the other selftests.
- [ ] The USAGE block and the header comment subcommand list in `bin/faff` document `faff label add|remove`.

**Integration smoke test:**

```
RUN  faff label add FAFF-99 faff-parked
ASSERT stdout parses as a faff-contract:label-op block
ASSERT block.action == "add" AND block.ensure_first == true AND block.manifest_entry.name == "faff-parked"
ASSERT exit code == 0
RUN  faff label add FAFF-99 not-a-label   → exit non-zero, no descriptor
RUN  faff label --selftest                → exit 0
```

confidence: high
