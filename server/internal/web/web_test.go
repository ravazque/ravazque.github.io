package web

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"ravazque.info/server/internal/app"
)

const secret = "0123456789abcdef0123456789abcdef-test"

func settings() app.Settings {
	return app.Settings{BaseURL: "https://localhost", FTUID: "u1", FTSecret: "s1", OAuthApp: 1, SessionSecret: secret,
		CooldownS: 3600, CacheS: 3600, SessionS: 604800, InsecureCookies: true, ContactEmail: "c@example.invalid",
		ControllerName: "Test", OwnerLogin: "tmidway"}
}

// fake42 answers sign-in: the token exchange, /v2/me and the coalitions.
type fake42 struct {
	me       map[string]any
	requests atomic.Int64
}

func (f *fake42) handler(w http.ResponseWriter, r *http.Request) {
	f.requests.Add(1)
	switch {
	case r.URL.Path == "/oauth/token":
		json.NewEncoder(w).Encode(map[string]any{"access_token": "SECRET-USER-TOKEN", "expires_in": 7200})
	case r.URL.Path == "/v2/me":
		json.NewEncoder(w).Encode(f.me)
	case strings.HasSuffix(r.URL.Path, "/coalitions"):
		w.Write([]byte(`[{"slug":"zefiria","color":"#E39F0B","name":"Zefiria"}]`))
	default:
		w.WriteHeader(404) // the first extraction fails at once (no retries): nothing here depends on it
	}
}

func student(id float64, login string) map[string]any {
	return map[string]any{"id": id, "login": login, "displayname": "T " + login, "staff?": false, "active?": true,
		"image":        map[string]any{"versions": map[string]any{"medium": "https://cdn.intra.42.fr/users/x.jpg"}},
		"campus_users": []any{map[string]any{"campus_id": 22.0, "is_primary": true}},
		"cursus_users": []any{map[string]any{"cursus_id": 21.0, "begin_at": "2025-01-01T07:42:00.000Z", "end_at": nil, "grade": nil}}}
}

type env struct {
	srv  *httptest.Server
	s    *Server
	f    *fake42
	jar  http.CookieJar
	hc   *http.Client
	csrf string
}

func newEnv(t *testing.T, mod func(*app.Settings)) *env {
	t.Helper()
	f := &fake42{me: student(990002, "tmidway")}
	api := httptest.NewServer(http.HandlerFunc(f.handler))
	t.Cleanup(api.Close)
	st := settings()
	if mod != nil {
		mod(&st)
	}
	static := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>spa</title>")}, "assets/app.js": {Data: []byte("1")}}
	s := New(st, static, Options{APIBase: api.URL, CDN: "https://cdn.intra.42.fr/", Now: time.Now})
	t.Cleanup(s.Close)
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	hc := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &env{srv: srv, s: s, f: f, jar: jar, hc: hc}
}

func (e *env) do(t *testing.T, method, path string, body io.Reader, hdr map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, e.srv.URL+path, body)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	if e.csrf != "" && method == "POST" && req.Header.Get("X-CSRF-Token") == "" {
		req.Header.Set("X-CSRF-Token", e.csrf)
	}
	r, err := e.hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func readAll(r *http.Response) string {
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	return string(b)
}

// signIn goes through /auth/login and /auth/callback and keeps the CSRF token of the session.
func (e *env) signIn(t *testing.T) *http.Response {
	t.Helper()
	r := e.do(t, "GET", "/auth/login?accept=1", nil, nil)
	loc, _ := url.Parse(r.Header.Get("Location"))
	state := loc.Query().Get("state")
	r = e.do(t, "GET", "/auth/callback?code=C&state="+state, nil, nil)
	var sess struct {
		User struct{ CSRF string } `json:"user"`
	}
	json.Unmarshal([]byte(readAll(e.do(t, "GET", "/api/session", nil, nil))), &sess)
	e.csrf = sess.User.CSRF
	return r
}

func (e *env) seed(t *testing.T, uid int, file string) {
	t.Helper()
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	e.s.Store.SaveRaw(uid, raw)
	e.s.Store.SetStatus(uid, app.Status{State: "done", Progress: 1, Last: time.Now().UTC().Format(time.RFC3339)})
}

