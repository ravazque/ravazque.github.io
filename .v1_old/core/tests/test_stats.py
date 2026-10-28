from core42.stats import correction_stats


def ev(corrector="me", correcteds=("me",), mark=100, out=False, negative=False, begin="2026-01-02 10:00"):
    return {"corrector": {"login": corrector}, "correcteds": [{"login": c} for c in correcteds], "mark": mark,
            "outstanding": out, "negative_flag": negative, "begin": begin, "hour": int(begin[11:13])}


def report(received=(), given=()):
    return {"profile": {"login": "me"}, "received": list(received), "given": list(given)}


def test_failure_rate_counts_marks_below_50_and_negative_flags():
    r = report(given=[ev(mark=0), ev(mark=49), ev(mark=100, negative=True), ev(mark=100), ev(mark=None)])
    assert correction_stats(r, None)["failed_given"] == {"n": 3, "total": 4, "pct": 75.0}
    assert correction_stats(report(), None)["failed_given"] == {"n": 0, "total": 0, "pct": None}


def test_outstanding_reciprocity():
    r = report(received=[ev(corrector="ann", out=True), ev(corrector="bob", out=True)],
               given=[ev(correcteds=["ann"], out=True), ev(correcteds=["cid"], out=True)])
    assert correction_stats(r, None)["outstanding_reciprocity"] == {"gave_me": 2, "i_gave_back": 1, "i_gave": 2, "they_gave_back": 1}


def test_by_group_needs_groups():
    r = report(received=[ev(corrector="ann", out=True), ev(corrector="zoe")], given=[ev(correcteds=["ann"])])
    assert correction_stats(r, None)["by_group"] == {}
    g = correction_stats(r, {"ann": "rank-03"})["by_group"]
    assert g["rank-03"] == {"received": 1, "received_out": 1, "given": 1, "given_out": 0}
    assert g["no-cursus"]["received"] == 1


def test_by_hour_counts_and_averages():
    r = report(received=[ev(mark=100, begin="2026-01-02 10:05"), ev(mark=50, begin="2026-01-03 10:40")], given=[ev(mark=125, begin="2026-01-04 21:00")])
    hours = correction_stats(r, None)["by_hour"]
    assert len(hours) == 24
    assert hours[10] == {"hour": 10, "received": 2, "given": 0, "avg_received": 75.0, "avg_given": None}
    assert hours[21]["given"] == 1 and hours[21]["avg_given"] == 125.0
