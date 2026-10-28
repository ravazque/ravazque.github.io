"""Texts, numbers and dates in the reader's language, as the browser's en-GB / es-ES locales would print them."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from markupsafe import Markup, escape

from ..i18n import strings

TZ = ZoneInfo("Europe/Madrid")


class Fmt:
    def __init__(self, lang: str):
        self.lang, self.d = lang, strings(lang)
        self.dec, self.sep = (",", ".") if lang == "es" else (".", ",")
        self.months = self.d["_months"].split()
        self.weekdays = self.d["_weekdays"].split()

    def __call__(self, key: str, **v) -> str:
        """The text for key with {vars} filled; plural texts pick "one" when count == 1."""
        text = self.d.get(key)
        if text is None:
            return key
        if isinstance(text, dict):
            text = text["one"] if v.get("count") == 1 and "one" in text else text["other"]
        for k, val in v.items():
            text = text.replace("{" + k + "}", str(val))
        return text

    def html(self, key: str, **v) -> Markup:
        """Like __call__ for a text whose vars may carry markup: the text and plain vars are escaped, Markup vars kept."""
        out = str(escape(self(key, **{k: f"\x01{i}\x02" for i, k in enumerate(v)})))
        for i, val in enumerate(v.values()):
            out = out.replace(f"\x01{i}\x02", str(escape(val)))
        return Markup(out)

    @staticmethod
    def markup(text: str) -> Markup:
        """Trusted markup built in a template from these texts."""
        return Markup(text)

    def plural(self, n, key: str) -> str:
        return self(key, count=n, n=self.num(n))

    def num(self, v, d: int = 0) -> str:
        """Grouped thousands, up to d decimals with trailing zeros dropped; "–" for None."""
        if v is None:
            return "–"
        v = round(float(v), d)
        neg, v = v < 0, abs(v)
        whole, _, frac = f"{v:.{d}f}".partition(".")
        frac = frac.rstrip("0")
        if len(whole) > 3 and not (self.lang == "es" and len(whole) == 4):  # es-ES leaves four-digit numbers ungrouped
            whole = f"{int(whole):,}".replace(",", self.sep)
        return ("-" if neg and (whole != "0" or frac) else "") + whole + (self.dec + frac if frac else "")

    def pct(self, a, b) -> str:
        return f"{round(100 * a / b)}%" if b else "–"

    def hm(self, seconds) -> str:
        h, m = divmod(int(seconds or 0) // 60, 60)
        return self("unit.hm", h=h, m=f"{m:02d}")

    def nb(self, v, unit: str, d: int = 1) -> str:
        return f"{self.num(v, d)} {unit}"

    def month_label(self, ym: str) -> str:
        return f"{self.months[int(ym[5:7]) - 1]} {ym[2:4]}"

    def day(self, iso: str | None, weekday: bool = False) -> str:
        """"2 Oct 2026" from an ISO date or datetime (the date part as written)."""
        if not iso:
            return "–"
        y, m, d = int(iso[:4]), int(iso[5:7]), int(iso[8:10])
        text = f"{d} {self.months[m - 1]} {y}"
        if weekday:
            text = f"{self.weekdays[datetime(y, m, d).weekday()]} {text}"
        return text

    def stamp(self, ms: float) -> str:
        """"2 Oct 2026, 14:05" in Madrid time."""
        t = datetime.fromtimestamp(ms / 1000, timezone.utc).astimezone(TZ)
        return f"{self.day(t.date().isoformat())}, {t:%H:%M}"

    def stamp_num(self, ms: float) -> str:
        """"27/10/2026, 14:05" in Madrid time."""
        t = datetime.fromtimestamp(ms / 1000, timezone.utc).astimezone(TZ)
        return f"{t:%d/%m/%Y, %H:%M}"

    def month_of(self, ms: float) -> str:
        t = datetime.fromtimestamp(ms / 1000, timezone.utc).astimezone(TZ)
        return self.month_label(f"{t:%Y-%m}")
