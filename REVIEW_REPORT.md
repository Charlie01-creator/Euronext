# Review Report — NexusCapital Platform

This report covers the complete audit-and-remediation engagement across every session, not just this final pass. Scores are calibrated conservatively — they reflect what was actually verified, not aspirational targets.

---

## 1. Issues Found (cumulative, across the whole engagement)

### Critical / High severity
| # | Issue | Where |
|---|---|---|
| 1 | CORS misconfigured — `'*'` origin combined with `credentials: true` (invalid per spec, dangerous if a client tolerated it) | `app.ts` |
| 2 | JWT verification didn't pin algorithm — algorithm-confusion attack surface | `jwt.ts` |
| 3 | Webhook race condition — concurrent deliveries could double-credit a user's balance | `payments.service.ts` |
| 4 | Webhook responded 200 before processing finished — real failures got silently lost with no retry | `payments.routes.ts` |
| 5 | Idempotency keys locked permanently on failure, blocking legitimate retries | `idempotency.middleware.ts` |
| 6 | No account lockout — brute-force protection was IP-based only, trivially bypassed | `auth.service.ts` |
| 7 | Rate limiting was in-memory — multiple instances would each get their own limit | `rateLimit.middleware.ts` |
| 8 | `Referral.referrerId`/`referredId` had no foreign key — no referential integrity | `schema.prisma` |
| 9 | No CSRF protection on cookie-authenticated endpoints | `auth.routes.ts` |
| 10 | Webhook endpoint had zero rate limiting, unlike every other route | `payments.routes.ts` |
| 11 | 49 interactive `<div>` elements with no keyboard accessibility at all | `nexus-dashboard-mobile.html` |

### Medium severity
- Helmet running on bare defaults — the CSP that would result would have silently blocked the Font Awesome and Socket.IO CDNs the frontend actually uses.
- `validate.middleware.ts` typed its parameter as `AnyZodObject`, incompatible with `.refine()`-based schemas — latent bug that would surface on a real `tsc` build.
- No pagination on deposits/withdrawals/notifications — unbounded result sets.
- No email verification or password reset flow existed at all.
- Money arithmetic (commission calculation, package returns, currency conversion) used raw floating-point math with no explicit rounding before persistence or API calls.
- `test` script in `package.json` referenced Jest, which was never actually installed, configured, or had any test files — a completely non-functional script.

