#!/bin/sh
# Stage the GitHub Pages site into $1 (default _site): the page itself plus what it shares with the web app:
# the self-hosted fonts, the tokens generated from core/core42/frontend/ui.json, accent.js, the custom controls
# (controls.js/css), the skills radar (radar.js) and the projects filters (projects.js).
# Used by .github/workflows/pages.yml and by `make site`. Tests, this script and the README are not published.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
out=${1:-_site}
rm -rf "$out"
mkdir -p "$out/data"
cp "$here/index.html" "$here/site.css" "$here/site.js" "$here/cv.json" "$here/favicon.svg" "$out/"
cp "$here/data/42.json" "$out/data/" 2>/dev/null || echo "build.sh: no data/42.json yet, the page shows the CV only"
front="$root/core/core42/frontend"
cp "$front/vendor/fonts.css" "$front/accent.js" "$front/controls.js" "$front/controls.css" "$front/radar.js" "$front/projects.js" "$out/"
PYTHONPATH="$root/core" python3 -c 'from core42.ui import css_from_ui, load_ui; print(css_from_ui(load_ui()), end="")' > "$out/ui.css"
echo "build.sh: site staged in $out"
