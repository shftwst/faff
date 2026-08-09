# Spec — FAFF-646: the ADR — what bounds a faff run on a CI runner (admission criteria, not a mechanism)

> Spec: faffter-dark-nlspec · 2026-08-03 · interactive · confidence: high. Full spec on Linear FAFF-646.

## 1. WHY — problem and principle

ADR-0010 delegates the unattended blast-radius boundary to an OS-level **host-isolated container** — faff owns no sandbox and enforces nothing; it *asserts* the boundary is present (`container-check.js`). `faff container-check` recognises container **markers** (`/.dockerenv`, `/run/.containerenv`, `KUBERNETES_SERVICE_HOST`, the pid-1 `container=` convention); a self-hosted GitHub Actions runner is a bare user process and produces **none** of them. Two sibling tickets built against that reality fail in opposite directions: FAFF-643 (L3) only *warns* on `not_confirmed`, so it would drain a queue unattended on a bare host behind a warning nobody reads; FAFF-606 (L4) *hard-blocks* on the same signal, so as specified it refuses at mint on the documented rig. The ADR has to say what bounds a faff run on a CI runner, and what each autonomy level requires of it — **as admission criteria, not as a mechanism.**

**The evidence is now on record (this is what unblocked the ADR).** FAFF-654's probe measured all four job-surface columns into `records/spikes/2026-07-26-FAFF-654/RESULTS.md` (hosted-direct/container by FAFF-657, self-hosted-direct/container by FAFF-656). Three findings are load-bearing here:

1. **`containerCheck` cannot distinguish a disposable VM from a laptop.** The self-hosted-direct column on a fly.io Firecracker microVM shows **no container markers** (`/.dockerenv` absent, cgroups at `/`, `proc1.comm: init`) — identical to a bare shell. Ephemerality of the host is invisible to the check.
2. **A contained job can still reach a writable host engine socket.** The self-hosted-container column reads *contained* (`/.dockerenv` present, `/docker/<id>` cgroup) **and** `attest.canonical_socket_present: yes`, `attest.canonical_socket_writable_by_euid: yes` — the host `/var/run/docker.sock` bind-mounted into the job. Read from `actions/runner` source (`ContainerInfo.cs:57`), the runner mounts the socket into a Linux job container; FAFF-656's container column is the single *observed* instance (RESULTS.md flags that column as having no independent corroboration). The **"every job, unconditionally" universal is source-derived, not observed** — the ADR keeps that distinction rather than presenting it as measured. A writable host docker socket is root-equivalent host control (ADR-0041 decision 3) — a full escape. So *containment* and *host-reach* are orthogonal axes, exactly as `container-check.js` already models them (`containerCheck` vs `hostSocketProbe`).
3. **The runner maps its whole `_work` into the job**, not one repository's checkout (`ContainerInfo.cs:54`). FAFF-656 confirmed the whole-`_work` mount; the multi-checkout neighbour reach is *inferred* from it, not observed — the single-tenant throwaway Machine held only its own checkout (RESULTS.md records the neighbour risk as a property of a shared runner, inferred not observed).

## 2. WHAT — design (the decisions the ADR records)

**Chosen: the normative part is admission criteria, not a mechanism — and there are exactly two.** faff states: the run is **contained**, and **no host engine socket is reachable** from the job. faff provides the mechanical check (`faff container-check --gate` → pass/fail, built by FAFF-655). The operator brings **any cage that passes** — claude-box, an Actions `container:` job with the socket removed, a devcontainer, a Kubernetes runner pod, sysbox, something they wrote. **No product appears in the normative part;** a named example may appear only in a clearly non-normative illustration. This is not new — the gateway already holds the container is a substitutable mechanism and claude-box one implementation, recommended not required (`SKILL.md:647`).

**Chosen: "work scoped to this checkout" is NOT a criterion — the set is two, not three.** The runner path-maps its whole `_work` into the job (`ContainerInfo.cs:54`; FAFF-656), so on a shared persistent runner the job reaches every other checkout on the machine, and faff has no signal to verify scoping — the worktree-isolation probe proves where *faff writes*, not what the *job can reach*. An unverifiable third criterion sitting beside two verifiable ones is what teaches people to infer safety from the cage they picked. The ADR states the criterion is real but **not faff-checkable**, and therefore not part of the admission set; it is a property only the cage can guarantee.

