package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ravazque.info/server/core"
)

func TestProfilesCoverEveryKindAndTrack(t *testing.T) {
	dir := t.TempDir()
	if err := makeProfiles(dir); err != nil {
		t.Fatal(err)
	}
	read := func(key string) (login string, slugs map[string]bool, raw string) {
		b, err := os.ReadFile(filepath.Join(dir, "test-"+key+".json"))
		if err != nil {
			t.Fatal(err)
		}
		r, _ := core.ParseOrdered(b)
		all := r.Obj("periods").Obj("all")
		slugs = map[string]bool{}
		for _, p := range all.Os("projects") {
			slugs[p.S("slug")] = true
		}
		return all.Obj("profile").S("login"), slugs, string(b)
	}
	logins := map[string]bool{}
	for _, p := range profiles {
		login, _, _ := read(p.key)
		if logins[login] {
			t.Fatalf("login %s twice", login)
		}
		logins[login] = true
	}
	if _, s, _ := read("python"); s["push_swap"] || s["minishell"] || !s["42next-push_swap"] || !s["call-me-maybe"] {
		t.Fatalf("python student: %v", s)
	}
	if _, s, _ := read("migrated"); !s["minishell"] || s["cub3d"] || !s["pac-man"] {
		t.Fatalf("migrated: %v", s)
	}
	for _, key := range []string{"outer", "pyouter"} {
		if _, _, raw := read(key); !strings.Contains(raw, `"grade":"Transcender"`) {
			t.Fatalf("%s is not a transcender", key)
		}
	}
	if _, s, _ := read("pyouter"); s["webserv"] || !s["tree_nity"] || !s["scop"] {
		t.Fatalf("python outer: %v", s)
	}
	// few and many: a side table or list with little (templates) and with a lot (a scroll)
	student := func(key string) *core.OMap {
		b, _ := os.ReadFile(filepath.Join(dir, "test-"+key+".json"))
		r, _ := core.ParseOrdered(b)
		return r.Obj("periods").Obj("student")
	}
	few, many := student("few"), student("many")
	if n := len(few.Os("given")); n != 3 {
		t.Fatalf("few: %d given", n)
	}
	if cp := few.Obj("coalition_points"); len(cp.Os("awards")) != 5 || len(cp.Os("bonuses")) != 2 || len(few.Obj("correction_points").Obj("reasons").Keys()) > 3 {
		t.Fatalf("few: %d awards, %d bonuses", len(cp.Os("awards")), len(cp.Os("bonuses")))
	}
	cp := many.Obj("coalition_points")
	srcs := map[string]bool{}
	for _, s := range cp.Os("sources") {
		srcs[s.S("key")] = true
	}
	if n := len(many.Obj("correction_points").Obj("reasons").Keys()); n < 9 || len(cp.Os("bonuses")) < 40 || !srcs["wallet"] || !srcs["other"] || !srcs["logtime_80"] {
		t.Fatalf("many: %d reasons, %d bonuses, sources %v", n, len(cp.Os("bonuses")), srcs)
	}
}
