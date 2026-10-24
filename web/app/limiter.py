"""The request budget of every 42 app this server holds (2 per second and a reported hourly budget, per app): each
request takes a free slot from whichever app has one, so two apps carry twice the load."""
import asyncio
import math
import time

SECOND_KEY = "rl:sec:{}:{}"
HOURLY_KEY = "rl:hourly:{}"


class RateLimiter:
    def __init__(self, memory, apps: int = 1, per_second: int = 2, hourly_floor: int = 50, now=time.time, sleep=asyncio.sleep):
        self.memory, self.apps, self.per_second, self.hourly_floor = memory, max(apps, 1), per_second, hourly_floor
        self.now, self.sleep = now, sleep
        self.turn = 0

    async def _has_budget(self, app: int) -> bool:
        remaining = await self.memory.get(HOURLY_KEY.format(app))
        return remaining is None or int(remaining) >= self.hourly_floor

    async def acquire(self, app: int | None = None) -> int:
        """Wait for a free slot in this second and return the app it belongs to; `app` pins one (a user token belongs
        to the app that issued it). Apps short of their hourly budget are left aside while another one has some."""
        while True:
            t = self.now()
            order = [app] if app is not None else [(self.turn + i) % self.apps for i in range(self.apps)]
            if app is None:
                usable = [a for a in order if await self._has_budget(a)]
                order = usable or order
            for a in order:
                key = SECOND_KEY.format(a, int(t))
                count = await self.memory.incr(key)
                if count == 1:
                    await self.memory.expire(key, 2)
                if count <= self.per_second:
                    self.turn = (a + 1) % self.apps
                    return a
            await self.sleep(max(math.floor(t) + 1 - t, 0.01))

    async def record(self, headers, app: int = 0):
        """Remember the hourly budget the API reports for that app, until the next full hour."""
        remaining = headers.get("x-hourly-ratelimit-remaining")
        if remaining is None:
            return
        ttl = max(int(3600 - self.now() % 3600), 1)
        await self.memory.set(HOURLY_KEY.format(app), int(remaining), ex=ttl)

    async def budget_ok(self) -> bool:
        """True while at least one app has budget left this hour."""
        for a in range(self.apps):
            if await self._has_budget(a):
                return True
        return False
