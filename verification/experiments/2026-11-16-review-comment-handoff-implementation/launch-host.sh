#!/usr/bin/env bash
set -euo pipefail
candidate_root=/Users/shftwst/workspace/shftwst/faff/.worktrees/review-comment-handoff
candidate_commit=1f2d75335d305be0ff14f1428f2bc56873a9dafa
output_root=/Users/shftwst/workspace/shftwst/faff/verification/experiments/2026-11-16-review-comment-handoff-diagnostic
if [[ -e "$output_root" ]]; then
  echo 'Diagnostic output already exists; inspect it before starting another run.' >&2
  exit 1
fi
docker exec -d --user hostuser -w "$candidate_root" e5729ecc0fe5 \
  node eval/control-parity/run-handoff-diagnostic.mjs \
  "$candidate_root" "$candidate_commit" "$output_root"
