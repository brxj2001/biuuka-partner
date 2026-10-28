#!/bin/sh
set -eu
umask 077
verify_only=0
if [ "${1:-}" = --verify-only ]; then verify_only=1; shift; fi
[ "$(uname -s)" = Darwin ] || { echo 'This installer requires macOS.' >&2; exit 1; }
[ "$(id -u)" != 0 ] || { echo 'Run as your desktop user without sudo.' >&2; exit 1; }
command -v git >/dev/null || { echo 'Install Git / Apple Command Line Tools first.' >&2; exit 1; }
stage=$(mktemp -d "${TMPDIR:-/tmp}/biuuka-github.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
# Git verifies the objects of one immutable fetched commit; no source hooks execute.
git -c core.hooksPath=/dev/null init -q "$stage/source"
git -C "$stage/source" remote add origin https://github.com/brxj2001/biuuka-partner.git
git -C "$stage/source" -c core.hooksPath=/dev/null fetch --depth=1 --no-tags origin refs/heads/main
commit=$(git -C "$stage/source" rev-parse FETCH_HEAD)
case "$commit" in *[!a-f0-9]*|'') exit 1;; esac
[ "${#commit}" -eq 40 ] || exit 1
git -C "$stage/source" -c core.hooksPath=/dev/null checkout -q --detach "$commit"
printf 'Installing GitHub source commit: %s\n' "$commit"
arch=$(uname -m)
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
case "$arch" in arm64) platform=darwin-arm64;; x86_64) platform=darwin-x64;; *) echo 'Unsupported architecture.' >&2; exit 1;; esac
url=$(plutil -extract "$platform.node.url" raw -o - "$stage/source/sources.json")
digest=$(plutil -extract "$platform.node.digest" raw -o - "$stage/source/sources.json")
case "$url" in https://nodejs.org/dist/*) ;; *) echo 'Invalid Node source.' >&2; exit 1;; esac
case "$digest" in *[!a-f0-9]*|'') exit 1;; esac
[ "${#digest}" -eq 64 ] || exit 1
curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 "$url" -o "$stage/node.tar.gz"
printf '%s  %s\n' "$digest" "$stage/node.tar.gz" | shasum -a 256 -c - >/dev/null
mkdir "$stage/node"
tar -xzf "$stage/node.tar.gz" -C "$stage/node" --strip-components=1
"$stage/node/bin/node" "$stage/source/package.mjs" --output "$stage/package"
if [ "$verify_only" = 1 ]; then
  "$stage/node/bin/node" - "$stage/package" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.argv[2],manifest=JSON.parse(fs.readFileSync(path.join(root,'latest.json'),'utf8'));
for(const name of ['install.cmd','install.sh','biuuka.zip','uninstall.ps1']) {
 const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
 if(manifest.files[name]?.sha256!==digest)throw Error('Generated package checksum mismatch: '+name);
}
NODE
  printf 'BIUUKA_VERIFY_OK commit=%s platform=%s installed=false\n' "$commit" "$platform"
  exit 0
fi
sh "$stage/package/install.sh" "$@"
