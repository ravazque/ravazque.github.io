"""Who someone is on 42 (student, staff, pisciner…) and whether they may use the web app.

The classification follows swifty-companion's ProfileKind: no single API field says it.
"""
from datetime import datetime
from enum import Enum

from core42.constants import MADRID_CAMPUS, MAIN_COALITIONS, MAIN_CURSUS


class Kind(str, Enum):
    STUDENT = "student"
    TRANSCENDER = "transcender"
    ALUMNI = "alumni"
    BLACKHOLED = "blackholed"
    FROZEN = "frozen"
    PISCINER = "pisciner"
    STAFF = "staff"


ALLOWED = {Kind.STUDENT, Kind.TRANSCENDER, Kind.ALUMNI}
REFUSAL = {Kind.STAFF: "staff", Kind.PISCINER: "piscine", Kind.BLACKHOLED: "blackholed", Kind.FROZEN: "frozen"}


def _ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def profile_kind(user: dict, now: datetime) -> Kind:
    """In order: staff; alumni; not started (no 42cursus or a future kickoff); blackholed; frozen; transcender."""
    main = next((c for c in user.get("cursus_users") or [] if c.get("cursus_id") == MAIN_CURSUS), None)
    if user.get("staff?"):
        return Kind.STAFF
    if user.get("alumni?") or (main or {}).get("grade") == "Alumni":
        return Kind.ALUMNI
    kickoff = _ts((main or {}).get("begin_at"))
    if main is None or kickoff is None or kickoff > now:
        return Kind.PISCINER
    end = _ts(main.get("end_at"))
    if end is not None and end <= now:
        return Kind.BLACKHOLED
    if not user.get("active?", True):
        return Kind.FROZEN
    if main.get("grade") == "Transcender":
        return Kind.TRANSCENDER
    return Kind.STUDENT


def access(user: dict, now: datetime) -> tuple[bool, str]:
    """(allowed, reason). Only 42 Madrid as primary campus, and only students, transcenders and alumni."""
    primary = next((c for c in user.get("campus_users") or [] if c.get("is_primary")), None)
    if not primary or primary.get("campus_id") != MADRID_CAMPUS:
        return False, "campus"
    kind = profile_kind(user, now)
    return (True, "ok") if kind in ALLOWED else (False, REFUSAL[kind])


def main_coalition(coalitions: list[dict]) -> dict | None:
    """The user's 42cursus coalition; piscine coalitions are ignored."""
    by_slug = {c.get("slug"): c for c in coalitions}
    return next((by_slug[s] for s in MAIN_COALITIONS if s in by_slug), None)
