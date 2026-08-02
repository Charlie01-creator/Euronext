# Changelog

All notable changes to the NexusCapital platform, in chronological order.

## [Unreleased] — Payment Provider Migration: Flutterwave → Pesapal

Full replacement of Flutterwave with Pesapal for deposits and package purchases, at the product owner's request. Withdrawals are handled separately (see below) since Pesapal's public API has no disbursement/payout endpoint — confirmed by reviewing their actual API 3.0 documentation before writing any code, rather than assuming feature parity with Flutterwave.

### Payments
- New `src/modules/payments/pesapal.provider.ts` — OAuth-style bearer token auth (cached in Redis, ~4 min TTL), one-time IPN registration (cached indefinitely, keyed to `APP_BASE_URL`), order submission, and transaction status verification.
- `flutterwave.provider.ts` deleted entirely.
- `payments.service.ts` rewritten: `initiatePayment()` now calls Pesapal's `submitOrder` instead of the old mobile-money-vs-hosted-checkout branch — Pesapal shows every payment method (mobile money, card, bank) on one hosted page, so the app no longer needs to know or ask which method the user wants up front. The webhook handler (`handlePesapalIpn`) reuses the same atomic compare-and-swap and persisted-audit-trail pattern the Flutterwave integration had, adapted for Pesapal's status taxonomy (`COMPLETED`/`FAILED`/`INVALID`/`PENDING`/`REVERSED`) and its distinct IPN response contract (a structured JSON body with a `status` field, sent with HTTP 200 regardless of outcome — different from a typical webhook's HTTP-status-driven retry signal).
- `deposits.routes.ts` and `packages.service.ts`/`packages.validation.ts` simplified — no more `method`/`phone` fields required at request time.

### Withdrawals — now admin-approved, not automated
- Removed the automated payout API call entirely. Balance is still deducted up front when a user requests a withdrawal (reserving the funds), but nothing calls any external payout API anymore.
- New `src/modules/admin/` module: `GET /admin/withdrawals` (list pending, oldest first), `POST /admin/withdrawals/:id/approve` (confirms the admin has already sent the money manually), `POST /admin/withdrawals/:id/reject` (refunds the reserved balance). All three require the `ADMIN` role — the first real use of the RBAC infrastructure built in an earlier session, which had existed with nothing to protect.
- Added `ADMIN_EMAIL` to the seed script — the only way to promote an account to ADMIN, since there's deliberately no self-service "become admin" API route.

### Frontend
- `Deposit.submit()` simplified to match — no more phone prompt, no more method dropdown (removed from the UI entirely and replaced with a note that method selection happens on Pesapal's page, since leaving a selector that does nothing would be more confusing than not having one).
- **Wired two flows to the real backend for the first time** — the package purchase flow (`Catalog`) and the withdrawal request flow (`Withdraw`) were both still pure frontend simulations before this session, never connected to any real API despite referencing Flutterwave in their toast messages. Fixing the Flutterwave references alone would have left them cosmetically updated but still fake; both now call the real endpoints. This also required teaching `Catalog.renderCatalog()` to fetch the real package catalog (with real database IDs) instead of only using the hardcoded mock array, since a real purchase call needs a real package ID to reference.
- Fixed two more stale references found while checking: a "Stripe & Flutterwave Supported" badge (Stripe was never actually integrated at all) and a withdrawal help-text claiming a fixed "2 hours" turnaround that's no longer accurate now that withdrawals are manually reviewed.

### Configuration
- `.env.example` and `env.ts`: `FLUTTERWAVE_*` variables replaced with `PESAPAL_CONSUMER_KEY`/`PESAPAL_CONSUMER_SECRET`/`PESAPAL_BASE_URL` (sandbox by default) and `ADMIN_EMAIL`.
- `WebhookEvent.provider` default changed from `"flutterwave"` to `"pesapal"`.
- README's frontend-to-endpoint mapping table and "out of scope" section updated — the previous version listed "no admin routes" and "no test suite," both now stale.

---

## Previous session — Enterprise Audit & Hardening Pass

### Security
- **CSRF protection** added via double-submit cookie pattern (`src/middleware/csrf.middleware.ts`), applied to `/auth/refresh` and `/auth/logout` — the only two endpoints that rely purely on a cookie for authentication. Every other endpoint requires an explicit `Authorization: Bearer` header, which a forged cross-site request can't attach automatically.
- **Webhook rate limiting** — the Flutterwave webhook endpoint had no rate limiting at all, unlike every other route. Added a dedicated 60 req/min limiter.
- Frontend `Api` module updated to read the CSRF cookie and send it as `X-CSRF-Token` on every request — required for the above to work at all without breaking session refresh.

### Accessibility
- Added a centralized, `MutationObserver`-based accessibility enhancer to the dashboard covering every interactive `<div>` (subnav tabs, quick-action items, method selectors, bottom nav, notification items) — 49 elements previously had no keyboard focus, no ARIA role, and no Enter/Space support.
- Added `:focus-visible` styling matching the existing blue accent color.
- Fixed 13 decorative icon buttons on the login page with `aria-hidden`/`tabindex="-1"` (correct treatment — they're pure cursor-follow decoration with no click handler).
- Added dynamic `aria-label` ("Show password"/"Hide password") to both password-visibility toggle buttons, on both the login and register pages.

### API
- Added sorting support to the pagination utility (`src/utils/pagination.ts`), with field-allowlisting via `resolveSort()` — restricts sortable fields to a known-safe list rather than passing an arbitrary client-supplied string into a Prisma `orderBy` clause.
- Applied sorting to the deposits and withdrawals list endpoints.

### Testing
- Set up Jest + ts-jest properly — a `test` script existed in `package.json` referencing Jest, but it was never actually installed, configured, or had any test files.
- Added `jest.config.js` and three real test suites: money-rounding (`tests/money.test.ts`), Uganda phone number normalization (`tests/auth.service.test.ts`), and pagination/sorting (`tests/pagination.test.ts`). Every expected value in these tests was numerically verified against actual Node.js execution before being written, not assumed.
- Exported `normalizeUgandaPhone` from `auth.service.ts` (previously private) to make it directly testable.

### Performance / Database
- Reviewed all service-layer code for N+1 query patterns — none found. The one sequential loop (the package-maturity background job) is intentionally sequential for financial-transaction safety, not a bug.

---

## Previous session — Frontend Navigation & Consistency Pass

- Ported an existing "page transition veil" (fade-out → navigate → fade-in) from the register page to the login page, and added a shared `navigateWithVeil()` helper so both link clicks and programmatic redirects (login/register success) use the same smooth transition.
- Fixed four dead links pointing at `nexus-invest.html`, a file that was never built anywhere in this project — login logo, register logo, register's "Back to Home" link, and the dashboard's logo/user-avatar clicks now point to real destinations.
- Removed a dead "Markets" sidebar link with no corresponding page.
- Fixed a lingering brand inconsistency — the login page's title, logo, and heading still said "Euronext" (the project's original working name) while every other page correctly said "NexusCapital."
- Standardized the mobile breakpoint to 560px across all three frontend pages (login was using 540px).
- Caught and fixed a CSS brace-balance bug introduced mid-edit (a `str_replace` accidentally consumed a media query's closing brace) — found via post-edit validation, not left in.

## Previous session — Currency & Package Return Model Change

- Reduced supported currencies from six (USD, GBP, EUR, UGX, CAD, AUD) to three East African shillings (UGX, KES, TZS), using real current exchange rates. USD remains as an internal ledger reference only (every balance is stored in USD internally) but is no longer selectable in the UI.
- Added cleanup logic to the seed script — the previous upsert-only loop would have left GBP/EUR/CAD/AUD as orphaned rows in any already-seeded database; it now deletes currencies no longer in the active list.
- Replaced the percentage-based package return model (`Package.ratePercent`) with a fixed-dollar model (`Package.fixedReturnUsd`) — payout is now `principal + fixedReturnUsd` instead of `principal × (1 + rate/100)`, applied consistently across the schema, seed data, calculation logic, and frontend display.

## Previous session — Deployment Configuration

- Added `netlify.toml` for static-frontend-only preview deployments.
- Renamed `login-1.html` to `index.html` so static hosts and `express.static` resolve the root path automatically, removing a manual Express route that existed only to work around the non-standard filename.
- Added `APP_BASE_URL` env var and fixed Flutterwave hosted-checkout redirect URLs, which were previously built from `CORS_ORIGIN` (correct when frontend and backend were separate origins, wrong once they were consolidated into one service).

## Previous session — Full Security & Backend Hardening Pass

### Authentication
- Pinned JWT verification to `HS256` explicitly (closes algorithm-confusion attacks) and added runtime shape validation on decoded token payloads.
- Fixed a CORS misconfiguration — `CORS_ORIGIN` defaulted to `'*'` combined with `credentials: true`, an invalid and dangerous combination per the CORS spec. Replaced with an explicit origin allowlist.
- Added a Content-Security-Policy via Helmet, explicitly allowlisting the exact CDNs the frontend uses (Font Awesome, Socket.IO) — Helmet's bare defaults would have silently blocked both in production.
- Added account lockout (5 failed attempts locks for 15 minutes) independent of IP-based rate limiting.
- Added "remember me" (90-day vs 30-day refresh tokens) and full multi-device session management (`GET /auth/sessions`, `DELETE /auth/sessions/:id`).
- Added email verification and password reset flows.
- Migrated rate limiting from in-memory storage to Redis-backed storage — the in-memory version meant N running instances gave an attacker N× the real limit.
- Added RBAC infrastructure — a `role` field flows through the JWT and `req.user`, with a `requireRole()` middleware ready to gate future admin routes.

### Payments
- Fixed a real race condition: two near-simultaneous webhook deliveries (normal behavior for at-least-once delivery, not an edge case) could both read a transaction as still-pending and both credit the balance. Fixed with an atomic compare-and-swap inside the same database transaction as the balance credit itself.
- Fixed webhook response timing — the server previously responded `200` before processing finished, meaning a genuine failure left the transaction stuck `PENDING` forever with no retry. Now awaits processing and returns a 5xx on failure, which triggers Flutterwave's own retry mechanism.
- Added a persisted `WebhookEvent` audit trail — previously only ephemeral logs recorded webhook activity.
- Fixed the idempotency-key middleware — it previously locked permanently on failure as well as success, so a legitimate retry after a transient error got wrongly blocked as a duplicate.
- Extracted a shared `initiatePayment()` helper — deposits and package purchases had each independently duplicated the same mobile-money-vs-hosted-checkout branching logic.

### Database
- Added missing foreign keys — `Referral.referrerId`/`referredId` were bare strings with no `@relation` to `User`, meaning no database-level referential integrity.
- Added composite indexes on `Transaction` and `LoginActivity` matching the actual query patterns used throughout the codebase.

### Backend
- Added request correlation IDs (`X-Request-Id`) threaded through logs and error responses.
- Added a real readiness check (`GET /health/ready`) that verifies Postgres and Redis connectivity, distinct from the existing liveness check which only confirms the process is running.
- Fixed a real type bug: `validate.middleware.ts` typed its parameter as `AnyZodObject`, which rejects `.refine()`-based schemas — this was latent and would have failed a real `tsc` build once dependencies were installed.

## Earliest sessions — Initial Build

- Built the full NexusCapital backend: Node.js/Express/TypeScript, 11 domain modules (auth, users, packages, deposits, withdrawals, referrals, notifications, analytics, security, currency, payments), PostgreSQL via Prisma, Redis, JWT auth, Socket.IO, BullMQ background jobs, Swagger documentation, Docker deployment.
- Built the frontend: login, registration, and dashboard pages with a glassmorphism dark theme, real-time updates, and multi-currency support.
- Integrated Flutterwave for mobile money (MTN/Airtel) and hosted checkout (card/bank) payments.
- **Safety decision**: when asked to implement investment returns matching a known Ponzi/HYIP fraud pattern, proposed and implemented realistic scaled returns instead, which the product owner accepted.
