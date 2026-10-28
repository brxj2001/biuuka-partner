#!/bin/sh
set -eu
stage=$(mktemp -d "${TMPDIR:-/tmp}/biuuka-bootstrap.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
curl -fL https://biuuka.com/downloads/biuuka/install.sh -o "$stage/install.sh"
sh "$stage/install.sh" "$@"
