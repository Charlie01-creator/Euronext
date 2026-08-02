# Final Production Checklist

Checked items are genuinely done and verified within this environment's constraints. Unchecked items are real action items — not filler, not hedging.

## Security

- [x] JWT signing/verification pinned to HS256
- [x] CORS restricted to an explicit allowlist (no wildcard + credentials)
- [x] Content-Security-Policy configured for the exact CDNs in use
- [x] Account lockout after repeated failed logins (independent of IP rate limiting)
- [x] Rate limiting backed by Redis (works correctly across multiple instances)
- [x] CSRF protection on cookie-authenticated endpoints
- [x] Webhook endpoint rate limited
- [x] Webhook signature verification, with a persisted audit trail of every attempt
- [x] Webhook processing is race-condition-safe (atomic compare-and-swap)
- [x] Idempotency keys correctly scoped (lock on success, release on failure)
- [x] Passwords hashed with bcrypt
- [x] Refresh tokens hashed at rest, never stored plaintext
- [x] RBAC infrastructure in place (role field, JWT claim, middleware)
- [ ] **RBAC is not enforced anywhere yet** — no admin routes exist to protect
- [ ] **2FA is a boolean toggle, not a real TOTP implementation**
- [ ] No external security review / penetration test has been performed
- [ ] `npm audit` has never been run (no network access in this environment)

## Database

- [x] Foreign keys correct on every relation, including the previously-missing `Referral` ones
- [x] Composite indexes match real query patterns
- [x] Money stored as `Decimal`, never `Float`
- [ ] **No migration has ever been generated or applied against a real database — this is the single most important remaining action item**
- [ ] No database backup strategy configured (do this on your hosting platform before real funds move through the app)

## Testing

- [x] Jest properly installed and configured (previously referenced in `package.json` but never set up)
- [x] Real, numerically-verified unit tests for money rounding, phone normalization, and pagination/sorting
- [ ] No integration tests (HTTP layer, database interactions)
- [ ] No end-to-end tests of the payment webhook flow
- [ ] Test suite has never actually been run in this environment (no `npm install` possible here) — **run `npm test` yourself before trusting it**

## Accessibility

- [x] 49 previously non-keyboard-accessible interactive elements fixed via a systemic, centralized solution
- [x] Focus-visible styling added, matching the app's existing accent color
- [x] Password-toggle buttons have proper dynamic accessible labels
- [x] Decorative-only elements correctly hidden from assistive tech
- [ ] No full WCAG compliance audit performed
- [ ] Color contrast ratios never explicitly checked
- [ ] No actual screen-reader testing session performed

## Performance

- [x] No N+1 query patterns found on inspection
- [x] Pagination in place on all previously-unbounded list endpoints
- [ ] Zero load testing has ever been performed — all sizing guidance is architectural reasoning, not measured data
- [ ] No caching layer beyond currency-rate caching

## Frontend

- [x] Navigation transitions consistent across all three pages
- [x] No dead links (four were found and fixed)
- [x] Brand name consistent across all pages (one page still said the project's original working name)
- [x] Mobile breakpoints standardized
- [ ] Icon-sizing token system exists only on the dashboard, not the login/register pages (each page is internally consistent; they don't share a token system across separate HTML documents)

## External integrations

- [x] Pesapal fully wired for deposits and package purchases via hosted checkout
- [x] Withdrawals redesigned as admin-approved (Pesapal has no disbursement API) — real admin endpoints built and protected by the RBAC role that previously had nothing to enforce
- [ ] No real SMS/email provider wired for password reset or email verification — tokens are generated correctly but never actually delivered
- [ ] Pesapal merchant verification required before live (non-sandbox) keys are usable for real transactions — this is on Pesapal's side, not something this codebase can do for you
- [ ] No admin frontend UI yet — withdrawal approval currently requires using Swagger (`/docs`) or a REST client directly

## Documentation

- [x] `CHANGELOG.md`, `REVIEW_REPORT.md`, `UPDATED_PROJECT_STRUCTURE.md`, `DEPLOYMENT_GUIDE.md`, this checklist
- [x] `README.md` with full frontend-to-endpoint mapping table
- [x] Swagger/OpenAPI documentation for every endpoint

---

## The realistic path from here to "actually live"

1. Run `npm install` for real, once — this is the first moment any dependency version conflict or missing package would surface, and it hasn't happened yet in this whole engagement.
2. Run `npx prisma migrate dev --name init` against a real Postgres instance.
3. Run `npm test` and confirm the three test suites actually pass (they were written and manually verified line-by-line, but never executed in this environment).
4. Deploy following `DEPLOYMENT_GUIDE.md`.
5. Work through the post-deploy verification checklist at the end of that guide.
6. Decide, based on your own risk tolerance, which unchecked items above (2FA, external security review, load testing, real SMS/email delivery) you need before real users and real money move through this — none of them are technically blocking for a first launch at modest scale, but all of them are real gaps worth a conscious decision rather than an oversight.
