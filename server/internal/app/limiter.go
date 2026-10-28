package app

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Limiter holds the request budget of every 42 app this server uses (2 per second and the hourly budget the API
// reports, per app): each request takes a free slot from whichever app has one, so more apps carry more load.
type Limiter struct {
	mu          sync.Mutex
	apps        int
	perSecond   int
	hourlyFloor int
	now         func() time.Time
	sleep       func(context.Context, time.Duration) error
	turn        int
	second      []int64 // the second each app's count belongs to
	count       []int
	hourly      []int // -1: unknown
	hourlyUntil []time.Time
	OnRequest   func(app int)
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

func NewLimiter(apps int, now func() time.Time, sleep func(context.Context, time.Duration) error) *Limiter {
	apps = max(apps, 1)
	l := &Limiter{apps: apps, perSecond: 2, hourlyFloor: 50, now: now, sleep: sleep,
		second: make([]int64, apps), count: make([]int, apps), hourly: make([]int, apps), hourlyUntil: make([]time.Time, apps)}
	for i := range l.hourly {
		l.hourly[i] = -1
	}
	if l.sleep == nil {
		l.sleep = sleepCtx
	}
	return l
}

func (l *Limiter) Apps() int { return l.apps }

func (l *Limiter) hasBudget(app int, t time.Time) bool {
	return l.hourly[app] < 0 || !t.Before(l.hourlyUntil[app]) || l.hourly[app] >= l.hourlyFloor
}

// Acquire waits for a free slot in this second and returns the app it belongs to; app >= 0 pins one (a user token
// belongs to the app that issued it). Apps short of their hourly budget are left aside while another has some.
func (l *Limiter) Acquire(ctx context.Context, app int) (int, error) {
	for {
		l.mu.Lock()
		t := l.now()
		var order []int
		if app >= 0 {
			order = []int{app}
		} else {
			for i := range l.apps {
				if a := (l.turn + i) % l.apps; l.hasBudget(a, t) {
					order = append(order, a)
				}
			}
			if len(order) == 0 {
				for i := range l.apps {
					order = append(order, (l.turn+i)%l.apps)
				}
			}
		}
		sec := t.Unix()
		for _, a := range order {
			if l.second[a] != sec {
				l.second[a], l.count[a] = sec, 0
			}
			if l.count[a] < l.perSecond {
				l.count[a]++
				l.turn = (a + 1) % l.apps
				l.mu.Unlock()
				if l.OnRequest != nil {
					l.OnRequest(a)
				}
				return a, nil
			}
		}
		wait := time.Unix(sec+1, 0).Sub(t)
		l.mu.Unlock()
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		if err := l.sleep(ctx, max(wait, 10*time.Millisecond)); err != nil {
			return 0, err
		}
	}
}

// Record remembers the hourly budget the API reports for an app, until the next full hour.
func (l *Limiter) Record(h http.Header, app int) {
	v := h.Get("X-Hourly-Ratelimit-Remaining")
	n, err := strconv.Atoi(v)
	if err != nil || app < 0 || app >= l.apps {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.hourly[app] = n
	l.hourlyUntil[app] = l.now().Truncate(time.Hour).Add(time.Hour)
}

// BudgetOK is true while at least one app has budget left this hour.
func (l *Limiter) BudgetOK() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	t := l.now()
	for a := range l.apps {
		if l.hasBudget(a, t) {
			return true
		}
	}
	return false
}
