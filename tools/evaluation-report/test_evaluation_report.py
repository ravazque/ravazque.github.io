import json
import unittest

import evaluation_report as h

T = 1_790_000_000_000  # an evaluation's begin_ms (2026-09-21 14:13 UTC)


def iso(ms):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat().replace("+00:00", "Z")


def evaluation(**over):
    e = {"id": 1, "team_id": 10, "project": "ft_newton", "corrector": {"login": "peer01", "name": "Peer <One>", "staff": False},
         "begin": "2026-09-28 18:00", "begin_ms": T, "booked": "2026-09-28 16:24", "filled": "2026-09-28 18:27",
         "filled_ms": T + 27 * 60000, "duration_min": 27.0, "planned_min": 30, "lead_h": 1.6, "mark": 100, "flag": "Ok",
         "outstanding": False, "negative_flag": False, "no_mark": None, "comment": "fine <b>", "feedbacks": [],
         "my_host": None, "other_host": None, "other_host_checked": False}
    return {**e, **over}


def report(*evals):
    attempt = {"n": 1, "team_id": 10, "members": ["peer02"], "leader": True, "status": "finished", "mark": 100,
               "validated": True, "start": "2026-09-20 10:00", "locked": "2026-09-28 15:00", "closed": "2026-09-28 16:00"}
    outer = {"name": "ft_newton", "slug": "ft_newton", "group": "outer-core", "status": "finished", "validated": True,
             "mark": 100, "first_ms": T, "evals": 1, "days_to_validate": 8.3, "attempts": [attempt]}
    rank = {"name": "Libft", "slug": "42cursus-libft", "group": "rank-00", "status": "finished", "validated": True, "mark": 125,
            "first_ms": T, "evals": 0, "days_to_validate": None, "attempts": [{**attempt, "team_id": 99}]}
    period = {"generated": "2026-11-04 12:28", "projects": [outer, rank], "received": list(evals),
              "profile": {"login": "me", "name": "Me", "wallet": 5, "correction_point": 3, "campus_current": "Madrid",
                          "coalition": {"name": "Coal", "score": 4000, "rank": 13}},
              "summary": {"projects": 2, "validated": 2, "attempts": 2, "retries": 0, "received": 1, "received_outstanding": 0,
                          "given": 4, "given_outstanding": 1, "unique_correctors": 1, "unique_evaluated": 4},
              "logtime": {"total_hours": 485.3, "days_present": 137, "sessions": 297},
              "correction_points": {"earned": 10, "spent": 7},
              "extras": {"cursus": [{"name": "42cursus", "level": 17.01, "grade": "Transcender", "begin": "2024-09-16 09:42"}]},
              "insights": {"exams": [{"name": "Exam Rank 02", "passed": True, "attempts": 3}]}}
    return {"periods": {"all": period, "student": period}, "promo": {"size": 424, "rank": 3, "percentile": 99.5}}


class Selection(unittest.TestCase):
    def test_keeps_outer_core_milestone_six_and_the_projects_to_hand_in_again(self):
        ps = [{"group": "outer-core", "slug": "scop"}, {"group": "rank-06", "slug": "ft_transcendence"},
              {"group": "rank-06", "slug": "42cursus-ft_transcendence"}, {"group": "rank-06", "slug": "exam-rank-06"},
              {"group": "rank-04", "slug": "minirt"}, {"group": "rank-01", "slug": "born2beroot"},
              {"group": "rank-01", "slug": "42next-born2beroot"}, {"group": "rank-02", "slug": "pipex"},
              {"group": "piscine", "slug": "c-piscine-c-00"}]
        self.assertEqual([p["slug"] for p in h.selected(ps)],
                         ["scop", "ft_transcendence", "42cursus-ft_transcendence", "minirt", "born2beroot", "42next-born2beroot"])

    def test_ft_resume_belongs_to_milestone_six(self):
        self.assertEqual(h.group_of({"group": "outer-core", "slug": "42_collaborative_resume"}), "rank-06")
        self.assertEqual(h.group_of({"group": "outer-core", "slug": "scop"}), "outer-core")

    def test_detail_groups_keep_their_order(self):
        ps = [{"group": "rank-01", "slug": "born2beroot"}, {"group": "outer-core", "slug": "scop"},
              {"group": "outer-core", "slug": "42_collaborative_resume"}, {"group": "rank-06", "slug": "ft_transcendence"}]
        self.assertEqual([(t, [p["slug"] for p in g]) for t, g in h.detail_groups(ps)],
                         [("Milestone 6", ["42_collaborative_resume", "ft_transcendence"]), ("Outer Core", ["scop"]),
                          ("Reentregas de milestones anteriores", ["born2beroot"])])


