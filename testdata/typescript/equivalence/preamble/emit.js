"use strict";
// a hand-written module
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
function size(p) {
    return fs.statSync(p).size;
}
module.exports = { size };
