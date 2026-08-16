# Name a provisionable point-2 subject in the cage-engine-acceptance runbook

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-837.

This spec is for the build agent and human reviewers. It scopes a documentation-only change to `docs/reference/cage-engine-acceptance.md` — the joint four-point cage-engine acceptance runbook — so that its point-2 (published-port reachability) check is run against a subject that actually publishes a port, rather than being silently skipped over an empty compose. It addresses FAFF-837, surfaced as finding 1 of the FAFF-381 in-cage acceptance run.

## 1. WHY — Problem and Principles

**The load-bearing model.** Point 2 of the runbook proves the one property CI cannot: that a rootless engine's published port is reachable from the cage's *own* processes (the slirp4netns/pasta loopback path that can silently break while in-container healthchecks stay green). That proof requires a running service that publishes a port. The runbook currently tells the operator to acquire the subject by mining the repo-under-test (`faff profile mine`), but a repo with no infra artifacts — faff itself is one — mines to an empty profile, so `faff env compose-gen` yields zero services and an empty endpoint, and point 2 has nothing to hit.

**Problem statement.** The runbook opens point 1 with `cd <repo-under-test>` then `faff profile mine`, implying any repo works as the subject. Against an empty-infra repo the whole reachability proof degrades to a vacuous pass — the operator runs `curl` against an empty endpoint and moves on. The change names a subject that is guaranteed to publish a port: an explicit synthetic datastore profile (the shape the FAFF-381 run actually used and the `env-rootless` CI lane exercises), with a real repo-with-infra kept as the alternative.

**Design principles.**

- **Reproducible over incidental.** This runbook lives in the project "Outward L4 evidence is reproducible and honestly bounded". The named subject must be deterministic and self-contained, not "some repo that happens to have a Dockerfile today". The synthetic profile is authored inline in the runbook, so any reader reproduces the exact same provisioned service.
- **Compose cleanly with sibling edits.** FAFF-838 (point-2 curl snippet), FAFF-839 (point-4 probe), and FAFF-840 (profile-fence strip) all edit this same file. This change touches only the *subject-naming* surface (the precondition/point-1 framing and the one sentence in point 2 that names what is being reached), leaving the sibling edit surfaces untouched.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `docs/reference/cage-engine-acceptance.md` | Markdown | The runbook being edited. Point 1 acquires the profile; point 2 reaches the published port. |
| `verification/audits/2026-08-16-FAFF-381-cage-engine-acceptance-run.md` | Markdown | Finding 1 is the source; its "Repo under test" note records the synthetic-minio workaround. |
| `.github/workflows/validate.yml` (`env-rootless` lane) | YAML | The CI lane whose minio profile shape this runbook should mirror, so runbook and CI exercise the same subject. |
| `test/env.test.mjs` | JavaScript | Pins the exact synthetic profile shape and its provisioned output (endpoint, health route). |

**Scope statement.** A wording/example fix to one reference doc — it changes what the runbook tells the operator to point point 2 at, nothing about faff's behaviour.

## 2. OUT OF SCOPE

- **The point-2 reachability curl snippet (FAFF-838).** — The `$endpoint$hpath` URL-construction bug is a separate finding with its own ticket. **Why excluded:** disjoint defect; editing it here would collide with FAFF-838's edit surface. **Extension point:** point 2's `curl` block in the same file.
- **The point-4 host-fs probe (FAFF-839).** — Not touched. **Why excluded:** unrelated finding, separate ticket. **Extension point:** point 4 of the same file.
- **`faff profile mine` contract-fence handling (FAFF-840).** — The synthetic profile is authored by hand as plain JSON, so it carries no `faff-contract:` fence and sidesteps the compose-gen rejection entirely; this spec does not change `compose-gen`, `faff profile mine`, or add a strip step. **Why excluded:** that is FAFF-840's fix. **Extension point:** the `faff profile mine > profile.json` line on the repo-with-infra alternative path.
- **Any change to faff CLI behaviour.** — Documentation only.

