package core

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

var trackRanks = sync.OnceValue(func() map[string]string {
	var f struct {
		CommonCore map[string][]string `json:"common_core"`
	}
	raw, _ := Data.ReadFile("data/tracks.json")
	if err := json.Unmarshal(raw, &f); err != nil {
		panic(err)
	}
	out := map[string]string{}
	for rank, slugs := range f.CommonCore {
		for _, s := range slugs {
			out[s] = rank
		}
	}
	return out
})

func commonCore() map[string]string { return trackRanks() }

// TrackOf says which part of 42 a project belongs to: piscine, common-core or outer-core.
func TrackOf(projectUser Raw) string {
	for _, c := range List(projectUser, "cursus_ids") {
		if c == float64(PiscineCursus) {
			return "piscine"
		}
	}
	if _, ok := trackRanks()[Str(Obj(projectUser, "project"), "slug")]; ok {
		return "common-core"
	}
	return "outer-core"
}

// GroupOf is the finer grouping of the project tables: rank-00…rank-06, outer-core or piscine.
func GroupOf(projectUser Raw) string {
	if t := TrackOf(projectUser); t != "common-core" {
		return t
	}
	return trackRanks()[Str(Obj(projectUser, "project"), "slug")]
}

// XPEarned is the XP a validated project gives: difficulty scaled by the final mark, bonus included. A calculation:
// the intra's own figure may differ.
func XPEarned(difficulty any, mark *float64, validated bool) int {
	d, _ := difficulty.(float64)
	if !validated || d == 0 || mark == nil {
		return 0
	}
	return int(math.RoundToEven(d * *mark / 100))
}

