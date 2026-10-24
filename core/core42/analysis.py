"""Turn raw 42 API datasets into one JSON-serialisable report dict."""
import re
from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean, median

from core42.constants import MAIN_CURSUS, PISCINE_CURSUS, TIMEZONE as TZ
from core42.tracks import group_of, track_of, xp_earned

OUTSTANDING = "Outstanding project"
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
FEEDBACK_KINDS = ["nice", "rigorous", "interested", "punctuality"]


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def local(dt):
    return dt.astimezone(TZ) if dt else None


def fmt(dt):
    return local(dt).strftime("%Y-%m-%d %H:%M") if dt else None


def ms(dt):
    return int(dt.timestamp() * 1000) if dt else None


def minutes(a, b):
    return round((b - a).total_seconds() / 60, 1) if a and b else None


def avg(values, nd=1):
    values = [v for v in values if v is not None]
    return round(mean(values), nd) if values else None


def cluster(host):
    return host.split("r")[0] if host and host.startswith("c") and "r" in host else host


def session_host(sessions, start, end, now):
    """Host of the session that overlaps [start, end] the most, or None."""
    best, best_overlap = None, timedelta(0)
    for s in sessions:
        b, e = ts(s["begin_at"]), ts(s["end_at"]) or now
        overlap = min(e, end) - max(b, start)
        if overlap > best_overlap:
            best, best_overlap = s["host"], overlap
    return best


def merge_intervals(intervals):
    """Union of (begin, end) intervals; overlapping sessions on two hosts count once."""
    merged = []
    for b, e in sorted(intervals):
        if merged and b <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([b, e])
    return [tuple(m) for m in merged]


# Arithmetic is done in UTC: subtracting two datetimes that share a ZoneInfo
# uses wall-clock time and gets DST-change days wrong.
def split_by_day(begin, end):
    """Seconds of [begin, end] spent on each local calendar day."""
    out = defaultdict(float)
    cur, end = begin.astimezone(timezone.utc), end.astimezone(timezone.utc)
    while cur < end:
        day = local(cur).date()
        next_midnight = datetime.combine(day + timedelta(days=1), datetime.min.time(), TZ).astimezone(timezone.utc)
        chunk_end = min(next_midnight, end)
        out[day.isoformat()] += (chunk_end - cur).total_seconds()
        cur = chunk_end
    return out


def split_by_hour(begin, end):
    """Seconds of [begin, end] spent in each local (weekday, hour) bucket."""
    out = defaultdict(float)
    cur, end = begin.astimezone(timezone.utc), end.astimezone(timezone.utc)
    while cur < end:
        # Madrid offsets are whole hours, so local and UTC hour boundaries coincide
        chunk_end = min((cur + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0), end)
        lt = local(cur)
        out[(lt.weekday(), lt.hour)] += (chunk_end - cur).total_seconds()
        cur = chunk_end
    return out


def feedback_entry(f):
    """Flatten an API feedback (with optional feedback_details) into one dict."""
    return {
        "by": (f.get("user") or {}).get("login"),
        "comment": f.get("comment"),
        "rating": f.get("rating"),
        "at": fmt(ts(f.get("created_at"))),
        **{d["kind"]: d["rate"] for d in f.get("feedback_details") or []},
    }


def feedback_scores(entries):
    """Average overall rating and per-kind rates over flattened feedback entries."""
    return {"rating": avg([f.get("rating") for f in entries]),
            **{k: avg([f.get(k) for f in entries], 2) for k in FEEDBACK_KINDS}}


def heatmap(evals):
    grid = [[0] * 24 for _ in range(7)]
    for e in evals:
        grid[e["wd"]][e["hour"]] += 1
    return grid


def histogram(values, edges):
    """Counts per [edges[i], edges[i+1]) bin; the last bin is open-ended."""
    counts = [0] * len(edges)
    for v in values:
        if v is not None:
            counts[max(bisect_right(edges, v) - 1, 0)] += 1
    return counts


