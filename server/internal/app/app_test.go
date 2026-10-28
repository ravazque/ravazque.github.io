package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

type clock struct {
	mu     sync.Mutex
	t      time.Time
	sleeps []time.Duration
}

func newClock() *clock { return &clock{t: time.Unix(1000, 250_000_000)} }

func (c *clock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }

func (c *clock) sleep(_ context.Context, d time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sleeps = append(c.sleeps, d)
	c.t = c.t.Add(d)
	return nil
}

func (c *clock) add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

const secret = "0123456789abcdef0123456789abcdef-test"

func testSettings() Settings {
	return Settings{BaseURL: "https://localhost", FTUID: "u1", FTSecret: "s1", OAuthApp: 1, SessionSecret: secret,
		CooldownS: 3600, CacheS: 3600, SessionS: 604800, ContactEmail: "c@example.invalid", ControllerName: "Test"}
}

func TestMemoryExpiresAndCounts(t *testing.T) {
	c := newClock()
	m := NewMemory(c.now)
	m.Set("a", []byte("1"), 10*time.Second, false)
	if v, ok := m.Get("a"); !ok || string(v) != "1" {
		t.Fatal("get")
	}
	if m.Set("a", []byte("2"), 0, true) {
		t.Fatal("nx set over an existing key")
	}
	if m.Incr("n") != 1 || m.Incr("n") != 2 {
		t.Fatal("incr")
	}
	if ttl := m.TTL("a"); ttl != 10*time.Second {
		t.Fatalf("ttl %v", ttl)
	}
	c.add(11 * time.Second)
	if _, ok := m.Get("a"); ok || m.Exists("a") {
		t.Fatal("expired key still there")
	}
	m.Sweep()
	if m.Size() != 1 {
		t.Fatalf("size %d", m.Size())
	}
	if got := m.Keys("n*"); !slices.Equal(got, []string{"n"}) || m.Delete("n", "zz") != 1 {
		t.Fatalf("keys %v", got)
	}
}

func TestLimiterCapsTwoPerSecond(t *testing.T) {
	c := newClock()
	l := NewLimiter(1, c.now, c.sleep)
	ctx := context.Background()
	l.Acquire(ctx, -1)
	l.Acquire(ctx, -1)
	if len(c.sleeps) != 0 {
		t.Fatal("slept too early")
	}
	l.Acquire(ctx, -1)
	if len(c.sleeps) == 0 || c.sleeps[0] <= 0 || c.sleeps[0] > time.Second {
		t.Fatalf("sleeps %v", c.sleeps)
	}
}

func TestLimiterRecordsHourlyBudget(t *testing.T) {
	c := newClock()
	l := NewLimiter(1, c.now, c.sleep)
	if !l.BudgetOK() {
		t.Fatal("fresh limiter has budget")
	}
	l.Record(http.Header{"X-Hourly-Ratelimit-Remaining": {"40"}}, 0)
	if l.BudgetOK() {
		t.Fatal("40 left is under the floor")
	}
	l.Record(http.Header{"X-Hourly-Ratelimit-Remaining": {"900"}}, 0)
	if !l.BudgetOK() {
		t.Fatal("900 left")
	}
}

func TestLimiterTwoAppsShareTurns(t *testing.T) {
	c := newClock()
	l := NewLimiter(2, c.now, c.sleep)
	ctx := context.Background()
	var got []int
	for range 4 {
		a, _ := l.Acquire(ctx, -1)
		got = append(got, a)
	}
	slices.Sort(got)
	if len(c.sleeps) != 0 || !slices.Equal(got, []int{0, 0, 1, 1}) {
		t.Fatalf("got %v sleeps %v", got, c.sleeps)
	}
	if a, _ := l.Acquire(ctx, 0); a != 0 || len(c.sleeps) == 0 {
		t.Fatal("a pinned app waits for its own window")
	}
}

