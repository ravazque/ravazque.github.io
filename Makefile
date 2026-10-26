COMPOSE     := docker compose
COMPOSE_DEV := $(COMPOSE) -p ravazque-info-dev -f compose.yaml -f compose.dev.yaml
.DEFAULT_GOAL := help
.PHONY: help dev dev-down dev-logs prod prod-down logs build down ps test preview snapshot site certs clean fclean re

help: ## Show this help
	@echo "ravazque.info — dev at https://localhost (signs in with FT_UID_2), production through the tunnel (FT_UID)"
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  make %-10s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

DEV_UID = $(shell sed -n 's/^DEV_UID=\([0-9][0-9]*\)$$/\1/p' .env 2>/dev/null)
TUNNEL_URL = $(COMPOSE) logs tunnel 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1

dev: .env web/Caddyfile.local ## Start dev at https://localhost with the last saved report; reloads on save; runs beside prod
	@mkdir -p web/preview
	@$(COMPOSE_DEV) up -d --build
	@if [ -f web/preview/data.json ]; then echo "Up at https://localhost — 'Dev · …' on the landing enters with the saved report"; \
	  else echo "Up at https://localhost — no saved report yet: run 'make build' (needs DEV_UID in .env)"; fi
	@if ls web/preview/test-*.json >/dev/null 2>&1; then echo "Test profiles (synthetic): 'Test · …' on the landing"; fi
	@echo "Real sign-in: the FT_UID_2 app needs the redirect URI https://localhost/auth/callback"

dev-down: ## Stop dev (its sessions and server copies go; browsers keep theirs)
	@$(COMPOSE_DEV) down

dev-logs: ## Follow dev's logs
	@$(COMPOSE_DEV) logs -f --tail=100

prod: .env web/Caddyfile.local ## Start production as built behind a Cloudflare quick tunnel and print its public URL
	@$(COMPOSE) --profile tunnel up -d tunnel
	@for i in $$(seq 1 30); do url=$$($(TUNNEL_URL)); [ -n "$$url" ] && break; sleep 1; done; \
	 if [ -z "$$url" ]; then echo "No tunnel URL yet: make logs"; exit 1; fi; \
	 BASE_URL=$$url $(COMPOSE) up -d --build api caddy && \
	 echo "Public: $$url" && \
	 echo "The FT_UID app needs the redirect URI $$url/auth/callback (a new URL every time the tunnel starts)"

prod-down: ## Stop production and its tunnel
	@$(COMPOSE) --profile tunnel down

logs: ## Follow production's logs
	@$(COMPOSE) --profile tunnel logs -f --tail=100

build: .env ## Build the images, refresh the saved report of DEV_UID (~120 requests, about 40 s with three apps) and the synthetic test profiles
	@$(COMPOSE) build
	@if [ -n "$(DEV_UID)" ]; then mkdir -p web/preview && $(COMPOSE) run --rm -v ./web:/srv/web api python scripts/preview.py --fetch $(DEV_UID); \
	  else echo "DEV_UID is not set in .env: images built, saved report not refreshed"; fi
	@mkdir -p web/preview && $(COMPOSE) run --rm -v ./web:/srv/web api python scripts/test_profiles.py

down: dev-down prod-down ## Stop dev and production

ps: ## Show the services of both
	@$(COMPOSE) --profile tunnel ps; $(COMPOSE_DEV) ps

test: .env ## Run every test: web + core (pytest in the image) and JS (local node)
	@$(COMPOSE) build -q api
	@$(COMPOSE) run --rm --no-deps -v ./web/tests:/srv/web/tests:ro -v ./web/app:/srv/web/app:ro -v ./web/static:/srv/web/static:ro \
	  api sh -c "python -m pytest -q -p no:cacheprovider && python -m pytest -q -p no:cacheprovider -o asyncio_default_fixture_loop_scope=function /srv/core/tests"
	@node --test web/tests/js/*.test.mjs core/tests/js/*.test.mjs site/tests/*.test.mjs

preview: .env ## Save a real extraction to web/preview/data.json for make snapshot (UID=<42 user id>, about 120 requests)
	@$(COMPOSE) run --rm -v ./web:/srv/web api python scripts/preview.py --fetch $(UID)

snapshot: .env ## Write site/data/42.json from web/preview/data.json (what the publish button would send)
	@$(COMPOSE) run --rm --no-deps -v ./web:/srv/web -v ./site:/srv/site api python scripts/snapshot.py preview/data.json /srv/site/data/42.json

site: ## Build the GitHub Pages site into site/_build and serve it at http://localhost:8080
	@sh site/build.sh site/_build
	@echo "http://localhost:8080 (Ctrl-C to stop)"
	@python3 -m http.server --bind 127.0.0.1 --directory site/_build 8080

certs: ## Create the HTTPS certificates for https://localhost in web/certs/
	@sh web/scripts/certs.sh

web/Caddyfile.local: web/Caddyfile.tmpl $(wildcard web/certs/localhost.pem)
	@if [ -f web/certs/localhost.pem ]; then line='tls /certs/localhost.pem /certs/localhost-key.pem'; else line='tls internal'; fi; \
	 sed "s|TLS_LINE|$$line|" web/Caddyfile.tmpl > $@

clean: ## Stop dev and production and delete generated files (preview data, site/_build, Caddyfile.local)
	@$(COMPOSE) --profile tunnel down --remove-orphans
	@$(COMPOSE_DEV) down --remove-orphans
	@rm -rf web/preview web/Caddyfile.local site/_build
	@find web core -name __pycache__ -type d -prune -exec rm -rf {} +

fclean: clean ## clean + delete the images and volumes (the consent log too); keeps web/certs
	@$(COMPOSE) --profile tunnel down --volumes --rmi local --remove-orphans
	@$(COMPOSE_DEV) down --volumes --rmi local --remove-orphans

re: fclean dev ## fclean + dev

.env:
	@cp .env.example .env && chmod 600 .env
	@echo "Created .env from .env.example: fill FT_UID, FT_SECRET, SESSION_SECRET, CONTROLLER_NAME and CONTACT_EMAIL, then run make again"
	@exit 1
