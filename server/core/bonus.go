package core

import (
	"slices"
	"sort"
	"time"
)

// BonusTier is one logtime bonus right now (inferred rule, see CoalitionPoints): hours in the rolling week, what is
// missing, when the cooldown ends, and the earliest logout that earns it when connected from now on.
type BonusTier struct {
	Hours   int     `json:"hours"`
	Points  int     `json:"points"`
	WindowH float64 `json:"window_h"`
	NeedH   float64 `json:"need_h"`
	Last    *string `json:"last"`
	From    *string `json:"from"`
	State   string  `json:"state"` // ready | short | cooldown
	Until   *string `json:"until"`
}

func windowSessions(w *OMap, now time.Time) []span {
	var ss []span
	for _, s := range w.L("sessions") {
		pair, _ := s.([]any)
		if len(pair) == 2 {
			ss = append(ss, span{tsAny(pair[0]), tsAny(pair[1])})
		}
	}
	// an open session is assumed to go on: the report cannot know
	if w.B("open") && len(ss) > 0 {
		ss[len(ss)-1].e = maxT(ss[len(ss)-1].e, now)
	}
	var out []span
	for _, s := range ss {
		if s.b.Before(now) {
			out = append(out, span{s.b, minT(s.e, now)})
		}
	}
	return out
}

func LogtimeBonus(w *OMap, now time.Time) []BonusTier {
	sessions := windowSessions(w, now)
	hours := func(t time.Time) float64 { // in the week before t, connected from now to t
		start := t.Add(-week)
		past := 0.0
		for _, s := range sessions {
			past += max(0, totalSeconds(minT(s.e, now).Sub(maxT(s.b, start))))
		}
		return (past + max(0, totalSeconds(t.Sub(maxT(now, start))))) / 3600
	}
	edgeSet := map[int64]time.Time{now.UnixNano(): now, now.Add(week).UnixNano(): now.Add(week)}
	for _, s := range sessions {
		for _, x := range []time.Time{s.b, s.e} {
			if y := x.Add(week); y.After(now) && y.Before(now.Add(week)) {
				edgeSet[y.UnixNano()] = y
			}
		}
	}
	edges := make([]time.Time, 0, len(edgeSet))
	for _, t := range edgeSet {
		edges = append(edges, t)
	}
	slices.SortFunc(edges, func(a, b time.Time) int { return a.Compare(b) })
	var out []BonusTier
	last := w.Obj("last")
	for _, tier := range bonusTiers {
		key := json_int(float64(tier.hours)).(string)
		var lastS, from *string
		var readyAt time.Time
		if s := last.S(key); s != "" {
			lastS = &s
			readyAt = TS(s).Add(week)
		}
		cooldown := !readyAt.IsZero() && readyAt.After(now)
		have, h := hours(now), float64(tier.hours)
		var until time.Time
		prev := now
		for _, t := range edges { // hours() is linear between edges and never decreases: first edge over h, then interpolate
			if hours(t) >= h {
				hp, ht := hours(prev), hours(t)
				if hp >= h {
					until = prev
				} else {
					until = prev.Add(time.Duration(pyRoundInt((h-hp)/(ht-hp)*totalSeconds(t.Sub(prev)))) * time.Second)
				}
				break
			}
			prev = t
		}
		if !until.IsZero() && cooldown {
			until = maxT(until, readyAt)
		}
		if cooldown {
			from = iso(readyAt)
		}
		state := "short"
		if cooldown {
			state = "cooldown"
		} else if have >= h {
			state = "ready"
		}
		var u *string
		if !until.IsZero() {
			u = iso(until)
		}
		out = append(out, BonusTier{tier.hours, tier.points, pyRound(have, 1), pyRound(max(0, h-have), 1), lastS, from, state, u})
	}
	return out
}

func iso(t time.Time) *string { s := pyISO(t); return &s }

// Drop is a past session leaving the rolling week: from At on, its hours stop counting.
type Drop struct {
	At           time.Time `json:"at"`
	Hours        float64   `json:"hours"`
	SessionBegin time.Time `json:"session_begin"`
}

// BonusDrops lists, oldest first, the sessions of the window that start leaving it within horizon from now.
func BonusDrops(w *OMap, now time.Time, horizon time.Duration) []Drop {
	var out []Drop
	for _, s := range windowSessions(w, now) {
		b := maxT(s.b, now.Add(-week))
		at := b.Add(week)
		if !at.After(now) && !s.e.Add(week).After(now) || at.After(now.Add(horizon)) {
			continue
		}
		out = append(out, Drop{at, pyRound(totalSeconds(s.e.Sub(b))/3600, 1), s.b})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}
