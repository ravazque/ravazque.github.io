package web

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"ravazque.info/server/core"
	"ravazque.info/server/internal/app"
)

const maxReport = 16 << 20

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{3,8}$`)

// safeColor: colours from the API reach styles only as plain hex.
func safeColor(c string) bool { return hexColor.MatchString(c) }

type statusOut struct {
	app.Status
	HasReport bool   `json:"has_report"`
	Consent   bool   `json:"consent"`
	Published string `json:"published,omitempty"`
	Frozen    bool   `json:"frozen,omitempty"` // make dev's saved reports: never extracted again
}

func (s *Server) statusOf(uid int) statusOut {
	st := s.Store.Status(uid)
	pub, _ := s.M.Get("published:" + s.Store.Digest(uid))
	return statusOut{st, s.Store.LoadRaw(uid) != nil, app.ConsentCurrent(s.Store, uid), string(pub), s.devFiles[uid] != ""}
}

// status also starts the extraction when nothing is stored, nothing is queued and the hour is over.
func (s *Server) status(w http.ResponseWriter, r *http.Request, si signedIn) {
	st := s.Store.Status(si.u.ID)
	if st.State == "none" && st.NextRefreshIn == 0 && s.Store.LoadRaw(si.u.ID) == nil && r.URL.Query().Get("kick") == "1" && s.devFiles[si.u.ID] == "" {
		app.EnqueueExtraction(s.Store, s.Jobs, si.u.ID, s.Lim)
	}
	writeJSON(w, 200, s.statusOf(si.u.ID))
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request, si signedIn) {
	if s.devFiles[si.u.ID] != "" { // make dev's saved reports are never extracted again from here
		writeJSON(w, http.StatusConflict, s.Store.Status(si.u.ID))
		return
	}
	st := app.EnqueueExtraction(s.Store, s.Jobs, si.u.ID, s.Lim)
	code := http.StatusAccepted
	if st.State != "queued" && st.State != "running" && st.NextRefreshIn > 0 {
		code = http.StatusTooManyRequests
	}
	writeJSON(w, code, st)
}

func (s *Server) deleteMe(w http.ResponseWriter, r *http.Request, si signedIn) {
	app.DeleteEverything(s.Store, s.Jobs, si.u.ID)
	s.M.Delete("published:" + s.Store.Digest(si.u.ID))
	s.Sessions.DeleteUser(si.u.ID)
	s.setCookie(w, app.SessionCookie, "", -1)
	w.Header().Set("Clear-Site-Data", `"storage"`) // the browser's copy goes too
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) consent(w http.ResponseWriter, r *http.Request, si signedIn) {
	var body struct{ Accept bool }
	if json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body) != nil || !body.Accept {
		writeJSON(w, 400, errBody("consent"))
		return
	}
	app.RecordConsent(s.Store, si.u.ID, s.now())
	w.WriteHeader(http.StatusNoContent)
}

// load is the user's stored report, with the opted-out students hidden; ok false writes the error.
func (s *Server) load(w http.ResponseWriter, si signedIn) (*core.OMap, bool) {
	if !app.ConsentCurrent(s.Store, si.u.ID) {
		writeJSON(w, 409, errBody("consent"))
		return nil, false
	}
	raw := s.Store.LoadRaw(si.u.ID)
	if raw == nil {
		writeJSON(w, 404, errBody("no-data"))
		return nil, false
	}
	if h := s.hidden(raw); h != nil {
		raw = h
	}
	data, err := core.ParseOrdered(raw)
	if err != nil {
		writeJSON(w, 500, errBody("report"))
		return nil, false
	}
	return data, true
}

// hidden is the report with every opted-out student turned into a label (the viewer never is); nil when nobody is.
func (s *Server) hidden(raw []byte) []byte {
	if len(s.S.OptoutLogins) == 0 {
		return nil
	}
	data, err := core.ParseOrdered(raw)
	if err != nil {
		return nil
	}
	own := ""
	for _, p := range data.Obj("periods").Keys() {
		own = data.Obj("periods").Obj(p).Obj("profile").S("login")
		break
	}
	logins := map[string]bool{}
	for _, l := range s.S.OptoutLogins {
		if l != strings.ToLower(own) {
			logins[l] = true
		}
	}
	if len(logins) == 0 {
		return nil
	}
	out, err := json.Marshal(hide(data, logins, own))
	if err != nil {
		return nil
	}
	return out
}

// view is everything the pages show for one period: the period's report, the figures derived from it, and the parts
// of the stored report that are per period (connections, network) or shared (layout, promo, coalitions).
func (s *Server) view(w http.ResponseWriter, r *http.Request, si signedIn) {
	data, ok := s.load(w, si)
	if !ok {
		return
	}
	periods := data.Obj("periods")
	p := r.URL.Query().Get("period")
	if !slices.Contains(periods.Keys(), p) {
		p = data.S("default_period")
		if !slices.Contains(periods.Keys(), p) {
			p = periods.Keys()[0]
		}
	}
	rep, all := periods.Obj(p), periods.Obj("all")
	if _, has := periods.Get("all"); !has {
		all = rep
	}
	writeJSON(w, 200, map[string]any{
		"period": p, "periods": periods.Keys(), "default_period": data.V("default_period"), "light": data.V("light"),
		"seat_days": data.V("seat_days"), "report": rep, "derive": core.Derive(rep, all, s.now()),
		"layout": data.V("layout"), "connections": data.Obj("connections").V(p), "network": data.Obj("network").V(p),
		"promo": data.V("promo"), "coalitions": data.V("coalitions"), "all_projects": all.V("projects"),
	})
}

func (s *Server) today(w http.ResponseWriter, r *http.Request, si signedIn) {
	data, ok := s.load(w, si)
	if !ok {
		return
	}
	all := data.Obj("periods").Obj("all")
	var up []core.UpcomingEval
	if raw, err := json.Marshal(data.V("upcoming")); err == nil {
		json.Unmarshal(raw, &up)
	}
	writeJSON(w, 200, core.BuildToday(all, up, s.now()))
}

// reportCopy is the stored report for the browser to keep, with the signature it must show to hand it back.
func (s *Server) reportCopy(w http.ResponseWriter, r *http.Request, si signedIn) {
	if _, ok := s.load(w, si); !ok { // the same opted-out students hidden as on the pages
		return
	}
	raw := s.Store.LoadRaw(si.u.ID)
	if hidden := s.hidden(raw); hidden != nil {
		raw = hidden
		s.Store.SaveRaw(si.u.ID, raw) // the server's copy and the browser's are the same bytes from now on
	}
	w.Header().Set("X-Report-Sig", s.Store.Sign(si.u.ID, raw))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(raw)
}

// reportBack takes the browser's copy back: only the exact bytes this server signed for this user.
func (s *Server) reportBack(w http.ResponseWriter, r *http.Request, si signedIn) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxReport+1))
	sig := r.Header.Get("X-Report-Sig")
	if err != nil || len(raw) == 0 || len(raw) > maxReport || !s.Store.Verify(si.u.ID, raw, sig) {
		writeJSON(w, 400, errBody("signature"))
		return
	}
	s.Store.SaveRaw(si.u.ID, raw)
	w.WriteHeader(http.StatusNoContent)
}

// imageTypes: what a photo may be served as from this origin; anything else goes out as a JPEG.
var imageTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true}

// avatar: the photo is fetched once an hour per user at most (each fetch spends the shared API budget).
func (s *Server) avatar(w http.ResponseWriter, r *http.Request, si signedIn) {
	if si.u.Image == "" {
		w.WriteHeader(404)
		return
	}
	key := "avatar:" + s.Store.Digest(si.u.ID)
	var b []byte
	ct := ""
	if cached, ok := s.M.Get(key); ok {
		ct, b = string(cached[:bytes.IndexByte(cached, '\n')]), cached[bytes.IndexByte(cached, '\n')+1:]
	} else {
		var err error
		if b, ct, err = s.API.Avatar(r.Context(), si.u.Image); err != nil {
			s.M.Set(key, []byte("\n"), 10*time.Minute, false) // a missing photo is not asked for again at once
			w.WriteHeader(404)
			return
		}
		if !imageTypes[strings.TrimSpace(strings.Split(ct, ";")[0])] {
			ct = "image/jpeg"
		}
		s.M.Set(key, append([]byte(ct+"\n"), b...), time.Hour, false)
	}
	if len(b) == 0 {
		w.WriteHeader(404)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Write(b)
}

// stats is the owner's live operations page: counters, queue, API budget and who is signed in.
func (s *Server) stats(w http.ResponseWriter, r *http.Request, si signedIn) {
	if !s.isOwner(si.u) {
		writeJSON(w, 403, errBody("owner"))
		return
	}
	var sessions []map[string]any
	for _, k := range s.M.Keys("sess:*") {
		raw, ok := s.M.Get(k)
		var u app.Session
		if ok && json.Unmarshal(raw, &u) == nil {
			sessions = append(sessions, map[string]any{"login": u.Login, "name": u.Name, "created": u.Created})
		}
	}
	slices.SortFunc(sessions, func(a, b map[string]any) int {
		return int(b["created"].(float64) - a["created"].(float64))
	})
	s.Stats.SawSessions(len(sessions))
	st := s.Stats
	writeJSON(w, 200, map[string]any{
		"started": st.StartedAt.UTC(), "requests_total": st.RequestsTotal, "last_hour": st.LastHour(),
		"extractions": st.Extractions, "extraction_requests": st.ExtractionRequests, "extraction_seconds": st.ExtractionTime.Seconds(),
		"failed": st.Failed, "timeouts": st.Timeouts, "denied": st.Denied, "queued": len(s.Jobs.Queued()),
		"last_publish": nullTime(st.LastPublish), "peak_sessions": st.PeakSessions, "memory_keys": s.M.Size(), "sessions": sessions,
		"uptime_s": int(s.now().Sub(st.StartedAt).Seconds()), "budget_ok": s.Lim.BudgetOK(), "apps": s.Lim.Apps(),
	})
}

func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t.UTC()
}
