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


async def test_limiter_caps_two_per_second(memory, clock):
    lim = RateLimiter(memory, now=clock.now, sleep=clock.sleep)
    for _ in range(2):
        await lim.acquire()
    assert clock.sleeps == []
    await lim.acquire()
    assert clock.sleeps and 0 < clock.sleeps[0] <= 1.0


async def test_limit_is_shared_between_instances(memory, clock):
    a, b = RateLimiter(memory, now=clock.now, sleep=clock.sleep), RateLimiter(memory, now=clock.now, sleep=clock.sleep)
    await a.acquire(); await b.acquire(); await b.acquire()
    assert len(clock.sleeps) == 1


async def test_records_hourly_budget(memory):
    lim = RateLimiter(memory)
    assert await lim.budget_ok() is True
    await lim.record({"x-hourly-ratelimit-remaining": "40"})
    assert await lim.budget_ok() is False
    await lim.record({"x-hourly-ratelimit-remaining": "900"})
    assert await lim.budget_ok() is True


async def test_two_apps_double_the_rate_and_share_the_turns(memory, clock):
    lim = RateLimiter(memory, apps=2, now=clock.now, sleep=clock.sleep)
    got = [await lim.acquire() for _ in range(4)]
    assert clock.sleeps == [] and sorted(got) == [0, 0, 1, 1]
    assert await lim.acquire(app=0) == 0 and clock.sleeps  # a pinned app waits for its own window


async def test_an_app_out_of_hourly_budget_is_left_aside(memory, clock):
    lim = RateLimiter(memory, apps=2, now=clock.now, sleep=clock.sleep)
    await lim.record({"x-hourly-ratelimit-remaining": "10"}, app=0)
    assert [await lim.acquire() for _ in range(2)] == [1, 1]
    assert await lim.budget_ok() is True
    await lim.record({"x-hourly-ratelimit-remaining": "10"}, app=1)
    assert await lim.budget_ok() is False
