// FAFF-1400: deterministic "swap landed between any check and the read" stub. Wraps lstatSync and openSync on
// the shared node:fs module object (the one the hashers call through at call time). On the FIRST call of either
// that names `target`, it swaps the target for `swap()`'s result: after a real lstat returns (so a pre-check
// sees the regular file), or before delegating an open (so an implementation with no pre-check opens the
// swapped path). Every later call delegates unchanged. No timing, no concurrency.

import { createRequire } from "node:module";
import { resolve } from "node:path";

const fs = createRequire(import.meta.url)("node:fs");

export function installSwapOnFirstTouch(target, swap) {
  const want = resolve(target);
  const real = { lstatSync: fs.lstatSync, openSync: fs.openSync };
  const state = { calls: 0, fired: false, restore() { fs.lstatSync = real.lstatSync; fs.openSync = real.openSync; } };
  const touch = (p) => typeof p === "string" && resolve(p) === want;
  fs.lstatSync = function (p, ...rest) {
    const st = real.lstatSync.call(this, p, ...rest);
    if (touch(p)) { state.calls++; if (!state.fired) { state.fired = true; swap(); } }
    return st;
  };
  fs.openSync = function (p, ...rest) {
    if (touch(p)) { state.calls++; if (!state.fired) { state.fired = true; swap(); } }
    return real.openSync.call(this, p, ...rest);
  };
  return state;
}
