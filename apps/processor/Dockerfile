# syntax=docker/dockerfile:1.7
# Single-stage Dockerfile. Multi-stage adds complexity for marginal benefit
# at this scale; uv installs in <100ms and caches with the pip layer.
FROM python:3.13-slim

# Install uv (the modern Python package manager, Astral/Rust)
RUN pip install --no-cache-dir uv

WORKDIR /app

# Layer-cache deps separately from source
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev

# Copy source
COPY app ./app

# Expose + run as non-root
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# python:3.13-slim ships with a 'python' user (uid 1000); use it
USER 1000:1000

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=3); sys.exit(0 if r.status==200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]