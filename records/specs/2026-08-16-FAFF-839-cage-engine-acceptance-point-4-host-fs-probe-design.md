# cage-engine-acceptance point 4: non-vacuous host-fs-invisibility probe

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-839.

This spec is for the build agent and human reviewers of FAFF-839. It replaces the host-filesystem check inside **point 4** of `docs/reference/cage-engine-acceptance.md` with the two-limb probe already exercised by the FAFF-381 in-cage run, so the isolation proof stops passing vacuously. It is a documentation-only change to one runbook section.

## 1. WHY — Problem and Principles

**The load-bearing idea:** a bare "is this host path absent inside the cage?" check is only evidence of isolation if (a) the path would actually be visible were isolation broken, and (b) the check mechanism is proven live rather than inert. Point 4 today satisfies neither, so its ABSENT result carries no signal.

**Problem statement.** Point 4's host-fs check is the single line `# and the cage cannot see the host filesystem (spot-check a known host path is absent)`. A naive spot-check passes vacuously: a container gets a fresh per-container tmpfs for paths like `/run` and `/tmp`, so a host marker there is absent for essentially any container regardless of isolation, and the check would also miss a bind-mounted host `/` or `/home`. This change replaces that line with a probe whose ABSENT result is a real isolation signal.

**Design principles.**

- **Absence is only signal against a path that would otherwise be present.** The probe must target a host path that genuinely exists on the host and is not shadowed by a per-container tmpfs — the host's real Docker data-root, plus a live host-planted sentinel on a persistent host path.
- **A negative check needs a positive control.** ABSENT means nothing unless the same mechanism is shown to report PRESENT for something that is present. Control ABSENT is INVALID, never a PASS — it means the check itself is inert.
- **faff stays engine-agnostic; the runbook records the observed requirement.** The probe reads the host's real data-root from the engine rather than hard-coding `/var/lib/docker`, so it holds across engines. This mirrors the doc's existing "record the observed requirement here" stance.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `docs/reference/cage-engine-acceptance.md` (point 4, lines 65–77) | Markdown | The runbook section this edits |
| `verification/audits/2026-08-16-FAFF-381-cage-engine-acceptance-run.md` (§ Point 4 probe, finding 3) | Markdown | The in-cage run that used this probe; the source wording to fold back |

**Scope statement.** This tightens the one property CI can never cover — in-cage host-fs invisibility — within the existing four-point runbook; it changes no faff code and no other runbook point.

## 2. OUT OF SCOPE

- **The host-socket and rootless-posture checks in point 4** — Why excluded: they are already sound and unaffected by this finding. Extension point: they remain the first two lines of point 4's block, unchanged.
- **Points 1–3, the precondition, and the caveats section** — Why excluded: the finding is specific to point 4's host-fs limb. Extension point: their own routed findings (FAFF-837/838/840) own those edits.
- **Automating the probe as a `faff` subcommand** — Why excluded: point 4 is explicitly "a property of the cage image, not of faff", proven by hand under human supervision. Extension point: a future `faff container-check`-style host-fs assertion would live in the CLI, not this runbook.

## 3. WHAT — Vocabulary and content

**Vocabulary.**

| Term | Definition |
|---|---|
| Host data-root | The engine's real on-host storage directory, read on the host via `docker info --format '{{.DockerRootDir}}'` (e.g. `/var/lib/docker`) |
| Live host sentinel | A marker file planted on a persistent, host-unique path (never a tmpfs) and confirmed present on the host, so its absence inside the cage proves invisibility of a genuinely-existing path |
| Positive control | A cage-local marker confirmed PRESENT by the same `test -e` mechanism, proving the check is live rather than inert |

**What the edit produces.** Point 4's third check line is replaced by a probe with three inputs and one combined decision. The section's `**Pass:**` clause is extended to state the combined rule. The two existing checks (host socket absent; rootless posture) are retained.

**Design decision — how much of point 4 changes.** Options: (a) replace only the single host-fs comment line; (b) rewrite the whole point-4 block. The finding and the FAFF-381 run scope the defect to the host-fs limb only; the socket and rootless checks are sound. **Chosen:** (a) — replace the host-fs limb (the third comment line) and extend the Pass clause with the combined decision rule, leaving the socket and rootless-posture lines intact. Rationale: minimal, reviewable, and matches the routed finding's exact scope.

## 4. HOW — the replacement content

**Behaviour summary.** The probe reads the host's real data-root on the host, plants a live sentinel on a persistent host path, then from inside the cage asserts both are absent while a cage-local control marker is present — and gates the three results into PASS / INVALID.

