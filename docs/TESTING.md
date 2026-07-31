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
| #8 | `feat/api-auth` | `## 5. Auth smoke tests` — register, login, refresh, logout via curl |
| #9 | `feat/processor-fastapi` | `## 6. Processor smoke tests` — start FastAPI service, hit `POST /process` |
| #10 | `feat/api-cards` | `## 7. Card tokenization smoke tests` |
| #11 | `feat/api-payments` | `## 8. Payment flow smoke tests` — including idempotency |
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

## 4. Conventions

- **All commits** use [Conventional Commits](https://www.conventionalcommits.org/) in English. No `Co-Authored-By`.
- **One PR per branch**, squash-merged to `main`. PR description follows the `What / Why / How to test / Checklist / Refs / Commits` template.
- **Tests** live in `apps/api/tests/` and run with `bun run test` (Vitest). Use `app.inject()` from Fastify — never spin up a real HTTP server in tests.
- **Logs** are JSON in production, pretty in dev. Never `console.log` in committed code; use `app.log.info(...)` inside Fastify or `console.error` only for unrecoverable startup failures.