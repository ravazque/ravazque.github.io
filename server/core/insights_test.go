package core

import (
	"fmt"
	"slices"
	"testing"
	"time"
)

func TestCoalitionStandingsCarryTheirLogoAndBanner(t *testing.T) {
	bloc := Raw{"coalitions": []any{
		Raw{"id": 1.0, "name": "Coalition A", "color": "#123456", "score": 10.0,
			"image_url": "https://cdn.intra.42.fr/coalition/image/1/a.svg", "cover_url": "https://cdn.intra.42.fr/coalition/cover/1/a.jpg"},
		Raw{"id": 2.0, "name": "Coalition B", "color": "#654321", "score": 20.0, "image_url": "", "cover_url": nil},
	}}
	out := CoalitionStandings(bloc, 1.0)
	b, a := out[0].(*OMap), out[1].(*OMap)
	if a.S("logo") != "https://cdn.intra.42.fr/coalition/image/1/a.svg" || a.S("cover") != "https://cdn.intra.42.fr/coalition/cover/1/a.jpg" {
		t.Fatalf("coalition A = %v", a)
	}
	if b.Has("logo") || b.Has("cover") {
		t.Fatalf("a coalition with no images keeps no keys for them: %v", b)
	}
}

func TestEveryCoalitionAwardIsKeptNewestFirst(t *testing.T) {
	var scores []Raw
	for i := range 45 {
		scores = append(scores, Raw{"created_at": fmt.Sprintf("2026-01-%02dT%02d:00:00.000Z", 1+i%28, 10+i/28),
			"scoreable_type": "ScaleTeam", "scoreable_id": float64(i), "value": 250.0})
	}
	p := CoalitionPoints(scores)
	awards, recent := p.Os("awards"), p.Os("recent")
	if len(awards) != 45 || len(recent) != 40 {
		t.Fatalf("awards %d, recent %d", len(awards), len(recent))
	}
	for i := 1; i < len(awards); i++ {
		if awards[i-1].S("at") < awards[i].S("at") {
			t.Fatalf("award %d is newer than %d", i, i-1)
		}
	}
	if !v2Keys["awards"] {
		t.Fatal("v1's golden files have no awards: it must be a v2 key")
	}
}

func TestMadridLevelsKeepStudentsOuterCoreFrozenAndAlumniOnly(t *testing.T) {
	now := time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)
	row := func(level float64, user Raw, cu Raw) any {
		r := Raw{"cursus_id": 21.0, "begin_at": "2024-10-07T08:00:00.000Z", "level": level, "user": user}
		for k, v := range cu {
			r[k] = v
		}
		return r
	}
	on := Raw{"staff?": false, "alumni?": false, "active?": true}
	rows := []any{
		row(5.5, on, nil), // student
		row(12.25, on, Raw{"grade": "Transcender"}),
		row(7, Raw{"staff?": false, "alumni?": false, "active?": false}, nil), // frozen
		row(16, Raw{"staff?": false, "alumni?": true, "active?": true}, nil),
		row(3, on, Raw{"end_at": "2025-01-01T00:00:00.000Z"}),                  // blackholed
		row(0, Raw{"staff?": true, "alumni?": false, "active?": true}, nil),   // staff
		row(0, on, Raw{"begin_at": "2027-01-01T00:00:00.000Z"}),                // not started
	}
	got := MadridLevels(rows, now)
	slices.Sort(got)
	if fmt.Sprint(got) != "[5.5 7 12.25 16]" {
		t.Fatalf("levels %v", got)
	}
}

func TestMadridStandingIsYourPlaceAmongThem(t *testing.T) {
	s := MadridStanding([]float64{1, 2, 3, 4, 5, 6, 7, 8}, 7)
	if s.I("size") != 8 || s.I("rank") != 2 || s.F("top") != 25 {
		t.Fatalf("standing %v", s)
	}
	if MadridStanding(nil, 7) != nil {
		t.Fatal("a standing with no levels")
	}
}