def month_range(first, last):
    y, m = map(int, first.split("-"))
    out = []
    while f"{y:04d}-{m:02d}" <= last:
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


PERIODS = {"piscine": "Piscine", "student": "Student", "all": "All periods"}


def for_period(d, period):
    """Keep the data of one period: "student" (the 42cursus, from its kickoff), "piscine" (everything else) or "all".

    "student" drops C Piscine projects and quests, plus everything dated before the 42cursus
    began: the piscine's logtime, evaluations, correction points, events and achievements
    (e.g. "Welcome, Cadet!"). "piscine" keeps exactly what "student" drops, so the two add up to "all".
    """
    cursus = next((c for c in d["user"]["cursus_users"] if c["cursus_id"] == MAIN_CURSUS), None)
    if period == "all" or not cursus or not cursus.get("begin_at"):
        return d
    start = ts(cursus["begin_at"])
    projects = {p["project"]["id"] for p in d["projects_users"] if PISCINE_CURSUS in p["cursus_ids"]}
    student = period == "student"

    def keep(is_student):
        return is_student == student

    def after(s):
        return s is not None and ts(s) >= start

    def eval_kept(e):
        return keep(after(e.get("begin_at")) and (e.get("team") or {}).get("project_id") not in projects)

    return {
        **d,
        "user": {**d["user"], "cursus_users": [c for c in d["user"]["cursus_users"]
                                               if keep(c["cursus_id"] != PISCINE_CURSUS)]},
        "projects_users": [p for p in d["projects_users"] if keep(p["project"]["id"] not in projects)],
        "teams": [t for t in d["teams"] if keep(t["project_id"] not in projects)],
        "evals_received": [e for e in d["evals_received"] if eval_kept(e)],
        "evals_given": [e for e in d["evals_given"] if eval_kept(e)],
        "locations": [s for s in d["locations"] if keep(after(s["begin_at"]))],
        **({"locations_stats": {day: v for day, v in d["locations_stats"].items() if keep(day >= start.date().isoformat())}}
           if d.get("locations_stats") is not None else {}),  # older reports have none: keep it absent, not empty
        **({"coalition_scores": [x for x in d["coalition_scores"] if keep(after(x["created_at"]))]}
           if d.get("coalition_scores") is not None else {}),
        "correction_points": [c for c in d["correction_points"] if keep(after(c["created_at"]))],
        "events_users": [e for e in d["events_users"] if keep(after((e.get("event") or {}).get("begin_at")))],
        "quests_users": [q for q in d["quests_users"]
                         if keep((q.get("quest") or {}).get("cursus_id") != PISCINE_CURSUS)],
        **{name: [x for x in d[name] if keep(after(x["created_at"]))]
           for name in ("achievements_users", "titles_users", "expertises_users")},
    }


def official_hours(stats: dict | None) -> float | None:
    """The intra's own total from /locations_stats ("HH:MM:SS.ffffff" per day); None when it was not fetched."""
    if stats is None:
        return None
    total = 0.0
    for v in stats.values():
        h, m, sec = str(v).split(":")
        total += int(h) * 3600 + int(m) * 60 + float(sec)
    return round(total / 3600, 1)


SEAT = re.compile(r"c(\d+)r(\d+)s(\d+)$")


def seat_layout(hosts):
    """Rows and seats per cluster, from every host code seen (c<cluster>r<row>s<seat>)."""
    out = {}
    for h in hosts:
        m = SEAT.match(h or "")
        if m:
            c, r, s = (int(x) for x in m.groups())
            rows, seats = out.get(f"c{c}", (0, 0))
            out[f"c{c}"] = (max(rows, r), max(seats, s))
    return {c: {"rows": r, "seats": s} for c, (r, s) in sorted(out.items(), key=lambda kv: int(kv[0][1:]))}


