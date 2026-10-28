"""The report's original lives in the browser; the server keeps a signed, short-lived copy and takes it back only
with its own signature for the same user."""
import json

import pytest

from app.store import Store


@pytest.fixture
async def stored(memory, settings):
    store = Store(memory, settings)
    await store.save_report(7, {"periods": {}, "page": "web"})
    return store


async def test_the_report_is_handed_out_with_its_signature(signed_in, stored):
    r = await signed_in.get("/app/report.json")
    assert r.status_code == 200 and json.loads(r.content) == {"periods": {}, "page": "web"}
    assert len(r.headers["x-report-sig"]) == 64 and r.headers["cache-control"] == "no-store"


async def test_a_signed_copy_comes_back_after_the_server_forgot_it(signed_in, stored, memory):
    r = await signed_in.get("/app/report.json")
    body, sig = r.content, r.headers["x-report-sig"]
    await memory.delete("user:7:data")
    back = await signed_in.post("/app/report", content=body, headers={**signed_in.csrf, "X-Report-Sig": sig})
    assert back.status_code == 204 and await stored.load_report(7) == {"periods": {}, "page": "web"}


@pytest.mark.parametrize("change", ["tampered", "unsigned", "no-csrf"])
async def test_tampered_unsigned_or_forged_copies_are_refused(signed_in, stored, memory, change):
    r = await signed_in.get("/app/report.json")
    body, sig = r.content, r.headers["x-report-sig"]
    await memory.delete("user:7:data")
    headers = {**signed_in.csrf, "X-Report-Sig": sig}
    if change == "tampered":
        body = body.replace(b'"web"', b'"evil"')
    elif change == "unsigned":
        headers.pop("X-Report-Sig")
    else:
        headers.pop("X-CSRF-Token")
    assert (await signed_in.post("/app/report", content=body, headers=headers)).status_code in (400, 403)
    assert await stored.load_report(7) is None


async def test_another_users_signature_does_not_open_this_account(signed_in, memory, settings):
    other = Store(memory, settings)
    await other.save_report(8, {"periods": {}, "page": "x"})
    raw, sig = await other.raw_report(8)
    r = await signed_in.post("/app/report", content=raw, headers={**signed_in.csrf, "X-Report-Sig": sig})
    assert r.status_code == 400 and await Store(memory, settings).load_report(7) is None


async def test_without_a_server_copy_the_page_asks_the_browser_first(signed_in, jobs):
    r = await signed_in.get("/app")
    assert 'data-restore="ravazque-test"' in r.text or "data-restore=" in r.text
    assert jobs.enqueued == []
    fresh = await signed_in.get("/app?fresh=1")
    assert 'id="boot"' in fresh.text and jobs.enqueued == ["extract_job"]


async def test_deleting_clears_the_browser_storage_too(signed_in, stored):
    r = await signed_in.post("/app/delete", data={"csrf": signed_in.csrf["X-CSRF-Token"]})
    assert r.headers.get("clear-site-data") == '"storage"'
