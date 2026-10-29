// a hand-written module
const fs = require("fs");

function size(p) { return fs.statSync(p).size; }

module.exports = { size };
