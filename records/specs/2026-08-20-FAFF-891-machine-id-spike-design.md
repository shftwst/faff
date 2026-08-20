# FAFF-891 — Spike: prove the machine_id source is readable AND collision-resistant across bare host / container / CI

> Spec: faffter-dark-nlspec · 2026-08-20 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-891.

This spec is for the agent running the spike and the humans reviewing it. It is a de-risking spike carved from FAFF-889: settle, with evidence, the `machine_id` source that FAFF-889's same-box fast-path reclaim will be gated on, before that fast path is built.

## 1. WHY — problem and principles

**The hazard being de-risked.** FAFF-889 adds a same-box fast-path reclaim to the build-queue mutex: when a claim's `machine_id` matches the reader's, the reader trusts a live local heartbeat-file read and reclaims a crashed claim with no staleness wait. That gate is only safe if two distinct hosts never share a `machine_id`. If they collide (the FAFF-889 §4.6 "too few ids" case), box B takes the no-wait path against box A's genuinely-live remote claim and both build — the double-build the mutex exists to prevent, caught only by rebase-before-merge. FAFF-889 mandates a collision-resistant source but leaves the cross-environment proof as prose; the certified spec-review (2026-08-20, QA critical) ruled that unverifiable and required a real blocking dependency. This spike is that dependency.

**What the spike must settle (not build).** A spike's output is a decision plus evidence plus a reusable test harness — not the FAFF-889 feature. Concretely: which source `thisMachineId()` reads, proof it is readable and distinct per host in each target environment, and a negative-test harness FAFF-889 adopts verbatim.

**Design principles.**

**Fail toward uniqueness, never toward a shared name.** A too-many-ids outcome (an id that changes across a container restart) only costs the fast-path optimisation — FAFF-889 degrades to the safe cross-box row. A too-few-ids outcome (a shared id) is the double-build hazard. So on any doubt the source must mint a fresh per-host value, never fall back to a bare hostname.

**A bare hostname is forbidden as a source, not merely deprioritised.** Container and CI hosts routinely share a hostname, so a hostname is the exact input that manufactures the collision. The id-source selector must reject it structurally, so a same-name two-host collision is unconstructable, not just unlikely.

**The id gates *when*, never *who wins*.** FAFF-889's CAS + head-confirm remain the arbiter; the machine_id only decides whether the no-wait fast path is eligible. The spike does not change that invariant — it only makes the eligibility input trustworthy.

**Reference context.**

| System | Location | Relevance |
|---|---|---|
| owner snapshot (no machine id today) | `plugin/skills/faff/bin/lib/bundle.js` (claim owner: `session_id` + `pid` + `epoch`) | Confirms `machine_id` is a genuinely new `claim.json` field; there is no existing id to reuse. |
| `homeDir(env)` | `plugin/skills/faff/bin/lib/shared-infra.js` ~517 | The durable per-user path root; a minted per-host UUID persists under it (or under the run root) so it survives across runs. |
| `.faff/` run root | repo-root `.faff/` (gitignored) | Alternative durable location for a minted id; per-checkout, so a per-host id must live above a worktree, under `homeDir`. |
| FAFF-889 §4.3 / §4.6 / §5 | FAFF-889 spec (Linear) | The consumer: the same-box fast path, the two failure modes, and the "machine_id collision is unconstructable" oracle this spike's harness backs. |

**Scope.** A time-boxed investigation in the shared coordination layer. It writes a finding and a test harness; it does not wire `buildClaimStore`.

## 2. OUT OF SCOPE

- **`buildClaimStore` / `claimStoreCore` / `release` / `buildClaimStaleAware`** — FAFF-889 owns these. The spike delivers only the id source + its harness, which FAFF-889 consumes.
- **Changing the owner snapshot shape** — beyond confirming where `machine_id` will be added; the field is added by FAFF-889.
- **A network-derived identity** (MAC address, cloud instance-metadata) — out of scope for v1; `/etc/machine-id` plus a minted UUID cover the target environments without a network dependency.

## 3. WHAT — the source, the function, the harness

**Vocabulary.**

| Term | Definition |
|---|---|
| `thisMachineId()` | The resolver FAFF-889 calls; returns a stable, collision-resistant per-host string. |
| Minted id | A UUID generated once and persisted to a durable per-host path, reused thereafter. |
| Source selector | The ordered resolution `thisMachineId()` walks; the unit that must reject a bare hostname. |

**Chosen: source order — OS machine id first, a minted durable UUID second, never a hostname.**

```
FUNCTION thisMachineId(env, fs):
  1. os := readFirstReadable(["/etc/machine-id", "/var/lib/dbus/machine-id"])   # Linux
        OR platformMachineId()                                                 # macOS: IOPlatformUUID; win: MachineGuid
     IF os is a non-empty, non-placeholder value -> RETURN hash(os)            # hashed so the raw host id is not leaked into a git ref
  2. path := <homeDir>/.faff/machine-id                                        # durable, above any worktree
     IF exists(path) -> RETURN read(path)
     minted := randomUUID(); atomicWrite(path, minted); RETURN minted           # mint-once, reused
  # NO step 3. A bare hostname is never returned.
```

