"""Correction statistics computed from a period's report: failure rates, Outstanding reciprocity,
breakdowns by the other person's rank group and by hour of day. No API calls."""
from collections import defaultdict


def _failed(e) -> bool:
    return e.get("negative_flag") or (e.get("mark") is not None and e["mark"] < 50)


def _rate(evs) -> dict:
    marked = [e for e in evs if e.get("mark") is not None or e.get("negative_flag")]
    n = sum(1 for e in marked if _failed(e))
    return {"n": n, "total": len(marked), "pct": round(100 * n / len(marked), 1) if marked else None}


def _avg(values):
    values = [v for v in values if v is not None]
    return round(sum(values) / len(values), 1) if values else None


def correction_stats(report: dict, groups: dict[str, str] | None) -> dict:
    me = report["profile"]["login"]
    received, given = report.get("received") or [], report.get("given") or []
    gave_me = {e["corrector"]["login"] for e in received if e.get("outstanding")}
    i_gave = {c["login"] for e in given if e.get("outstanding") for c in e.get("correcteds") or [] if c["login"] != me}

    by_group = {}
    if groups is not None:
        acc = defaultdict(lambda: {"received": 0, "received_out": 0, "given": 0, "given_out": 0})
        for e in received:
            g = acc[groups.get(e["corrector"]["login"], "no-cursus")]
            g["received"] += 1; g["received_out"] += bool(e.get("outstanding"))
        for e in given:
            for c in e.get("correcteds") or []:
                if c["login"] != me:
                    g = acc[groups.get(c["login"], "no-cursus")]
                    g["given"] += 1; g["given_out"] += bool(e.get("outstanding"))
        by_group = dict(acc)

    hours = [{"hour": h, "received": 0, "given": 0, "_r": [], "_g": []} for h in range(24)]
    for e in received:
        if e.get("hour") is not None:
            hours[e["hour"]]["received"] += 1; hours[e["hour"]]["_r"].append(e.get("mark"))
    for e in given:
        if e.get("hour") is not None:
            hours[e["hour"]]["given"] += 1; hours[e["hour"]]["_g"].append(e.get("mark"))
    by_hour = [{"hour": h["hour"], "received": h["received"], "given": h["given"],
                "avg_received": _avg(h["_r"]), "avg_given": _avg(h["_g"])} for h in hours]

    return {
        "failed_given": _rate(given),
        "failed_received": _rate(received),
        "outstanding_reciprocity": {"gave_me": len(gave_me), "i_gave_back": len(gave_me & i_gave),
                                    "i_gave": len(i_gave), "they_gave_back": len(i_gave & gave_me)},
        "by_group": by_group,
        "by_hour": by_hour,
    }
