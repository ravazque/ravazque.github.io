package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"ravazque.info/server/core"
	"strconv"
	"strings"
	"time"
)

// Store keeps per user in memory: a copy of the analysed report, the extraction status and the refresh cooldown.
type Store struct {
	m        *Memory
	settings Settings
	now      func() time.Time
}

type Status struct {
	State         string  `json:"state"` // none | queued | running | done | failed | refused
	Progress      float64 `json:"progress"`
	Message       string  `json:"message,omitempty"`
	Last          string  `json:"last,omitempty"`
	NextRefreshIn int     `json:"next_refresh_in"`
}

func NewStore(m *Memory, s Settings, now func() time.Time) *Store { return &Store{m, s, now} }

func dataKey(uid int) string   { return fmt.Sprintf("user:%d:data", uid) }
func statusKey(uid int) string { return fmt.Sprintf("user:%d:status", uid) }
func lockKey(uid int) string   { return fmt.Sprintf("lock:extract:%d", uid) }

// Digest is an HMAC of the id: keys that survive "Delete my data" without naming the user.
func (s *Store) Digest(uid int) string {
	mac := hmac.New(sha256.New, []byte(s.settings.SessionSecret))
	mac.Write([]byte(strconv.Itoa(uid)))
	return hex.EncodeToString(mac.Sum(nil))
}

// DigestString keys other per-person counters (the sign-in limit per address) without storing the value.
func (s *Store) DigestString(v string) string {
	mac := hmac.New(sha256.New, []byte(s.settings.SessionSecret))
	mac.Write([]byte("v:" + v))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Store) cooldownKey(uid int) string { return "cooldown:" + s.Digest(uid) }
func (s *Store) deletedKey(uid int) string  { return "deleted:" + s.Digest(uid) }

// copyLife: how long a browser's copy can be handed back; after that a fresh extraction is needed.
const copyLife = 30 * 24 * time.Hour

func (s *Store) mac(uid int, iat int64, raw []byte) string {
	sum := sha256.Sum256(raw)
	mac := hmac.New(sha256.New, []byte(s.settings.SessionSecret))
	mac.Write(append([]byte(fmt.Sprintf("report:%d:%d:", uid, iat)), sum[:]...))
	return hex.EncodeToString(mac.Sum(nil))
}

// Sign ties a report's exact bytes to one user and the moment it was handed out ("<unix>.<hmac>"): only this server,
// for this user, can produce it.
func (s *Store) Sign(uid int, raw []byte) string {
	iat := s.now().Unix()
	return strconv.FormatInt(iat, 10) + "." + s.mac(uid, iat, raw)
}

// Verify accepts a copy signed for this user, less than copyLife ago and not before their last "Delete my data".
func (s *Store) Verify(uid int, raw []byte, sig string) bool {
	at, mac, ok := strings.Cut(sig, ".")
	iat, err := strconv.ParseInt(at, 10, 64)
	if !ok || err != nil || !hmac.Equal([]byte(mac), []byte(s.mac(uid, iat, raw))) {
		return false
	}
	issued := time.Unix(iat, 0)
	if s.now().Sub(issued) > copyLife || issued.After(s.now().Add(time.Minute)) {
		return false
	}
	if v, ok := s.m.Get("epoch:" + s.Digest(uid)); ok {
		if gone, _ := strconv.ParseInt(string(v), 10, 64); iat <= gone {
			return false
		}
	}
	return true
}

func (s *Store) cache() time.Duration { return time.Duration(s.settings.CacheS) * time.Second }

func (s *Store) SaveRaw(uid int, raw []byte) { s.m.Set(dataKey(uid), raw, s.cache(), false) }

// LoadRaw is the stored report, renewed for another hour on every use; nil when there is none.
func (s *Store) LoadRaw(uid int) []byte {
	raw, ok := s.m.Get(dataKey(uid))
	if !ok {
		return nil
	}
	s.m.Expire(dataKey(uid), s.cache())
	s.m.Expire(statusKey(uid), s.cache())
	return raw
}

func (s *Store) SetStatus(uid int, st Status) {
	b, _ := json.Marshal(st)
	s.m.Set(statusKey(uid), b, s.cache(), false)
}

// Status is the stored status with the cooldown left; State "none" when there is none.
func (s *Store) Status(uid int) Status {
	st := Status{State: "none"}
	if raw, ok := s.m.Get(statusKey(uid)); ok {
		json.Unmarshal(raw, &st)
	}
	st.NextRefreshIn = s.RefreshWait(uid)
	return st
}

func (s *Store) update(uid int, f func(*Status)) {
	st := s.Status(uid)
	f(&st)
	st.NextRefreshIn = 0
	s.SetStatus(uid, st)
}

func (s *Store) RefreshWait(uid int) int { return int(s.m.TTL(s.cooldownKey(uid)).Seconds()) }

