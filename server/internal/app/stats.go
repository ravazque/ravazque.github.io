package app

import (
	"sync"
	"time"
)

// Stats are live operational figures for the owner's stats page, in process memory; they reset on restart.
type Stats struct {
	mu            sync.Mutex
	now           func() time.Time
	apps          int
	StartedAt     time.Time
	RequestsTotal int
	recent        []struct {
		at  time.Time
		app int
	}
	Extractions, ExtractionRequests int
	Failed, Timeouts, Denied        int
	ExtractionTime                  time.Duration
	LastPublish                     time.Time
	PeakSessions                    int
}

func NewStats(apps int, now func() time.Time) *Stats {
	return &Stats{now: now, apps: max(apps, 1), StartedAt: now()}
}

func (s *Stats) Request(app int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.RequestsTotal++
	s.recent = append(s.recent, struct {
		at  time.Time
		app int
	}{s.now(), app})
}

// LastHour counts the API requests of the last hour per app.
func (s *Stats) LastHour() []int {
	s.mu.Lock()
	defer s.mu.Unlock()
	cut := s.now().Add(-time.Hour)
	i := 0
	for i < len(s.recent) && s.recent[i].at.Before(cut) {
		i++
	}
	s.recent = s.recent[i:]
	out := make([]int, s.apps)
	for _, r := range s.recent {
		if r.app >= 0 && r.app < s.apps {
			out[r.app]++
		}
	}
	return out
}

func (s *Stats) Extraction(requests int, took time.Duration, ok, timeout bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Extractions++
	s.ExtractionRequests += max(requests, 0)
	s.ExtractionTime += max(took, 0)
	if timeout {
		s.Timeouts++
	}
	if !ok {
		s.Failed++
	}
}

func (s *Stats) Deny()      { s.mu.Lock(); s.Denied++; s.mu.Unlock() }
func (s *Stats) Published() { s.mu.Lock(); s.LastPublish = s.now(); s.mu.Unlock() }

func (s *Stats) SawSessions(live int) {
	s.mu.Lock()
	s.PeakSessions = max(s.PeakSessions, live)
	s.mu.Unlock()
}
