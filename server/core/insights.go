package core

import (
	"encoding/json"
	"math"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
)

// Extra views on a student's data: campus history, teammates, exams, pace, evaluations in depth, the promo, the
// campus coalitions, the network among the closest contacts and the coalition points. Pure functions: no API calls.

func localDay(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t.In(Madrid).Format("2006-01-02")
}

func campusHistory(user Raw, locations []Raw, now time.Time) []any {
	info := map[float64]Raw{}
	for _, c := range Objs(user, "campus") {
		info[Num(c, "id")] = c
	}
	var rows []*OMap
	for _, cu := range Objs(user, "campus_users") {
		cid := cu["campus_id"]
		var sessions []span
		for _, l := range locations {
			if l["campus_id"] == cid {
				e := tsAny(l["end_at"])
				if e.IsZero() {
					e = now
				}
				sessions = append(sessions, span{tsAny(l["begin_at"]), e})
			}
		}
		secs := 0.0
		for _, s := range MergeIntervals(sessions) {
			secs += totalSeconds(s.e.Sub(s.b))
		}
		var first, last time.Time
		for i, s := range sessions {
			if i == 0 || s.b.Before(first) {
				first = s.b
			}
			if i == 0 || s.b.After(last) {
				last = s.b
			}
		}
		cidF, _ := cid.(float64)
		var joined any
		if j := Str(cu, "created_at"); len(j) >= 10 {
			joined = j[:10]
		} else if j != "" {
			joined = j
		}
		rows = append(rows, M("id", cid, "name", nilIfEmpty(info[cidF], "name"), "city", nilIfEmpty(info[cidF], "city"),
			"primary", Bool(cu, "is_primary"), "joined", joined, "sessions", len(sessions), "hours", pyRound(secs/3600, 1),
			"first", localDay(first), "last", localDay(last)))
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.B("primary") != b.B("primary") {
			return a.B("primary")
		}
		return a.S("joined") < b.S("joined")
	})
	return list(rows)
}

func teammates(projects []*OMap, me string, names map[string]any) []any {
	acc, order := map[string]*OMap{}, []string{}
	for _, p := range projects {
		for _, a := range p.Os("attempts") {
			for _, m := range a.L("members") {
				login, _ := m.(string)
				if login == me {
					continue
				}
				row := acc[login]
				if row == nil {
					row = M("login", login, "name", names[login], "teams", 0, "projects", NewOMap())
					acc[login] = row
					order = append(order, login)
				}
				row.Set("teams", row.I("teams")+1)
				pr := row.Obj("projects")
				pr.Set(p.S("name"), pr.I(p.S("name"))+1)
			}
		}
	}
	sort.SliceStable(order, func(i, j int) bool { return acc[order[i]].I("teams") > acc[order[j]].I("teams") })
	out := []any{}
	for _, l := range order {
		out = append(out, acc[l])
	}
	return out
}

func exams(projects []*OMap) []any {
	rows := []any{}
	for _, p := range projects {
		if !p.B("exam") {
			continue
		}
		var tries []*OMap
		for _, a := range p.Os("attempts") {
			d := a.S("start")
			if len(d) > 10 {
				d = d[:10]
			}
			tries = append(tries, M("date", d, "mark", a.V("mark"), "passed", a.V("validated") == true))
		}
		var passedOn string
		for _, t := range tries {
			if t.B("passed") {
				passedOn = t.S("date")
				break
			}
		}
		var days any
		if passedOn != "" && len(tries) > 0 {
			a, _ := time.Parse("2006-01-02", passedOn)
			b, _ := time.Parse("2006-01-02", tries[0].S("date"))
			days = int(math.Floor(a.Sub(b).Hours() / 24))
		}
		var best any
		for i, t := range tries {
			m, _ := toFloat(t.V("mark"))
			if i == 0 || m > best.(float64) {
				best = m
			}
		}
		rows = append(rows, M("name", p.V("name"), "track", p.V("track"), "passed", p.V("validated") == true, "attempts", len(tries),
			"best", best, "days_to_pass", days, "tries", list(tries)))
	}
	return rows
}

