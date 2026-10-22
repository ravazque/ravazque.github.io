import unittest
from datetime import datetime, timezone

from core42.analysis import (Report, cluster, feedback_entry, feedback_scores, histogram,
                             for_period, merge_intervals, seat_layout, session_host, split_by_day, split_by_hour, ts)

NOW = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)


def utc(s):
    return ts(s)


class Helpers(unittest.TestCase):
    def test_merge_intervals_counts_overlap_once(self):
        a = (utc("2026-10-07T08:00:00Z"), utc("2026-10-07T12:00:00Z"))
        b = (utc("2026-10-07T11:00:00Z"), utc("2026-10-07T14:00:00Z"))
        c = (utc("2026-10-07T20:00:00Z"), utc("2026-10-07T21:00:00Z"))
        self.assertEqual(merge_intervals([b, c, a]), [(a[0], b[1]), c])

    def test_split_by_day_uses_madrid_midnight(self):
        # 21:30Z-23:30Z on Oct 7 is 23:30-01:30 in Madrid (UTC+2)
        out = split_by_day(utc("2026-10-07T21:30:00Z"), utc("2026-10-07T23:30:00Z"))
        self.assertEqual(dict(out), {"2026-10-07": 1800.0, "2026-10-08": 5400.0})

    def test_split_by_day_across_dst_change(self):
        # Madrid leaves DST on 2026-10-25 at 03:00 local: that day lasts 25h
        out = split_by_day(utc("2026-10-24T22:00:00Z"), utc("2026-10-25T23:00:00Z"))
        self.assertEqual(out["2026-10-25"], 25 * 3600)

    def test_split_by_hour_buckets(self):
        out = split_by_hour(utc("2026-10-07T08:30:00Z"), utc("2026-10-07T09:15:00Z"))
        # Wednesday (2), 10:30-11:15 local
        self.assertEqual(dict(out), {(2, 10): 1800.0, (2, 11): 900.0})

    def test_session_host_picks_largest_overlap(self):
        sessions = [
            {"host": "c1r1s1", "begin_at": "2026-10-07T09:00:00Z", "end_at": "2026-10-07T10:10:00Z"},
            {"host": "c2r2s2", "begin_at": "2026-10-07T10:05:00Z", "end_at": None},
        ]
        start, end = utc("2026-10-07T10:00:00Z"), utc("2026-10-07T10:30:00Z")
        self.assertEqual(session_host(sessions, start, end, NOW), "c2r2s2")
        self.assertIsNone(session_host(sessions, utc("2026-10-06T10:00:00Z"), utc("2026-10-06T11:00:00Z"), NOW))

    def test_histogram_open_last_bin(self):
        self.assertEqual(histogram([0, 14.9, 15, 200, None, -3], [0, 15, 30]), [3, 1, 1])

    def test_feedback_scores(self):
        fbs = [{"rating": 5, "feedback_details": [{"kind": "nice", "rate": 4}, {"kind": "rigorous", "rate": 3}]},
               {"rating": 4, "feedback_details": [{"kind": "nice", "rate": 2}]}]
        s = feedback_scores([feedback_entry(f) for f in fbs])
        self.assertEqual((s["rating"], s["nice"], s["rigorous"], s["punctuality"]), (4.5, 3, 3, None))

    def test_cluster(self):
        self.assertEqual(cluster("c3r10s5"), "c3")
        self.assertIsNone(cluster(None))


def scale_team(id_, corrector, correcteds, begin, filled, mark, flag, team_id, feedbacks=()):
    return {
        "id": id_, "created_at": "2026-09-01T10:00:00Z", "begin_at": begin, "filled_at": filled,
        "final_mark": mark, "flag": {"name": flag, "positive": flag != "Leaks"},
        "corrector": {"id": corrector[0], "login": corrector[1]},
        "correcteds": [{"id": i, "login": l} for i, l in correcteds],
        "truant": {}, "comment": "c", "feedback": "f", "scale": {"duration": 1800},
        "team": {"id": team_id, "name": "t", "project_id": 1}, "feedbacks": list(feedbacks),
    }


