"use strict";
// already strict on main
const path = require("path");
function rel(a, b) { return path.relative(a, b); }
module.exports = { rel };
