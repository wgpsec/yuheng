#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
cd "$PROJECT_ROOT"

ICON_SOURCE="${YUHENG_ICON_SOURCE:-assets/yuheng-icon.png}"
ICON_PNG="assets/yuheng-1024.png"
ICONSET_DIR="assets/yuheng.iconset"
ICON_OUTPUT="assets/yuheng-icon.icns"

if [[ ! -f "$ICON_SOURCE" ]]; then
  print -u2 "找不到图标源文件：$ICON_SOURCE"
  exit 1
fi

mkdir -p "$ICONSET_DIR"
if [[ "$ICON_SOURCE" == *.svg ]]; then
  if ! command -v rsvg-convert >/dev/null 2>&1; then
    print -u2 "缺少 rsvg-convert，请先安装 librsvg（例如：brew install librsvg）。"
    exit 1
  fi
  rsvg-convert -w 1024 -h 1024 "$ICON_SOURCE" -o "$ICON_PNG"
else
  sips -z 1024 1024 "$ICON_SOURCE" --out "$ICON_PNG" >/dev/null
fi

typeset -a sizes=(
  "16:icon_16x16.png"
  "32:icon_16x16@2x.png"
  "32:icon_32x32.png"
  "64:icon_32x32@2x.png"
  "128:icon_128x128.png"
  "256:icon_128x128@2x.png"
  "256:icon_256x256.png"
  "512:icon_256x256@2x.png"
  "512:icon_512x512.png"
  "1024:icon_512x512@2x.png"
)

for entry in $sizes; do
  IFS=: read -r size filename <<< "$entry"
  sips -z "$size" "$size" "$ICON_PNG" --out "$ICONSET_DIR/$filename" >/dev/null
done

iconutil -c icns "$ICONSET_DIR" -o "$ICON_OUTPUT"
print "已生成 $ICON_OUTPUT"
