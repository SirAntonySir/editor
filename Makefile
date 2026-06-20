.PHONY: help install dev dev-backend admin electron build electron-build lint test test-run check preview clean download-sam

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
	@echo "  make admin           Start backend and open the admin cockpit"
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
