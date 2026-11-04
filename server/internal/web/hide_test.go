package web

import (
	"encoding/json"
	"strings"
	"testing"

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
