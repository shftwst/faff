#!/bin/sh
# FAFF-654 — the probe.
#
# Reads a fixed list of signals and prints them in a fixed order, on any Linux
# machine with a POSIX shell. Depends on nothing from the CI system and nothing
# from faff. It decides nothing, compares nothing, and recommends nothing:
# every line is an observation.
#
# Usage:
#   probe.sh --shape <label> [--environ-keys names|count]
#   probe.sh --selftest
#
# Exits 0 unconditionally in probe mode — an unreadable file is a finding, not
# an error, and a non-zero exit would fail the job and lose the transcript from
# the shape whose reading was most interesting.
#
# See docs/specs/2026-07-26-FAFF-654-*-design.md for why each choice is as it is.

PROBE_VERSION=1

# ---------------------------------------------------------------------------
# The value grammar. Every reading is exactly one of these six tokens.
#
#   present(<detail>)          observed and read
#   absent                     constructible, ancestors searchable, leaf not there
#   unreadable(<class>)        exists, open-or-read did not succeed
#   undecidable(<why>)         the shell cannot tell absent from unreadable here
#   impossible_on_shape(<why>) cannot exist on this shape
#   unmeasurable_here(<why>)   may exist; this methodology cannot obtain it here
#
# The unreadable classes are not-readable-by-euid, open-failed and read-failed.
# present carries the literal detail "empty" when a read succeeded and obtained
# no bytes — that is a statement about the read, not about the file.
# ---------------------------------------------------------------------------

emit() { printf '%s: %s\n' "$1" "$2"; }

# Continuation lines for a multi-line reading. Marked so they can never be
# mistaken for key lines by anything reading the transcript.
emit_block() {
  while IFS= read -r _eb_line; do
    printf '  | %s\n' "$_eb_line"
  done
}

scratch_file() {
  if [ -n "$PROBE_TMPDIR" ]; then
    _sf=$PROBE_TMPDIR/scratch.$$
    : > "$_sf" 2>/dev/null && { printf '%s' "$_sf"; return 0; }
  fi
  mktemp 2>/dev/null || {
    _sf=${TMPDIR:-/tmp}/probe.scratch.$$
    : > "$_sf" 2>/dev/null && printf '%s' "$_sf"
  }
}

# detail_ls <path> — the numeric long listing, verbatim, never parsed.
# -d so a directory reports itself rather than its contents.
detail_ls() { ls -ldn "$1" 2>/dev/null || printf 'ls-failed'; }

