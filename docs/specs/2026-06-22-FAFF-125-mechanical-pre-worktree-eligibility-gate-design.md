# Spec — FAFF-125: Mechanical pre-worktree eligibility gate

> Spec: faffter-dark-nlspec · 2026-06-22 · autonomous · confidence: high — Full spec below.

This is the build spec for **FAFF-125 — Mechanical pre-worktree eligibility gate**. Its audience is the build agent who will edit `faff-graft/SKILL.md` and the human reviewers gating that change. It specifies turning the existing *prose* "autonomous graft never builds a not-eligible ticket" backstop into a precise, deterministic, mechanical gate that fires before any worktree is created.

## 1. WHY — Problem and Principles

**The load-bearing idea:** the eligibility verdict is a *pure function* — `automation_eligible(labels, automation_default)` — already shipped as the `faff eligible` CLI. Anything pure-and-reproducible is a tool, not prose (the *deterministic-tools-over-prose* tenet). So the autonomous-build authority boundary should be enforced by *shelling that CLI at a fixed insertion point and reading its verdict*, not by trusting the agent to "compute `faff eligible`" in its head.

**Problem statement.** The backstop "autonomous graft never builds a not-eligible ticket" lives today as prose in `faff-graft/SKILL.md` (Autonomous Mode → "Automation-eligibility backstop (first)", line 353), which says "compute `faff eligible`" but specifies no mechanical shell-out and no precise insertion point — a fail-dangerous boundary resting on the agent honouring narration. This change replaces that narration with a mechanical gate that shells `faff eligible`, reads its stdout verdict, and hard-stops before worktree creation when the verdict is `false`.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **Deterministic verdict, never agent judgement.** The eligible/not-eligible decision MUST come from `faff eligible`'s printed stdout, never from the agent re-deriving label precedence in prose. Same labels + same `automation_default` ⇒ same decision, always.
- **Fail-safe, never fail-dangerous.** Any inability to resolve the inputs (labels unavailable, binary unresolvable, shell error) errs toward **NOT building** — treat as not-eligible and refuse. The hard stop is a refusal to proceed; it is never destructive and never mutates eligibility labels.
- **Autonomous-only.** The gate fires solely on the autonomous-mode signal. Interactive graft keeps its existing Step-2 WARN-only behaviour and is never blocked.
- **Enforcement, not semantics.** This changes *where and how* eligibility is enforced, not *what* eligibility means. `automation_default`, the label precedence, and `faff eligible`'s logic are untouched.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` | skill prose (markdown) | The file this change edits — Step 1, Step 2, Step 3 worktree creation, Autonomous backstop |
| `plugin/skills/faff/bin/faff` (`cmdEligible`; `automationEligible`) | JavaScript (Node) | The deterministic verdict source the gate shells |
| `plugin/skills/faff/SKILL.md` → Automation eligibility | skill prose | Canonical eligibility semantics + precedence the gate enforces (unchanged) |
| `plugin/skills/faff/SKILL.md` → Resolving the `faff` executable | bash snippet | Canonical binary-resolution the gate reuses |
| `plugin/skills/faff-beep-boop/SKILL.md` | skill prose | The autonomous-mode signal prose the gate keys off |

**Scope statement.** This is one prose+CLI change inside `faff-graft/SKILL.md` (plus a one-field addition to its Step-1 fetch), mechanising an existing autonomous boundary — it sits at the graft build chokepoint, downstream of beep-boop's queue assembly, upstream of worktree creation.

## 2. OUT OF SCOPE

