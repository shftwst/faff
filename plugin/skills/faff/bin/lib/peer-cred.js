"use strict";
// ===========================================================================
// === region:factory — peer-cred — FAFF-1211: read the Unix-socket peer uid via a trusted Python helper (ADR 0135) ===
//
// Node exposes no API for a Unix-domain socket's peer credentials, so the governor asks the kernel
// through a tiny Python helper: the helper inherits the accepted connection's descriptor as its stdin
// and calls getsockopt(SO_PEERCRED) on Linux / LOCAL_PEERCRED on macOS. The uid the kernel returns is
// authoritative — the caller cannot forge it. This module holds that read behind one injectable
// interface so tests drive the guard with a stub, and resolves the interpreter ONLY from a fixed list
// of trusted absolute paths (never PATH): the governor spawns the helper as its own user with the live
// peer socket in hand, so a runner-writable `python3` shim found via PATH would itself be an admit
// bypass. Requires Node built-ins only; the `.py` helper is not a `require`, so the shipped closure
// gains no runtime dependency.
// ===========================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
const isUid = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
// Fixed, operator-and-root-controlled absolute paths only. No element is derived from PATH or any
// user-writable directory: a runner-writable shim must never be reachable here.
const TRUSTED_PYTHON_PATHS = ["/usr/bin/python3"];
const HELPER_TIMEOUT_MS = 3000;
const HELPER_PATH = path.join(__dirname, "peer-cred-helper.py");
// The first trusted absolute path that names a regular file, or null when none is present.
function resolveTrustedInterpreter() {
    for (const p of TRUSTED_PYTHON_PATHS) {
        try {
            if (fs.statSync(p).isFile())
                return p;
        }
        catch {
            /* not present at this path — try the next */
        }
    }
    return null;
}
function socketFd(socket) {
    if (!isRecord(socket))
        return null;
    const handle = socket._handle;
    if (!isRecord(handle))
        return null;
    return isUid(handle.fd) ? handle.fd : null;
}
function readPeerUid(socket) {
    if (process.platform !== "linux" && process.platform !== "darwin") {
        return { ok: false, error: "unsupported-platform" };
    }
    const fd = socketFd(socket);
    if (fd === null)
        return { ok: false, error: "no-socket-fd" };
    const interpreter = resolveTrustedInterpreter();
    if (interpreter === null)
        return { ok: false, error: "interpreter-missing" };
    let r;
    try {
        r = spawnSync(interpreter, [HELPER_PATH], { stdio: [fd, "pipe", "pipe"], timeout: HELPER_TIMEOUT_MS, killSignal: "SIGKILL" });
    }
    catch {
        return { ok: false, error: "helper-spawn-failed" };
    }
    if (r.error)
        return { ok: false, error: "helper-timeout-or-spawn" };
    if (r.status !== 0)
        return { ok: false, error: "helper-nonzero" };
    let parsed;
    try {
        parsed = JSON.parse(String(r.stdout ?? ""));
    }
    catch {
        return { ok: false, error: "unparseable" };
    }
    if (!isRecord(parsed) || !isUid(parsed.uid))
        return { ok: false, error: "unparseable" };
    const result = { ok: true, uid: parsed.uid };
    if (isUid(parsed.gid))
        result.gid = parsed.gid;
    if (isUid(parsed.pid))
        result.pid = parsed.pid;
    return result;
}
function makePeerCredReader() {
    return { readPeerUid };
}
module.exports = { makePeerCredReader, readPeerUid, resolveTrustedInterpreter, TRUSTED_PYTHON_PATHS };