def dataset():
    me = (1, "me")
    team1 = {"id": 10, "name": "t1", "project_id": 1, "created_at": "2026-09-01T10:00:00Z",
             "closed_at": "2026-09-02T10:00:00Z", "locked_at": None, "updated_at": "2026-09-02T10:00:00Z",
             "final_mark": 0, "validated?": False, "status": "finished",
             "users": [{"id": 1, "login": "me"}], "teams_uploads": []}
    team2 = {**team1, "id": 11, "created_at": "2026-09-10T10:00:00Z", "closed_at": "2026-09-11T10:00:00Z",
             "final_mark": 125, "validated?": True, "users": [{"id": 1, "login": "me"}, {"id": 4, "login": "mate"}],
             "teams_uploads": [{"final_mark": 100, "created_at": "2026-09-11T09:00:00Z", "comment": "ok"}]}
    received = [
        scale_team(100, (2, "alice"), [me], "2026-09-02T08:00:00Z", "2026-09-02T08:40:00Z", 0, "Ok", 10),
        scale_team(101, (2, "alice"), [me, (4, "mate")], "2026-09-11T08:00:00Z", "2026-09-11T08:20:00Z", 125,
                   "Outstanding project", 11,
                   feedbacks=[{"user": {"login": "me"}, "rating": 5, "created_at": "2026-09-11T09:00:00Z"},
                              {"user": {"login": "mate"}, "rating": 1, "created_at": "2026-09-11T09:00:00Z"}]),
    ]
    given = [scale_team(200, me, [(2, "alice")], "2026-09-05T08:00:00Z", "2026-09-05T08:30:00Z", 50, "Leaks", 99,
                        feedbacks=[{"user": {"login": "alice"}, "rating": 4, "created_at": "2026-09-05T09:00:00Z"}])]
    return {
        "user": {"id": 1, "login": "me", "displayname": "Me", "email": "", "pool_month": "july", "pool_year": "2024",
                 "created_at": "2024-07-01T08:00:00Z", "campus": [], "wallet": 0, "correction_point": 3,
                 "achievements": [], "titles": [], "cursus_users": [{"cursus_id": 21, "cursus": {"name": "42cursus"}, "level": 1,
                                                                     "grade": None, "begin_at": None, "skills": []}]},
        "projects_users": [{"project": {"id": 1, "name": "libft", "slug": "42cursus-libft"}, "cursus_ids": [21], "status": "finished",
                            "validated?": True, "final_mark": 125, "occurrence": 1, "created_at": "2026-09-01T10:00:00Z",
                            "marked_at": "2026-09-11T10:00:00Z", "teams": [team2, team1]}],
        "teams": [team1, team2],
        "evals_received": received, "evals_given": given,
        "locations": [{"host": "c2r1s1", "begin_at": "2026-09-02T07:00:00Z", "end_at": "2026-09-02T10:00:00Z"},
                      {"host": "c3r1s1", "begin_at": "2026-09-02T09:00:00Z", "end_at": "2026-09-02T11:00:00Z"}],
        "corrector_sessions": {"100": [{"host": "c2r5s5", "begin_at": "2026-09-02T07:50:00Z", "end_at": None}],
                               "101": []},
        "feedbacks": {},
        "projects": [{"id": 1, "name": "libft", "slug": "libft", "difficulty": 462, "exam": False}],
        "people": [{"id": 2, "login": "alice", "displayname": "Alice"}],
        "correction_points": [{"reason": "Creation", "sum": 5, "total": 5, "created_at": "2024-07-01T08:00:00Z"}],
        "events_users": [], "coalitions_users": [], "coalitions": [], "quests_users": [],
        "titles_users": [], "expertises_users": [], "achievements_users": [], "achievements": [],
    }


