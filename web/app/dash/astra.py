"""Astra Victoris (42 Madrid): six goals, all needed. The RNCP titles and The Gatekeeper are worked out from the
report; The Kraken, The Headhunter and The Titan, and any RNCP override, are marked by the student and kept only in
their browser (dash.js), so nothing about them reaches the server."""
import json
import math
import re
from pathlib import Path

from markupsafe import Markup, escape

import core42
from core42.tracks import COMMON_CORE

RNCP = json.loads((Path(core42.__file__).parent / "rncp.json").read_text())
TAGS = {tag: {n.strip().lower() for n in names} for tag, names in RNCP["tags"].items()}
GOALS = ["grandmaster", "architect", "kraken", "gatekeeper", "headhunter", "titan"]


def _level(extras) -> float:
    main = next((c for c in extras.get("cursus", []) if c["name"] == "42cursus"), None)
    return main["level"] if main else 0


def _validated(projects, tag):
    return [p for p in projects if p.get("validated") and p["name"].strip().lower() in TAGS[tag]]


def catalogue(tag, projects) -> list[dict]:
    """Every project of a tag once (the intra lists spelling variants), with the student's state in it."""
    same = lambda n: re.sub(r"[\s_-]+", "", n.lower())  # noqa: E731  "Doom Nukem", "doom-nukem" and "doom_nukem" are one entry
    mine = {}
    for p in projects:
        if p.get("validated") or same(p["name"]) not in mine:
            mine[same(p["name"])] = p
    seen, out = set(), []
    for name in RNCP["tags"][tag]:
        key = same(name)
        if key in seen:
            continue
        seen.add(key)
        p = mine.get(key)
        state = "validated" if p and p.get("validated") else "started" if p else "none"
        out.append({"name": name, "state": state, "xp": p.get("xp_earned") if p and p.get("validated") else None})
    return sorted(out, key=lambda x: ({"validated": 0, "started": 1, "none": 2}[x["state"]], x["name"].lower()))


def requirement(f, need, projects, extras) -> dict:
    """One line of an RNCP option: what it asks, what the student has, met or not, and the projects behind it."""
    if "projects" in need:
        done = _validated(projects, need["projects"])
        return {"label": f("astra.req.projects", n=need["n"], tag=f(f"astra.tag.{need['projects']}")), "have": len(done), "need": need["n"],
                "met": len(done) >= need["n"], "list": [p["name"] for p in done], "unit": "", "all": catalogue(need["projects"], projects)}
    if "xp" in need:
        done = _validated(projects, need["xp"])
        xp = sum(p.get("xp_earned") or 0 for p in done)
        return {"label": f("astra.req.xp", n=f.num(need["n"]), tag=f(f"astra.tag.{need['xp'].removesuffix('_xp')}")), "have": xp, "need": need["n"],
                "met": xp >= need["n"], "list": [f"{p['name']} ≈ {f.num(p.get('xp_earned'))}" for p in done], "unit": "xp",
                "all": catalogue(need["xp"], projects)}
    if "group" in need:
        done = [p for p in projects if p.get("validated") and any(a.get("validated") and a.get("members") for a in p.get("attempts", []))]
        return {"label": f("astra.req.group", n=need["group"]), "have": len(done), "need": need["group"], "met": len(done) >= need["group"],
                "list": [p["name"] for p in done], "unit": ""}
    if "events" in need:
        n = len(extras.get("events", []))
        return {"label": f("astra.req.events", n=need["events"]), "have": n, "need": need["events"], "met": n >= need["events"], "list": [], "unit": ""}
    lvl = _level(extras)
    return {"label": f("astra.req.level", n=need["level"]), "have": lvl, "need": need["level"], "met": lvl >= need["level"], "list": [], "unit": "level"}


def rncp(f, title, projects, extras) -> dict:
    options = [{"key": o["key"], "name": f(f"astra.option.{o['key']}"), "reqs": [requirement(f, n, projects, extras) for n in o["needs"]]}
               for o in RNCP["titles"][title]]
    for o in options:
        o["met"] = all(r["met"] for r in o["reqs"])
        o["done"] = sum(r["met"] for r in o["reqs"])
    return {"options": options, "met": any(o["met"] for o in options)}


def gatekeeper(data) -> dict:
    periods = data["periods"]
    given = (periods.get("student") or periods["all"])["given"]

    def outer(e):
        slug = e.get("slug")
        name = e["project"].strip().lower()
        return slug not in COMMON_CORE if slug else not ({name, name.replace(" ", "_"), name.replace(" ", "-")} & COMMON_CORE)
    rated = [e["fb_rating"] for e in given if e.get("fb_rating") is not None]
    avg = sum(rated) / len(rated) if rated else None
    hours = periods["all"]["logtime"]["total_hours"]
    evals_ok = sum(map(outer, given)) >= 50 or (len(given) >= 150 and (avg or 0) >= 4.5)
    return {"outer": sum(map(outer, given)), "total": len(given), "avg": avg, "hours": hours,
            "evals_met": evals_ok, "hours_met": hours >= 2000, "met": evals_ok and hours >= 2000}


def coalition(data) -> dict | None:
    """Today's standing in the student's coalition; the API keeps no history of past masters or tournament winners."""
    c = data["periods"]["all"]["profile"].get("coalition")
    if not c:
        return None
    return {"name": c["name"], "rank": c.get("rank"), "score": c.get("score"), "master": bool(c.get("master")),
            "met": bool(c.get("master")) or c.get("rank") == 1}


def view(f, data) -> dict:
    every = data["periods"]["all"]
    projects, extras = every["projects"], every["extras"]
    return {"grandmaster": rncp(f, "rncp7", projects, extras), "architect": rncp(f, "rncp6", projects, extras), "gatekeeper": gatekeeper(data),
            "titan": coalition(data)}


def hexagon(goal: str, label: str) -> Markup:
    """The goal's emblem (web/static/astra), shown in colour once achieved."""
    return Markup(f'<img class="astra-hex" src="/static/astra/the-{goal}.svg" width="200" height="174" alt="{escape(label)}">')


def laurel(flip=False) -> Markup:
    """A laurel branch: leaves along an arc, opening upwards."""
    leaves = []
    for k in range(7):
        a = math.radians(205 - 22 * k)
        x, y = 34 + 24 * math.cos(a), 34 - 26 * math.sin(a)
        leaves.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="7" ry="2.8" transform="rotate({-math.degrees(a) - 60:.0f} {x:.1f} {y:.1f})"/>')
    stem = '<path d="M30 60 C10 50 8 26 22 8" class="stem"/>'
    return Markup(f'<svg class="laurel{" flip" if flip else ""}" viewBox="0 0 44 62" aria-hidden="true">{stem}{"".join(leaves)}</svg>')
