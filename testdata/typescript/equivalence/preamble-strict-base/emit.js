"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// already strict on main
const path = require("path");
function rel(a, b) {
    return path.relative(a, b);
}
module.exports = { rel };
