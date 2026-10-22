"""The in-process job queue: one extraction at a time, a retry after a failure runs again, deleting cancels a queued
job, a running one saves nothing after "Delete my data", and a timeout never leaves the status on "running"."""
import asyncio
import logging

from app.jobs import Jobs
from app.limiter import RateLimiter
from app.memory import Memory
from app.store import JOB_ID, Store, delete_everything, enqueue_extraction
from app.worker import extract_job


class BrokenApi:
    """Every 42 call fails, like an API outage in the middle of an extraction."""

    def __getattr__(self, name):
        async def fail(*_a, **_kw):
            raise RuntimeError("42 is down")
        return fail


def setup(settings, timeout=900):
    memory = Memory()
    store = Store(memory, settings)
    jobs = Jobs(lambda uid: extract_job({"store": store, "api": BrokenApi()}, uid), timeout=timeout)
    return memory, store, jobs, RateLimiter(memory)


async def test_retry_after_a_failed_extraction_enqueues_a_new_job(settings):
    _, store, jobs, limiter = setup(settings)
    await enqueue_extraction(store, jobs, 7, limiter)
    await jobs.drain()
    assert (await store.status(7))["state"] == "failed"
    status = await enqueue_extraction(store, jobs, 7, limiter)
    assert status["state"] == "queued" and jobs.queued() == [JOB_ID.format(7)]
    await jobs.drain()
    assert (await store.status(7))["state"] == "failed"  # the retry really ran


async def test_the_same_extraction_is_never_queued_twice(settings):
    _, store, jobs, limiter = setup(settings)
    await enqueue_extraction(store, jobs, 7, limiter)
    assert await jobs.enqueue_job("extract_job", 7, _job_id=JOB_ID.format(7)) is None
    assert jobs.queued() == [JOB_ID.format(7)]


async def test_deleting_cancels_a_queued_extraction(settings):
    _, store, jobs, limiter = setup(settings)
    await enqueue_extraction(store, jobs, 7, limiter)
    await delete_everything(store, jobs, 7)
    assert jobs.queued() == []
    await jobs.drain()
    assert (await store.status(7))["state"] == "none"


async def test_a_running_extraction_does_not_bring_deleted_data_back(settings, monkeypatch):
    memory, store, jobs, limiter = setup(settings)

    async def extract_then_user_deletes(_api, uid, progress):
        await progress(0.5)
        await delete_everything(store, jobs, uid)  # the user clicks "Delete my data" while the job runs
        await progress(0.9)
        return {"page": "web"}
    monkeypatch.setattr("app.worker.extract", extract_then_user_deletes)
    await enqueue_extraction(store, jobs, 7, limiter)
    await jobs.drain()
    assert await store.load_report(7) is None and await memory.exists("user:7:status") == 0

    await memory.delete(*[k.decode() async for k in memory.scan_iter("cooldown:*")])
    monkeypatch.setattr("app.worker.extract", lambda *_a, **_kw: _report())
    await enqueue_extraction(store, jobs, 7, limiter)
    await jobs.drain()
    assert await store.load_report(7) == {"page": "web"}


async def _report():
    return {"page": "web"}


async def test_a_timed_out_extraction_does_not_stay_running(settings, monkeypatch):
    _, store, jobs, limiter = setup(settings, timeout=0.2)

    async def too_slow(*_a, **_kw):
        await asyncio.sleep(5)
    monkeypatch.setattr("app.worker.extract", too_slow)
    await enqueue_extraction(store, jobs, 7, limiter)
    await jobs.drain()
    assert (await store.status(7))["state"] == "failed"


async def test_a_deferred_job_waits_for_its_time(settings):
    _, store, jobs, _ = setup(settings)
    await jobs.enqueue_job("extract_job", 7, _job_id=JOB_ID.format(7), _defer_by=0.2)
    assert jobs.queued() == [JOB_ID.format(7)]
    await asyncio.sleep(0.05)
    assert (await store.status(7))["state"] == "none"
    await jobs.drain()
    assert (await store.status(7))["state"] == "failed"


def test_the_worker_logs_at_info_level():
    from app.worker import log
    assert log.isEnabledFor(logging.INFO)
