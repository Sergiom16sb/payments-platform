# Payments Platform

A REST payments system: users register, tokenize credit cards, and create
payments that are approved or rejected by an independent mock payment
processor. Built as a technical test submission, with several production-grade
additions ("plus" features) beyond the minimum spec.

## Stack

| Layer | Choice |
|---|---|
| API runtime | Bun + Fastify 5 + TypeScript (strict) |
| Validation | Zod, end-to-end (routes, services, repositories, env, processor client) |
| ORM | Prisma 7 + PostgreSQL 16 |
| Auth | JWT access tokens (`jose`, HS256) + persisted, revocable refresh tokens |
| Processor | Python 3.13 + FastAPI + Pydantic v2 (separate microservice) |
| Docs | Swagger UI (auto-generated from Zod schemas) + this README + Postman collection |
| Testing | Vitest (`app.inject()`, no real HTTP server) · pytest |
| Lint/format | Biome (API) · Ruff (processor) |
| Orchestration | Docker Compose — one command brings up all three services |

## Quick start (Docker — recommended)

```bash
git clone https://github.com/Sergiom16sb/payments-platform.git
cd payments-platform
docker compose up --build
```

Wait for all three containers to report `healthy` (`docker compose ps`), then:

```bash
curl http://localhost:3000/api/health      # {"status":"ok","uptime":...}
curl http://localhost:8000/health          # {"status":"ok","uptime":...}
```

First run only — apply the migration and seed two demo users:

```bash
cd apps/api
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/payments' bunx prisma migrate deploy
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/payments' bun run db:seed
```

Seeded accounts:

| Email | Password | Role |
|---|---|---|
| `admin@payments.local` | `Admin1234` | ADMIN |
| `demo@payments.local` | `Demo1234` | USER |

## Quick start (manual, no Docker)

```bash
# Postgres — bring up only the database container
docker compose up -d postgres

# API
cd apps/api
bun install
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/payments' bunx prisma migrate deploy
DATABASE_URL='postgresql://postgres:postgres@localhost:5432/payments' bun run db:seed
bun run dev          # http://localhost:3000

# Processor (separate terminal)
cd apps/processor
uv sync --frozen
uv run uvicorn app.main:app --reload --port 8000   # http://localhost:8000
```

## Environment variables

All have safe defaults for local dev via `docker-compose.yml`. Override by
exporting before `docker compose up`, or via `apps/api/.env` when running the
API outside Docker.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/payments` | Postgres connection string |
| `JWT_SECRET` | *(change in prod)* | HS256 signing secret, >= 32 chars |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `payments-api` / `payments-client` | JWT claims |
| `JWT_ACCESS_TOKEN_EXPIRES_IN` | `15m` | Access token TTL |
| `JWT_REFRESH_TOKEN_EXPIRES_IN` | `7d` | Refresh token TTL |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost |
| `PAYMENTS_PROCESSOR_URL` | `http://processor:8000` | Processor base URL (API → processor) |
| `PAYMENTS_PROCESSOR_TIMEOUT_MS` | `5000` | Per-attempt timeout for the processor client |
| `PAYMENTS_PROCESSOR_MAX_RETRIES` | `3` | Retry attempts on 503/timeout (200ms/800ms/3200ms backoff) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Comma-separated allowed origins |
| `PROCESSOR_APPROVE_RATIO` | `0.8` | Processor: P(APPROVED) |
| `PROCESSOR_ERROR_RATE` | `0.01` | Processor: P(503), used to test API retry |

## API endpoints

All error responses share the envelope `{ "success": false, "error": { "message", "code", "fields"? } }`.
Success responses return the resource directly (no wrapper).

### Auth (`/api/auth`) — public

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/register` | `{email, name, password}` | 201, sets `refresh_token` httpOnly cookie |
| POST | `/login` | `{email, password}` | 200, same cookie behavior |
| POST | `/refresh` | `{refreshToken?}` | Reads body or cookie. Rotates the token — old one is revoked |
| POST | `/logout` | `{refreshToken?}` | 204, revokes the token, clears the cookie |

### Cards (`/api/cards`) — requires `Authorization: Bearer <accessToken>`

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/` | `{pan, cvv, expMonth, expYear, cardholderName}` | 201. PAN/CVV validated (Luhn + expiry) then **discarded** — only `last4` + an opaque `token` are persisted |
| GET | `/` | — | Current user's cards |
| GET | `/:id` | — | 403 if owned by another user |
| DELETE | `/:id` | — | 204 |

### Payments (`/api/payments`, `/api/users/:id/payments`) — requires Bearer auth

| Method | Path | Body / Query | Notes |
|---|---|---|---|
| POST | `/api/payments` | `{cardId, amount, currency?, idempotencyKey?}` | 201 APPROVED / 402 REJECTED. Same `idempotencyKey` never double-charges |
| GET | `/api/payments/:id` | — | 403 if owned by another user |
| GET | `/api/users/:id/payments` | `?page&pageSize&status&from&to` | 200 `{data, meta}`. 403 if `:id` isn't the caller |

