package app

import (
	"errors"
	"os"
	"slices"
	"strconv"
	"strings"
)

// Settings come from the environment (the root .env through docker compose).
type Settings struct {
	BaseURL                     string
	FTUID, FTSecret             string
	FTUID2, FTSecret2           string // more 42 apps, optional: app-token requests are spread over all of them
	FTUID3, FTSecret3           string
	OAuthApp                    int // the app that signs users in: 1 (FT_UID, production) or 2 (FT_UID_2, make dev); 3 never does
	SessionSecret               string
	CooldownS, CacheS, SessionS int
	InsecureCookies             bool // tests only
	ContactEmail, IssuesURL     string
	ControllerName              string
	OptoutLogins                []string // students who asked to be left out of every report
	ConsentLog                  string   // where acceptances of the privacy policy are kept (the only file written)
	DevReport                   string   // make dev only: a saved report served at once, /dev/login as its owner
	DevUID                      int
	OwnerLogin                  string // the one login that may publish to the GitHub Pages site
	GithubToken, GithubRepo     string
	GithubBranch                string
	Addr                        string
}

type App struct{ UID, Secret string }

// OAuth is the app that signs users in.
func (s Settings) OAuth() App {
	if s.OAuthApp == 2 {
		return App{s.FTUID2, s.FTSecret2}
	}
	return App{s.FTUID, s.FTSecret}
}

// Apps are the 42 apps that answer app-token requests, whichever one signs users in.
func (s Settings) Apps() []App {
	out := []App{{s.FTUID, s.FTSecret}}
	for _, a := range []App{{s.FTUID2, s.FTSecret2}, {s.FTUID3, s.FTSecret3}} {
		if a.UID != "" && a.Secret != "" {
			out = append(out, a)
		}
	}
	return out
}

// OAuthIndex is where the sign-in app sits in Apps: its rate limit is shared with its app-token requests.
func (s Settings) OAuthIndex() int { return slices.Index(s.Apps(), s.OAuth()) }

// Check refuses to run with a short SESSION_SECRET (it keys the HMACs) or without a contact and a controller.
func (s Settings) Check() error {
	o := s.OAuth()
	if (s.OAuthApp != 1 && s.OAuthApp != 2) || (s.OAuthApp == 2 && (o.UID == "" || o.Secret == "")) {
		return errors.New("OAUTH_APP must name a 42 app with its UID and secret set: 1 (FT_UID) or 2 (FT_UID_2)")
	}
	if len(s.SessionSecret) < 32 {
		return errors.New("SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)")
	}
	if s.ContactEmail == "" {
		return errors.New("CONTACT_EMAIL must be set: the privacy page names who to contact")
	}
	if s.ControllerName == "" {
		return errors.New("CONTROLLER_NAME must be set: the privacy page names the data controller")
	}
	if s.DevReport != "" && !strings.HasPrefix(s.BaseURL, "https://localhost") {
		return errors.New("DEV_REPORT signs anyone in without 42: it only runs on https://localhost")
	}
	return nil
}

func SettingsFromEnv() Settings {
	env := func(k, def string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return def
	}
	num := func(k string, def int) int {
		n, err := strconv.Atoi(os.Getenv(k))
		if err != nil {
			return def
		}
		return n
	}
	var optout []string
	for _, x := range strings.Split(os.Getenv("OPTOUT_LOGINS"), ",") {
		if x = strings.ToLower(strings.TrimSpace(x)); x != "" {
			optout = append(optout, x)
		}
	}
	return Settings{
		BaseURL: strings.TrimRight(env("BASE_URL", "https://localhost"), "/"),
		FTUID:   os.Getenv("FT_UID"), FTSecret: os.Getenv("FT_SECRET"),
		FTUID2: os.Getenv("FT_UID_2"), FTSecret2: os.Getenv("FT_SECRET_2"),
		FTUID3: os.Getenv("FT_UID_3"), FTSecret3: os.Getenv("FT_SECRET_3"),
		OAuthApp: num("OAUTH_APP", 1), SessionSecret: os.Getenv("SESSION_SECRET"),
		CooldownS: 3600, CacheS: 3600, SessionS: 604_800,
		ContactEmail: os.Getenv("CONTACT_EMAIL"), IssuesURL: os.Getenv("ISSUES_URL"), ControllerName: os.Getenv("CONTROLLER_NAME"),
		OptoutLogins: optout, ConsentLog: os.Getenv("CONSENT_LOG"), DevReport: os.Getenv("DEV_REPORT"), DevUID: num("DEV_UID", 0),
		OwnerLogin: os.Getenv("OWNER_LOGIN"), GithubToken: os.Getenv("GITHUB_TOKEN"), GithubRepo: os.Getenv("GITHUB_REPO"),
		GithubBranch: env("GITHUB_BRANCH", "main"), Addr: env("ADDR", ":8000"),
	}
}
