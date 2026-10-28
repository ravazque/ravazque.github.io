package core

import (
	"strings"
	"time"
	_ "time/tzdata" // Madrid's rules inside the binary: the image has no zoneinfo
)

// Raw is one object as the 42 API sends it; it keeps the API's shape.
type Raw = map[string]any

const (
	MainCursus    = 21
	PiscineCursus = 9
	MadridCampus  = 22
)

// CommonCoreQuests place someone in the Common Core: "Common Core" and "Common Core Rank 00"…"05" (checked 2026-10-25).
var CommonCoreQuests = []int{37, 44, 45, 46, 47, 48, 49}

// MainCoalitions are the 42 Madrid main cursus coalitions, in the order that wins when a user has several.
var MainCoalitions = []string{"zefiria", "marventis", "ignisaria", "tiamant"}

var Madrid = mustZone("Europe/Madrid")

func mustZone(name string) *time.Location {
	l, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return l
}

// TS parses the API's timestamps; zero time for empty or invalid input.
func TS(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, strings.Replace(s, " ", "T", 1))
	if err != nil {
		return time.Time{}
	}
	return t.UTC()
}

func Str(r Raw, k string) string {
	s, _ := r[k].(string)
	return s
}

func Num(r Raw, k string) float64 {
	f, _ := r[k].(float64)
	return f
}

// NumP is nil when the value is absent or not a number.
func NumP(r Raw, k string) *float64 {
	if f, ok := r[k].(float64); ok {
		return &f
	}
	return nil
}

func Int(r Raw, k string) int { return int(Num(r, k)) }

func Bool(r Raw, k string) bool {
	b, _ := r[k].(bool)
	return b
}

func List(r Raw, k string) []any {
	l, _ := r[k].([]any)
	return l
}

// Objs is the list under k keeping only its objects.
func Objs(r Raw, k string) []Raw {
	var out []Raw
	for _, v := range List(r, k) {
		if o, ok := v.(Raw); ok {
			out = append(out, o)
		}
	}
	return out
}

func Obj(r Raw, k string) Raw {
	o, _ := r[k].(Raw)
	return o
}
