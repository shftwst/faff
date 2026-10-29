"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Fault extends Error {
    reason;
    constructor(reason) {
        super(reason);
        this.reason = reason;
    }
}
module.exports = { Fault };
