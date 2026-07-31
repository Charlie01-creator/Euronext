# Deployment Guide

## Before you deploy anywhere — three things that are true regardless of platform

1. **No migration has ever been generated.** This has been true since the schema was first written and remains the single most important step. `docker-compose.yml`'s `prisma migrate deploy` *applies* existing migrations — it does not create one from schema drift. Run this once, against your real database, before anything else:
   ```bash
   npx prisma migrate dev --name init
   npx prisma db seed
   ```
2. **`npm install` has never been run in this environment** (no network access during development). Run it yourself once, and commit the resulting `package-lock.json` — the Dockerfile's `npm install` will work without one, but a committed lockfile means reproducible builds.
3. **Generate real secrets** — do not deploy with placeholder values:
   ```bash
   node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
   node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
   node -e "console.log('FLUTTERWAVE_WEBHOOK_SECRET_HASH=' + require('crypto').randomBytes(24).toString('hex'))"
   ```

---

## Option A: Railway (recommended — closest to "point at my repo and it runs")

### 1. Push your code to GitHub
Railway deploys from a GitHub repo, not a zip. If you haven't already, get this project's contents into a repo.

### 2. Create the Railway project
- **railway.com** → sign in with GitHub → **New Project → Deploy from GitHub repo** → select your repo

### 3. Add the two managed databases
In the same project: **+ New → Database → PostgreSQL**, then again for **Redis**. Railway generates connection strings automatically.

### 4. Set environment variables
On your app service → **Variables** tab, add every value from `.env.example`, with real values. Connect `DATABASE_URL`/`REDIS_URL` to the Postgres/Redis services using Railway's reference syntax (`${{Postgres.DATABASE_URL}}`).

### 5. Generate your domain
App service → **Settings → Networking → Generate Domain**. Use that URL for `APP_BASE_URL` and `CORS_ORIGIN`.

### 6. Run the migration
App service → **Settings → Pre-Deploy Command**:
```bash
npx prisma migrate deploy && npx prisma db seed
```
This runs automatically on every deploy — no separate terminal session needed, works from the Railway web dashboard alone.

### 7. Point Flutterwave's webhook at the real URL
Flutterwave dashboard → **Settings → Webhooks** → `https://your-app.up.railway.app/api/v1/payments/webhooks/flutterwave`, plus the same `FLUTTERWAVE_WEBHOOK_SECRET_HASH` you generated above.

### 8. Visit your domain — done.

**Estimated cost at ~2,000 active accounts**: Pro plan ($20/mo included credit) plus modest overage, roughly $25–40/month all-in. Check Railway's Usage tab in your first week live rather than trusting any estimate, including this one.

---

## Option B: Render

Same shape as Railway: connect the GitHub repo, add a **PostgreSQL** and a **Redis** instance from Render's dashboard (both have free tiers, though a paid tier is recommended for anything beyond testing), set the same environment variables, and Render builds from the `Dockerfile` automatically. Slightly more manual than Railway for wiring the database URLs together, but comparable otherwise. Render also supports a pre-deploy/build command field for the migration step.

---

## Option C: Any VPS (DigitalOcean, Linode, Hetzner) via Docker Compose directly

```bash
git clone <your-repo>
cd nexuscapital-backend
cp .env.example .env   # fill in real values
docker compose up --build -d
docker compose exec app npx prisma migrate deploy
docker compose exec app npx prisma db seed
```
Put Nginx (config already included at `docker/nginx.conf`) or a managed load balancer in front for TLS termination.

---

## What does NOT work: static hosts (Netlify, Vercel static, GitHub Pages)

This backend needs a persistent Node process, a real Postgres connection, and a real Redis connection — none of which a static host provides. `netlify.toml` is included in this project specifically for a **frontend-only preview link** (the dashboard's "Continue in Demo Mode" works fully there), not a functioning deployment. Don't expect login, deposits, or withdrawals to work on a Netlify deployment of this project.

---

## Post-deploy verification checklist

1. `GET /health` returns `200`
2. `GET /health/ready` returns `200` with `{"database": true, "redis": true}` — if either is `false`, that connection isn't actually working despite the app being "up"
3. `GET /docs` loads the Swagger UI
4. Register a real test account through the actual UI, not just the API directly
5. Make a real (small, test-mode) Flutterwave deposit and confirm the webhook actually lands — check the `WebhookEvent` table for a `PROCESSED` row, not just that the payment succeeded on Flutterwave's side
