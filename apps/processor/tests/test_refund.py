"""Tests for the /refund endpoint and its process_refund logic."""

from __future__ import annotations

import os
from collections import Counter

# Speed up retries in the test env (otherwise a 503 test sleeps a lot).
os.environ.setdefault("PROCESSOR_ERROR_RATE", "0")
# NOTE: setting PROCESSOR_APPROVE_RATIO here has no effect on approve_ratio
# — app.config.settings is a module-level frozen dataclass computed at
# import time, and whichever test module pytest collects first (e.g.
# test_processor.py, which doesn't set this env var) has already frozen it
# to the real default (0.8) by the time this file's env var is read. Tests
# that need a specific ratio must monkeypatch config.settings.approve_ratio
# directly, like the other tests in this file already do.

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import (
    RefundRejectionReason,
    RefundResponse,
)

client = TestClient(app)


def _valid_request() -> dict:
    return {
        "refundId": "rfn_1",
        "paymentId": "ckl_abc",
        "amount": "49.99",
        "currency": "USD",
    }


def test_refund_request_validates_required_fields() -> None:
    from app import config

    original = config.settings.approve_ratio
    object.__setattr__(config.settings, "approve_ratio", 1.0)  # always approve
    try:
        r = client.post("/refund", json=_valid_request())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "APPROVED"
        assert body["processorRef"]
        assert body["reason"] is None
    finally:
        object.__setattr__(config.settings, "approve_ratio", original)


def test_refund_request_rejects_missing_refund_id() -> None:
    bad = _valid_request()
    del bad["refundId"]
    r = client.post("/refund", json=bad)
    assert r.status_code == 422


def test_refund_request_rejects_non_positive_amount() -> None:
    bad = _valid_request()
    bad["amount"] = "0"
    r = client.post("/refund", json=bad)
    assert r.status_code == 422


def test_refund_request_rejects_lowercase_currency() -> None:
    bad = _valid_request()
    bad["currency"] = "usd"
    r = client.post("/refund", json=bad)
    assert r.status_code == 422


def test_refund_response_rejects_unknown_status() -> None:
    """Direct schema validation: a malformed response would be caught by
    FastAPI's response_model check before the wire."""
    with pytest.raises(ValueError):
        RefundResponse.model_validate(
            {"processorRef": "x", "status": "BOGUS", "reason": None}
        )


def test_refund_distribution_roughly_80_20() -> None:
    """Override the env so we get a real 50/50 split for distribution
    testing. Mirrors the /process distribution test."""

    # Temporarily override the module-level settings to a 50/50 split
    # and high count so we observe both branches.
    from app import config

    original = config.settings.approve_ratio
    object.__setattr__(config.settings, "approve_ratio", 0.5)
    try:
        counts: Counter[str] = Counter()
        n = 200
        for i in range(n):
            r = client.post(
                "/refund",
                json={
                    "refundId": f"rfn_{i}",
                    "paymentId": "ckl_x",
                    "amount": "10.00",
                    "currency": "USD",
                },
            )
            assert r.status_code == 200
            counts[r.json()["status"]] += 1
        # With approve_ratio=0.5, both should be roughly 50%.
        assert 0.35 <= counts["APPROVED"] / n <= 0.65, (
            f"expected ~50/50 split, got {dict(counts)}"
        )
    finally:
        object.__setattr__(config.settings, "approve_ratio", original)


def test_refund_response_includes_a_refund_specific_reason() -> None:
    """A REJECTED refund must populate reason with one of the refund-
    specific enum values (REFUND_WINDOW_EXPIRED or ORIGINAL_NOT_FOUND)."""
    from app import config

    original = config.settings.approve_ratio
    object.__setattr__(config.settings, "approve_ratio", 0.0)  # always reject
    try:
        for i in range(20):
            r = client.post(
                "/refund",
                json={
                    "refundId": f"rfn_{i}",
                    "paymentId": "ckl_x",
                    "amount": "5",
                    "currency": "USD",
                },
            )
            assert r.json()["status"] == "REJECTED"
            assert r.json()["reason"] in {r.value for r in RefundRejectionReason}
    finally:
        object.__setattr__(config.settings, "approve_ratio", original)