package core

import (
	"maps"
	"slices"
	"testing"
	"time"
)

func pu(slug string, cursus ...float64) Raw {
	ids := make([]any, len(cursus))
	for i, c := range cursus {
		ids[i] = c
	}
	return Raw{"project": Raw{"slug": slug}, "cursus_ids": ids}
}

func TestTrackOf(t *testing.T) {
	cases := map[string]Raw{"piscine": pu("c-piscine-c-00", 9), "common-core": pu("42cursus-libft", 21), "outer-core": pu("scop", 21)}
	for want, p := range cases {
		if got := TrackOf(p); got != want {
			t.Errorf("TrackOf(%v) = %s, want %s", p, got, want)
		}
	}
	if TrackOf(pu("ft_transcendence", 21)) != "common-core" {
		t.Error("ft_transcendence is Common Core")
	}
}

func TestCommonCoreListCoversRanksAndExams(t *testing.T) {
	for _, s := range []string{"born2beroot", "cpp-module-09", "exam-rank-06", "minirt", "netpractice", "inception", "ft_irc"} {
		if _, ok := commonCore()[s]; !ok {
			t.Errorf("%s missing", s)
		}
	}
}

func TestXPEarned(t *testing.T) {
	m125, m80, m100 := 125.0, 80.0, 100.0
	for _, c := range []struct {
		diff  any
		mark  *float64
		valid bool
		want  int
	}{{462.0, &m125, true, 578}, {462.0, &m80, false, 0}, {0.0, &m100, true, 0}, {nil, &m100, true, 0}, {462.0, nil, true, 0}} {
		if got := XPEarned(c.diff, c.mark, c.valid); got != c.want {
			t.Errorf("XPEarned(%v,%v,%v) = %d, want %d", c.diff, c.mark, c.valid, got, c.want)
		}
	}
}

func TestGroupOf(t *testing.T) {
	for slug, want := range map[string]string{"42cursus-libft": "rank-00", "born2beroot": "rank-01", "exam-rank-02": "rank-02",
		"minishell": "rank-03", "cpp-module-04": "rank-04", "cpp-module-05": "rank-05", "ft_transcendence": "rank-06", "scop": "outer-core"} {
		if got := GroupOf(pu(slug, 21)); got != want {
			t.Errorf("GroupOf(%s) = %s, want %s", slug, got, want)
		}
	}
	if GroupOf(pu("c-piscine-c-00", 9)) != "piscine" {
		t.Error("piscine")
	}
}

func q(login, name string, validated any) Raw {
	return Raw{"user": Raw{"login": login}, "quest": Raw{"name": name}, "validated_at": validated}
}

func cu(login string, grade, end any) Raw {
	return Raw{"user": Raw{"login": login}, "cursus_id": 21.0, "grade": grade, "end_at": end}
}

var rulesNow = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

func TestRankGroupsBlackholed(t *testing.T) {
	g := RankGroups([]Raw{cu("bh", nil, "2025-03-01T00:00:00Z"), cu("later", nil, "2999-01-01T00:00:00Z"),
		cu("tr", "Transcender", "2025-03-01T00:00:00Z")}, nil, rulesNow)
	want := map[string]string{"bh": "blackholed", "later": "rank-00", "tr": "outer-core"}
	if !maps.Equal(g, want) {
		t.Fatalf("got %v", g)
	}
}

func TestRankGroupsWorkedOn(t *testing.T) {
	v := "2025-01-01T00:00:00Z"
	g := RankGroups([]Raw{cu("a", nil, nil), cu("b", nil, nil), cu("d", nil, nil), cu("e", nil, nil), cu("t", "Transcender", nil), cu("al", "Alumni", nil)},
		[]Raw{q("b", "Common Core Rank 00", v), q("b", "Common Core Rank 02", v), q("d", "Common Core Rank 05", v), q("e", "Common Core", v),
			q("x", "Common Core Rank 01", v), q("al", "Common Core", v)}, rulesNow)
	want := map[string]string{"a": "rank-00", "b": "rank-03", "d": "rank-06", "e": "outer-core", "t": "outer-core", "al": "alumni", "x": "no-cursus"}
	if !maps.Equal(g, want) {
		t.Fatalf("got %v", g)
	}
}

func TestRankGroupsIgnoresUnvalidatedAndOtherQuests(t *testing.T) {
	g := RankGroups([]Raw{cu("a", nil, nil)}, []Raw{q("a", "Common Core Rank 00", nil), q("a", "Exam Rank 06", "2025-01-01T00:00:00Z"),
		q("a", "CanEvaluateCommonCore", "2025-01-01T00:00:00Z")}, rulesNow)
	if !maps.Equal(g, map[string]string{"a": "rank-00"}) {
		t.Fatalf("got %v", g)
	}
}

type userOpt struct {
	staff, alumni, inactive, noMain bool
	begin, end, grade               any
	campus                          [][2]any
}

