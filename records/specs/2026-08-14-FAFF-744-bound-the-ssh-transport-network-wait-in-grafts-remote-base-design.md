# Bound the SSH-transport network wait in graft's remote base resolver on hosts without a timeout binary

> Spec: faffter-dark-nlspec · 2026-08-13 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-744.

This spec is for the build agent and human reviewers. It hardens the network posture of graft's shared remote base resolver, `plugin/skills/faff-graft/remote-diff-base.sh`, so that an SSH `origin` is abandoned within a bounded wall-clock even on a host that has neither `timeout` nor `gtimeout`. It is a small, self-contained follow-up to FAFF-708 — one function changes, no interface moves.

## 1. WHY — Problem and Principles

**The load-bearing model:** git's low-speed abort (`http.lowSpeedLimit` / `http.lowSpeedTime`) is a *transport-specific* bound — it only governs HTTP(S) transfers. SSH transfers are bounded by `ssh` itself, not by git's HTTP knobs. So the fall-back that FAFF-708 relies on when no `timeout` wrapper exists silently does nothing for an SSH remote. The fix is to give `ssh` its own connect/liveness bound, composed into the same non-interactive posture.

**Problem statement:** FAFF-708 gave `net_git()` a bounded, non-interactive posture — a `timeout`/`gtimeout` wrapper when present, else git's HTTP low-speed knobs plus `GIT_TERMINAL_PROMPT=0`. On a host with neither `timeout` nor `gtimeout` (stock macOS without coreutils) reaching an SSH `origin`, a silently black-holed connection has no wall-clock bound and can hang far past `FAFF_GIT_NET_TIMEOUT`. This change bounds the SSH connect and liveness via `GIT_SSH_COMMAND`, so the wall-clock holds on every platform independent of a `timeout` binary.

**Design principles:**

- **Compose, never regress.** The SSH bound is additive to the existing posture: it must not change HTTP(S) behaviour, nor the `timeout`-present path. `GIT_SSH_COMMAND` is consulted by git *only* for SSH transports, so an HTTP fetch is untouched by construction.
- **Non-interactive is the whole point.** The bound must not reintroduce a prompt hang. `ssh` can still block on host-key or passphrase prompts that `GIT_TERMINAL_PROMPT=0` (a git-credential knob) does not cover; `BatchMode=yes` closes that gap.
- **The operator owns their transport.** An operator who has already set `GIT_SSH_COMMAND` (custom identity, proxy, jump host) must not have it clobbered. Bound our own default only when they have set none.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/remote-diff-base.sh` | bash | The resolver whose `net_git()` runs the two network commands (`ls-remote --symref`, `fetch`). The only file that changes. |
| `plugin/skills/faff-graft/setup-worktree.sh` | bash | Delegates the origin-base resolution to `remote-diff-base.sh`; runs no git network command itself. Inherits the bound with no edit. |
| `test/graft-remote-base.test.mjs` | Node test | Direct coverage of the resolver; the new SSH-bound assertion lands here. |

**Scope statement:** this sits in graft's worktree-provisioning / remote-base surface — the network posture of one shared shell resolver, nothing above it.

## 2. OUT OF SCOPE

- **Documentation-only mitigation (recommend GNU coreutils on macOS)** — Why excluded: the code bound satisfies every acceptance criterion on its own and on every platform, so a doc note is a redundant belt, not a requirement; adding operator-doc prose widens the change surface for no AC gain. Extension point: a future docs pass could add a one-line "install coreutils for a hard `timeout` wall-clock" note under the operator setup guide (`docs/guide/`), independent of this ticket.
- **A separate SSH connect-timeout config knob** — Why excluded: a second knob splits one budget the operator already reasons about as a single number (see Design Decision Rationale). Extension point: if a future need arises to bound connect independently of transfer, a `FAFF_GIT_SSH_CONNECT_TIMEOUT` env var would slot into `net_git()`'s bound computation.
- **Changing `setup-worktree.sh`** — Why excluded: it delegates network work to the resolver and runs no `git` network command of its own, so it inherits the bound unchanged. Extension point: none needed — the delegation boundary is already correct.

## 3. WHAT — Behaviour bound

**Vocabulary:**

| Term | Definition |
|---|---|
| black-holed connection | a TCP endpoint that silently drops packets (no RST, no reply), so a naive connect or read blocks indefinitely rather than failing fast. |
| `NET_TIMEOUT` | the resolved positive-integer second budget already computed in `remote-diff-base.sh` from `FAFF_GIT_NET_TIMEOUT` (default 30). |

**The bound.** `net_git()` gains an `ssh` command string, passed to each git invocation via the `GIT_SSH_COMMAND` environment variable, carrying:

- `-o BatchMode=yes` — fail instead of prompting (host-key, passphrase); the SSH-layer analogue of `GIT_TERMINAL_PROMPT=0`.
- `-o ConnectTimeout=$NET_TIMEOUT` — bound the TCP/connect phase; a black-holed *connect* is abandoned within the budget.
- `-o ServerAliveInterval=$NET_TIMEOUT -o ServerAliveCountMax=1` — bound an *established-then-stalled* session; a mid-transfer black-hole is dropped after roughly the budget (one unanswered keepalive), so the wall-clock holds beyond the connect phase too.

**Precedence.** When the environment already carries a `GIT_SSH_COMMAND`, it is used verbatim (operator owns their transport); otherwise the bounded default above is used. This is the one branch the change introduces.

**Design decision (transport of the bound):**

- `GIT_SSH_COMMAND` env prefix on each invocation vs `git -c core.sshCommand=…` inline option — both scope to the single command with no global side-effect. **Chosen:** `GIT_SSH_COMMAND` env prefix — it is the idiom the ticket names, reads cleanly beside the existing `GIT_TERMINAL_PROMPT=0` export, and lets the operator-set-value check be a plain `[ -z "${GIT_SSH_COMMAND:-}" ]` test on the same variable git itself consults.

## 4. HOW — Behaviour

**Architecture and approach.** Compute the SSH command once (respecting an operator-set value), then thread it through both existing branches of `net_git()` as a `GIT_SSH_COMMAND` prefix. The `timeout`-wrapper branch and the no-wrapper branch both gain the same prefix; nothing else in the function changes. The prefix passes transparently through the `timeout` wrapper to the underlying `git` process.

```
# computed once, after NET_TIMEOUT is resolved and before net_git is called
IF GIT_SSH_COMMAND is already set in the environment:
    SSH_CMD := the operator's GIT_SSH_COMMAND        # respect their transport, do not clobber
