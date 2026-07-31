"""Runtime configuration for the processor service.

Loaded once at import time. Fails fast on invalid / missing values so
the container exits before serving traffic (same fail-fast principle
as apps/api/src/config/env.ts).
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    approve_ratio: float  # 0..1, probability of APPROVED (default 0.8)
    min_latency_ms: int  # simulated latency lower bound
    max_latency_ms: int  # simulated latency upper bound
    error_rate: float  # 0..1, probability of returning 503 (forces client retry)
    log_level: str


def _float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise SystemExit(f"env {name} must be a float, got {raw!r}") from exc


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise SystemExit(f"env {name} must be an int, got {raw!r}") from exc


def load_settings() -> Settings:
    approve = _float("PROCESSOR_APPROVE_RATIO", 0.8)
    if not 0 <= approve <= 1:
        raise SystemExit(f"PROCESSOR_APPROVE_RATIO must be in [0,1], got {approve}")

    min_ms = _int("PROCESSOR_MIN_LATENCY_MS", 50)
    max_ms = _int("PROCESSOR_MAX_LATENCY_MS", 200)
    if min_ms < 0 or max_ms < min_ms:
        raise SystemExit(
            f"invalid latency range: min={min_ms} max={max_ms}"
        )

    err = _float("PROCESSOR_ERROR_RATE", 0.01)
    if not 0 <= err <= 1:
        raise SystemExit(f"PROCESSOR_ERROR_RATE must be in [0,1], got {err}")

    return Settings(
        approve_ratio=approve,
        min_latency_ms=min_ms,
        max_latency_ms=max_ms,
        error_rate=err,
        log_level=os.getenv("LOG_LEVEL", "info"),
    )


settings: Settings = load_settings()