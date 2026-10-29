"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function first(rows) {
    const row = rows[0];
    if (row === undefined)
        throw new Error("first: no row");
    return row.name;
}
module.exports = { first };
