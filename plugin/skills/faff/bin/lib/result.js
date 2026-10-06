"use strict";
// ===========================================================================
// === region:governance — result — FAFF-1180: closed Ok/Err result and an exhaustiveness check ===
//
// A parser or handler returns a Result instead of throwing, so a caller must handle both arms.
// assertNever closes a switch over a union: an unhandled variant fails compilation, and at runtime
// it throws rather than falling through a default. Pure, requires nothing.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
function ok(value) {
    return { ok: true, value };
}
function err(error) {
    return { ok: false, error };
}
function describe(value) {
    try {
        const json = JSON.stringify(value);
        return typeof json === "string" ? json : typeof value;
    }
    catch {
        return typeof value;
    }
}
function assertNever(value, context) {
    throw new Error(`${context}: unhandled variant ${describe(value)}`);
}
module.exports = { ok, err, assertNever };
