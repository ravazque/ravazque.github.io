# ravazque.info

A self-hosted web app with statistics for **42 Madrid** students, built on the 42 API. Sign in with your 42 account
and see your own history in one place: logged hours and seats, every project and retry, exams, pace, every evaluation
given and received, the people you crossed paths with, your promo and the campus coalitions. Light and dark, English
and Spanish, in the 42 blue or your coalition colour.

An independent project: not made, run or endorsed by 42 or 42 Madrid. "42" and the 42 API belong to their owners.

The repository also holds a small static page (`site/`, deployed to GitHub Pages) that shows a CV and a public 42
snapshot published from the app.

## Features

Five pages, rendered on the server; every choice (period, filters, views) lives in the URL:

- **Home**: key numbers, pace and blackhole, skills (radar or bars, 42cursus or C Piscine), coalitions and promo,
  achievements, events, quests and titles.
- **Projects**: every project with filters, rank groups and CSV export, the attempt timeline, cumulative retries, exams.
- **Evaluations**: received and given over time, marks, when (weekday × hour, duration, booking lead, per project),
  correction statistics, feedback, correction points, the full evaluation log with search.
- **People**: top correctors and everyone you crossed paths with, Connections as bubbles or as your circle, teammates.
- **Campus**: seat plan with every computer, hours per month, calendar, weekday × hour, sessions, where evaluations happen.
- **Astra Victoris**: the six goals of 42 Madrid's distinction in hexagons. RNCP 6 and 7 are checked against
  `core/core42/rncp.json` (both options, with the projects behind each requirement) and The Gatekeeper against the
  evaluations and hours; the goals the API cannot tell are marked by the student and kept only in the browser.
- **Publish** (optional, one account only): commits a whitelisted snapshot of that account's profile to a GitHub Pages
  repository.

## Stack

| Directory | Contents |
|-----------|----------|
| `web/` | FastAPI app rendering every page with Jinja (htmx for partial updates, a small `dash.js` for tooltips and sorting), an in-process job queue, Caddy (HTTPS), in Docker Compose. No database |
| `core/` | `core42`: 42 API analysis, sign-in rules, rank groups and the shared frontend assets (CSS, `ui.json`, i18n, controls, accent, radar) |
| `site/` | Static CV page with the published 42 snapshot, deployed by `.github/workflows/pages.yml` |

## Running it

Requirements: Docker with the Compose plugin, `make`, `openssl` or `mkcert`. Node ≥ 22 and Python 3 for the tests and
the site preview.

1. **Register a 42 application** at https://profile.intra.42.fr/oauth/applications:
   redirect URI `https://localhost/auth/callback`, website `https://localhost`, scope `public`.
2. **Configure**: `make` copies `.env.example` to `.env` on the first run. Fill the required values (see below) and adapt the
   privacy policy texts (`policy.*` in the i18n files) to your deployment.
3. **Certificates**: `make certs` creates `web/certs/`. With `mkcert` they are trusted at once; with `openssl`, import
   `web/certs/ca.pem` as a trusted authority. Without certificates Caddy uses its internal CA.
4. **Start**: `make dev` and open https://localhost.

### Configuration

Everything lives in one `.env` (mode `600`, never committed), read by Docker Compose.

| Variable | Required | Purpose |
|----------|----------|---------|
| `FT_UID`, `FT_SECRET` | yes | 42 application credentials |
| `SESSION_SECRET` | yes | ≥ 32 characters (`openssl rand -hex 32`); keys session HMACs |
| `CONTROLLER_NAME` | yes | Data controller named by the privacy policy |
| `CONTACT_EMAIL` | yes | Contact for privacy requests, shown on the About and Privacy pages |
| `OPTOUT_LOGINS` | no | Comma-separated logins of students who asked to be excluded: shown as "Hidden" everywhere |
| `ISSUES_URL` | no | "Report an issue" link on every page, e.g. `https://github.com/<owner>/<repo>/issues/new/choose` |
| `BASE_URL` | no | Public address, default `https://localhost` |
| `DEV_UID` | no | Local only: whose report `make build` saves and `make dev` serves (refused outside `https://localhost`) |
| `OWNER_LOGIN`, `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH` | no | Publishing; the button stays hidden unless `OWNER_LOGIN` and `GITHUB_TOKEN` are set |

