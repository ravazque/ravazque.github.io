COMPOSE     := docker compose
COMPOSE_DEV := $(COMPOSE) -f compose.yaml -f compose.dev.yaml
.DEFAULT_GOAL := help
.PHONY: help dev up build down logs ps test preview snapshot site certs clean fclean re tunnel tunnel-stop

help: ## Show this help
	@echo "ravazque.info — https://localhost"
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  make %-8s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

DEV_UID = $(shell sed -n 's/^DEV_UID=\([0-9][0-9]*\)$$/\1/p' .env 2>/dev/null)
BASE_URL = $(shell sed -n 's/^BASE_URL=\(.*\)$$/\1/p' .env 2>/dev/null)
TUNNEL_URL = $(COMPOSE) logs tunnel 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1

dev: .env web/Caddyfile.local ## Start at https://localhost with the last saved report, no sign-in or wait; reloads on save
	@if [ -n "$(BASE_URL)" ] && [ "$(BASE_URL)" != "https://localhost" ]; then \
	  echo "BASE_URL is $(BASE_URL): dev sign-ins only run on https://localhost. make tunnel-stop, set BASE_URL=https://localhost in .env, or use make up"; exit 1; fi
	@mkdir -p web/preview
	@$(COMPOSE_DEV) up -d --build
	@if [ -f web/preview/data.json ]; then echo "Up at https://localhost — 'Dev · …' on the landing enters with the saved report"; \
	  else echo "Up at https://localhost — no saved report yet: run 'make build' (needs DEV_UID in .env)"; fi
	@if ls web/preview/test-*.json >/dev/null 2>&1; then echo "Test profiles (synthetic): 'Test · …' on the landing"; fi

up: .env web/Caddyfile.local ## Start the web as built, without live reload
	@$(COMPOSE) up -d --build
	@echo "Up at https://localhost"
	@case "$(BASE_URL)" in https://*.trycloudflare.com) url=$$($(TUNNEL_URL)); \
	  if [ "$$url" = "$(BASE_URL)" ]; then echo "Public (tunnel): $(BASE_URL)"; \
	  elif [ -z "$$url" ]; then echo "BASE_URL is $(BASE_URL) but no tunnel is running: make tunnel"; \
	  else echo "The tunnel moved to $$url: set BASE_URL=$$url in .env, add $$url/auth/callback to the 42 app, make up"; fi;; \
	 https://localhost|"") ;; *) echo "Public: $(BASE_URL)";; esac

build: .env ## Build the images, refresh the saved report of DEV_UID (~120 requests, about 40 s with three apps) and the synthetic test profiles
	@$(COMPOSE) build
	@if [ -n "$(DEV_UID)" ]; then mkdir -p web/preview && $(COMPOSE) run --rm -v ./web:/srv/web api python scripts/preview.py --fetch $(DEV_UID); \
	  else echo "DEV_UID is not set in .env: images built, saved report not refreshed"; fi
	@mkdir -p web/preview && $(COMPOSE) run --rm -v ./web:/srv/web api python scripts/test_profiles.py

tunnel: ## Open a free Cloudflare quick tunnel for testers and print its URL (then set BASE_URL and run make up)
	@$(COMPOSE) --profile tunnel up -d tunnel
	@for i in $$(seq 1 30); do url=$$($(COMPOSE) logs tunnel 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1); \
	  [ -n "$$url" ] && break; sleep 1; done; \
	 if [ -z "$$url" ]; then echo "No tunnel URL yet: make logs"; exit 1; fi; \
	 echo "Tunnel: $$url"; \
	 echo "1. In your 42 app (intra > Settings > API), add the redirect URI $$url/auth/callback"; \
	 echo "2. In .env set BASE_URL=$$url (make dev refuses to run with it: dev sign-ins never leave localhost)"; \
	 echo "3. make up   (production mode; the URL changes if the tunnel restarts: make tunnel-stop, make tunnel)"

tunnel-stop: ## Close the tunnel (set BASE_URL back to https://localhost for make dev)
	@$(COMPOSE) --profile tunnel stop tunnel
	@$(COMPOSE) --profile tunnel rm -f tunnel >/dev/null

down: ## Stop the web (sessions and server copies of reports are in memory: they go; browsers keep theirs)
	@$(COMPOSE) down

logs: ## Follow the logs
	@$(COMPOSE) logs -f --tail=100

ps: ## Show the services
	@$(COMPOSE) ps

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

clean: ## Stop the web and delete generated files (preview data, site/_build, Caddyfile.local)
	@$(COMPOSE) down --remove-orphans
	@rm -rf web/preview web/Caddyfile.local site/_build
	@find web core -name __pycache__ -type d -prune -exec rm -rf {} +

fclean: clean ## clean + delete the images and volumes (the consent log too); keeps web/certs
	@$(COMPOSE) down --volumes --rmi local --remove-orphans

re: fclean dev ## fclean + dev

.env:
	@cp .env.example .env && chmod 600 .env
	@echo "Created .env from .env.example: fill FT_UID, FT_SECRET, SESSION_SECRET, CONTROLLER_NAME and CONTACT_EMAIL, then run make again"
	@exit 1
