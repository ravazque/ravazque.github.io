package api42

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"ravazque.info/server/api42/fake42"
	"ravazque.info/server/core"
)

var goldenNow = time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)

func readJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestExtractMatchesV1(t *testing.T) {
	for _, key := range []string{"new", "mid", "alumni"} {
		t.Run(key, func(t *testing.T) {
			d := readJSON(t, "../core/testdata/api/"+key+".json")
			c, _ := newTestClient(t, fake42.Handler(d, func(p string) { t.Errorf("unexpected request %s", p) }))
			var last float64
			report, err := Extract(context.Background(), c, int(d["user"].(map[string]any)["id"].(float64)),
				func(f float64) {
					if f < last {
						t.Errorf("progress went back: %v after %v", f, last)
					}
					last = f
				}, func() time.Time { return goldenNow })
			if err != nil {
				t.Fatal(err)
			}
			if last != 1 {
				t.Fatalf("progress ended at %v", last)
			}
			wantReq, _ := os.ReadFile("../core/testdata/golden/" + key + ".requests")
			if got := strconv.Itoa(c.Requests()); got != strings.TrimSpace(string(wantReq)) {
				t.Errorf("requests %s, v1 made %s", got, strings.TrimSpace(string(wantReq)))
			}
			up, _ := report.Get("upcoming")
			if _, ok := up.([]core.UpcomingEval); !ok {
				t.Fatalf("upcoming = %T", up)
			}
			trimmed := core.NewOMap()
			for _, k := range report.Keys() {
				if k != "upcoming" {
					trimmed.Set(k, report.V(k))
				}
			}
			gb, _ := json.Marshal(trimmed)
			g, _ := core.ParseOrdered(gb)
			wb, _ := os.ReadFile("../core/testdata/golden/" + key + ".report.json")
			w, _ := core.ParseOrdered(wb)
			if diff := core.JSONDiff(g, w, "$"); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestRefusedUser(t *testing.T) {
	d := readJSON(t, "../core/testdata/api/mid.json")
	d["user"].(map[string]any)["staff?"] = true
	c, _ := newTestClient(t, fake42.Handler(d, func(p string) { t.Errorf("unexpected request %s", p) }))
	_, err := Extract(context.Background(), c, int(d["user"].(map[string]any)["id"].(float64)), func(float64) {}, func() time.Time { return goldenNow })
	var refused core.AccessRefused
	if !errorsAs(err, &refused) || refused.Reason != "staff" || c.Requests() != 1 {
		t.Fatalf("err %v after %d requests", err, c.Requests())
	}
}

func TestUpcomingHiddenEvaluationsAreKept(t *testing.T) {
	d := readJSON(t, "../core/testdata/api/mid.json")
	recv := d["evals_received"].([]any)
	hidden := map[string]any{"id": 7999999.0, "begin_at": "2026-10-29T15:30:00.000Z", "corrector": "invisible", "correcteds": []any{},
		"team": recv[0].(map[string]any)["team"], "scale": map[string]any{"duration": 1800.0}}
	d["evals_received"] = append(recv, hidden)
	c, _ := newTestClient(t, fake42.Handler(d, func(p string) { t.Errorf("unexpected request %s", p) }))
	report, err := Extract(context.Background(), c, int(d["user"].(map[string]any)["id"].(float64)), func(float64) {}, func() time.Time { return goldenNow })
	if err != nil {
		t.Fatal(err)
	}
	up := report.V("upcoming").([]core.UpcomingEval)
	if len(up) != 1 || up[0].Role != "corrected" || up[0].Project == "" {
		t.Fatalf("upcoming %+v", up)
	}
	for _, e := range report.Obj("periods").Obj("all").Os("received") {
		if e.F("id") == 7999999 {
			t.Fatal("the hidden evaluation reached the analysis")
		}
	}
	if slices.Contains(report.Keys(), "upcoming") == false {
		t.Fatal("no upcoming key")
	}
}

func errorsAs(err error, target any) bool { return errors.As(err, target) }

// One contact the API refuses (seen live: a 401 on another student's given evaluations) leaves that contact out of
// the network instead of failing the whole extraction.
func TestRefusedContactIsSkipped(t *testing.T) {
	d := readJSON(t, "../core/testdata/api/mid.json")
	uid := strconv.Itoa(int(d["user"].(map[string]any)["id"].(float64)))
	fake := fake42.Handler(d, func(p string) { t.Errorf("unexpected request %s", p) })
	var mu sync.Mutex
	refused, hits := "", 0
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.HasSuffix(p, "/scale_teams/as_corrector") && !strings.Contains(p, "/users/"+uid+"/") {
			mu.Lock()
			if refused == "" {
				refused = p
			}
			hit := p == refused
			if hit {
				hits++
			}
			mu.Unlock()
			if hit {
				w.WriteHeader(401)
				return
			}
		}
		fake(w, r)
	})
	if _, err := Extract(context.Background(), c, int(d["user"].(map[string]any)["id"].(float64)), func(float64) {}, func() time.Time { return goldenNow }); err != nil {
		t.Fatal(err)
	}
	if hits == 0 {
		t.Fatal("no contact was refused")
	}
}
