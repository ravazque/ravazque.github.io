"""Settings from the environment (.env through docker compose)."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    base_url: str = "https://localhost"
    ft_uid: str = ""
    ft_secret: str = ""
    session_secret: str = ""
    redis_url: str = "redis://redis:6379/0"
    cooldown_s: int = 3600
    retention_s: int = 2_592_000   # 30 days without a visit
    session_s: int = 604_800       # 7 days, sliding
    secure_cookies: bool = True
    contact_email: str = ""        # shown on the About and Privacy pages
    issues_url: str = ""           # "Report an issue" link; hidden when empty
    owner_login: str = ""          # the one login that may publish to the GitHub Pages site
    github_token: str = ""         # fine-grained, this repository only, Contents: read and write
    github_repo: str = ""
    github_branch: str = "main"

    def check(self) -> "Settings":
        """Refuse to run with a missing or short SESSION_SECRET (it keys the HMACs) or without a contact address."""
        if len(self.session_secret) < 32:
            raise ValueError("SESSION_SECRET must be at least 32 characters (openssl rand -hex 32)")
        if not self.contact_email:
            raise ValueError("CONTACT_EMAIL must be set: the privacy page names who to contact")
        return self

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ
        return cls(
            base_url=env.get("BASE_URL", cls.base_url).rstrip("/"),
            ft_uid=env.get("FT_UID", ""),
            ft_secret=env.get("FT_SECRET", ""),
            session_secret=env.get("SESSION_SECRET", ""),
            redis_url=env.get("REDIS_URL", cls.redis_url),
            contact_email=env.get("CONTACT_EMAIL", ""),
            issues_url=env.get("ISSUES_URL", ""),
            owner_login=env.get("OWNER_LOGIN", ""),
            github_token=env.get("GITHUB_TOKEN", ""),
            github_repo=env.get("GITHUB_REPO", ""),
            github_branch=env.get("GITHUB_BRANCH", "") or cls.github_branch,
        )
