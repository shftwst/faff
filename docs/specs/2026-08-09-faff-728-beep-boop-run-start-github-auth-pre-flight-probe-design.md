# FAFF-728 — beep-boop run-start GitHub auth pre-flight probe

> Spec: faffter-dark-nlspec · 2026-08-09 · autonomous · confidence: high. Full spec on Linear FAFF-728.

This spec is for the build agent and human reviewers. It addresses FAFF-728: a `/faff-beep-boop` autonomous run must confirm the GitHub push credential is live **at kickoff**, before it commits tokens to a run whose entire build/delivery phase would be dead. It defines a read-only auth probe, a new `faff` CLI subcommand, and the run-start wiring that surfaces a dead credential loudly instead of at the mid-run delivery gate.

## 1. WHY — Problem and Principles

**The load-bearing model:** a beep-boop run uses two independent credentials — the **tracker** credential (Linear MCP), which drives tidy + prep + spec production, and the **GitHub** credential (`GH_TOKEN` / `gh` auth), which every push/PR/merge depends on. The tracker credential being healthy says nothing about the GitHub one. A read-only `gh api user` probe at run start settles the GitHub credential's liveness cheaply, before any build tokens are spent.

**Problem statement:** today a run with a malformed/expired `GH_TOKEN` mints its queue, runs the whole prep/spec pass, and only discovers the dead credential far downstream — at graft's delivery gate (`not-ready:precondition:push`) or not clearly at all. The operator has committed a run that can never deliver. This change probes the GitHub credential at kickoff and surfaces a dead one loudly and precisely.

**Design principles:**

- **Name the fault, not a generic error.** The kickoff message must say "GitHub auth is dead, re-auth" — distinguishable from a network blip and from a per-issue build failure. A generic precondition error discovered mid-run is exactly the failure being removed.
- **The tracker credential must never mask the GitHub one.** The probe targets `gh`/GitHub directly, so a healthy Linear connection cannot make a dead push credential look fine.
- **Respect the no-prompt invariant.** An autonomous run never adds a mid-run interactive gate (gateway → Autonomous Mode Contract). "Proceed specs-only knowingly" is achieved by the default warn-and-continue posture plus a loud kickoff surface the operator sees, not by a new prompt.
- **Fail toward advisory, escalate only on opt-in.** Mirror the existing container / branch-protection entry preflights: warn-and-continue by default, block only under an explicit opt-in knob.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `skills/faff/bin/lib/merge-gate.js` → `cmdBranchProtectionCheck` | Node | The exact probe template: a read-only `gh` API probe at autonomous entry, `--json` / `--selftest` / classify-with-`basis`, exit-code-mapped. Also hosts the reusable `ghJson` helper. |
| `skills/faff/bin/faff` → `COMMANDS` map | Node | Where a new subcommand registers (`"branch-protection-check": cmdBranchProtectionCheck`, etc.). |
| `skills/faff-beep-boop/SKILL.md` → `## Install-health preflight` + `## Full pipeline` | prose | Where a run-start preflight slots in and how a kickoff warning is prepended to `.faff/runs/<run-id>/summary.md` + the tracker status post. |
| gateway `faff/SKILL.md` → Autonomous Mode Contract → container/branch-protection/host-socket preflight bullets | prose | The prose pattern each entry preflight follows (warn default + opt-in `block` knob); the new bullet mirrors it. |
| `skills/faffter-noon-ship/SKILL.md` → push precondition (FAFF-4) | prose | The existing mid-run delivery-gate net this ticket is explicitly distinct from — the warn-mode safety net that still parks build issues gracefully. |

**Scope statement:** this adds one read-only GitHub-auth preflight at the beep-boop autonomous-entry preflight point, next to the container and branch-protection preflights — it does not touch the delivery gate, the merge floor, or per-issue build flow.

## 2. OUT OF SCOPE

