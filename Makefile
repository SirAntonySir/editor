.PHONY: help install dev dev-backend electron build electron-build lint test test-run check preview clean

help:
	@echo "Photo Editor — make targets"
	@echo ""
	@echo "  make install         Install npm dependencies"
	@echo "  make dev             Run Vite dev server"
	@echo "  make dev-backend     Run FastAPI backend (uvicorn)"
	@echo "  make electron        Run Electron + Vite (dev)"
	@echo "  make build           Type-check and build for production"
	@echo "  make electron-build  Build Electron desktop app"
	@echo "  make lint            Run ESLint"
	@echo "  make test            Run Vitest (watch mode)"
	@echo "  make test-run        Run Vitest once"
	@echo "  make check           tsc + eslint + vitest (full pre-commit)"
	@echo "  make preview         Preview the production build"
	@echo "  make clean           Remove dist, release, node_modules/.vite"

install:
	npm install

dev:
	npm run dev

dev-backend:
	npm run dev:backend

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
