"""Payments processor — FastAPI entry point.

Mock payment processor that approves 80% / rejects 20% of payments.
The full business logic (idempotency, reasons, retry semantics) is added
in feat/processor-fastapi. This file is the minimal scaffold for
chore/docker-full-stack so the service can be containerised and health-checked.
"""

from fastapi import FastAPI

app = FastAPI(
    title="Payments Processor",
    version="0.1.0",
    description="Mock payment approval service — approves 80% / rejects 20%.",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}