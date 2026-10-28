"""The extraction job run by jobs.Jobs inside the web process."""
import logging
import time
from datetime import datetime, timezone

from .api42 import Api42, Api42Error
from .extract import AccessRefused, extract

log = logging.getLogger("ravazque.worker")
log.setLevel(logging.INFO)  # without a level the per-extraction request count is dropped
if not logging.getLogger().handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s: %(message)s", "%H:%M:%S"))
    log.addHandler(_handler)


def _requests(api) -> int:
    count = getattr(api, "requests", 0)
    return count if isinstance(count, int) else 0


async def extract_job(ctx, uid: int):
    store, stats = ctx["store"], ctx.get("stats")
    started = time.time()
    await store.set_status(uid, state="running", progress=0, message="")

    async def progress(fraction):
        if not await store.deleted(uid):
            await store.set_status(uid, progress=round(fraction, 3))

    before = _requests(ctx["api"])
    try:
        data = await extract(ctx["api"], uid, progress=progress)
        log.info("extraction for user %s: %s API requests in %.0f s", uid, _requests(ctx["api"]) - before, time.time() - started)
        if stats:
            stats.extraction(_requests(ctx["api"]) - before, time.time() - started, ok=True)
        await store.start_cooldown(uid, started_at=started)
        if await store.deleted(uid):  # "Delete my data" while the job ran: keep nothing
            return
        await store.save_report(uid, data)
        await store.set_status(uid, state="done", progress=1, message="", last=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    except AccessRefused as refused:  # no longer allowed: drop what is stored and say why
        if stats:
            stats.deny()
        await store.drop_report(uid)
        await store.start_cooldown(uid, started_at=started)
        await store.set_status(uid, state="refused", message=refused.args[0])
    except Exception as exc:  # any failure keeps the old report and does not spend the hour
        log.warning("extraction failed for user %s after %s API requests: %s", uid, _requests(ctx["api"]) - before,
                    exc if isinstance(exc, Api42Error) else type(exc).__name__)
        if stats:
            stats.extraction(_requests(ctx["api"]) - before, time.time() - started, ok=False)
        await store.set_status(uid, state="failed", message="status.failed")
    finally:
        # a job timeout cancels the coroutine (not an Exception): never leave the status on "running"
        if (await store.status(uid))["state"] == "running":
            if stats:
                stats.extraction(_requests(ctx["api"]) - before, time.time() - started, ok=False, timeout=True)
            await store.set_status(uid, state="failed", message="status.failed")
        if await store.deleted(uid):
            await store.forget_status(uid)
        await store.unlock(uid)