func mkUser(o userOpt) Raw {
	cursus := []any{Raw{"cursus_id": 9.0, "begin_at": "2024-07-01T08:00:00Z", "end_at": "2024-07-26T16:00:00Z", "grade": "Pisciner"}}
	if !o.noMain {
		begin := o.begin
		if begin == nil {
			begin = "2024-09-16T07:42:00Z"
		}
		if begin == "none" {
			begin = nil
		}
		cursus = append(cursus, Raw{"cursus_id": 21.0, "begin_at": begin, "end_at": o.end, "grade": o.grade})
	}
	camp := o.campus
	if camp == nil {
		camp = [][2]any{{22.0, true}}
	}
	cus := []any{}
	for _, c := range camp {
		cus = append(cus, Raw{"campus_id": c[0], "is_primary": c[1]})
	}
	return Raw{"staff?": o.staff, "alumni?": o.alumni, "active?": !o.inactive, "cursus_users": cursus, "campus_users": cus}
}

func TestProfileKindOrder(t *testing.T) {
	for _, c := range []struct {
		o    userOpt
		want Kind
	}{
		{userOpt{staff: true, alumni: true}, Staff}, {userOpt{grade: "Alumni"}, Alumni}, {userOpt{alumni: true}, Alumni},
		{userOpt{noMain: true}, Pisciner}, {userOpt{begin: "2027-01-01T00:00:00Z"}, Pisciner}, {userOpt{begin: "none"}, Pisciner},
		{userOpt{end: "2026-10-01T00:00:00Z"}, Blackholed}, {userOpt{inactive: true}, Frozen}, {userOpt{grade: "Transcender"}, Transcender},
		{userOpt{}, Student}, {userOpt{end: "2027-03-01T00:00:00Z"}, Student},
	} {
		if got := ProfileKind(mkUser(c.o), rulesNow); got != c.want {
			t.Errorf("%+v: got %s, want %s", c.o, got, c.want)
		}
	}
}

func TestAccess(t *testing.T) {
	for _, c := range []struct {
		o      userOpt
		ok     bool
		reason string
	}{
		{userOpt{}, true, "ok"}, {userOpt{grade: "Transcender"}, true, "ok"}, {userOpt{grade: "Alumni"}, true, "ok"},
		{userOpt{campus: [][2]any{{1.0, true}}}, false, "campus"}, {userOpt{staff: true}, false, "staff"},
		{userOpt{noMain: true}, false, "piscine"}, {userOpt{end: "2026-10-01T00:00:00Z"}, false, "blackholed"},
		{userOpt{inactive: true}, false, "frozen"}, {userOpt{campus: [][2]any{{1.0, true}, {22.0, false}}}, false, "campus"},
		{userOpt{campus: [][2]any{}}, false, "campus"},
	} {
		ok, reason := Access(mkUser(c.o), rulesNow)
		if ok != c.ok || reason != c.reason {
			t.Errorf("%+v: got %v %s", c.o, ok, reason)
		}
	}
}

func TestMainCoalition(t *testing.T) {
	cs := []Raw{{"slug": "piscine-x"}, {"slug": "tiamant"}, {"slug": "zefiria"}}
	if c := MainCoalition(cs); c == nil || c["slug"] != "zefiria" {
		t.Fatalf("got %v", c)
	}
	if MainCoalition([]Raw{{"slug": "piscine-x"}}) != nil || MainCoalition(nil) != nil {
		t.Fatal("expected nil")
	}
}

func TestPeopleAndProjectIDs(t *testing.T) {
	d := Raw{"evals_received": []any{Raw{"corrector": Raw{"id": 2.0}}, Raw{"corrector": nil}},
		"evals_given": []any{Raw{"correcteds": []any{Raw{"id": 3.0}, "invalid"}}},
		"teams":       []any{Raw{"project_id": 9.0, "users": []any{Raw{"id": 1.0}, Raw{"id": 4.0}}}}}
	if got := PeopleIDs(d, 1); !slices.Equal(got, []int{2, 3, 4}) {
		t.Errorf("PeopleIDs = %v", got)
	}
	d = Raw{"teams": []any{Raw{"project_id": 9.0}}, "evals_received": []any{Raw{"team": Raw{"project_id": 7.0}}}, "evals_given": []any{Raw{"team": nil}}}
	if got := ProjectIDs(d); !slices.Equal(got, []int{7, 9}) {
		t.Errorf("ProjectIDs = %v", got)
	}
}

