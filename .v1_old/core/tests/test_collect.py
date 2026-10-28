from core42.collect import people_ids, project_ids


def test_people_are_correctors_evaluated_and_teammates_but_not_me():
    d = {"evals_received": [{"corrector": {"id": 2}}, {"corrector": None}],
         "evals_given": [{"correcteds": [{"id": 3}, "invalid"]}],
         "teams": [{"project_id": 9, "users": [{"id": 1}, {"id": 4}]}]}
    assert people_ids(d, my_id=1) == {2, 3, 4}


def test_project_ids_from_teams_and_evaluations():
    d = {"teams": [{"project_id": 9}], "evals_received": [{"team": {"project_id": 7}}], "evals_given": [{"team": None}]}
    assert project_ids(d) == {7, 9}


def test_evaluations_with_a_hidden_corrector_are_dropped():
    from core42.collect import drop_hidden_evaluations
    d = {"evals_received": [{"id": 1, "corrector": {"id": 2, "login": "a"}}, {"id": 2, "corrector": "invisible"}],
         "evals_given": [{"id": 3, "correcteds": [{"id": 3}, "invisible"]}], "teams": []}
    drop_hidden_evaluations(d)
    assert [e["id"] for e in d["evals_received"]] == [1]
    assert d["evals_given"][0]["correcteds"] == [{"id": 3}]
    assert people_ids(d, my_id=1) == {2, 3}
