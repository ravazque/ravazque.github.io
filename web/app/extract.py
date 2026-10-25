"""The light extraction: everything the report shows without one request per evaluation. The other side's seat is
looked up per day, for the last SEAT_DAYS days only; feedback comes in batches; plus the rank group of everyone met."""
import asyncio
from datetime import datetime, timedelta, timezone

from core42.analysis import PERIODS, analyze, seat_layout, ts
from core42.collect import drop_hidden_evaluations, people_ids, project_ids
from core42.connections import connections
from core42.constants import COMMON_CORE_QUESTS, MADRID_CAMPUS, MAIN_COALITIONS, MAIN_CURSUS
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
SCORE_FIELDS = ("value", "scoreable_type", "scoreable_id", "calculation_id", "created_at")
BATCH = 100
SEAT_DAYS = 60  # the other side's seat is looked up for evaluations of the last 60 days (one request per day with any)
NETWORK_SIZE = 30  # closest contacts whose given evaluations are read for the network (1 request each)


async def _batched(api, path, key, ids, **params):
    ids, out = sorted(ids), []
    for i in range(0, len(ids), BATCH):
        out += await api.get_all(path, **{key: ",".join(map(str, ids[i:i + BATCH])), **params})
    return out


async def extract(api, uid: int, progress) -> dict:
    # user, the lists, intra hours + groups, achievements, coalitions, people, projects, ranks, feedback, promo + coalitions, network, analysis
    steps = len(USER_LISTS) + 11
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
    # the independent lists go out together: the limiter paces them over every app it holds

    async def user_list(name, endpoint):
        d[name] = await api.get_all(f"/v2/users/{uid}/{endpoint}")
        await step()

    async def stats_and_groups():
        # the intra's own daily logtime since the account began (1 request), and the profile's groups (names only)
        d["locations_stats"] = await api.get(f"/v2/users/{uid}/locations_stats", begin_at=(d["user"].get("created_at") or "2013-01-01")[:10])
        d["groups"] = [{"name": g.get("name")} for g in await api.get_all(f"/v2/users/{uid}/groups")]
        await step()

    async def achievements_users():
        d["achievements_users"] = await api.get_all("/v2/achievements_users", **{"filter[user_id]": uid})

    async def coalitions_of_user():
        d["_coalitions"] = await api.get(f"/v2/users/{uid}/coalitions")

    await asyncio.gather(*(user_list(n, e) for n, e in USER_LISTS.items()), stats_and_groups(), achievements_users(), coalitions_of_user())
    known = {a["id"] for a in d["user"].get("achievements", [])}
    missing = sorted({a["achievement_id"] for a in d["achievements_users"]} - known)
    d["achievements"] = await _batched(api, "/v2/achievements", "filter[id]", missing) if missing else []
    await step()
    coalitions = d.pop("_coalitions")
    rank = {slug: i for i, slug in enumerate(MAIN_COALITIONS)}
    d["coalitions"] = sorted(coalitions, key=lambda c: rank.get(c.get("slug"), len(rank)))
    order = {c["id"]: i for i, c in enumerate(d["coalitions"])}
    d["coalitions_users"] = sorted(d["coalitions_users"], key=lambda cu: order.get(cu.get("coalition_id"), len(order)))
    drop_hidden_evaluations(d)
    met = people_ids(d, uid)
    # everything below depends only on the lists above, so it goes out together as well

    async def coalition_scores():
        # the points given to the main coalition (paged, ~1 request per 100) feed the logtime bonus and the points by source
        cu = (d["coalitions_users"] or [None])[0]
        d["coalition_scores"] = [{k: s.get(k) for k in SCORE_FIELDS} for s in await api.get_all(f"/v2/coalitions_users/{cu['id']}/scores")] if cu else []
        await step()

    async def people():
        # other people: only id, login and name are kept (no photo, staff flag or cursus data)
        d["people"] = [{"id": p["id"], "login": p["login"], "displayname": p.get("displayname")}
                       for p in await _batched(api, "/v2/users", "filter[id]", met)]
        await step()

    async def projects():
        d["projects"] = [{k: p.get(k) for k in PROJECT_FIELDS} for p in await _batched(api, "/v2/projects", "filter[id]", project_ids(d))]
        await step()

    async def ranks():
        cursus_rows, quest_rows = await asyncio.gather(_batched(api, f"/v2/cursus/{MAIN_CURSUS}/cursus_users", "filter[user_id]", met),
                                                       _batched(api, "/v2/quests_users", "filter[user_id]", met,
                                                                **{"filter[quest_id]": ",".join(map(str, COMMON_CORE_QUESTS))}))
        await step()
        return rank_groups(cursus_rows, quest_rows)

    async def feedbacks():
        (d["corrector_sessions"], d["evaluated_sessions"]), d["feedbacks"] = await asyncio.gather(
            _other_sessions(api, d, datetime.now(timezone.utc)), _feedbacks(api, d))
        await step()

    async def standing_():
        result = await _standing(api, d)
        await step()
        return result

    _, _, _, groups, _, standing = await asyncio.gather(coalition_scores(), people(), projects(), ranks(), feedbacks(), standing_())

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
        "seat_days": SEAT_DAYS,
        "default_period": "student",
        "periods": periods,
        "layout": seat_layout([s["host"] for s in d["locations"]]),
        "connections": links,
        "network": network,
        **standing,
    }


