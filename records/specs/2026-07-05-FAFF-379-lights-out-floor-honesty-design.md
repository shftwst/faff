# FAFF-379 — L4 lights-out preflight: make the floor surface honest

> Spec: faffter-dark-nlspec · 2026-07-05 · autonomous · confidence: high. Full spec on Linear FAFF-379.

This spec defines the fix for the vacuous `floor:worktree_isolation` assertion in the L4 lights-out preflight, and the honest re-presentation of the two static floor assertions alongside it. Audience: the build agent implementing the change in `plugin/skills/faff/bin/faff`, and human reviewers of the trust-critical preflight surface. Provenance: frontier audit finding F7 on FAFF-316 (honesty/theater class, not an exploit).

## 1. WHY — Problem and Principles

**The load-bearing model.** The lights-out preflight advertises three `floor:*` gates, but they are not one kind of thing: two (`no_execute`, `autonomous_contract`) are *static invariants of the shipped code* — properties no runtime probe can meaningfully re-verify — while one (`worktree_isolation`) names a *checkable runtime property* (the resolved worktree root is actually isolated and usable) that the code does not check. The fix is to make each floor entry honest about which kind it is: give `worktree_isolation` a real runtime check, and label the other two as static asserts on every surface that presents them — the same reachable-vs-enforced honesty split the banner already applies to guardrails.

**Problem statement.** `cmdLightsOut` constructs `worktree_isolation: !!worktreeRoot` where `worktreeRoot` always resolves to a non-empty string (env → config → `$HOME/.faff/worktrees` fallback), so the floor loop in `lightsOutPreflight` can never refuse on it — and `worktreeRoot` is never used again after that line. An auditor reading the banner's `floor: … worktree-isolation ✓ …` reads "verified" where nothing was verified. The other two floor keys are literal `true` — defensible as static invariants, but presented identically to a live check, which overstates what the preflight did.

**Design principles.**

**Fail-closed stays fail-closed.** The floor loop's refuse-on-`!== true` behaviour is kept for all three keys. The honesty fix is in what the check *does* and what the surface *claims* — never a weakening of when the preflight refuses.

**Claim exactly what was verified.** The banner and refusal details must state precisely what the `worktree_isolation` check asserts (the resolved root is outside the repo tree and usable) — not imply more (e.g. that builds provably used it; that is a graft-side concern, out of scope here).