func pace(projects []*OMap, cursus *OMap, now time.Time) *OMap {
	type month struct{ xp, validated float64 }
	byMonth := map[string]*month{}
	for _, p := range projects {
		if p.V("validated") == true && p.S("marked") != "" {
			k := p.S("marked")[:7]
			if byMonth[k] == nil {
				byMonth[k] = &month{}
			}
			byMonth[k].xp += p.F("xp_earned")
			byMonth[k].validated++
		}
	}
	months, total := []any{}, 0.0
	if len(byMonth) > 0 {
		keys := make([]string, 0, len(byMonth))
		for k := range byMonth {
			keys = append(keys, k)
		}
		slices.Sort(keys)
		end := max(keys[len(keys)-1], now.In(Madrid).Format("2006-01"))
		for _, k := range monthRange(keys[0], end) {
			m := byMonth[k]
			if m == nil {
				m = &month{}
			}
			total += m.xp
			months = append(months, M("month", k, "xp", int(m.xp), "validated", int(m.validated), "cumulative", int(total)))
		}
	}
	var since, blackhole, xpPerMonth any
	if b := cursus.S("begin"); b != "" {
		start, _ := time.Parse("2006-01-02 15:04", b)
		today := now.In(Madrid)
		n := (today.Year()-start.Year())*12 + int(today.Month()) - int(start.Month())
		if today.Day() < start.Day() {
			n--
		}
		since = n
		if n != 0 {
			xpPerMonth = pyRoundInt(total / float64(n))
		}
	}
	if b := cursus.S("blackholed"); b != "" {
		end, _ := time.ParseInLocation("2006-01-02 15:04", b, Madrid)
		blackhole = max(int(math.Floor(end.Sub(now).Hours()/24)), 0)
	}
	return M("months", months, "months_since_kickoff", since, "blackhole_days", blackhole, "xp_per_month", xpPerMonth)
}

func evaluationDepth(received, given []*OMap) *OMap {
	type row struct {
		project                   any
		received, recvOut, given  int
		receivedMarks, givenMarks []any
	}
	rows, order := map[any]*row{}, []any{}
	for _, role := range []string{"received", "given"} {
		evs := received
		if role == "given" {
			evs = given
		}
		for _, e := range evs {
			k := e.V("project")
			r := rows[k]
			if r == nil {
				r = &row{project: k}
				rows[k] = r
				order = append(order, k)
			}
			done := e.S("status") == "done" && e.V("mark") != nil
			if role == "received" {
				r.received++
				if done {
					r.receivedMarks = append(r.receivedMarks, e.V("mark"))
				}
				if e.B("outstanding") {
					r.recvOut++
				}
			} else {
				r.given++
				if done {
					r.givenMarks = append(r.givenMarks, e.V("mark"))
				}
			}
		}
	}
	sort.SliceStable(order, func(i, j int) bool { return rows[order[i]].received > rows[order[j]].received })
	projects := []any{}
	for _, k := range order {
		r := rows[k]
		projects = append(projects, M("project", r.project, "received", r.received, "received_avg", sumAvg(r.receivedMarks, 1),
			"received_outstanding", r.recvOut, "given", r.given, "given_avg", sumAvg(r.givenMarks, 1)))
	}
	byBegin := slices.Clone(received)
	sort.SliceStable(byBegin, func(i, j int) bool { return byBegin[i].S("begin") < byBegin[j].S("begin") })
	streak, best := 0, 0
	for _, e := range byBegin {
		if e.B("outstanding") {
			streak++
		} else {
			streak = 0
		}
		best = max(best, streak)
	}
	pick := func(evs []*OMap, k string) []any {
		var out []any
		for _, e := range evs {
			out = append(out, e.V(k))
		}
		return out
	}
	duration := func(evs []*OMap) *OMap {
		return M("avg", sumAvg(pick(evs, "duration_min"), 1), "median", medianOpt(pick(evs, "duration_min"), 1))
	}
	return M("projects", projects, "received_duration", duration(received), "given_duration", duration(given),
		"received_lead_h", medianOpt(pick(received, "lead_h"), 1), "given_lead_h", medianOpt(pick(given, "lead_h"), 1),
		"outstanding_streak", best)
}

// PromoStanding is where a level sits among the students who started the 42cursus the same week: counts only.
func PromoStanding(levels []float64, mine float64) any {
	if len(levels) == 0 {
		return nil
	}
	hist := newCounted()
	above, atOrBelow := 0, 0
	for _, l := range levels {
		hist.add(int(l), 1)
		if l > mine {
			above++
		} else {
			atOrBelow++
		}
	}
	keys := slices.Clone(hist.keys)
	slices.SortFunc(keys, func(a, b any) int { return a.(int) - b.(int) })
	h := []any{}
	for _, k := range keys {
		h = append(h, M("level", k, "count", int(hist.n[k])))
	}
	return M("size", len(levels), "rank", 1+above, "percentile", pyRound(100*float64(atOrBelow)/float64(len(levels)), 1),
		"median", pyRound(median(levels), 2), "mine", mine, "histogram", h)
}

