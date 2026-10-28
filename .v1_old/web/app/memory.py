"""The app's only store: process memory with expiry, nothing written to disk. It speaks the small subset of the Redis
API the app uses (strings, counters, hashes, patterns), so sessions, cooldowns and limits keep their logic."""
import fnmatch
import time


def _b(v) -> bytes:
    return v if isinstance(v, bytes) else str(v).encode()


def _k(key) -> str:
    return key.decode() if isinstance(key, bytes) else key


class Memory:
    def __init__(self, now=time.monotonic):
        self.now, self.data, self.expiry = now, {}, {}

    def _live(self, key: str) -> bool:
        exp = self.expiry.get(key)
        if exp is not None and exp <= self.now():
            self.data.pop(key, None)
            self.expiry.pop(key, None)
        return key in self.data

    def sweep(self):
        for key in list(self.expiry):
            self._live(key)

    def size(self) -> int:
        return len(self.data)

    async def get(self, key):
        key = _k(key)
        return self.data[key] if self._live(key) and isinstance(self.data[key], bytes) else None

    async def set(self, key, value, ex=None, nx=False):
        key = _k(key)
        if nx and self._live(key):
            return None
        self.data[key] = _b(value)
        self.expiry.pop(key, None)
        if ex is not None:
            self.expiry[key] = self.now() + ex
        return True

    async def delete(self, *keys) -> int:
        keys = [_k(k) for k in keys]
        gone = sum(1 for k in keys if self._live(k))
        for k in keys:
            self.data.pop(k, None)
            self.expiry.pop(k, None)
        return gone

    async def exists(self, key) -> int:
        key = _k(key)
        return int(self._live(key))

    async def expire(self, key, seconds) -> bool:
        key = _k(key)
        if not self._live(key):
            return False
        self.expiry[key] = self.now() + seconds
        return True

    async def ttl(self, key) -> int:
        key = _k(key)
        if not self._live(key):
            return -2
        exp = self.expiry.get(key)
        return -1 if exp is None else max(int(round(exp - self.now())), 0)

    async def incr(self, key) -> int:
        key = _k(key)
        value = int(self.data[key]) + 1 if self._live(key) else 1
        self.data[key] = _b(value)
        return value

    async def hset(self, key, mapping) -> int:
        key = _k(key)
        h = self.data[key] if self._live(key) and isinstance(self.data[key], dict) else {}
        h.update({_b(k): _b(v) for k, v in mapping.items()})
        self.data[key] = h
        return len(mapping)

    async def hgetall(self, key) -> dict:
        key = _k(key)
        return dict(self.data[key]) if self._live(key) and isinstance(self.data[key], dict) else {}

    async def keys(self, pattern="*") -> list:
        return [k.encode() for k in list(self.data) if self._live(k) and fnmatch.fnmatchcase(k, pattern)]

    async def scan_iter(self, match="*"):
        for k in await self.keys(match):
            yield k

    async def ping(self) -> bool:
        return True
