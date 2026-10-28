"""The in-process store that replaces Redis: values, expiry, counters, hashes and patterns, nothing on disk."""
from app.memory import Memory


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


async def test_values_come_back_as_bytes_and_expire():
    clock = Clock()
    m = Memory(now=clock)
    await m.set("a", "x", ex=10)
    assert await m.get("a") == b"x" and await m.ttl("a") == 10
    clock.t += 10
    assert await m.get("a") is None and await m.ttl("a") == -2


async def test_set_nx_only_once_and_incr_counts():
    m = Memory()
    assert await m.set("lock", 1, nx=True, ex=60) and not await m.set("lock", 1, nx=True, ex=60)
    assert [await m.incr("n") for _ in range(3)] == [1, 2, 3]
    assert await m.ttl("n") == -1


async def test_hashes_merge_fields():
    m = Memory()
    await m.hset("h", mapping={"a": "1"})
    await m.hset("h", mapping={"b": "2"})
    assert await m.hgetall("h") == {b"a": b"1", b"b": b"2"}


async def test_keys_match_patterns_and_delete_counts():
    m = Memory()
    for k in ("rl:sec:1", "rl:sec:2", "sess:x"):
        await m.set(k, 1)
    assert sorted(await m.keys("rl:*")) == [b"rl:sec:1", b"rl:sec:2"]
    assert [k async for k in m.scan_iter("sess:*")] == [b"sess:x"]
    assert await m.delete("rl:sec:1", "nope") == 1 and await m.exists("rl:sec:1") == 0


async def test_expired_keys_are_swept():
    clock = Clock()
    m = Memory(now=clock)
    await m.set("a", 1, ex=1)
    clock.t += 2
    m.sweep()
    assert m.size() == 0


async def test_keys_listed_as_bytes_can_be_used_again():
    m = Memory()
    await m.set("sess:x", 1)
    for k in await m.keys("sess:*"):
        await m.delete(k)
    assert m.size() == 0
