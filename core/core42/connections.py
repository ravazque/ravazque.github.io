"""Who corrected the user and whom the user corrected, per person, for the Connections graph."""
from collections import defaultdict


def connections(report: dict, groups: dict[str, str]) -> list[dict]:
    """One entry per person met in an evaluation, busiest first; the user is left out."""
    me = report["profile"]["login"]
    names = {p["login"]: p.get("name") for p in report.get("people") or []}
    acc = defaultdict(lambda: {"received": 0, "given": 0, "last": ""})

    def met(login, key, begin):
        a = acc[login]
        a[key] += 1
        a["last"] = max(a["last"], (begin or "")[:10])

    for e in report.get("received") or []:
        met(e["corrector"]["login"], "received", e.get("begin"))
    for e in report.get("given") or []:
        for c in e.get("correcteds") or []:
            met(c["login"], "given", e.get("begin"))
    acc.pop(me, None)
    nodes = [{"login": login, "name": names.get(login), "group": groups.get(login, "no-cursus"),
              "received": a["received"], "given": a["given"], "last": a["last"] or None}
             for login, a in acc.items()]
    return sorted(nodes, key=lambda n: (-(n["received"] + n["given"]), n["login"]))
