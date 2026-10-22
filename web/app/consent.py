"""Proof that someone accepted the privacy policy: a keyed hash of their 42 id, the version and the date, kept for two
years after their last sign-in. It names nobody and survives "Delete my data"."""
import json
from datetime import datetime, timezone

VERSION, UPDATED = 1, "2026-10-22"
KEY = "consent:{}"
KEEP_S = 2 * 365 * 86400


async def record(store, uid):
    entry = {"v": VERSION, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    await store.redis.set(KEY.format(store._digest(uid)), json.dumps(entry), ex=KEEP_S)


async def is_current(store, uid) -> bool:
    raw = await store.redis.get(KEY.format(store._digest(uid)))
    return raw is not None and json.loads(raw).get("v") == VERSION
