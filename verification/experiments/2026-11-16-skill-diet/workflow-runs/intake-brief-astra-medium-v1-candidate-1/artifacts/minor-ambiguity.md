# Discovery brief: Receipt delivery date

mode: single-item

## Goal
Show receipt readers the scheduled delivery date already stored on their order.

## Item
intent: Show the delivery date already stored on the order.
done-signal: A receipt with a stored delivery date shows it; one without it omits the field.
area: Checkout
split-sense: unitary

## Constraints
- Use the existing receipt component and layout.

## Out of scope
- New delivery estimation logic.

## Open questions
- The display timezone is unresolved; carry it forward for prep.