ELSE:
    SSH_CMD := "ssh -o BatchMode=yes -o ConnectTimeout=$NET_TIMEOUT \
                    -o ServerAliveInterval=$NET_TIMEOUT -o ServerAliveCountMax=1"

PROCEDURE net_git(args...):
  IF TIMEOUT_BIN is set:
    run: GIT_SSH_COMMAND=$SSH_CMD  $TIMEOUT_BIN $NET_TIMEOUT \
           git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=$NET_TIMEOUT  args...
  ELSE:
    run: GIT_SSH_COMMAND=$SSH_CMD \
           git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=$NET_TIMEOUT  args...
```

**Behaviour summary:** on an SSH origin with no `timeout` binary, the resolver's `ls-remote`/`fetch` now abandon a black-holed connection within roughly `NET_TIMEOUT` seconds (connect phase) or roughly `NET_TIMEOUT` seconds after a mid-transfer stall, instead of hanging indefinitely.

**Edge cases and precedence:**

- **HTTP(S) origin** — git ignores `GIT_SSH_COMMAND` for non-SSH transports, so the prefix is inert; behaviour is byte-identical to today.
- **`timeout` present** — the wrapper remains the hard outer wall-clock; the SSH `-o` bounds sit inside it and only ever tighten, never loosen, the effective wait. No behaviour change on that path.
- **Operator `GIT_SSH_COMMAND` set** — used verbatim; faff adds no bound (the operator has taken ownership of the transport, including its own timeouts). Documented tradeoff, not a regression — the pre-FAFF-708 code bounded nothing here either.
- **`NET_TIMEOUT` resolution** — unchanged; the same resolved integer feeds the HTTP knobs and the SSH `-o` values, so a single budget governs both transports.

**Anti-pattern:** exporting `GIT_SSH_COMMAND` process-wide at the top of the script. Why: it would leak the bound (and `BatchMode=yes`) onto any later, non-`net_git` git call in the same process; scope it to the two resolver network commands via the per-invocation prefix instead.

**Anti-pattern:** appending `-o` options onto an operator-set `GIT_SSH_COMMAND`. Why: their command may already be a wrapper or carry conflicting options; silently mutating it risks breaking a working custom transport. Respect-or-replace is the safe rule.

## 5. Scenarios

```
Given a repo whose `origin` is an SSH URL that black-holes the connection,
  and a host with neither `timeout` nor `gtimeout` on PATH,
  and FAFF_GIT_NET_TIMEOUT set to a small value
When remote-diff-base.sh runs its ls-remote/fetch through net_git()
Then the command is abandoned within a bounded wall-clock (≈ the timeout budget),
  exits non-zero, and prints no base ref (never a stale fall-back).
