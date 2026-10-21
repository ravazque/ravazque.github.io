"""Save a real light extraction as preview/data.json, the input of scripts/snapshot.py.

    python scripts/preview.py --fetch UID   run the extraction for UID with the app token from .env (about 100 requests)
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # the web app package


OUT = Path(__file__).resolve().parent.parent / "preview"


async def fetch(uid: int):
    import httpx

    from app.api42 import Api42
    from app.extract import extract
    from app.limiter import RateLimiter
    from app.redis import make_redis
    from app.settings import Settings
    settings = Settings.from_env()
    redis = make_redis(settings.redis_url)
    async with httpx.AsyncClient() as http:
        api = Api42(settings, redis, http, RateLimiter(redis))
        async def progress(f):
            print(f"\r  {round(100 * f)}%", end="", flush=True)
        data = await extract(api, uid, progress)
    print()
    return data


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fetch", type=int, metavar="UID", required=True)
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    (OUT / "data.json").write_text(json.dumps(asyncio.run(fetch(args.fetch)), ensure_ascii=False))
    print("preview/data.json")
