# ravazque.info

A self-hosted web app with statistics for **42 Madrid** students, built on the 42 API. Sign in with your 42 account
and see your own history in one place: logged hours and seats, every project and retry, exams, pace, every evaluation
given and received, the people you crossed paths with, your promo and the campus coalitions. Light and dark, English
and Spanish, in the 42 blue or your coalition colour.

An independent project: not made, run or endorsed by 42 or 42 Madrid. "42" and the 42 API belong to their owners.

The repository also holds a small static page (`site/`, deployed to GitHub Pages) that shows a CV and a public 42
snapshot published from the app.

## Features

Five pages; every choice (period, filters, views) lives in the URL:

- **Today** (home): only what changes day to day. The coalition logtime bonus (hours in the rolling seven days against
  50 h and 80 h, when each one is available again, the earliest logout that earns it, and the sessions about to leave
  the window), where you are sitting now, your last seven days hour by hour, your next evaluation, the projects you have
  open and this month. You (photo, login, level, coalition, wallet, points) live on the band, in your menu.
- **Projects**: level, pace and blackhole, skills (radar and bars, 42cursus or C Piscine), every project with filters,
  rank groups and CSV export, exams, technical domains, the attempt timeline, achievements, events, quests and titles.
- **Evaluations**: what you give back, received and given over time, marks, when (weekday × hour, duration, booking
  lead, per project), correction statistics, feedback, correction points, the full evaluation log with search.
- **People**: top correctors and everyone you crossed paths with, Connections as bubbles, your circle, teammates, the
  campus coalitions and your promo, and the points you gave your coalition.
- **Campus**: rhythm, the logtime bonus in detail with every bonus so far, the seat plan with every computer, hours per
  month, calendar, weekday × hour, sessions, where evaluations happen and your campuses.
- **Publish** (optional, one account only): commits a whitelisted snapshot of that account's profile to a GitHub Pages
  repository.

## Stack

| Directory | Contents |
|-----------|----------|
| `server/` | Go (standard library only): the 42 API client and extraction (`api42/`), the analysis, sign-in rules, rank groups, the logtime bonus and the look of every page (`core/`, with `ui.json`, the i18n texts, skills, tracks and RNCP data in `core/data/`), and the web server (`internal/`): sign-in, the JSON API, an in-process job queue, memory with expiry. One binary that embeds the browser app. No database |
| `web/` | The browser app: Vue 3 and TypeScript (Vite). Charts are its own SVG and HTML; Caddy (HTTPS) and Docker Compose files |
| `.v1_old/` | The first version (Python, FastAPI and htmx), archived as it was; not built or run |
| `site/` | Static CV page with the published 42 snapshot, deployed by `.github/workflows/pages.yml` |

## Running it

Requirements: Docker with the Compose plugin, `make`, `openssl` or `mkcert`. Go ≥ 1.27 and Node ≥ 26 for the tests and
the dev tools; Python 3 only to serve the site preview.

1. **Register the 42 applications** at https://profile.intra.42.fr/oauth/applications, scope `public`: one for `make dev`
   (`FT_UID_2`, redirect URI `https://localhost/auth/callback`) and one for production at https://ravazque.info
   (`FT_UID`, redirect URI `https://ravazque.info/auth/callback`). A third (`FT_UID_3`) only adds
   request budget and never signs anyone in.
2. **Configure**: `make` copies `.env.example` to `.env` on the first run. Fill the required values (see below) and adapt the
   privacy policy texts (`policy.*` in the i18n files) to your deployment.
3. **Certificates**: `make certs` creates `web/certs/`. With `mkcert` they are trusted at once; with `openssl`, import
   `web/certs/ca.pem` as a trusted authority. Without certificates Caddy uses its internal CA.
4. **Start**: `make dev` and open https://localhost.
5. **Production** (optional): the domain's DNS lives in Cloudflare. In Zero Trust → Networks → Tunnels create a
   tunnel (connector: Docker), copy its token to `TUNNEL_TOKEN` in `.env` and give it the public hostname
   `ravazque.info` → service `http://caddy:8080`. Then `make production`.

