// Command devtools makes the files make dev and make snapshot use:
//
//	devtools profiles DIR       the synthetic test profiles (test-*.json), moved to today, from the fake 42 API
//	devtools real DIR           the real profiles of DEV_REAL_LOGINS (real-<login>.json) not saved yet (~120 requests each)
//	devtools fetch UID OUT      one real extraction with the apps in the environment (about 120 requests)
//	devtools snapshot IN OUT    the public snapshot the publish button would send, from a saved report
//
// profiles never reaches the 42 API; real and fetch do, and only when the owner runs make dev-real or make preview.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"ravazque.info/server/api42"
	"ravazque.info/server/api42/fake42"
	"ravazque.info/server/core"
	"ravazque.info/server/internal/app"
	"ravazque.info/server/internal/web"
)

// the moment the synthetic datasets were written for (server/core/testdata/api)
var datasetNow = time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)

// Each test profile is one synthetic dataset (base), as written or turned into another kind of student: a new login
// and name, the 42cursus grade (Transcender), and the Common Core projects started from python on (dataset time)
// moved to the Python track.
var profiles = []struct {
	key, base   string
	uid         int
	login, name string
	grade       string
	python      string
}{
	{"new", "new", 990001, "", "", "", ""},
	{"mid", "mid", 990002, "", "", "", ""},
	{"alumni", "alumni", 990003, "", "", "", ""},
	{"outer", "alumni", 990004, "touter", "Olga Outer", "Transcender", ""},
	{"python", "mid", 990005, "tpython", "Pia Python", "", "2000-01-01"},
	{"pyouter", "alumni", 990006, "tpyouter", "Pau Pyouter", "Transcender", "2000-01-01"},
	{"migrated", "mid", 990007, "tmigrant", "Mia Migrant", "", "2026-02-11"},
}

// pythonTrack: the C project each Python one stands in for, rank by rank (server/core/data/tracks.json); the names of
// the shared ones and the exams stay. shortcut: the Python names are guesses, check them against the intra if they matter.
var pythonTrack = map[string][2]string{
	"born2beroot": {"42next-push_swap", "push_swap"}, "push_swap": {"42next-born2beroot", "Born2beroot"},
	"pipex": {"python-module-00", "Python Module 00"}, "so_long": {"python-module-01", "Python Module 01"},
	"exam-rank-02": {"42next-exam-rank-02", ""}, "philosophers": {"call-me-maybe", "Call Me Maybe"},
	"minishell": {"codexion", "Codexion"}, "exam-rank-03": {"42next-exam-rank-03", ""},
	"cub3d": {"pac-man", "Pac-Man"}, "netpractice": {"rag-against-the-machine", "RAG Against the Machine"},
	"cpp-module-00": {"python-module-02", "Python Module 02"}, "cpp-module-01": {"python-module-03", "Python Module 03"},
	"cpp-module-02": {"python-module-04", "Python Module 04"}, "cpp-module-03": {"python-module-05", "Python Module 05"},
	"cpp-module-04": {"python-module-06", "Python Module 06"}, "exam-rank-04": {"42next-exam-rank-04", ""},
	"cpp-module-05": {"python-module-07", "Python Module 07"}, "cpp-module-06": {"python-module-08", "Python Module 08"},
	"cpp-module-07": {"python-module-09", "Python Module 09"}, "cpp-module-08": {"python-module-10", "Python Module 10"},
	"cpp-module-09": {"a-maze-ing", "A-Maze-ing"}, "inception": {"agent-smith", "Agent Smith"},
	"webserv": {"tree_nity", "Tree_nity"}, "exam-rank-05": {"42next-exam-rank-05", ""},
	"exam-rank-06": {"42next-exam-rank-06", ""},
}

