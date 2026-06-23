.PHONY: help install dev dev-backend tunnel tunnel-tailscale admin diagram electron build electron-build lint test test-run check preview clean download-sam

# The admin cockpit lives at /admin on the backend (FastAPI, port 8787)
# and is gated to loopback peers (see backend/app/api/admin.py). Override
# host/port via env vars when needed: `BACKEND_PORT=9000 make admin`.
BACKEND_HOST ?= 127.0.0.1
BACKEND_PORT ?= 8787
ADMIN_URL    := http://$(BACKEND_HOST):$(BACKEND_PORT)/admin

help:
	@echo "Photo Editor — make targets"
	@echo ""
	@echo "  make install         Install npm dependencies"
	@echo "  make dev             Run Vite dev server"
	@echo "  make dev-backend     Run FastAPI backend (uvicorn)"
	@echo "  make tunnel          Expose the running backend via a Cloudflare quick tunnel"
	@echo "  make tunnel-tailscale  Run the backend bound to your tailnet (SSE-safe, private)"
	@echo "  make admin           Start backend and open the admin cockpit"
	@echo "  make diagram         Regenerate docs/figures/architecture.{puml,svg} via arkit + PlantUML"
	@echo "  make electron        Run Electron + Vite (dev)"
	@echo "  make build           Type-check and build for production"
	@echo "  make electron-build  Build Electron desktop app"
	@echo "  make lint            Run ESLint"
	@echo "  make test            Run Vitest (watch mode)"
	@echo "  make test-run        Run Vitest once"
	@echo "  make check           tsc + eslint + vitest (full pre-commit)"
	@echo "  make preview         Preview the production build"
	@echo "  make clean           Remove dist, release, node_modules/.vite"
	@echo "  make download-sam    Vendor MobileSAM ONNX files (~45 MB, one-time)"

install:
	npm install

dev:
	npm run dev

dev-backend:
	npm run dev:backend

# Cloudflare quick tunnel — exposes the local backend on a public HTTPS URL so a
# remote machine running the packaged app can reach it. The URL is random and
# changes every run; copy it into the app's Preferences -> Backend URL. cloudflared
# only forwards to 127.0.0.1:$(BACKEND_PORT), so the backend must already be running
# (make dev-backend in another terminal) or tunneled requests return 502.
tunnel:
	@command -v cloudflared >/dev/null || { echo "[make tunnel] cloudflared not found — install it:  brew install cloudflared"; exit 1; }
	@curl -sf "http://$(BACKEND_HOST):$(BACKEND_PORT)/health" >/dev/null \
		&& echo "[make tunnel] backend is up at http://$(BACKEND_HOST):$(BACKEND_PORT)" \
		|| echo "[make tunnel] WARNING backend not reachable at http://$(BACKEND_HOST):$(BACKEND_PORT) — run 'make dev-backend' first (tunnel will 502 until then)"
	@echo "[make tunnel] starting Cloudflare quick tunnel — copy the https://<...>.trycloudflare.com URL below into Preferences -> Backend URL"
	cloudflared tunnel --url http://$(BACKEND_HOST):$(BACKEND_PORT)

# Tailscale path — runs the backend bound to this machine's tailnet IP. Unlike a
# Cloudflare tunnel there is no buffering CDN in the path, so SSE (the live event
# stream the editor depends on) works reliably. The backend is reachable ONLY by
# devices signed into the same tailnet — not the public internet, not the LAN.
# One command (no separate dev-backend needed); paste the printed URL into the
# other machine's Preferences -> Backend URL. For plain loopback dev use
# `make dev-backend` instead (this binds the tailnet IP, not 127.0.0.1).
tunnel-tailscale:
	@bash -c '\
		TS=$$(command -v tailscale || true); \
		if [ -z "$$TS" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; fi; \
		if [ -z "$$TS" ]; then \
			echo "[make tunnel-tailscale] tailscale not found. Install one of:"; \
			echo "    brew install --cask tailscale   (then open Tailscale.app and sign in)"; \
			echo "    brew install tailscale && sudo tailscale up   (daemon-only)"; \
			exit 1; \
		fi; \
		TS_IP=$$("$$TS" ip -4 2>/dev/null | head -1); \
		if [ -z "$$TS_IP" ]; then echo "[make tunnel-tailscale] no tailnet IP — open Tailscale and sign in (or run \"$$TS up\")"; exit 1; fi; \
		echo ""; \
		echo "[make tunnel-tailscale] backend reachable on your tailnet at:"; \
		echo ""; \
		echo "    http://$$TS_IP:$(BACKEND_PORT)"; \
		echo ""; \
		echo "[make tunnel-tailscale] paste that into Preferences -> Backend URL on the other"; \
		echo "[make tunnel-tailscale] machine (it must be signed into the same tailnet). Ctrl-C to stop."; \
		echo ""; \
		cd backend && source .venv/bin/activate && \
		ANALYZE_SAM=1 uvicorn app.main:app --reload --host "$$TS_IP" --port $(BACKEND_PORT)'

# Spawn the browser opener in the background so the foreground stays
# attached to uvicorn — that way Ctrl-C still cleanly stops the server.
# `open` is macOS; falls back to xdg-open on Linux.
admin:
	@echo "[make admin] starting backend; cockpit at $(ADMIN_URL)"
	@( sleep 2 && (command -v open >/dev/null && open "$(ADMIN_URL)" || xdg-open "$(ADMIN_URL)") ) &
	@BACKEND_HOST=$(BACKEND_HOST) BACKEND_PORT=$(BACKEND_PORT) bash -c '\
		cd backend && source .venv/bin/activate && \
		ANALYZE_SAM=1 uvicorn app.main:app --reload \
		--host $$BACKEND_HOST --port $$BACKEND_PORT'

diagram:
	npm run diagram

electron:
	npm run electron:dev

build:
	npm run build

electron-build:
	npm run electron:build

lint:
	npm run lint

test:
	npm test

test-run:
	npm run test:run

check:
	npm run check

preview:
	npm run preview

clean:
	rm -rf dist release node_modules/.vite

download-sam:
	./scripts/download_mobile_sam.sh
