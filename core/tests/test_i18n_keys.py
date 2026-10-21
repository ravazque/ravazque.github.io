import json
import re

from core42 import FRONTEND_DIR

I18N = FRONTEND_DIR / "i18n"


def keys(d):
    return {f"{k}.{sub}" if isinstance(v, dict) else k for k, v in d.items() for sub in (v if isinstance(v, dict) else [None])}


def test_en_and_es_have_the_same_keys():
    en = json.loads((I18N / "en.json").read_text())
    es = json.loads((I18N / "es.json").read_text())
    assert keys(en) == keys(es), keys(en) ^ keys(es)


def test_every_key_used_by_the_page_exists():
    en = json.loads((I18N / "en.json").read_text())
    html = (FRONTEND_DIR / "report.html").read_text()
    js = (FRONTEND_DIR / "report.js").read_text()
    used = set(re.findall(r'data-(?:i18n|title-i18n)="([\w.-]+)"', html))
    used |= {k for pair in re.findall(r'data-i18n-attr="([^"]+)"', html) for k in re.findall(r":([\w.-]+)", pair)}
    used |= set(re.findall(r'\bt\("([\w.-]+)"', js))
    # keys handed to t() through plural(), ternaries and lookups: every dotted lowercase string literal
    used |= set(re.findall(r'"((?:[a-z_]+)\.[a-z_][\w.]*)"', js)) - {"report.rendered"}
    # dynamic families built with template strings
    for prefix, values in {"period": ["piscine", "student", "all"], "criterion": ["overall", "nice", "rigorous", "interested", "punctuality"]}.items():
        used |= {f"{prefix}.{v}" for v in values}
    assert used, "no keys found"
    missing = sorted(k for k in used if k not in en)
    assert not missing, missing