- **Option (a): PreToolUse / WorktreeCreate harness hook.** A Claude Code PreToolUse hook on the worktree-creating command, shipped in faff and injected into the consumer's `settings.json` so the gate fires even if the agent "forgets". Excluded: methodology steer commits the in-skill check (b) as this slice; (a) is defence-in-depth, a fresh follow-up ticket.
- **Eligibility semantics / `automation_default`.** Any change to label precedence, the `faff eligible` logic, or the `automation_default` knob. This ticket is enforcement-only.
- **Interactive-graft blocking.** Making the interactive path refuse a not-eligible ticket. Interactive graft is human-driven; the existing Step-2 WARN is the agreed behaviour.
- **Concurrency-slot parallel-worktree orchestration.** Out of this slice — but the gate's contract MUST hold per-issue, so the parallel path inherits the guarantee for free.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| autonomous-mode signal | The prose preamble beep-boop prefixes each sub-skill invocation with. There is NO env var / CLI flag — it is the conversational signal graft's existing backstop already keys off. |
| pre-worktree point | The tail of graft Step 2, before Step 3 creates the worktree. Step 4's commit prose already names Step 2 as the "before the worktree exists" staging point. |
| eligible verdict | The `true`/`false` string `faff eligible` prints to **stdout**. `faff eligible` ALWAYS exits 0 — the decision is the printed string, never the exit code. |
| `ineligible` disposition | The skip outcome the gate returns to the orchestrator on refusal: a skip recorded as *ineligible, not built* — never `parked`, never a build attempt. |

**The `faff eligible` interface** (already shipped — the gate consumes it):

```
COMMAND faff eligible
  INPUT  --label <L>        # repeated, one flag per label (NOT --labels, NOT comma-separated)
         --default <opt-in|opt-out>   # automation_default; defaults to opt-in if omitted
  OUTPUT stdout: "true" | "false"      # the verdict — read THIS
         exit code: ALWAYS 0          # never branch on $? for the verdict
  LOGIC  faff-automation-hold present  -> false   (hard-exclude wins, even with faff-automate)
         else faff-automate present    -> true
         else                          -> (default == "opt-out")   (default opt-in ⇒ false)
```

**The Step-1 label-capture addition.** graft Step 1 currently extracts identifier / title / status / branch but NOT labels. The gate needs the labels. The tracker `get_issue` fetch already returns them — capturing them is the *same* fetch, no extra round-trip.

## 4. HOW — Behavior

**Architecture.** Two prose edits to `faff-graft/SKILL.md`, no code change to the CLI:

1. **Step 1 fetch** gains `labels` (captured from the existing `get_issue` response).
2. **A new mechanical gate at the tail of Step 2** (before Step 3), firing only under the autonomous-mode signal, that shells `faff eligible` and hard-stops on `false` (or any input-resolution failure). The existing Autonomous "Automation-eligibility backstop (first)" prose is rewritten to *point at / be* this mechanical gate.

**The gate procedure** (pseudocode at the ambiguity point):

```
PROCEDURE pre_worktree_eligibility_gate(issue):     # runs at the TAIL of Step 2
  1. IF not running under the autonomous-mode signal:
     a. RETURN proceed         # interactive: Step-2 WARN already handled; never blocked
  2. # --- autonomous path ---
     Resolve the faff binary (canonical snippet, gateway → Resolving the faff executable)
  3. IF faff unresolved / not executable:
     a. RETURN refuse(reason = "faff binary unresolvable — failing safe to not-eligible")
  4. IF issue.labels could not be resolved (tracker / MCP failure at Step 1):
     a. RETURN refuse(reason = "issue labels unresolved — failing safe to not-eligible")
  5. default = "$faff" config get automation_default -d opt-in     # CLI-only; never hand-read .faffrc
  6. verdict = "$faff" eligible <--label L for each L in issue.labels> --default "$default"
     #   read STDOUT ("true"/"false") — NOT the exit code (faff eligible always exits 0)
  7. IF verdict == "true":
     a. RETURN proceed         # eligible — Step 3 (worktree creation) runs unchanged
  8. ELSE (verdict == "false", OR any shell/parse error in step 6):
     a. RETURN refuse(reason = "not automation-eligible per faff eligible")

PROCEDURE refuse(reason):
  1. Do NOT create a worktree (Step 3 never runs).
  2. Do NOT commit the spec (Step 4 never runs).
  3. Log the reason to .faff/runs/<run-id>/<ISSUE>/graft.md (hard-floor resume artifact).
  4. RETURN the `ineligible` skip disposition to the orchestrator
     (recorded as ineligible / not built — never `parked`, never a build attempt).
  # Never add faff-automate, never remove faff-automation-hold. The stop is non-destructive.
```

