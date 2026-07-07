# FAFF-375 — Harden `faff merge-gate` flag surface: drop `--admin`, fence `--human-override` / `--allow-no-ci` on real interactivity

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high. Full spec on Linear FAFF-375.

This spec defines the hardening of the `faff merge-gate` CLI flag surface for the build agent implementing FAFF-375 and the humans reviewing it. It closes the two caller-trust holes the FAFF-316 frontier audit found in the merge interlock shipped by FAFF-350.

## 1. WHY — Problem and Principles

**The load-bearing model:** `faff merge-gate` is the sole sanctioned `gh pr merge` path — a mechanical interlock whose entire value is that merging does **not** depend on caller discipline. Any flag an autonomous caller can self-assert to weaken the gate converts the interlock back into caller-trust, which is exactly what FAFF-350 was built to eliminate. This change makes the dangerous flags either nonexistent (`--admin`) or structurally unreachable from the autonomous lane (`--human-override`, `--allow-no-ci`).

**Problem statement:** Today `--admin` sits in the merge-args allowlist and is forwarded verbatim to `gh pr merge`, instructing GitHub to bypass branch protection — the forge-side backstop the gate itself depends on (and which `faff branch-protection-check` exists to assert). Meanwhile `--human-override` overrides *every* blocker at once (failed CI, failed review, missing L4 holdout) fenced only by the sibling argv flag `--interactive`, and `--allow-no-ci` has no fence at all — all three are self-assertable by an autonomous caller. This change removes `--admin` and fences the two human-only flags on a genuine interactivity signal.

**Design principles:**

- **The fence must be structural, not declarative.** A CLI flag asserting "a human is here" is not evidence a human is here. The fence must read a signal the autonomous lane cannot mint by adding a token to its own argv.
- **Fail loud, before any network call.** A fenced flag from a non-interactive context is a bad invocation (exit 2 with a remedy), never a silent downgrade to the plain refusal path — silent ignoring hides misuse from the run log.
- **The pure core stays pure and untouched.** `decideFloor` (the `integrity-floor` contract) is unchanged; all hardening lands in flag parsing and shell wiring, plus one new pure fence function, keeping the existing pure-core/impure-shell split.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/faff` — `MERGE_FLAG_ALLOW` (line 13697), `parseMergeArgs` (13698–13703) | The allowlist to shrink |
| `plugin/skills/faff/bin/faff` — `cmdMergeGate` (13817–13889) | The shell where flags are read (13825–13827) and the override falls through to execute (13867–13877) |
| `plugin/skills/faff/bin/faff` — `mergeGateSelftest` (13923–13960) | Pure-core selftest to extend; registered in `REGION_SELFTEST_ARGV` (13148), run in CI |
| `test/merge-gate.test.mjs` | CLI-boundary tests via `runCli` (spawned with piped stdio — naturally non-TTY, ideal for refusal tests) |
| `docs/guide/cli.md` line 38 + USAGE (bin/faff line 5661) | Flag documentation; `faff lint-cli-doc --selftest` gates sync |
| `plugin/skills/faff-graft/SKILL.md` line 396 | The interactive no-CI confirm flow this change re-routes |

**Scope statement:** this is a flag-surface hardening of one existing subcommand plus its docs and tests; no new subcommand, no change to the floor decision logic.

## 2. OUT OF SCOPE

- **Cryptographic prevention of out-of-band `gh pr merge`** — FAFF-350's committed spec already declared this out of scope (docs/specs/2026-07-04-faff-350-faff-merge-gate-design.md line 26); a human or rogue call bypassing the CLI remains a loud off-script boundary. Extension point: forge-side branch protection (`faff branch-protection-check` + the `autonomous.require_branch_protection` knob).
- **Defending against a deliberately adversarial agent inside an interactive session.** Every signal a same-uid process can read (env vars, files, even a self-allocated pty) is in principle agent-mintable in an uncontained interactive session. The fence targets the realistic threat: a drifting or over-eager autonomous caller passing flags through its normal call path. The containment story for the truly adversarial case is the L4 container boundary (ADR-0010). Extension point: container-level mandates (deferred L4 work).
- **Editing the committed FAFF-350 spec.** It is a point-in-time record; this spec supersedes its allowlist decision and cites why (see Design Decision Rationale). Extension point: none needed — specs are append-only history.
- **Re-designing the L4 holdout or review gates themselves** — FAFF-311 / FAFF-350 own those legs; this change only closes the flags that skip them.

## 3. WHAT — Vocabulary and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Human-only flag | `--human-override` or `--allow-no-ci` — a flag that weakens the refusal path and therefore may only be honoured when a genuine human is at the process's terminal |
| Genuine interactivity signal | `process.stdin.isTTY === true` on the merge-gate process itself |
| Fence | The pure check that a human-only flag is accompanied by both `--interactive` and a genuine interactivity signal |

**Interface changes (the whole surface delta):**

```
MERGE_FLAG_ALLOW: { --squash, --merge, --rebase, --delete-branch, --auto }   # --admin REMOVED
                                                                             # "--admin" in --merge-args now → rejected token → exit 2 (existing message path)

