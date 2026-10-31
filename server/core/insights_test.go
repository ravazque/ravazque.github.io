package core

import "testing"

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
