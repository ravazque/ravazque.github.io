# site · ravazque.github.io

A one-page CV plus a 42 snapshot, in the same visual world as ravazque.top.

| File | What it is |
|------|------------|
| `index.html`, `site.css`, `site.js` | The page; `site.js` renders `cv.json` and `data/42.json`, follows the browser language (EN/ES) and theme |
| `cv.json` | The CV text, edited by hand. Public: no phone number or private email |
| `data/42.json` | The 42 snapshot. Written by the web app's *Publish* button (or `make snapshot` locally); don't edit by hand |
| `build.sh` | Stages the published folder: these files plus fonts, `ui.css` (from `core/core42/frontend/ui.json`) and `accent.js` from `core/` |
| `tests/` | `node --test site/tests/*.test.mjs` (not published) |

`make site` builds into `site/_build` and serves it at http://localhost:8080. On push to `main`,
`.github/workflows/pages.yml` runs the tests, stages the site and deploys it.
