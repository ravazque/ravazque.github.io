package app

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"
	"time"
)

// Proof that someone accepted the privacy policy: a keyed hash of their 42 id, the version and the date, kept for two
// years after their last sign-in. It names nobody and survives "Delete my data". It is the one thing written to disk
// (CONSENT_LOG, one JSON line per acceptance, pruned at start-up).
const (
	ConsentVersion = 3
	ConsentUpdated = "2026-10-27"
	consentKeep    = 2 * 365 * 24 * time.Hour
)

type consentEntry struct {
	H  string `json:"h"`
	V  int    `json:"v"`
	At string `json:"at"`
}

func remember(m *Memory, e consentEntry, ttl time.Duration) {
	b, _ := json.Marshal(map[string]any{"v": e.V, "at": e.At})
	m.Set("consent:"+e.H, b, ttl, false)
}

func RecordConsent(s *Store, uid int, now time.Time) error {
	e := consentEntry{s.Digest(uid), ConsentVersion, now.UTC().Format("2006-01-02T15:04:05") + "+00:00"}
	remember(s.m, e, consentKeep)
	if s.settings.ConsentLog == "" {
		return nil
	}
	f, err := os.OpenFile(s.settings.ConsentLog, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	b, _ := json.Marshal(e)
	_, err = f.Write(append(b, '\n'))
	return err
}

func ConsentCurrent(s *Store, uid int) bool {
	raw, ok := s.m.Get("consent:" + s.Digest(uid))
	var e consentEntry
	return ok && json.Unmarshal(raw, &e) == nil && e.V == ConsentVersion
}

// LoadConsent, at start-up, drops entries older than two years from the log and brings the rest back into memory.
func LoadConsent(s *Store, now time.Time) error {
	path := s.settings.ConsentLog
	if path == "" {
		return nil
	}
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	var kept []consentEntry
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var e consentEntry
		if json.Unmarshal(sc.Bytes(), &e) != nil {
			continue
		}
		at, err := time.Parse(time.RFC3339, strings.Replace(e.At, "+00:00", "Z", 1))
		if err != nil {
			continue
		}
		if age := now.Sub(at); age < consentKeep {
			kept = append(kept, e)
			remember(s.m, e, consentKeep-age) // the latest line per person wins, as in memory
		}
	}
	f.Close()
	var b strings.Builder
	for _, e := range kept {
		j, _ := json.Marshal(e)
		b.Write(append(j, '\n'))
	}
	return os.WriteFile(path, []byte(b.String()), 0o600)
}