func TestHealthUICSSAndSPA(t *testing.T) {
	e := newEnv(t, nil)
	if r := e.do(t, "GET", "/healthz", nil, nil); r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	if r := e.do(t, "GET", "/ui.css", nil, nil); r.StatusCode != 200 || !strings.Contains(readAll(r), "--accent") {
		t.Fatal("ui.css")
	}
	for _, p := range []string{"/", "/app", "/app/projects", "/privacy", "/refused"} {
		r := e.do(t, "GET", p, nil, nil)
		if body := readAll(r); r.StatusCode != 200 || !strings.Contains(body, "<title>spa") {
			t.Fatalf("%s: %d %s", p, r.StatusCode, body)
		}
		if csp := r.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'self'") || r.Header.Get("X-Frame-Options") != "DENY" ||
			r.Header.Get("Cross-Origin-Opener-Policy") != "same-origin" || !strings.Contains(r.Header.Get("Permissions-Policy"), "camera=()") {
			t.Fatalf("%s: headers %v", p, r.Header)
		}
	}
	if r := e.do(t, "GET", "/assets/app.js", nil, nil); !strings.Contains(r.Header.Get("Cache-Control"), "immutable") {
		t.Fatal("assets are immutable")
	}
	if r := e.do(t, "GET", "/api/nope", nil, nil); r.StatusCode != 404 {
		t.Fatal("unknown API path")
	}
}

func TestLoginNeedsConsent(t *testing.T) {
	e := newEnv(t, nil)
	if r := e.do(t, "GET", "/auth/login", nil, nil); r.StatusCode != 303 || r.Header.Get("Location") != "/?error=consent" {
		t.Fatal(r.StatusCode, r.Header.Get("Location"))
	}
	r := e.do(t, "GET", "/auth/login?accept=1", nil, nil)
	loc, _ := url.Parse(r.Header.Get("Location"))
	if loc.Query().Get("client_id") != "u1" || loc.Query().Get("redirect_uri") != "https://localhost/auth/callback" || loc.Query().Get("state") == "" {
		t.Fatal(loc)
	}
}

func TestCallbackSignsInWithoutLeakingTheToken(t *testing.T) {
	e := newEnv(t, nil)
	r := e.signIn(t)
	if r.StatusCode != 303 || r.Header.Get("Location") != "/app" {
		t.Fatal(r.StatusCode, r.Header.Get("Location"))
	}
	var sessCookie *http.Cookie
	for _, c := range r.Cookies() {
		if c.Name == app.SessionCookie {
			sessCookie = c
		}
		if strings.Contains(c.Value, "SECRET-USER-TOKEN") {
			t.Fatal("the user token reached a cookie")
		}
	}
	if sessCookie == nil || !sessCookie.HttpOnly || sessCookie.Path != "/" || sessCookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie %+v", sessCookie)
	}
	body := readAll(e.do(t, "GET", "/api/session", nil, nil))
	if strings.Contains(body, "SECRET-USER-TOKEN") || !strings.Contains(body, `"login":"tmidway"`) || !strings.Contains(body, `"owner":true`) {
		t.Fatal(body)
	}
	e.s.Jobs.Drain()
	if st := readAll(e.do(t, "GET", "/api/me/status", nil, nil)); !strings.Contains(st, `"state":"failed"`) {
		t.Fatalf("the first extraction was queued and ran: %s", st)
	}
}

func TestCallbackRefusesAndLimits(t *testing.T) {
	e := newEnv(t, nil)
	e.f.me = student(5, "staffer")
	e.f.me["staff?"] = true
	if r := e.signIn(t); r.Header.Get("Location") != "/refused?reason=staff" {
		t.Fatal(r.Header.Get("Location"))
	}
	if r := e.do(t, "GET", "/auth/callback?code=C&state=forged", nil, nil); r.StatusCode != 400 {
		t.Fatal(r.StatusCode)
	}
	e2 := newEnv(t, nil)
	var last int
	for range 11 {
		r := e2.do(t, "GET", "/auth/login?accept=1", nil, nil)
		loc, _ := url.Parse(r.Header.Get("Location"))
		last = e2.do(t, "GET", "/auth/callback?code=C&state="+loc.Query().Get("state"), nil, nil).StatusCode
	}
	if last != 429 {
		t.Fatalf("11th callback: %d", last)
	}
}

