"""Astra Victoris (42 Madrid): six goals, all needed. The RNCP titles and The Gatekeeper are worked out from the
report; The Kraken, The Headhunter and The Titan, and any RNCP override, are marked by the student and kept only in
their browser (dash.js), so nothing about them reaches the server."""
import json
import math
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


def requirement(f, need, projects, extras) -> dict:
    """One line of an RNCP option: what it asks, what the student has, met or not, and the projects behind it."""
    if "projects" in need:
        done = _validated(projects, need["projects"])
        return {"label": f("astra.req.projects", n=need["n"], tag=f(f"astra.tag.{need['projects']}")), "have": len(done), "need": need["n"],
                "met": len(done) >= need["n"], "list": [p["name"] for p in done], "unit": ""}
    if "xp" in need:
        done = _validated(projects, need["xp"])
        xp = sum(p.get("xp_earned") or 0 for p in done)
        return {"label": f("astra.req.xp", n=f.num(need["n"]), tag=f(f"astra.tag.{need['xp'].removesuffix('_xp')}")), "have": xp, "need": need["n"],
                "met": xp >= need["n"], "list": [f"{p['name']} ≈ {f.num(p.get('xp_earned'))}" for p in done], "unit": "xp"}
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


def view(f, data) -> dict:
    every = data["periods"]["all"]
    projects, extras = every["projects"], every["extras"]
    return {"grandmaster": rncp(f, "rncp7", projects, extras), "architect": rncp(f, "rncp6", projects, extras), "gatekeeper": gatekeeper(data)}


# ---------- drawing: a flat-topped hexagon around each goal's silhouette (100 × 100 units) ----------

ICONS = {
    "grandmaster": (  # a dragon, bat wings spread
        '<path d="M46 48 L26 17 L4 30 Q12 34 12 45 Q19 40 24 49 Q30 44 34 55 Q40 50 46 57 Z"/>'
        '<path d="M54 48 L74 17 L96 30 Q88 34 88 45 Q81 40 76 49 Q70 44 66 55 Q60 50 54 57 Z"/>'
        '<path d="M45 47 C44 38 46 31 50 27 C54 31 56 38 55 47 Z"/><path d="M43 26 L50 13 L57 26 L50 31 Z"/>'
        '<path class="line" d="M46 17 L41 8 M54 17 L59 8"/><ellipse cx="50" cy="59" rx="8" ry="14"/>'
        '<path class="line wide" d="M50 71 C42 80 60 84 52 95"/>'),
    "architect": (  # a spider
        '<circle cx="50" cy="37" r="7"/><ellipse cx="50" cy="58" rx="11" ry="15"/>'
        + "".join(f'<path class="line" d="M{x1} {y1} L{x2} {y2} L{x3} {y3}"/><path class="line" d="M{100 - x1} {y1} L{100 - x2} {y2} L{100 - x3} {y3}"/>'
                  for x1, y1, x2, y2, x3, y3 in [(44, 44, 30, 26, 22, 36), (42, 49, 22, 40, 12, 50), (42, 55, 22, 58, 14, 72), (44, 61, 32, 72, 28, 88)])),
    "kraken": (  # an octopus
        '<path d="M28 50 C28 18 72 18 72 50 C72 59 63 63 50 63 C37 63 28 59 28 50 Z"/>'
        '<circle cx="41" cy="45" r="4" class="eye"/><circle cx="59" cy="45" r="4" class="eye"/>'
        + "".join(f'<path class="line wide" d="M{x} 60 C{x + dx} 72 {x + 2 * dx} 74 {x + dx} 86 C{x + dx // 2} 92 {x + dx * 2} 94 {x + dx * 2} 88"/>'
                  for x, dx in [(36, -7), (43, -3), (57, 3), (64, 7)])),
    "gatekeeper": (  # a wolf howling at the moon
        '<circle cx="72" cy="24" r="15" class="moon"/>'
        '<path d="M28 16 L41 25 L46 12 L50 27 C56 33 58 42 60 52 C68 60 71 78 70 92 L42 92 L44 72 C38 62 36 50 37 40 C33 34 30 28 26 22 Z"/>'
        '<path d="M64 88 C76 93 85 85 83 74 C81 82 73 85 67 81 Z"/>'),
    "headhunter": (  # an eagle in flight
        '<path d="M50 46 C40 38 26 31 5 34 L14 40 L7 45 L18 48 L11 53 L24 55 L19 60 L34 59 C41 57 46 53 50 53 Z"/>'
        '<path d="M50 46 C60 38 74 31 95 34 L86 40 L93 45 L82 48 L89 53 L76 55 L81 60 L66 59 C59 57 54 53 50 53 Z"/>'
        '<ellipse cx="50" cy="54" rx="6" ry="11"/><circle cx="50" cy="38" r="6"/><path d="M48 41 L50 47 L52 41 Z" class="eye"/>'
        '<path d="M44 63 L50 82 L56 63 Z"/>'),
    "titan": (  # a gorilla
        '<path d="M16 93 C14 70 24 56 38 52 L62 52 C76 56 86 70 84 93 Z"/>'
        '<path d="M20 60 C9 66 5 80 8 94 L20 94 C19 82 23 72 28 65 Z"/><path d="M80 60 C91 66 95 80 92 94 L80 94 C81 82 77 72 72 65 Z"/>'
        '<path d="M30 52 C28 36 37 28 50 27 C63 28 72 36 70 52 C68 62 60 67 50 67 C40 67 32 62 30 52 Z"/>'
        '<path d="M37 49 C39 43 61 43 63 49 C65 57 58 64 50 64 C42 64 35 57 37 49 Z" class="eye"/>'
        '<path d="M34 46 C41 38 59 38 66 46 L63 50 C57 44 43 44 37 50 Z" class="brow"/>'
        '<circle cx="44" cy="50" r="2.1" class="pupil"/><circle cx="56" cy="50" r="2.1" class="pupil"/>'
        '<ellipse cx="47" cy="56" rx="1.7" ry="1.1" class="pupil"/><ellipse cx="53" cy="56" rx="1.7" ry="1.1" class="pupil"/>'
        '<path d="M44 60 Q50 62.5 56 60" class="line thin"/>'),
}


def hexagon(goal: str, label: str) -> Markup:
    outer = "30,2 90,2 118,52 90,102 30,102 2,52"
    inner = "34,9 86,9 110,52 86,95 34,95 10,52"
    return Markup(f'<svg class="astra-hex" viewBox="0 0 120 104" role="img" aria-label="{escape(label)}">'
                  f'<polygon class="hex-out" points="{outer}"/><polygon class="hex-in" points="{inner}"/>'
                  f'<g class="icon" transform="translate(21 13) scale(0.78)">{ICONS[goal]}</g></svg>')


def laurel(flip=False) -> Markup:
    """A laurel branch: leaves along an arc, opening upwards."""
    leaves = []
    for k in range(7):
        a = math.radians(205 - 22 * k)
        x, y = 34 + 24 * math.cos(a), 34 - 26 * math.sin(a)
        leaves.append(f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="7" ry="2.8" transform="rotate({-math.degrees(a) - 60:.0f} {x:.1f} {y:.1f})"/>')
    stem = '<path d="M30 60 C10 50 8 26 22 8" class="stem"/>'
    return Markup(f'<svg class="laurel{" flip" if flip else ""}" viewBox="0 0 44 62" aria-hidden="true">{stem}{"".join(leaves)}</svg>')