PURE fenceHumanFlags(inputs) -> { ok: bool, violations: [string] }
  RECORD inputs:
    human_override: bool      # --human-override present
    allow_no_ci: bool         # --allow-no-ci present
    interactive: bool         # --interactive present
    stdin_is_tty: bool        # process.stdin.isTTY === true (shell supplies; undefined/false → false)
```

`decideFloor`, the `integrity-floor` contract, exit-code vocabulary (0 merge-ok / 1 refuse / 2 fail-loud), `--check-only`, and the already-merged idempotent no-op are all unchanged.

**Design decision — `--admin`:** remove from `MERGE_FLAG_ALLOW` outright, do not gate it.
**Chosen:** remove outright. No caller anywhere in `plugin/skills` passes it (the only spelled invocation, `faffter-noon-ship/SKILL.md` line 39, uses `--squash --delete-branch`), so removal breaks nobody; an admin merge bypasses branch protection — the forge-side backstop the gate's own guarantee leans on — so faff must never issue one under any lane. A human who genuinely needs a force-merge does it at the forge UI or their own terminal, which is the same loud off-script boundary FAFF-350 already accepted for out-of-band merges.

**Design decision — keep or remove the override path:** keep `--human-override` in merge-gate (fenced), rather than deleting it and making every blocked merge a human-at-the-forge action.
**Chosen:** keep, fenced. The in-CLI override preserves two things forge-UI merging loses: the audit artifact (`merge-gate-override.json` in the run-dir, which `/faff-wtf` and post-run reconciliation can see) and the singular merge path (even an override flows through the one interlock). Removal was seriously considered and rejected for those two losses; it remains the fallback if the fence proves leaky.

**Design decision — the fence signal:** `process.stdin.isTTY`, required in addition to the existing `--interactive` pairing.
**Chosen:** `isTTY` + `--interactive`, for both human-only flags. Consequence accepted deliberately: sessions driven through Claude Code's Bash tool are non-TTY, so an in-session agent — even one relaying a human's verbal "yes" — cannot execute an override; the human must run the printed merge-gate command themselves in a real terminal. That relocation of the gesture out of the agent-mediated session is the security property, not collateral damage, and it matches the existing house pattern of handing plain-terminal commands to the human for human-supervised steps. Rejected alternatives: env var (agent-mintable in its own call, strictly weaker than argv), human-minted token file (agent-mintable in any uncontained session, plus new mint/verify/expire machinery — heavier and no stronger). See Design Decision Rationale.

**Design decision — `--allow-no-ci` treatment:** same fence as `--human-override` (not dropped, not artifact-based).
**Chosen:** same fence, symmetric (`--interactive` + TTY). It has a legitimate interactive use — the graft interactive no-CI confirm — so dropping it forces forge-UI merges for a sanctioned case; an artifact path (a human-written `no-ci-allowed.json`) is agent-mintable in-session, i.e. the same hole shaped differently. Adding the previously-missing `--interactive` pairing makes the two human-only flags behave identically.

## 4. HOW — Behavior

**Wiring order in `cmdMergeGate` (fence before any network):**

```
PROCEDURE cmdMergeGate hardening:
  1. Parse flags as today (bin/faff 13819–13829)
  2. Existing required-flag / level / issue-id validation (exit 2 paths, unchanged)
  3. parseMergeArgs: "--admin" is no longer in MERGE_FLAG_ALLOW → lands in
     rejected → existing "unrecognised --merge-args token(s)" stderr + exit 2
  4. NEW: fence = fenceHumanFlags({ human_override, allow_no_ci, interactive,
                                    stdin_is_tty: process.stdin.isTTY === true })
     IF NOT fence.ok:
       write each violation to stderr, each naming the remedy
       ("run this merge-gate command yourself in a real terminal")
       return 2                       # BEFORE ghRepoSlug / any gh call —
                                      # tests need no network, misuse is loud
  5. Everything downstream unchanged: PR identity, CI observation,
     decideFloor, the (interactive && humanOverride) fall-through at
     13867–13877, --check-only return, gh spawn at 13880
