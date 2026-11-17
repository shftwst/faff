# Discovery brief: CSV export empty rows

mode: single-item

## Goal
Remove the empty row inserted after each record in CSV export for users of Reporting.

## Item
intent: Remove the extra empty rows from CSV export.
done-signal: Two records export as two data rows under the existing header.
area: Reporting
split-sense: unitary

## Constraints

- Preserve the existing columns and header.
- Use existing issue naming conventions.

## Dependencies

- REPORT-17: Correct CSV parser row boundaries must ship first.

## Out of scope

- Report UI redesign.
