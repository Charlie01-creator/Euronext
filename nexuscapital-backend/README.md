# NexusCapital Backend

Production backend for the NexusCapital investment dashboard frontend. Node.js + Express + TypeScript + PostgreSQL (Prisma) + Redis + JWT + Socket.IO + BullMQ + Swagger, containerized with Docker.

## Quick start (Docker — recommended)

```bash
cp .env.example .env        # then fill in real secrets before going to production
docker compose up --build
```

This starts Postgres, Redis, and the API+frontend together as one service. On boot, the `app` container runs `prisma migrate deploy` automatically. Run the seed once, from your host machine, after the stack is up:

```bash
docker compose exec app npx prisma db seed
```

- **Frontend (login page)**: `http://localhost:4000/`
- **Register page**: `http://localhost:4000/nexus-register.html`
- **Dashboard**: `http://localhost:4000/nexus-dashboard-mobile.html`
- **API**: `http://localhost:4000/api/v1`
- **Swagger UI**: `http://localhost:4000/docs`
- **Health check**: `http://localhost:4000/health`

The frontend lives in `public/` and is served directly by Express (`app.ts`) — same origin as the API, so no CORS configuration is needed for it to work, and `Api.BASE_URL` in the dashboard is just `/api/v1` (relative). `CORS_ORIGIN` in `.env` only matters if you add a separate client later (e.g. a mobile app or admin panel) that needs to call this API cross-origin.

## Quick start (local, without Docker)

```bash
npm install
cp .env.example .env         # point DATABASE_URL / REDIS_URL at local instances
npx prisma migrate dev
npx prisma db seed
npm run dev
```

## Project structure

```
public/         the frontend — login-1.html, nexus-register.html, nexus-dashboard-mobile.html, served statically by Express
src/
  config/       env validation, logger, Swagger spec
  lib/          Prisma client, Redis client + cache helpers
  middleware/   auth, validation, rate limiting, idempotency, error handling
  modules/      one folder per domain — routes / controller / service / validation
  jobs/         BullMQ background jobs (package maturity sweep)
  sockets/      Socket.IO server (JWT-authenticated, per-user rooms)
  utils/        JWT, password hashing, ApiError, catchAsync
  app.ts        Express app assembly
  server.ts     entry point — boots HTTP + Socket.IO + background workers
prisma/
  schema.prisma
  seed.ts       seeds the 15-tier package catalog + currency rates
```

## How the frontend connects to this API

The dashboard's `Currency`, `Router`, `Deposit`, `Withdraw`, `Catalog`, `Referrals`, `Notifications` JS modules currently read from hardcoded arrays and show toast placeholders instead of calling a server. Below is the exact mapping — replacing a hardcoded array with a `fetch()` to the listed endpoint is the whole migration for each piece.

| Frontend piece | Replace with | Backend endpoint |
|---|---|---|
| `Identity.getUserName()` (localStorage fallback) | `GET` on load, store in memory | `GET /api/v1/users/me` |
| `login-1.html` (phone/email + password) | `POST`, sets httpOnly refresh cookie | `POST /api/v1/auth/login` |
| `login-1.html` forgot-password modal | `POST`, then `POST` with the emailed/texted token | `POST /api/v1/auth/forgot-password`, `POST /api/v1/auth/reset-password` |
| `nexus-register.html` | `POST`, sets httpOnly refresh cookie, then redirects to the dashboard | `POST /api/v1/auth/register` |
| Sidebar/topbar name, avatar, tier | same `GET /users/me` response | `GET /api/v1/users/me` |
| Dashboard welcome card (portfolio value, streak, active days, package maturity %) | `GET` on Dashboard page load | `GET /api/v1/analytics/dashboard` |
| `Earnings.renderEarningsChart()` + the 4 earn-card counters | `GET`, use `today/week/month/lifetime` in place of the hardcoded `data-target` values | `GET /api/v1/analytics/earnings` |
| Analytics "Performance" tab (conversion rate, engagement) | `GET` | `GET /api/v1/analytics/performance` |
| `PACKAGE_CATALOG` constant / `Catalog.renderCatalog()` | `GET` replaces the hardcoded array | `GET /api/v1/packages` |
| "Active Package" subview | `GET` | `GET /api/v1/packages/active` |
| `PACKAGE_HISTORY` constant / `Catalog.renderHistory()` | `GET` | `GET /api/v1/packages/history` |
| `Catalog.confirmPayment()` / `Catalog.payWithMobileMoney()` | `POST`, send `Idempotency-Key` header (e.g. a fresh UUID per tap) | `POST /api/v1/packages/:id/purchase` |
| `Deposit.submit()` | `POST`, `Idempotency-Key` header required | `POST /api/v1/deposits` |
| `Withdraw.submit()` | `POST`, `Idempotency-Key` header required | `POST /api/v1/withdrawals` |
| `REFERRALS` / `TOP_PERFORMERS` constants, `Referrals.renderTable()` | `GET` | `GET /api/v1/referrals` and `GET /api/v1/referrals/leaderboard` |
| `NOTIFICATIONS` constant, `Notifications.renderList()` | `GET` on load, then listen for the `notification:new` socket event for real-time pushes | `GET /api/v1/notifications` |
| `Notifications.markOneRead()` | `PATCH` | `PATCH /api/v1/notifications/:id/read` |
| `Notifications.markAllRead()` | `PATCH` | `PATCH /api/v1/notifications/read-all` |
| Trust Center card (Security Indicators, Financial Transparency) | `GET` | `GET /api/v1/security/overview` |
| Login History table | `GET` | `GET /api/v1/security/login-history` |
| 2FA toggle | `PATCH` | `PATCH /api/v1/security/two-factor` |
| `Currency.RATES` constant | `GET` once on boot instead of hardcoding | `GET /api/v1/currency/rates` |
| Toast after Flutterwave redirect (card/bank) | n/a — Flutterwave calls this directly | `POST /api/v1/payments/webhooks/flutterwave` |