# ---------------------------------------------------------------------------
# classify_path <path> [detail_mode]
#
# detail_mode: ok (default) | ls
#
# Steps 1-7 of the classifier. Step 0 (unconstructible paths) is classify_var
# below, because only the caller knows which variable a path was built from.
# ---------------------------------------------------------------------------
classify_path() {
  cp_path=$1
  cp_mode=${2:-ok}

  # --- steps 1-2: walk the ancestors before testing the leaf.
  # [ -e ] alone is false for both "not there" and "cannot search the parent",
  # so the ancestors are what recover the distinction.
  case "$cp_path" in
    /*) cp_acc=""; cp_rest=${cp_path#/}
        if [ ! -x / ]; then
          printf 'undecidable(ancestor-not-searchable:/)'; return 0
        fi ;;
    *)  cp_acc="."; cp_rest=$cp_path ;;
  esac

  while :; do
    case "$cp_rest" in
      */*) cp_comp=${cp_rest%%/*}; cp_rest=${cp_rest#*/} ;;
      *)   break ;;
    esac
    [ -n "$cp_comp" ] || continue          # tolerate a doubled separator
    cp_acc="$cp_acc/$cp_comp"
    if [ ! -d "$cp_acc" ]; then
      if [ -e "$cp_acc" ]; then
        printf 'undecidable(ancestor-not-a-directory:%s)' "$cp_acc"; return 0
      fi
      # a genuinely missing ancestor is decisive: the leaf cannot exist
      printf 'absent'; return 0
    fi
    if [ ! -x "$cp_acc" ]; then
      printf 'undecidable(ancestor-not-searchable:%s)' "$cp_acc"; return 0
    fi
  done

  # --- step 3: every ancestor exists and is searchable, so [ -e ] now decides.
  if [ ! -e "$cp_path" ]; then printf 'absent'; return 0; fi

  # --- step 4
  if [ ! -r "$cp_path" ]; then printf 'unreadable(not-readable-by-euid)'; return 0; fi

  # --- step 5: a directory's readability is its listing, not a byte read.
  # A read on a directory fd returns EISDIR on Linux and would misclassify it.
  if [ -d "$cp_path" ]; then
    if [ "$cp_mode" = ls ]; then printf 'present(%s)' "$(detail_ls "$cp_path")"
    else printf 'present(directory)'; fi
    return 0
  fi

  # --- step 6: probe the OPEN on its own. Its status alone answers whether the
  # open succeeded — e.g. ENXIO on a live socket, which reads open-failed.
  if ! ( : < "$cp_path" ) 2>/dev/null; then
    printf 'unreadable(open-failed)'; return 0
  fi

  # --- step 7: read the first byte into a scratch file, so the reader's own
  # status survives. A pipe would report the counter's status instead — measured,
  # a failing read piped into the counter reports success with zero bytes, which
  # is the exact silent-wrong-answer this classifier exists to prevent.
  cp_tmp=$(scratch_file)
  if [ -z "$cp_tmp" ]; then
    printf 'unmeasurable_here(no scratch file available: cannot separate read from open)'
    return 0
  fi
  dd if="$cp_path" bs=1 count=1 of="$cp_tmp" >/dev/null 2>/dev/null
  cp_rc=$?
  cp_n=$(wc -c < "$cp_tmp" 2>/dev/null | tr -d ' \t')
  rm -f "$cp_tmp"
  [ -n "$cp_n" ] || cp_n=0

  if [ "$cp_rc" -ne 0 ]; then printf 'unreadable(read-failed)'; return 0; fi
  if [ "$cp_n" -eq 0 ]; then printf 'present("empty")'; return 0; fi

  if [ "$cp_mode" = ls ]; then printf 'present(%s)' "$(detail_ls "$cp_path")"
  else printf 'present(read-ok)'; fi
  return 0
}

# ---------------------------------------------------------------------------
# classify_var <value> <varname> <suffix> [detail_mode]
#
# Step 0. A path whose variable part is unset is NOT constructible: it is never
# assembled and never tested, because a mangled path walks cleanly to a
# confident "absent" for a thing nobody ever looked at.
# ---------------------------------------------------------------------------
classify_var() {
  cv_val=$1; cv_name=$2; cv_suffix=$3; cv_mode=${4:-ok}
  if [ -z "$cv_val" ]; then
    printf 'unmeasurable_here(%s unset: path not constructible)' "$cv_name"
    return 0
  fi
  classify_path "$cv_val$cv_suffix" "$cv_mode"
}

# is the path a symlink whose target does not resolve?
dangling_symlink() {
  if [ -h "$1" ] && [ ! -e "$1" ]; then printf 'yes'; else printf 'no'; fi
}

# ===========================================================================
# SELFTEST
#
# Ten fixture cases, all built inside a temp tree so the run is self-contained
# and behaves identically on a host with an unusual filesystem layout.
#
# Two tokens have no case at all and cannot get one: unreadable(open-failed)
# needs a file whose readable test passes and whose open then fails (a unix
# socket returning ENXIO, or a device node) — POSIX sh cannot create a socket,
# mknod needs root, and a FIFO blocks on open with no portable timeout, which
# is worse than no fixture. unreadable(read-failed) has no portable fixture
# either. Both are exercised only in the field, and possibly not even there:
# measured, pid 1's environ — the canonical open-succeeds-read-fails example —
# fails at OPEN on at least one machine, not at read.
# ===========================================================================
st_pass=0; st_skip=0; st_fail=0
st_euid=$(id -u 2>/dev/null || printf '?')

st_case() {
  # st_case <name> <expected-prefix> <observed>
  sc_name=$1; sc_expect=$2; sc_obs=$3
  case "$sc_obs" in
    "$sc_expect"*)
      st_pass=$((st_pass + 1))
      printf '%-34s expected=%-40s observed=%-46s PASS\n' "$sc_name" "$sc_expect" "$sc_obs" ;;
    *)
      st_fail=$((st_fail + 1))
      printf '%-34s expected=%-40s observed=%-46s FAIL\n' "$sc_name" "$sc_expect" "$sc_obs" ;;
  esac
}

