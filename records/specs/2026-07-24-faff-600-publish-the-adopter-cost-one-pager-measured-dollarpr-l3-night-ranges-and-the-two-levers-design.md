# FAFF-600 — Publish the adopter cost one-pager (measured $/PR, L3-night ranges, and the two levers)

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-600.

This spec defines a documentation deliverable: a committed, adopter-facing cost one-pager under `docs/reports/`, built from the FAFF-407/409 measurement, linked from the README. Audience: the build agent producing the page, and human reviewers checking the figures are honest. No runtime code changes.

## 1. WHY — Problem and Principles

**The load-bearing idea:** faff already *measured* what it costs to run itself — a reconciled, per-class, per-model token breakdown with a committed report — but that evidence is buried in an internal analysis artifact. An adopter asking "what will an unattended night cost me?" has no page to read. This issue publishes the existing measurement in adopter-facing form; it creates no new measurement machinery.

**Problem statement.** Prospective adopters' first question about unattended runs is cost, and today the answer lives in an internal spike report (`docs/reports/token-usage-breakdown/report.md`) written for faff's own optimisation work. Nothing states the cost per shipped PR, what a night of L3 actually costs, or which knobs cut the bill. This change commits a one-pager that answers those three questions with measured figures only, and links it from the README.

**Design principles** (each would reject an otherwise-valid page):

