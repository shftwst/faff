# Spec — FAFF-42: Containerisation preflight — assert the blast-radius boundary faff doesn't own

> Spec: faffter-dark-nlspec · 2026-06-26 · interactive · confidence: high. Full spec on Linear FAFF-42.

> **Revised 2026-06-26** — detection reworked to reliable standard container signals (Docker `/.dockerenv`, Podman `/run/.containerenv`, k8s var, systemd `container=`); the unreliable cgroup-v2 parse and the faff-invented env marker are both dropped. **Empirically verified in claude-box** (Docker): `/.dockerenv` present → auto-detected, no claude-box change needed; `/proc/1/cgroup` = `0::/` → cgroup parsing useless here. The cross-project env-marker Punt is dissolved (no marker needed). Confidence medium → high.

> **Narrowed this session.** FAFF-42's original scope (faff-built sandbox/permission/supply-chain enforcement) is superseded by ADR 0010 + the human steer of 2026-06-26 ("the container enforces system boundaries, not faff itself"). Children FAFF-100/105/102 are cancelled; FAFF-99 shipped. This spec covers only the residual faff still owns.

## 1. WHY — Problem and Principles

**The load-bearing model.** ADR 0010 already settled the blast-radius question: *faff implements no sandbox of its own; the boundary for an autonomous run is an OS-level host-isolated container, not faff.* That decision turns FAFF-42's original scope into the container's job. What's left for faff is not *enforcement* but *assertion*: detect whether the boundary ADR 0010 assumes is actually present, and say so loudly when it isn't, **without** refusing to run. This spec builds that thin assertion layer and writes the assumption down where the runtime reader sees it.

**Problem statement.** ADR 0010's container-is-the-boundary decision lives only in an ADR; nothing in the runtime checks it and the gateway never states it — so an autonomous `/faff-beep-boop` can run unconfined on a host with full agent authority and no signal the boundary is missing. This change adds a portable containerisation check, an advisory preflight that warns (never blocks) when an autonomous run isn't containerised, and states the assumption in the gateway.

**Design principles:**

- **Assert, don't enforce.** faff owns no sandbox (ADR 0010). This layer only detects and warns; any in-faff enforcement re-opens a closed decision. The container does the work.
- **Warn, don't block (proportionality is load-bearing).** faff recommends a containerised runner and ships none — it must not refuse to run for a user who accepted the risk. Default is warn-and-continue; escalation to block is an opt-in knob, never the default.
- **Reuse standard signals, invent nothing.** Detection reads the signals container runtimes already set (Docker's `/.dockerenv`, Podman's `/run/.containerenv`, the k8s service-host var, the systemd Container Interface `container=`). faff coins **no** marker of its own and requires **no** cooperation from the container — so the container (claude-box or any other) stays entirely faff-agnostic. The substitutable-mechanism principle of ADR 0010 is honoured: any runtime that sets a standard signal is detected.
- **Honest detection over false confidence.** No signal set is universal; absence of a positive signal is reported as "couldn't confirm", never "definitely uncontained". A user in an undetectable runtime can assert containment via the systemd `container=` convention.
- **Deterministic tool, not prose.** The check is a pure, dependency-free, `--selftest`-able CLI function (mirroring `faff next` / `faff eligible`).

**Scope statement.** The thin faff-side residual of *Agent authority & blast-radius* after ADR 0010 moved enforcement to the container: a detection CLI + an advisory autonomous-entry preflight + a gateway assumption statement.

## 2. OUT OF SCOPE

- **faff-owned sandbox / permission-boundary / seccomp** — ADR 0010 rejected an in-faff sandbox (cancelled FAFF-100/105). Extension: the container project (claude-box).
- **Runtime command allowlist / execution guard** — FAFF-105 cancelled; in-container allow-all is the model.
- **Supply-chain / dependency-addition vetting** — FAFF-102 cancelled.
- **Provisioning / building / shipping a container** — faff recommends claude-box, ships none.
- **Any change to claude-box** — it is Docker; `/.dockerenv` is present so it is auto-detected with no cooperation.
- **A faff-invented env marker (`FAFF_CONTAINERISED` etc.)** — it would make the container know about faff and duplicate existing standards.
- **`/proc/1/cgroup` path parsing** — unreliable under cgroup v2 (verified `0::/` in claude-box).
- **In-container lane isolation** — ADR 0010 bounds blast radius *to* the container, not *within* it. Extension: FAFF-32.
- **Hard-failing an uncontainerised run by default** — violates warn-not-block. Extension: the opt-in `autonomous.require_container: block` knob.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| **Containerised** | The autonomous run executes inside a host-isolated container (the ADR-0010 boundary). |
| **Containment signal** | One piece of standard evidence a container runtime already provides: a marker file, an injected env var, or the systemd `container=` convention. |
| **Preflight** | The advisory check run once at autonomous entry that warns when not containerised. |

