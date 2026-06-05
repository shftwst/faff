# FAFF-45 — Gateway should mention the /faff-jot ISSUE-XX existing-ticket interactor

> Spec: faff-prep · faffter-noon-spec · 2026-06-05 · confidence: high. Full spec on Linear FAFF-45.

## WHY
After FAFF-24, `/faff-jot ISSUE-XX` acts on an existing ticket (v1 freeze/thaw of the
automation hold), but the gateway still frames `/faff-jot` as new-work/creation only — so a
shipped capability isn't discoverable from the routing layer, and the routing prose's
"(the rest act on tickets that already exist)" is now a false generalisation.

## WHAT (two markdown edits to skills/faff/SKILL.md only)
1. Routing-table `/faff-jot` row — append a clause naming the existing-ticket interactor.
2. Routing prose — qualify the "(the rest act on tickets that already exist)" parenthetical
   to acknowledge `/faff-jot ISSUE-XX`, as a *mode* of `/faff-jot` (not a separate command).

## Decisions
- **Chosen:** append to the existing row / qualify the existing parenthetical rather than add
  a new table row (a new row would imply a separate command).
- Out of scope: frontmatter `description:` (left unchanged, per ticket scoping); faff-jot/SKILL.md.

## DONE
- [x] Routing-table row mentions `/faff-jot ISSUE-XX`.
- [x] Routing prose no longer asserts the parenthetical unqualified.
- [x] Points the reader at jot's "Existing-ticket interactor".
- [x] Not presented as a separate command (a mode selected by argument).
- [x] Frontmatter + other sections unchanged.
- [x] Code diff limited to the two touch-points in skills/faff/SKILL.md.
