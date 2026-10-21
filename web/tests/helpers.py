"""Fake 42 for auth tests: respx routes that answer like the intra for a chosen profile."""
import httpx
import respx

from app.api42 import API

PROFILES = {
    "student": {},
    "transcender": {"grade": "Transcender"},
    "alumni": {"grade": "Alumni"},
    "staff": {"staff?": True},
    "pisciner": {"main": None},
    "blackholed": {"end": "2026-01-01T00:00:00Z"},
    "frozen": {"active?": False},
    "paris": {"campus": 1},
}


def me_payload(uid=192183, login="ravazque", profile="student"):
    p = PROFILES[profile]
    cursus = [{"cursus_id": 9, "begin_at": "2024-07-01T08:00:00Z", "end_at": "2024-07-26T16:00:00Z", "grade": "Pisciner"}]
    if p.get("main", "yes") is not None:
        cursus.append({"cursus_id": 21, "begin_at": "2024-09-16T07:42:00Z", "end_at": p.get("end"), "grade": p.get("grade")})
    return {"id": uid, "login": login, "displayname": "Raúl Vázquez Pérez", "staff?": p.get("staff?", False),
            "alumni?": False, "active?": p.get("active?", True), "cursus_users": cursus,
            "campus_users": [{"campus_id": p.get("campus", 22), "is_primary": True}],
            "image": {"versions": {"medium": "https://cdn.intra.42.fr/users/x/medium_ravazque.jpg"}}}


class Mock42:
    def __init__(self, router):
        self.router, self.uid = router, 192183

    def as_profile(self, profile, uid=192183):
        self.uid = uid
        # like the intra: the code exchange returns the user's token, client credentials the app's
        self.router.post(f"{API}/oauth/token").mock(side_effect=lambda req: httpx.Response(200, json={
            "access_token": "USER_TOKEN" if b"authorization_code" in req.content else "APP_TOKEN", "expires_in": 7200}))
        self.router.get(f"{API}/v2/me").respond(json=me_payload(uid, profile=profile))
        self.router.get(f"{API}/v2/users/{uid}/coalitions").respond(json=[{"slug": "zefiria", "name": "Zefiria", "color": "#E39F0B"}])
        return self


async def signed_callback(client):
    r = await client.get("/auth/login?accept=1")
    state = r.headers["location"].split("state=")[1].split("&")[0]
    return await client.get(f"/auth/callback?code=CODE&state={state}")