class ReportBuild(unittest.TestCase):
    def setUp(self):
        self.r = Report(dataset(), now=NOW).build()

    def test_attempts_ordered_and_retries_counted(self):
        p = self.r["projects"][0]
        self.assertEqual([a["n"] for a in p["attempts"]], [1, 2])
        self.assertEqual([a["mark"] for a in p["attempts"]], [0, 125])
        self.assertEqual((p["retries"], p["failed_attempts"], p["evals"], p["outstanding"]), (1, 1, 2, 1))
        self.assertEqual(p["attempts"][1]["members"], ["mate"])
        self.assertEqual(p["attempts"][1]["moulinette"][0]["mark"], 100)

    def test_the_coalition_says_whether_the_user_is_its_master(self):
        d = dataset()
        d["coalitions"] = [{"id": 5, "name": "Zefiria", "color": "#E39F0B", "user_id": 1}]
        d["coalitions_users"] = [{"coalition_id": 5, "score": 300, "rank": 2}]
        coal = Report(d, now=NOW).build()["profile"]["coalition"]
        self.assertEqual((coal["master"], coal["rank"], coal["score"]), (True, 2, 300))

    def test_evaluations_carry_the_project_slug(self):
        self.assertTrue(all(e["slug"] == "libft" for e in self.r["received"] + self.r["given"]))

    def test_evaluation_where_when(self):
        e = self.r["received"][0]
        self.assertEqual(e["begin"], "2026-09-02 10:00")  # Madrid time
        self.assertEqual((e["duration_min"], e["planned_min"], e["lead_h"]), (40.0, 30, 22.0))
        self.assertEqual((e["my_host"], e["other_host"]), ("c2r1s1", "c2r5s5"))
        self.assertIsNone(self.r["received"][1]["other_host"])

    def test_my_rating_ignores_teammates(self):
        self.assertEqual(self.r["received"][1]["fb_rating"], 5)
        self.assertEqual(self.r["summary"]["my_rating_of_correctors"]["rating"], 5)

    def test_people_reciprocity(self):
        alice = next(p for p in self.r["people"] if p["login"] == "alice")
        self.assertEqual((alice["evaluated_me"], alice["evaluated_by_me"], alice["outstanding_to_me"]), (2, 1, 1))
        self.assertEqual(alice["their_rating_of_me"], 4)
        mate = next(p for p in self.r["people"] if p["login"] == "mate")
        self.assertEqual(mate["teammate"], 1)

    def test_summary_flags(self):
        s = self.r["summary"]
        self.assertEqual((s["received_outstanding"], s["given_negative"], s["mutual"]), (1, 1, 1))

    def test_projects_carry_track_xp_and_evaluations_per_attempt(self):
        p = self.r["projects"][0]
        self.assertEqual((p["track"], p["xp_base"], p["xp_earned"]), ("common-core", 462, 578))
        evs = p["attempts"][0]["evaluations"]
        self.assertEqual([(e["corrector"], e["mark"], e["outstanding"]) for e in evs], [("alice", 0, False)])
        self.assertEqual(p["attempts"][1]["evaluations"][0]["outstanding"], True)

    def test_logtime_merges_overlapping_sessions(self):
        lt = self.r["logtime"]
        self.assertEqual(lt["total_hours"], 4.0)  # 07:00-11:00Z, not 3h + 2h
        self.assertEqual(lt["clusters"], {"c2": 3.0, "c3": 2.0})