class Axis(unittest.TestCase):
    def test_a_lone_old_attempt_does_not_stretch_the_axis(self):
        starts = [h.parse(s) for s in ("2024-11-02 10:03", "2025-11-26 19:23", "2026-04-01 15:07", "2026-10-14 22:48")]
        self.assertEqual(h.axis_start(starts), h.parse("2025-11-01 00:00"))

    def test_steady_history_keeps_its_first_month(self):
        starts = [h.parse(s) for s in ("2026-01-15 10:00", "2026-04-01 15:07")]
        self.assertEqual(h.axis_start(starts), h.parse("2026-01-01 00:00"))


class Login(unittest.TestCase):
    def test_only_a_login_can_reach_a_url_or_a_file_name(self):
        for good in ("ravazque", "rorozco-", "a1b2"):
            self.assertTrue(h.valid_login(good), good)
        for bad in ("", "../etc", "a/b", "a b", "a.b", "Ravazque", "x" * 40):
            self.assertFalse(h.valid_login(bad), bad)


class Env(unittest.TestCase):
    def test_reads_compose_format(self):
        text = '# comment\nFT_UID=abc\nFT_SECRET="s=3"\n\nOTHER = x\n'
        self.assertEqual(h.parse_env(text), {"FT_UID": "abc", "FT_SECRET": "s=3", "OTHER": "x"})


class Seat(unittest.TestCase):
    def session(self, host, begin, end):
        return {"host": host, "begin_at": iso(begin), "end_at": iso(end) if end else None}

    def test_longest_overlap_wins(self):
        ss = [self.session("c1r1s1", T - 60000, T + 60000), self.session("c2r2s2", T + 60000, T + 3600000)]
        self.assertEqual(h.seat_at(ss, T, T + 1800000), "c2r2s2")

    def test_session_outside_the_window_is_not_logged(self):
        self.assertIsNone(h.seat_at([self.session("c1r1s1", T - 7200000, T - 3600000)], T, T + 60000))

    def test_open_session_counts(self):
        self.assertEqual(h.seat_at([self.session("c3r3s3", T - 60000, None)], T, T + 60000), "c3r3s3")


class CorrectorSeats(unittest.TestCase):
    def test_report_first_then_cache_then_api(self):
        evals = [evaluation(id=1, other_host_checked=True, other_host="c1r1s1"),
                 evaluation(id=2),
                 evaluation(id=3),
                 evaluation(id=4, other_host_checked=True, other_host=None)]
        asked = []

        def lookup(e):
            asked.append(e["id"])
            return [{"host": "c3r3s3", "begin_at": iso(T), "end_at": iso(T + 60000)}]

        cache = {"2": "c2r2s2"}
        seats = h.corrector_seats(evals, cache, lookup)
        self.assertEqual(asked, [3])
        self.assertEqual(seats, {1: "c1r1s1", 2: "c2r2s2", 3: "c3r3s3", 4: None})
        self.assertEqual(cache["3"], "c3r3s3")

    def test_failed_or_no_lookup_stays_unknown(self):
        def lookup(e):
            raise h.LookupFailed

        self.assertEqual(h.corrector_seats([evaluation()], {}, lookup), {})
        self.assertEqual(h.corrector_seats([evaluation()], {}, None), {})

    def test_cached_not_logged_is_kept(self):
        self.assertEqual(h.corrector_seats([evaluation()], {"1": None}, None), {1: None})


class Outcome(unittest.TestCase):
    def test_outcomes(self):
        self.assertEqual(h.outcome(evaluation(mark=125, outstanding=True)), "out")
        self.assertEqual(h.outcome(evaluation(mark=100)), "ok")
        self.assertEqual(h.outcome(evaluation(mark=78)), "low")
        self.assertEqual(h.outcome(evaluation(mark=100, negative_flag=True)), "low")
        self.assertEqual(h.outcome(evaluation(mark=None)), "none")


class Spread(unittest.TestCase):
    def test_marks_that_share_a_day_are_pushed_apart(self):
        self.assertEqual(h.spread([10, 10, 11, 100], 14), [10, 24, 38, 100])
        self.assertEqual(h.spread([], 14), [])


