package core

import (
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
