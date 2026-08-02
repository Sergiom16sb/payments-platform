"""Pydantic schemas for the /process endpoint.

Request: paymentId, amount (Decimal), currency (3-letter ISO), cardToken.
Response: processorRef (uuid4 hex), status (APPROVED|REJECTED),
         reason (nullable: only set when REJECTED).
"""

from __future__ import annotations

from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class PaymentStatus(StrEnum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


# Rejection reasons (mirrors what Stripe-like processors return).
class RejectionReason(StrEnum):
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
    EXPIRED = "EXPIRED"
    FRAUD_SUSPECTED = "FRAUD_SUSPECTED"


class ProcessRequest(BaseModel):
    """Body of POST /process. Field names match the API contract exactly."""

    model_config = ConfigDict(extra="forbid")

    paymentId: str = Field(min_length=1, max_length=64)  # noqa: N815
    amount: Decimal = Field(gt=Decimal("0"), max_digits=12, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    cardToken: str = Field(min_length=1, max_length=128)  # noqa: N815


class ProcessResponse(BaseModel):
    """Successful response. processorRef is always present; reason is only
    populated when status == REJECTED."""

    model_config = ConfigDict(extra="forbid")

    processorRef: str = Field(min_length=1)  # noqa: N815
    status: PaymentStatus
    reason: RejectionReason | None = None


# Reject reasons for /refund (a refund can be declined for different reasons
# than the original charge).
class RefundRejectionReason(StrEnum):
    REFUND_WINDOW_EXPIRED = "REFUND_WINDOW_EXPIRED"
    ORIGINAL_NOT_FOUND = "ORIGINAL_NOT_FOUND"


class RefundRequest(BaseModel):
    """Body of POST /refund. Mirrors the API's RefundRequestSchema but
    reuses PaymentStatus for the response status (PENDING/APPROVED/REJECTED).
    """

    model_config = ConfigDict(extra="forbid")

    refundId: str = Field(min_length=1, max_length=64)  # noqa: N815
    paymentId: str = Field(min_length=1, max_length=64)  # noqa: N815
    amount: Decimal = Field(gt=Decimal("0"), max_digits=12, decimal_places=2)
    currency: str = Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")


class RefundResponse(BaseModel):
    """Response of POST /refund. Same shape as ProcessResponse but with
    an extra `reason` enum covering refund-specific declines."""

    model_config = ConfigDict(extra="forbid")

    processorRef: str = Field(min_length=1)  # noqa: N815
    status: PaymentStatus
    reason: RefundRejectionReason | None = None