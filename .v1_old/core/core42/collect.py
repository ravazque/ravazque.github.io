"""Which extra records a student's data refers to."""


def people_ids(d: dict, my_id: int) -> set[int]:
    """Everyone who evaluated me, was evaluated by me, or shared a team with me."""
    ids = {e["corrector"]["id"] for e in d["evals_received"] if (e.get("corrector") or {}).get("id")}
    for e in d["evals_given"]:
        ids |= {c["id"] for c in e.get("correcteds") or [] if isinstance(c, dict)}
    for t in d["teams"]:
        ids |= {u["id"] for u in t.get("users", [])}
    return ids - {my_id}


def project_ids(d: dict) -> set[int]:
    ids = {t["project_id"] for t in d["teams"]}
    return ids | {e["team"]["project_id"] for e in d["evals_received"] + d["evals_given"] if e.get("team")}


def drop_hidden_evaluations(d: dict) -> dict:
    """The API can hide who takes part in an upcoming evaluation ("invisible" instead of a user object).
    Such evaluations have no mark and nobody to count yet: drop them (and hidden correcteds) before any analysis."""
    d["evals_received"] = [e for e in d.get("evals_received", []) if isinstance(e.get("corrector"), dict) or e.get("corrector") is None]
    for e in d.get("evals_given", []):
        if isinstance(e.get("correcteds"), list):
            e["correcteds"] = [u for u in e["correcteds"] if isinstance(u, dict)]
    return d
