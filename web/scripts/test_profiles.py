"""Synthetic test profiles for `make dev`: a student who just started, one halfway through the Common Core and an
alumni. Everything is invented from a fixed seed (people are peerNN, ids from 990001, hosts are synthetic) and runs
through the same extraction as a real profile, against a fake API. Nothing here reaches the 42 API, and the profiles
are only served in dev mode (DEV_REPORT, refused outside https://localhost).

    python scripts/test_profiles.py        # writes preview/test-<key>.json next to the saved report
"""
import asyncio
import copy
import json
import random
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
FIXTURE = json.loads((ROOT / "tests" / "fixtures" / "42.json").read_text())  # anonymized: only its record shapes are used
OUT = ROOT / "preview"

PROFILES = {  # key: login, name, months in the 42cursus, projects done, level, grade, campus presence (0-1)
    "new": ("tnova", "Nova Tester", 2, 3, 1.84, None, .75),
    "mid": ("tmidway", "Mika Midway", 14, 24, 8.41, None, .55),
    "alumni": ("talumni", "Alba Alumni", 42, 41, 21.37, "Alumni", .35),
}
UIDS = {"new": 990001, "mid": 990002, "alumni": 990003}

# (slug, name, difficulty, team size, exam), Common Core in order, then some Outer Core
CURRICULUM = [
    ("libft", "Libft", 462, 1, False), ("get_next_line", "get_next_line", 882, 1, False), ("ft_printf", "ft_printf", 882, 1, False),
    ("born2beroot", "Born2beroot", 577, 1, False), ("push_swap", "push_swap", 1855, 1, False), ("pipex", "pipex", 1142, 1, False),
    ("so_long", "so_long", 1000, 1, False), ("exam-rank-02", "Exam Rank 02", 0, 1, True), ("philosophers", "Philosophers", 3360, 1, False),
    ("minishell", "minishell", 2814, 2, False), ("exam-rank-03", "Exam Rank 03", 0, 1, True), ("cub3d", "cub3d", 5775, 2, False),
    ("netpractice", "NetPractice", 3160, 1, False), ("cpp-module-00", "CPP Module 00", 0, 1, False), ("cpp-module-01", "CPP Module 01", 0, 1, False),
    ("cpp-module-02", "CPP Module 02", 0, 1, False), ("cpp-module-03", "CPP Module 03", 0, 1, False), ("cpp-module-04", "CPP Module 04", 0, 1, False),
    ("exam-rank-04", "Exam Rank 04", 0, 1, True), ("cpp-module-05", "CPP Module 05", 0, 1, False), ("cpp-module-06", "CPP Module 06", 0, 1, False),
    ("cpp-module-07", "CPP Module 07", 0, 1, False), ("cpp-module-08", "CPP Module 08", 0, 1, False), ("cpp-module-09", "CPP Module 09", 10042, 1, False),
    ("inception", "Inception", 10042, 1, False), ("webserv", "webserv", 21630, 3, False), ("exam-rank-05", "Exam Rank 05", 0, 1, True),
    ("ft_transcendence", "ft_transcendence", 24360, 4, False), ("exam-rank-06", "Exam Rank 06", 0, 1, True),
    ("red-tetris", "red-tetris", 15750, 2, False), ("scop", "scop", 9450, 1, False), ("swifty-companion", "swifty-companion", 4200, 1, False),
    ("inception-of-things", "Inception-of-Things", 25450, 1, False), ("dslr", "DSLR", 4200, 2, False), ("matcha", "matcha", 9450, 2, False),
    ("ft_ping", "ft_ping", 4200, 1, False), ("libasm", "libasm", 966, 1, False), ("computorv1", "computorv1", 1050, 1, False),
    ("ready-set-boole", "ready set boole", 8000, 1, False), ("camagru", "camagru", 4200, 1, False), ("ft_linear_regression", "ft_linear_regression", 4200, 1, False),
    ("taskmaster", "taskmaster", 9450, 2, False),
]
SKILLS = ["Algorithms & AI", "Rigor", "Unix", "Imperative programming", "Adaptation & creativity", "Group & interpersonal",
          "Network & system administration", "Object-oriented programming", "Web", "Graphics", "Security", "DB & Data"]
