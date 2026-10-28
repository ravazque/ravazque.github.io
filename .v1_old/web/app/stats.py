"""Live operational stats for the owner's stats page. Everything is in process memory, per process (dev and
production count on their own) and resets on restart: counters are bumped at the hooks, the rest is read on demand
in routes_dash.build_stats."""
import time
from collections import deque


class Stats:
    def __init__(self, apps: int, now=time.time):
        self.now, self.apps = now, max(apps, 1)
        self.started_at = now()
        self.requests_total = 0
        self._recent: deque = deque()  # (ts, app) of every API request in the last hour
        self.extractions = self.extraction_requests = self.failed = self.timeouts = self.denied = 0
        self.extraction_seconds = 0.0
        self.last_publish = None
        self.peak_sessions = 0

    def request(self, app: int):
        self.requests_total += 1
        self._recent.append((self.now(), app))

    def last_hour(self) -> list[int]:
        """Requests in the last hour, counted per app (index)."""
        cutoff = self.now() - 3600
        while self._recent and self._recent[0][0] < cutoff:
            self._recent.popleft()
        by_app = [0] * self.apps
        for _, a in self._recent:
            if 0 <= a < self.apps:
                by_app[a] += 1
        return by_app

    def extraction(self, requests: int, seconds: float, *, ok: bool, timeout: bool = False):
        self.extractions += 1
        self.extraction_requests += max(requests, 0)
        self.extraction_seconds += max(seconds, 0.0)
        self.timeouts += timeout
        self.failed += not ok

    def deny(self):
        self.denied += 1

    def published(self):
        self.last_publish = self.now()

    def saw_sessions(self, live: int):
        self.peak_sessions = max(self.peak_sessions, live)
