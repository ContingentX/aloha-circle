#!/usr/bin/env bash
# Build and verify the exact Lambda artifact used by infra/deploy.sh.
#   usage: ./infra/package-donations.sh /path/to/donations.zip
set -euo pipefail

OUTPUT="${1:-}"
if [[ -z "$OUTPUT" ]]; then
  echo "usage: $0 /path/to/donations.zip" >&2
  exit 1
fi
if [[ -e "$OUTPUT" ]]; then
  echo "error: refusing to update existing artifact: $OUTPUT" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$ROOT/infra/donations" && zip -q -j "$OUTPUT" \
  index.mjs public-api.mjs public-api-core.mjs)

EXPECTED=$'index.mjs\npublic-api-core.mjs\npublic-api.mjs'
ACTUAL="$(unzip -Z1 "$OUTPUT" | LC_ALL=C sort)"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "error: Lambda package contents differ from the reviewed module set" >&2
  unzip -Z1 "$OUTPUT" >&2
  exit 1
fi
