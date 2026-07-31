# Updated Project Structure

Complete, accurate file tree as of this delivery — generated from the actual filesystem, not written from memory.

```
nexuscapital-backend/
│
├── CHANGELOG.md                        # Full chronological history of every change, across every session
├── REVIEW_REPORT.md                    # Audit findings, fixes, remaining gaps, and calibrated scores
├── UPDATED_PROJECT_STRUCTURE.md         # This file
├── DEPLOYMENT_GUIDE.md                 # Step-by-step deployment (Railway-focused, with alternatives noted)
├── FINAL_PRODUCTION_CHECKLIST.md       # Pre-launch checklist — what's done, what's your action item
├── README.md                           # Setup instructions + full frontend↔endpoint mapping table
│
├── .env.example                        # Every environment variable the app reads, with safe defaults
├── .gitignore
├── .dockerignore
├── package.json
├── tsconfig.json
├── jest.config.js                      # NEW — testing infrastructure (previously referenced but never set up)
├── netlify.toml                        # Static-frontend-only preview deployment config
│
├── Dockerfile                          # Multi-stage build (deps+build → slim runtime)
├── docker-compose.yml                  # app + postgres + redis, with healthchecks
├── docker/
│   └── nginx.conf                      # Optional reverse proxy config
│
├── prisma/
│   ├── schema.prisma                   # 11 models: User, RefreshToken, LoginActivity, Package,
│   │                                   #   UserPackage, Transaction, Referral, Commission,
│   │                                   #   Notification, CurrencyRate, WebhookEvent, + 6 enums
│   └── seed.ts                         # Seeds the 15-tier package catalog (fixed-dollar returns)
│                                       #   + 3 East African currencies (UGX/KES/TZS), with cleanup
│                                       #   logic for any currency removed from the active list
│
├── public/                             # Frontend — served statically by Express, same origin as the API
│   ├── index.html                      # Login page (phone/email + password, MTN/Airtel detection)
│   ├── nexus-register.html             # Registration page
│   └── nexus-dashboard-mobile.html     # Main SPA — dashboard, packages, deposit/withdraw, account
│
├── tests/                              # NEW — real test suites, not scaffolding
│   ├── money.test.ts                    # Money-rounding helper, verified against real Node execution
│   ├── auth.service.test.ts             # Uganda phone number normalization
│   └── pagination.test.ts               # Pagination parsing + sort-field allowlisting
│
└── src/
    ├── app.ts                          # Express app assembly — middleware stack, route mounting
    ├── server.ts                       # Entry point — HTTP server, Socket.IO, background workers
    │
    ├── config/
    │   ├── env.ts                      # Zod-validated environment loader
    │   ├── logger.ts                   # Pino structured logger
    │   └── swagger.ts                  # OpenAPI spec (scans JSDoc across all routes)
    │
    ├── lib/
    │   ├── prisma.ts                   # Prisma client singleton
    │   └── redis.ts                    # Redis client + cache-aside helpers
    │
    ├── middleware/
    │   ├── auth.middleware.ts          # JWT verification (requireAuth / optionalAuth / requireRole)
    │   ├── csrf.middleware.ts          # NEW — double-submit cookie CSRF protection
    │   ├── validate.middleware.ts      # Zod request validation (fixed: now accepts ZodTypeAny)
    │   ├── error.middleware.ts         # Global error handler + 404, includes request ID
    │   ├── rateLimit.middleware.ts     # Redis-backed: general, auth, and webhook limiters
    │   ├── idempotency.middleware.ts   # Fixed: releases key on failure, keeps it on success
    │   └── requestId.middleware.ts     # X-Request-Id correlation across logs
    │
    ├── types/
    │   └── express.d.ts                # Augments Request with user (incl. role) and requestId
    │
    ├── utils/
    │   ├── ApiError.ts                 # Centralized error class (incl. locked/tooMany statuses)
    │   ├── catchAsync.ts               # Wraps async handlers for the error middleware
    │   ├── jwt.ts                      # Sign/verify — pinned to HS256, runtime payload validation
    │   ├── password.ts                 # bcrypt hashing + referral code generator
    │   ├── money.ts                    # roundMoney() — used everywhere money math happens
    │   └── pagination.ts               # NEW: parsePagination, resolveSort (allowlisted), paginatedResponse
    │
    ├── jobs/
    │   └── maturity.job.ts             # BullMQ hourly sweep — matures packages, credits returns
    │
    ├── sockets/
    │   └── socket.server.ts            # JWT-authenticated Socket.IO, per-user rooms
    │
    └── modules/                        # One folder per domain
        ├── auth/                       # register/login/refresh/logout/forgot-password/reset-password/
        │                               #   verify-email/resend-verification/sessions (list+revoke)
        ├── users/                      # GET/PATCH /users/me
        ├── packages/                   # catalog, active, history, purchase (fixed-dollar returns)
        ├── deposits/                   # + pagination, status filter, sorting
        ├── withdrawals/                # + pagination, status filter, sorting
        ├── referrals/                  # referral tracking, commission history
        ├── notifications/              # + pagination
        ├── analytics/                  # dashboard/earnings/performance
        ├── security/                   # trust center, login history, 2FA toggle
        ├── currency/                   # UGX/KES/TZS rates
        └── payments/                   # Flutterwave provider, webhook handling (+ rate limited,
                                        #   atomic compare-and-swap, persisted audit trail)
```

## What's new in this file tree versus the previous delivery

- `tests/` directory and `jest.config.js` — didn't exist before; the `test` script in `package.json` was a dead reference.
- `src/middleware/csrf.middleware.ts` — new file.
- `src/utils/pagination.ts` gained `resolveSort()` — same file, new export.
- Five new root-level documentation files (this one included).

## What's still a single standalone file, not modularized

The frontend remains three large, independent HTML files rather than a component-based build (React/Vue/etc.). This was a deliberate original architecture choice, not an oversight — it keeps the deployment story simple (Express serves static files directly, no build step for the frontend at all) at the cost of some code-sharing between the three pages. Revisiting this would be a legitimate, but large, architectural change beyond the scope of an audit-and-fix pass.
