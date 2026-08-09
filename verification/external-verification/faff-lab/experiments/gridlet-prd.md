# PRD — gridlet: Browser Spreadsheet

- **Container:** gridlet
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver a browser spreadsheet whose value is entirely in the engine: formulas with real operator precedence, cell and range references, a dependency graph that recalculates only what an edit affects, and cycle detection that never hangs. The UI is deliberately minimal; correctness of evaluation is the task.

## Goals & success metrics

- Every corpus case evaluates to exactly the expected value.
- Editing a cell updates every dependent — and nothing else.
- The engine cannot be hung or crashed from inside a sheet.

## Non-goals

- Persistence, import, or export.
- Multiple sheets.
- Absolute references ($A$1) and copy/paste fill.
- Formatting: fonts, colors, number formats.
- Collaboration.

## Users

Anyone needing quick grid calculations in a browser tab; evaluators exercising the engine through the corpus.

## Requirements

- A grid of at least 26 columns × 100 rows with editable cells and a formula bar showing the raw content of the selected cell.
- Formulas begin with `=` and support: numbers, quoted strings, cell references (A1 style), ranges (A1:B10), `+ - * / ^` with conventional precedence, parentheses, comparison operators, and `&` for concatenation.
- Functions: SUM, AVERAGE, MIN, MAX, COUNT, IF, ROUND, ABS, LEN, CONCAT.
- An empty cell referenced arithmetically evaluates as 0; COUNT counts only numeric cells.
- Recalculation is dependency-driven: an edit recalculates the edited cell and its transitive dependents in dependency order, and touches nothing else.
- Reference cycles are detected: every cell on a cycle shows `#CYCLE!`; the app stays responsive.
- Errors — `#CYCLE!`, `#REF!`, `#VALUE!`, `#DIV/0!` — propagate to dependents.
- Determinism: the same cell contents produce the same computed values regardless of the order they were entered.
- The engine runs headless, decoupled from the DOM.
- A committed reference corpus — sheets of inputs with expected values, covering precedence, ranges, empty-cell semantics, every error kind, and cycles — and a headless harness that loads each case, evaluates it, and reports per-case pass/fail.
- Deployed as a static site with automated deploys. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given a cell containing `=2+3*4`, When evaluated, Then it MUST display 14.
- Given a cell containing `=(2+3)*4`, When evaluated, Then it MUST display 20.
- Given A1=1, A2 empty, A3=2, When a cell contains `=SUM(A1:A3)`, Then it MUST display 3, and a cell containing `=COUNT(A1:A3)` MUST display 2.
- Given a formula that uses an empty cell arithmetically, When evaluated, Then the empty cell MUST evaluate as 0.
- Given a cell edit, When recalculation completes, Then every direct and transitive dependent MUST show its updated value, and no other cell's value may change.
- Given A1 containing `=B1` and B1 containing `=A1`, When evaluated, Then both MUST display `#CYCLE!` and the app MUST remain responsive.
- Given a formula referencing a cell outside the grid, When evaluated, Then it MUST display `#REF!`.
- Given a division whose divisor evaluates to 0, When evaluated, Then the cell MUST display `#DIV/0!`.
- Given a cell depending on a cell that displays an error, When evaluated, Then the error MUST propagate to it.
- Given the same cell contents entered in two different orders, When both sheets are evaluated, Then every computed value MUST be identical.
- The engine MUST evaluate headless, without a DOM.
- The repository MUST include the corpus and harness; Given the harness runs, Then it MUST report pass/fail per corpus case and every case MUST pass.
- The site MUST be deployed as a static site with automated deploys and no manual deploy step.

## Evaluator note

The Acceptance criteria are objective, and the corpus makes engine correctness mechanical: the evaluator runs the harness rather than hand-checking formulas — and can add cases of their own and re-run, since a well-built engine passes cases its authors never saw. Residual duties: confirm the harness truly evaluates the corpus through the engine (not hardcoded answers) and that the corpus covers everything this brief claims it covers. Grid usability beyond the responsiveness criterion is a human judgement, not a gate.

## Open questions

- Grid size above the minimum, keyboard navigation, and the selection model are left to implementation.
- Function edge semantics not pinned here (e.g. ROUND's half-away vs half-even) are left to implementation, with the chosen behavior captured as corpus cases.
- String/number coercion rules beyond the corpus's `#VALUE!` cases are left to implementation.
