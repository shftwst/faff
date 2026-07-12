# FAFF-333 — Host-socket detection probe on the lights-out preflight (assert-only) + correct socket/dind guidance

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high. Committed to the feature branch by `/faff-graft` at build time (FAFF-333).

**Build-time note (spec disambiguation, resolve-attempt, not a park).** Two full spec candidates were posted as separate Linear comments on FAFF-333 42 seconds apart (2026-07-05T03:13:07Z and 2026-07-05T03:13:49Z), diverging on a load-bearing design axis: the earlier draft proposed a standalone `faff host-socket-check` CLI command gated by an `autonomous.require_no_host_socket: warn|block` knob that never affects the lights-out path; the later one — this document — folds detection into `container-check`'s own `--json` output (`hostSocketProbe`, a `host_socket` field) and gates the lights-out refusal itself behind an `autonomous.engine_bounded` attestation. Only the later comment carries the `faff-contract:spec-readiness` block faff's spec-discovery machinery keys on, and every subsequent comment on the ticket (the "blast radius + build refinement" note, the spec-review amendment) builds on this version's vocabulary (`engine_bounded`, not `require_no_host_socket`). Per the deterministic-tools-over-prose principle, that machine-readable signal — not a coin flip — is what resolved the ambiguity: **this document (the later, contract-bearing comment) is canonical**; the earlier draft is superseded. Built accordingly, below, unedited from the canonical comment body.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff never *implements* the cage — it *asserts* the cage is present and refuses to run when it isn't (ADR-0010, assert-don't-implement). ADR-0041 decision 3 sharpens what "present" means for L4: the in-cage container engine's authority must be **bounded by the cage**. A mounted host Docker socket (`/var/run/docker.sock`) is root-equivalent host control — any lane can start a privileged container and mount the host filesystem — so a cage with a host socket is *not host-isolated at all*. This work adds the missing assertion for that specific boundedness violation, in the same detect-and-refuse shape as the existing `container-check`.

**Problem statement.** ADR-0041 makes engine-boundedness a hard L4 launch requirement, but nothing detects a mounted host socket, so a `container-check: contained` verdict can currently assert a lie (the run *thinks* it's caged while a host socket gives it host control). Two shipped docs still actively bless "mounted socket / docker-in-docker" as the valid in-cage engine precondition — guidance the boundedness criterion supersedes. This change detects the violation and refuses lights-out on it, and corrects the stale guidance.

**Design principles.**

- **Assert, never enforce (ADR-0010).** The probe *detects and refuses*. It never removes the socket, patches the daemon, launches a container, or self-grants anything. faff reports the boundary is broken; making the cage bounded is claude-box's (external) job.
- **Pure detection, decision at the caller.** Detection is a pure function over an injectable filesystem reader (`fsq`) — no tracker, no network, no process spawning — exactly like `containerCheck`. Whether a detected socket *warns* or *refuses* is the caller's policy, not the probe's.
- **A host socket is only a problem in the autonomous cage.** On an interactive developer host the Docker socket is normally present and legitimate. The probe's warn/refuse policy must not fire noise on every interactive invocation — it mirrors the sibling preflight probes, which never fire interactively.

**Reference context** (line numbers below are from the spec's own explore pass, 2026-07-05, against the then-monolithic `bin/faff`; FAFF-441 has since split it into `bin/lib/*.js` modules — the build targeted the current module layout: `container-check.js` / `lights-out.js` / `config.js` / `regions.js`, functionally identical touch-points).

| System | Location | Relevance |
|---|---|---|
| `containerCheck` / `cmdContainerCheck` / `containerCheckSelftest` | `bin/lib/container-check.js` | The template: pure `(env, fsq)` detection + `realFsq()` adapter + in-memory selftest. The new probe mirrors its shape and `fsq` testability. |
| `cmdBranchProtectionCheck` / `classifyBranchProtection` | `bin/lib/merge-gate.js` | The closest behavioural sibling: an assert-only probe that warns by default, blocks under an opt-in knob, never fires interactive. |
| `lightsOutPreflight` + `cmdLightsOut` | `bin/lib/lights-out.js` | The lights-out refuse-to-start decision. The probe threads a boolean into the assembled `probes` object and adds one refusal in the body, mirroring the existing `budget-ceiling` precondition. |
| `docs/architecture/l4-container-permission-model.svg` (line 79) | git-tracked | Blesses "mounted socket / docker-in-docker" — the primary doc correction (ships in the PR). |
| `design/faff-external-verification-brief.md` (line 106) | **gitignored** | Blesses "host daemon, or docker-in-docker" — corrected best-effort locally; **not** in the PR diff. |

**Scope statement.** This is one thin assertion joining faff's existing container-preflight surface, plus two guidance corrections — nothing more.

## 2. OUT OF SCOPE

- **Container / cage orchestration, socket removal, daemon patching, rootless-engine provisioning.** ADR-0010 / ADR-0041 keep the cage image and its engine as claude-box's (external) concern; faff only asserts.
- **Per-lane cages and the outer orchestration layer (FAFF-276 / FAFF-313).** FAFF-333 extends only the *single existing* `lightsOutPreflight` surface.
- **Non-Docker engine sockets** (rootful Podman, containerd, etc.) — widening the checked-path set is a clean follow-up via the `HOST_SOCKET_PATHS` constant.
- **Promoting the probe to a first-class `LIGHTS_OUT_GUARDRAILS` banner line** — the minimal `probes`-boolean integration is chosen (see Design Decision Rationale); a banner/ledger line is a later observability nicety.
- **Correcting the `.faff/diagrams/` SVG copy** — gitignored local cache, not the source of truth.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Host socket | A Unix socket file connecting to the *host's* Docker daemon (`/var/run/docker.sock`, commonly a symlink to `/run/docker.sock`). Presence inside a cage grants root-equivalent host control. |
| Bounded engine | A container engine whose authority stays inside the cage — rootless dind / podman-in-podman / sysbox-class. |
| Assert-only | Detect-and-report (refuse, on lights-out) — never mutate, launch, or enforce. |

**The probe.**

```
CONSTANT HOST_SOCKET_PATHS = ["/var/run/docker.sock", "/run/docker.sock"]

FUNCTION hostSocketProbe(fsq) -> { present: Bool, path: String|null }
  FOR p IN HOST_SOCKET_PATHS:
     IF fsq.exists(p): RETURN { present: true, path: p }
  RETURN { present: false, path: null }
```

- Pure, exported, uses the same injectable `fsq` as `containerCheck` (the `realFsq()` never-throws adapter).
- Rootless engines conventionally expose their socket at a rootless path (`/run/user/<uid>/docker.sock`, `$XDG_RUNTIME_DIR/podman/podman.sock`) — deliberately *not* in the set, so the recommended posture never false-positives.

**Detection boundary (best-effort, standard-signal only — infosec amendment, 2026-07-05).** `hostSocketProbe` reports a host socket **only at the canonical `HOST_SOCKET_PATHS`** — mirroring `containerCheck`'s "reads only standard signals, invents no marker" posture. It does **not** consult `DOCKER_HOST` and does **not** chase a socket mounted at a non-canonical path; such an evasion is outside faff's threat model (the operator owns the cage — ADR-0010) and the cage itself, not this probe, remains the real boundary.

**`container-check` surfacing (added output, exit unchanged).**

```
RECORD ContainerCheckOutput:      # --json
  result: "contained" | "not_confirmed"    # unchanged
  basis: String                            # unchanged
  host_socket: { present: Bool, path: String|null }   # NEW
```

When `host_socket.present`, the human-readable output prints a warning line naming the path. **Exit code is unchanged** — the socket warning never flips it; the binding refuse lives on the lights-out path only.

**Config knob.**

```
autonomous:
  engine_bounded: false   # default (unset ⇒ false). true = operator attests any host-path
                          # socket is a BOUNDED nested engine, not the host daemon.
```

An operator **attestation**, not a permissive `warn|block` knob — the ADR calls boundedness a *hard* L4 requirement, so the lights-out default is **refuse** on positive evidence; the knob is the human taking responsibility, relaxing refuse→warn.

## 4. HOW — Behavior

**The three loci.**

| Locus | Mode | Behaviour on `host_socket.present` |
|---|---|---|
| `faff container-check` command | mode-agnostic (incl. interactive) | print the warn line + `host_socket` field; exit unchanged |
| Autonomous-entry preflight (beep-boop, non-lights-out) | autonomous only | emit **one** warning to the run log + `/faff-wtf` surface; continue |
| **Lights-out preflight** (`lightsOutPreflight`, folded into the container-axis refusal) | lights-out only | **REFUSE** unless `autonomous.engine_bounded === true`, else warn + continue |

```
PROCEDURE lights_out host-socket resolution:
  1. socket := hostSocketProbe(realFsq())
  2. IF socket.present AND config.autonomous.engine_bounded !== true:
        → refusals.push({ gate: "host-socket", detail: "<path> voids ADR-0010 ... ADR-0041 decision 3" })
  3. ELSE IF socket.present: degrades.push({ gate: "host-socket", detail: "attested bounded, proceeding" })
```

- `engine_bounded === true` downgrades the socket refuse to a warn, but does **not** waive the existing `container-check` containment requirement.
- **Build refinement (2026-07-05 review note):** the refuse reason must be actionable — name both remediation paths (move to a bounded nested engine, or attest `engine_bounded:true`).

**Doc corrections.**

- `docs/architecture/l4-container-permission-model.svg:79` — replace the "mounted socket / docker-in-docker" precondition text with the bounded-rootless-nested-engine requirement; mounted socket / privileged dind named as voiding it (ADR-0041 §3); cross-reference FAFF-276/rungs 2–3 for lane isolation (a separate axis this posture does not deliver).
- `design/faff-external-verification-brief.md:106` — same correction, best-effort (gitignored, not in the PR diff; verified by file read).

## 5. SCENARIOS

```
Given a lights-out preflight where every other guardrail is live and a host docker socket is present
When lightsOutPreflight(probes) runs
Then it returns proceed = false with a refusal gated "host-socket" naming the path and ADR-0041 decision 3
```

```
Given the same cage but autonomous.engine_bounded = true
When lightsOutPreflight(probes) runs
Then the socket finding is a degrades[] warning only and preflight proceeds
```

```
Given faff container-check --json run with a host docker socket present
When the command emits its output
Then result/basis/exit are unchanged AND host_socket:{present:true,path:"/var/run/docker.sock"} is present with a warning line
```

```
Given no docker socket at the well-known paths
When any of the three loci evaluate the probe
Then behaviour is byte-for-byte identical to today (no warn, no refuse)
```

## 6. DESIGN DECISION RATIONALE

**Separate probe vs extend `containerCheck`?** Chosen: standalone `hostSocketProbe` — containment and boundedness are orthogonal; folding would corrupt the containment verdict or break its exit/selftest contract. `container-check`'s own CLI output surfaces it as an additive field.

**Flip `container-check` exit on socket presence?** Chosen: unchanged + `host_socket` field + warn line — back-compat; the binding refuse lives on the lights-out path.

**Permissive `warn|block` knob vs default-refuse + attestation?** Chosen: default-refuse + `engine_bounded` attestation — positive evidence of an unbounded posture, unlike a merely-unconfirmed container.

**Which socket paths?** Chosen: `/var/run/docker.sock` + `/run/docker.sock`; rootless/podman paths excluded by design.

**Guardrail-array entry vs a `probes`-boolean body precondition?** Chosen: the minimal `probes.hostSocketPresent` boolean + one body refusal (mirrors `budget-ceiling`) — a banner/ledger guardrail-array entry would need inverted armed-state special-casing for a one-boolean check; larger blast radius than warranted here.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Punt P1 — host vs nested socket at the canonical path (non-blocking).** The probe treats *any* canonical-path presence as a violation; a rootless/nested engine deliberately exposed at that path would be false-refused. v1 accepts the conservative false-refuse (fail-safe) — the `engine_bounded` attestation is the intended remedy. Widening to discriminate is a follow-up, not this slice.

**Assumptions.**

- **A1 — the committed SVG is hand-editable source, not generated.** Validated: no generator found in `scripts/`, `Makefile`, or `plugin/` referencing this SVG.
- **A2 — `design/faff-external-verification-brief.md` still exists on disk at build time with the line-106 wording.** Validated: present, edited in place; gitignored, so this correction does not appear in the PR diff.
- **A3 — no separate CLI registration is needed** since detection surfaces through `container-check`'s existing command, not a new subcommand (a build-time confirmation once the FAFF-441 module split was accounted for — no `COMMANDS`/`REGION_MAP` entry required).

## 8. DONE — Definition of Done

### From WHY
- [x] A host socket at a well-known path is detected and refused on the lights-out path; environment stand-up (bounded nested engine) is unaffected.

### From WHAT (types and interfaces)
- [x] `hostSocketProbe(fsq)` is a pure, exported function using the shared `fsq`; returns `{present, path}` over `/var/run/docker.sock` + `/run/docker.sock`; excludes rootless paths.
- [x] `faff container-check --json` gains a `host_socket:{present,path}` field; the human-readable form prints a warning line when present; exit codes 0/1 are unchanged.
- [x] `autonomous.engine_bounded` config knob (default `false`) is read via `faff config get`.

### From HOW (behaviour)
- [x] `lightsOutPreflight`'s container-axis refusal REFUSES (folds into the existing miss array, mints nothing) when the socket is present and `engine_bounded !== true`, with a reason naming the path + ADR-0010/ADR-0041.
- [x] `engine_bounded === true` downgrades the socket refuse to a warn (surfaced via `degrades[]`) but does not waive the containment requirement.
- [x] The autonomous-entry (non-lights-out) preflight warns once (run log + `/faff-wtf` surface) on socket presence; the `container-check` command warns mode-agnostically; neither refuses. (SKILL.md prose bullet added.)
- [x] Socket absent ⇒ every locus is byte-for-byte unchanged.

### From HOW (docs)
- [x] `docs/architecture/l4-container-permission-model.svg:79` no longer blesses "mounted socket / docker-in-docker"; names a bounded rootless nested engine as the precondition for host isolation, flags mounted-socket/privileged-dind as voiding it, and cross-references FAFF-276/rungs 2–3 for lane isolation. *(Verified in the PR diff.)*
- [x] `design/faff-external-verification-brief.md:106` corrects the guidance to the bounded-nested-engine recommendation, scoped to host isolation with the lane-isolation cross-reference. *(Gitignored — verified by file read, noted in the PR body, NOT in the diff.)*
- [x] Neither doc edit claims the engine posture delivers lane isolation / evaluator code-blindness.

### From tests
- [x] `test/container-check.test.mjs` adds `hostSocketProbe` fixtures (injected `fsq`): present/absent/both-paths/rootless-excluded, plus the `host_socket` field + exit-unchanged assertion on the real CLI.
- [x] `test/lights-out.test.mjs` adds a preflight case where a present host socket forces REFUSE (direct `lightsOutPreflight()` calls + the in-CLI `--selftest` table), and one where `engine_bounded:true` downgrades it to warn+proceed. The existing `tmpRoot()` fixture now attests `engine_bounded:true` by default so ambient host state (a real Docker socket on the CI runner or a dev laptop) never spuriously breaks an unrelated proceed-path test — exact parity with how the `CONTAINED` env fixture neutralizes the containment axis.
- [x] `faff container-check --selftest` and `faff lights-out --selftest` tables extended; `node --test` passes with zero real fs/network dependency in the new assertions.

**Eval coverage.** No LLM-judgement seam introduced (pure fs detection + deterministic policy); no grader `KIND` required.