func TestLimiterAppOutOfBudgetLeftAside(t *testing.T) {
	c := newClock()
	l := NewLimiter(2, c.now, c.sleep)
	ctx := context.Background()
	l.Record(http.Header{"X-Hourly-Ratelimit-Remaining": {"10"}}, 0)
	a, _ := l.Acquire(ctx, -1)
	b, _ := l.Acquire(ctx, -1)
	if a != 1 || b != 1 || !l.BudgetOK() {
		t.Fatalf("got %d %d", a, b)
	}
	l.Record(http.Header{"X-Hourly-Ratelimit-Remaining": {"10"}}, 1)
	if l.BudgetOK() {
		t.Fatal("both apps out of budget")
	}
}

func TestLimiterStopsOnCancel(t *testing.T) {
	l := NewLimiter(1, time.Now, func(ctx context.Context, d time.Duration) error { return ctx.Err() })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	l.Acquire(ctx, -1)
	l.Acquire(ctx, -1)
	if _, err := l.Acquire(ctx, -1); !errors.Is(err, context.Canceled) {
		t.Fatalf("err %v", err)
	}
}

func newStore(c *clock) (*Memory, *Store) {
	m := NewMemory(c.now)
	return m, NewStore(m, testSettings(), c.now)
}

func TestStoreCopyRenewedOnUse(t *testing.T) {
	c := newClock()
	m, s := newStore(c)
	s.SaveRaw(1, []byte(`{"a":1}`))
	m.Expire("user:1:data", 10*time.Second)
	if raw := s.LoadRaw(1); string(raw) != `{"a":1}` {
		t.Fatalf("raw %s", raw)
	}
	if ttl := m.TTL("user:1:data"); ttl < 3500*time.Second || ttl > 3600*time.Second {
		t.Fatalf("ttl %v", ttl)
	}
}

func TestStoreStatusDefaultsAndCooldown(t *testing.T) {
	c := newClock()
	_, s := newStore(c)
	if st := s.Status(1); st.State != "none" || st.NextRefreshIn != 0 {
		t.Fatalf("%+v", st)
	}
	s.StartCooldown(1, time.Time{})
	if st := s.Status(1); st.NextRefreshIn < 3590 || st.NextRefreshIn > 3600 {
		t.Fatalf("%+v", st)
	}
}

func TestStoreDeleteKeepsOnlyAnonymousKeys(t *testing.T) {
	c := newClock()
	m, s := newStore(c)
	s.StartCooldown(1, time.Time{})
	s.SaveRaw(1, []byte("{}"))
	s.SetStatus(1, Status{State: "done"})
	s.DeleteUser(1)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("1"))
	d := hex.EncodeToString(mac.Sum(nil))
	keys := m.Keys("*")
	slices.Sort(keys)
	if !slices.Equal(keys, []string{"cooldown:" + d, "deleted:" + d, "epoch:" + d}) {
		t.Fatalf("keys %v", keys)
	}
	if m.TTL("deleted:"+d) > 900*time.Second {
		t.Fatal("deleted marker lasts a job at most")
	}
}

func TestSignTiesBytesToUser(t *testing.T) {
	_, s := newStore(newClock())
	a := s.Sign(1, []byte("x"))
	if !s.Verify(1, []byte("x"), a) || s.Verify(2, []byte("x"), a) || s.Verify(1, []byte("y"), a) || s.Verify(1, []byte("x"), "1."+a) {
		t.Fatal("signature")
	}
}

type fixture struct {
	m    *Memory
	s    *Store
	jobs *Jobs
	lim  *Limiter
}

func setup(t *testing.T, run func(ctx context.Context, f *fixture, uid int) error, timeout time.Duration) *fixture {
	c := newClock()
	f := &fixture{}
	f.m, f.s = newStore(c)
	f.m.now, f.s.now = time.Now, time.Now
	f.lim = NewLimiter(1, time.Now, sleepCtx)
	f.jobs = NewJobs(func(ctx context.Context, uid int) error { return run(ctx, f, uid) }, timeout)
	t.Cleanup(f.jobs.Stop)
	return f
}

