# Faff gateway reference — create lane

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Ticket templates (born-structured create boundary)

The single canonical definition of the **type-appropriate templates** that `/faff-jot` (Step 4) and `/faff-plot` (Step 5) fill when they *create* tickets, so issues are **born structured** — predictable per-type fields a later `/faff-prep` can build on — instead of free prose prep has to reverse-engineer. It generalises the lite spec arc (WHY/WHAT/HOW/DONE) **earlier** (the create stage) and **by type**. Both create-skills reference this one section; they never duplicate the taxonomy or field sets. The fill step runs **after** the `methodology` slot's `ticket-shaping` proposes the set and **before** the description is handed to the `rendering_adaptor` (gateway → **Rendering**).

**The load-bearing invariant — seed, never constrain.** A template is a default the producer *fills*, never a form that *gates*. Ticket creation is **never** rejected, blocked, or warned-to-block because a field has no content; there is **no create-time completeness gate**. A one-line idea yields a thin-but-structured ticket (one filled field, the rest placeholdered), not an error. Completeness is `/faff-prep`'s gate, not creation's.

**Type taxonomy (closed set + fallback).**

- `bug` — a defect in existing behaviour
- `feature` — a new capability or behaviour
- `spike` — a time-boxed investigation / decision, no committed deliverable
- `chore` — maintenance with no user-facing behaviour change
- `epic` — a container that decomposes into child slices
- `default` — fallback when type can't be determined (guarantees the fill step always has a skeleton, preserving the never-block invariant)

**Built-in default field sets.** Each is an ordered field list; **every** template ends with `Open questions` (preserves jot's and plot's existing "carry open questions into the description" behaviour):

| Type | Fields (in order) |
|---|---|
| `bug` | Repro · Expected · Actual · Scope · Open questions |
| `feature` | Why · What · Acceptance · Open questions |
| `spike` | Question · Timebox · Decision to make · Open questions |
| `chore` | What · Why now · Open questions |
| `epic` | Outcome · Child slices · Open questions |
| `default` | Why · What · Open questions |

**Template resolution order** (first match wins, per type):

1. *Native-template slot* (tracker-native Linear/GitHub templates, **idea G**) — **implemented** (FAFF-1083). Ask the committed map for the tracker template mapped to this faff-type; on a hit, fill from the tracker's own template body (fetched live), keeping the tracker as source of truth. A miss (no map, no entry, a stale id, or an opaque body) falls through to tier 2 exactly as before. See **Native-template fill** below.
2. A committed **override file** at `.faff-templates/<type>.md`, if present.
3. The built-in default field set above.

(`default` resolves the same way; a project may even override `.faff-templates/default.md`.)

**Native-template fill (tier 1).** Only the create-skill's orchestrator lane runs this; the pure `faff` CLI never makes the tracker call. The read is **lane-bound**: the CLI returns the stored id, the skill lane fetches the body via `get_template`. It is **seed, never constrain** like every other tier — a miss never blocks creation, an unfilled field stays placeholdered.

```
resolve_native_template(type):        # → FieldSequence | MISS
  m := run `faff native-map get --type <type> --json`   # pure CLI; never errors on absence
  IF m.mapping == null: RETURN MISS                      # no tier-1 entry → tier 2
  tmpl := get_template(id = m.id)                        # orchestrator-lane MCP read (jot/plot's MCP lane)
  IF tmpl empty / not found (stale id, renamed/deleted): # OR an MCP timeout/absent connector
     REPORT stale mapping naming type + m.id + m.name    # extends "log the skipped override" (below)
     RETURN MISS
  fields := heading sequence of `## <Field>` in tmpl.content.description   # the SAME tier-2 parse
  IF fields is empty:                                    # opaque body: form template / plain prose / no `## ` headings
     REPORT opaque mapping naming type + m.id
     RETURN MISS
  RETURN fields
```

- The body arrives at `get_template(id)`'s **`content.description`** (a markdown string); read only its `## <Field>` **level-2 heading sequence** (body prose under a heading is the template's own guidance and is ignored, exactly as tier-2 override files are). A tracker *form* template applies its fields through a form, so its `content.description` carries no `## <Field>` headings — that is the opaque-body miss.
- First-match-wins is preserved: tier 1 only *prepends* a resolution attempt; on any miss the existing tier 2 → tier 3 order runs unchanged.
- **Git-only / no tracker connector:** `get_template` needs a tracker, so tier 1 always misses and the fill runs identically to today.

**Override files.** Live at committed `.faff-templates/<type>.md` — **deliberately outside** the gitignored `.faff/` directory (the `.faff/`-dir-only ignore is append-only and git's parent-exclusion rule blocks a `!.faff/templates/` carve-out, so the store sits outside `.faff/`; a multi-line per-type map is also not cleanly readable through the scalar/block-scalar config CLI — so files, not config, are the single override surface). **Format:** a markdown file whose level-2 headings (`## <Field>`) are the field list, in order; body text under a heading is the project's own guidance and is ignored by the fill step (it reads only the heading sequence).

**Type determination** (per proposed ticket):

1. If the methodology's `ticket-shaping` attached an optional per-ticket `type` that is in the taxonomy → use it.
2. Else infer from the ticket's title + description: *broken / incorrect / regressed behaviour* ("fails", "doesn't", "regression") → `bug`; *open question / "figure out" / "decide", no committed deliverable* → `spike`; *maintenance with no user-facing change (deps, refactor, config, cleanup)* → `chore`; *a container that decomposes into child slices / spans multiple deliverables* → `epic`; *a new capability or behaviour* → `feature` (the lean for greenfield brief items).
3. If inference isn't confident → `default`.

**The fill step** (run once per proposed ticket):

1. Determine the type (above).
2. Resolve the template (above).
3. For each field in order: emit `## <Field>` followed by the best-available content drawn from the proposed ticket + brief (e.g. `feature.Why` ← the brief's goal/why prose; `feature.Acceptance` ← the brief's done-signal; `bug.Repro` ← any repro prose; every template's `Open questions` ← the brief's open questions). **When no content is available, emit the field heading with the explicit placeholder `_To be determined during prep._`** — never silently omit a field, and **never fabricate** factual content (no invented repro steps, no invented acceptance).
4. The assembled fields become the description, which then routes through the `rendering_adaptor` and is written to the tracker exactly as before.

**Edge cases.**

- Override file that's empty, heading-less, or unreadable → treat as absent, fall through to the built-in default (never block), and **log the skipped override**.
- Override filename for an unknown type (`.faff-templates/foo.md`) → ignored; only the recognised type filenames + `default` are consulted.
- **plot** container nodes (`shape-level` = `initiative` / `project`, or any node with children) resolve to the `epic` template *type*, then run the tier-1 lookup for `epic`; buildable first-slice nodes infer their own type per node.
- **Git-only mode:** the fill step runs identically and the structured description is written into the `.faff/intake/…` file jot/plot already use; override files at `.faff-templates/` are read the same way.
- Existing create-path behaviour is otherwise unchanged — the fill step only restructures the *description body*; blocker/blocked-by links, `Backlog` status, and plot's `planned by /faff-plot` provenance line all still apply.

**Out-of-scope seams (documented, not built here):** persisting type as a `faff-type-<type>` control label (a later ticket, via **Control-label provisioning**, reading the type the fill step already determined); and a configurable `tracking.templates_path` key (mirroring `spec_docs_path` — a clean follow-up that touches the CLI allowlist). (The native-template resolution slot, idea G, is now built — FAFF-1083; see **Template resolution order** tier 1.)
