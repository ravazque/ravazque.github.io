package web

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"ravazque.info/server/core"
)

func TestHiddenStudentsLoseTheSeatTheEvaluationCarries(t *testing.T) {
	doc, err := core.ParseOrdered([]byte(`{
		"received": [
			{"corrector": {"login": "peer03", "host": "c1r1s1"}, "other_host": "c1r1s1", "other_host_checked": true},
			{"corrector": {"login": "peer04", "host": "c2r2s2"}, "other_host": "c2r2s2", "other_host_checked": true}],
		"given": [{"correcteds": [{"login": "peer03", "host": "c3r3s3"}], "other_host_checked": true}]}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(hide(doc, map[string]bool{"peer03": true}, "tmidway"))
	if err != nil {
		t.Fatal(err)
	}
	got := string(raw)
	for _, seat := range []string{"c1r1s1", "c3r3s3"} {
		if strings.Contains(got, seat) {
			t.Fatalf("a hidden student's seat %s is visible: %s", seat, got)
		}
	}
	if !strings.Contains(got, "c2r2s2") {
		t.Fatalf("the seat of someone not hidden went too: %s", got)
	}
	// looked up with no seat would read "not logged": a hidden student's evaluation says nothing at all
	if strings.Count(got, `"other_host_checked":true`) != 1 {
		t.Fatalf("a hidden student's evaluation still claims its seat was looked up: %s", got)
	}
}

func TestHiddenStudentsLeaveNoLoginInsideOtherTexts(t *testing.T) {
	doc, err := core.ParseOrdered([]byte(`{"given": [{"team": "peer03's group", "comment": "Good talk with PEER03, and with peer033 and xpeer03."}],
		"mine": "tmidway's group"}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(hide(doc, map[string]bool{"peer03": true, "tmidway": true}, "tmidway"))
	if err != nil {
		t.Fatal(err)
	}
	got := string(raw)
	if strings.Contains(got, "peer03's") || strings.Contains(got, "PEER03") {
		t.Fatalf("a hidden login is still inside a text: %s", got)
	}
	if !strings.Contains(got, "Hidden 1's group") || !strings.Contains(got, "peer033") || !strings.Contains(got, "xpeer03") || !strings.Contains(got, "tmidway's group") {
		t.Fatalf("it should only touch the whole login, and never the viewer's: %s", got)
	}
}

// figures: every number under v, in order; a name changing can't move them.
func figures(v any) string {
	raw, _ := json.Marshal(v)
	var doc any
	json.Unmarshal(raw, &doc)
	var out []string
	var walk func(any)
	walk = func(x any) {
		switch y := x.(type) {
		case float64:
			out = append(out, fmt.Sprint(y))
		case []any:
			for _, e := range y {
				walk(e)
			}
		case map[string]any:
			keys := make([]string, 0, len(y))
			for k := range y {
				keys = append(keys, k)
			}
			slices.Sort(keys)
			for _, k := range keys {
				walk(y[k])
			}
		}
	}
	walk(doc)
	return strings.Join(out, ",")
}

func TestHidingChangesWhoNeverTheFigures(t *testing.T) {
	raw, err := os.ReadFile("../../core/testdata/golden/mid.report.json")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := core.ParseOrdered(raw)
	if err != nil {
		t.Fatal(err)
	}
	all := doc.Obj("periods").Obj("all")
	own := all.Obj("profile").S("login")
	logins := map[string]bool{}
	for _, p := range all.Os("people") {
		if len(logins) < 6 {
			logins[strings.ToLower(p.S("login"))] = true
		}
	}
	if len(logins) < 2 {
		t.Fatal("the fixture needs people to hide")
	}
	got := hide(doc, logins, own).(*core.OMap)
	now := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	distinct := func(rows []*core.OMap, key string) int {
		seen := map[string]bool{}
		for _, r := range rows {
			seen[r.S(key)] = true
		}
		return len(seen)
	}
	for _, p := range doc.Obj("periods").Keys() {
		a, b := doc.Obj("periods").Obj(p), got.Obj("periods").Obj(p)
		for _, k := range []string{"summary", "stats", "when", "place", "logtime", "projects", "coalition_points"} {
			if figures(a.V(k)) != figures(b.V(k)) {
				t.Errorf("%s: the figures of %s changed", p, k)
			}
		}
		for _, k := range []string{"received", "given", "people"} {
			if len(a.L(k)) != len(b.L(k)) {
				t.Errorf("%s: %s went from %d to %d", p, k, len(a.L(k)), len(b.L(k)))
			}
		}
		if da, db := core.Derive(a, doc.Obj("periods").Obj("all"), now), core.Derive(b, got.Obj("periods").Obj("all"), now); figures(da.V("community")) != figures(db.V("community")) {
			t.Errorf("%s: community %s became %s", p, figures(da.V("community")), figures(db.V("community")))
		}
		if distinct(a.Os("people"), "login") != distinct(b.Os("people"), "login") {
			t.Errorf("%s: different people became one", p)
		}
	}
	for _, p := range doc.Obj("connections").Keys() {
		if distinct(doc.Obj("connections").Os(p), "login") != distinct(got.Obj("connections").Os(p), "login") {
			t.Errorf("connections %s: different people became one", p)
		}
	}
	for _, p := range doc.Obj("network").Keys() {
		a, b := doc.Obj("network").Obj(p), got.Obj("network").Obj(p)
		if distinct(a.Os("nodes"), "login") != distinct(b.Os("nodes"), "login") || figures(a.V("links")) != figures(b.V("links")) {
			t.Errorf("network %s changed", p)
		}
	}
	text, _ := json.Marshal(got)
	for l := range logins {
		if strings.Contains(strings.ToLower(string(text)), `"`+l+`"`) {
			t.Fatalf("%s is still there", l)
		}
	}
	// hidden again later, with someone more: nobody takes a number already in use
	var more string
	for _, p := range got.Obj("periods").Obj("all").Os("people") {
		if !isHidden(p.S("login")) && p.S("login") != own {
			more = strings.ToLower(p.S("login"))
			break
		}
	}
	if more != "" {
		again := hide(got, map[string]bool{more: true}, own).(*core.OMap)
		if a, b := distinct(got.Obj("periods").Obj("all").Os("people"), "login"), distinct(again.Obj("periods").Obj("all").Os("people"), "login"); a != b {
			t.Errorf("hiding one more merged people: %d became %d", a, b)
		}
	}
}
