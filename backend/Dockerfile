# Backend image for Render (or any container host). Lean profile: no torch/SAM
# server-side (SAM runs client-side via ONNX), so slim + wheels — no build tools.
#
# Build CONTEXT is the repo root (see render.yaml dockerContext: .), because the
# backend resolves the shared registry relative to its package location:
# loader.py is at /app/app/registry/loader.py, parents[3] -> "/", so it looks
# for /shared/registry. That dir lives at the repo root, outside backend/, so it
# must be copied into the image alongside the app.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install the package + pinned deps. pyproject declares a setuptools build
# backend so `pip install .` resolves everything from PyPI wheels.
COPY backend/pyproject.toml ./
COPY backend/app ./app

# Shared registry (ops/presets the analyze + compound-widget paths load at
# runtime). Must land at /shared so loader.py's /shared/registry resolves.
COPY shared /shared

RUN pip install .

# Render injects $PORT; fall back to 8787 for local `docker run`. Bind 0.0.0.0
# so the container is reachable. Single process — state lives in memory, so do
# NOT run multiple workers.
EXPOSE 8787
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8787}"]