class State(unittest.TestCase):
    def test_says_what_happened(self):
        self.assertEqual(h.state({"validated": True, "status": "finished"}), ("yes", "Validado"))
        self.assertEqual(h.state({"validated": True, "status": "in_progress"}), ("yes", "Validado · en curso"))
        self.assertEqual(h.state({"validated": False, "status": "finished"}), ("no", "No validado"))
        self.assertEqual(h.state({"validated": None, "status": "waiting_for_correction"}), ("open", "Esperando corrección"))


class Page(unittest.TestCase):
    def test_shows_each_attempt_and_escapes_values(self):
        page = h.render(report(evaluation()), {1: "c2r2s2"})
        self.assertIn('id="p-ft_newton"', page)
        self.assertIn("peer01", page)
        self.assertIn("peer02", page)
        self.assertIn("Peer &lt;One&gt;", page)
        self.assertIn("fine &lt;b&gt;", page)
        self.assertNotIn("fine <b>", page)
        self.assertIn("c2r2s2", page)
        self.assertIn('class="seat off"', page)  # my_host is None
        self.assertIn("28 sep 2026 16:00", page)  # delivered

    def test_whole_profile_lists_every_project_but_details_only_the_chosen(self):
        page = h.render(report(evaluation()), {})
        self.assertIn("Libft", page)
        self.assertNotIn('id="p-42cursus-libft"', page)
        for fact in ("17,01", "3 de 424", "485 h", "Coal", "1 de 1"):
            self.assertIn(fact, page)

    def test_project_and_attempt_are_two_columns_of_the_chart(self):
        page = h.render(report(evaluation()), {})
        self.assertIn('<span class="att-n">1 de 1</span>', page)
        self.assertIn(">Proyecto</span><span>Intento</span>", page)

    def test_milestones_are_named_and_ft_resume_is_in_the_sixth(self):
        doc = report(evaluation())
        doc["periods"]["all"]["projects"].append(
            {"name": "ft_resume", "slug": "42_collaborative_resume", "group": "outer-core", "status": "finished", "validated": True,
             "mark": 100, "first_ms": T, "evals": 0, "days_to_validate": 0.2, "attempts": []})
        page = h.render(doc, {})
        block = page[page.index("<h3>Milestone 6 "):]
        self.assertIn("ft_resume", block[:block.index("</table>")])

    def test_speaks_of_the_student_not_to_them(self):
        page = h.render(report(evaluation()), {})
        body = page[page.index("</style></head>"):]
        for second_person in ("Tu asiento", "Tú,", "Tu valoración", " te ", "tu promoción", "empezaste"):
            self.assertNotIn(second_person, body)

    def test_every_cell_says_what_it_is_for_narrow_screens(self):
        page = h.render(report(evaluation()), {})
        for label in ("Empezó", "Agendada", "Antelación", "Tras la entrega", "Duración", "Nota", "Asiento del alumno", "Asiento del corrector"):
            self.assertIn(f'data-l="{label}"', page)

    def test_nothing_needs_sideways_scrolling(self):
        self.assertNotIn('class="scroll"', h.render(report(evaluation()), {}))

    def test_colours_come_from_the_design_tokens(self):
        tokens = json.loads((h.REPO / "server/core/data/ui.json").read_text())["tokens"]
        page = h.render(report(evaluation()), {})
        self.assertIn(f"--ground:{tokens['light']['ground']}", page)
        self.assertIn(f"--ground:{tokens['dark']['ground']}", page)

    def test_marks_never_leave_the_plot(self):
        page = h.render(report(evaluation()), {})
        self.assertRegex(page, r'class="dot" style="left:min\(calc\([\d.]+% \+ \d+px\),calc\(100% - 7px\)\)"')

    def test_unknown_seat_is_not_called_not_logged(self):
        page = h.render(report(evaluation(my_host="c1r1s1")), {})
        self.assertIn('class="seat none"', page)
        self.assertNotIn('class="seat off"', page)

    def test_no_evaluations_no_crash(self):
        self.assertIn("Sin evaluaciones", h.render(report(), {}))

    def test_missing_optional_profile_data_no_crash(self):
        doc = report()
        doc.pop("promo")
        doc["periods"]["student"].pop("insights")
        doc["periods"]["student"]["profile"].pop("coalition")
        self.assertIn("Perfil", h.render(doc, {}))


if __name__ == "__main__":
    unittest.main()
