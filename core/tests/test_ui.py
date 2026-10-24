import re

from core42 import FRONTEND_DIR
from core42.ui import css_from_ui, load_ui, validate_ui

RUNTIME_VARS = {"--v", "--seats", "--cols", "--i"}  # set inline per cell or section by the dashboard's markup


def test_default_ui_is_valid():
    assert validate_ui(load_ui()) == []


def test_css_has_tokens_dark_block_and_panels():
    css = css_from_ui({"breakpoints": {"mobile": 0, "desktop": 960},
                       "tokens": {"light": {"ink": "#1e2430"}, "dark": {"ink": "#eef0f3"}},
                       "components": {"button": {"primary": {"height": "40px", "bg": "@ink", "desktop": {"height": "44px"}}}},
                       "panels": {"marks": {"mobile": {"span": 12}, "desktop": {"span": 6, "height": "280px"}}}})
    assert "--ink: #1e2430" in css and ':root[data-theme="dark"]' in css and "--ink: #eef0f3" in css
    assert "--c-button-primary-bg: var(--ink)" in css and "--c-button-primary-height: 40px" in css
    assert "@media (min-width: 960px)" in css and "--c-button-primary-height: 44px" in css
    assert '[data-panel="marks"]' in css and "grid-column: span 6" in css and "height: 280px" in css


def test_grouped_tokens_are_prefixed():
    css = css_from_ui({"breakpoints": {"mobile": 0}, "tokens": {"space": {"main-x": "48px"}, "type": {"display": '"Barlow", sans-serif'}},
                       "components": {}, "panels": {}})
    assert "--space-main-x: 48px" in css and '--type-display: "Barlow", sans-serif' in css


def test_invalid_values_are_reported():
    errs = validate_ui({"breakpoints": {"mobile": 0}, "tokens": {}, "components": {"button": {"primary": {"height": "tall", "bg": "@nope"}}},
                        "panels": {"x": {"mobile": {"span": 13}}, "y": {"huge": {"span": 2}}}})
    assert any("button.primary.height" in e for e in errs)
    assert any("button.primary.bg" in e and "@nope" in e for e in errs)
    assert any("x.mobile.span" in e for e in errs)
    assert any("y.huge" in e for e in errs)


STYLESHEETS = [FRONTEND_DIR / "controls.css", FRONTEND_DIR / "report.css",
               FRONTEND_DIR.parents[2] / "web" / "static" / "site.css"]


def test_component_css_uses_only_defined_variables():
    css = "".join(f.read_text() for f in STYLESHEETS if f.exists())
    defined = set(re.findall(r"(--[\w-]+):", css_from_ui(load_ui())))
    used = set(re.findall(r"var\((--[\w-]+)", css))
    assert used - RUNTIME_VARS <= defined, sorted(used - RUNTIME_VARS - defined)


def test_stylesheets_have_no_literal_colours():
    css = "".join(f.read_text() for f in STYLESHEETS if f.exists())
    assert not re.findall(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(", css)
