from core42.ranks import GROUPS, rank_groups


def q(login, name, validated="2025-01-01T00:00:00Z"):
    return {"user": {"login": login}, "quest": {"name": name}, "validated_at": validated}


def c(login, grade=None):
    return {"user": {"login": login}, "cursus_id": 21, "grade": grade}


def test_groups_in_display_order():
    assert GROUPS == ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06",
                      "outer-core", "alumni", "no-cursus"]


def test_rank_is_the_one_being_worked_on():
    g = rank_groups([c("a"), c("b"), c("d"), c("e"), c("t", "Transcender"), c("al", "Alumni")],
                    [q("b", "Common Core Rank 00"), q("b", "Common Core Rank 02"),
                     q("d", "Common Core Rank 05"), q("e", "Common Core"), q("x", "Common Core Rank 01"),
                     q("al", "Common Core")])
    assert g == {"a": "rank-00", "b": "rank-03", "d": "rank-06", "e": "outer-core", "t": "outer-core",
                 "al": "alumni", "x": "no-cursus"}


def test_unvalidated_quest_rows_do_not_count():
    assert rank_groups([c("a")], [q("a", "Common Core Rank 00", validated=None)]) == {"a": "rank-00"}


def test_other_quests_are_ignored():
    assert rank_groups([c("a")], [q("a", "Exam Rank 06"), q("a", "CanEvaluateCommonCore")]) == {"a": "rank-00"}
