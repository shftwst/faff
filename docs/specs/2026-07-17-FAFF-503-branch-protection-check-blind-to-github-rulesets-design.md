# FAFF-503 — `branch-protection-check` sees GitHub rulesets: probe the effective-rules API

> Spec: faffter-dark-nlspec · 2026-07-17 · autonomous · confidence: high. Full spec on Linear FAFF-503.

This spec is for the build agent implementing FAFF-503, and for the human reviewers gating it. It describes a contained bug fix to the branch-protection probe in `plugin/skills/faff/bin/lib/merge-gate.js` and the doc/prose that describes it.

## 1. WHY — Problem and Principles

**Load-bearing model.** GitHub exposes branch protection through *two* surfaces: the legacy **classic branch-protection API** (`repos/{repo}/branches/{branch}/protection`) and, since rulesets, the **effective-rules API** (`repos/{repo}/rules/branches/{branch}`). The effective-rules API is the documented *union* — it returns every rule that applies to the branch, whether it came from a classic protection or a ruleset. The classic API is blind to rulesets: on a branch protected *only* by a ruleset it returns `404 Branch not protected`. `branch-protection-check` probes only the classic API, so it misreads ruleset-only protection as no protection at all.

**Problem statement.** On `shftwst/faff` `main` — protected only by ruleset 18852686 (required status check `validate`, PR-only squash, linear history) — `faff branch-protection-check --json` returns `{"status":"unprotected", ...}`, so the autonomous-entry preflight warns "main is unprotected" even though live required-status-check protection is in force. The fix repoints the probe at the effective-rules API, which sees the ruleset, and classifies `protected` when a `required_status_checks` rule is present.

**Design principles.**

- **Classifier stays pure and network-free.** The FAFF-350 design splits a pure classifier (`--selftest`-covered, no network) from a thin impure probe. That split is load-bearing and must survive: all network stays in the probe; every branch of the decision is exercisable by the selftest with no `gh` call.
- **Fail-closed on ambiguity.** An unreadable or unreachable probe classifies `indeterminate`, never a fabricated `protected`/`unprotected`. This is a security-adjacent preflight (branch protection is the forge-side backstop the merge floor leans on) — the safe direction on doubt is "can't confirm", which the preflight surfaces as a warning.
- **"Protected" means required-status-check protection.** The preflight exists to assert the forge will enforce CI. So `protected` is defined precisely as "a `required_status_checks` rule applies", not "some protection object exists". This narrows the classic probe's old semantics (see Design Decision Rationale) and aligns the signal with what the merge floor actually depends on.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | Node (dependency-free CLI) | Holds `classifyBranchProtection` (pure) + `cmdBranchProtectionCheck` (impure probe) + `branchProtectionSelftest` |
| `gh api repos/{repo}/rules/branches/{branch}` | GitHub REST | The effective-rules endpoint the new probe queries |
| `plugin/skills/faff/SKILL.md` (preflight prose, ~L669) | Prose | Describes the branch-protection preflight; names the probed endpoint |
| `docs/guide/cli.md` (`branch-protection-check` row, ~L49) | Prose | CLI reference row; names the probed endpoint |
| `plugin/skills/faff/bin/faff` (usage string, ~L149) | Prose | `--help` usage line; names the probed endpoint |

**Scope statement.** A localised correctness fix to one CLI probe used by the autonomous-entry branch-protection preflight; no change to any merge-gate enforcement path.

## Already shipped against this surface

Related Done work on `merge-gate.js`, none of which supersedes this premise (the ruleset-blindness of the probe is unaddressed by all of them):

- **FAFF-350** (Done) — *introduced* `classifyBranchProtection` + the classic-only probe. The origin of this defect; this ticket corrects its probe.
- **FAFF-434** (Done) — added the `merge-fence` PreToolUse hook as a compensating control *because* branch protection "can't bite" — that finding rested on the account not exposing classic protection. Rulesets do provide protection; this fix lets the preflight actually see it. Reinforces, does not supersede.
- **FAFF-366 / FAFF-369 / FAFF-376 / FAFF-375 / FAFF-526** (Done) — all touch `merge-gate.js` but concern CI observation, flag hardening, and the git-only local path; none touch the branch-protection probe.

Premise still holds → proceed.

## 2. OUT OF SCOPE