The replaced host-fs limb of point 4 reads (in the runbook's existing bash-plus-prose style):

```
# --- Host-fs invisibility (replaces the vacuous spot-check) ---
# Read on the HOST (not the cage): the engine's real data-root.
#   docker info --format '{{.DockerRootDir}}'      # e.g. /var/lib/docker
# Plant a live sentinel on a persistent, host-unique path (never a tmpfs), confirmed present on the host.
#   host$ touch "$HOME/faff-cage-host-sentinel"    # example persistent host path

# Inside the cage, assert both host paths are absent and a cage-local control is present:
test -e /var/lib/docker            && echo "host data-root VISIBLE — FAIL" || echo "host data-root absent — ok"
test -e "$HOME/faff-cage-host-sentinel" && echo "host sentinel VISIBLE — FAIL" || echo "host sentinel absent — ok"
touch /tmp/faff-cage-local-control                 # cage-local marker
test -e /tmp/faff-cage-local-control && echo "control PRESENT — check is live" || echo "control ABSENT — INVALID"
```

**Combined decision** (folded into the `**Pass:**` clause):

```
PROCEDURE decide_host_fs_limb(control_present, host_root_absent, sentinel_absent):
  IF NOT control_present:
     RETURN INVALID          # the test mechanism is inert; ABSENT results carry no signal
  IF host_root_absent AND sentinel_absent:
     RETURN PASS
  RETURN FAIL                # a host path is visible inside the cage
```

**Anti-pattern:** treating a bare ABSENT as PASS without the positive control. Why: a fresh per-container tmpfs makes host markers absent regardless of isolation, so ABSENT-without-control is exactly the vacuous check being removed.

**Note on the primary path.** The `test -e /var/lib/docker` line uses the value read from `DockerRootDir` on the host; the runbook prose instructs the reader to substitute the observed data-root rather than hard-coding `/var/lib/docker` when the engine reports a different one. This keeps the runbook engine-agnostic per the caveats section.

## 5. SCENARIOS

Given point 4 has been updated with the two-limb probe
When a reader runs it inside a correctly-bounded cage (host data-root and sentinel absent, cage-local control present)
Then the combined decision returns PASS

Given the check mechanism is inert (e.g. `test -e` cannot see even a cage-local marker)
When the cage-local positive control is ABSENT
Then the combined decision returns INVALID, never PASS — the host-path ABSENT results are not trusted as an isolation signal

## 6. DESIGN DECISION RATIONALE

**How much of point 4 to change?**
- Options: replace only the host-fs limb vs rewrite the whole block.
- Rewriting risks regressing the already-sound socket/rootless checks and exceeds the routed finding's scope.
- **Chosen:** replace the host-fs limb (third comment line) and extend the Pass clause with the combined decision rule. Rationale: minimal and matches finding 3's exact scope.

**Hard-code `/var/lib/docker` or read `DockerRootDir`?**
- Options: literal `/var/lib/docker` vs the engine-reported data-root.
- A literal is wrong on any engine with a non-default data-root and contradicts the doc's engine-agnostic stance.
- **Chosen:** read the host data-root from `docker info --format '{{.DockerRootDir}}'` and substitute it, showing `/var/lib/docker` only as the default example.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:** none beyond the runbook's existing precondition (a reachable, compose-capable engine) — validated by point 4 already running after points 1–3.

## 8. DONE — Definition of Done

### From WHY
- [ ] The single line `# and the cage cannot see the host filesystem (spot-check a known host path is absent)` no longer appears in `docs/reference/cage-engine-acceptance.md`.

### From WHAT / HOW (content)
- [ ] Point 4 instructs reading the host data-root on the host via `docker info --format '{{.DockerRootDir}}'`, with `/var/lib/docker` shown as the default example and the reader told to substitute the observed value.
- [ ] Point 4 includes a live host-planted sentinel on a persistent, host-unique path (never a tmpfs), asserted absent inside the cage.
- [ ] Point 4 includes a cage-local positive control asserted PRESENT by the same `test -e` mechanism.
- [ ] The `**Pass:**` clause states the combined rule: control PRESENT and host data-root/sentinel ABSENT → PASS; control ABSENT → INVALID (never PASS).
- [ ] The existing host-socket-absent and rootless-posture checks remain in point 4, unchanged.

### From principles
- [ ] The probe reads the data-root from the engine rather than hard-coding it, preserving the doc's engine-agnostic stance.

**Integration smoke test:** re-read point 4 top-to-bottom and confirm it is internally consistent — the three inputs (host data-root, host sentinel, cage-local control) each map to one line of the combined decision, and the Pass clause names the INVALID case.

confidence: high
spec-review: approve
build-tier: standard

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" } ] }
```

## Methodology critique

Agile-delivery lens (`issue-critique`), autonomous — advisory, does not gate promotion.

- **Right-sized?** Yes. A single documentation edit to one runbook section, well under a 1–3 day unit and internally cohesive. No split or merge indicated.
- **Workstream fit?** Yes. It serves the project outcome ("Outward L4 evidence is reproducible and honestly bounded") directly — a vacuous isolation check undermines the honesty of the L4 boundedness evidence, and this makes point 4's ABSENT result a real signal.
- **Deps surfaced?** No missing blocker. The source probe already exists (FAFF-381 in-cage run, related-to link present), so there is no implicit build dependency. Watch-out only: sibling routed findings FAFF-837 / FAFF-838 / FAFF-840 edit the *same file* (`docs/reference/cage-engine-acceptance.md`) at different points — no logical dependency, but if built concurrently they may need textual merge coordination.
- **Risk profile?** Low. Documentation-only, no external dependency, no novel integration — no de-risking spike warranted.
