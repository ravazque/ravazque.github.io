package web

import (
	"crypto/subtle"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"ravazque.info/server/core"
	"ravazque.info/server/internal/app"
)

// 42 OAuth (authorization code). The user's token only proves who they are: it is used for /v2/me and dropped.

const (
	stateCookie        = "__Host-oauth_state"
	callbacksPerWindow = 10 // each callback spends shared API budget, so it is capped per address
	callbackWindow     = 10 * time.Minute
)

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("accept") != "1" {
		http.Redirect(w, r, "/?error=consent", http.StatusSeeOther)
		return
	}
	state := app.Token()
	q := url.Values{"client_id": {s.S.OAuth().UID}, "redirect_uri": {s.S.BaseURL + "/auth/callback"}, "response_type": {"code"},
		"scope": {"public"}, "state": {state}}
	s.setCookie(w, stateCookie, state, 600)
	http.Redirect(w, r, s.API.Base+"/oauth/authorize?"+q.Encode(), http.StatusTemporaryRedirect)
}

func (s *Server) callback(w http.ResponseWriter, r *http.Request) {
	code, state := r.URL.Query().Get("code"), r.URL.Query().Get("state")
	c, err := r.Cookie(stateCookie)
	if code == "" || state == "" || err != nil || subtle.ConstantTimeCompare([]byte(state), []byte(c.Value)) != 1 {
		http.Error(w, "Invalid sign-in state. Please start again.", http.StatusBadRequest)
		return
	}
	key := "rl:signin:" + s.Store.DigestString(clientIP(r))
	if n := s.M.Incr(key); n == 1 {
		s.M.Expire(key, callbackWindow)
	} else if n > callbacksPerWindow {
		http.Error(w, "Too many sign-in attempts. Try again in a few minutes.", http.StatusTooManyRequests)
		return
	}
	s.setCookie(w, stateCookie, "", -1)
	ctx := r.Context()
	tok, err := s.API.ExchangeCode(ctx, code)
	if err != nil {
		http.Redirect(w, r, "/?error=signin", http.StatusSeeOther)
		return
	}
	me, err := s.API.Me(ctx, tok)
	if err != nil {
		http.Redirect(w, r, "/?error=signin", http.StatusSeeOther)
		return
	}
	if ok, reason := core.Access(me, s.now()); !ok {
		http.Redirect(w, r, "/refused?reason="+reason, http.StatusSeeOther)
		return
	}
	uid := core.Int(me, "id")
	color := ""
	if cs, err := s.API.Get(ctx, "/v2/users/"+strconv.Itoa(uid)+"/coalitions", nil); err == nil { // the accent; sign-in goes on without it
		var list []core.Raw
		for _, x := range cs.([]any) {
			if o, ok := x.(core.Raw); ok {
				list = append(list, o)
			}
		}
		if main := core.MainCoalition(list); main != nil {
			color = core.Str(main, "color")
		}
	}
	image := core.Str(core.Obj(core.Obj(me, "image"), "versions"), "medium")
	if image == "" {
		image = core.Str(core.Obj(me, "image"), "link")
	}
	sid := s.Sessions.Create(app.Session{ID: uid, Login: core.Str(me, "login"), Name: core.Str(me, "displayname"), Image: image,
		CoalitionColor: color})
	s.Stats.SawSessions(s.Sessions.Live())
	s.Store.ClearRefusal(uid)
	app.RecordConsent(s.Store, uid, s.now()) // the landing's checkbox
	if s.Store.LoadRaw(uid) == nil {         // the first sign-in starts the first extraction
		app.EnqueueExtraction(s.Store, s.Jobs, uid, s.Lim)
	}
	s.setCookie(w, app.SessionCookie, sid, s.S.SessionS)
	http.Redirect(w, r, "/app", http.StatusSeeOther)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request, si signedIn) {
	s.Sessions.Delete(si.sid)
	s.setCookie(w, app.SessionCookie, "", -1)
	w.WriteHeader(http.StatusNoContent)
}

// session tells the browser app who is signed in and what the public pages need; never a token but the CSRF one.
func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"contact_email": s.S.ContactEmail, "issues_url": s.S.IssuesURL, "controller": s.S.ControllerName,
		"consent_version": app.ConsentVersion, "consent_updated": app.ConsentUpdated, "dev": s.S.DevReport != "", "user": nil}
	var dev []map[string]any
	for _, login := range s.devOrder {
		d := s.devLogins[login]
		label := "Dev · "
		if d.test {
			label = "Test · "
		}
		dev = append(dev, map[string]any{"label": label + login, "href": "/dev/login?as=" + url.QueryEscape(login)})
	}
	out["dev_logins"] = dev
	if c, err := r.Cookie(app.SessionCookie); err == nil {
		if u, ok := s.Sessions.Get(c.Value); ok {
			color := u.CoalitionColor
			if !safeColor(color) {
				color = ""
			}
			out["user"] = map[string]any{"login": u.Login, "name": u.Name, "has_image": strings.HasPrefix(u.Image, s.API.CDN),
				"coalition_color": color, "csrf": u.CSRF, "owner": s.isOwner(u), "can_publish": s.canPublish(u)}
		}
	}
	writeJSON(w, 200, out)
}
