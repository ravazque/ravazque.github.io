import httpx
import pytest
import respx

from app.api42 import API, Api42, Api42Error
from app.limiter import RateLimiter


async def no_sleep(_):
    return None


@pytest.fixture
async def api(settings, memory):
    async with httpx.AsyncClient() as http:
        yield Api42(settings, memory, http, RateLimiter(memory, sleep=no_sleep), sleep=no_sleep)


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
async def test_token_cached_in_redis(api, memory):
    token_route()
    respx.get(f"{API}/v2/me").respond(json={"id": 1})
    await api.get("/v2/me")
    assert await memory.get("api42:token:0") == b"T"
    assert 0 < await memory.ttl("api42:token:0") <= 7140


@respx.mock
async def test_401_reauthenticates_once(api, memory):
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
async def test_records_rate_limit_headers(api, memory):
    token_route()
    respx.get(f"{API}/v2/me").respond(json={}, headers={"x-hourly-ratelimit-remaining": "12"})
    await api.get("/v2/me")
    assert int(await memory.get("rl:hourly:0")) == 12


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


@respx.mock
async def test_a_slow_answer_is_retried_like_a_server_error(api):
    token_route()
    route = respx.get(f"{API}/v2/users/1/scale_teams").mock(side_effect=[httpx.ReadTimeout("slow"), httpx.Response(200, json=[{"id": 9}])])
    assert await api.get("/v2/users/1/scale_teams") == [{"id": 9}]
    assert route.call_count == 2


@respx.mock
async def test_a_network_that_never_answers_ends_in_an_api_error_without_ids(api):
    token_route()
    respx.get(f"{API}/v2/users/192183/scale_teams").mock(side_effect=httpx.ConnectTimeout("down"))
    with pytest.raises(Api42Error) as err:
        await api.get("/v2/users/192183/scale_teams")
    assert err.value.status == 0 and "192183" not in str(err.value) and "/v2/users/:id/scale_teams" in str(err.value)


@respx.mock
async def test_requests_spread_over_both_apps_each_with_its_token(memory):
    from app.settings import Settings
    s = Settings(ft_uid="A1", ft_secret="S1", ft_uid_2="A2", ft_secret_2="S2", session_secret="x" * 32)
    respx.post(f"{API}/oauth/token").mock(side_effect=lambda req: httpx.Response(
        200, json={"access_token": "TA" if b"client_id=A1" in req.content else "TB", "expires_in": 7200}))
    route = respx.get(f"{API}/v2/me").respond(json={"id": 1})
    async with httpx.AsyncClient() as http:
        api = Api42(s, memory, http, RateLimiter(memory, apps=len(s.apps), sleep=no_sleep), sleep=no_sleep)
        for _ in range(4):
            await api.get("/v2/me")
    assert {c.request.headers["Authorization"] for c in route.calls} == {"Bearer TA", "Bearer TB"}
    assert await memory.get("api42:token:0") == b"TA" and await memory.get("api42:token:1") == b"TB"