COMMENTS = ["Clear explanation, tests passed, good discussion of the edge cases.", "Solid work; we went through the code together.",
            "Works as expected. A couple of leaks found and fixed during the evaluation.", "Nice structure, well defended.",
            "Missing error handling on bad input, so the project fails this time."]
ISO = "%Y-%m-%dT%H:%M:%S.000Z"


def iso(dt):
    return dt.astimezone(timezone.utc).strftime(ISO)


def build(key, now, rng):
    login, name, months, done, level, grade, presence = PROFILES[key]
    uid = UIDS[key]
    first, last = name.split(" ", 1)
    kickoff = (now - timedelta(days=int(months * 30.4))).replace(hour=7, minute=42, second=0, microsecond=0)
    piscine = kickoff - timedelta(days=75)
    me = {"id": uid, "login": login, "url": f"https://api.intra.42.fr/v2/users/{login}"}
    peers = [{"id": 990100 + i, "login": f"peer{i:02d}", "displayname": f"Peer {i:02d}"} for i in range(1, 46)]
    pid = iter(range(991001, 999999))

    user = copy.deepcopy(FIXTURE["user"])
    user.update({"id": uid, "login": login, "displayname": name, "first_name": first, "last_name": last, "usual_full_name": name,
                 "usual_first_name": first, "email": f"{login}@example.invalid", "url": me["url"], "image": {"link": None, "versions": {}},
                 "wallet": rng.randint(40, 900), "correction_point": rng.randint(2, 14), "location": None,
                 "created_at": iso(piscine), "alumni?": grade == "Alumni", "alumnized_at": iso(now - timedelta(days=60)) if grade == "Alumni" else None,
                 "pool_month": piscine.strftime("%B").lower(), "pool_year": str(piscine.year), "projects_users": [], "titles": [], "titles_users": []})
    user["campus"] = [c for c in user["campus"] if c["id"] == 22]
    user["campus_users"] = [{"id": next(pid), "user_id": uid, "campus_id": 22, "is_primary": True, "created_at": iso(piscine), "updated_at": iso(piscine)}]
    weights = [rng.random() for _ in SKILLS]
    skills = [{"id": i + 1, "name": s, "level": round(level * (.35 + .65 * w), 2)} for i, (s, w) in enumerate(zip(SKILLS, weights))]
    blackhole = None if grade else iso(now + timedelta(days=rng.randint(45, 140)))
    user["cursus_users"] = [
        {"id": next(pid), "cursus_id": 9, "grade": "Pisciner", "level": round(rng.uniform(3.2, 6.1), 2), "begin_at": iso(piscine),
         "end_at": iso(piscine + timedelta(days=26)), "blackholed_at": None, "skills": [], "cursus": {"id": 9, "name": "C Piscine", "slug": "c-piscine"}},
        {"id": next(pid), "cursus_id": 21, "grade": grade, "level": level, "begin_at": iso(kickoff), "end_at": None, "blackholed_at": blackhole,
         "skills": skills, "cursus": {"id": 21, "name": "42cursus", "slug": "42cursus"}}]

    team_t, eval_t = FIXTURE["teams"][0], FIXTURE["evals_received"][0]
    projects, projects_users, teams, received, given, feedbacks, scores = [], [], [], [], [], [], []

    def eval_record(when, project_id, team, corrector, correcteds, mark, outstanding):
        e = copy.deepcopy(eval_t)
        e.update({"id": next(pid), "begin_at": iso(when), "created_at": iso(when - timedelta(hours=rng.randint(3, 40))),
                  "filled_at": iso(when + timedelta(minutes=rng.randint(15, 70))), "updated_at": iso(when + timedelta(hours=2)),
                  "final_mark": mark, "comment": rng.choice(COMMENTS), "feedback": rng.choice(COMMENTS),
                  "flag": {"id": 9 if outstanding else 1, "name": "Outstanding project" if outstanding else "Ok", "positive": True},
                  "corrector": corrector, "correcteds": correcteds, "truant": {}, "feedbacks": []})
        e["team"] = {**{k: team[k] for k in ("id", "name", "url", "final_mark", "project_id", "created_at", "updated_at", "status")}, "users": team["users"]}
        return e

    cursor = kickoff + timedelta(days=2)
    plan = CURRICULUM[:done]
    for n, (slug, pname, diff, size, exam) in enumerate(plan):
        project_id = 991500 + n
        projects.append({"id": project_id, "name": pname, "slug": slug, "difficulty": diff, "exam": exam, "parent": None})
        in_progress = key != "alumni" and n == len(plan) - 1
        tries = 1 if exam and rng.random() < .6 else 1 + (rng.random() < .35) + (rng.random() < .12)
        pu_id, pu_teams, mark = next(pid), [], None
        for attempt in range(tries):
            start = cursor
            length = timedelta(days=(1 if exam else max(2, int(rng.gauss(4 + diff / 900, 3)))))
            end = start + length
            last_try = attempt == tries - 1
            if in_progress and last_try:
                end = None
            passed = last_try and not (in_progress and last_try)
            mark = None if end is None else (rng.choice([100, 100, 100, 110, 115, 125]) if passed else rng.choice([0, 0, 42, 60, 75]))
            mates = rng.sample(peers, size - 1)
            team = copy.deepcopy(team_t)
            team.update({"id": next(pid), "name": f"Team {n:02d}-{attempt}", "project_id": project_id, "created_at": iso(start),
                         "updated_at": iso(end or now), "final_mark": mark, "status": "finished" if end else "in_progress",
                         "validated?": bool(mark and mark >= 80) if end else None, "closed?": bool(end), "locked?": True,
                         "locked_at": iso(start + timedelta(hours=1)), "closed_at": iso(end) if end else None, "scale_teams": [], "teams_uploads": [],
                         "users": [{"id": u["id"], "login": u["login"], "url": f"https://api.intra.42.fr/v2/users/{u['login']}", "leader": u is me,
                                    "occurrence": attempt, "validated": True, "projects_user_id": pu_id} for u in [me, *mates]]})
            teams.append(team)
            pu_teams.append(team)
            if end and not exam:
                for _ in range(3 if diff >= 1000 else 2):
                    corrector = rng.choice([p for p in peers if p not in mates])
                    when = end + timedelta(hours=rng.randint(2, 70))
                    out = bool(mark and mark >= 100 and rng.random() < .28)
                    e = eval_record(when, project_id, team, {k: corrector[k] for k in ("id", "login")},
                                    [{"id": u["id"], "login": u["login"]} for u in [me, *mates]], mark, out)
                    fb = {"id": next(pid), "user": {"login": login, "id": uid}, "feedbackable_type": "ScaleTeam", "feedbackable_id": e["id"],
                          "comment": rng.choice(COMMENTS[:4]), "rating": rng.choice([4, 5, 5]), "created_at": iso(when + timedelta(hours=1))}
                    e["feedbacks"] = [fb]
                    feedbacks.append({**fb, "feedback_details": [{"kind": k, "rate": rng.randint(3, 4)} for k in ("nice", "rigorous", "interested", "punctuality")]})
                    received.append(e)
            if end and exam and mark:
                scores.append(("Team", 4, 2000, end, team["id"]))
            cursor = (end or now) + timedelta(days=rng.randint(1, 9))
        if mark and mark >= 80 and diff:
            scores.append(("ProjectsUser", 3, int(diff * mark / 100 / 4), end, pu_id))
        projects_users.append({"id": pu_id, "occurrence": tries - 1, "final_mark": mark, "status": "in_progress" if in_progress else "finished",
                               "validated?": None if in_progress else bool(mark and mark >= 80), "current_team_id": pu_teams[-1]["id"],
                               "project": {"id": project_id, "name": pname, "slug": slug, "parent_id": None}, "cursus_ids": [21],
                               "marked_at": None if in_progress else iso(end), "marked": not in_progress, "retriable_at": None,
                               "created_at": pu_teams[0]["created_at"], "updated_at": iso(end or now), "teams": pu_teams})

    # evaluations given: across the whole cursus, on peers' teams of the projects already reached
    span = (min(cursor, now) - kickoff).total_seconds()
    for _ in range(int(len(received) * rng.uniform(1.2, 1.7))):
        when = kickoff + timedelta(seconds=rng.uniform(.05, 1) * span)
        p = rng.choice(projects[:max(1, sum(1 for t in teams if datetime.strptime(t["created_at"], ISO).replace(tzinfo=timezone.utc) <= when))])
        if p["exam"]:
            continue
        mates = rng.sample(peers, rng.choice([1, 1, 2]))
        mark = rng.choice([0, 80, 100, 100, 110, 125])
        team = copy.deepcopy(team_t)
        team.update({"id": next(pid), "name": "Team", "project_id": p["id"], "final_mark": mark, "status": "finished",
                     "users": [{"id": m["id"], "login": m["login"], "leader": i == 0, "occurrence": 0, "validated": True} for i, m in enumerate(mates)]})
        e = eval_record(when, p["id"], team, {"id": uid, "login": login}, [{"id": m["id"], "login": m["login"]} for m in mates], mark,
                        mark >= 110 and rng.random() < .3)
        e["feedbacks"] = [{"id": next(pid), "user": {"login": mates[0]["login"], "id": mates[0]["id"]}, "feedbackable_type": "ScaleTeam",
                           "feedbackable_id": e["id"], "comment": "Thanks, clear and fair.", "rating": rng.choice([4, 5, 5]), "created_at": iso(when)}]
        given.append(e)
        scores.append(("ScaleTeam", 1, 250, when, e["id"]))

    # sessions on campus: the piscine month every day, then by presence; an alumni comes by less and less
    locations, day, last_day = [], piscine, now - timedelta(hours=3)
    while day < last_day:
        p = .92 if day < piscine + timedelta(days=26) else presence * (.4 if grade and day > now - timedelta(days=240) else 1)
        if piscine + timedelta(days=26) <= day < kickoff:
            p = .05
        if rng.random() < p * (.55 if day.weekday() >= 5 else 1):
            begin = day.replace(hour=rng.choice([8, 9, 10, 11, 14, 16]), minute=rng.randint(0, 59))
            end = min(begin + timedelta(minutes=rng.randint(60, 600)), last_day)
            if end > begin:
                host = f"c{rng.randint(1, 3)}r{rng.randint(1, 14)}s{rng.randint(1, 6)}"
                locations.append({"id": next(pid), "begin_at": iso(begin), "end_at": iso(end), "primary": True, "host": host, "campus_id": 22,
                                  "user": {"id": uid, "login": login}})
        day += timedelta(days=1)
    if key != "alumni":  # logged in right now
        begin = now - timedelta(hours=2, minutes=17)
        locations.append({"id": next(pid), "begin_at": iso(begin), "end_at": None, "primary": True, "host": "c2r7s3", "campus_id": 22,
                          "user": {"id": uid, "login": login}})
        user["location"] = "c2r7s3"
    stats = {}
    for loc in locations:
        b = datetime.strptime(loc["begin_at"], ISO)
        e = datetime.strptime(loc["end_at"], ISO) if loc["end_at"] else now.replace(tzinfo=None)
        stats[b.strftime("%Y-%m-%d")] = stats.get(b.strftime("%Y-%m-%d"), 0) + (e - b).total_seconds()
    locations_stats = {k: f"{int(v // 3600):02d}:{int(v % 3600 // 60):02d}:00.000000" for k, v in sorted(stats.items())}

    # logtime bonuses: the weeks over 50 / 80 h, as the intra gives them (inferred rule)
    week = kickoff
    while week < now:
        h = sum((min(datetime.strptime(l["end_at"], ISO).replace(tzinfo=timezone.utc) if l["end_at"] else now, week + timedelta(days=7))
                 - max(datetime.strptime(l["begin_at"], ISO).replace(tzinfo=timezone.utc), week)).total_seconds()
                for l in locations if l["begin_at"] < iso(week + timedelta(days=7)) and (l["end_at"] or iso(now)) > iso(week)) / 3600
        if h >= 50:
            scores.append(("Location", 7, 500, week + timedelta(days=6, hours=20), next(pid)))
        if h >= 80:
            scores.append(("Location", 20, 1000, week + timedelta(days=6, hours=21), next(pid)))
        week += timedelta(days=7)

    coalition = copy.deepcopy(FIXTURE["coalitions"][0])
    cu = {**copy.deepcopy(FIXTURE["coalitions_users"][0]), "id": 990900 + uid % 100, "user_id": uid, "score": rng.randint(300, 9000), "rank": rng.randint(2, 60)}
    coalition_scores = [{"id": next(pid), "coalition_id": coalition["id"], "scoreable_id": sid, "scoreable_type": kind,
                         "coalitions_user_id": cu["id"], "calculation_id": calc, "value": value, "reason": "", "created_at": iso(when),
                         "updated_at": iso(when)} for kind, calc, value, when, sid in scores if when <= now]
    correction_points, total = [], 5
    for kind, sign, when in sorted([("given", 1, datetime.strptime(e["begin_at"], ISO)) for e in given]
                                   + [("received", -1, datetime.strptime(e["begin_at"], ISO)) for e in received], key=lambda x: x[2]):
        total = max(0, total + sign)
        correction_points.append({"id": next(pid), "scale_team_id": None, "reason": f"Earning after defense" if sign > 0 else "Defense plannification",
                                  "sum": sign, "total": total, "created_at": iso(when), "updated_at": iso(when)})
    user["correction_point"] = total

    achievements_users = [{"id": next(pid), "achievement_id": a["id"], "user_id": uid, "login": login, "nbr_of_success": None, "url": me["url"],
                           "created_at": iso(kickoff + timedelta(days=rng.randint(3, max(4, int(span / 86400))))), "updated_at": iso(now)}
                          for a in FIXTURE["achievements"]]
    events = []
    for e in FIXTURE["events_users"]:
        ev = copy.deepcopy(e)
        when = kickoff + timedelta(days=rng.randint(5, max(6, int(span / 86400))))
        ev.update({"id": next(pid), "user_id": uid, "user": {"id": uid, "login": login}})
        ev["event"].update({"begin_at": iso(when), "end_at": iso(when + timedelta(hours=2)), "created_at": iso(when - timedelta(days=9))})
        events.append(ev)
    # Common Core ranks: a rank's quest is validated once all its projects are (the rank shown follows these)
    from core42.tracks import RANKS
    validated = {pu["project"]["slug"]: pu["marked_at"] for pu in projects_users if pu["validated?"]}
    quests, quest_t = [], FIXTURE["quests_users"][0]
    for rank in sorted({RANKS[slug] for slug, *_ in CURRICULUM if slug in RANKS}):
        slugs = [slug for slug, *_ in CURRICULUM if RANKS.get(slug) == rank]
        if all(slug in validated for slug in slugs):
            when = max(validated[slug] for slug in slugs)
            q = copy.deepcopy(quest_t)
            q.update({"id": next(pid), "validated_at": when, "created_at": when, "updated_at": when, "end_at": None,
                      "user": {"id": uid, "login": login}})
            q["quest"] = {**q["quest"], "id": 990700 + int(rank[-2:]), "name": f"Common Core Rank {rank[-2:]}", "slug": f"common-core-rank-{rank[-2:]}",
                          "cursus_id": 21}
            quests.append(q)
    met = {p["login"] for e in received + given for p in [e["corrector"], *e["correcteds"]]} | {u["login"] for t in teams for u in t["users"]}
    people = [{"id": p["id"], "login": p["login"], "displayname": p["displayname"], "image": {"versions": {}}, "staff?": False} for p in peers if p["login"] in met]
    ranks = [None, None, "Transcender", "Alumni"]
    return {
        "user": user, "projects_users": projects_users, "teams": teams, "evals_received": received, "evals_given": given,
        "locations": sorted(locations, key=lambda l: l["begin_at"], reverse=True), "correction_points": correction_points,
        "events_users": events, "coalitions": [coalition], "coalitions_users": [cu], "quests_users": quests, "titles_users": [],
        "expertises_users": [], "achievements_users": achievements_users, "achievements": FIXTURE["achievements"], "projects": projects,
        "people": people, "quests_batch": [], "coalition_scores": coalition_scores, "feedbacks_api": feedbacks,
        "cursus_users_batch": [{"user": {"id": p["id"], "login": p["login"]}, "cursus_id": 21, "grade": rng.choice(ranks),
                                "level": round(rng.uniform(1, 19), 2)} for p in people],
        "promo": [{"level": round(max(0, rng.gauss(level * .85, 2.6)), 2)} for _ in range(rng.randint(260, 430))],
        "blocs": [{"coalitions": [{"id": coalition["id"], "name": coalition["name"], "color": coalition["color"], "score": rng.randint(60000, 95000)},
                                  {"id": 990801, "name": "Coalition B", "color": "#3E7BC8", "score": rng.randint(60000, 95000)},
                                  {"id": 990802, "name": "Coalition C", "color": "#5BA35B", "score": rng.randint(60000, 95000)},
                                  {"id": 990803, "name": "Coalition D", "color": "#B5413C", "score": rng.randint(60000, 95000)}]}],
        "contact_evals": {p["id"]: [{"correcteds": [{"login": rng.choice(people)["login"]}]} for _ in range(rng.randint(0, 4))] for p in people},
        "locations_stats": locations_stats, "groups": [],
    }