// become turns one dataset into another profile (see profiles); the dataset's own times, before shift.
func become(data map[string]any, login, name, grade, python string) map[string]any {
	user := data["user"].(map[string]any)
	if login != "" {
		old := user["login"].(string)
		b, _ := json.Marshal(data)
		json.Unmarshal(bytes.ReplaceAll(b, []byte(old), []byte(login)), &data)
		user = data["user"].(map[string]any)
		first, last, _ := strings.Cut(name, " ")
		for k, v := range map[string]string{"first_name": first, "usual_first_name": first, "last_name": last, "usual_full_name": name, "displayname": name} {
			user[k] = v
		}
	}
	if grade != "" {
		user["alumni?"] = false
		for _, c := range user["cursus_users"].([]any) {
			if c := c.(map[string]any); c["cursus_id"] == float64(core.MainCursus) {
				c["grade"] = grade
			}
		}
	}
	if python == "" {
		return data
	}
	moved := map[float64]bool{}
	for _, pu := range data["projects_users"].([]any) {
		if pu := pu.(map[string]any); pu["created_at"].(string) >= python {
			moved[pu["project"].(map[string]any)["id"].(float64)] = true
		}
	}
	var walk func(any)
	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			if slug, ok := x["slug"].(string); ok && moved[asFloat(x["id"])] {
				if py, ok := pythonTrack[slug]; ok {
					x["slug"] = py[0]
					if py[1] != "" {
						x["name"] = py[1]
					}
				}
			}
			for _, e := range x {
				walk(e)
			}
		case []any:
			for _, e := range x {
				walk(e)
			}
		}
	}
	walk(data)
	return data
}

func asFloat(v any) float64 { f, _ := v.(float64); return f }

func main() {
	loadEnv("../.env") // make runs this from server/
	if len(os.Args) < 3 {
		usage()
	}
	var err error
	switch os.Args[1] {
	case "profiles":
		err = makeProfiles(os.Args[2])
	case "real":
		err = fetchReal(os.Args[2])
	case "fetch":
		if len(os.Args) != 4 {
			usage()
		}
		err = fetch(os.Args[2], os.Args[3])
	case "snapshot":
		if len(os.Args) != 4 {
			usage()
		}
		err = snapshot(os.Args[2], os.Args[3])
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "devtools:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: devtools profiles DIR | real DIR | fetch UID OUT | snapshot IN OUT")
	os.Exit(2)
}

