# editor-backend

FastAPI backend for the photo editor's AI layer.

## Bootstrap

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY
```

## Run

```bash
source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8787
```

Visit http://127.0.0.1:8787/health → `{"status":"ok"}`.

## Test

```bash
source .venv/bin/activate
pytest -v
```
