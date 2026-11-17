# ravazque.github.io

The public CV of Raúl Vázquez Pérez (ravazque), a software developer trained at **42 Madrid Fundación Telefónica**,
and a page with his 42 progress. Two static pages, in English and Spanish, light and dark, served by GitHub Pages.

- **https://ravazque.github.io**: the CV. Experience, selected projects, education, languages and stack, with a paper
  look of its own (serif titles, quiet rules, a warm dark mode).
- **https://ravazque.github.io/ravazque/**: 42 progress. Level, stage, coalition, projects in progress, skills,
  projects and evaluations, in the look of [ravazque.info](https://github.com/ravazque/ravazque.info), the web app
  that publishes its data.

An independent project: not made, run or endorsed by 42 or 42 Madrid Fundación Telefónica.

The other paths under ravazque.github.io (`/NASA-Space-APPs-Challenge_2025/`, `/NASA-Space-APPs-Challenge_2026/`) are
the Pages of those repositories, served from them. Never create a folder here with a repository's name: it would hide
that repository's page.

## How it works

The CV is written by hand in `cv.json`. The 42 page reads `data/42.json`, a snapshot that the **Publish** button of
ravazque.info commits to this repository through the GitHub API. The snapshot is a field-by-field whitelist chosen in
ravazque.info: level, cursus stage, validated projects, evaluation counts, coalition and top skills. It never holds
contact data, seats, logged hours, ids, tokens, photos or anything about other students.

`site.js` draws both pages in the browser: `cv.json` on the first, `data/42.json` on the second (`body[data-page]`).
It follows the browser's language and theme, and remembers the visitor's choice.

| File | What it is |
|------|------------|
| `index.html` | The CV (`<html data-look="paper">` turns on its own look) |
| `ravazque/index.html` | The 42 page (`<base href="../">`, so it shares every file with the CV) |
| `site.css`, `site.js` | Styles and rendering of both pages |
| `cv.json` | The CV text, edited by hand, EN and ES. Public: no phone number, private email or address |
| `data/42.json` | The 42 snapshot, written by ravazque.info. Don't edit it by hand |
| `ui.css`, `shared/fonts.css` | ravazque.info's colours, type and sizes, written there by `make site-sync`. Don't edit them by hand |
| `shared/` | Fonts, the accent colour (`accent.js`), the custom controls, the skills radar and the projects filters |
| `build.sh` | Copies what is published into one folder |
| `tests/` | Tests of the scripts (not published) |

## Run it locally

You need `sh`, Python 3 and Node.js (for the tests only).

```sh
sh build.sh _site
python3 -m http.server --bind 127.0.0.1 --directory _site 8080   # http://localhost:8080
node --test tests/*.test.mjs
```

## Deploy

Every push to `main` runs `.github/workflows/pages.yml`: the tests, then `build.sh`, then the deploy to GitHub Pages.
Pull requests run the tests only. In Settings → Pages, **Source** must be **GitHub Actions**, so that only what
`build.sh` copies is published.

The Publish button also pushes to `main`: run `git pull --rebase` before pushing local work.

## Keeping it in step with ravazque.info

- When ravazque.info's look changes (`server/core/data/ui.json`), run `make site-sync` there: it writes `ui.css` and
  `shared/fonts.css` into this repository's checkout (by default `../ravazque.github.io`). Commit them here.
- `accent.js` and the custom controls in `shared/` are adapted copies of ravazque.info's `web/src/legacy/`: change
  both by hand.

## License

[AGPL-3.0](LICENSE).