### Refunds (`/api/payments/:id/refund`, `/api/payments/:id/refunds`, `/api/refunds/:id`) — requires Bearer auth

| Method | Path | Body / Query | Notes |
|---|---|---|---|
| POST | `/api/payments/:id/refund` | `{amount?, reason?, idempotencyKey?}` | 201 APPROVED or REJECTED. `amount` defaults to the full remaining balance. Same `idempotencyKey` returns the same refund. Eligibility: APPROVED always, PENDING within `PAYMENT_PENDING_REFUND_WINDOW_MINUTES` (default 5), REJECTED never. 422 REFUND_EXCEEDS_REMAINING if the requested amount would push the cumulative refunds over the payment's total. |
| GET | `/api/payments/:id/refunds` | — | 200 list of refunds for the payment |
| GET | `/api/refunds/:id` | — | 200 single refund, owner-checked via the parent payment |

### Admin (`/api/admin`) — requires Bearer auth + `ADMIN` role

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/cards/:id/restore` | — | 200. Restores a soft-deleted card (clears `deletedAt`). Idempotent — restoring an already-active card is a no-op. 403 for non-`ADMIN` callers |

### Processor (separate service, port 8000) — no auth, internal only

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/health` | — | Liveness |
| POST | `/process` | `{paymentId, amount, currency, cardToken}` | ~80% APPROVED, ~20% REJECTED with a reason, ~1% returns 503 to exercise the API's retry |

### Swagger UI

```
http://localhost:3000/api-docs
```

## Roles & Access (RBAC)

| Role | Access |
|---|---|
| `USER` | Default role on register. Manages their own cards, payments, and refunds — never another user's. |
| `ADMIN` | Everything a `USER` can do, plus `POST /api/admin/cards/:id/restore`. Granted manually (`UPDATE users SET role='ADMIN'`) — there's no self-service promotion endpoint. |

A JWT's `role` claim is fixed at issuance — if a user's role changes in the DB, they must log in again to get a token reflecting it.

## Standard response format

Success responses return the resource directly, with no wrapper:

```json
{ "id": "cl123", "email": "demo@payments.local", "name": "Demo" }
```

Errors always use the same envelope:

```json
{
  "success": false,
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_ERROR",
    "fields": [{ "field": "email", "message": "Invalid email" }]
  }
}
```

Paginated list responses (`GET /api/users/:id/payments`):

```json
{
  "data": [ { "id": "pay_1", "amount": "49.99", "status": "APPROVED" } ],
  "meta": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

## Security notes (the "plus" features)

- **Card tokenization**: the API never persists a PAN or CVV. The full
  number is validated (Luhn checksum, brand detection, expiry) and
  discarded immediately after generating an opaque token — the same model
  real processors like Stripe use.
- **Revocable refresh tokens**: persisted as a SHA-256 hash (never the raw
  token) in `refresh_tokens`, with rotation on every `/refresh` call and
  reuse detection (a revoked token used again is rejected).
- **Idempotency keys**: `POST /api/payments` accepts an idempotency key
  (auto-generated if omitted). Replaying the same key returns the
  original payment instead of charging twice.
- **Processor retry with backoff**: the API client retries a 503 or
  timeout from the processor up to 3 times (200ms → 800ms → 3200ms)
  before giving up — validated at both ends with Zod so a contract drift
  fails fast instead of corrupting a payment record.
- **No account enumeration**: wrong password and unknown email return the
  identical `401 INVALID_CREDENTIALS`.

## Postman collection

A ready-to-import collection lives at [`postman/payments-platform.postman_collection.json`](postman/payments-platform.postman_collection.json).

1. Import the file into Postman.
2. Run **Auth → Register** (or **Login**) — the access token is saved
   automatically into the collection variable `accessToken` via a test
   script; every subsequent request in Cards/Payments reuses it.
3. The **Processor** folder targets `{{processorUrl}}` (port 8000) and
   needs no auth.

## Testing

Full smoke-test guides (curl walkthroughs per feature) live in
[`docs/TESTING.md`](docs/TESTING.md).

```bash
# API
cd apps/api && bun run typecheck && bun run lint && bun run format:check && bun run test

# Processor
cd apps/processor && uv run pytest -q && uv run ruff check
```

## Project layout

```
apps/
  api/          Fastify + TypeScript REST API
    src/
      config/       env validation, Prisma client
      controllers/  HTTP handlers
      dto/          Zod request/response schemas, per feature
      exceptions/   HttpException hierarchy
      helpers/      Luhn, tokens, passwords
      plugins/      error handler, auth guard
      repositories/ Prisma wrappers
      routes/       Fastify route registration
      schemas/      shared Zod primitives + envelopes
      services/     business logic + processor client
    prisma/         schema, migrations, seed
    tests/          Vitest (unit + integration)
  processor/    FastAPI mock payment processor
    app/          config, schemas, business logic
    tests/        pytest
docs/
  TESTING.md    per-feature smoke-test guides
postman/
  payments-platform.postman_collection.json
docker-compose.yml
```
