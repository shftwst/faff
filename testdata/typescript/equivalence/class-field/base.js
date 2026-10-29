class Fault extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
module.exports = { Fault };
