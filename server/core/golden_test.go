package core

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

var goldenNow = time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)

func loadRaw(t *testing.T, path string) Raw {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var r Raw
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func assertGolden(t *testing.T, got any, file string) {
	t.Helper()
	gb, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	wb, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	g, err := ParseOrdered(gb)
	if err != nil {
		t.Fatal(err)
	}
	w, err := ParseOrdered(wb)
	if err != nil {
		t.Fatal(err)
	}
	if d := JSONDiff(g, w, "$"); d != "" {
		t.Fatal(d)
	}
}

func TestAnalyzeGoldenFixture(t *testing.T) {
	for _, p := range []string{"student", "piscine", "all"} {
		t.Run(p, func(t *testing.T) {
			d := loadRaw(t, "testdata/api/fixture.json")
			for _, k := range []string{"corrector_sessions", "evaluated_sessions", "feedbacks"} {
				if _, ok := d[k]; !ok {
					d[k] = Raw{}
				}
			}
			groups := RankGroups(Objs(d, "cursus_users_batch"), Objs(d, "quests_batch"), goldenNow)
			r := Analyze(d, p, goldenNow)
			r.Set("stats", CorrectionStats(r, groups))
			r.Set("connections", Connections(r, groups))
			assertGolden(t, r, "testdata/golden/fixture."+p+".json")
		})
	}
}

func TestAnalyzeGoldenProfiles(t *testing.T) {
	for _, key := range []string{"new", "mid", "alumni"} {
		for _, p := range Periods {
			t.Run(key+"/"+p, func(t *testing.T) {
				d := loadRaw(t, "testdata/golden/"+key+".d.json")
				var groups map[string]string
				b, _ := os.ReadFile("testdata/golden/" + key + ".groups.json")
				if err := json.Unmarshal(b, &groups); err != nil {
					t.Fatal(err)
				}
				r := Analyze(d, p, goldenNow)
				r.Obj("profile").Set("image", "/avatar/me")
				r.Set("stats", CorrectionStats(r, groups))
				// the stored report is checked as a whole at extraction (api42); here each period's own report
				gb, _ := json.Marshal(r)
				g, _ := ParseOrdered(gb)
				full, _ := os.ReadFile("testdata/golden/" + key + ".report.json")
				wo, _ := ParseOrdered(full)
				w := wo.Obj("periods").Obj(p)
				if diff := JSONDiff(g, w, "$"); diff != "" {
					t.Fatal(diff)
				}
			})
		}
	}
}