**Chosen: a CI runner is never, by itself, the boundary — recorded, not re-argued.** Ephemerality bounds how long the mess survives, not how far it reaches: within the job's life the agent holds the checkout, the runner's credentials and registration token, and on a self-hosted runner the invoking user's home. And `containerCheck` cannot tell a disposable hosted VM from a laptop (finding 1), so no exemption can be scoped to the "safe" case even if one were wanted. This was attacked adversarially during the earlier spec-review and held; the ADR records it.

**Chosen: a disposable hosted-runner VM does not count — default no, stated honestly.** It produces no container marker, so `containerCheck` reads `not_confirmed`, and the check says so rather than guessing. The default is **no** (a disposable VM is not admissible on the strength of being disposable), because the check genuinely cannot confirm isolation and must not infer it from a substrate it cannot see.

**Chosen: the per-level posture — refuse by default when a criterion is absent, at every unattended level, with an explicit recorded opt-out.** L3 and L4 both run *unattended* (the human is out of the loop once the drain starts), and — critically — `containerCheck` **cannot tell a CI runner from a laptop**, so the floor cannot be scoped to "CI" or to "L4 only": the strictness keys on the *cage* (detectable) and the *autonomy level* (the unattended proxy), never on substrate. So:
- `autonomous.require_container` **defaults to refuse** (a missing containment boundary refuses an unattended L3/L4 run at mint), closing what is today the system's only fail-open floor (`gates.fallback`, `merge-gate`, holdout, and the L4 preflight all fail-closed; L3 containment is the sole place faff observes a missing safety property and carries on).
- The escape is an **explicit, recorded operator opt-out** — `autonomous.require_container: warn` set deliberately means "I accept running uncaged." This converts an *inherited* silent gap into a *decision*; it is never the default. Uncaged runs are pointed at a cage (claude-box or a Codex/other equivalent).
- **No migration window.** The single-operator reference install (this repo's own) already runs contained (`faff container-check` → `contained`, `host_socket.present false` on the linuxkit rig), so flipping the default breaks nothing that exists; there is no population to phase. FAFF-643's reference rig is caged from day one by construction.
- **This extends ADR-0010, it does not reverse it — the ADR body must say so plainly.** ADR-0010's headline is "assert, don't enforce": faff implements no sandbox and never refuses on its own authority. Admission-refusal is not enforcement — declining to *start* an unattended run when the asserted boundary is absent is faff refusing to *act without* a cage, not faff *implementing* one (it still owns and builds none). This closes L3 to the fail-closed posture `lights-out.js` already applies at L4 on the same signals — a narrowing of ADR-0010's prose, not a reversal. State it explicitly so a reader doesn't hit an apparent corpus contradiction.

**Chosen: `autonomous.require_branch_protection` gets the same treatment — default to safest.** It is the same shape (a prose-only `warn` default today, no JS branch) on a *different axis* (it bounds the run's reach into the repo, not the host blast radius). Decided in the same breath per the operator note: **default refuse** when branch protection on the target branch is absent for an unattended run, with the same explicit `warn` recorded opt-out and no migration. The ADR names it as a sibling fail-open floor closed by the same principle, not as a CI-cage criterion.

**Chosen: the host-socket route for in-job `faff env` is recorded as refused, with its reason** — the lights-out preflight already refuses unconditionally on a present host socket unless `autonomous.engine_bounded: true` attests a bounded nested engine (`lights-out.js:346`). The ADR records this route as refused rather than leaving it looking like a shortcut, and names the demonstration: the Actions job container fails criterion 2 by default because the runner bind-mounts the socket (`ContainerInfo.cs:57`), which is exactly why the check must be **run**, not inferred from which cage was chosen. claude-box deliberately does not mount the socket (its entrypoint refuses one) — the socket problem is a property of *that way of making a cage*, not of cages.

**Assumes:** the mechanical check (`faff container-check --gate`, its injection seam and tests) is built by **FAFF-655** (blocked by this ADR); the reference workflows adopt the gate and are caged from day one as acceptance criteria on **FAFF-643 / FAFF-606**; **FAFF-651 / FAFF-649** are worked-cage examples, not the normative answer. This ticket writes the ADR only (the re-slice of 2026-07-26 already moved the rest out).

## 3. HOW — acceptance

- An ADR under `records/adr/` stating the boundary requirement for a faff run on a CI runner, **per level**, with **no product in the normative part** (a named example only in a clearly non-normative illustration).
- The admission set is stated as **two** criteria (contained; no host engine socket reachable); "work scoped to this checkout" is recorded as real-but-not-faff-checkable and therefore excluded, with the reason.
- The per-level posture is stated as a **decision**: `require_container` defaults to **refuse** at every unattended level (L3 and L4) when containment is absent, with an explicit recorded `warn` opt-out and **no migration** (single-operator install); `require_branch_protection` gets the same default-safest treatment as a sibling fail-open floor.
- FAFF-643 and FAFF-606 each have an unambiguous answer for the documented solo-dev rig (caged from day one).
- The host-socket route for in-job `faff env` is recorded as refused with its reason; the default socket bind-mount (`ContainerInfo.cs:57`) is named as the demonstration that the check must be run, not inferred.
- The disposable-hosted-VM default is stated (no), with the reason (`containerCheck` cannot confirm isolation on a marker-less VM).
- The ADR cites the FAFF-654 record (`records/spikes/2026-07-26-FAFF-654/RESULTS.md`) and `.github/workflows/validate.yml`'s `env-rootless` job as the in-repo hosted-direct demonstration.
- No code changes: this ticket produces the ADR. The `--gate` flag, the workflow adoptions, and the worked cages are downstream tickets.

### Scenarios

```
Given a bare self-hosted runner (no container markers, host socket reachable)
When an unattended L3 or L4 run is dispatched to it under the default config
Then faff refuses at mint (containment absent), naming the missing criterion and a cage
And the refusal is not softened by autonomy level, because the check cannot tell the runner from a laptop.
```

```
Given an operator who deliberately sets autonomous.require_container: warn
When an unattended run finds the boundary absent
Then it proceeds with a recorded warning — the opt-out is an explicit decision, never a default.
```

```
Given a vanilla Actions container: job (contained, but the host docker socket bind-mounted in)
When faff container-check --gate runs
Then it fails on the host-socket criterion, demonstrating that admission is decided by the check, not by which cage was chosen.
```

## 4. DONE — definition of done

- [ ] ADR under `records/adr/` records the two admission criteria (contained; no host engine socket reachable), product-neutral in the normative part.
- [ ] "Work scoped to this checkout" recorded as real-but-not-faff-checkable, excluded from the admission set with the reason.
- [ ] Per-level posture stated as a decision: `require_container` default **refuse** at L3 and L4, explicit `warn` recorded opt-out, no migration; `require_branch_protection` same default-safest treatment.
- [ ] A CI runner recorded as not-itself-a-boundary; disposable-VM default stated (no).
- [ ] Host-socket route for in-job `faff env` recorded as refused with its reason; the default socket bind-mount named as the demonstration.
- [ ] FAFF-643 / FAFF-606 have an unambiguous cage answer; FAFF-649 reframed as a worked example, not the normative cage.
- [ ] ADR cites the FAFF-654 four-column record + the `env-rootless` job as evidence.

## ADR promotion intent

Materialise one ADR from this ticket's `Chosen:` decisions — title: *"What bounds a faff run on a CI runner — admission criteria (contained; no host engine socket reachable), product-neutral, with the per-level default-refuse posture."* It records: the two-criterion admission set; the excluded work-scoped criterion; the per-level default-refuse posture + explicit `warn` opt-out for `require_container` and `require_branch_protection`; the CI-runner-is-not-a-boundary and disposable-VM-default-no conclusions; and the refused host-socket route. Supersedes nothing; extends ADR-0010 (assert-don't-enforce) and ADR-0041 (host socket = unbounded).

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
