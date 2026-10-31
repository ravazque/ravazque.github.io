package core

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// ui.json → CSS. ui.json decides colours, sizes and placement of every page.
//
//	tokens.light / tokens.dark          --<name>          colours; dark ones under prefers-color-scheme and [data-theme=dark]
//	tokens.<group>.<name>               --<group>-<name>  type, space, radius, motion
//	components.<c>[.<variant>].<name>   --c-<c>[-<variant>]-<name>
//
// A value "@name" refers to another variable: var(--name). Inside a component, an object keyed by a breakpoint name
// overrides its values from that width up. Keys starting with "_" are notes and are ignored.

var (
	reLength   = regexp.MustCompile(`^-?(\d+(\.\d+)?|\.\d+)(px|rem|em|vh|vw|%|ch|fr)$|^0$`)
	reNumber   = regexp.MustCompile(`^-?(\d+(\.\d+)?|\.\d+)$`)
	reColour   = regexp.MustCompile(`^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent|currentColor)$`)
	reDuration = regexp.MustCompile(`^(\d+(\.\d+)?|\.\d+)(ms|s)$`)
	reEasing   = regexp.MustCompile(`^(cubic-bezier\([\d\s.,-]+\)|ease|ease-in|ease-out|ease-in-out|linear)$`)
	reVarDecl  = regexp.MustCompile(`(--[\w-]+):`)
	keywords   = map[string]bool{"none": true, "auto": true, "uppercase": true, "normal": true, "bold": true,
		"seats": true, "shapes": true, "bubbles": true, "cubes": true} // site.field: the landing's animated background
	places   = map[string][]string{"side": {"left", "right"}, "position": {"top", "bottom"}}
	freeText = []string{"shadow", "font"} // keys whose values are CSS shorthands or font stacks
)

func LoadUI() (*OMap, error) {
	raw, err := Data.ReadFile("data/ui.json")
	if err != nil {
		return nil, err
	}
	return ParseOrdered(raw)
}

type leaf struct {
	bp, suffix, path, key string
	value                 any
}

func flatten(node *OMap, bps map[string]bool, v, path, bp string, out *[]leaf) {
	for _, k := range node.Keys() {
		if strings.HasPrefix(k, "_") {
			continue
		}
		val, _ := node.Get(k)
		if o, ok := val.(*OMap); ok {
			if bps[k] {
				flatten(o, bps, v, path+k+".", k, out)
			} else {
				flatten(o, bps, v+k+"-", path+k+".", bp, out)
			}
			continue
		}
		*out = append(*out, leaf{bp, v + k, path + k, k, val})
	}
}

func cssValue(v any) string {
	s := pyStr(v)
	if strings.HasPrefix(s, "@") {
		return "var(--" + s[1:] + ")"
	}
	return s
}

func decls(m *OMap) string {
	parts := make([]string, 0, len(m.Keys()))
	for _, k := range m.Keys() {
		v, _ := m.Get(k)
		parts = append(parts, fmt.Sprintf("%s: %s;", k, v))
	}
	return strings.Join(parts, " ")
}

func breakpointNames(cfg *OMap) (map[string]bool, map[string]int) {
	names, widths := map[string]bool{}, map[string]int{}
	bp := cfg.Obj("breakpoints")
	for _, k := range bp.Keys() {
		v, _ := bp.Get(k)
		n, _ := v.(json.Number).Int64()
		names[k], widths[k] = true, int(n)
	}
	return names, widths
}

func variables(cfg *OMap) (dark, base *OMap, perBP map[string]*OMap) {
	names, widths := breakpointNames(cfg)
	tokens := cfg.Obj("tokens")
	light, dark := NewOMap(), NewOMap()
	for group, target := range map[string]*OMap{"light": light, "dark": dark} {
		g := tokens.Obj(group)
		for _, k := range g.Keys() {
			if !strings.HasPrefix(k, "_") {
				v, _ := g.Get(k)
				target.Set("--"+k, cssValue(v))
			}
		}
	}
	base = NewOMap()
	for _, k := range light.Keys() {
		v, _ := light.Get(k)
		base.Set(k, v)
	}
	for _, group := range tokens.Keys() {
		if strings.HasPrefix(group, "_") || group == "light" || group == "dark" {
			continue
		}
		g := tokens.Obj(group)
		for _, k := range g.Keys() {
			if !strings.HasPrefix(k, "_") {
				v, _ := g.Get(k)
				base.Set("--"+group+"-"+k, cssValue(v))
			}
		}
	}
	perBP = map[string]*OMap{}
	comps := cfg.Obj("components")
	for _, c := range comps.Keys() {
		if strings.HasPrefix(c, "_") {
			continue
		}
		var leaves []leaf
		flatten(comps.Obj(c), names, "", "", "", &leaves)
		for _, l := range leaves {
			target := base
			if l.bp != "" && widths[l.bp] > 0 {
				if perBP[l.bp] == nil {
					perBP[l.bp] = NewOMap()
				}
				target = perBP[l.bp]
			}
			target.Set("--c-"+c+"-"+l.suffix, cssValue(l.value))
		}
	}
	return dark, base, perBP
}

func panelRules(panel string, p *OMap) []string {
	sel := fmt.Sprintf(`[data-panel="%s"]`, panel)
	var rules []string
	grid := NewOMap()
	if v, ok := p.Get("span"); ok {
		grid.Set("grid-column", "span "+pyStr(v))
	}
	if v, ok := p.Get("order"); ok {
		grid.Set("order", pyStr(v))
	}
	if len(grid.Keys()) > 0 {
		rules = append(rules, fmt.Sprintf("%s { %s }", sel, decls(grid)))
	}
	if v, ok := p.Get("height"); ok {
		rules = append(rules, fmt.Sprintf("%s .plot { height: %s; }", sel, pyStr(v)))
	}
	if v, ok := p.Get("gap"); ok {
		rules = append(rules, fmt.Sprintf("%s { margin-top: %s; }", sel, pyStr(v)))
	}
	if v, ok := p.Get("hidden"); ok {
		d := "block"
		if v == true {
			d = "none"
		}
		rules = append(rules, fmt.Sprintf("%s { display: %s; }", sel, d))
	}
	return rules
}

