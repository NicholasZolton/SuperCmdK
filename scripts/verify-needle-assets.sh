#!/usr/bin/env bash
set -euo pipefail

assets="${1:-packages/needle/assets}"
revision="07f3e789e993e8ecf69ef5409fd7558f5fe43202"

verify() {
  local path="$1" expected="$2"
  printf '%s  %s/%s\n' "$expected" "$assets" "$path" | shasum -a 256 -c - >/dev/null
}

verify "needle.js" "06499ec635d7e2790cb84791bc0e323fa4d0c5a8948108ca357b76685e085a66"
verify "needle.wasm" "22e62a037d83c50f48d8e68b0b3e386eb85a8f0f0bf97c6bee800ad57c87b6ba"
verify "needle2.cact" "b43aabfcaf1a6db6acf488076eab71d823c08697c7af4521fc1d174b60ede5ba"
verify "LICENSE" "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"

grep -Fxq "Cactus-Compute/needle2" "$assets/REVISION"
grep -Fxq "$revision" "$assets/REVISION"
printf 'Needle: bundled assets match %s\n' "$revision"
