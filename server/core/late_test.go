package core

import (
	"testing"
	"time"
)

func TestLateMinutes(t *testing.T) {
	at := func(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }
	sess := func(b, e string) Raw {
		r := Raw{"host": "c1r1s1", "begin_at": b, "end_at": nil}
		if e != "" {
			r["end_at"] = e
		}
		return r
	}
	start, end, now := at("2026-11-01T10:00:00Z"), at("2026-11-01T10:30:00Z"), at("2026-11-02T00:00:00Z")
	for _, c := range []struct {
		name string
		s    []Raw
		want any
	}{
		{"no session", nil, nil},
		{"open before the start", []Raw{sess("2026-11-01T09:00:00Z", "2026-11-01T11:00:00Z")}, nil},
		{"still open from before", []Raw{sess("2026-11-01T09:00:00Z", "")}, nil},
		{"logged in 12 minutes in", []Raw{sess("2026-11-01T10:12:40Z", "2026-11-01T12:00:00Z")}, 12},
		{"out before the start, back late", []Raw{sess("2026-11-01T08:00:00Z", "2026-11-01T09:50:00Z"), sess("2026-11-01T10:05:00Z", "")}, 5},
		{"the earliest login counts", []Raw{sess("2026-11-01T10:20:00Z", ""), sess("2026-11-01T10:08:00Z", "2026-11-01T10:15:00Z")}, 8},
		{"only after the end", []Raw{sess("2026-11-01T10:31:00Z", "")}, nil},
		{"under a minute", []Raw{sess("2026-11-01T10:00:30Z", "")}, nil},
	} {
		if got := LateMinutes(c.s, start, end, now); got != c.want {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}

// Received: how late you logged in; given: how late each evaluated student did, where their sessions were looked up.
func TestEvaluationsSayWhoLoggedInLate(t *testing.T) {
	d := loadRaw(t, "testdata/api/fixture.json")
	r := Analyze(d, "all", goldenNow)
	var recv, given *OMap
	if evs := r.Os("received"); len(evs) > 0 {
		recv = evs[0]
	}
	for _, e := range r.Os("given") {
		if len(e.Os("correcteds")) > 0 && e.Os("correcteds")[0].S("login") != "" {
			given = e
			break
		}
	}
	if recv == nil || given == nil {
		t.Fatal("the fixture needs a received and a given evaluation")
	}
	iso := func(ms float64, plusMin int) string {
		return time.UnixMilli(int64(ms)).Add(time.Duration(plusMin) * time.Minute).UTC().Format(time.RFC3339)
	}
	d["locations"] = []any{Raw{"host": "c2r2s2", "begin_at": iso(recv.F("begin_ms"), 9), "end_at": iso(recv.F("begin_ms"), 120)}} // your only session
	login := given.Os("correcteds")[0].S("login")
	d["evaluated_sessions"] = Raw{idStr(given.V("id")): Raw{login: []any{Raw{"host": "c3r3s3", "begin_at": iso(given.F("begin_ms"), 7), "end_at": nil}}}}
	r = Analyze(d, "all", goldenNow)
	find := func(role string, id any) *OMap {
		for _, e := range r.Os(role) {
			if e.V("id") == id {
				return e
			}
		}
		t.Fatalf("%s %v gone", role, id)
		return nil
	}
	if got := find("received", recv.V("id")).V("my_late_min"); got != 9 {
		t.Fatalf("received: my_late_min %v", got)
	}
	if got := find("given", given.V("id")).Os("correcteds")[0].V("late_min"); got != 7 {
		t.Fatalf("given: late_min %v", got)
	}
}

// Work experience evaluations (company mid/final, peer video) are not booked between students: no lateness there; a
// given evaluation's students say who led the team.
func TestWorkExperienceHasNoLatenessAndTeamsTheirLeader(t *testing.T) {
	d := loadRaw(t, "testdata/api/fixture.json")
	e := Objs(d, "evals_given")[0]
	team := Obj(e, "team")
	users := Objs(team, "users")
	if len(users) == 0 || len(Objs(e, "correcteds")) == 0 {
		t.Fatal("the fixture's first given evaluation needs its team's users")
	}
	login, id := Str(Objs(e, "correcteds")[0], "login"), Num(Objs(e, "correcteds")[0], "id")
	for _, u := range users {
		u["leader"] = Num(u, "id") == id
	}
	begin := TS(Str(e, "begin_at"))
	d["evaluated_sessions"] = Raw{idStr(e["id"]): Raw{login: []any{Raw{"host": "c3r3s3", "begin_at": begin.Add(7 * time.Minute).UTC().Format(time.RFC3339), "end_at": nil}}}}
	person := func(r *OMap) *OMap {
		for _, g := range r.Os("given") {
			if g.V("id") == e["id"] {
				return g.Os("correcteds")[0]
			}
		}
		t.Fatal("given evaluation gone")
		return nil
	}
	p := person(Analyze(d, "all", goldenNow))
	if p.V("leader") != true || p.V("late_min") != 7 {
		t.Fatalf("leader %v, late_min %v", p.V("leader"), p.V("late_min"))
	}
	d["projects"] = append(d["projects"].([]any), Raw{"id": team["project_id"], "name": "Work Experience I - Peer Video", "slug": "work-experience-i-work-experience-i-peer-video"})
	if p := person(Analyze(d, "all", goldenNow)); p.V("late_min") != nil {
		t.Fatalf("a work experience evaluation says how late: %v", p.V("late_min"))
	}
}
