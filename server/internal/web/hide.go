package web

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"ravazque.info/server/core"
)

// hidden is how an opted-out student appears: a label with no name, photo or seat, and a number that only tells them
// apart inside one report, so that nobody's evaluations or counts change: only who it was goes.
const hidden = "Hidden"

var (
	loginWord   = regexp.MustCompile(`[A-Za-z0-9-]+`) // a login inside a text ("peer's group", a comment), as a whole word
	hiddenLabel = regexp.MustCompile(`^Hidden( \d+)?$`)
	usedLabel   = regexp.MustCompile(`Hidden (\d+)`)
)

func isHidden(login string) bool { return hiddenLabel.MatchString(login) }

type hider struct {
	logins map[string]bool
	own    string
	labels map[string]string
	used   int
}

// hide copies the report with every opted-out student turned into a nameless, photoless label; the viewer never is.
func hide(v any, logins map[string]bool, own string) any {
	h := &hider{logins: logins, own: own, labels: map[string]string{}}
	raw, _ := json.Marshal(v) // a copy hidden before keeps its numbers: the new ones come after them
	for _, m := range usedLabel.FindAllSubmatch(raw, -1) {
		if n, _ := strconv.Atoi(string(m[1])); n > h.used {
			h.used = n
		}
	}
	return h.walk(v)
}

func (h *hider) gone(login string) bool {
	return h.logins[strings.ToLower(login)] && !strings.EqualFold(login, h.own)
}

// label is the same for one person everywhere in the report.
func (h *hider) label(login string) string {
	k := strings.ToLower(login)
	if h.labels[k] == "" {
		h.used++
		h.labels[k] = hidden + " " + strconv.Itoa(h.used)
	}
	return h.labels[k]
}

func (h *hider) walk(v any) any {
	switch x := v.(type) {
	case *core.OMap:
		out := core.NewOMap()
		for _, k := range x.Keys() {
			key := k // objects keyed by login (evaluated sessions, a teammate's projects) lose the key too
			if h.gone(k) {
				key = h.label(k)
			}
			out.Set(key, h.walk(x.V(k)))
		}
		if h.gone(x.S("login")) {
			for _, k := range []string{"name", "image", "displayname", "host", "hosts", "late_min"} {
				if _, ok := x.Get(k); ok {
					out.Set(k, nil)
				}
			}
		}
		// the evaluation carries the seat too; looked up with no seat would read "not logged", so it claims neither
		if out.Has("other_host_checked") && namesHidden(out) {
			out.Set("other_host_checked", false)
			if out.Has("other_host") {
				out.Set("other_host", nil)
			}
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = h.walk(e)
		}
		return out
	case string:
		return loginWord.ReplaceAllStringFunc(x, func(w string) string {
			if h.gone(w) {
				return h.label(w)
			}
			return w
		})
	}
	return v
}

// namesHidden says whether an evaluation has a hidden student on the other side.
func namesHidden(e *core.OMap) bool {
	if c, ok := e.V("corrector").(*core.OMap); ok && isHidden(c.S("login")) {
		return true
	}
	for _, c := range e.Os("correcteds") {
		if isHidden(c.S("login")) {
			return true
		}
	}
	return false
}
