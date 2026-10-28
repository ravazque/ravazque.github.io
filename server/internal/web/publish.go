package web

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"time"

	"ravazque.info/server/core"
)

// The public snapshot for ravazque.github.io and its commit through the GitHub Contents API. The snapshot is a
// whitelist: every field is copied by name from the owner's report, so nothing new (contact data, seats, logged hours,
// other students) can reach the public site by accident.

const siteDataPath = "site/data/42.json"

var (
	cursusTracks = []string{"common-core", "outer-core"}
	inProgress   = []string{"in_progress", "waiting_for_correction", "searching_a_group", "creating_group"}
	rankQuest    = regexp.MustCompile(`^Common Core Rank (\d\d)$`)
)

func cut10(s string) string {
	if len(s) > 10 {
		return s[:10]
	}
	return s
}

// Snapshot builds the public JSON from the stored report (schema 1, as v1).
func Snapshot(report *core.OMap, updated string) *core.OMap {
	periods := report.Obj("periods")
	every := periods.Obj("all")
	student := every
	if _, ok := periods.Get("student"); ok {
		student = periods.Obj("student")
	}
	profile, extras, summary := every.Obj("profile"), every.Obj("extras"), student.Obj("summary")
	var main *core.OMap
	for _, c := range extras.Os("cursus") {
		if c.S("name") == "42cursus" {
			main = c
		}
	}
	var commonCore any
	for _, q := range extras.Os("quests") {
		if q.S("name") == "Common Core" && q.S("validated") != "" {
			commonCore = cut10(q.S("validated"))
			break
		}
	}
	group := func(p *core.OMap) any {
		if g, ok := p.Get("group"); ok {
			return g
		}
		return p.V("track")
	}
	var projects, progress []*core.OMap
	for _, p := range every.Os("projects") {
		if p.V("validated") == true {
			projects = append(projects, core.M("name", p.V("name"), "track", p.V("track"), "group", group(p), "mark", p.V("mark"),
				"xp", p.I("xp_earned"), "validated", cut10(p.S("marked"))))
		} else if slices.Contains(inProgress, p.S("status")) && slices.Contains(cursusTracks, p.S("track")) {
			progress = append(progress, core.M("name", p.V("name"), "track", p.V("track"), "group", group(p), "since", cut10(p.S("registered"))))
		}
	}
	slices.SortStableFunc(projects, func(a, b *core.OMap) int {
		switch {
		case a.S("validated") > b.S("validated"):
			return -1
		case a.S("validated") < b.S("validated"):
			return 1
		}
		return 0
	})
	validated := 0
	for _, p := range projects {
		if slices.Contains(cursusTracks, p.S("track")) {
			validated++
		}
	}
	var title any
	for _, t := range extras.Os("titles") {
		if t.B("selected") {
			title = t.V("name")
			break
		}
	}
	var coalition any
	if c := profile.Obj("coalition"); c.S("name") != "" {
		coalition = core.M("name", c.V("name"), "color", c.V("color"))
	}
	var cursus any
	if main != nil {
		cursus = core.M("level", main.V("level"), "grade", main.V("grade"), "stage", core.MyRank(extras),
			"kickoff", cut10(main.S("begin")), "common_core", commonCore)
	}
	skills := func(name string) []any {
		out := []any{}
		for _, s := range extras.Obj("skills_by_cursus").Os(name) {
			out = append(out, core.M("name", s.V("name"), "level", s.V("level")))
		}
		return out
	}
	evals := core.NewOMap()
	for _, k := range []string{"given", "given_outstanding", "received", "received_outstanding", "received_avg_mark"} {
		evals.Set(k, summary.V(k))
	}
	listOf := func(xs []*core.OMap) []any {
		out := []any{}
		for _, x := range xs {
			out = append(out, x)
		}
		return out
	}
	return core.M("schema", 1, "updated", updated, "login", profile.V("login"), "name", profile.V("name"), "campus", "42 Madrid",
		"title", title, "coalition", coalition, "cursus", cursus,
		"skills", core.M("student", skills("42cursus"), "piscine", skills("C Piscine")),
		"projects", core.M("validated", validated, "list", listOf(projects), "in_progress", listOf(progress)), "evaluations", evals)
}

func (s *Server) publish(w http.ResponseWriter, r *http.Request, si signedIn) {
	if !s.isOwner(si.u) {
		writeJSON(w, 403, errBody("owner"))
		return
	}
	if !s.canPublish(si.u) {
		writeJSON(w, 503, errBody("publish-off"))
		return
	}
	st := s.Store.Status(si.u.ID)
	last, err := time.Parse(time.RFC3339, st.Last)
	raw := s.Store.LoadRaw(si.u.ID)
	if raw == nil || err != nil || s.now().Sub(last) >= time.Duration(s.S.CooldownS)*time.Second {
		writeJSON(w, 409, errBody("stale"))
		return
	}
	if !s.publishMu.TryLock() {
		writeJSON(w, 409, errBody("busy"))
		return
	}
	defer s.publishMu.Unlock()
	report, err := core.ParseOrdered(raw)
	if err != nil {
		writeJSON(w, 500, errBody("report"))
		return
	}
	url, err := s.commitSnapshot(Snapshot(report, st.Last))
	if err != nil {
		writeJSON(w, 502, errBody("github"))
		return
	}
	published := s.now().UTC().Format(time.RFC3339)
	s.M.Set("published:"+s.Store.Digest(si.u.ID), []byte(published), 0, false)
	s.Stats.Published()
	writeJSON(w, 200, map[string]string{"url": url, "published": published})
}

// commitSnapshot creates or updates siteDataPath on the configured branch; returns the commit's URL.
func (s *Server) commitSnapshot(snap *core.OMap) (string, error) {
	u := fmt.Sprintf("%s/repos/%s/contents/%s", s.githubAPI, s.S.GithubRepo, siteDataPath)
	req := func(method, url string, body []byte) (*http.Response, error) {
		r, _ := http.NewRequest(method, url, bytes.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+s.S.GithubToken)
		r.Header.Set("Accept", "application/vnd.github+json")
		r.Header.Set("X-GitHub-Api-Version", "2022-11-28")
		return s.gh.Do(r)
	}
	cur, err := req("GET", u+"?ref="+s.S.GithubBranch, nil)
	if err != nil {
		return "", err
	}
	defer cur.Body.Close()
	if cur.StatusCode != 200 && cur.StatusCode != 404 {
		return "", fmt.Errorf("GitHub answered %d reading %s", cur.StatusCode, siteDataPath)
	}
	content, _ := json.MarshalIndent(snap, "", " ")
	day := cut10(snap.S("updated"))
	if day == "" {
		day = "today"
	}
	body := map[string]any{"message": "site: 42 snapshot of " + day, "branch": s.S.GithubBranch,
		"content": base64.StdEncoding.EncodeToString(append(content, '\n'))}
	if cur.StatusCode == 200 {
		var c struct{ SHA string }
		json.NewDecoder(cur.Body).Decode(&c)
		body["sha"] = c.SHA
	}
	b, _ := json.Marshal(body)
	res, err := req("PUT", u, b)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 && res.StatusCode != 201 {
		return "", fmt.Errorf("GitHub answered %d writing %s", res.StatusCode, siteDataPath)
	}
	var out struct {
		Commit struct {
			HTMLURL string `json:"html_url"`
		} `json:"commit"`
	}
	json.NewDecoder(res.Body).Decode(&out)
	return out.Commit.HTMLURL, nil
}

func decodeB64(s string) []byte {
	b, _ := base64.StdEncoding.DecodeString(s)
	return b
}
