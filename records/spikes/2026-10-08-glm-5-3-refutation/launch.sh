#!/usr/bin/env bash
cd "$(dirname "$0")"
for effort in low high; do
  i=0; pids=()
  while read -r ids; do i=$((i+1)); node run.mjs $effort $effort-s$i "$ids" > logs-$effort-s$i.out 2> logs-$effort-s$i.err & pids+=($!); done < shards.txt
  wait "${pids[@]}"
  echo "$effort done $(date -u +%FT%TZ)" >> progress.txt
done