class PiscineFilter(unittest.TestCase):
    def setUp(self):
        d = dataset()
        d["user"]["cursus_users"][0]["begin_at"] = "2024-09-16T07:42:00Z"
        d["user"]["cursus_users"].append({"cursus_id": 9, "cursus": {"name": "C Piscine"}, "level": 4,
                                          "begin_at": "2024-07-01T08:00:00Z", "end_at": "2024-07-26T16:00:00Z"})
        pisc_team = {**d["teams"][0], "id": 50, "project_id": 7, "created_at": "2024-07-02T10:00:00Z"}
        d["projects_users"].append({**d["projects_users"][0], "project": {"id": 7, "name": "C Piscine C 00"},
                                    "cursus_ids": [9], "teams": [pisc_team]})
        d["teams"].append(pisc_team)
        d["projects"].append({"id": 7, "name": "C Piscine C 00", "difficulty": 0, "exam": False})
        d["evals_received"].append(scale_team(300, (2, "alice"), [(1, "me")], "2024-07-03T08:00:00Z",
                                              "2024-07-03T08:20:00Z", 100, "Ok", 50))
        d["evals_given"].append(scale_team(301, (1, "me"), [(5, "pisciner")], "2024-07-04T08:00:00Z",
                                           "2024-07-04T08:20:00Z", 100, "Ok", 51))
        d["locations"].append({"host": "c1r1s1", "begin_at": "2024-07-03T07:00:00Z", "end_at": "2024-07-03T12:00:00Z"})
        d["correction_points"].append({"reason": "Earning after defense", "sum": 1, "total": 6,
                                       "created_at": "2024-07-04T09:00:00Z"})
        d["correction_points"].append({"reason": "Reset kickoff", "sum": 4, "total": 1,
                                       "created_at": "2024-09-26T09:00:00Z"})
        d["achievements_users"] = [{"achievement_id": 1, "created_at": "2024-08-27T12:20:00Z"},
                                   {"achievement_id": 2, "created_at": "2024-10-05T15:58:00Z"}]
        d["quests_users"] = [{"quest": {"name": "Common Core", "cursus_id": 21}, "created_at": "2024-08-27T12:20:00Z"},
                             {"quest": {"name": "Piscine quest", "cursus_id": 9}, "created_at": "2024-07-10T12:20:00Z"}]
        self.full = d
        self.d = for_period(d, "student")

    def test_drops_piscine_projects_and_cursus(self):
        self.assertEqual([p["project"]["name"] for p in self.d["projects_users"]], ["libft"])
        self.assertEqual([t["id"] for t in self.d["teams"]], [10, 11])
        self.assertEqual([c["cursus_id"] for c in self.d["user"]["cursus_users"]], [21])

    def test_drops_everything_dated_during_piscine(self):
        self.assertEqual([e["id"] for e in self.d["evals_received"]], [100, 101])
        self.assertEqual([e["id"] for e in self.d["evals_given"]], [200])
        self.assertEqual(len(self.d["locations"]), 2)
        self.assertEqual([c["reason"] for c in self.d["correction_points"]], ["Reset kickoff"])

    def test_achievements_before_cursus_dropped_cursus_quests_kept(self):
        self.assertEqual([a["achievement_id"] for a in self.d["achievements_users"]], [2])
        self.assertEqual([q["quest"]["name"] for q in self.d["quests_users"]], ["Common Core"])

    def test_duplicate_quests_listed_once(self):
        d = dataset()
        d["quests_users"] = [{"quest_id": 46, "quest": {"name": "Rank 02", "cursus_id": 21}, "created_at": "2025-03-13T17:08:23Z"},
                             {"quest_id": 46, "quest": {"name": "Rank 02", "cursus_id": 21}, "created_at": "2025-03-13T17:08:23Z"}]
        self.assertEqual([q["name"] for q in Report(d, now=NOW).build()["extras"]["quests"]], ["Rank 02"])

    def test_report_has_no_piscine_or_pool(self):
        r = Report(self.d, now=NOW).build()
        self.assertNotIn("pool", r["profile"])
        self.assertNotIn("pisciner", [p["login"] for p in r["people"]])
        self.assertTrue(all("pool" not in p for p in r["people"]))

    def test_piscine_period_is_the_complement(self):
        p = for_period(self.full, "piscine")
        self.assertEqual([x["project"]["name"] for x in p["projects_users"]], ["C Piscine C 00"])
        self.assertEqual([e["id"] for e in p["evals_received"]], [300])
        self.assertEqual([e["id"] for e in p["evals_given"]], [301])
        self.assertEqual([c["cursus_id"] for c in p["user"]["cursus_users"]], [9])
        for name in ("locations", "correction_points", "achievements_users", "quests_users", "evals_received"):
            self.assertEqual(len(p[name]) + len(self.d[name]), len(self.full[name]), name)

    def test_all_period_keeps_everything(self):
        self.assertIs(for_period(self.full, "all"), self.full)


class Seats(unittest.TestCase):
    def test_seat_layout_takes_max_row_and_seat_per_cluster(self):
        layout = seat_layout(["c2r19s6", "c2r3s2", "c10r1s1", "c1r4s5", None, "lab-01"])
        self.assertEqual(list(layout), ["c1", "c2", "c10"])
        self.assertEqual(layout["c2"], {"rows": 19, "seats": 6})

    def test_logtime_lists_seats_and_sessions(self):
        lt = Report(dataset(), now=NOW).build()["logtime"]
        self.assertEqual([(s["host"], s["hours"], s["sessions"]) for s in lt["seats"]], [("c2r1s1", 3.0, 1), ("c3r1s1", 2.0, 1)])
        self.assertEqual(lt["total_seconds"], 4 * 3600)
        self.assertEqual([x["host"] for x in lt["log"]], ["c3r1s1", "c2r1s1"])  # newest first


if __name__ == "__main__":
    unittest.main()
