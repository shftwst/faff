# Faff gateway reference — create lane

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Ticket templates (born-structured create boundary)

After `ticket-shaping` and before rendering, jot and plot fill one description per ticket. Templates seed drafts. Even a one-line idea can be created, with open fields left for prep.

**Choose the type.** Plot's initiative/project nodes and nodes with children use `epic`; infer each buildable slice separately. Otherwise prefer a recognised methodology type. From title and description, choose `bug` for broken behaviour, `feature` for new behaviour, `spike` for a time-boxed question or decision, `chore` for maintenance, or `epic` for a container. Use `default` when uncertain.

**Resolve fields.** Run `faff native-map fields --type TYPE`. In git-only mode add `--local`. The command resolves the same templates directory as `faff config templates-path --absolute` and returns ordered `fields` from the type override or built-in defaults, or a mapped `{id,name}` for the caller to fetch.

- On `{id,name}`, fetch the live template by id through the discovered tracker's `get_template`. Supply its `content.description` markdown to the same command with `--native-body FILE` (or `-` for stdin). Only level-2 field headings count.
- On a missing, stale or unreachable template, report the type, id and name and repeat with `--local`. For an opaque native body, report the type and id. The command falls back to the committed override and then the built-in fields. Surface skipped-override diagnostics. Template misses never block creation.

**Fill in order.** Emit `## <Field>` and the best available content from the ticket and brief, including known open questions. For an unknown field use exactly `_To be determined during prep._`. Keep every field and never invent facts. Pass the description through `rendering_adaptor` and write it via the usual tracker or git-only intake lane. Preserve blocker links, Backlog status and plot's `planned by /faff-plot` provenance. The chosen type is not a control label.
