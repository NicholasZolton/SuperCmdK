#!/usr/bin/env bash
set -euo pipefail

revision="07f3e789e993e8ecf69ef5409fd7558f5fe43202"
base="https://huggingface.co/Cactus-Compute/needle2/resolve/$revision"
raw_base="https://huggingface.co/Cactus-Compute/needle2/raw/$revision"
destination="${1:-demo/public/needle}"
mkdir -p "$destination"

fetch() {
  local path="$1" expected="$2" source="$3"
  local target="$destination/$path"
  if [ -f "$target" ] && printf '%s  %s\n' "$expected" "$target" | shasum -a 256 -c - >/dev/null 2>&1; then
    printf 'Needle: %s is current\n' "$path"
    return
  fi

  printf 'Needle: downloading %s…\n' "$path"
  local temporary="$target.tmp"
  rm -f "$temporary"
  curl --fail --location --silent --show-error --retry 3 --retry-delay 1 "$source" -o "$temporary"
  printf '%s  %s\n' "$expected" "$temporary" | shasum -a 256 -c - >/dev/null
  mv "$temporary" "$target"
}

fetch "needle.js" \
  "06499ec635d7e2790cb84791bc0e323fa4d0c5a8948108ca357b76685e085a66" \
  "$base/wasm/needle.js"
fetch "needle.wasm" \
  "22e62a037d83c50f48d8e68b0b3e386eb85a8f0f0bf97c6bee800ad57c87b6ba" \
  "$base/wasm/needle.wasm"
fetch "needle2.cact" \
  "b43aabfcaf1a6db6acf488076eab71d823c08697c7af4521fc1d174b60ede5ba" \
  "$base/needle2.cact"
fetch "LICENSE" \
  "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30" \
  "$raw_base/LICENSE"

cat > "$destination/REVISION" <<EOF
Cactus-Compute/needle2
$revision
EOF

printf 'Needle: assets ready in %s\n' "$destination"