class Report:
    def __init__(self, d, now=None):
        self.d = d
        self.now = now or datetime.now(timezone.utc)
        self.user = d["user"]
        self.login = self.user["login"]
        self.projects = {p["id"]: p for p in d["projects"]}
        self.people = {p["id"]: p for p in d["people"]}
        self.teams = {t["id"]: t for t in d["teams"]}
        self.my_sessions = sorted(d["locations"], key=lambda s: s["begin_at"])
        self.feedback_details = d.get("feedbacks") or {}

    # ---------- helpers ----------
    def project_name(self, pid):
        p = self.projects.get(pid)
        return p["name"] if p else f"project {pid}"

    def person(self, ref):
        ref = ref or {}
        p = self.people.get(ref.get("id"), {})
        img = (p.get("image") or {}).get("versions") or {}
        return {
            "login": ref.get("login") or p.get("login") or "?",
            "name": p.get("displayname"),
            "staff": bool(p.get("staff?")),
            "image": img.get("small"),
        }

    def my_host(self, start, end):
        return session_host(self.my_sessions, start, end, self.now)

    def feedbacks_of(self, e):
        return self.feedback_details.get(str(e["id"])) or e.get("feedbacks") or []

    def window(self, e):
        begin = ts(e["begin_at"])
        planned = timedelta(seconds=(e.get("scale") or {}).get("duration") or 1800)
        filled = ts(e.get("filled_at"))
        end = filled if filled and filled > begin else begin + planned
        return begin, end, planned

    # ---------- evaluations ----------
    def evaluation(self, e, role):
        begin, end, planned = self.window(e)
        created, filled = ts(e.get("created_at")), ts(e.get("filled_at"))
        flag = (e.get("flag") or {}).get("name")
        team = e.get("team") or {}
        fbs = [feedback_entry(f) for f in self.feedbacks_of(e)]
        if role == "received":  # teammates' feedback on the corrector is about someone else: keep only the user's own
            fbs = [f for f in fbs if f["by"] == self.login]
        scores = feedback_scores(fbs)
        out = {
            "id": e["id"],
            "role": role,
            "project": self.project_name(team.get("project_id")),
            "project_id": team.get("project_id"),
            "slug": (self.projects.get(team.get("project_id")) or {}).get("slug"),
            "team_id": team.get("id"),
            "team": team.get("name"),
            "corrector": self.person(e.get("corrector")),
            "correcteds": [self.person(c) for c in e.get("correcteds") or [] if isinstance(c, dict)],
            "booked": fmt(created),
            "begin": fmt(begin),
            "begin_ms": ms(begin),
            "filled": fmt(filled),
            "filled_ms": ms(filled),
            "duration_min": minutes(begin, filled),
            "planned_min": round(planned.total_seconds() / 60),
            "lead_h": round((begin - created).total_seconds() / 3600, 1) if created else None,
            "weekday": WEEKDAYS[local(begin).weekday()],
            "wd": local(begin).weekday(),
            "hour": local(begin).hour,
            "mark": e.get("final_mark"),
            "flag": flag,
            "outstanding": flag == OUTSTANDING,
            "negative_flag": bool(e.get("flag")) and not e["flag"].get("positive", True),
            "status": "pending" if not filled and begin > self.now else ("done" if filled else "not filled"),
            "truant": (e.get("truant") or {}).get("login"),
            "comment": e.get("comment"),
            "feedback": e.get("feedback"),
            "feedbacks": fbs,
            "fb_rating": scores["rating"],
            "fb_scores": {k: scores[k] for k in FEEDBACK_KINDS},
            "my_host": self.my_host(begin, end),
        }
        if role == "received":
            sessions = self.d["corrector_sessions"].get(str(e["id"])) or []
            out["other_host"] = session_host(sessions, begin, end, self.now)
            out["other_host_checked"] = str(e["id"]) in self.d["corrector_sessions"]
        return out

    # ---------- projects & attempts ----------
    def projects_section(self, evals_received):
        by_team = defaultdict(list)
        for ev in evals_received:
            by_team[ev["team_id"]].append(ev)
        rows = []
        for pu in self.d["projects_users"]:
            pid = pu["project"]["id"]
            proj = self.projects.get(pid, {})
            attempts = []
            for i, t in enumerate(sorted(pu["teams"], key=lambda t: t["created_at"]), 1):
                full = self.teams.get(t["id"], t)
                evs = sorted(by_team.get(t["id"], []), key=lambda e: e["begin_ms"] or 0)
                start = ts(full["created_at"])
                end_ms = ms(ts(full.get("closed_at")) or ts(full.get("locked_at")) or ts(full.get("updated_at")))
                end_ms = max([end_ms, *(e["filled_ms"] for e in evs if e["filled_ms"])])
                attempts.append({
                    "n": i,
                    "team_id": t["id"],
                    "team": full.get("name"),
                    "members": [u["login"] for u in full.get("users", []) if u["login"] != self.login],
                    "status": full.get("status"),
                    "mark": full.get("final_mark"),
                    "validated": full.get("validated?"),
                    "start": fmt(start), "start_ms": ms(start),
                    "locked": fmt(ts(full.get("locked_at"))),
                    "closed": fmt(ts(full.get("closed_at"))),
                    "end_ms": end_ms,
                    "days": round((end_ms - ms(start)) / 86400000, 1),
                    "moulinette": [{"mark": u["final_mark"], "at": fmt(ts(u["created_at"])),
                                    "comment": u.get("comment")} for u in full.get("teams_uploads") or []],
                    "evals": [e["id"] for e in evs],
                    "outstanding": sum(e["outstanding"] for e in evs),
                    "correctors": [e["corrector"]["login"] for e in evs],
                    "evaluations": [{"corrector": e["corrector"]["login"], "mark": e["mark"], "outstanding": e["outstanding"],
                                     "negative": e["negative_flag"], "flag": e["flag"], "begin": e["begin"]} for e in evs],
                })
            all_evals = [e for t in pu["teams"] for e in by_team.get(t["id"], [])]
            first = attempts[0]["start_ms"] if attempts else None
            validated_at = next((a["end_ms"] for a in attempts if a["validated"]), None)
            rows.append({
                "id": pid,
                "name": pu["project"]["name"],
                "slug": pu["project"].get("slug"),
                "track": track_of(pu),
                "group": group_of(pu),
                "xp_base": proj.get("difficulty"),
                "xp_earned": xp_earned(proj.get("difficulty"), pu.get("final_mark"), pu.get("validated?")),
                "exam": bool(proj.get("exam")),
                "xp": proj.get("difficulty"),
                "status": pu["status"],
                "validated": pu.get("validated?"),
                "mark": pu.get("final_mark"),
                "occurrence": pu["occurrence"],
                "attempts": attempts,
                "retries": max(len(attempts) - 1, 0),
                "failed_attempts": sum(1 for a in attempts if a["validated"] is False),
                "evals": len(all_evals),
                "outstanding": sum(e["outstanding"] for e in all_evals),
                "avg_eval_mark": avg([e["mark"] for e in all_evals]),
                "correctors": sorted({e["corrector"]["login"] for e in all_evals}),
                "first_ms": first,
                "registered": fmt(ts(pu["created_at"])),
                "marked": fmt(ts(pu.get("marked_at"))),
                "days_to_validate": round((validated_at - first) / 86400000, 1) if first and validated_at else None,
            })
        rows.sort(key=lambda r: r["first_ms"] or 0)
        return rows

    # ---------- people ----------
    def people_section(self, received, given):
        acc = defaultdict(lambda: {
            "evaluated_me": 0, "evaluated_by_me": 0, "teammate": 0,
            "projects_on_me": Counter(), "marks_to_me": [], "outstanding_to_me": 0,
            "my_rating_of_them": [], "their_rating_of_me": [], "durations": [],
            "hosts": Counter(), "dates": [], "info": None,
        })
        for e in received:
            p = acc[e["corrector"]["login"]]
            p["info"] = e["corrector"]
            p["evaluated_me"] += 1
            p["projects_on_me"][e["project"]] += 1
            p["marks_to_me"].append(e["mark"])
            p["outstanding_to_me"] += e["outstanding"]
            p["my_rating_of_them"].append(e["fb_rating"])
            p["durations"].append(e["duration_min"])
            if e["other_host"]:
                p["hosts"][e["other_host"]] += 1
            p["dates"].append(e["begin_ms"])
        for e in given:
            for c in e["correcteds"]:
                p = acc[c["login"]]
                p["info"] = p["info"] or c
                p["evaluated_by_me"] += 1
                p["their_rating_of_me"] += [f["rating"] for f in e["feedbacks"] if f["by"] == c["login"]]
                p["dates"].append(e["begin_ms"])
        for t in self.d["teams"]:
            for u in t.get("users", []):
                if u["login"] != self.login:
                    acc[u["login"]]["teammate"] += 1
                    acc[u["login"]]["info"] = acc[u["login"]]["info"] or self.person(u)
        rows = []
        for login, p in acc.items():
            dates = [x for x in p["dates"] if x]
            rows.append({
                "login": login,
                **{k: (p["info"] or {}).get(k) for k in ("name", "staff", "image")},
                "evaluated_me": p["evaluated_me"],
                "evaluated_by_me": p["evaluated_by_me"],
                "teammate": p["teammate"],
                "projects_on_me": dict(p["projects_on_me"].most_common()),
                "avg_mark_to_me": avg(p["marks_to_me"]),
                "outstanding_to_me": p["outstanding_to_me"],
                "my_rating_of_them": avg(p["my_rating_of_them"], 2),
                "their_rating_of_me": avg(p["their_rating_of_me"], 2),
                "avg_duration": avg(p["durations"]),
                "hosts": dict(p["hosts"].most_common()),
                "first": fmt(datetime.fromtimestamp(min(dates) / 1000, timezone.utc)) if dates else None,
                "last": fmt(datetime.fromtimestamp(max(dates) / 1000, timezone.utc)) if dates else None,
            })
        rows.sort(key=lambda r: (-r["evaluated_me"], -r["evaluated_by_me"], r["login"]))
        return rows

    # ---------- time & place ----------
    def logtime_section(self, received, given):
        daily = defaultdict(float)
        hourly = defaultdict(float)
        seats = {}
        clusters = Counter()
        intervals = []
        log = []
        for s in self.my_sessions:
            b, e = ts(s["begin_at"]), ts(s["end_at"]) or self.now
            seat = seats.setdefault(s["host"], {"host": s["host"], "seconds": 0, "sessions": 0, "first": b, "last": e})
            seat["seconds"] += (e - b).total_seconds()
            seat["sessions"] += 1
            seat["first"], seat["last"] = min(seat["first"], b), max(seat["last"], e)
            clusters[cluster(s["host"])] += (e - b).total_seconds()
            intervals.append((b, e))
            log.append({"begin": fmt(b), "begin_ms": ms(b), "end": fmt(ts(s["end_at"])), "host": s["host"],
                        "seconds": round((e - b).total_seconds())})
        sessions = []
        for b, e in merge_intervals(intervals):
            for day, sec in split_by_day(b, e).items():
                daily[day] += sec
            for key, sec in split_by_hour(b, e).items():
                hourly[key] += sec
            sessions.append((e - b).total_seconds())
        eval_days = Counter(e["begin"][:10] for e in received + given if e["begin"])
        days = sorted(daily)
        all_days = []
        if days:
            cur, last = datetime.fromisoformat(days[0]).date(), datetime.fromisoformat(days[-1]).date()
            while cur <= last:
                all_days.append(cur.isoformat())
                cur += timedelta(days=1)
        hours_on_eval_days = [daily[d] / 3600 for d in daily if eval_days.get(d)]
        hours_other_days = [daily[d] / 3600 for d in daily if not eval_days.get(d)]
        monthly = defaultdict(float)
        for d, sec in daily.items():
            monthly[d[:7]] += sec
        return {
            "days": all_days,
            "hours": [round(daily.get(d, 0) / 3600, 2) for d in all_days],
            "evals": [eval_days.get(d, 0) for d in all_days],
            "monthly": {m: round(s / 3600, 1) for m, s in sorted(monthly.items())},
            "heat": [[round(hourly.get((w, h), 0) / 3600, 1) for h in range(24)] for w in range(7)],
            "seats": [{**x, "hours": round(x["seconds"] / 3600, 1), "first": fmt(x["first"]), "last": fmt(x["last"])}
                      for x in sorted(seats.values(), key=lambda x: -x["seconds"])],
            "log": sorted(log, key=lambda x: -x["begin_ms"]),
            "clusters": {c: round(s / 3600, 1) for c, s in clusters.most_common()},
            "total_seconds": round(sum(daily.values())),
            "total_hours": round(sum(daily.values()) / 3600, 1),
            "official_hours": official_hours(self.d.get("locations_stats")),
            "days_present": len(daily),
            "first_day": days[0] if days else None,
            "last_day": days[-1] if days else None,
            "sessions": len(self.my_sessions),
            "longest_session_h": round(max(sessions) / 3600, 1) if sessions else 0,
            "avg_day_h_eval_days": avg(hours_on_eval_days),
            "avg_day_h_other_days": avg(hours_other_days),
        }

    def place_section(self, received, given):
        def counter(values):
            return dict(Counter(v or "not logged" for v in values).most_common())
        same_host = sum(1 for e in received if e["other_host"] and e["other_host"] == e["my_host"])
        same_cluster = sum(1 for e in received if e["other_host"] and e["my_host"]
                           and cluster(e["other_host"]) == cluster(e["my_host"]))
        return {
            "received_corrector_cluster": counter(cluster(e["other_host"]) for e in received),
            "received_my_cluster": counter(cluster(e["my_host"]) for e in received),
            "given_my_cluster": counter(cluster(e["my_host"]) for e in given),
            "received_corrector_hosts": dict(Counter(e["other_host"] for e in received if e["other_host"]).most_common()),
            "my_eval_hosts": dict(Counter(e["my_host"] for e in received + given if e["my_host"]).most_common()),
            "same_host": same_host,
            "same_cluster": same_cluster,
            "corrector_located": sum(1 for e in received if e["other_host"]),
            "me_located_received": sum(1 for e in received if e["my_host"]),
            "me_located_given": sum(1 for e in given if e["my_host"]),
        }

    def when_section(self, received, given):
        def done(evs):
            return [e for e in evs if e["status"] == "done"]
        months = sorted({e["begin"][:7] for e in received + given})
        months = month_range(months[0], months[-1]) if months else []

        def monthly(evs):
            out = {"ok": Counter(), "outstanding": Counter(), "negative": Counter()}
            for e in evs:
                key = "outstanding" if e["outstanding"] else "negative" if e["negative_flag"] else "ok"
                out[key][e["begin"][:7]] += 1
            return {k: [v.get(m, 0) for m in months] for k, v in out.items()}

        def cumulative(evs, pred):
            pts, n = [], 0
            for e in sorted(evs, key=lambda e: e["begin_ms"]):
                if pred(e):
                    n += 1
                    pts.append({"x": e["begin_ms"], "y": n})
            return pts

        dur_edges = [0, 15, 30, 45, 60, 75, 90, 120, 180]
        lead_edges = [0, 1, 3, 6, 12, 24, 48, 96]
        return {
            "months": months,
            "received_monthly": monthly(received),
            "given_monthly": monthly(given),
            "heat_received": heatmap(received),
            "heat_given": heatmap(given),
            "cum_received": cumulative(received, lambda e: True),
            "cum_given": cumulative(given, lambda e: True),
            "cum_out_received": cumulative(received, lambda e: e["outstanding"]),
            "cum_out_given": cumulative(given, lambda e: e["outstanding"]),
            "duration_edges": dur_edges,
            "duration_received": histogram([e["duration_min"] for e in done(received)], dur_edges),
            "duration_given": histogram([e["duration_min"] for e in done(given)], dur_edges),
            "lead_edges": lead_edges,
            "lead_received": histogram([e["lead_h"] for e in received], lead_edges),
            "lead_given": histogram([e["lead_h"] for e in given], lead_edges),
            "median_duration_received": median([e["duration_min"] for e in done(received)] or [0]),
            "median_duration_given": median([e["duration_min"] for e in done(given)] or [0]),
            "median_lead_received": median([e["lead_h"] for e in received if e["lead_h"] is not None] or [0]),
        }

    # ---------- other datasets ----------
    def correction_points_section(self):
        rows = sorted(self.d["correction_points"], key=lambda c: c["created_at"])
        reasons = defaultdict(lambda: {"count": 0, "sum": 0})
        for c in rows:
            reasons[c["reason"]]["count"] += 1
            reasons[c["reason"]]["sum"] += c["sum"]
        return {
            "series": [{"x": ms(ts(c["created_at"])), "y": c["total"]} for c in rows],
            "reasons": dict(sorted(reasons.items(), key=lambda kv: -kv[1]["count"])),
            "earned": sum(c["sum"] for c in rows if c["sum"] > 0),
            "spent": -sum(c["sum"] for c in rows if c["sum"] < 0),
            "max": max((c["total"] for c in rows), default=0),
        }

    def extras_section(self):
        u = self.user
        ach = {a["id"]: a for a in u["achievements"] + (self.d.get("achievements") or [])}
        achievements = sorted(({
            "name": ach.get(a["achievement_id"], {}).get("name", f"#{a['achievement_id']}"),
            "description": ach.get(a["achievement_id"], {}).get("description"),
            "tier": ach.get(a["achievement_id"], {}).get("tier"),
            "kind": ach.get(a["achievement_id"], {}).get("kind"),
            "at": fmt(ts(a["created_at"])), "at_ms": ms(ts(a["created_at"])),
        } for a in self.d["achievements_users"]), key=lambda a: a["at_ms"])
        titles = {t["id"]: t["name"] for t in u.get("titles", [])}
        events = sorted(({
            "name": eu["event"]["name"], "kind": eu["event"]["kind"],
            "location": eu["event"].get("location"),
            "begin": fmt(ts(eu["event"]["begin_at"])), "begin_ms": ms(ts(eu["event"]["begin_at"])),
            "hours": round((ts(eu["event"]["end_at"]) - ts(eu["event"]["begin_at"])).total_seconds() / 3600, 1)
            if eu["event"].get("end_at") else None,
        } for eu in self.d["events_users"] if eu.get("event")), key=lambda e: e["begin_ms"])
        cursus = max(u["cursus_users"], key=lambda c: c["level"])
        return {
            "achievements": achievements,
            "titles": [{"name": titles.get(t["title_id"], "?").replace("%login", self.login),
                        "selected": t["selected"], "at": fmt(ts(t["created_at"]))} for t in self.d["titles_users"]],
            "events": events,
            "event_kinds": dict(Counter(e["kind"] for e in events).most_common()),
            "quests": sorted(({"name": q["quest"]["name"], "description": q["quest"].get("description"),
                               "validated": fmt(ts(q.get("validated_at"))), "created": fmt(ts(q["created_at"]))}
                              # the API can list the same quest twice; keep one per quest
                              for q in {q.get("quest_id") or q["quest"].get("name"): q for q in self.d["quests_users"] if q.get("quest")}.values()),
                             key=lambda q: q["created"] or ""),
            "expertises": [{"name": x["expertise"]["name"], "value": x["value"], "interested": x["interested"]}
                           for x in self.d["expertises_users"] if x.get("expertise")],
            "skills": [{"name": s["name"], "level": s["level"]} for s in cursus["skills"]],
            "cursus": [{"name": c["cursus"]["name"], "level": c["level"], "grade": c["grade"],
                        "begin": fmt(ts(c["begin_at"])), "blackholed": fmt(ts(c.get("blackholed_at")))}
                       for c in u["cursus_users"]],
        }

    def profile(self):
        u = self.user
        coal = (self.d["coalitions"] or [None])[0]
        cu = (self.d["coalitions_users"] or [None])[0]
        return {
            "login": u["login"], "name": u["displayname"], "email": u["email"],
            "image": ((u.get("image") or {}).get("versions") or {}).get("medium"),
            "campus": [c["name"] for c in u["campus"]],
            "location": u.get("location"), "wallet": u["wallet"], "correction_point": u["correction_point"],
            "groups": [g["name"] for g in self.d.get("groups") or [] if g.get("name")],
            "coalition": {"name": coal["name"], "color": coal["color"], "score": cu["score"], "rank": cu["rank"],
                          "master": coal.get("user_id") == u["id"]}
            if coal and cu else None,
        }

    def summary(self, received, given, projects, people, logtime):
        done_r = [e for e in received if e["status"] == "done"]
        done_g = [e for e in given if e["status"] == "done"]
        my_scores = feedback_scores([f for e in received for f in e["feedbacks"] if f["by"] == self.login])
        their_scores = feedback_scores([f for e in given for f in e["feedbacks"]])
        return {
            "projects": len(projects),
            "validated": sum(1 for p in projects if p["validated"]),
            "attempts": sum(len(p["attempts"]) for p in projects),
            "retries": sum(p["retries"] for p in projects),
            "projects_with_retries": sum(1 for p in projects if p["retries"]),
            "received": len(received),
            "received_outstanding": sum(e["outstanding"] for e in received),
            "received_negative": sum(e["negative_flag"] for e in received),
            "received_avg_mark": avg([e["mark"] for e in done_r]),
            "given": len(given),
            "given_outstanding": sum(e["outstanding"] for e in given),
            "given_negative": sum(e["negative_flag"] for e in given),
            "given_avg_mark": avg([e["mark"] for e in done_g]),
            "unique_correctors": sum(1 for p in people if p["evaluated_me"]),
            "unique_evaluated": sum(1 for p in people if p["evaluated_by_me"]),
            "mutual": sum(1 for p in people if p["evaluated_me"] and p["evaluated_by_me"]),
            "truant_me": sum(1 for e in received + given if e["truant"] == self.login),
            "truant_others": sum(1 for e in received + given if e["truant"] and e["truant"] != self.login),
            "my_rating_of_correctors": my_scores,
            "ratings_i_received": their_scores,
            "logtime_hours": logtime["total_hours"],
        }

    def build(self):
        received = sorted((self.evaluation(e, "received") for e in self.d["evals_received"] if e.get("begin_at")),
                          key=lambda e: e["begin_ms"])
        given = sorted((self.evaluation(e, "given") for e in self.d["evals_given"] if e.get("begin_at")),
                       key=lambda e: e["begin_ms"])
        projects = self.projects_section(received)
        people = self.people_section(received, given)
        logtime = self.logtime_section(received, given)
        return {
            "generated": fmt(self.now),
            "profile": self.profile(),
            "summary": self.summary(received, given, projects, people, logtime),
            "projects": projects,
            "received": received,
            "given": given,
            "people": people,
            "when": self.when_section(received, given),
            "place": self.place_section(received, given),
            "logtime": logtime,
            "correction_points": self.correction_points_section(),
            "extras": self.extras_section(),
        }


def analyze(d, period="student", now=None):
    from core42.insights import add_insights, bonus_window, coalition_points, skill_sets  # insights builds on this module's helpers
    data = for_period(d, period)
    report = Report(data, now)
    out = add_insights({**report.build(), "period": {"key": period, "label": PERIODS[period]}}, data, report.now)
    out["extras"]["skills_by_cursus"] = skill_sets(d["user"]["cursus_users"])  # skills are not split by period
    if d.get("coalition_scores") is not None:
        out["coalition_points"] = coalition_points(data["coalition_scores"])
        out["logtime_bonus"] = bonus_window(d["locations"], d["coalition_scores"], report.now)  # about now: never split
    return out
