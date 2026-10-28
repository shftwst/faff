// ===========================================================================
// === region:governance — leaf-read — FAFF-1400: one no-follow descriptor read for the digest hashers ===
// A hash is only as trustworthy as the open that produced its bytes. This helper opens a path once with
// O_NOFOLLOW (a symlink in the final component is refused, never followed) and O_NONBLOCK (a FIFO never
// blocks the open), asks the descriptor what it is, and reads bytes from that same descriptor only when it
// is a regular file. Both hashers (evidence.js, integrity-digest.js) read through it so their
// classification of a path cannot drift apart. It hashes nothing and requires only node:fs.
// ===========================================================================

"use strict";

const fs = require("node:fs");

// readLeafNoFollow(abs, constants = fs.constants) -> { kind, bytes }
//   kind: regular | symlink | directory | other | absent; bytes is a Buffer iff kind is regular.
// `constants` is a test-only seam (fs.constants properties are non-writable). Throws a plain Error when
// either flag is missing (dropping one silently reopens a hole), when open fails for any reason other than
// absent, a symlink or a special file, and when fstat or the read fails. fs.* is called through the module object so a
// test can wrap it.
function readLeafNoFollow(abs, constants = fs.constants) {
  const { O_NOFOLLOW, O_NONBLOCK } = constants;
  if (typeof O_NOFOLLOW !== "number" || typeof O_NONBLOCK !== "number") {
    throw new Error("no-follow non-blocking open unsupported on this platform");
  }
  let fd;
  try {
    fd = fs.openSync(abs, constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return { kind: "absent", bytes: null };
    // The refusal code for a symlink differs across POSIX systems (ELOOP on Linux and macOS), so confirm
    // with an lstat instead of matching an errno. The lstat reads no content.
    let lst;
    try { lst = fs.lstatSync(abs); } catch (le) {
      if (le.code === "ENOENT") return { kind: "absent", bytes: null };
      throw new Error(`cannot open ${abs}: ${e.code || e.message}`);
    }
    if (lst.isSymbolicLink()) return { kind: "symlink", bytes: null };
    // A socket fails a no-follow open (ENXIO) before fstat can see it; a stable special file is still
    // "other", never a fault. A regular file or directory that failed to open stays a fault.
    if (lst.isSocket() || lst.isFIFO() || lst.isCharacterDevice() || lst.isBlockDevice()) return { kind: "other", bytes: null };
    throw new Error(`cannot open ${abs}: ${e.code || e.message}`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (st.isFile()) return { kind: "regular", bytes: fs.readFileSync(fd) };
    return { kind: st.isDirectory() ? "directory" : "other", bytes: null };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { readLeafNoFollow };
