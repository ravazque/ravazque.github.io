package app

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"time"
)

// Server-side sessions: the browser only holds a random id in the __Host-session cookie.
const SessionCookie = "__Host-session"

type Session struct {
	ID             int     `json:"id"`
	Login          string  `json:"login"`
	Name           string  `json:"name,omitempty"`
	Image          string  `json:"image,omitempty"`
	CoalitionColor string  `json:"coalition_color,omitempty"`
	CSRF           string  `json:"csrf"`
	Created        float64 `json:"created"`
	App            int     `json:"app"` // the limiter slot of the app that issued the user's token
}

type Sessions struct {
	m        *Memory
	settings Settings
}

func NewSessions(m *Memory, s Settings) *Sessions { return &Sessions{m, s} }

func Token() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func (ss *Sessions) ttl() time.Duration { return time.Duration(ss.settings.SessionS) * time.Second }

func (ss *Sessions) Create(u Session) string {
	sid := Token()
	u.CSRF, u.Created = Token(), float64(ss.m.now().Unix())
	b, _ := json.Marshal(u)
	ss.m.Set("sess:"+sid, b, ss.ttl(), false)
	return sid
}

// Get renews a live session (sliding expiry).
func (ss *Sessions) Get(sid string) (Session, bool) {
	var u Session
	if sid == "" {
		return u, false
	}
	raw, ok := ss.m.Get("sess:" + sid)
	if !ok || json.Unmarshal(raw, &u) != nil {
		return u, false
	}
	ss.m.Expire("sess:"+sid, ss.ttl())
	return u, true
}

func (ss *Sessions) Delete(sid string) {
	if sid != "" {
		ss.m.Delete("sess:" + sid)
	}
}

func (ss *Sessions) Live() int { return len(ss.m.Keys("sess:*")) }
