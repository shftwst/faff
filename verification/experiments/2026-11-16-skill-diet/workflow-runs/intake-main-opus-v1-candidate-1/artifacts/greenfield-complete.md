# Discovery brief: Tool library lending desk

mode: greenfield

## Goal
A lending desk for a neighbourhood tool library. It tracks which tools are lent to which neighbours and when they come back. One volunteer runs it on a laptop.

## Capabilities
- Tool catalogue: the tools the library holds and can lend.
- Checkout and return log: a record of each tool lent to a neighbour and its return.

## First slice
Record a checkout and its return for a tool already in the catalogue.

## Constraints
- Python CLI, as the existing README states.
- Runs offline on one laptop.

## Out of scope
- Online marketplace: no listing or exchange of tools online.
- Payments: no fees or charges are handled.

## Open questions
- How long should completed checkout records be kept?
