import httpx
import pytest

from app.main import create_app
from app.settings import Settings


@pytest.fixture
def settings():
    return Settings(base_url="https://localhost", ft_uid="UID", ft_secret="SECRET", session_secret="s" * 32,
                    contact_email="owner@example.invalid", controller_name="Owner Example (owner)",
                    issues_url="https://github.com/example/logbook/issues/new/choose")


@pytest.fixture
def memory():
    from app.memory import Memory
    return Memory()


class FakeJobs:
    """Records what would run; nothing runs."""

    def __init__(self):
        self.enqueued, self.kwargs, self.cancelled = [], [], []
        self.running = None

    async def enqueue_job(self, name, *args, **kw):
        self.enqueued.append(name); self.kwargs.append(kw)

    def cancel(self, job_id):
        self.cancelled.append(job_id)

    def queued(self):
        return []


@pytest.fixture
def jobs():
    return FakeJobs()


@pytest.fixture
async def app(settings, memory, jobs):
    return create_app(settings, memory, jobs=jobs)


@pytest.fixture
async def client(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://localhost") as c:
        yield c


@pytest.fixture
def mock42():
    import respx

    from helpers import Mock42
    with respx.mock(assert_all_called=False) as router:
        router.route(host="localhost").pass_through()
        yield Mock42(router)


class SignedIn:
    """A client with a session, as after a successful sign-in."""

    def __init__(self, client, uid, csrf, coalition_color):
        self.client, self.uid, self.coalition_color = client, uid, coalition_color
        self.csrf = {"X-CSRF-Token": csrf}

    def __getattr__(self, name):
        return getattr(self.client, name)


@pytest.fixture
async def signed_in(client, memory, settings):
    from app.sessions import COOKIE, SessionStore
    sid = await SessionStore(memory, settings).create({"id": 7, "login": "ana", "name": "Ana", "coalition_color": "#3E7BC8",
                                                      "image": "https://cdn.intra.42.fr/users/a/medium_ana.jpg"})
    client.cookies.set(COOKIE, sid)
    csrf = (await SessionStore(memory, settings).get(sid))["csrf"]
    from app import consent
    from app.store import Store
    await consent.record(Store(memory, settings), 7)
    return SignedIn(client, 7, csrf, "#3E7BC8")
