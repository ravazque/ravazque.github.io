from datetime import datetime, timezone

from core42.profile import Kind, access, main_coalition, profile_kind

NOW = datetime(2026, 10, 18, 12, tzinfo=timezone.utc)
MAIN = object()


def user(staff=False, alumni=False, active=True, campus=22, campus_users=None, main=MAIN,
         begin="2024-09-16T07:42:00Z", end=None, grade=None):
    cursus = [{"cursus_id": 9, "begin_at": "2024-07-01T08:00:00Z", "end_at": "2024-07-26T16:00:00Z", "grade": "Pisciner"}]
    if main is MAIN:
        cursus.append({"cursus_id": 21, "begin_at": begin, "end_at": end, "grade": grade})
    pairs = campus_users if campus_users is not None else [(campus, True)]
    return {"staff?": staff, "alumni?": alumni, "active?": active, "cursus_users": cursus,
            "campus_users": [{"campus_id": c, "is_primary": p} for c, p in pairs]}


def test_kind_order_matches_swifty():
    assert profile_kind(user(staff=True, alumni=True), NOW) is Kind.STAFF
    assert profile_kind(user(grade="Alumni"), NOW) is Kind.ALUMNI
    assert profile_kind(user(alumni=True), NOW) is Kind.ALUMNI
    assert profile_kind(user(main=None), NOW) is Kind.PISCINER
    assert profile_kind(user(begin="2027-01-01T00:00:00Z"), NOW) is Kind.PISCINER
    assert profile_kind(user(begin=None), NOW) is Kind.PISCINER
    assert profile_kind(user(end="2026-10-01T00:00:00Z"), NOW) is Kind.BLACKHOLED
    assert profile_kind(user(active=False), NOW) is Kind.FROZEN
    assert profile_kind(user(grade="Transcender"), NOW) is Kind.TRANSCENDER
    assert profile_kind(user(), NOW) is Kind.STUDENT


def test_future_end_is_not_blackholed():
    assert profile_kind(user(end="2027-03-01T00:00:00Z"), NOW) is Kind.STUDENT


def test_access_allows_students_transcenders_alumni_in_madrid_only():
    assert access(user(), NOW) == (True, "ok")
    assert access(user(grade="Transcender"), NOW) == (True, "ok")
    assert access(user(grade="Alumni"), NOW) == (True, "ok")
    assert access(user(campus=1), NOW) == (False, "campus")
    assert access(user(staff=True), NOW) == (False, "staff")
    assert access(user(main=None), NOW) == (False, "piscine")
    assert access(user(end="2026-10-01T00:00:00Z"), NOW) == (False, "blackholed")
    assert access(user(active=False), NOW) == (False, "frozen")


def test_secondary_madrid_campus_is_not_enough():
    assert access(user(campus_users=[(1, True), (22, False)]), NOW) == (False, "campus")


def test_missing_campus_users_is_refused():
    assert access({**user(), "campus_users": []}, NOW) == (False, "campus")


def test_main_coalition_ignores_piscine_coalitions():
    cs = [{"slug": "piscine-x", "color": "#000"}, {"slug": "tiamant", "color": "#123456"},
          {"slug": "zefiria", "color": "#E39F0B"}]
    assert main_coalition(cs)["slug"] == "zefiria"
    assert main_coalition([{"slug": "piscine-x"}]) is None
    assert main_coalition([]) is None
