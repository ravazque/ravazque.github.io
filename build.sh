#!/bin/sh
# Stage the GitHub Pages site into $1 (default _site) with the same layout as this repository: the CV (index.html,
# cv.json), the 42 page (ravazque/, data/42.json), the NASA short links (NASA-2025/, NASA-2026/), assets/, shared/
# and ui.css. ui.css, shared/fonts.css and data/42.json are written by ravazque.info at these exact paths: don't move
# them. Used by .github/workflows/pages.yml and for a local preview. Tests, this script and the README are not published.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-_site}
rm -rf "$out"
mkdir -p "$out/data"
cp "$here/index.html" "$here/cv.json" "$here/ui.css" "$out/"
cp -R "$here/ravazque" "$here/NASA-2025" "$here/NASA-2026" "$here/assets" "$here/shared" "$out/"
cp "$here/data/42.json" "$out/data/" 2>/dev/null || echo "build.sh: no data/42.json yet, the 42 page shows nothing"
echo "build.sh: site staged in $out"
