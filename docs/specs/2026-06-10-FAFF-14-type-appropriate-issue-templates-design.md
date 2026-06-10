# Type-appropriate issue templates — issues born structured (write-half of the tracker boundary)

> Spec: faffter-dark-nlspec · 2026-06-09 · interactive · adaptor: faffidavit-spec · confidence: high. Full spec on Linear FAFF-14.

This is the build spec for **FAFF-14**, for the build agent and human reviewers. It covers the **write-half** of faff's tracker boundary: making the tickets faff *creates* (`/faff-jot`, `/faff-plot`) born with a type-appropriate structure, instead of free prose that `/faff-prep` later reverse-engineers. The read-half (inferring a brownfield tracker's native shape) is **FAFF-15 / idea G** and is out of scope here.

## 1. WHY — Problem and Principles

**Problem statement.** Today jot and plot seed a new ticket's description from raw brief prose plus its open questions — there is no per-type structure, so a bug, a feature, and a spike all land as undifferentiated prose, and prep has to reconstruct the shape (repro? acceptance? timebox?) every time. This change gives each ticket type a **target skeleton** the create-path producer fills, so issues are *born structured* and downstream consumers (prep's spec arc, the QA lens, future BDD scenarios) get predictable fields. It generalises the lite spec arc (WHY/WHAT/HOW/DONE) **earlier** — to the ticket-create stage — and **by type**.

**Design principles.**

- **Seed, never constrain.** A template is a default the producer *fills*, never a form that *gates*. Ticket creation must never be rejected or blocked because a template field has no content. A one-line idea yields a thin-but-structured ticket, not an error. This is the settled ethos and the load-bearing invariant of the whole feature.
- **Built-in defaults, project-overridable.** faff ships a default skeleton per type (the "configurable, not opinionated" tenet); a project may override any type's skeleton with a committed file, but needs zero config to get the defaults.
- **Don't fight settled boundaries.** The override store must not require reopening FAFF-67's deliberately append-only `gitignore-ensure` design (verified: it ignores `.faff/` dir-only), nor stress the config CLI beyond its scalar/block-scalar reading (verified: `dig()` returns leaf scalars only, no map-blocks or lists).
- **One canonical definition, two consumers.** jot and plot both already load the gateway; the template set, taxonomy, and fill rules live there once, referenced by both — never duplicated into each skill.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `faff-jot/SKILL.md` Step 4 "Confirm and create" | skill prose | Create boundary for new-work tickets; insertion point for the fill step |
| `faff-plot/SKILL.md` Step 5 "Write the skeleton" | skill prose | Create boundary for roadmap epics; second insertion point |
| `faff/SKILL.md` (gateway) | skill prose | Canonical home for the new shared template contract |
| `faff/bin/faff` `gitignore-ensure` | Node CLI | Verified `.faff/` dir-only ignore — forces overrides outside `.faff/` |
| methodology `ticket-shaping` output (gateway row) | named-output contract | Upstream of the fill step; may optionally carry a type hint |
| `rendering_adaptor` normalise pass | slot | The fill step runs *before* it; structured fields render skimmably for free |

**Scope statement.** This sits at faff's **write boundary** — the seam where faff emits work into the tracker — as a fill step between `ticket-shaping` and the existing rendering pass, plus the shared template definitions in the gateway.

## 2. OUT OF SCOPE

