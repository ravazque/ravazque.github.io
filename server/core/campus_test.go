package core

import (
	"testing"
	"time"
)

// Sessions on another campus (a move from Urduliz, a visit) count as time but stay off Madrid's plan, its clusters and
// "where"; the session log says the campus, and so does an evaluation held there.
func TestSessionsOnAnotherCampusStayOffMadridsPlan(t *testing.T) {
	d := loadRaw(t, "testdata/api/fixture.json")
	r := Analyze(d, "all", goldenNow)
	recv := r.Os("received")[0]
	iso := func(ms float64, plusMin int) string {
		return time.UnixMilli(int64(ms)).Add(time.Duration(plusMin) * time.Minute).UTC().Format(time.RFC3339)
	}
	d["locations"] = []any{
		Raw{"host": "c4r9s9", "campus_id": 66.0, "begin_at": iso(recv.F("begin_ms"), -30), "end_at": iso(recv.F("begin_ms"), 90)},
		Raw{"host": "c1r1s1", "campus_id": 22.0, "begin_at": iso(recv.F("begin_ms"), -3000), "end_at": iso(recv.F("begin_ms"), -2900)},
	}
	r = Analyze(d, "all", goldenNow)
	L := r.Obj("logtime")
	for _, s := range L.Os("seats") {
		if s.S("host") == "c4r9s9" {
			t.Fatal("a seat on another campus is on Madrid's plan")
		}
	}
	if L.Obj("clusters").Has("c4") {
		t.Fatal("another campus's cluster counted among Madrid's")
	}
	away := 0
	for _, s := range L.Os("log") {
		if s.S("host") == "c4r9s9" {
			if s.V("campus") != "Forty2" {
				t.Fatalf("the session log does not name the campus: %v", s.V("campus"))
			}
			away++
		}
	}
	if away != 1 || L.Obj("away").I("Forty2") != 1 {
		t.Fatalf("away sessions: in log %d, counted %v", away, L.V("away"))
	}
	if L.F("total_seconds") < 7000 {
		t.Fatalf("time on another campus still counts: %v s", L.F("total_seconds"))
	}
	var e *OMap
	for _, x := range r.Os("received") {
		if x.V("id") == recv.V("id") {
			e = x
		}
	}
	if e.V("my_host") != "c4r9s9" || e.V("my_campus") != "Forty2" {
		t.Fatalf("evaluation on another campus: host %v campus %v", e.V("my_host"), e.V("my_campus"))
	}
	P := r.Obj("place")
	if P.Obj("received_my_cluster").Has("c4") || P.I("received_away") != 1 {
		t.Fatalf("where: %v, away %v", P.V("received_my_cluster"), P.V("received_away"))
	}
}

// An alumnus's profile keeps the day they became one, for the timeline.
func TestProfileKeepsTheDayOfBecomingAlumni(t *testing.T) {
	d := loadRaw(t, "testdata/api/fixture.json")
	d["user"].(Raw)["alumni?"] = true
	d["user"].(Raw)["alumnized_at"] = "2025-06-30T10:00:00.000Z"
	r := Analyze(d, "all", goldenNow)
	AddInsights(r, d, goldenNow)
	if got := r.Obj("profile").V("alumnized"); got != "2025-06-30" {
		t.Fatalf("alumnized %v", got)
	}
	d["user"].(Raw)["alumnized_at"] = nil
	r = Analyze(d, "all", goldenNow)
	AddInsights(r, d, goldenNow)
	if r.Obj("profile").Has("alumnized") {
		t.Fatal("no date, no key")
	}
}
