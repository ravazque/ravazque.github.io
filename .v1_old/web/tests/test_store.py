import hashlib
import hmac

import pytest

from app.store import Store, enqueue_extraction


class Budget:
    def __init__(self, ok=True):
        self.ok = ok

    async def budget_ok(self):
        return self.ok


@pytest.fixture
def store(memory, settings):
    return Store(memory, settings)


async def test_the_server_copy_is_renewed_for_an_hour_on_every_use(store, memory):
    await store.save_report(1, {"a": 1})
    await memory.expire("user:1:data", 10)
    assert await store.load_report(1) == {"a": 1}
    assert 3500 < await memory.ttl("user:1:data") <= 3600


async def test_status_defaults_and_cooldown_wait(store):
    s = await store.status(1)
    assert s["state"] == "none" and s["next_refresh_in"] == 0
    await store.start_cooldown(1)
    assert 3590 < (await store.status(1))["next_refresh_in"] <= 3600


async def test_double_enqueue_makes_one_job(store, jobs):
    a = await enqueue_extraction(store, jobs, 1, Budget())
    b = await enqueue_extraction(store, jobs, 1, Budget())
    assert jobs.enqueued == ["extract_job"] and a["state"] == "queued" and b["state"] in {"queued", "running"}


async def test_cooldown_blocks_enqueue(store, jobs):
    await store.start_cooldown(1)
    s = await enqueue_extraction(store, jobs, 1, Budget())
    assert jobs.enqueued == [] and s["next_refresh_in"] > 0 and await store.try_lock(1)


async def test_low_budget_defers_to_next_hour(store, jobs):
    s = await enqueue_extraction(store, jobs, 1, Budget(ok=False))
    assert s["state"] == "queued" and s["message"] == "status.budget"
    assert 0 < jobs.kwargs[0]["_defer_by"] <= 3600


async def test_delete_keeps_only_keys_that_do_not_name_the_user(store, memory, settings):
    await store.start_cooldown(1); await store.save_report(1, {}); await store.set_status(1, state="done")
    await store.delete_user(1)
    keys = sorted(k.decode() for k in await memory.keys("*"))
    digest = hmac.new(settings.session_secret.encode(), b"1", hashlib.sha256).hexdigest()
    assert keys == [f"cooldown:{digest}", f"deleted:{digest}"]
    assert await memory.ttl(f"deleted:{digest}") <= 900
