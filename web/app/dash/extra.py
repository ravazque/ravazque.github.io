"""Profile figures beyond the raw history: contribution to others, technical domains, rhythm, and the portfolio."""
from datetime import date

from .astra import RNCP

# technical areas from the RNCP tags: a project counts once per area
AREAS = {"web": ["web", "web_db", "web_db_xp"], "mobile": ["mobile"], "ai": ["ai", "ai_xp"], "sysadmin": ["sysadmin"],
         "unix": ["unix"], "security": ["security", "security_xp"], "oop": ["oop"], "functional": ["functional", "functional_xp"],
         "imperative": ["imperative"], "suite": ["suite"]}
AREA_NAMES = {area: {n.strip().lower() for tag in tags for n in RNCP["tags"][tag]} for area, tags in AREAS.items()}


def streak(days: list[str], hours: list[float]) -> int:
    """Most consecutive calendar days with logged time."""
    best = run = 0
    prev = None
    for d, h in zip(days, hours):
        if not h:
            prev = None
            run = 0
            continue
        day = date.fromisoformat(d)
        run = run + 1 if prev is not None and (day - prev).days == 1 else 1
        best, prev = max(best, run), day
    return best


def active_weeks(days: list[str], hours: list[float]) -> tuple[int, int]:
    """(weeks with logged time, weeks from the first to the last logged day)."""
    on = [date.fromisoformat(d) for d, h in zip(days, hours) if h]
    if not on:
        return 0, 0
    weeks = {d.isocalendar()[:2] for d in on}
    return len(weeks), (on[-1] - on[0]).days // 7 + 1


def day_split(heat) -> dict:
    """Share of logged hours in the morning (6–14 h), afternoon (14–20 h) and night (20–6 h), Madrid time."""
    parts = {"morning": range(6, 14), "afternoon": range(14, 20)}
    total = sum(sum(row) for row in heat) or 1
    morning = sum(row[h] for row in heat for h in parts["morning"])
    afternoon = sum(row[h] for row in heat for h in parts["afternoon"])
    m, a = round(100 * morning / total), round(100 * afternoon / total)
    return {"morning": m, "afternoon": a, "night": 100 - m - a} if sum(map(sum, heat)) else {"morning": 0, "afternoon": 0, "night": 0}


def community(given: list[dict], received: list[dict]) -> dict:
    """Time spent evaluating others, how many people, and the rating they gave the student as evaluator."""
    rated = [e["fb_rating"] for e in given if e.get("fb_rating") is not None]
    return {"hours": round(sum(e.get("duration_min") or 0 for e in given) / 60, 1),
            "people": len({c.get("login") for e in given for c in e.get("correcteds", [])}),
            "correctors": len({(e.get("corrector") or {}).get("login") for e in received}),
            "rating": round(sum(rated) / len(rated), 2) if rated else None, "rated": len(rated)}


def domains(projects: list[dict]) -> list[dict]:
    """XP and validated projects per technical area, biggest first; areas with nothing validated are left out."""
    out = []
    for area, names in AREA_NAMES.items():
        done = [p for p in projects if p.get("validated") and p["name"].strip().lower() in names]
        if done:
            out.append({"key": area, "xp": sum(p.get("xp_earned") or 0 for p in done), "projects": [p["name"] for p in done]})
    return sorted(out, key=lambda x: -x["xp"])


def resilience(projects: list[dict]) -> int:
    """Projects validated after at least one failed attempt."""
    return sum(1 for p in projects if p.get("validated") and p.get("failed_attempts"))


def portfolio_rows(projects: list[dict]) -> list[list]:
    """One line per validated project, for an application or a CV: no other person's data."""
    rows = []
    for p in sorted((p for p in projects if p.get("validated")), key=lambda p: p.get("marked") or ""):
        areas = [a for a, names in AREA_NAMES.items() if p["name"].strip().lower() in names]
        last = next((a for a in reversed(p.get("attempts", [])) if a.get("validated")), {})
        rows.append([p["name"], p.get("track"), ", ".join(areas), (p.get("registered") or "")[:10], (p.get("marked") or "")[:10],
                     p.get("mark"), len(p.get("attempts", [])), p.get("xp_earned"), len(last.get("members") or []) + 1, p.get("days_to_validate")])
    return rows
