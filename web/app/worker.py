"""arq worker: runs extractions one at a time through the shared rate limiter."""
import logging
import time
from datetime import datetime, timezone

import httpx
from arq.connections import RedisSettings

from .api42 import Api42, Api42Error
from .extract import AccessRefused, extract
from .limiter import RateLimiter
from .redis import make_redis
from .settings import Settings
from .store import Store

log = logging.getLogger("ravazque.worker")
log.setLevel(logging.INFO)  # arq configures only its own logger: without this the per-extraction request count is dropped
if not logging.getLogger().handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s: %(message)s", "%H:%M:%S"))
    log.addHandler(_handler)


def _requests(api) -> int:
    count = getattr(api, "requests", 0)
    return count if isinstance(count, int) else 0


async def extract_job(ctx, uid: int):
    store = ctx["store"]
    started = time.time()
    await store.set_status(uid, state="running", progress=0, message="")

    async def progress(fraction):
        if not await store.deleted(uid):
            await store.set_status(uid, progress=round(fraction, 3))

    before = _requests(ctx["api"])
    try:
        data = await extract(ctx["api"], uid, progress=progress)
        log.info("extraction for user %s: %s API requests in %.0f s", uid, _requests(ctx["api"]) - before, time.time() - started)
        await store.start_cooldown(uid, started_at=started)
        if await store.deleted(uid):  # "Delete my data" while the job ran: keep nothing
            return
        await store.save_report(uid, data)
        await store.set_status(uid, state="done", progress=1, message="", last=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    except AccessRefused as refused:  # no longer allowed: drop what is stored and say why
        await store.drop_report(uid)
        await store.start_cooldown(uid, started_at=started)
        await store.set_status(uid, state="refused", message=refused.args[0])
    except Exception as exc:  # any failure keeps the old report and does not spend the hour
        log.warning("extraction failed for user %s after %s API requests: %s", uid, _requests(ctx["api"]) - before,
                    exc if isinstance(exc, Api42Error) else type(exc).__name__)
        await store.set_status(uid, state="failed", message="status.failed")
    finally:
        # a job timeout cancels the coroutine (not an Exception): never leave the status on "running"
        if (await store.status(uid))["state"] == "running":
            await store.set_status(uid, state="failed", message="status.failed")
        if await store.deleted(uid):
            await store.forget_status(uid)
        await store.unlock(uid)


async def startup(ctx):
    settings = Settings.from_env().check()
    redis = make_redis(settings.redis_url)
    ctx["http"] = httpx.AsyncClient()
    ctx["store"] = Store(redis, settings)
    ctx["api"] = Api42(settings, redis, ctx["http"], RateLimiter(redis))


async def shutdown(ctx):
    await ctx["http"].aclose()


class WorkerSettings:
    functions = [extract_job]
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 1
    job_timeout = 900
    # arq refuses a job whose id still has a stored result (kept 1 h by default): with extract:{uid} as the id,
    # a retry or the next hourly refresh would be silently dropped. Results are never read, so keep none.
    keep_result = 0
    redis_settings = RedisSettings.from_dsn(Settings.from_env().redis_url)
