package web

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ravazque.info/server/core"
	"ravazque.info/server/internal/app"
)

// make dev-build / dev-real: the saved reports matching DEV_PROFILES (space-separated globs: the synthetic test-*.json,
// the real real-*.json; each carries its id in test_profile) are in memory from the start, and /dev/login signs in as
// one of them: no 42 sign-in, no extraction. Settings.Check refuses DEV_PROFILES anywhere but https://localhost.

func (s *Server) seedDev() {
	s.devLogins, s.devFiles = map[string]devLogin{}, map[int]string{}
	var files []string
	for _, g := range strings.Fields(s.S.DevProfiles) {
		m, _ := filepath.Glob(g)
		files = append(files, m...)
	}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		data, err := core.ParseOrdered(raw)
		if err != nil {
			slog.Warn("dev report unreadable", "file", filepath.Base(file))
			continue
		}
		uid, test := data.I("test_profile"), !strings.HasPrefix(filepath.Base(file), "real-")
		if uid <= 0 {
			continue
		}
		s.devFiles[uid] = file
		s.Store.SaveRaw(uid, raw)
		info, _ := os.Stat(file)
		s.Store.SetStatus(uid, app.Status{State: "done", Progress: 1, Last: info.ModTime().UTC().Format(time.RFC3339)})
		p := data.Obj("periods").Obj("all").Obj("profile")
		color := p.Obj("coalition").S("color")
		login := p.S("login")
		if _, seen := s.devLogins[login]; !seen {
			s.devOrder = append(s.devOrder, login)
		}
		s.devLogins[login] = devLogin{app.Session{ID: uid, Login: login, Name: p.S("name"), CoalitionColor: color}, test}
	}
}

func (s *Server) devLogin(w http.ResponseWriter, r *http.Request) {
	as := r.URL.Query().Get("as")
	var d devLogin
	found := false
	if as != "" {
		d, found = s.devLogins[as]
	} else {
		for _, l := range s.devOrder {
			if !s.devLogins[l].test {
				d, found = s.devLogins[l], true
				break
			}
		}
	}
	if !found {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if s.frozen(d.session.ID) && s.Store.LoadRaw(d.session.ID) == nil { // deleted (or expired) in this session: the saved file is still there
		if raw, err := os.ReadFile(s.devFiles[d.session.ID]); err == nil {
			s.Store.SaveRaw(d.session.ID, raw)
			s.Store.SetStatus(d.session.ID, app.Status{State: "done", Progress: 1, Last: s.now().UTC().Format(time.RFC3339)})
		}
	}
	sid := s.Sessions.Create(d.session)
	app.RecordConsent(s.Store, d.session.ID, s.now())
	s.setCookie(w, app.SessionCookie, sid, s.S.SessionS)
	http.Redirect(w, r, "/app", http.StatusSeeOther)
}

// frozen: a saved report of make dev, never extracted from 42 (unless the owner turned it live).
func (s *Server) frozen(uid int) bool {
	_, live := s.devLive.Load(uid)
	return s.devFiles[uid] != "" && !live
}

// devGoLive (owner, make dev only) tests coming back after an hour with a real extraction: the server forgets the saved
// report as after an hour unused and it turns live, so the browser's copy comes back and the refresh asks 42 (~110
// requests of the shared budget, once an hour as for anyone) until the dev server restarts.
func (s *Server) devGoLive(w http.ResponseWriter, r *http.Request, si signedIn) {
	if !s.isOwner(si.u) || s.devFiles[si.u.ID] == "" {
		writeJSON(w, http.StatusForbidden, errBody("owner"))
		return
	}
	s.devLive.Store(si.u.ID, true)
	s.Store.DropReport(si.u.ID)
	s.Store.ForgetStatus(si.u.ID)
	w.WriteHeader(http.StatusNoContent)
}
