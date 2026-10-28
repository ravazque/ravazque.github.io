package core

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

var bonusNow = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

func window(open bool, last50, last80 any, sessions ...[2]time.Time) *OMap {
	ss := []any{}
	for _, s := range sessions {
		ss = append(ss, []any{pyISO(s[0]), pyISO(s[1])})
	}
	return M("at", pyISO(bonusNow), "open", open, "sessions", ss, "last", M("50", last50, "80", last80))
}

func strp(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

func TestBonusWindowKeepsTheWeekMerged(t *testing.T) {
	loc := func(b string, e any) Raw { return Raw{"begin_at": b, "end_at": e} }
	sc := func(at, kind string, v, calc float64) Raw {
		return Raw{"created_at": at, "scoreable_type": kind, "value": v, "calculation_id": calc}
	}
	w := BonusWindow([]Raw{loc("2026-10-10T08:00:00Z", "2026-10-10T20:00:00Z"), loc("2026-10-11T06:00:00Z", "2026-10-11T14:00:00Z"),
		loc("2026-10-15T08:00:00Z", "2026-10-15T12:00:00Z"), loc("2026-10-15T11:00:00Z", "2026-10-15T13:00:00Z"), loc("2026-10-18T10:00:00Z", nil)},
		[]Raw{sc("2026-10-04T22:24:00Z", "Location", 500, 7), sc("2026-10-12T15:33:00Z", "Location", 500, 7),
			sc("2026-10-07T08:24:00Z", "Location", 1000, 20), sc("2026-10-17T08:00:00Z", "ScaleTeam", 250, 1)}, bonusNow)
	got, _ := json.Marshal(w)
	want := `{"at":"2026-10-18T12:00:00+00:00","open":true,"sessions":[["2026-10-11T12:00:00+00:00","2026-10-11T14:00:00+00:00"],` +
		`["2026-10-15T08:00:00+00:00","2026-10-15T13:00:00+00:00"],["2026-10-18T10:00:00+00:00","2026-10-18T12:00:00+00:00"]],` +
		`"last":{"50":"2026-10-12T15:33:00Z","80":"2026-10-07T08:24:00Z"}}`
	if string(got) != want {
		t.Fatalf("got %s", got)
	}
}

func TestBonusCooldownAndForecast(t *testing.T) {
	d3 := bonusNow.Add(-72 * time.Hour)
	w := window(true, pyISO(bonusNow.Add(-6*24*time.Hour)), nil, [2]time.Time{d3, d3.Add(43 * time.Hour)}, [2]time.Time{bonusNow.Add(-2 * time.Hour), bonusNow})
	tiers := LogtimeBonus(w, bonusNow)
	t50, t80 := tiers[0], tiers[1]
	if t50.Hours != 50 || t50.Points != 500 || t50.WindowH != 45 || t50.NeedH != 5 || t50.State != "cooldown" ||
		strp(t50.From) != pyISO(bonusNow.Add(24*time.Hour)) || strp(t50.Until) != strp(t50.From) {
		t.Fatalf("t50 = %+v from %s until %s", t50, strp(t50.From), strp(t50.Until))
	}
	if t80.State != "short" || t80.NeedH != 35 || strp(t80.Until) != pyISO(bonusNow.Add(35*time.Hour)) {
		t.Fatalf("t80 = %+v until %s", t80, strp(t80.Until))
	}
	later := LogtimeBonus(w, bonusNow.Add(time.Hour))[1]
	if later.WindowH != 46 || strp(later.Until) != strp(t80.Until) {
		t.Fatalf("an hour later: %+v until %s", later, strp(later.Until))
	}
}

func TestBonusReadyAndOldHoursDropOut(t *testing.T) {
	w := window(false, nil, nil, [2]time.Time{bonusNow.Add(-7 * 24 * time.Hour), bonusNow.Add(-6 * 24 * time.Hour)},
		[2]time.Time{bonusNow.Add(-5 * 24 * time.Hour), bonusNow.Add(-5*24*time.Hour + 28*time.Hour)})
	tiers := LogtimeBonus(w, bonusNow)
	if tiers[0].WindowH != 52 || tiers[0].State != "ready" || strp(tiers[0].Until) != pyISO(bonusNow) {
		t.Fatalf("t50 = %+v", tiers[0])
	}
	if tiers[1].State != "short" || tiers[1].NeedH != 28 || strp(tiers[1].Until) != pyISO(bonusNow.Add(80*time.Hour)) {
		t.Fatalf("t80 = %+v until %s", tiers[1], strp(tiers[1].Until))
	}
}

func TestBonusAcrossDST(t *testing.T) {
	// 2026-10-25 03:00 CEST → 02:00 CET: 22:00 → 04:00 local is 7 real hours
	b := time.Date(2026, 10, 24, 22, 0, 0, 0, Madrid)
	e := time.Date(2026, 10, 25, 4, 0, 0, 0, Madrid)
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	w := BonusWindow([]Raw{{"begin_at": pyISO(b.UTC()), "end_at": pyISO(e.UTC())}}, nil, now)
	if h := LogtimeBonus(w, now)[0].WindowH; h != 7 {
		t.Fatalf("window = %v h, want 7", h)
	}
}

func TestBonusOpenSession(t *testing.T) {
	now := bonusNow
	w := BonusWindow([]Raw{{"begin_at": pyISO(now.Add(-10 * time.Hour)), "end_at": nil}}, nil, now)
	t50 := LogtimeBonus(w, now)[0]
	if t50.WindowH != 10 || strp(t50.Until) != pyISO(now.Add(40*time.Hour)) {
		t.Fatalf("t50 = %+v until %s", t50, strp(t50.Until))
	}
}

func TestBonusDrops(t *testing.T) {
	thu := time.Date(2026, 10, 23, 9, 0, 0, 0, Madrid)
	fri := time.Date(2026, 10, 24, 10, 30, 0, 0, Madrid)
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, Madrid)
	w := BonusWindow([]Raw{{"begin_at": pyISO(thu.UTC()), "end_at": pyISO(thu.Add(6*time.Hour + 12*time.Minute).UTC())},
		{"begin_at": pyISO(fri.UTC()), "end_at": pyISO(fri.Add(8*time.Hour + 30*time.Minute).UTC())}}, nil, now.UTC())
	drops := BonusDrops(w, now.UTC(), 7*24*time.Hour)
	if len(drops) != 2 {
		t.Fatalf("drops = %+v", drops)
	}
	// 168 real hours later: the DST change on the 25th moves the local time back an hour
	if !drops[0].At.Equal(thu.Add(week)) || drops[0].Hours != 6.2 || !drops[0].SessionBegin.Equal(thu) {
		t.Fatalf("first = %+v", drops[0])
	}
	if !drops[1].At.Equal(fri.Add(week)) || drops[1].Hours != 8.5 {
		t.Fatalf("second = %+v", drops[1])
	}
	if d := BonusDrops(w, now.UTC(), 24*time.Hour); len(d) != 0 {
		t.Fatalf("within a day: %+v", d)
	}
}

