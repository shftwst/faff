"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
function get(v, k) {
    return Reflect.get(Object(v), k);
}
function code(p) {
    try {
        fs.statSync(p);
        return null;
    }
    catch (e) {
        return get(e, "code");
    }
}
module.exports = { code };