// CoalitionStandings ranks the campus coalitions by score, with yours marked.
func CoalitionStandings(bloc Raw, mineID any) []any {
	cs := Objs(bloc, "coalitions")
	sort.SliceStable(cs, func(i, j int) bool { return Num(cs[i], "score") > Num(cs[j], "score") })
	out := []any{}
	for i, c := range cs {
		score := any(0)
		if v, ok := c["score"].(float64); ok && v != 0 {
			score = v
		}
		out = append(out, M("name", c["name"], "color", c["color"], "score", score, "rank", i+1, "mine", mineID != nil && c["id"] == mineID))
	}
	return out
}

// ContactNetwork is who evaluated whom among you and your closest contacts: nodes and directed links
// (corrector → evaluated). keep(begin_at) picks the evaluations of one period.
func ContactNetwork(me string, contacts []*OMap, givenBy map[string][]Raw, keep func(string) bool) *OMap {
	nodes := []any{M("login", me, "group", "me")}
	known := map[string]bool{me: true}
	for _, c := range contacts {
		nodes = append(nodes, M("login", c.V("login"), "group", c.V("group")))
		known[c.S("login")] = true
	}
	type link struct{ s, t string }
	counts, order := map[link]int{}, []link{}
	for _, c := range contacts {
		for _, e := range givenBy[c.S("login")] {
			us, ok := e["correcteds"].([]any)
			if !ok || !keep(Str(e, "begin_at")) {
				continue
			}
			for _, u := range us {
				o, _ := u.(Raw)
				target := Str(o, "login")
				if o != nil && known[target] && target != c.S("login") {
					k := link{c.S("login"), target}
					if _, seen := counts[k]; !seen {
						order = append(order, k)
					}
					counts[k]++
				}
			}
		}
	}
	links := []any{}
	for _, k := range order {
		links = append(links, M("source", k.s, "target", k.t, "count", counts[k]))
	}
	return M("nodes", nodes, "links", links)
}

var skillOrder = sync.OnceValue(func() *OMap {
	raw, _ := Data.ReadFile("data/skills.json")
	m, err := ParseOrdered(raw)
	if err != nil {
		panic(err)
	}
	return m
})

// SkillSets lists each cursus's skills in the intra's radar order, every skill included (0 when not started).
func SkillSets(cursusUsers []Raw) *OMap {
	out := NewOMap()
	order := skillOrder()
	for _, cu := range cursusUsers {
		name := Str(Obj(cu, "cursus"), "name")
		if strings.HasPrefix(name, "_") {
			continue
		}
		want, ok := order.Get(name)
		if !ok {
			continue
		}
		levels := NewOMap()
		for _, s := range Objs(cu, "skills") {
			levels.Set(Str(s, "name"), s["level"])
		}
		known := map[string]bool{}
		items := []any{}
		for _, n := range want.([]any) {
			k := n.(string)
			known[k] = true
			lv, has := levels.Get(k)
			if !has {
				lv = 0
			}
			items = append(items, M("name", k, "level", lv))
		}
		for _, k := range levels.Keys() {
			if !known[k] {
				items = append(items, M("name", k, "level", levels.V(k)))
			}
		}
		out.Set(name, items)
	}
	return out
}

// Coalition points: /coalitions_users/:id/scores. The logtime bonus rule is inferred (see .development/42-api.md): at
// every logout the intra sums the last 7 rolling days, overlaps merged; >= 50 h gives +500 (calculation 7), >= 80 h
// +1000 (calculation 20), each at most once every 7 days since it was last given.
var (
	bonusTiers  = []struct{ calc, hours, points int }{{7, 50, 500}, {20, 80, 1000}}
	scoreSource = map[string]string{"ScaleTeam": "evaluations", "ProjectsUser": "projects", "Team": "exams", "Location": "logtime", "Transaction": "wallet"}
)

const (
	week         = 7 * 24 * time.Hour
	recentPoints = 40
)

func bonusHours(calc any) (int, bool) {
	c, _ := calc.(float64)
	for _, t := range bonusTiers {
		if float64(t.calc) == c {
			return t.hours, true
		}
	}
	return 0, false
}

