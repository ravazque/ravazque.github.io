package core

import (
	"fmt"
	"testing"
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