- **Push-permission probe (`git push --dry-run`).** — A dry-run push confirms write permission to a specific ref, not credential liveness, and fails for non-auth reasons (branch protection, no remote, protected ref). Conflating it with auth muddies the precise "re-auth" message. **Extension point:** a follow-up may add a `--push-check` flag to the new subcommand that runs `git push --dry-run` against the origin and reports a separate `push-denied` status.
- **The Claude/MCP-session auth-expiry half.** — Stays with FAFF-590 (parked, harness-layer, now largely moot given the long-lived non-refreshing session token). **Extension point:** FAFF-590 itself.
- **Push-alerting / andon escalation of the kickoff signal.** — Whether "run needs re-auth at kickoff" fires an external alert belongs to FAFF-386. This ticket surfaces the signal in the run summary + tracker post + `/faff-wtf`; routing it to an alert channel is FAFF-386. **Extension point:** FAFF-386's andon channel consumes the surfaced signal.
- **Tracker-credential health probe.** — Out of scope; the tracker is exercised immediately by tidy/prep, so a dead tracker credential already fails fast. This probe is GitHub-only.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| auth pre-flight | The read-only `gh api user` probe run once at beep-boop autonomous entry. |
| authed / auth-failed / indeterminate | The three classified probe outcomes (see below). |

**The classified probe result.** The new subcommand emits a small status record (JSON under `--json`, one human line otherwise):

```
RECORD GithubAuthStatus:
  status: Enum { authed, auth-failed, indeterminate }
  basis: String              # human-readable reason, always present
  login: String | null       # the authenticated GitHub login when status == authed
```

- **authed** — `gh api user` returned exit 0 with a parseable user object (a live credential). `login` set.
- **auth-failed** — `gh` ran but the API rejected the credential: HTTP 401/403, or a `gh` "not logged in"/bad-credentials error. This is the loud, actionable outcome ("re-auth").
- **indeterminate** — `gh` could not run or the failure is not attributably an auth failure: binary missing, network error/timeout, or an unrecognised non-auth error status. Advisory only — not a "re-auth" claim.

**New CLI subcommand — `faff github-auth-check`.**

```
faff github-auth-check [--json] [--selftest]
  exit 0  -> status == authed
  exit 1  -> status == auth-failed OR indeterminate   (mirrors branch-protection-check: 0 = confirmed-good, 1 = otherwise)
  --json      -> print the GithubAuthStatus record as one JSON line
  (no --json) -> print "<status> (basis: <basis>)" ; append " — <login>" when authed
  --selftest  -> the standard offline self-test hook every probe subcommand carries
```

- It reuses `merge-gate.js`'s `ghJson`/`spawnSync` idiom; it needs **no repo slug** (`gh api user` is user-scoped), so it is even more robust than `branch-protection-check` and works before any repo resolution.
- **Design decision — subcommand vs folding into an existing check.** Options: (a) a standalone `faff github-auth-check`; (b) a field on `container-check`; (c) a flag on `branch-protection-check`. A standalone probe is independently testable, independently wired, and semantically distinct (credential liveness, not containment or protection). **Chosen:** a standalone `faff github-auth-check` subcommand, colocated in `merge-gate.js` (which already owns the `gh` helpers) and registered in the `COMMANDS` map. Rationale: reuses the gh helpers with zero new duplication, keeps the probe first-class and unit-testable via `--selftest`.

**Design decision — the probe command.** Options: `gh api user`, `gh auth status`, `gh api rate_limit`. `gh auth status` reports configured-token presence but not that the token is *accepted* by the API (a malformed token can pass `auth status` and still 401). `gh api user` makes a real authenticated call and is the cheapest read that proves acceptance. **Chosen:** `gh api user` as the probe. Rationale: it proves the credential is *accepted*, which is the exact condition every push/PR/merge needs; matches the ticket's named probe.

**Config knob — `autonomous.require_github_auth`.**

```
autonomous:
  require_github_auth: warn | block     # default: warn
```

