#!/bin/sh
# Prepares the key directory on the volume as root, then runs the governor as the commissaire user.
set -eu

DATA=/data
KEY_DIR=/data/commissaire
USER_NAME=commissaire

die() { echo "commissaire-entrypoint: $*" >&2; exit 1; }

mountpoint -q "$DATA" || die "no volume at $DATA"

if [ ! -e "$KEY_DIR" ] && [ ! -L "$KEY_DIR" ]; then
  install -d -o "$USER_NAME" -g "$USER_NAME" -m 0700 "$KEY_DIR"
fi
[ -L "$KEY_DIR" ] && die "$KEY_DIR is a symlink"
[ -d "$KEY_DIR" ] || die "$KEY_DIR is not a directory"
[ "$(stat -c %U "$KEY_DIR")" = "$USER_NAME" ] || die "$KEY_DIR is not owned by $USER_NAME"
[ "$(stat -c %a "$KEY_DIR")" = "700" ] || die "$KEY_DIR is not mode 0700"

stranger=$(find "$KEY_DIR" ! -user "$USER_NAME" -print -quit)
[ -z "$stranger" ] || die "$stranger is not owned by $USER_NAME"

install -o "$USER_NAME" -g "$USER_NAME" -m 0600 "$COMMISSAIRE_ROOT/operations/fly/governor/governor-config.json" "$KEY_DIR/governor-config.json"

listen=${GOVERNOR_LISTEN:-fly-local-6pn:7650}
allow=${GOVERNOR_ALLOW_DNS:-}
[ -n "$allow" ] || die "GOVERNOR_ALLOW_DNS must name the runner app (e.g. fly-ci-l3-runner.internal)"
for pair in "GOVERNOR_LISTEN=$listen" "GOVERNOR_ALLOW_DNS=$allow"; do
  case "${pair#*=}" in
    *[!A-Za-z0-9.:_-]*) die "${pair%%=*} has characters outside [A-Za-z0-9.:_-]: ${pair#*=}" ;;
  esac
done

exec setpriv --reuid="$USER_NAME" --regid="$USER_NAME" --clear-groups \
  node "$COMMISSAIRE_ROOT/plugin/skills/faff/bin/commissaire" governor start \
  --key-dir "$KEY_DIR" --listen "$listen" --listen-allow-dns "$allow"
