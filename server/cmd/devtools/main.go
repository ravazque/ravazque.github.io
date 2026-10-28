// Command devtools makes the files make dev and make snapshot use:
//
//	devtools profiles DIR       the synthetic test profiles (test-*.json), moved to today, from the fake 42 API
//	devtools fetch UID OUT      one real extraction with the apps in the environment (about 120 requests)
//	devtools snapshot IN OUT    the public snapshot the publish button would send, from a saved report
//
// profiles never reaches the 42 API; fetch does, and only when the owner runs make build or make preview.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"

	"ravazque.info/server/api42"
	"ravazque.info/server/api42/fake42"
	"ravazque.info/server/core"
	"ravazque.info/server/internal/app"
	"ravazque.info/server/internal/web"
)

// the moment the synthetic datasets were written for (server/core/testdata/api)
var datasetNow = time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)

var profiles = []struct {
	key string
	uid int
}{{"new", 990001}, {"mid", 990002}, {"alumni", 990003}}

func main() {
	if len(os.Args) < 3 {
		usage()
	}
	var err error
	switch os.Args[1] {
	case "profiles":
		err = makeProfiles(os.Args[2])
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
	fmt.Fprintln(os.Stderr, "usage: devtools profiles DIR | fetch UID OUT | snapshot IN OUT")
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
		raw, err := os.ReadFile(filepath.Join(root, "core", "testdata", "api", p.key+".json"))
		if err != nil {
			return err
		}
		var data map[string]any
		if err := json.Unmarshal(raw, &data); err != nil {
			return err
		}
		data = shift(data, d).(map[string]any)
		srv := httptest.NewServer(fake42.Handler(data, func(string) {}))
		lim := app.NewLimiter(1, time.Now, nil)
		lim.PerSecond(1000)
		c := api42.New([]api42.App{{UID: "fake", Secret: "fake"}}, 0, "", lim, srv.Client())
		c.Base = srv.URL
		report, err := api42.Extract(context.Background(), c, p.uid, func(float64) {}, func() time.Time { return now })
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
	for _, c := range []string{".", "server"} {
		if _, err := os.Stat(filepath.Join(c, "go.mod")); err == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("run from the repository root or server/")
}

func fetch(uidArg, out string) error {
	uid, err := strconv.Atoi(uidArg)
	if err != nil || uid <= 0 {
		return fmt.Errorf("UID must be a 42 user id")
	}
	s := app.SettingsFromEnv()
	apps := s.Apps()
	if apps[0].UID == "" {
		return fmt.Errorf("FT_UID and FT_SECRET are not set (the root .env)")
	}
	keys := make([]api42.App, len(apps))
	for i, a := range apps {
		keys[i] = api42.App{UID: a.UID, Secret: a.Secret}
	}
	c := api42.New(keys, 0, "", app.NewLimiter(len(apps), time.Now, nil), nil)
	started := time.Now()
	report, err := api42.Extract(context.Background(), c, uid, func(f float64) { fmt.Fprintf(os.Stderr, "\r%3.0f%%", 100*f) }, time.Now)
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return err
	}
	b, _ := json.Marshal(report)
	if err := os.WriteFile(out, b, 0o600); err != nil {
		return err
	}
	fmt.Printf("%s: %d requests in %.0f s\n", out, c.Requests(), time.Since(started).Seconds())
	return nil
}

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
