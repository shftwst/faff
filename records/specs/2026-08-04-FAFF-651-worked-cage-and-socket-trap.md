# Spec — FAFF-651: one worked CI rig that passes the admission check (and the socket trap)

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-651.

## 1. WHY — problem and principle

ADR-0095 states the admission criteria and FAFF-655 shipped `faff container-check --gate` (exit 0 iff *contained* AND *no host engine socket reachable*). But the boundary decision only changes anything on the ground if a rig **actually runs that way**, and the measurement record shows the gap sharply: **none of the four measured shapes passes the gate.** From `records/spikes/2026-07-26-FAFF-654/RESULTS.md` —

- hosted-direct / self-hosted-direct: not contained (no markers) *and* a writable host socket → refuse on both counts.
- hosted-container / self-hosted-container: contained, but the host `/var/run/docker.sock` is bind-mounted in and writable → refuse on the socket.
- the socket-removed readings were taken on the *direct* (uncontained) shapes, so they still refuse.

So the shape that passes — *contained AND socket-free* — was never jointly measured. This ticket produces it: one worked rig that passes the gate, presented as an example rather than a requirement (a reference workflow is what adopters copy, so a named cage must read as *an* example, not *the* answer — this is ADR-0095's product-neutral posture). It also owns the socket-mount trap, which has no other home, and settles how `faff env` gets a container engine without a host socket.

## 2. WHAT — design (the load-bearing decisions)

**Chosen: the passing shape is a cage with no host socket reachable — and the naive "just add a job `container:`" is the trap, not the cage.** The obvious Actions move fails: when the runner host has a docker socket, `actions/runner` bind-mounts `/var/run/docker.sock` into every Linux job container (`ContainerInfo.cs:57`, source-derived per ADR-0095), so a `container:` job on such a host is *contained-with-a-host-socket* — the load-bearing refusal row — and a host-side `rm -f` right before the job does **not** help (the runner establishes the mount when it starts the container, after the pre-step, and inside the container that path is a live bind mount `rm` cannot unmount). What ADR-0095 means by "an Actions `container:` job with the socket removed" is dealing with the socket at the **runner-host level** — no host docker daemon, or rootless-only — so the runner has nothing to mount, exactly the posture the `env-rootless` job in `.github/workflows/validate.yml` demonstrates. So a job `container:` is admissible only once the runner host exposes no socket; that is a runner-host property, not something the workflow can fix inside the job.

The worked passing cages, then, are any of: a cage the runner runs the job *inside* whose entrypoint refuses the socket (**claude-box** — reads `contained` via `/.dockerenv`, no host socket, passes by construction); a Kubernetes/ARC runner pod (contained via `KUBERNETES_SERVICE_HOST`, no host socket); a devcontainer or a sysbox runtime; or a job `container:` on a runner host with no docker socket. The concrete named example is claude-box. This shape is demonstrable today: this repo's own dev container is exactly a contained-no-socket cage — `faff container-check` reports `contained (basis dockerenv)` with `host_socket.present: false`, so `--gate` passes. The doc shows that real reading as the proof that a passing cage exists and what "admitted" looks like — while stating plainly that this reading is taken in an interactive dev container, **not** from within a live Actions/self-hosted job (that live reading is FAFF-609's operator step); the "worked CI rig passes" claim therefore rests on construction (claude-box's documented contract) plus this contained-no-socket instance, not on a freshly-registered runner measured here.

**Chosen: claude-box is the example; an ARC/Kubernetes runner pod, a devcontainer, a sysbox-class runtime, and a socket-free-host `container:` job are named as equally-valid passing substrates (settles the substrate question).** The worked example is deliberately **not** presented as a single GitHub Actions shape, because the ADR's criteria are substrate-agnostic and the most obvious Actions shape — the naive job `container:` on a socket-bearing host — is the one that *fails*. A k8s runner pod reads `contained` via `KUBERNETES_SERVICE_HOST` with no host socket → passes; a devcontainer or a sysbox runtime likewise; a job `container:` passes once its runner host exposes no socket. The doc names all of these so a reader can tell, without opening the ADR, that swapping claude-box for another passing cage is expected rather than a deviation. The check is the requirement; the cage is an example.

**Chosen: the socket trap is documented exactly where someone reaching for a job `container:` will meet it.** Two places: the worked-cage section in `docs/guide/unattended.md`, and a short comment beside the admission-gate step in `operations/ci/l3-watcher.yml` (the point an adopter copying the reference thinks "why not just add `container:`?"). The trap, stated plainly: on a runner host with a docker socket, a job `container:` gets `/var/run/docker.sock` bind-mounted in (`ContainerInfo.cs:57`); a host-side `rm -f /var/run/docker.sock` in a pre-job step does **not** help, because the runner establishes the mount when it starts the container, after that step, and inside the container that path is a live bind mount `rm` cannot unmount. The fix is not an in-job scrub — it is dealing with the socket at the runner-host level (no host daemon / rootless-only, the `env-rootless` posture), which is a runner-host property (overlaps FAFF-609), or using a cage the job runs inside that never had the socket (claude-box, an ARC pod, a devcontainer).

**Chosen: `faff env` gets a bounded nested engine, never a host socket (settles the faff-env question).** Where a job needs a container engine (for `faff env`'s `docker compose up`), the cage provides a **bounded nested engine** — rootless dind, podman-in-podman, or a sysbox-class runtime — exactly the contract `docs/reference/cage-engine-acceptance.md` already states for claude-box. This does not trip the gate: `hostSocketProbe` checks only the canonical host paths (`/var/run/docker.sock`, `/run/docker.sock`) and deliberately excludes rootless paths (`/run/user/<uid>/docker.sock`), so a bounded rootless engine is invisible to it. The host-socket route is refused at L4 regardless of containment (`lights-out.js:346`), and the in-repo demonstration that the socket is removable and a bounded engine substitutable is the existing `env-rootless` job in `.github/workflows/validate.yml`. This ticket points `faff env` at the bounded-engine path and records the host socket as the dead end it is; it does not re-implement the cage's engine (that is `cage-engine-acceptance.md`'s scope).

**Chosen: service-account narrowing is FAFF-609's, not this ticket's (settles open question 1).** Containment (contained + no host socket) is what this ticket delivers and what `--gate` checks — but containment alone does **not** bound the runner's credential and `_work` reach: the runner maps its whole `_work` into the job (`ContainerInfo.cs:54`), and within the job's life the agent holds the runner's registration token and credentials. Narrowing what the runner's own service account can reach is a property of *how the runner host is registered and scoped*, which is the self-hosted-runner rig doc's concern (FAFF-609), not the cage's. So the boundary is: **this ticket owns the cage that passes the gate** (containment + socket posture + the bounded engine); **FAFF-609 owns the runner host's credential surface** (service-account narrowing, registration scope). The doc states this boundary explicitly rather than leaving the reader to guess which layer bounds what.

**Chosen: the deliverable is documentation + a real gate reading, not a freshly-registered live rig.** What is provable now, and what this ticket delivers: (a) a cage that passes `faff container-check --gate`, demonstrated with a real `--gate` → pass reading from a contained-no-socket cage; (b) that such a cage clears the lights-out preflight's **containment and host-socket legs** (the legs this ticket's subject matter governs). What is *not* in scope: standing up a freshly-registered self-hosted runner end to end (that is FAFF-609's operator rig), and the preflight's remaining **dial-coherence** legs (adversarial `spec_review` etc.), which are config an L4 consumer sets (FAFF-606). The doc is honest about the split so "the lights-out preflight clears on that job" is not read as a claim this ticket stood up a full L4 run.

**Assumes:** claude-box (or any cage meeting `docs/reference/cage-engine-acceptance.md`) is the operator's to run; FAFF-609 documents runner registration and service-account narrowing; FAFF-606 wires the L4 preflight's remaining dial-coherence config. `--gate` is on `main` (FAFF-655, PR #530); `l3-watcher.yml` is on `main` (FAFF-643).

## 3. HOW — acceptance

- `docs/guide/unattended.md` gains a worked-cage section describing **a rig that passes** the admission check: contained + no host engine socket + a bounded nested engine for `faff env`. It shows a real `faff container-check --gate` → pass reading (contained/dockerenv, `host_socket.present: false`) as the proof.
- claude-box is the concrete named example; an ARC/Kubernetes runner pod, a devcontainer, and a sysbox runtime are named as equally-valid passing substrates. A reader can tell the cage is an example, not a requirement.
- The socket trap is documented where someone reaching for a job `container:` meets it — in the worked-cage section **and** as a comment beside the admission gate in `operations/ci/l3-watcher.yml`: on a socket-bearing runner host a job `container:` gets `/var/run/docker.sock` bind-mounted in (`ContainerInfo.cs:57`), an in-job `rm -f` does not unmount it, so the fix is runner-host-level socket removal (or a cage the job runs inside), not an in-job scrub.
- The `faff env` question is settled: a bounded nested engine (rootless dind / podman / sysbox), never a host socket; the gate excludes rootless paths, and the host-socket route is refused at L4 (`lights-out.js:346`). Points at `cage-engine-acceptance.md` rather than re-implementing it.
- The scope of "the lights-out preflight clears on that job" is stated explicitly: this ticket demonstrates the preflight's **containment + host-socket legs** clear on a passing cage (which `faff container-check --gate` → pass evidences); the remaining **dial-coherence** legs (adversarial `spec_review`, etc.) are L4 config an outward-repo consumer sets (FAFF-606), and full runner registration is FAFF-609. The doc names this split so the criterion is not read as a full-L4-run claim.
- The service-account-narrowing question resolved: assigned to FAFF-609; the cage-vs-runner-host boundary is stated.
- The substrate question resolved: the worked example is substrate-honest — a cage the job runs inside (claude-box), an ARC/k8s pod, a devcontainer, a sysbox runtime, or a socket-free-host `container:` job — with claude-box as the named example and the others as equally-valid alternatives.
- No product is mandated in the normative text; no live `.github/workflows/` job is added (the "no dead label" convention); `docs/guide/` prose stays ref-free (no `FAFF-NNN` / `ADR-NNN` in enforced prose — `faff lint-refs` passes).
- `node --test` green.

### Scenarios

```
Given an operator reaching for a naive GitHub Actions job container: as their cage on a socket-bearing runner host
When they read the worked-cage section (or the l3-watcher.yml gate comment)
Then they learn the runner bind-mounts the host socket into the job container, that an in-job rm -f does not unmount it, and that the fix is runner-host-level socket removal or a cage the job runs inside.
```

```
Given a job running inside claude-box (or an ARC pod / devcontainer / sysbox cage) with no host socket mounted
When faff container-check --gate runs
Then it passes (contained AND no host socket) — the documented proof reading — and faff env uses the cage's bounded nested engine, never a host socket.
```

```
Given a reader deciding whether the named cage is mandatory
When they read the worked-cage section
Then it is visibly an example: claude-box, an ARC pod, a devcontainer, and sysbox are all named as passing, and the check — not the product — is the requirement.
```

## 4. DONE — definition of done

- [ ] `docs/guide/unattended.md` worked-cage section: a rig that passes (contained + no host socket + bounded nested engine), with a real `faff container-check --gate` → pass reading shown.
- [ ] claude-box named as the example; ARC/k8s pod, devcontainer, sysbox named as equally-valid passing substrates; visibly an example, not a requirement.
- [ ] Socket trap documented in the worked-cage section **and** beside the admission gate in `operations/ci/l3-watcher.yml`: on a socket-bearing host a job `container:` gets the socket bind-mounted (`ContainerInfo.cs:57`), an in-job `rm -f` does not unmount it, so the fix is runner-host-level socket removal (or a cage the job runs inside).
- [ ] `faff env` settled: bounded nested engine (rootless dind / podman / sysbox), never a host socket; gate excludes rootless paths; host-socket route refused at L4 (`lights-out.js:346`); points at `cage-engine-acceptance.md`.
- [ ] The "preflight clears" criterion is scoped explicitly: the containment + host-socket legs clear on a passing cage (evidenced by `--gate` → pass); the dial-coherence legs are FAFF-606 config and full runner registration is FAFF-609 — the doc states the split, and the proof reading is disclosed as a dev-container instance, not a live Actions/self-hosted job.
- [ ] Service-account-narrowing question: assigned to FAFF-609; cage-vs-runner-host boundary stated.
- [ ] Substrate question: worked example is substrate-honest — claude-box (example) plus ARC/k8s pod, devcontainer, sysbox, and socket-free-host `container:` as named alternatives.
- [ ] No product mandated in normative text; no live `.github/workflows/` job added; `docs/guide/` prose ref-free (`faff lint-refs` passes).
- [ ] `node --test` green.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
