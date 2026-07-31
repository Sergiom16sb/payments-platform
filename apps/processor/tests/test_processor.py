"""Tests for /health and /process endpoints."""

from __future__ import annotations

import os
from collections import Counter

# Disable the 503 injection during distribution tests so the sample is clean.
os.environ.setdefault("PROCESSOR_ERROR_RATE", "0")

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "uptime" in body
    assert body["uptime"] >= 0


def test_process_approved_or_rejected_shape() -> None:
    r = client.post(
        "/process",
        json={
            "paymentId": "p_test_1",
            "amount": "10.50",
            "currency": "USD",
            "cardToken": "tok_test",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "processorRef" in body and len(body["processorRef"]) > 0
    assert body["status"] in ("APPROVED", "REJECTED")
    if body["status"] == "REJECTED":
        assert body["reason"] in (
            "INSUFFICIENT_FUNDS",
            "EXPIRED",
            "FRAUD_SUSPECTED",
        )
    else:
        assert body["reason"] is None


def test_process_validation_currency_lowercase() -> None:
    r = client.post(
        "/process",
        json={"paymentId": "p", "amount": "5", "currency": "usd", "cardToken": "t"},
    )
    assert r.status_code == 422


def test_process_validation_amount_zero() -> None:
    r = client.post(
        "/process",
        json={"paymentId": "p", "amount": "0", "currency": "USD", "cardToken": "t"},
    )
    assert r.status_code == 422


def test_process_validation_missing_fields() -> None:
    r = client.post("/process", json={"paymentId": "p"})
    assert r.status_code == 422


def test_process_validation_extra_field_rejected() -> None:
    r = client.post(
        "/process",
        json={
            "paymentId": "p",
            "amount": "5",
            "currency": "USD",
            "cardToken": "t",
            "sneaky": "value",
        },
    )
    assert r.status_code == 422


def test_distribution_roughly_80_20() -> None:
    """Over 500 samples, APPROVED ratio should be within 0.7..0.9 of
    the configured 0.8 (95% confidence for binomial)."""
    n = 500
    counts: Counter[str] = Counter()
    for i in range(n):
        r = client.post(
            "/process",
            json={
                "paymentId": f"dist_{i}",
                "amount": "10.00",
                "currency": "USD",
                "cardToken": "tok",
            },
        )
        assert r.status_code == 200, r.text
        counts[r.json()["status"]] += 1

    approved_ratio = counts["APPROVED"] / n
    # Wide bounds to keep the test stable across runs.
    assert 0.7 <= approved_ratio <= 0.9, (
        f"expected APPROVED ratio ~0.8, got {approved_ratio:.3f} "
        f"(counts: {dict(counts)})"
    )