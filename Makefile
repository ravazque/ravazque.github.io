COMPOSE     := docker compose
COMPOSE_DEV := $(COMPOSE) -f compose.yaml -f compose.dev.yaml
.DEFAULT_GOAL := help
.PHONY: help dev up build down logs ps test preview snapshot site certs clean fclean re

help: ## Show this help
	@echo "ravazque.top — https://localhost"
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  make %-8s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: .env web/Caddyfile.local ## Build and start the web at https://localhost, reloading on every save
	@$(COMPOSE_DEV) up -d --build
	@echo "Up at https://localhost — 'make logs' to follow, 'make down' to stop"

up: .env web/Caddyfile.local ## Start the web as built, without live reload
	@$(COMPOSE) up -d --build

build: .env ## Build the images
	@$(COMPOSE) build

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

preview: .env ## Save a real extraction to web/preview/data.json for make snapshot (UID=<42 user id>, about 100 requests)
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