func CSSFromUI(cfg *OMap) string {
	_, widths := breakpointNames(cfg)
	dark, base, perBP := variables(cfg)
	out := []string{fmt.Sprintf(":root { color-scheme: light; %s }", decls(base))}
	if len(dark.Keys()) > 0 {
		out = append(out,
			fmt.Sprintf(`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; %s } }`, decls(dark)),
			fmt.Sprintf(`:root[data-theme="dark"] { color-scheme: dark; %s }`, decls(dark)))
	}
	rules := map[string][]string{}
	panels := cfg.Obj("panels")
	for _, panel := range panels.Keys() {
		if strings.HasPrefix(panel, "_") {
			continue
		}
		per := panels.Obj(panel)
		for _, bp := range per.Keys() {
			rules[bp] = append(rules[bp], panelRules(panel, per.Obj(bp))...)
		}
	}
	order := slices.Clone(cfg.Obj("breakpoints").Keys())
	slices.SortStableFunc(order, func(a, b string) int { return widths[a] - widths[b] })
	for _, bp := range order {
		var block []string
		if widths[bp] > 0 && perBP[bp] != nil && len(perBP[bp].Keys()) > 0 {
			block = append(block, fmt.Sprintf(":root { %s }", decls(perBP[bp])))
		}
		block = append(block, rules[bp]...)
		if len(block) == 0 {
			continue
		}
		if widths[bp] == 0 {
			out = append(out, strings.Join(block, " "))
		} else {
			out = append(out, fmt.Sprintf("@media (min-width: %dpx) { %s }", widths[bp], strings.Join(block, " ")))
		}
	}
	return strings.Join(out, "\n") + "\n"
}

func checkValue(path, key string, value any, defined map[string]bool, errs *[]string) {
	s := pyStr(value)
	if strings.HasPrefix(s, "@") {
		if !defined["--"+s[1:]] {
			*errs = append(*errs, fmt.Sprintf("%s: unknown reference %s", path, s))
		}
		return
	}
	if allowed, ok := places[key]; ok {
		if !slices.Contains(allowed, s) {
			*errs = append(*errs, fmt.Sprintf("%s: must be one of %v, not %q", path, allowed, s))
		}
		return
	}
	for _, w := range freeText {
		if strings.Contains(key, w) {
			return
		}
	}
	if !(reLength.MatchString(s) || reNumber.MatchString(s) || reColour.MatchString(s) || reDuration.MatchString(s) ||
		reEasing.MatchString(s) || keywords[s]) {
		*errs = append(*errs, fmt.Sprintf("%s: invalid value %q", path, s))
	}
}

func ValidateUI(cfg *OMap) []string {
	var errs []string
	names, widths := breakpointNames(cfg)
	zero := false
	for _, w := range widths {
		zero = zero || w == 0
	}
	if !zero {
		errs = append(errs, "breakpoints: one breakpoint must start at 0")
	}
	noPanels := NewOMap()
	for _, k := range cfg.Keys() {
		if k != "panels" {
			v, _ := cfg.Get(k)
			noPanels.Set(k, v)
		}
	}
	defined := map[string]bool{}
	for _, m := range reVarDecl.FindAllStringSubmatch(CSSFromUI(noPanels), -1) {
		defined[m[1]] = true
	}
	tokens := cfg.Obj("tokens")
	for _, group := range tokens.Keys() {
		if strings.HasPrefix(group, "_") {
			continue
		}
		g := tokens.Obj(group)
		for _, name := range g.Keys() {
			if strings.HasPrefix(name, "_") {
				continue
			}
			v, _ := g.Get(name)
			key := group + "-" + name
			if group == "light" || group == "dark" {
				key = name
			}
			checkValue("tokens."+group+"."+name, key, v, defined, &errs)
		}
	}
	comps := cfg.Obj("components")
	for _, c := range comps.Keys() {
		if strings.HasPrefix(c, "_") {
			continue
		}
		var leaves []leaf
		flatten(comps.Obj(c), names, "", "", "", &leaves)
		for _, l := range leaves {
			checkValue(c+"."+l.path, l.key, l.value, defined, &errs)
		}
	}
	panels := cfg.Obj("panels")
	for _, panel := range panels.Keys() {
		if strings.HasPrefix(panel, "_") {
			continue
		}
		per := panels.Obj(panel)
		for _, bp := range per.Keys() {
			if !names[bp] {
				errs = append(errs, fmt.Sprintf("panels.%s.%s: unknown breakpoint", panel, bp))
				continue
			}
			p := per.Obj(bp)
			if v, ok := p.Get("span"); ok {
				num, isNum := v.(json.Number)
				n, err := num.Int64()
				if !isNum || err != nil || n < 1 || n > 12 {
					errs = append(errs, fmt.Sprintf("panels.%s.%s.span: must be 1–12", panel, bp))
				}
			}
			for _, k := range []string{"height", "gap"} {
				if v, ok := p.Get(k); ok && !reLength.MatchString(pyStr(v)) {
					errs = append(errs, fmt.Sprintf("panels.%s.%s.%s: invalid length %q", panel, bp, k, pyStr(v)))
				}
			}
		}
	}
	return errs
}
