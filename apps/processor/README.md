# payments-processor

Mock payment processor microservice. Approves 80% / rejects 20% of incoming payment requests.

## Stack
- **Python 3.12** (slim)
- **FastAPI** + **Pydantic v2** (schema-driven validation)
- **uv** for environment + dependency management (lockfile reproducible)
- **Ruff** for lint + format
- **pytest** + **httpx** for tests

## Layout
```
apps/processor/
├── app/
│   ├── __init__.py
│   └── main.py           # FastAPI app + /health
├── tests/                # pytest suite (added in feat/processor-fastapi)
├── pyproject.toml        # uv config + ruff config
├── Dockerfile            # multi-stage build + distroless runtime
└── .dockerignore
```

## Development
```bash
cd apps/processor
uv sync                # install deps
uv run uvicorn app.main:app --reload --port 8000
uv run pytest          # tests
uv run ruff check .    # lint
uv run ruff format .   # format
```

## Container
```bash
docker build -t payments-processor apps/processor
docker run --rm -p 8000:8000 payments-processor
```

The full docker-compose orchestration with api + postgres lives at the repo root (`docker-compose.yml`).