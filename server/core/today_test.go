package core

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func storedAll(t *testing.T, key string) *OMap {
	t.Helper()
	raw, err := os.ReadFile("testdata/golden/" + key + ".report.json")
	if err != nil {
		t.Fatal(err)
	}
	r, err := ParseOrdered(raw)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func emptyRaw() Raw {
	user := Raw{"id": 900001.0, "login": "tempty", "displayname": "T Empty", "email": "tempty@example.invalid", "wallet": 0.0,
		"correction_point": 5.0, "campus": []any{}, "achievements": []any{}, "titles": []any{},
		"cursus_users": []any{Raw{"cursus_id": 21.0, "level": 0.0, "grade": nil, "begin_at": "2026-10-01T07:42:00.000Z", "skills": []any{},
			"cursus": Raw{"name": "42cursus"}}}}
	d := Raw{"user": user, "corrector_sessions": Raw{}, "evaluated_sessions": Raw{}, "feedbacks": Raw{}}
	for _, k := range []string{"projects_users", "teams", "evals_received", "evals_given", "locations", "correction_points", "events_users",
		"coalitions", "coalitions_users", "quests_users", "titles_users", "expertises_users", "achievements_users", "achievements",
		"projects", "people", "coalition_scores"} {
		d[k] = []any{}
	}
	return d
}

func TestAnalyzeEmpty(t *testing.T) {
	for _, p := range Periods {
		r := Analyze(emptyRaw(), p, goldenNow)
		L := r.Obj("logtime")
		if L.I("total_seconds") != 0 || L.V("first_day") != nil || len(L.L("days")) != 0 || L.V("official_hours") != nil {
			t.Fatalf("%s: logtime = %s", p, mustJSON(L))
		}
		if _, err := json.Marshal(r); err != nil {
			t.Fatal(err)
		}
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestTodayWeekStrips(t *testing.T) {
	all := storedAll(t, "mid").Obj("periods").Obj("all")
	td := BuildToday(all, nil, goldenNow)
	if len(td.Week) != 7 || td.Week[6].Date != "2026-10-28" || td.Week[0].Date != "2026-10-22" {
		t.Fatalf("week = %+v", td.Week)
	}
	for _, d := range td.Week {
		for _, p := range d.Parts {
			if p.From < 0 || p.To > 24 || p.From >= p.To {
				t.Fatalf("%s part %+v", d.Date, p)
			}
		}
	}
	// the open session began 10:43 local and runs to now (13:00 local)
	if td.Now == nil || td.Now.Host != "c2r7s3" || td.TodayS != 8220 {
		t.Fatalf("now = %+v today = %d", td.Now, td.TodayS)
	}
	last := td.Week[6].Parts[len(td.Week[6].Parts)-1]
	if last.From < 10.7 || last.From > 10.72 || last.To != 13 {
		t.Fatalf("today's last part = %+v", last)
	}
	if len(td.Bonus) != 2 || td.WindowH != td.Bonus[0].WindowH {
		t.Fatalf("bonus = %+v", td.Bonus)
	}
}

func TestTodayInProgressAndMonth(t *testing.T) {
	all := storedAll(t, "mid").Obj("periods").Obj("all")
	td := BuildToday(all, nil, goldenNow)
	if len(td.InProgress) != 1 || td.InProgress[0].Name != "CPP Module 09" || td.InProgress[0].Day != 48 {
		t.Fatalf("in progress = %+v", td.InProgress)
	}
	if td.Month.Month != "2026-10" || td.Month.CoalitionPoints != 1750 {
		t.Fatalf("month = %+v", td.Month)
	}
}

func TestNextEvaluationInvisible(t *testing.T) {
	up := Upcoming([]Raw{
		{"begin_at": "2026-10-28T15:30:00.000Z", "corrector": "invisible", "team": Raw{"project_id": 1.0}},
		{"begin_at": "2026-10-30T09:00:00.000Z", "corrector": "invisible", "team": Raw{"project_id": 1.0}},
		{"begin_at": "2026-10-20T09:00:00.000Z", "corrector": "invisible", "team": Raw{"project_id": 1.0}},
	}, []Raw{{"begin_at": "2026-10-29T08:00:00.000Z", "correcteds": []any{"invisible"}, "team": Raw{"project_id": 2.0}}},
		[]Raw{{"id": 1.0, "name": "webserv"}, {"id": 2.0, "name": "Inception"}}, goldenNow)
	all := storedAll(t, "mid").Obj("periods").Obj("all")
	td := BuildToday(all, up, goldenNow)
	if td.Next == nil || td.Next.Project != "webserv" || td.Next.Role != "corrected" || td.Next.MoreThisWeek != 2 ||
		!td.Next.At.Equal(time.Date(2026, 10, 28, 15, 30, 0, 0, time.UTC)) {
		t.Fatalf("next = %+v", td.Next)
	}
	if b, _ := json.Marshal(up); json.Valid(b) && len(up) != 3 {
		t.Fatalf("upcoming = %s", b)
	}
}

func TestTodayEmpty(t *testing.T) {
	td := BuildToday(Analyze(emptyRaw(), "all", goldenNow), nil, goldenNow)
	if td.Now != nil || td.Next != nil || len(td.InProgress) != 0 || td.TodayS != 0 || len(td.Week) != 7 {
		t.Fatalf("today = %+v", td)
	}
}

func TestDayStripsUseTheWallClockOnDSTDays(t *testing.T) {
	// 2026-10-25 lasts 25 h in Madrid: a session 22:00–23:30 local sits at 22–23.5 on the day's 0–24 line
	all := Analyze(emptyRaw(), "all", goldenNow)
	b := time.Date(2026, 10, 25, 22, 0, 0, 0, Madrid)
	all.Obj("logtime").Set("log", []any{M("begin_ms", float64(b.UnixMilli()), "seconds", 5400.0, "end", "2026-10-25 23:30", "host", "c1r1s1")})
	td := BuildToday(all, nil, time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC))
	var parts []Part
	for _, d := range td.Week {
		if d.Date == "2026-10-25" {
			parts = d.Parts
		}
	}
	if len(parts) != 1 || parts[0].From != 22 || parts[0].To != 23.5 {
		t.Fatalf("parts %+v", parts)
	}
}

func TestTodayCarriesPointsAndBlackhole(t *testing.T) {
	all := storedAll(t, "mid").Obj("periods").Obj("all")
	td := BuildToday(all, nil, goldenNow)
	if td.Points != all.Obj("profile").I("correction_point") {
		t.Fatalf("points %d", td.Points)
	}
	all.Obj("insights").Obj("pace").Set("blackhole_days", 42)
	if td := BuildToday(all, nil, goldenNow); td.BlackholeDays == nil || *td.BlackholeDays != 42 {
		t.Fatalf("blackhole %v", td.BlackholeDays)
	}
}
