package main

import (
	"reflect"
	"testing"
	"time"
)

func TestShiftMovesEveryTimestampAndDateKey(t *testing.T) {
	in := map[string]any{
		"begin_at": "2026-10-28T10:43:00.000Z", "plain": "2026 is a year", "n": 3.0,
		"list":            []any{map[string]any{"created_at": "2026-10-27T23:22:00+00:00"}},
		"locations_stats": map[string]any{"2026-10-27": "08:01:00.000000"},
	}
	out := shift(in, 49*time.Hour+30*time.Minute)
	want := map[string]any{
		"begin_at": "2026-10-30T12:13:00.000Z", "plain": "2026 is a year", "n": 3.0,
		"list":            []any{map[string]any{"created_at": "2026-10-30T00:52:00+00:00"}},
		"locations_stats": map[string]any{"2026-10-29": "08:01:00.000000"},
	}
	if !reflect.DeepEqual(out, want) {
		t.Fatalf("got %v", out)
	}
}