func TestAPINeedsSessionAndCSRF(t *testing.T) {
	e := newEnv(t, nil)
	if r := e.do(t, "GET", "/api/me/status", nil, nil); r.StatusCode != 401 {
		t.Fatal(r.StatusCode)
	}
	e.signIn(t)
	for _, p := range []string{"/api/me/refresh", "/api/me/delete", "/api/me/publish", "/api/me/consent", "/auth/logout", "/api/me/report"} {
		if r := e.do(t, "POST", p, nil, map[string]string{"X-CSRF-Token": "wrong"}); r.StatusCode != 403 {
			t.Fatalf("%s: %d", p, r.StatusCode)
		}
	}
}

func TestViewTodayAndConsent(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/mid.report.json")
	r := e.do(t, "GET", "/api/me/view?period=all", nil, nil)
	var v map[string]any
	json.Unmarshal([]byte(readAll(r)), &v)
	if r.StatusCode != 200 || v["period"] != "all" || v["report"] == nil || v["derive"] == nil || v["layout"] == nil || v["network"] == nil {
		t.Fatalf("%d %v", r.StatusCode, keys(v))
	}
	if r := e.do(t, "GET", "/api/me/view?period=bogus", nil, nil); r.StatusCode != 200 || !strings.Contains(readAll(r), `"period":"student"`) {
		t.Fatal("unknown period falls back to the default")
	}
	r = e.do(t, "GET", "/api/me/today", nil, nil)
	if body := readAll(r); r.StatusCode != 200 || !strings.Contains(body, `"week"`) || !strings.Contains(body, `"bonus"`) {
		t.Fatal(body)
	}
	e.s.M.Delete(e.s.M.Keys("consent:*")...)
	if r := e.do(t, "GET", "/api/me/view", nil, nil); r.StatusCode != 409 {
		t.Fatalf("no consent: %d", r.StatusCode)
	}
	if r := e.do(t, "POST", "/api/me/consent", strings.NewReader(`{"accept":true}`), nil); r.StatusCode != 204 {
		t.Fatal(r.StatusCode)
	}
	if r := e.do(t, "GET", "/api/me/view", nil, nil); r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
}

func keys(m map[string]any) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestReportRoundTripNeedsTheSignature(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/new.report.json")
	r := e.do(t, "GET", "/api/me/report.json", nil, nil)
	raw, sig := readAll(r), r.Header.Get("X-Report-Sig")
	if r.StatusCode != 200 || sig == "" {
		t.Fatal(r.StatusCode)
	}
	e.s.Store.DropReport(990002)
	if r := e.do(t, "POST", "/api/me/report", strings.NewReader(raw+" "), map[string]string{"X-Report-Sig": sig}); r.StatusCode != 400 {
		t.Fatal("tampered bytes accepted")
	}
	if r := e.do(t, "POST", "/api/me/report", strings.NewReader(raw), map[string]string{"X-Report-Sig": sig}); r.StatusCode != 204 {
		t.Fatal(r.StatusCode)
	}
	if e.s.Store.LoadRaw(990002) == nil {
		t.Fatal("not restored")
	}
}

func TestDeleteLeavesNothingNamingTheUser(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/new.report.json")
	r := e.do(t, "POST", "/api/me/delete", nil, nil)
	if r.StatusCode != 204 || !strings.Contains(r.Header.Get("Clear-Site-Data"), "storage") {
		t.Fatal(r.StatusCode)
	}
	for _, k := range e.s.M.Keys("*") {
		if strings.Contains(k, "990002") || strings.HasPrefix(k, "sess:") {
			t.Fatalf("left: %s", k)
		}
	}
	if r := e.do(t, "GET", "/api/me/status", nil, nil); r.StatusCode != 401 {
		t.Fatal("session survived")
	}
}

func TestOptedOutStudentsAreHidden(t *testing.T) {
	e := newEnv(t, func(s *app.Settings) { s.OptoutLogins = []string{"peer03", "tmidway"} })
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/mid.report.json")
	body := readAll(e.do(t, "GET", "/api/me/view?period=all", nil, nil))
	if strings.Contains(body, `"peer03"`) || strings.Contains(body, "Peer 03") {
		t.Fatal("an opted-out student is visible")
	}
	if !strings.Contains(body, `"tmidway"`) {
		t.Fatal("the viewer is never hidden")
	}
}

