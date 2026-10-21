"""The light extraction: everything the report shows except the per-evaluation lookups
(the corrector's seat and per-criterion feedback), plus the rank group of everyone met."""
from datetime import datetime, timedelta, timezone

from core42.analysis import PERIODS, analyze, seat_layout, ts
from core42.collect import drop_hidden_evaluations, people_ids, project_ids
from core42.connections import connections
from core42.constants import MADRID_CAMPUS, MAIN_COALITIONS, MAIN_CURSUS
from core42.insights import coalition_standings, contact_network, promo_standing
from core42.profile import access
from core42.ranks import rank_groups
from core42.stats import correction_stats

class AccessRefused(Exception):
    """The profile no longer meets the access rule; args[0] is the reason (campus, staff, pisciner, blackholed, frozen)."""


USER_LISTS = {
    "projects_users": "projects_users",
    "teams": "teams",
    "evals_received": "scale_teams/as_corrected",
    "evals_given": "scale_teams/as_corrector",
    "locations": "locations",
    "correction_points": "correction_point_historics",
    "events_users": "events_users",
    "coalitions_users": "coalitions_users",
    "quests_users": "quests_users",
    "titles_users": "titles_users",
    "expertises_users": "expertises_users",
}
PROJECT_FIELDS = ("id", "name", "slug", "difficulty", "exam", "parent")
BATCH = 100
NETWORK_SIZE = 30  # closest contacts whose given evaluations are read for the network (1 request each)


async def _batched(api, path, key, ids):
    ids, out = sorted(ids), []
    for i in range(0, len(ids), BATCH):
        out += await api.get_all(path, **{key: ",".join(map(str, ids[i:i + BATCH]))})
    return out


async def extract(api, uid: int, progress) -> dict:
    # user, the lists, achievements, coalitions, people, projects, ranks, feedback, promo + coalitions, network, analysis
    steps = len(USER_LISTS) + 10
    done = 0

    async def step():
        nonlocal done
        done += 1
        await progress(done / steps)

    d = {"user": await api.get(f"/v2/users/{uid}")}
    allowed, reason = access(d["user"], datetime.now(timezone.utc))
    if not allowed:  # checked again at every extraction: blackholed or frozen since signing in
        raise AccessRefused(reason)
    await step()
    for name, endpoint in USER_LISTS.items():
        d[name] = await api.get_all(f"/v2/users/{uid}/{endpoint}")
        await step()
    d["achievements_users"] = await api.get_all("/v2/achievements_users", **{"filter[user_id]": uid})
    known = {a["id"] for a in d["user"].get("achievements", [])}
    missing = sorted({a["achievement_id"] for a in d["achievements_users"]} - known)
    d["achievements"] = [await api.get(f"/v2/achievements/{i}") for i in missing]
    await step()
    coalitions = await api.get(f"/v2/users/{uid}/coalitions")
    rank = {slug: i for i, slug in enumerate(MAIN_COALITIONS)}
    d["coalitions"] = sorted(coalitions, key=lambda c: rank.get(c.get("slug"), len(rank)))
    order = {c["id"]: i for i, c in enumerate(d["coalitions"])}
    d["coalitions_users"] = sorted(d["coalitions_users"], key=lambda cu: order.get(cu.get("coalition_id"), len(order)))
    await step()
    # other people: only id, login and name are kept (no photo, staff flag or cursus data)
    drop_hidden_evaluations(d)
    met = people_ids(d, uid)
    d["people"] = [{"id": p["id"], "login": p["login"], "displayname": p.get("displayname")}
                   for p in await _batched(api, "/v2/users", "filter[id]", met)]
    await step()
    d["projects"] = [{k: p.get(k) for k in PROJECT_FIELDS} for p in await _batched(api, "/v2/projects", "filter[id]", project_ids(d))]
    await step()
    cursus_rows = await _batched(api, f"/v2/cursus/{MAIN_CURSUS}/cursus_users", "filter[user_id]", met)
    quest_rows = await _batched(api, "/v2/quests_users", "filter[user_id]", met)
    groups = rank_groups(cursus_rows, quest_rows)
    await step()
    d["corrector_sessions"], d["feedbacks"] = {}, await _feedbacks(api, d)
    await step()
    standing = await _standing(api, d)
    await step()

    periods = {}
    for p in PERIODS:
        report = analyze(d, p)
        report["profile"]["image"] = "/avatar/me"
        report["stats"] = correction_stats(report, groups)
        periods[p] = report
    await step()
    links = {p: connections(r, groups) for p, r in periods.items()}
    network = await _network(api, d, links["all"])
    await step()
    return {
        "page": "web",
        "light": True,
        "default_period": "student",
        "periods": periods,
        "layout": seat_layout([s["host"] for s in d["locations"]]),
        "connections": links,
        "network": network,
        **standing,
    }


async def _feedbacks(api, d) -> dict:
    """Written feedback with its per-criterion details, 100 evaluations per request. Authors are kept as logins only."""
    ids = [e["id"] for e in d["evals_received"] + d["evals_given"]]
    out = {}
    for f in await _batched(api, "/v2/feedbacks", "filter[feedbackable_id]", ids):
        if f.get("feedbackable_type", "ScaleTeam") == "ScaleTeam":
            out.setdefault(str(f["feedbackable_id"]), []).append(
                {**{k: f.get(k) for k in ("comment", "rating", "created_at", "feedback_details")},
                 "user": {"login": (f.get("user") or {}).get("login")}})
    return out


async def _standing(api, d) -> dict:
    """The promo (who started the 42cursus in Madrid the same week, counts only) and the Madrid coalitions."""
    main = next((c for c in d["user"]["cursus_users"] if c["cursus_id"] == MAIN_CURSUS), None)
    promo = None
    if main and main.get("begin_at"):
        start = ts(main["begin_at"])
        window = ",".join((start + timedelta(days=k)).strftime("%Y-%m-%dT%H:%M:%S.000Z") for k in (-3, 3))
        rows = await api.get_all(f"/v2/cursus/{MAIN_CURSUS}/cursus_users", **{"filter[campus_id]": MADRID_CAMPUS, "range[begin_at]": window})
        promo = promo_standing([r["level"] for r in rows if r.get("level") is not None], main.get("level") or 0)
    blocs = await api.get("/v2/blocs", **{"filter[campus_id]": MADRID_CAMPUS, "filter[cursus_id]": MAIN_CURSUS})
    mine = (d["coalitions"] or [{}])[0].get("id")
    return {"promo": promo, "coalitions": coalition_standings(blocs[0] if blocs else None, mine)}


async def _network(api, d, contacts) -> dict:
    """Who evaluated whom among the closest contacts: one request per contact, skipped when the hourly budget is low."""
    top = sorted(contacts, key=lambda c: -(c["received"] + c["given"]))[:NETWORK_SIZE]
    ids = {p["login"]: p["id"] for p in d["people"]}
    limiter = getattr(api, "limiter", None)
    given_by = {}
    if limiter is None or await limiter.budget_ok():
        for c in top:
            if c["login"] in ids:
                evs = await api.get(f"/v2/users/{ids[c['login']]}/scale_teams/as_corrector", **{"page[size]": 100, "sort": "-begin_at"})
                given_by[c["login"]] = [{"correcteds": [{"login": u.get("login")} for u in e["correcteds"] if isinstance(u, dict)]
                                         if isinstance(e.get("correcteds"), list) else []} for e in evs or []]
    return contact_network(d["user"]["login"], [{"login": c["login"], "group": c["group"]} for c in top], given_by)