```

**The pure fence:**

```
PROCEDURE fenceHumanFlags(i):
  violations = []
  1. IF i.human_override AND NOT i.stdin_is_tty:
       violations += "--human-override is human-only: stdin is not a TTY"
  2. IF i.allow_no_ci AND NOT i.stdin_is_tty:
       violations += "--allow-no-ci is human-only: stdin is not a TTY"
  3. IF i.human_override AND NOT i.interactive:
       violations += "--human-override requires --interactive"
  4. IF i.allow_no_ci AND NOT i.interactive:
       violations += "--allow-no-ci requires --interactive"      # NEW pairing
  5. RETURN { ok: violations empty, violations }
```

**Edge cases:**

- `process.stdin.isTTY` is `undefined` when stdin is piped — the `=== true` coercion makes undefined/absent read as non-TTY. Fail-closed by construction.
- Fenced flag under `--check-only`: still exit 2. The flags are human-only regardless of mode; one uniform rule, no mode-dependent carve-out.
- Neither human-only flag present: the fence is vacuously ok — the ordinary autonomous invocation (`--execute --merge-args "--squash --delete-branch"`) is untouched.
- `--interactive` alone (no human-only flag): allowed, non-fenced — it remains a declarative mode flag, consistent with the intakecheck convention elsewhere.
- Autonomous caller erroneously passes a fenced flag: exit 2 → graft/ship map fail-loud to `failed`, surfaced in the run summary — loud, never a quiet merge or a quiet downgrade.

**Caller prose update (same PR):** `plugin/skills/faff-graft/SKILL.md` line 396 (interactive no-CI confirm) currently says "On confirm … proceed to the `ship` handoff" — which today hands off to a merge-gate call that carries no `--allow-no-ci` and would refuse anyway (a latent inconsistency this change makes explicit). Rewrite that bullet: on confirm, graft prints the exact command — `faff merge-gate --pr <n> --issue <ID> --run-dir <dir> --level <L> --execute --interactive --allow-no-ci --merge-args "--squash --delete-branch"` — and asks the human to run it in their own terminal; graft then re-reads the PR state (the existing already-merged idempotent path covers verification). The equivalent blocked-merge override flow is the same shape with `--human-override`.

**Docs (same PR, lint-gated):** USAGE string (bin/faff line 5661) and `docs/guide/cli.md` line 38 — remove `--admin` from the documented allowlist, document the human-only fence (TTY + `--interactive`) and its exit-2 behaviour. `faff lint-cli-doc --selftest` gates the sync.

**Anti-pattern:** implementing the TTY check inline in `cmdMergeGate` instead of the pure `fenceHumanFlags`. Why: the selftest cannot fake a TTY on a spawned child, so the TTY-true legs are only testable through a pure function with injected inputs — the same reason `decideFloor` is pure.

**Anti-pattern:** downgrading a fence violation to the plain exit-1 refusal. Why: exit 1 reads as "floor not met" and invites retry-with-different-flags; exit 2 reads as "your invocation is wrong", which is the truth.

## 5. Scenarios

```
Given a non-TTY invocation (autonomous lane, or any agent-driven Bash call)
When merge-gate is called with --merge-args containing "--admin"
Then it exits 2 naming the rejected token, and no gh command runs
```

```
Given a non-TTY invocation with all blockers otherwise green
When merge-gate is called with --interactive --human-override (or --allow-no-ci)
Then it exits 2 naming the TTY fence and the run-it-yourself remedy, before any gh call
```

```
Given a real terminal (stdin is a TTY) and a refused floor
When a human runs merge-gate --interactive --human-override --execute
Then the override is recorded to <run-dir>/<ISSUE>/merge-gate-override.json and the merge executes
```

- Assertion: `MERGE_FLAG_ALLOW` no longer contains `--admin`; no code path can place `--admin` into the `gh pr merge` argv.
- Assertion: `decideFloor` fixtures and the `integrity-floor` contract are byte-identical to before this change.
- Assertion: the ordinary autonomous green-path invocation (no human-only flags) behaves exactly as today.

## 6. Design Decision Rationale

**Should `--admin` be removed or human-gated?** Options: (a) remove from the allowlist — simplest, zero callers affected, faff can never bypass branch protection; (b) keep but fence like the override flags — preserves a hypothetical in-CLI admin lane at the cost of keeping a protection-bypass token in the vocabulary. The FAFF-350 spec (docs/specs/2026-07-04-faff-350-faff-merge-gate-design.md line 80) put `--admin` in the allowlist and passed spec review — but that allowlist was designed as an *injection* guard (no untrusted free-text reaching the shell), not an *authority* model; the FAFF-316 audit showed `--admin` turns the injection guard into an authority-escalation channel that disables the forge backstop for both the merge floor and the merge TOCTOU. A fenced admin lane would also be faff's only flag whose effect is to defeat a control faff itself asserts (`branch-protection-check`) — incoherent.
**Chosen:** remove outright — the reversal of the reviewed FAFF-350 decision is deliberate and grounded in the audit's authority-vs-injection distinction.

**Should the override path survive at all?** Options: (a) delete `--human-override`, blocked merges become human-at-the-forge; (b) keep it behind a structural fence. Deleting is maximally simple and removes the attack surface, but loses the run-dir override audit record and forks the merge path (forge merges leave no faff-side artifact).
**Chosen:** keep, fenced — audit record + singular path outweigh the residual surface, given the fence below.

**What is the fence?** Options compared honestly against the Claude-Code caveat (an interactive *session* is still a non-TTY *process*):

| Option | Autonomous lane blocked? | In-session human relay | Verdict |
|---|---|---|---|
| Sibling argv flags (status quo) | No — self-assertable | Works | The audit finding; rejected |
| Env var | No — agent sets it in the same call | Works | Rejected: weaker than argv |
| Human-minted token file | Only inside the L4 container; mintable in any uncontained session | Works | Rejected: new machinery, no stronger than TTY where it matters |
| `process.stdin.isTTY` | Yes — Bash tool + L4 container are non-TTY | Blocked — human runs the command in a real terminal | **Chosen** |

**Chosen:** `isTTY` (plus the `--interactive` pairing, now required for both flags). At the time of writing no pty-allocation machinery exists anywhere in bin/faff or its callers, so satisfying the fence from the autonomous lane requires deliberately building one — a loud, off-policy act, not a flag. The workflow consequence (overrides happen in the human's own terminal, from a command the session prints for them) is the intended relocation of the gesture, consistent with faff's provenance stance that the human surface stays native and the machine cannot speak for the human. Whether Claude Code's `!` shell-escape yields a TTY is unverified and immaterial: if yes, it is the user's own shell issuing the command; if no, a real terminal is one window away.

**Fence-violation behaviour?** Options: exit 2 fail-loud before any network call vs silently dropping the flags and refusing normally (exit 1).
**Chosen:** exit 2, checked before `ghRepoSlug` — misuse is a caller bug and must surface as one; pre-network ordering also makes the refusal CLI-boundary-testable with zero mocking.

**Graft's interactive no-CI confirm flow?** Options: leave the prose as-is (now provably dead — the downstream merge-gate call would refuse), or re-route it through the hand-the-human-the-command pattern.
**Chosen:** re-route (one bullet edit in faff-graft SKILL.md line 396, spelled in HOW) — same PR, since leaving it stale violates the docs-never-go-stale house rule.

**Leave the FAFF-350 committed spec untouched?**
**Chosen:** yes — committed specs are point-in-time records; this spec supersedes the allowlist decision and carries the citation, so history stays honest without rewriting it.

## 7. Open Questions and Assumptions

**Open questions:** none — every decision above is closed.

**Assumptions:**

- **Assumes:** `process.stdin.isTTY` is falsy under Claude Code's Bash tool and inside the L4 container. Validation before build: run `node -e "console.log(process.stdin.isTTY)"` via the Bash tool (expect `undefined`) and, if a container run is available, the same probe there. If this assumption fails in either lane, stop and re-raise — the fence choice depends on it.

## 8. DONE — Definition of Done

### From WHY / WHAT (flag surface)
- [ ] `MERGE_FLAG_ALLOW` (bin/faff line 13697) no longer contains `--admin`; `--merge-args "--admin"` exits 2 via the existing rejected-token path
- [ ] `fenceHumanFlags` exists as a pure function taking `{human_override, allow_no_ci, interactive, stdin_is_tty}` and returning `{ok, violations}`
- [ ] `decideFloor` and the `integrity-floor` contract fixtures are unchanged (diff shows no edit)

### From HOW (wiring)
- [ ] `cmdMergeGate` calls the fence with `process.stdin.isTTY === true` after arg validation and **before** `ghRepoSlug`/any `gh` call; violations → stderr (each naming the real-terminal remedy) + exit 2
- [ ] Fence applies uniformly, including under `--check-only`
- [ ] An invocation with neither human-only flag behaves byte-identically to today
- [ ] `plugin/skills/faff-graft/SKILL.md` interactive no-CI bullet (line 396) re-routed to print-the-command-for-the-human; the override flow described the same way

### From HOW (selftest & tests)
- [ ] `mergeGateSelftest` extended: `parseMergeArgs("--admin")` → rejected; `parseMergeArgs("--squash --admin")` → rejected includes `--admin`; fence table — override/non-TTY → violation, override/TTY/no-interactive → violation, override/TTY/interactive → ok, allow-no-ci/non-TTY → violation, allow-no-ci/TTY/interactive → ok, no-flags/non-TTY → ok
- [ ] `test/merge-gate.test.mjs` adds runCli cases (spawned stdio is non-TTY by construction): `--merge-args "--admin"` → exit 2 naming the token; `--interactive --human-override` → exit 2 naming the TTY fence; `--allow-no-ci` → exit 2 — all with required flags present and no network reached
- [ ] `faff merge-gate --selftest` still exits 0 and remains wired in `REGION_SELFTEST_ARGV`

### From HOW (docs, same PR)
- [ ] USAGE (bin/faff line 5661) and `docs/guide/cli.md` line 38 updated — `--admin` gone, fence documented; `faff lint-cli-doc --selftest` passes
- [ ] Conventional commit (`fix(FAFF-375): …`)

**Integration smoke test:**

```
PROCEDURE smoke:
  1. In a repo checkout, run: faff merge-gate --pr 1 --issue FAFF-1 --run-dir /tmp/x \
       --level L3 --check-only --interactive --human-override   (stdin piped)
  2. EXPECT exit 2, stderr mentions "not a TTY", and no gh subprocess was spawned
  3. Run the same command without the two human-only flags
  4. EXPECT it proceeds to PR-identity resolution (the pre-existing behaviour)
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4) — No issues, and the bundling is correct.** The issue carries two audit findings (the `--admin` removal and the human-only fence), which superficially reads as a split candidate. It isn't: the `--admin` removal alone is an hour-scale allowlist edit — too small to stand as its own ticket — and both findings edit the same surfaces (`MERGE_FLAG_ALLOW`/`cmdMergeGate` region, `mergeGateSelftest`, `test/merge-gate.test.mjs`, the USAGE string, `docs/guide/cli.md` line 38). Split, they'd be always-ship-together siblings producing stacked PRs that conflict on every shared file. Combined, this is a coherent 1–2 day unit: one subcommand's flag surface, hardened once. Keep as-is.

