"""Which part of 42 a project belongs to (Piscine, Common Core, Outer Core) and the XP it gave."""
import json
from pathlib import Path

from core42.constants import PISCINE_CURSUS

TRACKS_FILE = Path(__file__).resolve().parent / "tracks.json"
RANKS = {slug: rank for rank, slugs in json.loads(TRACKS_FILE.read_text())["common_core"].items() for slug in slugs}
COMMON_CORE = frozenset(RANKS)


def track_of(project_user: dict) -> str:
    if PISCINE_CURSUS in (project_user.get("cursus_ids") or []):
        return "piscine"
    return "common-core" if (project_user.get("project") or {}).get("slug") in COMMON_CORE else "outer-core"


def group_of(project_user: dict) -> str:
    """The finer grouping used by the project tables: Common Core rank (rank-00…rank-06), outer-core or piscine."""
    track = track_of(project_user)
    return RANKS[project_user["project"]["slug"]] if track == "common-core" else track


def xp_earned(difficulty, mark, validated) -> int:
    """XP a validated project gives: its difficulty scaled by the final mark (bonus included). A calculation:
    the intra's own figure may differ."""
    if not validated or not difficulty or mark is None:
        return 0
    return round(difficulty * mark / 100)
