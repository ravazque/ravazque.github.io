"""The one Redis client of the app (sessions, data, cooldowns, rate limit, job queue)."""
from redis.asyncio import Redis


def make_redis(url: str) -> Redis:
    return Redis.from_url(url, decode_responses=False)
