// Package api42 talks to the 42 API v2: one client-credentials token per app, a limiter that spreads requests over
// the apps, retries, pagination, and the light extraction of one student's data.
package api42

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	pageSize = 100
	retries  = 4
)

type App struct{ UID, Secret string }

// Limiter is the request budget shared by every caller (internal/app.Limiter in the server).
type Limiter interface {
	Acquire(ctx context.Context, app int) (int, error) // app < 0: any app
	Record(h http.Header, app int)
	BudgetOK() bool
}

var idInPath = regexp.MustCompile(`/\d+`)

// Error: Status 0 means no answer (timeouts, connection errors). The message never carries ids.
type Error struct {
	Status int
	Path   string
}

func (e *Error) Error() string {
	return fmt.Sprintf("42 API %d on %s", e.Status, idInPath.ReplaceAllString(e.Path, "/:id"))
}

type token struct {
	value string
	until time.Time
}

type Client struct {
	Base, CDN   string
	apps        []App
	oauth       int
	redirectURI string
	lim         Limiter
	hc          *http.Client
	sleep       func(context.Context, time.Duration) error
	mu          sync.Mutex
	tokens      map[int]token
	requests    atomic.Int64
}

func New(apps []App, oauthIndex int, redirectURI string, lim Limiter, hc *http.Client) *Client {
	if hc == nil {
		hc = &http.Client{Timeout: 60 * time.Second}
	}
	return &Client{Base: "https://api.intra.42.fr", CDN: "https://cdn.intra.42.fr/", apps: apps, oauth: oauthIndex,
		redirectURI: redirectURI, lim: lim, hc: hc, tokens: map[int]token{}, sleep: sleepCtx}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Requests counts the API calls made through this client (the worker logs it per extraction).
func (c *Client) Requests() int { return int(c.requests.Load()) }

func (c *Client) Limiter() Limiter { return c.lim }

func (c *Client) postToken(ctx context.Context, form url.Values) (string, int, error) {
	req, _ := http.NewRequestWithContext(ctx, "POST", c.Base+"/oauth/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r, err := c.hc.Do(req)
	if err != nil {
		return "", 0, &Error{0, "/oauth/token"}
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return "", 0, &Error{r.StatusCode, "/oauth/token"}
	}
	var body struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.AccessToken == "" {
		return "", 0, &Error{r.StatusCode, "/oauth/token"}
	}
	return body.AccessToken, body.ExpiresIn, nil
}

func (c *Client) appToken(ctx context.Context, app int, refresh bool) (string, error) {
	c.mu.Lock()
	t, ok := c.tokens[app]
	c.mu.Unlock()
	if ok && !refresh && time.Now().Before(t.until) {
		return t.value, nil
	}
	a := c.apps[app]
	v, exp, err := c.postToken(ctx, url.Values{"grant_type": {"client_credentials"}, "client_id": {a.UID}, "client_secret": {a.Secret}})
	if err != nil {
		return "", err
	}
	if exp == 0 {
		exp = 7200
	}
	c.mu.Lock()
	c.tokens[app] = token{v, time.Now().Add(time.Duration(max(exp-60, 60)) * time.Second)}
	c.mu.Unlock()
	return v, nil
}

func (c *Client) do(ctx context.Context, path string, params url.Values, userToken string) (*http.Response, []byte, error) {
	reauthed := false
	for attempt := 0; attempt <= retries; attempt++ {
		pin := -1
		if userToken != "" {
			pin = c.oauth // a user token belongs to the sign-in app
		}
		app, err := c.lim.Acquire(ctx, pin)
		if err != nil {
			return nil, nil, err
		}
		tok := userToken
		if tok == "" {
			if tok, err = c.appToken(ctx, app, false); err != nil {
				return nil, nil, err
			}
		}
		c.requests.Add(1)
		u := c.Base + path
		if len(params) > 0 {
			u += "?" + params.Encode()
		}
		req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r, err := c.hc.Do(req)
		if err != nil { // a slow or dropped answer is retried like a server error
			if ctx.Err() != nil {
				return nil, nil, ctx.Err()
			}
			if attempt == retries {
				return nil, nil, &Error{0, path}
			}
			if err := c.sleep(ctx, time.Duration(1<<attempt)*time.Second); err != nil {
				return nil, nil, err
			}
			continue
		}
		body, err := io.ReadAll(r.Body)
		r.Body.Close()
		c.lim.Record(r.Header, app)
		switch {
		case err != nil:
			if attempt == retries {
				return nil, nil, &Error{0, path}
			}
			continue
		case r.StatusCode == 401 && userToken == "" && !reauthed:
			if _, err := c.appToken(ctx, app, true); err != nil {
				return nil, nil, err
			}
			reauthed = true
			attempt--
			continue
		case r.StatusCode == 429 || r.StatusCode >= 500:
			if attempt == retries {
				return nil, nil, &Error{r.StatusCode, path}
			}
			wait := time.Duration(1<<attempt) * time.Second
			if s, err := strconv.ParseFloat(r.Header.Get("Retry-After"), 64); err == nil {
				wait = time.Duration(s * float64(time.Second))
			}
			if err := c.sleep(ctx, wait); err != nil {
				return nil, nil, err
			}
			continue
		case r.StatusCode >= 400:
			return nil, nil, &Error{r.StatusCode, path}
		}
		return r, body, nil
	}
	return nil, nil, &Error{401, path}
}

// Get is one request; objects come back as map[string]any, numbers as float64.
func (c *Client) Get(ctx context.Context, path string, params url.Values) (any, error) {
	_, body, err := c.do(ctx, path, params, "")
	if err != nil {
		return nil, err
	}
	var v any
	return v, json.Unmarshal(body, &v)
}

// GetAll follows the pages of a list.
func (c *Client) GetAll(ctx context.Context, path string, params url.Values) ([]any, error) {
	var items []any
	for page := 1; ; page++ {
		p := url.Values{}
		for k, v := range params {
			p[k] = v
		}
		p.Set("page[size]", strconv.Itoa(pageSize))
		p.Set("page[number]", strconv.Itoa(page))
		r, body, err := c.do(ctx, path, p, "")
		if err != nil {
			return nil, err
		}
		var batch []any
		if err := json.Unmarshal(body, &batch); err != nil {
			return nil, &Error{r.StatusCode, path}
		}
		items = append(items, batch...)
		total, _ := strconv.Atoi(r.Header.Get("X-Total"))
		if len(batch) < pageSize || (total > 0 && len(items) >= total) {
			if items == nil {
				items = []any{}
			}
			return items, nil
		}
	}
}

// ExchangeCode returns the signed-in user's access token: used once to read /v2/me, never stored.
func (c *Client) ExchangeCode(ctx context.Context, code string) (string, error) {
	if _, err := c.lim.Acquire(ctx, c.oauth); err != nil {
		return "", err
	}
	a := c.apps[c.oauth]
	tok, _, err := c.postToken(ctx, url.Values{"grant_type": {"authorization_code"}, "client_id": {a.UID}, "client_secret": {a.Secret},
		"code": {code}, "redirect_uri": {c.redirectURI}})
	return tok, err
}

func (c *Client) Me(ctx context.Context, userToken string) (map[string]any, error) {
	_, body, err := c.do(ctx, "/v2/me", nil, userToken)
	if err != nil {
		return nil, err
	}
	var me map[string]any
	return me, json.Unmarshal(body, &me)
}

var ErrNotCDN = errors.New("avatar: not an intra CDN URL")

// Avatar fetches a profile photo from the intra CDN, which only serves them with an API token.
func (c *Client) Avatar(ctx context.Context, u string) ([]byte, string, error) {
	if !strings.HasPrefix(u, c.CDN) { // the app token goes with the request
		return nil, "", ErrNotCDN
	}
	app, err := c.lim.Acquire(ctx, -1) // the CDN counts against the same 2 requests per second
	if err != nil {
		return nil, "", err
	}
	tok, err := c.appToken(ctx, app, false)
	if err != nil {
		return nil, "", err
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	r, err := c.hc.Do(req)
	if err != nil {
		return nil, "", &Error{0, "avatar"}
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return nil, "", &Error{r.StatusCode, "avatar"}
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 5<<20))
	ct := r.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/jpeg"
	}
	return b, ct, err
}