### Commands

| Command | Action |
|---------|--------|
| `make` | List the commands |
| `make dev` | Start at https://localhost at once with the last saved report (`Dev · <login>` on the landing signs in without 42); live reload |
| `make build` | Build the images and refresh the saved report of `DEV_UID` (a real extraction, ~135 requests, ~3 min) |
| `make up` / `make down` | Start as built / stop (memory is cleared; browsers keep their reports) |
| `make logs`, `make ps` | Follow logs / list services |
| `make test` | Python tests (web, core) in the image and JS tests (web, core, site) with local Node |
| `make preview UID=…` | Save a real extraction to `web/preview/data.json` (about 135 requests) |
| `make snapshot` | Write `site/data/42.json` from the preview data |
| `make site` | Stage `site/` into `site/_build` and serve it at http://localhost:8080 |
| `make certs` | Create the HTTPS certificates |
| `make clean` / `make fclean` / `make re` | Remove generated files / also images and volumes / `fclean` + `dev` |

## Behaviour

- **Access**: students, transcenders and alumni whose primary campus is 42 Madrid. Staff, pisciners, blackholed and
  frozen accounts get a refusal page with the reason. Access is re-checked on every extraction.
- **42 API budget**: 2 requests/s and 1200/h per application, shared by every user. One extraction per user per hour
  (about 135 requests, 3 minutes, measured), run inside the web process, one at a time, with a progress bar. When the hourly budget runs low, the job
  waits for the next hour. Every extraction logs its request count.
- **Extras and their cost**: teammates, exams, pace, evaluations in depth and campus history reuse downloaded data
  (0 requests); feedback details ~5, promo 2–3, coalitions 1, the network of the 30 closest contacts 30.

## Privacy and security

- **No database.** Sessions, report copies, cooldowns and rate limits live in the web process's memory (one process,
  `web/app/memory.py`) and vanish on restart. The browser holds only a random id in a `__Host-` cookie (`Secure`,
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
- The published snapshot (`web/app/publish.py`) is a field-by-field whitelist: never contact data, seats, logged hours,
  ids, tokens, photos or anything about other students.

Signing in requires accepting the privacy policy; the acceptance is recorded as a keyed hash of the 42 id, the policy
version and the date for two years, and a new version asks everyone to accept it again (`web/app/consent.py`).

Report vulnerabilities privately through GitHub Security Advisories on this repository, not in public issues.

## Customising

- `core/core42/frontend/ui.json`: colours (light and dark), type, spacing, breakpoints and panel layout for every page,
  served as `/ui.css` and reloaded on change. `"@name"` references another token.
- `core/core42/frontend/i18n/{en,es}.json`: every text; both files must have the same keys (enforced by a test).
- `core/core42/skills.json`, `core/core42/tracks.json`: skill order per cursus and Common Core rank of each project.
- `core/core42/rncp.json`: RNCP 6 and 7 requirements and the projects behind each tag, as the intra lists them.
- Accent: 42 blue `#00BABC` by default, coalition colour on request, contrast-adjusted for both themes.

## Publishing to GitHub Pages

1. Fine-grained token at https://github.com/settings/personal-access-tokens: access to the Pages repository only,
   permission **Contents: Read and write**. Set `GITHUB_TOKEN`, `GITHUB_REPO` and `OWNER_LOGIN` in `.env`.
2. Repository settings → **Pages → Source: GitHub Actions**, so only `site/` is deployed.
3. The button commits `site/data/42.json` to `GITHUB_BRANCH`: `git pull --rebase` before pushing local work.

`site/cv.json` is edited by hand (EN/ES) and is public.

## Tests

`make test`. Python in `web/tests/` and `core/tests/`; JS in `web/tests/js/`, `core/tests/js/` and `site/tests/`
(`node --test`). Fixtures are anonymised.

## License

[AGPL-3.0](LICENSE). Running a modified version as a network service requires offering its source to its users.
