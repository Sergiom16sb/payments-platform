# syntax=docker/dockerfile:1.7
# ---------- Build stage ----------
FROM python:3.12-slim AS build

# uv is the modern Python package manager (Astral, Rust).
# Installing it in the builder keeps the runtime image slim.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Layer-cache deps separately from source
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-install-project

# Copy source and install the project itself
COPY app ./app
RUN uv sync --frozen --no-dev

# ---------- Runtime stage ----------
FROM python:3.12-slim AS runtime

# Copy uv binary from official image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Bring the venv + project source from the builder
COPY --from=build /app/.venv ./.venv
COPY --from=build /app/app ./app
COPY pyproject.toml ./

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Run as non-root for defense in depth
RUN useradd --create-home --uid 1001 app && chown -R app:app /app
USER app

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=3); sys.exit(0 if r.status==200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]