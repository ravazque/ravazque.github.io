// Package web is the HTTP side: sign-in with 42, the JSON API the browser app reads, and the app itself.
package web

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"ravazque.info/server/api42"
	"ravazque.info/server/core"
	"ravazque.info/server/internal/app"
)

type Options struct {
	APIBase, CDN string // the 42 API and its CDN; tests point them at fakes
	Now          func() time.Time
}

type devLogin struct {
	session app.Session
	test    bool
}

type Server struct {
	S         app.Settings
	M         *app.Memory
	Store     *app.Store
	Sessions  *app.Sessions
	Jobs      *app.Jobs
	Lim       *app.Limiter
	API       *api42.Client
	Stats     *app.Stats
	now       func() time.Time
	mux       *http.ServeMux
	static    fs.FS
	uiCSS     string
	githubAPI string
	gh        *http.Client
	publishMu sync.Mutex
	devLogins map[string]devLogin
	devOrder  []string
	stop      chan struct{}
}

const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; " +
	"connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self' https://*.42.fr"

// New wires the server: memory, limiter, 42 client, queue and routes. static is the built browser app.
func New(s app.Settings, static fs.FS, o Options) *Server {
	if o.Now == nil {
		o.Now = time.Now
	}
	if s.DevReport != "" { // the saved report stays for the whole session instead of an hour
		s.CacheS = 365 * 86400
	}
	m := app.NewMemory(o.Now)
	srv := &Server{S: s, M: m, Store: app.NewStore(m, s, o.Now), Sessions: app.NewSessions(m, s), now: o.Now, static: static,
		githubAPI: "https://api.github.com", gh: &http.Client{Timeout: 15 * time.Second}, stop: make(chan struct{})}
	apps := s.Apps()
	srv.Stats = app.NewStats(len(apps), o.Now)
	srv.Lim = app.NewLimiter(len(apps), o.Now, nil)
	srv.Lim.OnRequest = srv.Stats.Request
	keys := make([]api42.App, len(apps))
	for i, a := range apps {
		keys[i] = api42.App{UID: a.UID, Secret: a.Secret}
	}
	srv.API = api42.New(keys, max(s.OAuthIndex(), 0), s.BaseURL+"/auth/callback", srv.Lim, nil)
	if o.APIBase != "" {
		srv.API.Base = o.APIBase
	}
	if o.CDN != "" {
		srv.API.CDN = o.CDN
	}
	srv.Jobs = app.NewJobs(srv.extractJob, 15*time.Minute)
	if cfg, err := core.LoadUI(); err == nil {
		srv.uiCSS = core.CSSFromUI(cfg)
	}
	if err := app.LoadConsent(srv.Store, o.Now()); err != nil {
		slog.Error("consent log", "error", err.Error())
	}
	if s.DevReport != "" {
		srv.seedDev()
	}
	srv.routes()
	go srv.sweep()
	return srv
}

func (s *Server) Close() {
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
	s.Jobs.Stop()
}

func (s *Server) sweep() {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-t.C:
			s.M.Sweep()
		}
	}
}