- **Reading the tracker's native issue templates** (Linear/GitHub templates). — *Why:* that is the read-side, which is idea **G / FAFF-15**. — *Extension point:* the template-resolution order (§3) has an explicit "native source" slot at position 0 that G fills later; the write-half always falls through to faff defaults until then.
- **Persisting ticket type as a `faff-type-*` label.** — *Why:* the born-structured *description* already delivers the WHY (predictable fields for downstream consumers); a filterable type label is a separable concern with real provisioning cost. — *Extension point:* a future ticket adds `faff-type-<type>` via the gateway's control-label provisioning, reading the type the fill step already determined.
- **A configurable `tracking.templates_path` config key.** — *Why:* the fixed override path (§3) already delivers "swappable per project"; a configurable *location* is a refinement, and adding it touches the CLI allowlist. — *Extension point:* mirror `spec_docs_path` — add `templates_path` to `TRACKING_KEYS` and resolve via `faff config get`. (Open Question, §6.)
- **Changing `/faff-prep`'s spec producers.** — *Why:* the spec arc (lite + nlspec) already templates the *spec* (WHY/WHAT/HOW/DONE); F's contribution is at *ticket* creation. The feature template's `acceptance` field is the natural input the spec's DONE section mirrors, but no producer change is needed. — *Extension point:* none required; the connection is by convention.
- **Per-autonomy-level strictness escalation** beyond the always-seed floor. — *Why:* "seed, strictness rising by level" — the seed floor is settled; the escalating nudge is a refinement. (Open Question, §6.)

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Template | A type-keyed ordered list of named **fields** that form a ticket description's skeleton. |
| Field | One named section of a template (e.g. `Repro`, `Acceptance`), rendered as a markdown subheading the producer fills. |
| Fill step | The new create-path step that selects a template, maps available content into its fields, and emits the structured description. |
| Type | One of the recognised ticket types (§ taxonomy) plus the `default` fallback. |
| Built-in default | The template faff ships for a type, defined canonically in the gateway. |
| Override file | A project-supplied template at `.faff-templates/<type>.md` that replaces the built-in default for that type. |

**The type taxonomy (closed set + fallback).**

```
ENUM TicketType:
  bug       # a defect in existing behaviour
  feature   # a new capability or behaviour
  spike     # a time-boxed investigation / decision, no committed deliverable
  chore     # maintenance with no user-facing behaviour change
  epic      # a container that decomposes into child slices
  default   # fallback when type cannot be determined
```

**Chosen:** five named types + a `default` fallback. *Rationale:* matches the design register's own enumeration; each type seeds a distinct downstream-consumer field set, so collapsing them loses the structure that is the point. `default` guarantees the fill step always has a skeleton, preserving the never-block invariant.

**The built-in default templates (field sets).** Each template is an ordered field list; **every** template ends with `Open questions` (preserves the existing "carry open questions into the description" behaviour of both jot and plot).

```
bug:     Repro · Expected · Actual · Scope · Open questions
feature: Why · What · Acceptance · Open questions
spike:   Question · Timebox · Decision to make · Open questions
chore:   What · Why now · Open questions
epic:    Outcome · Child slices · Open questions
default: Why · What · Open questions          # the lite-arc head
```

**Chosen:** these field sets, defined canonically in a new gateway section. *Rationale:* the gateway is the established home for shared write-boundary contracts and is already loaded by both jot and plot; one definition, two consumers (principle).

**Template source / resolution order.** The fill step resolves a type's template by first match:

```
PROCEDURE resolve_template(type):
  0. [reserved for G/FAFF-15: tracker-native template] — not implemented in write-half; always misses
  1. IF .faff-templates/<type>.md exists in repo → use it (override file)
  2. ELSE → use the built-in default for <type> from the gateway
  # `default` type resolves the same way; a project may even override .faff-templates/default.md
```

**Chosen:** faff-owned defaults now, with position 0 reserved as the documented seam for G to inject tracker-native templates later. *Rationale:* native-reading is explicitly G's job and out of scope; reserving the slot keeps the honest "fill native if present, else faff default" end-state reachable without reworking the write path. (Design rationale §5, decision A.)

**Override store location.** Override files live at committed `.faff-templates/<type>.md`, **deliberately outside** the gitignored `.faff/` directory.

