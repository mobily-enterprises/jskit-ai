# Annuity Value Calculator (Fastify + Vue + Vuetify + TanStack)

Client/server annuity calculator with Supabase authentication and MySQL persistence via Knex.

## Architecture

- `server.js`: Fastify bootstrap + static file serving
- `routes/`: URL to controller mapping
- `plugins/auth.js`: auth policy + CSRF + rate-limit wiring
- `controllers/`: HTTP concerns (status codes, request/response)
- `services/`: business logic (auth, annuity math, history)
- `repositories/`: DB queries only

## Stack

- Backend: Fastify
- Frontend: Vue 3 + Vuetify + Vite + TanStack Query + TanStack Router + Pinia
- Auth source of truth: Supabase Auth
- Database: MySQL + Knex (HEAD)
- API docs: `@fastify/swagger` + `@fastify/swagger-ui`
- Security headers: `@fastify/helmet`

## Requirements

- Node.js 20+
- MySQL 8+
- Supabase project (URL + publishable key)

## Install

```bash
npm install
```

## Configure

```bash
export DB_HOST="127.0.0.1"
export DB_PORT="3306"
export DB_NAME="material-app"
export DB_USER="annuity_app"
export DB_PASSWORD="replace-with-a-strong-password"

export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
export SUPABASE_PUBLISHABLE_KEY="YOUR_SUPABASE_PUBLISHABLE_KEY"
# optional; defaults to "authenticated"
export SUPABASE_JWT_AUDIENCE="authenticated"
# optional but recommended; reset links use: APP_PUBLIC_URL + /reset-password
export APP_PUBLIC_URL="http://localhost:5173"
```

The server loads `.env` (and `.env.local`) via `dotenv`, so you can place the same key/value pairs in that file instead of exporting them manually before each command.

Notes:

- Do not use MySQL `root` for production app traffic.
- Keep secrets in environment variables only.
- Runtime/application code is ESM. Knex CLI files stay as `.cjs` by design.

## Database setup

Create DB once:

```bash
node -e "const mysql=require('mysql2/promise'); (async()=>{const dbName=(process.env.DB_NAME||'material-app').replace(/`/g,''); const c=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:'mysql'}); await c.query('CREATE DATABASE IF NOT EXISTS `'+dbName+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); await c.end();})()"
```

Run migrations:

```bash
npm run db:migrate
```

Migrations are intentionally not executed at app boot; run them explicitly during deployment/startup.

This scaffold assumes a fresh install. If an old local `knex_migrations` table references legacy migration filenames,
reset that local database before running `npm run db:migrate`.

Optional seed data:

```bash
npm run db:seed
```

Always run `npm run db:migrate` before any seed command.

Seed files:

- `seeds/01_user_profiles_seed.cjs`
- `seeds/02_calculation_logs_seed.cjs`

Run a specific seed file:

```bash
npm run db:seed:users
npm run db:seed:calculator
```

## Development

Terminal 1 (API):

```bash
npm run db:migrate
npm run server
```

Terminal 2 (frontend):

```bash
npm run dev
```

Open `http://localhost:5173`.

Notes:

- In development, backend can run without a built `dist/` folder.
- If `dist/` is missing, backend serves API only; Vite serves the frontend.

## Production-style run

```bash
npm run db:migrate
npm run build
npm start
```

Open `http://localhost:3000`.

Swagger UI is available at `http://localhost:3000/api/docs` in non-production mode.

## Release process

Use `docs/release-checklist.md` before shipping.

## End-to-End Tests

Install browser once:

```bash
npm run test:e2e:install
```

Run Playwright tests:

```bash
npm run test:e2e
```

## Lint and format

```bash
npm run lint
npm run format:check
```

## API contracts (v1)

- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/session`
- `POST /api/password/forgot`
- `POST /api/password/recovery`
- `POST /api/password/reset`
- `GET /api/history`
- `POST /api/annuity`

Auth/security behavior:

- API routes declare `authPolicy` as `public`, `required`, or `own`.
- Login/register routes are rate-limited.
- Password reset routes are rate-limited and return generic forgot-password responses.
- All unsafe API methods (`POST/PUT/PATCH/DELETE`) enforce CSRF token checks.
- Access tokens are verified locally against Supabase JWKS; refresh is only attempted when access token is expired.
- Transient JWKS/network failures return temporary auth errors without clearing valid sessions.

CSRF notes:

- `GET /api/session` returns `csrfToken`.
- Unsafe requests must send `csrf-token` header.
- The shipped frontend handles this automatically.

`/api/annuity` supports finite and perpetual PV calculations:

```json
{
  "mode": "pv",
  "payment": 500,
  "annualRate": 6,
  "annualGrowthRate": 3,
  "paymentsPerYear": 12,
  "timing": "ordinary",
  "isPerpetual": true
}
```

Validation errors return HTTP 400 with `fieldErrors`.

Password reset flow:

1. User clicks `Forgot password?` on `/login`.
2. Frontend calls `POST /api/password/forgot` with email.
3. Supabase sends recovery link to `${APP_PUBLIC_URL}/reset-password`.
4. `/reset-password` exchanges recovery link data via `POST /api/password/recovery`.
5. User submits new password to `POST /api/password/reset`.
