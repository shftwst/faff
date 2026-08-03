# Spec — FAFF-656: measure the two self-hosted columns on a fly.io runner

> Spec: faffter-dark-nlspec · 2026-08-02 · interactive · confidence: high. Full spec on Linear FAFF-656.

## 1. WHY — problem and principle

FAFF-654 built the probe and defined four job-surface columns; FAFF-657 took the two GitHub-**hosted** columns (VM dies with the job). This ticket takes the two **self-hosted** columns — `selfhosted-direct` and `selfhosted-container` — where the host **survives the job**, using the same committed probe so all four columns are comparable in one record. It is the half that blocks FAFF-646: the ADR's open question, "can faff express and check *work scoped to this checkout*?", turns on the persistent-runner `_work` path-map, which only a self-hosted reading produces. The hosted columns "answer almost nothing on their own" (FAFF-654) for that question.

This is a **measurement spike run by an operator** — it needs a real host and a real runner registration token, so it cannot be built by an agent. This spec is the runbook the operator follows; it decides nothing and recommends nothing about how faff should run (that is FAFF-646). It produces observed facts.

**Substrate: fly.io.** The throwaway host is a fly.io Machine — spin up → register → measure → destroy. A fly Machine is a **Firecracker microVM**, so a fly-hosted self-hosted runner is not bare-metal or a laptop; its containment signals reflect fly's substrate. That is a *feature* of the reading (a live data point for FAFF-646's thesis that `containerCheck` cannot tell a disposable VM from a laptop), but only if the record says so — see the substrate-stamp decision below.

## 2. WHAT — design (the runbook's load-bearing decisions)

**Chosen: a persistent fly.io Machine, registered to a scratch repo, kept up across all dispatches.** Register the runner against a **scratch repository, never `shftwst/faff`** (the security premise — no self-hosted runner is ever attached to the repo whose posture the exercise protects). Keep one Machine up for the session — **not** auto-stop / ephemeral-per-job — because the whole point is what survives the job: the persistent `_work`, the on-disk registration token, and the socket-removal-before-the-job moment.

**Chosen: stamp `substrate: fly.io Machine (Firecracker microVM)` in `RESULTS.md` provenance.** Without it a reader takes the `containment` column as generic-self-hosted; it is not. Record the fly image/size/region used, so the reading is reproducible-in-kind.

**Chosen: reuse FAFF-654's committed probe unchanged, and verify its digest on the host before teardown.** Copy `docs/spikes/2026-07-26-FAFF-654/probe.sh` to the runner; confirm `shasum -a256` = `40166f33ba093cf0f1d95a3d4ca311a7435f46647d3827e807eaeac7bbb052b7` **before the Machine is destroyed** — afterwards nothing can prove the copy was byte-identical.

**Chosen: fill the two self-hosted columns into the SAME record.** Commit both transcripts (plus their self-test and pre-checkout outputs, per the hosted pattern) into `docs/spikes/2026-07-26-FAFF-654/`, and in the existing `RESULTS.md`: flip the two `selfhosted-*` column-status lines (currently `owned_by FAFF-656`) to obtained, add each shape's observation cells to the table, and **add** the `worktree_changed_by_checkout.selfhosted-direct` / `.selfhosted-container` lines (they do not yet exist — only the hosted pair and the `.derivation` rule do; derive the two new lines per that rule). The four columns then sit in one comparable observation table.

**Chosen: `--environ-keys count`, not `names` (settles the FAFF-654 handoff note).** On a self-hosted host pid 1 may be the runner service, whose environ is documented to carry registration material — the hosted-runner argument for the `names` default does not hold here. Use `count` (emits only how many keys pid 1 has, withholding the names) as the safe self-hosted default; it costs only the key-name reading. This is a deliberate, recorded per-shape difference from the hosted columns (same key set and order; only the `environ_keys` reading differs, `count` vs `names`) — note it in provenance. (On fly, pid 1 is fly's init and the runner is a child, so pid-1's environ is fly-init's, not the runner service's — but `count` stays the conservative choice, and the operator need not eyeball a name block that `count` never emits.)