// CoalitionPoints: points by source (biggest first), per Madrid month (logtime apart), the logtime bonuses and the
// latest awards (scoreable_id says which project, evaluation or exam each came from).
func CoalitionPoints(scores []Raw) *OMap {
	type src struct {
		key           string
		points, count float64
	}
	sources, srcOrder := map[string]*src{}, []string{}
	type mo struct{ logtime, other float64 }
	months := map[string]*mo{}
	var recent, bonuses []*OMap
	for _, s := range scores {
		key, ok := scoreSource[Str(s, "scoreable_type")]
		if !ok {
			key = "other"
		}
		if h, isBonus := bonusHours(s["calculation_id"]); key == "logtime" && isBonus {
			key = "logtime_" + json_int(float64(h)).(string)
		}
		recent = append(recent, M("at", s["created_at"], "key", key, "points", s["value"], "id", s["scoreable_id"]))
		if sources[key] == nil {
			sources[key] = &src{key: key}
			srcOrder = append(srcOrder, key)
		}
		sources[key].points += Num(s, "value")
		sources[key].count++
		mk := tsAny(s["created_at"]).In(Madrid).Format("2006-01")
		if months[mk] == nil {
			months[mk] = &mo{}
		}
		if strings.HasPrefix(key, "logtime") {
			months[mk].logtime += Num(s, "value")
		} else {
			months[mk].other += Num(s, "value")
		}
		if h, isBonus := bonusHours(s["calculation_id"]); Str(s, "scoreable_type") == "Location" && isBonus {
			bonuses = append(bonuses, M("at", s["created_at"], "hours", h, "points", s["value"]))
		}
	}
	span := []any{}
	if len(months) > 0 {
		keys := make([]string, 0, len(months))
		for k := range months {
			keys = append(keys, k)
		}
		slices.Sort(keys)
		for _, k := range monthRange(keys[0], keys[len(keys)-1]) {
			m := months[k]
			if m == nil {
				m = &mo{}
			}
			span = append(span, M("month", k, "logtime", m.logtime, "other", m.other))
		}
	}
	byAtDesc := func(xs []*OMap) {
		sort.SliceStable(xs, func(i, j int) bool { return xs[i].S("at") > xs[j].S("at") })
	}
	byAtDesc(bonuses)
	byAtDesc(recent)
	if len(recent) > recentPoints {
		recent = recent[:recentPoints]
	}
	sort.SliceStable(srcOrder, func(i, j int) bool { return sources[srcOrder[i]].points > sources[srcOrder[j]].points })
	srcRows, total := []any{}, 0.0
	for _, k := range srcOrder {
		s := sources[k]
		total += s.points
		srcRows = append(srcRows, M("key", s.key, "points", s.points, "count", int(s.count)))
	}
	return M("total", total, "count", len(scores), "sources", srcRows, "months", span, "bonuses", list(bonuses), "recent", list(recent))
}

// BonusWindow is what LogtimeBonus needs, kept in the report: the last 7 days of sessions (merged; an open one ends
// now) and when each bonus was last given.
func BonusWindow(locations, scores []Raw, now time.Time) *OMap {
	start := now.Add(-week)
	var in []span
	open := false
	for _, l := range locations {
		e := tsAny(l["end_at"])
		if !truthy(l["end_at"]) {
			open = true
		}
		if e.IsZero() {
			e = now
		}
		if e.After(start) {
			in = append(in, span{maxT(tsAny(l["begin_at"]), start), minT(e, now)})
		}
	}
	sessions := []any{}
	for _, s := range MergeIntervals(in) {
		if s.e.After(s.b) {
			sessions = append(sessions, []any{pyISO(s.b), pyISO(s.e)})
		}
	}
	last := NewOMap()
	for _, t := range bonusTiers {
		var best any
		for _, s := range scores {
			if Str(s, "scoreable_type") == "Location" && Num(s, "calculation_id") == float64(t.calc) {
				if c := Str(s, "created_at"); best == nil || c > best.(string) {
					best = c
				}
			}
		}
		last.Set(json_int(float64(t.hours)).(string), best)
	}
	return M("at", pyISO(now), "open", open, "sessions", sessions, "last", last)
}

// AddInsights adds the extra views to one period's report; d is that period's data (campus hours follow the period).
func AddInsights(r *OMap, d Raw, now time.Time) {
	user := Obj(d, "user")
	var primary Raw
	for _, c := range Objs(user, "campus_users") {
		if Bool(c, "is_primary") {
			primary = c
			break
		}
	}
	var current any
	for _, c := range Objs(user, "campus") {
		if primary != nil && c["id"] == primary["campus_id"] {
			current = c["name"]
		}
	}
	r.Obj("profile").Set("campus_current", current)
	r.Set("campuses", campusHistory(user, Objs(d, "locations"), now))
	names := map[string]any{}
	for _, p := range Objs(d, "people") {
		if l := Str(p, "login"); l != "" {
			n := p["displayname"]
			if !truthy(n) {
				n = p["name"]
			}
			names[l] = n
		}
	}
	var main *OMap
	for _, c := range r.Obj("extras").Os("cursus") {
		if c.S("name") == "42cursus" {
			main = c
			break
		}
	}
	if main == nil {
		main = NewOMap()
	}
	projects := r.Os("projects")
	r.Set("insights", M("teammates", teammates(projects, r.Obj("profile").S("login"), names), "exams", exams(projects),
		"pace", pace(projects, main, now), "evaluations", evaluationDepth(r.Os("received"), r.Os("given"))))
}

// keep json imported for json.Number use in toFloat callers.
var _ = json.Number("")
