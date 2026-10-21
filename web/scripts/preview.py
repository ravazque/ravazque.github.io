"""Build preview/{home,corrections,campus}.html: the three dashboard pages as offline files, for design review.

    python scripts/preview.py --fetch UID   run the real light extraction for UID (app token from .env), save preview/data.json
    python scripts/preview.py               build the pages from preview/data.json
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # the web app package

from core42 import FRONTEND_DIR
from core42.ui import css_from_ui, load_ui

from app.pages import _foot_links

OUT = Path(__file__).resolve().parent.parent / "preview"
PAGES = [("home", "web-home"), ("corrections", "web-corrections"), ("campus", "web-campus")]


async def fetch(uid: int):
    import httpx

    from app.api42 import Api42
    from app.extract import extract
    from app.limiter import RateLimiter
    from app.redis import make_redis
    from app.settings import Settings
    settings = Settings.from_env()
    redis = make_redis(settings.redis_url)
    async with httpx.AsyncClient() as http:
        api = Api42(settings, redis, http, RateLimiter(redis))
        async def progress(f):
            print(f"\r  {round(100 * f)}%", end="", flush=True)
        data = await extract(api, uid, progress)
    print()
    return data


def build(data: dict):
    en = json.loads((FRONTEND_DIR / "i18n" / "en.json").read_text())
    vendor = FRONTEND_DIR / "vendor"
    css = (vendor / "fonts.css").read_text() + css_from_ui(load_ui()) + (FRONTEND_DIR / "controls.css").read_text() + (FRONTEND_DIR / "report.css").read_text()
    static = Path(__file__).resolve().parent.parent / "static"
    scripts = "".join(f"<script>{(FRONTEND_DIR / f).read_text()}</script>" for f in ("controls.js", "accent.js", "radar.js", "projects.js"))
    scripts += "".join(f"<script>{(static / f).read_text()}</script>" for f in ("vendor/d3.min.js", "graph.js", "network.js"))
    scripts += f"<script>{(FRONTEND_DIR / 'report.js').read_text()}</script>"
    colour = (data["periods"]["all"]["profile"].get("coalition") or {}).get("color", "")
    for key, kind in PAGES:
        d = {**data, "page": kind, "pages": [{"href": f"{k}.html", "key": k, "page": p} for k, p in PAGES]}
        html = (FRONTEND_DIR / "report.html").read_text()
        boot = (f'<script>setDict({json.dumps(en)}); applyAccent({json.dumps(colour)}); '
                f'startReport({json.dumps(d).replace("<", "\\u003c")}, {{i18n: {json.dumps(en)}}}); document.body.classList.add("enter");</script>')
        html = (html.replace("{{TITLE}}", f"{key} · preview", 1).replace("{{HEAD}}", f"<script>{(FRONTEND_DIR / 'theme.js').read_text()}</script><style>{css}</style>", 1)
                .replace("{{FOOT_LINKS}}", _foot_links(en, ""), 1)
                .replace("{{BODY_END}}", f"<script>{(vendor / 'chart.umd.min.js').read_text()}</script>{scripts}{boot}", 1)
                .replace("<body>", f'<body data-page="{kind}">', 1))
        (OUT / f"{key}.html").write_text(html)
        print(f"preview/{key}.html")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fetch", type=int, metavar="UID")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    if args.fetch:
        (OUT / "data.json").write_text(json.dumps(asyncio.run(fetch(args.fetch)), ensure_ascii=False))
    build(json.loads((OUT / "data.json").read_text()))