- **Merge-gate enforcement logic** — *Why:* this ticket only fixes what the preflight *reports*; `decideFloor` and the merge interlock are untouched. *Extension point:* `cmdMergeGate` / `decideFloor` in the same file.
- **Other ruleset rule types** (linear history, force-push/`non_fast_forward`, `deletion`, `pull_request`) — *Why:* the preflight's job is asserting required-status-check enforcement only. *Extension point:* extend the pure extractor to surface additional rule types, and widen the `BranchProtectionState` shape.
- **Keeping a classic-protection fallback probe** — *Why:* the effective-rules endpoint is the documented union and available on github.com and GHES ≥ 3.4; a dual-probe is dropped (see Design Decision Rationale). *Extension point:* if a classic-protected host is found whose required checks do *not* surface via the rules endpoint (see the Assumption), reintroduce a classic probe on the `unprotected`/`404` branch of `cmdBranchProtectionCheck` only.
- **Non-GitHub git hosts** — *Why:* the probe is `gh`-only, as the whole merge floor is (FAFF-430 tracks portability). *Extension point:* FAFF-430.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Classic protection API | `repos/{repo}/branches/{branch}/protection` — legacy; 404s on ruleset-only protection |
| Effective-rules API | `repos/{repo}/rules/branches/{branch}` — returns the union of all rules (classic + rulesets) applying to the branch |
| Required-status-check rule | A rule object with `type == "required_status_checks"`; its checks live at `parameters.required_status_checks[].context` |

**The effective-rules payload (empirically confirmed against `shftwst/faff` `main`).** A JSON array of rule objects, each carrying a `type`:

```
RESPONSE rules: Array<Rule>            # gh api repos/{repo}/rules/branches/{branch}
RECORD Rule:
  type: String                          # "required_status_checks" | "deletion" | "non_fast_forward"
                                        #   | "required_linear_history" | "pull_request" | ...
  parameters?: Object                   # present on some types
  # for type == "required_status_checks":
  #   parameters.required_status_checks: Array<{ context: String, integration_id?: Int }>
```

Observed empirically: an **unprotected** branch and even a **nonexistent** branch both return `[]` at exit 0 — the endpoint does *not* 404 the way the classic API does. A `404` therefore signals repo-unreachable or an endpoint absent on an old host, never "this branch is unprotected".

**`BranchProtectionState` (unchanged output shape — preserved).**

```
RECORD BranchProtectionState:
  status: "protected" | "unprotected" | "indeterminate"
  required_checks: Array<String>        # the extracted contexts (empty unless protected)
  basis: String                         # human-readable reason
  branch: String                        # added by the command
  repo: String                          # added by the command
```

**New pure helper (added; selftest-covered).**

```
FUNCTION extractRequiredChecks(rules: Array<Rule>) -> { protected: Bool, required_checks: Array<String> }
  # pure, no network — operates on an already-fetched array
```

**Probe shape (unchanged interface into the pure classifier).** `classifyBranchProtection(probe)` keeps its exact contract: `{ ok, protected, required_checks, basis }` → `BranchProtectionState`. Only how `cmdBranchProtectionCheck` *builds* `probe` changes.

**Design decisions.** See §6.

## 4. HOW — Behavior

**Architecture.** Three seams, matching the existing pure/impure split:

1. `extractRequiredChecks(rules)` — **new pure fn.** Scans the array for the `required_status_checks` rule and flattens its contexts.
2. `cmdBranchProtectionCheck` — **impure probe rewired.** Calls the effective-rules endpoint, feeds the parsed array to `extractRequiredChecks`, and builds the same `probe` shape it builds today.
3. `classifyBranchProtection(probe)` — **unchanged.** Still maps `ok:true+protected:true → protected`, `ok:true+protected:false → unprotected`, `ok:false → indeterminate`.

**`extractRequiredChecks` behaviour.**

```
FUNCTION extractRequiredChecks(rules):
  1. IF rules is not an array: RETURN { protected: false, required_checks: [] }   # defensive; caller guarantees array
  2. rsc := first rule r in rules WHERE r.type == "required_status_checks"
  3. IF rsc is absent: RETURN { protected: false, required_checks: [] }
  4. contexts := [ c.context FOR c IN (rsc.parameters?.required_status_checks OR []) IF c.context is a non-empty string ]
  5. RETURN { protected: true, required_checks: contexts }
```

Note: a `required_status_checks` rule with an empty `contexts` list still classifies `protected: true` with `required_checks: []` — the rule's presence is the protection signal; an empty context list is a well-formed (if unusual) ruleset and is not the probe's to second-guess.

**`cmdBranchProtectionCheck` probe construction (replaces the current classic-API block).**

