"""Pydantic schemas for the /process endpoint (PLAN §8).

Request: paymentId, amount (Decimal), currency (3-letter ISO), cardToken.
Response: processorRef (uuid4 hex), status (APPROVED|REJECTED),
         reason (nullable: only set when REJECTED).
"""

from __future__ import annotations

from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class PaymentStatus(str, Enum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


# Rejection reasons per PLAN §8 (mirrors what Stripe-like processors return).
class RejectionReason(str, Enum):
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
    EXPIRED = "EXPIRED"
    FRAUD_SUSPECTED = "FRAUD_SUSPECTED"


class ProcessRequest(BaseModel):
    """Body of POST /process. Field names match the API contract exactly."""

    model_config = ConfigDict(extra="forbid")

    paymentId: str = Field(min_length=1, max_length=64)
    amount: Decimal = Field(gt=Decimal("0"), max_digits=12, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    cardToken: str = Field(min_length=1, max_length=128)


class ProcessResponse(BaseModel):
    """Successful response. processorRef is always present; reason is only
    populated when status == REJECTED."""

    model_config = ConfigDict(extra="forbid")

    processorRef: str = Field(min_length=1)
    status: PaymentStatus
    reason: RejectionReason | None = None