var stamp = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`)
var dateKey = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// shift moves every timestamp (and every object key that is a date) by d, keeping each one's written form.
func shift(v any, d time.Duration) any {
	switch x := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, e := range x {
			if dateKey.MatchString(k) {
				if t, err := time.Parse("2006-01-02", k); err == nil {
					k = t.Add(d).Format("2006-01-02")
				}
			}
			out[k] = shift(e, d)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = shift(e, d)
		}
		return out
	case string:
		if !stamp.MatchString(x) {
			return x
		}
		t, err := time.Parse(time.RFC3339Nano, x)
		if err != nil {
			return x
		}
		layout := "2006-01-02T15:04:05"
		if m := stamp.FindStringSubmatch(x); m[1] != "" {
			layout += "." + "000000000"[:len(m[1])-1]
		}
		if x[len(x)-1] == 'Z' {
			return t.Add(d).UTC().Format(layout + "Z")
		}
		return t.Add(d).Format(layout + "-07:00")
	}
	return v
}

func makeProfiles(dir string) error {
	root, err := moduleDir()
	if err != nil {
		return err
	}
	now := time.Now().UTC().Truncate(time.Minute)
	d := now.Sub(datasetNow)
	for _, p := range profiles {
		raw, err := os.ReadFile(filepath.Join(root, "core", "testdata", "api", p.base+".json"))
		if err != nil {
			return err
		}
		var data map[string]any
		if err := json.Unmarshal(raw, &data); err != nil {
			return err
		}
		data = shift(become(data, p.login, p.name, p.grade, p.python), d).(map[string]any)
		srv := httptest.NewServer(fake42.Handler(data, func(string) {}))
		lim := app.NewLimiter(1, time.Now, nil)
		lim.PerSecond(1000)
		c := api42.New([]api42.App{{UID: "fake", Secret: "fake"}}, 0, "", lim, srv.Client())
		c.Base = srv.URL
		uid := int(data["user"].(map[string]any)["id"].(float64)) // the base's: fake42 answers for it
		report, err := api42.Extract(context.Background(), c, uid, func(float64) {}, func() time.Time { return now })
		srv.Close()
		if err != nil {
			return fmt.Errorf("%s: %w", p.key, err)
		}
		report.Set("test_profile", p.uid) // never a real student: dev mode signs in as it under this id
		out, _ := json.Marshal(report)
		if err := os.WriteFile(filepath.Join(dir, "test-"+p.key+".json"), out, 0o600); err != nil {
			return err
		}
		fmt.Printf("%s/test-%s.json · %s\n", dir, p.key, report.Obj("periods").Obj("all").Obj("profile").S("login"))
	}
	return nil
}

// moduleDir finds server/ from the working directory (make runs this from the repository root or from server/).
func moduleDir() (string, error) {
	for _, c := range []string{".", "server", "../.."} { // ../..: go test runs in cmd/devtools
		if _, err := os.Stat(filepath.Join(c, "go.mod")); err == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("run from the repository root or server/")
}

// client42 talks to the real 42 API with the apps in the environment.
func client42() (*api42.Client, error) {
	apps := app.SettingsFromEnv().Apps()
	if apps[0].UID == "" {
		return nil, fmt.Errorf("FT_UID and FT_SECRET are not set (the root .env)")
	}
	keys := make([]api42.App, len(apps))
	for i, a := range apps {
		keys[i] = api42.App{UID: a.UID, Secret: a.Secret}
	}
	return api42.New(keys, 0, "", app.NewLimiter(len(apps), time.Now, nil), nil), nil
}

func fetch(uidArg, out string) error {
	uid, err := strconv.Atoi(uidArg)
	if err != nil || uid <= 0 {
		return fmt.Errorf("UID must be a 42 user id")
	}
	c, err := client42()
	if err != nil {
		return err
	}
	return save(c, uid, out, false)
}

// save writes one real extraction; dev marks it with its id so make dev-real signs in as it.
func save(c *api42.Client, uid int, out string, dev bool) error {
	before, started := c.Requests(), time.Now()
	report, err := api42.Extract(context.Background(), c, uid, func(f float64) { fmt.Fprintf(os.Stderr, "\r%3.0f%%", 100*f) }, time.Now)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return err
	}
	if dev {
		report.Set("test_profile", uid)
	}
	b, _ := json.Marshal(report)
	if err := os.WriteFile(out, b, 0o600); err != nil {
		return err
	}
	fmt.Printf("%s: %d requests in %.0f s\n", out, c.Requests()-before, time.Since(started).Seconds())
	return nil
}

// fetchReal saves the real profiles of DEV_REAL_LOGINS (comma-separated, the root .env) missing from dir: one
// request finds their ids, then one extraction each. Delete a file to fetch it again.
func fetchReal(dir string) error {
	var missing []string
	for _, l := range strings.Split(os.Getenv("DEV_REAL_LOGINS"), ",") {
		if l = strings.TrimSpace(l); l != "" {
			if _, err := os.Stat(filepath.Join(dir, "real-"+l+".json")); err != nil {
				missing = append(missing, l)
			}
		}
	}
	if len(missing) == 0 {
		return nil
	}
	c, err := client42()
	if err != nil {
		return err
	}
	found, err := c.Get(context.Background(), "/v2/users", url.Values{"filter[login]": {strings.Join(missing, ",")}, "page[size]": {"100"}})
	if err != nil {
		return err
	}
	ids := map[string]int{}
	for _, u := range asList(found) {
		u := u.(map[string]any)
		ids[u["login"].(string)] = int(asFloat(u["id"]))
	}
	var failed []string
	for _, l := range missing {
		err := fmt.Errorf("no such login")
		if ids[l] > 0 {
			err = save(c, ids[l], filepath.Join(dir, "real-"+l+".json"), true)
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", l, err)
			failed = append(failed, l)
		}
	}
	if failed != nil {
		return fmt.Errorf("not saved: %s", strings.Join(failed, ", "))
	}
	return nil
}

func asList(v any) []any { l, _ := v.([]any); return l }

func snapshot(in, out string) error {
	raw, err := os.ReadFile(in)
	if err != nil {
		return err
	}
	report, err := core.ParseOrdered(raw)
	if err != nil {
		return err
	}
	info, _ := os.Stat(in)
	b, _ := json.MarshalIndent(web.Snapshot(report, info.ModTime().UTC().Format(time.RFC3339)), "", " ")
	return os.WriteFile(out, append(b, '\n'), 0o644)
}
