"""Extra views on a student's data: campus history, teammates, exams, pace, evaluations in depth, and the three that
need a few more API calls (the promo, the campus coalitions, the network among the closest contacts).

Everything here is a pure function over data the extraction already holds; nothing reaches the API.
"""
import json
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from statistics import median

from .analysis import TZ, local, merge_intervals, ts


SKILLS = {k: v for k, v in json.loads((Path(__file__).resolve().parent / "skills.json").read_text()).items() if not k.startswith("_")}


def _day(dt):
    return local(dt).date().isoformat() if dt else None


def _avg(values, nd=1):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), nd) if values else None


def _median(values, nd=1):
    values = [v for v in values if v is not None]
    return round(median(values), nd) if values else None


def campus_history(user: dict, locations: list[dict], now: datetime) -> list[dict]:
    """Every campus of the profile with when you joined it and the time logged there; the primary campus first."""
    info = {c["id"]: c for c in user.get("campus") or []}
    rows = []
    for cu in user.get("campus_users") or []:
        cid = cu["campus_id"]
        sessions = [(ts(l["begin_at"]), ts(l["end_at"]) or now) for l in locations if l.get("campus_id") == cid]
        seconds = sum((e - b).total_seconds() for b, e in merge_intervals(sessions))
        rows.append({"id": cid, "name": info.get(cid, {}).get("name"), "city": info.get(cid, {}).get("city"),
                     "primary": bool(cu.get("is_primary")), "joined": (cu.get("created_at") or "")[:10] or None,
                     "sessions": len(sessions), "hours": round(seconds / 3600, 1),
                     "first": _day(min((b for b, _ in sessions), default=None)),
                     "last": _day(max((b for b, _ in sessions), default=None))})
    rows.sort(key=lambda r: (not r["primary"], r["joined"] or ""))
    return rows


def teammates(projects: list[dict], me: str, names: dict[str, str]) -> list[dict]:
    """Everyone you shared a team with: how many teams, and on which projects how many times each, most frequent first."""
    acc = {}
    for p in projects:
        for a in p.get("attempts") or []:
            for login in a.get("members") or []:
                if login == me:
                    continue
                row = acc.setdefault(login, {"login": login, "name": names.get(login), "teams": 0, "projects": {}})
                row["teams"] += 1
                row["projects"][p["name"]] = row["projects"].get(p["name"], 0) + 1
    return sorted(acc.values(), key=lambda r: -r["teams"])


def exams(projects: list[dict]) -> list[dict]:
    """Every exam with each try (date, mark, passed) and the days from the first try to the pass."""
    rows = []
    for p in projects:
        if not p.get("exam"):
            continue
        tries = [{"date": (a.get("start") or "")[:10], "mark": a.get("mark"), "passed": bool(a.get("validated"))}
                 for a in p.get("attempts") or []]
        passed_on = next((t["date"] for t in tries if t["passed"]), None)
        days = (datetime.fromisoformat(passed_on) - datetime.fromisoformat(tries[0]["date"])).days if passed_on and tries else None
        rows.append({"name": p["name"], "track": p.get("track"), "passed": bool(p.get("validated")), "attempts": len(tries),
                     "best": max((t["mark"] or 0 for t in tries), default=None), "days_to_pass": days, "tries": tries})
    return rows