func TestDeriveGolden(t *testing.T) {
	for _, key := range []string{"new", "mid", "alumni"} {
		t.Run(key, func(t *testing.T) {
			full, _ := json.Marshal(loadRaw(t, "testdata/golden/"+key+".report.json"))
			stored, _ := ParseOrdered(full)
			out := NewOMap()
			for _, p := range Periods {
				r := stored.Obj("periods").Obj(p)
				out.Set(p, Derive(r, stored.Obj("periods").Obj("all"), goldenNow))
			}
			gb, _ := json.Marshal(out)
			g, _ := ParseOrdered(gb)
			raw, _ := os.ReadFile("testdata/golden/" + key + ".derive.json")
			w, _ := ParseOrdered(raw)
			for _, p := range Periods {
				// active_weeks' span is calendar weeks now (v1 counted days/7): checked by TestActiveWeeksNeverExceedTheSpan
				g.Obj(p).Set("active_weeks", w.Obj(p).V("active_weeks"))
				if d := JSONDiff(g.Obj(p), w.Obj(p), p); d != "" {
					t.Fatal(d)
				}
			}
		})
	}
}

func TestActiveWeeksNeverExceedTheSpan(t *testing.T) {
	// a Sunday and the Monday after: two calendar weeks, one day apart
	if got := ActiveWeeks([]string{"2026-10-04", "2026-10-05"}, []float64{1, 1}); got != [2]int{2, 2} {
		t.Fatalf("got %v", got)
	}
	if got := ActiveWeeks([]string{"2026-10-05", "2026-10-11", "2026-10-26"}, []float64{1, 0, 2}); got != [2]int{2, 4} {
		t.Fatalf("got %v", got)
	}
}

