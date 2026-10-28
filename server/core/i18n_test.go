package core

import (
	"encoding/json"
	"slices"
	"testing"
)

func flatKeys(prefix string, v any, out *[]string) {
	if m, ok := v.(map[string]any); ok {
		for k, x := range m {
			flatKeys(prefix+k+".", x, out)
		}
		return
	}
	*out = append(*out, prefix)
}

func TestI18nSameKeys(t *testing.T) {
	keys := map[string][]string{}
	for _, lang := range []string{"en", "es"} {
		raw, err := Data.ReadFile("data/i18n/" + lang + ".json")
		if err != nil {
			t.Fatal(err)
		}
		var v any
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatal(err)
		}
		var ks []string
		flatKeys("", v, &ks)
		slices.Sort(ks)
		keys[lang] = ks
	}
	if !slices.Equal(keys["en"], keys["es"]) {
		t.Fatal("en.json and es.json keys differ")
	}
}