def pace(projects: list[dict], cursus: dict | None, now: datetime) -> dict:
    """XP and validations per month (cumulative XP), months since the kickoff and the days left before the blackhole."""
    by_month = {}
    for p in projects:
        if p.get("validated") and p.get("marked"):
            m = by_month.setdefault(p["marked"][:7], {"month": p["marked"][:7], "xp": 0, "validated": 0})
            m["xp"] += p.get("xp_earned") or 0
            m["validated"] += 1
    # every month from the first validation to this one, empty months at 0: the chart's axis is time
    months, total = [], 0
    if by_month:
        y, mo = map(int, min(by_month).split("-"))
        end = max(max(by_month), local(now).strftime("%Y-%m"))
        while f"{y}-{mo:02d}" <= end:
            key = f"{y}-{mo:02d}"
            m = by_month.get(key, {"month": key, "xp": 0, "validated": 0})
            total += m["xp"]
            months.append({**m, "cumulative": total})
            y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
    cursus = cursus or {}
    since = None
    if cursus.get("begin"):
        start = datetime.strptime(cursus["begin"], "%Y-%m-%d %H:%M")
        today = local(now)
        since = (today.year - start.year) * 12 + today.month - start.month - (today.day < start.day)
    blackhole = None
    if cursus.get("blackholed"):
        end = datetime.strptime(cursus["blackholed"], "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
        blackhole = max((end - now).days, 0)
    return {"months": months, "months_since_kickoff": since, "blackhole_days": blackhole,
            "xp_per_month": round(total / since) if since else None}


def evaluation_depth(received: list[dict], given: list[dict]) -> dict:
    """Per project (received and given), how long evaluations last, how far ahead they are booked, Outstanding streak."""
    rows = {}
    for role, evs in (("received", received), ("given", given)):
        for e in evs:
            r = rows.setdefault(e["project"], {"project": e["project"], "received": 0, "received_marks": [],
                                               "received_outstanding": 0, "given": 0, "given_marks": []})
            r[role] += 1
            if e.get("status") == "done" and e.get("mark") is not None:
                r[f"{role}_marks"].append(e["mark"])
            if role == "received" and e.get("outstanding"):
                r["received_outstanding"] += 1
    projects = [{"project": r["project"], "received": r["received"], "received_avg": _avg(r["received_marks"]),
                 "received_outstanding": r["received_outstanding"], "given": r["given"], "given_avg": _avg(r["given_marks"])}
                for r in sorted(rows.values(), key=lambda r: -r["received"])]
    streak = best = 0
    for e in sorted(received, key=lambda e: e.get("begin") or ""):
        streak = streak + 1 if e.get("outstanding") else 0
        best = max(best, streak)
    duration = lambda evs: {"avg": _avg([e.get("duration_min") for e in evs]), "median": _median([e.get("duration_min") for e in evs])}
    return {"projects": projects, "received_duration": duration(received), "given_duration": duration(given),
            "received_lead_h": _median([e.get("lead_h") for e in received]), "given_lead_h": _median([e.get("lead_h") for e in given]),
            "outstanding_streak": best}


def promo_standing(levels: list[float], mine: float) -> dict | None:
    """Where a level sits among the students who started the 42cursus the same week: no names, only counts."""
    if not levels:
        return None
    hist = Counter(int(l) for l in levels)
    return {"size": len(levels), "rank": 1 + sum(1 for l in levels if l > mine),
            "percentile": round(100 * sum(1 for l in levels if l <= mine) / len(levels), 1),
            "median": round(median(levels), 2), "mine": mine,
            "histogram": [{"level": k, "count": hist[k]} for k in sorted(hist)]}


def coalition_standings(bloc: dict | None, mine_id: int | None) -> list[dict]:
    """The campus coalitions ranked by score, with yours marked."""
    ranked = sorted((bloc or {}).get("coalitions") or [], key=lambda c: -(c.get("score") or 0))
    return [{"name": c["name"], "color": c.get("color"), "score": c.get("score") or 0, "rank": i + 1, "mine": c.get("id") == mine_id}
            for i, c in enumerate(ranked)]


def contact_network(me: str, contacts: list[dict], given_by: dict[str, list[dict]]) -> dict:
    """Who evaluated whom among you and your closest contacts: nodes and directed links (corrector → evaluated)."""
    nodes = [{"login": me, "group": "me"}] + [{"login": c["login"], "group": c.get("group")} for c in contacts]
    known = {n["login"] for n in nodes}
    links = {}
    for c in contacts:
        for e in given_by.get(c["login"]) or []:
            if not isinstance(e.get("correcteds"), list):
                continue
            for u in e["correcteds"]:
                target = u.get("login") if isinstance(u, dict) else None
                if target in known and target != c["login"]:
                    key = (c["login"], target)
                    links[key] = links.get(key, 0) + 1
    return {"nodes": nodes, "links": [{"source": s, "target": t, "count": n} for (s, t), n in links.items()]}


def skill_sets(cursus_users: list[dict]) -> dict[str, list[dict]]:
    """Each cursus's skills in the intra's radar order, every skill of the cursus included (0 when not started)."""
    out = {}
    for cu in cursus_users:
        name = (cu.get("cursus") or {}).get("name")
        if name not in SKILLS:
            continue
        levels = {s["name"]: s["level"] for s in cu.get("skills") or []}
        out[name] = [{"name": n, "level": levels.get(n, 0)} for n in SKILLS[name]] + \
                    [{"name": n, "level": l} for n, l in levels.items() if n not in SKILLS[name]]
    return out


# Coalition points: /coalitions_users/:id/scores. The logtime bonus rule is inferred (2026-10-24, ten awards on two
# profiles): at every logout the intra sums the last 7 rolling days, overlaps merged; >= 50 h gives +500 (calculation
# 7), >= 80 h +1000 (calculation 20), each at most once every 7 days since it was last given.
BONUS_TIERS = {7: 50, 20: 80}
BONUS_POINTS = {50: 500, 80: 1000}
WEEK = timedelta(days=7)
SOURCES = {"ScaleTeam": "evaluations", "ProjectsUser": "projects", "Team": "exams", "Location": "logtime",
           "Transaction": "wallet"}


def coalition_points(scores: list[dict] | None) -> dict | None:
    """Points given to the coalition by source (biggest first), per Madrid month (logtime apart), and the logtime bonuses."""
    if scores is None:
        return None
    sources, months = {}, {}
    for s in scores:
        key = SOURCES.get(s.get("scoreable_type"), "other")
        if key == "logtime" and s.get("calculation_id") in BONUS_TIERS:
            key = f"logtime_{BONUS_TIERS[s['calculation_id']]}"
        row = sources.setdefault(key, {"key": key, "points": 0, "count": 0})
        row["points"] += s["value"]
        row["count"] += 1
        m = months.setdefault(local(ts(s["created_at"])).strftime("%Y-%m"), {"logtime": 0, "other": 0})
        m["logtime" if key.startswith("logtime") else "other"] += s["value"]
    span = []
    if months:
        y, mo = map(int, min(months).split("-"))
        while f"{y}-{mo:02d}" <= max(months):
            span.append({"month": f"{y}-{mo:02d}", **months.get(f"{y}-{mo:02d}", {"logtime": 0, "other": 0})})
            y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
    bonuses = sorted(({"at": s["created_at"], "hours": BONUS_TIERS[s["calculation_id"]], "points": s["value"]} for s in scores
                      if s.get("scoreable_type") == "Location" and s.get("calculation_id") in BONUS_TIERS), key=lambda b: b["at"], reverse=True)
    return {"total": sum(r["points"] for r in sources.values()), "count": len(scores),
            "sources": sorted(sources.values(), key=lambda r: -r["points"]), "months": span, "bonuses": bonuses}


def bonus_window(locations: list[dict], scores: list[dict], now: datetime) -> dict:
    """What logtime_bonus needs, kept in the report: the last 7 days of sessions (merged; an open one ends now) and when
    each bonus was last given."""
    start = now - WEEK
    sessions = merge_intervals([(max(ts(l["begin_at"]), start), min(ts(l["end_at"]) or now, now)) for l in locations
                                if (ts(l["end_at"]) or now) > start])
    last = {str(h): max((s["created_at"] for s in scores if s.get("scoreable_type") == "Location" and s.get("calculation_id") == c), default=None)
            for c, h in BONUS_TIERS.items()}
    return {"at": now.isoformat(), "open": any(not l.get("end_at") for l in locations),
            "sessions": [[b.isoformat(), e.isoformat()] for b, e in sessions if e > b], "last": last}


def logtime_bonus(window: dict, now: datetime) -> list[dict]:
    """Each bonus now: hours in the rolling week, what is missing, when the cooldown ends, and the earliest logout that
    earns it when connected from now on (an open session is assumed to go on: the report cannot know)."""
    sessions = [(ts(b), ts(e)) for b, e in window["sessions"]]
    if window["open"] and sessions:
        sessions[-1] = (sessions[-1][0], max(sessions[-1][1], now))
    sessions = [(b, min(e, now)) for b, e in sessions if b < now]

    def hours(t):  # in the week before t, connected from now to t
        start = t - WEEK
        past = sum(max(0, (min(e, now) - max(b, start)).total_seconds()) for b, e in sessions)
        return (past + max(0, (t - max(now, start)).total_seconds())) / 3600

    edges = sorted({now, now + WEEK} | {x + WEEK for b, e in sessions for x in (b, e) if now < x + WEEK < now + WEEK})
    out = []
    for h in BONUS_TIERS.values():
        last = window["last"].get(str(h))
        ready_at = ts(last) + WEEK if last else None
        cooldown = ready_at is not None and ready_at > now
        have = hours(now)
        until, prev = None, now
        for t in edges:  # hours() is linear between edges and never decreases: find the first edge over h, then interpolate
            if hours(t) >= h:
                hp, ht = hours(prev), hours(t)
                until = prev if hp >= h else prev + timedelta(seconds=round((h - hp) / (ht - hp) * (t - prev).total_seconds()))
                break
            prev = t
        if until and cooldown:
            until = max(until, ready_at)
        out.append({"hours": h, "points": BONUS_POINTS[h], "window_h": round(have, 1), "need_h": round(max(0, h - have), 1),
                    "last": last, "from": ready_at.isoformat() if cooldown else None,
                    "state": "cooldown" if cooldown else "ready" if have >= h else "short",
                    "until": until.isoformat() if until else None})
    return out


def add_insights(report: dict, d: dict, now: datetime) -> dict:
    """The extra views for one period's report; d is that period's data (campus hours follow the period)."""
    user = d["user"]
    primary = next((c for c in user.get("campus_users") or [] if c.get("is_primary")), None)
    campus_names = {c["id"]: c["name"] for c in user.get("campus") or []}
    report["profile"]["campus_current"] = campus_names.get((primary or {}).get("campus_id"))
    report["campuses"] = campus_history(user, d.get("locations") or [], now)
    names = {p["login"]: p.get("displayname") or p.get("name") for p in d.get("people") or [] if p.get("login")}
    main = next((c for c in report["extras"].get("cursus") or [] if c["name"] == "42cursus"), None)
    report["insights"] = {"teammates": teammates(report["projects"], report["profile"]["login"], names),
                          "exams": exams(report["projects"]), "pace": pace(report["projects"], main, now),
                          "evaluations": evaluation_depth(report["received"], report["given"])}
    return report
