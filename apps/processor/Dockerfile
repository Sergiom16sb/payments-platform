# syntax=docker/dockerfile:1.7
# Single-stage Dockerfile using the official uv image with Python 3.13 baked in.
# The image is larger than the distroless variant (~256MB vs ~78MB) but means
# one FROM line, no COPY --from, and no need to keep the distroless image in sync.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

ENV UV_PYTHON_DOWNLOADS=0 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Layer-cache deps separately from source
COPY pyproject.toml uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

COPY app ./app

# python user (uid 1000) is already in the base image
USER 1000:1000

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=3); sys.exit(0 if r.status==200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]