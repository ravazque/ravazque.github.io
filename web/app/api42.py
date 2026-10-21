"""42 API v2 client: the app's client-credentials token, the shared rate limiter, retries, pagination."""
import asyncio

import httpx

API = "https://api.intra.42.fr"
CDN = "https://cdn.intra.42.fr/"
TOKEN_KEY = "api42:token"
PAGE_SIZE = 100
RETRIES = 4


class Api42Error(Exception):
    def __init__(self, status: int, path: str):
        super().__init__(f"42 API {status} on {path}")
        self.status, self.path = status, path


class Api42:
    def __init__(self, settings, redis, http: httpx.AsyncClient, limiter, sleep=asyncio.sleep):
        self.settings, self.redis, self.http, self.limiter, self.sleep = settings, redis, http, limiter, sleep
        self.requests = 0  # API calls made through this client (the worker logs it per extraction)

    async def app_token(self, refresh: bool = False) -> str:
        if not refresh and (cached := await self.redis.get(TOKEN_KEY)):
            return cached.decode()
        r = await self.http.post(f"{API}/oauth/token", data={
            "grant_type": "client_credentials", "client_id": self.settings.ft_uid, "client_secret": self.settings.ft_secret}, timeout=30)
        if r.status_code != 200:
            raise Api42Error(r.status_code, "/oauth/token")
        body = r.json()
        await self.redis.set(TOKEN_KEY, body["access_token"], ex=max(int(body.get("expires_in", 7200)) - 60, 60))
        return body["access_token"]

    async def _get(self, path: str, params: dict | None = None, user_token: str | None = None) -> httpx.Response:
        token = user_token or await self.app_token()
        reauthed = False
        for attempt in range(RETRIES + 1):
            await self.limiter.acquire()
            self.requests += 1
            r = await self.http.get(API + path, params=params, headers={"Authorization": f"Bearer {token}"}, timeout=60)
            await self.limiter.record(r.headers)
            if r.status_code == 401 and user_token is None and not reauthed:
                token, reauthed = await self.app_token(refresh=True), True
                continue
            if r.status_code == 429 or r.status_code >= 500:
                if attempt == RETRIES:
                    raise Api42Error(r.status_code, path)
                await self.sleep(float(r.headers.get("Retry-After") or 2 ** attempt))
                continue
            if r.status_code >= 400:
                raise Api42Error(r.status_code, path)
            return r
        raise Api42Error(401, path)

    async def get(self, path: str, **params):
        return (await self._get(path, params or None)).json()

    async def get_all(self, path: str, **params) -> list:
        items, page = [], 1
        while True:
            r = await self._get(path, {**params, "page[size]": PAGE_SIZE, "page[number]": page})
            batch = r.json()
            items.extend(batch)
            total = int(r.headers.get("X-Total") or 0)
            if len(batch) < PAGE_SIZE or (total and len(items) >= total):
                return items
            page += 1

    async def exchange_code(self, code: str) -> str:
        """The signed-in user's access token. Used once to read /v2/me, never stored."""
        await self.limiter.acquire()
        r = await self.http.post(f"{API}/oauth/token", data={
            "grant_type": "authorization_code", "client_id": self.settings.ft_uid, "client_secret": self.settings.ft_secret,
            "code": code, "redirect_uri": f"{self.settings.base_url}/auth/callback"}, timeout=30)
        if r.status_code != 200:
            raise Api42Error(r.status_code, "/oauth/token")
        return r.json()["access_token"]

    async def me(self, user_token: str) -> dict:
        return (await self._get("/v2/me", user_token=user_token)).json()

    async def avatar(self, url: str) -> tuple[bytes, str]:
        """A profile photo from the intra CDN, which only serves them with an API token."""
        if not url.startswith(CDN):  # the app token goes with the request
            raise Api42Error(400, "avatar")
        token = await self.app_token()
        await self.limiter.acquire()  # the CDN counts against the same 2 requests per second
        r = await self.http.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
        if r.status_code != 200:
            raise Api42Error(r.status_code, "avatar")
        return r.content, r.headers.get("content-type", "image/jpeg")