async def _other_sessions(api, d, now) -> tuple[dict, dict]:
    """The other side's login sessions around each evaluation of the last SEAT_DAYS days, to tell their seat: the corrector
    of a received one, the evaluated students of a given one. One request per day with evaluations (up to 100 people);
    only begin, end and host are kept, under the evaluation's id, and the analysis keeps nothing but the seat."""
    since, wanted, days = now - timedelta(days=SEAT_DAYS), [], {}
    for role, key in (("received", "evals_received"), ("given", "evals_given")):
        for e in d[key]:
            begin = ts(e["begin_at"])
            if since <= begin <= now:
                people = [e.get("corrector")] if role == "received" else e.get("correcteds") or []
                people = [p for p in people if isinstance(p, dict) and p.get("id")]
                wanted.append((role, e, people))
                days.setdefault(begin.date(), set()).update(p["id"] for p in people)

    async def day(date, ids):
        # sessions that began from the day before (one can run overnight into the evaluation) to the end of the day
        start = datetime(date.year, date.month, date.day, tzinfo=timezone.utc)
        window = ",".join(t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in (start - timedelta(days=1), start + timedelta(days=1)))
        return await _batched(api, "/v2/locations", "filter[user_id]", ids, **{"range[begin_at]": window})

    found = await asyncio.gather(*(day(date, ids) for date, ids in days.items()))
    by_person = {}
    for rows in found:
        for l in rows:
            by_person.setdefault((l.get("user") or {}).get("id"), {})[l["id"] if "id" in l else id(l)] = \
                {"host": l.get("host"), "begin_at": l.get("begin_at"), "end_at": l.get("end_at")}
    sessions = lambda p: list(by_person.get(p["id"], {}).values())  # noqa: E731
    corrector, evaluated = {}, {}
    for role, e, people in wanted:
        if role == "received":
            corrector[str(e["id"])] = sessions(people[0]) if people else []
        else:
            evaluated[str(e["id"])] = {p.get("login"): sessions(p) for p in people}
    return corrector, evaluated


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
        async def given(login):
            evs = await api.get(f"/v2/users/{ids[login]}/scale_teams/as_corrector", **{"page[size]": 100, "sort": "-begin_at"})
            given_by[login] = [{"correcteds": [{"login": u.get("login")} for u in e["correcteds"] if isinstance(u, dict)]
                                if isinstance(e.get("correcteds"), list) else []} for e in evs or []]
        await asyncio.gather(*(given(c["login"]) for c in top if c["login"] in ids))
    return contact_network(d["user"]["login"], [{"login": c["login"], "group": c["group"]} for c in top], given_by)
