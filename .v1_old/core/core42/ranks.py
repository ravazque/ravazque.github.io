"""Where someone stands in the 42cursus today, as a Connections graph group."""
import re
from datetime import datetime, timezone

GROUPS = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06",
          "outer-core", "alumni", "blackholed", "no-cursus"]
RANK_QUEST = re.compile(r"^Common Core Rank (\d\d)$")


def rank_groups(cursus_users: list[dict], quests_users: list[dict]) -> dict[str, str]:
    """login -> group. "Rank N" is the rank being worked on: the highest validated rank quest plus one.

    A 42cursus already ended (end_at past, as the sign-in check reads it) puts a student who has not finished the
    Common Core in "blackholed".
    Logins in neither list are absent; callers treat them as "no-cursus".
    """
    grade = {c["user"]["login"]: c.get("grade") for c in cursus_users}
    now = datetime.now(timezone.utc).isoformat()
    gone = {c["user"]["login"] for c in cursus_users if c.get("end_at") and c["end_at"] < now}  # the access rule (profile.py)
    common_core, best = set(), {}
    for q in quests_users:
        if not q.get("validated_at"):
            continue
        login, name = q["user"]["login"], (q.get("quest") or {}).get("name", "")
        if name == "Common Core":
            common_core.add(login)
        elif m := RANK_QUEST.match(name):
            best[login] = max(best.get(login, -1), int(m.group(1)))
    out = {}
    for login in set(grade) | common_core | set(best):
        if login not in grade:
            out[login] = "no-cursus"
        elif grade[login] == "Alumni":
            out[login] = "alumni"
        elif grade[login] == "Transcender" or login in common_core:
            out[login] = "outer-core"
        elif login in gone:
            out[login] = "blackholed"
        else:
            out[login] = f"rank-{best.get(login, -1) + 1:02d}"
    return out