- **Step 1 (OS machine id)** is stable across reboots and distinct per install; hashed before use so a raw host identifier never lands in a pushed git ref.
- **Step 2 (minted UUID)** covers hosts with no stable OS id (some containers), persisted under `homeDir` so it survives across runs and is distinct per host by construction (`randomUUID` collision probability is negligible).
- **No hostname fallback.** The selector has no branch that returns `os.hostname()`; a test asserts this structurally (below).

**The negative-test harness (the deliverable FAFF-889 adopts).**

| Test | Assertion |
|---|---|
| distinct-per-host | Two independent work roots / mocked hosts resolve to **different** ids (OS-id path and minted-UUID path each). |
| container hostname-collision | Two mocked hosts sharing a hostname but distinct OS ids / minted UUIDs still resolve **distinct** — the collision is not constructible from a shared hostname. |
| hostname-source-rejected | The source selector, fed only a hostname (OS id + minted path both unavailable/mocked absent), does **not** return the hostname — it mints instead; a hostname value never becomes the id. |
| readable-per-env | On bare host, in a container, and in CI, `thisMachineId()` returns a non-empty stable value across two calls (idempotent). |

## 4. HOW — the investigation

1. **Confirm readability per environment.** Run `thisMachineId()` on: a bare host (developer machine), inside a container (e.g. the repo's own container image), and in CI (a workflow step). Record the resolved source (OS id vs minted) and the value's stability across two calls in each.
2. **Confirm distinctness.** On two genuinely-separate hosts in each environment class available, assert distinct ids. Where a second physical host isn't available (CI), simulate via two work roots / mocked source files, and note the simulation in the finding.
3. **Confirm the hostname rejection.** Exercise the selector with OS-id and minted-path both absent and only a hostname available; assert it mints a UUID rather than returning the hostname.
4. **Write the harness** as a test file FAFF-889's build imports, covering the four rows in §3.
5. **Record the finding** on FAFF-891: the chosen source, per-environment readability evidence, the collision negative result, and the harness location.

**Chosen: simulate the second host where a real one is unavailable, and say so.** A cross-host distinctness claim ideally uses two real hosts; CI cannot always provide that. The finding states, per environment, whether distinctness was shown on two real hosts or simulated via mocked source files — never presenting a simulation as a real two-host result (the honesty-of-evidence rule).

**Assumes:** `randomUUID` (Node `crypto.randomUUID`) is available in the faff runtime. *Validate:* it is a built-in in the Node versions faff already targets; confirm at the top of the harness.

## 5. Scenarios / oracles

```
Given two hosts with distinct /etc/machine-id values
When each calls thisMachineId()
Then the two results differ (distinct-per-host)
```

```
Given two hosts sharing a hostname but with distinct OS machine ids (the container case)
When each calls thisMachineId()
Then the results still differ — a shared hostname cannot manufacture a collision
```

```
Given a host with no OS machine id and no prior minted id, only a resolvable hostname
When thisMachineId() runs
Then it mints and persists a fresh UUID and returns THAT, never the hostname
```

```
Given the same host across two calls
When thisMachineId() runs twice
Then it returns the identical value both times (idempotent / stable)
```

## 6. Design decision rationale

**Source order?** OS-id-first vs mint-first. OS id is stable and free where present; minting is the universal fallback. **Chosen: OS id (hashed) first, minted durable UUID second, no hostname.**

**Where does a minted id live?** Per-checkout `.faff/` vs per-user `homeDir`. A per-checkout path differs per worktree on one host, breaking same-host matching. **Chosen: `<homeDir>/.faff/machine-id`, above any worktree.**

**Real vs simulated second host?** **Chosen: real where available, mocked where not, always labelled** — a simulation is never reported as a two-real-host result.

## 7. Open questions and assumptions

**Open questions.** None blocking. Whether to hash the OS machine id (privacy) vs use it raw is settled to hashed (§3) so a raw host id never enters a git ref.

**Assumptions.**
- **Assumes:** `crypto.randomUUID` is available (validated in the harness).
- **Assumes:** `homeDir` is writable in each target environment; where it is not (a read-only CI home), the minted-id branch is exercised via a mocked writable path and the finding notes it.

## 8. DONE

- [ ] `thisMachineId()` is prototyped with the §3 source order; no branch returns a bare hostname.
- [ ] Readability shown on bare host, in a container, and in CI; the resolved source and cross-call stability recorded per environment.
- [ ] Distinctness shown across two hosts per environment (real or labelled-simulated); the container hostname-collision case returns distinct ids.
- [ ] The source selector provably rejects a bare hostname (it mints instead); a test asserts a hostname value never becomes the id.
- [ ] The negative-test harness (four rows in §3) is written and located for FAFF-889 to adopt.
- [ ] A finding is recorded on FAFF-891 (chosen source, per-environment evidence, collision negative, harness location); FAFF-889 is unblocked.

confidence: high
build-tier: standard
