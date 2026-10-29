package api42

import (
	"context"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"ravazque.info/server/core"
)

// The light extraction: everything the report shows without one request per evaluation. The other side's seat is
// looked up per day for the last SeatDays days only; feedback comes in batches; plus the rank group of everyone met.

var userLists = []struct{ name, endpoint string }{
	{"projects_users", "projects_users"}, {"teams", "teams"}, {"evals_received", "scale_teams/as_corrected"},
	{"evals_given", "scale_teams/as_corrector"}, {"locations", "locations"}, {"correction_points", "correction_point_historics"},
	{"events_users", "events_users"}, {"coalitions_users", "coalitions_users"}, {"quests_users", "quests_users"},
	{"titles_users", "titles_users"}, {"expertises_users", "expertises_users"},
}

var (
	projectFields = []string{"id", "name", "slug", "difficulty", "exam", "parent"}
	scoreFields   = []string{"value", "scoreable_type", "scoreable_id", "calculation_id", "created_at"}
)

const (
	batch       = 100
	SeatDays    = 60 // the other side's seat is looked up for evaluations of the last 60 days (one request per day)
	networkSize = 30 // closest contacts whose given evaluations are read for the network (one request each)
)

type raw = core.Raw

func objs(v []any) []raw {
	var out []raw
	for _, x := range v {
		if o, ok := x.(raw); ok {
			out = append(out, o)
		}
	}
	return out
}

func vals(kv ...string) url.Values {
	v := url.Values{}
	for i := 0; i+1 < len(kv); i += 2 {
		v.Set(kv[i], kv[i+1])
	}
	return v
}

func joinIDs(ids []int) string {
	s := make([]string, len(ids))
	for i, id := range ids {
		s[i] = strconv.Itoa(id)
	}
	return strings.Join(s, ",")
}

func (c *Client) batched(ctx context.Context, path, key string, ids []int, params url.Values) ([]any, error) {
	ids = slices.Clone(ids)
	slices.Sort(ids)
	out := []any{}
	for i := 0; i < len(ids); i += batch {
		p := url.Values{}
		for k, v := range params {
			p[k] = v
		}
		p.Set(key, joinIDs(ids[i:min(i+batch, len(ids))]))
		got, err := c.GetAll(ctx, path, p)
		if err != nil {
			return nil, err
		}
		out = append(out, got...)
	}
	return out, nil
}

// group runs functions together and keeps the first error, like asyncio.gather.
type group struct {
	wg  sync.WaitGroup
	mu  sync.Mutex
	err error
}

func (g *group) Go(f func() error) {
	g.wg.Add(1)
	go func() {
		defer g.wg.Done()
		if err := f(); err != nil {
			g.mu.Lock()
			if g.err == nil {
				g.err = err
			}
			g.mu.Unlock()
		}
	}()
}

func (g *group) Wait() error { g.wg.Wait(); return g.err }

func pickFields(o raw, fields []string) raw {
	out := raw{}
	for _, f := range fields {
		out[f] = o[f]
	}
	return out
}

