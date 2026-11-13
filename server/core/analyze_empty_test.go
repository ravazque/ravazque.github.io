package core

import (
	"encoding/json"
	"testing"
)

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

func TestCancelledEvaluationsByKind(t *testing.T) {
	d := emptyRaw()
	row := func(id float64, reason string, sum float64, at string, st float64) any {
		return Raw{"id": id, "reason": reason, "sum": sum, "total": 5.0, "created_at": at, "scale_team_id": st}
	}
	d["correction_points"] = []any{
		row(1, "Defense plannification", -1, "2026-10-10T08:00:00.000Z", 7001),
		row(2, "Evaluator cancelled a defense", 1, "2026-10-10T09:30:00.000Z", 7001),  // your corrector cancelled, point back
		row(3, "Evaluator cancelled a defense", -1, "2026-10-12T15:00:00.000Z", 7002), // you cancelled one you were to give
		row(4, "Defense plannification", -1, "2026-10-14T10:00:00.000Z", 7004),        // booked, then gone with no refund: you cancelled it
		row(5, "Defense plannification", -1, "2026-10-15T10:00:00.000Z", 7005),        // booked and evaluated
		row(6, "Defense plannification", -1, "2026-10-16T10:00:00.000Z", 7006),        // booked, still to come (hidden by the API)
		row(7, "Refund for evaluator missing", 1, "2026-10-17T10:00:00.000Z", 7007),   // your corrector didn't come
		row(8, "Earning after defense", 1, "2026-10-13T15:00:00.000Z", 7003),
	}
	d["evals_received"] = []any{Raw{"id": 7005.0, "corrector": Raw{"id": 900002.0, "login": "peer02"}, "correcteds": []any{}, "begin_at": "2026-10-15T12:00:00.000Z"}}
	d["hidden_received_ids"] = []any{7006.0}
	kinds := map[string][]*OMap{}
	for _, c := range Analyze(d, "all", goldenNow).Obj("correction_points").Os("cancels") {
		kinds[c.S("kind")] = append(kinds[c.S("kind")], c)
	}
	if len(kinds["corrector"]) != 1 || kinds["corrector"][0].V("at") != fmtT(tsAny("2026-10-10T09:30:00.000Z")) {
		t.Fatalf("your corrector cancelled: %s", mustJSON(kinds["corrector"]))
	}
	if len(kinds["you"]) != 1 || kinds["you"][0].F("at_ms") == 0 {
		t.Fatalf("you cancelled theirs: %s", mustJSON(kinds["you"]))
	}
	if len(kinds["self"]) != 1 || kinds["self"][0].V("at") != fmtT(tsAny("2026-10-14T10:00:00.000Z")) {
		t.Fatalf("you cancelled yours (when you booked it): %s", mustJSON(kinds["self"]))
	}
	if len(kinds["absent"]) != 1 || kinds["absent"][0].F("st") != 7007 {
		t.Fatalf("your corrector didn't come: %s", mustJSON(kinds["absent"]))
	}
}

func TestCorrectionPointsByMonthAndWeek(t *testing.T) {
	d := emptyRaw()
	row := func(id float64, reason string, sum float64, at string) any {
		return Raw{"id": id, "reason": reason, "sum": sum, "total": 99.0, "created_at": at, "scale_team_id": id}
	}
	d["correction_points"] = []any{
		row(1, "Earning after defense", 2, "2026-03-31T22:30:00.000Z"),   // Madrid (summer time): Wednesday April 1st, 00:30
		row(2, "Defense plannification", -1, "2026-02-10T10:00:00.000Z"), // Tuesday: the week of Monday February 9
		row(3, "Earning after defense", 1, "2026-02-15T10:00:00.000Z"),   // Sunday: the same week
		row(4, "Provided points to the pool.", -3, "2026-04-06T10:00:00.000Z"),
	}
	cp := Analyze(d, "all", goldenNow).Obj("correction_points")
	ms, ws := cp.Os("by_month"), cp.Os("by_week")
	if len(ms) != 2 || ms[0].S("m") != "2026-02" || ms[1].S("m") != "2026-04" || ms[1].F("earned") != 2 || ms[1].F("spent") != 3 {
		t.Fatalf("months %s", mustJSON(ms))
	}
	if r := ms[1].Obj("reasons"); r.F("Earning after defense") != 2 || r.F("Provided points to the pool.") != -3 {
		t.Fatalf("reasons %s", mustJSON(ms[1]))
	}
	if len(ws) != 3 || ws[0].S("w") != "2026-02-09" || ws[0].F("earned") != 1 || ws[0].F("spent") != 1 || ws[1].S("w") != "2026-03-30" || ws[2].S("w") != "2026-04-06" {
		t.Fatalf("weeks %s", mustJSON(ws))
	}
	ds := cp.Os("by_day") // Madrid days: the zoomed balance goes day by day
	if len(ds) != 4 || ds[0].S("d") != "2026-02-10" || ds[1].S("d") != "2026-02-15" || ds[2].S("d") != "2026-04-01" || ds[2].F("earned") != 2 || ds[3].F("spent") != 3 {
		t.Fatalf("days %s", mustJSON(ds))
	}
	if cp.Has("quarters") {
		t.Fatal("quarters are gone")
	}
}