## 3. WHAT — Content to add

**Vocabulary.**

| Term | Definition |
|---|---|
| point-2 subject | The service whose published port point 2 curls for reachability. Must publish a port to be non-vacuous. |
| synthetic datastore profile | A hand-authored infra-profile JSON (not mined from a repo) naming a datastore `kind`, which `faff env compose-gen` turns into a provisionable service. |

**The synthetic profile to document (verbatim shape).** The runbook must show this exact profile as the primary point-2 subject — it is the shape `test/env.test.mjs` pins and the `env-rootless` lane exercises:

```
{ "schema": 1, "datastores": [{ "kind": "minio", "evidence": "synthetic — cage-engine acceptance point-2 subject" }], "deploy_targets": [] }
```

Its provisioned output, which point 2 depends on and the runbook should state so the operator knows what "reachable" means here:

| Provisioned property | Value |
|---|---|
| service | `minio/minio` |
| published endpoint | `http://localhost:9000` |
| health route | `/minio/health/ready` |

**Design decision — which subject to name.**

- Option A: name a specific real repo that has provisionable infra. Con: fragile (no such repo is guaranteed to stay provisionable; faff itself has none; an external repo is a dependency the reader may not have).
- Option B: show the synthetic datastore profile inline as the named subject. Pro: deterministic, self-contained, mirrors CI and the FAFF-381 run exactly; no external dependency.

**Chosen:** Option B — the runbook names the inline synthetic minio datastore profile as the primary point-2 subject, and keeps "a real repo that actually has provisionable infra" as an explicitly-offered alternative for readers who have one (preserving the existing `faff profile mine` path for that case). Rationale: reproducibility is the project's whole point; the synthetic profile is the only subject the runbook can guarantee provisions a port, and it is what was actually run.

## 4. HOW — The edit

**Where.** Point 1 ("compose up with no host socket") is where the subject is acquired; its `cd <repo-under-test>` + `faff profile mine > profile.json` lines are the lines that assume a provisionable repo. The edit reframes the subject acquisition there, and adds one clarifying sentence to point 2 naming what is being reached.

**Behaviour of the revised point 1.** Present two acquisition paths, synthetic first:

```
Acquire the point-2 subject — it MUST publish a port, or point 2 is vacuous.

Preferred (deterministic, self-contained): write the synthetic minio datastore
profile — the same shape the env-rootless CI lane exercises — straight to a file:

  cat > profile.json <<'EOF'
  { "schema": 1, "datastores": [{ "kind": "minio", "evidence": "synthetic — cage-engine acceptance point-2 subject" }], "deploy_targets": [] }
  EOF

  faff env compose-gen --profile profile.json --out .faff/env/docker-compose.yml --project cage-accept > plan.json
  faff env up --plan plan.json --project cage-accept

This provisions a single minio/minio service publishing http://localhost:9000 with
health route /minio/health/ready — a real HTTP port for point 2 to reach.

Alternative (a repo that actually has provisionable infra): cd into it and mine its
profile instead —

  cd <repo-with-provisionable-infra>
  faff profile mine > profile.json   # only meaningful if the repo declares datastores/runtimes

A repo with no infra artifacts (faff itself is one) mines to an empty profile:
zero services, empty endpoint, and point 2 has nothing to exercise — use the
synthetic profile above for that repo.
```

**Anti-pattern:** naming faff's own repo (or any empty-infra repo) as the point-2 subject with a bare `faff profile mine`. Why: it mines to an empty profile and point 2 passes vacuously — the exact defect this ticket fixes.

**Behaviour of the point-2 clarification.** Add one sentence at the top of point 2 stating the subject: "With the synthetic minio profile above, the published port is `http://localhost:9000` and the health route is `/minio/health/ready`." Do **not** rewrite the existing `curl`/endpoint-extraction snippet — that is FAFF-838.

