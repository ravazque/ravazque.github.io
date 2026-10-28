package web

import (
	"strconv"
	"strings"

	"ravazque.info/server/core"
)

// hidden is how an opted-out student appears: a label with no name, photo or seat.
const hidden = "Hidden"

// hide copies the report with every opted-out student turned into a nameless, photoless label; the viewer never is.
func hide(v any, logins map[string]bool, own string) any {
	switch x := v.(type) {
	case *core.OMap:
		out := core.NewOMap()
		for _, k := range x.Keys() {
			out.Set(k, hide(x.V(k), logins, own))
		}
		if l := x.S("login"); logins[strings.ToLower(l)] && l != own {
			out.Set("login", hidden)
			for _, k := range []string{"name", "image", "displayname", "host", "hosts"} {
				if _, ok := x.Get(k); ok {
					out.Set(k, nil)
				}
			}
		}
		// objects keyed by login (evaluated sessions, a teammate's projects) lose the key too
		for _, k := range out.Keys() {
			if logins[strings.ToLower(k)] && k != own {
				label := hidden // two hidden logins as keys of one object keep both entries
				for n := 2; out.Has(label); n++ {
					label = hidden + " " + strconv.Itoa(n)
				}
				renamed := core.NewOMap()
				for _, kk := range out.Keys() {
					if kk == k {
						renamed.Set(label, out.V(kk))
					} else {
						renamed.Set(kk, out.V(kk))
					}
				}
				out = renamed
			}
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = hide(e, logins, own)
		}
		return out
	case string:
		if logins[strings.ToLower(x)] && x != own {
			return hidden
		}
	}
	return v
}
