#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
RELEASE_DIR="$PROJECT_ROOT/release"

if [[ ! -d "$RELEASE_DIR" ]]; then
  exit 0
fi

if [[ "${1:-}" == "--app-only" ]]; then
  [[ -d "$RELEASE_DIR/mac-arm64" ]] && rm -rf "$RELEASE_DIR/mac-arm64"
  exit 0
fi

# Keep builder diagnostics, but remove generated installers and the unpacked app.
find "$RELEASE_DIR" -maxdepth 1 -type f \( \
  -name '玉衡-*-arm64.dmg' -o \
  -name '玉衡-*-arm64.dmg.blockmap' -o \
  -name '玉衡-*-arm64.zip' -o \
  -name '玉衡-*-arm64.zip.blockmap' \
\) -delete

if [[ -d "$RELEASE_DIR/mac-arm64" ]]; then
  rm -rf "$RELEASE_DIR/mac-arm64"
fi
