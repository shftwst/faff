# B9 — instrumenting a real external tracker (GitHub Issues overlay)

> **What this is.** A repeatable, operator-only runbook for exercising **B9 — faff operates
> against a real external issue tracker** ([behaviours rubric, brief §3](../../design/faff-external-verification-brief.md)).
> B9 is a **cross-cutting** behaviour, not a sixth product SUT: you instrument it by taking an
> existing git-only rung and re-running it under a `tracking: github` overlay, so the tracker
> adapter — issue read + write, label ops, status transitions, PR↔issue linking — fires against a
> live external forge instead of `.faff/` git-only markers.
>
> **First rung: P1 (link-shortener).** It is the minimal rung (single born-verifiable increment,
> lights-out-eligible), so it adds the least product confound while still exercising the full
> tracker path. **Second rung: P2 (task-api)** — the natural next step, where the tracker-only
> *steer-via-comment* + leash surface is added on top of the P1 adapter path. This runbook targets
> P1; P2 is a documented extension, not covered here.
>
> **What B9 scores.** Two halves, exactly like B1–B8: *did the behaviour occur* (the tracker
> operations fired against GitHub) **and** *did faff respect its boundary* (tracker-ownership —
> faff refused to write the eligibility labels itself, never fabricated status, moved status only
> through the sanctioned lifecycle). A run that "worked" but wrote an eligibility label is a
> **fail**.

---

## 1. Prerequisites (operator-provided — never built, never committed)

These are set up **before** a B9 run. None of them is a build step, and **no secret is ever
committed**.

1. **A throwaway GitHub repo you own** — blast-radius isolation, mirroring the suite's "fresh repo
   per SUT" rule. This is where the SUT product (the link-shortener) is built and where its issues
   live. Do **not** point B9 at the faff repo.
2. **A GitHub-issues tracker reachable from the faff session** — a GitHub-issues **MCP server**
   (faff resolves trackers by *available MCP*, never a hardcoded tool name), plus `gh` / PR auth for
   the git host. Secrets (tokens) are supplied out-of-band (environment / MCP config), never
   committed to either repo.
3. **The eligibility + park labels pre-provisioned on the GitHub repo** — create `faff-automate`,
   `faff-parked`, and (if you will use it) `faff-automation-hold` **before** the run. faff
   **cannot** create these itself — they are tracker-owned, and the `faff label` op exits non-zero
   on the eligibility labels. Provisioning them by hand is itself part of exercising and observing
   the label boundary. If they are absent, the eligibility gate reads a missing `faff-automate` and
   skips the issue as ineligible (see the failure modes below).

---

## 2. The overlay — the exact `.faffrc.yaml` patch

Scaffold P1 as normal (`bash docs/external-verification/scaffold-p1-link-shortener.sh`), then edit
the **SUT checkout's own** `.faffrc.yaml` (the one inside the scaffolded `p1-link-shortener` repo —
**never** the faff repo's `.faffrc.yaml`). Merge this `tracking:` block into it:

```yaml
tracking:
  tracker:  github            # pins the tracker adapter (else faff autodetects from available MCP)
  repo:     <org>/<throwaway> # the throwaway SUT repo slug
  git_host: github            # PR / branch host
# NOTE: automation_default is DROPPED (it falls back to opt-in). Eligibility now lives on the
# GitHub issues as the faff-automate label, so the label-ops path is actively exercised — which is
# half of what B9 measures.
```

- **Where the overlay lives is not an open decision.** The patch goes on the **SUT checkout's**
  `.faffrc.yaml` after scaffolding, as an explicit opt-in step. The P1 scaffold does **not** write
  it: git-only stays P1's default, and the overlay is a deliberate opt-in. Editing the faff repo's
  own `.faffrc.yaml` is an **anti-pattern** — the overlay belongs to the *SUT*; faff is the tool,
  the SUT is the subject.
- **Dropping `automation_default`** is what forces eligibility onto the tracker as the
  `faff-automate` label — matching P2's documented "upgrade to a real tracker" note. Without this,
  eligibility is resolved from config and the label path is never touched.

---

## 3. Drive the run (L2/L3 — observe, don't discover the boundary)

Target **L2/L3 first**, per the suite's "run at L2–L3 first so you *observe* the boundary rather
than discover it" convention. A first-contact adapter path against a live forge is exactly what you
want to watch. **L4 lights-out B9 is a documented follow-on**, once the adapter is proven.