```
PROCEDURE probe_branch(repo, branch):
  r := spawn gh api repos/{repo}/rules/branches/{branch}
  1. IF r.error (gh not runnable):
        probe := { ok: false, basis: "gh unavailable: {r.error.message}" }
  2. ELSE IF r.status == 0:
        TRY rules := JSON.parse(r.stdout)
        IF parse fails OR rules is not an array:
           probe := { ok: false, basis: "unparseable rules JSON from gh api .../rules/branches/{branch}" }
        ELSE:
           { protected, required_checks } := extractRequiredChecks(rules)
           IF protected:
              probe := { ok: true, protected: true, required_checks,
                         basis: "gh api repos/{repo}/rules/branches/{branch} — required_status_checks rule present" }
           ELSE:
              probe := { ok: true, protected: false,
                         basis: "no required-status-check rule on {branch} (rules endpoint returned {N} rule(s))" }
  3. ELSE IF r.stderr matches /404|Not Found/:
        # unlike the classic API, a 404 here is NOT "unprotected" — the rules endpoint returns [] for an
        # unprotected/nonexistent branch. A 404 means the repo is unreachable or the endpoint is absent
        # (GHES older than ruleset support) → cannot confirm.
        probe := { ok: false, basis: "rules endpoint 404 (repo unreachable or host without ruleset support) on {branch}" }
  4. ELSE:
        probe := { ok: false, basis: "gh api error ({r.status}): {first line of r.stderr}" }
  RETURN probe
```

Everything after `probe` is built is unchanged: `classifyBranchProtection(probe)` → attach `branch`/`repo` → JSON or human print → exit `0` if `protected` else `1`.

**Edge cases and error handling.**

- **Ruleset-only protected** (the repro) → `protected`, `required_checks: ["validate"]`, exit 0.
- **No required-status-check rule** (empty array, or rules present but none of type `required_status_checks`) → `unprotected`, exit 1. Fail-closed: the preflight warns.
- **Unparseable JSON at exit 0** → `indeterminate` (never a fabricated empty-green). Boundary confound: a shape change in `gh` output must not read as `[]` → `unprotected`; the "not an array" guard forces `indeterminate`.
- **404 / repo unreachable / old GHES** → `indeterminate` (warns), not `unprotected`.
- **`gh` unrunnable or other non-zero** → `indeterminate`.

**Failure modes.**