// Extract reads one student's data and returns the stored report: the three periods' reports, the seat layout, the
// connections, the network, the promo, the campus coalitions and the evaluations still ahead.
func Extract(ctx context.Context, c *Client, uid int, progress func(float64), clock func() time.Time) (*core.OMap, error) {
	const steps = 11 + 11 // the lists, then intra hours + groups, achievements, coalitions, people, projects, ranks, feedback, standing, analysis, network
	var pmu sync.Mutex
	done := 0
	step := func() {
		pmu.Lock()
		done++
		progress(float64(done) / steps)
		pmu.Unlock()
	}
	now := clock()
	user, err := c.Get(ctx, "/v2/users/"+strconv.Itoa(uid), nil)
	if err != nil {
		return nil, err
	}
	d := raw{"user": user}
	u, _ := user.(raw)
	if ok, reason := core.Access(u, now); !ok { // checked again at every extraction: blackholed or frozen since signing in
		return nil, core.AccessRefused{Reason: reason}
	}
	step()
	var dmu sync.Mutex
	set := func(k string, v any) { dmu.Lock(); d[k] = v; dmu.Unlock() }
	var coalitions []any
	g := &group{}
	for _, l := range userLists {
		g.Go(func() error {
			v, err := c.GetAll(ctx, "/v2/users/"+strconv.Itoa(uid)+"/"+l.endpoint, nil)
			if err == nil {
				set(l.name, v)
				step()
			}
			return err
		})
	}
	g.Go(func() error { // the intra's own daily logtime since the account began, and the profile's groups (names only)
		begin := core.Str(u, "created_at")
		if len(begin) >= 10 {
			begin = begin[:10]
		} else {
			begin = "2013-01-01"
		}
		stats, err := c.Get(ctx, "/v2/users/"+strconv.Itoa(uid)+"/locations_stats", vals("begin_at", begin))
		if err != nil {
			return err
		}
		groups, err := c.GetAll(ctx, "/v2/users/"+strconv.Itoa(uid)+"/groups", nil)
		if err != nil {
			return err
		}
		names := []any{}
		for _, gr := range objs(groups) {
			names = append(names, raw{"name": gr["name"]})
		}
		set("locations_stats", stats)
		set("groups", names)
		step()
		return nil
	})
	g.Go(func() error {
		v, err := c.GetAll(ctx, "/v2/achievements_users", vals("filter[user_id]", strconv.Itoa(uid)))
		set("achievements_users", v)
		return err
	})
	g.Go(func() error {
		v, err := c.Get(ctx, "/v2/users/"+strconv.Itoa(uid)+"/coalitions", nil)
		coalitions, _ = v.([]any)
		return err
	})
	if err := g.Wait(); err != nil {
		return nil, err
	}
	known := map[float64]bool{}
	for _, a := range core.Objs(u, "achievements") {
		known[core.Num(a, "id")] = true
	}
	missingSet := map[int]bool{}
	for _, a := range core.Objs(d, "achievements_users") {
		if id := core.Num(a, "achievement_id"); !known[id] {
			missingSet[int(id)] = true
		}
	}
	missing := make([]int, 0, len(missingSet))
	for id := range missingSet {
		missing = append(missing, id)
	}
	d["achievements"] = []any{}
	if len(missing) > 0 {
		if d["achievements"], err = c.batched(ctx, "/v2/achievements", "filter[id]", missing, nil); err != nil {
			return nil, err
		}
	}
	step()
	rank := map[string]int{}
	for i, s := range core.MainCoalitions {
		rank[s] = i
	}
	rankOf := func(c raw) int {
		if r, ok := rank[core.Str(c, "slug")]; ok {
			return r
		}
		return len(rank)
	}
	cs := objs(coalitions)
	sort.SliceStable(cs, func(i, j int) bool { return rankOf(cs[i]) < rankOf(cs[j]) })
	order := map[any]int{}
	for i, co := range cs {
		order[co["id"]] = i
	}
	orderOf := func(cu raw) int {
		if o, ok := order[cu["coalition_id"]]; ok {
			return o
		}
		return len(order)
	}
	cus := core.Objs(d, "coalitions_users")
	sort.SliceStable(cus, func(i, j int) bool { return orderOf(cus[i]) < orderOf(cus[j]) })
	d["coalitions"], d["coalitions_users"] = toAny(cs), toAny(cus)

	upcomingRecv, upcomingGiven := core.Objs(d, "evals_received"), core.Objs(d, "evals_given") // before the hidden ones go
	core.DropHiddenEvaluations(d)
	met := core.PeopleIDs(d, uid)

	// the second round reads d while it runs: results wait in these until every request is back
	var groups map[string]string
	var standing *core.OMap
	var scores, people, projects []any
	var corrSessions, evalSessions, fbs raw
	g = &group{}
	g.Go(func() error { // the points given to the main coalition feed the logtime bonus and the points by source
		scores = []any{}
		if len(cus) > 0 {
			v, err := c.GetAll(ctx, "/v2/coalitions_users/"+idStr(cus[0]["id"])+"/scores", nil)
			if err != nil {
				return err
			}
			for _, s := range objs(v) {
				scores = append(scores, pickFields(s, scoreFields))
			}
		}
		step()
		return nil
	})
	g.Go(func() error { // other people: only id, login, name and whether they are staff are kept
		v, err := c.batched(ctx, "/v2/users", "filter[id]", met, nil)
		if err != nil {
			return err
		}
		people = []any{}
		for _, p := range objs(v) {
			people = append(people, raw{"id": p["id"], "login": p["login"], "displayname": p["displayname"], "staff?": p["staff?"], "kind": p["kind"]})
		}
		step()
		return nil
	})
	g.Go(func() error {
		v, err := c.batched(ctx, "/v2/projects", "filter[id]", core.ProjectIDs(d), nil)
		if err != nil {
			return err
		}
		projects = []any{}
		for _, p := range objs(v) {
			pp := pickFields(p, projectFields)
			var cursus []any // only the names: they tell a Discovery piscine from the 42cursus
			for _, c := range core.Objs(p, "cursus") {
				cursus = append(cursus, core.Str(c, "name"))
			}
			pp["cursus"] = cursus
			projects = append(projects, pp)
		}
		step()
		return nil
	})
	g.Go(func() error {
		var cursusRows, questRows []any
		var e1, e2 error
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			cursusRows, e1 = c.batched(ctx, "/v2/cursus/"+strconv.Itoa(core.MainCursus)+"/cursus_users", "filter[user_id]", met, nil)
		}()
		go func() {
			defer wg.Done()
			questRows, e2 = c.batched(ctx, "/v2/quests_users", "filter[user_id]", met, vals("filter[quest_id]", joinIDs(core.CommonCoreQuests)))
		}()
		wg.Wait()
		if e1 != nil {
			return e1
		}
		if e2 != nil {
			return e2
		}
		step()
		groups = core.RankGroups(objs(cursusRows), objs(questRows), now)
		return nil
	})
	g.Go(func() error {
		var corr, eval raw
		var fb raw
		var e1, e2 error
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); corr, eval, e1 = otherSessions(ctx, c, d, now) }()
		go func() { defer wg.Done(); fb, e2 = feedbacks(ctx, c, d) }()
		wg.Wait()
		if e1 != nil {
			return e1
		}
		if e2 != nil {
			return e2
		}
		corrSessions, evalSessions, fbs = corr, eval, fb
		step()
		return nil
	})
	g.Go(func() error {
		var err error
		standing, err = standingOf(ctx, c, d)
		if err == nil {
			step()
		}
		return err
	})
	if err := g.Wait(); err != nil {
		return nil, err
	}
	d["coalition_scores"], d["people"], d["projects"] = scores, people, projects
	d["corrector_sessions"], d["evaluated_sessions"], d["feedbacks"] = corrSessions, evalSessions, fbs

	periods := core.NewOMap()
	for _, p := range core.Periods {
		r := core.Analyze(d, p, now)
		r.Obj("profile").Set("image", "/avatar/me")
		r.Set("stats", core.CorrectionStats(r, groups))
		periods.Set(p, r)
	}
	step()
	links := core.NewOMap()
	for _, p := range core.Periods {
		links.Set(p, core.Connections(periods.Obj(p), groups))
	}
	network, err := networkOf(ctx, c, d, links.L("all"), kickoff(d))
	if err != nil {
		return nil, err
	}
	step()
	var hosts []string
	for _, l := range core.Objs(d, "locations") {
		hosts = append(hosts, core.Str(l, "host"))
	}
	out := core.M("page", "web", "light", true, "seat_days", SeatDays, "default_period", "student", "periods", periods,
		"layout", core.SeatLayout(hosts), "connections", links, "network", network)
	for _, k := range standing.Keys() {
		out.Set(k, standing.V(k))
	}
	out.Set("upcoming", core.Upcoming(upcomingRecv, upcomingGiven, core.Objs(d, "projects"), now))
	return out, nil
}

