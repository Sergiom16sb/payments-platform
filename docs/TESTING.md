# Testing & Operations Runbook

> Detailed testing, smoke-test, and operational procedures for `payments-platform`.
> This file is the developer-facing companion to the high-level [README](../README.md).
> Each section is tagged with which PR introduced the functionality.

---

## 0. Quick Smoke Test (works after PR #2)

Verifies that the repo's foundation (Fastify + TypeScript scaffold, Postgres via docker) is wired correctly. Every endpoint will return 404 because no routes are registered yet — that's expected. The point is to prove the runtime and quality gates work.

### 0.1 Prerequisites
- Bun `>= 1.3` (`curl -fsSL https://bun.sh/install | bash`)
- Docker + Docker Compose v2 (`docker compose version`)
- Node 20+ (only if you want to run `node dist/server.js` from a production build)

### 0.2 Bring up the database
From the repo root:
```bash
docker compose up -d postgres
docker compose ps
# Expected: payments-postgres   ...   healthy   (within ~10s)
docker compose exec postgres pg_isready -U postgres
# Expected: /var/run/postgresql:5432 - accepting connections
```

If `healthy` doesn't appear:
- Check logs: `docker compose logs postgres`
- Common cause: port 5432 already in use locally. Edit `.env` (`POSTGRES_PORT`) or stop the conflicting service.

To tear down (including the volume — **destroys data**):
```bash
docker compose down -v
```

### 0.3 Run the API in dev mode
```bash
cd apps/api
bun install              # idempotent; bun.lock is committed
bun run dev              # tsx watch src/server.ts
# Expected: "server listening at http://0.0.0.0:3000"
```

The logger is `pino-pretty` in dev (translates timestamps, colorizes levels). In production (`NODE_ENV=production`) it falls back to structured JSON.

### 0.4 Probe with curl
The app has no routes yet, so every path returns 404:
```bash
curl -i http://localhost:3000/
# HTTP/1.1 404 Not Found
# {"statusCode":404,"error":"Not Found","message":"Route not found"}

curl -i http://localhost:3000/api/health
# Same 404 — the health route lands in PR #4 (feat/api-foundation)
```

