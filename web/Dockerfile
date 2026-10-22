# Built from the repository root (compose sets the context to ..) so the image can install ../core.
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 1000 app && mkdir /data && chown app /data
WORKDIR /srv
COPY web/requirements.txt web/requirements.txt
RUN pip install --no-cache-dir -r web/requirements.txt
COPY core core
# editable: compose mounts ../core over /srv/core, so edits to ui.json and the i18n files show on reload
RUN pip install --no-cache-dir -e core
COPY web web
WORKDIR /srv/web
USER app
EXPOSE 8000
# one process: its memory is the only store (sessions, report copies, limits)
CMD ["uvicorn", "app.main:build", "--factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