func failing(ctx context.Context, f *fixture, uid int) error {
	return RunExtraction(ctx, f.s, nil, uid, func(context.Context, func(float64)) ([]byte, error) { return nil, errors.New("42 is down") })
}

func TestRetryAfterFailureRunsAgain(t *testing.T) {
	f := setup(t, failing, time.Minute)
	EnqueueExtraction(f.s, f.jobs, 7, f.lim)
	f.jobs.Drain()
	if f.s.Status(7).State != "failed" {
		t.Fatal(f.s.Status(7))
	}
	if st := EnqueueExtraction(f.s, f.jobs, 7, f.lim); st.State != "queued" {
		t.Fatal(st)
	}
	f.jobs.Drain()
	if f.s.Status(7).State != "failed" {
		t.Fatal("the retry ran")
	}
}

func TestSameExtractionNeverQueuedTwice(t *testing.T) {
	block, busy := make(chan struct{}), make(chan struct{}, 1)
	f := setup(t, func(ctx context.Context, f *fixture, uid int) error { busy <- struct{}{}; <-block; return nil }, time.Minute)
	defer close(block)
	f.jobs.Enqueue(JobID(1), 1, 0) // keeps the worker busy
	<-busy
	EnqueueExtraction(f.s, f.jobs, 7, f.lim)
	if f.jobs.Enqueue(JobID(7), 7, 0) || !slices.Equal(f.jobs.Queued(), []string{JobID(7)}) {
		t.Fatalf("queued %v", f.jobs.Queued())
	}
}

func TestDeleteCancelsQueuedAndRunning(t *testing.T) {
	started := make(chan struct{})
	ran := map[int]bool{}
	var mu sync.Mutex
	f := setup(t, func(ctx context.Context, f *fixture, uid int) error {
		mu.Lock()
		ran[uid] = true
		mu.Unlock()
		return RunExtraction(ctx, f.s, nil, uid, func(ctx context.Context, progress func(float64)) ([]byte, error) {
			close(started)
			<-ctx.Done()
			return nil, ctx.Err()
		})
	}, time.Minute)
	EnqueueExtraction(f.s, f.jobs, 7, f.lim)
	<-started
	EnqueueExtraction(f.s, f.jobs, 8, f.lim)
	DeleteEverything(f.s, f.jobs, 8) // queued: never runs
	DeleteEverything(f.s, f.jobs, 7) // running: cancelled
	f.jobs.Drain()
	if ran[8] {
		t.Fatal("a deleted queued job ran")
	}
	for _, k := range f.m.Keys("*") {
		if strings.Contains(k, ":7:") || strings.HasSuffix(k, ":7") || strings.Contains(k, ":8:") || strings.HasSuffix(k, ":8") {
			t.Fatalf("key naming the user left: %s", k)
		}
	}
}

func TestRunningExtractionDoesNotBringDeletedDataBack(t *testing.T) {
	f := setup(t, func(ctx context.Context, f *fixture, uid int) error {
		return RunExtraction(ctx, f.s, nil, uid, func(ctx context.Context, progress func(float64)) ([]byte, error) {
			progress(.5)
			DeleteEverything(f.s, nil, uid) // "Delete my data" while the job runs, after its cancel point
			progress(.9)
			return []byte(`{"page":"web"}`), nil
		})
	}, time.Minute)
	EnqueueExtraction(f.s, f.jobs, 7, f.lim)
	f.jobs.Drain()
	if f.s.LoadRaw(7) != nil || f.m.Exists("user:7:status") {
		t.Fatal("deleted data came back")
	}
}

func TestTimedOutExtractionDoesNotStayRunning(t *testing.T) {
	f := setup(t, func(ctx context.Context, f *fixture, uid int) error {
		return RunExtraction(ctx, f.s, nil, uid, func(ctx context.Context, _ func(float64)) ([]byte, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		})
	}, 50*time.Millisecond)
	EnqueueExtraction(f.s, f.jobs, 7, f.lim)
	f.jobs.Drain()
	if st := f.s.Status(7); st.State != "failed" {
		t.Fatalf("%+v", st)
	}
}

