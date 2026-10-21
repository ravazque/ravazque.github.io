"""What the web keeps per user in Redis: the analysed report, the extraction status and the refresh cooldown."""
import hashlib
import hmac
import json
import time

from arq.constants import default_queue_name, job_key_prefix

DATA = "user:{}:data"
STATUS = "user:{}:status"
LOCK = "lock:extract:{}"
COOLDOWN = "cooldown:{}"
DELETED = "deleted:{}"   # set by "Delete my data" for the length of a job, keyed like the cooldown
JOB_ID = "extract:{}"


class Store:
    def __init__(self, redis, settings):
        self.redis, self.settings = redis, settings

    def _digest(self, uid) -> str:
        # an HMAC of the id: keys that survive "delete my data" without naming the user
        return hmac.new(self.settings.session_secret.encode(), str(uid).encode(), hashlib.sha256).hexdigest()

    def _cooldown_key(self, uid) -> str:
        return COOLDOWN.format(self._digest(uid))

    def deleted_key(self, uid) -> str:
        return DELETED.format(self._digest(uid))

    async def save_report(self, uid, data: dict):
        await self.redis.set(DATA.format(uid), json.dumps(data, ensure_ascii=False, separators=(",", ":")), ex=self.settings.retention_s)

    async def load_report(self, uid) -> dict | None:
        raw = await self.redis.get(DATA.format(uid))
        if raw is None:
            return None
        await self.redis.expire(DATA.format(uid), self.settings.retention_s)
        await self.redis.expire(STATUS.format(uid), self.settings.retention_s)
        return json.loads(raw)

    async def set_status(self, uid, **fields):
        await self.redis.hset(STATUS.format(uid), mapping={k: json.dumps(v) for k, v in fields.items()})
        await self.redis.expire(STATUS.format(uid), self.settings.retention_s)

    async def status(self, uid) -> dict:
        raw = await self.redis.hgetall(STATUS.format(uid))
        s = {"state": "none", "progress": 0, "message": None, "last": None}
        s.update({k.decode(): json.loads(v) for k, v in raw.items()})
        s["message"] = s["message"] or None
        s["next_refresh_in"] = await self.refresh_wait(uid)
        return s

    async def refresh_wait(self, uid) -> int:
        ttl = await self.redis.ttl(self._cooldown_key(uid))
        return max(int(ttl), 0)

    async def start_cooldown(self, uid, started_at: float | None = None):
        """The hour counts from the start of the extraction that succeeded."""
        elapsed = time.time() - started_at if started_at else 0
        await self.redis.set(self._cooldown_key(uid), 1, ex=max(int(self.settings.cooldown_s - elapsed), 1))

    async def try_lock(self, uid) -> bool:
        return bool(await self.redis.set(LOCK.format(uid), 1, nx=True, ex=900))

    async def unlock(self, uid):
        await self.redis.delete(LOCK.format(uid))

    async def delete_user(self, uid):
        """Remove everything about the user, a queued extraction included. A running one finds the marker and saves nothing."""
        job = JOB_ID.format(uid)
        await self.redis.delete(DATA.format(uid), STATUS.format(uid), LOCK.format(uid), job_key_prefix + job)
        await self.redis.zrem(default_queue_name, job)
        await self.redis.set(self.deleted_key(uid), 1, ex=900)

    async def drop_report(self, uid):
        await self.redis.delete(DATA.format(uid))

    async def deleted(self, uid) -> bool:
        return bool(await self.redis.exists(self.deleted_key(uid)))

    async def clear_refusal(self, uid):
        """Access is back (signed in again): drop the refused status and its cooldown so the extraction can run."""
        if (await self.status(uid))["state"] == "refused":
            await self.redis.delete(STATUS.format(uid), self._cooldown_key(uid))

    async def forget_status(self, uid):
        await self.redis.delete(STATUS.format(uid))


async def enqueue_extraction(store: Store, arq_pool, uid, limiter) -> dict:
    """Start an extraction unless one is running or the hour has not passed. Always returns the status."""
    if not await store.try_lock(uid):
        return await store.status(uid)
    if await store.refresh_wait(uid) > 0:
        await store.unlock(uid)
        return await store.status(uid)
    await store.redis.delete(store.deleted_key(uid))  # coming back after "Delete my data": this extraction may save again
    kw = {"_job_id": JOB_ID.format(uid)}
    message = ""
    if not await limiter.budget_ok():
        # the hourly API budget is nearly spent: run when it resets, at the next full hour
        kw["_defer_by"] = max(int(3600 - time.time() % 3600), 1)
        message = "status.budget"
    await store.set_status(uid, state="queued", progress=0, message=message)
    # None only means a job with this id is still waiting (keep_result = 0 in WorkerSettings): "queued" stays true
    await arq_pool.enqueue_job("extract_job", uid, **kw)
    return await store.status(uid)


async def first_extraction(app, uid, _me):
    """Sign-in hook: the first sign-in starts the first extraction; later ones show what is stored."""
    store = Store(app.state.redis, app.state.settings)
    if await store.load_report(uid) is None:
        await enqueue_extraction(store, app.state.arq, uid, app.state.limiter)
