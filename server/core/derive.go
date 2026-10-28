package core

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Figures built on a period's report for the pages: rhythm, contribution, technical domains, portfolio, the alumni
// estimate, the rank being worked on and the logtime bonus now.

const alumniMonths = 8

var workExperience = map[string]bool{"work-experience-i": true, "work-experience-ii": true}

// AlumniDue: a Transcender has eight months from the last validated 42cursus project to become alumni
// (swifty-companion's rule); an open work experience pauses the count ("paused"). nil for anyone else.
func AlumniDue(projects []*OMap, grade any) any {
	if grade != "Transcender" {
		return nil
	}
	waiting := map[string]bool{"waiting_for_correction": true, "searching_a_group": true, "creating_group": true}
	passed := func(p *OMap) bool { return !waiting[p.S("status")] && p.V("validated") == true }
	closed := func(p *OMap) bool { return passed(p) || p.V("validated") == false || p.S("status") == "finished" }
	last := ""
	for _, p := range projects {
		if p.S("track") == "piscine" {
			continue
		}
		if workExperience[strings.TrimPrefix(p.S("slug"), "42cursus-")] && !closed(p) {
			return "paused"
		}
		if passed(p) && p.S("marked") != "" {
			last = max(last, p.S("marked")[:10])
		}
	}
	if last == "" {
		return nil
	}
	d, _ := time.Parse("2006-01-02", last)
	first := time.Date(d.Year(), d.Month()+alumniMonths, 1, 0, 0, 0, 0, time.UTC)
	lastDay := first.AddDate(0, 1, -1).Day()
	return time.Date(first.Year(), first.Month(), min(d.Day(), lastDay), 0, 0, 0, 0, time.UTC).Format("2006-01-02")
}

var rankQuestName = regexp.MustCompile(`^Common Core Rank (\d\d)$`)

// MyRank is the user's own group, as RankGroups names it.
func MyRank(extras *OMap) any {
	var main *OMap
	for _, c := range extras.Os("cursus") {
		if c.S("name") == "42cursus" {
			main = c
			break
		}
	}
	if main == nil {
		return nil
	}
	if main.S("grade") == "Alumni" {
		return "alumni"
	}
	best, cc := -1, false
	for _, q := range extras.Os("quests") {
		if q.V("validated") == nil || q.V("validated") == "" {
			continue
		}
		if q.S("name") == "Common Core" {
			cc = true
		} else if m := rankQuestName.FindStringSubmatch(q.S("name")); m != nil {
			var n int
			fmt.Sscan(m[1], &n)
			best = max(best, n)
		}
	}
	if main.S("grade") == "Transcender" || cc {
		return "outer-core"
	}
	return fmt.Sprintf("rank-%02d", best+1)
}

func strsAndFloats(days, hours []any) ([]string, []float64) {
	ds, hs := make([]string, len(days)), make([]float64, len(hours))
	for i := range days {
		ds[i], _ = days[i].(string)
		hs[i], _ = toFloat(hours[i])
	}
	return ds, hs
}

// Streak is the most consecutive calendar days with logged time.
func Streak(days []string, hours []float64) int {
	best, run := 0, 0
	var prev time.Time
	for i, d := range days {
		if hours[i] == 0 {
			prev, run = time.Time{}, 0
			continue
		}
		day, _ := time.Parse("2006-01-02", d)
		if !prev.IsZero() && day.Sub(prev) == 24*time.Hour {
			run++
		} else {
			run = 1
		}
		best, prev = max(best, run), day
	}
	return best
}

// ActiveWeeks is (weeks with logged time, weeks from the first to the last logged day).
func ActiveWeeks(days []string, hours []float64) [2]int {
	var on []time.Time
	weeks := map[[2]int]bool{}
	for i, d := range days {
		if hours[i] != 0 {
			t, _ := time.Parse("2006-01-02", d)
			on = append(on, t)
			y, w := t.ISOWeek()
			weeks[[2]int{y, w}] = true
		}
	}
	if len(on) == 0 {
		return [2]int{0, 0}
	}
	// the span counts calendar weeks too (v1 counted days/7, so a Sunday and the next Monday read "2 of 1")
	monday := func(t time.Time) time.Time { return t.AddDate(0, 0, -((int(t.Weekday()) + 6) % 7)) }
	return [2]int{len(weeks), int(monday(on[len(on)-1]).Sub(monday(on[0])).Hours()/24)/7 + 1}
}

// DaySplit is the share of logged hours in the morning (6–14 h), afternoon (14–20 h) and night (20–6 h), Madrid time.
func DaySplit(heat []any) *OMap {
	total, morning, afternoon := 0.0, 0.0, 0.0
	for _, row := range heat {
		r, _ := row.([]any)
		for h, v := range r {
			f, _ := toFloat(v)
			total += f
			if h >= 6 && h < 14 {
				morning += f
			} else if h >= 14 && h < 20 {
				afternoon += f
			}
		}
	}
	if total == 0 {
		return M("morning", 0, "afternoon", 0, "night", 0)
	}
	m, a := pyRoundInt(100*morning/total), pyRoundInt(100*afternoon/total)
	return M("morning", m, "afternoon", a, "night", 100-m-a)
}