st_skip_case() {
  st_skip=$((st_skip + 1))
  printf '%-34s expected=%-40s observed=%-46s SKIPPED-EUID-0\n' \
    "$1" "$2" 'unmeasurable_here(euid 0: access(2) grants search and read regardless)'
}

selftest() {
  st_root=$(mktemp -d 2>/dev/null) || {
    printf 'selftest: cannot create a temp directory\n' >&2; return 2
  }
  PROBE_TMPDIR=$st_root

  # (a) a file that exists, is readable, and has bytes
  printf 'x' > "$st_root/a_hasbytes"
  # (b) a path that genuinely does not exist, under an existing directory
  #     -> lands on step 3's leaf test
  # (c) a file inside a directory with mode 0000
  mkdir -p "$st_root/c_dir"; printf 'x' > "$st_root/c_dir/leaf"; chmod 000 "$st_root/c_dir"
  # (d) a dangling symlink
  ln -s "$st_root/nowhere-at-all" "$st_root/d_dangling" 2>/dev/null
  # (e) a mode-0000 file inside a searchable directory
  printf 'x' > "$st_root/e_noperm"; chmod 000 "$st_root/e_noperm"
  # (f) a path whose ancestor is a regular file
  printf 'x' > "$st_root/f_afile"
  # (g) handled by classify_var with an explicitly unset variable
  # (h) an empty file
  : > "$st_root/h_empty"
  # (i) a path under a genuinely missing ancestor directory
  #     -> lands on step 2a's ancestor-walk absent, a different branch from (b)
  # (j) a directory
  mkdir -p "$st_root/j_dir"

  printf 'probe selftest — probe_version %s, euid %s\n\n' "$PROBE_VERSION" "$st_euid"

  st_case 'a readable-with-bytes'     'present('    "$(classify_path "$st_root/a_hasbytes")"
  st_case 'b missing-leaf'            'absent'      "$(classify_path "$st_root/b_not_here")"

  if [ "$st_euid" = 0 ]; then
    st_skip_case 'c unsearchable-ancestor' 'undecidable(ancestor-not-searchable'
  else
    st_case 'c unsearchable-ancestor' 'undecidable(ancestor-not-searchable' \
      "$(classify_path "$st_root/c_dir/leaf")"
  fi

  st_case 'd dangling-symlink'        'absent'      "$(classify_path "$st_root/d_dangling")"
  st_case 'd dangling-sibling-key'    'yes'         "$(dangling_symlink "$st_root/d_dangling")"

  if [ "$st_euid" = 0 ]; then
    st_skip_case 'e unreadable-leaf' 'unreadable(not-readable-by-euid)'
  else
    st_case 'e unreadable-leaf'       'unreadable(not-readable-by-euid)' \
      "$(classify_path "$st_root/e_noperm")"
  fi

  st_case 'f ancestor-not-a-directory' 'undecidable(ancestor-not-a-directory' \
    "$(classify_path "$st_root/f_afile/leaf")"
  st_case 'g unconstructible-path'    'unmeasurable_here(PROBE_SELFTEST_UNSET unset' \
    "$(classify_var "" PROBE_SELFTEST_UNSET /sock)"
  st_case 'h empty-file'              'present("empty")' "$(classify_path "$st_root/h_empty")"
  st_case 'i missing-ancestor'        'absent'      "$(classify_path "$st_root/i_absent_dir/leaf")"
  st_case 'j directory'               'present('    "$(classify_path "$st_root/j_dir")"

  printf '\nunreadable(open-failed)            no fixture — POSIX sh cannot create a socket; a FIFO blocks on open\n'
  printf 'unreadable(read-failed)            no fixture — no portable way to fail a read after a successful open\n'

  chmod 700 "$st_root/c_dir" 2>/dev/null
  rm -rf "$st_root"
  PROBE_TMPDIR=

  printf '\nselftest: %s passed, %s skipped (euid %s), %s failed\n' \
    "$st_pass" "$st_skip" "$st_euid" "$st_fail"
  [ "$st_fail" -eq 0 ] || return 1
  return 0
}