### Configuration

Everything lives in one `.env` (mode `600`, never committed), read by Docker Compose.

| Variable | Required | Purpose |
|----------|----------|---------|
| `FT_UID`, `FT_SECRET` | yes | 42 app that signs users in to production (`make production`) |
| `FT_UID_2`, `FT_SECRET_2` | for `make dev` | 42 app that signs users in to `make dev` |
| `FT_UID_3`, `FT_SECRET_3` | no | 42 app that never signs anyone in; app-token requests are spread over all three |
| `SESSION_SECRET` | yes | ≥ 32 characters (`openssl rand -hex 32`); keys session HMACs |
| `CONTROLLER_NAME` | yes | Data controller named by the privacy policy |
| `CONTACT_EMAIL` | yes | Contact for privacy requests, shown on the About and Privacy pages |
| `OPTOUT_LOGINS` | no | Comma-separated logins of students who asked to be excluded: shown as "Hidden" everywhere |
| `ISSUES_URL` | no | "Report an issue" link on every page, e.g. `https://github.com/<owner>/<repo>/issues/new/choose` |
| `TUNNEL_TOKEN` | for `make production` | Token of the Cloudflare tunnel that serves https://ravazque.info |
| `DEV_UID` | no | Local only: whose report `make build` saves and `make dev` serves (refused outside `https://localhost`) |
| `OWNER_LOGIN`, `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH` | no | Publishing; the button stays hidden unless `OWNER_LOGIN` and `GITHUB_TOKEN` are set |

### Commands

| Command | Action |
|---------|--------|
| `make` | List the commands |
| `make dev` / `make dev-down` / `make dev-fclean` / `make dev-logs` | Build and start at https://localhost (runs `make build` first when there is no saved report) with the last saved report (`Dev · <login>` on the landing signs in without 42) and three synthetic test profiles (`Test · …`: a new student, one halfway through the Common Core, an alumni; invented, moved to today's date, never real people, never able to publish); a change to the code needs `make dev` again; its own compose project, so it runs beside production / stop it / also delete its image, volumes and saved reports / its logs |
| `make build` | Build dev's image, refresh the saved report of `DEV_UID` (~120 requests, about 40 s with three apps) and the synthetic test profiles |
| `make production` / `make prod-down` | Build and start production at https://ravazque.info through the Cloudflare tunnel (`make production` too) / stop it and the tunnel (memory is cleared; browsers keep their reports; its volumes, the consent log among them, stay) |
| `make down` | Stop both |
| `make logs`, `make ps` | Follow production's logs / list the services of both |
| `make test` | Go tests (server), type check and tests of the browser app (web) and the site's scripts |
| `make preview UID=…` | Save a real extraction to `web/preview/data.json` (about 120 requests) |
| `make snapshot` | Write `site/data/42.json` from the preview data |
| `make site` | Stage `site/` into `site/_build` and serve it at http://localhost:8080 |
| `make certs` | Create the HTTPS certificates |
| `make clean` / `make fclean` / `make re` | `dev-down` + generated files / `clean` + `dev-fclean` / `fclean` + `dev`. None of them touches production: only `make production`, `make prod-down` and `make logs` do |

## Behaviour

- **Access**: students, transcenders and alumni whose primary campus is 42 Madrid. Staff, pisciners, blackholed and
  frozen accounts get a refusal page with the reason. Access is re-checked on every extraction.
- **42 API budget**: 2 requests/s and 1200/h per application, shared by every user. A second and a third app
  (`FT_UID_2`/`FT_SECRET_2`, `FT_UID_3`/`FT_SECRET_3`) are optional: app-token requests are spread over all of them, each
  within its own limits. Production signs in with the first and `make dev` with the second; dev and production each
  keep their own limiter, so running extractions in both at once can go over an app's 2 requests/s (retried). One extraction per user per hour (119 requests in 39 s
  measured with three apps, its independent
  lists fetched together), run inside the web process, one at a time, with a progress bar. When the hourly budget runs low, the job
  waits for the next hour. Every extraction logs its request count.
