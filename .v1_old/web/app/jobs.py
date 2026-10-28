"""Extractions run inside the web process, one at a time, through the shared rate limiter. A job id is never queued
twice; a queued job can be cancelled; a job that runs past its timeout is cancelled (extract_job resets its status)."""
import asyncio
import logging

log = logging.getLogger("ravazque.worker")


class Jobs:
    def __init__(self, run, timeout: float = 900):
        self.run, self.timeout = run, timeout
        self.pending: dict[str, int] = {}   # job id -> uid, queued or waiting for its deferred start
        self.running: str | None = None
        self.queue: asyncio.Queue | None = None
        self.task: asyncio.Task | None = None
        self.idle = asyncio.Event()
        self.idle.set()

    def _ensure(self):
        if self.task is None or self.task.done():
            self.queue = self.queue or asyncio.Queue()
            self.task = asyncio.create_task(self._work())

    async def enqueue_job(self, _name, uid, _job_id: str, _defer_by: float | None = None):
        """None when this job is already queued or running (callers keep reporting it as queued)."""
        if _job_id in self.pending or _job_id == self.running:
            return None
        self._ensure()
        self.pending[_job_id] = uid
        self.idle.clear()
        if _defer_by:
            asyncio.get_running_loop().call_later(_defer_by, self.queue.put_nowait, _job_id)
        else:
            self.queue.put_nowait(_job_id)
        return _job_id

    def cancel(self, job_id: str):
        self.pending.pop(job_id, None)
        if not self.pending and self.running is None:
            self.idle.set()

    def queued(self) -> list[str]:
        return list(self.pending)

    async def _work(self):
        while True:
            job_id = await self.queue.get()
            uid = self.pending.pop(job_id, None)
            if uid is None:
                continue
            self.running = job_id
            try:
                await asyncio.wait_for(self.run(uid), self.timeout)
            except Exception as exc:  # extract_job records its own failures; this only keeps the queue alive
                log.warning("job %s ended with %s", job_id.split(":")[0], type(exc).__name__)
            finally:
                self.running = None
                if not self.pending:
                    self.idle.set()

    async def drain(self):
        """Wait until nothing is queued or running (tests and shutdown)."""
        await self.idle.wait()

    async def stop(self):
        if self.task:
            self.task.cancel()
