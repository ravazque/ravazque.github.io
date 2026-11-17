# ravazque.github.io

The owner's public CV (https://ravazque.github.io) and a 42 snapshot page (https://ravazque.github.io/ravazque/), in
the same visual world as [ravazque.info](https://github.com/ravazque/ravazque.info). The other paths under
ravazque.github.io (`/NASA-Space-APPs-Challenge_2025/`, `/NASA-Space-APPs-Challenge_2026/`) are those repositories' own
Pages, served from their repositories: never create a folder here with a repository's name.

| File | What it is |
|------|------------|
| `index.html`, `ravazque/index.html`, `site.css`, `site.js` | The CV and the 42 page (`<base href="../">`, so it shares every file); `site.js` renders `cv.json` on the first and `data/42.json` on the second (`body[data-page]`), follows the browser language (EN/ES) and theme |
| `cv.json` | The CV text, edited by hand. Public: no phone number or private email |
| `data/42.json` | The 42 snapshot. Committed by ravazque.info's *Publish* button (or its `make snapshot` locally); don't edit by hand |
| `ui.css`, `shared/fonts.css` | ravazque.info's look, written there by `make site-sync`; don't edit by hand |
| `shared/` | Fonts, `accent.js`, the custom controls, the skills radar and the projects filters (`accent.js` and the controls are kept in step by hand with ravazque.info's `web/src/legacy/`) |
| `build.sh` | Stages the published folder |
| `tests/` | `node --test tests/*.test.mjs` (not published) |

Local preview: `sh build.sh _site && python3 -m http.server --bind 127.0.0.1 --directory _site 8080`, then
http://localhost:8080. On every push to `main`, `.github/workflows/pages.yml` runs the tests, stages the site and
deploys it (Settings → Pages → Source: GitHub Actions).

Since the publish button commits `data/42.json` to `main`, run `git pull --rebase` before pushing local work.
