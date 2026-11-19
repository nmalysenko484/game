#!/bin/sh
# Builds yandex-build.zip for Yandex Games: index.html at the root of the archive (plus the font licence),
# with the developer mode switched off.
#
#   sh tools/build-yandex.sh
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
sed 's/^const DEV_ALLOWED = true;/const DEV_ALLOWED = false;/' index.html > "$tmp/index.html"
grep -q '^const DEV_ALLOWED = false;' "$tmp/index.html" || { echo 'DEV_ALLOWED line not found in index.html' >&2; exit 1; }
cp OFL-Unbounded.txt "$tmp/"
touch -t 202601010000 "$tmp/index.html" "$tmp/OFL-Unbounded.txt"     # same input -> same zip
rm -f yandex-build.zip
(cd "$tmp" && zip -q -X -9 out.zip index.html OFL-Unbounded.txt)
mv "$tmp/out.zip" yandex-build.zip
unzip -l yandex-build.zip
