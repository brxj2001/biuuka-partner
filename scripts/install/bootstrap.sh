#!/bin/sh
set -eu
stage=$(mktemp -d "${TMPDIR:-/tmp}/biuuka-bootstrap.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
curl --fail --location --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/brxj2001/biuuka-partner/main/scripts/install/github-install.sh -o "$stage/install.sh"
sh "$stage/install.sh" "$@"
