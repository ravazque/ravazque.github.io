package core

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestCSSFromUIMatchesV1(t *testing.T) {
	cfg, err := LoadUI()
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("testdata/golden/ui.css")
	if err != nil {
		t.Fatal(err)
	}
	if got := CSSFromUI(cfg); got != string(want) {
		gl, wl := strings.Split(got, "\n"), strings.Split(string(want), "\n")
		for i := range min(len(gl), len(wl)) {
			if gl[i] != wl[i] {
				t.Fatalf("line %d differs:\n got %.300s\nwant %.300s", i+1, gl[i], wl[i])
			}
		}
		t.Fatalf("length differs: %d vs %d lines", len(gl), len(wl))
	}
}

func TestValidateUIClean(t *testing.T) {
	cfg, _ := LoadUI()
	if errs := ValidateUI(cfg); len(errs) != 0 {
		t.Fatalf("shipped ui.json has errors: %v", errs)
	}
	bad, _ := ParseOrdered([]byte(`{"breakpoints":{"mobile":0},"tokens":{"light":{"x":"@nope","y":"12qq"}}}`))
	errs := ValidateUI(bad)
	if len(errs) != 2 || !strings.Contains(errs[0], "unknown reference @nope") || !strings.Contains(errs[1], "invalid value") {
		t.Fatalf("errors = %v", errs)
	}
}

func TestPanelGapIsTheSpaceAboveIt(t *testing.T) {
	p, _ := ParseOrdered([]byte(`{"span":12,"gap":"48px"}`))
	if got := strings.Join(panelRules("hours-month", p), " "); !strings.Contains(got, `[data-panel="hours-month"] { margin-top: 48px; }`) {
		t.Fatalf("rules = %s", got)
	}
	bad, _ := ParseOrdered([]byte(`{"breakpoints":{"mobile":0},"panels":{"hours-month":{"mobile":{"gap":"lots"}}}}`))
	if errs := ValidateUI(bad); len(errs) != 1 || !strings.Contains(errs[0], "panels.hours-month.mobile.gap") {
		t.Fatalf("errors = %v", errs)
	}
}

func TestOrderedJSONRoundTripKeepsEmptyLists(t *testing.T) {
	in := `{"a":[],"b":{"c":[[]],"d":null},"e":[1,{}]}`
	m, err := ParseOrdered([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(m)
	if string(out) != in {
		t.Fatalf("got %s", out)
	}
}