Resolved via `faff config get autonomous.require_github_auth -d warn`, exactly as `autonomous.require_container` / `autonomous.require_branch_protection` are resolved for their preflights.

**Design decision — warn vs block default.** **Chosen:** default `warn` (loud kickoff surface, continue), opt-in `block` (abort at entry). Rationale: mirrors the two existing entry preflights; a warn default lets the overnight prep pass — valuable on its own — still run and lets the operator knowingly proceed specs-only, while `block` gives "hold the run" to operators who want it. Never blocks by default (gateway hard rule for entry preflights).

**Design decision — interactive kickoff prompt for specs-only?** The ticket floats "let the operator knowingly proceed specs-only." Options: add a pre-mint soft-offer (like the install-health `faff sync` carve-out); or achieve knowing-proceed via the warn posture. The no-prompt invariant forbids new mid-run gates, and a second pre-mint interactive carve-out is a governance-sensitive addition. **Chosen:** no new prompt — the loud kickoff warning plus default warn-continue **is** the "knowingly proceed specs-only" path (the operator sees the warning at kickoff and can abort or let it run); `block` is the "hold" path. Rationale: respects the no-prompt invariant while delivering both operator choices the ticket asks for.

## 4. HOW — Behavior

**Architecture and approach.** Two build sites plus wiring:

1. **The probe (CLI).** Add `cmdGithubAuthCheck` to `merge-gate.js`, register `"github-auth-check": cmdGithubAuthCheck` in `bin/faff`, export it, and add its `--selftest`. It runs `gh api user`, classifies the result, prints, and returns the exit code.
2. **The run-start wiring (beep-boop prose).** At autonomous entry — in the same entry-preflight block as the container/branch-protection/host-socket preflights, and **before the build queue is minted** — run the probe and branch on the resolved knob.
3. **The gateway bullet.** Add a "GitHub-auth preflight (entry, advisory — autonomous-only)" bullet to the Autonomous Mode Contract preflight group, mirroring the container/branch-protection bullets, and document the knob in the config schema.

**Behavior summary — the probe classification:**

```
PROCEDURE github_auth_check():
  1. r <- spawnSync("gh", ["api", "user"], { timeout, encoding: utf8 })
  2. IF r.error (spawn failed, e.g. gh not installed) OR r timed out:
       RETURN { status: "indeterminate", basis: "gh unavailable: <message>", login: null }
  3. IF r.status == 0:
       parse r.stdout as JSON
       IF parseable AND has .login:
         RETURN { status: "authed", basis: "gh api user ok", login: <.login> }
       ELSE:
         RETURN { status: "indeterminate", basis: "gh api user returned unparseable body", login: null }
  4. IF r.stderr matches 401 / 403 / "Bad credentials" / "not logged in" / "authentication":
       RETURN { status: "auth-failed", basis: "gh api user rejected credential: <first stderr line>", login: null }
  5. OTHERWISE (non-zero, non-auth):
       RETURN { status: "indeterminate", basis: "gh api error (<status>): <first stderr line>", login: null }
```

**Behavior summary — the run-start wiring:**

```
PROCEDURE beep_boop_github_auth_preflight(run_id):
  1. mode <- `faff config get autonomous.require_github_auth -d warn`
  2. st <- `faff github-auth-check --json`   (JSON.parse stdout)
  3. IF st.status == "authed":
       continue silently (optionally log the login at debug)
  4. IF st.status == "auth-failed":
       message <- "GitHub auth invalid — GH_TOKEN malformed/expired; re-auth (gh auth login / refresh GH_TOKEN) and re-run."
       surface message LOUDLY at kickoff:
         - prepend a RESULT line to .faff/runs/<run_id>/summary.md (ahead of the Methodology line), as the install-health doctor line does
         - include it in the condensed tracker status post (first thing a human reads)
         - log to the /faff-wtf-visible surface
       IF mode == "block":
         abort the run with a needs-human outcome naming the credential + fix, BEFORE minting the build queue (mint no ledger / do no further phase)
       ELSE (warn):
         continue the full pipeline; the build phase's issues park gracefully at the existing FAFF-4 delivery precondition — but the operator was warned at kickoff, not surprised mid-run
  5. IF st.status == "indeterminate":
       surface ONE advisory line ("GitHub auth could not be verified: <basis> — not necessarily an auth failure") to summary.md + /faff-wtf; continue unchanged regardless of mode (an unverifiable probe never blocks — fail-open on indeterminate, exactly as branch-protection-check's indeterminate is advisory)
```

