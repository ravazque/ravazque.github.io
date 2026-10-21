import httpx
import pytest
import respx

from app.api42 import API, Api42, Api42Error
from app.limiter import RateLimiter


async def no_sleep(_):
    return None


@pytest.fixture
async def api(settings, redis):
    async with httpx.AsyncClient() as http:
        yield Api42(settings, redis, http, RateLimiter(redis, sleep=no_sleep), sleep=no_sleep)


def token_route():
    return respx.post(f"{API}/oauth/token").respond(json={"access_token": "T", "expires_in": 7200})


@respx.mock
async def test_get_all_paginates_and_reuses_token(api):
    tok = token_route()
    route = respx.get(f"{API}/v2/users/1/locations").mock(side_effect=[
        httpx.Response(200, json=[{}] * 100, headers={"X-Total": "150"}),
        httpx.Response(200, json=[{}] * 50, headers={"X-Total": "150"})])
    assert len(await api.get_all("/v2/users/1/locations")) == 150
    assert route.calls[0].request.headers["Authorization"] == "Bearer T"
    assert route.calls[1].request.url.params["page[number]"] == "2"
    assert tok.call_count == 1


@respx.mock
async def test_token_cached_in_redis(api, redis):
    token_route()
    respx.get(f"{API}/v2/me").respond(json={"id": 1})
    await api.get("/v2/me")
    assert await redis.get("api42:token") == b"T"
    assert 0 < await redis.ttl("api42:token") <= 7140


@respx.mock
async def test_401_reauthenticates_once(api, redis):
    tok = respx.post(f"{API}/oauth/token").mock(side_effect=[
        httpx.Response(200, json={"access_token": "OLD", "expires_in": 7200}),
        httpx.Response(200, json={"access_token": "NEW", "expires_in": 7200})])
    route = respx.get(f"{API}/v2/me").mock(side_effect=[httpx.Response(401), httpx.Response(200, json={"id": 1})])
    assert await api.get("/v2/me") == {"id": 1}
    assert route.calls[1].request.headers["Authorization"] == "Bearer NEW" and tok.call_count == 2


@respx.mock
async def test_5xx_storm_raises_after_retries(api):
    token_route()
    route = respx.get(f"{API}/v2/me").respond(503)
    with pytest.raises(Api42Error) as err:
        await api.get("/v2/me")
    assert err.value.status == 503 and route.call_count == 5


@respx.mock
async def test_records_rate_limit_headers(api, redis):
    token_route()
    respx.get(f"{API}/v2/me").respond(json={}, headers={"x-hourly-ratelimit-remaining": "12"})
    await api.get("/v2/me")
    assert int(await redis.get("rl:hourly")) == 12


@respx.mock
async def test_exchange_code_and_me_use_the_user_token(api):
    respx.post(f"{API}/oauth/token").respond(json={"access_token": "USER", "expires_in": 7200})
    me = respx.get(f"{API}/v2/me").respond(json={"id": 7})
    tok = await api.exchange_code("CODE")
    assert tok == "USER" and await api.me(tok) == {"id": 7}
    assert me.calls[0].request.headers["Authorization"] == "Bearer USER"


@respx.mock
async def test_every_api_request_is_counted(api):
    token_route()
    respx.get(f"{API}/v2/users/1/locations").mock(side_effect=[
        httpx.Response(200, json=[{}] * 100, headers={"X-Total": "150"}),
        httpx.Response(200, json=[{}] * 50, headers={"X-Total": "150"})])
    await api.get_all("/v2/users/1/locations")
    assert api.requests == 2
