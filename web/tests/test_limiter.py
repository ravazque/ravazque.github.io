import pytest

from app.limiter import RateLimiter


class Clock:
    def __init__(self, t=1000.25):
        self.t, self.sleeps = t, []

    def now(self):
        return self.t

    async def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


@pytest.fixture
def clock():
    return Clock()


async def test_limiter_caps_two_per_second(redis, clock):
    lim = RateLimiter(redis, now=clock.now, sleep=clock.sleep)
    for _ in range(2):
        await lim.acquire()
    assert clock.sleeps == []
    await lim.acquire()
    assert clock.sleeps and 0 < clock.sleeps[0] <= 1.0


async def test_limit_is_shared_between_instances(redis, clock):
    a, b = RateLimiter(redis, now=clock.now, sleep=clock.sleep), RateLimiter(redis, now=clock.now, sleep=clock.sleep)
    await a.acquire(); await b.acquire(); await b.acquire()
    assert len(clock.sleeps) == 1


async def test_records_hourly_budget(redis):
    lim = RateLimiter(redis)
    assert await lim.budget_ok() is True
    await lim.record({"x-hourly-ratelimit-remaining": "40"})
    assert await lim.budget_ok() is False
    await lim.record({"x-hourly-ratelimit-remaining": "900"})
    assert await lim.budget_ok() is True
