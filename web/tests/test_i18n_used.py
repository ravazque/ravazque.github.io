"""Every text key the dashboard and the public pages ask for exists in both languages."""
import json
import re
from pathlib import Path

from core42 import FRONTEND_DIR

APP = Path(__file__).resolve().parent.parent / "app"
LITERAL = re.compile(r'"([a-z_]+\.[a-z_][\w-]*)"')
TEMPLATE = re.compile(r"""\bt\(\s*["']([\w.-]+)["']|t\[["']([\w.-]+)["']\]""")
FAMILIES = {"period": ["piscine", "student", "all"], "track": ["student", "piscine", "all", "common-core", "outer-core"],
            "projects_table.marks": ["all", "bonus", "max", "failed"], "log.flag": ["all", "out", "bad", "ok"],
            "log": ["received", "given"], "criterion": ["overall", "nice", "rigorous", "interested", "punctuality"],
            "delete": ["title", "confirm", "yes", "no"],
            "publish": ["title", "confirm", "yes", "no", "done", "view"],
            "publish.error": ["stale", "busy", "github", "owner", "publish-off"],
            "pages": ["home", "projects", "evaluations", "people", "campus", "astra"]}
GOALS = ["grandmaster", "architect", "kraken", "gatekeeper", "headhunter", "titan"]


def used_keys() -> set[str]:
    used = set()
    for py in [*(APP / "dash").glob("*.py"), APP / "routes_dash.py"]:
        used |= {k for k in LITERAL.findall(py.read_text()) if not k.endswith(".json")}
    for html in (APP / "templates").rglob("*.html"):
        used |= {a or b for a, b in TEMPLATE.findall(html.read_text())} - {""}
    used = {k for k in used if not k.endswith((".", "_"))}  # prefixes of the families below
    from app.dash.astra import RNCP
    used |= {f"astra.goal.{g}.{part}" for g in GOALS for part in ("name", "rule")}
    used |= {f"astra.option.{o['key']}" for options in RNCP["titles"].values() for o in options}
    used |= {f"astra.tag.{t.removesuffix('_xp')}" for t in RNCP["tags"]}
    for prefix, values in FAMILIES.items():
        used |= {f"{prefix}.{v}" if prefix not in ("projects_table.marks", "log.flag", "publish.error") else f"{prefix}_{v}" for v in values}
    return used


def test_every_key_used_exists():
    en = json.loads((FRONTEND_DIR / "i18n" / "en.json").read_text())
    used = used_keys()
    assert len(used) > 200
    missing = sorted(k for k in used if k not in en)
    assert not missing, missing
