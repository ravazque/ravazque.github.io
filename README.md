# site · ravazque.github.io

A one-page CV (`/`) and a 42 snapshot page (`/ravazque/`), in the same visual world as ravazque.info. The other
paths under ravazque.github.io (`/NASA-Space-APPs-Challenge_2025/`, `_2026/`) are those repositories' own Pages:
never create a folder here with a repository's name.

| File | What it is |
|------|------------|
| `index.html`, `ravazque/index.html`, `site.css`, `site.js` | The CV and the 42 page (`<base href="../">`, so it shares every file); `site.js` renders `cv.json` on the first and `data/42.json` on the second (`body[data-page]`), follows the browser language (EN/ES) and theme |
| `cv.json` | The CV text, edited by hand. Public: no phone number or private email |
| `data/42.json` | The 42 snapshot. Written by the web app's *Publish* button (or `make snapshot` locally); don't edit by hand |
| `build.sh` | Stages the published folder: these files plus fonts, `ui.css` (from `core/core42/frontend/ui.json`) and `accent.js` from `core/` |
| `tests/` | `node --test site/tests/*.test.mjs` (not published) |

`make site` builds into `site/_build` and serves it at http://localhost:8080. On push to `main`,
`.github/workflows/pages.yml` runs the tests, stages the site and deploys it.
