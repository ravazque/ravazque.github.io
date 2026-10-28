// Package fake42 is a stand-in for the 42 API built from one synthetic profile's data: the tests and the dev test
// profiles run the real extraction against it. Nothing here reaches the network.
package fake42

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Handler answers the extraction's requests from one synthetic profile, as v1's web/scripts/test_profiles.FakeApi;
// unexpected requests go to miss and get a 404.
func Handler(d map[string]any, miss func(path string)) http.HandlerFunc {
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
			json.NewEncoder(w).Encode(map[string]any{"access_token": "T", "expires_in": 7200})
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
			miss(p)
			w.WriteHeader(404)
			return
		}
		if l, ok := v.([]any); ok { // the whole list in one answer, as the v1 fake: request counts stay comparable
			w.Header().Set("X-Total", strconv.Itoa(len(l)))
		}
		json.NewEncoder(w).Encode(v)
	}
}
