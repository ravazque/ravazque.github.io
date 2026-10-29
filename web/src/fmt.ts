// Texts, numbers and dates in the reader's language, exactly as v1 printed them (Madrid time, Python rounding).
import en from "@data/i18n/en.json";
import es from "@data/i18n/es.json";

export type Lang = "en" | "es";
type Strings = Record<string, string | string[] | { one?: string; other: string }>;
const STRINGS: Record<Lang, Strings> = { en: en as unknown as Strings, es: es as unknown as Strings };
export type Vars = Record<string, string | number>;

// The exact decimal value of a double, as digits and a decimal exponent: digits × 10^exp.
function exact(x: number): { neg: boolean; digits: bigint; exp: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0), lo = view.getUint32(4);
  const neg = hi >>> 31 === 1;
  const e = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let pow = e - 1075;
  if (e === 0) pow = -1074;
  else mant |= 1n << 52n;
  if (pow >= 0) return { neg, digits: mant << BigInt(pow), exp: 0 };
  return { neg, digits: mant * 5n ** BigInt(-pow), exp: pow }; // m·2^p = m·5^-p·10^p
}

/** Python's round(x, d): the exact binary value rounded, exact ties to even. */
export function pyRound(x: number, d = 0): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const { neg, digits, exp } = exact(x);
  const shift = -exp - d; // drop this many decimal digits
  let q = digits;
  if (shift > 0) {
    const div = 10n ** BigInt(shift);
    q = digits / div;
    const r = digits % div, half = div / 2n;
    if (r > half || (r === half && div % 2n === 0n && q % 2n === 1n)) q += 1n;
  } else if (shift < 0) {
    q = digits * 10n ** BigInt(-shift);
  }
  const v = Number(q) / 10 ** d;
  return neg ? -v : v;
}

const madrid = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hourCycle: "h23", weekday: "short",
});

/** Madrid wall-clock parts of an instant. */
export function madridParts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of madrid.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: p.hour, mm: p.minute, iso: `${p.year}-${p.month}-${p.day}` };
}

export class Fmt {
  readonly lang: Lang;
  readonly months: string[];
  readonly weekdays: string[];
  private d: Strings;
  private dec: string;
  private sep: string;

  constructor(lang: Lang) {
    this.lang = lang;
    this.d = STRINGS[lang];
    [this.dec, this.sep] = lang === "es" ? [",", "."] : [".", ","];
    this.months = String(this.d._months).split(" ");
    this.weekdays = String(this.d._weekdays).split(" ");
  }

  /** The text for key with {vars} filled; plural texts pick "one" when count is 1. */
  t = (key: string, v: Vars = {}): string => {
    let text = this.d[key];
    if (text === undefined) return key;
    if (Array.isArray(text)) return text.join(" ");
    if (typeof text === "object") text = v.count === 1 && text.one ? text.one : text.other;
    for (const [k, val] of Object.entries(v)) text = text.split(`{${k}}`).join(String(val));
    return text;
  };

  has = (key: string) => key in this.d;

  /** A text's raw value (the policy's lists are arrays). */
  raw = (key: string): unknown => this.d[key];

  plural = (n: number, key: string) => this.t(key, { count: n, n: this.num(n) });

  /** Grouped thousands, up to d decimals with trailing zeros dropped; "–" for nothing. */
  num = (v: number | null | undefined, d = 0): string => {
    if (v === null || v === undefined || Number.isNaN(v)) return "–";
    const r = pyRound(Number(v), d);
    const neg = r < 0;
    let [whole, frac = ""] = Math.abs(r).toFixed(d).split(".");
    frac = frac.replace(/0+$/, "");
    if (whole.length > 3 && !(this.lang === "es" && whole.length === 4)) // es-ES leaves four-digit numbers ungrouped
      whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, this.sep);
    return (neg && (whole !== "0" || frac) ? "-" : "") + whole + (frac ? this.dec + frac : "");
  };

  pct = (a: number, b: number) => (b ? `${pyRound((100 * a) / b)}%` : "–");

  hm = (seconds: number | null | undefined) => {
    const mins = Math.floor((seconds || 0) / 60);
    return this.t("unit.hm", { h: Math.floor(mins / 60), m: String(mins % 60).padStart(2, "0") });
  };

  nb = (v: number | null | undefined, unit: string, d = 1) => `${this.num(v, d)} ${unit}`;

  monthLabel = (ym: string) => `${this.months[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;

  /** "2 Oct 2026" from an ISO date or datetime (the date part as written). */
  day = (iso: string | null | undefined, weekday = false) => {
    if (!iso) return "–";
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    const text = `${d} ${this.months[m - 1]} ${y}`;
    if (!weekday) return text;
    const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    return `${this.weekdays[wd]} ${text}`;
  };

  /** "2 Oct 2026, 14:05" in Madrid time. */
  stamp = (ms: number) => {
    const p = madridParts(ms);
    return `${this.day(p.iso)}, ${p.hh}:${p.mm}`;
  };

  /** "2 Oct 2026, 14:05" from a written date-time ("2026-10-02 14:05" or ISO), the date alone when there is no time. */
  dayTime = (s: string | null | undefined) => (!s ? "–" : s.length > 10 ? `${this.day(s)}, ${s.slice(11, 16)}` : this.day(s));

  monthOf = (ms: number) => this.monthLabel(madridParts(ms).iso.slice(0, 7));

  /** "14:05" in Madrid time. */
  clock = (ms: number) => {
    const p = madridParts(ms);
    return `${p.hh}:${p.mm}`;
  };
}
