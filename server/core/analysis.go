package core

import (
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Turn the raw 42 API datasets into one report: an ordered JSON object, the same shape as v1's.

const outstandingFlag = "Outstanding project"

var (
	weekdays      = []string{"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}
	feedbackKinds = []string{"nice", "rigorous", "interested", "punctuality"}
	Periods       = []string{"piscine", "student", "all"}
	periodLabels  = map[string]string{"piscine": "Piscine", "student": "Student", "all": "All periods"}
	seatRe        = regexp.MustCompile(`c(\d+)r(\d+)s(\d+)$`)
)

func weekdayIndex(t time.Time) int { return (int(t.Weekday()) + 6) % 7 }

func Cluster(host string) string {
	if strings.HasPrefix(host, "c") && strings.Contains(host, "r") {
		return strings.SplitN(host, "r", 2)[0]
	}
	return host
}

func clusterAny(h any) any {
	if s, ok := h.(string); ok && s != "" {
		return Cluster(s)
	}
	return h
}

type span struct{ b, e time.Time }

// SessionHost is the host of the session overlapping [start, end] the most, or nil.
func SessionHost(sessions []Raw, start, end, now time.Time) any {
	var best any
	var bestOverlap time.Duration
	for _, s := range sessions {
		b, e := TS(Str(s, "begin_at")), TS(Str(s, "end_at"))
		if e.IsZero() {
			e = now
		}
		if o := minT(e, end).Sub(maxT(b, start)); o > bestOverlap {
			best, bestOverlap = s["host"], o
		}
	}
	return best
}

func minT(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func maxT(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

// MergeIntervals is the union of intervals: overlapping sessions on two hosts count once.
func MergeIntervals(in []span) []span {
	s := slices.Clone(in)
	sort.SliceStable(s, func(i, j int) bool {
		if !s[i].b.Equal(s[j].b) {
			return s[i].b.Before(s[j].b)
		}
		return s[i].e.Before(s[j].e)
	})
	var out []span
	for _, x := range s {
		if n := len(out); n > 0 && !x.b.After(out[n-1].e) {
			out[n-1].e = maxT(out[n-1].e, x.e)
		} else {
			out = append(out, x)
		}
	}
	return out
}

type dayKey = string

// SplitByDay is the seconds of [begin, end] spent on each local calendar day, in day order.
func SplitByDay(begin, end time.Time) ([]dayKey, map[dayKey]float64) {
	out, keys := map[dayKey]float64{}, []dayKey{}
	for cur := begin.UTC(); cur.Before(end); {
		l := cur.In(Madrid)
		next := time.Date(l.Year(), l.Month(), l.Day()+1, 0, 0, 0, 0, Madrid).UTC()
		chunk := minT(next, end)
		k := l.Format("2006-01-02")
		if _, ok := out[k]; !ok {
			keys = append(keys, k)
		}
		out[k] += totalSeconds(chunk.Sub(cur))
		cur = chunk
	}
	return keys, out
}

type hourKey struct{ wd, hour int }

// SplitByHour is the seconds of [begin, end] in each local (weekday, hour); Madrid offsets are whole hours.
func SplitByHour(begin, end time.Time) map[hourKey]float64 {
	out := map[hourKey]float64{}
	for cur := begin.UTC(); cur.Before(end); {
		chunk := minT(cur.Add(time.Hour).Truncate(time.Hour), end)
		l := cur.In(Madrid)
		out[hourKey{weekdayIndex(l), l.Hour()}] += totalSeconds(chunk.Sub(cur))
		cur = chunk
	}
	return out
}

func feedbackEntry(f Raw) *OMap {
	out := M("by", nilIfEmpty(Obj(f, "user"), "login"), "comment", f["comment"], "rating", f["rating"], "at", fmtT(tsAny(f["created_at"])))
	for _, d := range Objs(f, "feedback_details") {
		out.Set(Str(d, "kind"), d["rate"])
	}
	return out
}

func nilIfEmpty(r Raw, k string) any {
	if r == nil {
		return nil
	}
	return r[k]
}

func feedbackScores(entries []*OMap) *OMap {
	pick := func(k string) []any {
		var vs []any
		for _, e := range entries {
			vs = append(vs, e.V(k))
		}
		return vs
	}
	out := M("rating", avg(pick("rating"), 1))
	for _, k := range feedbackKinds {
		out.Set(k, avg(pick(k), 2))
	}
	return out
}

func heatmap(evals []*OMap) []any {
	grid := make([][]int, 7)
	for i := range grid {
		grid[i] = make([]int, 24)
	}
	for _, e := range evals {
		grid[e.I("wd")][e.I("hour")]++
	}
	out := make([]any, 7)
	for i, r := range grid {
		out[i] = list(r)
	}
	return out
}

// histogram counts per [edges[i], edges[i+1]); the last bin is open-ended.
func histogram(vals []any, edges []float64) []any {
	counts := make([]int, len(edges))
	for _, f := range floats(vals) {
		i := sort.Search(len(edges), func(i int) bool { return edges[i] > f }) - 1
		counts[max(i, 0)]++
	}
	return list(counts)
}

func cursusOf(user Raw, id int) Raw {
	for _, c := range Objs(user, "cursus_users") {
		if Num(c, "cursus_id") == float64(id) {
			return c
		}
	}
	return nil
}

func filterObjs(r Raw, k string, keep func(Raw) bool) []any {
	out := []any{}
	for _, x := range Objs(r, k) {
		if keep(x) {
			out = append(out, x)
		}
	}
	return out
}

// ForPeriod keeps one period's data: "student" (the 42cursus, from its kickoff), "piscine" (everything else) or "all".
// "student" drops C Piscine projects and quests plus everything dated before the kickoff; "piscine" keeps exactly
// that, so the two add up to "all".
func ForPeriod(d Raw, period string) Raw {
	cursus := cursusOf(Obj(d, "user"), MainCursus)
	if period == "all" || cursus == nil || Str(cursus, "begin_at") == "" {
		return d
	}
	start := TS(Str(cursus, "begin_at"))
	piscineProjects := map[float64]bool{}
	for _, p := range Objs(d, "projects_users") {
		for _, c := range List(p, "cursus_ids") {
			if c == float64(PiscineCursus) {
				piscineProjects[Num(Obj(p, "project"), "id")] = true
			}
		}
	}
	student := period == "student"
	keep := func(isStudent bool) bool { return isStudent == student }
	after := func(v any) bool { s, ok := v.(string); return ok && !TS(s).Before(start) }
	inPiscine := func(v any) bool { f, ok := v.(float64); return ok && piscineProjects[f] }
	evalKept := func(e Raw) bool { return keep(after(e["begin_at"]) && !inPiscine(Obj(e, "team")["project_id"])) }

	out := Raw{}
	for k, v := range d {
		out[k] = v
	}
	user := Raw{}
	for k, v := range Obj(d, "user") {
		user[k] = v
	}
	user["cursus_users"] = filterObjs(Obj(d, "user"), "cursus_users", func(c Raw) bool { return keep(Num(c, "cursus_id") != PiscineCursus) })
	out["user"] = user
	out["projects_users"] = filterObjs(d, "projects_users", func(p Raw) bool { return keep(!piscineProjects[Num(Obj(p, "project"), "id")]) })
	out["teams"] = filterObjs(d, "teams", func(t Raw) bool { return keep(!inPiscine(t["project_id"])) })
	out["evals_received"] = filterObjs(d, "evals_received", evalKept)
	out["evals_given"] = filterObjs(d, "evals_given", evalKept)
	out["locations"] = filterObjs(d, "locations", func(s Raw) bool { return keep(after(s["begin_at"])) })
	if stats := Obj(d, "locations_stats"); stats != nil { // older reports have none: keep it absent, not empty
		day, kept := start.Format("2006-01-02"), Raw{}
		for k, v := range stats {
			if keep(k >= day) {
				kept[k] = v
			}
		}
		out["locations_stats"] = kept
	}
	if d["coalition_scores"] != nil {
		out["coalition_scores"] = filterObjs(d, "coalition_scores", func(x Raw) bool { return keep(after(x["created_at"])) })
	}
	out["correction_points"] = filterObjs(d, "correction_points", func(c Raw) bool { return keep(after(c["created_at"])) })
	out["events_users"] = filterObjs(d, "events_users", func(e Raw) bool { return keep(after(Obj(e, "event")["begin_at"])) })
	out["quests_users"] = filterObjs(d, "quests_users", func(q Raw) bool { return keep(Num(Obj(q, "quest"), "cursus_id") != PiscineCursus) })
	for _, name := range []string{"achievements_users", "titles_users", "expertises_users"} {
		out[name] = filterObjs(d, name, func(x Raw) bool { return keep(after(x["created_at"])) })
	}
	return out
}

// officialHours is the intra's own total from /locations_stats ("HH:MM:SS.ffffff" per day); nil when not fetched.
func officialHours(stats Raw) any {
	if stats == nil {
		return nil
	}
	total := 0.0
	for _, v := range stats {
		parts := strings.Split(pyStr(v), ":")
		if len(parts) != 3 {
			continue
		}
		h, _ := strconv.Atoi(parts[0])
		m, _ := strconv.Atoi(parts[1])
		s, _ := strconv.ParseFloat(parts[2], 64)
		total += float64(h*3600+m*60) + s
	}
	return pyRound(total/3600, 1)
}

// SeatLayout is the rows and seats per cluster, from every host code seen (c<cluster>r<row>s<seat>).
func SeatLayout(hosts []string) *OMap {
	type rs struct{ c, r, s int }
	acc := map[int]*rs{}
	for _, h := range hosts {
		m := seatRe.FindStringSubmatch(h)
		if m == nil || !strings.HasPrefix(h, "c") {
			continue
		}
		c, _ := strconv.Atoi(m[1])
		r, _ := strconv.Atoi(m[2])
		s, _ := strconv.Atoi(m[3])
		if acc[c] == nil {
			acc[c] = &rs{c: c}
		}
		acc[c].r, acc[c].s = max(acc[c].r, r), max(acc[c].s, s)
	}
	cs := make([]int, 0, len(acc))
	for c := range acc {
		cs = append(cs, c)
	}
	slices.Sort(cs)
	out := NewOMap()
	for _, c := range cs {
		out.Set("c"+strconv.Itoa(c), M("rows", acc[c].r, "seats", acc[c].s))
	}
	return out
}

type report struct {
	d             Raw
	now           time.Time
	user          Raw
	login         string
	projects      map[float64]Raw
	people        map[float64]Raw
	teams         map[float64]Raw
	mySessions    []Raw
	feedbackByEva Raw
}

func newReport(d Raw, now time.Time) *report {
	r := &report{d: d, now: now, user: Obj(d, "user"), projects: map[float64]Raw{}, people: map[float64]Raw{}, teams: map[float64]Raw{}}
	r.login = Str(r.user, "login")
	for _, p := range Objs(d, "projects") {
		r.projects[Num(p, "id")] = p
	}
	for _, p := range Objs(d, "people") {
		r.people[Num(p, "id")] = p
	}
	for _, t := range Objs(d, "teams") {
		r.teams[Num(t, "id")] = t
	}
	r.mySessions = Objs(d, "locations")
	sort.SliceStable(r.mySessions, func(i, j int) bool { return Str(r.mySessions[i], "begin_at") < Str(r.mySessions[j], "begin_at") })
	r.feedbackByEva = Obj(d, "feedbacks")
	return r
}

func (r *report) projectName(pid any) any {
	f, ok := pid.(float64)
	if p := r.projects[f]; ok && p != nil {
		return p["name"]
	}
	return "project " + pyStr(numOrNone(pid))
}

func numOrNone(v any) any {
	if f, ok := v.(float64); ok {
		return json_int(f)
	}
	return v
}

// json_int keeps whole numbers printing like Python ints.
func json_int(f float64) any {
	if f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

func (r *report) person(ref Raw) *OMap {
	p := r.people[Num(ref, "id")]
	login := any("?")
	if s := Str(ref, "login"); s != "" {
		login = s
	} else if s := Str(p, "login"); s != "" {
		login = s
	}
	return M("login", login, "name", nilIfEmpty(p, "displayname"), "staff", Bool(p, "staff?"),
		"image", nilIfEmpty(Obj(Obj(p, "image"), "versions"), "small"))
}

func (r *report) feedbacksOf(e Raw) []Raw {
	if f := Objs(r.feedbackByEva, idStr(e["id"])); len(f) > 0 {
		return f
	}
	return Objs(e, "feedbacks")
}

func (r *report) window(e Raw) (begin, end time.Time, planned time.Duration) {
	begin = tsAny(e["begin_at"])
	secs := Num(Obj(e, "scale"), "duration")
	if secs == 0 {
		secs = 1800
	}
	planned = time.Duration(secs * float64(time.Second))
	filled := tsAny(e["filled_at"])
	if !filled.IsZero() && filled.After(begin) {
		return begin, filled, planned
	}
	return begin, begin.Add(planned), planned
}

// noMark says why an evaluation has no mark: still ahead, someone did not show up, or the team's project still open
// or closed.
func (r *report) noMark(e Raw, begin, filled time.Time, team Raw) any {
	if !filled.IsZero() || e["final_mark"] != nil {
		return nil
	}
	if begin.After(r.now) {
		return "pending"
	}
	if truant := Str(Obj(e, "truant"), "login"); truant != "" {
		if truant == r.login {
			return "absent_you"
		}
		return "absent_them"
	}
	if Bool(team, "closed?") {
		return "closed"
	}
	return "unfinished"
}

func minutesBetween(a, b time.Time) any {
	if a.IsZero() || b.IsZero() {
		return nil
	}
	return pyRound(totalSeconds(b.Sub(a))/60, 1)
}

func sessionsOf(v any) []Raw {
	var out []Raw
	l, _ := v.([]any)
	for _, x := range l {
		if o, ok := x.(Raw); ok {
			out = append(out, o)
		}
	}
	return out
}

func (r *report) evaluation(e Raw, role string) *OMap {
	begin, end, planned := r.window(e)
	created, filled := tsAny(e["created_at"]), tsAny(e["filled_at"])
	flag := Obj(e, "flag")
	var flagName any
	if flag != nil {
		flagName = flag["name"]
	}
	team := Obj(e, "team")
	var fbs []*OMap
	for _, f := range r.feedbacksOf(e) {
		entry := feedbackEntry(f)
		// teammates' feedback on the corrector is about someone else: keep only the user's own
		if role == "received" && entry.V("by") != r.login {
			continue
		}
		fbs = append(fbs, entry)
	}
	scores := feedbackScores(fbs)
	correcteds := []any{}
	for _, c := range List(e, "correcteds") {
		if o, ok := c.(Raw); ok {
			correcteds = append(correcteds, r.person(o))
		}
	}
	var leadH any
	if !created.IsZero() {
		leadH = pyRound(totalSeconds(begin.Sub(created))/3600, 1)
	}
	status := "not filled"
	if filled.IsZero() && begin.After(r.now) {
		status = "pending"
	} else if !filled.IsZero() {
		status = "done"
	}
	negative := false
	if flag != nil && len(flag) > 0 {
		pos, has := flag["positive"].(bool)
		negative = has && !pos
	}
	pid := nilIfEmpty(team, "project_id")
	var slug any
	if f, ok := pid.(float64); ok && r.projects[f] != nil {
		slug = r.projects[f]["slug"]
	}
	fbScores := NewOMap()
	for _, k := range feedbackKinds {
		fbScores.Set(k, scores.V(k))
	}
	lb := begin.In(Madrid)
	out := M(
		"id", e["id"], "role", role, "project", r.projectName(pid), "project_id", pid, "slug", slug,
		"team_id", nilIfEmpty(team, "id"), "team", nilIfEmpty(team, "name"),
		"corrector", r.person(Obj(e, "corrector")), "correcteds", correcteds,
		"booked", fmtT(created), "begin", fmtT(begin), "begin_ms", msT(begin), "filled", fmtT(filled), "filled_ms", msT(filled),
		"duration_min", minutesBetween(begin, filled), "planned_min", pyRoundInt(totalSeconds(planned)/60), "lead_h", leadH,
		"weekday", weekdays[weekdayIndex(lb)], "wd", weekdayIndex(lb), "hour", lb.Hour(),
		"mark", e["final_mark"], "flag", flagName, "outstanding", flagName == outstandingFlag, "negative_flag", negative,
		"status", status, "truant", nilIfEmpty(Obj(e, "truant"), "login"), "no_mark", r.noMark(e, begin, filled, team),
		"comment", e["comment"], "feedback", e["feedback"], "feedbacks", list(fbs),
		"fb_rating", scores.V("rating"), "fb_scores", fbScores,
		"my_host", SessionHost(r.mySessions, begin, end, r.now),
	)
	// the other side's seat, looked up for recent evaluations only; it rides on the person so a hidden one loses it
	if role == "received" {
		looked := Obj(r.d, "corrector_sessions")
		_, checked := looked[idStr(e["id"])]
		host := SessionHost(sessionsOf(looked[idStr(e["id"])]), begin, end, r.now)
		out.Set("other_host", host)
		out.Set("other_host_checked", checked)
		out.V("corrector").(*OMap).Set("host", host)
	} else {
		looked, checked := Obj(r.d, "evaluated_sessions")[idStr(e["id"])].(Raw)
		out.Set("other_host_checked", checked)
		for _, c := range correcteds {
			co := c.(*OMap)
			if checked {
				co.Set("host", SessionHost(sessionsOf(looked[co.S("login")]), begin, end, r.now))
			} else {
				co.Set("host", nil)
			}
		}
	}
	return out
}

func sumBools(evs []*OMap, k string) int {
	n := 0
	for _, e := range evs {
		if e.B(k) {
			n++
		}
	}
	return n
}

func (r *report) projectsSection(received []*OMap) []*OMap {
	byTeam := map[any][]*OMap{}
	for _, ev := range received {
		byTeam[ev.V("team_id")] = append(byTeam[ev.V("team_id")], ev)
	}
	var rows []*OMap
	for _, pu := range Objs(r.d, "projects_users") {
		pid := Num(Obj(pu, "project"), "id")
		proj := r.projects[pid]
		teams := Objs(pu, "teams")
		sorted := slices.Clone(teams)
		sort.SliceStable(sorted, func(i, j int) bool { return Str(sorted[i], "created_at") < Str(sorted[j], "created_at") })
		var attempts []*OMap
		for i, t := range sorted {
			full := r.teams[Num(t, "id")]
			if full == nil {
				full = t
			}
			evs := slices.Clone(byTeam[t["id"]])
			sort.SliceStable(evs, func(a, b int) bool { return evs[a].F("begin_ms") < evs[b].F("begin_ms") })
			start := tsAny(full["created_at"])
			endT := tsAny(full["closed_at"])
			if endT.IsZero() {
				endT = tsAny(full["locked_at"])
			}
			if endT.IsZero() {
				endT = tsAny(full["updated_at"])
			}
			endMs := msT(endT)
			for _, e := range evs {
				if f, ok := e.V("filled_ms").(int64); ok && f != 0 {
					if cur, ok := endMs.(int64); !ok || f > cur {
						endMs = f
					}
				}
			}
			members := []any{}
			for _, u := range Objs(full, "users") {
				if Str(u, "login") != r.login {
					members = append(members, u["login"])
				}
			}
			moulinette := []any{}
			for _, u := range Objs(full, "teams_uploads") {
				moulinette = append(moulinette, M("mark", u["final_mark"], "at", fmtT(tsAny(u["created_at"])), "comment", u["comment"]))
			}
			ids, correctors, evals := []any{}, []any{}, []any{}
			for _, e := range evs {
				ids = append(ids, e.V("id"))
				login := e.V("corrector").(*OMap).V("login")
				correctors = append(correctors, login)
				evals = append(evals, M("corrector", login, "mark", e.V("mark"), "outstanding", e.V("outstanding"),
					"negative", e.V("negative_flag"), "flag", e.V("flag"), "begin", e.V("begin")))
			}
			var days any
			if em, ok := endMs.(int64); ok {
				days = pyRound(float64(em-msOf(start))/86400000, 1)
			}
			attempts = append(attempts, M(
				"n", i+1, "team_id", t["id"], "team", full["name"], "members", members, "status", full["status"],
				"mark", full["final_mark"], "validated", full["validated?"], "start", fmtT(start), "start_ms", msT(start),
				"locked", fmtT(tsAny(full["locked_at"])), "closed", fmtT(tsAny(full["closed_at"])), "end_ms", endMs, "days", days,
				"moulinette", moulinette, "evals", ids, "outstanding", sumBools(evs, "outstanding"), "correctors", correctors,
				"evaluations", evals))
		}
		var all []*OMap
		for _, t := range teams {
			all = append(all, byTeam[t["id"]]...)
		}
		var first, validatedAt any
		if len(attempts) > 0 {
			first = attempts[0].V("start_ms")
		}
		for _, a := range attempts {
			if a.V("validated") == true {
				validatedAt = a.V("end_ms")
				break
			}
		}
		failed := 0
		for _, a := range attempts {
			if a.V("validated") == false {
				failed++
			}
		}
		marks := []any{}
		cset := map[string]bool{}
		for _, e := range all {
			marks = append(marks, e.V("mark"))
			cset[e.V("corrector").(*OMap).S("login")] = true
		}
		cs := make([]string, 0, len(cset))
		for c := range cset {
			cs = append(cs, c)
		}
		slices.Sort(cs)
		var dtv any
		if f, ok := first.(int64); ok && f != 0 {
			if v, ok := validatedAt.(int64); ok && v != 0 {
				dtv = pyRound(float64(v-f)/86400000, 1)
			}
		}
		var mark *float64
		if m, ok := pu["final_mark"].(float64); ok {
			mark = &m
		}
		validated, _ := pu["validated?"].(bool)
		rows = append(rows, M(
			"id", Obj(pu, "project")["id"], "pu_id", pu["id"], "name", Obj(pu, "project")["name"], "slug", Obj(pu, "project")["slug"],
			"track", TrackOf(pu), "group", GroupOf(pu), "xp_base", nilIfEmpty(proj, "difficulty"),
			"xp_earned", XPEarned(nilIfEmpty(proj, "difficulty"), mark, validated),
			"exam", Bool(proj, "exam"), "xp", nilIfEmpty(proj, "difficulty"), "status", pu["status"], "validated", pu["validated?"],
			"mark", pu["final_mark"], "occurrence", pu["occurrence"], "attempts", list(attempts), "retries", max(len(attempts)-1, 0),
			"failed_attempts", failed, "evals", len(all), "outstanding", sumBools(all, "outstanding"), "avg_eval_mark", avg(marks, 1),
			"correctors", list(cs), "first_ms", first, "registered", fmtT(tsAny(pu["created_at"])), "marked", fmtT(tsAny(pu["marked_at"])),
			"days_to_validate", dtv))
	}
	firstMs := func(o *OMap) float64 { return o.F("first_ms") }
	sort.SliceStable(rows, func(i, j int) bool { return firstMs(rows[i]) < firstMs(rows[j]) })
	TrackNames(rows)
	return rows
}

type personAcc struct {
	evaluatedMe, evaluatedByMe, teammate, outstandingToMe int
	projectsOnMe, hosts                                   *counted
	marksToMe, myRating, theirRating, durations           []any
	dates                                                 []int64
	info                                                  *OMap
}

func (r *report) peopleSection(received, given []*OMap) []*OMap {
	acc, order := map[string]*personAcc{}, []string{}
	get := func(login string) *personAcc {
		if acc[login] == nil {
			acc[login] = &personAcc{projectsOnMe: newCounted(), hosts: newCounted()}
			order = append(order, login)
		}
		return acc[login]
	}
	for _, e := range received {
		c := e.V("corrector").(*OMap)
		p := get(c.S("login"))
		p.info = c
		p.evaluatedMe++
		p.projectsOnMe.add(e.V("project"), 1)
		p.marksToMe = append(p.marksToMe, e.V("mark"))
		if e.B("outstanding") {
			p.outstandingToMe++
		}
		p.myRating = append(p.myRating, e.V("fb_rating"))
		p.durations = append(p.durations, e.V("duration_min"))
		if h := e.V("other_host"); h != nil && h != "" {
			p.hosts.add(h, 1)
		}
		if ms, ok := e.V("begin_ms").(int64); ok {
			p.dates = append(p.dates, ms)
		}
	}
	for _, e := range given {
		for _, c := range e.Os("correcteds") {
			p := get(c.S("login"))
			if p.info == nil {
				p.info = c
			}
			p.evaluatedByMe++
			for _, f := range e.Os("feedbacks") {
				if f.V("by") == c.S("login") {
					p.theirRating = append(p.theirRating, f.V("rating"))
				}
			}
			if ms, ok := e.V("begin_ms").(int64); ok {
				p.dates = append(p.dates, ms)
			}
		}
	}
	for _, t := range Objs(r.d, "teams") {
		for _, u := range Objs(t, "users") {
			if Str(u, "login") != r.login {
				p := get(Str(u, "login"))
				p.teammate++
				if p.info == nil {
					p.info = r.person(u)
				}
			}
		}
	}
	var rows []*OMap
	for _, login := range order {
		p := acc[login]
		var first, last any
		if ds := slices.DeleteFunc(slices.Clone(p.dates), func(x int64) bool { return x == 0 }); len(ds) > 0 {
			first, last = fmtT(fromMs(slices.Min(ds))), fmtT(fromMs(slices.Max(ds)))
		}
		info := p.info
		if info == nil {
			info = NewOMap()
		}
		rows = append(rows, M(
			"login", login, "name", info.V("name"), "staff", info.V("staff"), "image", info.V("image"),
			"evaluated_me", p.evaluatedMe, "evaluated_by_me", p.evaluatedByMe, "teammate", p.teammate,
			"projects_on_me", p.projectsOnMe.obj(asInt), "avg_mark_to_me", avg(p.marksToMe, 1), "outstanding_to_me", p.outstandingToMe,
			"my_rating_of_them", avg(p.myRating, 2), "their_rating_of_me", avg(p.theirRating, 2), "avg_duration", avg(p.durations, 1),
			"hosts", p.hosts.obj(asInt), "first", first, "last", last))
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.I("evaluated_me") != b.I("evaluated_me") {
			return a.I("evaluated_me") > b.I("evaluated_me")
		}
		if a.I("evaluated_by_me") != b.I("evaluated_by_me") {
			return a.I("evaluated_by_me") > b.I("evaluated_by_me")
		}
		return a.S("login") < b.S("login")
	})
	return rows
}

func (r *report) logtimeSection(received, given []*OMap) *OMap {
	daily, dayOrder := map[string]float64{}, []string{}
	hourly := map[hourKey]float64{}
	type seat struct {
		host        any
		seconds     float64
		sessions    int
		first, last time.Time
	}
	seats, seatOrder := map[any]*seat{}, []any{}
	clusters := newCounted()
	var intervals []span
	var log []*OMap
	for _, s := range r.mySessions {
		b, e := tsAny(s["begin_at"]), tsAny(s["end_at"])
		if e.IsZero() {
			e = r.now
		}
		h := s["host"]
		st := seats[h]
		if st == nil {
			st = &seat{host: h, first: b, last: e}
			seats[h] = st
			seatOrder = append(seatOrder, h)
		}
		st.seconds += totalSeconds(e.Sub(b))
		st.sessions++
		st.first, st.last = minT(st.first, b), maxT(st.last, e)
		host, _ := h.(string)
		clusters.add(clusterAny(host), totalSeconds(e.Sub(b)))
		intervals = append(intervals, span{b, e})
		log = append(log, M("begin", fmtT(b), "begin_ms", msOf(b), "end", fmtT(tsAny(s["end_at"])), "host", h,
			"seconds", pyRoundInt(totalSeconds(e.Sub(b)))))
	}
	var sessions []float64
	for _, iv := range MergeIntervals(intervals) {
		keys, secs := SplitByDay(iv.b, iv.e)
		for _, k := range keys {
			if _, ok := daily[k]; !ok {
				dayOrder = append(dayOrder, k)
			}
			daily[k] += secs[k]
		}
		for k, v := range SplitByHour(iv.b, iv.e) {
			hourly[k] += v
		}
		sessions = append(sessions, totalSeconds(iv.e.Sub(iv.b)))
	}
	evalDays := map[string]int{}
	for _, e := range append(slices.Clone(received), given...) {
		if b := e.S("begin"); b != "" {
			evalDays[b[:10]]++
		}
	}
	days := slices.Sorted(func(yield func(string) bool) {
		for _, d := range dayOrder {
			if !yield(d) {
				return
			}
		}
	})
	var allDays []string
	if len(days) > 0 {
		cur, _ := time.Parse("2006-01-02", days[0])
		last, _ := time.Parse("2006-01-02", days[len(days)-1])
		for ; !cur.After(last); cur = cur.AddDate(0, 0, 1) {
			allDays = append(allDays, cur.Format("2006-01-02"))
		}
	}
	var onEval, other []any
	monthly, monthOrder := map[string]float64{}, []string{}
	total := 0.0
	for _, d := range dayOrder {
		if evalDays[d] > 0 {
			onEval = append(onEval, daily[d]/3600)
		} else {
			other = append(other, daily[d]/3600)
		}
		if _, ok := monthly[d[:7]]; !ok {
			monthOrder = append(monthOrder, d[:7])
		}
		monthly[d[:7]] += daily[d]
		total += daily[d]
	}
	slices.Sort(monthOrder)
	monthlyObj := NewOMap()
	for _, m := range monthOrder {
		monthlyObj.Set(m, pyRound(monthly[m]/3600, 1))
	}
	hours, evals := []any{}, []any{}
	for _, d := range allDays {
		hours = append(hours, pyRound(daily[d]/3600, 2))
		evals = append(evals, evalDays[d])
	}
	heat := make([]any, 7)
	for w := range 7 {
		row := make([]any, 24)
		for h := range 24 {
			row[h] = pyRound(hourly[hourKey{w, h}]/3600, 1)
		}
		heat[w] = row
	}
	sort.SliceStable(seatOrder, func(i, j int) bool { return seats[seatOrder[i]].seconds > seats[seatOrder[j]].seconds })
	seatRows := []any{}
	for _, h := range seatOrder {
		s := seats[h]
		seatRows = append(seatRows, M("host", s.host, "seconds", s.seconds, "sessions", s.sessions, "first", fmtT(s.first),
			"last", fmtT(s.last), "hours", pyRound(s.seconds/3600, 1)))
	}
	sort.SliceStable(log, func(i, j int) bool { return log[i].V("begin_ms").(int64) > log[j].V("begin_ms").(int64) })
	var firstDay, lastDay any
	if len(days) > 0 {
		firstDay, lastDay = days[0], days[len(days)-1]
	}
	longest := any(0)
	if len(sessions) > 0 {
		longest = pyRound(slices.Max(sessions)/3600, 1)
	}
	return M(
		"days", list(allDays), "hours", hours, "evals", evals, "monthly", monthlyObj, "heat", heat, "seats", seatRows,
		"log", list(log), "clusters", clusters.obj(func(f float64) any { return pyRound(f/3600, 1) }),
		"total_seconds", pyRoundInt(total), "total_hours", pyRound(total/3600, 1),
		"official_hours", officialHours(Obj(r.d, "locations_stats")), "days_present", len(daily),
		"first_day", firstDay, "last_day", lastDay, "sessions", len(r.mySessions), "longest_session_h", longest,
		"avg_day_h_eval_days", avg(onEval, 1), "avg_day_h_other_days", avg(other, 1))
}

func truthy(v any) bool { return v != nil && v != "" }

func (r *report) placeSection(received, given []*OMap) *OMap {
	counter := func(values []any) *OMap {
		c := newCounted()
		for _, v := range values {
			if !truthy(v) {
				v = "not logged"
			}
			c.add(v, 1)
		}
		return c.obj(asInt)
	}
	countTruthy := func(values []any) *OMap {
		c := newCounted()
		for _, v := range values {
			if truthy(v) {
				c.add(v, 1)
			}
		}
		return c.obj(asInt)
	}
	sameHost, sameCluster := 0, 0
	var corrClusters, recvMine, givenMine, corrHosts, myHosts []any
	corrChecked, corrLocated, meRecv, meGiven := 0, 0, 0, 0
	for _, e := range received {
		oh, mh := e.V("other_host"), e.V("my_host")
		if truthy(oh) && oh == mh {
			sameHost++
		}
		if truthy(oh) && truthy(mh) && clusterAny(oh) == clusterAny(mh) {
			sameCluster++
		}
		if e.B("other_host_checked") {
			corrClusters = append(corrClusters, clusterAny(oh))
			corrChecked++
		}
		recvMine = append(recvMine, clusterAny(mh))
		corrHosts = append(corrHosts, oh)
		myHosts = append(myHosts, mh)
		if truthy(oh) {
			corrLocated++
		}
		if truthy(mh) {
			meRecv++
		}
	}
	var theirs []any
	for _, e := range given {
		givenMine = append(givenMine, clusterAny(e.V("my_host")))
		myHosts = append(myHosts, e.V("my_host"))
		if truthy(e.V("my_host")) {
			meGiven++
		}
	}
	for _, e := range given {
		if e.B("other_host_checked") {
			for _, c := range e.Os("correcteds") {
				theirs = append(theirs, c.V("host"))
			}
		}
	}
	theirClusters := make([]any, len(theirs))
	located := 0
	for i, h := range theirs {
		theirClusters[i] = clusterAny(h)
		if truthy(h) {
			located++
		}
	}
	return M(
		"received_corrector_cluster", counter(corrClusters), "given_evaluated_cluster", counter(theirClusters),
		"given_evaluated_hosts", countTruthy(theirs), "evaluated_located", located, "evaluated_checked", len(theirs),
		"corrector_checked", corrChecked, "received_my_cluster", counter(recvMine), "given_my_cluster", counter(givenMine),
		"received_corrector_hosts", countTruthy(corrHosts), "my_eval_hosts", countTruthy(myHosts),
		"same_host", sameHost, "same_cluster", sameCluster, "corrector_located", corrLocated,
		"me_located_received", meRecv, "me_located_given", meGiven)
}

func (r *report) whenSection(received, given []*OMap) *OMap {
	done := func(evs []*OMap) []*OMap {
		var out []*OMap
		for _, e := range evs {
			if e.S("status") == "done" {
				out = append(out, e)
			}
		}
		return out
	}
	all := append(slices.Clone(received), given...)
	mset := map[string]bool{}
	for _, e := range all {
		mset[e.S("begin")[:7]] = true
	}
	var months []string
	if len(mset) > 0 {
		ms := make([]string, 0, len(mset))
		for m := range mset {
			ms = append(ms, m)
		}
		slices.Sort(ms)
		months = monthRange(ms[0], ms[len(ms)-1])
	}
	monthly := func(evs []*OMap) *OMap {
		counts := map[string]map[string]int{"ok": {}, "outstanding": {}, "negative": {}}
		for _, e := range evs {
			k := "ok"
			if e.B("outstanding") {
				k = "outstanding"
			} else if e.B("negative_flag") {
				k = "negative"
			}
			counts[k][e.S("begin")[:7]]++
		}
		out := NewOMap()
		for _, k := range []string{"ok", "outstanding", "negative"} {
			row := []any{}
			for _, m := range months {
				row = append(row, counts[k][m])
			}
			out.Set(k, row)
		}
		return out
	}
	cumulative := func(evs []*OMap, pred func(*OMap) bool) []any {
		s := slices.Clone(evs)
		sort.SliceStable(s, func(i, j int) bool { return s[i].F("begin_ms") < s[j].F("begin_ms") })
		pts, n := []any{}, 0
		for _, e := range s {
			if pred(e) {
				n++
				pts = append(pts, M("x", e.V("begin_ms"), "y", n))
			}
		}
		return pts
	}
	pick := func(evs []*OMap, k string) []any {
		var out []any
		for _, e := range evs {
			out = append(out, e.V(k))
		}
		return out
	}
	medianOr0 := func(vals []any) any {
		vs := floats(vals)
		if len(vs) == 0 {
			return 0
		}
		return median(vs)
	}
	durEdges := []float64{0, 15, 30, 45, 60, 75, 90, 120, 180}
	leadEdges := []float64{0, 1, 3, 6, 12, 24, 48, 96}
	always := func(*OMap) bool { return true }
	out := func(e *OMap) bool { return e.B("outstanding") }
	return M(
		"months", list(months), "received_monthly", monthly(received), "given_monthly", monthly(given),
		"heat_received", heatmap(received), "heat_given", heatmap(given),
		"cum_received", cumulative(received, always), "cum_given", cumulative(given, always),
		"cum_out_received", cumulative(received, out), "cum_out_given", cumulative(given, out),
		"duration_edges", list(durEdges), "duration_received", histogram(pick(done(received), "duration_min"), durEdges),
		"duration_given", histogram(pick(done(given), "duration_min"), durEdges),
		"lead_edges", list(leadEdges), "lead_received", histogram(pick(received, "lead_h"), leadEdges),
		"lead_given", histogram(pick(given, "lead_h"), leadEdges),
		"median_duration_received", medianOr0(pick(done(received), "duration_min")),
		"median_duration_given", medianOr0(pick(done(given), "duration_min")),
		"median_lead_received", medianOr0(pick(received, "lead_h")))
}

func (r *report) correctionPointsSection() *OMap {
	rows := Objs(r.d, "correction_points")
	sort.SliceStable(rows, func(i, j int) bool { return Str(rows[i], "created_at") < Str(rows[j], "created_at") })
	type reason struct{ count, sum float64 }
	reasons, order := map[any]*reason{}, []any{}
	series := []any{}
	earned, spent, mx := 0.0, 0.0, 0.0
	for i, c := range rows {
		k := c["reason"]
		if reasons[k] == nil {
			reasons[k] = &reason{}
			order = append(order, k)
		}
		reasons[k].count++
		reasons[k].sum += Num(c, "sum")
		series = append(series, M("x", msT(tsAny(c["created_at"])), "y", c["total"]))
		if s := Num(c, "sum"); s > 0 {
			earned += s
		} else if s < 0 {
			spent -= s
		}
		if t := Num(c, "total"); i == 0 || t > mx {
			mx = t
		}
	}
	sort.SliceStable(order, func(i, j int) bool { return reasons[order[i]].count > reasons[order[j]].count })
	ro := NewOMap()
	for _, k := range order {
		ro.Set(keyStr(k), M("count", int(reasons[k].count), "sum", reasons[k].sum))
	}
	return M("series", series, "reasons", ro, "earned", earned, "spent", spent, "max", mx)
}

func (r *report) extrasSection() *OMap {
	u := r.user
	ach := map[float64]Raw{}
	for _, a := range append(Objs(u, "achievements"), Objs(r.d, "achievements")...) {
		ach[Num(a, "id")] = a
	}
	var achievements []*OMap
	for _, a := range Objs(r.d, "achievements_users") {
		id := Num(a, "achievement_id")
		info := ach[id]
		name := any("#" + json_int(id).(string))
		if v, ok := info["name"]; ok {
			name = v
		}
		at := tsAny(a["created_at"])
		achievements = append(achievements, M("name", name, "description", nilIfEmpty(info, "description"), "tier", nilIfEmpty(info, "tier"),
			"kind", nilIfEmpty(info, "kind"), "at", fmtT(at), "at_ms", msT(at)))
	}
	sort.SliceStable(achievements, func(i, j int) bool { return achievements[i].F("at_ms") < achievements[j].F("at_ms") })
	titleNames := map[float64]any{}
	for _, t := range Objs(u, "titles") {
		titleNames[Num(t, "id")] = t["name"]
	}
	titles := []any{}
	for _, t := range Objs(r.d, "titles_users") {
		name, ok := titleNames[Num(t, "title_id")].(string)
		if !ok {
			name = "?"
		}
		titles = append(titles, M("name", strings.ReplaceAll(name, "%login", r.login), "selected", t["selected"], "at", fmtT(tsAny(t["created_at"]))))
	}
	var events []*OMap
	for _, eu := range Objs(r.d, "events_users") {
		ev := Obj(eu, "event")
		if len(ev) == 0 {
			continue
		}
		b := tsAny(ev["begin_at"])
		var hours any
		if Str(ev, "end_at") != "" {
			hours = pyRound(totalSeconds(tsAny(ev["end_at"]).Sub(b))/3600, 1)
		}
		events = append(events, M("name", ev["name"], "kind", ev["kind"], "location", ev["location"], "begin", fmtT(b), "begin_ms", msT(b), "hours", hours))
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].F("begin_ms") < events[j].F("begin_ms") })
	kinds := newCounted()
	for _, e := range events {
		kinds.add(e.V("kind"), 1)
	}
	// the API can list the same quest twice; keep one per quest (the last row, at the first one's place)
	qOrder, qRows := []any{}, map[any]Raw{}
	for _, q := range Objs(r.d, "quests_users") {
		if len(Obj(q, "quest")) == 0 {
			continue
		}
		k := q["quest_id"]
		if k == nil || k == 0.0 {
			k = Obj(q, "quest")["name"]
		}
		if _, ok := qRows[k]; !ok {
			qOrder = append(qOrder, k)
		}
		qRows[k] = q
	}
	var quests []*OMap
	for _, k := range qOrder {
		q := qRows[k]
		quests = append(quests, M("name", Obj(q, "quest")["name"], "description", Obj(q, "quest")["description"],
			"validated", fmtT(tsAny(q["validated_at"])), "created", fmtT(tsAny(q["created_at"]))))
	}
	sort.SliceStable(quests, func(i, j int) bool { return quests[i].S("created") < quests[j].S("created") })
	expertises := []any{}
	for _, x := range Objs(r.d, "expertises_users") {
		if len(Obj(x, "expertise")) > 0 {
			expertises = append(expertises, M("name", Obj(x, "expertise")["name"], "value", x["value"], "interested", x["interested"]))
		}
	}
	cus := Objs(u, "cursus_users")
	var best Raw
	for i, c := range cus {
		if i == 0 || Num(c, "level") > Num(best, "level") {
			best = c
		}
	}
	skills, cursus := []any{}, []any{}
	for _, s := range Objs(best, "skills") {
		skills = append(skills, M("name", s["name"], "level", s["level"]))
	}
	for _, c := range cus {
		cursus = append(cursus, M("name", Obj(c, "cursus")["name"], "level", c["level"], "grade", c["grade"],
			"begin", fmtT(tsAny(c["begin_at"])), "blackholed", fmtT(tsAny(c["blackholed_at"]))))
	}
	return M("achievements", list(achievements), "titles", titles, "events", list(events), "event_kinds", kinds.obj(asInt),
		"quests", list(quests), "expertises", expertises, "skills", skills, "cursus", cursus)
}

func (r *report) profile() *OMap {
	u := r.user
	var coalition any
	coals, cus := Objs(r.d, "coalitions"), Objs(r.d, "coalitions_users")
	if len(coals) > 0 && len(cus) > 0 {
		coal, cu := coals[0], cus[0]
		coalition = M("name", coal["name"], "color", coal["color"], "score", cu["score"], "rank", cu["rank"],
			"master", coal["user_id"] != nil && coal["user_id"] == u["id"])
	}
	campus := []any{}
	for _, c := range Objs(u, "campus") {
		campus = append(campus, c["name"])
	}
	groups := []any{}
	for _, g := range Objs(r.d, "groups") {
		if truthy(g["name"]) {
			groups = append(groups, g["name"])
		}
	}
	return M("login", u["login"], "name", u["displayname"], "email", u["email"],
		"image", nilIfEmpty(Obj(Obj(u, "image"), "versions"), "medium"), "campus", campus, "location", u["location"],
		"wallet", u["wallet"], "correction_point", u["correction_point"], "groups", groups, "coalition", coalition)
}

func (r *report) summary(received, given, projects, people []*OMap, logtime *OMap) *OMap {
	countIf := func(xs []*OMap, f func(*OMap) bool) int {
		n := 0
		for _, x := range xs {
			if f(x) {
				n++
			}
		}
		return n
	}
	marksDone := func(evs []*OMap) []any {
		var out []any
		for _, e := range evs {
			if e.S("status") == "done" {
				out = append(out, e.V("mark"))
			}
		}
		return out
	}
	var mine, theirs []*OMap
	for _, e := range received {
		for _, f := range e.Os("feedbacks") {
			if f.V("by") == r.login {
				mine = append(mine, f)
			}
		}
	}
	for _, e := range given {
		theirs = append(theirs, e.Os("feedbacks")...)
	}
	attempts, retries := 0, 0
	for _, p := range projects {
		attempts += len(p.L("attempts"))
		retries += p.I("retries")
	}
	both := append(slices.Clone(received), given...)
	return M(
		"projects", len(projects), "validated", countIf(projects, func(p *OMap) bool { return p.V("validated") == true }),
		"attempts", attempts, "retries", retries, "projects_with_retries", countIf(projects, func(p *OMap) bool { return p.I("retries") > 0 }),
		"received", len(received), "received_outstanding", sumBools(received, "outstanding"),
		"received_negative", sumBools(received, "negative_flag"), "received_avg_mark", avg(marksDone(received), 1),
		"given", len(given), "given_outstanding", sumBools(given, "outstanding"), "given_negative", sumBools(given, "negative_flag"),
		"given_avg_mark", avg(marksDone(given), 1),
		"unique_correctors", countIf(people, func(p *OMap) bool { return p.I("evaluated_me") > 0 }),
		"unique_evaluated", countIf(people, func(p *OMap) bool { return p.I("evaluated_by_me") > 0 }),
		"mutual", countIf(people, func(p *OMap) bool { return p.I("evaluated_me") > 0 && p.I("evaluated_by_me") > 0 }),
		"truant_me", countIf(both, func(e *OMap) bool { return e.V("truant") == r.login }),
		"truant_others", countIf(both, func(e *OMap) bool { return truthy(e.V("truant")) && e.V("truant") != r.login }),
		"my_rating_of_correctors", feedbackScores(mine), "ratings_i_received", feedbackScores(theirs),
		"logtime_hours", logtime.V("total_hours"))
}

func (r *report) build() *OMap {
	evals := func(k, role string) []*OMap {
		var out []*OMap
		for _, e := range Objs(r.d, k) {
			if truthy(e["begin_at"]) {
				out = append(out, r.evaluation(e, role))
			}
		}
		sort.SliceStable(out, func(i, j int) bool { return out[i].F("begin_ms") < out[j].F("begin_ms") })
		return out
	}
	received, given := evals("evals_received", "received"), evals("evals_given", "given")
	projects := r.projectsSection(received)
	people := r.peopleSection(received, given)
	logtime := r.logtimeSection(received, given)
	return M(
		"generated", fmtT(r.now), "profile", r.profile(), "summary", r.summary(received, given, projects, people, logtime),
		"projects", list(projects), "received", list(received), "given", list(given), "people", list(people),
		"when", r.whenSection(received, given), "place", r.placeSection(received, given), "logtime", logtime,
		"correction_points", r.correctionPointsSection(), "extras", r.extrasSection())
}

// Analyze builds one period's report (period ∈ piscine|student|all) from the extraction's data.
func Analyze(d Raw, period string, now time.Time) *OMap {
	data := ForPeriod(d, period)
	out := newReport(data, now).build()
	out.Set("period", M("key", period, "label", periodLabels[period]))
	AddInsights(out, data, now)
	out.Obj("extras").Set("skills_by_cursus", SkillSets(Objs(Obj(d, "user"), "cursus_users"))) // skills are not split by period
	if d["coalition_scores"] != nil {
		out.Set("coalition_points", CoalitionPoints(Objs(data, "coalition_scores")))
		out.Set("logtime_bonus", BonusWindow(Objs(d, "locations"), Objs(d, "coalition_scores"), now)) // about now: never split
	}
	return out
}