**Side-effect-free preflight.** `lights-out --check` is documented as minting nothing. The new check must not create directories or files; it probes only.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` — `lightsOutPreflight` (~line 12463), floor loop (~12488) | JS | The refuse decision this change feeds |
| `cmdLightsOut` floor construction (~12665–12673) | JS | The vacuous `!!worktreeRoot` being replaced |
| `renderLightsOutBanner` floor line (~12526) | JS | The surface gaining checked/static labels |
| `lightsOutSelftest` (~12778) + `containerCheck(env, realFsq())` pattern | JS | In-process synthetic-probe style + the `fsq` injection seam the new check reuses |
| `test/lights-out.test.mjs` | JS | CLI-level seam tests; gains real floor coverage |
| `docs/guide/cli.md` (lights-out row), `docs/guide/unattended.md` (preflight step) | Markdown | Living guides asserting the floor is a live gate; must be aligned |

**Scope statement.** This change is confined to the L4 lights-out preflight's floor surface (construction, refusal detail, banner, selftest, tests, guides); it does not touch guardrail probing, dial-coherence, the ledger schema, or how grafts place worktrees.

## 2. OUT OF SCOPE

- **Enforcing that builds actually place worktrees under the checked root** — the check verifies the *configured isolation root* is sane; whether a graft subagent honours `FAFF_WORKTREE_ROOT` / `worktree_root` when it runs `git worktree add` is graft-skill behaviour. Why excluded: different surface (skill prose + runner dispatch), different ticket-sized change. Extension point: the graft skill's worktree-setup step and the concurrency executors' dispatch prompts.
- **Runtime verification of `no_execute` and `autonomous_contract`** — you cannot runtime-check "my own code derives no command from free text" from inside that code. Why excluded: structurally impossible; the honest treatment is the static label this spec ships. Extension point: if a future contract makes either externally probeable, flip its entry in the floor-modes map from `static` to `checked` and wire the probe in `cmdLightsOut`.
- **Retro-editing the frozen provenance docs** — `records/specs/2026-06-29-FAFF-225-…` and `records/adr/0036-…` describe the floor as designed at the time; they are historical records, not living guides. Why excluded: the repo's convention is that attached specs and ADRs record decisions forward, and this change refines rather than reverses the ADR's decision. Extension point: a superseding ADR, only if the floor model is ever redesigned wholesale.
- **Symlink-resolving the worktree root before the containment check** — `path.resolve` only; a symlink under the repo pointing outside (or vice versa) is not chased. Why excluded: exotic, and chasing realpaths adds failure modes on dangling links for a marginal gain. Extension point: swap the resolve step inside the new check function for a realpath-based one.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| checked floor entry | A floor key whose boolean comes from a genuine runtime probe run this launch |
| static floor entry | A floor key asserted as an invariant of the shipped code; recorded, labelled, but not runtime-probed — the preflight loop still refuses if it ever reads non-true (fail-closed backstop) |
| worktree root | The directory under which build worktrees are placed: `FAFF_WORKTREE_ROOT` env, else config `worktree_root`, else `$HOME/.faff/worktrees` (existing resolution order, unchanged) |
| anchor | The nearest existing ancestor of the resolved worktree root — the directory whose writability proves the root is creatable/usable |

**Types and shapes.**

```
CONST FLOOR_MODES:                    # new module const, beside LIGHTS_OUT_FLOOR_KEYS
  no_execute:          "static"
  worktree_isolation:  "checked"
  autonomous_contract: "static"

RECORD FloorFacts:                    # probes.floor — SHAPE UNCHANGED
  no_execute: Boolean
  worktree_isolation: Boolean         # now the result of a real probe
  autonomous_contract: Boolean

RECORD FloorDetail (new, optional):   # probes.floor_detail — per-key refusal detail
  worktree_isolation?: String         # specific reason when the check fails

RECORD IsolationVerdict:              # return of the new check function
  holds: Boolean
  detail: String | null               # null when holds; specific reason otherwise