**Edge cases and error handling:**

- **No credential material in output.** `basis`, the surfaced message, and the logs name `GH_TOKEN` (the env var) and the HTTP status only — never the token value. `gh api user` stderr for an auth failure reports `Bad credentials` / the HTTP status, not the token, so echoing its first line is safe; the probe must not print the resolved token under any status.
- `gh` not installed / not on PATH → `indeterminate` (never `auth-failed`): absence of the tool is not a dead credential.
- Network timeout → `indeterminate`; the probe carries a bounded `timeout` (reuse the 60s used by the sibling gh probes) so a hung network never stalls kickoff.
- A malformed token that `gh` sends and the API 401s → `auth-failed` (the core observed bug — the malformed `GH_TOKEN` case).
- `block` mode + `indeterminate` → **continue** (do not abort on an unverifiable probe); only `auth-failed` honours `block`.

**Failure modes — how the approach falls over, and how you'd notice:**

- **The failure:** `gh api user` succeeds (read scope) but the token lacks `repo`/push scope, so pushes still fail — a false "authed". **How you'd know:** a warn-clean kickoff still parks every build at `not-ready:precondition:push`. **What it means:** narrow — the out-of-scope `--push-check` extension exists precisely for scope/permission confirmation; `gh api user` deliberately scopes this ticket to *credential liveness*, which is the observed failure (malformed/expired token), not scope starvation.
- **The failure:** stderr matching for auth strings is locale/format-fragile, misclassifying an auth 401 as `indeterminate`. **How you'd know:** the `--selftest`/unit fixtures for the 401 case fail, or a known-bad token reports `indeterminate` instead of `auth-failed`. **What it means:** proceed — key on HTTP status code (401/403) first, treat string matching as a secondary signal; fail-open to `indeterminate` (advisory) is the safe direction, never a false `auth-failed` abort.

**Anti-pattern:** blocking the run by default. Why: entry preflights are advisory-by-default across faff (container, branch-protection); a default-block would abort overnight prep the operator wanted regardless of delivery.

