"""The public snapshot for ravazque.github.io and its commit through the GitHub Contents API.

The snapshot is a whitelist: every field is copied by name from the owner's report, so nothing new
(contact data, seats, logged hours, other students) can reach the public site by accident.
"""
import base64
import json
import re
from datetime import datetime

import httpx

GITHUB_API = "https://api.github.com"
SITE_DATA_PATH = "site/data/42.json"
CURSUS_TRACKS = ("common-core", "outer-core")
IN_PROGRESS = ("in_progress", "waiting_for_correction", "searching_a_group", "creating_group")


class PublishError(Exception):
    pass


def _stage(cursus: dict | None, quests: list[dict]) -> str | None:
    """Same rule as myRank() in report.js: alumni, outer-core once the Common Core is done, else the rank being worked on."""
    if not cursus:
        return None
    if cursus.get("grade") == "Alumni":
        return "alumni"
    done = [q["name"] for q in quests if q.get("validated")]
    if cursus.get("grade") == "Transcender" or "Common Core" in done:
        return "outer-core"
    ranks = [int(m.group(1)) for m in (re.fullmatch(r"Common Core Rank (\d\d)", n) for n in done) if m]
    return f"rank-{(max(ranks) + 1 if ranks else 0):02d}"


def snapshot(report: dict, updated: str) -> dict:
    every = report["periods"]["all"]
    student = report["periods"].get("student") or every
    profile, extras, summary = every["profile"], every["extras"], student["summary"]
    cursus = {c["name"]: c for c in extras.get("cursus", [])}
    main = cursus.get("42cursus")
    quests = extras.get("quests", [])
    common_core = next((q["validated"] for q in quests if q["name"] == "Common Core" and q.get("validated")), None)
    projects = sorted(({"name": p["name"], "track": p["track"], "group": p.get("group", p["track"]), "mark": p["mark"],
                        "xp": p.get("xp_earned") or 0, "validated": (p.get("marked") or "")[:10]}
                       for p in every["projects"] if p.get("validated")), key=lambda p: p["validated"], reverse=True)
    in_progress = [{"name": p["name"], "track": p["track"], "group": p.get("group", p["track"]), "since": (p.get("registered") or "")[:10]}
                   for p in every["projects"] if not p.get("validated") and p.get("status") in IN_PROGRESS and p["track"] in CURSUS_TRACKS]
    skills = extras.get("skills_by_cursus") or {}
    coalition = profile.get("coalition") or {}
    return {
        "schema": 1,
        "updated": updated,
        "login": profile["login"],
        "name": profile.get("name"),
        "campus": "42 Madrid",
        "title": next((t["name"] for t in extras.get("titles", []) if t.get("selected")), None),
        "coalition": {"name": coalition["name"], "color": coalition["color"]} if coalition.get("name") else None,
        "cursus": {"level": main["level"], "grade": main.get("grade"), "stage": _stage(main, quests),
                   "kickoff": (main.get("begin") or "")[:10], "common_core": common_core[:10] if common_core else None} if main else None,
        "skills": {"student": [{"name": s["name"], "level": s["level"]} for s in skills.get("42cursus", [])],
                   "piscine": [{"name": s["name"], "level": s["level"]} for s in skills.get("C Piscine", [])]},
        "projects": {"validated": sum(1 for p in projects if p["track"] in CURSUS_TRACKS), "list": projects, "in_progress": in_progress},
        "evaluations": {k: summary.get(k) for k in ("given", "given_outstanding", "received", "received_outstanding", "received_avg_mark")},
    }


def can_publish(settings, user: dict) -> bool:
    return bool(settings.owner_login and settings.github_token and user.get("login") == settings.owner_login)


def is_fresh(last: str | None, now: datetime, max_age_s: int) -> bool:
    try:
        return (now - datetime.fromisoformat(last)).total_seconds() < max_age_s
    except (TypeError, ValueError):
        return False


async def publish_snapshot(http: httpx.AsyncClient, settings, payload: dict) -> str:
    """Create or update SITE_DATA_PATH on the configured branch; returns the commit's URL."""
    url = f"{GITHUB_API}/repos/{settings.github_repo}/contents/{SITE_DATA_PATH}"
    headers = {"Authorization": f"Bearer {settings.github_token}", "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28"}
    try:
        current = await http.get(url, params={"ref": settings.github_branch}, headers=headers, timeout=15)
        if current.status_code not in (200, 404):
            raise PublishError(f"GitHub answered {current.status_code} reading {SITE_DATA_PATH}")
        body = {"message": f"site: 42 snapshot of {payload.get('updated', '')[:10] or 'today'}".rstrip(),
                "content": base64.b64encode((json.dumps(payload, ensure_ascii=False, indent=1) + "\n").encode()).decode(),
                "branch": settings.github_branch}
        if current.status_code == 200:
            body["sha"] = current.json()["sha"]
        r = await http.put(url, json=body, headers=headers, timeout=15)
    except httpx.HTTPError as exc:
        raise PublishError(str(exc)) from exc
    if r.status_code not in (200, 201):
        raise PublishError(f"GitHub answered {r.status_code} writing {SITE_DATA_PATH}")
    return r.json()["commit"]["html_url"]