**Chosen:** `.faff-templates/<type>.md` (committed, repo-root). **Reject** a `.faffrc templates:` map and **reject** "both". *Rationale:* the config CLI reads scalars/block-scalars only — a multi-line, per-type template map is not cleanly readable (verified). `.faff/templates/` would force reopening FAFF-67's settled append-only `.faff/`-dir-only ignore, and git's parent-exclusion rule blocks a simple `!.faff/templates/` negation (verified) — so the store sits outside `.faff/`. A single surface (files, not files-and-config) keeps it understandable. (Design rationale §5, decision B.)

**Override file format.** A markdown file whose level-2 headings (`## <Field>`) are the field list, in order; body text under a heading is ignored by the fill step (it is the project's own guidance). The fill step reads only the heading sequence as the skeleton.

**Anti-pattern:** storing overrides under `.faff/templates/`. *Why:* `.faff/` is gitignored dir-only and the ignore pattern is append-only/byte-identical-no-op by FAFF-67 design; a child carve-out can't re-include files under an excluded parent.

**Type determination interface.** The fill step decides each proposed ticket's type:

```
PROCEDURE determine_type(proposed_ticket, optional shaping_type_hint):
  1. IF shaping_type_hint present AND in TicketType → use it          # methodology may supply it
  2. ELSE infer from proposed_ticket title+description by heuristics (§HOW)
  3. IF inference is not confident → default
```

**Chosen:** type is determined at the create step by prose inference, optionally honouring a `type` hint the methodology's `ticket-shaping` may attach per proposed ticket. **Assumes:** the `ticket-shaping` output contract gains an *optional* per-ticket `type` field — absent today, honoured when present, ignored when absent (backward-compatible; no methodology is required to supply it). *Rationale:* keeps the methodology contract optional/graceful (matches how the gateway treats `ticket-shaping` itself) while giving an opinionated methodology a place to assert type. (Design rationale §5, decision C.)

## 4. HOW — Behaviour

**Architecture.** Three deliverables: (a) a new gateway section defining the taxonomy, built-in templates, resolution order, determination heuristics, and the seed-not-constrain rule; (b) a one-step insertion into `faff-jot` Step 4 and `faff-plot` Step 5 that runs the fill step per proposed ticket; (c) a small note in the methodology `ticket-shaping` gateway contract row that the per-ticket `type` field is an optional output. All of (a)–(c) are **SKILL.md prose edits** — faff skills are agent instructions, not compiled code (verified); there is **no CLI change** in this issue.

**The fill step (the core behaviour).** Runs once per proposed ticket, after `ticket-shaping` produces the proposed set and **before** the description is handed to the `rendering_adaptor`:

```
PROCEDURE fill_ticket(proposed_ticket, brief, shaping_type_hint):
  1. type ← determine_type(proposed_ticket, shaping_type_hint)
  2. template ← resolve_template(type)              # override file, else built-in default
  3. FOR each field in template (in order):
     a. content ← best-available content for this field from proposed_ticket + brief
        (e.g. feature.Why ← brief Goal/why prose; feature.Acceptance ← brief done-signal;
         bug.Repro ← any repro prose; every template's "Open questions" ← brief Open questions)
     b. IF content present → emit "## <Field>\n<content>"
     c. ELSE → emit "## <Field>\n_To be determined during prep._"   # explicit placeholder, never omit silently, never invent
  4. description ← the assembled fields
  5. RETURN description        # caller routes it through rendering_adaptor as today, then writes to tracker
```

**Behavior summary:** every recognised field of the chosen template becomes a heading; known content fills it, unknown content becomes a visible placeholder. The structure is always present; the gaps are always visible; creation is never blocked.

**Seed-not-constrain (the invariant, in behaviour).**

```
- Missing content for a field → placeholder line, NOT an error and NOT a silent omission.
- No minimum-fields gate exists at create time. A one-line idea → a skeleton with one filled field and the rest placeholdered.
- The fill step never invents factual content to satisfy a field (no fabricated repro steps, no invented acceptance).
```

**Anti-pattern:** rejecting or warning-to-block a ticket whose template is under-filled. *Why:* violates the settled seed-not-constrain ethos; completeness is prep's gate, not creation's.

**Type-inference heuristics (prose, applied in `determine_type` step 2).**

```
- bug     → describes existing behaviour that is broken/incorrect/regressed ("fails", "doesn't", "regression").
- spike   → frames an open question / investigation / "figure out" / "decide", no committed deliverable.
- chore   → maintenance/upkeep with no user-facing behaviour change (deps, refactor, config, cleanup).
- epic    → a container that decomposes into child slices / spans multiple deliverables
            (in plot, shape-level = initiative|project, or any node with children → epic/container).
- feature → a new capability or behaviour (the default lean for greenfield brief items).
- otherwise → default.
```

**Edge cases.**

- **plot containers vs leaves.** At `shape-level` = `initiative`/`project`, the node is a container → `epic` template (Outcome / Child slices). First-slice epics that are themselves buildable units take `feature` (or inferred) — `determine_type` runs per node using its content and level.
- **Override file with zero headings or unreadable** → treat as absent; fall through to built-in default (never block). Log the skipped override.
- **Override file naming an unknown type** (`.faff-templates/foo.md`) → ignored; only the recognised type filenames + `default` are consulted.
- **Existing behaviour preserved:** the `faff-jot-intake` label, blocker/blocked-by links, `Backlog` status, and plot's `planned by /faff-plot` provenance line are all unchanged — the fill step only restructures the *description body*, then the existing rendering+write path runs as before.
- **git-only mode.** jot/plot already write the shaped set to `.faff/intake/<...>.md` instead of a tracker; the fill step runs identically and the structured description is written into that file. (Override files at `.faff-templates/` are read the same way.)

## 5. DESIGN DECISION RATIONALE

**A. Template source for the write-half — faff-owned now, or native-first now?**
- *faff-owned defaults + reserved native seam (chosen)* — on-pattern; native-read is G's job; keeps the honest end-state reachable.
- *native-first now* — would pull G's tracker-reading into this issue; out of scope, larger, and unbuildable without G.
- **Chosen:** faff-owned defaults with resolution position 0 reserved for G.

**B. Customisation surface — `.faffrc` map vs override files vs both?**
- *`.faffrc templates:` map* — CLI reads scalars only; multi-line per-type bodies are unwieldy/unreadable (verified). Rejected.
- *both* — two surfaces for one concern; violates understandable-not-unapproachable. Rejected.
- *committed override files at `.faff-templates/<type>.md` (chosen)* — clean, no CLI change, doesn't fight the `.faff/` gitignore design, delivers "swappable per project".
- **Chosen:** override files outside `.faff/`.

**C. Type taxonomy/count + determination.**
- *Fewer types* — loses distinct downstream field sets. *More* — bureaucracy. **Chosen:** the design's five + `default`.
- *Determination:* a dedicated classifier skill (overkill) vs prose inference at create (chosen), with an optional methodology `type` hint honoured when present.
- **Chosen:** create-step prose inference + optional `ticket-shaping` type hint.

**D. Seed vs constrain.** **Chosen:** always seed, never constrain — no create-time completeness gate; placeholders for unknowns. The escalating-strictness knob is punted (§6).

**E. Where it hooks.** Methodology `ticket-shaping` input (too early — type needs the shaped ticket) vs a post-shaping fill step before rendering (chosen). **Chosen:** fill step after `ticket-shaping`, before `rendering_adaptor`, in both jot Step 4 and plot Step 5, defined once in the gateway.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions (Punt).**

- **Punt:** a configurable `tracking.templates_path` key (spec_docs_path-style) — needs human? Fixed `.faff-templates/` ships in v1; a configurable location is a clean follow-up that touches the CLI allowlist. Non-blocking.
- **Punt:** per-autonomy-level strictness *nudge* (e.g. a non-blocking "feature has no Acceptance" notice at higher autonomy) — needs human on whether it's wanted at all. The always-seed floor is settled and unaffected. Non-blocking.

**Assumptions.**

- **Assumes:** the methodology `ticket-shaping` output may carry an *optional* per-ticket `type` field. *Validation:* gateway contract row for `ticket-shaping` lists only "titles, descriptions, links, container" today — the build adds `type` as an explicitly optional, graceful-when-absent field; confirm no methodology is made to *require* it.
- **Assumes:** committing `.faff-templates/` requires no gitignore change because it is outside `.faff/`. *Validation:* confirm `FAFF_GITIGNORE_PATTERNS` in `faff/bin/faff` contains only `.faff/` (dir-only) and the `.faffrc*` forms — it does not ignore `.faff-templates/`.

## 7. DONE — Definition of Done

### From WHY
- [ ] A ticket created by jot or plot for each of the five types has a description whose headings match that type's template field set (bug/feature/spike/chore/epic), verifiable by creating one ticket per type and inspecting the rendered description.
- [ ] A one-line idea produces a structured-but-thin ticket (template headings present, unknown fields shown as `_To be determined during prep._`), not an error and not free prose.

### From WHAT (types and interfaces)
- [ ] The gateway defines the closed taxonomy `bug | feature | spike | chore | epic | default`.
- [ ] The gateway defines the six built-in field sets exactly as in §3, each ending with `Open questions`.
- [ ] `resolve_template` order is: reserved native slot (no-op) → `.faff-templates/<type>.md` if present → built-in default.
- [ ] An override file at `.faff-templates/feature.md` whose `##` headings differ from the default changes the created feature ticket's headings to match the override.
- [ ] An absent/empty/heading-less override file falls through to the built-in default without blocking, and the skip is logged.
- [ ] The `ticket-shaping` gateway contract row documents `type` as an optional per-ticket output (absent → inferred; present → honoured).

### From HOW (behaviour)
- [ ] The fill step runs per proposed ticket after `ticket-shaping` and before the `rendering_adaptor` pass, in both faff-jot Step 4 and faff-plot Step 5 (verifiable in both SKILL.md files).
- [ ] `determine_type` uses the methodology `type` hint when present and in-taxonomy, else prose-infers per the §4 heuristics, else `default`.
- [ ] A field with no available content emits an explicit placeholder; the fill step never silently omits a template field and never fabricates factual content.
- [ ] Creation is never rejected/blocked for an under-filled template (no create-time completeness gate exists).
- [ ] Existing create-path behaviour is preserved: `faff-jot-intake` label, blocker links, `Backlog` status, plot's `planned by /faff-plot` line, and routing through `rendering_adaptor`.
- [ ] git-only mode: the structured description is written into `.faff/intake/<...>.md` identically.

### From HOW (edge cases)
- [ ] plot container nodes (`shape-level` initiative/project) resolve to the `epic` template; buildable first-slice nodes infer their own type.
- [ ] An override filename for an unknown type is ignored.

### Definition / docs closed-loop
- [ ] All template/taxonomy/fill definitions live in the gateway once; jot and plot reference them rather than duplicating.
- [ ] Out-of-scope seams are documented: native-template resolution slot (G), the `faff-type-*` label extension, and `templates_path`.

**Integration smoke test (one end-to-end happy path).**

```
GIVEN a project with no .faff-templates/ overrides
WHEN /faff-jot captures a single-item brief describing broken behaviour ("X throws on empty input")
THEN determine_type infers `bug`
 AND the created ticket's description has headings: Repro, Expected, Actual, Scope, Open questions
 AND Repro/Expected/Actual are filled from the brief where available, missing ones show the placeholder
 AND the ticket still carries the faff-jot-intake label and Backlog status
 AND the description passed through the rendering_adaptor (enumerable fields render as lists).
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "punt" },
    { "marker": "punt" },
    { "marker": "assumes" }
  ] }
```
