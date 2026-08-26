#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
cd "$PROJECT_ROOT"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  print -u2 "玉衡 0.1 仅支持 macOS Apple Silicon（arm64）。"
  exit 1
fi

macos_major="$(sw_vers -productVersion | awk -F. '{print $1}')"
if (( macos_major < 13 )); then
  print -u2 "玉衡 0.1 需要 macOS 13 Ventura 或更高版本。"
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  print -u2 "需要先安装 Node.js 20+（建议使用 LTS 版本）。"
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 20 )); then
  print -u2 "当前 Node.js 版本过低：$(node --version)，需要 20+。"
  exit 1
fi

# Keep the project install reproducible without changing the user's global npm config.
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"

electron_binary="$PROJECT_ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [[ ! -x "$electron_binary" ]]; then
  print "首次启动需要安装依赖并下载 Electron，这可能需要几分钟。"
  npm install
fi

if [[ ! -x "$electron_binary" ]]; then
  npm rebuild electron
fi

if [[ ! -x "$electron_binary" ]]; then
  npm exec -- electron --version >/dev/null
fi

if [[ ! -x "$electron_binary" ]]; then
  print -u2 "Electron 二进制未安装成功，请检查网络后重试。"
  exit 1
fi

if [[ -z "${VITE_PORT:-}" ]]; then
  VITE_PORT=5173
  while lsof -nP -iTCP:"$VITE_PORT" -sTCP:LISTEN >/dev/null 2>&1; do
    (( VITE_PORT++ ))
  done
  export VITE_PORT
fi

exec npm run dev
