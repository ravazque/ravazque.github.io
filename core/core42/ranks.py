"""Where someone stands in the 42cursus today, as a Connections graph group."""
import re

GROUPS = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06",
          "outer-core", "alumni", "no-cursus"]
RANK_QUEST = re.compile(r"^Common Core Rank (\d\d)$")


def rank_groups(cursus_users: list[dict], quests_users: list[dict]) -> dict[str, str]:
    """login -> group. "Rank N" is the rank being worked on: the highest validated rank quest plus one.

    Logins in neither list are absent; callers treat them as "no-cursus".
    """
    grade = {c["user"]["login"]: c.get("grade") for c in cursus_users}
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
        else:
            out[login] = f"rank-{best.get(login, -1) + 1:02d}"
    return out
