#!/bin/sh
set -eu
if [ -n "${1:-}" ]; then export BIUUKA_INSTALL_SOURCE="$1"; fi
umask 077
[ "$(uname -s)" = Darwin ] || { echo 'Biuuka: this installer is for macOS.' >&2; exit 1; }
[ "$(id -u)" != 0 ] || { echo 'Run without sudo, as your desktop user.' >&2; exit 1; }
MAJOR=$(sw_vers -productVersion | cut -d. -f1)
[ "$MAJOR" -ge 14 ] || { echo 'Biuuka requires macOS 14 or newer.' >&2; exit 1; }
ARCH=$(uname -m)
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then ARCH=arm64; fi
case "$ARCH" in arm64) NODE_ARCH=arm64; NODE_SHA=__NODE_ARM64_SHA__;; x86_64) NODE_ARCH=x64; NODE_SHA=__NODE_X64_SHA__;; *) echo 'Unsupported Mac architecture.' >&2; exit 1;; esac
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/biuuka-install.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT HUP INT TERM
awk '/^__BIUUKA_PAYLOAD__$/{found=1;next} found{print}' "$0" | base64 -D > "$STAGE/package.zip"
printf '%s  %s\n' '__PACKAGE_SHA__' "$STAGE/package.zip" | shasum -a 256 -c - >/dev/null
unzip -q "$STAGE/package.zip" -d "$STAGE/app"
NODE=$(command -v node || true)
if [ -z "$NODE" ] && [ -x "$HOME/.biuuka/base/runtime/node/bin/node" ]; then NODE="$HOME/.biuuka/base/runtime/node/bin/node"; fi
if [ "$NODE" = "$HOME/.biuuka/base/runtime/node/bin/node" ]; then
  mkdir -p "$STAGE/app/runtime"
  cp -R "$HOME/.biuuka/base/runtime/node" "$STAGE/app/runtime/node"
  NODE="$STAGE/app/runtime/node/bin/node"
fi
if [ -z "$NODE" ] && [ -x "$HOME/.local/share/biuuka/app/runtime/node/bin/node" ]; then NODE="$HOME/.local/share/biuuka/app/runtime/node/bin/node"; fi
if [ "$NODE" = "$HOME/.local/share/biuuka/app/runtime/node/bin/node" ]; then
  mkdir -p "$STAGE/app/runtime"
  cp -R "$HOME/.local/share/biuuka/app/runtime/node" "$STAGE/app/runtime/node"
  NODE="$STAGE/app/runtime/node/bin/node"
fi
if [ -z "$NODE" ] || ! "$NODE" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 && process.arch === '$NODE_ARCH' ? 0 : 1)" 2>/dev/null; then
  echo "Installing verified Node.js for $NODE_ARCH..."
  CACHE_NAME="node-darwin-$NODE_ARCH.tar.gz"
  mkdir -p "$HOME/.biuuka/cache"
  NODE_SOURCE=''
  for CACHE_DIR in "${BIUUKA_OFFLINE_DIR:-$HOME/.biuuka/cache}" "$HOME/.biuuka/cache"; do
    if [ -f "$CACHE_DIR/$CACHE_NAME" ] && printf '%s  %s\n' "$NODE_SHA" "$CACHE_DIR/$CACHE_NAME" | shasum -a 256 -c - >/dev/null 2>&1; then
      cp "$CACHE_DIR/$CACHE_NAME" "$STAGE/node.tgz"; NODE_SOURCE=local-cache; break
    fi
  done
  if [ -z "$NODE_SOURCE" ] && [ "${BIUUKA_OFFLINE_ONLY:-0}" = 1 ]; then echo 'Offline Node.js cache missing or checksum mismatch.'; exit 1; fi
  if [ -z "$NODE_SOURCE" ]; then
    for SOURCE in 'https://npmmirror.com/mirrors/node' 'https://nodejs.org/dist'; do
      echo "Downloading Node.js from $SOURCE ..."
      if curl --fail --location --connect-timeout 8 --max-time 300 --speed-limit 1024 --speed-time 20 "$SOURCE/v24.19.0/node-v24.19.0-darwin-$NODE_ARCH.tar.gz" -o "$STAGE/node.tgz" && printf '%s  %s\n' "$NODE_SHA" "$STAGE/node.tgz" | shasum -a 256 -c - >/dev/null 2>&1; then
        NODE_SOURCE="$SOURCE"; cp "$STAGE/node.tgz" "$HOME/.biuuka/cache/$CACHE_NAME"; break
      fi
      echo 'Source unavailable or checksum mismatch; trying the next source.'
    done
  fi
  [ -n "$NODE_SOURCE" ] || { echo 'All Node.js sources failed. Use an offline package or check network access.'; exit 1; }
  printf '{"source":"%s","verified":true}\n' "$NODE_SOURCE" > "$HOME/.biuuka/node-source.json"
  mkdir -p "$STAGE/app/runtime/node"
  tar -xzf "$STAGE/node.tgz" -C "$STAGE/app/runtime/node" --strip-components=1
  NODE="$STAGE/app/runtime/node/bin/node"
fi
"$NODE" "$STAGE/app/setup.mjs"
exit 0
__BIUUKA_PAYLOAD__