- **Extras and their cost**: teammates, exams, pace, evaluations in depth and campus history reuse downloaded data
  (0 requests); feedback details ~5, promo 2–3, coalitions 1, the network of the 30 closest contacts 30, the other
  side's seat in the evaluations of the last 60 days one per day with evaluations (~25; only the seat is kept).

## Privacy and security

- **No database.** Sessions, report copies, cooldowns and rate limits live in the web process's memory (one process,
  `server/internal/app/memory.go`) and vanish on restart. The browser holds only a random id in a `__Host-` cookie (`Secure`,
  `HttpOnly`, `SameSite=Lax`); state-changing requests carry a CSRF token.
- The user's 42 token is used once to identify them and then discarded. API tokens never reach the browser.
- **The report lives in the user's browser** (IndexedDB). The server keeps a copy in memory for an hour after its last
  use to render pages; when it is gone, the page hands the browser's copy back, accepted only with the server's own
  HMAC signature for that user, so nobody can upload a forged or someone else's report. Signing out removes the
  browser's copy. About other students only login, name and rank group; received evaluations keep only the user's own
  feedback.
- The only file written is the consent log (`CONSENT_LOG`, in the `consent` volume): a keyed hash of the 42 id, the
  policy version and the date, pruned after two years.
- *Delete my data* removes the server's copy, cancels a pending extraction and sends `Clear-Site-Data: "storage"`. The
  hourly limit survives as an anonymous HMAC so deleting cannot bypass it.
- Sign-in callbacks are rate-limited per address; avatars are fetched only from the intra CDN; Caddy sends HSTS, a
  strict CSP (`script-src 'self'`, no frames), `nosniff` and `same-origin` referrer headers.
- The published snapshot (`server/internal/web/publish.go`) is a field-by-field whitelist: never contact data, seats, logged hours,
  ids, tokens, photos or anything about other students.

Signing in requires accepting the privacy policy; the acceptance is recorded as a keyed hash of the 42 id, the policy
version and the date for two years, and a new version asks everyone to accept it again (`server/internal/app/consent.go`).

Report vulnerabilities privately through GitHub Security Advisories on this repository, not in public issues.

## Customising

- `server/core/data/ui.json`: colours (light and dark), type, spacing, breakpoints and panel layout for every page,
  served as `/ui.css` (built into the binary: restart after a change). `"@name"` references another token.
- `server/core/data/i18n/{en,es}.json`: every text; both files must have the same keys, and every key the app uses must
  exist (enforced by tests).
- `server/core/data/skills.json`, `server/core/data/tracks.json`: skill order per cursus and Common Core rank of each project.
- `server/core/data/rncp.json`: the projects behind each RNCP tag, as the intra lists them (the technical areas).
- Accent: 42 blue `#00BABC` by default, coalition colour on request, contrast-adjusted for both themes.

## Publishing to GitHub Pages

1. Fine-grained token at https://github.com/settings/personal-access-tokens: access to the Pages repository only,
   permission **Contents: Read and write**. Set `GITHUB_TOKEN`, `GITHUB_REPO` and `OWNER_LOGIN` in `.env`.
2. Repository settings → **Pages → Source: GitHub Actions**, so only `site/` is deployed.
3. The button commits `site/data/42.json` to `GITHUB_BRANCH`: `git pull --rebase` before pushing local work.

`site/cv.json` is edited by hand (EN/ES) and is public.

## Tests

`make test`. Go next to its code in `server/` (the analysis and the extraction are checked against golden files that
the first version produced from the same anonymised and synthetic data, key order included); the browser app's tests
in `web/src/` (Vitest); the site's in `site/tests/` (`node --test`). Fixtures are anonymised or synthetic.

## License

[AGPL-3.0](LICENSE). Running a modified version as a network service requires offering its source to its users.
