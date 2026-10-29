package core

import (
	"encoding/json"
	"fmt"
	"math"
)

// JSONDiff is the first path where two JSON documents differ, key order included; "" when equal.
func JSONDiff(got, want any, path string) string {
	switch w := want.(type) {
	case *OMap:
		g, ok := got.(*OMap)
		if !ok {
			return fmt.Sprintf("%s: got %T, want object", path, got)
		}
		gk, wk := v2Only(g.Keys(), w), w.Keys()
		for i := range max(len(gk), len(wk)) {
			if i >= len(gk) || i >= len(wk) || gk[i] != wk[i] {
				return fmt.Sprintf("%s: keys %v, want %v", path, gk, wk)
			}
		}
		for _, k := range wk {
			gv, _ := g.Get(k)
			wv, _ := w.Get(k)
			if d := JSONDiff(gv, wv, path+"."+k); d != "" {
				return d
			}
		}
	case []any:
		g, ok := got.([]any)
		if !ok {
			return fmt.Sprintf("%s: got %T, want array", path, got)
		}
		if len(g) != len(w) {
			return fmt.Sprintf("%s: length %d, want %d", path, len(g), len(w))
		}
		for i := range w {
			if d := JSONDiff(g[i], w[i], fmt.Sprintf("%s[%d]", path, i)); d != "" {
				return d
			}
		}
	case json.Number:
		g, ok := got.(json.Number)
		if !ok {
			return fmt.Sprintf("%s: got %v, want %v", path, got, w)
		}
		gf, _ := g.Float64()
		wf, _ := w.Float64()
		if math.Abs(gf-wf) > 1e-9*max(1, math.Abs(wf)) {
			return fmt.Sprintf("%s: got %v, want %v", path, g, w)
		}
	default:
		if got != want {
			return fmt.Sprintf("%s: got %v, want %v", path, got, want)
		}
	}
	return ""
}

// v2Keys were added after the first version: a golden file from it has none of them, so they are left out there.
var v2Keys = map[string]bool{"leader": true, "cursus": true}

func v2Only(keys []string, want *OMap) []string {
	out := keys[:0:0]
	for _, k := range keys {
		if !v2Keys[k] || want.Has(k) {
			out = append(out, k)
		}
	}
	return out
}
