// FAFF-1107 fixture component (SUT-cage source): a minimal, buildable Node package the
// containerised bridge reflects over the session RPC wire. It maps 1:1 onto the wire
// conformance scenarios - push 7 then pop returns 7, an empty pop throws TypeError, and a
// static util.drain(n) returns 2n for call_static. It is a test fixture, never shipped.

export class Stack {
  constructor() {
    this.items = [];
  }

  push(x) {
    this.items.push(x);
  }

  pop() {
    if (!this.items.length) throw new TypeError("pop from empty stack");
    return this.items.pop();
  }

  size() {
    return this.items.length;
  }
}

export const util = {
  drain: (n) => n * 2,
};
