# Discovery brief: Tool library lending desk

mode: greenfield

## Goal
Track which tools a neighbourhood tool library has lent to neighbours and when each one comes back. The user is the volunteer who runs the lending desk on one laptop.

## Capabilities
- Tool catalogue: the list of tools the library holds and can lend.
- Checkout and return log: a record of each tool lent to a neighbour and its return.

## First slice
Record a checkout and its return for a tool that is already in the catalogue.

## Constraints
- Python CLI, as the existing README states.
- Runs offline on one laptop.

## Out of scope
- Online marketplace: no listing or browsing of tools online.
- Payments: no fees, deposits or charges.

## Open questions
- How long should completed checkout records be retained?
