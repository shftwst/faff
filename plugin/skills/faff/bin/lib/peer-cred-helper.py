#!/usr/bin/env python3
# region:factory — peer-cred-helper — FAFF-1211: read the kernel peer credentials of an inherited
# Unix-socket descriptor (stdin, fd 0) and print one line of JSON, or exit non-zero.
#
# The governor spawns this helper with the accepted connection's file descriptor as fd 0 and resolves
# the interpreter from a trusted absolute path only (never PATH). It reads the kernel-authoritative
# peer uid: SO_PEERCRED (struct ucred) on Linux; LOCAL_PEERCRED (struct xucred) on macOS. It writes
# {"uid": N, "gid": N, "pid": N} and exits 0, or writes nothing and exits non-zero (fail closed).
#
# This script is NOT a `require` and ships as a plain file, so it adds no runtime dependency to the
# Node closure and is outside build-manifest's `.ts`->`.js` scope.
import json
import socket
import struct
import sys


def read_linux(sock):
    # struct ucred { pid_t pid; uid_t uid; gid_t gid; } — three native 32-bit ints.
    SO_PEERCRED = 17
    raw = sock.getsockopt(socket.SOL_SOCKET, SO_PEERCRED, struct.calcsize("iii"))
    pid, uid, gid = struct.unpack("iii", raw)
    return {"uid": uid, "gid": gid, "pid": pid}


def read_darwin(sock):
    # struct xucred { u_int cr_version; uid_t cr_uid; short cr_ngroups; gid_t cr_groups[NGROUPS]; }
    # with NGROUPS == 16. LOCAL_PEERCRED is read at level SOL_LOCAL (0). Only cr_uid is used; the
    # effective gid (cr_groups[0]) is reported when present. pid is not carried by xucred.
    SOL_LOCAL = 0
    LOCAL_PEERCRED = 0x001
    NGROUPS = 16
    size = struct.calcsize("I") + struct.calcsize("I") + struct.calcsize("h") + struct.calcsize("%dI" % NGROUPS)
    raw = sock.getsockopt(SOL_LOCAL, LOCAL_PEERCRED, size)
    cr_version, cr_uid = struct.unpack_from("II", raw, 0)
    out = {"uid": cr_uid}
    cr_ngroups = struct.unpack_from("h", raw, struct.calcsize("II"))[0]
    if cr_ngroups > 0:
        groups_off = struct.calcsize("II") + struct.calcsize("h")
        # account for the compiler's alignment padding between the short and the gid array
        groups_off = (groups_off + 3) & ~3
        out["gid"] = struct.unpack_from("I", raw, groups_off)[0]
    return out


def main():
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM, fileno=0)
    except Exception:
        return 1
    try:
        if sys.platform.startswith("linux"):
            out = read_linux(sock)
        elif sys.platform == "darwin":
            out = read_darwin(sock)
        else:
            return 2
    except Exception:
        return 3
    finally:
        # The fd is owned by the parent; detach so the parent's socket is never closed by this child.
        try:
            sock.detach()
        except Exception:
            pass
    if not isinstance(out.get("uid"), int) or out["uid"] < 0:
        return 4
    sys.stdout.write(json.dumps(out))
    return 0


sys.exit(main())
