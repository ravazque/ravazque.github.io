package api42

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type nopLimiter struct{ recorded atomic.Int64 }

func (l *nopLimiter) Acquire(ctx context.Context, app int) (int, error) {
	if app < 0 {
		app = 0
	}
	return app, ctx.Err()
}
func (l *nopLimiter) Record(h http.Header, app int) {
	if h.Get("X-Hourly-Ratelimit-Remaining") != "" {
		l.recorded.Add(1)
	}
}
func (l *nopLimiter) BudgetOK() bool { return true }

func newTestClient(t *testing.T, h http.HandlerFunc) (*Client, *nopLimiter) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	lim := &nopLimiter{}
	c := New([]App{{"u1", "s1"}, {"u2", "s2"}}, 0, "https://localhost/auth/callback", lim, srv.Client())
	c.Base, c.CDN = srv.URL, srv.URL+"/cdn/"
	c.sleep = func(ctx context.Context, d time.Duration) error { return ctx.Err() }
	return c, lim
}

func tokenOK(w http.ResponseWriter, tok string) {
	json.NewEncoder(w).Encode(map[string]any{"access_token": tok, "expires_in": 7200})
}

func TestGetAllPaginatesAndReusesToken(t *testing.T) {
	var tokens, pages atomic.Int64
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokens.Add(1)
			tokenOK(w, "T")
			return
		}
		if r.Header.Get("Authorization") != "Bearer T" {
			t.Errorf("auth %q", r.Header.Get("Authorization"))
		}
		n := 100
		if pages.Add(1) == 2 {
			if r.URL.Query().Get("page[number]") != "2" {
				t.Errorf("page %s", r.URL.RawQuery)
			}
			n = 50
		}
		w.Header().Set("X-Total", "150")
		w.Write([]byte("[" + strings.TrimSuffix(strings.Repeat("{},", n), ",") + "]"))
	})
	got, err := c.GetAll(context.Background(), "/v2/users/1/locations", nil)
	if err != nil || len(got) != 150 || tokens.Load() != 1 || c.Requests() != 2 {
		t.Fatalf("got %d err %v tokens %d requests %d", len(got), err, tokens.Load(), c.Requests())
	}
}

func TestTokenRefreshOn401(t *testing.T) {
	var tokens, calls atomic.Int64
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			if tokens.Add(1) == 1 {
				tokenOK(w, "OLD")
			} else {
				tokenOK(w, "NEW")
			}
			return
		}
		if calls.Add(1) == 1 {
			w.WriteHeader(401)
			return
		}
		if r.Header.Get("Authorization") != "Bearer NEW" {
			t.Errorf("auth %q", r.Header.Get("Authorization"))
		}
		w.Write([]byte(`{"id":1}`))
	})
	got, err := c.Get(context.Background(), "/v2/me", nil)
	if err != nil || got.(map[string]any)["id"] != 1.0 || tokens.Load() != 2 {
		t.Fatalf("got %v err %v", got, err)
	}
}

func TestServerErrorStormRaisesAfterRetries(t *testing.T) {
	var calls atomic.Int64
	c, lim := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		calls.Add(1)
		w.Header().Set("X-Hourly-Ratelimit-Remaining", "12")
		w.WriteHeader(503)
	})
	_, err := c.Get(context.Background(), "/v2/users/1234/locations", nil)
	var e *Error
	if !errors.As(err, &e) || e.Status != 503 || calls.Load() != 5 || lim.recorded.Load() != 5 {
		t.Fatalf("err %v calls %d", err, calls.Load())
	}
	if strings.Contains(err.Error(), "1234") {
		t.Fatalf("error names an id: %v", err)
	}
}

func TestNetworkThatNeverAnswersEndsInAnErrorWithoutIDs(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		hj, _ := w.(http.Hijacker)
		conn, _, _ := hj.Hijack()
		conn.Close()
	})
	_, err := c.Get(context.Background(), "/v2/users/77/teams", nil)
	var e *Error
	if !errors.As(err, &e) || e.Status != 0 || strings.Contains(err.Error(), "77") {
		t.Fatalf("err %v", err)
	}
}

func TestExchangeCodeAndMeUseTheUserToken(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			r.ParseForm()
			if r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("client_id") != "u1" || r.Form.Get("redirect_uri") != "https://localhost/auth/callback" {
				t.Errorf("form %v", r.Form)
			}
			tokenOK(w, "USER")
			return
		}
		if r.Header.Get("Authorization") != "Bearer USER" {
			t.Errorf("auth %q", r.Header.Get("Authorization"))
		}
		w.Write([]byte(`{"id":7}`))
	})
	tok, err := c.ExchangeCode(context.Background(), "CODE")
	if err != nil || tok != "USER" {
		t.Fatal(tok, err)
	}
	me, err := c.Me(context.Background(), tok)
	if err != nil || me["id"] != 7.0 {
		t.Fatal(me, err)
	}
}

func TestAvatarOnlyFromTheCDN(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("PNG"))
	})
	if _, _, err := c.Avatar(context.Background(), "https://evil.example/x.png"); err == nil {
		t.Fatal("a non-CDN URL would carry the app token")
	}
	b, ct, err := c.Avatar(context.Background(), c.CDN+"users/x.png")
	if err != nil || string(b) != "PNG" || ct != "image/png" {
		t.Fatal(b, ct, err)
	}
}

func TestRetryAfterIsCapped(t *testing.T) {
	var waited []time.Duration
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		w.Header().Set("Retry-After", "86400")
		w.WriteHeader(429)
	})
	c.sleep = func(ctx context.Context, d time.Duration) error { waited = append(waited, d); return nil }
	c.Get(context.Background(), "/v2/me", nil)
	for _, d := range waited {
		if d > time.Minute {
			t.Fatalf("waited %v", d)
		}
	}
}
