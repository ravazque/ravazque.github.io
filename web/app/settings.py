"""Settings from the environment (.env through docker compose)."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    base_url: str = "https://localhost"
    ft_uid: str = ""
    ft_secret: str = ""
    ft_uid_2: str = ""             # more 42 apps, optional: app-token requests are spread over all of them
    ft_secret_2: str = ""
    ft_uid_3: str = ""
    ft_secret_3: str = ""
    session_secret: str = ""
    cooldown_s: int = 3600
    cache_s: int = 3600            # the server's copy of a report, renewed on every use; the browser keeps the original
    session_s: int = 604_800       # 7 days, sliding
    secure_cookies: bool = True
    contact_email: str = ""        # shown on the About and Privacy pages
    issues_url: str = ""           # "Report an issue" link; hidden when empty
    controller_name: str = ""      # the data controller named by the privacy policy
    optout_logins: frozenset = frozenset()  # students who asked to be left out of every report
    consent_log: str = ""          # where acceptances of the privacy policy are kept (the only file the app writes)
    dev_report: str = ""           # make dev only: a saved report served at once, with /dev/login as its owner
    dev_uid: int = 0
    owner_login: str = ""          # the one login that may publish to the GitHub Pages site
    github_token: str = ""         # fine-grained, this repository only, Contents: read and write
    github_repo: str = ""
    github_branch: str = "main"

    @property
    def apps(self) -> list[tuple[str, str]]:
        """The 42 apps that answer app-token requests; the first one also signs users in."""
        extra = [(self.ft_uid_2, self.ft_secret_2), (self.ft_uid_3, self.ft_secret_3)]
        return [(self.ft_uid, self.ft_secret)] + [(u, s) for u, s in extra if u and s]

    def check(self) -> "Settings":
        """Refuse to run with a missing or short SESSION_SECRET (it keys the HMACs) or without a contact and a controller."""
        if len(self.session_secret) < 32:
            raise ValueError("SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)")
        if not self.contact_email:
            raise ValueError("CONTACT_EMAIL must be set: the privacy page names who to contact")
        if not self.controller_name:
            raise ValueError("CONTROLLER_NAME must be set: the privacy page names the data controller")
        if self.dev_report and not self.base_url.startswith("https://localhost"):
            raise ValueError("DEV_REPORT signs anyone in without 42: it only runs on https://localhost")
        return self

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ
        return cls(
            base_url=env.get("BASE_URL", cls.base_url).rstrip("/"),
            ft_uid=env.get("FT_UID", ""),
            ft_secret=env.get("FT_SECRET", ""),
            ft_uid_2=env.get("FT_UID_2", ""),
            ft_secret_2=env.get("FT_SECRET_2", ""),
            ft_uid_3=env.get("FT_UID_3", ""),
            ft_secret_3=env.get("FT_SECRET_3", ""),
            session_secret=env.get("SESSION_SECRET", ""),
            contact_email=env.get("CONTACT_EMAIL", ""),
            issues_url=env.get("ISSUES_URL", ""),
            controller_name=env.get("CONTROLLER_NAME", ""),
            consent_log=env.get("CONSENT_LOG", ""),
            dev_report=env.get("DEV_REPORT", ""),
            dev_uid=int(env.get("DEV_UID") or 0),
            optout_logins=frozenset(x.strip().lower() for x in env.get("OPTOUT_LOGINS", "").split(",") if x.strip()),
            owner_login=env.get("OWNER_LOGIN", ""),
            github_token=env.get("GITHUB_TOKEN", ""),
            github_repo=env.get("GITHUB_REPO", ""),
            github_branch=env.get("GITHUB_BRANCH", "") or cls.github_branch,
        )