```
ENUM Containment: { contained, not_confirmed }
        # not_confirmed deliberately conflates "uncontained" and "undetectable" —
        # the warn path treats both identically; the message distinguishes them.

FUNCTION container_check(env, fs) -> { result: Containment, basis: string }:
  # PURE given (env, fs readings); no tracker, no network. --selftest-able.

RECORD PreflightOutcome:
  containment: Containment        # from container_check
  policy: ENUM { warn, block }    # autonomous.require_container, default warn
  action: ENUM { continue, warn_continue, abort }
```

**Detection precedence** (first decisive signal wins; all are signals the runtime sets — faff invents none):

```
1. env KUBERNETES_SERVICE_HOST set                 → contained  (k8s, in-pod)
2. file /.dockerenv exists                          → contained  (Docker)   ← claude-box, verified
3. file /run/.containerenv exists                   → contained  (Podman)
4. `container=` present in /proc/1/environ          → contained  (systemd Container Interface: nspawn/podman/LXC/OCI)
5. `container` present & truthy in our own env      → contained  (manual assert / inherited systemd convention)
6. otherwise                                        → not_confirmed (no standard signal)
```

`basis` records which rule fired (`"k8s"`, `"dockerenv"`, `"containerenv"`, `"pid1-container=<rt>"`, `"env-container"`, `"no-signal"`) for an honest message. `/proc/1/environ` is null-separated `KEY=VALUE`; an unreadable/absent file contributes no signal (never throws).

**CLI surface** — a **new dedicated subcommand**, not a `doctor` flag:

```
faff container-check        # exit 0 = contained · exit 1 = not_confirmed · prints {result, basis}
faff container-check --json # machine form: {"result":"…","basis":"…"}
faff container-check --selftest   # in-memory table over synthetic (env, fs) fixtures
```

**Design decisions:**

- **Chosen:** a dedicated `faff container-check` subcommand, not `faff doctor --container`. `doctor`'s exit space means install-health; overloading conflates concerns. A sibling pure-function keeps each check's exit codes clean and independently `--selftest`-able. Distinct from the existing `faff contain` containment primitive.
- **Chosen:** read **standard runtime signals**, invent no faff marker. Docker `/.dockerenv`, Podman `/run/.containerenv`, k8s `KUBERNETES_SERVICE_HOST`, and the systemd `container=` convention cover the mainstream runtimes; the container needs zero faff awareness.
- **Chosen:** `not_confirmed` conflates uncontained + undetectable. For a warn-only advisory the two action identically; the message still distinguishes them.

## 4. HOW — Behavior

**Architecture.** One pure CLI function (`container-check`) + one advisory caller (the autonomous-entry preflight) + one gateway prose block. The preflight fires **only in autonomous mode** — an interactive run on the host is a watched session, never warned.

```
PROCEDURE container_check(env, fs):
  IF env["KUBERNETES_SERVICE_HOST"] set:                       return {contained, "k8s"}
  IF fs.exists("/.dockerenv"):                                 return {contained, "dockerenv"}
  IF fs.exists("/run/.containerenv"):                          return {contained, "containerenv"}
  pid1 := fs.read_safe("/proc/1/environ")    # null-separated; read error/absent → "" (never throws)
  IF pid1 contains "container=" token:        return {contained, "pid1-container="+value}
  IF truthy(env["container"]):                                 return {contained, "env-container"}
  return {not_confirmed, "no-signal"}
```

```
PROCEDURE autonomous_entry_preflight():     # runs once, autonomous mode only
  policy := faff config get autonomous.require_container -d warn   # warn | block
  c := faff container-check
  IF c.result == contained:           action := continue
  ELSE IF policy == block:            action := abort
  ELSE:                               action := warn_continue
  log + surface the outcome (basis included); RETURN action
```

