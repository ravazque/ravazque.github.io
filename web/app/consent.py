"""Proof that someone accepted the privacy policy: a keyed hash of their 42 id, the version and the date, kept for two
years after their last sign-in. It names nobody and survives "Delete my data". It is the one thing written to disk
(CONSENT_LOG, one JSON line per acceptance, pruned at start-up), so the proof outlives restarts."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

VERSION, UPDATED = 2, "2026-10-25"
KEY = "consent:{}"
KEEP_S = 2 * 365 * 86400


def _remember(memory, h, entry, ttl):
    return memory.set(KEY.format(h), json.dumps({"v": entry["v"], "at": entry["at"]}), ex=ttl)


async def record(store, uid):
    h = store._digest(uid)
    entry = {"h": h, "v": VERSION, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    await _remember(store.memory, h, entry, KEEP_S)
    if store.settings.consent_log:
        with open(store.settings.consent_log, "a", encoding="utf-8") as log:
            log.write(json.dumps(entry) + "\n")


async def is_current(store, uid) -> bool:
    raw = await store.memory.get(KEY.format(store._digest(uid)))
    return raw is not None and json.loads(raw).get("v") == VERSION


async def load(memory, settings):
    """At start-up: drop entries older than two years from the log and bring the rest back into memory."""
    path = Path(settings.consent_log) if settings.consent_log else None
    if not path or not path.exists():
        return
    now, kept = datetime.now(timezone.utc), []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            entry = json.loads(line)
            age = now - datetime.fromisoformat(entry["at"])
        except (ValueError, KeyError):
            continue
        if age < timedelta(seconds=KEEP_S):
            kept.append(entry)
    path.write_text("".join(json.dumps(e) + "\n" for e in kept), encoding="utf-8")
    for e in kept:  # the latest line per person wins, as in memory
        await _remember(memory, e["h"], e, KEEP_S - int((now - datetime.fromisoformat(e["at"])).total_seconds()))