# ===========================================================================
# PROBE
# ===========================================================================
probe() {
  p_shape=$1
  p_environ_mode=$2
  p_euid=$(id -u 2>/dev/null || printf 'unknown')

  # --- provenance header -------------------------------------------------
  emit probe_version "$PROBE_VERSION"

  p_cksum=$(cksum "$0" 2>/dev/null | cut -d' ' -f1,2)
  if [ -n "$p_cksum" ]; then emit probe_cksum "$p_cksum"
  else emit probe_cksum 'unmeasurable_here(no cksum on PATH)'; fi

  p_sha=""
  if command -v sha256sum >/dev/null 2>&1; then
    p_sha=$(sha256sum "$0" 2>/dev/null | cut -d' ' -f1)
  elif command -v shasum >/dev/null 2>&1; then
    p_sha=$(shasum -a 256 "$0" 2>/dev/null | cut -d' ' -f1)
  fi
  if [ -n "$p_sha" ]; then emit probe_sha256 "$p_sha"
  else emit probe_sha256 'unmeasurable_here(no-digest-tool)'; fi

  p_bytes=$(wc -c < "$0" 2>/dev/null | tr -d ' \t')
  emit probe_bytes "${p_bytes:-unknown}"

  emit shape "$p_shape"
  emit source_repository "${GITHUB_REPOSITORY:-unknown}"
  emit probe_euid "$p_euid"
  emit captured_at "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf 'unknown')"
  emit runner_os "$(uname -s 2>/dev/null || printf 'unknown')"
  emit runner_arch "$(uname -m 2>/dev/null || printf 'unknown')"
  emit container_image "${PROBE_CONTAINER_IMAGE:-none}"
  emit environ_keys_mode "$p_environ_mode"
  emit notes "${PROBE_NOTES:-}"

  # --- mounts ------------------------------------------------------------
  if [ -r /proc/self/mounts ]; then
    p_mounts=$(cat /proc/self/mounts 2>/dev/null)
    emit mounts.table "present($(printf '%s\n' "$p_mounts" | wc -l | tr -d ' \t') lines)"
    printf '%s\n' "$p_mounts" | emit_block
  else
    emit mounts.table "$(classify_path /proc/self/mounts)"
  fi

  # --- canonical engine sockets -----------------------------------------
  # Exactly HOST_SOCKET_PATHS in container-check.js:75. Reported as their own
  # labelled group, never merged with the rootless paths below.
  for p_sock in /var/run/docker.sock /run/docker.sock; do
    emit "socket.canonical.$p_sock" "$(classify_path "$p_sock" ls)"
    if [ -S "$p_sock" ] 2>/dev/null; then emit "socket.canonical.$p_sock.is_socket" yes
    else emit "socket.canonical.$p_sock.is_socket" no; fi
    emit "socket.canonical.$p_sock._dangling_symlink" "$(dangling_symlink "$p_sock")"
    if [ -r "$p_sock" ]; then emit "socket.canonical.$p_sock.readable" yes
    else emit "socket.canonical.$p_sock.readable" no; fi
    if [ -w "$p_sock" ]; then emit "socket.canonical.$p_sock.writable" yes
    else emit "socket.canonical.$p_sock.writable" no; fi
  done

  # --- rootless engine sockets, separately labelled ----------------------
  # HOST_SOCKET_PATHS excludes these deliberately (container-check.js:72-74):
  # they are the recommended bounded posture and must never read as a violation.
  emit socket.rootless.docker \
    "$(classify_var "$p_euid" 'id -u' '' >/dev/null 2>&1; \
       if [ "$p_euid" = unknown ]; then \
         printf 'unmeasurable_here(id -u failed: path not constructible)'; \
       else classify_path "/run/user/$p_euid/docker.sock" ls; fi)"
  emit socket.rootless.podman \
    "$(classify_var "${XDG_RUNTIME_DIR:-}" XDG_RUNTIME_DIR /podman/podman.sock ls)"
  if [ -n "${DOCKER_HOST:-}" ]; then emit env.DOCKER_HOST "present($DOCKER_HOST)"
  else emit env.DOCKER_HOST absent; fi

  # --- attestation evidence ---------------------------------------------
  # What an operator would need to set autonomous.engine_bounded honestly.
  # Facts only. Whether this is a bounded engine is not answerable from inside
  # the job at all, and this group does not pretend otherwise.
  p_canon_present=no
  for p_sock in /var/run/docker.sock /run/docker.sock; do
    [ -e "$p_sock" ] && p_canon_present=yes
  done
  emit attest.canonical_socket_present "$p_canon_present"
  p_canon_writable=no
  for p_sock in /var/run/docker.sock /run/docker.sock; do
    [ -w "$p_sock" ] && p_canon_writable=yes
  done
  emit attest.canonical_socket_writable_by_euid "$p_canon_writable"
  emit attest.writable_is_a_proxy \
    'connecting to a unix socket requires write permission, so the writable test is a necessary-condition proxy for connectability, never proof'
  p_rootless_present=no
  [ "$p_euid" != unknown ] && [ -e "/run/user/$p_euid/docker.sock" ] && p_rootless_present=yes
  [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -e "$XDG_RUNTIME_DIR/podman/podman.sock" ] && p_rootless_present=yes
  emit attest.rootless_socket_present "$p_rootless_present"

  # --- containment signals ----------------------------------------------
  # The exact signals containerCheck reads, in its precedence order.
  if [ -n "${KUBERNETES_SERVICE_HOST:-}" ]; then
    emit containment.env.KUBERNETES_SERVICE_HOST "present($KUBERNETES_SERVICE_HOST)"
  else
    emit containment.env.KUBERNETES_SERVICE_HOST absent
  fi
  emit containment./.dockerenv "$(classify_path /.dockerenv ls)"
  emit containment./run/.containerenv "$(classify_path /run/.containerenv ls)"
  emit containment.proc1.environ "$(classify_path /proc/1/environ)"
  if [ -r /proc/1/environ ]; then
    p_keys=$(tr '\0' '\n' < /proc/1/environ 2>/dev/null | sed -n 's/=.*//p' | sort -u)
    if [ "$p_environ_mode" = count ]; then
      emit containment.proc1.environ_keys "present($(printf '%s\n' "$p_keys" | grep -c . ) keys, names withheld)"
    else
      emit containment.proc1.environ_keys "present($(printf '%s\n' "$p_keys" | grep -c . ) keys)"
      printf '%s\n' "$p_keys" | emit_block
    fi
    p_cval=$(tr '\0' '\n' < /proc/1/environ 2>/dev/null | sed -n 's/^container=//p' | head -1)
    if [ -n "$p_cval" ]; then emit containment.proc1.container_value "present($p_cval)"
    else emit containment.proc1.container_value absent; fi
  else
    emit containment.proc1.environ_keys "$(classify_path /proc/1/environ)"
    emit containment.proc1.container_value "$(classify_path /proc/1/environ)"
  fi
  if [ -n "${container:-}" ]; then emit containment.env.container "present($container)"
  else emit containment.env.container absent; fi
  # Recorded, and marked non-decisive: container-check.js:9-10 states the
  # detector never parses this because it is empty under cgroup v2 and carries
  # no container hint. Recording it is fine; treating it as decisive is not.
  emit containment.proc1.cgroup "$(classify_path /proc/1/cgroup)"
  emit containment.proc1.cgroup.decisiveness 'non-decisive'
  if [ -r /proc/1/cgroup ]; then cat /proc/1/cgroup 2>/dev/null | emit_block; fi
  emit containment.proc1.comm "$(classify_path /proc/1/comm)"
  if [ -r /proc/1/comm ]; then cat /proc/1/comm 2>/dev/null | emit_block; fi

  # --- the work directory ------------------------------------------------
  p_work=${RUNNER_WORKSPACE:-}
  [ -n "$p_work" ] || p_work=${GITHUB_WORKSPACE:-}
  if [ -z "$p_work" ]; then
    emit workdir.path 'unmeasurable_here(no runner workspace variable set: path not constructible)'
    emit workdir.parent 'unmeasurable_here(no runner workspace variable set: path not constructible)'
    # Never skip a key: the columns must line up, and a reader must be able to
    # tell a missing measurement from an absent signal.
    emit workdir.checkout 'unmeasurable_here(no runner workspace variable set: path not constructible)'
    emit workdir.listing 'unmeasurable_here(no runner workspace variable set: path not constructible)'
  else
    emit workdir.path "present($p_work)"
    p_wparent=$(dirname "$p_work" 2>/dev/null)
    emit workdir.parent "$(classify_path "$p_wparent" ls)"
    if [ -n "${GITHUB_WORKSPACE:-}" ]; then
      emit workdir.checkout "present($GITHUB_WORKSPACE)"
    else
      emit workdir.checkout 'unmeasurable_here(GITHUB_WORKSPACE unset: checkout location not constructible)'
    fi
    if [ -r "$p_wparent" ] && [ -x "$p_wparent" ]; then
      # exactly one level deep: names, type and numeric owner. No descent.
      p_listing=$(ls -1An "$p_wparent" 2>/dev/null)
      emit workdir.listing "present($(printf '%s\n' "$p_listing" | grep -c . ) entries, one level)"
      printf '%s\n' "$p_listing" | emit_block
    else
      emit workdir.listing "$(classify_path "$p_wparent")"
    fi
  fi

  # --- reachability of the invoking user's home --------------------------
  # Metadata and names only. Never contents, never a digest: a digest of a
  # constrained-format credential file is a content oracle against a
  # permanently public artifact.
  emit home.path "$(classify_var "${HOME:-}" HOME '' ls)"
  if [ -n "${HOME:-}" ] && [ -r "$HOME" ] && [ -x "$HOME" ]; then
    p_home_entries=$(ls -1An "$HOME" 2>/dev/null)
    emit home.entries "present($(printf '%s\n' "$p_home_entries" | grep -c . ) entries, one level)"
    printf '%s\n' "$p_home_entries" | emit_block
  else
    emit home.entries "$(classify_var "${HOME:-}" HOME '')"
  fi

  # --- socket removal ----------------------------------------------------
  # On a hosted runner under a job container there is no host-side hook before
  # the container starts, so the before-the-job removal is not impossible on
  # this shape — it is unobtainable under this methodology. Different facts,
  # different tokens.
  if [ "${PROBE_SOCKET_REMOVED:-}" = "1" ]; then
    emit socket_removal.performed 'present(same-job removal, performed before this probe run)'
    emit socket_removal.kind 'same-job'
    emit socket_removal./var/run/docker.sock.after "$(classify_path /var/run/docker.sock ls)"
    emit socket_removal./run/docker.sock.after "$(classify_path /run/docker.sock ls)"
  else
    emit socket_removal.performed \
      'unmeasurable_here(hosted runner: the job container is started before any step runs, so no step can act on the host before it exists)'
    emit socket_removal.kind \
      'unmeasurable_here(hosted runner: no host-side hook before the job container starts)'
    emit socket_removal./var/run/docker.sock.after \
      'unmeasurable_here(no removal was performed on this shape)'
    emit socket_removal./run/docker.sock.after \
      'unmeasurable_here(no removal was performed on this shape)'
  fi

  # --- derived cross-check ------------------------------------------------
  # What the current detector concludes from the raw signals above. A different
  # and also useful fact — recorded alongside them, never instead of them.
  if command -v faff >/dev/null 2>&1; then
    p_cc_json=$(faff container-check --json 2>/dev/null); p_cc_rc=$?
    emit crosscheck.container_check_json "present($p_cc_json)"
    emit crosscheck.container_check_exit "present($p_cc_rc)"
    p_cc_plain=$(faff container-check 2>&1)
    emit crosscheck.container_check_plain "present($(printf '%s\n' "$p_cc_plain" | wc -l | tr -d ' \t') lines)"
    printf '%s\n' "$p_cc_plain" | emit_block
  else
    emit crosscheck.container_check_json 'impossible_on_shape(no faff binary on PATH)'
    emit crosscheck.container_check_exit 'impossible_on_shape(no faff binary on PATH)'
    emit crosscheck.container_check_plain 'impossible_on_shape(no faff binary on PATH)'
  fi
}

# ===========================================================================
# entry
# ===========================================================================
arg_shape=unknown
arg_environ=names
arg_mode=probe

while [ $# -gt 0 ]; do
  case "$1" in
    --selftest)      arg_mode=selftest; shift ;;
    --shape)         arg_shape=${2:-unknown}; shift 2 ;;
    --shape=*)       arg_shape=${1#--shape=}; shift ;;
    --environ-keys)  arg_environ=${2:-names}; shift 2 ;;
    --environ-keys=*) arg_environ=${1#--environ-keys=}; shift ;;
    -h|--help)
      printf 'usage: probe.sh --shape <label> [--environ-keys names|count]\n'
      printf '       probe.sh --selftest\n'
      exit 0 ;;
    *) printf 'probe.sh: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

case "$arg_environ" in
  names|count) ;;
  *) printf 'probe.sh: --environ-keys must be names or count\n' >&2; exit 2 ;;
esac

if [ "$arg_mode" = selftest ]; then
  selftest
  exit $?
fi

probe "$arg_shape" "$arg_environ"
# Unconditionally zero: an unreadable file is a finding, not an error.
exit 0
