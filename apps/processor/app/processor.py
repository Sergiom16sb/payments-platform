"""Mock payment processor logic (PLAN §8).

Behavior:
  - 80% (configurable via PROCESSOR_APPROVE_RATIO) -> APPROVED
  - 20% -> REJECTED with a random reason
  - Simulated latency between PROCESSOR_MIN/MAX_LATENCY_MS (default 50..200)
  - 1% (configurable via PROCESSOR_ERROR_RATE) -> raises HTTP 503
    to test the API client's retry behavior
"""

from __future__ import annotations

import asyncio
import random
import uuid
from decimal import Decimal

from fastapi import HTTPException, status

from .config import settings
from .schemas import (
    PaymentStatus,
    ProcessRequest,
    ProcessResponse,
    RefundRejectionReason,
    RefundRequest,
    RefundResponse,
    RejectionReason,
)


async def process_payment(req: ProcessRequest) -> ProcessResponse:
    """Decide APPROVED or REJECTED, with a randomized processorRef.

    Raises HTTPException(503) to simulate a transient upstream failure
    (used by the API client to test its retry logic).
    """

    # 1) Simulated latency so the API exercises realistic timeouts.
    if settings.max_latency_ms > settings.min_latency_ms:
        span = settings.max_latency_ms - settings.min_latency_ms
        delay_ms = settings.min_latency_ms + random.randint(0, span)
    else:
        delay_ms = settings.min_latency_ms
    await asyncio.sleep(delay_ms / 1000)

    # 2) Occasional 503 to test client retry.
    if settings.error_rate > 0 and random.random() < settings.error_rate:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="processor temporarily unavailable",
        )

    # 3) APPROVED vs REJECTED.
    if random.random() < settings.approve_ratio:
        return ProcessResponse(
            processorRef=uuid.uuid4().hex,
            status=PaymentStatus.APPROVED,
            reason=None,
        )

    return ProcessResponse(
        processorRef=uuid.uuid4().hex,
        status=PaymentStatus.REJECTED,
        reason=random.choice(list(RejectionReason)),
    )


async def process_refund(req: RefundRequest) -> RefundResponse:
    """Decide APPROVED or REJECTED for a refund. Same shape as
    process_payment but with a slightly different rejection enum (refund-
    specific reasons: REFUND_WINDOW_EXPIRED, ORIGINAL_NOT_FOUND).

    Behavior is intentionally identical to process_payment (same latency,
    same 503 injection rate, same approve_ratio) so the API exercises
    the same retry path for refunds as for charges.
    """

    if settings.max_latency_ms > settings.min_latency_ms:
        span = settings.max_latency_ms - settings.min_latency_ms
        delay_ms = settings.min_latency_ms + random.randint(0, span)
    else:
        delay_ms = settings.min_latency_ms
    await asyncio.sleep(delay_ms / 1000)

    if settings.error_rate > 0 and random.random() < settings.error_rate:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="processor temporarily unavailable",
        )

    if random.random() < settings.approve_ratio:
        return RefundResponse(
            processorRef=uuid.uuid4().hex,
            status=PaymentStatus.APPROVED,
            reason=None,
        )

    return RefundResponse(
        processorRef=uuid.uuid4().hex,
        status=PaymentStatus.REJECTED,
        reason=random.choice(list(RefundRejectionReason)),
    )


def _format_decimal(amount: Decimal) -> str:
    """Stable string repr (avoids scientific notation noise in logs)."""
    return f"{amount:.2f}"