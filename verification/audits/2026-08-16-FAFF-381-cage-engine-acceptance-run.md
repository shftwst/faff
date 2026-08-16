# FAFF-381 cage-engine acceptance run

The joint four-point runbook (`docs/reference/cage-engine-acceptance.md`) executed inside an actual
claude-box cage on 2026-08-16, human-supervised. This closes the open half of ADR-0041 decision 3:
the boundedness criterion was attested but had never been observed end-to-end in a cage (the
2026-07-20 L4 capabilities audit, seam 2, recorded the run as "never executed"). It has now run.

## Result

**overall: PASS.** Precondition passed and all four points passed inside the cage. No cage-image
gaps were surfaced; the findings below are runbook and faff-CLI wording issues, routed to the
runbook owner, not blockers.

| Field | Value |
|---|---|
| run_date | 2026-08-16 |
| precondition_result | PASS |
| overall | PASS |

## Cage context

The session ran inside a claude-box cage that had handed over a bounded rootless nested engine.

- **Cage-identity marker:** `claude-box:latest`, digest `claude-box@sha256:e676e8cd1c939893206d228626769509afd6ecb211814fadee22c8cc1c0e67f2` (locally-built image, no registry ref; digest observed on the host that launched the cage). Container name pattern `claude-box-faff-*`.
- **Nested engine posture:** rootless. The engine's data-root is `/var/lib/claude-box-engine`, its own, distinct from the host's default `/var/lib/docker`. Docker Engine 29.7.2, Compose v5.4.0.
- **Engine socket:** the ambient engine is reached over a rootless per-user socket (no `/var/run/docker.sock`).

## Precondition

- `docker info` reachable via the ambient rootless engine context: OK.
- `docker compose version`: v5.4.0, present.
- `docker info --format '{{.SecurityOptions}}'` reports a rootless posture (parsed anchor below).

## Mechanical anchors

Machine-checkable provenance captured alongside the human observation, so a later reader can trust
the in-cage claim without re-running. faff asserts, the cage proves; human supervision is still the
final attestation.

- **container_check:** `faff container-check` run inside the cage returned `contained (basis: dockerenv)`, exit 0. This is the FAFF-42 boundary assertion.
- **security_options_allowlisted** (parsed allowlist only, raw `docker info` string not committed):

  | key | value |
  |---|---|
  | rootless | true |
  | seccomp | present |
  | apparmor | absent |
  | userns | absent |

  A `cgroupns` token was also present; it falls outside the closed allowlist set and is dropped.
- **socket_ownership:** absent. `/var/run/docker.sock` does not exist in the cage.

## The four points

| Point | Status | Evidence |
|---|---|---|
| 1. Compose up, no host socket | PASS | Synthetic minio profile → `faff env compose-gen` (1 service) → `faff env up` exit 0, 1 service healthy. `/var/run/docker.sock` absent (see point 4). |
| 2. Published port reachable from inside the cage | PASS | A cage-local process (node `fetch`) reached the published port at `localhost:9000/minio/health/ready` and got HTTP 200, exit 0. This is the rootless loopback path (slirp4netns/pasta) that can silently break while in-container healthchecks stay green. |
| 3. Clean teardown | PASS | `faff env seed` exit 0, `faff env down` exit 0. No `cage-accept` containers or volumes remained afterward. |
| 4. Isolation proof | PASS | See probe below. |

**Repo under test.** faff itself mines to an empty infra profile (no datastores or runtimes), so
`compose-gen` yields zero services and no endpoint, and point 2 cannot be exercised against it. A
synthetic minio datastore profile was used instead (the same shape the `env-rootless` CI lane uses),
which provisions a real service publishing an HTTP port with a `/minio/health/ready` route. This is
a legitimate "any acquired infra profile" per the runbook, and it is the only way to exercise point
2's published-port reachability. Recorded as finding 1 below.

### Point 4 host-fs-invisibility probe (both limbs)

The one property CI can never cover, made non-vacuously decidable.

- **Primary — host data-root not traversable as the host's.** The host's real data-root is
  `/var/lib/docker` (read on the host: `DockerRootDir=/var/lib/docker`, the default). Inside the cage
  that path is absent.
- **Live host-planted sentinel.** A marker `/tmp/faff-cage-host-sentinel-381` was created on the host
  (macOS) and confirmed present there. Inside the cage that path is absent. The cage's `/tmp` is its
  own tmpfs, so a genuinely-existing host path is proven invisible, not merely a path that never
  existed.
- **Positive control.** A cage-local marker `/tmp/faff-cage-local-control-381` is reported PRESENT by
  the same `test -e` mechanism, so the check is live rather than inert. The host sentinel's ABSENT
  result is therefore a real isolation signal.
- **Combined decision:** control PRESENT and host data-root/sentinel ABSENT → PASS.
- Supporting: host socket absent, rootless posture confirmed, `container-check` contained.

The cage root filesystem is a distinct Debian 12 (bookworm) image; the host is macOS. Only an
explicit allowlist of host paths is bind-mounted in (the workspace under test, claude-box state, and
a few tool dirs). Host paths outside that allowlist, including host `/etc`, `/tmp`, `/var/lib/docker`,
are the cage's own and not the host's.

## Routed findings

All are faff-side runbook or CLI wording issues surfaced by the run. None is a cage-image gap: the
cage passed cleanly, so there is nothing to route to claude-box.

| # | Owner | Routed to | Gap |
|---|---|---|---|
| 1 | faff runbook (`docs/reference/cage-engine-acceptance.md`) | FAFF-837 | The runbook's `cd <repo-under-test>` implies a repo with provisionable infra. A repo with none (faff itself) mines to an empty profile and yields zero services, so point 2 cannot be exercised. The runbook should name a repo with real infra, or a synthetic datastore profile, as the point-2 subject. |
| 2 | faff runbook | FAFF-838 | Point 2's snippet builds the URL as `$endpoint$hpath`, but `health_checks[].path` here is a full command string (`curl -f http://localhost:9000/minio/health/ready`), not a URL path, so the snippet as written forms a broken URL. The reachability check should curl the health URL directly (or the field should carry a path). |
| 3 | faff runbook | FAFF-839 | Point 4 says only "spot-check a known host path is absent", which passes vacuously on any fresh-tmpfs container. Recommend tightening it to the DockerRootDir-primary probe plus positive control actually used here. |
| 4 | faff CLI (`faff env compose-gen` / runbook) | FAFF-840 | `faff profile mine` emits a ```` ```faff-contract:infra-profile ```` fenced block, but `faff env compose-gen --profile` rejects that file as "malformed profile JSON". The runbook's `faff profile mine > profile.json` piped straight into `compose-gen` fails; the fence must be stripped first. Either `compose-gen` should accept the contract-fenced form, or the runbook should show the strip step. |

## FAFF-333 host-socket guidance

No discrepancy observed. FAFF-333 governs host-socket detection guidance on the lights-out
preflight. The in-cage reality matched it: no host socket is mounted (`/var/run/docker.sock` absent),
and `faff container-check` correctly reported `contained (basis: dockerenv)`. Nothing to feed back to
FAFF-333.