func TestPublishOwnerOnlyAndWhitelisted(t *testing.T) {
	var put []byte
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.WriteHeader(404)
			return
		}
		put, _ = io.ReadAll(r.Body)
		w.Write([]byte(`{"commit":{"html_url":"https://github.example/c/1"}}`))
	}))
	defer gh.Close()
	e := newEnv(t, func(s *app.Settings) { s.GithubToken, s.GithubRepo = "gh-token", "o/r" })
	e.s.githubAPI = gh.URL
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/mid.report.json")
	r := e.do(t, "POST", "/api/me/publish", nil, nil)
	if body := readAll(r); r.StatusCode != 200 || !strings.Contains(body, "github.example") {
		t.Fatal(r.StatusCode, body)
	}
	var b struct{ Content string }
	json.Unmarshal(put, &b)
	snap := string(decodeB64(b.Content))
	for _, bad := range []string{"@", "c2r", "c3r", "peer", "990002", "hours", "image", "email", "location"} {
		if strings.Contains(snap, bad) {
			t.Fatalf("snapshot carries %q", bad)
		}
	}
	other := newEnv(t, func(s *app.Settings) { s.GithubToken, s.GithubRepo, s.OwnerLogin = "gh", "o/r", "someoneelse" })
	other.signIn(t)
	if r := other.do(t, "POST", "/api/me/publish", nil, nil); r.StatusCode != 403 {
		t.Fatal(r.StatusCode)
	}
	if r := other.do(t, "GET", "/api/stats", nil, nil); r.StatusCode != 403 {
		t.Fatal("stats are the owner's")
	}
	if r := e.do(t, "GET", "/api/stats", nil, nil); r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
}

func TestDevLoginOnlyInDevMode(t *testing.T) {
	e := newEnv(t, nil)
	if r := e.do(t, "GET", "/dev/login", nil, nil); r.StatusCode == 303 {
		t.Fatal("dev login outside dev mode")
	}
	dir := t.TempDir()
	raw, _ := os.ReadFile("../../core/testdata/golden/mid.report.json")
	os.WriteFile(dir+"/data.json", raw, 0o600)
	var test map[string]any
	traw, _ := os.ReadFile("../../core/testdata/golden/new.report.json")
	json.Unmarshal(traw, &test)
	test["test_profile"] = 990001
	traw, _ = json.Marshal(test)
	os.WriteFile(dir+"/test-new.json", traw, 0o600)
	d := newEnv(t, func(s *app.Settings) { s.DevReport, s.DevUID = dir+"/data.json", 990002 })
	if r := d.do(t, "GET", "/dev/login?as=tnova", nil, nil); r.StatusCode != 303 {
		t.Fatal(r.StatusCode)
	}
	if body := readAll(d.do(t, "GET", "/api/session", nil, nil)); !strings.Contains(body, `"login":"tnova"`) {
		t.Fatal(body)
	}
	if body := readAll(d.do(t, "GET", "/api/me/view", nil, nil)); !strings.Contains(body, `"tnova"`) {
		t.Fatal("the test profile's report")
	}
	var buf bytes.Buffer
	buf.WriteString("")
}

func TestBrowserCopyHidesOptedOutStudents(t *testing.T) {
	e := newEnv(t, func(s *app.Settings) { s.OptoutLogins = []string{"peer03"} })
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/mid.report.json")
	r := e.do(t, "GET", "/api/me/report.json", nil, nil)
	raw, sig := readAll(r), r.Header.Get("X-Report-Sig")
	if strings.Contains(raw, `"peer03"`) || strings.Contains(raw, "Peer 03") {
		t.Fatal("the browser's copy carries an opted-out student")
	}
	e.s.Store.DropReport(990002)
	if r := e.do(t, "POST", "/api/me/report", strings.NewReader(raw), map[string]string{"X-Report-Sig": sig}); r.StatusCode != 204 {
		t.Fatalf("the hidden copy comes back: %d", r.StatusCode)
	}
}

