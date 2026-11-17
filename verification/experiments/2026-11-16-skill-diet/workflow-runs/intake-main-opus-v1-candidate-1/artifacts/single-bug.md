# Discovery brief: Empty rows in CSV export

mode: single-item

## Goal
CSV export inserts an empty row after each record. Remove the extra empty rows so the export contains only data rows under the header.

## Item
intent: Remove the empty row that CSV export inserts after each record.
done-signal: Two records export as two data rows under the existing header.
area: Reporting
split-sense: unitary

## Constraints
- Keep the existing columns and header.
- Follow the Reporting workstream's existing issue naming.

## Dependencies
- REPORT-17, which corrects the CSV parser's row boundaries, must ship first.

## Out of scope
- Report UI redesign: the report screens are not changed.
