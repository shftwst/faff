# Discovery brief: Delivery date on order receipt

mode: single-item

## Goal
Show the scheduled delivery date already stored on an order on that order's receipt.

## Item
intent: Show the stored delivery date on the order receipt.
done-signal: A receipt for an order with a stored delivery date shows it; a receipt for an order without one leaves the field out.
area: Checkout
split-sense: unitary

## Constraints
- Use the existing receipt layout.

## Out of scope
- New delivery estimation logic: the receipt shows only the date already stored.

## Open questions
- Which timezone the delivery date is displayed in is unresolved; to be settled at prep.