- **The failure:** a *classic*-protected branch (no ruleset) does not surface its required-status-check rule via the effective-rules endpoint, so a genuinely-protected classic repo now reads `unprotected` — a regression versus the old classic probe. *How you'd know:* run `faff branch-protection-check --json` on a classic-protected-only branch; expect `protected`. If it returns `unprotected` while `gh api .../branches/{branch}/protection` shows required checks, the union assumption is false. *What it means:* reintroduce a classic-API fallback on the `unprotected`/`404` branch only (named in OUT OF SCOPE). This rests on the Assumption below; the effective-rules endpoint is *documented* to return the union, so the risk is low but real on classic-only hosts.
- **Anti-pattern:** treating a `404` from the rules endpoint as `unprotected` (copying the classic probe's 404→unprotected mapping). Why: the rules endpoint returns `[]`, not `404`, for an unprotected branch; a 404 is an unreachable/absent-endpoint signal and must be `indeterminate`.

## 5. Scenarios — born-verifiable main objectives

```
Given a repo+branch protected only by a GitHub ruleset carrying a required_status_checks rule (context "validate")
When faff branch-protection-check --json runs against it
Then it prints {"status":"protected","required_checks":["validate"], ...} and exits 0
```

```
Given the effective-rules endpoint returns [] (branch has no rules)
When the probe classifies it
Then status is "unprotected" and the command exits 1
```

```
Given the effective-rules endpoint returns HTTP 404
When the probe classifies it
Then status is "indeterminate" (not "unprotected") and the command exits 1
```

- The pure `extractRequiredChecks` and `classifyBranchProtection` cores are exercised by `branchProtectionSelftest` with **no network** — a real ruleset-shaped array (deletion + non_fast_forward + required_status_checks + linear + pull_request) yields `{ protected: true, required_checks: ["validate"] }`; an empty array yields `{ protected: false, required_checks: [] }`.

## 6. Design Decision Rationale

**Which API does the probe query?**
- Classic only (status quo) — blind to rulesets; the bug.
- Effective-rules only — the documented union; sees classic + rulesets.
- Both — max compatibility, double the network + branches.

**Chosen:** Effective-rules API as the *sole* probe. It is the documented union of classic protection and rulesets, available on github.com and GHES ≥ 3.4 (rulesets GA). A dual-probe doubles network surface and classifier branches for a shrinking pre-3.4-GHES population that instead degrades to `indeterminate` (a warning, the safe direction) rather than silent wrongness. This directly resolves the ticket's "drop vs keep classic fallback" open question in favour of dropping.

**How are required checks extracted?**
**Chosen:** find the array element with `type == "required_status_checks"` and flatten `parameters.required_status_checks[].context`. Confirmed empirically against the live `shftwst/faff` payload (`context: "validate"`). Resolves the ticket's extraction-mapping open question.

**How does a 404 on the rules endpoint classify?**
**Chosen:** `indeterminate`. Confirmed empirically that the rules endpoint returns `[]` (exit 0), not 404, for unprotected *and* nonexistent branches; a 404 therefore indicates repo-unreachable or an endpoint absent on an old host — a cannot-confirm, not an unprotected. Resolves the ticket's reachable-but-404 open question.

**Does the pure classifier change?**
**Chosen:** no. `classifyBranchProtection` keeps its `{ ok, protected, required_checks, basis }` → state contract; only probe construction moves to the new endpoint, and a new pure `extractRequiredChecks` carries the ruleset-parsing logic (so it is selftest-covered without network). Keeps the FAFF-350 pure/impure split intact.

**What does "protected" mean now?**
**Chosen:** a `required_status_checks` rule applies. This narrows the classic probe's prior semantics (which returned `protected` for *any* protection object, even one with no required checks). The narrowing is intentional: the preflight asserts the forge will enforce CI, and a branch with, e.g., only PR-review protection and no required checks does not enforce CI — `unprotected` is the more honest signal for the merge floor's purpose. At the time of writing the merge floor depends solely on required status checks.

## 7. Open Questions and Assumptions

**Open Questions:** none — the three open questions the ticket raised (extraction mapping, drop-vs-keep classic fallback, reachable-but-404 classification) are all resolved above with empirical grounding.

**Assumptions:**

- **Assumes:** a *classic*-protected branch's `required_status_checks` also surfaces as a `required_status_checks` rule via `repos/{repo}/rules/branches/{branch}` (the effective-rules endpoint is the documented union). *Validation:* on a branch protected by classic protection only (no ruleset) with a required status check, run `gh api repos/{repo}/rules/branches/{branch}` and confirm a `type:"required_status_checks"` element is present. If absent, keep the classic fallback (OUT OF SCOPE extension point) rather than dropping it. Could not be empirically confirmed during prep (no classic-protected repo to hand); documented behaviour supports it.

## 8. DONE — Definition of Done

### From WHY
- [ ] On a ruleset-only-protected branch, `faff branch-protection-check --json` returns `status: "protected"` carrying the ruleset's required checks (the repro now passes).

### From WHAT (types and interfaces)
- [ ] New pure `extractRequiredChecks(rules)` returns `{ protected, required_checks }`, exported for the selftest.
- [ ] `BranchProtectionState` output shape (`status` / `required_checks` / `basis` / `branch` / `repo`) and the exit codes (0 `protected` / 1 not-confirmed) are unchanged.
- [ ] The status vocabulary is exactly `protected` / `unprotected` / `indeterminate`.

### From HOW (behaviour)
- [ ] The probe queries `repos/{repo}/rules/branches/{branch}` (not the classic protection endpoint).
- [ ] Exit-0 + array with a `required_status_checks` rule → `protected` with extracted contexts.
- [ ] Exit-0 + array without such a rule (including `[]`) → `unprotected`.
- [ ] Exit-0 + unparseable / non-array body → `indeterminate`.
- [ ] `404` / `Not Found` → `indeterminate` (not `unprotected`).
- [ ] `gh` unrunnable / other non-zero → `indeterminate`.

### From HOW (purity)
- [ ] `classifyBranchProtection` remains network-free; all network stays in `cmdBranchProtectionCheck`.
- [ ] `branchProtectionSelftest` gains a ruleset case (real payload array → `protected` + `["validate"]`) and an empty-array case (→ `unprotected`), and passes with no network.

### From docs
- [ ] `docs/guide/cli.md` `branch-protection-check` row updated to name the effective-rules endpoint + ruleset awareness.
- [ ] `plugin/skills/faff/SKILL.md` preflight prose (~L669) updated to name the effective-rules endpoint + ruleset awareness.
- [ ] `plugin/skills/faff/bin/faff` usage string (~L149) updated to name the effective-rules endpoint.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. faff branch-protection-check --repo shftwst/faff --branch main --json
  2. ASSERT stdout.status == "protected" AND "validate" IN stdout.required_checks AND exit == 0
  3. faff branch-protection-check --selftest   # ASSERT exit 0 (ruleset + empty-array cases pass, no network)
```

confidence: high
spec-review: approve