- **Measured-only.** Every dollar or token figure on the page carries its measurement window and comes from an artifact in this repo (the regenerated token-breakdown report, a run's `faff economics`/ledger output, or git history). A figure that cannot be regenerated or pointed at is not published. Claims from the external planning package that lack an in-repo measurement are dropped or explicitly labelled as estimates — never silently presented as measured.
- **State the method, not just the number.** The $/PR figure must be accompanied by exactly how the numerator and denominator were obtained, so a reader can recompute it.
- **The faff-on-faff caveat is prominent, not a footnote.** All figures are from faff building faff — an unusually skill-heavy, Opus-heavy, tracker-chatty workload. State plainly that an adopter's numbers will differ, and in which direction the known biases point.
- **Honest about the levers' status.** A lever that shipped but is not yet the default (or not yet re-measured) is described as available, not as achieved savings.

**Reference context:**

| System | Relevance |
|---|---|
| `docs/reports/token-usage-breakdown/report.md` + `report.json` | The FAFF-407/409 measurement this page publishes (window 2026-05-29→07-09, $16,763, per-class/per-model/per-MCP-tool axes) |
| `scripts/token-breakdown.mjs` | Regenerates the measurement; run before publishing for a current snapshot |
| `.faff/runs/*/summary.md` + `faff economics` | Per-run unit economics — source for the recent-night data point (e.g. run-20260723-144253: 79.3M tokens / $57.94 / 5 shipped) |
| `records/adr/0048-…token-pricing-model.md` | The per-model × per-class price map the costs are priced against |
| `README.md` (docs list, "Everything past the pitch lives in `docs/`") | Where the link lands |
| `docs/reports/governance-layer-explainer-2026-07.md` | Naming/tone precedent for adopter-facing reports |

**Scope statement.** This is an evidence-publication page in `docs/reports/`, downstream of the measurement tickets (FAFF-407/409/410) and upstream of nothing — no code, config, or CLI behaviour changes.

## 2. OUT OF SCOPE

- **New telemetry or measurement passes** — why: the page publishes existing measurement; extension point: the telemetry-gap register in `docs/reports/token-usage-breakdown/report.md`.
- **Changes to `faff economics` / the price map / budget ceilings** — why: publication, not instrumentation; extension point: `bin/lib/` economics/budget modules and ADR-0048.
- **Re-running the MCP call census** — why: the FAFF-409 measured per-tool figures supersede it; extension point: `docs/reports/mcp-call-census/`.
- **A marketing/landing-page treatment** — why: this is a docs report with the repo's plain delivery-lead tone; extension point: any future site work under "Front door & packaging".
- **Refreshing the internal `token-usage-breakdown/report.md` prose** — why: the regeneration is for the one-pager's snapshot; the internal report stays as the committed FAFF-407/409 record. If the regenerated JSON is committed, it lands with the one-pager, not as a rewrite of the internal report's analysis.

## 3. WHAT — the page, its figures, and the README link

**Deliverable:** one new markdown file under `docs/reports/`, plus one README edit.

**File name.** Existing adopter-facing reports use `<topic>-YYYY-MM.md` (`governance-layer-explainer-2026-07.md`).
**Chosen:** `docs/reports/adopter-cost-2026-07.md` — matches the sibling naming convention; the date suffix makes the snapshot window part of the identity.

**Page content requirements** (each is a DONE item):

1. **Headline $/PR** — all-in cost per shipped PR on faff's own development, with the window and the method (below) stated adjacently.
2. **L3-night ranges** — what a night of unattended running has actually cost, as a range with both ends measured: heavy Opus-heavy run-days from the breakdown's by-day axis (top days $1,001–$1,803 in the measured window) down to a recent routed night (run-20260723-144253: 79.3M tokens, $57.94, 7 build attempts, 5 shipped — from that run's ledger/summary). Each end cites its source and date.
3. **Where the money goes** — cache traffic is 85.5% of spend (cache_read 52.7%, cache_write 32.8%); model generation is 13.3%; the cost driver is resident-context × turns, not output. One table, from the regenerated snapshot.
4. **The two levers**, quantified (see the lever decision below).
5. **Subscription framing** — on Max/ChatGPT-class seats a local L3 night is window draw, not marginal dollars; the API prices here are the metered-worst-case framing.
6. **The faff-on-faff caveat** — prominent, per the design principle.
7. **Pricing basis** — one line pointing at the per-model × per-class rates used (ADR-0048 / the script's `PRICE_PER_MTOK`), including the Sonnet 5 intro-rate note ($2/$10 through 2026-08-31).

**The $/PR method.**
**Chosen:** numerator = the regenerated token-breakdown grand-total USD for its stated window; denominator = count of PR merge commits on `main` in the same window, counted mechanically as commits whose subject carries the squash-merge `(#N)` suffix (`git log --since=<window-start> --until=<window-end+1> --grep='(#'` — this repo squash-merges, so there are no merge commits to count via `--merges`). Publish the *recomputed* quotient, not the ticket's ~$48. Rationale: the ticket's figures ($16,763 / ~350 PRs ≈ $48) come from the external planning package; explore measured 305 `(#N)` commits in that window, which yields ~$55/PR. The discrepancy is method opacity in the external count — exactly what the "state the method" principle exists to kill. The page states the command shape so the number is recomputable, and may note the ticket's ~$48 provenance in one sentence if the recomputed figure differs materially.

**The two levers.**
**Chosen:** the title's "two levers" are the two *categories* the measurement itself ranks, each carrying its two quantified instruments from the issue:

- **Lever 1 — route work to cheaper models.** Instruments: `models.build_by_confidence` per-issue routing (FAFF-334; the measured Haiku lane ran 342M tokens for $76) and a Sonnet 5 build lane (intro $2/$10 through 2026-08-31, standard $3/$15). Grounded in the measurement: Opus-4-8 was 82% of spend.
- **Lever 2 — shrink the resident context re-read every turn.** Instruments: the gateway/skill-corpus diet and MCP field-projection (top-5 Linear tools = $1,348 measured cache cost, FAFF-409). Grounded in the measurement: cache_read is 52.7% of cost and 94.7% of tokens.

Rationale: the report's own conclusion is "the primary lever is context, the secondary is model routing"; the issue's four quantified items pair naturally two-and-two under those heads. The "skill corpus ≈ 40% of the average turn's cached prefix" figure is from the external package with no in-repo measurement — include it **only** if the build can substantiate it cheaply (e.g. skill-corpus bytes ÷ a measured average cached-prefix size from `report.json`); otherwise describe the gateway diet qualitatively and keep the measured $1,348 MCP figure as lever 2's number. Measured-only outranks completeness.

**README link.**
**Chosen:** one bullet in the existing "Everything past the pitch lives in `docs/`" list (README.md ~line 69): `[What faff costs to run](docs/reports/adopter-cost-2026-07.md) — measured $/PR, what an unattended night costs, and the two levers that cut it.` No other README restructuring.

**Snapshot regeneration.**
**Chosen:** run `node scripts/token-breakdown.mjs --json` at build time and source the page's breakdown figures from that regenerated snapshot (window end = regeneration date), not from the committed 07-09 report. The corpus is live, so absolute figures will have moved; percentages are stable. If the regenerated headline figures differ from the committed report's by more than ~15%, commit the regenerated `report.json` alongside the page (under `docs/reports/token-usage-breakdown/`, superseding snapshot noted in its header) so the published figures remain pointable-at; below that threshold, cite the regenerated numbers with their window and leave the committed report as-is.

**Assumes:** the build runs on the machine holding the transcript corpus (`~/.claude/projects/<encoded-cwd>/`) — `scripts/token-breakdown.mjs` reads it directly. Validate before starting: run the script; if the corpus is absent/empty the regeneration cannot happen and the build must not fall back to republishing stale external-package numbers as current.

## 4. HOW — build procedure

Summary: regenerate the snapshot, derive the handful of published figures, write the page, link it.

```
PROCEDURE build_one_pager:
  1. node scripts/token-breakdown.mjs --json > <scratch>/snapshot.json   # validate Assumes
  2. Derive from snapshot: window, grand total $, class table, model shares,
     top run-day costs, MCP top-5 measured cache cost
  3. Count PRs: git log --since=<window-start> --until=<window-end + 1 day> --grep='(#' --oneline | wc -l
  4. $/PR := grand_total / pr_count   (round to whole dollars; state both inputs on the page)
  5. Pull the recent-night data point from .faff/runs/run-20260723-144253-beepboop-full/summary.md
     (or a newer completed beep-boop run's summary if one exists at build time — cite whichever is used)
  6. Write docs/reports/adopter-cost-2026-07.md per the content requirements (WHAT)
  7. Add the README bullet
```

**Edge cases:**

- Corpus present but window start differs from 2026-05-29 (older transcripts pruned) → publish the window the snapshot actually covers; never mix the old window's PR count with a new window's spend.
- A `(#N)`-suffixed commit that isn't a PR merge (hand-written subject) → acceptable noise; the method is stated, and single-digit miscounts don't move a ~$50 figure materially.
- Regenerated figures move the headline percentages by a point or two → fine; the page cites its own snapshot's window.

**Failure modes:**

- **The failure:** the regenerated snapshot diverges wildly from the committed report (e.g. corpus partially pruned), making the published $/PR unrepresentative. **How you'd know:** grand total or PR count differs >30% from the committed report's window figures. **What it means:** narrow — publish with the actual window prominently stated and a one-line note that the earlier committed window measured $16,763/305+; do not average the two.
- **The failure:** the ~40% cached-prefix claim can't be substantiated. **How you'd know:** no measured average-prefix figure derivable from `report.json`. **What it means:** proceed without the number (the lever stands on the measured 52.7% cache_read share) — a planned, valid outcome per the lever decision.

**Anti-pattern:** copying the ticket's headline figures ($48/PR, $16,763, 85.5%) onto the page verbatim without regenerating. Why: the page's whole credibility is "measured, with window, recomputable"; stale pass-through numbers with a fresh publication date break exactly that.

## Scenarios

```
Given the committed one-pager
When a reader takes the page's stated $/PR method (numerator source, git log command shape, window)
Then they can recompute the published figure from the repo + corpus without any unstated input
```

```
Given the README docs list
When a prospective adopter looks for cost information
Then a link to the one-pager is present and resolves to docs/reports/adopter-cost-2026-07.md
```

- Assertion: every dollar figure on the page has a measurement window or run-id within one sentence of it.
- Assertion: the page contains no unlabelled estimate — each figure is traceable to the regenerated snapshot, a run summary/ledger, git history, or is explicitly marked as an estimate/external claim.

## 6. DESIGN DECISION RATIONALE

- **Which "two levers"?** Options: (a) model routing + budget ceilings; (b) the two measurement-ranked categories — model routing + resident-context reduction. **Chosen:** (b) — the issue's own "Levers, quantified" list contains only routing and context instruments (no ceiling item), and the report ranks exactly these two. Budget ceilings cap spend; they don't cut unit cost, which is the page's subject.
- **Publish recomputed vs ticket figures?** **Chosen:** recomputed (see WHAT) — the external count is unreproducible; the page's method must be.
- **File name?** **Chosen:** `adopter-cost-2026-07.md` (sibling convention; date = snapshot identity). Rejected: undated name (snapshot ages silently), nesting under `token-usage-breakdown/` (that directory is the internal measurement record).
- **Where the README link lives?** **Chosen:** the docs list — the established index for docs-tier content. Rejected: a new top-level README section (over-weights one report).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — all decisions above are closed.

**Assumptions:**

- **Assumes:** the transcript corpus is present and readable on the build machine. Validation: step 1 of the build procedure; on absence, park rather than publish stale numbers as current.

## 8. DONE — Definition of Done

### From WHY (principles)
- [ ] Every published dollar/token figure carries its window or run-id (assertion scenario passes)
- [ ] The faff-on-faff caveat appears prominently (above the fold, not a trailing footnote)

### From WHAT (content)
- [ ] `docs/reports/adopter-cost-2026-07.md` exists with: headline $/PR + stated method, L3-night range (heavy days + recent routed night, both sourced), where-the-money-goes table, the two levers with their quantified instruments, subscription framing, pricing-basis line
- [ ] The $/PR figure is the recomputed quotient (regenerated grand total ÷ mechanically-counted PR merges), with both inputs stated on the page
- [ ] The ~40% cached-prefix claim appears only if substantiated from measured data; otherwise omitted
- [ ] README docs list links the page with a one-line description

### From HOW
- [ ] `scripts/token-breakdown.mjs --json` was run at build time and is the source of the breakdown figures (window on the page = the regenerated snapshot's window)
- [ ] If regenerated figures diverged >15% from the committed report, the regenerated `report.json` is committed alongside; otherwise no internal-report churn

### Integration smoke test
```
Open README → click the cost link → the page renders; take its stated git log command +
window → the PR count reproduces; the quoted $/PR equals stated-total ÷ that count.
```

No LLM-judgement seam is introduced (docs-only) — no eval-coverage item.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ]
}
```
