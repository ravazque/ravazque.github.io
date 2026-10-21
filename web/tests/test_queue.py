"""Real arq over fakeredis: the job id dedupe must never swallow a retry or a refresh after a job has finished."""
import fakeredis
import pytest
from arq.connections import ArqRedis
from arq.worker import Worker, func

from app.limiter import RateLimiter
from app.store import Store, enqueue_extraction
from app.worker import WorkerSettings, extract_job


class BrokenApi:
    """Every 42 call fails, like an API outage in the middle of an extraction."""

    def __getattr__(self, name):
        async def fail(*_a, **_kw):
            raise RuntimeError("42 is down")
        return fail


@pytest.fixture(autouse=True)
def no_redis_info(monkeypatch):
    async def quiet(*_a, **_kw):
        return None
    monkeypatch.setattr("arq.worker.log_redis_info", quiet)  # fakeredis has no INFO; arq only logs it


@pytest.fixture
async def pool():
    fake = fakeredis.aioredis.FakeRedis()
    arq = ArqRedis(connection_pool=fake.connection_pool)
    yield arq
    await fake.aclose()


async def run_worker(pool, store):
    worker = Worker(functions=[func(extract_job, name="extract_job")], redis_pool=pool, burst=True, poll_delay=0.01,
                    keep_result=getattr(WorkerSettings, "keep_result", 3600), max_jobs=1, handle_signals=False,
                    ctx={"store": store, "api": BrokenApi()})
    await worker.main()
    await worker.close()


async def test_retry_after_a_failed_extraction_enqueues_a_new_job(pool, settings):
    store, limiter = Store(pool, settings), RateLimiter(pool)
    await enqueue_extraction(store, pool, 7, limiter)
    await run_worker(pool, store)
    assert (await store.status(7))["state"] == "failed"

    status = await enqueue_extraction(store, pool, 7, limiter)
    assert status["state"] == "queued"
    assert len(await pool.queued_jobs()) == 1
    await run_worker(pool, store)
    assert (await store.status(7))["state"] == "failed"  # the retry really ran


async def test_deleting_cancels_a_queued_extraction(pool, settings):
    store, limiter = Store(pool, settings), RateLimiter(pool)
    await enqueue_extraction(store, pool, 7, limiter)
    assert len(await pool.queued_jobs()) == 1
    await store.delete_user(7)
    assert await pool.queued_jobs() == []
    await run_worker(pool, store)
    assert (await store.status(7))["state"] == "none"


async def test_a_running_extraction_does_not_bring_deleted_data_back(pool, settings, monkeypatch):
    store, limiter = Store(pool, settings), RateLimiter(pool)

    async def extract_then_user_deletes(_api, uid, progress):
        await progress(0.5)
        await store.delete_user(uid)  # the user clicks "Delete my data" while the job runs
        await progress(0.9)
        return {"page": "web"}
    monkeypatch.setattr("app.worker.extract", extract_then_user_deletes)
    await enqueue_extraction(store, pool, 7, limiter)
    await run_worker(pool, store)
    assert await store.load_report(7) is None
    assert await pool.exists("user:7:status") == 0

    # signing in again later starts a fresh extraction that does save
    await pool.delete(*[k async for k in pool.scan_iter("cooldown:*")])
    monkeypatch.setattr("app.worker.extract", lambda *_a, **_kw: _report())
    await enqueue_extraction(store, pool, 7, limiter)
    await run_worker(pool, store)
    assert await store.load_report(7) == {"page": "web"}


async def _report():
    return {"page": "web"}


async def test_a_timed_out_extraction_does_not_stay_running(pool, settings, monkeypatch):
    import asyncio
    store, limiter = Store(pool, settings), RateLimiter(pool)

    async def too_slow(*_a, **_kw):
        await asyncio.sleep(5)
    monkeypatch.setattr("app.worker.extract", too_slow)
    await enqueue_extraction(store, pool, 7, limiter)
    worker = Worker(functions=[func(extract_job, name="extract_job", timeout=0.2)], redis_pool=pool, burst=True, poll_delay=0.01,
                    keep_result=0, max_jobs=1, handle_signals=False, ctx={"store": store, "api": BrokenApi()})
    await worker.main()
    await worker.close()
    assert (await store.status(7))["state"] == "failed"