### Real-time updates (Socket.IO)

Connect once the access token is available:

```js
const socket = io('http://localhost:4000', { auth: { token: accessToken } });
socket.on('notification:new', (n) => Notifications.prepend(n));   // new notification arrives
socket.on('notification:read', ({ id }) => Notifications.markReadInPlace(id));
socket.on('wallet:update', () => Analytics.refresh());            // balance changed — deposit/withdrawal/purchase/maturity resolved
```

### Auth flow

1. `POST /auth/register` or `/auth/login` → returns `{ accessToken }` in the body and sets an httpOnly `nexus_refresh_token` cookie.
2. Store the access token in memory (not localStorage) and send it as `Authorization: Bearer <token>` on every request.
3. On a 401, call `POST /auth/refresh` (cookie sent automatically) to get a new access token, then retry.
4. `POST /auth/logout` revokes the refresh token server-side.

### Money-movement requests need an idempotency key

`POST /packages/:id/purchase`, `POST /deposits`, and `POST /withdrawals` all require an `Idempotency-Key` header. Generate a fresh UUID client-side per user action (not per retry) — if the request is retried with the same key, the server rejects the duplicate instead of double-charging.

### Currency conversion

The frontend's `Currency` module already stores everything as USD internally and converts for display — this backend does the same: every amount is persisted as `amountUsd` / `balanceUsd`, and `POST` endpoints accept `{ amount, currency }`, converting to USD server-side via `GET /currency/rates` before touching the ledger. Never trust a client-submitted USD amount directly for money-movement endpoints; always convert server-side.

## Security & enterprise hardening (audit changes)

This backend went through a structured security/code audit. Everything below is live in the code, not aspirational:

- **JWT** pinned to `HS256` on verify (closes algorithm-confusion attacks), with runtime shape validation on decoded payloads
- **CORS** fixed from a `'*'` + credentials misconfiguration (invalid per spec, and dangerous if a client ever tolerated it) to a real comma-separated allowlist
- **CSP** configured explicitly (Helmet's bare defaults would have silently blocked the Font Awesome and Socket.IO CDNs the frontend actually loads)
- **Distributed rate limiting** via Redis (`rate-limit-redis`) — the previous in-memory store meant N running instances gave an attacker N× the real limit
- **Account lockout**: 5 failed logins locks the account for 15 minutes, independent of IP-based rate limiting (which alone is trivially bypassed by rotating IPs)
- **Remember me** (90-day vs 30-day refresh token) and **multi-device session management** — `GET /auth/sessions` lists every active device, `DELETE /auth/sessions/:id` revokes one specific device without logging out everywhere else
- **Email verification** (`POST /auth/verify-email`, `POST /auth/resend-verification`) — actual delivery still needs a real email/SMS provider wired in, same gap as password reset, see below
- **RBAC infrastructure**: a `role` field (`USER`/`ADMIN`) flows through the JWT and `req.user`; `requireRole('ADMIN')` is ready to gate routes as soon as an admin module exists
- **Payments race condition fixed**: two near-simultaneous webhook deliveries (normal at-least-once provider behavior, not an edge case) could previously both read a transaction as still-pending and both credit the balance. Fixed with an atomic compare-and-swap inside the same DB transaction as the balance credit itself
- **Webhook response timing fixed**: the server used to respond `200` before processing finished, so a genuine failure left the transaction stuck pending forever with no retry. Now awaits processing and returns a 5xx on failure, which is what triggers Flutterwave's own retry mechanism
- **Persisted webhook audit trail** (`WebhookEvent` table) — every inbound webhook is recorded, including rejected-signature attempts, independent of ephemeral logs
- **Idempotency-key bug fixed**: keys used to lock permanently even when the request failed, so a legitimate retry after a transient error got wrongly blocked as a duplicate. Now only successful requests keep the key locked
- **Referral foreign keys added** — `Referral.referrerId`/`referredId` were bare strings with no DB-level relation to `User`
- **Composite indexes** added on `Transaction` and `LoginActivity` matching the query patterns actually used (`userId + type + createdAt`, etc.)
- **Pagination** on deposits, withdrawals, and notifications — previously hard-capped at 50 with no way to see older records
- **Request correlation IDs** — every request gets an `X-Request-Id` (or reuses an inbound one), included in every log line and in error responses, so a user-reported error can be traced to an exact server log

### Migrations — action required

Every schema change above still needs a real migration generated against a live database — this project has never had a live Postgres connection available during development, so `prisma/migrations/` has never been created. Before deploying:

```bash
npx prisma migrate dev --name enterprise_hardening
```

`docker-compose.yml` runs `prisma migrate deploy`, which applies existing migrations — it will not create one from schema drift.

## What's intentionally out of scope here

- **Real KYC/AML verification** — `kycStatus` is a field you can set, not an integration with an identity verification provider. Flutterwave will require your business to complete KYB before enabling real transactions.
- **Admin dashboard/API** — this backend has the data model to support one (approve withdrawals, manage packages) but no admin routes are included; add a `role` field to `User` and an `admin` module following the same pattern as the other modules.
- **Automated tests** — the codebase is structured to be testable (services are pure functions decoupled from Express), but no test suite is included.
