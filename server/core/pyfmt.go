package core

import (
	"math/big"
	"slices"
	"strconv"
	"time"
)

// The analysis must give v1's numbers exactly: these follow Python's round(), statistics.mean/median and datetime.

func pyRound(x float64, nd int) float64 {
	f, _ := strconv.ParseFloat(strconv.FormatFloat(x, 'f', nd, 64), 64)
	return f
}

func pyRoundInt(x float64) int { return int(pyRound(x, 0)) }

func floats(vals []any) []float64 {
	var out []float64
	for _, v := range vals {
		if f, ok := toFloat(v); ok {
			out = append(out, f)
		}
	}
	return out
}

// exactMean is statistics.mean: the exact sum divided, then rounded once.
func exactMean(vs []float64) float64 {
	sum := new(big.Rat)
	for _, v := range vs {
		sum.Add(sum, new(big.Rat).SetFloat64(v))
	}
	f, _ := sum.Quo(sum, new(big.Rat).SetInt64(int64(len(vs)))).Float64()
	return f
}

// avg is analysis.avg: statistics.mean of the non-null values, rounded; nil when there are none.
func avg(vals []any, nd int) any {
	vs := floats(vals)
	if len(vs) == 0 {
		return nil
	}
	return pyRound(exactMean(vs), nd)
}

// sumAvg is the insights/stats _avg: a plain left-to-right sum over the count.
func sumAvg(vals []any, nd int) any {
	vs := floats(vals)
	if len(vs) == 0 {
		return nil
	}
	s := 0.0
	for _, v := range vs {
		s += v
	}
	return pyRound(s/float64(len(vs)), nd)
}

func median(vs []float64) float64 {
	s := slices.Clone(vs)
	slices.Sort(s)
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

func medianOpt(vals []any, nd int) any {
	vs := floats(vals)
	if len(vs) == 0 {
		return nil
	}
	return pyRound(median(vs), nd)
}

func totalSeconds(d time.Duration) float64 { return float64(d/time.Microsecond) / 1e6 }

func tsAny(v any) time.Time {
	s, _ := v.(string)
	return TS(s)
}

// fmtT is the report's local time text, nil for no time.
func fmtT(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t.In(Madrid).Format("2006-01-02 15:04")
}

// msOf is int(dt.timestamp() * 1000), float steps included.
func msOf(t time.Time) int64 {
	us := t.Unix()*1_000_000 + int64(t.Nanosecond()/1000)
	return int64(float64(us) / 1e6 * 1000)
}

func msT(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return msOf(t)
}

func fromMs(ms int64) time.Time { return time.UnixMilli(ms).UTC() }

// pyISO is datetime.isoformat() of a UTC time.
func pyISO(t time.Time) string {
	t = t.UTC()
	if t.Nanosecond()/1000 != 0 {
		return t.Format("2006-01-02T15:04:05.000000") + "+00:00"
	}
	return t.Format("2006-01-02T15:04:05") + "+00:00"
}

func idStr(v any) string {
	f, _ := toFloat(v)
	return strconv.FormatInt(int64(f), 10)
}

// counted is Counter.most_common(): by count, highest first, ties in first-seen order.
type counted struct {
	keys []any
	n    map[any]float64
}

func newCounted() *counted { return &counted{n: map[any]float64{}} }

func (c *counted) add(k any, by float64) {
	if _, ok := c.n[k]; !ok {
		c.keys = append(c.keys, k)
	}
	c.n[k] += by
}

func (c *counted) mostCommon() []any {
	ks := slices.Clone(c.keys)
	slices.SortStableFunc(ks, func(a, b any) int {
		switch {
		case c.n[a] > c.n[b]:
			return -1
		case c.n[a] < c.n[b]:
			return 1
		}
		return 0
	})
	return ks
}

// obj renders the counts as an object, most common first; values pass through conv.
func (c *counted) obj(conv func(float64) any) *OMap {
	out := NewOMap()
	for _, k := range c.mostCommon() {
		out.Set(keyStr(k), conv(c.n[k]))
	}
	return out
}

func keyStr(k any) string {
	if s, ok := k.(string); ok {
		return s
	}
	if k == nil {
		return "null"
	}
	return idStr(k)
}

func asInt(f float64) any { return int(f) }

func monthRange(first, last string) []string {
	y, _ := strconv.Atoi(first[:4])
	m, _ := strconv.Atoi(first[5:7])
	var out []string
	for {
		k := strconv.Itoa(y) + "-" + pad2(m)
		if len(strconv.Itoa(y)) < 4 {
			k = pad4(y) + "-" + pad2(m)
		}
		if k > last {
			return out
		}
		out = append(out, k)
		if m == 12 {
			y, m = y+1, 1
		} else {
			m++
		}
	}
}

func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

func pad4(n int) string {
	s := strconv.Itoa(n)
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}

func list[T any](xs []T) []any {
	out := make([]any, len(xs))
	for i, x := range xs {
		out[i] = x
	}
	return out
}