// extractJob is the queued extraction: the 42 data, analysed, saved as the user's report.
func (s *Server) extractJob(ctx context.Context, uid int) error {
	return app.RunExtraction(ctx, s.Store, s.Stats, uid, func(ctx context.Context, progress func(float64)) ([]byte, error) {
		before, started := s.API.Requests(), s.now()
		report, err := api42.Extract(ctx, s.API, uid, progress, s.now)
		n, took := s.API.Requests()-before, s.now().Sub(started)
		if err != nil {
			slog.Warn("extraction failed", "requests", n, "seconds", int(took.Seconds()))
			return nil, err
		}
		slog.Info("extraction", "requests", n, "seconds", int(took.Seconds())) // never the user: counts only
		s.Stats.Extraction(n, took, true, false)
		return json.Marshal(report)
	})
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Security-Policy", csp)
	h.Set("X-Frame-Options", "DENY")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "same-origin")
	h.Set("Cross-Origin-Opener-Policy", "same-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	m := http.NewServeMux()
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]bool{"ok": true}) })
	m.HandleFunc("GET /ui.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write([]byte(s.uiCSS))
	})
	m.HandleFunc("GET /auth/login", s.login)
	m.HandleFunc("GET /auth/callback", s.callback)
	m.HandleFunc("POST /auth/logout", s.user(s.csrf(s.logout)))
	if s.S.DevReport != "" {
		m.HandleFunc("GET /dev/login", s.devLogin)
	}
	m.HandleFunc("GET /api/session", s.session)
	m.HandleFunc("GET /api/me/status", s.user(s.status))
	m.HandleFunc("POST /api/me/refresh", s.user(s.csrf(s.refresh)))
	m.HandleFunc("POST /api/me/delete", s.user(s.csrf(s.deleteMe)))
	m.HandleFunc("POST /api/me/consent", s.user(s.csrf(s.consent)))
	m.HandleFunc("POST /api/me/publish", s.user(s.csrf(s.publish)))
	m.HandleFunc("GET /api/me/view", s.user(s.view))
	m.HandleFunc("GET /api/me/today", s.user(s.today))
	m.HandleFunc("GET /api/me/report.json", s.user(s.reportCopy))
	m.HandleFunc("POST /api/me/report", s.user(s.csrf(s.reportBack)))
	m.HandleFunc("GET /api/stats", s.user(s.stats))
	m.HandleFunc("GET /avatar/me", s.user(s.avatar))
	m.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 404, errBody("not-found")) })
	m.HandleFunc("/", s.spa)
	s.mux = m
}

// spa serves the built app: files as they are, every other path the app's index (its router takes it from there).
func (s *Server) spa(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name != "" && name != "index.html" {
		if f, err := fs.Stat(s.static, name); err == nil && !f.IsDir() {
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			http.ServeFileFS(w, r, s.static, name)
			return
		}
	}
	index, err := fs.ReadFile(s.static, "index.html")
	if err != nil {
		http.Error(w, "the browser app is not built: run make build", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(index)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func errBody(e string) map[string]string { return map[string]string{"error": e} }

type ctxKey struct{}

type signedIn struct {
	sid string
	u   app.Session
}

// user requires a session: 401 JSON for the API, which the browser app turns into the landing.
func (s *Server) user(h func(http.ResponseWriter, *http.Request, signedIn)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(app.SessionCookie)
		if err != nil {
			writeJSON(w, 401, errBody("session"))
			return
		}
		u, ok := s.Sessions.Get(c.Value)
		if !ok {
			writeJSON(w, 401, errBody("session"))
			return
		}
		h(w, r, signedIn{c.Value, u})
	}
}

func (s *Server) csrf(h func(http.ResponseWriter, *http.Request, signedIn)) func(http.ResponseWriter, *http.Request, signedIn) {
	return func(w http.ResponseWriter, r *http.Request, si signedIn) {
		sent := r.Header.Get("X-CSRF-Token")
		if sent == "" || subtle.ConstantTimeCompare([]byte(sent), []byte(si.u.CSRF)) != 1 {
			writeJSON(w, 403, errBody("csrf"))
			return
		}
		h(w, r, si)
	}
}

func (s *Server) setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge, Secure: !s.S.InsecureCookies,
		HttpOnly: true, SameSite: http.SameSiteLaxMode})
}

// clientIP: Caddy puts the real address (Cloudflare's Cf-Connecting-Ip in production) in X-Forwarded-For.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) isOwner(u app.Session) bool {
	return s.S.OwnerLogin != "" && u.Login == s.S.OwnerLogin
}

func (s *Server) canPublish(u app.Session) bool {
	return s.isOwner(u) && s.S.GithubToken != "" && s.S.GithubRepo != ""
}