This proves:
- Fastify is listening on the configured port
- The JSON error envelope is the Fastify default (we'll override it in PR #4 with our HTTPException hierarchy)
- No route is registered (expected at this stage)

### 0.5 Graceful shutdown
Send `SIGINT` (Ctrl+C) or `SIGTERM` to the running `bun run dev` process:
```
^C
{"level":30,"time":...,"pid":...,"hostname":...,"signal":"SIGINT","msg":"shutting down"}
```
The process exits with code 0. There are no DB connections yet, so `prisma.$disconnect()` is a no-op until PR #4.

### 0.6 Run quality gates
All four should pass with zero warnings:
```bash
cd apps/api
bun run typecheck    # tsc --noEmit (strict + noUncheckedIndexedAccess + isolatedModules)
bun run lint         # eslint .
bun run format:check # prettier --check
bun run test         # vitest run (no tests yet, exits 0)
```

If `bun run lint` fails complaining about `import/order` or the `@/*` alias, run:
```bash
bun run lint:fix
bun run format
```

---

## 1. Troubleshooting

### 1.1 `bun: command not found`
Install Bun from <https://bun.sh>. The repo declares `engines.node >= 20` but the dev tooling is Bun-first.

### 1.2 Docker daemon not running
`docker compose up -d postgres` will fail with `Cannot connect to the Docker daemon`. Start Docker Desktop or `sudo systemctl start docker`.

### 1.3 Postgres port already taken
```bash
sudo lsof -i :5432
# or
ss -tlnp | grep 5432
```
Either stop the conflicting process or change `POSTGRES_PORT` in `.env` (compose file reads it via `${POSTGRES_PORT:-5432}`).

### 1.4 `prisma migrate dev` can't reach the DB
If the error mentions `Can't reach database server at localhost:5432`, the container isn't healthy yet. Wait for `docker compose ps` to show `healthy`, or:
```bash
docker compose exec postgres pg_isready -U postgres
```

### 1.5 Type errors after pulling
`bun run typecheck` should always pass on `main`. If you see red squiggles after a `git pull`:
```bash
cd apps/api && bun install
```
A new dependency may have been added.

---

## 2. What's coming next

Each PR adds new functionality. This runbook will get new sections as we land:

| PR | Branch | Runbook section to expect |
|---|---|---|
| #6 | `feat/db-schema` | `## Database operations` — `prisma migrate`, `prisma studio`, `prisma db seed` |
| #7 | `feat/api-foundation` | (covered above in `## 3. API Foundation Smoke Test`) |
| #8 | `feat/api-auth` | (covered below in `## 4. Auth smoke tests`) |
| #9 | `feat/processor-fastapi` | (covered below in `## 5. Processor smoke tests`) |
| #10 | `feat/api-cards` | (covered below in `## 6. Cards smoke tests`) |
| #11 | `feat/api-payments` | (covered below in `## 7. Payment flow smoke tests`) |
| #12 | `chore/docker-full-stack` | `## 9. Full stack via docker compose` |
| #13 | `docs/readme-and-postman` | `## 10. Postman collection` |

---

## 3. API Foundation Smoke Test (works after PR #7 `feat/api-foundation`)

PR #7 wires the Fastify plugins, the centralized error handler, the env validation, and the shared Zod schemas. None of it is business logic yet — it just proves the foundation is solid. Use this section to verify a fresh clone works before moving on to feature PRs.

### 3.1 Prerequisites

Same as section 0.1, plus:
- `apps/api/.env` exists with at least `DATABASE_URL`, `JWT_SECRET` (>= 32 chars), `PAYMENTS_PROCESSOR_URL`. See `apps/api/.env.example` (TODO: not yet committed — use the values from `docker-compose.yml` defaults).

### 3.2 Bring up postgres + boot the API

```bash
docker compose up -d postgres
cd apps/api
bun install
bun run dev
# Expected: "Server listening at http://127.0.0.1:3000"
```

### 3.3 Verify the plugin stack is wired

```bash
# Swagger UI — auto-generated OpenAPI spec from Zod schemas
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api-docs/
# Expected: 200

# OpenAPI JSON spec (the schemas dict is empty because no routes are registered yet)
curl -s http://localhost:3000/api-docs/json | jq '.info.title, .openapi'
# Expected: "Payments API", "3.1.0"

# Helmet security headers
curl -s -I http://localhost:3000/api-docs/ | grep -iE "strict-transport|x-content-type|x-frame-options"
# Expected: at least Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options

# Rate-limit headers (100 req / 15 min global)
curl -s -I http://localhost:3000/api-docs/ | grep -i ratelimit
# Expected: x-ratelimit-limit: 100, x-ratelimit-remaining: <some int>, x-ratelimit-reset: <seconds>

# CORS — preflight from a disallowed origin must NOT echo Access-Control-Allow-Origin
curl -s -I -X OPTIONS http://localhost:3000/api-docs/ \
  -H "Origin: http://evil.example" \
  -H "Access-Control-Request-Method: GET" | grep -i "access-control-allow-origin"
# Expected: (no output — origin is not whitelisted)
```

### 3.4 Verify the env validation fails fast

```bash
cd apps/api
# Missing required vars — process should exit with a Zod issue list, not a cryptic undefined later.
JWT_SECRET=short DATABASE_URL='postgresql://x@y/z' PAYMENTS_PROCESSOR_URL='http://x' bun run dev
# Expected: "Invalid environment configuration: JWT_SECRET: JWT_SECRET must be at least 32 characters for HS256"
```

### 3.5 Verify the error envelope

Every error — thrown by handlers, thrown by services, raised by Zod, raised by Prisma, or just "route not found" — returns the same envelope:

```bash
# Unknown route -> 404 with our envelope (NOT Fastify's default)
curl -s http://localhost:3000/api/nope | jq
# Expected:
# {
#   "success": false,
#   "error": {
#     "message": "Route GET:/api/nope not found",
#     "code": "NOT_FOUND"
#   }
# }

# Unknown method -> same envelope
curl -s -X PATCH http://localhost:3000/api-docs/ | jq
# Expected: { "success": false, "error": { "message": "Route PATCH:/api-docs/ not found", "code": "NOT_FOUND" } }
```

These probes hit Fastify's `setNotFoundHandler` (notFound envelopes) without needing any route to be registered — useful as a healthcheck that the error envelope wiring survived a fresh boot.

### 3.6 Run quality gates

```bash
cd apps/api
bun run typecheck   # tsc --noEmit, strict + noUncheckedIndexedAccess
bun run lint        # biome check
bun run format:check
bun run test        # 36 tests across env, error-handler, and shared schemas
```

If `bun run lint` reports warnings, run:
```bash
bun run lint:fix
bun run format
```

### 3.7 What's not yet wired

- **No routes registered.** Every endpoint except `/api-docs/` and `/api-docs/json` returns 404. The `/api/health` route lands in a future PR.
- **No JWT auth.** `@fastify/jwt` is installed but not wired — that's PR #8.
- **No Prisma client at boot.** `DATABASE_URL` is validated but no connection is opened until the first query (PR #8+).

If any probe above fails, check the corresponding troubleshooting entry in section 1 or open a debug session with `LOG_LEVEL=debug bun run dev`.

---

## 4. Auth smoke tests (works after PR #8 `feat/api-auth`)

PR #8 adds the `/api/auth/*` endpoints (register, login, refresh, logout). With postgres up and the API booted, you can exercise the full flow with curl.

### 4.1 Boot

```bash
docker compose up -d postgres
cd apps/api
bun install
bun run dev
```

### 4.2 Register a user

```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","password":"Secret123"}'
# Expected: HTTP/1.1 201 Created
# {
#   "user": { "id": "cm...", "email": "alice@example.com", "name": "Alice",
#             "role": "USER", "createdAt": "..." },
#   "accessToken": "eyJ...",
#   "refreshToken": "eyJ...",
#   "accessTokenExpiresIn": "15m",
#   "refreshTokenExpiresIn": "7d"
# }
# Set-Cookie: refresh_token=eyJ...; HttpOnly; SameSite=Lax; Path=/api/auth
```

Save the `refreshToken` for the next steps, or just reuse the cookie.

### 4.3 Login (proves wrong password returns 401, not 404)

```bash
# Correct password
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Secret123"}'
# Expected: 200 + tokens

# Wrong password
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"WrongPass1"}'
# Expected: 401
# { "success": false, "error": { "message": "Invalid email or password",
#                                 "code": "INVALID_CREDENTIALS" } }
# (same code/message as a missing email — no account enumeration)
```

### 4.4 Refresh (token rotation + reuse detection)

```bash
# Use the cookie from step 4.2
curl -i -X POST http://localhost:3000/api/auth/refresh \
  -H "Cookie: refresh_token=<paste from set-cookie above>"
# Expected: 200 + a NEW refresh token (different from the one issued at register)

# Reusing the original refresh token now returns 401 (reuse detection)
curl -i -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<original token>"}'
# Expected: 401 { error: { code: "REVOKED_REFRESH" } }
```

### 4.5 Logout (idempotent)

```bash
curl -i -X POST http://localhost:3000/api/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<current token>"}'
# Expected: 204 No Content (and the refresh_token cookie is cleared)

# Subsequent refresh with the same token -> 401
```

### 4.6 Weak password rejection (Zod schema)

```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@example.com","name":"Bob","password":"weak"}'
# Expected: 400
# { "success": false, "error": {
#     "code": "VALIDATION_ERROR",
#     "fields": [{ "path": "password", "message": "..." }]
# } }
```

### 4.7 Duplicate email rejection

```bash
curl -i -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice2","password":"Secret456"}'
# Expected: 409
# { "success": false, "error": { "message": "Email is already registered",
#                                 "code": "EMAIL_TAKEN" } }
```

### 4.8 Quality gates

```bash
cd apps/api
bun run typecheck   # clean
bun run lint        # clean
bun run format:check
bun run test        # 63 tests passing
```

### 4.9 What's not yet wired

- No `/api/users/me` or PATCH/DELETE — those come with a separate user-management PR or stay out of scope per the PDF.
- No protected routes require an access token yet — that's PR #9+ (cards/payments add `Authorization: Bearer` enforcement).
- The refresh cookie is `httpOnly` + `SameSite=Lax` but `secure: false` in dev. Production builds set `secure: true` automatically when `NODE_ENV=production`.

---

## 5. Processor smoke tests (works after PR #9 `feat/processor-fastapi`)

PR #9 adds `POST /process` (approve/reject decision) and expands `GET /health` on the Python processor service.

### 5.1 Boot

The processor runs as part of the full docker stack:

```bash
docker compose up -d processor
# OR for the whole stack:
docker compose up -d postgres processor
```

`processor` is independent — it doesn't need postgres. Healthy when `/health` returns 200.

### 5.2 Health probe

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
# Expected:
# {
#   "status": "ok",
#   "uptime": 42.3
# }
```

### 5.3 Approve / reject decision

```bash
curl -s -X POST http://localhost:8000/process \
  -H 'Content-Type: application/json' \
  -d '{"paymentId":"p1","amount":"49.99","currency":"USD","cardToken":"tok_test"}' \
  | python3 -m json.tool
# Expected APPROVED ~80% of the time:
# {
#   "processorRef": "<uuid4 hex>",
#   "status": "APPROVED",
#   "reason": null
# }
# Expected REJECTED ~20% of the time:
# {
#   "processorRef": "<uuid4 hex>",
#   "status": "REJECTED",
#   "reason": "INSUFFICIENT_FUNDS" | "EXPIRED" | "FRAUD_SUSPECTED"
# }
```

### 5.4 Validation errors (422)

```bash
# Lowercase currency
curl -s -X POST http://localhost:8000/process \
  -H 'Content-Type: application/json' \
  -d '{"paymentId":"p","amount":"5","currency":"usd","cardToken":"t"}'
# Expected: 422 (Pydantic rejects lowercase)

# Zero amount
curl -s -X POST http://localhost:8000/process \
  -H 'Content-Type: application/json' \
  -d '{"paymentId":"p","amount":"0","currency":"USD","cardToken":"t"}'
# Expected: 422

# Extra field
curl -s -X POST http://localhost:8000/process \
  -H 'Content-Type: application/json' \
  -d '{"paymentId":"p","amount":"5","currency":"USD","cardToken":"t","sneaky":"x"}'
# Expected: 422 (extra='forbid')
```

### 5.5 Configuring behavior

All via env (read at startup, frozen in `app.config.settings`):

| Env var | Default | Effect |
|---|---|---|
| `PROCESSOR_APPROVE_RATIO` | 0.8 | P(APPROVED). 0.0 → always reject, 1.0 → always approve. |
| `PROCESSOR_MIN_LATENCY_MS` | 50 | Min simulated latency per call. |
| `PROCESSOR_MAX_LATENCY_MS` | 200 | Max simulated latency per call. |
| `PROCESSOR_ERROR_RATE` | 0.01 | P(503 per call). Used by the API client to test retry. |
| `LOG_LEVEL` | info | Standard Python log level. |

Override in docker-compose by adding to `processor.environment`, e.g. `PROCESSOR_APPROVE_RATIO=0.5` to force a 50/50 split for a manual test.

### 5.6 Quality gates

```bash
cd apps/processor
uv sync --frozen         # installs pinned deps
uv run pytest -q         # 7 tests passing (distribution + validation + happy path)
uv run ruff check        # static analysis (uses [tool.ruff.lint] from pyproject.toml)
```

### 5.7 What's not yet wired

- The processor doesn't persist anything — every call is stateless, so the same `paymentId` can be re-processed (the API client is responsible for idempotency, PR #11).
- No auth on `/process` — the docker network is the only access control. In a real deploy, both the API and processor would sit behind a private network and the processor would reject calls from outside.
- No DB ping yet — `/health` only confirms the process is alive.

---

## 6. Cards smoke tests (works after PR #10 `feat/api-cards`)

PR #10 adds the `/api/cards` endpoints with **tokenization** — the API never stores the PAN or CVV; only an opaque token + last4 + brand survive in the database (PLAN §9).

### 6.1 Register a card (requires auth)

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"Secret123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

curl -i -X POST http://localhost:3000/api/cards \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"pan":"4111111111111111","cvv":"123","expMonth":12,"expYear":2030,"cardholderName":"Alice Example"}'
# Expected: HTTP/1.1 201 Created
# {
#   "id": "cms9a...",
#   "brand": "VISA",
#   "last4": "1111",
#   "expMonth": 12,
#   "expYear": 2030,
#   "cardholderName": "Alice Example",
#   "token": "tok_<48 hex chars>",
#   "createdAt": "..."
# }
# Notice: NO 'pan', NO 'cvv' in the response.
```

### 6.2 Validation errors

```bash
# Bad Luhn (off-by-one)
curl -i -X POST http://localhost:3000/api/cards \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"pan":"4111111111111112","cvv":"123","expMonth":12,"expYear":2030,"cardholderName":"x"}'
# Expected: 400 { error: { code: "INVALID_PAN" } }

# Expired
curl -i -X POST http://localhost:3000/api/cards \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"pan":"4111111111111111","cvv":"123","expMonth":1,"expYear":2020,"cardholderName":"x"}'
# Expected: 400 { error: { code: "CARD_EXPIRED" } }
```

### 6.3 List / get / delete

```bash
# List current user's cards
curl -s http://localhost:3000/api/cards -H "Authorization: Bearer $TOKEN"
# Expected: { success: true, data: [...] }

# Get one (with ownership check)
curl -i http://localhost:3000/api/cards/<id> -H "Authorization: Bearer $TOKEN"
# Expected: 200 with the card | 403 NOT_CARD_OWNER if owned by another user | 400 CARD_NOT_FOUND

# Delete
curl -i -X DELETE http://localhost:3000/api/cards/<id> -H "Authorization: Bearer $TOKEN"
# Expected: 204
```

### 6.4 Auth required

```bash
# Without the Bearer token, every cards endpoint returns 401.
curl -i http://localhost:3000/api/cards
# Expected: 401 { error: { code: "UNAUTHENTICATED" } }
```

### 6.5 Verify the DB never stored the PAN

After registering a card, check the raw DB row. PAN/CVV columns **do not exist** in the schema (`apps/api/prisma/schema.prisma`) — only `last4` + `token` + brand + meta. Confirms the tokenization works:

```bash
docker compose exec -T postgres psql -U postgres -d payments \
  -c 'SELECT id, brand, "last4", "cardholderName", token FROM cards LIMIT 3;'
# Expected: only those columns. No pan, no cvv.
```

### 6.6 Soft delete (PR #13)

The DELETE endpoint is now a **soft delete**: the row stays in the DB (with `deletedAt = now()`) but is hidden from all reads. This preserves the `Payment.cardId` FK so historical payment rows keep referencing the card after the user "deletes" it.

```bash
# Register a card (assumes $TOKEN and $CARD_ID from steps above)
curl -s -X DELETE "http://localhost:3000/api/cards/$CARD_ID" -H "Authorization: Bearer $TOKEN"
# Expected: 204 No Content

# GET deleted card -> 404 CARD_NOT_FOUND
curl -s -i "http://localhost:3000/api/cards/$CARD_ID" -H "Authorization: Bearer $TOKEN"
# Expected: 404 + {"success":false,"error":{"message":"Card ... not found","code":"CARD_NOT_FOUND"}}

# List shows 0 cards
curl -s http://localhost:3000/api/cards -H "Authorization: Bearer $TOKEN" | jq 'length'
# Expected: 0

# DB still has the row, just marked
docker compose exec -T postgres psql -U postgres -d payments \
  -c "SELECT id, last4, \"deletedAt\" FROM cards WHERE id = '$CARD_ID';"
# Expected: 1 row, deletedAt populated
```

An admin endpoint to restore soft-deleted cards is not exposed via HTTP in this PR — the repository has a `restore(id)` helper so a future admin route or batch job can clear `deletedAt`.

### 6.6 Quality gates

```bash
cd apps/api
bun run typecheck   # clean
bun run lint        # clean
bun run format:check
bun run test        # 91 tests passing
```

### 6.7 What's not yet wired

- The token is opaque but not encrypted at rest. For production, the column should be encrypted with a KMS key (out of scope for the technical test).
- No "default card" or "set as primary" endpoint.
- Cards are referenced by id in `/api/payments` (PR #11), not by token — the token is meant for the client-side API.

---

## 7. Payment flow smoke tests (works after PR #11 `feat/api-payments`)

PR #11 adds `/api/payments` — the endpoint that ties the API, the card token, and the Python processor together. All routes require auth.

### 7.1 Create a payment (happy path)

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"Secret123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

CARD_ID=$(curl -s http://localhost:3000/api/cards -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")

curl -i -X POST http://localhost:3000/api/payments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"cardId\":\"$CARD_ID\",\"amount\":49.99}"
# Expected APPROVED (~80% of the time):
#   HTTP/1.1 201 Created
#   { "id": "...", "status": "APPROVED", "processorRef": "<uuid4 hex>", ... }
# Expected REJECTED (~20% of the time):
#   HTTP/1.1 402 Payment Required
#   { "success": false, "error": { "message": "Payment rejected: ...",
#       "code": "PAYMENT_REJECTED", "details": { "payment": {...} } } }
```

### 7.2 Idempotency — same key, no double charge

```bash
KEY=$(python3 -c "import uuid; print(uuid.uuid4())")

# First call creates the payment
curl -s -X POST http://localhost:3000/api/payments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"cardId\":\"$CARD_ID\",\"amount\":15,\"idempotencyKey\":\"$KEY\"}" \
  | python3 -c "import json,sys; print('first id:', json.load(sys.stdin)['id'])"

# Second call with the SAME key returns the SAME payment — the processor
# is not called again (verify no duplicate row appears in payment history).
curl -s -X POST http://localhost:3000/api/payments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"cardId\":\"$CARD_ID\",\"amount\":15,\"idempotencyKey\":\"$KEY\"}" \
  | python3 -c "import json,sys; print('second id:', json.load(sys.stdin)['id'])"
# Expected: both ids are identical.
```

### 7.3 Ownership checks

```bash
# Using a card that belongs to another user -> 403
curl -i -X POST http://localhost:3000/api/payments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"cardId":"<someone-elses-card-id>","amount":5}'
# Expected: 403 NOT_CARD_OWNER

# Fetching someone else's payment -> 403
curl -i http://localhost:3000/api/payments/<someone-elses-payment-id> \
  -H "Authorization: Bearer $TOKEN"
# Expected: 403 NOT_PAYMENT_OWNER

# Listing someone else's history -> 403
curl -i http://localhost:3000/api/users/<other-user-id>/payments \
  -H "Authorization: Bearer $TOKEN"
# Expected: 403 NOT_SELF
```

### 7.4 Payment history (paginated)

```bash
ME=$(curl -s http://localhost:3000/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"Secret123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['user']['id'])")

curl -s "http://localhost:3000/api/users/$ME/payments?page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
# Expected: { "data": [...], "meta": { "page": 1, "pageSize": 10, "total": N, "totalPages": ... } }

# Filter by status
curl -s "http://localhost:3000/api/users/$ME/payments?status=APPROVED" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### 7.5 Processor retry (manual — requires stopping the processor)

To see the retry-with-backoff behavior live:
1. Stop the processor container: `docker compose stop processor`
2. Attempt a payment — the API will retry 3 times (200ms, 800ms, 3200ms delays) before returning 503.
3. `docker compose start processor` to restore normal behavior.

```bash
curl -i -X POST http://localhost:3000/api/payments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"cardId\":\"$CARD_ID\",\"amount\":5}"
# Expected (processor down): ~4.2s total latency, then:
#   HTTP/1.1 503 Service Unavailable
#   { "error": { "code": "PROCESSOR_UNREACHABLE" } }
```

### 7.6 Quality gates

```bash
cd apps/api
bun run typecheck && bun run lint && bun run format:check
bun run test        # 126 tests passing
```

### 7.7 What's not yet wired

- No admin bypass on `GET /api/users/:id/payments` — only the payment's own owner can list it. Admin routes are out of scope for this technical test.
- No reconciliation job for PENDING payments that got stuck after a processor timeout — a client retry with the same idempotencyKey returns the PENDING row as-is; resolving it would need a background job.
- Currency conversion is not implemented — `currency` on the payment must match what the processor expects (both default to USD).

---

## 8. Conventions

- **All commits** use [Conventional Commits](https://www.conventionalcommits.org/) in English. No `Co-Authored-By`.
- **One PR per branch**, squash-merged to `main`. PR description follows the `What / Why / How to test / Checklist / Refs / Commits` template.
- **Tests** live in `apps/api/tests/` and run with `bun run test` (Vitest). Use `app.inject()` from Fastify — never spin up a real HTTP server in tests.
- **Logs** are JSON in production, pretty in dev. Never `console.log` in committed code; use `app.log.info(...)` inside Fastify or `console.error` only for unrecoverable startup failures.