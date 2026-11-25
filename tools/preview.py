#!/usr/bin/env python3
"""Previews of both pages that open with a double click (file://, no server): OUT/cv.html and OUT/42.html, each one file
with its styles, scripts, icon and data inlined; a fetch shim hands site.js the data. Uses cv.json and data/42.json, or the
examples in tools/ for whichever is missing (always, with --template). Not published: build.sh doesn't copy tools/."""
import base64
import json
import re
import sys
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = {  # output: (source page, links to the other page rewritten to the other preview)
    "cv.html": ("index.html", ('href="ravazque/"', 'href="42.html"')),
    "42.html": ("ravazque/index.html", ('href="./"', 'href="cv.html"')),
}


def load(real, example, template):
    path = ROOT / (example if template or not (ROOT / real).is_file() else real)
    print(f"preview.py: data from {path.relative_to(ROOT)}")
    return json.loads(path.read_text(encoding="utf-8"))


def build(page, data, link):
    text = lambda m: (ROOT / m[1]).read_text(encoding="utf-8")
    html = (ROOT / page).read_text(encoding="utf-8").replace('<base href="../">\n', "").replace(*link)
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', lambda m: f"<style>\n{text(m)}</style>", html)
    html = re.sub(r'<link rel="icon" href="([^"]+)"', lambda m: '<link rel="icon" href="data:image/svg+xml;base64,' +
                  base64.b64encode((ROOT / m[1]).read_bytes()).decode() + '"', html)
    shim = ("<script>const PREVIEW = " + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") +
            "; const netFetch = window.fetch; window.fetch = (url, opts) => url in PREVIEW ? "
            "Promise.resolve(new Response(JSON.stringify(PREVIEW[url]))) : netFetch(url, opts);</script>\n")
    html = html.replace("<script src=", shim + "<script src=", 1)
    return re.sub(r'<script src="([^"]+)"></script>', lambda m: f"<script>\n{text(m)}</script>", html)


def main(argv):
    if not argv or argv[0].startswith("-"):
        sys.exit("usage: preview.py OUT_DIR [--template]")
    out, template = Path(argv[0]), "--template" in argv[1:]
    cv = load("cv.json", "tools/template-cv.json", template)
    data = {"cv.json": cv, "data/42.json": load("data/42.json", "tools/template-42.json", template)}
    out.mkdir(parents=True, exist_ok=True)
    for name, (page, link) in PAGES.items():
        html = build(page, data, link)
        if page == "index.html" and cv.get("name"):  # the CV's name is in its HTML; the example data brings its own
            html = re.sub(r'(<h1 class="name" id="name">)[^<]*', lambda m: m[1] + escape(cv["name"]), html)
        (out / name).write_text(html, encoding="utf-8")
        print(f"preview.py: {(out / name).resolve().as_uri()}")


if __name__ == "__main__":
    main(sys.argv[1:])
