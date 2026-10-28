package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// OMap is a JSON object that keeps its keys in file order: ui.json's order decides the order of the CSS it makes.
type OMap struct {
	keys []string
	vals map[string]any
}

func (m *OMap) Keys() []string { return m.keys }

func (m *OMap) Get(k string) (any, bool) {
	if m == nil {
		return nil, false
	}
	v, ok := m.vals[k]
	return v, ok
}

// Obj is the object under k, or an empty one.
func (m *OMap) Obj(k string) *OMap {
	if v, ok := m.Get(k); ok {
		if o, ok := v.(*OMap); ok {
			return o
		}
	}
	return &OMap{vals: map[string]any{}}
}

// Set keeps the position of an existing key, like a Python dict.
func (m *OMap) Set(k string, v any) {
	if _, ok := m.vals[k]; !ok {
		m.keys = append(m.keys, k)
	}
	m.vals[k] = v
}

func NewOMap() *OMap { return &OMap{vals: map[string]any{}} }

// ParseOrdered decodes JSON with objects as *OMap and numbers as json.Number.
func ParseOrdered(raw []byte) (*OMap, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	v, err := parseValue(dec)
	if err != nil {
		return nil, err
	}
	m, ok := v.(*OMap)
	if !ok {
		return nil, fmt.Errorf("not a JSON object")
	}
	return m, nil
}

func parseValue(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		if t == '{' {
			m := NewOMap()
			for dec.More() {
				k, err := dec.Token()
				if err != nil {
					return nil, err
				}
				v, err := parseValue(dec)
				if err != nil {
					return nil, err
				}
				m.Set(k.(string), v)
			}
			_, err := dec.Token()
			return m, err
		}
		var a []any
		for dec.More() {
			v, err := parseValue(dec)
			if err != nil {
				return nil, err
			}
			a = append(a, v)
		}
		_, err := dec.Token()
		return a, err
	default:
		return t, nil
	}
}

// pyStr renders a JSON scalar as Python's str() does (1.0 stays "1.0", true is "True").
func pyStr(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		s := x.String()
		if !strings.ContainsAny(s, ".eE") {
			return s
		}
		f, _ := strconv.ParseFloat(s, 64)
		out := strconv.FormatFloat(f, 'f', -1, 64)
		if !strings.Contains(out, ".") {
			out += ".0"
		}
		return out
	case bool:
		if x {
			return "True"
		}
		return "False"
	case nil:
		return "None"
	}
	return fmt.Sprint(v)
}