// Groups of the connections graph, in display order.
var Groups = []string{"rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "alumni", "blackholed", "no-cursus"}

var rankQuest = regexp.MustCompile(`^Common Core Rank (\d\d)$`)

// RankGroups maps login → group. "Rank N" is the rank being worked on: the highest validated rank quest plus one.
// A 42cursus already ended puts a student who has not finished the Common Core in "blackholed".
func RankGroups(cursusUsers, questsUsers []Raw, now time.Time) map[string]string {
	grade, gone := map[string]any{}, map[string]bool{}
	for _, c := range cursusUsers {
		login := Str(Obj(c, "user"), "login")
		grade[login] = c["grade"]
		if end := TS(Str(c, "end_at")); !end.IsZero() && end.Before(now) {
			gone[login] = true
		}
	}
	cc, best := map[string]bool{}, map[string]int{}
	for _, q := range questsUsers {
		if Str(q, "validated_at") == "" {
			continue
		}
		login, name := Str(Obj(q, "user"), "login"), Str(Obj(q, "quest"), "name")
		if name == "Common Core" {
			cc[login] = true
		} else if m := rankQuest.FindStringSubmatch(name); m != nil {
			var n int
			fmt.Sscan(m[1], &n)
			if b, ok := best[login]; !ok || n > b {
				best[login] = n
			}
		}
	}
	out := map[string]string{}
	set := func(login string) {
		g, inCursus := grade[login]
		switch {
		case !inCursus:
			out[login] = "no-cursus"
		case g == "Alumni":
			out[login] = "alumni"
		case g == "Transcender" || cc[login]:
			out[login] = "outer-core"
		case gone[login]:
			out[login] = "blackholed"
		default:
			b, ok := best[login]
			if !ok {
				b = -1
			}
			out[login] = fmt.Sprintf("rank-%02d", b+1)
		}
	}
	for l := range grade {
		set(l)
	}
	for l := range cc {
		set(l)
	}
	for l := range best {
		set(l)
	}
	return out
}

// Kind is who someone is on 42; no single API field says it (swifty-companion's ProfileKind).
type Kind string

const (
	Student     Kind = "student"
	Transcender Kind = "transcender"
	Alumni      Kind = "alumni"
	Blackholed  Kind = "blackholed"
	Frozen      Kind = "frozen"
	Pisciner    Kind = "pisciner"
	Staff       Kind = "staff"
)

func mainCursus(user Raw) Raw {
	for _, c := range Objs(user, "cursus_users") {
		if Num(c, "cursus_id") == MainCursus {
			return c
		}
	}
	return nil
}

// ProfileKind, in order: staff; alumni; not started (no 42cursus or a future kickoff); blackholed; frozen; transcender.
func ProfileKind(user Raw, now time.Time) Kind {
	main := mainCursus(user)
	if Bool(user, "staff?") {
		return Staff
	}
	if Bool(user, "alumni?") || Str(main, "grade") == "Alumni" {
		return Alumni
	}
	kickoff := TS(Str(main, "begin_at"))
	if main == nil || kickoff.IsZero() || kickoff.After(now) {
		return Pisciner
	}
	if end := TS(Str(main, "end_at")); !end.IsZero() && !end.After(now) {
		return Blackholed
	}
	if active, ok := user["active?"].(bool); ok && !active {
		return Frozen
	}
	if Str(main, "grade") == "Transcender" {
		return Transcender
	}
	return Student
}

var refusal = map[Kind]string{Staff: "staff", Pisciner: "piscine", Blackholed: "blackholed", Frozen: "frozen"}

// Access says whether someone may use the app: 42 Madrid Fundación Telefónica as primary campus, and only students, transcenders, alumni.
func Access(user Raw, now time.Time) (bool, string) {
	var primary Raw
	for _, c := range Objs(user, "campus_users") {
		if Bool(c, "is_primary") {
			primary = c
			break
		}
	}
	if primary == nil || Num(primary, "campus_id") != MadridCampus {
		return false, "campus"
	}
	if r, refused := refusal[ProfileKind(user, now)]; refused {
		return false, r
	}
	return true, "ok"
}

// MainCoalition is the user's 42cursus coalition; piscine coalitions are ignored.
func MainCoalition(coalitions []Raw) Raw {
	for _, slug := range MainCoalitions {
		for _, c := range coalitions {
			if Str(c, "slug") == slug {
				return c
			}
		}
	}
	return nil
}

func sortedIDs(set map[int]bool) []int {
	out := make([]int, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	slices.Sort(out)
	return out
}

// PeopleIDs: everyone who evaluated me, was evaluated by me, or shared a team with me.
func PeopleIDs(d Raw, myID int) []int {
	ids := map[int]bool{}
	for _, e := range Objs(d, "evals_received") {
		if id := Int(Obj(e, "corrector"), "id"); id != 0 {
			ids[id] = true
		}
	}
	for _, e := range Objs(d, "evals_given") {
		for _, c := range Objs(e, "correcteds") {
			ids[Int(c, "id")] = true
		}
	}
	for _, t := range Objs(d, "teams") {
		for _, u := range Objs(t, "users") {
			ids[Int(u, "id")] = true
		}
	}
	delete(ids, myID)
	return sortedIDs(ids)
}

func ProjectIDs(d Raw) []int {
	ids := map[int]bool{}
	for _, t := range Objs(d, "teams") {
		ids[Int(t, "project_id")] = true
	}
	for _, k := range []string{"evals_received", "evals_given"} {
		for _, e := range Objs(d, k) {
			if team := Obj(e, "team"); team != nil {
				ids[Int(team, "project_id")] = true
			}
		}
	}
	return sortedIDs(ids)
}

// DropHiddenEvaluations: the API can hide who takes part in an upcoming evaluation ("invisible" instead of a user).
// Such evaluations have no mark and nobody to count yet: drop them (and hidden correcteds) before any analysis.
func DropHiddenEvaluations(d Raw) Raw {
	var kept []any
	for _, v := range List(d, "evals_received") {
		e, _ := v.(Raw)
		if e == nil {
			continue
		}
		if _, isObj := e["corrector"].(Raw); isObj || e["corrector"] == nil {
			kept = append(kept, e)
		}
	}
	if kept == nil {
		kept = []any{}
	}
	d["evals_received"] = kept
	for _, e := range Objs(d, "evals_given") {
		if l, ok := e["correcteds"].([]any); ok {
			users := []any{}
			for _, u := range l {
				if _, ok := u.(Raw); ok {
					users = append(users, u)
				}
			}
			e["correcteds"] = users
		}
	}
	return d
}

// AccessRefused: the profile no longer meets the access rule; Reason is campus, staff, piscine, blackholed or frozen.
type AccessRefused struct{ Reason string }

func (e AccessRefused) Error() string { return "access refused: " + e.Reason }

// TrackNames tells the C and Python (42Next, slugs 42next-*) versions of one project apart when a student has both:
// those rows get " (C)" or " (Python)" after the name.
func TrackNames(rows []*OMap) {
	tracks := map[string]map[bool]bool{}
	for _, p := range rows {
		n := p.S("name")
		if tracks[n] == nil {
			tracks[n] = map[bool]bool{}
		}
		tracks[n][strings.HasPrefix(p.S("slug"), "42next-")] = true
	}
	for _, p := range rows {
		if len(tracks[p.S("name")]) == 2 {
			p.Set("name", p.S("name")+map[bool]string{false: " (C)", true: " (Python)"}[strings.HasPrefix(p.S("slug"), "42next-")])
		}
	}
}
