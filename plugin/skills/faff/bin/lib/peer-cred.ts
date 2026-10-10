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

import type { Socket } from "node:net";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

export type PeerCredResult =
  | { ok: true; uid: number; gid?: number; pid?: number }
  | { ok: false; error: string };

export interface PeerCredReader {
  readPeerUid(socket: Socket): PeerCredResult;
}

// Fixed, operator-and-root-controlled absolute paths only. No element is derived from PATH or any
// user-writable directory: a runner-writable shim must never be reachable here.
const TRUSTED_PYTHON_PATHS: string[] = ["/usr/bin/python3"];
const HELPER_TIMEOUT_MS = 3000;
const HELPER_PATH = path.join(__dirname, "peer-cred-helper.py");

// The first trusted absolute path that names a regular file, or null when none is present.
function resolveTrustedInterpreter(): string | null {
  for (const p of TRUSTED_PYTHON_PATHS) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* not present at this path — try the next */
    }
  }
  return null;
}

function socketFd(socket: Socket): number | null {
  const handle = (socket as unknown as { _handle?: { fd?: unknown } })._handle;
  const fd = handle && typeof handle.fd === "number" ? handle.fd : null;
  return fd !== null && Number.isInteger(fd) && fd >= 0 ? fd : null;
}

function readPeerUid(socket: Socket): PeerCredResult {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    return { ok: false, error: "unsupported-platform" };
  }
  const fd = socketFd(socket);
  if (fd === null) return { ok: false, error: "no-socket-fd" };
  const interpreter = resolveTrustedInterpreter();
  if (interpreter === null) return { ok: false, error: "interpreter-missing" };
  let r: { error?: unknown; status: number | null; stdout?: unknown };
  try {
    r = spawnSync(interpreter, [HELPER_PATH], { stdio: [fd, "pipe", "pipe"], timeout: HELPER_TIMEOUT_MS, killSignal: "SIGKILL" });
  } catch {
    return { ok: false, error: "helper-spawn-failed" };
  }
  if (r.error) return { ok: false, error: "helper-timeout-or-spawn" };
  if (r.status !== 0) return { ok: false, error: "helper-nonzero" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(r.stdout ?? ""));
  } catch {
    return { ok: false, error: "unparseable" };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, error: "unparseable" };
  const rec = parsed as { uid?: unknown; gid?: unknown; pid?: unknown };
  if (typeof rec.uid !== "number" || !Number.isInteger(rec.uid) || rec.uid < 0) {
    return { ok: false, error: "unparseable" };
  }
  const result: { ok: true; uid: number; gid?: number; pid?: number } = { ok: true, uid: rec.uid };
  if (typeof rec.gid === "number" && Number.isInteger(rec.gid) && rec.gid >= 0) result.gid = rec.gid;
  if (typeof rec.pid === "number" && Number.isInteger(rec.pid) && rec.pid >= 0) result.pid = rec.pid;
  return result;
}

function makePeerCredReader(): PeerCredReader {
  return { readPeerUid };
}

module.exports = { makePeerCredReader, readPeerUid, resolveTrustedInterpreter, TRUSTED_PYTHON_PATHS };