**Edge cases and precedence:**

- `faff-automation-hold` + `faff-automate` both present → `faff eligible` returns `false` (hard-exclude wins). The gate refuses.
- Empty / unlabelled issue → under `opt-in` default → `false` → refuse (fail-safe). Under `opt-out` → `true` → proceed.
- Interactive (no autonomous signal) → step 1a short-circuits to proceed; the existing Step-2 WARN is untouched.

**Anti-patterns:** branching on `$?` (faff eligible always exits 0 — read stdout); hand-reading `.faffrc` for `automation_default`; hardcoding `~/.claude/skills/faff/bin/faff`; on the refuse path parking the issue or adding/removing eligibility labels.

## 5. Scenarios

```
Given an autonomous graft of a ticket whose labels make `faff eligible` print "false"
When graft reaches the tail of Step 2
Then it hard-stops BEFORE Step 3 — no worktree, no spec commit — logs a reason, returns `ineligible`
```

```
Given an autonomous graft of a ticket whose labels make `faff eligible` print "true"
When graft reaches the tail of Step 2
Then the gate returns proceed and Step 3 (worktree creation) runs unchanged
```

```
Given an interactive graft (no autonomous-mode signal) of a not-eligible ticket
When graft reaches Step 2
Then the new gate does not fire; the existing Step-2 WARN is emitted and the build proceeds
```

```
Given a ticket carrying BOTH faff-automation-hold AND faff-automate, under autonomous graft
When the gate shells `faff eligible`
Then the verdict is "false" (hard-exclude wins) and graft hard-stops pre-worktree
```

```
Given an autonomous graft where labels or the faff binary cannot be resolved
When the gate runs
Then it fails safe — treats as not-eligible, hard-stops pre-worktree, logs the reason, returns `ineligible`
```

## 6. Design Decision Rationale

- **Injection mechanism:** (b) in-skill mechanical check — low risk, no consumer settings change, reuses the shipped deterministic CLI. (a) harness hook → OUT OF SCOPE follow-up.
- **Where is "pre-worktree"?** The tail of Step 2, before Step 3 — the established pre-worktree boundary.
- **Autonomous detection:** the existing prose autonomous-mode signal — no new flag/env.
- **Labels/binary unresolvable:** refuse (fail-safe).

## 7. Open Questions and Assumptions

**Open Questions:** none — all resolved by methodology steer + ground truth.

**Assumptions:** the tracker `get_issue` response includes labels (fail-safe covers omission); the autonomous-mode signal is in context at the gate point (else treated as interactive, matching today).

## 8. DONE — Definition of Done

- [ ] The Autonomous backstop prose no longer says only "compute `faff eligible`" — rewritten to be / point at the precise mechanical gate at the tail of Step 2.
- [ ] graft Step 1 captures the issue's `labels` from the existing `get_issue` response (no new round-trip).
- [ ] A mechanical gate at the tail of Step 2, before Step 3, fires ONLY under the autonomous-mode signal.
- [ ] The gate resolves the faff binary via the canonical resolver (never hardcoded).
- [ ] The gate resolves `automation_default` via `faff config get automation_default -d opt-in`.
- [ ] The gate shells `faff eligible --label <each> --default <default>` (repeated `--label`, not `--labels`).
- [ ] The gate reads the verdict from **stdout**, never the exit code.
- [ ] On `false`, autonomous graft hard-stops BEFORE Step 3 — no worktree, no spec commit; logs a reason; returns `ineligible`; never mutates labels.
- [ ] On `true`, autonomous graft proceeds to Step 3 unchanged.
- [ ] An interactive graft of a not-eligible ticket is NOT blocked (Step-2 WARN unchanged).
- [ ] Fail-safe: unresolved labels / binary / shell error → refuse.
- [ ] Both `faff-automation-hold` + `faff-automate` → `false` → refused.
- [ ] No change to `faff eligible` logic, label precedence, or `automation_default` semantics; no harness hook added.

confidence: high