```

- The `ssh` invocation carries `BatchMode=yes` and `ConnectTimeout=<NET_TIMEOUT>` whenever the operator has set no `GIT_SSH_COMMAND`.
- An operator-set `GIT_SSH_COMMAND` is passed through unmodified.
- An HTTP(S)-origin resolve is byte-for-byte unchanged (the existing FAFF-708 tests stay green).

## 6. Design Decision Rationale

**Reuse `FAFF_GIT_NET_TIMEOUT` (the resolved `NET_TIMEOUT`) for the SSH bound, or add a separate connect-timeout knob?**

- Reuse — one number the operator already sets governs the whole network wait, HTTP and SSH alike; no new surface to document or test.
- Separate knob — finer control (connect vs transfer), but splits one budget into two and adds config surface for a hardening fix.

**Chosen:** reuse `NET_TIMEOUT` — it keeps a single, already-documented budget for the network wait and composes cleanly with the existing HTTP low-speed bound, which also uses `NET_TIMEOUT`. A separate knob is the documented extension point if a real need appears.

**Code bound vs documentation-only (recommend coreutils on macOS)?**

- Code bound — holds on every platform automatically, needs no operator action, is testable in CI.
- Doc-only — zero code, but relies on every operator reading and acting on the note; leaves the default host still able to hang.

**Chosen:** code bound as the deliverable. The doc recommendation is a valid, independent belt (Out of Scope) but cannot satisfy the "abandoned within a bounded wall-clock" AC on an unmodified host, so it does not replace the code fix.

**Respect an operator-set `GIT_SSH_COMMAND`, or always impose faff's bound?**

- Respect-if-set — never breaks a working custom transport (proxy, jump host, identity); the operator owns bounding their own command.
- Always impose — guarantees the bound even under a custom command, but risks clobbering a deliberately-configured transport.

**Chosen:** respect-if-set. Clobbering a custom transport is a worse failure than leaving a bespoke setup to bound itself, and the respect-if-set branch is a one-line guard. The residual unbounded case (custom command + no timeout binary + black-hole) is the operator's owned surface.

## 7. Open Questions and Assumptions

**Open Questions:** none — both questions the ticket raised (reuse vs separate knob; code vs docs) are closed above.

**Assumptions:**

- **`ssh` on the target host understands `-o BatchMode`, `-o ConnectTimeout`, `-o ServerAliveInterval`, `-o ServerAliveCountMax`.** Validation: these are standard OpenSSH options present on macOS's bundled OpenSSH and every mainstream Linux distro; no non-OpenSSH client is in faff's supported surface. The build agent need not add a runtime capability probe.

## 8. DONE — Definition of Done

### From WHY
- [ ] On a host with no `timeout`/`gtimeout` and an SSH `origin`, a black-holed connection is abandoned within a bounded wall-clock (not left to hang), exiting non-zero with no base printed.

### From WHAT / HOW (behaviour)
- [ ] `net_git()` passes `GIT_SSH_COMMAND` on every git invocation in both the `timeout`-wrapped and unwrapped branches.
- [ ] When no `GIT_SSH_COMMAND` is set in the environment, the bound carries `-o BatchMode=yes`, `-o ConnectTimeout=<NET_TIMEOUT>`, `-o ServerAliveInterval=<NET_TIMEOUT>`, `-o ServerAliveCountMax=1`.
- [ ] When `GIT_SSH_COMMAND` is already set, it is passed through verbatim (no clobber, no appended options).
- [ ] The SSH bound reuses the resolved `NET_TIMEOUT` (from `FAFF_GIT_NET_TIMEOUT`, default 30), not a new knob.

### From HOW (non-regression)
- [ ] HTTP(S) resolves and the `timeout`-present path are behaviourally unchanged — the existing `test/graft-remote-base.test.mjs` and `test/impure/setup-worktree-base.test.mjs` suites stay green.
- [ ] `setup-worktree.sh` is unchanged (inherits the bound via delegation).

### Test (added to `test/graft-remote-base.test.mjs`)
- [ ] A test puts a stub `ssh` on PATH that records the argv it is invoked with, points `origin` at a `git@host:repo`/`ssh://` URL, ensures no `timeout`/`gtimeout` is resolved, runs `remote-diff-base.sh` with a small `FAFF_GIT_NET_TIMEOUT`, and asserts (a) the recorded `ssh` argv contains `BatchMode=yes` and `ConnectTimeout=<n>`, and (b) the resolver returns within a bounded wall-clock, non-zero, printing no base.
- [ ] A test sets `GIT_SSH_COMMAND` in the environment and asserts the stub `ssh` (or recorded command) is the operator's, unmodified.

**Integration smoke test:**

```
1. In a temp git repo, set origin to an ssh:// URL pointing at a black-hole port,
   with a stub `ssh` on PATH and no timeout binary resolvable.
2. Run remote-diff-base.sh with FAFF_GIT_NET_TIMEOUT=2.
3. Assert it returns in a few seconds (not hanging), exit != 0, stdout empty.
```

## Methodology critique

Agile-delivery lens (faffter-dark-methodology-agile-delivery), per-issue.

- **Right-sized (P4):** right-sized. One function (`net_git`) gains a bounded SSH command plus a targeted test — a single, coherent 1–3 day (in practice sub-day) unit with one concern. Nothing to split; nothing to merge.
- **Workstream fit (P1 + P5):** fits. The parent project is *Harness-agnostic runtime — the loop runs under Codex CLI*; a fix that makes remote-base resolution hold its wall-clock on stock macOS (no coreutils) is squarely host/harness-agnostic robustness. Cohesive with the outcome.
- **Surfaced deps (P6):** clean. The one dependency (FAFF-708, which introduced the posture being hardened) is Done and already linked as a related issue. No implicit or unlinked blocker.
- **Risk profile (P7):** low. Standard, long-stable OpenSSH options, additive and guarded by a respect-if-set branch; no novel integration or external dependency. No de-risking spike warranted.

confidence: high
build-tier: standard
spec-review: approve
