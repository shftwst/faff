# Discovery brief: Extra empty rows in CSV export

mode: single-item

## Goal
CSV export inserts an empty row after each record. Remove those empty rows so the export holds only the header and the data rows.

## Item
intent: Remove the extra empty rows from CSV export.
done-signal: Two records export as two data rows under the existing header.
area: Reporting
split-sense: unitary

## Constraints
- Preserve the existing columns and header.
- Follow the existing issue naming in the Reporting workstream.

## Dependencies
- REPORT-17 (correct the CSV parser's row boundaries) must ship first.

## Out of scope
- Report UI redesign: the report screens stay as they are.
