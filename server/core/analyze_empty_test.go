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
