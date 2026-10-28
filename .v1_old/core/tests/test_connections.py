from core42.connections import connections


def ev(corrector, begin, correcteds=("me",)):
    return {"corrector": {"login": corrector}, "correcteds": [{"login": x} for x in correcteds], "begin": begin}


def test_connections_counts_both_directions_and_skips_me():
    report = {"profile": {"login": "me"},
              "people": [{"login": "ann", "name": "Ann"}, {"login": "bob", "name": "Bob"}],
              "received": [ev("ann", "2026-01-02 10:00"), ev("ann", "2026-03-01 10:00")],
              "given": [ev("me", "2026-02-01 09:00", correcteds=["ann", "bob"])]}
    nodes = connections(report, {"ann": "rank-04"})
    assert nodes[0] == {"login": "ann", "name": "Ann", "group": "rank-04", "received": 2, "given": 1, "last": "2026-03-01"}
    assert nodes[1]["login"] == "bob" and nodes[1]["group"] == "no-cursus" and nodes[1]["received"] == 0
    assert all(n["login"] != "me" for n in nodes)


def test_teammate_corrected_with_me_is_not_counted_as_my_corrector():
    report = {"profile": {"login": "me"}, "people": [], "received": [ev("ann", "2026-01-02 10:00", correcteds=["me", "mate"])],
              "given": []}
    assert [n["login"] for n in connections(report, {})] == ["ann"]


def test_connections_empty_for_new_student():
    assert connections({"profile": {"login": "me"}, "people": [], "received": [], "given": []}, {}) == []
