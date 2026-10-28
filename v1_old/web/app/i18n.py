"""Server-side strings: the same en.json / es.json the report uses."""
import json
from functools import lru_cache

from fastapi import Request

from core42 import FRONTEND_DIR

LANGS = ("en", "es")


FILES = {lang: FRONTEND_DIR / "i18n" / f"{lang}.json" for lang in LANGS}  # never a path built from a request


@lru_cache(maxsize=None)
def _load(lang: str, mtime: float) -> dict:
    return json.loads(FILES[lang].read_text())


def strings(lang: str) -> dict:
    lang = lang if lang in FILES else "en"
    return _load(lang, FILES[lang].stat().st_mtime)  # edits to the JSON show on the next request


def pick_lang(request: Request) -> str:
    if request.cookies.get("lang") in LANGS:
        return request.cookies["lang"]
    for part in request.headers.get("accept-language", "").split(","):
        code = part.split(";")[0].strip()[:2].lower()
        if code in LANGS:
            return code
    return "en"
