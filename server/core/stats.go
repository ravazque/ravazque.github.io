package core

import "sort"

// Correction statistics from a period's report: failure rates, Outstanding reciprocity, breakdowns by the other
// person's rank group and by hour of day.

func failed(e *OMap) bool {
	if e.B("negative_flag") {
		return true
	}
	m, ok := toFloat(e.V("mark"))
	return ok && m < 50
}

func failRate(evs []*OMap) *OMap {
	n, total := 0, 0
	for _, e := range evs {
		if e.V("mark") != nil || e.B("negative_flag") {
			total++
			if failed(e) {
				n++
			}
		}
	}
	var pct any
	if total > 0 {
		pct = pyRound(100*float64(n)/float64(total), 1)
	}
	return M("n", n, "total", total, "pct", pct)
}

func CorrectionStats(r *OMap, groups map[string]string) *OMap {
	me := r.Obj("profile").S("login")
	received, given := r.Os("received"), r.Os("given")
	gaveMe, iGave := map[string]bool{}, map[string]bool{}
	for _, e := range received {
		if e.B("outstanding") {
			gaveMe[e.Obj("corrector").S("login")] = true
		}
	}
	for _, e := range given {
		if e.B("outstanding") {
			for _, c := range e.Os("correcteds") {
				if c.S("login") != me {
					iGave[c.S("login")] = true
				}
			}
		}
	}
	both := func(a, b map[string]bool) int {
		n := 0
		for k := range a {
			if b[k] {
				n++
			}
		}
		return n
	}
	byGroup := NewOMap()
	if groups != nil {
		bump := func(login, k string, out bool) {
			g := groups[login]
			if g == "" {
				g = "no-cursus"
			}
			row := byGroup.Obj(g)
			if _, ok := byGroup.Get(g); !ok {
				row = M("received", 0, "received_out", 0, "given", 0, "given_out", 0)
				byGroup.Set(g, row)
			}
			row.Set(k, row.I(k)+1)
			if out {
				row.Set(k+"_out", row.I(k+"_out")+1)
			}
		}
		for _, e := range received {
			bump(e.Obj("corrector").S("login"), "received", e.B("outstanding"))
		}
		for _, e := range given {
			for _, c := range e.Os("correcteds") {
				if c.S("login") != me {
					bump(c.S("login"), "given", e.B("outstanding"))
				}
			}
		}
	}
	type hour struct {
		r, g   int
		rm, gm []any
	}
	hours := make([]hour, 24)
	for _, e := range received {
		if h, ok := toFloat(e.V("hour")); ok {
			hours[int(h)].r++
			hours[int(h)].rm = append(hours[int(h)].rm, e.V("mark"))
		}
	}
	for _, e := range given {
		if h, ok := toFloat(e.V("hour")); ok {
			hours[int(h)].g++
			hours[int(h)].gm = append(hours[int(h)].gm, e.V("mark"))
		}
	}
	byHour := []any{}
	for h, x := range hours {
		byHour = append(byHour, M("hour", h, "received", x.r, "given", x.g, "avg_received", sumAvg(x.rm, 1), "avg_given", sumAvg(x.gm, 1)))
	}
	return M("failed_given", failRate(given), "failed_received", failRate(received),
		"outstanding_reciprocity", M("gave_me", len(gaveMe), "i_gave_back", both(gaveMe, iGave), "i_gave", len(iGave), "they_gave_back", both(iGave, gaveMe)),
		"by_group", byGroup, "by_hour", byHour)
}

// Connections: one entry per person met in an evaluation, busiest first; the user is left out.
func Connections(r *OMap, groups map[string]string) []any {
	me := r.Obj("profile").S("login")
	names := map[string]any{}
	for _, p := range r.Os("people") {
		names[p.S("login")] = p.V("name")
	}
	type acc struct {
		received, given int
		last            string
	}
	people, order := map[string]*acc{}, []string{}
	met := func(login, k, begin string) {
		a := people[login]
		if a == nil {
			a = &acc{}
			people[login] = a
			order = append(order, login)
		}
		if k == "received" {
			a.received++
		} else {
			a.given++
		}
		if len(begin) > 10 {
			begin = begin[:10]
		}
		a.last = max(a.last, begin)
	}
	for _, e := range received(r) {
		met(e.Obj("corrector").S("login"), "received", e.S("begin"))
	}
	for _, e := range r.Os("given") {
		for _, c := range e.Os("correcteds") {
			met(c.S("login"), "given", e.S("begin"))
		}
	}
	var nodes []*OMap
	for _, login := range order {
		if login == me {
			continue
		}
		a := people[login]
		g := groups[login]
		if g == "" {
			g = "no-cursus"
		}
		var last any
		if a.last != "" {
			last = a.last
		}
		nodes = append(nodes, M("login", login, "name", names[login], "group", g, "received", a.received, "given", a.given, "last", last))
	}
	sort.SliceStable(nodes, func(i, j int) bool {
		a, b := nodes[i].I("received")+nodes[i].I("given"), nodes[j].I("received")+nodes[j].I("given")
		if a != b {
			return a > b
		}
		return nodes[i].S("login") < nodes[j].S("login")
	})
	return list(nodes)
}

func received(r *OMap) []*OMap { return r.Os("received") }