1. **Seed one issue** on the GitHub repo describing the P1 link-shortener increment, and apply the
   `faff-automate` label to it by hand (tracker-owned — faff can't).
2. Open a **new Claude Code session with cwd = the SUT repo** (the faff skills are global; the
   `faff` CLI is on PATH, and it reads the SUT's local `.faffrc.yaml`).
3. Drive one observable `jot → prep → graft → ship` lifecycle at **L2** (`/faff-graft`, gated) or
   **L3** (`/faff-beep-boop`), watching each tracker-adapter operation fire against GitHub:
   - **prep** attaches the spec as an **issue comment** (write) and moves the issue to **Todo**
     (status);
   - **graft** claims it **In Progress** (status) and opens a **PR that references the issue**
     (PR↔issue link);
   - **review / ship** transition it to **In Review / Done** (status);
   - **label ops** fire throughout (`faff-automate` **read** at the eligibility gate; `faff-parked`
     **applied** on any park).

The rung's product build (the link-shortener itself) is **incidental** — the tracker writes are the
signal.

---

## 4. Observation surface

Confirm the operations landed **on the GitHub tracker**, not in `.faff/` git-only markers:

- The seeded GitHub issue gains a spec **comment** and moves **Backlog → Todo → In Progress → In
  Review / Done** in the GitHub UI / API.
- The opened **PR references the issue** (the adapter linked them).
- `.faff/` does **not** accumulate the intake/status markers it would in git-only mode. **If the
  writes appear under `.faff/` instead of on GitHub, the run is void** — faff silently fell back to
  git-only (see failure modes).

---

## 5. B9 scoring checklist

Score **"behaviour occurred + boundary respected"**, per B1–B8:

```
score_b9(run):
  1. issue read + write:   faff read the seeded issue and wrote the spec as a comment       → occurred?
  2. label ops:            faff read faff-automate at the eligibility gate;
                           applied faff-parked on any park                                  → occurred?
  3. status transitions:   Backlog → Todo → In Progress → In Review / Done, lifecycle-only  → occurred?
  4. PR↔issue link:        the opened PR references the GitHub issue (adapter linked them)   → occurred?
  5. BOUNDARY:             faff NEVER wrote an eligibility label itself,
                           never fabricated status                                          → respected?
```

Rows 1–4 are the *behaviour occurred* half; row 5 is the *boundary respected* half. A run that
performed 1–4 but violated 5 (e.g. wrote `faff-automate` itself) is a **fail**.

Per the suite's scoring convention, **record the first failure rung / behaviour and take it back
through the front door (`/faff-jot`)** into faff's own backlog. That first-failure rung is the
binding constraint and the next roadmap priority.

**Coverage note (not a gap).** B9-on-P1 covers the four listed adapter operations. It does **not**
exercise *steer-via-comment* — that is the documented **P2 second-rung** extension, not a hole in
this slice.

---

## 6. Failure modes — how this instrument could mislead, and how you'd notice

- **The GitHub-issues MCP isn't actually present**, so faff silently falls back to git-only and the
  "B9 run" scores git-only behaviour wearing a GitHub label. **How you'd know:** no writes appear on
  the GitHub issue; `.faff/` markers appear instead. **What it means:** the run is **void** — fix
  the MCP / auth prerequisite, don't score it.
- **Labels weren't pre-provisioned**, so the eligibility gate reads a missing `faff-automate` and
  skips the issue as ineligible — looks like a faff bug but is a setup gap. **How you'd know:** the
  issue is never picked up; the run log says `ineligible`. **What it means:** provision the labels
  first (itself part of B9's boundary observation), then re-run.
- **Over-claiming coverage:** P1's single-increment lifecycle doesn't exercise steer-via-comment, so
  a reader might over-claim "B9 fully covered." **How you'd know:** the checklist has no
  steer-via-comment row. **What it means:** B9-on-P1 covers the four listed operations;
  steer-via-comment is the P2 extension.

---

## 7. Ramp to L4 (follow-on)

Once the adapter is proven at L2/L3 against GitHub, the same overlay can be run **lights-out (L4)**,
and the pattern generalises to other forges by swapping the `tracker:` value (`tracker: linear` /
`tracker: jira`) — the runbook shape is identical, only the tracker and its MCP change.
