# ADR 0103 — Lane-to-secret visibility matrix

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-11
- **Issue:** FAFF-32

## Context

The gateway's lane-isolation table already fixes what each of the three agent
lanes (orchestrator, implementor, evaluator) may see of the codebase, tracker,
spec, and environment — but says nothing about *secrets*. Today every lane
runs inside one shared container with one shared process environment, so the
evaluator's "sees no repo credentials" and the implementor's "sees no tracker
key" are unstated conventions, not recorded invariants. FAFF-104 (the
secret-store/injection producer) is blocked on this: there is no matrix
telling it *what* must be injected *to whom*.

Two prior decisions bound this one without settling it. ADR-0010 records the
forwarded-secret set that crosses the outer container boundary and explicitly
delegates the *within-cage* (inter-lane) boundary to this ticket. ADR-0041
fixes *when* a per-lane boundary becomes physically enforceable: the matrix
is specifiable at any time, but physical enforcement (per-subagent env
scrubbing) requires the full per-lane-cage rung of the isolation ladder,
which has not fired. Below that rung, all lanes share one process
environment and no mechanism can hold a per-lane boundary open. This ADR
supplies the missing WHAT — the matrix — leaving the WHEN (ADR-0041) and the
outer-boundary WHAT (ADR-0010) unchanged.

## Decision

**1. Six secret classes.** The matrix governs six named categories, not
individual keys — instances (which concrete env var a given project uses)
are per-project config, not matrix content:

- **Agent-engine credentials** — LLM provider keys powering agent and helper
  processes (e.g. the primary engine key, plus adversarial-review provider
  keys resolved via the `api_key_env` idiom).
- **Forge credential** — repo/PR/merge authority (e.g. a `gh`-equivalent
  token).
- **Tracker credential** — tracker read/write authority (a tracker API key,
  or the tracker MCP's harness-level auth — same authority class, different
  transport).
- **Project runtime secrets** — the product's real configuration (a
  per-project gitignored env overlay).
- **Synthetic SUT credentials** — an evaluation env-handle's credentials
  block: minted per evaluation, local-only, dev/test-grade, runtime-consumed,
  never persisted.
- **Engine-context vars** — container-engine capability handles (e.g. a
  Docker host socket): not secrets in the credential sense, but authority —
  an unscoped engine handle is host-equivalent control.

**2. The three-lane matrix.** Exactly three rows (the three lanes), not one
row per helper process — helper inventory churns with every slot swap, while
the lane ceiling is stable:

| Secret class | Orchestrator | Implementor | Evaluator |
|---|---|---|---|
| Agent-engine credentials | Yes | Yes (incl. adversarial-review key, scoped to its helper process) | Yes (its runtime helper is itself an LLM process) |
| Forge credential | Yes | Yes | No |
| Tracker credential | Yes | No (host-session tool grant, no lane-held key) | No |
| Project runtime secrets | No | Yes (local dev) | No (gets synthetic credentials instead) |
| Synthetic SUT credentials | Transit only, never persisted | No | Yes (its runtime input) |
| Engine-context vars | Yes | Yes (local dev) | No (endpoint URLs only, never the engine) |

Every cell but one is forced by an already-shipped decision (the lane table's
Tracker=No, ADR-0041's rung-2 evaluator scoping, the env-handle no-persist
rule). The one free cell — orchestrator × project runtime secrets — is
decided by least-privilege: the orchestrator sequences, it never runs the
product, so it needs no project secret.

**3. Helper narrowing rule.** A helper process (a fresh call a lane spawns
for one step — an adversarial-review call, an evaluate call) may receive *at
most* its host lane's visibility, scoped down to what that single call needs.
A helper needing a secret its host lane may not see is a matrix violation,
not a helper exception.

**4. The evaluator ceiling.** The evaluator's complete visible set is an
engine credential, the env-handle's contents (endpoints, synthetic
credentials), and the spec text. Nothing else — no forge credential, no
tracker key, no project secret, no engine-context var. This is the
specification that the outer layer's minimally-scoped evaluator cage is
scoped *to*.

**5. The two-sided holdout invariant.** The evaluator never sees the
implementor's classes (forge, tracker, project runtime secrets); the
implementor never sees the evaluator's (synthetic SUT credentials).
Code-blindness already has its structural mechanism (a fresh process, no
repo path); this matrix adds the credential half of the same seam.

**6. Naming and handling idiom.** All six classes follow the existing
`api_key_env` pattern generalised: config and docs carry env-var *names*
only; *values* live in the process environment; a value never appears in
`.faffrc`, on a command line, in a tracker comment, in a PR log, or in any
committed file — the env-handle's no-persist rule, generalised.

**7. Enforcement posture per rung** (restated from ADR-0041, not
re-decided):

- **Today (rungs 0–1):** normative, not enforced. One shared cage, one
  shared env; ADR-0010's outer-boundary posture stands. A breach is a
  convention violation caught by review and attestation, not a mechanical
  block. Nothing in this ADR ships enforcement machinery.
- **Rung 2 (fired for L4):** the evaluator row becomes physically enforced —
  the outer layer launches the evaluator cage with the minimally-scoped env;
  the assert-and-refuse at lane entry is that build's decision, not this
  ADR's.
- **Rung 3 (not fired):** the full matrix becomes physically enforceable —
  per-lane cages, per-lane credentials. Its trigger is, in part, this matrix
  needing physical enforcement; when it fires it formally reopens ADR-0010
  via that ADR's own escalation trigger.

**8. Contract split.** This matrix is the **fixed contract** — the
lane→secret visibility invariant. The secret-store/injection mechanism that
actually delivers each secret to each lane is a **swappable producer**
behind it, scoped entirely to FAFF-104.

## Consequences

- FAFF-104 unblocks: it designs injection to satisfy these cells, changing
  no cell.
- The rung-3 trigger (ADR-0041) is sharpened by this ADR's existence, not
  fired — no ADR-0041 rung semantics are altered here.
- No enforcement ships from this ADR — assert, never implement. Any rung-2
  assertion machinery is a decision for the build that fires it, not this
  document.
- **Revisit rule:** if a lane's real flow needs a cell this matrix denies,
  amend the matrix by a superseding/amending ADR before widening any cage
  env — never grant the exception quietly. A wrong cell is invisible under
  today's shared environment and only bites once a rung physically enforces
  the row; the fix is always a recorded correction, not a silent edit.