**Workstream fit? (principles 1 + 5) — No issues.** "Trustworthy lights-out — harden & broaden (post-v1)" is outcome-named (trustworthy autonomous delivery), and this issue is squarely on that outcome: it converts the merge interlock's residual caller-trust flags into structural guarantees, which is the project's whole thesis. The `faff-chain-gap-fill` label matches the FAFF-316-audit-remediation lineage.

**Deps surfaced? (principle 6) — No missing blocker edge, one sequencing awareness to log.** The spec's references to FAFF-350, FAFF-316, and FAFF-311 are provenance and scoping, not consumed outputs: FAFF-350 is shipped (no edge needed to Done work), FAFF-316 is the origin audit, and FAFF-311 is explicitly fenced *out of scope* ("FAFF-311 / FAFF-350 own those legs; this change only closes the flags that skip them") — so the absence of `blockedBy` edges is honest, not a gap. The one thing worth a breadcrumb: this PR edits `plugin/skills/faff-graft/SKILL.md` line 396 (the interactive no-CI confirm), and FAFF-311 works the graft-gate area. If FAFF-311 goes in flight concurrently, the two can collide on that file — a merge-conflict hazard, not a dependency. What to do: no edge; add a one-line "touches faff-graft SKILL.md confirm flow — coordinate if FAFF-311 is in flight" note to whichever ticket ships second, or let the concurrency executor's conflict analysis serialise them.

**Risk profile? (principle 7) — No de-risking spike needed; the spec already front-loads the only real unknown.** There is no novel integration, no external dependency, no network path in the new code — the fence is a pure function with injected inputs, testable without mocking. The single environmental unknown (`process.stdin.isTTY` falsy under the Bash tool and the L4 container) is exactly the kind of assumption principle 7 wants surfaced early, and the spec handles it correctly: a cheap pre-build probe with an explicit stop-and-re-raise if it fails, listed under Assumptions. The behavioural risk (fencing `--allow-no-ci` strands graft's interactive confirm flow) is closed in the same PR by the prose re-route. Sequence this whole ticket early within the project's remaining audit-remediation work — it's a HIGH-severity finding with a small, well-de-risked footprint, i.e. maximal risk retired per unit of work.

confidence: high

spec-review: approve
