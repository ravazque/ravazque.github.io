package core

import (
	"sort"
	"time"
)

// Home: only what changes day to day. Built at request time from the stored "all" report, so the bonus and the week
// follow the clock while the data is as of the last extraction.

type UpcomingEval struct {
	At      time.Time `json:"at"`
	Project string    `json:"project"`
	Role    string    `json:"role"` // corrector | corrected
}

// Upcoming lists evaluations still ahead, read before DropHiddenEvaluations: the API hides who takes part in them, so
// only the time, the project and the user's role are kept.
func Upcoming(received, given, projects []Raw, now time.Time) []UpcomingEval {
	names := map[float64]string{}
	for _, p := range projects {
		names[Num(p, "id")] = Str(p, "name")
	}
	var out []UpcomingEval
	add := func(evs []Raw, role string) {
		for _, e := range evs {
			if at := TS(Str(e, "begin_at")); at.After(now) {
				out = append(out, UpcomingEval{at, names[Num(Obj(e, "team"), "project_id")], role})
			}
		}
	}
	add(received, "corrected")
	add(given, "corrector")
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

type NowAt struct {
	Host  any       `json:"host"`
	Since time.Time `json:"since"`
}

type Part struct {
	From    float64 `json:"from"` // local hours, 0–24
	To      float64 `json:"to"`
	Host    any     `json:"host"`
	Leaving bool    `json:"leaving"` // leaves the bonus window within a day
}

type DayStrip struct {
	Date    string `json:"date"`
	Seconds int    `json:"seconds"`
	Parts   []Part `json:"parts"`
}

type Next struct {
	At           time.Time `json:"at"`
	Project      string    `json:"project"`
	Role         string    `json:"role"`
	MoreThisWeek int       `json:"more_this_week"`
}

type InProgress struct {
	Name       any    `json:"name"`
	Day        int    `json:"day"` // whole days since registering
	Registered string `json:"registered"`
	Attempt    int    `json:"attempt"`
}

type Month struct {
	Month           string `json:"month"`
	XP              int    `json:"xp"`
	Validated       int    `json:"validated"`
	Evaluations     int    `json:"evaluations"`
	CoalitionPoints int    `json:"coalition_points"`
}

type Today struct {
	AsOf           string       `json:"as_of"`
	Bonus          []BonusTier  `json:"bonus"`
	WindowH        float64      `json:"window_h"`
	Drops          []Drop       `json:"drops"`
	Now            *NowAt       `json:"now"`
	TodayS         int          `json:"today_s"`
	YesterdayS     int          `json:"yesterday_s"`
	YesterdaySeats int          `json:"yesterday_seats"`
	Week           []DayStrip   `json:"week"`
	Next           *Next        `json:"next"`
	InProgress     []InProgress `json:"in_progress"`
	Month          Month        `json:"month"`
}

func localMidnight(t time.Time) time.Time {
	l := t.In(Madrid)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, Madrid)
}

func hourOfDay(t, midnight time.Time) float64 {
	return pyRound(totalSeconds(t.Sub(midnight))/3600, 2)
}

func BuildToday(all *OMap, upcoming []UpcomingEval, now time.Time) Today {
	td := Today{AsOf: all.S("generated"), Week: []DayStrip{}, InProgress: []InProgress{}, Drops: []Drop{}, Bonus: []BonusTier{}}
	asOf := now
	if w, ok := all.Get("logtime_bonus"); ok && w != nil {
		window := w.(*OMap)
		asOf = TS(window.S("at"))
		td.Bonus = LogtimeBonus(window, now)
		if len(td.Bonus) > 0 {
			td.WindowH = td.Bonus[0].WindowH
		}
		if d := BonusDrops(window, now, week); d != nil {
			td.Drops = d
		}
	}
	// sessions as of the extraction; an open one runs to the extraction time
	type sess struct {
		b, e time.Time
		host any
	}
	var sessions []sess
	for _, l := range all.Obj("logtime").Os("log") {
		b := fromMs(int64(l.F("begin_ms")))
		e := b.Add(time.Duration(l.F("seconds")) * time.Second)
		if l.V("end") == nil {
			if !asOf.IsZero() {
				e = maxT(e, minT(asOf, now))
			}
			if td.Now == nil || b.After(td.Now.Since) {
				td.Now = &NowAt{l.V("host"), b}
			}
		}
		sessions = append(sessions, sess{b, e, l.V("host")})
	}
	today := localMidnight(now)
	for i := 6; i >= 0; i-- {
		start := today.AddDate(0, 0, -i)
		end := start.AddDate(0, 0, 1)
		strip := DayStrip{Date: start.Format("2006-01-02"), Parts: []Part{}}
		var in []span
		for _, s := range sessions {
			b, e := maxT(s.b, start), minT(s.e, end)
			if e.After(b) {
				strip.Parts = append(strip.Parts, Part{hourOfDay(b, start), hourOfDay(e, start), s.host, b.Add(week).Before(now.Add(24 * time.Hour))})
				in = append(in, span{b, e})
			}
		}
		secs := 0.0
		for _, s := range MergeIntervals(in) {
			secs += totalSeconds(s.e.Sub(s.b))
		}
		strip.Seconds = pyRoundInt(secs)
		sort.SliceStable(strip.Parts, func(a, b int) bool { return strip.Parts[a].From < strip.Parts[b].From })
		td.Week = append(td.Week, strip)
	}
	td.TodayS, td.YesterdayS = td.Week[6].Seconds, td.Week[5].Seconds
	seats := map[any]bool{}
	for _, p := range td.Week[5].Parts {
		seats[p.Host] = true
	}
	td.YesterdaySeats = len(seats)

	for i, u := range upcoming {
		if u.At.After(now) {
			n := &Next{u.At, u.Project, u.Role, 0}
			for _, o := range upcoming[i+1:] {
				if o.At.Before(now.Add(week)) {
					n.MoreThisWeek++
				}
			}
			td.Next = n
			break
		}
	}

	for _, p := range all.Os("projects") {
		if p.V("validated") == true || p.S("status") == "finished" {
			continue
		}
		reg, err := time.ParseInLocation("2006-01-02 15:04", p.S("registered"), Madrid)
		if err != nil {
			continue
		}
		td.InProgress = append(td.InProgress, InProgress{p.V("name"), int(now.Sub(reg).Hours() / 24), p.S("registered"), len(p.L("attempts"))})
	}

	month := now.In(Madrid).Format("2006-01")
	td.Month.Month = month
	for _, m := range all.Obj("insights").Obj("pace").Os("months") {
		if m.S("month") == month {
			td.Month.XP, td.Month.Validated = m.I("xp"), m.I("validated")
		}
	}
	for _, k := range []string{"received", "given"} {
		for _, e := range all.Os(k) {
			if len(e.S("begin")) >= 7 && e.S("begin")[:7] == month {
				td.Month.Evaluations++
			}
		}
	}
	for _, m := range all.Obj("coalition_points").Os("months") {
		if m.S("month") == month {
			td.Month.CoalitionPoints = m.I("logtime") + m.I("other")
		}
	}
	return td
}
