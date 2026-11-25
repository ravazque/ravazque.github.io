# ravazque.github.io

The public CV of Raúl Vázquez Pérez (ravazque), a software developer trained at **42 Madrid Fundación Telefónica**,
and a page with his 42 progress. Two static pages, in English and Spanish, light and dark, served by GitHub Pages.

- **https://ravazque.github.io**: the CV. Experience, selected projects, education, languages and stack, with a paper
  look of its own: always light, serif titles, quiet rules and its own icon. On phones the band of links, the name and
  the headline each keep to one line, scaled to fit, and every entry shows its title above its details.
- **https://ravazque.github.io/ravazque/**: 42 progress. Level, stage, coalition, projects in progress, skills,
  projects and evaluations, in the look of [ravazque.info](https://github.com/ravazque/ravazque.info), the web app
  that publishes its data.

An independent project: not made, run or endorsed by 42 or 42 Madrid Fundación Telefónica.

The other paths under ravazque.github.io (`/NASA-Space-APPs-Challenge_2025/`, `/NASA-Space-APPs-Challenge_2026/`) are
the Pages of those repositories, served from them. `/NASA-2025/` and `/NASA-2026/` are short links to them, served from
here: they redirect and keep the query (`?lang=es`, `?sim=storm_eva`). Never create a folder here with a repository's
name: it would hide that repository's page.

## How it works

The CV is written by hand in `cv.json`. The 42 page reads `data/42.json`, a snapshot that the **Publish** button of
ravazque.info commits to this repository through the GitHub API. The snapshot is a field-by-field whitelist chosen in
ravazque.info: level, cursus stage, validated projects, evaluation counts, coalition and top skills. It never holds
contact data, seats, logged hours, ids, tokens, photos or anything about other students.

`assets/site.js` draws both pages in the browser: `cv.json` on the first, `data/42.json` on the second (`body[data-page]`).
It follows the browser's language and remembers the visitor's choice. The CV is always light; the 42 page follows the
system's theme until the visitor picks one (kept as `theme-42`). On both pages, "ravazque" and "Raúl" written as words
link to the CV.

The CV's titles use the system's serif, whose width changes from device to device, so `site.js` measures the name and the
headline and shrinks their font until each fits on one line. The band's buttons use the shared webfont, the same width
everywhere, so plain CSS scales them.

| File | What it is |
|------|------------|
| `index.html`, `assets/cv-icon.svg` | The CV (`<html data-look="paper" data-theme="light">` turns on its own look) and its icon |
| `ravazque/index.html`, `assets/status-icon.svg` | The 42 page (`<base href="../">`, so it shares every file with the CV) and its icon |
| `assets/site.css`, `assets/site.js` | Styles and rendering of both pages |
| `cv.json` | The CV text, edited by hand, EN and ES. Public: no phone number, private email or address |
| `data/42.json` | The 42 snapshot, written by ravazque.info. Don't edit or move it |
| `ui.css`, `shared/fonts.css` | ravazque.info's colours, type and sizes, written there by `make site-sync`. Don't edit or move them |
| `shared/` | Fonts, the accent colour (`accent.js`), the custom controls, the skills radar and the projects filters |
| `NASA-2025/`, `NASA-2026/` | Short links that redirect to the Pages of the NASA Space Apps repositories |
| `build.sh` | Copies what is published into one folder, with the same layout |
| `tests/` | Tests of the scripts (not published) |
| `Makefile`, `tools/preview.py` | One-file previews of both pages, see [Preview](#preview) (not published) |
| `tools/template-cv.json`, `tools/template-42.json` | Example data in the shape of `cv.json` and `data/42.json`, for the previews |

## Run it locally

You need `sh`, `make`, Python 3 and Node.js (for the tests only).

```sh
sh build.sh _site
python3 -m http.server --bind 127.0.0.1 --directory _site 8080   # http://localhost:8080
node --test tests/*.test.mjs
```

## Preview

To see a change before pushing it, without a server:

```sh
make preview            # preview/cv.html and preview/42.html, with cv.json and data/42.json
make preview-template   # preview/template/cv.html and 42.html, with the example data in tools/
make clean              # removes preview/
```

Each preview is a single HTML file that opens with a double click: `tools/preview.py` inlines the page's styles, fonts,
scripts, icon and data, and hands `site.js` the data in place of the network. The two previews link to each other.
`make preview` falls back to the example data for any data file that is missing. `preview/` is ignored by git, and
`build.sh` doesn't publish `tools/` or the `Makefile`.

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

[AGPL-3.0](LICENSE). If you run a modified version as a network service, you must offer its source to its users.
