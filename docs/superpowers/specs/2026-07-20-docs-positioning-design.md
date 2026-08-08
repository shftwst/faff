<!-- faff-positioning-supersession:FAFF-733 -->
> **Status:** This historical brief is partly superseded. [ADR 0096](../../adr/0096-adopt-superdomestique-and-commissaire-through-staged-naming.md) records the decision; the [canonical language guide](../../concept/positioning-and-language.md) states the current position.
<!-- /faff-positioning-supersession:FAFF-733 -->

# Docs positioning — design brief for the documentation website

- **Status:** Positioning brief, agreed 2026-07-20. Governs the full docs rewrite: the documentation website (FAFF-508), the README, and the `docs/guide/` pages. Every decision below applies to all three surfaces.
- **Sources:** [2026-07-20 L4 capabilities audit](../../audits/2026-07-20-l4-capabilities-audit.md) (§2 doc-truth findings, §6 positioning findings) · [governance-layer explainer](../../reports/governance-layer-explainer-2026-07.md) · [governance landscape notes](../../reports/governance-landscape-2026-07.md) · FAFF-570 (docs truth pass) · FAFF-508 (docs site)

## Why reposition now

A docs site freezes an information architecture. The L4 capabilities audit found the current docs mispositioned in three distinct ways, and building the site around the current README structure would pour concrete over all three:

1. **Wrong identity at the front door.** The README pitches faff as a convenience tool for developers who dislike project-management overhead. What the system actually is — and what the audit found — is a governance-dense delivery system whose defining property is that it is *safe to stop watching*. The convenience framing is the project's origin story, not its identity, and it hides the system from the readers most likely to value it.
2. **Wrong product up front.** The pitch is staked on the top rung of the ladder (lights-out, out-of-the-loop), which has no external proof runs yet. The demonstrable-today product is unattended L3 plus the governance layer — and the governance layer has a genuinely differentiated story (the five-property scorecard; no surveyed project holds all five) that currently lives in an internal report rather than on any front page.
3. **Docs claim more than the code enforces.** Roughly five places narrate attested guarantees as enforced ones (FAFF-570). For a system whose entire pitch is trust, overstated docs are their own defect class.

## Decisions

### 1. The core idea: "safe to stop watching" — the convenience angle is retired

One story, everywhere: faff makes it safe to stop watching the delivery loop, one level at a time. The tracker-control / ticket-writing / backlog-ordering material remains fully documented, but as *capability within the loop*, not as the pitch. No copy anywhere positions faff as a shortcut or a chore-remover. The levels ladder stays as the central mental model, reframed as **trust earned per rung**, not convenience gained per rung.

### 2. Structure: one site, two equal products

Top-level navigation splits into two tracks with equal billing:

- **The factory** — the delivery loop: levels, skills, methodology, unattended runs.
- **The governance layer** — the referee: the merge chokepoint, the flight recorder, declared effects, the code-blind holdout, the five properties. Its landing page is written for a reader who never touches the factory (the existing explainer is the seed).

Each track gets its own landing page, story, and quickstart. Cross-links, no duplicated prose. The two are **not** split into separate sites, brands, or domains: the factory and the layer evolve symbiotically, and a separated docs surface would have to be kept in sync by hand. If package-level extraction later ships (see the extraction RFCs), the governance track lifts out with its identity already formed — the site structure is the rehearsal, not the commitment.

### 3. Front-page policy: evidence-forward

The front page sells the full stop-watching arc in confident, specific sentences — and wires every claim to its proof:

- **Per-level proof badges**, styled as status indicators, not footnotes. L3 carries its external-run evidence; L4 carries "machinery built and CI-gated; external proof pending" with the tracking ticket. When external L4 proof lands, the badge changes and the run artifacts join the evidence — nothing restructures.
- **An Evidence section in top-level navigation**: the audits published as first-class content (including kept corrections), the honest five-property scorecard, the external subject-under-test run artifacts. Not a blog, not an appendix — a first-class part of the site.
- **Standing rule, inherited from FAFF-570:** an enforcement claim without a linked artifact is a documentation bug, by policy. This is the product's own thesis applied to its docs — trust comes from records, not assurances. A future lint for enforcement-claim phrasing in docs is in-spirit but out of scope for the site kickoff.

The register throughout: hedging qualifies, evidence quantifies. Gaps are stated as specific statuses with tickets, never as apologetic qualifiers.

### 4. Timeline: pre-user phase, by design

faff is public ahead of user-readiness: lights-out is not yet externally proven, and users are deliberately not being courted until it is. The near-term reader therefore evaluates the ideas and the rigor rather than installs — a skeptical senior engineer giving the site ten minutes. The site is still written *as if for users* (that discipline is itself the credibility), but near-term content priorities follow the evaluating reader: the ideas must land fast, the evidence must be one click from every claim, and nothing may overstate. When external L4 proof exists, the same architecture serves adopters without restructuring.

### 5. Tone: casual but credible

The project name carries the personality; the prose underneath it earns trust. Concretely, calibrated against current README lines:

- **Keeps:** "it makes it safe to stop watching" — plain, confident, precise. "What keeps it honest: well… you" — dry, earns its joke, states a truth.
- **Cuts:** "off down the pub", "spontaneous robot combustion" — costume from the retired convenience identity; reads hobbyist to the evaluating reader.

Not corporate, not dry. The full voice, claims-register, and banned-vocabulary rules live in **[`.agents/STYLE.md`](../../../.agents/STYLE.md)** — the durable style authority for all prose in this repo. Everything the rewrite produces must adhere to it; this spec only carries the calibration examples above.

## Non-goals

- No separate site, domain, or brand for the governance layer (symbiotic evolution; see Decision 2).
- No renaming of the project or the layer.
- No new claims: the site kickoff writes no copy that FAFF-570's truth pass would flag. The truth pass is a prerequisite or an early workstream of the site, not a follow-up.

## Scope and implications for the kickoff

The rewrite covers three surfaces under one set of decisions:

- **The website:** information architecture is front page (arc + badges) → two product tracks (factory / governance layer) → Evidence → reference (CLI, configuration, skills).
- **The README:** rewritten under the same decisions — convenience angle out, two-track framing, evidence-forward claims, calibrated tone. Once the site exists it shrinks toward the arc, the badges, and pointers into the site; until then it is the front page and carries the full positioning itself.
- **The guide pages (`docs/guide/`):** rewritten in place for the same positioning and tone, then consumed by the site as the seed content for the two tracks (guide pages → factory track; explainer → governance track; audits and scorecard → Evidence). Rewriting the guides is not a separate later job — it is where most of the rewrite work actually lives.

Other implications:

- **Seed content exists for every section**, so the kickoff is mostly repositioning and rewriting for tone, not writing from nothing.
- **FAFF-570 is load-bearing:** the ~5 overstated-enforcement passages (several in the guide pages) must be corrected as part of the rewrite, since the front-page policy makes claim-accuracy a stated feature of the docs.
- **The tone rules travel with the work:** [`.agents/STYLE.md`](../../../.agents/STYLE.md) and the calibrated keep/cut examples apply to all three surfaces and to any generated site copy.