**Chosen: the ARC / Kubernetes shape is out of scope for the fly rig (settles open question 1).** An actions-runner-controller pod on Kubernetes is a *different substrate* (needs a cluster + ARC install), not a variant measurable on a fly Machine. Record it as **unmeasured / deferred** with the reason, not as a gap in this reading. Note that `KUBERNETES_SERVICE_HOST` (containerCheck's first precedence rung) will be absent on fly, so the fly reading cannot stand in for the k8s shape even by construction.

**Chosen: record the `_work` reading as-is from a single-repo throwaway; do not seed synthetic neighbours (settles open question 2).** A one-afternoon runner registered to one scratch repo shows a `_work` that holds only its own checkout. Seeding contrived neighbour checkouts produces a state that reads as representative but is not; an empty reading is equally uninformative if left unexplained. So record what a single-tenant throwaway actually shows, and state explicitly that the multi-checkout neighbour risk is a property of a **shared, long-lived** runner — inferred structurally, **not** observed here. That honest null is itself the finding FAFF-646 needs (the risk exists on shared runners; a single-tenant throwaway does not exhibit it).

**Assumes: the operator provides the substrate** — a fly.io Machine with an engine + outbound network, a scratch repo, and a registration token minted against it. This is the pre-pull prerequisite; the measurement is an operator afternoon, not an agent graft.

## 3. HOW — the runbook + acceptance

**Runbook (operator-executed; confirm current `fly` and GitHub-runner CLI syntax on the day):**

1. **Stand up a persistent fly Machine** — a Linux image with a container engine (docker/podman) + outbound network, in a region of your choice; keep it running for the session (no auto-stop). Record the image, size, and region.
2. **Create a scratch GitHub repo** (not `shftwst/faff`) and mint a **runner registration token** against it (`gh api -X POST repos/<you>/<scratch>/actions/runners/registration-token -q .token`, or the repo's New self-hosted runner page).
3. **Register the runner on the fly Machine** — download the runner package the scratch repo's New-runner page names (do not hardcode a version), `./config.sh --url https://github.com/<you>/<scratch> --token <REG_TOKEN>`, then `./run.sh`.
4. **Copy the probe + verify digest** — put `probe.sh` on the Machine, confirm its sha256 equals `40166f33…` (record the command + output; the token/registration exchange is withheld per the record's existing digest-provenance discipline — never commit a token).
5. **Take the readings** via scratch-repo workflows targeting the runner, each with `--environ-keys count`:
   - `selfhosted-direct` — `runs-on: self-hosted`, no container.
   - `selfhosted-container` — same + a `container:` key.
   - the **socket-removal-before-the-job** reading — remove the engine socket from the runner host *before* a job starts, then probe, and record its effect on the in-job path (the reading that only exists on a persistent host).
   - one self-test output + one pre-checkout listing per shape (the hosted pattern; at least one self-test at a non-zero euid reporting zero skipped).
6. **Download + commit verbatim** into `docs/spikes/2026-07-26-FAFF-654/`; fill the `selfhosted-direct` / `selfhosted-container` columns + `worktree_changed_by_checkout.selfhosted-*` in `RESULTS.md`, stamp `substrate: fly.io Machine (Firecracker microVM)` + image/size/region + the `count` mode choice in provenance.
7. **Re-verify the probe digest before teardown**, then `./config.sh remove --token <REMOVE_TOKEN>` and destroy the Machine.
8. **Record the registration + teardown steps as a byproduct** so FAFF-609 does not work them out from scratch.

**Acceptance:**

- Two transcripts (`selfhosted-direct`, `selfhosted-container`) from the committed probe, same key set + order as the hosted columns, committed verbatim.
- The probe digest compared against the committed original **before** the Machine is destroyed.
- Credential readings record reachability, never contents.
- `RESULTS.md` fills the two self-hosted columns and **adds** their `worktree_changed_by_checkout` lines (they don't pre-exist), and stamps the fly.io substrate (image/size/region) + the `--environ-keys count` choice in provenance.
- The socket-removal-before-the-job reading is recorded, with its effect (or lack of one) on the in-job path.
- The ARC/Kubernetes shape is recorded as deferred (different substrate), not as a gap.
- The `_work` reading is recorded as observed on a single-tenant throwaway, with the shared-runner neighbour risk stated as structural/inferred, not measured.
- Deregistration + host destruction recorded as an operator attestation (not a checkable artifact).
- Registration + teardown steps recorded as a byproduct for FAFF-609.
- `probe.sh` byte-unchanged.

### Scenarios

```
Given a persistent fly.io Machine running a self-hosted runner registered to a scratch repo
When the committed probe runs in the selfhosted-direct and selfhosted-container shapes
Then two transcripts with the hosted key set are committed, and RESULTS.md's two self-hosted columns and their worktree_changed_by_checkout are filled, substrate-stamped fly.io.
```

```
Given a single-repo throwaway runner whose _work holds only its own checkout
When the _work reading is recorded
Then it is stated as a single-tenant observation, and the multi-checkout neighbour risk is recorded as a property of shared long-lived runners, inferred not measured.
```

```
Given pid 1 on the runner may carry registration material
When the probe runs
Then it is invoked with --environ-keys count, and RESULTS.md's provenance records the mode choice as a per-shape difference from the hosted columns.
```

## 4. DONE — definition of done

- [ ] `selfhosted-direct` + `selfhosted-container` transcripts committed verbatim (same key set/order as hosted), plus a self-test + pre-checkout per shape.
- [ ] Probe digest verified against `40166f33…` on the host before teardown.
- [ ] `RESULTS.md` fills both self-hosted columns and **adds** `worktree_changed_by_checkout.selfhosted-*` (new lines), stamps `substrate: fly.io Machine (Firecracker microVM)` + image/size/region + the `--environ-keys count` choice.
- [ ] Socket-removal-before-the-job reading recorded with its effect.
- [ ] ARC/Kubernetes recorded as deferred (different substrate); `_work` recorded as single-tenant with the shared-runner risk stated as inferred.
- [ ] Credential readings record reachability, never contents; no token/IP committed.
- [ ] Deregistration + host destruction recorded as an operator attestation; registration + teardown steps recorded as a byproduct for FAFF-609.
- [ ] `probe.sh` byte-unchanged.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