- **`warn_continue`** — emit one WARNING to the run log and the `/faff-wtf`-visible surface, then **continue unchanged**.
- **`abort`** — only when the operator opted into `block`: do not start the drain; return a needs-human/blocked outcome naming the missing boundary. Never the default.
- **`continue`** — silent; contained.

**Edge cases:**

- **Docker host (claude-box):** `/.dockerenv` present → `contained` (basis dockerenv).
- **Non-Linux host (macOS dev):** no marker file, no `container=` → `not_confirmed` → warn.
- **cgroup v2 host (`/proc/1/cgroup` = `0::/`):** irrelevant — detection never parses cgroup.
- **`/proc/1/environ` unreadable (permissions):** `read_safe` returns `""` → fall through. Never throws.
- **Interactive run, uncontainerised:** preflight does not fire — no warning.

**Anti-pattern:** parsing `/proc/1/cgroup` for container hints (empty `0::/` under cgroup v2).
**Anti-pattern:** inventing a faff-specific env marker.
**Anti-pattern:** defaulting `require_container` to `block` or hard-failing on `not_confirmed`.

## 5. Scenarios

```
Given an autonomous /faff-beep-boop run inside a Docker container (claude-box) where /.dockerenv exists
When  the autonomous-entry preflight runs
Then  container-check returns contained (basis dockerenv) and the run continues with no warning
```
```
Given an autonomous run on a bare host (no marker file, no container= env, not k8s) under default policy
When  the preflight runs
Then  container-check returns not_confirmed and the run emits one WARNING and CONTINUES (never blocks)
```
```
Given the same uncontainerised autonomous run but autonomous.require_container = block
When  the preflight runs
Then  the run aborts with a needs-human outcome naming the missing container boundary
```
```
Given an interactive /faff-prep or /faff-graft on an uncontainerised host
When  the session runs
Then  no containerisation warning fires (the preflight is autonomous-only)
```

Non-functional assertions:
- `faff container-check` is pure, dependency-free (`node:*` only), offline, `--selftest`-covered; reads only `env` + three well-known paths and never throws on read errors.
- The preflight never changes run outcome under the default `warn` policy — observably advisory.

## 8. DONE — Definition of Done

### From WHY
- [ ] An autonomous run not confirmed containerised produces a visible warning naming the missing ADR-0010 boundary; a contained run does not.
- [ ] faff adds **no** enforcement of its own — detect-and-warn only.
- [ ] faff invents no marker and requires no container cooperation — detection reads only standard runtime signals.

### From WHAT (types & interfaces)
- [ ] `faff container-check` exists, pure and dependency-free, exit 0 = contained / 1 = not_confirmed, with `--json` and `--selftest`.
- [ ] Detection follows the precedence table: `KUBERNETES_SERVICE_HOST`, `/.dockerenv`, `/run/.containerenv`, `container=` in `/proc/1/environ`, truthy `container` in own env, else not_confirmed; `basis` reported.
- [ ] Detection never parses `/proc/1/cgroup`.

### From HOW (behaviour)
- [ ] The autonomous-entry preflight runs `container-check` once, autonomous mode only, mapping result+policy to continue / warn_continue / abort.
- [ ] Default `autonomous.require_container` is `warn`: `not_confirmed` warns and continues; `block` aborts with a needs-human outcome.
- [ ] The warning is surfaced to the run log and the `/faff-wtf`-visible surface, including `basis`.
- [ ] Gateway prose states the container-is-the-boundary assumption (faff enforces none; container is the substitutable mechanism; claude-box one impl) and points at ADR 0010.

### From HOW (edge cases)
- [ ] Docker host with `/.dockerenv` → contained (basis dockerenv).
- [ ] No-signal host → not_confirmed → warn (no throw).
- [ ] `/proc/1/environ` read error → no-signal, never throws.
- [ ] Interactive runs never fire the preflight.

**Integration smoke test:**
```
1. faff container-check                 → in claude-box: exit 0, basis "dockerenv"
2. (simulate bare host fixture)         → exit 1, basis "no-signal"
3. faff container-check --selftest      → all rows pass (k8s, dockerenv, containerenv, pid1-container=, env-container, no-signal)
4. autonomous preflight, policy=warn + not_confirmed → warning emitted, action=warn_continue (run proceeds)
5. same, policy=block                   → action=abort
```

confidence: high