func toAny[T any](xs []T) []any {
	out := make([]any, len(xs))
	for i, x := range xs {
		out[i] = x
	}
	return out
}

func idStr(v any) string {
	f, _ := v.(float64)
	return strconv.FormatInt(int64(f), 10)
}

// otherSessions: the other side's login sessions around each evaluation of the last SeatDays days, to tell their
// seat (the corrector of a received one, the evaluated students of a given one). One request per day with
// evaluations; only begin, end and host are kept, and the analysis keeps nothing but the seat.
func otherSessions(ctx context.Context, c *Client, d raw, now time.Time) (raw, raw, error) {
	since := now.AddDate(0, 0, -SeatDays)
	type want struct {
		role   string
		e      raw
		people []raw
	}
	var wanted []want
	var dayOrder []string
	days := map[string]map[int]bool{}
	for _, rk := range []struct{ role, key string }{{"received", "evals_received"}, {"given", "evals_given"}} {
		for _, e := range core.Objs(d, rk.key) {
			begin := core.TS(core.Str(e, "begin_at"))
			if begin.Before(since) || begin.After(now) {
				continue
			}
			var people []raw
			if rk.role == "received" {
				if p, ok := e["corrector"].(raw); ok && core.Num(p, "id") != 0 {
					people = []raw{p}
				}
			} else {
				for _, p := range core.Objs(e, "correcteds") {
					if core.Num(p, "id") != 0 {
						people = append(people, p)
					}
				}
			}
			wanted = append(wanted, want{rk.role, e, people})
			day := begin.Format("2006-01-02")
			if days[day] == nil {
				days[day] = map[int]bool{}
				dayOrder = append(dayOrder, day)
			}
			for _, p := range people {
				days[day][int(core.Num(p, "id"))] = true
			}
		}
	}
	found := make([][]any, len(dayOrder))
	g := &group{}
	for i, day := range dayOrder {
		g.Go(func() error {
			// sessions that began from the day before (one can run overnight into the evaluation) to the day's end
			start, _ := time.Parse("2006-01-02", day)
			window := start.AddDate(0, 0, -1).Format("2006-01-02T15:04:05Z") + "," + start.AddDate(0, 0, 1).Format("2006-01-02T15:04:05Z")
			ids := make([]int, 0, len(days[day]))
			for id := range days[day] {
				ids = append(ids, id)
			}
			rows, err := c.batched(ctx, "/v2/locations", "filter[user_id]", ids, vals("range[begin_at]", window))
			found[i] = rows
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return nil, nil, err
	}
	type session struct {
		order int
		v     raw
	}
	byPerson := map[float64]map[string]session{}
	for _, rows := range found {
		for _, l := range objs(rows) {
			pid := core.Num(core.Obj(l, "user"), "id")
			if byPerson[pid] == nil {
				byPerson[pid] = map[string]session{}
			}
			key := idStr(l["id"])
			s, seen := byPerson[pid][key]
			if !seen {
				s.order = len(byPerson[pid])
			}
			s.v = raw{"host": l["host"], "begin_at": l["begin_at"], "end_at": l["end_at"]}
			byPerson[pid][key] = s
		}
	}
	sessions := func(p raw) []any {
		m := byPerson[core.Num(p, "id")]
		list := make([]session, 0, len(m))
		for _, s := range m {
			list = append(list, s)
		}
		sort.Slice(list, func(i, j int) bool { return list[i].order < list[j].order })
		out := []any{}
		for _, s := range list {
			out = append(out, s.v)
		}
		return out
	}
	corrector, evaluated := raw{}, raw{}
	for _, w := range wanted {
		if w.role == "received" {
			if len(w.people) > 0 {
				corrector[idStr(w.e["id"])] = sessions(w.people[0])
			} else {
				corrector[idStr(w.e["id"])] = []any{}
			}
		} else {
			m := raw{}
			for _, p := range w.people {
				m[core.Str(p, "login")] = sessions(p)
			}
			evaluated[idStr(w.e["id"])] = m
		}
	}
	return corrector, evaluated, nil
}

// feedbacks: written feedback with its per-criterion details, 100 evaluations per request; authors as logins only.
func feedbacks(ctx context.Context, c *Client, d raw) (raw, error) {
	var ids []int
	for _, k := range []string{"evals_received", "evals_given"} {
		for _, e := range core.Objs(d, k) {
			ids = append(ids, int(core.Num(e, "id")))
		}
	}
	rows, err := c.batched(ctx, "/v2/feedbacks", "filter[feedbackable_id]", ids, nil)
	if err != nil {
		return nil, err
	}
	out := raw{}
	for _, f := range objs(rows) {
		if t := core.Str(f, "feedbackable_type"); t != "" && t != "ScaleTeam" {
			continue
		}
		k := idStr(f["feedbackable_id"])
		entry := raw{"comment": f["comment"], "rating": f["rating"], "created_at": f["created_at"], "feedback_details": f["feedback_details"],
			"user": raw{"login": core.Obj(f, "user")["login"]}}
		l, _ := out[k].([]any)
		out[k] = append(l, entry)
	}
	return out, nil
}

// standingOf: the promo (who started the 42cursus in Madrid the same week, counts only) and the Madrid coalitions.
func standingOf(ctx context.Context, c *Client, d raw) (*core.OMap, error) {
	var main raw
	for _, cu := range core.Objs(core.Obj(d, "user"), "cursus_users") {
		if core.Num(cu, "cursus_id") == core.MainCursus {
			main = cu
			break
		}
	}
	var promo any
	if main != nil && core.Str(main, "begin_at") != "" {
		start := core.TS(core.Str(main, "begin_at"))
		f := "2006-01-02T15:04:05.000Z"
		rows, err := c.GetAll(ctx, "/v2/cursus/"+strconv.Itoa(core.MainCursus)+"/cursus_users", vals("filter[campus_id]", strconv.Itoa(core.MadridCampus),
			"range[begin_at]", start.AddDate(0, 0, -3).Format(f)+","+start.AddDate(0, 0, 3).Format(f)))
		if err != nil {
			return nil, err
		}
		var levels []float64
		for _, r := range objs(rows) {
			if lv, ok := r["level"].(float64); ok {
				levels = append(levels, lv)
			}
		}
		promo = core.PromoStanding(levels, core.Num(main, "level"))
	}
	blocs, err := c.Get(ctx, "/v2/blocs", vals("filter[campus_id]", strconv.Itoa(core.MadridCampus), "filter[cursus_id]", strconv.Itoa(core.MainCursus)))
	if err != nil {
		return nil, err
	}
	var mine any
	if cs := core.Objs(d, "coalitions"); len(cs) > 0 {
		mine = cs[0]["id"]
	}
	var bloc raw
	if bs, _ := blocs.([]any); len(bs) > 0 {
		bloc, _ = bs[0].(raw)
	}
	return core.M("promo", promo, "coalitions", core.CoalitionStandings(bloc, mine)), nil
}

// kickoff is the 42cursus start, where the student period begins.
func kickoff(d raw) string {
	for _, cu := range core.Objs(core.Obj(d, "user"), "cursus_users") {
		if core.Num(cu, "cursus_id") == core.MainCursus {
			return core.Str(cu, "begin_at")
		}
	}
	return ""
}

// networkOf: who evaluated whom among the closest contacts, per period; one request per contact, skipped when the
// hourly budget is low.
func networkOf(ctx context.Context, c *Client, d raw, contacts []any, start string) (*core.OMap, error) {
	var top []*core.OMap
	for _, x := range contacts {
		top = append(top, x.(*core.OMap))
	}
	sort.SliceStable(top, func(i, j int) bool {
		return top[i].I("received")+top[i].I("given") > top[j].I("received")+top[j].I("given")
	})
	if len(top) > networkSize {
		top = top[:networkSize]
	}
	ids := map[string]float64{}
	for _, p := range core.Objs(d, "people") {
		ids[core.Str(p, "login")] = core.Num(p, "id")
	}
	givenBy := map[string][]raw{}
	if c.lim == nil || c.lim.BudgetOK() {
		var mu sync.Mutex
		g := &group{}
		for _, ct := range top {
			id, ok := ids[ct.S("login")]
			if !ok {
				continue
			}
			g.Go(func() error {
				v, err := c.Get(ctx, "/v2/users/"+idStr(id)+"/scale_teams/as_corrector", vals("page[size]", "100", "sort", "-begin_at"))
				if err != nil {
					return err
				}
				var evs []raw
				for _, e := range objs(asList(v)) {
					var cs any = []any{}
					if l, ok := e["correcteds"].([]any); ok {
						logins := []any{}
						for _, u := range objs(l) {
							logins = append(logins, raw{"login": u["login"]})
						}
						cs = logins
					}
					evs = append(evs, raw{"begin_at": e["begin_at"], "correcteds": cs})
				}
				mu.Lock()
				givenBy[ct.S("login")] = evs
				mu.Unlock()
				return nil
			})
		}
		if err := g.Wait(); err != nil {
			return nil, err
		}
	}
	nodes := make([]*core.OMap, len(top))
	for i, ct := range top {
		nodes[i] = core.M("login", ct.V("login"), "group", ct.V("group"))
	}
	me := core.Str(core.Obj(d, "user"), "login")
	st := core.TS(start)
	split := []struct {
		p    string
		keep func(string) bool
	}{ // no kickoff: every period is everything
		{"all", func(string) bool { return true }},
		{"student", func(at string) bool { return start == "" || (at != "" && !core.TS(at).Before(st)) }},
		{"piscine", func(at string) bool { return start == "" || (at != "" && core.TS(at).Before(st)) }},
	}
	out := core.NewOMap()
	for _, s := range split {
		out.Set(s.p, core.ContactNetwork(me, nodes, givenBy, s.keep))
	}
	return out, nil
}

func asList(v any) []any {
	l, _ := v.([]any)
	return l
}