```

**New function.** `checkWorktreeIsolation(rawRoot, repoRoot, fsq)` — pure over the injected `fsq` (the same injection seam `containerCheck` uses), returning an `IsolationVerdict`. Lives beside the other preflight probes in the lights-out region. (Note: `realFsq()` today exposes `{exists, readEnviron}` — the implementer adds `isDirectory`/`writable` wrappers to it, additive and harmless to existing callers.)

**Changed surfaces.**

- `cmdLightsOut` floor construction: `worktree_isolation` becomes `checkWorktreeIsolation(worktreeRoot, root, realFsq()).holds`; the verdict's `detail` (when failing) is passed as `probes.floor_detail.worktree_isolation`. The stale comment ("worktree isolation is a resolvable worktree root") is rewritten to describe the real check and the static/checked split.
- `lightsOutPreflight` floor loop: unchanged refuse condition; when a refusal fires for key `k` and `probes.floor_detail[k]` is a non-empty string, that string is the refusal's `detail`; otherwise the existing generic message stands (backward-compatible — the selftest's synthetic probes pass no detail).
- `renderLightsOutBanner` floor line: each entry renders its mode token from `FLOOR_MODES`, e.g. `floor: no-execute ✓ static · worktree-isolation ✓ checked · autonomous-contract ✓ static` (exact spacing/separators are the implementer's call; the tokens `checked` and `static` must appear per-entry and are what the selftest asserts).
- Run-ledger: the `floor` object keeps its `{key: boolean}` shape verbatim (no consumer breakage); mode honesty reaches the ledger through the persisted banner, which already lands in it.

**Design decisions** — collected with rationale in the Design Decision Rationale section; every one is closed with a `**Chosen:**` marker there.

## 4. HOW — Behavior

**Approach.** One new probe function, injected-`fsq` for testability, wired into the existing floor construction; presentation changes ripple to the banner, refusal details, selftest, tests, and the two living guides. No new plumbing shapes beyond the optional `floor_detail` passthrough.

The check, at its ambiguity points:

```
PROCEDURE checkWorktreeIsolation(raw_root, repo_root, fsq):
  1. resolved := absolute-resolve(raw_root)          # plain path resolution, no symlink chase
  2. IF resolved == repo_root OR resolved is strictly inside repo_root
     (path-segment-aware prefix test, never a bare string startsWith):
       RETURN { holds: false,
                detail: "worktree root '<resolved>' is inside the repo working tree —
                         builds would collide with the orchestrating checkout" }
  3. anchor := resolved; WHILE NOT fsq.exists(anchor): anchor := parent(anchor)
     # terminates at filesystem root, which always exists
  4. IF fsq.exists(anchor) AND NOT fsq.isDirectory(anchor):
       RETURN { holds: false, detail: "worktree root '<resolved>' collides with a
                non-directory at '<anchor>'" }
  5. IF NOT fsq.writable(anchor):                     # W_OK-style probe; NO mkdir
       RETURN { holds: false, detail: "worktree root '<resolved>' is not creatable —
                nearest existing ancestor '<anchor>' is not writable" }
  6. RETURN { holds: true, detail: null }
```

Behaviour summary: the check proves the resolved worktree root is (a) outside the repo working tree and (b) creatable/usable — the two properties "worktree isolation" actually turns on — without creating anything.

**Edge cases and error handling.**

- **`HOME` unset** — the fallback becomes the literal `~/.faff/worktrees`, which resolves relative to cwd (typically the repo root) → lands inside the repo → refuses with a path-naming detail. This flips a formerly silent vacuous-pass into a correct, explained refusal.
- **Relative `FAFF_WORKTREE_ROOT`** — resolved against cwd; if that lands inside the repo it refuses. The guides note the value should be absolute.
- **Config `worktree_root` pointing below an existing file** — step 4 catches it (anchor exists but is not a directory) → refuse with detail.
- **Deep nonexistent path (e.g. `/nonexistent/a/b`)** — anchor walks to `/`; refuses for a non-root user via step 5, which is the right answer (the root is not creatable).
- **Repo checked out *under* the worktree root** (e.g. the repo itself lives in `~/.faff/worktrees/x`) — allowed: worktrees become siblings of the repo, not children inside it; the containment test is one-directional by design.
- **All failure paths are refusals, not throws** — the check returns a verdict; `cmdLightsOut` never crashes on a weird path, it refuses with the detail. If `fsq` itself throws (permission-denied on stat), catch inside the check and return `holds: false` with the error message as detail — fail-closed.

**Failure modes.**

- **False refusals in exotic environments** (network FS with misleading W_OK, root-squash mounts). How you'd know: `floor:worktree_isolation` refusal whose detail names a path the operator knows is fine. What it means: the detail string exists precisely so this is diagnosable in one read; the operator points `FAFF_WORKTREE_ROOT` at a directory that probes cleanly. Proceed.
- **Residual theater: a verified root nothing consumes.** The check makes the *configured* isolation root honest; nothing yet forces builds to use it. How you'd know: a graft worktree appearing outside the checked root. What it means: accepted, named boundary (see Out of Scope, first item) — the banner claim is worded to what is verified, so the surface stays honest even with this gap open.

**Anti-pattern:** proving creatability by `mkdirSync` at preflight. Why: `--check` is contractually side-effect-free; the anchor-writability walk proves the same thing without writing.

**Anti-pattern:** dropping `no_execute` / `autonomous_contract` from the refuse loop because they're static. Why: the loop is a free fail-closed backstop against future wiring bugs; honesty is fixed at the presentation layer, not by weakening the gate.

## Scenarios

The main objectives, born-verifiable:

```
Given a repo root and FAFF_WORKTREE_ROOT resolving to a directory inside that repo
When faff lights-out --check --json runs (contained, all other preconditions green)
Then it exits 1 with a refusal whose gate is "floor:worktree_isolation"
  and whose detail names the resolved path
```

```
Given FAFF_WORKTREE_ROOT resolving to a writable directory outside the repo
When faff lights-out --check --json runs with all other preconditions green
Then the preflight proceeds and the banner floor line reads
  worktree-isolation as "checked" and the other two entries as "static"
```

Assertion (non-functional): `lights-out --check` performs no filesystem writes while probing the floor — the worktree root and its ancestors are stat/access-probed only.

## Design Decision Rationale

**Real check, static labels, or both?** The ticket sanctions either making `worktree_isolation` real or modelling all three as statics.

- *Real check for all three*: impossible — two are invariants of the shipped code with nothing external to probe.
- *Statics for all three*: honest but leaves value on the table — `worktree_isolation` names a genuinely checkable property, and the cheap fs helpers to check it already exist in this file.
- *Combination*: check the checkable one, label the rest.

**Chosen:** the combination — `worktree_isolation` gains a real runtime check; `no_execute` and `autonomous_contract` are labelled `static` on the banner. Grounded in the codebase evidence: the two statics have no probeable external referent, while the isolation property has one and the `fsq`/`path` machinery to verify it is already in the file. This mirrors the banner's existing reachable-vs-enforced honesty split, so the surface stays consistent with itself.

**What does the real check assert?** Candidates ranged from "path is non-empty" (still vacuous) through outside-repo + creatable, up to mkdir-probe + free-space checks.

**Chosen:** exactly two properties — resolved root strictly outside the repo working tree, and creatable/usable (nearest existing ancestor is a writable directory) — probed side-effect-free. These are the two properties isolation actually turns on; anything more (mkdir probes, symlink chasing, space checks) is gold-plating a preflight that must also stay side-effect-free under `--check`.

**Do the static keys stay in the refuse loop?** **Chosen:** yes, unchanged — the loop over `LIGHTS_OUT_FLOOR_KEYS` keeps refusing on any non-true value as a fail-closed backstop; only the presentation distinguishes checked from static. Removing them would trade a free safety property for nothing.

**Where do the mode labels live?** A restructured floor object (`{key: {holds, mode}}`) versus a parallel module const. **Chosen:** a parallel `FLOOR_MODES` module const beside `LIGHTS_OUT_FLOOR_KEYS`, read by the banner renderer. The ledger's `floor` shape stays `{key: boolean}` verbatim — no consumer (audit, runcheck, ledger readers) sees a schema change, and the persisted banner already carries the mode tokens into the ledger for auditors.

**How does a specific refusal reason travel?** The generic floor-loop message versus a per-key detail. **Chosen:** an optional `probes.floor_detail` map; the loop uses the specific string when present, else the existing generic message. One small passthrough, no signature churn, and the selftest's synthetic probes keep working unmodified.

**Which docs move?** **Chosen:** the two living guides only — `docs/guide/cli.md` (lights-out row) and `docs/guide/unattended.md` (preflight step) — updated in the same PR to say worktree isolation is genuinely checked (outside the repo tree, creatable) and the other two floor entries are static asserts. The frozen FAFF-225 spec and ADR-0036 stay untouched as historical records; this refines the ADR's decision rather than reversing it, so no superseding ADR is minted.

## Open Questions and Assumptions

None. Every decision above is closed; the check depends only on machinery already present in the file (`path`, the `fsq` injection seam, `findRoot`'s repo root already in scope as `root` inside `cmdLightsOut`).

## DONE — Definition of Done

### From WHAT (shapes and surfaces)
- [ ] `FLOOR_MODES` module const exists beside `LIGHTS_OUT_FLOOR_KEYS`, mapping the three keys to `static`/`checked`/`static`
- [ ] The minted run-ledger's `floor` object is byte-shape-identical to today (`{no_execute, worktree_isolation, autonomous_contract}` booleans)
- [ ] The floor-construction comment in `cmdLightsOut` no longer claims "resolvable worktree root"; it describes the real check and the static/checked split

### From HOW (the check)
- [ ] `checkWorktreeIsolation(rawRoot, repoRoot, fsq)` returns `{holds:false, detail}` naming the resolved path when the root is at/inside the repo tree (segment-aware containment, not bare `startsWith`)
- [ ] It returns `{holds:false, detail}` when the nearest existing ancestor is a non-directory, and when that ancestor is not writable
- [ ] It returns `{holds:true}` for a writable outside-repo root whose leaf does not yet exist (anchor-walk proves creatability)
- [ ] It performs no writes (stat/access probes only) and never throws (an `fsq` error becomes a fail-closed `{holds:false}`)

### From HOW (wiring and presentation)
- [ ] A failing check surfaces as a `floor:worktree_isolation` refusal carrying the specific detail; a floor refusal with no `floor_detail` entry still carries the existing generic message
- [ ] The banner floor line renders `checked` for worktree-isolation and `static` for the other two entries

### From HOW (selftest — `lights-out --selftest`)
- [ ] A `worktree_isolation:false` synthetic-floor case refuses with gate `floor:worktree_isolation` (closing the gap where `no_execute` was the only floor case)
- [ ] A `floor_detail` passthrough case asserts the refusal detail equals the supplied string
- [ ] A banner case asserts the ok-floor banner contains the per-entry `checked` and `static` tokens
- [ ] Direct `checkWorktreeIsolation` cases over a synthetic `fsq`: inside-repo → false, non-writable anchor → false, writable outside root with nonexistent leaf → true

### From Scenarios (CLI seam — `test/lights-out.test.mjs`)
- [ ] `FAFF_WORKTREE_ROOT` inside the tmp repo → exit 1, JSON refusals include gate `floor:worktree_isolation` with a path-naming detail
- [ ] `HOME` set to the tmp repo root with no override → the default resolution lands inside the repo → refuses (proves the default path is now a live gate)
- [ ] `FAFF_WORKTREE_ROOT` at a fresh tmpdir outside the repo → `--check` proceeds, banner carries the mode tokens
- [ ] Non-writable-ancestor CLI case is guarded to skip when running as root (chmod-based writability denial is a no-op for uid 0)

### From Design Decision Rationale (docs)
- [ ] `docs/guide/cli.md` lights-out row and `docs/guide/unattended.md` preflight step state the checked-vs-static floor split in the same PR

**Integration smoke test:**

```
1. Create tmp repo (as tmpRoot() does), coherent dial, contained env
2. Run: FAFF_WORKTREE_ROOT=<tmp repo>/wt faff lights-out --check --json
   → expect exit 1, refusals ∋ { gate: "floor:worktree_isolation" }
3. Run: FAFF_WORKTREE_ROOT=<fresh tmpdir> faff lights-out --check --json
   → expect exit 0, proceed:true, banner contains "checked" and "static"
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized — No issues.** The spec bundles two moves — a real `checkWorktreeIsolation` probe, and `checked`/`static` labels on the banner — but they are one honesty model, not two independent concerns.
- **Workstream fit — No issues.** "Trustworthy lights-out — harden & broaden (post-v1)" is the harden-the-MVP outcome this ticket serves directly.
- **Surfaced deps — one gap + one soft overlap.** The spec names a real residual — nothing forces grafts to place worktrees under the now-verified root — with an extension point but no follow-up ticket. Recommended: file a chain-gap follow-up ("grafts honour the checked worktree root") in Backlog, relatedTo FAFF-379. FAFF-333 edits the same region for a different check; serialize-preferred if both drain in one run.
- **Risk profile — No issues.** Pure fs stat/access probes over an already-present injection seam.

**Verdict:** well-shaped, buildable as-is.

## Spec review (retained verdict)

Reviewed 2026-07-05 by `faffter-noon-spec-review` (single-pass; lenses fired: architectural, infosec, QA). No blocker/major/minor objections. One rationale-prose footnote: `realFsq()` currently exposes `{exists, readEnviron}` — the `isDirectory`/`writable` wrappers are added by the implementer.

```faff-contract:spec-review-verdict
{ "verdict": "approve", "objections": [] }
```

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```

confidence: high
spec-review: approve