**Composition note (carried into the edit, not into the runbook prose).** Because the synthetic profile is authored inline as plain JSON, it carries no `faff-contract:` fence, so the FAFF-840 compose-gen rejection does not apply to this path. The `faff profile mine > profile.json` line survives only on the repo-with-infra alternative, where FAFF-840's fix will land independently.

## 5. SCENARIOS

```
Given a reader running the cage-engine-acceptance runbook against faff itself (no infra)
When they follow point 1 as revised
Then they are directed to the inline synthetic minio profile, and point 2 curls a real published port (http://localhost:9000) rather than an empty endpoint
```

- The documented synthetic profile is byte-identical in shape to the one in `test/env.test.mjs` (`{ schema: 1, datastores: [{ kind: "minio", ... }], deploy_targets: [] }`) and the `env-rootless` lane — runbook and CI exercise the same subject.

## 6. DESIGN DECISION RATIONALE

**Which subject does the runbook name for point 2?** Options and choice are in section 3. **Chosen:** the inline synthetic minio datastore profile as primary, real-repo-with-infra as offered alternative — deterministic, reproducible, matches CI and the actual FAFF-381 run, no external dependency. At the time of writing, `minio` is the datastore `kind` the FAFF-381 run and the CI lane both use; if the reference datastore changes, update the profile shape to match `test/env.test.mjs` and the `env-rootless` lane together.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions.**

- **Assumes:** the `minio` datastore `kind` and its `http://localhost:9000` + `/minio/health/ready` provisioned output remain what `test/env.test.mjs` and the `env-rootless` lane use. Validation: before editing, confirm the shape against `test/env.test.mjs` (currently lines ~137/330) and `.github/workflows/validate.yml`; if they have diverged, mirror the current shape rather than this spec's literal.

## 8. DONE — Definition of Done

### From WHY
- [ ] The runbook no longer presents `cd <repo-under-test>` + bare `faff profile mine` as the sole/implied way to acquire the point-2 subject.

### From WHAT / HOW
- [ ] Point 1 names an inline synthetic minio datastore profile as the primary point-2 subject, showing the exact JSON `{ "schema": 1, "datastores": [{ "kind": "minio", ... }], "deploy_targets": [] }`.
- [ ] The runbook states the provisioned endpoint (`http://localhost:9000`) and health route (`/minio/health/ready`) so the reader knows what point 2 reaches.
- [ ] A real repo-with-provisionable-infra is retained as an explicitly-offered alternative, with the empty-infra caveat spelled out.
- [ ] Point 2 gains one sentence naming the subject; its existing curl/endpoint snippet is left unchanged (FAFF-838's surface).

### Composition
- [ ] The edit touches only the subject-naming surface (precondition/point-1 acquisition + one sentence in point 2); point 4 (FAFF-839), the point-2 curl snippet (FAFF-838), and any `compose-gen`/mine-strip change (FAFF-840) are untouched.
- [ ] The documented synthetic profile shape matches `test/env.test.mjs` and the `env-rootless` lane at build time.

**Integration smoke test:** a reader following revised point 1 against a no-infra repo reaches `faff env up` with a running `minio` service and a non-empty `http://localhost:9000` endpoint for point 2.

confidence: high
build-tier: standard
spec-review: approve

## Methodology critique

Agile-delivery lens (issue-critique):

- **Right-sized?** Yes. A single reference-doc edit confined to the point-2 subject-naming surface — well under a 1–3 day unit, one concern. No split warranted.
- **Workstream fit?** Yes. Sits in "Outward L4 evidence is reproducible and honestly bounded"; the change directly serves that outcome (a reproducible, non-vacuous reachability proof).
- **Deps surfaced?** Yes. FAFF-838 / FAFF-839 / FAFF-840 edit the same file but are disjoint findings, not blockers — related-to, not blocked-by. The spec pins its edit surface so the four compose without conflict; no hidden dep.
- **Risk profile?** Low. Documentation-only, no new integration or external dependency, fully reversible via `git revert`. No de-risking spike needed.
