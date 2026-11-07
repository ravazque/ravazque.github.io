COMPOSE     := docker compose
COMPOSE_DEV := $(COMPOSE) -p ravazque-info-dev -f compose.yaml -f compose.dev.yaml
# nothing but production's own targets (production, production-down, logs) ever touches production's containers, image or volumes
# the dev tools run here (Go); fetch reads the 42 apps from the root .env itself, without printing them
DEVTOOLS := cd server && go run ./cmd/devtools
CHROME := google-chrome-stable
OPEN_DEV := nohup $(CHROME) https://localhost >/dev/null 2>&1 &
TEST_PROFILES := /preview/test-*.json
REAL_PROFILES := /preview/real-*.json
.DEFAULT_GOAL := help
.PHONY: help dev dev-build dev-real dev-live dev-up dev-vite profiles-test profiles-real dev-down dev-fclean dev-logs production production-down logs down ps test preview snapshot eval-report report site certs clean fclean re

help: ## Show this help
	@echo "ravazque.info — dev at https://localhost, production at https://ravazque.info (both sign in with FT_UID)"
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  make %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# each level serves what the one before serves, plus its own; a single build and start, not one per level
dev: dev-up ## Build, start and open https://localhost in Chrome with no saved profiles: real 42 sign-in only (FT_UID)
	@$(OPEN_DEV)
	@echo "Up at https://localhost — sign in with 42 (the FT_UID app needs the redirect URI https://localhost/auth/callback)"

dev-build: SERVE := $(TEST_PROFILES)
dev-build: profiles-test dev-up ## dev + the synthetic test profiles (made again, 0 requests)
	@$(OPEN_DEV)
	@echo "Up at https://localhost — 'Test · …' on the landing enters as a synthetic profile"
	@echo "Real sign-in: the FT_UID app needs the redirect URI https://localhost/auth/callback"

dev-real: SERVE := $(TEST_PROFILES) $(REAL_PROFILES)
dev-real: profiles-real dev-up ## dev-build + the real profiles of DEV_REAL_LOGINS (fetched only when missing, ~120 requests each)
	@$(OPEN_DEV)
	@echo "Up at https://localhost — 'Test · …' and 'Real · …' on the landing (delete web/preview/real-<login>.json to fetch it again)"

dev-live: SERVE := $(TEST_PROFILES) $(REAL_PROFILES)
dev-live: profiles-real dev-up dev-vite ## dev-real + edit live: opens http://localhost:5173 in Chrome, a saved change in web/src shows at once (Ctrl+C stops Vite)

dev-vite:
	@if curl -s -o /dev/null -m 2 http://localhost:5173/; then \
	   echo "Vite is already running: attached"; nohup $(CHROME) http://localhost:5173 >/dev/null 2>&1 & \
	 else \
	   cd web && { test -x node_modules/.bin/vite || npm ci --no-audit --no-fund --silent; } && API=https://localhost BROWSER=$(CHROME) node_modules/.bin/vite --port 5173 --strictPort --open; \
	 fi

# made again only when missing, from another day (they are moved to today) or older than the server's code and data
profiles-test: .env
	@mkdir -p web/preview
	@oldest=$$(ls -t web/preview/test-*.json 2>/dev/null | tail -1); \
	 if [ -z "$$oldest" ] || [ -n "$$(find "$$oldest" ! -newermt 'today 00:00')" ] || [ -n "$$(find server -type f -newer "$$oldest" -print -quit)" ]; then \
	   $(DEVTOOLS) profiles $(CURDIR)/web/preview; \
	 fi

profiles-real: profiles-test
	@$(DEVTOOLS) real $(CURDIR)/web/preview || echo "Starting without them: run make dev-real again later (only the missing ones are fetched)"

# compose's build cache and config hash leave a running dev alone when the code and settings have not changed.
# It keeps a running dev that already serves this level's profiles, replaces one that does not answer, and restarts
# the server when a profile changed after it started (it reads them only at the start).
dev-up: .env web/Caddyfile.local
	@mkdir -p web/preview
	@set -f; api=ravazque-info-dev-api-1; state() { docker inspect -f "$$1" $$api 2>/dev/null; }; \
	 before=$$(state '{{.State.StartedAt}}'); serve='$(SERVE)'; force=; \
	 if [ "$$(state '{{.State.Running}}')" = true ]; then \
	   running=$$(state '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^DEV_PROFILES=//p'); covers=yes; \
	   for g in $$serve; do case " $$running " in *" $$g "*) ;; *) covers=no ;; esac; done; \
	   [ $$covers = no ] || serve=$$running; \
	   curl -sfk -m 3 -o /dev/null https://localhost/healthz || force=--force-recreate; \
	 fi; \
	 DEV_PROFILES="$$serve" $(COMPOSE_DEV) up -d --build $$force || exit 1; \
	 if [ -n "$$(find web/preview \( -name 'test-*.json' -o -name 'real-*.json' \) -newermt "$$(state '{{.State.StartedAt}}')")" ]; then $(COMPOSE_DEV) restart api; fi; \
	 timeout 60 sh -c 'until curl -sfk -o /dev/null https://localhost/healthz; do sleep 1; done' || { echo "Dev did not answer in 60 s: make dev-logs"; exit 1; }; \
	 [ "$$before" != "$$(state '{{.State.StartedAt}}')" ] || echo "Nothing to update: attached to the running dev"

