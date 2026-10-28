package api42

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"ravazque.info/server/core"
)

var goldenNow = time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)

// fakeAPI answers the extraction's requests from one synthetic profile, as v1's web/scripts/test_profiles.FakeApi.
func fakeAPI(t *testing.T, d map[string]any) http.HandlerFunc {
	uid := strconv.Itoa(int(d["user"].(map[string]any)["id"].(float64)))
	lists := map[string]string{"scale_teams/as_corrected": "evals_received", "scale_teams/as_corrector": "evals_given", "correction_point_historics": "correction_points"}
	userPath := regexp.MustCompile(`^/v2/users/` + uid + `/(.+)$`)
	contact := regexp.MustCompile(`^/v2/users/(\d+)/scale_teams/as_corrector$`)
	scores := regexp.MustCompile(`^/v2/coalitions_users/\d+/scores$`)
	ids := func(s string) map[float64]bool {
		out := map[float64]bool{}
		for _, x := range strings.Split(s, ",") {
			n, _ := strconv.Atoi(x)
			out[float64(n)] = true
		}
		return out
	}
	filter := func(key, field, csv string) []any {
		want := ids(csv)
		out := []any{}
		for _, x := range d[key].([]any) {
			if want[x.(map[string]any)[field].(float64)] {
				out = append(out, x)
			}
		}
		return out
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		q, p := r.URL.Query(), r.URL.Path
		var v any
		switch {
		case p == "/v2/users/"+uid:
			v = d["user"]
		case p == "/v2/users/"+uid+"/coalitions":
			v = d["coalitions"]
		case userPath.MatchString(p):
			name := userPath.FindStringSubmatch(p)[1]
			if l, ok := lists[name]; ok {
				name = l
			}
			v = d[name]
		case contact.MatchString(p):
			v = d["contact_evals"].(map[string]any)[contact.FindStringSubmatch(p)[1]]
			if v == nil {
				v = []any{}
			}
		case p == "/v2/achievements_users":
			v = d["achievements_users"]
		case p == "/v2/achievements":
			v = filter("achievements", "id", q.Get("filter[id]"))
		case p == "/v2/users":
			v = filter("people", "id", q.Get("filter[id]"))
		case p == "/v2/projects":
			v = d["projects"]
		case p == "/v2/cursus/21/cursus_users":
			if q.Has("range[begin_at]") {
				v = d["promo"]
			} else {
				v = d["cursus_users_batch"]
			}
		case p == "/v2/quests_users":
			v = d["quests_batch"]
		case p == "/v2/feedbacks":
			v = filter("feedbacks_api", "feedbackable_id", q.Get("filter[feedbackable_id]"))
		case p == "/v2/blocs":
			v = d["blocs"]
		case scores.MatchString(p):
			v = d["coalition_scores"]
		case p == "/v2/locations": // a peer is at the same computer all that day, one in five not logged in
			first, _ := time.Parse("2006-01-02T15:04:05Z", strings.Split(q.Get("range[begin_at]"), ",")[0])
			day := first.AddDate(0, 0, 1)
			ordinal := int(day.Unix()/86400) + 719163 // date.toordinal(); a Duration from year 1 overflows
			out := []any{}
			for _, s := range strings.Split(q.Get("filter[user_id]"), ",") {
				i, _ := strconv.Atoi(s)
				if i%5 == 0 {
					continue
				}
				iso := func(t time.Time) string { return t.Format("2006-01-02T15:04:05.000Z") }
				out = append(out, map[string]any{"id": i*1000 + ordinal%1000, "user": map[string]any{"id": i},
					"host": fmt.Sprintf("c%dr%ds%d", 1+i%3, 1+i%14, 1+i%6), "begin_at": iso(day.Add(6 * time.Hour)), "end_at": iso(day.Add(23 * time.Hour))})
			}
			v = out
		default:
			t.Errorf("unexpected request %s", p)
			w.WriteHeader(404)
			return
		}
		if l, ok := v.([]any); ok { // the whole list in one answer, as the v1 fake: request counts stay comparable
			w.Header().Set("X-Total", strconv.Itoa(len(l)))
		}
		json.NewEncoder(w).Encode(v)
	}
}

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
			c, _ := newTestClient(t, fakeAPI(t, d))
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
	c, _ := newTestClient(t, fakeAPI(t, d))
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
	c, _ := newTestClient(t, fakeAPI(t, d))
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