// StartCooldown: the hour counts from the start of the extraction that succeeded.
func (s *Store) StartCooldown(uid int, startedAt time.Time) {
	ttl := time.Duration(s.settings.CooldownS) * time.Second
	if !startedAt.IsZero() {
		ttl -= s.now().Sub(startedAt)
	}
	s.m.Set(s.cooldownKey(uid), []byte("1"), max(ttl, time.Second), false)
}

func (s *Store) TryLock(uid int) bool {
	return s.m.Set(lockKey(uid), []byte("1"), 15*time.Minute, true)
}
func (s *Store) Unlock(uid int) { s.m.Delete(lockKey(uid)) }

// DeleteUser removes everything about the user; a running extraction finds the marker and saves nothing.
func (s *Store) DeleteUser(uid int) {
	s.m.Delete(dataKey(uid), statusKey(uid), lockKey(uid), "avatar:"+s.Digest(uid))
	s.m.Set(s.deletedKey(uid), []byte("1"), 15*time.Minute, false)
	// copies handed out before now are refused from here on (keyed by the HMAC: it names nobody)
	s.m.Set("epoch:"+s.Digest(uid), []byte(strconv.FormatInt(s.now().Unix(), 10)), copyLife, false)
}

func (s *Store) DropReport(uid int)   { s.m.Delete(dataKey(uid)) }
func (s *Store) Deleted(uid int) bool { return s.m.Exists(s.deletedKey(uid)) }
func (s *Store) ForgetStatus(uid int) { s.m.Delete(statusKey(uid)) }

// ClearRefusal: access is back (signed in again), so the refused status and its cooldown go.
func (s *Store) ClearRefusal(uid int) {
	if s.Status(uid).State == "refused" {
		s.m.Delete(statusKey(uid), s.cooldownKey(uid))
	}
}

// DeleteEverything is "Delete my data": the stored copy, the status, a queued or running extraction.
func DeleteEverything(s *Store, jobs *Jobs, uid int) {
	if jobs != nil {
		jobs.Cancel(JobID(uid))
	}
	s.DeleteUser(uid)
}

// EnqueueExtraction starts an extraction unless one is running or the hour has not passed; returns the status.
func EnqueueExtraction(s *Store, jobs *Jobs, uid int, lim *Limiter) Status {
	if !s.TryLock(uid) {
		return s.Status(uid)
	}
	if s.RefreshWait(uid) > 0 {
		s.Unlock(uid)
		return s.Status(uid)
	}
	s.m.Delete(s.deletedKey(uid)) // back after "Delete my data": this extraction may save again
	var deferBy time.Duration
	msg := ""
	if !lim.BudgetOK() { // the hourly budget is nearly spent: run at the next full hour
		now := s.now()
		deferBy = now.Truncate(time.Hour).Add(time.Hour).Sub(now)
		msg = "status.budget"
	}
	s.SetStatus(uid, Status{State: "queued", Message: msg})
	jobs.Enqueue(JobID(uid), uid, deferBy) // false only means it is still waiting: "queued" stays true
	return s.Status(uid)
}

// RunExtraction is the extraction job: extract returns the report's JSON. It keeps the old report on failure, saves
// nothing after "Delete my data", and never leaves the status on "running".
func RunExtraction(ctx context.Context, s *Store, stats *Stats, uid int, extract func(context.Context, func(float64)) ([]byte, error)) error {
	started := s.now()
	s.SetStatus(uid, Status{State: "running"})
	defer func() {
		if s.Status(uid).State == "running" {
			if stats != nil {
				stats.Extraction(0, s.now().Sub(started), false, true)
			}
			s.update(uid, func(st *Status) { st.State, st.Message = "failed", "status.failed" })
		}
		if s.Deleted(uid) {
			s.ForgetStatus(uid)
		}
		s.Unlock(uid)
	}()
	raw, err := extract(ctx, func(f float64) {
		if !s.Deleted(uid) {
			s.update(uid, func(st *Status) { st.Progress = float64(int(f*1000)) / 1000 })
		}
	})
	var refused core.AccessRefused
	switch {
	case errors.As(err, &refused):
		if stats != nil {
			stats.Deny()
		}
		s.DropReport(uid)
		s.StartCooldown(uid, started)
		s.SetStatus(uid, Status{State: "refused", Message: refused.Reason})
	case err != nil:
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return err // the deferred check marks it failed
		}
		slog.Warn("extraction failed", "error", err.Error())
		if stats != nil {
			stats.Extraction(0, s.now().Sub(started), false, false)
		}
		s.SetStatus(uid, Status{State: "failed", Message: "status.failed"})
	default:
		s.StartCooldown(uid, started)
		if s.Deleted(uid) {
			return nil
		}
		s.SaveRaw(uid, raw)
		s.SetStatus(uid, Status{State: "done", Progress: 1, Last: s.now().UTC().Format(time.RFC3339)})
	}
	return err
}
