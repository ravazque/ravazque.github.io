"""One request budget for every process that talks to the 42 API (api, worker): it is per application."""
import asyncio
import math
import time

SECOND_KEY = "rl:sec:{}"
HOURLY_KEY = "rl:hourly"


class RateLimiter:
    def __init__(self, redis, per_second: int = 2, hourly_floor: int = 50, now=time.time, sleep=asyncio.sleep):
        self.redis, self.per_second, self.hourly_floor = redis, per_second, hourly_floor
        self.now, self.sleep = now, sleep

    async def acquire(self):
        """Wait until this second's shared window has room (42 allows 2 requests per second per app)."""
        while True:
            t = self.now()
            key = SECOND_KEY.format(int(t))
            count = await self.redis.incr(key)
            if count == 1:
                await self.redis.expire(key, 2)
            if count <= self.per_second:
                return
            await self.sleep(max(math.floor(t) + 1 - t, 0.01))

    async def record(self, headers):
        """Remember the hourly budget the API reports, until the next full hour."""
        remaining = headers.get("x-hourly-ratelimit-remaining")
        if remaining is None:
            return
        ttl = max(int(3600 - self.now() % 3600), 1)
        await self.redis.set(HOURLY_KEY, int(remaining), ex=ttl)

    async def budget_ok(self) -> bool:
        remaining = await self.redis.get(HOURLY_KEY)
        return remaining is None or int(remaining) >= self.hourly_floor