**Anti-pattern:** reporting `auth-failed` when `gh` is merely missing or the network is down. Why: it sends the operator to re-auth when the real fix is install/network — the opposite of the "name the fault precisely" principle.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a beep-boop run starting with a malformed or expired GH_TOKEN
When the run reaches autonomous entry, before the build queue is minted
Then `faff github-auth-check` classifies auth-failed
And a loud kickoff message naming the credential and the fix (re-auth) is prepended to the run summary and the tracker status post
And under the default warn knob the run continues (specs still produced), while under require_github_auth: block the run aborts before minting the build queue
```

```
Given a beep-boop run with a healthy GitHub credential but (hypothetically) a probe that cannot reach the gh API (gh missing / network down)
When the auth pre-flight runs
Then it classifies indeterminate, surfaces one advisory line, and never claims auth-failed and never aborts — even under require_github_auth: block
```

## 6. Design Decision Rationale

- **Standalone `faff github-auth-check` subcommand (colocated in merge-gate.js).** Options: standalone / field on container-check / flag on branch-protection-check. **Chosen:** standalone, reusing merge-gate.js's gh helpers — independently testable and semantically distinct, no duplication.
- **`gh api user` as the probe.** Options: `gh api user` / `gh auth status` / `gh api rate_limit`. **Chosen:** `gh api user` — proves the credential is *accepted* by the API, which `gh auth status` does not.
- **Default `warn`, opt-in `block` via `autonomous.require_github_auth`.** **Chosen:** warn default — mirrors the two existing entry preflights; block is opt-in for operators who want a hard hold.
- **No new interactive kickoff prompt.** **Chosen:** the loud warning + warn-continue is the knowing-proceed-specs-only path; block is the hold path — respecting the no-prompt invariant rather than adding a second pre-mint interactive carve-out.
- **Fail-open on `indeterminate` (advisory, never abort).** **Chosen:** only `auth-failed` is actionable/blockable; an unverifiable probe never stops a run — the safe direction, matching branch-protection-check's `indeterminate`.

## 7. Open Questions and Assumptions

**Open Questions:** none blocking.

**Assumptions:**

- **Assumes:** the `gh` CLI is the GitHub access path in the run environment (the existing merge-gate / ship path already relies on it). *Validation:* the probe itself detects `gh`-unavailable and degrades to `indeterminate` rather than failing — so an absent `gh` is handled, not assumed away.
- **Assumes:** the FAFF-4 delivery-gate push precondition still parks build issues gracefully when push is dead. *Validation:* confirmed in `faffter-noon-ship/SKILL.md` (push precondition) — this is the warn-mode safety net that makes "proceed specs-only" non-destructive.

## 8. DONE — Definition of Done

### From WHY
- [ ] A malformed/invalid `GH_TOKEN` is detected at beep-boop run start, before the build queue is minted, by the read-only `gh api user` probe.
- [ ] The tracker credential being healthy does not mask a dead GitHub push credential (the probe targets `gh` directly).

### From WHAT (CLI)
- [ ] `faff github-auth-check` exists, registered in the `COMMANDS` map and exported from `merge-gate.js`.
- [ ] It returns exit 0 for `authed`, exit 1 for `auth-failed`/`indeterminate`; `--json` prints the `GithubAuthStatus` record; the non-JSON line reads `<status> (basis: <basis>)`.
- [ ] `--selftest` runs offline and covers authed / auth-failed (401) / indeterminate (gh-missing) fixtures.
- [ ] `autonomous.require_github_auth` (default `warn`) is documented in the config schema and resolved via `faff config get`.

### From HOW (behaviour)
- [ ] `gh api user` exit 0 + parseable `.login` → `authed` (login captured).
- [ ] An API 401/403 / bad-credentials → `auth-failed` with a message naming the credential and the fix (re-auth), not a generic precondition error.
- [ ] `gh` missing / network error / non-auth failure → `indeterminate`, advisory only, never `auth-failed`.
- [ ] At beep-boop autonomous entry the probe runs before build-queue mint; `auth-failed` surfaces loudly (summary.md RESULT line + tracker status post + `/faff-wtf`).
- [ ] `require_github_auth: block` aborts the run (needs-human, names credential + fix) before minting the build queue on `auth-failed`; `warn` continues the pipeline.
- [ ] `indeterminate` never aborts, even under `block`.

### From HOW (edge cases)
- [ ] The probe carries a bounded timeout so a hung network never stalls kickoff.
- [ ] `gh`-not-installed classifies `indeterminate`, not `auth-failed`.
- [ ] No credential material (the token value) appears in `basis`, the surfaced message, or the logs — only `GH_TOKEN` and the HTTP status.

**Eval coverage.** The probe classification is deterministic CLI (no new LLM-judgement seam) — no grader registration required.

**Integration smoke test:**

```
Run `faff github-auth-check --json` in an environment with a valid gh credential
-> exits 0, prints {"status":"authed","basis":"gh api user ok","login":"<user>"}
Overwrite GH_TOKEN with a malformed value, re-run
-> exits 1, prints {"status":"auth-failed",...}; a beep-boop run started here prepends the re-auth message to summary.md at kickoff
```

confidence: high
spec-review: approve