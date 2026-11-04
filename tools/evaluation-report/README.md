# Evaluation report

A local tool that writes the evaluation history of one 42 student as a single HTML page: for a review, for a report,
or to print. It is not part of the deployed app. It is kept here as a first version of something the web app could
offer later (see [Future integration with the web](#future-integration-with-the-web)).

## Run it

```sh
make eval-report
# or
python3 tools/evaluation-report/evaluation_report.py
```

It asks for the login, extracts it and prints where the page is: `tools/evaluation-report/out/<login>.html`.

| Option | What it does |
|--------|--------------|
| `--fresh` | Extract again even if the saved extraction is under an hour old |
| `--report FILE` | Render a saved report: no prompt, no API. Seats that were not looked up show "Sin datos" |
| `--out FILE` | Write the page there instead |

To try it without touching the API, render a synthetic profile (`make dev-build` creates them):
`python3 tools/evaluation-report/evaluation_report.py --report web/preview/test-outer.json --out /tmp/report.html`.

Requirements: Python 3.12 or newer (standard library only), Go (the extraction is the server's own,
`server/cmd/devtools`) and `FT_UID` and `FT_SECRET` in the root `.env`, which also holds `OPTOUT_LOGINS` (see
[Privacy](#privacy)).

## What the page shows

- **Perfil**: level, place in the promo, validated projects, exams, evaluations received and given, logged time,
  coalition.
- **Todos los proyectos**: every project by milestone, with its state, mark, attempts, evaluations and days.
- **Evaluaciones en detalle**: figures and a timeline with one row per attempt, from registering to handing in, and a
  mark per evaluation.
- **Intento a intento**: a sheet per project. Each attempt has its dates with the time between them and its teammates;
  each evaluation has its corrector, start, booking, lead time, time since handing in, duration against the planned
  one, mark and flag, both seats and the comments.
- **Correctores**: who corrected these evaluations, how many times, in which projects.

The details cover Milestone 6 (but its exam), Outer Core and the Common Core projects handed in again from there, which
`HANDED_IN_AGAIN` names at the top of `evaluation_report.py` (miniRT, Born2beroot). Which milestone a project belongs to
comes from `server/core/data/tracks.json`, as in the web app.

Every table fits the window from 320 px up: wide tables stack into labelled rows instead of scrolling sideways. The page
follows the system's light or dark theme, takes its colours from `server/core/data/ui.json` and prints on A4 landscape.
Its text is in Spanish only for now.

## How to read the data

Some values are inferences, and the page says so next to them:

- **Handing in** is the team's `closed_at`: the API has no such field.
- **Duration** runs from the start to when the form was filled in, so it drifts if the form was filled in late or early.
- **Seats** are the computer with the most login time during the evaluation. The API does not say where an evaluation
  took place, so both seats are shown. "No logeado" means no session in that time; "Sin datos" means it could not be
  looked up, or that the student is hidden.

## Cost on the 42 API

The budget is shared (see the main README). Measured on 2026-11-04:

- one extraction is about 130 requests (128 in 40 s). It is reused for an hour, as the app does;
- the extraction looks up the other side's seat for the last 60 days only. Older evaluations cost one more request
  each, once: the answers are saved next to the extraction.

## Privacy

The page and `data/` hold other students' names, comments and seats.

- Extract your own login, or another student's with their consent. The tool asks for a login because the API allows it,
  not because the data is free to take.
- `data/` and `out/` are git-ignored, CI fails if anything in them is ever tracked, and the files are private (mode 600).
- Never publish a page or commit an extraction. Delete both folders when you are done with them.
- Accounts the app refuses (staff, pisciners, blackholed, frozen) are refused here too: the extraction applies the same
  rules.
- Students in `OPTOUT_LOGINS` (root `.env`) appear as "Hidden", with no name or seat, as in the app. Their sessions are
  never looked up, and the saved extraction and seats stop naming them on the next run. A page written before they
  opted out keeps what it had: write it again or delete it.
- The site's privacy policy covers what the site does, not this tool, which also reads correctors' seats further back
  than the site's 60 days. Whoever runs it answers for that data, including the correctors', who were not asked.

## Tests

`python3 tools/evaluation-report/test_evaluation_report.py`, also part of `make test` and CI. The fixtures are synthetic.

## Future integration with the web

The tool already reads the report the app produces, so most of the work is presentation:

1. **Data**: `periods.all.projects` and `periods.all.received` are what `/api/me/view` serves. The app already has
   everything but the older seats.
2. **Page**: `render()` becomes a section in `web/src/views/` (the attempts timeline and the sheets are new; the profile
   and the project list exist there already), with its text in `server/core/data/i18n/{en,es}.json`.
3. **Older seats**: `corrector_seats()` is the rule. On the server it would go in `api42/extract.go` with a limit, since
   each evaluation older than `SeatDays` costs one request of the shared budget. The privacy policy promises the last
   60 days only, so it would have to change first.
4. **Access**: on the web a student only ever sees their own report, so the login prompt goes away and the consent and
   access rules of the app apply. Corrector seats and comments stay within the signed-in user's own view.
5. **Print**: the print styles at the end of `CSS` can move to the app as they are.