func TestLowBudgetDefersToNextHour(t *testing.T) {
	f := setup(t, failing, time.Minute)
	f.lim.Record(http.Header{"X-Hourly-Ratelimit-Remaining": {"1"}}, 0)
	st := EnqueueExtraction(f.s, f.jobs, 7, f.lim)
	if st.State != "queued" || st.Message != "status.budget" || !slices.Equal(f.jobs.Queued(), []string{JobID(7)}) {
		t.Fatalf("%+v", st)
	}
}

func TestCooldownBlocksEnqueue(t *testing.T) {
	f := setup(t, failing, time.Minute)
	f.s.StartCooldown(7, time.Time{})
	if st := EnqueueExtraction(f.s, f.jobs, 7, f.lim); st.NextRefreshIn == 0 || len(f.jobs.Queued()) != 0 || !f.s.TryLock(7) {
		t.Fatalf("%+v", st)
	}
}

func TestSessions(t *testing.T) {
	c := newClock()
	m := NewMemory(c.now)
	ss := NewSessions(m, testSettings())
	sid := ss.Create(Session{ID: 5, Login: "tnova"})
	got, ok := ss.Get(sid)
	if !ok || got.Login != "tnova" || len(got.CSRF) < 32 {
		t.Fatalf("%+v", got)
	}
	ss.Delete(sid)
	if _, ok := ss.Get(sid); ok {
		t.Fatal("deleted session")
	}
}

func TestConsentSurvivesRestartAndPrunes(t *testing.T) {
	c := newClock()
	dir := t.TempDir()
	st := testSettings()
	st.ConsentLog = filepath.Join(dir, "consent.log")
	m, s := NewMemory(c.now), (*Store)(nil)
	s = NewStore(m, st, c.now)
	old := `{"h":"old","v":3,"at":"2020-01-01T00:00:00+00:00"}` + "\n"
	os.WriteFile(st.ConsentLog, []byte(old), 0o600)
	RecordConsent(s, 9, time.Now())
	m2 := NewMemory(c.now)
	s2 := NewStore(m2, st, c.now)
	LoadConsent(s2, time.Now())
	if !ConsentCurrent(s2, 9) {
		t.Fatal("consent lost on restart")
	}
	b, _ := os.ReadFile(st.ConsentLog)
	if strings.Contains(string(b), `"old"`) || strings.Contains(string(b), `"9"`) {
		t.Fatalf("log %s", b)
	}
}

func TestSettingsChecks(t *testing.T) {
	s := testSettings()
	if err := s.Check(); err != nil {
		t.Fatal(err)
	}
	for name, mod := range map[string]func(*Settings){
		"short secret":  func(s *Settings) { s.SessionSecret = "short" },
		"no contact":    func(s *Settings) { s.ContactEmail = "" },
		"no controller": func(s *Settings) { s.ControllerName = "" },
		"dev elsewhere": func(s *Settings) { s.DevReport = "x.json"; s.BaseURL = "https://ravazque.info" },
		"app 2 unset":   func(s *Settings) { s.OAuthApp = 2 },
	} {
		bad := testSettings()
		mod(&bad)
		if bad.Check() == nil {
			t.Errorf("%s accepted", name)
		}
	}
	s.FTUID2, s.FTSecret2, s.FTUID3, s.FTSecret3 = "u2", "s2", "u3", "s3"
	s.OAuthApp = 2
	if len(s.Apps()) != 3 || s.OAuthIndex() != 1 {
		t.Fatalf("apps %v index %d", s.Apps(), s.OAuthIndex())
	}
}

func TestDevReportOnlyOnLocalhostItself(t *testing.T) {
	s := testSettings()
	s.DevReport, s.BaseURL = "x.json", "https://localhost.example.com"
	if s.Check() == nil {
		t.Fatal("a look-alike host turns dev mode on")
	}
	s.BaseURL = "https://localhost"
	if err := s.Check(); err != nil {
		t.Fatal(err)
	}
}
