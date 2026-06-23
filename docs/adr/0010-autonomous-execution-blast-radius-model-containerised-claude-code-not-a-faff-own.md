# ADR 0010 — Autonomous-execution blast-radius model: containerised Claude Code, not a faff-owned sandbox

- **Status:** Accepted
- **Date:** 2026-06-23
- **Issue:** FAFF-123

## Context

Autonomous faff (L3 `/faff-beep-boop`, the L4 lights-out frontier) executes commands with no human approving each one. This forces the question the Security threat-model session (FAFF-123) was raised to settle: **where does the blast-radius boundary live — what stops an unattended agent reaching past the work in front of it?**

Claude Code already *is* a sandbox, but its boundary mechanism is **per-command human approval**: every off-allowlist command surfaces a prompt. That is exactly the right control for a human at the keyboard and exactly the wrong one for an unattended run — the run cannot stop and wait for a nod, so the prompts either block it dead or get blanket-approved. The blunt fix, `--dangerously-skip-permissions`, removes the prompts but on a host it also removes the boundary: an allow-all agent running against the host filesystem can touch anything the user can.

Two parked tickets predate settling this:

- **FAFF-100** ([spike] sandbox / permission-boundary mechanism, ADR) asked whether faff needs a **faff-owned sandbox** at all.
- **FAFF-105** (enforce the trusted-command allowlist as a runtime guard) proposed faff **actively blocking off-allowlist commands at runtime** as the boundary.

Both were parked 2026-06-11 on proportionality grounds, deferring to this session. Meanwhile **FAFF-68** (shipped) established a *different* control on a *different* axis — the no-execute floor: commands derived from untrusted free-text (descriptions, comments) are never executed (injection prevention, not blast radius). FAFF-100/105 are about blast radius; FAFF-68 is about injection. Conflating the two is what kept the question open.

## Decision

**faff implements no sandbox of its own. The blast-radius boundary for autonomous faff is OS-level container isolation, provided by running Claude Code inside a container — not by faff.**

The model:

- Run Claude Code in a container with **in-container allow-all** (`--dangerously-skip-permissions`), so unattended execution is never gated on per-command prompts. The boundary is the **container**, not the prompt: the agent can reach only the mounted project and read-only `~/.claude` skills/MCP; it **cannot reach the host filesystem or host processes**. Allow-all is safe *because* the container, not the agent, is trusted to contain the damage.
- **The container is the substitutable mechanism, not a specific product.** **claude-box** (`shftwst/claude-box`) is one portable, ergonomic implementation — it wires up bind-mounts, credential/env forwarding, and skill-symlink resolution so the containerised run keeps native ergonomics (every `~/.claude` skill resolved — faff included — MCP servers reachable, git/SSH forwarded, sessions persisted), and it adapts to any project rather than each project rolling a bespoke automation container. But **any containerised Claude Code satisfies this ADR**: the contract is "host-isolated container + in-container allow-all," and claude-box is a recommended-not-required way to get there.
- faff layers its own controls **on top** of the container — they are complementary axes, not redundant:

  | Control | Axis it bounds | Owner |
  |---|---|---|
  | Containerised Claude Code (e.g. claude-box) | **Blast radius** — what the agent can touch | the container, external to faff |
  | FAFF-68 no-execute floor | **Injection** — never execute free-text-derived commands | faff (shipped) |
  | Git worktree isolation | **Per-build isolation** — one build ≠ one worktree | faff (shipped) |
  | Autonomous Mode Contract | **Irreversibility** — no side-effects outside the PR/revert envelope | faff (shipped) |

**Rejected alternatives:**

- **A faff-owned sandbox (FAFF-100).** Reinvents OS/container isolation that faff is not positioned to own, and couples faff to a sandbox implementation — violating the *adoptable, not all-encompassing* tenet. The boundary belongs at the OS/container layer, which already does this better than an in-process mechanism could.
- **A runtime trusted-command allowlist guard (FAFF-105).** Contradicts the chosen model: inside the container you deliberately run allow-all *because* the container is the boundary, so a per-command guard re-imposes exactly the friction the container removes — and an in-process guard is strictly weaker than OS isolation (a compromised or mistaken agent can route around it). FAFF-68's no-execute floor remains the relevant command-level control; runtime blast-radius guarding is the wrong layer.

## Consequences

- **FAFF-100 and FAFF-105 are cancelled, not deferred.** FAFF-100's open question is answered (no faff-owned sandbox); FAFF-105's mechanism is rejected as the wrong layer for this architecture. Re-file fresh only if the model below stops holding.
- **faff stays *adoptable, not all-encompassing*.** It recommends a containerised runner for L3/L4 and ships none, porting to any container. The dependency is a runtime posture for the operator, not a faff subsystem.
- **claude-box is recommended, not required, and is the portability win.** One adaptable container for any project beats a bespoke per-project automation image. Tradeoff: an in-container run loses the native host environment unless mounted — skills (faff itself) are made available by bind-mount, and secrets cross the boundary only as explicitly forwarded env (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `LINEAR_API_KEY`, per-project `.env.claude-box`).
- **This ADR bounds blast radius *to the container*, not *within* it.** Isolating faff's own lanes from each other inside the container — the evaluator's code-blind / oblivious-holdout boundary, who-sees-which-secret — is **out of scope** and remains FAFF-32's lane→secret visibility matrix (with FAFF-104 the producer behind it). This ADR is the outer boundary; that matrix is the inner one.
- **Revisit triggers.** Reopen if: (a) faff needs finer-than-container isolation between lanes that the container can't give (escalate via FAFF-32); or (b) FAFF-68's trust assumption breaks — i.e. the tracker stops being human-gated (shared / multi-tenant / externally-writable), at which point the injection axis, not the blast-radius axis, is what changes.
