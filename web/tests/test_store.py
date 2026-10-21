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
def store(redis, settings):
    return Store(redis, settings)


async def test_report_round_trip_renews_retention(store, redis):
    await store.save_report(1, {"a": 1})
    await redis.expire("user:1:data", 10)
    assert await store.load_report(1) == {"a": 1}
    assert await redis.ttl("user:1:data") > 2_590_000


async def test_status_defaults_and_cooldown_wait(store):
    s = await store.status(1)
    assert s["state"] == "none" and s["next_refresh_in"] == 0
    await store.start_cooldown(1)
    assert 3590 < (await store.status(1))["next_refresh_in"] <= 3600


async def test_double_enqueue_makes_one_job(store, arq_pool):
    a = await enqueue_extraction(store, arq_pool, 1, Budget())
    b = await enqueue_extraction(store, arq_pool, 1, Budget())
    assert arq_pool.enqueued == ["extract_job"] and a["state"] == "queued" and b["state"] in {"queued", "running"}


async def test_cooldown_blocks_enqueue(store, arq_pool):
    await store.start_cooldown(1)
    s = await enqueue_extraction(store, arq_pool, 1, Budget())
    assert arq_pool.enqueued == [] and s["next_refresh_in"] > 0 and await store.try_lock(1)


async def test_low_budget_defers_to_next_hour(store, arq_pool):
    s = await enqueue_extraction(store, arq_pool, 1, Budget(ok=False))
    assert s["state"] == "queued" and s["message"] == "status.budget"
    assert 0 < arq_pool.kwargs[0]["_defer_by"] <= 3600


async def test_delete_keeps_only_keys_that_do_not_name_the_user(store, redis, settings):
    await store.start_cooldown(1); await store.save_report(1, {}); await store.set_status(1, state="done")
    await store.delete_user(1)
    keys = sorted(k.decode() for k in await redis.keys("*"))
    digest = hmac.new(settings.session_secret.encode(), b"1", hashlib.sha256).hexdigest()
    assert keys == [f"cooldown:{digest}", f"deleted:{digest}"]
    assert await redis.ttl(f"deleted:{digest}") <= 900
