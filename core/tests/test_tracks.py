from core42.tracks import COMMON_CORE, track_of, xp_earned


def test_track_of():
    assert track_of({"project": {"slug": "c-piscine-c-00"}, "cursus_ids": [9]}) == "piscine"
    assert track_of({"project": {"slug": "42cursus-libft"}, "cursus_ids": [21]}) == "common-core"
    assert track_of({"project": {"slug": "ft_transcendence"}, "cursus_ids": [21]}) == "common-core"
    assert track_of({"project": {"slug": "scop"}, "cursus_ids": [21]}) == "outer-core"


def test_list_covers_the_ranks_and_exams():
    for slug in ("born2beroot", "cpp-module-09", "exam-rank-06", "minirt", "netpractice", "inception", "ft_irc"):
        assert slug in COMMON_CORE


def test_xp_earned():
    assert xp_earned(462, 125, True) == 578
    assert xp_earned(462, 80, False) == 0
    assert xp_earned(0, 100, True) == 0
    assert xp_earned(None, 100, True) == 0 and xp_earned(462, None, True) == 0


def test_group_of_places_projects_in_their_common_core_rank():
    from core42.tracks import group_of
    assert group_of({"project": {"slug": "42cursus-libft"}, "cursus_ids": [21]}) == "rank-00"
    assert group_of({"project": {"slug": "born2beroot"}, "cursus_ids": [21]}) == "rank-01"
    assert group_of({"project": {"slug": "exam-rank-02"}, "cursus_ids": [21]}) == "rank-02"
    assert group_of({"project": {"slug": "minishell"}, "cursus_ids": [21]}) == "rank-03"
    assert group_of({"project": {"slug": "cpp-module-04"}, "cursus_ids": [21]}) == "rank-04"
    assert group_of({"project": {"slug": "cpp-module-05"}, "cursus_ids": [21]}) == "rank-05"
    assert group_of({"project": {"slug": "ft_transcendence"}, "cursus_ids": [21]}) == "rank-06"
    assert group_of({"project": {"slug": "scop"}, "cursus_ids": [21]}) == "outer-core"
    assert group_of({"project": {"slug": "c-piscine-c-00"}, "cursus_ids": [9]}) == "piscine"
