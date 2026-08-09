# L3 vs L4 — architecture, control flow, and isolation

Two reference diagrams for how the current `faff` implementation runs L3 and L4. Rendered SVGs live beside this file.

For the responsibility split beneath these levels, see [Execution and governance](../../concept/execution-and-governance.md). It distinguishes probabilistic execution, objective conformance, subjective judgement, retained human authority, and the current factory-to-governance dependency direction.

> These are **design references**, not runtime prose — they cite tickets/ADRs for provenance (allowed under `docs/` outside `docs/guide/`).

## 1. `l3-l4-architecture.svg` — the loop at L3 and L4

The delivery loop, the three agent lanes, and the control flow — with L4 shown as **L3 + four additions**.

- **L3 · on the loop** (`/faff-beep-boop`) — the orchestrator drains the queue unattended and **parks** anything it can't call. The safety net is mechanical (park protocol + run-ledger + `runcheck` + Stop-hook), not human vigilance. Review is a single senior pass (swappable to adversarial). Ends on queue-drained / all-parked / budget-hit.
- **L4 · out of the loop** (lights-out) — L3's whole loop, moved **inside the cage**, plus:
  1. a **fail-closed preflight** (container contained · spend/time budget ceiling set — a count-cap alone is refused · adversarial review + spec_review reachable · dial-coherence · 8 guardrail contracts · floor);
  2. **adversarial** review & spec-review (a second opinion that can't collude);
  3. the **code-blind holdout** evaluator lane (a judge that can't see the code);
  4. **Sentry** — a live derailment watcher that can't be reached by what it watches.

### The three lanes (isolation by construction)
| Lane | Sees | Isolation |
|---|---|---|
| **Orchestrator** | tracker · human · read-only code | — (the main process) |
| **Implementor** | full codebase R/W · spec · **no tracker** | throwaway subagent + git worktree; returns only `{issue, outcome, pr}` |
| **Evaluator** (L4) | running env + spec · **no codebase** | fresh process, code-blind |

## 2. `l4-container-permission-model.svg` — what's a container vs. a context

Answers "who launches what, and who could escape".

- There is **one** OS container at L4: the human-launched **`claude-box`** (grants no-human-stop + host isolation — the blast-radius cage, ADR-0010). **faff runs inside it, asserts it via `faff container-check`, and REFUSES if absent — but never launches a container and never self-grants the escape.**
- The lanes inside are **context-isolated, not container-isolated** — orchestrator (main process), implementor (subagent + worktree), evaluator (fresh process, code-blind *by convention*). All share claude-box's one permission envelope.
- The **only** containers faff launches are the **SUT env** — the `env` slot's `docker compose up` stands up the system under test (app · postgres · …), which needs a docker engine **inside** claude-box, and is torn down every path. The evaluator reaches it by **endpoint URL only**.

### The known gap
The evaluator's code-blindness is a **context convention** today, not a **wall**. Making it a wall (its own sandbox where the codebase is physically unreadable) is **FAFF-276**. Generalising that to **per-lane containers + the outer orchestration layer that launches them** (which faff asserts-but-never-builds) is a separate, tracked design concern — see the multi-cage-L4 ticket relating FAFF-42 / 276 / 225 / 32 / 73.

## Where each piece is tracked
| Concept | Ticket |
|---|---|
| Container = the blast-radius cage (ADR-0010) | FAFF-42 (Done) |
| Build context-isolation (orchestrator holds only the ledger) | FAFF-201 (Done) |
| Lights-out runner (in-container L4 entry) | FAFF-225 (Done) |
| Code-blind holdout wired into a run + enforced | FAFF-309 (Done) · dial-coherence FAFF-298 (Done) · level-scoped appetite FAFF-308 (Done) |
| Evaluator **hard** sandbox (code physically unreadable) | FAFF-276 |
| Lane→secret visibility | FAFF-32 · FAFF-104 |
| Isolation as a declared field | FAFF-73 |
| Sentry (derailment kill-switch · corrective authority) | FAFF-49 (shipped) · FAFF-278 |
| L4 governance (run-done terminates · Sentry interrupts · budget backstops) | FAFF-312 |
