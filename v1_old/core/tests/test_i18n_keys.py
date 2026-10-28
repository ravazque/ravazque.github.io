import json

from core42 import FRONTEND_DIR

I18N = FRONTEND_DIR / "i18n"


def keys(d):
    return {f"{k}.{sub}" if isinstance(v, dict) else k for k, v in d.items() for sub in (v if isinstance(v, dict) else [None])}


def test_en_and_es_have_the_same_keys():
    en = json.loads((I18N / "en.json").read_text())
    es = json.loads((I18N / "es.json").read_text())
    assert keys(en) == keys(es), keys(en) ^ keys(es)