class FakeApi:
    """Answers the extraction's requests from one synthetic profile."""

    def __init__(self, d):
        self.d, self.limiter, self.requests = d, None, 0
        self.uid = d["user"]["id"]

    def _answer(self, path, params):
        d, uid = self.d, self.uid
        lists = {"scale_teams/as_corrected": "evals_received", "scale_teams/as_corrector": "evals_given", "correction_point_historics": "correction_points"}
        if path == f"/v2/users/{uid}":
            return d["user"]
        if path == f"/v2/users/{uid}/coalitions":
            return d["coalitions"]
        if m := re.match(rf"^/v2/users/{uid}/(.+)$", path):
            return d[lists.get(m.group(1), m.group(1))]
        if m := re.match(r"^/v2/users/(\d+)/scale_teams/as_corrector$", path):
            return d["contact_evals"].get(int(m.group(1)), [])
        if path == "/v2/achievements_users":
            return d["achievements_users"]
        if path == "/v2/achievements":
            ids = {int(x) for x in params["filter[id]"].split(",")}
            return [a for a in d["achievements"] if a["id"] in ids]
        if m := re.match(r"^/v2/achievements/(\d+)$", path):
            return next(a for a in d["achievements"] if a["id"] == int(m.group(1)))
        if path == "/v2/users":
            ids = {int(x) for x in params["filter[id]"].split(",")}
            return [p for p in d["people"] if p["id"] in ids]
        if path == "/v2/projects":
            return d["projects"]
        if path == "/v2/cursus/21/cursus_users":
            return d["promo"] if "range[begin_at]" in params else d["cursus_users_batch"]
        if path == "/v2/quests_users":
            return d["quests_batch"]
        if path == "/v2/feedbacks":
            ids = {int(x) for x in params["filter[feedbackable_id]"].split(",")}
            return [f for f in d["feedbacks_api"] if f["feedbackable_id"] in ids]
        if path == "/v2/blocs":
            return d["blocs"]
        if re.match(r"^/v2/coalitions_users/\d+/scores$", path):
            return d["coalition_scores"]
        if path == "/v2/locations":  # the other side's seat: a peer is at the same computer all that day, one in five not logged in
            day = datetime.strptime(params["range[begin_at]"].split(",")[0], "%Y-%m-%dT%H:%M:%SZ") + timedelta(days=1)
            return [{"id": i * 1000 + day.toordinal() % 1000, "user": {"id": i}, "host": f"c{1 + i % 3}r{1 + i % 14}s{1 + i % 6}",
                     "begin_at": iso(day + timedelta(hours=6)), "end_at": iso(day + timedelta(hours=23))}
                    for i in map(int, params["filter[user_id]"].split(",")) if i % 5]
        raise LookupError(path)

    async def get(self, path, **params):
        self.requests += 1
        return self._answer(path, params)

    get_all = get


async def main():
    from app.extract import extract
    now = datetime.now(timezone.utc)
    OUT.mkdir(exist_ok=True)

    async def progress(_):
        return None

    for n, key in enumerate(PROFILES):
        data = await extract(FakeApi(build(key, now, random.Random(4200 + n))), UIDS[key], progress)
        data["test_profile"] = UIDS[key]  # never a real student: dev mode signs in as it under this id
        (OUT / f"test-{key}.json").write_text(json.dumps(data, ensure_ascii=False))
        print(f"preview/test-{key}.json · {PROFILES[key][0]}")


if __name__ == "__main__":
    asyncio.run(main())
