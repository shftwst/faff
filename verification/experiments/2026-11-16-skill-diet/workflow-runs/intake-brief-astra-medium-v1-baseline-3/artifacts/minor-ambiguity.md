# Discovery brief: Delivery date on order receipts

mode: single-item

## Goal
Show the delivery date already stored on an order on its receipt.

## Item

- intent: Show the order's stored delivery date on the receipt.
- done-signal: A receipt with a stored delivery date shows it; one without it omits the field.
- area: Checkout, existing receipt component.
- split-sense: unitary.

## Constraints

- Use the existing receipt layout.

## Out of scope

- New delivery estimation logic.

## Open questions

- The display timezone is unresolved. Carry forward for prep without blocking the brief.