func TestDropHidden(t *testing.T) {
	d := Raw{"evals_received": []any{Raw{"id": 1.0, "corrector": Raw{"id": 2.0, "login": "a"}}, Raw{"id": 2.0, "corrector": "invisible"}},
		"evals_given": []any{Raw{"id": 3.0, "correcteds": []any{Raw{"id": 3.0}, "invisible"}}}, "teams": []any{}}
	DropHiddenEvaluations(d)
	if r := List(d, "evals_received"); len(r) != 1 || Num(r[0].(Raw), "id") != 1 {
		t.Fatalf("received = %v", r)
	}
	if c := List(List(d, "evals_given")[0].(Raw), "correcteds"); len(c) != 1 {
		t.Fatalf("correcteds = %v", c)
	}
	if got := PeopleIDs(d, 1); !slices.Equal(got, []int{2, 3}) {
		t.Fatalf("PeopleIDs = %v", got)
	}
}

// The Python track (42Next) shares cursus 21 and the rank quests but places some projects on other circles.
func TestGroupOfPythonTrack(t *testing.T) {
	for slug, want := range map[string]string{"42cursus-libft": "rank-00", "42cursus-ft_printf": "rank-01", "42next-push_swap": "rank-01",
		"42next-born2beroot": "rank-02", "python-module-00": "rank-02", "python-module-06-bis": "rank-02", "a-maze-ing": "rank-02",
		"42next-exam-rank-02": "rank-02", "call-me-maybe": "rank-03", "codexion": "rank-03", "fly-in": "rank-03", "42next-exam-rank-03": "rank-03",
		"pac-man": "rank-04", "rag-against-the-machine": "rank-04", "42next-exam-rank-04": "rank-04", "agent-smith": "rank-05", "tree_nity": "rank-05",
		"the-answer-protocol": "rank-05", "42next-exam-rank-05": "rank-05", "42next-exam-rank-06": "rank-06", "push_swap": "rank-02", "born2beroot": "rank-01"} {
		if got := GroupOf(pu(slug, 21)); got != want {
			t.Errorf("GroupOf(%s) = %s, want %s", slug, got, want)
		}
	}
}

// A student who switched tracks has two projects with one name (push_swap, Exam Rank 02): each says its track.
func TestTrackNamesTellCAndPythonApart(t *testing.T) {
	rows := []*OMap{M("name", "Exam Rank 02", "slug", "exam-rank-02"), M("name", "Exam Rank 02", "slug", "42next-exam-rank-02"),
		M("name", "Libft", "slug", "42cursus-libft"), M("name", "push_swap", "slug", "42next-push_swap")}
	TrackNames(rows)
	got := []string{rows[0].S("name"), rows[1].S("name"), rows[2].S("name"), rows[3].S("name")}
	want := []string{"Exam Rank 02 (C)", "Exam Rank 02 (Python)", "Libft", "push_swap"}
	if !slices.Equal(got, want) {
		t.Errorf("TrackNames = %v, want %v", got, want)
	}
}

// Every attempt says whether the student led its team (group evaluations happen at the leader's computer).
func TestAttemptsSayWhoLed(t *testing.T) {
	r := Analyze(loadRaw(t, "testdata/api/fixture.json"), "all", goldenNow)
	found := false
	for _, p := range r.Os("projects") {
		for _, a := range p.Os("attempts") {
			if a.I("team_id") == 7000148 {
				found = true
				if a.V("leader") != true || len(a.L("members")) == 0 {
					t.Errorf("group attempt 7000148: leader %v, members %v", a.V("leader"), a.L("members"))
				}
			}
		}
	}
	if !found {
		t.Fatal("attempt 7000148 missing")
	}
}

// Staff accounts have no cursus: the API's kind (admin, external) marks them even when "staff?" is false.
func TestPersonIsStaffByKind(t *testing.T) {
	r := &report{people: map[float64]Raw{1: {"id": 1.0, "login": "boss", "staff?": false, "kind": "admin"}, 2: {"id": 2.0, "login": "pal", "kind": "student"}}}
	if !r.person(Raw{"id": 1.0}).B("staff") {
		t.Error("kind admin is staff")
	}
	if r.person(Raw{"id": 2.0}).B("staff") {
		t.Error("a student is not staff")
	}
}

// Each evaluation carries the cursus of its project, so Discovery piscines can be told from the 42cursus.
func TestEvaluationsCarryTheirProjectsCursus(t *testing.T) {
	d := loadRaw(t, "testdata/api/fixture.json")
	for _, p := range Objs(d, "projects") {
		p["cursus"] = []any{"42cursus"}
	}
	r := Analyze(d, "all", goldenNow)
	evs := append(r.Os("received"), r.Os("given")...)
	if len(evs) == 0 {
		t.Fatal("no evaluations")
	}
	withProject := 0
	for _, e := range evs {
		if e.V("slug") == nil { // a project the API did not return: nothing to read its cursus from
			continue
		}
		withProject++
		if c := e.L("cursus"); len(c) != 1 || c[0] != "42cursus" {
			t.Fatalf("evaluation %v: cursus %v", e.V("id"), e.V("cursus"))
		}
	}
	if withProject == 0 {
		t.Fatal("no evaluation with a project")
	}
}
