#!/usr/bin/env bash
# Downloads the shard-timing artifacts `detect hot-path changes` picked for this CI run and writes
# test-reports/ci-timings/vitest.json and ui.json (scripts/ci-timings.ts, DEC-075).
#
# ARTIFACTS: space-separated "<run id>/<artifact id>/<artifact name>" entries, the same for every
# shard of the run. A download that still fails after retries fails the job: a shard that quietly
# split by other timings than its siblings could skip or repeat test files.
set -euo pipefail
out=test-reports/ci-timings
mkdir -p "$out/runs"
for entry in ${ARTIFACTS:-}; do
  IFS=/ read -r run id name <<<"$entry"
  dir="$out/runs/$run/$name"
  mkdir -p "$dir"
  for attempt in 1 2 3 4; do
    if gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$id/zip" >"$dir.zip" &&
      unzip -oq "$dir.zip" -d "$dir"; then
      break
    fi
    if [ "$attempt" = 4 ]; then
      echo "::error::could not download artifact $id ($name of run $run)"
      exit 1
    fi
    sleep $((attempt * 5))
  done
  rm -f "$dir.zip"
done
node --experimental-strip-types scripts/ci-timings.ts "$out/runs" "$out"
