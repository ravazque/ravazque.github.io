"""ui.json → CSS. ui.json is the one file that decides colours, sizes and placement of the report pages.

Generated variables:
  tokens.light / tokens.dark          --<name>          colours; dark ones under prefers-color-scheme and [data-theme=dark]
  tokens.<group>.<name>               --<group>-<name>  type, space, radius, motion
  components.<c>[.<variant>].<name>   --c-<c>[-<variant>]-<name>
A value "@name" refers to another variable: var(--name).
Inside a component, an object keyed by a breakpoint name overrides its values from that width up.
Keys starting with "_" are notes and are ignored.
"""
import json
import re
from pathlib import Path

from core42 import FRONTEND_DIR

UI_FILE = FRONTEND_DIR / "ui.json"
COLOUR_GROUPS = ("light", "dark")
LENGTH = re.compile(r"^-?(\d+(\.\d+)?|\.\d+)(px|rem|em|vh|vw|%|ch|fr)$|^0$")
NUMBER = re.compile(r"^-?(\d+(\.\d+)?|\.\d+)$")
COLOUR = re.compile(r"^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent|currentColor)$")
DURATION = re.compile(r"^(\d+(\.\d+)?|\.\d+)(ms|s)$")
EASING = re.compile(r"^(cubic-bezier\([\d\s.,-]+\)|ease|ease-in|ease-out|ease-in-out|linear)$")
KEYWORDS = {"none", "auto", "uppercase", "normal", "bold"}
PLACES = {"side": {"left", "right"}, "position": {"top", "bottom"}}
FREE_TEXT = ("shadow", "font")  # keys whose values are CSS shorthands or font stacks


def load_ui(path: Path = UI_FILE) -> dict:
    return json.loads(Path(path).read_text())


def _flatten(node: dict, breakpoints: set, var: str = "", path: str = "", bp: str | None = None):
    """Yield (breakpoint or None, var suffix, dotted path, leaf key, value) for one component tree."""
    for key, value in node.items():
        if key.startswith("_"):
            continue
        if isinstance(value, dict) and key in breakpoints:
            yield from _flatten(value, breakpoints, var, f"{path}{key}.", key)
        elif isinstance(value, dict):
            yield from _flatten(value, breakpoints, f"{var}{key}-", f"{path}{key}.", bp)
        else:
            yield bp, f"{var}{key}", f"{path}{key}", key, value


def _value(v) -> str:
    v = str(v)
    return f"var(--{v[1:]})" if v.startswith("@") else v


def _decls(pairs) -> str:
    return " ".join(f"{k}: {v};" for k, v in pairs)


def _variables(config: dict):
    """(light, dark, base, per_breakpoint) variable maps."""
    names = set(config.get("breakpoints", {}))
    widths = config.get("breakpoints", {})
    tokens = config.get("tokens", {})
    light = {f"--{k}": _value(v) for k, v in tokens.get("light", {}).items() if not k.startswith("_")}
    dark = {f"--{k}": _value(v) for k, v in tokens.get("dark", {}).items() if not k.startswith("_")}
    base = dict(light)
    for group, values in tokens.items():
        if group.startswith("_") or group in COLOUR_GROUPS:
            continue
        base.update({f"--{group}-{k}": _value(v) for k, v in values.items() if not k.startswith("_")})
    per_bp = {}
    for comp, tree in config.get("components", {}).items():
        if comp.startswith("_"):
            continue
        for bp, suffix, _, _, v in _flatten(tree, names):
            target = per_bp.setdefault(bp, {}) if bp and widths.get(bp, 0) > 0 else base
            target[f"--c-{comp}-{suffix}"] = _value(v)
    return light, dark, base, per_bp


def _panel_rules(panel: str, p: dict) -> list[str]:
    sel = f'[data-panel="{panel}"]'
    rules = []
    grid = []
    if "span" in p:
        grid.append(("grid-column", f"span {p['span']}"))
    if "order" in p:
        grid.append(("order", p["order"]))
    if grid:
        rules.append(f"{sel} {{ {_decls(grid)} }}")
    if "height" in p:
        rules.append(f"{sel} .plot {{ height: {p['height']}; }}")
    if "hidden" in p:
        rules.append(f"{sel} {{ display: {'none' if p['hidden'] else 'block'}; }}")
    return rules


def css_from_ui(config: dict) -> str:
    breakpoints = config.get("breakpoints", {})
    components = config.get("components", {})
    _, dark, base, per_bp = _variables(config)

    out = [f":root {{ color-scheme: light; {_decls(base.items())} }}"]
    if dark:
        out.append(f'@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ color-scheme: dark; {_decls(dark.items())} }} }}')
        out.append(f':root[data-theme="dark"] {{ color-scheme: dark; {_decls(dark.items())} }}')

    rules = {}
    for panel, per in config.get("panels", {}).items():
        if not panel.startswith("_"):
            for bp, p in per.items():
                rules.setdefault(bp, []).extend(_panel_rules(panel, p))
    for bp, width in sorted(breakpoints.items(), key=lambda kv: kv[1]):
        block = []
        if width > 0 and per_bp.get(bp):
            block.append(f":root {{ {_decls(per_bp[bp].items())} }}")
        block += rules.get(bp, [])
        if block:
            out.append(" ".join(block) if width == 0 else f"@media (min-width: {width}px) {{ {' '.join(block)} }}")
    return "\n".join(out) + "\n"


def _check(path: str, key: str, value, defined: set, errors: list):
    s = str(value)
    if s.startswith("@"):
        if f"--{s[1:]}" not in defined:
            errors.append(f"{path}: unknown reference {s}")
        return
    if key in PLACES:
        if s not in PLACES[key]:
            errors.append(f"{path}: must be one of {sorted(PLACES[key])}, not {s!r}")
        return
    if any(word in key for word in FREE_TEXT):
        return
    if not (LENGTH.match(s) or NUMBER.match(s) or COLOUR.match(s) or DURATION.match(s) or EASING.match(s) or s in KEYWORDS):
        errors.append(f"{path}: invalid value {s!r}")


def validate_ui(config: dict) -> list[str]:
    errors = []
    breakpoints = config.get("breakpoints", {})
    names = set(breakpoints)
    if 0 not in breakpoints.values():
        errors.append("breakpoints: one breakpoint must start at 0")
    defined = set(re.findall(r"(--[\w-]+):", css_from_ui({**config, "panels": {}})))
    for group, values in config.get("tokens", {}).items():
        if not group.startswith("_"):
            for name, v in values.items():
                if not name.startswith("_"):
                    _check(f"tokens.{group}.{name}", name if group in COLOUR_GROUPS else f"{group}-{name}", v, defined, errors)
    for comp, tree in config.get("components", {}).items():
        if not comp.startswith("_"):
            for _, _, path, key, v in _flatten(tree, names):
                _check(f"{comp}.{path}", key, v, defined, errors)
    for panel, per in config.get("panels", {}).items():
        if panel.startswith("_"):
            continue
        for bp, p in per.items():
            if bp not in names:
                errors.append(f"panels.{panel}.{bp}: unknown breakpoint")
                continue
            if "span" in p and not (isinstance(p["span"], int) and 1 <= p["span"] <= 12):
                errors.append(f"panels.{panel}.{bp}.span: must be 1–12")
            if "height" in p and not LENGTH.match(str(p["height"])):
                errors.append(f"panels.{panel}.{bp}.height: invalid length {p['height']!r}")
    return errors
