package core

import (
	"encoding/json"
	"fmt"
	"math"
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

// jsonDiff is the first path where two JSON documents differ, key order included; "" when equal.
func jsonDiff(got, want any, path string) string {
	switch w := want.(type) {
	case *OMap:
		g, ok := got.(*OMap)
		if !ok {
			return fmt.Sprintf("%s: got %T, want object", path, got)
		}
		gk, wk := g.Keys(), w.Keys()
		for i := range max(len(gk), len(wk)) {
			if i >= len(gk) || i >= len(wk) || gk[i] != wk[i] {
				return fmt.Sprintf("%s: keys %v, want %v", path, gk, wk)
			}
		}
		for _, k := range wk {
			gv, _ := g.Get(k)
			wv, _ := w.Get(k)
			if d := jsonDiff(gv, wv, path+"."+k); d != "" {
				return d
			}
		}
	case []any:
		g, ok := got.([]any)
		if !ok {
			return fmt.Sprintf("%s: got %T, want array", path, got)
		}
		if len(g) != len(w) {
			return fmt.Sprintf("%s: length %d, want %d", path, len(g), len(w))
		}
		for i := range w {
			if d := jsonDiff(g[i], w[i], fmt.Sprintf("%s[%d]", path, i)); d != "" {
				return d
			}
		}
	case json.Number:
		g, ok := got.(json.Number)
		if !ok {
			return fmt.Sprintf("%s: got %v, want %v", path, got, w)
		}
		gf, _ := g.Float64()
		wf, _ := w.Float64()
		if math.Abs(gf-wf) > 1e-9*max(1, math.Abs(wf)) {
			return fmt.Sprintf("%s: got %v, want %v", path, g, w)
		}
	default:
		if got != want {
			return fmt.Sprintf("%s: got %v, want %v", path, got, want)
		}
	}
	return ""
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
	if d := jsonDiff(g, w, "$"); d != "" {
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
				if diff := jsonDiff(g, w, "$"); diff != "" {
					t.Fatal(diff)
				}
			})
		}
	}
}