func TestDeleteEndsEverySessionAndRefusesOldCopies(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/new.report.json")
	other := newEnvSharing(t, e) // a second device signed in as the same user
	r := other.do(t, "GET", "/api/me/report.json", nil, nil)
	raw, sig := readAll(r), r.Header.Get("X-Report-Sig")
	if r := e.do(t, "POST", "/api/me/delete", nil, nil); r.StatusCode != 204 {
		t.Fatal(r.StatusCode)
	}
	if r := other.do(t, "GET", "/api/me/status", nil, nil); r.StatusCode != 401 {
		t.Fatalf("the other device's session survived: %d", r.StatusCode)
	}
	sid := e.s.Sessions.Create(app.Session{ID: 990002, Login: "tmidway"})
	_ = sid
	u, _ := e.s.Sessions.Get(sid)
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/me/report", strings.NewReader(raw))
	req.Header.Set("X-Report-Sig", sig)
	req.Header.Set("X-CSRF-Token", u.CSRF)
	req.AddCookie(&http.Cookie{Name: app.SessionCookie, Value: sid})
	res, _ := http.DefaultClient.Do(req)
	if res.StatusCode != 400 {
		t.Fatalf("a copy from before the deletion was taken back: %d", res.StatusCode)
	}
	for _, k := range e.s.M.Keys("*") {
		if strings.HasPrefix(k, "sess:") {
			raw, _ := e.s.M.Get(k)
			if strings.Contains(string(raw), "tmidway") && !strings.Contains(k, sid) {
				t.Fatalf("a session naming the user is left: %s", k)
			}
		}
	}
}

func TestAvatarIsCachedAndOnlyAnImage(t *testing.T) {
	var cdn atomic.Int64
	e := newEnv(t, nil)
	cdnSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cdn.Add(1)
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<script>x</script>"))
	}))
	defer cdnSrv.Close()
	e.s.API.CDN = cdnSrv.URL + "/"
	sid := e.s.Sessions.Create(app.Session{ID: 5, Login: "tnova", Image: cdnSrv.URL + "/users/x.jpg"})
	e.jar.SetCookies(mustURL(e.srv.URL), []*http.Cookie{{Name: app.SessionCookie, Value: sid, Path: "/"}})
	for range 3 {
		r := e.do(t, "GET", "/avatar/me", nil, nil)
		if ct := r.Header.Get("Content-Type"); ct != "image/jpeg" {
			t.Fatalf("content type %q", ct)
		}
		readAll(r)
	}
	if cdn.Load() != 1 {
		t.Fatalf("the CDN was asked %d times", cdn.Load())
	}
}

func mustURL(s string) *url.URL { u, _ := url.Parse(s); return u }

// newEnvSharing: another browser against the same server, signed in as the same user.
func newEnvSharing(t *testing.T, e *env) *env {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	o := &env{srv: e.srv, s: e.s, f: e.f, jar: jar, hc: &http.Client{Jar: jar, CheckRedirect: e.hc.CheckRedirect}}
	o.signIn(t)
	return o
}

func TestTestProfilesNeverReachThe42API(t *testing.T) {
	dir := t.TempDir()
	var test map[string]any
	traw, _ := os.ReadFile("../../core/testdata/golden/new.report.json")
	json.Unmarshal(traw, &test)
	test["test_profile"] = 990001
	traw, _ = json.Marshal(test)
	os.WriteFile(dir+"/test-new.json", traw, 0o600)
	d := newEnv(t, func(s *app.Settings) { s.DevReport, s.DevUID = dir+"/data.json", 990002 })
	d.do(t, "GET", "/dev/login?as=tnova", nil, nil)
	var sess struct{ User struct{ CSRF string } }
	json.Unmarshal([]byte(readAll(d.do(t, "GET", "/api/session", nil, nil))), &sess)
	d.csrf = sess.User.CSRF
	before := d.f.requests.Load()
	d.do(t, "POST", "/api/me/refresh", nil, nil)
	d.do(t, "POST", "/api/me/delete", nil, nil)
	d.do(t, "GET", "/dev/login?as=tnova", nil, nil) // back after deleting: the profile is there again
	json.Unmarshal([]byte(readAll(d.do(t, "GET", "/api/session", nil, nil))), &sess)
	d.csrf = sess.User.CSRF
	d.do(t, "GET", "/api/me/status?kick=1", nil, nil)
	d.s.Jobs.Drain()
	if n := d.f.requests.Load() - before; n != 0 {
		t.Fatalf("a test profile sent %d requests to 42", n)
	}
	if r := d.do(t, "GET", "/api/me/view", nil, nil); r.StatusCode != 200 {
		t.Fatalf("the test profile's report after deleting: %d", r.StatusCode)
	}
}
