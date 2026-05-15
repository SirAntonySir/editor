# editor-backend

FastAPI backend for the photo editor's AI layer.

**Requirements:** Python 3.11 or newer (the `anthropic` SDK and `pydantic` 2.9 require ≥ 3.11).

## Bootstrap

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY
```

### Download SAM checkpoint

After installing deps, fetch the SAM ViT-B checkpoint (~375 MB, one-time):

```bash
./scripts/download_sam.sh
```

This places the file at `models/sam_vit_b_01ec64.pth`. To use a different
model variant (ViT-L or ViT-H), set `SAM_MODEL_NAME` and `SAM_CHECKPOINT_PATH`
in `.env`.

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
