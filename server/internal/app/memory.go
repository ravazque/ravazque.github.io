// Package app is the web server's in-process state: memory with expiry, the 42 API limiter, the job queue, the
// per-user store, sessions, consent and settings. One process by design: nothing is shared with another.
package app

import (
	"path"
	"strconv"
	"sync"
	"time"
)

type item struct {
	val []byte
	exp time.Time // zero: no expiry
}

// Memory is a small key-value store with expiry (the subset of Redis v1 used).
type Memory struct {
	mu    sync.Mutex
	items map[string]item
	now   func() time.Time
}

func NewMemory(now func() time.Time) *Memory {
	return &Memory{items: map[string]item{}, now: now}
}

func (m *Memory) live(k string) (item, bool) {
	it, ok := m.items[k]
	if ok && !it.exp.IsZero() && !m.now().Before(it.exp) {
		delete(m.items, k)
		return item{}, false
	}
	return it, ok
}

func (m *Memory) Get(k string) ([]byte, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	it, ok := m.live(k)
	return it.val, ok
}

// Set stores val for ttl (0: no expiry); with nx it only sets a missing key and says whether it did.
func (m *Memory) Set(k string, val []byte, ttl time.Duration, nx bool) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.live(k); ok && nx {
		return false
	}
	it := item{val: val}
	if ttl > 0 {
		it.exp = m.now().Add(ttl)
	}
	m.items[k] = it
	return true
}

func (m *Memory) Delete(keys ...string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, k := range keys {
		if _, ok := m.live(k); ok {
			delete(m.items, k)
			n++
		}
	}
	return n
}

func (m *Memory) Exists(k string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.live(k)
	return ok
}

func (m *Memory) Expire(k string, ttl time.Duration) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	it, ok := m.live(k)
	if ok {
		it.exp = m.now().Add(ttl)
		m.items[k] = it
	}
	return ok
}

// TTL is the time left; 0 for a missing key or one without expiry.
func (m *Memory) TTL(k string) time.Duration {
	m.mu.Lock()
	defer m.mu.Unlock()
	it, ok := m.live(k)
	if !ok || it.exp.IsZero() {
		return 0
	}
	return it.exp.Sub(m.now())
}

func (m *Memory) Incr(k string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	it, _ := m.live(k)
	n, _ := strconv.Atoi(string(it.val))
	it.val = []byte(strconv.Itoa(n + 1))
	m.items[k] = it
	return n + 1
}

// Keys lists the live keys matching a glob pattern.
func (m *Memory) Keys(pattern string) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for k := range m.items {
		if _, ok := m.live(k); ok {
			if match, _ := path.Match(pattern, k); match {
				out = append(out, k)
			}
		}
	}
	return out
}

func (m *Memory) Sweep() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k := range m.items {
		m.live(k)
	}
}

func (m *Memory) Size() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.items)
}
