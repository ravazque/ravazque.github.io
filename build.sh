#!/bin/sh
# Stage the GitHub Pages site into $1 (default _site): the page itself, its shared/ scripts (fonts, accent.js, the
# custom controls, the skills radar and the projects filters) and the tokens generated from server/core/data/ui.json.
# Used by .github/workflows/pages.yml and by `make site`. Tests, this script and the README are not published.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
out=${1:-_site}
rm -rf "$out"
mkdir -p "$out/data"
cp "$here/index.html" "$here/site.css" "$here/site.js" "$here/cv.json" "$here/favicon.svg" "$out/"
cp "$here/data/42.json" "$out/data/" 2>/dev/null || echo "build.sh: no data/42.json yet, the page shows the CV only"
cp "$here"/shared/* "$out/"
(cd "$root/server" && go run ./cmd/uicss) > "$out/ui.css"
echo "build.sh: site staged in $out"