### Low severity / correctness
- Four dead links to `nexus-invest.html`, a file never built in this project.
- Login page still branded "Euronext" (the project's original working name) in three places while every other page said "NexusCapital."
- Mismatched mobile breakpoint (540px vs 560px) between the login page and the rest of the app.
- No sort-field allowlisting on list endpoints (would have accepted any client-supplied string into a Prisma `orderBy`).
- Icon-only password-toggle buttons had no accessible label.

---

## 2. Issues Fixed

Every item in the table above has been fixed and verified — see `CHANGELOG.md` for the full technical detail on each. Verification method throughout: structural brace/paren balance checks, `tsc --noResolve` syntax-level TypeScript checks, JS syntax checks on every frontend script block, duplicate-ID scans, and (new in this pass) numerically-verified unit tests for pure-logic code.

**Important honesty note on verification**: this environment has never had network access, so no fix in this entire engagement has been verified against a real `npm install`, a live PostgreSQL/Redis connection, or an actual `tsc` build with real type packages resolved. The `--noResolve` syntax checks catch real structural and logic errors (and did catch several, including bugs I introduced myself mid-edit) but cannot catch type errors that only surface once the real `@types/*` packages are resolved. **Running `npm install && npm run build && npm test` for real, once, before deploying, is not optional** — it's the one verification step that could not be done here.

---

## 3. Files Modified (this final pass)

`src/middleware/rateLimit.middleware.ts`, `src/middleware/csrf.middleware.ts` (new), `src/modules/payments/payments.routes.ts`, `src/modules/auth/auth.controller.ts`, `src/modules/auth/auth.routes.ts`, `src/modules/auth/auth.service.ts`, `src/utils/pagination.ts`, `src/modules/deposits/deposits.routes.ts`, `src/modules/withdrawals/withdrawals.routes.ts`, `public/nexus-dashboard-mobile.html`, `public/index.html`, `public/nexus-register.html`, `package.json`, `jest.config.js` (new), `tests/money.test.ts` (new), `tests/auth.service.test.ts` (new), `tests/pagination.test.ts` (new).

(Full cross-session file history is in `CHANGELOG.md`.)

---

## 4. Remaining Recommendations — not done, named plainly

- **No admin panel or admin-authorized routes exist.** The RBAC infrastructure (`role` field, JWT claim, `requireRole()` middleware) is built and ready, but nothing actually uses it yet — there's no admin module to protect.
- **2FA is a boolean toggle, not a real TOTP implementation.** `twoFactorEnabled`/`twoFactorSecret` exist on the `User` model but no actual one-time-code generation/verification flow was built.
- **No load testing has ever been performed.** Sizing recommendations given earlier in this engagement (for ~2,000 users) are based on architectural reasoning (what the app does per request), not measured results.
- **Test coverage is a real start, not comprehensive.** Three test suites cover pure-logic utilities (money rounding, phone normalization, pagination). Nothing tests the actual HTTP layer, database interactions, or payment webhook flows — those would need a test database and mocked Flutterwave responses, a meaningfully larger undertaking.
- **No real email/SMS provider is wired up.** Password reset and email verification tokens are generated correctly and logged, but nothing actually delivers them to a user.
- **Full WCAG compliance was not audited.** This pass fixed the single largest, most concrete accessibility gap (keyboard access to interactive divs) and a few labeling issues. Color contrast ratios, full screen-reader walkthroughs of every flow, and semantic heading structure were not audited.
- **No migrations have ever been generated.** Every schema change across this entire engagement still needs `npx prisma migrate dev` run once against a real database — this has been true since the first schema was written and remains the single most important action item before deployment.

---

## 5. Scores (0–100)

Each score below includes the reasoning behind the number, not just the figure — a bare number without justification isn't useful to you.

| Category | Score | Why |
|---|---|---|
| **Production Readiness** | **70** | Strong, real fixes throughout — but genuinely blocked on two external steps that couldn't be done in this environment: generating the first real migration, and a real `npm install` + build verification. Not a reflection of code quality; a reflection of what's structurally still outstanding. |
| **Security** | **80** | The high-severity items (CORS, JWT, CSRF, webhook race condition, rate limiting) are genuinely fixed, not just documented. Held back from higher by: RBAC exists but is unenforced anywhere (no admin routes yet), 2FA is not a real implementation, and no external security review/pen test has ever touched this code. |
| **Performance** | **65** | No N+1 queries found on inspection, pagination exists on the endpoints that needed it, Redis-backed rate limiting scales across instances. Held back by: zero load testing ever performed, no caching strategy beyond currency rates, and no query performance data from real traffic. |
| **Maintainability** | **75** | Consistent modular structure held up well across many sessions of changes, comprehensive documentation now exists, real (if minimal) test infrastructure now exists. Held back by: test coverage is a starting point, not comprehensive, and the frontend is three large standalone HTML files rather than a component-based structure. |
| **Accessibility** | **58** | The single largest, most legitimate gap (49 non-keyboard-accessible interactive elements) is now fixed with a real, systemic solution, not a token gesture. Held back significantly by: no full WCAG audit, no color-contrast verification, no actual screen-reader testing session, and this pass focused on the dashboard specifically — the login/register pages already used semantic `<button>` elements and needed smaller, targeted fixes. |
| **Scalability** | **66** | Rate limiting and JWT auth are both stateless/distributable, which matters most as this scales. Held back by: single-instance assumptions baked into the original sizing guidance, no read replicas or caching layer, and — again — zero load testing to confirm any of this holds up under real concurrent traffic. |

---

## Bottom line

This is a genuinely well-hardened, carefully-built application for its scale — the security work in particular reflects real, verified fixes to real bugs (including a legitimate race condition that could have double-credited user funds). It is not, however, a "deploy today with full confidence" state — the migration step and a real dependency install are concrete, named, unavoidable actions that have to happen outside this environment before any of this matters in production.
