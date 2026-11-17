# Discovery brief: Delivery date on order receipt

mode: single-item

## Goal
Show the scheduled delivery date, already stored on the order, on the order receipt.

## Item
intent: Show the delivery date already stored on the order.
done-signal: A receipt with a stored delivery date shows it; one without it omits the field.
area: Checkout
split-sense: unitary

## Constraints
- Use the existing receipt layout.

## Out of scope
- New delivery estimation logic: the receipt shows the stored date only.

## Open questions
- The display timezone for the delivery date is unresolved; carried forward for /faff-prep.
