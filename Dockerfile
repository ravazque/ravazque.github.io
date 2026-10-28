# The web app in one binary: the browser app (web/) built first, then embedded in the Go server (server/).
FROM node:26-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund
COPY web web
COPY server/core/data server/core/data
RUN mkdir -p server/internal/web/dist && cd web && npm run build

FROM golang:1.27-alpine AS server
WORKDIR /src/server
COPY server/go.mod ./
COPY server .
COPY --from=web /src/server/internal/web/dist internal/web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ravazque-info ./cmd/ravazque-info && mkdir -p /out/data

FROM gcr.io/distroless/static-debian12
COPY --from=server /out/ravazque-info /ravazque-info
# the consent log's volume: uid 1000, as v1's image, so production's existing volume stays writable
COPY --from=server --chown=1000:1000 /out/data /data
USER 1000:1000
EXPOSE 8000
# one process: its memory is the only store (sessions, report copies, limits)
ENTRYPOINT ["/ravazque-info"]