// Resilience counts projects validated after at least one failed attempt.
func Resilience(projects []*OMap) int {
	n := 0
	for _, p := range projects {
		if p.V("validated") == true && p.I("failed_attempts") > 0 {
			n++
		}
	}
	return n
}

var areaOrder = []string{"web", "mobile", "ai", "sysadmin", "unix", "security", "oop", "functional", "imperative", "suite"}
var areaTags = map[string][]string{"web": {"web", "web_db", "web_db_xp"}, "mobile": {"mobile"}, "ai": {"ai", "ai_xp"},
	"sysadmin": {"sysadmin"}, "unix": {"unix"}, "security": {"security", "security_xp"}, "oop": {"oop"},
	"functional": {"functional", "functional_xp"}, "imperative": {"imperative"}, "suite": {"suite"}}

// areaNames: technical areas from the RNCP tags, project names lower-cased.
var areaNames = sync.OnceValue(func() map[string]map[string]bool {
	var rncp struct {
		Tags map[string][]string `json:"tags"`
	}
	raw, _ := Data.ReadFile("data/rncp.json")
	if err := json.Unmarshal(raw, &rncp); err != nil {
		panic(err)
	}
	out := map[string]map[string]bool{}
	for area, tags := range areaTags {
		out[area] = map[string]bool{}
		for _, tag := range tags {
			for _, n := range rncp.Tags[tag] {
				out[area][strings.ToLower(strings.TrimSpace(n))] = true
			}
		}
	}
	return out
})

func projectKey(p *OMap) string { return strings.ToLower(strings.TrimSpace(p.S("name"))) }

// Domains: XP and validated projects per technical area, biggest first; areas with nothing validated left out.
func Domains(projects []*OMap) []any {
	var rows []*OMap
	for _, area := range areaOrder {
		names, xp := []any{}, 0.0
		for _, p := range projects {
			if p.V("validated") == true && areaNames()[area][projectKey(p)] {
				names = append(names, p.V("name"))
				xp += p.F("xp_earned")
			}
		}
		if len(names) > 0 {
			rows = append(rows, M("key", area, "xp", int(xp), "projects", names))
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].F("xp") > rows[j].F("xp") })
	return list(rows)
}

// Community: time spent evaluating others, how many people, and the rating they gave the student as evaluator.
func Community(given, received []*OMap) *OMap {
	mins, rated := 0.0, []any{}
	people, correctors := map[any]bool{}, map[any]bool{}
	for _, e := range given {
		mins += e.F("duration_min")
		if e.V("fb_rating") != nil {
			rated = append(rated, e.V("fb_rating"))
		}
		for _, c := range e.Os("correcteds") {
			people[c.V("login")] = true
		}
	}
	for _, e := range received {
		correctors[e.Obj("corrector").V("login")] = true
	}
	return M("hours", pyRound(mins/60, 1), "people", len(people), "correctors", len(correctors),
		"rating", sumAvg(rated, 2), "rated", len(rated))
}

// PortfolioRows: one line per validated project, for an application or a CV; no other person's data.
func PortfolioRows(projects []*OMap) []any {
	var done []*OMap
	for _, p := range projects {
		if p.V("validated") == true {
			done = append(done, p)
		}
	}
	sort.SliceStable(done, func(i, j int) bool { return done[i].S("marked") < done[j].S("marked") })
	rows := []any{}
	for _, p := range done {
		var areas []string
		for _, a := range areaOrder {
			if areaNames()[a][projectKey(p)] {
				areas = append(areas, a)
			}
		}
		attempts := p.Os("attempts")
		members := 0
		for i := len(attempts) - 1; i >= 0; i-- {
			if attempts[i].V("validated") == true {
				members = len(attempts[i].L("members"))
				break
			}
		}
		cut := func(s string) string {
			if len(s) > 10 {
				return s[:10]
			}
			return s
		}
		rows = append(rows, []any{p.V("name"), p.V("track"), strings.Join(areas, ", "), cut(p.S("registered")), cut(p.S("marked")),
			p.V("mark"), len(attempts), p.V("xp_earned"), members + 1, p.V("days_to_validate")})
	}
	return rows
}

// Derive gathers the figures the pages show for one period; all is the "all" period's report.
func Derive(r, all *OMap, now time.Time) *OMap {
	L := r.Obj("logtime")
	days, hours := strsAndFloats(L.L("days"), L.L("hours"))
	var grade any
	for _, c := range r.Obj("extras").Os("cursus") {
		if c.S("name") == "42cursus" {
			grade = c.V("grade")
			break
		}
	}
	var bonus any
	if w, ok := r.Get("logtime_bonus"); ok && w != nil {
		bonus = LogtimeBonus(w.(*OMap), now)
	}
	return M("alumni_due", AlumniDue(all.Os("projects"), grade), "my_rank", MyRank(r.Obj("extras")),
		"streak", Streak(days, hours), "active_weeks", ActiveWeeks(days, hours), "day_split", DaySplit(L.L("heat")),
		"resilience", Resilience(r.Os("projects")), "domains", Domains(r.Os("projects")),
		"community", Community(r.Os("given"), r.Os("received")), "portfolio", PortfolioRows(r.Os("projects")),
		"logtime_bonus", bonus)
}