dev-down: ## Stop dev and remove its containers (its sessions and server copies go; browsers keep theirs)
	@$(COMPOSE_DEV) down --remove-orphans

dev-fclean: ## dev-down + delete dev's image, volumes and saved reports (web/preview): dev-build starts from scratch
	@$(COMPOSE_DEV) down --volumes --rmi local --remove-orphans
	@rm -rf web/preview

dev-logs: ## Follow dev's logs
	@$(COMPOSE_DEV) logs -f --tail=100

production: .env web/Caddyfile.local ## Build and start production at https://ravazque.info through the Cloudflare tunnel
	@grep -q '^TUNNEL_TOKEN=.' .env || { echo "TUNNEL_TOKEN is empty in .env: create the tunnel in Cloudflare first (README)"; exit 1; }
	@$(COMPOSE) --profile tunnel up -d --build
	@echo "Public: https://ravazque.info (the FT_UID app needs the redirect URI https://ravazque.info/auth/callback)"

production-down: ## Stop production and its tunnel (its volumes, the consent log among them, stay)
	@$(COMPOSE) --profile tunnel down

logs: ## Follow production's logs
	@$(COMPOSE) --profile tunnel logs -f --tail=100

down: dev-down production-down ## Stop dev and production

ps: ## Show the services of both
	@$(COMPOSE) --profile tunnel ps; $(COMPOSE_DEV) ps

test: ## Run every test: Go (server), the browser app (web), the site's scripts and the evaluation report
	@cd server && go vet ./... && go test ./...
	@cd web && npm ci --no-audit --no-fund --silent && npx vue-tsc --noEmit && npx vitest run
	@node --test site/tests/*.test.mjs
	@python3 tools/evaluation-report/test_evaluation_report.py

preview: .env ## Save a real extraction to web/preview/data.json for make snapshot (UID=<42 user id>, about 120 requests)
	@mkdir -p web/preview && $(DEVTOOLS) fetch $(UID) $(CURDIR)/web/preview/data.json

snapshot: ## Write site/data/42.json from web/preview/data.json (what the publish button would send)
	@$(DEVTOOLS) snapshot $(CURDIR)/web/preview/data.json $(CURDIR)/site/data/42.json

eval-report: .env ## Ask for a 42 login and write its evaluation history as one private HTML page (about 130 requests)
	@python3 tools/evaluation-report/evaluation_report.py

report: eval-report ## make eval-report, then open the page it wrote in Chrome
	@nohup $(CHROME) "$$(ls -t $(CURDIR)/tools/evaluation-report/out/*.html | head -1)" >/dev/null 2>&1 &

site: ## Build the GitHub Pages site into site/_build and serve it at http://localhost:8080
	@sh site/build.sh site/_build
	@echo "http://localhost:8080 (Ctrl-C to stop)"
	@python3 -m http.server --bind 127.0.0.1 --directory site/_build 8080

certs: ## Create the HTTPS certificates for https://localhost in web/certs/
	@sh web/scripts/certs.sh

web/Caddyfile.local: web/Caddyfile.tmpl $(wildcard web/certs/localhost.pem)
	@if [ -f web/certs/localhost.pem ]; then line='tls /certs/localhost.pem /certs/localhost-key.pem'; else line='tls internal'; fi; \
	 sed "s|TLS_LINE|$$line|" web/Caddyfile.tmpl > $@

# clean and fclean never touch production: its containers, image, volumes (the consent log), Caddyfile.local and certs
clean: dev-down ## dev-down + delete generated files (site/_build, the app's build); production keeps running
	@rm -rf site/_build
	@find server/internal/web/dist -mindepth 1 ! -name .gitkeep -exec rm -rf {} +

fclean: clean dev-fclean ## clean + dev-fclean + web/node_modules: everything but production and web/certs
	@rm -rf web/node_modules

re: fclean dev-build ## fclean + dev-build

.env:
	@cp .env.example .env && chmod 600 .env
	@echo "Created .env from .env.example: fill FT_UID, FT_SECRET, SESSION_SECRET, CONTROLLER_NAME and CONTACT_EMAIL, then run make again"
	@exit 1
