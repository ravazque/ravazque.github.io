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

func (m *OMap) Has(k string) bool { _, ok := m.Get(k); return ok }

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
		a := []any{} // an empty list stays a list ([]), never null
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

// M builds an object from key, value pairs, in that order.
func M(kv ...any) *OMap {
	m := NewOMap()
	for i := 0; i+1 < len(kv); i += 2 {
		m.Set(kv[i].(string), kv[i+1])
	}
	return m
}

func (m *OMap) MarshalJSON() ([]byte, error) {
	if m == nil {
		return []byte("null"), nil
	}
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range m.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		vb, err := json.Marshal(m.vals[k])
		if err != nil {
			return nil, err
		}
		b.Write(vb)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}

func (m *OMap) UnmarshalJSON(b []byte) error {
	o, err := ParseOrdered(b)
	if err != nil {
		return err
	}
	*m = *o
	return nil
}

// S, F, I, B and V read a value written by the analysis (Go types) or parsed back (json.Number).
func (m *OMap) V(k string) any {
	v, _ := m.Get(k)
	return v
}

func (m *OMap) S(k string) string {
	s, _ := m.V(k).(string)
	return s
}

func (m *OMap) B(k string) bool {
	b, _ := m.V(k).(bool)
	return b
}

func (m *OMap) F(k string) float64 {
	f, _ := toFloat(m.V(k))
	return f
}

func (m *OMap) I(k string) int { return int(m.F(k)) }

func (m *OMap) L(k string) []any {
	l, _ := m.V(k).([]any)
	return l
}

// Os is the list under k keeping its objects.
func (m *OMap) Os(k string) []*OMap {
	var out []*OMap
	for _, v := range m.L(k) {
		if o, ok := v.(*OMap); ok {
			out = append(out, o)
		}
	}
	return out
}

func toFloat(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case json.Number:
		f, err := x.Float64()
		return f, err == nil
	}
	return 0, false
}
