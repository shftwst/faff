# Discovery brief: CSV export empty rows

mode: single-item

## Goal
Remove the extra empty rows inserted after each record in CSV export.

## Item

intent: Remove the extra empty rows from CSV export.
done-signal: Two records export as two data rows under the existing header.
area: Reporting.
split-sense: unitary.

## Constraints

- Preserve the existing columns and header.
- Use existing issue naming.

## Dependencies

- REPORT-17: Correct CSV parser row boundaries. This parser correction must ship first.

## Out of scope

- Report UI redesign.