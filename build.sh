#!/bin/sh
# Stage the GitHub Pages site into $1 (default _site): the CV, the 42 page (ravazque/), its shared/ scripts (fonts,
# accent.js, the custom controls, the skills radar and the projects filters) and ui.css, the tokens of ravazque.info's
# look (written by `make site-sync` there). Used by .github/workflows/pages.yml and for a local preview. Tests, this
# script and the README are not published.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-_site}
rm -rf "$out"
mkdir -p "$out/data" "$out/ravazque"
cp "$here/ravazque/index.html" "$out/ravazque/"
cp "$here/index.html" "$here/site.css" "$here/site.js" "$here/cv.json" "$here/favicon.svg" "$here/ui.css" "$out/"
cp "$here/data/42.json" "$out/data/" 2>/dev/null || echo "build.sh: no data/42.json yet, the 42 page shows nothing"
cp "$here"/shared/* "$out/"
echo "build.sh: site staged in $out"
