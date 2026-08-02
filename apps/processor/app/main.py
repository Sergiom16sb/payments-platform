"""Payments processor — FastAPI entry point.

Mock payment processor that approves PROCESSOR_APPROVE_RATIO (default
0.8) and rejects the rest. Returns 503 ~PROCESSOR_ERROR_RATE (default 0.01)
of the time to test client retry logic.

Endpoints:
  GET  /health   -> 200 {status: ok, uptime}
  POST /process  -> 200 {processorRef, status, reason?}
                  -> 503 (occasional) to test retry
  POST /refund   -> 200 {processorRef, status, reason?}
                  -> 503 (occasional) to test retry
"""

from __future__ import annotations

import logging
import time

from fastapi import FastAPI

from .config import settings
from .processor import process_payment, process_refund
from .schemas import ProcessRequest, ProcessResponse, RefundRequest, RefundResponse

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

_app_started = time.time()

app = FastAPI(
    title="Payments Processor",
    version="0.1.0",
    description="Mock payment approval service — configurable APPROVE/REJECT ratio.",
)


@app.get("/health")
async def health() -> dict[str, str | float]:
    """Liveness probe. Returns uptime so the caller can detect restarts."""
    return {"status": "ok", "uptime": time.time() - _app_started}


@app.post("/process", response_model=ProcessResponse)
async def process(req: ProcessRequest) -> ProcessResponse:
    """Approve or reject a payment. See app/schemas.py for the contract."""
    logger.info(
        "process: paymentId=%s amount=%s currency=%s",
        req.paymentId,
        req.amount,
        req.currency,
    )
    return await process_payment(req)


@app.post("/refund", response_model=RefundResponse)
async def refund(req: RefundRequest) -> RefundResponse:
    """Approve or reject a refund. Same behavior as /process but for refunds."""
    logger.info(
        "refund: refundId=%s paymentId=%s amount=%s currency=%s",
        req.refundId,
        req.paymentId,
        req.amount,
        req.currency,
    )
    return await process_refund(req)